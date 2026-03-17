// ============================================================================
// PAYSTACK SPLIT PAYMENT SERVER
// ============================================================================
// Main server file for the Paystack split payment system.
// This server handles service booking payments with automatic 15% markup:
// - 5% markup covers Paystack transaction fees (non-refundable)
// - 10% agent service fee goes to platform/agents (non-refundable)
// - Only original service amount is refundable to customers
// ============================================================================

// Load environment variables from .env file
require('dotenv').config();

// Import required modules
const express = require('express');
const paymentRoutes = require('./routes/payments');

// Create Express application
const app = express();

// Get port from environment or default to 3000
const PORT = process.env.PORT || 3000;

// ============================================================================
// MIDDLEWARE CONFIGURATION
// ============================================================================

// Parse JSON request bodies (required for API endpoints)
app.use(express.json());

// ============================================================================
// ROUTE CONFIGURATION
// ============================================================================

// Mount payment routes with /api/payments prefix
// All 18 Paystack endpoints are available under this prefix
app.use('/api/payments', paymentRoutes);

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

// Health check endpoint to verify server status
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Server is running with Paystack split payment integration.',
    payment_provider: 'Paystack',
    api_base: '/api/payments',
    split_payment: {
      markup_percentage: 5,           // Covers Paystack fees
      agent_fee_percentage: 10,       // Platform commission
      total_markup: 15,               // Total additional cost
      refund_policy: 'Service amount only' // Only original service cost is refundable
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
  console.log('   - Service Amount: 85% (goes to seller, refundable)');
  console.log('   - Markup: 5% (covers Paystack fees, non-refundable)');
  console.log('   - Agent Fee: 10% (platform commission, non-refundable)');
  console.log('   - Total Customer Pays: 115% of service cost');
  console.log('📋 Health check available at /health');
  console.log('🔗 API Documentation: See PAYSTACK_SPLIT_PAYMENT_IMPLEMENTATION.md');
});