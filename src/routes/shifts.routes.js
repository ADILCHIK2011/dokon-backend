const express = require('express');
const { verifyToken, requireRole, loadMarket } = require('../middleware/auth.middleware');
const { current, start, end } = require('../controllers/shifts.controller');

const router = express.Router();

router.use(verifyToken, requireRole('owner', 'cashier'), loadMarket());

router.get('/current', current);
router.post('/start', start);
router.post('/end', end);

module.exports = router;
