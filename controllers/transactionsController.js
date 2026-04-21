const callbackEvents = require('../events');
const paystackService = require('../services/paystack');
const db = require('../config/firebase');
const crypto = require('crypto');
const { updateEscrowTransaction, getEscrowTransaction } = require('../models/escrowModel');

const createTransactionWithLink = async (req, res) => {
  try {
    const { input } = req.body;
    const userId = req.user?.uid;

    if (!input) {
      return res.status(400).json({ error: 'Validation failed', message: 'Payment input data is required' });
    }

    if (!input.amount) {
      return res.status(400).json({ error: 'Validation failed', message: 'Service amount is required' });
    }
    if (typeof input.amount !== 'number') {
      return res.status(400).json({ error: 'Validation failed', message: 'Service amount must be a number' });
    }
    if (input.amount <= 0) {
      return res.status(400).json({ error: 'Validation failed', message: 'Service amount must be a positive number' });
    }
    if (!Number.isFinite(input.amount)) {
      return res.status(400).json({ error: 'Validation failed', message: 'Service amount must be a finite number' });
    }

    const buyerEmail = input.buyer?.email || input.email;
    if (!buyerEmail) {
      return res.status(400).json({ error: 'Validation failed', message: 'Buyer email is required' });
    }
    if (typeof buyerEmail !== 'string') {
      return res.status(400).json({ error: 'Validation failed', message: 'Buyer email must be a string' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(buyerEmail)) {
      return res.status(400).json({ error: 'Validation failed', message: 'Buyer email must be a valid email address' });
    }

    if (input.seller_subaccount && typeof input.seller_subaccount !== 'string') {
      return res.status(400).json({ error: 'Validation failed', message: 'Seller subaccount must be a string' });
    }
    if (input.booking_id && typeof input.booking_id !== 'string') {
      return res.status(400).json({ error: 'Validation failed', message: 'Booking ID must be a string' });
    }
    if (input.title && typeof input.title !== 'string') {
      return res.status(400).json({ error: 'Validation failed', message: 'Title must be a string' });
    }
    if (input.description && typeof input.description !== 'string') {
      return res.status(400).json({ error: 'Validation failed', message: 'Description must be a string' });
    }
    if (input.buyer) {
      if (input.buyer.givenName && typeof input.buyer.givenName !== 'string') {
        return res.status(400).json({ error: 'Validation failed', message: 'Buyer given name must be a string' });
      }
      if (input.buyer.familyName && typeof input.buyer.familyName !== 'string') {
        return res.status(400).json({ error: 'Validation failed', message: 'Buyer family name must be a string' });
      }
    }

    const paymentData = {
      email: buyerEmail,
      amount: input.amount,
      currency: 'ZAR',
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
      metadata: {
        title: input.title,
        description: input.description,
        seller_subaccount: input.seller_subaccount,
        booking_id: input.booking_id,
        escrow_id: input.escrow_id || null,
        buyer_email: buyerEmail,
        buyer_name: `${input.buyer?.givenName || ''} ${input.buyer?.familyName || ''}`.trim(),
        firebaseUID: userId || '',
        service_amount: input.amount,
      },
    };

    let sellerSubaccount = input.seller_subaccount;

    if (!sellerSubaccount && input.escrow_id) {
      console.log(`No seller_subaccount provided, resolving from escrow: ${input.escrow_id}`);
      const escrow = await getEscrowTransaction(input.escrow_id);
      sellerSubaccount = escrow?.metadata?.subaccountCode;
      console.log(`Resolved subaccountCode from escrow: ${sellerSubaccount}`);
    }

    if (sellerSubaccount) {
      paymentData.subaccount = sellerSubaccount;
      paymentData.metadata.seller_subaccount = sellerSubaccount;
    } else {
      console.warn('No seller subaccount found — transaction will not be split');
    }

    console.log('Initializing transaction...');
    console.log(`Service Amount: ${input.amount} ZAR`);

    const result = await paystackService.initializeTransaction(paymentData);

    if (!result || !result.status || !result.data) {
      console.log('Payment initialization failed:', result);
      return res.status(400).json({ error: 'Payment initialization failed. No authorization data returned.' });
    }

    console.log('Payment initialized:', result);

    res.json({
      paymentLink: result.data.authorization_url,
      reference: result.data.reference,
      amount: input.amount,
      currency: 'ZAR',
    });

  } catch (error) {
    console.error('Error in createTransactionWithLink:', error);
    res.status(500).json({ error: 'Failed to create transaction and generate payment link.' });
  }
};

const handleCallback = async (req, res) => {
  try {
    const callbackPayload = req.body;

    console.log('Received callback:', JSON.stringify(callbackPayload, null, 2));

    if (!callbackPayload) {
      return res.status(400).json({ error: 'Invalid callback payload structure' });
    }

    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(callbackPayload))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { event, data } = callbackPayload;

    let state = null;
    let allocations = [];

    if (event === 'preauthorization.success') {
      state = 'FUNDS_RECEIVED';
      allocations = [{
        id: data.authorization_code,
        value: data.amount / 100,
        state: 'FUNDS_RECEIVED',
      }];
    } else if (event === 'charge.success') {
      const serviceAmount = data.metadata?.service_amount;

      state = 'FUNDS_RECEIVED';

      allocations = [{
        id: data.id,
        value: serviceAmount || (data.amount / 100),
        state: 'FUNDS_RECEIVED',
      }];
    }

    const transactionDetails = {
      reference: data.reference,
      transactionId: data.id,
      state,
      balance: data.amount / 100,
      updatedAt: data.paid_at || new Date().toISOString(),
      allocations,
      authorization_code: data.authorization_code,
      splitPaymentDetails: data.metadata ? {
        serviceAmount: data.metadata.service_amount,
        markupAmount: data.metadata.markup_amount,
        agentServiceFee: data.metadata.agent_service_fee,
        bookingId: data.metadata.booking_id
      } : null
    };

    console.log('Checking state', state);

    if (state === 'FUNDS_RECEIVED') {
      console.log('Emitting FUNDS_RECEIVED event...');
      callbackEvents.emit('FUNDS_RECEIVED', allocations);

      console.log('State is FUNDS_RECEIVED, searching Firestore for booking:', data.metadata?.booking_id);

      const appointmentsRef = db.collection('appointments_bookings');

      let attempts = 0;
      const maxAttempts = 5;
      let docFound = false;

      while (attempts < maxAttempts && !docFound) {
        const querySnapshot = await appointmentsRef
          .where('bookingId', '==', data.metadata?.booking_id)
          .get();

        if (querySnapshot.empty) {
          console.log('No matching document found, retrying...');
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          docFound = true;
          querySnapshot.forEach(async (doc) => {
            const docRef = appointmentsRef.doc(doc.id);
            const existingData = doc.data();

            const updatedAllocations = existingData.allocations
              ? [...existingData.allocations, ...allocations]
              : allocations;

            await docRef.update({
              ...transactionDetails,
              allocations: updatedAllocations,
              status: event === 'charge.success' ? 'PAID' : existingData.status,
            });

            console.log('Document updated successfully with split payment details.');
          });
        }
      }

      if (!docFound) {
        console.error('[handleCallback] Booking not found after max retries for booking_id:', data.metadata?.booking_id);
        try {
          await db.collection('webhook_failures').add({
            event,
            data,
            reason: 'booking_not_found',
            booking_id: data.metadata?.booking_id || null,
            reference: data.reference || null,
            failedAt: new Date().toISOString(),
          });
        } catch (dlErr) {
          console.error('[handleCallback] Failed to write to webhook_failures:', dlErr.message);
        }
      }
    }

    if (event === 'refund.processed' || event === 'refund.failed') {
      try {
        const refundStatus = event === 'refund.processed' ? 'processed' : 'failed';
        const refundRef = data.transaction_reference || data.reference;

        const refundSnap = await db.collection('refunds')
          .where('reference', '==', refundRef)
          .limit(1)
          .get();

        if (!refundSnap.empty) {
          await refundSnap.docs[0].ref.update({
            status: refundStatus,
            updatedAt: new Date().toISOString(),
          });
          console.log(`Refund record updated to '${refundStatus}' for reference: ${refundRef}`);
        } else {
          console.warn('No refund record found in Firestore for reference:', refundRef);
        }
      } catch (refundUpdateError) {
        console.error('Failed to update refund status:', refundUpdateError.message);
      }
    }

    if (event === 'charge.success' && data.metadata?.escrow_id) {
      try {
        await updateEscrowTransaction(data.metadata.escrow_id, {
          paymentStatus: 'paid',
          reference: data.reference,
          paystackTransactionId: data.id,
          status: 'active',
        });
        console.log('Escrow updated for ID:', data.metadata.escrow_id);
      } catch (escrowError) {
        console.error('Failed to update escrow:', escrowError.message);
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

const refundTransaction = async (req, res) => {
  try {
    const { reference, amount } = req.body;

    if (!reference) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Transaction reference is required'
      });
    }

    if (typeof reference !== 'string') {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Transaction reference must be a string'
      });
    }

    if (reference.trim().length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Transaction reference cannot be empty'
      });
    }

    if (amount !== undefined && amount !== null) {
      if (typeof amount !== 'number') {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Refund amount must be a number'
        });
      }

      if (amount <= 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Refund amount must be a positive number'
        });
      }

      if (!Number.isFinite(amount)) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Refund amount must be a finite number'
        });
      }
    }

    const transactionResult = await paystackService.verifyTransaction(reference);

    if (!transactionResult || !transactionResult.status) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const metadata = transactionResult.data.metadata || {};
    const serviceAmount = metadata.service_amount;
    const markupAmount = metadata.markup_amount || 0;
    const agentServiceFee = metadata.agent_service_fee || 0;
    const totalPaid = transactionResult.data.amount / 100;

    if (!serviceAmount) {
      return res.status(400).json({
        error: 'Cannot determine refundable amount. Service amount not found in transaction metadata.'
      });
    }

    let refundAmount;

    if (amount) {
      if (amount > serviceAmount) {
        return res.status(400).json({
          error: `Refund amount (${amount}) cannot exceed refundable service amount (${serviceAmount}). Markup and agent fees are non-refundable.`
        });
      }
      refundAmount = amount;
    } else {
      refundAmount = serviceAmount;
    }

    const result = await paystackService.refundTransaction(reference, refundAmount);

    if (!result || !result.status) {
      return res.status(400).json({ error: 'Refund failed' });
    }

    console.log('Refund processed successfully:', result);

    res.json({
      message: 'Refund processed successfully',
      data: {
        id: result.data.id,
        reference: reference,
        refunded_amount: refundAmount,
        service_amount: serviceAmount,
        markup_retained: markupAmount,
        agent_fee_retained: agentServiceFee,
        total_paid: totalPaid,
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

    const refunds = result.data.map(refund => ({
      id: refund.id,
      reference: refund.transaction_reference,
      amount: refund.amount / 100,
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
  handleCallback,
  refundTransaction,
  listRefunds,
};
