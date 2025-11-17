# Polymarket Backend

Express.js backend server that provides API endpoints and WebSocket connections for the Polymarket trading platform. Features backend signing architecture for secure order management without requiring frontend wallet connections.

## Features

- 🔐 **Backend Signing**: Secure order signing using private key (no MetaMask required)
- 📡 **RESTful API**: Complete API for markets, orders, balances, and trades
- 🔌 **WebSocket Server**: Real-time updates for orderbooks and user orders
- 🔗 **Polymarket Integration**: CLOB and Gamma API integration
- ⛓️ **Blockchain Integration**: Polygon network support with balance queries
- 🛡️ **Error Handling**: Comprehensive error handling and validation

## Architecture

The backend uses a **backend signing architecture** where:
- Orders are signed on the backend using a private key
- Frontend sends unsigned order parameters
- Backend handles all signing and submission to Polymarket CLOB
- No MetaMask or wallet connection required from frontend

### Key Components

- **SigningService**: Manages wallet, ClobClient initialization, and order signing
- **ClobService**: Polymarket CLOB API integration
- **GammaService**: Market data fetching from Polymarket Gamma API
- **WebSocketService**: Real-time data relay for orderbooks and orders

## Setup

### Prerequisites

- Node.js v16 or higher
- npm or yarn
- Polymarket Builder Account (for API credentials)
- Wallet with private key

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Set required environment variables:**
   
   Edit `.env` and configure:
   ```env
   # REQUIRED: Your wallet private key for signing transactions
   PRIVATE_KEY=0x...
   
   # REQUIRED: Builder credentials from https://polymarket.com/builder
   BUILDER_API_KEY=...
   BUILDER_API_SECRET=...
   BUILDER_PASSPHRASE=...
   ```

4. **Get Builder API Credentials:**
   - Visit https://polymarket.com/builder
   - Create or access your builder profile
   - Generate API credentials (API Key, Secret, Passphrase)
   - Add them to your `.env` file

5. **Start the server:**
   ```bash
   # Production
   npm start
   
   # Development (with auto-reload)
   npm run dev
   ```

### Verification

On successful startup, you should see:
```
✅ Trading service initialized with address: 0x...
✅ ClobClient initialized successfully
🚀 Server running on port 5000
📊 Environment: development
🔗 Health check: http://localhost:5000/health
🔌 WebSocket available at ws://localhost:5000/ws
```

Test the health endpoint:
```bash
curl http://localhost:5000/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-11-13T12:00:00.000Z",
  "service": "polymarket-backend"
}
```

> **See [BACKEND_SIGNING_SETUP.md](../BACKEND_SIGNING_SETUP.md) for detailed setup instructions**

## Environment Variables

### Required Variables

```env
# Wallet private key (must start with 0x)
PRIVATE_KEY=0x...

# Polymarket Builder API credentials
BUILDER_API_KEY=...
BUILDER_API_SECRET=...
BUILDER_PASSPHRASE=...
```

### Optional Configuration

```env
# Server
PORT=5000
NODE_ENV=development

# API Endpoints
CLOB_API_URL=https://clob.polymarket.com
GAMMA_API_URL=https://gamma-api.polymarket.com
DATA_API_URL=https://data-api.polymarket.com
POLYGON_RPC_URL=https://polygon-rpc.com

# Blockchain
CHAIN_ID=137
CTF_EXCHANGE_ADDRESS=0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
USDC_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174

# Builder Configuration
BUILDER_ADDRESS=0x29be1a571dc1e18a946bce8c5c629faacbd436ad
SIGNATURE_TYPE=2

# CORS
CORS_ORIGIN=http://localhost:3000
```

> **See [ENV_VARIABLES.md](../ENV_VARIABLES.md) for complete environment variable reference**

## API Endpoints

### Base URL

```
http://localhost:5000/api
```

### Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-13T12:00:00.000Z",
  "service": "polymarket-backend"
}
```

### Markets

#### List Markets

```http
GET /api/markets?limit=50&offset=0&active=true
```

**Query Parameters:**
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset (default: 0)
- `active` (optional): Filter active markets (default: true)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "question": "Will...",
      "description": "...",
      "outcomes": ["YES", "NO"],
      "endDate": "...",
      "active": true
    }
  ]
}
```

