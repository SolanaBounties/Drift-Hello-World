import { 
  DriftClient, 
  Wallet, 
  getUserAccountPublicKey,
  PerpMarkets,
  SpotMarkets,
  PositionDirection,
  OrderType,
  BASE_PRECISION,
  BN
} from '@drift-labs/sdk';
import { Connection, Keypair } from '@solana/web3.js';
import { config } from 'dotenv';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
// add imports
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { Transaction, SystemProgram } from '@solana/web3.js';
import { getAccount, getMint, TOKEN_2022_PROGRAM_ID, createTransferInstruction } from '@solana/spl-token';

// returns the right token account for the wallet+USDC mint, no matter which token program
async function findUsdcTokenAccount(): Promise<PublicKey> {
  // ⬇️ REPLACE your USDC_DEVNET_MINT constant with this helper
function getUsdcMintFromSdk(): PublicKey {
  // Spot market 0 = USDC on devnet
  const cfg = SpotMarkets['devnet'][0];
  // cfg.mint is a string in the SDK table
  return new PublicKey(cfg.mint);
}


  // 1) Look up any TA for this mint (both programs)
  const [classic, token2022] = await Promise.all([
    connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_DEVNET_MINT, programId: TOKEN_PROGRAM_ID }),
    connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_DEVNET_MINT, programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  const candidates = [...classic.value, ...token2022.value];

  if (candidates.length === 0) {
    throw new Error('No USDC token account found for this wallet. Airdrop USDC on devnet first (Drift UI → Deposit → Airdrop USDC).');
  }

  // Prefer the one with balance > 0
  for (const it of candidates) {
    const acc = await getAccount(connection, it.pubkey);
    if (Number(acc.amount) > 0) {
      console.log('✅ Using USDC account:', it.pubkey.toBase58(), 'balance:', Number(acc.amount) / 1e6);
      return it.pubkey;
    }
  }

  // Otherwise just use the first one
  console.log('ℹ️ Using first USDC account:', candidates[0].pubkey.toBase58(), '(balance 0)');
  return candidates[0].pubkey;
}

const USDC_DEVNET_MINT = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
);

async function ensureUsdcAta(): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(USDC_DEVNET_MINT, wallet.publicKey);
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const ix = createAssociatedTokenAccountInstruction(
      wallet.publicKey, // payer
      ata,              // ATA to create
      wallet.publicKey, // owner
      USDC_DEVNET_MINT
    );
    const tx = new Transaction().add(ix);
    const sig = await connection.sendTransaction(tx, [wallet.payer]);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('✅ Created USDC ATA:', ata.toBase58(), 'tx:', sig);
  }
  return ata;
}

/* ---------- NEW HELPERS (used by depositCollateral only) ---------- */

// Canonical Token-2022 ATA for devnet USDC (what Drift expects on devnet)
// Canonical classic (TOKEN_PROGRAM_ID) ATA for devnet USDC
async function getCanonicalUsdcAta(): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(
    USDC_DEVNET_MINT,
    wallet.publicKey,
    false,
    TOKEN_PROGRAM_ID            // 👈 use classic SPL Token program
  );
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const ix = createAssociatedTokenAccountInstruction(
      wallet.publicKey, ata, wallet.publicKey, USDC_DEVNET_MINT, TOKEN_PROGRAM_ID
    );
    const sig = await connection.sendTransaction(new Transaction().add(ix), [wallet.payer]);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('✅ Created classic USDC ATA:', ata.toBase58());
  }
  return ata;
}


// Move any USDC from miscellaneous accounts into the canonical ATA
async function moveUsdcIntoAta(ata: PublicKey): Promise<number> {
  const [classic, t22] = await Promise.all([
    connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_DEVNET_MINT, programId: TOKEN_PROGRAM_ID }),
    connection.getTokenAccountsByOwner(wallet.publicKey, { mint: USDC_DEVNET_MINT, programId: TOKEN_2022_PROGRAM_ID }),
  ]);
  const sources = [...classic.value, ...t22.value].map(x => x.pubkey);

  let moved = 0;
  for (const src of sources) {
    if (src.equals(ata)) continue;
    const info = await connection.getAccountInfo(src);
    if (!info) continue;

    const acc = await getAccount(connection, src);
    const amount = acc.amount; // bigint (base units)
    if (amount === BigInt(0)) continue;

    const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    const ix = createTransferInstruction(src, ata, wallet.publicKey, amount, [], programId);
    const sig = await connection.sendTransaction(new Transaction().add(ix), [wallet.payer]);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log(`🔁 Moved ${Number(amount)/1e6} USDC → ATA (${sig})`);
    moved += Number(amount);
  }
  return moved; // base units
}

