// CLI tool for interacting with Drift Protocol on Solana Devnet
// this does the account management, depositing collateral, and trading perpetuals

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

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { config } from 'dotenv';
import bs58 from 'bs58';

import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createTransferInstruction,
} from '@solana/spl-token';

config();

let driftClient: DriftClient;
let wallet: Wallet;
let connection: Connection;

const DEFAULT_RPC = process.env.RPC_URL || 'https://api.devnet.solana.com';
const SUB_ACCOUNT_ID = 0;  // Use first sub-account
const BASE = 1_000_000_000;  // 9 decimal precision for perp sizes

// Get USDC mint address from Drift's devnet configuration
function getUsdcMint(): PublicKey {
  return new PublicKey(SpotMarkets['devnet'][0].mint);
}

// Determine which token program (standard or Token-2022) owns this mint
async function getMintProgramId(mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error('USDC mint account not found on chain');
  return info.owner;
}

// Initialize connection to Drift Protocol on Solana Devnet
async function initializeDrift() {
  connection = new Connection(DEFAULT_RPC, 'confirmed');

  const secretKey = process.env.SECRET_KEY_BASE58;
  if (!secretKey) throw new Error('SECRET_KEY_BASE58 not found in .env');

  const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
  wallet = new Wallet(keypair);

  console.log('Connecting to Drift on Devnet...');
  console.log('Wallet:', wallet.publicKey.toBase58());

  // Initialize Drift client - handles all protocol interactions
  driftClient = new DriftClient({
    connection,
    wallet,
    env: 'devnet',
    activeSubAccountId: SUB_ACCOUNT_ID,
  });

  // Subscribe to real-time account updates
  await driftClient.subscribe();
  console.log('Connected to Drift Protocol');
}

async function getSolBalance(): Promise<number> {
  const lamports = await connection.getBalance(wallet.publicKey);
  const sol = lamports / 1e9;
  console.log('\nWallet Balance:', sol, 'SOL');
  return sol;
}

async function checkAccount(): Promise<boolean> {
  const userAccountPk = await getUserAccountPublicKey(
    driftClient.program.programId,
    wallet.publicKey,
    SUB_ACCOUNT_ID,
  );
  const info = await connection.getAccountInfo(userAccountPk);
  const exists = info !== null;

  console.log('\nDrift Account Info:');
  console.log('Account Public Key:', userAccountPk.toBase58());
  console.log('Account Exists:', exists ? 'yes' : 'no');

  if (!exists) console.log('\nRun "npm run drift:init" to create account');
  return exists;
}

async function initializeAccount() {
  console.log('\nInitializing account...');
  try {
    const tx = await driftClient.initializeUserAccount(SUB_ACCOUNT_ID);
    const sig = Array.isArray(tx) ? tx[0] : tx;
    console.log('Initialized');
    console.log('TX:', sig);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('already') || msg.includes('0x0')) {
      console.log('Account exists');
    } else {
      throw e;
    }
  }
}

async function listMarkets() {
  const perps = PerpMarkets['devnet'];
  const spots = SpotMarkets['devnet'];

  console.log('\nPerp Markets:');
  perps.forEach((m) => console.log(`  ${m.marketIndex}: ${m.symbol}`));

  console.log('\nSpot Markets:');
  spots.forEach((m) => console.log(`  ${m.marketIndex}: ${m.symbol}`));
}

async function getCanonicalUsdcAta(): Promise<PublicKey> {
  const mint = getUsdcMint();
  const programId = await getMintProgramId(mint);

  const ata = await getAssociatedTokenAddress(
    mint,
    wallet.publicKey,
    false,
    programId,
  );

  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const ix = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      ata,
      wallet.publicKey,
      mint,
      programId,
    );
    const sig = await connection.sendTransaction(new Transaction().add(ix), [
      wallet.payer,
    ]);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log(
      `Created USDC ATA (${programId.equals(TOKEN_2022_PROGRAM_ID) ? 'token-2022' : 'token'}):`,
      ata.toBase58(),
    );
  }
  return ata;
}

