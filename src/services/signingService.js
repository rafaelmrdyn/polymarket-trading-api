const { ethers } = require('ethers');
const { ClobClient, Side, OrderType } = require('@polymarket/clob-client');
const { BuilderConfig } = require('@polymarket/builder-signing-sdk');

const CLOB_API_URL = process.env.CLOB_API_URL || 'https://clob.polymarket.com';
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '137'); // Polygon mainnet
const CTF_EXCHANGE_ADDRESS = process.env.CTF_EXCHANGE_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const BUILDER_ADDRESS = process.env.BUILDER_ADDRESS || '0x29be1a571dc1e18a946bce8c5c629faacbd436ad';

/**
 * Create a signer adapter for ClobClient compatibility with ethers v6
 * ClobClient expects _signTypedData but ethers v6 uses signTypedData
 */
const createSignerAdapter = (wallet) => {
  if (!wallet) return null;
  
  // Check if wallet already has _signTypedData (ethers v5 or already adapted)
  if (wallet._signTypedData && typeof wallet._signTypedData === 'function') {
    return wallet;
  }
  
  // Verify wallet has signTypedData method
  if (!wallet.signTypedData || typeof wallet.signTypedData !== 'function') {
    console.error('Wallet does not have signTypedData method');
    return wallet; // Return original wallet, let it fail with a clear error
  }
  
  // Directly attach _signTypedData method to the wallet object
  // This is more reliable than using a Proxy for ClobClient compatibility
  wallet._signTypedData = async (domain, types, value) => {
    try {
      console.log('🔐 Adapter: Calling _signTypedData, redirecting to signTypedData');
      // Use the public signTypedData method from ethers v6
      const signature = await wallet.signTypedData(domain, types, value);
      return signature;
    } catch (err) {
      console.error('Adapter: signTypedData error:', err);
      throw err;
    }
  };
  
  // Verify the method was attached
  if (typeof wallet._signTypedData !== 'function') {
    console.error('Failed to attach _signTypedData method to wallet');
    return wallet;
  }
  
  console.log('✅ Signer adapter created - _signTypedData method attached');
  return wallet;
};

// EIP-712 domain for Polymarket orders
const getDomain = () => ({
  name: 'Polymarket',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: CTF_EXCHANGE_ADDRESS
});

