const express = require('express');
const router = express.Router();

// Import controllers (will be created in next step)
const marketController = require('../controllers/marketController');
const orderController = require('../controllers/orderController');

// Market routes
router.get('/markets', marketController.getMarkets);
router.get('/markets/:id', marketController.getMarketDetails);
router.get('/markets/:id/orderbook', marketController.getOrderbook);
router.get('/markets/:id/prices', marketController.getPrices);

// Order routes
router.get('/orders/address', orderController.getTradingAddress); // Get trading address
router.post('/orders', orderController.placeOrder);
router.delete('/orders/:id', orderController.cancelOrder);
router.get('/orders/active', orderController.getActiveOrders);
router.get('/orders/history', orderController.getOrderHistory);
router.get('/orders/:id', orderController.getOrder);

// Balance routes
router.get('/balances/:address', orderController.getBalances);

// Trade routes
router.get('/trades', orderController.getTrades);

module.exports = router;

