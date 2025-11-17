const WebSocket = require('ws');
const clobService = require('./clobService');
const gammaService = require('./gammaService');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map client connections to their subscriptions
    this.polymarketWs = null;
    this.reconnectInterval = 5000;
    this.orderbookSubscriptions = new Map(); // Map market_id to Set of clientIds
    this.orderbookIntervals = new Map(); // Map market_id to interval ID
    this.orderbookPollInterval = 2000; // Poll orderbook every 2 seconds
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      console.log('🔌 New WebSocket client connected');
      
      const clientId = this.generateClientId();
      this.clients.set(clientId, {
        ws,
        subscriptions: new Set()
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(clientId, data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        console.log('🔌 Client disconnected');
        this.cleanupClientSubscriptions(clientId);
        this.clients.delete(clientId);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'connected',
        clientId,
        timestamp: new Date().toISOString()
      });
    });

    console.log('✅ WebSocket server initialized');
  }

  /**
   * Connect to Polymarket WebSocket for market data
   */
  connectToPolymarket() {
    const POLYMARKET_WS_URL = process.env.POLYMARKET_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
    
    this.polymarketWs = new WebSocket(POLYMARKET_WS_URL);

    this.polymarketWs.on('open', () => {
      console.log('✅ Connected to Polymarket WebSocket');
    });

    this.polymarketWs.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.broadcastPolymarketData(message);
      } catch (error) {
        console.error('Error parsing Polymarket message:', error);
      }
    });

    this.polymarketWs.on('close', () => {
      console.log('🔌 Polymarket WebSocket closed, reconnecting...');
      setTimeout(() => this.connectToPolymarket(), this.reconnectInterval);
    });

    this.polymarketWs.on('error', (error) => {
      console.error('Polymarket WebSocket error:', error);
    });
  }

  /**
   * Handle messages from clients
   */
  handleClientMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (data.type) {
      case 'subscribe':
        this.handleSubscribe(clientId, data);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(clientId, data);
        break;
      case 'ping':
        this.sendToClient(clientId, { type: 'pong' });
        break;
      default:
        console.log('Unknown message type:', data.type);
    }
  }

  /**
   * Handle subscription requests
   */
  handleSubscribe(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { channel, params } = data;
    const subscriptionKey = `${channel}:${JSON.stringify(params)}`;
    
    client.subscriptions.add(subscriptionKey);

    // Handle orderbook subscriptions
    if (channel === 'orderbook' && params.market_id) {
      this.subscribeToOrderbook(clientId, params.market_id);
    }

    // Subscribe to Polymarket WebSocket if needed
    if (this.polymarketWs && this.polymarketWs.readyState === WebSocket.OPEN) {
      this.polymarketWs.send(JSON.stringify({
        type: 'subscribe',
        channel,
        ...params
      }));
    }

    this.sendToClient(clientId, {
      type: 'subscribed',
      channel,
      params
    });
  }

  /**
   * Handle unsubscription requests
   */
  handleUnsubscribe(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { channel, params } = data;
    const subscriptionKey = `${channel}:${JSON.stringify(params)}`;
    
    client.subscriptions.delete(subscriptionKey);

    // Handle orderbook unsubscriptions
    if (channel === 'orderbook' && params.market_id) {
      this.unsubscribeFromOrderbook(clientId, params.market_id);
    }

    this.sendToClient(clientId, {
      type: 'unsubscribed',
      channel,
      params
    });
  }

  /**
   * Broadcast Polymarket data to subscribed clients
   */
  broadcastPolymarketData(message) {
    this.clients.forEach((client, clientId) => {
      // Check if client is subscribed to this data
      const shouldSend = this.isClientSubscribed(client, message);
      
      if (shouldSend) {
        this.sendToClient(clientId, message);
      }
    });
  }

  /**
   * Check if client is subscribed to specific data
   */
  isClientSubscribed(client, message) {
    // Simple implementation - can be enhanced based on Polymarket's message format
    return client.subscriptions.size > 0;
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId, data) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(data) {
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(data));
      }
    });
  }

  /**
   * Subscribe to orderbook updates for a market
   */
  subscribeToOrderbook(clientId, marketId) {
    if (!this.orderbookSubscriptions.has(marketId)) {
      this.orderbookSubscriptions.set(marketId, new Set());
      // Start polling for this market
      this.startOrderbookPolling(marketId);
    }
    
    this.orderbookSubscriptions.get(marketId).add(clientId);
    console.log(`📊 Client ${clientId} subscribed to orderbook for market ${marketId}`);
  }

  /**
   * Unsubscribe from orderbook updates for a market
   */
  unsubscribeFromOrderbook(clientId, marketId) {
    const subscribers = this.orderbookSubscriptions.get(marketId);
    if (subscribers) {
      subscribers.delete(clientId);
      console.log(`📊 Client ${clientId} unsubscribed from orderbook for market ${marketId}`);
      
      // If no more subscribers, stop polling and clean up
      if (subscribers.size === 0) {
        this.stopOrderbookPolling(marketId);
        this.orderbookSubscriptions.delete(marketId);
      }
    }
  }

  /**
   * Start polling orderbook for a market
   */
  startOrderbookPolling(marketId) {
    // Clear any existing interval for this market
    if (this.orderbookIntervals.has(marketId)) {
      clearInterval(this.orderbookIntervals.get(marketId));
    }

    // Poll immediately, then set up interval
    this.pollOrderbook(marketId);
    
    const intervalId = setInterval(() => {
      this.pollOrderbook(marketId);
    }, this.orderbookPollInterval);

    this.orderbookIntervals.set(marketId, intervalId);
    console.log(`🔄 Started polling orderbook for market ${marketId}`);
  }

  /**
   * Stop polling orderbook for a market
   */
  stopOrderbookPolling(marketId) {
    const intervalId = this.orderbookIntervals.get(marketId);
    if (intervalId) {
      clearInterval(intervalId);
      this.orderbookIntervals.delete(marketId);
      console.log(`⏹️  Stopped polling orderbook for market ${marketId}`);
    }
  }

  /**
   * Poll orderbook data for a market and broadcast to subscribers
   */
  async pollOrderbook(marketId) {
    try {
      // Get market details to find token IDs
      const market = await gammaService.getMarket(marketId);
      
      if (!market || !market.tokens) {
        console.warn(`Market ${marketId} not found or has no tokens`);
        return;
      }

      // Get orderbook for each token in the market
      const orderbookPromises = market.tokens.map(token => 
        clobService.getOrderbook(token.token_id)
      );

      const orderbooks = await Promise.all(orderbookPromises);

      // Combine orderbooks with token info (same format as REST API)
      const orderbookData = market.tokens.map((token, index) => ({
        token_id: token.token_id,
        outcome: token.outcome,
        orderbook: orderbooks[index]
      }));

      // Broadcast to all subscribed clients
      const subscribers = this.orderbookSubscriptions.get(marketId);
      if (subscribers && subscribers.size > 0) {
        const message = {
          type: 'orderbook',
          market_id: marketId,
          orderbook: orderbookData,
          timestamp: new Date().toISOString()
        };

        subscribers.forEach(clientId => {
          this.sendToClient(clientId, message);
        });
      }
    } catch (error) {
      console.error(`Error polling orderbook for market ${marketId}:`, error.message);
    }
  }

  /**
   * Clean up when client disconnects
   */
  cleanupClientSubscriptions(clientId) {
    // Remove client from all orderbook subscriptions
    this.orderbookSubscriptions.forEach((subscribers, marketId) => {
      if (subscribers.has(clientId)) {
        this.unsubscribeFromOrderbook(clientId, marketId);
      }
    });
  }

  /**
   * Generate unique client ID
   */
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new WebSocketService();

