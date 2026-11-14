const express = require('express');
const { login, alohidaLogin, adminLogin, me, changePassword } = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/login', login);
router.post('/alohida-login', alohidaLogin);
router.post('/admin-login', adminLogin);
router.get('/me', verifyToken, me);
router.put('/me/password', verifyToken, changePassword);

module.exports = router;
