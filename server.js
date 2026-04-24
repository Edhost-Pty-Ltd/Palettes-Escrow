require('dotenv').config();

const express = require('express');
const cors = require('cors');
const paymentRoutes = require('./routes/payments');
const refundsRoutes = require('./routes/refunds');
const escrowRoutes = require('./routes/escrowRoutes');
const subaccountRoutes = require('./routes/subaccountRoutes');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

app.get("/api/test", (req, res) => {
  res.json({ message: "Backend working ✅" });
});

app.use('/api/payments', paymentRoutes);
app.use('/api/refunds', refundsRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/subaccounts', subaccountRoutes);
app.use('/api/auth', authRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running with Paystack split payment integration.',
    payment_provider: 'Paystack',
    api_base: '/api/payments',
    split_payment: {
      platform_percentage: 20,
      seller_percentage: 80,
      refund_policy: 'Service amount only (80% of total)'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on https://nonempty-sierra-paradoxically.ngrok-free.dev`);
  console.log('✅ Paystack split payment routes active at /api/payments');
  console.log('💰 Split Payment System:');
  console.log('   - Platform keeps: 20% (via subaccount percentage_charge)');
  console.log('   - Seller receives: 80% of service amount');
  console.log('   - Refund policy: service amount only');
  console.log('📋 Health check available at /health');
  console.log('🔗 API Documentation: See PAYSTACK_SPLIT_PAYMENT_IMPLEMENTATION.md');
});
