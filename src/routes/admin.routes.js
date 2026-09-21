const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');
const { list, detail, create, renew, update, notes } = require('../controllers/admin.controller');

const router = express.Router();

router.use(verifyToken, requireRole('superadmin'));

router.get('/markets', list);
router.get('/markets/:id', detail);
router.get('/markets/:id/notes', notes);
router.post('/markets', create);
router.put('/markets/:id', update);
router.put('/markets/:id/renew', renew);

module.exports = router;
