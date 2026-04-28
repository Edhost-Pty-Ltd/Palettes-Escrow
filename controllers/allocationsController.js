const paystackService = require('../services/paystack');
const db = require('../config/firebase');

const allocationStartDelivery = async (req, res) => {
  try {
    const { id, authorization_code, booking_id } = req.body;

    if (!authorization_code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const bookingRef = db.collection('appointments_bookings').doc(booking_id);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();
    const amount = bookingData.balance || bookingData.amount;

    const agentAmount = Math.floor(amount * 0.1);
    const sellerAmount = Math.floor(amount * 0.9);

    const chargePayload = {
      authorization_code,
      email: bookingData.email || bookingData.buyerEmail,
      amount: amount * 100,
      ...(bookingData.seller_subaccount && {
        subaccount: bookingData.seller_subaccount,
        transaction_charge: agentAmount * 100,
      }),
    };

    const result = await paystackService.makePaystackRequest('POST', '/transaction/charge_authorization', chargePayload);

    await bookingRef.update({
      status: 'IN_DELIVERY',
      deliveryStartedAt: new Date().toISOString(),
    });

    res.json({
      data: {
        allocationStartDelivery: {
          id: result.data.id || authorization_code,
          state: 'IN_DELIVERY',
        },
      },
    });
  } catch (error) {
    console.error('Error in allocationStartDelivery:', error);
    res.status(500).json({ error: error.message });
  }
};

const allocationAcceptDelivery = async (req, res) => {
  try {
    const { id, booking_id } = req.body;

    if (booking_id) {
      const bookingRef = db.collection('appointments_bookings').doc(booking_id);
      await bookingRef.update({
        status: 'COMPLETED',
        deliveryAcceptedAt: new Date().toISOString(),
      });
    }

    res.json({
      data: {
        allocationAcceptDelivery: {
          id: id,
          state: 'COMPLETED',
        },
      },
    });
  } catch (error) {
    console.error('Error in allocationAcceptDelivery:', error);
    res.status(500).json({ error: error.message });
  }
};

const getAllocationDetails = async (req, res) => {
  try {
    const { id, reference } = req.body;

    const result = await paystackService.verifyTransaction(reference || id);

    if (!result || !result.status) {
      return res.status(404).json({ error: 'Allocation not found' });
    }

    res.json({
      data: {
        allocation: {
          id: result.data.id,
          value: result.data.amount / 100,
          state: result.data.status === 'success' ? 'COMPLETED' : 'PENDING',
          calculation: {
            value: result.data.amount / 100,
            payout: Math.floor((result.data.amount / 100) * 0.8),
            fee: Math.floor((result.data.amount / 100) * 0.2),
            refund: 0,
          },
        },
      },
    });
  } catch (error) {
    console.error('Error in getAllocationDetails:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  allocationStartDelivery,
  allocationAcceptDelivery,
  getAllocationDetails
};
