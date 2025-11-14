import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import {
  DriftClient,
  Wallet,
  getUserAccountPublicKey,
  PerpMarkets,
  SpotMarkets,
  PositionDirection,
  OrderType,
  BN,
} from '@drift-labs/sdk';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  Commitment,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

type Direction = 'long' | 'short';

@Injectable()
export class DriftService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DriftService.name);

  private driftClient!: DriftClient;
  private connection!: Connection;
  private wallet!: Wallet;

  private readonly rpcUrl =
    process.env.RPC_URL || 'https://api.devnet.solana.com';
  private readonly commitment: Commitment = 'confirmed';
  
  private lastFetchTime = 0;
  private fetchCooldown = 1000;
  
  // Drift supports multiple sub-accounts per wallet for position isolation
  private readonly subAccountId = 0;
  
  // Base precision for perpetual contract sizes (9 decimals)
  private readonly BASE = 1_000_000_000;

  async onModuleInit() {
    await this.initialize();
  }

  async onModuleDestroy() {
    try {
      await this.driftClient?.unsubscribe();
    } catch {}
  }

  private async initialize() {
    const secretKey = process.env.SECRET_KEY_BASE58;
    if (!secretKey) {
      throw new Error('SECRET_KEY_BASE58 not found in env');
    }

    this.connection = new Connection(this.rpcUrl, this.commitment);
    const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
    this.wallet = new Wallet(keypair);

    // Initialize Drift client with devnet configuration
    // The SDK handles all protocol interactions including order placement,
    // position management, and account state synchronization
    this.driftClient = new DriftClient({
      connection: this.connection,
      wallet: this.wallet,
      env: 'devnet',
      activeSubAccountId: this.subAccountId,
    });

    // Subscribe to account updates for real-time position and balance data
    await this.driftClient.subscribe();
    this.logger.log(
      `Drift connected on Devnet. Wallet ${this.wallet.publicKey.toBase58()}`,
    );
  }

  // Get USDC mint address from Drift's spot market configuration
  // Spot market 0 is USDC on devnet
  private getUsdcMint(): PublicKey {
    return new PublicKey(SpotMarkets['devnet'][0].mint);
  }

  // Determine if USDC uses standard Token Program or Token-2022
  private async getMintProgramId(mint: PublicKey): Promise<PublicKey> {
    const info = await this.connection.getAccountInfo(mint);
    if (!info) throw new Error('USDC mint account not found on chain');
    return info.owner;
  }

  // Ensure Associated Token Account exists for USDC
  // ATA is a deterministic address for holding SPL tokens
  private async ensureUsdcAta(): Promise<PublicKey> {
    const mint = this.getUsdcMint();
    const programId = await this.getMintProgramId(mint);

    const ata = await getAssociatedTokenAddress(
      mint,
      this.wallet.publicKey,
      false,
      programId,
    );
    const info = await this.connection.getAccountInfo(ata);
    if (!info) {
      const ix = createAssociatedTokenAccountInstruction(
        this.wallet.publicKey,
        ata,
        this.wallet.publicKey,
        mint,
        programId,
      );
      const sig = await this.connection.sendTransaction(
        new Transaction().add(ix),
        [this.wallet.payer],
      );
      await this.connection.confirmTransaction(sig, this.commitment);
      this.logger.log(
        `Created USDC ATA (${programId.equals(TOKEN_2022_PROGRAM_ID) ? 'token-2022' : 'token'}): ${ata.toBase58()}`,
      );
    }
    return ata;
  }

  private async sweepUsdcToAta(ata: PublicKey): Promise<number> {
    const mint = this.getUsdcMint();
    const programId = await this.getMintProgramId(mint);

    const list = await this.connection.getTokenAccountsByOwner(
      this.wallet.publicKey,
      { mint, programId },
    );
    let moved = 0;

    for (const { pubkey } of list.value) {
      if (pubkey.equals(ata)) continue;
      const info = await this.connection.getAccountInfo(pubkey);
      if (!info) continue;

      const acc = await getAccount(this.connection, pubkey);
      const amount = acc.amount;
      if (amount === BigInt(0)) continue;

      const ix = createTransferInstruction(
        pubkey,
        ata,
        this.wallet.publicKey,
        amount,
        [],
        programId,
      );
      const sig = await this.connection.sendTransaction(
        new Transaction().add(ix),
        [this.wallet.payer],
      );
      await this.connection.confirmTransaction(sig, this.commitment);
      this.logger.log(
        `Moved ${(Number(amount) / 1e6).toFixed(6)} USDC → ATA (${sig})`,
      );
      moved += Number(amount);
    }
    return moved;
  }

  // Convert human-readable size to base units with minimum step sizes
  // Each market has different precision requirements
  private toBaseAmount(size: number, marketIndex: number): BN {
    const raw = Math.round(size * this.BASE);
    let minStep = 1;
    if (marketIndex === 0)
      minStep = 10_000_000;  // SOL-PERP: 0.01 minimum
    else if (marketIndex === 1)
      minStep = 100_000;  // ETH-PERP: 0.0001 minimum
    else if (marketIndex === 2) 
      minStep = 1_000_000;  // BTC-PERP: 0.001 minimum
    return new BN(Math.max(raw, minStep));
  }

  async status() {
    const userAccountPk = await getUserAccountPublicKey(
      this.driftClient.program.programId,
      this.wallet.publicKey,
      this.subAccountId,
    );
    const info = await this.connection.getAccountInfo(userAccountPk);
    const lamports = await this.connection.getBalance(this.wallet.publicKey);

    return {
      wallet: this.wallet.publicKey.toBase58(),
      userAccount: userAccountPk.toBase58(),
      accountExists: info !== null,
      walletSol: lamports / 1e9,
    };
  }

  // Initialize a Drift user account for this wallet
  // Required before trading - creates on-chain account to track positions
  async initAccount() {
    try {
      const tx = await this.driftClient.initializeUserAccount(
        this.subAccountId,
      );
      const sig = Array.isArray(tx) ? tx[0] : tx;
      return { ok: true, signature: sig };
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('already') || msg.includes('0x0')) {
        return { ok: true, already: true };
      }
      throw e;
    }
  }

  async markets() {
    return {
      perps: PerpMarkets['devnet'],
      spots: SpotMarkets['devnet'],
    };
  }

  private async rateLimitedFetch() {
    const now = Date.now();
    const elapsed = now - this.lastFetchTime;
    if (elapsed < this.fetchCooldown) {
      await new Promise((r) => setTimeout(r, this.fetchCooldown - elapsed));
    }
    await this.driftClient.fetchAccounts();
    this.lastFetchTime = Date.now();
  }

  async positions() {
    await this.rateLimitedFetch();
    const user = this.driftClient.getUser(this.subAccountId);
    const perps = user
      .getActivePerpPositions()
      .filter((p) => !p.baseAssetAmount.eq(new BN(0)))
      .map((p) => {
        const market = PerpMarkets['devnet'].find(
          (m) => m.marketIndex === p.marketIndex,
        );
        const isLong = p.baseAssetAmount.gt(new BN(0));
        const size = p.baseAssetAmount.abs().toNumber() / this.BASE;

        let entryPrice = 0;
        if (
          !p.quoteAssetAmount.eq(new BN(0)) &&
          !p.baseAssetAmount.eq(new BN(0))
        ) {
          const quote = p.quoteAssetAmount.abs().toNumber() / 1_000_000;
          const base = p.baseAssetAmount.abs().toNumber() / this.BASE;
          entryPrice = quote / base;
        }

        return {
          marketIndex: p.marketIndex,
          marketSymbol: market?.symbol ?? `Market ${p.marketIndex}`,
          direction: isLong ? 'LONG' : 'SHORT',
          size,
          entryPrice,
          rawBase: p.baseAssetAmount.toString(),
        };
      });

    return { perps };
  }

  async accountValue() {
    await this.rateLimitedFetch();
    const user = this.driftClient.getUser(this.subAccountId);
    const spots = user.getActiveSpotPositions().map((s) => {
      const m = SpotMarkets['devnet'][s.marketIndex];
      return {
        marketIndex: s.marketIndex,
        symbol: m.symbol,
        scaledBalance: s.scaledBalance.toString(),
      };
    });

    return {
      spots,
      totalCollateral: (user.getTotalCollateral() ?? new BN(0)).toString(),
      initialMarginRequirement: (
        user.getInitialMarginRequirement() ?? new BN(0)
      ).toString(),
      maintenanceMarginRequirement: (
        user.getMaintenanceMarginRequirement() ?? new BN(0)
      ).toString(),
    };
  }

  // Open a perpetual position on a specified market
  // LONG = profit when price rises, SHORT = profit when price falls
  async open(marketIndex: number, direction: Direction, size: number) {
    try {
      const userAccountPk = await getUserAccountPublicKey(
        this.driftClient.program.programId,
        this.wallet.publicKey,
        this.subAccountId,
      );
      const info = await this.connection.getAccountInfo(userAccountPk);
      if (!info) {
        return {
          ok: false,
          message: 'Drift account not initialized',
        };
      }

      const baseAmount = this.toBaseAmount(size, marketIndex);
      
      // Place a market order that executes immediately at best available price
      const txSig = await this.driftClient.placePerpOrder({
        orderType: OrderType.MARKET,
        marketIndex,
        direction:
          direction === 'long' ? PositionDirection.LONG : PositionDirection.SHORT,
        baseAssetAmount: baseAmount,
      });

      await this.rateLimitedFetch();
      const user = this.driftClient.getUser(this.subAccountId);
      const pos = user.getPerpPosition(marketIndex);

      return {
        ok: true,
        signature: txSig,
        opened: pos ? !pos.baseAssetAmount.eq(new BN(0)) : false,
        rawBase: pos?.baseAssetAmount?.toString() ?? '0',
        solscan: `https://solscan.io/tx/${txSig}?cluster=devnet`,
      };
    } catch (e: any) {
      this.logger.error('Failed to open position:', e.message);
      return {
        ok: false,
        message: e.message || 'Failed to open position',
      };
    }
  }

  // Close an existing position by placing opposite order
  // LONG positions close with SHORT order, SHORT positions close with LONG order
  async close(marketIndex: number) {
    await this.rateLimitedFetch();
    const user = this.driftClient.getUser(this.subAccountId);
    const pos = user.getPerpPosition(marketIndex);

    if (!pos || pos.baseAssetAmount.eq(new BN(0))) {
      return { ok: false, reason: 'no-open-position' };
    }

    // Determine opposite direction to close position
    const isLong = pos.baseAssetAmount.gt(new BN(0));
    const dir = isLong ? PositionDirection.SHORT : PositionDirection.LONG;

    // reduceOnly ensures we only close existing position, not open new one
    const txSig = await this.driftClient.placePerpOrder({
      orderType: OrderType.MARKET,
      marketIndex,
      direction: dir,
      baseAssetAmount: pos.baseAssetAmount.abs(),
      reduceOnly: true,
    });

    return {
      ok: true,
      signature: txSig,
      solscan: `https://solscan.io/tx/${txSig}?cluster=devnet`,
    };
  }

  // Deposit USDC collateral to Drift account
  // Collateral is required to open leveraged positions
  async depositUsdc(amount: number) {
    const userAccountPk = await getUserAccountPublicKey(
      this.driftClient.program.programId,
      this.wallet.publicKey,
      this.subAccountId,
    );
    if (!(await this.connection.getAccountInfo(userAccountPk))) {
      throw new Error('Drift account not initialized');
    }

    const ata = await this.ensureUsdcAta();
    await this.sweepUsdcToAta(ata);

    const acc = await getAccount(this.connection, ata);
    const mintInfo = await getMint(this.connection, acc.mint);
    const dp = mintInfo.decimals || 6;
    const bal = Number(acc.amount) / 10 ** dp;

    if (bal < amount) {
      return {
        ok: false,
        reason: 'insufficient-usdc',
        have: bal,
        need: amount,
      };
    }

    const depositAmount = new BN(Math.round(amount * 10 ** dp));
    // Deposit to spot market 0 (USDC) on Drift
    const tx = await this.driftClient.deposit(depositAmount, 0, ata);
    const sig = Array.isArray(tx) ? tx[0] : tx;

    return {
      ok: true,
      signature: sig,
      solscan: `https://solscan.io/tx/${sig}?cluster=devnet`,
    };
  }

  async depositSol(amount: number) {
    const userAccountPk = await getUserAccountPublicKey(
      this.driftClient.program.programId,
      this.wallet.publicKey,
      this.subAccountId,
    );
    if (!(await this.connection.getAccountInfo(userAccountPk))) {
      throw new Error('Drift account not initialized');
    }

    const walletLamports = await this.connection.getBalance(
      this.wallet.publicKey,
    );
    const walletSol = walletLamports / 1e9;
    const minReserve = 0.05;

    if (walletSol < amount + minReserve) {
      return {
        ok: false,
        reason: 'insufficient-sol',
        have: walletSol,
        need: amount,
        note: `Keep ${minReserve} SOL for tx fees`,
      };
    }

    const solMarketIndex = SpotMarkets['devnet'].findIndex(
      (m) => m.symbol === 'SOL',
    );
    if (solMarketIndex === -1) {
      throw new Error('SOL spot market not found in Drift devnet config');
    }

    const depositAmount = new BN(Math.round(amount * 1e9));
    const tx = await this.driftClient.deposit(
      depositAmount,
      solMarketIndex,
      this.wallet.publicKey,
    );
    const sig = Array.isArray(tx) ? tx[0] : tx;

    return {
      ok: true,
      signature: sig,
      solscan: `https://solscan.io/tx/${sig}?cluster=devnet`,
    };
  }

  async doctor() {
    const status = await this.status();

    const mint = this.getUsdcMint();
    const programId = await this.getMintProgramId(mint);
    const list = await this.connection.getTokenAccountsByOwner(
      this.wallet.publicKey,
      { mint, programId },
    );

    type UsdcAcct = { account: string; balance: number };
    const usdc: UsdcAcct[] = [];

    for (const { pubkey } of list.value) {
      try {
        const acc = await getAccount(this.connection, pubkey);
        const mintInfo = await getMint(this.connection, acc.mint);
        const dec = mintInfo.decimals ?? 6;

        usdc.push({
          account: pubkey.toBase58(),
          balance: Number(acc.amount) / 10 ** dec,
        });
      } catch {}
    }

    const risk = await this.accountValue();

    return {
      status,
      tokenProgram: programId.equals(TOKEN_2022_PROGRAM_ID)
        ? 'token-2022'
        : 'token',
      usdc,
      risk,
    };
  }
}
