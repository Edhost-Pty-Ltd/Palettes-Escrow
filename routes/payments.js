
const express = require('express');

const { 
  handleCallback, 
  createTransactionWithLink, 
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
  verifyPayment
} = require('../controllers/paymentController');

const authenticateJWT = require('../middleware/authJwt');

const { login, signup } = require('../controllers/jwtController');

const router = express.Router();

router.post('/signup', signup);
router.post('/login', login);


const {createSubaccount} =require("../controllers/createSubaccount")
router.post("/create-subaccount", authenticateJWT, createSubaccount)
router.post('/transactionCreate', authenticateJWT, createTransactionWithLink);

router.get('/verify/:reference', verifyPayment);


router.post('/tokenCreate', authenticateJWT, createToken);
router.post('/updateToken', authenticateJWT, updateToken);
router.post('/tokenDetails', authenticateJWT, getTokenDetails);


router.post('/allocationStartDelivery', authenticateJWT, allocationStartDelivery);
router.post('/allocationAcceptDelivery', authenticateJWT, allocationAcceptDelivery);
router.post('/allocationDetails', authenticateJWT, getAllocationDetails);

router.post('/callback', handleCallback);


router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Paystack payment API is running',
    endpoints: {
      auth: ['POST /signup', 'POST /login'],
      payment: ['POST /transactionCreate', 'GET /verify/:reference'],
      token: ['POST /tokenCreate', 'POST /updateToken', 'POST /tokenDetails'],
      allocation: ['POST /allocationStartDelivery', 'POST /allocationAcceptDelivery'],
      webhook: ['POST /callback'],
      refunds: ['POST /api/refunds', 'GET /api/refunds']
    },
    split_payment: {
      platform_percentage: 20,
      seller_percentage: 80,
      refund_policy: 'Service amount only (80% of total)'
    }
  });
});

module.exports = router;
