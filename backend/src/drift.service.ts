import { Injectable, OnModuleInit } from '@nestjs/common';
import { 
  DriftClient, 
  Wallet, 
  getUserAccountPublicKey,
  PerpMarkets,
  SpotMarkets
} from '@drift-labs/sdk';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

@Injectable()
export class DriftService implements OnModuleInit {
  private driftClient: DriftClient;
  private connection: Connection;
  private wallet: Wallet;

  async onModuleInit() {
    await this.initialize();
  }

  private async initialize() {
    // Get RPC URL from env (devnet)
    const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Load wallet from base58 secret key
    const secretKey = process.env.SECRET_KEY_BASE58;
    if (!secretKey) {
      throw new Error('SECRET_KEY_BASE58 not found in .env');
    }

    const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
    this.wallet = new Wallet(keypair);

    // Initialize Drift client for DEVNET
    this.driftClient = new DriftClient({
      connection: this.connection,
      wallet: this.wallet,
      env: 'devnet', // Devnet environment
    });

    await this.driftClient.subscribe();
    console.log('✅ Drift client initialized on DEVNET');
    console.log('Wallet:', this.wallet.publicKey.toBase58());
  }

  async getUserAccount() {
    const userAccountPublicKey = await getUserAccountPublicKey(
      this.driftClient.program.programId,
      this.wallet.publicKey,
      0 // subaccount ID
    );
    
    const accountInfo = await this.driftClient.connection.getAccountInfo(userAccountPublicKey);
    
    return {
      publicKey: userAccountPublicKey.toBase58(),
      exists: accountInfo !== null,
      walletPublicKey: this.wallet.publicKey.toBase58()
    };
  }

  async getMarketInfo() {
    // Get devnet perp markets
    const markets = PerpMarkets['devnet'];
    return markets;
  }

  async getSpotMarkets() {
    // Get devnet spot markets
    const markets = SpotMarkets['devnet'];
    return markets;
  }

  async getWalletBalance() {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return {
      balance: balance / 1e9, // Convert lamports to SOL
      lamports: balance
    };
  }

  getDriftClient(): DriftClient {
    return this.driftClient;
  }
}