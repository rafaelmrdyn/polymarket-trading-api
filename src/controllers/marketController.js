const gammaService = require('../services/gammaService');
const clobService = require('../services/clobService');

class MarketController {
  /**
   * Get all markets
   */
  async getMarkets(req, res, next) {
    try {
      const { 
        limit, 
        offset, 
        active, 
        closed, 
        tag,
        search 
      } = req.query;

      let markets;

      if (search) {
        markets = await gammaService.searchMarkets(search);
      } else if (tag) {
        markets = await gammaService.getMarketsByTag(tag, { 
          limit, 
          offset,
          active: true,
          archived: false,
          closed: false,
          order: 'volume24hr',
          ascending: false
        });
      } else {
        // Request markets with exact parameters matching Polymarket homepage
        // Use parameters from query string if provided, otherwise use defaults
        const requestLimit = limit ? parseInt(limit) : 100;
        const requestOrder = req.query.order || 'volume24hr';
        // Handle both string and boolean values for ascending
        const requestAscending = req.query.ascending !== undefined 
          ? (req.query.ascending === 'true' || req.query.ascending === true) 
          : false;
        
        const requestParams = { 
          limit: requestLimit,
          offset: offset || 0,
          active: req.query.active !== undefined 
            ? (req.query.active === 'true' || req.query.active === true) 
            : true,
          archived: req.query.archived !== undefined 
            ? (req.query.archived === 'true' || req.query.archived === true) 
            : false,
          closed: req.query.closed !== undefined 
            ? (req.query.closed === 'true' || req.query.closed === true) 
            : false,
          order: requestOrder,
          ascending: requestAscending
        };
        
        markets = await gammaService.getMarkets(requestParams);
      }

      // Markets should already be an array from gammaService (already sorted correctly by API)
      let marketList = Array.isArray(markets) ? markets : [];
      
      // Deduplicate markets by ID (in case API returns duplicates)
      // Normalize IDs to handle string/number differences
      const seenIds = new Set();
      const uniqueMarkets = [];
      
      marketList.forEach((market, index) => {
        // Normalize ID - convert to string to handle number/string differences
        const marketId = String(market.id || market.condition_id || market.slug || '').toLowerCase().trim();
        
        if (!marketId || marketId === 'undefined' || marketId === 'null') {
          console.warn(`Market at index ${index} has invalid ID, skipping:`, market.question?.substring(0, 50));
          return;
        }
        
        if (seenIds.has(marketId)) {
          console.log(`Backend duplicate detected: Market "${market.question?.substring(0, 50)}..." (index ${index})`);
          return; // Skip duplicates
        }
        
        seenIds.add(marketId);
        uniqueMarkets.push(market);
      });
      
      console.log(`Backend: ${marketList.length} markets received, ${uniqueMarkets.length} unique after deduplication`);
      marketList = uniqueMarkets;
      
      // First, build/ensure tokens arrays exist for all markets
      marketList = marketList.map((market, idx) => {
        // Log first market structure for debugging
        if (idx === 0) {
          console.log(`Sample market ${market.id} structure:`, {
            hasTokens: !!market.tokens,
            tokensLength: market.tokens?.length || 0,
            hasOutcomes: !!market.outcomes,
            outcomesType: typeof market.outcomes,
            outcomesValue: market.outcomes,
            hasClobTokenIds: !!market.clobTokenIds,
            clobTokenIdsType: typeof market.clobTokenIds,
            clobTokenIdsValue: market.clobTokenIds,
            hasOutcomePrices: !!market.outcomePrices,
            allKeys: Object.keys(market).slice(0, 20)
          });
        }
        
        // Parse outcomePrices if available (fallback)
        const outcomePrices = typeof market.outcomePrices === 'string'
          ? JSON.parse(market.outcomePrices)
          : (market.outcomePrices || []);
        
        // Check if tokens need to be built (empty array or missing)
        const needsTokens = !market.tokens || !Array.isArray(market.tokens) || market.tokens.length === 0;
        
        if (needsTokens) {
          // Try to build tokens from various possible fields
          let outcomes = null;
          let clobTokenIds = null;
          
          // Try different field names
          if (market.outcomes) {
            outcomes = typeof market.outcomes === 'string' 
              ? JSON.parse(market.outcomes) 
              : market.outcomes;
          }
          
          if (market.clobTokenIds) {
            clobTokenIds = typeof market.clobTokenIds === 'string'
              ? JSON.parse(market.clobTokenIds)
              : market.clobTokenIds;
          }
          
          // Also check for alternative field names
          if (!outcomes && market.outcome) {
            outcomes = typeof market.outcome === 'string' 
              ? JSON.parse(market.outcome) 
              : market.outcome;
          }
          
          if (!clobTokenIds && market.tokenIds) {
            clobTokenIds = typeof market.tokenIds === 'string'
              ? JSON.parse(market.tokenIds)
              : market.tokenIds;
          }
          
          if (outcomes && Array.isArray(outcomes) && clobTokenIds && Array.isArray(clobTokenIds) && outcomes.length > 0 && clobTokenIds.length === outcomes.length) {
            market.tokens = outcomes.map((outcome, index) => ({
              outcome: outcome,
              token_id: clobTokenIds[index],
              price: outcomePrices[index] !== undefined && outcomePrices[index] !== null 
                ? parseFloat(outcomePrices[index]) 
                : null
            }));
            
            if (idx < 3) {
              console.log(`Built tokens for market ${market.id}:`, market.tokens.map(t => ({ outcome: t.outcome, token_id: t.token_id?.slice(0, 20) + '...' })));
            }
          } else {
            if (idx < 3) {
              console.warn(`Market ${market.id}: Cannot build tokens - outcomes: ${outcomes?.length || 'missing'}, clobTokenIds: ${clobTokenIds?.length || 'missing'}`);
            }
          }
        }
        
        return market;
      });
      
      // Collect all token IDs from all markets
      const allTokenIds = [];
      const tokenToMarketMap = new Map(); // Map token_id to market index
      
      marketList.forEach((market, marketIndex) => {
        if (market.tokens && Array.isArray(market.tokens)) {
          market.tokens.forEach(token => {
            if (token.token_id) {
              allTokenIds.push(token.token_id);
              tokenToMarketMap.set(token.token_id, { marketIndex, token });
            }
          });
        }
      });
      
      // Fetch prices for all tokens at once from CLOB
      if (allTokenIds.length > 0) {
        try {
          console.log(`Fetching CLOB prices for ${allTokenIds.length} tokens across ${marketList.length} markets`);
          const prices = await clobService.getPrices(allTokenIds);
          
          // Create a map of token_id to price for quick lookup (normalize to lowercase)
          const priceMap = new Map();
          if (Array.isArray(prices)) {
            prices.forEach(priceData => {
              const tokenId = priceData.token_id || priceData.tokenId || priceData.token;
              if (tokenId && priceData.price !== undefined && priceData.price !== null) {
                const price = parseFloat(priceData.price);
                if (!isNaN(price) && price >= 0 && price <= 1) {
                  // Store with both original and lowercase key for matching
                  priceMap.set(tokenId, price);
                  priceMap.set(tokenId.toLowerCase(), price);
                }
              }
            });
          }
          
          console.log(`Price map size: ${priceMap.size / 2} unique prices`);
          
          // Update markets with CLOB prices
          let enrichedCount = 0;
          marketList = marketList.map((market, marketIdx) => {
            if (market.tokens && Array.isArray(market.tokens)) {
              market.tokens = market.tokens.map(token => {
                if (token.token_id) {
                  // Try exact match first, then lowercase
                  const price = priceMap.get(token.token_id) || priceMap.get(token.token_id.toLowerCase());
                  if (price !== undefined) {
                    token.price = price;
                    enrichedCount++;
                    if (marketIdx === 0) {
                      console.log(`Market ${market.id || marketIdx}: Token ${token.outcome} (${token.token_id.slice(0, 20)}...) = ${price}`);
                    }
                  } else {
                    console.warn(`No price found for token ${token.token_id.slice(0, 20)}... (outcome: ${token.outcome})`);
                  }
                }
                return token;
              });
            }
            return market;
          });
          
          console.log(`Successfully enriched ${enrichedCount} tokens with CLOB prices across ${marketList.length} markets`);
        } catch (priceError) {
          console.error('Error fetching CLOB prices for markets list:', priceError.message);
          // Continue with outcomePrices as fallback
        }
      }
      
      // Don't filter or re-sort - Polymarket API already returns markets in the correct order
      // with the correct filters applied. Any additional filtering would change the order.
      
      // Limit to requested amount after sorting
      if (limit) {
        marketList = marketList.slice(0, parseInt(limit));
      }

      res.json({
        success: true,
        data: marketList
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get market details by ID
   */
  async getMarketDetails(req, res, next) {
    try {
      const { id } = req.params;
      const market = await gammaService.getMarket(id);

      // Enrich market tokens with prices from CLOB
      if (market && market.tokens && market.tokens.length > 0) {
        try {
          const tokenIds = market.tokens.map(t => t.token_id);
          const prices = await clobService.getPrices(tokenIds);
          
          console.log('Prices API response:', JSON.stringify(prices, null, 2));
          console.log('Prices type:', typeof prices);
          console.log('Is array:', Array.isArray(prices));
          
          // Prices API might return an array of { token_id, price } or an object
          if (Array.isArray(prices)) {
            market.tokens = market.tokens.map(token => {
              const priceData = prices.find(p => {
                // Handle different possible formats
                const pTokenId = p.token_id || p.tokenId || p.token;
                return pTokenId === token.token_id || pTokenId === token.token_id.toLowerCase();
              });
              if (priceData) {
                const price = priceData.price || priceData.priceValue || priceData.value;
                if (price !== undefined && price !== null) {
                  const parsedPrice = parseFloat(price);
                  if (!isNaN(parsedPrice) && parsedPrice > 0 && parsedPrice < 1) {
                    token.price = parsedPrice;
                    console.log(`Set price for ${token.outcome}: ${parsedPrice}`);
                  }
                }
              }
              return token;
            });
          } else if (prices && typeof prices === 'object') {
            // Handle object format (e.g., { token_id: price })
            market.tokens = market.tokens.map(token => {
              const price = prices[token.token_id] || prices[token.token_id.toLowerCase()];
              if (price !== undefined && price !== null) {
                const parsedPrice = parseFloat(price);
                if (!isNaN(parsedPrice) && parsedPrice > 0 && parsedPrice < 1) {
                  token.price = parsedPrice;
                  console.log(`Set price for ${token.outcome}: ${parsedPrice}`);
                }
              }
              return token;
            });
          }
        } catch (priceError) {
          console.error('Error fetching prices for market:', priceError.message);
          console.error('Price error stack:', priceError.stack);
          // Continue without prices - frontend can fetch them separately
        }
      }

      res.json({
        success: true,
        data: market
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get orderbook for a market
   */
  async getOrderbook(req, res, next) {
    try {
      const { id } = req.params;
      
      // Get market details to find token IDs
      const market = await gammaService.getMarket(id);
      
      if (!market || !market.tokens) {
        return res.status(404).json({
          success: false,
          error: 'Market not found or has no tokens'
        });
      }

      // Get orderbook for each token in the market
      const orderbookPromises = market.tokens.map(token => 
        clobService.getOrderbook(token.token_id)
      );

      const orderbooks = await Promise.all(orderbookPromises);

      // Combine orderbooks with token info
      const result = market.tokens.map((token, index) => ({
        token_id: token.token_id,
        outcome: token.outcome,
        orderbook: orderbooks[index]
      }));

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get prices for a market
   */
  async getPrices(req, res, next) {
    try {
      const { id } = req.params;
      
      // Get market details to find token IDs
      const market = await gammaService.getMarket(id);
      
      if (!market || !market.tokens) {
        return res.status(404).json({
          success: false,
          error: 'Market not found or has no tokens'
        });
      }

      const tokenIds = market.tokens.map(t => t.token_id);
      const pricesResponse = await clobService.getPrices(tokenIds);

      // Normalize prices response to array format
      let prices = [];
      if (Array.isArray(pricesResponse)) {
        prices = pricesResponse;
      } else if (pricesResponse && typeof pricesResponse === 'object') {
        // Convert object format to array
        prices = Object.entries(pricesResponse).map(([tokenId, price]) => ({
          token_id: tokenId,
          price: price
        }));
      }

      res.json({
        success: true,
        data: prices
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new MarketController();

