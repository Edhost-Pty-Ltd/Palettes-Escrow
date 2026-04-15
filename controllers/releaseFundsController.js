const db = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { createTransferRecipient, initiateTransfer } = require('../services/paystack');

const PLATFORM_PERCENTAGE = 0.20; // platform keeps 20%, vendor gets 80%

/**
 * POST /api/escrow/:id/complete
 *
 * Called by the professional when the service is done.
 * Resolves the vendor's transfer recipient (creating it if needed),
 * then initiates a Paystack transfer for 80% of the escrow amount.
 */
const releaseFunds = async (req, res) => {
  const { id: escrowId } = req.params;
  const professionalUid = req.user?.uid;

  try {
    // ── 1. Load and validate escrow ──────────────────────────────────────────
    const escrowRef = db.collection('escrowTransactions').doc(escrowId);
    const escrowSnap = await escrowRef.get();

    if (!escrowSnap.exists) {
      return res.status(404).json({ message: 'Escrow not found' });
    }

    const escrow = escrowSnap.data();

    // escrow.professionalVendorId is the vendor's Firebase Auth UID (Firestore doc ID)
    if (escrow.professionalVendorId !== professionalUid) {
      return res.status(403).json({ message: 'Only the assigned professional can complete this escrow' });
    }

    if (escrow.status !== 'active') {
      return res.status(400).json({ message: `Escrow is not active. Current status: ${escrow.status}` });
    }

    if (escrow.paymentStatus !== 'paid') {
      return res.status(400).json({ message: 'Payment has not been received yet' });
    }

    if (escrow.payoutStatus !== 'not_paid') {
      return res.status(400).json({ message: `Funds already released. Payout status: ${escrow.payoutStatus}` });
    }

    // ── 2. Load vendor's user doc by Firebase Auth UID (doc ID) ──────────────
    const vendorSnap = await db.collection('users').doc(escrow.professionalVendorId).get();

    if (!vendorSnap.exists) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const vendorData = vendorSnap.data();
    const { accountDetails } = vendorData;

    if (!accountDetails?.accountNumber || !accountDetails?.branchNumber) {
      return res.status(400).json({ message: 'Vendor has incomplete banking details' });
    }

    // ── 3. Resolve transfer recipient (create once, reuse forever) ────────────
    let recipientCode = vendorData.paystack_recipient_code;

    if (!recipientCode) {
      console.log(`[releaseFunds] No recipient code for vendor ${escrow.professionalVendorId}, creating...`);

      // Prefer paystackBankCode (correct Paystack bank identifier) over branchNumber
      const bankCode = accountDetails.paystackBankCode || accountDetails.branchNumber;
      if (!accountDetails.paystackBankCode) {
        console.warn(`[releaseFunds] paystackBankCode not set for vendor ${escrow.professionalVendorId} — falling back to branchNumber. This may cause transfer failures. Vendor should set paystackBankCode via GET /api/payments/banks.`);
      }

      const recipientResult = await createTransferRecipient({
        name: accountDetails.accountHolder || vendorData.displayName || escrow.professionalVendorId,
        account_number: accountDetails.accountNumber,
        bank_code: bankCode,
        currency: 'ZAR',
      });

      if (!recipientResult?.data?.recipient_code) {
        throw new Error('Failed to create transfer recipient: ' + (recipientResult?.message || 'no recipient_code returned'));
      }

      recipientCode = recipientResult.data.recipient_code;
      console.log(`[releaseFunds] Recipient created: ${recipientCode}`);

      // Persist so we never create it twice
      await vendorSnap.ref.update({ paystack_recipient_code: recipientCode });
    }

    // ── 4. Calculate vendor payout (80%) ──────────────────────────────────────
    const vendorAmount = Math.round(escrow.amount * (1 - PLATFORM_PERCENTAGE) * 100) / 100;
    console.log(`[releaseFunds] Escrow amount: ${escrow.amount} ZAR | Vendor payout: ${vendorAmount} ZAR`);

    // ── 5. Initiate Paystack transfer ─────────────────────────────────────────
    const transferResult = await initiateTransfer({
      amount: vendorAmount,
      recipient: recipientCode,
      reason: `Escrow payout for escrow ${escrowId}`,
    });

    if (!transferResult?.data?.transfer_code) {
      throw new Error('Transfer initiation failed: ' + (transferResult?.message || 'no transfer_code returned'));
    }

    const transferCode = transferResult.data.transfer_code;
    console.log(`[releaseFunds] Transfer initiated: ${transferCode}`);

    // ── 6. Update escrow ──────────────────────────────────────────────────────
    await escrowRef.update({
      status: 'completed',
      payoutStatus: 'released',
      transferCode,
      vendorPayout: vendorAmount,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      message: 'Service marked complete. Funds are being transferred to the professional.',
      data: {
        escrowId,
        transferCode,
        vendorPayout: vendorAmount,
        currency: 'ZAR',
        status: transferResult.data.status,
      },
    });

  } catch (error) {
    console.error('[releaseFunds] Error:', error.message);
    res.status(500).json({ message: 'Failed to release funds', error: error.message });
  }
};

module.exports = { releaseFunds };
