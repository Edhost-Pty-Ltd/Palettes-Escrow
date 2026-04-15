const express = require('express');
const authenticateJWT = require('../middleware/authJwt');
const { initiateRefund, getUserRefunds } = require('../controllers/refundController');

const router = express.Router();

router.post('/', authenticateJWT, initiateRefund);
router.get('/', authenticateJWT, getUserRefunds);

module.exports = router;
