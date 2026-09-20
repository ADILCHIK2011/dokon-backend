const express = require('express');
const { verifyToken, requireRole, loadMarket } = require('../middleware/auth.middleware');
const { list, getByBarcode, create, update, remove, bulkImport } = require('../controllers/products.controller');

const router = express.Router();

router.use(verifyToken, loadMarket());

router.get('/', list);
router.get('/barcode/:barcode', getByBarcode);
router.post('/', requireRole('owner'), create);
router.post('/import', requireRole('owner'), bulkImport);
router.put('/:id', requireRole('owner'), update);
router.delete('/:id', requireRole('owner'), remove);

module.exports = router;