async function moveUsdcIntoAta(ata: PublicKey): Promise<number> {
  const mint = getUsdcMint();
  const programId = await getMintProgramId(mint);

  const list = await connection.getTokenAccountsByOwner(wallet.publicKey, {
    mint,
    programId,
  });

  let moved = 0;
  for (const { pubkey } of list.value) {
    if (pubkey.equals(ata)) continue;

    const info = await connection.getAccountInfo(pubkey);
    if (!info) continue;

    const acc = await getAccount(connection, pubkey);
    const amount = acc.amount;
    if (amount === BigInt(0)) continue;

    const ix = createTransferInstruction(
      pubkey,
      ata,
      wallet.publicKey,
      amount,
      [],
      programId,
    );
    const sig = await connection.sendTransaction(new Transaction().add(ix), [
      wallet.payer,
    ]);
    await connection.confirmTransaction(sig, 'confirmed');

    console.log(
      `Moved ${(Number(amount) / 1e6).toFixed(6)} USDC → ATA (${sig})`,
    );
    moved += Number(amount);
  }
  return moved;
}

// Deposit USDC collateral to Drift account
// Collateral is required to open leveraged positions
async function depositCollateral(amount: number) {
  console.log(`\nDepositing ${amount} USDC as collateral...`);
  if (!(await checkAccount())) return;

  try {
    const ata = await getCanonicalUsdcAta();
    await moveUsdcIntoAta(ata);

    const acc = await getAccount(connection, ata);
    const mintInfo = await getMint(connection, acc.mint);
    const dp = mintInfo.decimals;
    const bal = Number(acc.amount) / 10 ** dp;
    console.log(`USDC ATA: ${ata.toBase58()} (decimals=${dp}) balance=${bal}`);

    if (bal < amount) {
      console.error(
        `Insufficient USDC in ATA. Have ${bal}, need ${amount}. Airdrop USDC in Drift Devnet UI, then retry.`,
      );
      return;
    }

    const depositAmount = new BN(Math.round(amount * 10 ** dp));
    // Deposit to spot market 0 (USDC)
    const tx = await driftClient.deposit(
      depositAmount,
      0,
      ata,
    );
    const sig = Array.isArray(tx) ? tx[0] : tx;

    console.log('Deposited');
    console.log('TX:', sig);
    console.log(`View: https://solscan.io/tx/${sig}?cluster=devnet`);
  } catch (e: any) {
    console.error('Error during deposit:', e?.message || e);
  }
}

async function depositSolCollateral(amount: number) {
  console.log(`\nDepositing ${amount} SOL as collateral...`);
  if (!(await checkAccount())) return;

  try {
    const walletLamports = await connection.getBalance(wallet.publicKey);
    const walletSol = walletLamports / 1e9;
    const minReserve = 0.05;

    console.log(`Wallet balance: ${walletSol} SOL`);

    if (walletSol < amount + minReserve) {
      console.error(
        `Insufficient SOL. Have ${walletSol}, need ${amount} + ${minReserve} (for tx fees)`,
      );
      return;
    }

    const solMarketIndex = SpotMarkets['devnet'].findIndex(
      (m) => m.symbol === 'SOL',
    );
    if (solMarketIndex === -1) {
      console.error('SOL spot market not found in Drift devnet config');
      return;
    }

    const depositAmount = new BN(Math.round(amount * 1e9));
    const tx = await driftClient.deposit(
      depositAmount,
      solMarketIndex,
      wallet.publicKey,
    );
    const sig = Array.isArray(tx) ? tx[0] : tx;

    console.log('Deposited');
    console.log('TX:', sig);
    console.log(`View: https://solscan.io/tx/${sig}?cluster=devnet`);
  } catch (e: any) {
    console.error('Error during deposit:', e?.message || e);
  }
}

