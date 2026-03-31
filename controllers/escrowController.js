const { createEscrowTransaction, getEscrowTransaction } = require("../models/escrowModel");

const createEscrow = async (req, res) => {
  try {
    const { vendorId, amount, type } = req.body;
    const customerId = req.user.uid;

    const escrow = await createEscrowTransaction({ customerId, vendorId, amount, type });

    res.status(200).json({ success: true, escrowId: escrow.id });
  } catch (error) {
    console.error("Escrow creation error:", error);
    res.status(500).json({ error: error.message });
  }
};

const getEscrow = async (req, res) => {
  try {
    const escrow = await getEscrowTransaction(req.params.id);
    res.status(200).json({ success: true, data: { ...escrow, currency: (escrow.currency || 'zar').toUpperCase() } });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

module.exports = { createEscrow, getEscrow };
