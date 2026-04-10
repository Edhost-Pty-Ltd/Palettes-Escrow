require('dotenv').config();
const db = require('../config/firebase');
const { FieldValue } = require('firebase-admin/firestore');

const VENDOR_UID = 'TLesyhnJSeqArxsrxhih';

async function seed() {
  const ref = await db.collection('escrowTransactions').add({
    transactionReference: `ESC-TEST-${Date.now()}`,
    customerId: 'test-customer-001',
    professionalVendorId: VENDOR_UID,
    type: 'service',
    amount: 500,
    currency: 'zar',
    reference: 'test-ref-001',
    status: 'active',
    paymentStatus: 'paid',
    payoutStatus: 'not_paid',
    metadata: {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log('Seeded escrow ID:', ref.id);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
