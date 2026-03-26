const express = require('express');
const axios = require('axios');

const router = express.Router();

// POST - Initiate a refund
router.post('/', async (req, res) => {
  try {
    const { reference, transactionId } = req.body;
    const txRef = reference || transactionId;

    console.log("=== REFUND REQUEST ===");
    console.log("REFERENCE RECEIVED:", txRef);

    if (!txRef) {
      return res.status(400).json({
        message: "Transaction reference is required",
      });
    }

    // STEP 1: Verify transaction first
    const verifyResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${txRef}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const transaction = verifyResponse.data.data;

    console.log("VERIFY STATUS:", transaction.status);
    console.log("VERIFY FULL TRANSACTION:", JSON.stringify(transaction, null, 2));

    if (transaction.status !== 'success') {
      return res.status(400).json({
        message: `Transaction not successful, cannot refund. Status: ${transaction.status}`,
      });
    }

    // STEP 2: Initiate refund using transaction ID from verified transaction
    const refundResponse = await axios.post(
      'https://api.paystack.co/refund',
      { transaction: transaction.id },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    console.log("REFUND RESPONSE:", refundResponse.data);

    res.json({
      message: "Refund initiated successfully",
      data: refundResponse.data,
    });

  } catch (error) {
    console.error("REFUND ERROR:", error.response?.data || error.message);

    res.status(500).json({
      message: "Refund failed",
      error: error.response?.data,
    });
  }
});
//This is for when paystack returns a string
const parseMetadata = (metadata) => {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch (error) {
      console.log("Metadata parse error:", error);
      return null;
    }
  }
  return metadata;
};

// GET - Fetch refunds for the current user
router.get('/', async (req, res) => {
  try {
    console.log("=== FETCH FILTERED REFINED ===");
    const userUID = req.headers['x-user-id'];

    console.log("CURRENT USER UID:", userUID);

    if (!userUID) {
      return res.status(400).json({
        message: "User ID missing",
      });
    }

    const response = await axios.get(
      'https://api.paystack.co/refund',
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const refunds = response.data.data;

    // The list endpoint returns minimal transaction data — fetch full transaction
    // for each refund to get metadata with firebaseUID and booking_id.
    const filteredRefunds = [];

    for (const refund of refunds) {
      // Paystack refund list returns transaction as object or id — handle both
      const txRef = refund.transaction?.reference || refund.transaction_reference;
      const txId = refund.transaction?.id || refund.transaction;

      let metadata = parseMetadata(refund.transaction?.metadata);

      // Always fetch full transaction if metadata is missing or firebaseUID is empty
      const needsFullFetch = !metadata || !metadata.firebaseUID || !metadata.booking_id;
      if (needsFullFetch && (txRef || txId)) {
        try {
          // Prefer reference-based verify, fall back to id-based lookup
          const fetchUrl = txRef
            ? `https://api.paystack.co/transaction/verify/${txRef}`
            : `https://api.paystack.co/transaction/${txId}`;

          const txResponse = await axios.get(fetchUrl, {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          });
          const fullTx = txResponse.data?.data;
          metadata = parseMetadata(fullTx?.metadata);
          console.log("FETCHED FULL TX METADATA:", metadata);
        } catch (err) {
          console.log("Could not fetch transaction for ref:", txRef, "id:", txId, err.message);
        }
      }

      const refundUID = metadata?.firebaseUID;
      // booking_id format: "booking_<timestamp>_<uid>"
      const bookingId = metadata?.booking_id || '';
      const bookingUID = bookingId.split('_').pop();

      console.log("REFUND UID:", refundUID, "BOOKING UID:", bookingUID);

      if (refundUID === userUID || bookingUID === userUID) {
        // Attach parsed metadata and human-readable amount to the refund object
        filteredRefunds.push({
          ...refund,
          amount_zar: (refund.amount / 100).toFixed(2),
          metadata,
        });
      }
    }

    res.json({
      status: true,
      count: filteredRefunds.length,
      data: filteredRefunds,
    });

  } catch (error) {
    console.error("FETCH REFUNDS ERROR:", error.response?.data || error.message);

    res.status(500).json({
      message: "Failed to fetch refunds",
      error: error.response?.data,
    });
  }
});

module.exports = router;
