const express = require('express');
const axios = require('axios');
const db = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');

const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_HEADERS = { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` };

// Helper: parse metadata whether it's a string or object
const parseMetadata = (metadata) => {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try { return JSON.parse(metadata); } catch { return null; }
  }
  return metadata;
};

// ============================================================================
// POST /api/refunds — Initiate a refund (service amount only)
// ============================================================================
router.post('/', async (req, res) => {
  try {
    const { reference, transactionId, amount } = req.body;
    const txRef = reference || transactionId;

    if (!txRef) {
      return res.status(400).json({ message: 'Transaction reference is required' });
    }

    // Step 1: Verify transaction with Paystack
    const verifyResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${txRef}`,
      { headers: PAYSTACK_HEADERS }
    );

    const transaction = verifyResponse.data.data;

    if (transaction.status !== 'success') {
      return res.status(400).json({
        message: `Transaction not eligible for refund. Status: ${transaction.status}`,
      });
    }

    // Step 2: Extract split payment breakdown from metadata
    const metadata = parseMetadata(transaction.metadata);
    const serviceAmount = Number(metadata?.service_amount);
    const markupAmount = Number(metadata?.markup_amount || 0);
    const agentServiceFee = Number(metadata?.agent_service_fee || 0);
    const totalPaid = transaction.amount / 100;

    if (!serviceAmount || serviceAmount <= 0) {
      return res.status(400).json({
        message: 'Cannot determine refundable amount. Service amount not found in transaction metadata.',
      });
    }

    // Step 3: Determine refund amount — capped at service amount
    let refundAmount;
    if (amount !== undefined && amount !== null) {
      if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ message: 'Refund amount must be a positive number' });
      }
      if (amount > serviceAmount) {
        return res.status(400).json({
          message: `Refund amount (${amount}) cannot exceed refundable service amount (${serviceAmount}). Markup and agent fees are non-refundable.`,
        });
      }
      refundAmount = amount;
    } else {
      refundAmount = serviceAmount;
    }

    // Step 4: Submit refund to Paystack (amount in kobo)
    const refundResponse = await axios.post(
      'https://api.paystack.co/refund',
      {
        transaction: transaction.reference,
        amount: Math.round(refundAmount * 100),
      },
      { headers: PAYSTACK_HEADERS }
    );

    const refundData = refundResponse.data.data;

    // Step 5: Record refund in Firestore
    const refundRecord = {
      reference: transaction.reference,
      paystackRefundId: refundData.id,
      firebaseUID: metadata?.firebaseUID || null,
      bookingId: metadata?.booking_id || null,
      escrowId: metadata?.escrow_id || null,
      refundedAmount: refundAmount,
      serviceAmount,
      markupRetained: markupAmount,
      agentFeeRetained: agentServiceFee,
      totalPaid,
      currency: 'ZAR',
      status: refundData.status,
      createdAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('refunds').add(refundRecord);

    // Step 6: Update escrow status if linked
    if (metadata?.escrow_id) {
      try {
        await db.collection('escrowTransactions').doc(metadata.escrow_id).update({
          payoutStatus: 'refunded',
          status: 'refunded',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error('Failed to update escrow on refund:', err.message);
      }
    }

    res.json({
      message: 'Refund initiated successfully',
      data: {
        refundId: docRef.id,
        paystackRefundId: refundData.id,
        reference: transaction.reference,
        refunded_amount: refundAmount,
        service_amount: serviceAmount,
        markup_retained: markupAmount,
        agent_fee_retained: agentServiceFee,
        total_paid: totalPaid,
        currency: 'ZAR',
        status: refundData.status,
      },
    });

  } catch (error) {
    console.error('REFUND ERROR:', error.response?.data || error.message);
    res.status(500).json({
      message: 'Refund failed',
      error: error.response?.data || error.message,
    });
  }
});

// ============================================================================
// GET /api/refunds — Fetch refunds for a user (from Firestore)
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const userUID = req.headers['x-user-id'];

    if (!userUID) {
      return res.status(400).json({ message: 'User ID missing (x-user-id header required)' });
    }

    // Query Firestore refunds collection by firebaseUID, sort in-memory
    const snapshot = await db.collection('refunds')
      .where('firebaseUID', '==', userUID)
      .get();

    const refunds = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    res.json({
      status: true,
      count: refunds.length,
      data: refunds,
    });

  } catch (error) {
    console.error('FETCH REFUNDS ERROR:', error.message);
    res.status(500).json({
      message: 'Failed to fetch refunds',
      error: error.message,
    });
  }
});

module.exports = router;
