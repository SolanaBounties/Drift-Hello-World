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
# Create .env file with: SECRET_KEY_BASE58=your_key_here
cd ..

# 3) Start everything
npm run up

# 4) Open browser
# Frontend: http://localhost:5173
# Backend:  http://localhost:3000
```

## Usage

1. **Initialize Account** - Click button in Status section (first time only)
2. **Select Market** - Choose SOL-PERP, BTC-PERP, or ETH-PERP
3. **Open Position** - Pick Long/Short direction and size (0.01 for testing)
4. **Close Position** - Click Close button on any active position

## Documentation

- **QUICKSTART.md** - Fast setup guide
- **DRIFT_GUIDE.md** - Complete user guide with troubleshooting
- **Drift Docs** - https://docs.drift.trade

## Project Structure

```
├── backend/           # NestJS API + Drift SDK integration
│   └── src/
│       ├── drift.controller.ts    # API endpoints
│       ├── drift.service.ts       # Drift Protocol logic
│       └── drift.module.ts
├── frontend/          # React + TypeScript UI
│   └── src/
│       ├── App.tsx               # Main component
│       └── App.css               # Solana-themed styles
└── database/          # SQLite (optional, for examples)
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: NestJS, Drift SDK
- **Blockchain**: Solana Devnet

## Development

```bash
# Start backend only
npm run dev:api

# Start frontend only  
npm run dev:web

# Build everything
npm run build

# Run sanity check
npm run sanity
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
- Initialize Drift account first
- Ensure devnet SOL for transaction fees

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
