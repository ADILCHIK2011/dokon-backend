const express = require('express');
const { verifyToken, requireRole, loadMarket } = require('../middleware/auth.middleware');
const { summary, topProducts, daily, deadStock } = require('../controllers/analytics.controller');

const router = express.Router();

router.use(verifyToken, requireRole('owner'), loadMarket());

router.get('/summary', summary);
router.get('/top-products', topProducts);
router.get('/daily', daily);
router.get('/dead-stock', deadStock);

module.exports = router;