config();

let driftClient: DriftClient;
let wallet: Wallet;
let connection: Connection;

async function initializeDrift() {
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  connection = new Connection(rpcUrl, 'confirmed');

  const secretKey = process.env.SECRET_KEY_BASE58;
  if (!secretKey) {
    throw new Error('SECRET_KEY_BASE58 not found in .env');
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
  wallet = new Wallet(keypair);

  console.log('🔗 Connecting to Drift on Devnet...');
  console.log('📍 Wallet:', wallet.publicKey.toBase58());

  driftClient = new DriftClient({
    connection,
    wallet,
    env: 'devnet',
  });

  await driftClient.subscribe();
  console.log('✅ Connected to Drift Protocol');
}

async function getBalance() {
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('\n💰 Wallet Balance:', balance / 1e9, 'SOL');
  return balance;
}

async function checkAccount() {
  const userAccountPublicKey = await getUserAccountPublicKey(
    driftClient.program.programId,
    wallet.publicKey,
    0
  );
  
  const accountInfo = await connection.getAccountInfo(userAccountPublicKey);
  const exists = accountInfo !== null;
  
  console.log('\n📊 Drift Account Info:');
  console.log('Account Public Key:', userAccountPublicKey.toBase58());
  console.log('Account Exists:', exists ? '✅' : '❌');
  
  if (!exists) {
    console.log('\n⚠️  You need to initialize your Drift account first!');
    console.log('Run: npm run drift:init');
  }
  
  return exists;
}

async function initializeAccount() {
  console.log('\n🔧 Initializing Drift account...');
  
  try {
    // Check if account already exists first
    const userAccountPublicKey = await getUserAccountPublicKey(
      driftClient.program.programId,
      wallet.publicKey,
      0
    );
    
    const accountInfo = await connection.getAccountInfo(userAccountPublicKey);
    
    if (accountInfo !== null) {
      console.log('ℹ️  Account already exists');
      return;
    }

    // Initialize user account with subAccountId only
    const txSig = await driftClient.initializeUserAccount(
      0, // subAccountId
    );
    
    const signature = Array.isArray(txSig) ? txSig[0] : txSig;
    console.log('✅ Account initialized!');
    console.log('Transaction:', signature);
  } catch (error: any) {
    console.error('❌ Error initializing account:', error.message);
    
    if (error.message.includes('already in use') || 
        error.message.includes('custom program error: 0x0')) {
      console.log('ℹ️  Account already exists');
    } else {
      throw error;
    }
  }
}

async function listMarkets() {
  const perpMarkets = PerpMarkets['devnet'];
  const spotMarkets = SpotMarkets['devnet'];
  
  console.log('\n📈 Available Perp Markets:');
  perpMarkets.slice(0, 5).forEach((market, idx) => {
    console.log(`  ${market.marketIndex}: ${market.symbol}`);
  });
  
  console.log('\n💵 Available Spot Markets:');
  spotMarkets.slice(0, 5).forEach((market, idx) => {
    console.log(`  ${market.marketIndex}: ${market.symbol}`);
  });
}

async function openPosition(marketIndex: number, direction: 'long' | 'short', size: number) {
  console.log(`\n🚀 Opening ${direction.toUpperCase()} position...`);
  console.log(`Market Index: ${marketIndex}`);
  console.log(`Size: ${size} units`);
  
  const accountExists = await checkAccount();
  if (!accountExists) {
    console.log('❌ Initialize account first with: npm run drift:init');
    return;
  }

  try {
    // Different markets have different step sizes
    // SOL-PERP (0): step_size = 10,000,000 (0.01 SOL minimum)
    // ETH-PERP (1): step_size = 100,000 (0.0001 ETH minimum)
    // BTC-PERP (2): step_size = 1,000,000 (0.000001 BTC minimum)
    
    // Convert size to base precision with proper step size
    let baseAmount: BN;
    if (marketIndex === 0) {
      // SOL-PERP: minimum 0.01 SOL = 10,000,000 base units
      baseAmount = new BN(Math.max(size * 1_000_000_000, 10_000_000));
    } else if (marketIndex === 1) {
      // ETH-PERP: minimum 0.0001 ETH = 100,000 base units
      baseAmount = new BN(Math.max(size * 1_000_000_000, 100_000));
    } else if (marketIndex === 2) {
      // BTC-PERP: minimum 0.000001 BTC = 1,000,000 base units
      baseAmount = new BN(Math.max(size * 1_000_000_000, 1_000_000));
    } else {
      // Default for other markets
      baseAmount = new BN(size * 1_000_000_000);
    }
    
    console.log(`Base amount: ${baseAmount.toString()}`);
    
    const txSig = await driftClient.placePerpOrder({
      orderType: OrderType.MARKET,
      marketIndex,
      direction: direction === 'long' ? PositionDirection.LONG : PositionDirection.SHORT,
      baseAssetAmount: baseAmount,
    });
    
    console.log('✅ Position opened!');
    console.log('Transaction:', txSig);
    console.log(`View on Solscan: https://solscan.io/tx/${txSig}?cluster=devnet`);
  } catch (error: any) {
    console.error('❌ Error opening position:', error.message);
  }
}
async function closePosition(marketIndex: number) {
  console.log(`\n🔒 Closing position on market ${marketIndex}...`);
  
  try {
    const user = driftClient.getUser();
    const position = user.getPerpPosition(marketIndex);
    
    if (!position || position.baseAssetAmount.eq(new BN(0))) {
      console.log('❌ No open position found on this market');
      return;
    }
    
    const isLong = position.baseAssetAmount.gt(new BN(0));
    const closeDirection = isLong ? PositionDirection.SHORT : PositionDirection.LONG;
    
    console.log(`Position size: ${position.baseAssetAmount.toString()}`);
    console.log(`Closing ${isLong ? 'LONG' : 'SHORT'} position...`);
    
    const txSig = await driftClient.placePerpOrder({
      orderType: OrderType.MARKET,
      marketIndex,
      direction: closeDirection,
      baseAssetAmount: position.baseAssetAmount.abs(),
      reduceOnly: true,
    });
    
    console.log('✅ Position closed!');
    console.log('Transaction:', txSig);
    console.log(`View on Solscan: https://solscan.io/tx/${txSig}?cluster=devnet`);
  } catch (error: any) {
    console.error('❌ Error closing position:', error.message);
  }
}

async function initializeDriftTokenAccount() {
  console.log('\n🔧 Initializing Drift USDC account...');
  
  const accountExists = await checkAccount();
  if (!accountExists) {
    console.log('❌ Initialize Drift account first with: npm run drift:init');
    return;
  }

  try {
    // This initializes with a small deposit to set up the account
    const txSig = await driftClient.initializeUserAccountForDevnet(
      0, // subAccountId
      'CLI', // name
      0, // spotMarketIndex (USDC)
      new BN(0), // amount (we'll deposit separately)
      undefined // tokenFaucet (optional)
    );
    
    const signature = Array.isArray(txSig) ? txSig[0] : txSig;
    console.log('✅ Drift USDC account initialized!');
    console.log('Transaction:', signature);
  } catch (error: any) {
    if (error.message.includes('already in use') || error.message.includes('0x0')) {
      console.log('ℹ️  Account already initialized');
    } else {
      console.error('❌ Error:', error.message);
    }
  }
}

/* -------------------- REPLACED FUNCTION: depositCollateral -------------------- */
async function depositCollateral(amount: number) {
  console.log(`\n💵 Depositing ${amount} USDC as collateral...`);
  if (!(await checkAccount())) return;

  try {
    // 1) Ensure canonical Token-2022 ATA (what Drift expects on devnet)
    const ata = await getCanonicalUsdcAta();

    // 2) Consolidate any stray USDC into that ATA
    await moveUsdcIntoAta(ata);

    // 3) Sanity logs & balance check
    const acc = await getAccount(connection, ata);
    const mintInfo = await getMint(connection, acc.mint);
    const dp = mintInfo.decimals; // should be 6
    const bal = Number(acc.amount) / 10**dp;
    console.log(`🧾 USDC ATA: ${ata.toBase58()} (dp=${dp}) balance=${bal}`);

    if (bal < amount) {
      console.error(`❌ Insufficient USDC in ATA. Have ${bal}, need ${amount}. Use Drift devnet UI → Airdrop USDC.`);
      return;
    }

    // 4) Deposit from the ATA
    const depositAmount = new BN(Math.round(amount * 10**dp));
    const txSig = await driftClient.deposit(
      depositAmount,
      0,   // USDC spot market index on devnet
      ata  // IMPORTANT: deposit from canonical ATA
    );

    const signature = Array.isArray(txSig) ? txSig[0] : txSig;
    console.log('✅ Success!');
    console.log('Transaction:', signature);
    console.log(`https://solscan.io/tx/${signature}?cluster=devnet`);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}
/* ----------------------------------------------------------------------------- */

async function getAccountValue() {
  const accountExists = await checkAccount();
  if (!accountExists) return;

  console.log('\n💰 Account Value:');
  
  try {
    const user = driftClient.getUser();
    const spotPositions = user.getActiveSpotPositions();
    
    console.log('\nSpot Balances:');
    if (spotPositions.length === 0) {
      console.log('  No collateral deposited');
    } else {
      spotPositions.forEach((position) => {
        const market = SpotMarkets['devnet'][position.marketIndex];
        const balance = position.scaledBalance.toString();
        console.log(`  ${market.symbol}: ${balance}`);
      });
    }
  } catch (error: any) {
    console.error('Error fetching account value:', error.message);
  }
}

async function getPositions() {
  const accountExists = await checkAccount();
  if (!accountExists) return;

  console.log('\n📊 Your Positions:');
  
  const user = driftClient.getUser();
  const positions = user.getActivePerpPositions();
  
  if (positions.length === 0) {
    console.log('No open positions');
    return;
  }
  
  positions.forEach((position) => {
    const market = PerpMarkets['devnet'][position.marketIndex];
    const isLong = position.baseAssetAmount.gt(new BN(0));
    
    console.log(`\n  Market: ${market.symbol}`);
    console.log(`  Direction: ${isLong ? 'LONG' : 'SHORT'}`);
    console.log(`  Size: ${position.baseAssetAmount.toString()}`);
    console.log(`  Entry Price: ${position.quoteAssetAmount.toString()}`);
  });
}

// CLI Command Handler
async function main() {
  const command = process.argv[2];
  
  try {
    await initializeDrift();
    await getBalance();
    
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
    
  case 'deposit':
    const depositAmt = parseFloat(process.argv[3] || '100');
    await depositCollateral(depositAmt);
    break;
    
  case 'balance':
    await getAccountValue();
    break;
    
  case 'open':
    const marketIndex = parseInt(process.argv[3] || '0');
    const direction = (process.argv[4] || 'long') as 'long' | 'short';
    const size = parseFloat(process.argv[5] || '0.01');
    await openPosition(marketIndex, direction, size);
    break;
    
  case 'close':
    const closeMarketIndex = parseInt(process.argv[3] || '0');
    await closePosition(closeMarketIndex);
    break;
    
  case 'init-token':
    await initializeDriftTokenAccount();
    break;
    
  default:
    console.log('\n📖 Available commands:');
    console.log('  npm run drift:status     - Check account status');
    console.log('  npm run drift:init       - Initialize Drift account');
    console.log('  npm run drift:markets    - List available markets');
    console.log('  npm run drift:deposit    - Deposit USDC collateral (params: amount)');
    console.log('  npm run drift:balance    - Check account collateral');
    console.log('  npm run drift:positions  - View your positions');
    console.log('  npm run drift:open       - Open position (params: marketIndex direction size)');
    console.log('  npm run drift:close      - Close position (params: marketIndex)');
    console.log('\nExamples:');
    console.log('  npm run drift:deposit 100            - Deposit 100 USDC');
    console.log('  npm run drift:open 0 long 0.01       - Open small LONG on SOL-PERP');
    console.log('  npm run drift:close 0                - Close position on SOL-PERP');
}
    
    await driftClient.unsubscribe();
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
