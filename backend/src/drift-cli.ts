// src/drift-cli.ts

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

// -----------------------------------------------------------------------------
// Env / Globals
// -----------------------------------------------------------------------------

config();

let driftClient: DriftClient;
let wallet: Wallet;
let connection: Connection;

const DEFAULT_RPC = process.env.RPC_URL || 'https://api.devnet.solana.com';
const SUB_ACCOUNT_ID = 0;
const BASE = 1_000_000_000; // perp base precision

// USDC mint (spot market 0) — derive from SDK table at runtime
function getUsdcMint(): PublicKey {
  return new PublicKey(SpotMarkets['devnet'][0].mint);
}

// Detect which token program the mint lives under (classic vs token-2022)
async function getMintProgramId(mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error('USDC mint account not found on chain');
  return info.owner;
}

// -----------------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------------

async function initializeDrift() {
  connection = new Connection(DEFAULT_RPC, 'confirmed');

  const secretKey = process.env.SECRET_KEY_BASE58;
  if (!secretKey) throw new Error('SECRET_KEY_BASE58 not found in .env');

  const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
  wallet = new Wallet(keypair);

  console.log('Connecting to Drift on Devnet...');
  console.log('Wallet:', wallet.publicKey.toBase58());

  driftClient = new DriftClient({
    connection,
    wallet,
    env: 'devnet',
    activeSubAccountId: SUB_ACCOUNT_ID,
  });

  await driftClient.subscribe();
  console.log('Connected to Drift Protocol');
}

async function getSolBalance(): Promise<number> {
  const lamports = await connection.getBalance(wallet.publicKey);
  const sol = lamports / 1e9;
  console.log('\nWallet Balance:', sol, 'SOL');
  return sol;
}

// -----------------------------------------------------------------------------
// Account helpers
// -----------------------------------------------------------------------------

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

  if (!exists)
    console.log('\nInitialize your Drift account with: npm run drift:init');
  return exists;
}

async function initializeAccount() {
  console.log('\nInitializing Drift account...');
  try {
    const tx = await driftClient.initializeUserAccount(SUB_ACCOUNT_ID);
    const sig = Array.isArray(tx) ? tx[0] : tx;
    console.log('Account initialized');
    console.log('Transaction:', sig);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('already') || msg.includes('0x0')) {
      console.log('Account already exists');
    } else {
      throw e;
    }
  }
}

// -----------------------------------------------------------------------------
// Market listing
// -----------------------------------------------------------------------------

async function listMarkets() {
  const perps = PerpMarkets['devnet'];
  const spots = SpotMarkets['devnet'];

  console.log('\nPerp Markets:');
  perps.forEach((m) => console.log(`  ${m.marketIndex}: ${m.symbol}`));

  console.log('\nSpot Markets:');
  spots.forEach((m) => console.log(`  ${m.marketIndex}: ${m.symbol}`));
}

// -----------------------------------------------------------------------------
// Collateral: ensure ATA and deposit
// -----------------------------------------------------------------------------

// Ensure/get ATA for USDC under the mint's ACTUAL program (classic or token-2022)
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

// Sweep any USDC in other accounts (same program as mint) into the canonical ATA
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
    const amount = acc.amount; // bigint
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

async function depositCollateral(amount: number) {
  console.log(`\nDepositing ${amount} USDC as collateral...`);
  if (!(await checkAccount())) return;

  try {
    const ata = await getCanonicalUsdcAta();
    await moveUsdcIntoAta(ata);

    const acc = await getAccount(connection, ata);
    const mintInfo = await getMint(connection, acc.mint);
    const dp = mintInfo.decimals; // USDC on devnet typically 6
    const bal = Number(acc.amount) / 10 ** dp;
    console.log(`USDC ATA: ${ata.toBase58()} (decimals=${dp}) balance=${bal}`);

    if (bal < amount) {
      console.error(
        `Insufficient USDC in ATA. Have ${bal}, need ${amount}. Airdrop USDC in Drift Devnet UI, then retry.`,
      );
      return;
    }

    const depositAmount = new BN(Math.round(amount * 10 ** dp));
    const tx = await driftClient.deposit(
      depositAmount,
      0, // spot market index for USDC on devnet
      ata, // must be same token program as the mint
    );
    const sig = Array.isArray(tx) ? tx[0] : tx;

    console.log('Deposit successful');
    console.log('Transaction:', sig);
    console.log(`https://solscan.io/tx/${sig}?cluster=devnet`);
  } catch (e: any) {
    console.error('Error during deposit:', e?.message || e);
  }
}

