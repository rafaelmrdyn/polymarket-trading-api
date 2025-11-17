const axios = require('axios');

const GAMMA_API_URL = process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com';

class GammaService {
  /**
   * Get all markets with optional filters
   */
  async getMarkets(params = {}) {
    try {
      // Build query params matching Polymarket homepage exactly
      const queryParams = {
        limit: params.limit || 20,
        offset: params.offset || 0,
        active: params.active !== false ? true : params.active,
        archived: params.archived !== undefined ? params.archived : false,
        closed: params.closed !== true ? false : params.closed,
        order: params.order || 'volume24hr',
        ascending: params.ascending !== undefined ? params.ascending : false,
        ...params // Allow overrides
      };
      
      const response = await axios.get(`${GAMMA_API_URL}/markets`, {
        params: queryParams
      });
      
      // Polymarket API returns array directly
      let markets = Array.isArray(response.data) ? response.data : (response.data?.data || response.data?.results || []);
      
      // Enrich markets with tokens if possible (similar to getMarket)
      markets = markets.map(market => {
        // Parse outcomePrices if available
        const outcomePrices = typeof market.outcomePrices === 'string'
          ? JSON.parse(market.outcomePrices)
          : (market.outcomePrices || []);
        
        // Build tokens if they don't exist
        if (!market.tokens || market.tokens.length === 0) {
          const outcomes = typeof market.outcomes === 'string' 
            ? JSON.parse(market.outcomes) 
            : (market.outcomes || []);
          const clobTokenIds = typeof market.clobTokenIds === 'string'
            ? JSON.parse(market.clobTokenIds)
            : (market.clobTokenIds || []);
          
          if (outcomes.length > 0 && clobTokenIds.length === outcomes.length) {
            market.tokens = outcomes.map((outcome, index) => ({
              outcome: outcome,
              token_id: clobTokenIds[index],
              price: outcomePrices[index] !== undefined && outcomePrices[index] !== null 
                ? parseFloat(outcomePrices[index]) 
                : null
            }));
          }
        } else {
          // Enrich existing tokens with outcomePrices if available
          if (outcomePrices.length > 0 && market.tokens.length === outcomePrices.length) {
            market.tokens = market.tokens.map((token, index) => {
              if (!token.price && outcomePrices[index] !== undefined && outcomePrices[index] !== null) {
                token.price = parseFloat(outcomePrices[index]);
              }
              return token;
            });
          }
        }
        
        return market;
      });
      
      // Don't filter or re-sort - Polymarket API already returns markets in the correct order
      // with the correct filters applied based on the query parameters.
      // Any additional filtering would change the order from Polymarket's homepage.
      
      return markets;
    } catch (error) {
      console.error('Error fetching markets:', error.message);
      throw new Error('Failed to fetch markets');
    }
  }

  /**
   * Get a specific market by ID
   */
  async getMarket(marketId) {
    try {
      const response = await axios.get(`${GAMMA_API_URL}/markets/${marketId}`);
      const market = response.data;
      
      // Parse outcomePrices if available
      const outcomePrices = typeof market.outcomePrices === 'string'
        ? JSON.parse(market.outcomePrices)
        : (market.outcomePrices || []);
      
      // Construct tokens array from outcomes, outcomePrices, and clobTokenIds
      // Polymarket API doesn't always return tokens array, so we build it
      if (!market.tokens || market.tokens.length === 0) {
        const outcomes = typeof market.outcomes === 'string' 
          ? JSON.parse(market.outcomes) 
          : (market.outcomes || []);
        const clobTokenIds = typeof market.clobTokenIds === 'string'
          ? JSON.parse(market.clobTokenIds)
          : (market.clobTokenIds || []);
        
        if (outcomes.length > 0 && clobTokenIds.length === outcomes.length) {
          market.tokens = outcomes.map((outcome, index) => ({
            outcome: outcome,
            token_id: clobTokenIds[index],
            price: outcomePrices[index] !== undefined && outcomePrices[index] !== null 
              ? parseFloat(outcomePrices[index]) 
              : null
          }));
        }
      } else {
        // Enrich existing tokens with outcomePrices if available
        if (outcomePrices.length > 0 && market.tokens.length === outcomePrices.length) {
          market.tokens = market.tokens.map((token, index) => {
            if (!token.price && outcomePrices[index] !== undefined && outcomePrices[index] !== null) {
              token.price = parseFloat(outcomePrices[index]);
            }
            return token;
          });
        }
      }
      
      return market;
    } catch (error) {
      console.error('Error fetching market:', error.message);
      throw new Error('Failed to fetch market details');
    }
  }

