const express = require('express');
const { verifyToken, requireRole, loadMarket, requirePlan, requirePermission } = require('../middleware/auth.middleware');
const { list, create, update, getOne, recordPayment } = require('../controllers/debtors.controller');

const router = express.Router();

router.use(verifyToken, requireRole('owner', 'cashier'), loadMarket(), requirePlan('pro'), requirePermission('nasiya'));

router.get('/', list);
router.post('/', create);
router.get('/:id', getOne);
router.put('/:id', update);
router.post('/:id/payments', recordPayment);

module.exports = router;
