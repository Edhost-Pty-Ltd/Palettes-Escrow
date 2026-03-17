// ============================================================================
// PAYSTACK PAYMENT ROUTES - ESSENTIAL ENDPOINTS ONLY
// ============================================================================
// Clean, minimal API with only the essential payment endpoints
// All routes are prefixed with /api/payments/
// ============================================================================

const express = require('express');

// Import controller functions
const { 
  handleCallback, 
  createTransactionWithLink, 
  refundTransaction
} = require('../controllers/transactionsController');

const { 
  createToken, 
  updateToken, 
  getTokenDetails 
} = require('../controllers/tokenController');

const { 
  allocationStartDelivery, 
  allocationAcceptDelivery, 
  getAllocationDetails 
} = require('../controllers/allocationsController');

const { 
  verifyPayment,
  handleWebhook 
} = require('../controllers/paymentController');

// Import middleware
const authenticateJWT = require('../middleware/authJwt');

// Import authentication controllers
const { login, signup } = require('../controllers/jwtController');

const router = express.Router();

// ============================================================================
// AUTHENTICATION ENDPOINTS - NO AUTH REQUIRED
// ============================================================================

router.post('/signup', signup);
router.post('/login', login);

// ============================================================================
// CORE PAYMENT ENDPOINTS
// ============================================================================

// Create payment with split logic
router.post('/transactionCreate', authenticateJWT, createTransactionWithLink);

// Verify payment status (NO AUTH REQUIRED - for frontend integration)
router.get('/verify/:reference', verifyPayment);

// Process refunds (service amount only)
router.post('/refund', authenticateJWT, refundTransaction);

// ============================================================================
// TOKEN/SUBACCOUNT MANAGEMENT - REQUIRE AUTH
// ============================================================================

router.post('/tokenCreate', authenticateJWT, createToken);
router.post('/updateToken', authenticateJWT, updateToken);
router.post('/tokenDetails', authenticateJWT, getTokenDetails);

// ============================================================================
// ALLOCATION MANAGEMENT - REQUIRE AUTH
// ============================================================================

router.post('/allocationStartDelivery', authenticateJWT, allocationStartDelivery);
router.post('/allocationAcceptDelivery', authenticateJWT, allocationAcceptDelivery);
router.post('/allocationDetails', authenticateJWT, getAllocationDetails);

// ============================================================================
// WEBHOOK ENDPOINT - NO AUTH (PAYSTACK WEBHOOKS)
// ============================================================================

router.post('/callback', handleCallback);

// ============================================================================
// HEALTH CHECK ENDPOINT - NO AUTH
// ============================================================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Paystack payment API is running',
    endpoints: {
      auth: ['POST /signup', 'POST /login'],
      payment: ['POST /transactionCreate', 'GET /verify/:reference', 'POST /refund'],
      token: ['POST /tokenCreate', 'POST /updateToken', 'POST /tokenDetails'],
      allocation: ['POST /allocationStartDelivery', 'POST /allocationAcceptDelivery'],
      webhook: ['POST /callback']
    },
    split_payment: {
      markup_percentage: 5,
      agent_fee_percentage: 10,
      total_markup: 15,
      refund_policy: 'Service amount only'
    }
  });
});

module.exports = router;
