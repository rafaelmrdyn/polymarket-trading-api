require('dotenv').config();
const express = require('express');
const corsMiddleware = require('./src/middleware/cors');
const errorHandler = require('./src/middleware/errorHandler');
const apiRoutes = require('./src/routes/api');
const signingService = require('./src/services/signingService');

const http = require('http');
const websocketService = require('./src/services/websocketService');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'polymarket-backend'
  });
});

// API routes
app.use('/api', apiRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize WebSocket server
websocketService.initialize(server);

// Initialize signing service if private key is provided
if (process.env.PRIVATE_KEY) {
  const privateKey = process.env.PRIVATE_KEY.trim();
  
  // Check for placeholder values before attempting initialization
  if (privateKey === 'your_private_key_here' || 
      privateKey === '0xyour_private_key_here' ||
      privateKey.includes('your_private_key')) {
    console.error('❌ Invalid private key detected:');
    console.error('   The PRIVATE_KEY in your .env file appears to be a placeholder.');
    console.error('   Please replace it with your actual wallet private key.');
    console.error('   Example: PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    console.error('⚠️  Trading functionality will not be available');
  } else {
    signingService.initialize(privateKey)
      .then((address) => {
        console.log(`✅ Trading service initialized with address: ${address}`);
      })
      .catch((error) => {
        console.error('❌ Failed to initialize trading service:', error.message);
        console.error('⚠️  Trading functionality will not be available');
        if (error.message.includes('invalid') || error.message.includes('BytesLike')) {
          console.error('');
          console.error('💡 Troubleshooting:');
          console.error('   1. Ensure PRIVATE_KEY in .env is your actual private key (not a placeholder)');
          console.error('   2. Private key should be 64 hex characters (with or without 0x prefix)');
          console.error('   3. Example format: PRIVATE_KEY=0x1234...abcd');
        }
      });
  }
} else {
  console.warn('⚠️  PRIVATE_KEY not set in environment variables');
  console.warn('⚠️  Trading functionality will not be available');
  console.warn('⚠️  Set PRIVATE_KEY in .env file to enable trading');
  console.warn('⚠️  See .env.example for the correct format');
}

// Optionally connect to Polymarket WebSocket for real-time data
// Uncomment when ready to use
// websocketService.connectToPolymarket();

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws`);
});

module.exports = app;

