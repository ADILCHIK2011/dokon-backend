const express = require('express');
const { verifyToken, requireRole, loadMarket, requirePlan } = require('../middleware/auth.middleware');
const { chat, briefing } = require('../controllers/ai.controller');

const router = express.Router();

router.use(verifyToken, requireRole('owner'), loadMarket(), requirePlan('pro'));
router.post('/chat', chat);
router.get('/briefing', briefing);

module.exports = router;
