const express = require('express');
const { verifyToken, requireRole, loadMarket } = require('../middleware/auth.middleware');
const { listMine, listHistory, create, getOne, updateItems, complete, cancel } = require('../controllers/sales.controller');

const router = express.Router();

router.use(verifyToken, requireRole('owner', 'cashier'), loadMarket());

router.get('/mine', listMine);
router.get('/history', listHistory);
router.post('/', create);
router.get('/:id', getOne);
router.put('/:id/items', updateItems);
router.post('/:id/complete', complete);
router.delete('/:id', cancel);

module.exports = router;