// EIP-712 types for order
const ORDER_TYPES = {
  Order: [
    { name: 'maker', type: 'address' },
    { name: 'isBuy', type: 'bool' },
    { name: 'baseAsset', type: 'address' },
    { name: 'quoteAsset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'price', type: 'uint256' },
    { name: 'salt', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'signatureType', type: 'uint8' }
  ]
};

class SigningService {
  constructor() {
    this.wallet = null;
    this.clobClient = null;
    this.provider = null;
    this.initialized = false;
  }

  /**
   * Initialize the signing service with a private key
   */
  async initialize(privateKey) {
    if (!privateKey) {
      throw new Error('Private key is required. Please set PRIVATE_KEY in your .env file.');
    }

    // Validate private key format
    const trimmedKey = privateKey.trim();
    
    // Check for placeholder values
    if (trimmedKey === 'your_private_key_here' || 
        trimmedKey === '0xyour_private_key_here' ||
        trimmedKey.includes('your_private_key') ||
        trimmedKey.length < 64) {
      throw new Error(
        'Invalid private key detected. The private key appears to be a placeholder value.\n' +
        'Please set PRIVATE_KEY in your .env file to your actual wallet private key.\n' +
        'Private key should be a 64-character hex string (with or without 0x prefix).'
      );
    }

    try {
      // Validate that it's a valid hex string
      if (!/^(0x)?[0-9a-fA-F]{64}$/.test(trimmedKey)) {
        throw new Error(
          'Invalid private key format. Private key must be a 64-character hexadecimal string.\n' +
          'Example: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
        );
      }

      // Create provider
      this.provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
      
      // Create wallet from private key
      const rawWallet = new ethers.Wallet(trimmedKey, this.provider);
      
      // Create adapter for ClobClient compatibility (ethers v6 uses signTypedData, ClobClient expects _signTypedData)
      this.wallet = createSignerAdapter(rawWallet);
      
      if (!this.wallet) {
        throw new Error('Failed to create signer adapter');
      }
      
      // Verify adapter has the required method
      if (typeof this.wallet._signTypedData !== 'function') {
        throw new Error('Signer adapter does not have _signTypedData method');
      }
      
      // Verify wallet address is accessible
      const walletAddress = await this.wallet.getAddress();
      console.log('✅ Signing service initialized with address:', walletAddress);
      
      // Test the adapter
      console.log('🔍 Testing signer adapter...');
      console.log('   - Has _signTypedData:', typeof this.wallet._signTypedData === 'function');
      console.log('   - Has signTypedData:', typeof this.wallet.signTypedData === 'function');
      console.log('   - Has getAddress:', typeof this.wallet.getAddress === 'function');

      // Initialize ClobClient with the adapted wallet
      await this.initializeClobClient();
      
      this.initialized = true;
      return this.wallet.address;
    } catch (error) {
      console.error('Error initializing signing service:', error);
      throw new Error(`Failed to initialize signing service: ${error.message}`);
    }
  }

  /**
   * Initialize ClobClient with wallet credentials
   */
  async initializeClobClient() {
    try {
      console.log('Initializing ClobClient with wallet...');
      
      // Verify wallet adapter has _signTypedData before using it
      if (typeof this.wallet._signTypedData !== 'function') {
        throw new Error('Wallet adapter does not have _signTypedData method. Cannot initialize ClobClient.');
      }
      
      console.log('✅ Wallet adapter verified - _signTypedData method available');
      
      // Derive API credentials from wallet
      const tempClient = new ClobClient(CLOB_API_URL, CHAIN_ID, this.wallet);
      
      // Derive API keys - this requires a signature from the wallet
      let credentials;
      try {
        credentials = await tempClient.deriveApiKey();
      } catch (error) {
        console.error('Error deriving API key:', error);
        // If deriveApiKey fails, try createOrDeriveApiKey
        try {
          credentials = await tempClient.createOrDeriveApiKey();
        } catch (createError) {
          console.error('Error creating/deriving API key:', createError);
          throw new Error(`Failed to derive API credentials: ${createError.message}`);
        }
      }
      
      // Normalize credentials - ClobClient might return apiKey/apiSecret or key/secret
      const normalizedCreds = {
        apiKey: credentials.apiKey || credentials.key,
        apiSecret: credentials.apiSecret || credentials.secret,
        passphrase: credentials.passphrase
      };
      
      if (!normalizedCreds.apiKey || !normalizedCreds.apiSecret || !normalizedCreds.passphrase) {
        throw new Error('Failed to derive API credentials - missing required fields');
      }
      
      credentials = normalizedCreds;

      console.log('✅ API credentials derived successfully');

      // Builder configuration
      const builderApiKey = process.env.BUILDER_API_KEY;
      const builderApiSecret = process.env.BUILDER_API_SECRET;
      const builderPassphrase = process.env.BUILDER_PASSPHRASE;
      
      if (!builderApiKey || !builderApiSecret || !builderPassphrase) {
        throw new Error('Builder credentials are required. Set BUILDER_API_KEY, BUILDER_API_SECRET, and BUILDER_PASSPHRASE in environment variables.');
      }
      
      const builderConfig = new BuilderConfig({
        localBuilderCreds: {
          key: builderApiKey,
          secret: builderApiSecret,
          passphrase: builderPassphrase
        }
      });

      const signatureType = parseInt(process.env.SIGNATURE_TYPE || '2'); // Builder mode (2)

      // Create ClobClient with credentials
      this.clobClient = new ClobClient(
        CLOB_API_URL,
        CHAIN_ID,
        this.wallet,
        {
          key: credentials.apiKey,
          secret: credentials.apiSecret,
          passphrase: credentials.passphrase
        },
        signatureType,
        BUILDER_ADDRESS,
        process.env.GEO_BLOCK_TOKEN, // geoBlockToken (optional)
        process.env.USE_SERVER_TIME === 'true', // useServerTime (optional)
        builderConfig
      );

      console.log('✅ ClobClient initialized successfully');
    } catch (error) {
      console.error('Error initializing ClobClient:', error);
      throw new Error(`Failed to initialize ClobClient: ${error.message}`);
    }
  }

  /**
   * Get the wallet address
   */
  getAddress() {
    if (!this.wallet) {
      throw new Error('Signing service not initialized');
    }
    return this.wallet.address;
  }

  /**
   * Sign an order using EIP-712
   */
  async signOrder(order) {
    if (!this.wallet) {
      throw new Error('Signing service not initialized');
    }

    try {
      const domain = getDomain();
      const signature = await this.wallet.signTypedData(domain, ORDER_TYPES, order);
      return signature;
    } catch (error) {
      console.error('Error signing order:', error);
      throw new Error(`Failed to sign order: ${error.message}`);
    }
  }

  /**
   * Build and sign an order
   */
  async buildAndSignOrder({
    tokenId,
    amount,
    price,
    side, // 0 for BUY, 1 for SELL
    tickSize = "0.001",
    negRisk = false
  }) {
    if (!this.clobClient) {
      throw new Error('ClobClient not initialized');
    }

    try {
      // Convert side to ClobClient Side enum
      const orderSide = side === 0 || side === 'BUY' || side === 'buy' ? Side.BUY : Side.SELL;

      // Use ClobClient to create and post order
      const result = await this.clobClient.createAndPostOrder(
        {
          tokenID: tokenId,
          price: price,
          side: orderSide,
          size: amount,
          feeRateBps: 0,
        },
        { tickSize: tickSize, negRisk: negRisk },
        OrderType.GTC // Good Till Cancel
      );

      return result;
    } catch (error) {
      console.error('Error creating and posting order:', error);
      throw new Error(`Failed to create and post order: ${error.message}`);
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId) {
    if (!this.clobClient) {
      throw new Error('ClobClient not initialized');
    }

    try {
      const result = await this.clobClient.cancelOrder(orderId);
      return result;
    } catch (error) {
      console.error('Error canceling order:', error);
      throw new Error(`Failed to cancel order: ${error.message}`);
    }
  }

  /**
   * Check if service is initialized
   */
  isInitialized() {
    return this.initialized && this.wallet !== null && this.clobClient !== null;
  }
}

// Export singleton instance
module.exports = new SigningService();

