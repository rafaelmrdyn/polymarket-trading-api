const axios = require('axios');
const { ClobClient } = require('@polymarket/clob-client');

const CLOB_API_URL = process.env.CLOB_API_URL || 'https://clob.polymarket.com';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '137'); // Polygon mainnet

// Create CLOB client instance
let clobClient = null;

const initializeClobClient = async () => {
  try {
    // Initialize client without credentials for read-only operations
    // Users will sign orders on frontend with their own wallet
    clobClient = new ClobClient(
      CLOB_API_URL,
      CHAIN_ID,
      undefined // No private key needed for proxy server
    );
    console.log('✅ CLOB Client initialized');
  } catch (error) {
    console.error('❌ Error initializing CLOB client:', error.message);
  }
};

// Initialize on module load
initializeClobClient();

class ClobService {
  /**
   * Get orderbook for a specific token
   */
  async getOrderbook(tokenId) {
    try {
      const response = await axios.get(`${CLOB_API_URL}/book`, {
        params: { token_id: tokenId }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching orderbook:', error.message);
      throw new Error('Failed to fetch orderbook');
    }
  }

  /**
   * Get current price for a token
   */
  async getPrice(tokenId) {
    try {
      const response = await axios.get(`${CLOB_API_URL}/price`, {
        params: { token_id: tokenId }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching price:', error.message);
      throw new Error('Failed to fetch price');
    }
  }

  /**
   * Get prices for multiple tokens
   */
  async getPrices(tokenIds) {
    try {
      console.log(`Fetching prices for ${tokenIds.length} tokens`);
      
      // Try using midpoint endpoint for each token (more reliable)
      const pricePromises = tokenIds.map(async (tokenId) => {
        try {
          const response = await axios.get(`${CLOB_API_URL}/midpoint`, {
            params: { token_id: tokenId }
          });
          const midpoint = response.data;
          console.log(`Midpoint response for ${tokenId.slice(0, 20)}...:`, midpoint);
          
          // Midpoint returns { price: number } or just a number
          let price = null;
          if (typeof midpoint === 'number') {
            price = midpoint;
          } else if (typeof midpoint === 'object' && midpoint !== null) {
            price = midpoint.price || midpoint.midpoint || midpoint.value || midpoint.mid || null;
          } else if (typeof midpoint === 'string') {
            price = parseFloat(midpoint);
          }
          
          if (price !== null && !isNaN(price) && price >= 0 && price <= 1) {
            return {
              token_id: tokenId,
              price: parseFloat(price)
            };
          } else {
            console.warn(`Invalid price for token ${tokenId.slice(0, 20)}...: ${price}`);
            return null;
          }
        } catch (err) {
          console.error(`Error fetching midpoint for token ${tokenId.slice(0, 20)}...:`, err.message);
          if (err.response) {
            console.error(`Response status: ${err.response.status}, data:`, err.response.data);
          }
          return null;
        }
      });
      
      const prices = await Promise.all(pricePromises);
      const validPrices = prices.filter(p => p !== null);
      console.log(`Successfully fetched ${validPrices.length} out of ${tokenIds.length} prices`);
      return validPrices;
    } catch (error) {
      console.error('Error fetching prices:', error.message);
      // Fallback to direct prices endpoint
      try {
        console.log('Trying fallback prices endpoint...');
        const response = await axios.get(`${CLOB_API_URL}/prices`, {
          params: { token_ids: tokenIds.join(',') }
        });
        console.log('Fallback prices response:', response.data);
        return response.data;
      } catch (fallbackError) {
        console.error('Fallback prices endpoint also failed:', fallbackError.message);
        if (fallbackError.response) {
          console.error(`Response status: ${fallbackError.response.status}, data:`, fallbackError.response.data);
        }
        throw new Error('Failed to fetch prices');
      }
    }
  }

  /**
   * Place an order (already signed by the user on frontend)
   */
  async placeOrder(signedOrder) {
    try {
      console.log('Placing order via CLOB API:', {
        maker: signedOrder.maker,
        tokenId: signedOrder.tokenId,
        side: signedOrder.side,
        hasSignature: !!signedOrder.signature
      });

      // Use direct axios call to CLOB API with signed order
      // ClobClient requires API keys which we don't have without user's private key
      // So we'll submit the signed order directly
      console.log('Submitting signed order directly to CLOB API...');
      const response = await axios.post(`${CLOB_API_URL}/order`, signedOrder, {
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });
      console.log('Order placed successfully via direct API call');
      return response.data;
    } catch (error) {
      const errorDetails = {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        url: error.config?.url
      };
      console.error('Error placing order - Full details:', JSON.stringify(errorDetails, null, 2));
      
      // If it's an API key error, provide helpful message
      if (error.response?.status === 401 && error.response?.data?.error?.includes('api key')) {
        throw new Error(
          'Polymarket CLOB API requires API key authentication (L2) for programmatic order submission. ' +
          'To enable trading:\n' +
          '1. Create API keys in your Polymarket Builder Profile (https://polymarket.com/builder)\n' +
          '2. Set POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and POLYMARKET_API_PASSPHRASE in backend .env\n' +
          '3. Or trade directly on polymarket.com which handles API keys server-side'
        );
      }
      
      const errorMessage = error.response?.data?.error || 
                          error.response?.data?.message || 
                          error.message || 
                          'Failed to place order';
      throw new Error(errorMessage);
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId, signature) {
    try {
      const response = await axios.delete(`${CLOB_API_URL}/order`, {
        data: { order_id: orderId, signature }
      });
      return response.data;
    } catch (error) {
      console.error('Error canceling order:', error.message);
      throw new Error('Failed to cancel order');
    }
  }

  /**
   * Get orders for a specific address
   */
  async getOrders(address, params = {}) {
    try {
      // Normalize address to lowercase
      const normalizedAddress = address.toLowerCase();
      
      // Try different parameter formats that CLOB API might accept
      // Some APIs use 'maker', others might use 'address' or 'user'
      const requestParams = { 
        maker: normalizedAddress
      };
      
      // Add limit if provided
      if (params.limit) {
        requestParams.limit = params.limit;
      }
      
      console.log('Fetching orders from CLOB API:', {
        url: `${CLOB_API_URL}/orders`,
        address: normalizedAddress
      });
      
      // Try GET first, but if it returns 405, the endpoint might not support GET
      // Some CLOB APIs require POST for querying orders
      let response;
      try {
        response = await axios.get(`${CLOB_API_URL}/orders`, {
          params: requestParams,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });
      } catch (getError) {
        // If GET returns 405, try POST with address in body
        if (getError.response?.status === 405) {
          console.log('GET returned 405, trying POST instead...');
          try {
            response = await axios.post(`${CLOB_API_URL}/orders`, {
              maker: normalizedAddress,
              ...requestParams
            }, {
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              timeout: 15000
            });
          } catch (postError) {
            // If POST also fails, the endpoint might not be publicly available
            // Return empty array gracefully
            if (postError.response?.status === 401 || postError.response?.status === 403) {
              console.warn('CLOB API /orders endpoint requires authentication. Returning empty array.');
              return [];
            }
            throw postError;
          }
        } else {
          throw getError;
        }
      }
      
      console.log('CLOB API response:', {
        status: response.status,
        dataType: typeof response.data,
        isArray: Array.isArray(response.data),
        dataLength: Array.isArray(response.data) ? response.data.length : 'N/A',
        hasData: !!response.data
      });
      
      // CLOB API might return data directly as array or wrapped in an object
      let orders = [];
      if (Array.isArray(response.data)) {
        orders = response.data;
      } else if (response.data && typeof response.data === 'object') {
        // Try common response formats
        orders = response.data.data || response.data.orders || response.data.results || [];
        // If still not an array, try to extract from object values
        if (!Array.isArray(orders) && Object.keys(response.data).length > 0) {
          // Check if response.data itself might be an order object (single order)
          if (response.data.id || response.data.order_id) {
            orders = [response.data];
          } else {
            orders = [];
          }
        }
      }
      
      console.log(`Retrieved ${orders.length} orders from CLOB API`);
      
      // Filter by status client-side if provided
      if (params.status && orders.length > 0) {
        const statusFilter = params.status.toLowerCase();
        const filteredOrders = orders.filter(order => {
          // Check various possible status fields
          const orderStatus = (order.status || order.state || '').toLowerCase();
          
          // Determine status from order properties if status field is missing
          if (!orderStatus) {
            // Check if order is filled based on filled amount vs total amount
            const filled = parseFloat(order.filled || order.filledAmount || 0);
            const total = parseFloat(order.size || order.amount || order.makerAmount || 0);
            
            if (filled > 0 && filled >= total) {
              return statusFilter === 'filled' || statusFilter === 'completed';
            } else if (filled > 0 && filled < total) {
              // Partially filled - consider it open if filtering for open
              return statusFilter === 'open' || statusFilter === 'partial';
            } else {
              // Not filled - consider it open
              return statusFilter === 'open' || statusFilter === 'pending';
            }
          }
          
          // Map common status values
          const statusMap = {
            'open': ['open', 'pending', 'active', 'new'],
            'filled': ['filled', 'completed', 'executed', 'done'],
            'cancelled': ['cancelled', 'canceled', 'cancelled'],
            'partial': ['partial', 'partially_filled']
          };
          
          // Check if orderStatus matches the filter
          const matchingStatuses = statusMap[statusFilter] || [statusFilter];
          return matchingStatuses.includes(orderStatus);
        });
        
        console.log(`Filtered orders by status '${params.status}': ${filteredOrders.length} of ${orders.length}`);
        return filteredOrders;
      }
      
      return orders;
    } catch (error) {
      console.error('Error fetching orders:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        params: error.config?.params,
        stack: error.stack
      });
      
      // Provide more detailed error message
      let errorMessage = 'Failed to fetch orders';
      
      if (error.response) {
        // API returned an error response
        const status = error.response.status;
        const responseData = error.response.data;
        
        console.error('CLOB API error response:', {
          status,
          statusText: error.response.statusText,
          data: responseData
        });
        
        // If it's a 404, the user might just have no orders - return empty array
        if (status === 404) {
          console.log('404 response - user likely has no orders, returning empty array');
          return [];
        }
        
        // If it's a 405, the endpoint doesn't support this HTTP method
        // This likely means the endpoint requires authentication or doesn't exist publicly
        if (status === 405) {
          console.warn('405 Method Not Allowed - CLOB API /orders endpoint may require authentication or use different method. Returning empty array.');
          return [];
        }
        
        // If it's a 400, it might be an invalid parameter - try to provide helpful message
        if (status === 400) {
          errorMessage = responseData?.error || 
                        responseData?.message || 
                        'Invalid request. Please check the address format.';
        } else if (status === 401 || status === 403) {
          errorMessage = 'Authentication required. The CLOB API may require API keys for this endpoint.';
        } else {
          errorMessage = responseData?.error || 
                        responseData?.message || 
                        `API error: ${status} ${error.response.statusText}`;
        }
      } else if (error.request) {
        // Request was made but no response received
        console.error('No response from CLOB API - network error or timeout');
        errorMessage = 'No response from CLOB API. Please check your connection or try again later.';
      } else {
        // Error setting up the request
        console.error('Error setting up request:', error.message);
        errorMessage = error.message || 'Failed to fetch orders';
      }
      
      // For network errors or timeouts, return empty array instead of throwing
      // This allows the UI to show "no orders" instead of an error
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || !error.response) {
        console.warn('Network/timeout error - returning empty array to allow graceful handling');
        return [];
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Get a specific order by ID
   */
  async getOrder(orderId) {
    try {
      const response = await axios.get(`${CLOB_API_URL}/order/${orderId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching order:', error.message);
      throw new Error('Failed to fetch order');
    }
  }

  /**
   * Get trades for a market
   */
  async getTrades(params = {}) {
    try {
      const response = await axios.get(`${CLOB_API_URL}/trades`, {
        params
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching trades:', error.message);
      throw new Error('Failed to fetch trades');
    }
  }

  /**
   * Get spread information
   */
  async getSpread(tokenId) {
    try {
      const response = await axios.get(`${CLOB_API_URL}/spread`, {
        params: { token_id: tokenId }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching spread:', error.message);
      throw new Error('Failed to fetch spread');
    }
  }

  /**
   * Get midpoint price
   */
  async getMidpoint(tokenId) {
    try {
      const response = await axios.get(`${CLOB_API_URL}/midpoint`, {
        params: { token_id: tokenId }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching midpoint:', error.message);
      throw new Error('Failed to fetch midpoint');
    }
  }
}

module.exports = new ClobService();

