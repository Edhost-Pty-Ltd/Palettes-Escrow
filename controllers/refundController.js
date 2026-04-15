const db = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const paystackService = require('../services/paystack');

// Helper: parse metadata whether it's a string or object
const parseMetadata = (metadata) => {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try { return JSON.parse(metadata); } catch { return null; }
  }
  return metadata;
};

// ============================================================================
// POST — Initiate a refund (service amount only)
// ============================================================================
const initiateRefund = async (req, res) => {
  try {
    const { reference, transactionId, amount } = req.body;
    const txRef = reference || transactionId;

    if (!txRef) {
      return res.status(400).json({ message: 'Transaction reference is required' });
    }

    // Step 1: Guard against duplicate refunds
    const existingRefund = await db.collection('refunds')
      .where('reference', '==', txRef)
      .limit(1)
      .get();

    if (!existingRefund.empty) {
      return res.status(409).json({ message: `A refund for reference ${txRef} has already been processed` });
    }

    // Step 2: Verify transaction via shared paystack service
    const verifyResult = await paystackService.verifyTransaction(txRef);
    const transaction = verifyResult?.data;

    if (!transaction || transaction.status !== 'success') {
      return res.status(400).json({
        message: `Transaction not eligible for refund. Status: ${transaction?.status || 'unknown'}`,
      });
    }

    // Step 3: Extract refundable amount from metadata
    // With the subaccount model, Paystack handles the platform split automatically.
    // Only service_amount is stored — markup/fee fields are not applicable here.
    const metadata = parseMetadata(transaction.metadata);
    const totalPaid = transaction.amount / 100;

    // Fall back to totalPaid if service_amount is missing or zero (e.g. older transactions)
    const rawServiceAmount = Number(metadata?.service_amount);
    const serviceAmount = (rawServiceAmount && rawServiceAmount > 0) ? rawServiceAmount : totalPaid;

    if (!serviceAmount || serviceAmount <= 0) {
      return res.status(400).json({
        message: 'Cannot determine refundable amount. service_amount not found in transaction metadata.',
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

    // Step 4: Submit refund to Paystack via shared service (handles kobo conversion)
    const refundResult = await paystackService.refundTransaction(transaction.reference, refundAmount);
    const refundData = refundResult?.data;

    if (!refundData) {
      return res.status(500).json({ message: 'Refund failed — no response from Paystack' });
    }

    // Step 5: Record refund in Firestore
    const refundRecord = {
      reference: transaction.reference,
      paystackRefundId: refundData.id,
      firebaseUID: req.user?.uid || metadata?.firebaseUID || null,
      bookingId: metadata?.booking_id || null,
      escrowId: metadata?.escrow_id || null,
      refundedAmount: refundAmount,
      serviceAmount,
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
};

// ============================================================================
// GET — Fetch refunds for the authenticated user (from Firestore)
// ============================================================================
const getUserRefunds = async (req, res) => {
  try {
    const userUID = req.user?.uid;

    if (!userUID) {
      return res.status(400).json({ message: 'User ID missing from token' });
    }

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
};

module.exports = { initiateRefund, getUserRefunds };
