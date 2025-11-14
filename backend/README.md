# Drift Backend API

NestJS backend service for Drift Protocol integration on Solana Devnet.

## Setup

```bash
npm install
```

Create `.env` file:
```env
SECRET_KEY_BASE58=your_solana_wallet_private_key_in_base58
RPC_URL=https://api.devnet.solana.com
```

## Run

```bash
npm run start:dev
```

Server runs on `http://localhost:3000`

## API Endpoints

### Drift Operations
- `GET /drift/status` - Check wallet and account status
- `POST /drift/init` - Initialize Drift account
- `GET /drift/markets` - List available markets
- `GET /drift/positions` - View active positions
- `GET /drift/account` - Get account value and collateral
- `POST /drift/open?marketIndex=0&dir=long&size=0.01` - Open position
- `POST /drift/close?marketIndex=0` - Close position
- `POST /drift/deposit-usdc?amount=100` - Deposit USDC collateral
- `GET /drift/doctor` - Debug account info

### Health
- `GET /` - Root endpoint
- `GET /health` - Health check

## CLI Commands

```bash
npm run drift:status      # Check account
npm run drift:init        # Initialize account
npm run drift:markets     # List markets
npm run drift:deposit     # Deposit collateral
npm run drift:positions   # View positions
npm run drift:open        # Open position
npm run drift:close       # Close position
npm run drift:balance     # Check balance
npm run drift:doctor      # Debug info
```

## Architecture

```
src/
├── drift.service.ts      # Drift SDK integration
├── drift.controller.ts   # REST API endpoints
├── drift.module.ts       # Module configuration
├── drift-cli.ts          # CLI tool
├── app.controller.ts     # Base endpoints
├── app.module.ts         # App configuration
└── main.ts               # Bootstrap
```

## Tech Stack

- NestJS - Backend framework
- Drift SDK - Protocol integration
- Solana Web3.js - Blockchain connection
- TypeScript - Language

## Development

```bash
npm run start:dev    # Watch mode
npm run build        # Production build
npm run lint         # Run linter
```
