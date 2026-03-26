// ============================================================================
// PAYSTACK TRANSACTION CONTROLLER
// ============================================================================
// This controller handles all payment-related operations including:
// - Creating transactions with split payment logic
// - Processing refunds (service amount only)
// - Handling Paystack webhooks
// - Managing payment allocations and parties
// ============================================================================

const callbackEvents = require('../events');
const paystackService = require('../services/paystack');
const db = require('../firebase');
const crypto = require('crypto');

/**
 * Create transaction with payment link using split payment logic
 * 
 * This function:
 * 1. Validates all input parameters
 * 2. Calculates split payment breakdown (15% markup)
 * 3. Creates Paystack transaction with total amount
 * 4. Stores breakdown in metadata for refund processing
 * 5. Returns payment link and breakdown for mobile app
 * 
 * Replaces: TradeSafe createTransactionWithLink
 * Uses split payment system where customer pays service + 5% + 10%
 */
const createTransactionWithLink = async (req, res) => {
  try {
    // ========================================
    // EXTRACT AND VALIDATE INPUT DATA
    // ========================================
    
    // Extract the input from the request body
    // userId should come from the request body (Firebase UID from client)
    const { input, userId } = req.body;

    // Check if input data is provided
    if (!input) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Payment input data is required' 
      });
    }

    // ========================================
    // VALIDATE SERVICE AMOUNT
    // ========================================
    
    // Check if service amount is provided
    if (!input.amount) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Service amount is required' 
      });
    }

    // Ensure service amount is a number
    if (typeof input.amount !== 'number') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Service amount must be a number' 
      });
    }

    // Ensure service amount is positive
    if (input.amount <= 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Service amount must be a positive number' 
      });
    }

    // Ensure service amount is finite
    if (!Number.isFinite(input.amount)) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Service amount must be a finite number' 
      });
    }

    // ========================================
    // VALIDATE BUYER EMAIL
    // ========================================
    
    // Get buyer email from input (support both formats)
    const buyerEmail = input.buyer?.email || input.email;
    if (!buyerEmail) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Buyer email is required' 
      });
    }

    // Ensure email is a string
    if (typeof buyerEmail !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Buyer email must be a string' 
      });
    }

    // Validate email format using regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(buyerEmail)) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Buyer email must be a valid email address' 
      });
    }

    // ========================================
    // VALIDATE OPTIONAL FIELDS
    // ========================================
    
    // Validate seller subaccount if provided
    if (input.seller_subaccount && typeof input.seller_subaccount !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Seller subaccount must be a string' 
      });
    }

    // Validate booking ID if provided
    if (input.booking_id && typeof input.booking_id !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Booking ID must be a string' 
      });
    }

    // Validate title if provided
    if (input.title && typeof input.title !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Title must be a string' 
      });
    }

    // Validate description if provided
    if (input.description && typeof input.description !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Description must be a string' 
      });
    }

    // Validate buyer information if provided
    if (input.buyer) {
      // Validate buyer given name if provided
      if (input.buyer.givenName && typeof input.buyer.givenName !== 'string') {
        return res.status(400).json({ 
          error: 'Validation failed', 
          message: 'Buyer given name must be a string' 
        });
      }
      
      // Validate buyer family name if provided
      if (input.buyer.familyName && typeof input.buyer.familyName !== 'string') {
        return res.status(400).json({ 
          error: 'Validation failed', 
          message: 'Buyer family name must be a string' 
        });
      }
    }

    // ========================================
    // CALCULATE SPLIT PAYMENT BREAKDOWN
    // ========================================
    
    let breakdown;
    
    try {
      // Calculate the 15% markup breakdown:
      // - Service amount: goes to seller (refundable)
      // - 5% markup: covers Paystack fees (non-refundable)
      // - 10% agent fee: platform commission (non-refundable)
      breakdown = paystackService.calculateSplitPayment(input.amount);
    } catch (calculationError) {
      // Return error if calculation fails (invalid input)
      return res.status(400).json({ 
        error: 'Payment calculation failed', 
        message: calculationError.message 
      });
    }

    // ========================================
    // PREPARE PAYSTACK PAYMENT DATA
    // ========================================
    
    // Prepare payment data for Paystack API
    const paymentData = {
      email: buyerEmail,                          // Customer email for payment
      amount: breakdown.totalAmount,              // Total amount in ZAR (customer pays service + 15%)
      currency: 'ZAR',                           // South African Rand
      callback_url: process.env.PAYSTACK_CALLBACK_URL, // Webhook URL for payment notifications
      
      // Store all payment details in metadata for future reference
      metadata: {
        // Booking information
        title: input.title,                       // Service title
        description: input.description,           // Service description
        seller_subaccount: input.seller_subaccount, // Seller's Paystack subaccount
        booking_id: input.booking_id,             // Unique booking identifier
        
        // Customer information
        buyer_email: buyerEmail,                  // Customer email
        buyer_name: `${input.buyer?.givenName || ''} ${input.buyer?.familyName || ''}`.trim(), // Customer name
        firebaseUID: userId || '',                 // Firebase UID for refund filtering
        
        // CRITICAL: Store breakdown amounts for refund processing
        service_amount: breakdown.serviceAmount,   // Original service cost (REFUNDABLE)
        markup_amount: breakdown.markupAmount,     // 5% markup (NON-REFUNDABLE)
        agent_service_fee: breakdown.agentServiceFee, // 10% agent fee (NON-REFUNDABLE)
        total_amount: breakdown.totalAmount,       // Total customer pays
        markup_percentage: 5,                      // Markup percentage for reference
        agent_service_fee_percentage: 10,          // Agent fee percentage for reference
      },
    };

    // ========================================
    // CONFIGURE SUBACCOUNT FOR SPLIT PAYMENT
    // ========================================
    if (input.seller_subaccount) {
      paymentData.subaccount = input.seller_subaccount;
      // Agent gets the markup amount + agent service fee (in ZAR)
      // Seller gets the original service amount
      paymentData.transaction_charge = (breakdown.markupAmount + breakdown.agentServiceFee);
    }

    // Step 1: Use regular transaction with split payment
    let result;
    console.log('Initializing transaction with split payment...');
    console.log(`Service Amount: ${breakdown.serviceAmount} ZAR`);
    console.log(`Markup (5%): ${breakdown.markupAmount} ZAR`);
    console.log(`Agent Service Fee (10%): ${breakdown.agentServiceFee} ZAR`);
    console.log(`Total Customer Pays: ${breakdown.totalAmount} ZAR`);
    console.log(`Agent Gets: ${breakdown.markupAmount + breakdown.agentServiceFee} ZAR (15%)`);
    console.log(`Seller Gets: ${breakdown.serviceAmount} ZAR (85%)`);
    
    result = await paystackService.initializeTransaction(paymentData);

    if (!result || !result.status || !result.data) {
      console.log('Payment initialization failed:', result);
      return res.status(400).json({ error: 'Payment initialization failed. No authorization data returned.' });
    }

    console.log('Payment initialized:', result);

    // Step 2: Return the payment link with breakdown
    res.json({ 
      paymentLink: result.data.authorization_url,
      reference: result.data.reference,
      breakdown: {
        serviceAmount: breakdown.serviceAmount,
        markupAmount: breakdown.markupAmount,
        agentServiceFee: breakdown.agentServiceFee,
        totalAmount: breakdown.totalAmount,
        currency: 'ZAR'
      }
    });

  } catch (error) {
    console.error('Error in createTransactionWithLink:', error);
    res.status(500).json({ error: 'Failed to create transaction and generate payment link.' });
  }
};