async function doctor() {
  console.log('\nDrift Doctor: Collateral & Accounts');
  await checkAccount();

  const mint = getUsdcMint();
  const programId = await getMintProgramId(mint);
  const list = await connection.getTokenAccountsByOwner(wallet.publicKey, {
    mint,
    programId,
  });

  if (list.value.length === 0) {
    console.log('\nNo USDC token accounts found for your wallet.');
    console.log('Use Drift Devnet UI to Airdrop USDC to your wallet first.');
  } else {
    console.log(`\nWallet USDC accounts (${list.value.length}):`);
    for (const { pubkey } of list.value) {
      try {
        const acc = await getAccount(connection, pubkey);
        const dec = (await getMint(connection, acc.mint)).decimals;
        console.log(
          `  ${pubkey.toBase58()}  balance=${Number(acc.amount) / 10 ** dec}`,
        );
      } catch {}
    }
  }

  await driftClient.fetchAccounts();
  const user = driftClient.getUser(SUB_ACCOUNT_ID);
  const spots = user.getActiveSpotPositions();
  console.log('\nDrift Spot Positions:');
  if (spots.length === 0) console.log('  (none)');
  for (const s of spots) {
    const m = SpotMarkets['devnet'][s.marketIndex];
    console.log(
      `  ${m.symbol} (market ${s.marketIndex}) scaledBalance=${s.scaledBalance.toString()}`,
    );
  }

  const totalCollat = (user.getTotalCollateral() ?? new BN(0)).toString();
  const imr = (user.getInitialMarginRequirement() ?? new BN(0)).toString();
  const mmr = (user.getMaintenanceMarginRequirement() ?? new BN(0)).toString();

  console.log('\nQuick risk view:');
  console.log('  totalCollateral:', totalCollat);
  console.log('  initialMarginRequirement:', imr);
  console.log('  maintenanceMarginRequirement:', mmr);
}

// Convert human-readable size to base units
// Enforces minimum step sizes per market
function toBaseAmount(size: number, marketIndex: number): BN {
  const raw = Math.round(size * BASE);
  let minStep = 1;
  if (marketIndex === 0)
    minStep = 10_000_000;  // SOL-PERP: 0.01 minimum
  else if (marketIndex === 1)
    minStep = 100_000;  // ETH-PERP: 0.0001 minimum
  else if (marketIndex === 2) 
    minStep = 1_000_000;  // BTC-PERP: 0.001 minimum
  const adjusted = Math.max(raw, minStep);
  return new BN(adjusted);
}

// Open a perpetual position
// LONG = profit when price increases, SHORT = profit when price decreases
async function openPosition(
  marketIndex: number,
  direction: 'long' | 'short',
  size: number,
) {
  console.log(`\nOpening ${direction.toUpperCase()} position`);
  console.log(`Market Index: ${marketIndex}`);
  console.log(`Size: ${size} units`);

  if (!(await checkAccount())) return;

  try {
    const baseAmount = toBaseAmount(size, marketIndex);
    console.log(`Base amount: ${baseAmount.toString()}`);

    // Place market order - executes immediately at best price
    const txSig = await driftClient.placePerpOrder({
      orderType: OrderType.MARKET,
      marketIndex,
      direction:
        direction === 'long' ? PositionDirection.LONG : PositionDirection.SHORT,
      baseAssetAmount: baseAmount,
    });

    console.log('Opened:', txSig);
    console.log(`https://solscan.io/tx/${txSig}?cluster=devnet`);

    await driftClient.fetchAccounts();
    const user = driftClient.getUser(SUB_ACCOUNT_ID);
    const pos = user.getPerpPosition(marketIndex);
    if (pos && !pos.baseAssetAmount.eq(new BN(0))) {
      console.log('Opened base:', pos.baseAssetAmount.toString());
    } else {
      console.log(
        'No non-zero position recorded after order. Check collateral/fills.',
      );
    }
  } catch (e: any) {
    console.error('Error opening position:', e?.message || e);
  }
}

async function closePosition(marketIndex: number) {
  console.log(`\nClosing position on market ${marketIndex}...`);
  try {
    await driftClient.fetchAccounts();
    const user = driftClient.getUser(SUB_ACCOUNT_ID);
    const pos = user.getPerpPosition(marketIndex);

    if (!pos || pos.baseAssetAmount.eq(new BN(0))) {
      console.log('No open position found on this market');
      return;
    }

    const isLong = pos.baseAssetAmount.gt(new BN(0));
    const dir = isLong ? PositionDirection.SHORT : PositionDirection.LONG;

    console.log(`Position size (raw): ${pos.baseAssetAmount.toString()}`);
    console.log(`Closing ${isLong ? 'LONG' : 'SHORT'} position...`);

    const txSig = await driftClient.placePerpOrder({
      orderType: OrderType.MARKET,
      marketIndex,
      direction: dir,
      baseAssetAmount: pos.baseAssetAmount.abs(),
      reduceOnly: true,
    });

    console.log('Closed:', txSig);
    console.log(`https://solscan.io/tx/${txSig}?cluster=devnet`);
  } catch (e: any) {
    console.error('Error closing position:', e?.message || e);
  }
}

