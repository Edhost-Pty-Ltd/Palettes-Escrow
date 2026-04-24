const { createEscrowTransaction, getEscrowTransaction, updateEscrowTransaction } = require("../models/escrowModel");
const { getVendorSubaccount } = require("../services/firebaseService");

const createEscrow = async (req, res) => {
  try {
    const { vendorId: docId, amount, type, metadata } = req.body;
    const customerId = req.user.uid;

    const { subaccountCode, professionalVendorID, userID } = await getVendorSubaccount(docId);

    const escrow = await createEscrowTransaction({
      customerId,
      professionalVendorId: userID,
      amount,
      type,
      metadata: { ...metadata, subaccountCode, professionalVendorID, userID },
    });

    res.status(200).json({ success: true, escrowId: escrow.id, subaccountCode });
  } catch (error) {
    console.error("Escrow creation error:", error);
    res.status(500).json({ error: error.message });
  }
};

const getEscrow = async (req, res) => {
  try {
    const escrow = await getEscrowTransaction(req.params.id);
    res.status(200).json({ success: true, data: { ...escrow, currency: (escrow.currency || "zar").toUpperCase() } });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

const updateEscrow = async (req, res) => {
  try {
    const escrow = await updateEscrowTransaction(req.params.id, req.body);
    res.status(200).json({ success: true, data: escrow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { createEscrow, getEscrow, updateEscrow };
