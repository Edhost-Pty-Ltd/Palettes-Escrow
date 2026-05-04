const paystackService = require('../services/paystack');
const { updateEscrowTransaction } = require('../models/escrowModel');
const db = require('../config/firebase');

const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        status: 'error',
        message: 'Transaction reference is required',
      });
    }

    const verification = await paystackService.verifyTransaction(reference);

    if (!verification || !verification.status) {
      return res.status(404).json({
        status: 'error',
        message: 'Transaction not found',
      });
    }

    const transactionData = verification.data;

    const metadata = transactionData.metadata || {};
    const splitPaymentDetails = {
      service_amount: Number(metadata.service_amount) || 0,
      markup_amount: Number(metadata.markup_amount) || 0,
      agent_service_fee: Number(metadata.agent_service_fee) || 0,
      total_amount: Number(metadata.total_amount) || transactionData.amount / 100,
    };

    // Handle escrow update if payment is successful
    if (transactionData.status === 'success') {
      console.log('[verifyPayment] Payment successful, checking for escrow_id');
      let escrowId = metadata.escrow_id;
      console.log('[verifyPayment] Escrow ID from metadata:', escrowId);

      // If escrow_id not in metadata, look it up using the reference
      if (!escrowId) {
        console.log('[verifyPayment] Escrow ID not in metadata, looking up using reference:', reference);
        try {
          const refSnapshot = await db.collection('transaction_references')
            .where('reference', '==', reference)
            .limit(1)
            .get();

          console.log('[verifyPayment] Query result - empty:', refSnapshot.empty, 'docs count:', refSnapshot.docs.length);

          if (!refSnapshot.empty) {
            escrowId = refSnapshot.docs[0].data().escrow_id;
            console.log('[verifyPayment] Found escrow_id from reference lookup:', escrowId);
          } else {
            console.log('[verifyPayment] No transaction_references document found for reference:', reference);
          }
        } catch (lookupError) {
          console.error('[verifyPayment] Failed to lookup escrow_id from reference:', lookupError.message);
        }
      }

      // Update escrow if we found an escrow_id
      if (escrowId) {
        console.log('[verifyPayment] Attempting to update escrow with ID:', escrowId);
        try {
          await updateEscrowTransaction(escrowId, {
            paymentStatus: 'paid',
            reference: transactionData.reference,
            paystackTransactionId: transactionData.id,
            status: 'active',
          });
          console.log('[verifyPayment] Escrow updated successfully for ID:', escrowId);
        } catch (escrowError) {
          console.error('[verifyPayment] Failed to update escrow:', escrowError.message);
          console.error('[verifyPayment] Escrow update error details:', escrowError);
        }
      } else {
        console.log('[verifyPayment] No escrow_id found, skipping escrow update');
      }
    }

    res.status(200).json({
      status: transactionData.status === 'success' ? 'success' : 'failed',
      transactionId: transactionData.id,
      amount: transactionData.amount / 100,
      reference: transactionData.reference,
      paymentStatus: transactionData.status === 'success' ? 'completed' : 'failed',
      split_payment: splitPaymentDetails,
      customer: {
        email: transactionData.customer.email,
        customer_code: transactionData.customer.customer_code,
      },
      formatted_amounts: {
        service: `R${splitPaymentDetails.service_amount.toFixed(2)}`,
        markup: `R${splitPaymentDetails.markup_amount.toFixed(2)}`,
        agent_fee: `R${splitPaymentDetails.agent_service_fee.toFixed(2)}`,
        total: `R${splitPaymentDetails.total_amount.toFixed(2)}`,
      },
      paid_at: transactionData.paid_at,
      created_at: transactionData.created_at,
    });
  } catch (error) {
    console.error('[verifyPayment] Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Payment verification failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

module.exports = { verifyPayment };