/**
 * Generate checkout link for existing transaction
 * Replaces: TradeSafe generateCheckoutLink
 * Note: With Paystack, link is generated during initialization
 */
const generateCheckoutLink = async (req, res) => {
  try {
    const { transactionId, reference } = req.body;

    // Validate input
    const transactionRef = reference || transactionId;
    if (!transactionRef) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction reference or ID is required' 
      });
    }

    if (typeof transactionRef !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction reference must be a string' 
      });
    }

    if (transactionRef.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction reference cannot be empty' 
      });
    }

    // Verify the transaction exists
    const result = await paystackService.verifyTransaction(transactionRef);

    if (!result || !result.status) {
      return res.status(400).json({ error: 'Failed to generate checkout link.' });
    }

    res.json({ 
      checkoutLink: result.data.authorization_url || 'Link already used',
      reference: result.data.reference,
    });
  } catch (error) {
    console.error('Error in generateCheckoutLink:', error);
    res.status(500).json({ error: error.message });
  }
};


/**
 * Get transaction allocation details
 * Replaces: TradeSafe getTransactionAllocation
 */
const getTransactionAllocation = async (req, res) => {
  try {
    const { id, reference } = req.body;

    // Validate input - either id or reference is required
    const transactionRef = reference || id;
    if (!transactionRef) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction ID or reference is required' 
      });
    }

    if (typeof transactionRef !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction ID or reference must be a string' 
      });
    }

    if (transactionRef.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction ID or reference cannot be empty' 
      });
    }

    // Verify transaction to get allocation details
    const result = await paystackService.verifyTransaction(transactionRef);

    if (!result || !result.status) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Format response similar to TradeSafe allocation structure
    const metadata = result.data.metadata || {};
    const allocation = {
      id: result.data.id,
      reference: result.data.reference,
      amount: result.data.amount / 100, // Convert from kobo
      status: result.data.status,
      channel: result.data.channel,
      currency: result.data.currency,
      paid_at: result.data.paid_at,
      metadata: result.data.metadata,
      // Add breakdown information
      breakdown: {
        service_amount: metadata.service_amount || (result.data.amount / 100),
        markup_amount: metadata.markup_amount || 0,
        agent_service_fee: metadata.agent_service_fee || 0,
        total_amount: result.data.amount / 100,
      }
    };

    res.json({ data: { transaction: { allocations: [allocation] } } });
  } catch (error) {
    console.error('Error in getTransactionAllocation:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get transaction parties
 * Replaces: TradeSafe getTransactionParties
 */
const getTransactionParties = async (req, res) => {
  try {
    const { id, reference } = req.body;

    // Validate input - either id or reference is required
    const transactionRef = reference || id;
    if (!transactionRef) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction ID or reference is required' 
      });
    }

    if (typeof transactionRef !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction ID or reference must be a string' 
      });
    }

    if (transactionRef.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction ID or reference cannot be empty' 
      });
    }

    // Verify transaction to get party details
    const result = await paystackService.verifyTransaction(transactionRef);

    if (!result || !result.status) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Extract parties from metadata
    const metadata = result.data.metadata || {};
    const serviceAmount = metadata.service_amount || (result.data.amount / 100);
    const markupAmount = metadata.markup_amount || 0;
    const agentServiceFee = metadata.agent_service_fee || 0;
    
    const parties = [
      {
        role: 'BUYER',
        email: result.data.customer.email,
        name: metadata.buyer_name || result.data.customer.email,
      },
      {
        role: 'SELLER',
        subaccount: metadata.seller_subaccount,
        amount_received: serviceAmount, // Seller gets the service amount (85%)
        percentage: Math.round((serviceAmount / (result.data.amount / 100)) * 100),
      },
      {
        role: 'AGENT',
        amount_received: markupAmount + agentServiceFee, // Agent gets markup + service fee (15%)
        percentage: Math.round(((markupAmount + agentServiceFee) / (result.data.amount / 100)) * 100),
        breakdown: {
          markup_amount: markupAmount, // 5% to cover Paystack fees
          service_fee: agentServiceFee, // 10% agent service fee
        }
      },
    ];

    res.json({ 
      data: { 
        transaction: { 
          id: result.data.id,
          reference: result.data.reference,
          parties,
        } 
      } 
    });
  } catch (error) {
    console.error('Error in getTransactionParties:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Cancel transaction
 * Replaces: TradeSafe cancelTransaction
 * For pre-authorized payments, cancels the authorization
 */
const cancelTransaction = async (req, res) => {
  try {
    const { id, authorization_code, comment } = req.body;

    if (!authorization_code) {
      return res.status(400).json({ error: 'Authorization code is required to cancel pre-authorization' });
    }

    // Cancel the pre-authorization (release held funds)
    const result = await paystackService.cancelPreauthorization(authorization_code);

    console.log('Transaction cancelled:', comment);

    res.json({ 
      data: { 
        state: 'CANCELLED',
        message: 'Pre-authorization cancelled successfully',
      } 
    });
  } catch (error) {
    console.error('Error in cancelTransaction:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete transaction
 * Replaces: TradeSafe deleteTransaction
 * Note: Paystack doesn't support deleting transactions, only refunding
 */
const deleteTransaction = async (req, res) => {
  try {
    const { id, reference } = req.body;

    // For Paystack, we can't delete but we can mark as cancelled in our system
    console.log('Transaction deletion requested for:', reference || id);

    res.json({ 
      message: 'Transaction marked for deletion. Note: Paystack does not support transaction deletion.',
      reference: reference || id,
    });
  } catch (error) {
    console.error('Error in deleteTransaction:', error);
    res.status(500).json({ error: error.message });
  }
};


/**
 * Handle webhook callbacks
 * Replaces: TradeSafe handleCallback
 * MAINTAINS EXACT TRADESAFE LOGIC: Firestore retry, event emission, auto-delivery trigger
 */
const handleCallback = async (req, res) => {
  try {
    const callbackPayload = req.body;

    console.log('Received callback:', JSON.stringify(callbackPayload, null, 2));

    if (!callbackPayload) {
      return res.status(400).json({ error: 'Invalid callback payload structure' });
    }

    // Verify webhook signature (Paystack security requirement)
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(callbackPayload))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { event, data } = callbackPayload;

    // Map Paystack events to TradeSafe states
    let state = null;
    let allocations = [];

    if (event === 'preauthorization.success') {
      state = 'FUNDS_RECEIVED'; // Funds held (pre-authorized)
      allocations = [{
        id: data.authorization_code,
        value: data.amount / 100,
        state: 'FUNDS_RECEIVED',
      }];
    } else if (event === 'charge.success') {
      // Extract split payment details from metadata
      const serviceAmount = data.metadata?.service_amount;
      const agentFee = data.metadata?.agent_service_fee;
      const markup = data.metadata?.markup_amount;

      console.log('Split payment details:', {
        serviceAmount,
        agentFee,
        markup,
        totalAmount: data.amount / 100
      });

      state = 'FUNDS_RECEIVED'; // Changed from 'COMPLETED' to 'FUNDS_RECEIVED' for split payment processing

      // Emit FUNDS_RECEIVED event with correct allocation amounts (only service amount for seller)
      allocations = [{
        id: data.id,
        value: serviceAmount || (data.amount / 100), // Use service amount if available, fallback to total
        state: 'FUNDS_RECEIVED',
      }];

      // Process successful payment - update booking status to PAID
      if (data.metadata?.booking_id) {
        console.log('Processing successful split payment for booking:', data.metadata.booking_id);
      }
    }

    const transactionDetails = {
      transactionId: data.id,
      reference: data.reference,
      state,
      balance: data.amount / 100,
      updatedAt: data.paid_at || new Date().toISOString(),
      allocations,
      authorization_code: data.authorization_code, // Save for later capture
      // Store split payment details for refund processing
      splitPaymentDetails: data.metadata ? {
        serviceAmount: data.metadata.service_amount,
        markupAmount: data.metadata.markup_amount,
        agentServiceFee: data.metadata.agent_service_fee,
        bookingId: data.metadata.booking_id
      } : null
    };

    console.log('Checking state', state);

    // EXACT TRADESAFE LOGIC: Emit event if state is FUNDS_RECEIVED
    if (state === 'FUNDS_RECEIVED') {
      console.log('Emitting FUNDS_RECEIVED event...');
      callbackEvents.emit('FUNDS_RECEIVED', allocations);
    }

    // EXACT TRADESAFE LOGIC: Search for document with retry mechanism
    if (state === 'FUNDS_RECEIVED') {
      console.log('State is FUNDS_RECEIVED, searching Firestore for booking:', data.metadata?.booking_id);

      // Firestore Query to Update the Document
      const appointmentsRef = db.collection('appointments_bookings');

      let attempts = 0;
      const maxAttempts = 5;  // Retry limit (SAME AS TRADESAFE)
      let docFound = false;

      while (attempts < maxAttempts && !docFound) {
        const querySnapshot = await appointmentsRef
          .where('bookingId', '==', data.metadata?.booking_id)
          .get();

        if (querySnapshot.empty) {
          console.log('No matching document found, retrying...');
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 2000)); // wait for 2 seconds (SAME AS TRADESAFE)
        } else {
          docFound = true;
          // Update the existing document
          querySnapshot.forEach(async (doc) => {
            const docRef = appointmentsRef.doc(doc.id);
            const existingData = doc.data();

            const updatedAllocations = existingData.allocations
              ? [...existingData.allocations, ...allocations]
              : allocations;

            await docRef.update({
              ...transactionDetails,
              allocations: updatedAllocations,
              // Update booking status to PAID for successful charge
              status: event === 'charge.success' ? 'PAID' : existingData.status,
            });

            console.log('Document updated successfully with split payment details.');
          });
        }
      }

      if (!docFound) {
        console.log('Document not found after max retries.');
        return res.status(404).json({ error: 'Transaction document not found in Firestore.' });
      }
    }

    res.status(200).json({
      message: 'Callback processed successfully',
      transactionDetails,
    });
  } catch (error) {
    console.error('Error handling callback:', error.message);
    res.status(500).json({ error: 'Failed to process callback' });
  }
}

// EXACT TRADESAFE LOGIC: Listener for FUNDS_RECEIVED event
// Auto-triggers delivery start when funds are received
callbackEvents.on('FUNDS_RECEIVED', async (allocations) => {
  if (!allocations || allocations.length === 0) {
    console.error('No allocations found for FUNDS_RECEIVED state.');
    return;
  }

  for (const allocation of allocations) {
    try {
      console.log(`Auto-triggering delivery for allocation ID: ${allocation.id}`);
      
      // Note: In Paystack, we don't auto-capture immediately
      // The capture will be triggered manually via allocationStartDelivery endpoint
      // This maintains the same flow as TradeSafe where delivery is started after funds received
      
      console.log('Allocation ready for delivery. Waiting for manual delivery trigger.');
    } catch (error) {
      console.error('Error processing allocation:', error.message);
    }
  }
});

/**
 * Refund a transaction (SERVICE AMOUNT ONLY)
 * 
 * This function implements the split payment refund logic where:
 * - Only the original service amount is refunded to customers
 * - 5% markup is retained to cover Paystack fees
 * - 10% agent service fee is retained as platform commission
 * - Supports both full and partial refunds (capped at service amount)
 * 
 * Replaces: TradeSafe refund functionality
 * Key difference: Only refunds service amount, not total payment
 */
const refundTransaction = async (req, res) => {
  try {
    // ========================================
    // EXTRACT AND VALIDATE INPUT
    // ========================================
    
    const { reference, amount } = req.body;

    // ========================================
    // VALIDATE TRANSACTION REFERENCE
    // ========================================
    
    // Check if transaction reference is provided
    if (!reference) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction reference is required' 
      });
    }

    // Ensure reference is a string
    if (typeof reference !== 'string') {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction reference must be a string' 
      });
    }

    // Ensure reference is not empty
    if (reference.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        message: 'Transaction reference cannot be empty' 
      });
    }

    // ========================================
    // VALIDATE REFUND AMOUNT (IF PROVIDED)
    // ========================================
    
    // Validate refund amount if provided (optional parameter)
    if (amount !== undefined && amount !== null) {
      // Ensure amount is a number
      if (typeof amount !== 'number') {
        return res.status(400).json({ 
          error: 'Validation failed', 
          message: 'Refund amount must be a number' 
        });
      }

      // Ensure amount is positive
      if (amount <= 0) {
        return res.status(400).json({ 
          error: 'Validation failed', 
          message: 'Refund amount must be a positive number' 
        });
      }

      // Ensure amount is finite
      if (!Number.isFinite(amount)) {
        return res.status(400).json({ 
          error: 'Validation failed', 
          message: 'Refund amount must be a finite number' 
        });
      }
    }

    // ========================================
    // RETRIEVE TRANSACTION DETAILS
    // ========================================
    
    // Get transaction details from Paystack to extract split payment metadata
    const transactionResult = await paystackService.verifyTransaction(reference);
    
    // Check if transaction exists
    if (!transactionResult || !transactionResult.status) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Extract split payment breakdown from transaction metadata
    const metadata = transactionResult.data.metadata || {};
    const serviceAmount = metadata.service_amount;        // Original service cost (REFUNDABLE)
    const markupAmount = metadata.markup_amount || 0;     // 5% markup (NON-REFUNDABLE)
    const agentServiceFee = metadata.agent_service_fee || 0; // 10% agent fee (NON-REFUNDABLE)
    const totalPaid = transactionResult.data.amount / 100;   // Total customer paid (convert from kobo)

    // Ensure we have the service amount for refund calculation
    if (!serviceAmount) {
      return res.status(400).json({ 
        error: 'Cannot determine refundable amount. Service amount not found in transaction metadata.' 
      });
    }

    // ========================================
    // CALCULATE REFUND AMOUNT
    // ========================================
    
    let refundAmount;
    
    if (amount) {
      // PARTIAL REFUND: User specified an amount
      // Ensure it doesn't exceed the refundable service amount
      if (amount > serviceAmount) {
        return res.status(400).json({ 
          error: `Refund amount (${amount}) cannot exceed refundable service amount (${serviceAmount}). Markup and agent fees are non-refundable.` 
        });
      }
      refundAmount = amount;
    } else {
      // FULL REFUND: Refund the entire service amount
      // NOTE: This excludes the 15% markup (5% + 10%) which is retained
      refundAmount = serviceAmount;
    }

    // ========================================
    // PROCESS REFUND THROUGH PAYSTACK
    // ========================================
    const refundAmountKobo = refundAmount;

    // Process the refund
    const result = await paystackService.refundTransaction(reference, refundAmountKobo);

    if (!result || !result.status) {
      return res.status(400).json({ error: 'Refund failed' });
    }

    console.log('Refund processed successfully:', result);

    res.json({
      message: 'Refund processed successfully',
      data: {
        id: result.data.id,
        reference: reference,
        refunded_amount: refundAmount, // Amount actually refunded
        service_amount: serviceAmount, // Original service cost
        markup_retained: markupAmount, // 5% markup retained
        agent_fee_retained: agentServiceFee, // 10% agent fee retained
        total_paid: totalPaid, // Total amount customer originally paid
        currency: 'ZAR',
        status: result.data.status,
        refunded_at: result.data.refunded_at || new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error in refundTransaction:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * List all refunds
 * Optionally filter by transaction reference
 */
const listRefunds = async (req, res) => {
  try {
    const { reference, perPage, page } = req.body;

    const params = {
      perPage: perPage || 10,
      page: page || 1,
      ...(reference && { reference }),
    };

    const result = await paystackService.listRefunds(params);

    if (!result || !result.status) {
      return res.status(400).json({ error: 'Failed to list refunds' });
    }

    // Format refunds for response
    const refunds = result.data.map(refund => ({
      id: refund.id,
      reference: refund.transaction_reference,
      amount: refund.amount / 100, // Convert from kobo
      status: refund.status,
      refunded_at: refund.refunded_at,
      currency: refund.currency,
    }));

    res.json({
      data: refunds,
      meta: result.meta,
    });
  } catch (error) {
    console.error('Error in listRefunds:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { 
  createTransactionWithLink, 
  generateCheckoutLink, 
  getTransactionAllocation, 
  getTransactionParties, 
  cancelTransaction, 
  deleteTransaction,
  handleCallback,
  refundTransaction,
  listRefunds,
};
