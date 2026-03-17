const paystackService = require('../services/paystack');
const db = require('../firebase');

/**
 * Start allocation delivery
 * Replaces: TradeSafe allocationStartDelivery
 * Captures the pre-authorized funds (charges the customer)
 */
const allocationStartDelivery = async (req, res) => {
  try {
    const { id, authorization_code, booking_id } = req.body;

    if (!authorization_code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    // Get booking details to calculate split
    const bookingRef = db.collection('appointments_bookings').doc(booking_id);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();
    const amount = bookingData.balance || bookingData.amount;
    
    // Calculate agent commission (10% same as TradeSafe)
    const agentAmount = Math.floor(amount * 0.1);
    const sellerAmount = Math.floor(amount * 0.9);

    // Capture the pre-authorization with split
    const splitConfig = bookingData.seller_subaccount ? {
      subaccount: bookingData.seller_subaccount,
      transaction_charge: agentAmount * 100, // Convert to kobo
    } : {};

    const result = await paystackService.capturePreauthorization(
      authorization_code,
      amount * 100, // Convert to kobo
      splitConfig
    );

    console.log('Allocation delivery started successfully:', result);

    // Update booking status
    await bookingRef.update({
      status: 'IN_DELIVERY',
      deliveryStartedAt: new Date().toISOString(),
    });

    // Format response similar to TradeSafe
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

/**
 * Accept allocation delivery
 * Replaces: TradeSafe allocationAcceptDelivery
 * Marks delivery as accepted (funds already captured in startDelivery)
 */
const allocationAcceptDelivery = async (req, res) => {
  try {
    const { id, booking_id } = req.body;

    // Update booking status to completed
    if (booking_id) {
      const bookingRef = db.collection('appointments_bookings').doc(booking_id);
      await bookingRef.update({
        status: 'COMPLETED',
        deliveryAcceptedAt: new Date().toISOString(),
      });
    }

    console.log('Allocation delivery accepted successfully');

    // Format response similar to TradeSafe
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

/**
 * Get allocation details
 * Replaces: TradeSafe getAllocationDetails
 */
const getAllocationDetails = async (req, res) => {
  try {
    const { id, reference } = req.body;

    // Verify transaction to get allocation details
    const result = await paystackService.verifyTransaction(reference || id);

    if (!result || !result.status) {
      return res.status(404).json({ error: 'Allocation not found' });
    }

    // Format response similar to TradeSafe
    res.json({
      data: {
        allocation: {
          id: result.data.id,
          value: result.data.amount / 100,
          state: result.data.status === 'success' ? 'COMPLETED' : 'PENDING',
          calculation: {
            value: result.data.amount / 100,
            payout: Math.floor((result.data.amount / 100) * 0.9), // 90% to seller
            fee: Math.floor((result.data.amount / 100) * 0.1), // 10% agent fee
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
