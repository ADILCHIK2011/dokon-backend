const express = require('express');
const { verifyToken, requireRole, loadMarket } = require('../middleware/auth.middleware');
const { list, getByBarcode, generateBarcode, create, update, remove, bulkImport } = require('../controllers/products.controller');

const router = express.Router();

router.use(verifyToken, loadMarket());

router.get('/', list);
router.get('/generate-barcode', requireRole('owner'), generateBarcode);
router.get('/barcode/:barcode', getByBarcode);
router.post('/', requireRole('owner'), create);
router.post('/import', requireRole('owner'), bulkImport);
router.put('/:id', requireRole('owner'), update);
router.delete('/:id', requireRole('owner'), remove);

module.exports = router;
