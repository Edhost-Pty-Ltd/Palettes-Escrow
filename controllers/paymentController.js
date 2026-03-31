// ============================================================================
// PAYSTACK PAYMENT CONTROLLER - LOCAL INTEGRATION
// ============================================================================
// This controller handles direct Paystack API integration for payment processing
// Designed for local development with proper error handling and validation
// Acts as secure bridge between frontend and Paystack API
// ============================================================================

const paystackService = require('../services/paystack');
require('dotenv').config();

// ============================================================================
// PAYMENT INITIALIZATION ENDPOINT
// ============================================================================

/**
 * Initialize Payment with Paystack API
 * 
 * This endpoint:
 * 1. Accepts payment information from frontend (email, amount)
 * 2. Calculates split payment breakdown (15% markup)
 * 3. Sends POST request to Paystack transaction initialization endpoint
 * 4. Uses Paystack secret key in authorization header (secure on server)
 * 5. Returns authorization URL and transaction reference to frontend
 * 
 * IMPORTANT: This keeps sensitive keys on server, never exposed to mobile app
 */
const initializePayment = async (req, res) => {
  try {
    // ========================================
    // EXTRACT AND VALIDATE INPUT
    // ========================================
    
    const { email, amount, userId, metadata = {} } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Customer email is required'
      });
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Valid payment amount is required (must be positive number)'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Valid email address is required'
      });
    }

    console.log(`💰 Initializing payment for ${email}, amount: R${amount.toFixed(2)}`);

    // ========================================
    // CALCULATE SPLIT PAYMENT BREAKDOWN
    // ========================================
    
    // Calculate split payment (15% markup: 5% + 10%)
    const breakdown = paystackService.calculateSplitPayment(amount);
    
    console.log('📊 Payment Breakdown:');
    console.log(`   Service Amount: R${breakdown.serviceAmount.toFixed(2)}`);
    console.log(`   Markup (5%): R${breakdown.markupAmount.toFixed(2)}`);
    console.log(`   Agent Fee (10%): R${breakdown.agentServiceFee.toFixed(2)}`);
    console.log(`   Total Customer Pays: R${breakdown.totalAmount.toFixed(2)}`);

    // ========================================
    // PREPARE PAYSTACK TRANSACTION DATA
    // ========================================
    
    // Prepare transaction data for Paystack API
    const transactionData = {
      email: email,
      amount: breakdown.totalAmount, // Amount in ZAR (Paystack will convert to kobo internally)
      currency: 'ZAR',
      callback_url: process.env.PAYSTACK_CALLBACK_URL, // Local callback URL
      metadata: {
        ...metadata, 
        service_amount: breakdown.serviceAmount,
        markup_amount: breakdown.markupAmount,
        agent_service_fee: breakdown.agentServiceFee,
        total_amount: breakdown.totalAmount,
        firebaseUID: userId || '',
        
        created_at: new Date().toISOString(),
        local_development: true,
        

      }
    };

    // Add subaccount for split payment if provided
    if (metadata.seller_subaccount) {
      transactionData.subaccount = metadata.seller_subaccount;
      // Platform takes markup + agent fee (15% total)
      transactionData.transaction_charge = (breakdown.markupAmount + breakdown.agentServiceFee);
      console.log(`🏪 Using seller subaccount: ${metadata.seller_subaccount}`);
      console.log(`💸 Platform charge: R${(breakdown.markupAmount + breakdown.agentServiceFee).toFixed(2)}`);
    }

    // ========================================
    // COMMUNICATE WITH PAYSTACK API
    // ========================================
    
    console.log('🔄 Sending request to Paystack API...');
    
    // Send POST request to Paystack transaction initialization endpoint
    // This uses the Paystack secret key in authorization header (secure on server)
    console.log("FINAL METADATA SENT:", transactionData.metadata);
    const paystackResponse = await paystackService.initializeTransaction(transactionData);

    // Check if Paystack request was successful
    if (!paystackResponse || !paystackResponse.status) {
      console.error('❌ Paystack API Error:', paystackResponse);
      return res.status(400).json({
        success: false,
        error: 'Payment Initialization Failed',
        message: 'Unable to initialize payment with Paystack'
      });
    }

    console.log('✅ Paystack transaction initialized successfully');
    console.log(`🔗 Authorization URL: ${paystackResponse.data.authorization_url}`);
    console.log(`📝 Reference: ${paystackResponse.data.reference}`);

    // ========================================
    // RETURN RESPONSE TO FRONTEND
    // ========================================
    
    // Extract authorization URL and reference from Paystack response
    // Return them as JSON to frontend
    const response = {
      success: true,
      message: 'Payment initialized successfully',
      data: {
        // Payment checkout link for frontend to open
        authorization_url: paystackResponse.data.authorization_url,
        
        // Transaction reference for tracking
        reference: paystackResponse.data.reference,
        
        // Payment breakdown for display in mobile app
        breakdown: {
          service_amount: breakdown.serviceAmount,
          markup_amount: breakdown.markupAmount,
          agent_service_fee: breakdown.agentServiceFee,
          total_amount: breakdown.totalAmount,
          currency: 'ZAR',
          
          // Formatted amounts for display
          formatted: {
            service: `R${breakdown.serviceAmount.toFixed(2)}`,
            markup: `R${breakdown.markupAmount.toFixed(2)}`,
            agent_fee: `R${breakdown.agentServiceFee.toFixed(2)}`,
            total: `R${breakdown.totalAmount.toFixed(2)}`
          }
        },
        
        // Additional info for frontend
        customer_email: email,
        created_at: new Date().toISOString()
      }
    };

    console.log('📱 Sending response to frontend...');
    res.status(200).json(response);

  } catch (error) {
    // ========================================
    // ERROR HANDLING
    // ========================================
    
    console.error('💥 Payment initialization error:', error);
    
    // Return structured error response
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to initialize payment',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// PAYMENT VERIFICATION ENDPOINT
// ============================================================================

/**
 * Verify Payment Status with Paystack
 * 
 * This endpoint verifies payment status after customer completes payment
 * Used by frontend to confirm successful payment
 * 
 * IMPORTANT: This endpoint does NOT require authentication
 * It should be accessible without JWT tokens for frontend integration
 */
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    
    console.log(`🔍 Verifying payment: ${reference}`);
    console.log(`📋 Headers:`, req.headers);
    console.log(`🔐 Auth header present:`, !!req.headers.authorization);
    console.log(`🛣️ Route accessed: ${req.method} ${req.originalUrl}`);

    if (!reference) {
      return res.status(400).json({
        status: 'error',
        message: 'Transaction reference is required',
        error: 'Validation Error'
      });
    }

    // ========================================
    // VERIFY WITH PAYSTACK API
    // ========================================
    
    const verification = await paystackService.verifyTransaction(reference);

    if (!verification || !verification.status) {
      return res.status(404).json({
        status: 'error',
        message: 'Transaction not found',
        error: 'Transaction Not Found'
      });
    }

    const transactionData = verification.data;

    console.log("VERIFY FULL DATA:", verification.data);
    console.log(`🆔 Escrow ID in metadata: ${transactionData.metadata?.escrow_id || 'none'}`);
    console.log(`📊 Transaction Status: ${transactionData.status}`);
    console.log(`💰 Amount: R${(transactionData.amount / 100).toFixed(2)}`);

    // ========================================
    // EXTRACT SPLIT PAYMENT DETAILS
    // ========================================
    
    const metadata = transactionData.metadata || {};
    const splitPaymentDetails = {
      service_amount: Number(metadata.service_amount) || 0,
      markup_amount: Number(metadata.markup_amount) || 0,
      agent_service_fee: Number(metadata.agent_service_fee) || 0,
      total_amount: Number(metadata.total_amount) || (transactionData.amount / 100)
    };

    // ========================================
    // RETURN VERIFICATION RESPONSE
    // ========================================
    
    const response = {
      status: transactionData.status === 'success' ? 'success' : 'failed',
      transactionId: transactionData.id,
      amount: transactionData.amount / 100, // Convert from kobo to ZAR
      reference: transactionData.reference,
      paymentStatus: transactionData.status === 'success' ? 'completed' : 'failed',
      // Additional details for debugging
      split_payment: splitPaymentDetails,
      customer: {
        email: transactionData.customer.email,
        customer_code: transactionData.customer.customer_code
      },
      formatted_amounts: {
        service: `R${(splitPaymentDetails.service_amount || 0).toFixed(2)}`,
        markup: `R${(splitPaymentDetails.markup_amount || 0).toFixed(2)}`,
        agent_fee: `R${(splitPaymentDetails.agent_service_fee || 0).toFixed(2)}`,
        total: `R${(splitPaymentDetails.total_amount || 0).toFixed(2)}`
      },
      paid_at: transactionData.paid_at,
      created_at: transactionData.created_at
    };

    if (transactionData.status === 'success') {
      console.log('✅ Payment verified successfully');
    } else {
      console.log(`⚠️ Payment status: ${transactionData.status}`);
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('💥 Payment verification error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Payment verification failed',
      error: 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// WEBHOOK HANDLER FOR LOCAL DEVELOPMENT
// ============================================================================

/**
 * Handle Paystack Webhooks (Local Development)
 * 
 * This endpoint receives webhook notifications from Paystack
 * Processes payment events and updates local system
 */
const handleWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const signature = req.headers['x-paystack-signature'];

    console.log('🔔 Webhook received:', payload.event);

    // ========================================
    // VERIFY WEBHOOK SIGNATURE
    // ========================================
    
    const isValidSignature = paystackService.verifyWebhookSignature(payload, signature);
    
    if (!isValidSignature) {
      console.error('❌ Invalid webhook signature');
      return res.status(400).json({
        success: false,
        error: 'Invalid Signature',
        message: 'Webhook signature verification failed'
      });
    }

    console.log('✅ Webhook signature verified');

    // ========================================
    // PROCESS WEBHOOK EVENTS
    // ========================================
    
    const { event, data } = payload;

    switch (event) {
      case 'charge.success':
        console.log('💰 Payment successful!');
        console.log(`   Reference: ${data.reference}`);
        console.log(`   Amount: R${(data.amount / 100).toFixed(2)}`);
        console.log(`   Customer: ${data.customer.email}`);
        console.log(`   Escrow ID: ${data.metadata?.escrow_id || 'none'}`);
        
        // Extract split payment details
        if (data.metadata) {
          const serviceAmount = data.metadata.service_amount;
          const markupAmount = data.metadata.markup_amount;
          const agentFee = data.metadata.agent_service_fee;
          
          console.log('📊 Split Payment Details:');
          console.log(`   Service Amount: R${serviceAmount.toFixed(2)}`);
          console.log(`   Platform Fee: R${(markupAmount + agentFee).toFixed(2)}`);
        }
        
        // Here you would update your database, send notifications, etc.
        // For local development, we just log the success
        break;

      case 'charge.failed':
        console.log('❌ Payment failed');
        console.log(`   Reference: ${data.reference}`);
        console.log(`   Reason: ${data.gateway_response}`);
        break;

      default:
        console.log(`ℹ️ Unhandled webhook event: ${event}`);
    }

    // ========================================
    // RETURN SUCCESS RESPONSE
    // ========================================
    
    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });

  } catch (error) {
    console.error('💥 Webhook processing error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to process webhook'
    });
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  initializePayment,
  verifyPayment,
  handleWebhook
};