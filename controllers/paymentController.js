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

    if (transactionData.status === 'success') {
      let escrowId = metadata.escrow_id;

      if (!escrowId) {
        try {
          const refSnapshot = await db.collection('transaction_references')
            .where('reference', '==', reference)
            .limit(1)
            .get();

          if (!refSnapshot.empty) {
            escrowId = refSnapshot.docs[0].data().escrow_id;
          }
        } catch (lookupError) {
          console.error('[verifyPayment] Failed to lookup escrow_id from reference:', lookupError.message);
        }
      }

      if (escrowId) {
        try {
          await updateEscrowTransaction(escrowId, {
            paymentStatus: 'paid',
            reference: transactionData.reference,
            paystackTransactionId: transactionData.id,
            status: 'active',
          });
        } catch (escrowError) {
          console.error('[verifyPayment] Failed to update escrow:', escrowError.message);
        }
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
