const db = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');
const { createTransferRecipient, initiateTransfer } = require('../services/paystack');

const PLATFORM_PERCENTAGE = 0.20;

const validateEscrowForApproval = async (escrowId) => {
  const escrowRef = db.collection('escrowTransactions').doc(escrowId);
  const escrowSnap = await escrowRef.get();

  if (!escrowSnap.exists) {
    return { valid: false, error: { status: 404, message: 'Escrow not found' } };
  }

  const escrow = escrowSnap.data();

  if (escrow.status !== 'active') {
    return { valid: false, error: { status: 400, message: `Escrow is not active. Current status: ${escrow.status}` } };
  }

  if (escrow.paymentStatus !== 'paid') {
    return { valid: false, error: { status: 400, message: 'Payment has not been received yet' } };
  }

  return { valid: true, escrowRef, escrow };
};

const toggleReleaseApproval = async (req, res) => {
  const { id: escrowId } = req.params;
  const userId = req.user?.uid;

  try {
    const validation = await validateEscrowForApproval(escrowId);
    if (!validation.valid) {
      const { status, message } = validation.error;
      return res.status(status).json({ message });
    }

    const { escrowRef, escrow } = validation;

    const isConsumer = escrow.customerId === userId;
    const isProfessional = escrow.professionalVendorId === userId;

    if (!isConsumer && !isProfessional) {
      return res.status(403).json({ message: 'You are not authorized to approve this escrow' });
    }

    const updateData = isConsumer
      ? { consumerApprovedRelease: true }
      : { professionalApprovedRelease: true };

    await escrowRef.update({
      ...updateData,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const updatedSnap = await escrowRef.get();
    const updatedEscrow = updatedSnap.data();

    res.json({
      success: true,
      message: `${isConsumer ? 'Consumer' : 'Professional'} approved release of funds`,
      data: {
        escrowId,
        consumerApprovedRelease: updatedEscrow.consumerApprovedRelease,
        professionalApprovedRelease: updatedEscrow.professionalApprovedRelease,
        bothApproved: updatedEscrow.consumerApprovedRelease && updatedEscrow.professionalApprovedRelease,
      },
    });
  } catch (error) {
    console.error('[toggleReleaseApproval] Error:', error.message);
    res.status(500).json({ message: 'Failed to toggle release approval', error: error.message });
  }
};

  const releaseFunds = async (req, res) => {
  const { id: escrowId } = req.params;
  const professionalUid = req.user?.uid;

  try {
    const validation = await validateEscrowForApproval(escrowId);
    if (!validation.valid) {
      const { status, message } = validation.error;
      return res.status(status).json({ message });
    }

    const { escrowRef, escrow } = validation;

    if (escrow.professionalVendorId !== professionalUid) {
      return res.status(403).json({ message: 'Only the assigned professional can complete this escrow' });
    }

    if (escrow.payoutStatus !== 'not_paid') {
      return res.status(400).json({ message: `Funds already released. Payout status: ${escrow.payoutStatus}` });
    }

    if (!escrow.consumerApprovedRelease || !escrow.professionalApprovedRelease) {
      return res.status(400).json({
        message: 'Both consumer and professional must approve the release of funds',
        data: {
          consumerApprovedRelease: escrow.consumerApprovedRelease || false,
          professionalApprovedRelease: escrow.professionalApprovedRelease || false,
        },
      });
    }

    const bookingId = escrow.metadata?.booking_id;
    if (!bookingId) {
      return res.status(400).json({ message: 'No booking ID found in escrow metadata' });
    }

    const bookingSnap = await db.collection('appointments_bookings')
      .where('id', '==', bookingId)
      .limit(1)
      .get();

    if (bookingSnap.empty) {
      return res.status(404).json({ message: `Booking not found for bookingId: ${bookingId}` });
    }

    const bookingData = bookingSnap.docs[0].data();
    const paymentReference = bookingData.reference;

    if (!paymentReference) {
      return res.status(400).json({ message: 'No payment reference found in booking. Payment may not be completed yet.' });
    }

    const vendorSnap = await db.collection('users').doc(escrow.professionalVendorId).get();

    if (!vendorSnap.exists) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const vendorData = vendorSnap.data();
    const { accountDetails } = vendorData;

    if (!accountDetails?.accountNumber || !accountDetails?.branchNumber) {
      return res.status(400).json({ message: 'Vendor has incomplete banking details' });
    }

    let recipientCode = vendorData.paystack_recipient_code;

    if (!recipientCode) {
      const bankCode = accountDetails.paystackBankCode || accountDetails.branchNumber;

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
      await vendorSnap.ref.update({ paystack_recipient_code: recipientCode });
    }

    const vendorAmount = Math.round(escrow.amount * (1 - PLATFORM_PERCENTAGE) * 100) / 100;

    const transferResult = await initiateTransfer({
      amount: vendorAmount,
      recipient: recipientCode,
      reason: `Escrow payout for escrow ${escrowId}`,
    });

    if (!transferResult?.data?.transfer_code) {
      throw new Error('Transfer initiation failed: ' + (transferResult?.message || 'no transfer_code returned'));
    }

    const transferCode = transferResult.data.transfer_code;

    await escrowRef.update({
      status: 'completed',
      payoutStatus: 'released',
      transferCode,
      vendorPayout: vendorAmount,
      paymentReference,
      bookingId,
      consumerApprovedRelease: false,
      professionalApprovedRelease: false,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      message: 'Service marked complete. Funds are being transferred to the professional.',
      data: {
        escrowId,
        bookingId,
        paymentReference,
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

module.exports = { releaseFunds, toggleReleaseApproval };
