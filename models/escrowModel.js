const db = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");

const createEscrowTransaction = async ({ customerId, professionalVendorId, amount, type, metadata = {} }) => {
  try {
    const transactionReference = `ESC-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const escrowData = {
      transactionReference,
      customerId,
      professionalVendorId,
      type,
      amount,
      currency: "zar",
      reference: null,
      status: "pending",
      paymentStatus: "unpaid",
      payoutStatus: "not_paid",
      metadata,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("escrowTransactions").add(escrowData);

    return { id: docRef.id, ...escrowData };
  } catch (error) {
    console.error("Error creating escrow:", error);
    throw error;
  }
};

const getEscrowTransaction = async (escrowId) => {
  const doc = await db.collection("escrowTransactions").doc(escrowId).get();
  if (!doc.exists) throw new Error("Escrow not found");
  return { id: doc.id, ...doc.data() };
};

const updateEscrowTransaction = async (escrowId, updates) => {
  const ref = db.collection("escrowTransactions").doc(escrowId);
  await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  const updated = await ref.get();
  return { id: updated.id, ...updated.data() };
};

module.exports = { createEscrowTransaction, getEscrowTransaction, updateEscrowTransaction };