#### Get Market Details

```http
GET /api/markets/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "question": "...",
    "description": "...",
    "outcomes": ["YES", "NO"],
    "endDate": "...",
    "active": true
  }
}
```

#### Get Orderbook

```http
GET /api/markets/:id/orderbook
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bids": [...],
    "asks": [...]
  }
}
```

#### Get Market Prices

```http
GET /api/markets/:id/prices
```

**Response:**
```json
{
  "success": true,
  "data": {
    "yes": 0.65,
    "no": 0.35
  }
}
```

### Orders

#### Place Order

```http
POST /api/orders
```

**Request Body:**
```json
{
  "tokenId": "0x...",
  "amount": "1000000000",
  "price": "0.65",
  "side": 0,
  "tickSize": "0.01",
  "negRisk": false
}
```

**Parameters:**
- `tokenId` (required): Token ID for the outcome (YES or NO)
- `amount` (required): Amount in smallest unit (wei-like)
- `price` (required): Price per share (0-1)
- `side` (required): 0 = BUY, 1 = SELL
- `tickSize` (optional): Minimum price increment
- `negRisk` (optional): Allow negative risk

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "...",
    "status": "pending"
  }
}
```

> **Note**: Order is automatically signed by backend using PRIVATE_KEY. No signature needed from frontend.

#### Cancel Order

```http
DELETE /api/orders/:id
```

**Response:**
```json
{
  "success": true,
  "message": "Order cancelled"
}
```

> **Note**: Order cancellation is automatically signed by backend.

#### Get Trading Address

```http
GET /api/orders/address
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "0x..."
  }
}
```

Returns the wallet address used for trading (derived from PRIVATE_KEY).

#### Get Active Orders

```http
GET /api/orders/active?address=0x...
```

**Query Parameters:**
- `address` (optional): Wallet address (defaults to backend trading address)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "tokenId": "0x...",
      "amount": "...",
      "price": "0.65",
      "side": 0,
      "status": "open"
    }
  ]
}
```

#### Get Order Details

```http
GET /api/orders/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "tokenId": "0x...",
    "amount": "...",
    "price": "0.65",
    "side": 0,
    "status": "open"
  }
}
```

#### Get Order History

```http
GET /api/orders/history?address=0x...
```

**Query Parameters:**
- `address` (optional): Wallet address (defaults to backend trading address)

**Response:**
```json
{
  "success": true,
  "data": [...]
}
```

### Balances

#### Get Wallet Balances

```http
GET /api/balances/:address
```

**Response:**
```json
{
  "success": true,
  "data": {
    "usdc": "1000.00",
    "matic": "0.5"
  }
}
```

### Trades

#### Get Trade History

```http
GET /api/trades?market=&token_id=&maker=&limit=
```

**Query Parameters:**
- `market` (optional): Market ID
- `token_id` (optional): Token ID
- `maker` (optional): Maker address
- `limit` (optional): Number of results

**Response:**
```json
{
  "success": true,
  "data": [...]
}
```

## WebSocket API

### Connection

```
ws://localhost:5000/ws
```

### Subscribe to Orderbook

**Message:**
```json
{
  "type": "subscribe",
  "channel": "orderbook",
  "params": {
    "market_id": "..."
  }
}
```

**Updates:**
```json
{
  "type": "orderbook_update",
  "channel": "orderbook",
  "data": {
    "bids": [...],
    "asks": [...]
  }
}
```

### Subscribe to User Orders

**Message:**
```json
{
  "type": "subscribe",
  "channel": "user",
  "params": {
    "address": "0x..."
  }
}
```

**Updates:**
```json
{
  "type": "order_update",
  "channel": "user",
  "data": {
    "orderId": "...",
    "status": "filled"
  }
}
```

## Project Structure

