 // ============================================================================
// PAYSTACK SPLIT PAYMENT SERVER
// ============================================================================
// Main server file for the Paystack split payment system.
// This server handles service booking payments with a 20% platform split:
// - Platform keeps 20% via Paystack subaccount percentage_charge
// - Seller receives 80% of the service amount
// - Only the service amount (80%) is refundable to customers
// ============================================================================

// Load environment variables from .env file
require('dotenv').config();

// Import required modules
const express = require('express');
const cors = require('cors');
const paymentRoutes = require('./routes/payments');
const refundsRoutes = require('./routes/refunds');
const escrowRoutes = require('./routes/escrowRoutes');
const subaccountRoutes = require('./routes/subaccountRoutes');
const authRoutes = require('./routes/auth');


// Create Express application
const app = express();

// Get port from environment or default to 3000
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE CONFIGURATION
// ============================================================================

// Parse JSON request bodies (required for API endpoints)
app.use(express.json());
app.use(cors());

//testing the api

app.get("/api/test", (req, res) => {
  res.json({ message: "Backend working ✅" });
});
// ============================================================================
// ROUTE CONFIGURATION
// ============================================================================

// Mount payment routes with /api/payments prefix
// All 18 Paystack endpoints are available under this prefix
app.use('/api/payments', paymentRoutes);
app.use('/api/refunds', refundsRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/subaccounts', subaccountRoutes);
app.use('/api/auth', authRoutes);

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

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
// ============================================================================
// START SERVER
// ============================================================================

// Start the server and listen on specified port
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log('✅ Paystack split payment routes active at /api/payments');
  console.log('💰 Split Payment System:');
  console.log('   - Platform keeps: 20% (via subaccount percentage_charge)');
  console.log('   - Seller receives: 80% of service amount');
  console.log('   - Refund policy: service amount only');
  console.log('📋 Health check available at /health');
  console.log('🔗 API Documentation: See PAYSTACK_SPLIT_PAYMENT_IMPLEMENTATION.md');
});