// Quick diagnostics for wallet USDC + Drift spot
async function doctor() {
  console.log('\n🔎 Drift Doctor: Collateral & Accounts');
  await checkAccount();

  // Wallet token accounts for USDC — only under the correct token program
  const mint = getUsdcMint();
  const programId = await getMintProgramId(mint);
  const list = await connection.getTokenAccountsByOwner(wallet.publicKey, {
    mint,
    programId,
  });

  if (list.value.length === 0) {
    console.log('\n❌ No USDC token accounts found for your wallet.');
    console.log('→ Use Drift Devnet UI to Airdrop USDC to your wallet first.');
  } else {
    console.log(`\n👛 Wallet USDC accounts (${list.value.length}):`);
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

  // Drift spot positions
  await driftClient.fetchAccounts();
  const user = driftClient.getUser(SUB_ACCOUNT_ID);
  const spots = user.getActiveSpotPositions();
  console.log('\n🏦 Drift Spot Positions:');
  if (spots.length === 0) console.log('  (none)');
  for (const s of spots) {
    const m = SpotMarkets['devnet'][s.marketIndex];
    console.log(
      `  ${m.symbol} (market ${s.marketIndex}) scaledBalance=${s.scaledBalance.toString()}`,
    );
  }

  // Simple risk view (use helpers on `User`)
  const totalCollat = (user.getTotalCollateral() ?? new BN(0)).toString();
  const imr = (user.getInitialMarginRequirement() ?? new BN(0)).toString();
  const mmr = (user.getMaintenanceMarginRequirement() ?? new BN(0)).toString();

  console.log('\n📐 Quick risk view:');
  console.log('  totalCollateral:', totalCollat);
  console.log('  initialMarginRequirement:', imr);
  console.log('  maintenanceMarginRequirement:', mmr);
}

// -----------------------------------------------------------------------------
// Perp trading
// -----------------------------------------------------------------------------

function toBaseAmount(size: number, marketIndex: number): BN {
  const raw = Math.round(size * BASE);
  let minStep = 1;
  if (marketIndex === 0)
    minStep = 10_000_000; // SOL-PERP: 0.01
  else if (marketIndex === 1)
    minStep = 100_000; // ETH-PERP: 0.0001
  else if (marketIndex === 2) minStep = 1_000_000; // BTC-PERP: typical
  const adjusted = Math.max(raw, minStep);
  return new BN(adjusted);
}

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

    const txSig = await driftClient.placePerpOrder({
      orderType: OrderType.MARKET,
      marketIndex,
      direction:
        direction === 'long' ? PositionDirection.LONG : PositionDirection.SHORT,
      baseAssetAmount: baseAmount,
    });

    console.log('Order sent:', txSig);
    console.log(
      `View on Solscan: https://solscan.io/tx/${txSig}?cluster=devnet`,
    );

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

    console.log('Close sent:', txSig);
    console.log(
      `View on Solscan: https://solscan.io/tx/${txSig}?cluster=devnet`,
    );
  } catch (e: any) {
    console.error('Error closing position:', e?.message || e);
  }
}

// -----------------------------------------------------------------------------
// Read Account Value / Positions
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

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
        console.log('\nAvailable commands:');
        console.log('  npm run drift:status     - Check account status');
        console.log('  npm run drift:init       - Initialize Drift account');
        console.log('  npm run drift:markets    - List available markets');
        console.log(
          '  npm run drift:deposit    - Deposit USDC collateral (params: amount)',
        );
        console.log(
          '  npm run drift:balance    - Check account collateral (spot)',
        );
        console.log('  npm run drift:positions  - View perp positions');
        console.log(
          '  npm run drift:open       - Open position (params: marketIndex direction size)',
        );
        console.log(
          '  npm run drift:close      - Close position (params: marketIndex)',
        );
        console.log(
          '  npm run drift:doctor     - Debug wallet USDC + Drift spot',
        );
        console.log('\nExamples:');
        console.log('  npm run drift:deposit 100');
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