  /**
   * Get market by condition ID
   */
  async getMarketByConditionId(conditionId) {
    try {
      const response = await axios.get(`${GAMMA_API_URL}/markets`, {
        params: { condition_id: conditionId }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching market by condition ID:', error.message);
      throw new Error('Failed to fetch market');
    }
  }

  /**
   * Get events
   */
  async getEvents(params = {}) {
    try {
      const response = await axios.get(`${GAMMA_API_URL}/events`, {
        params
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching events:', error.message);
      throw new Error('Failed to fetch events');
    }
  }

  /**
   * Get a specific event
   */
  async getEvent(eventId) {
    try {
      const response = await axios.get(`${GAMMA_API_URL}/events/${eventId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching event:', error.message);
      throw new Error('Failed to fetch event');
    }
  }

  /**
   * Search markets
   */
  async searchMarkets(query) {
    try {
      const response = await axios.get(`${GAMMA_API_URL}/search`, {
        params: { 
          q: query,
          active: true,
          archived: false,
          closed: false,
          order: 'volume24hr',
          ascending: false
        }
      });
      
      // Filter results to ensure only active markets
      let markets = Array.isArray(response.data) ? response.data : (response.data?.data || response.data?.results || []);
      const now = new Date();
      markets = markets.filter(m => {
        if (m.closed === true) return false;
        if (m.archived === true) return false;
        if (m.active !== true) return false;
        if (m.end_date) {
          const endDate = new Date(m.end_date);
          if (endDate < now) return false;
        }
        return true;
      });
      
      return markets;
    } catch (error) {
      console.error('Error searching markets:', error.message);
      throw new Error('Failed to search markets');
    }
  }

  /**
   * Get market tags
   */
  async getTags() {
    try {
      const response = await axios.get(`${GAMMA_API_URL}/tags`);
      return response.data;
    } catch (error) {
      console.error('Error fetching tags:', error.message);
      throw new Error('Failed to fetch tags');
    }
  }

  /**
   * Get markets by tag
   */
  async getMarketsByTag(tag, params = {}) {
    try {
      // Use same parameters as homepage for consistency
      const queryParams = {
        tag,
        active: params.active !== false ? true : params.active,
        archived: params.archived !== undefined ? params.archived : false,
        closed: params.closed !== true ? false : params.closed,
        order: params.order || 'volume24hr',
        ascending: params.ascending !== undefined ? params.ascending : false,
        ...params
      };
      
      const response = await axios.get(`${GAMMA_API_URL}/markets`, {
        params: queryParams
      });
      
      // Filter results to ensure only active markets
      let markets = Array.isArray(response.data) ? response.data : (response.data?.data || response.data?.results || []);
      const now = new Date();
      markets = markets.filter(m => {
        if (m.closed === true) return false;
        if (m.archived === true) return false;
        if (queryParams.active !== false && m.active !== true) return false;
        if (m.end_date) {
          const endDate = new Date(m.end_date);
          if (endDate < now) return false;
        }
        return true;
      });
      
      return markets;
    } catch (error) {
      console.error('Error fetching markets by tag:', error.message);
      throw new Error('Failed to fetch markets by tag');
    }
  }

  /**
   * Get series
   */
  async getSeries(params = {}) {
    try {
      const response = await axios.get(`${GAMMA_API_URL}/series`, {
        params
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching series:', error.message);
      throw new Error('Failed to fetch series');
    }
  }
}

module.exports = new GammaService();

