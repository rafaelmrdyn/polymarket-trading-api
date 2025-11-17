const clobService = require('../services/clobService');
const signingService = require('../services/signingService');
const { ethers } = require('ethers');
const axios = require('axios');

/**
 * Calculate CREATE2 address for Gnosis Safe proxy
 * This is a deterministic calculation based on factory, salt, and bytecode
 */
function calculateCreate2Address(factoryAddress, salt, initCodeHash) {
  const saltBytes = ethers.zeroPadValue(salt, 32);
  const factoryBytes = ethers.getBytes(factoryAddress);
  const initCodeHashBytes = ethers.getBytes(initCodeHash);
  
  // CREATE2: keccak256(0xff ++ factory ++ salt ++ keccak256(init_code))[12:]
  const data = ethers.concat([
    '0xff',
    factoryBytes,
    saltBytes,
    initCodeHashBytes
  ]);
  
  const hash = ethers.keccak256(data);
  // Take last 20 bytes (40 hex chars) and add 0x prefix
  return '0x' + hash.slice(-40);
}

class OrderController {
  /**
   * Place a new order (signed on backend using private key)
   */
  async placeOrder(req, res, next) {
    try {
      const { tokenId, amount, price, side, tickSize, negRisk } = req.body;

      // Validate required fields
      if (!tokenId) {
        return res.status(400).json({
          success: false,
          error: 'Token ID is required'
        });
      }

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Valid amount is required'
        });
      }

      if (!price || parseFloat(price) <= 0 || parseFloat(price) > 1) {
        return res.status(400).json({
          success: false,
          error: 'Valid price is required (between 0 and 1)'
        });
      }

      if (side === undefined || side === null) {
        return res.status(400).json({
          success: false,
          error: 'Order side is required (0 for BUY, 1 for SELL)'
        });
      }

      // Check if signing service is initialized
      if (!signingService.isInitialized()) {
        return res.status(500).json({
          success: false,
          error: 'Trading service not initialized. Please set PRIVATE_KEY in environment variables.'
        });
      }

      console.log('Placing order on backend:', {
        tokenId,
        amount: parseFloat(amount),
        price: parseFloat(price),
        side: side === 0 ? 'BUY' : 'SELL',
        tickSize: tickSize || '0.001',
        negRisk: negRisk || false
      });

      // Build and sign order on backend, then submit
      const result = await signingService.buildAndSignOrder({
        tokenId: String(tokenId),
        amount: parseFloat(amount),
        price: parseFloat(price),
        side: parseInt(side),
        tickSize: tickSize || "0.001",
        negRisk: negRisk || false
      });

      console.log('Order placed successfully');
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error in placeOrder controller:', error);
      next(error);
    }
  }

  /**
   * Cancel an order (signed on backend)
   */
  async cancelOrder(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Order ID is required'
        });
      }

      // Check if signing service is initialized
      if (!signingService.isInitialized()) {
        return res.status(500).json({
          success: false,
          error: 'Trading service not initialized. Please set PRIVATE_KEY in environment variables.'
        });
      }

      console.log('Canceling order on backend:', id);

      // Cancel order using signing service
      const result = await signingService.cancelOrder(id);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error in cancelOrder controller:', error);
      next(error);
    }
  }

  /**
   * Get trading address (wallet address from signing service)
   */
  async getTradingAddress(req, res, next) {
    try {
      if (!signingService.isInitialized()) {
        return res.status(500).json({
          success: false,
          error: 'Trading service not initialized'
        });
      }

      const address = signingService.getAddress();
      res.json({
        success: true,
        data: { address }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get active orders for an address
   */
  async getActiveOrders(req, res, next) {
    try {
      const { address } = req.query;

      if (!address) {
        return res.status(400).json({
          success: false,
          error: 'Address parameter required'
        });
      }

      // Validate address format
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Ethereum address'
        });
      }

      try {
        const orders = await clobService.getOrders(address, {
          status: 'open'
        });

        // Ensure we return an array
        const ordersArray = Array.isArray(orders) ? orders : [];

        res.json({
          success: true,
          data: ordersArray
        });
      } catch (error) {
        // If it's a known error about API not supporting this, return empty array
        if (error.message?.includes('Authentication required') || 
            error.message?.includes('API error: 401') ||
            error.message?.includes('API error: 403')) {
          console.warn('CLOB API requires authentication for orders endpoint, returning empty array');
          res.json({
            success: true,
            data: []
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Error in getActiveOrders:', error.message);
      next(error);
    }
  }

  /**
   * Get a specific order by ID
   */
  async getOrder(req, res, next) {
    try {
      const { id } = req.params;
      const order = await clobService.getOrder(id);

      res.json({
        success: true,
        data: order
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get order history (filled/completed orders) for an address
   */
  async getOrderHistory(req, res, next) {
    try {
      const { address } = req.query;

      if (!address) {
        return res.status(400).json({
          success: false,
          error: 'Address parameter required'
        });
      }

      // Validate address format
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Ethereum address'
        });
      }

      // Get filled/completed orders
      // Try different status values that CLOB API might use
      try {
        const orders = await clobService.getOrders(address, {
          status: 'filled'
        });

        // Ensure we return an array
        const ordersArray = Array.isArray(orders) ? orders : [];

        res.json({
          success: true,
          data: ordersArray
        });
      } catch (error) {
        // If it's a known error about API not supporting this, return empty array
        if (error.message?.includes('Authentication required') || 
            error.message?.includes('API error: 401') ||
            error.message?.includes('API error: 403')) {
          console.warn('CLOB API requires authentication for orders endpoint, returning empty array');
          res.json({
            success: true,
            data: []
          });
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Error in getOrderHistory:', error.message);
      next(error);
    }
  }

  /**
   * Get balances for an address
   * When using builder signing, balances should be fetched from BUILDER_ADDRESS
   */
  async getBalances(req, res, next) {
    try {
      const { address } = req.params;

      // Validate address format
      if (!ethers.isAddress(address)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Ethereum address'
        });
      }

      // Determine which address to use for balance queries
      // If using builder signing (SIGNATURE_TYPE=2), use BUILDER_ADDRESS
      const signatureType = parseInt(process.env.SIGNATURE_TYPE || '2');
      const BUILDER_ADDRESS = process.env.BUILDER_ADDRESS || '0x29be1a571dc1e18a946bce8c5c629faacbd436ad';
      
      let balanceAddress = address;
      if (signatureType === 2 && BUILDER_ADDRESS) {
        // Builder signing mode: balances are in the builder address
        console.log(`🔧 Using builder signing mode - fetching balances from BUILDER_ADDRESS: ${BUILDER_ADDRESS}`);
        balanceAddress = BUILDER_ADDRESS;
      } else {
        console.log(`🔧 Using wallet address for balances: ${address}`);
      }

      // Try multiple RPC endpoints for reliability
      const primaryRpc = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
      const fallbackRpcList = process.env.POLYGON_RPC_FALLBACKS 
        ? process.env.POLYGON_RPC_FALLBACKS.split(',').map(url => url.trim())
        : ['https://polygon-rpc.com', 'https://rpc.ankr.com/polygon', 'https://polygon.llamarpc.com'];
      
      const rpcUrls = [primaryRpc, ...fallbackRpcList].filter(Boolean);

      const CTF_EXCHANGE_ADDRESS = process.env.CTF_EXCHANGE_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'; // Polymarket CTF Exchange
      const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC on Polygon
      
      // Polymarket proxy wallet factories
      const GNOSIS_SAFE_FACTORY = process.env.GNOSIS_SAFE_FACTORY || '0xaacfeea03eb1561c4e67d661e40682bd20e3541b'; // For MetaMask users
      const POLYMARKET_PROXY_FACTORY = process.env.POLYMARKET_PROXY_FACTORY || '0xaB45c54AB0c941a2F231C04C3f49182e1A254052'; // For MagicLink users

      let provider = null;
      let usdcFormatted = '0.0';
      let maticFormatted = '0.0';
      let lastError = null;
      let proxyAddress = balanceAddress; // Use the determined balance address (builder or wallet)

      // Try each RPC endpoint until one works
      for (const rpcUrl of rpcUrls) {
        try {
          console.log(`Trying RPC endpoint: ${rpcUrl}`);
          provider = new ethers.JsonRpcProvider(rpcUrl);
          
          // Test connection with a simple call
          await provider.getBlockNumber();
          console.log(`✅ Connected to RPC: ${rpcUrl}`);

          // If using builder signing, skip proxy detection - builder address holds funds directly
          if (signatureType === 2 && balanceAddress === BUILDER_ADDRESS) {
            console.log(`✅ Using BUILDER_ADDRESS directly (no proxy detection needed): ${BUILDER_ADDRESS}`);
            proxyAddress = BUILDER_ADDRESS;
          } else {
            // Try to get proxy address from Polymarket proxy wallet factories
            // Polymarket uses Gnosis Safe for MetaMask users and Polymarket Proxy for MagicLink users
            try {
              console.log(`Attempting to get proxy address for ${balanceAddress}...`);
            
              // First, try to get proxy address from CLOB orders (most reliable)
              // The maker address in orders is the proxy address
              try {
                console.log(`Trying to get proxy address from CLOB orders...`);
                const orders = await clobService.getOrders(balanceAddress, { limit: 10 });
                if (Array.isArray(orders) && orders.length > 0) {
                  // Check if any order has a different maker address (proxy)
                  const uniqueMakers = [...new Set(orders.map(o => o.maker?.toLowerCase()).filter(Boolean))];
                  if (uniqueMakers.length > 0) {
                    const orderMaker = uniqueMakers[0];
                    if (orderMaker !== balanceAddress.toLowerCase()) {
                      proxyAddress = ethers.getAddress(orderMaker); // Normalize address
                      console.log(`✅ Found proxy address from CLOB orders: ${proxyAddress}`);
                    } else {
                      console.log(`⚠️ Order maker matches parent address, trying factories...`);
                      throw new Error('Order maker matches parent address');
                    }
                  } else {
                    throw new Error('No valid maker addresses in orders');
                  }
                } else {
                  throw new Error('No orders found for address');
                }
              } catch (orderError) {
                console.log(`⚠️ CLOB orders method failed: ${orderError.message}, trying CTF Exchange...`);
                
                // Try CTF Exchange first (this is the documented method)
                try {
                  console.log(`Trying CTF Exchange contract at ${CTF_EXCHANGE_ADDRESS}...`);
                  const ctfExchangeContract = new ethers.Contract(
                    CTF_EXCHANGE_ADDRESS,
                    [
                      'function getPolyProxyWalletAddress(address) view returns (address)', // Primary method from docs
                      'function getProxyAddress(address) view returns (address)',
                      'function proxies(address) view returns (address)',
                      'function getProxy(address) view returns (address)',
                      'function proxy(address) view returns (address)'
                    ],
                    provider
                  );

                  // Try getPolyProxyWalletAddress first (this is the documented method)
                  try {
                    proxyAddress = await ctfExchangeContract.getPolyProxyWalletAddress(balanceAddress);
                    console.log(`CTF Exchange getPolyProxyWalletAddress returned: ${proxyAddress}`);
                    if (!proxyAddress || proxyAddress === ethers.ZeroAddress) {
                      throw new Error('getPolyProxyWalletAddress returned zero address');
                    }
                  } catch (e1) {
                    console.log(`getPolyProxyWalletAddress failed: ${e1.message}, trying alternatives...`);
                    try {
                      proxyAddress = await ctfExchangeContract.getProxyAddress(balanceAddress);
                      console.log(`CTF Exchange getProxyAddress returned: ${proxyAddress}`);
                      if (!proxyAddress || proxyAddress === ethers.ZeroAddress) {
                        throw new Error('getProxyAddress returned zero address');
                      }
                    } catch (e2) {
                      try {
                        proxyAddress = await ctfExchangeContract.proxies(balanceAddress);
                        console.log(`CTF Exchange proxies returned: ${proxyAddress}`);
                        if (!proxyAddress || proxyAddress === ethers.ZeroAddress) {
                          throw new Error('proxies returned zero address');
                        }
                      } catch (e3) {
                        try {
                          proxyAddress = await ctfExchangeContract.getProxy(balanceAddress);
                          console.log(`CTF Exchange getProxy returned: ${proxyAddress}`);
                          if (!proxyAddress || proxyAddress === ethers.ZeroAddress) {
                            throw new Error('getProxy returned zero address');
                          }
                        } catch (e4) {
                          proxyAddress = await ctfExchangeContract.proxy(balanceAddress);
                          console.log(`CTF Exchange proxy returned: ${proxyAddress}`);
                          if (!proxyAddress || proxyAddress === ethers.ZeroAddress) {
                            throw new Error('proxy returned zero address');
                          }
                        }
                      }
                    }
                  }
                  
                  if (proxyAddress && proxyAddress !== ethers.ZeroAddress) {
                    console.log(`✅ Found proxy address via CTF Exchange: ${proxyAddress}`);
                  } else {
                    throw new Error(`CTF Exchange proxy address is zero: ${proxyAddress}`);
                  }
                } catch (ctfError) {
                  console.log(`⚠️ CTF Exchange methods failed: ${ctfError.message}, trying factory contracts...`);
                  
                  // First try Gnosis Safe factory (for MetaMask users)
                  try {
                    console.log(`Trying Gnosis Safe factory at ${GNOSIS_SAFE_FACTORY}...`);
                    const gnosisFactory = new ethers.Contract(
                      GNOSIS_SAFE_FACTORY,
                      [
                        'function getProxyAddress(address) view returns (address)',
                        'function proxies(address) view returns (address)',
                        'function proxy(address) view returns (address)'
                      ],
                      provider
                    );
                    
                    try {
                      proxyAddress = await gnosisFactory.getProxyAddress(balanceAddress);
                      console.log(`Gnosis Safe getProxyAddress returned: ${proxyAddress}`);
                    } catch (e1) {
                      try {
                        proxyAddress = await gnosisFactory.proxies(balanceAddress);
                        console.log(`Gnosis Safe proxies returned: ${proxyAddress}`);
                      } catch (e2) {
                        proxyAddress = await gnosisFactory.proxy(balanceAddress);
                        console.log(`Gnosis Safe proxy returned: ${proxyAddress}`);
                      }
                    }
                    
                    if (proxyAddress && proxyAddress !== ethers.ZeroAddress && proxyAddress !== '0x0000000000000000000000000000000000000000') {
                      console.log(`✅ Found Gnosis Safe proxy address: ${proxyAddress}`);
                    } else {
                      throw new Error(`Gnosis Safe proxy address is zero: ${proxyAddress}`);
                    }
                  } catch (gnosisError) {
                    console.log(`⚠️ Gnosis Safe factory failed: ${gnosisError.message}`);
                    console.log(`Error details:`, gnosisError);
                    
                    // Try Polymarket Proxy factory (for MagicLink users)
                    try {
                      console.log(`Trying Polymarket Proxy factory at ${POLYMARKET_PROXY_FACTORY}...`);
                      const polymarketFactory = new ethers.Contract(
                        POLYMARKET_PROXY_FACTORY,
                        [
                          'function getProxyFor(address) view returns (address)',
                          'function getProxy(address) view returns (address)',
                          'function proxies(address) view returns (address)'
                        ],
                        provider
                      );
                      
                      try {
                        proxyAddress = await polymarketFactory.getProxyFor(balanceAddress);
                        console.log(`Polymarket Proxy getProxyFor returned: ${proxyAddress}`);
                      } catch (e1) {
                        try {
                          proxyAddress = await polymarketFactory.getProxy(balanceAddress);
                          console.log(`Polymarket Proxy getProxy returned: ${proxyAddress}`);
                        } catch (e2) {
                          proxyAddress = await polymarketFactory.proxies(balanceAddress);
                          console.log(`Polymarket Proxy proxies returned: ${proxyAddress}`);
                        }
                      }
                      
                      if (proxyAddress && proxyAddress !== ethers.ZeroAddress && proxyAddress !== '0x0000000000000000000000000000000000000000') {
                        console.log(`✅ Found Polymarket Proxy address: ${proxyAddress}`);
                      } else {
                        throw new Error(`Polymarket Proxy address is zero: ${proxyAddress}`);
                      }
                    } catch (polymarketError) {
                      console.log(`⚠️ Polymarket Proxy factory failed: ${polymarketError.message}`);
                      console.log(`Error details:`, polymarketError);
                      throw new Error('All proxy detection methods failed');
                    }
                  }
                }
              }

              // Final validation
              if (!proxyAddress || proxyAddress === ethers.ZeroAddress || proxyAddress === '0x0000000000000000000000000000000000000000') {
                console.log(`⚠️ Proxy address is zero or invalid, using parent address: ${balanceAddress}`);
                proxyAddress = balanceAddress;
              } else if (proxyAddress.toLowerCase() === balanceAddress.toLowerCase()) {
                console.log(`⚠️ Proxy address matches parent address, using parent: ${balanceAddress}`);
                proxyAddress = balanceAddress;
              } else {
                console.log(`✅ Using proxy address for balance queries: ${proxyAddress}`);
              }
            } catch (proxyError) {
              console.error(`❌ Error getting proxy address: ${proxyError.message}`);
              console.error(`Error stack:`, proxyError.stack);
              console.log(`⚠️ Falling back to parent address: ${balanceAddress}`);
              proxyAddress = balanceAddress;
            }
          }

          // Check if proxy address is a contract (deployed) or just a deterministic address
          let isProxyDeployed = false;
          try {
            const code = await provider.getCode(proxyAddress);
            isProxyDeployed = code && code !== '0x';
            console.log(`Proxy address ${proxyAddress} is ${isProxyDeployed ? 'deployed' : 'not deployed (deterministic address)'}`);
          } catch (codeError) {
            console.log(`Could not check if proxy is deployed: ${codeError.message}`);
          }

          // Get USDC balance from proxy address (or parent if no proxy)
          const usdcContract = new ethers.Contract(
            USDC_ADDRESS,
            ['function balanceOf(address) view returns (uint256)'],
            provider
          );

          console.log(`Fetching USDC balance for ${proxyAddress === balanceAddress ? 'parent' : 'proxy'} address ${proxyAddress}...`);
          const usdcBalance = await usdcContract.balanceOf(proxyAddress);
          usdcFormatted = ethers.formatUnits(usdcBalance, 6); // USDC has 6 decimals
          console.log(`USDC balance (raw): ${usdcBalance.toString()}, formatted: ${usdcFormatted}`);

          // Also check parent address balance in case funds are there
          if (proxyAddress !== balanceAddress && parseFloat(usdcFormatted) === 0) {
            console.log(`Proxy has 0 USDC, checking parent address balance...`);
            const parentUsdcBalance = await usdcContract.balanceOf(balanceAddress);
            const parentUsdcFormatted = ethers.formatUnits(parentUsdcBalance, 6);
            console.log(`Parent address USDC balance: ${parentUsdcFormatted}`);
            if (parseFloat(parentUsdcFormatted) > 0) {
              console.log(`⚠️ Found USDC in parent address instead of proxy!`);
              usdcFormatted = parentUsdcFormatted;
              proxyAddress = balanceAddress; // Use parent if it has the funds
            }
          }

          // Get MATIC balance from proxy address
          console.log(`Fetching MATIC balance for ${proxyAddress === balanceAddress ? 'parent' : 'proxy'} address ${proxyAddress}...`);
          const maticBalance = await provider.getBalance(proxyAddress);
          maticFormatted = ethers.formatEther(maticBalance);
          console.log(`MATIC balance (raw): ${maticBalance.toString()}, formatted: ${maticFormatted}`);

          console.log(`✅ Successfully fetched balances for ${proxyAddress === balanceAddress ? 'parent' : 'proxy'} address ${proxyAddress}: USDC=${usdcFormatted}, MATIC=${maticFormatted}, Proxy Deployed: ${isProxyDeployed}`);
          break; // Success, exit loop
        } catch (error) {
          console.error(`❌ Error with RPC ${rpcUrl}:`, error.message);
          lastError = error;
          continue; // Try next RPC endpoint
        }
      }

      if (!provider) {
        throw new Error(`Failed to connect to any RPC endpoint. Last error: ${lastError?.message}`);
      }

      // Try to get balances from Polymarket's API first (if available)
      // This is more reliable than querying blockchain directly since Polymarket shows balances
      let apiBalances = null;
      let finalUsdc = usdcFormatted;
      let portfolioValue = parseFloat(usdcFormatted);
      
      try {
        console.log('Attempting to get balances from Polymarket API...');
        // Try different possible API endpoints
        const checkAddress = proxyAddress !== balanceAddress ? proxyAddress : balanceAddress;
        
        // Try CLOB API balance endpoint
        try {
          const clobBalanceResponse = await axios.get(`${process.env.CLOB_API_URL || 'https://clob.polymarket.com'}/balance`, {
            params: { address: checkAddress },
            timeout: 5000
          });
          if (clobBalanceResponse.data) {
            apiBalances = clobBalanceResponse.data;
            console.log('Got balances from CLOB API:', apiBalances);
          }
        } catch (clobBalanceError) {
          console.log('CLOB balance endpoint not available:', clobBalanceError.message);
        }
        
        // Try Gamma API user endpoint
        if (!apiBalances) {
          try {
            const gammaUserResponse = await axios.get(`${process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com'}/user/${checkAddress}`, {
              timeout: 5000
            });
            if (gammaUserResponse.data) {
              apiBalances = gammaUserResponse.data;
              console.log('Got balances from Gamma API:', apiBalances);
            }
          } catch (gammaError) {
            console.log('Gamma user endpoint not available:', gammaError.message);
          }
        }
      } catch (apiError) {
        console.log('Could not get balances from API:', apiError.message);
      }

      // Use API balances if available, otherwise use blockchain balances
      if (apiBalances) {
        if (apiBalances.usdc !== undefined) {
          finalUsdc = apiBalances.usdc.toString();
          portfolioValue = parseFloat(finalUsdc);
          console.log(`Using API USDC balance: ${finalUsdc}`);
        }
        if (apiBalances.portfolio !== undefined) {
          portfolioValue = parseFloat(apiBalances.portfolio);
          console.log(`Using API portfolio value: ${portfolioValue}`);
        }
        if (apiBalances.cash !== undefined) {
          finalUsdc = apiBalances.cash.toString();
          console.log(`Using API cash balance: ${finalUsdc}`);
        }
      } else {
        // Fallback to blockchain balances
        const usdcValue = parseFloat(usdcFormatted);
        portfolioValue = usdcValue;
        
        try {
          // Get active orders to estimate portfolio value
          const activeOrders = await clobService.getOrders(balanceAddress, { status: 'open' });
          if (Array.isArray(activeOrders) && activeOrders.length > 0) {
            console.log(`Found ${activeOrders.length} active orders for portfolio calculation`);
          }
        } catch (err) {
          console.log('Could not fetch orders for portfolio calculation:', err.message);
        }
      }

      const response = {
        success: true,
        data: {
          address,
          proxyAddress: (proxyAddress && proxyAddress !== balanceAddress && proxyAddress.toLowerCase() !== balanceAddress.toLowerCase()) ? proxyAddress : null, // Include proxy address if different from parent
          builderAddress: (signatureType === 2 && BUILDER_ADDRESS) ? BUILDER_ADDRESS : null, // Include builder address if using builder signing
          usdc: finalUsdc,
          matic: maticFormatted,
          portfolio: portfolioValue.toFixed(2),
          cash: finalUsdc, // Cash = USDC balance
          timestamp: new Date().toISOString(),
          source: apiBalances ? 'api' : 'blockchain' // Indicate where balances came from
        }
      };
      
      console.log(`Final balance response - Requested: ${address}, Balance Address: ${balanceAddress}, Proxy: ${proxyAddress}, USDC: ${finalUsdc}, Portfolio: ${portfolioValue.toFixed(2)}, Source: ${apiBalances ? 'API' : 'Blockchain'}`);

      console.log('Balance response:', JSON.stringify(response, null, 2));
      res.json(response);
    } catch (error) {
      console.error('Error fetching balances:', error);
      next(error);
    }
  }

  /**
   * Get trades
   */
  async getTrades(req, res, next) {
    try {
      const { 
        market, 
        token_id, 
        maker, 
        limit 
      } = req.query;

      const trades = await clobService.getTrades({
        market,
        token_id,
        maker,
        limit
      });

      res.json({
        success: true,
        data: trades
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new OrderController();