```
backend/
├── src/
│   ├── controllers/
│   │   ├── marketController.js    # Market API handlers
│   │   └── orderController.js     # Order API handlers
│   ├── services/
│   │   ├── clobService.js         # Polymarket CLOB integration
│   │   ├── gammaService.js        # Market data service
│   │   ├── signingService.js      # Order signing & wallet management
│   │   └── websocketService.js    # WebSocket server
│   ├── middleware/
│   │   ├── cors.js                # CORS configuration
│   │   └── errorHandler.js        # Error handling
│   └── routes/
│       └── api.js                 # API route definitions
├── server.js                      # Express server entry point
├── package.json
├── .env                           # Environment variables (not in git)
└── README.md                      # This file
```

## Dependencies

### Core Dependencies

- `express` ^4.18.2 - Web framework
- `axios` ^1.6.2 - HTTP client
- `cors` ^2.8.5 - CORS middleware
- `dotenv` ^16.3.1 - Environment variables
- `ws` ^8.14.2 - WebSocket server
- `@polymarket/clob-client` ^4.22.8 - Polymarket CLOB integration
- `ethers` ^6.9.0 - Ethereum library

### Development Dependencies

- `nodemon` ^3.0.2 - Auto-reload for development

## Backend Signing Architecture

### How It Works

1. **Initialization**: On server start, `signingService` creates a wallet from `PRIVATE_KEY`
2. **ClobClient Setup**: Initializes ClobClient with Builder API credentials
3. **Order Placement**: Frontend sends unsigned order parameters
4. **Signing**: Backend signs the order using the wallet
5. **Submission**: Signed order is submitted to Polymarket CLOB

### SigningService

The `signingService.js` handles:
- Wallet creation from private key
- ClobClient initialization with Builder credentials
- Order signing and submission
- Address derivation for order queries

### Benefits

- ✅ No MetaMask required from frontend
- ✅ Simplified UX (no signature prompts)
- ✅ Centralized trading logic
- ✅ Better security (private key on backend)
- ✅ Easier automation

## Security Considerations

### Private Key Security

⚠️ **CRITICAL**: Never commit private keys to version control!

1. **Store securely**: Use environment variables only
2. **Dedicated wallet**: Use a separate wallet for trading
3. **Limited funds**: Don't store large amounts in trading wallet
4. **Key management**: Consider using secure key management services in production
5. **Rotation**: Rotate keys regularly

### Server Security

1. **HTTPS**: Use HTTPS in production
2. **CORS**: Configure CORS properly for production
3. **Rate limiting**: Implement rate limiting for API endpoints
4. **Authentication**: Add authentication if exposing publicly
5. **Monitoring**: Monitor wallet activity regularly
6. **Error handling**: Don't expose sensitive information in error messages

## Development

### Running in Development Mode

```bash
npm run dev
```

This uses `nodemon` to automatically restart the server on file changes.

### Debugging

1. **Check logs**: Server logs appear in the terminal
2. **Health endpoint**: Verify server is running with `/health`
3. **Environment variables**: Verify `.env` file is loaded
4. **Trading service**: Check for "Trading service initialized" message

### Common Issues

**"Trading service not initialized"**
- Check that `PRIVATE_KEY` is set in `.env`
- Verify private key format (should start with `0x`)
- Check Builder credentials are correct

**"Failed to derive API credentials"**
- Ensure wallet has MATIC for gas
- Check network connectivity
- Verify private key is valid

**"ClobClient initialization fails"**
- Verify Builder API credentials
- Check network connectivity
- Verify private key is valid

## Production Deployment

1. **Set environment**: `NODE_ENV=production`
2. **Secure secrets**: Use secure secret management (AWS Secrets Manager, etc.)
3. **HTTPS**: Use HTTPS for all connections
4. **Firewall**: Restrict access to backend API
5. **Monitoring**: Set up logging and monitoring
6. **Backup**: Backup environment configuration securely

## Testing

### Manual Testing

1. **Health check**: `curl http://localhost:5000/health`
2. **Markets**: `curl http://localhost:5000/api/markets`
3. **Trading address**: `curl http://localhost:5000/api/orders/address`
4. **Active orders**: `curl http://localhost:5000/api/orders/active`

### Integration Testing

Test the full order flow:
1. Get trading address
2. Check balances
3. Place an order
4. Verify order appears in active orders
5. Cancel the order
6. Verify order is cancelled


## License

MIT

---

**Version**: 1.0.0  
**Last Updated**: November 2025