async function getAccountValue() {
  if (!(await checkAccount())) return;

  console.log('\nAccount Value:');
  try {
    const user = driftClient.getUser(SUB_ACCOUNT_ID);
    const spots = user.getActiveSpotPositions();

    console.log('\nSpot Balances:');
    if (spots.length === 0) {
      console.log('  No collateral deposited');
    } else {
      for (const s of spots) {
        const m = SpotMarkets['devnet'][s.marketIndex];
        console.log(
          `  ${m.symbol} (market ${s.marketIndex}): scaledBalance=${s.scaledBalance.toString()}`,
        );
      }
    }
  } catch (e: any) {
    console.error('Error fetching account value:', e?.message || e);
  }
}

async function getPositions() {
  if (!(await checkAccount())) return;

  console.log('\nYour Positions:');

  await driftClient.fetchAccounts();
  const user = driftClient.getUser(SUB_ACCOUNT_ID);
  const positions = user.getActivePerpPositions();

  if (positions.length === 0) {
    console.log('  No open positions');
    return;
  }

  for (const p of positions) {
    const market = PerpMarkets['devnet'].find(
      (m) => m.marketIndex === p.marketIndex,
    );
    const isLong = p.baseAssetAmount.gt(new BN(0));
    const size = p.baseAssetAmount.abs().toNumber() / BASE;

    let entryPrice = 0;
    if (!p.quoteAssetAmount.eq(new BN(0)) && !p.baseAssetAmount.eq(new BN(0))) {
      entryPrice =
        p.quoteAssetAmount
          .abs()
          .mul(new BN(1_000_000))
          .div(p.baseAssetAmount.abs())
          .toNumber() / 1_000_000;
    }

    console.log(
      `\n  Market: ${market?.symbol ?? `Market ${p.marketIndex}`} (index ${p.marketIndex})`,
    );
    console.log(`  Direction: ${isLong ? 'LONG' : 'SHORT'}`);
    console.log(`  Size: ${size.toFixed(6)}`);
    console.log(`  Entry Price: $${entryPrice.toFixed(2)}`);
    console.log(`  Raw Base Amount: ${p.baseAssetAmount.toString()}`);
  }
}

async function main() {
  const command = process.argv[2];

  try {
    await initializeDrift();
    await getSolBalance();

    switch (command) {
      case 'status':
        await checkAccount();
        break;

      case 'init':
        await initializeAccount();
        break;

      case 'markets':
        await listMarkets();
        break;

      case 'positions':
        await getPositions();
        break;

      case 'deposit': {
        const amt = parseFloat(process.argv[3] || '100');
        await depositCollateral(amt);
        break;
      }

      case 'deposit-sol': {
        const amt = parseFloat(process.argv[3] || '1');
        await depositSolCollateral(amt);
        break;
      }

      case 'balance':
        await getAccountValue();
        break;

      case 'open': {
        const marketIndex = parseInt(process.argv[3] || '0', 10);
        const direction = (process.argv[4] || 'long') as 'long' | 'short';
        const size = parseFloat(process.argv[5] || '0.01');
        await openPosition(marketIndex, direction, size);
        break;
      }

      case 'close': {
        const marketIndex = parseInt(process.argv[3] || '0', 10);
        await closePosition(marketIndex);
        break;
      }

      case 'doctor':
        await doctor();
        break;

      default:
        console.log('\nDrift CLI Commands:');
        console.log('  drift:status     - Account status');
        console.log('  drift:init       - Initialize account');
        console.log('  drift:markets    - List markets');
        console.log('  drift:deposit    - Deposit USDC collateral');
        console.log('  drift deposit-sol <amount> - Deposit SOL collateral');
        console.log('  drift:balance    - Check balance');
        console.log('  drift:positions  - View positions');
        console.log('  drift:open       - Open position');
        console.log('  drift:close      - Close position');
        console.log('  drift:doctor     - Debug info');
        console.log('\nExamples:');
        console.log('  npm run drift:deposit 100');
        console.log('  npm run drift deposit-sol 2');
        console.log('  npm run drift:open 0 long 0.01');
        console.log('  npm run drift:close 0');
    }

    await driftClient.unsubscribe();
  } catch (e: any) {
    console.error('\nError:', e?.message || e);
    try {
      await driftClient?.unsubscribe();
    } catch {}
    process.exit(1);
  }
}

main();
