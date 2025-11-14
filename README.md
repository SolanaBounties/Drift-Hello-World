# Drift Hello World — $200 Bounty

A simple educational application demonstrating basic interaction with Drift Protocol on Solana Devnet.

## Features

✅ **Basic Drift Protocol Integration** - Connect to Drift on Solana Devnet
✅ **Open & Close Positions** - Trade perpetual positions (SOL, BTC, ETH markets)  
✅ **Simple UI** - Clean Solana-themed interface for interaction
✅ **Account Management** - Initialize and manage Drift accounts
✅ **Real-time Data** - View positions, balances, and market info

## Quick Start

```bash
# 1) Install dependencies
npm install

# 2) Configure backend (add your Solana wallet key)
cd backend
echo "SECRET_KEY_BASE58=your_key_here" > .env
cd ..

# 3) Start everything
npm run dev

# 4) Open browser
# Frontend: http://localhost:5173
# Backend:  http://localhost:3000
```

1. **Connect Wallet** - Click "Select Wallet" button (Phantom, Solflare, etc.)
2. **Initialize Account** - Click "Initialize Account" button (first time only)
3. **Deposit Collateral** - Choose either:
   - **SOL**: `npm run drift deposit-sol 2` (Uses your existing SOL!)
   - **USDC**: `npm run drift:deposit 100` (Requires Devnet USDC airdrop)
4. **Select Market** - Choose SOL-PERP, BTC-PERP, or ETH-PERP
5. **Open Position** - Pick Long/Short direction and size (start with 0.01)
6. **Close Position** - Click "Close" button on active position

## Resources

- [Drift Protocol](https://drift.trade)
- [Drift Documentation](https://docs.drift.trade)
- [Solana Devnet Faucet](https://faucet.solana.com)

## Project Structure

```
├── backend/           # NestJS API + Drift SDK integration
│   └── src/
│       ├── drift.controller.ts    # API endpoints
│       ├── drift.service.ts       # Drift Protocol logic
│       ├── drift.module.ts        # Module config
│       └── drift-cli.ts           # CLI tool
└── frontend/          # React + TypeScript UI
    └── src/
        ├── App.tsx                # Main component
        └── App.css                # Solana-themed styles
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: NestJS, Drift SDK and Solana Devnet

## Development
```bash
# Start both (recommended)
npm run dev

# Start backend only
npm run dev:api

# Start frontend only  
npm run dev:web

# Build everything
npm run build
```

## Key Concepts

### Drift Protocol
Decentralized perpetual futures exchange on Solana

### Markets
- SOL-PERP (Index 0)
- BTC-PERP (Index 1)  
- ETH-PERP (Index 2)

### Positions
- **Long**: Profit when price goes up
- **Short**: Profit when price goes down

## Troubleshooting

**Backend won't start?**
- Check `.env` file in `backend/` directory
- Verify `SECRET_KEY_BASE58` is set

**Can't open positions?**
- Initialize Drift account first (`npm run drift:init`)
- Deposit collateral: `npm run drift deposit-sol 2` (easiest!)
- Ensure devnet SOL for transaction fees

**Hitting rate limits?**
- Free RPC has strict limits - the app now includes rate limiting
- Get a free RPC from [Helius](https://helius.dev) or [QuickNode](https://quicknode.com)
- Add to `.env`: `RPC_URL=https://your-rpc-url`

**Connection errors?**
- Confirm backend running on port 3000
- Check RPC_URL in .env (default: devnet)

## Educational Purpose

This is a learning tool for developers new to Drift Protocol. It demonstrates:
- Connecting to Drift SDK
- Account initialization
- Opening/closing perpetual positions
- Reading market data
- Basic UI interaction patterns

**Use on Devnet only!**

## Resources

- Drift Protocol: https://drift.trade
- Drift Docs: https://docs.drift.trade
- Solana Devnet: https://faucet.solana.com
