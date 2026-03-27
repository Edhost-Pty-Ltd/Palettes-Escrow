/**
 * Live E2E Script: Customer "Slice" — R500 service on Paystack test API
 *
 * This script hits the REAL Paystack test API (no mocks).
 * It records every step with timestamps and full API responses.
 *
 * Steps:
 *  1. Calculate split payment breakdown for R500
 *  2. Initialize a Paystack transaction (get payment link)
 *  3. Verify the transaction by reference
 *  4. Attempt a refund (will be pending until payment is completed via the link)
 *
 * Run: node tests/e2e-live-slice-500.js
 */

require('dotenv').config();
const paystackService = require('../services/paystack');

// ── Scenario constants ────────────────────────────────────────────────────────
const SERVICE_AMOUNT = 500;
const CUSTOMER_EMAIL = 'slice@palettes-test.com';
const CUSTOMER_UID   = 'slice_user_uid';
const BOOKING_ID     = `booking_${Date.now()}_${CUSTOMER_UID}`;

// ── Logging helpers ───────────────────────────────────────────────────────────
const log = (label, data) => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${new Date().toISOString()}] ${label}`);
  console.log(JSON.stringify(data, null, 2));
};

const logStep = (n, title) => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  STEP ${n}: ${title}`);
  console.log(`${'═'.repeat(60)}`);
};

const logError = (label, err) => {
  console.error(`\n[ERROR] ${label}`);
  console.error(err?.response?.data || err?.message || err);
};

// ── Main E2E flow ─────────────────────────────────────────────────────────────
async function runE2E() {
  console.log('\n🚀 Palettes Escrow — Live E2E: Slice customer, R500 service');
  console.log(`   Paystack env: ${process.env.PAYSTACK_BASE_URL}`);
  console.log(`   Booking ID:   ${BOOKING_ID}`);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1: Split payment calculation
  // ──────────────────────────────────────────────────────────────────────────
  logStep(1, 'Calculate split payment breakdown for R500');

  const breakdown = paystackService.calculateSplitPayment(SERVICE_AMOUNT);
  log('Breakdown', {
    serviceAmount:    `R${breakdown.serviceAmount}   ← refundable (goes to seller)`,
    markupAmount:     `R${breakdown.markupAmount}    ← 5% non-refundable (Paystack fees)`,
    agentServiceFee:  `R${breakdown.agentServiceFee} ← 10% non-refundable (platform fee)`,
    totalAmount:      `R${breakdown.totalAmount}  ← customer pays`,
    refundableAmount: `R${breakdown.refundableAmount} ← max refund`,
    totalKobo:        paystackService.zarToKobo(breakdown.totalAmount),
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: Initialize transaction on Paystack
  // ──────────────────────────────────────────────────────────────────────────
  logStep(2, 'Initialize Paystack transaction (R575 total)');

  let reference;
  let paymentLink;

  try {
    const initResult = await paystackService.initializeTransaction({
      email:        CUSTOMER_EMAIL,
      amount:       breakdown.totalAmount,   // R575 ZAR — service converts to kobo internally
      currency:     'ZAR',
      callback_url: process.env.PAYSTACK_CALLBACK_URL || 'http://localhost:3000/api/payments/callback',
      metadata: {
        booking_id:        BOOKING_ID,
        firebaseUID:       CUSTOMER_UID,
        buyer_email:       CUSTOMER_EMAIL,
        buyer_name:        'Slice Customer',
        service_amount:    breakdown.serviceAmount,
        markup_amount:     breakdown.markupAmount,
        agent_service_fee: breakdown.agentServiceFee,
        total_amount:      breakdown.totalAmount,
        title:             'Palettes Escrow — R500 service',
        description:       'E2E live test: Slice customer, R500 service',
      },
    });

    reference   = initResult.data.reference;
    paymentLink = initResult.data.authorization_url;

    log('Transaction initialized ✅', {
      reference,
      paymentLink,
      access_code: initResult.data.access_code,
      status:      initResult.status,
      message:     initResult.message,
    });

    console.log(`\n  👉 PAYMENT LINK: ${paymentLink}`);
    console.log(`     Open this URL in a browser to complete the test payment.`);
    console.log(`     Use Paystack test card: 4084 0840 8408 4081 | CVV: 408 | Exp: 01/25 | PIN: 0000 | OTP: 123456`);

  } catch (err) {
    logError('initializeTransaction', err);
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3: Verify transaction by reference
  // ──────────────────────────────────────────────────────────────────────────
  logStep(3, `Verify transaction: ${reference}`);

  try {
    const verifyResult = await paystackService.verifyTransaction(reference);

    log('Transaction verified ✅', {
      reference:  verifyResult.data.reference,
      status:     verifyResult.data.status,
      amount_kobo: verifyResult.data.amount,
      amount_zar:  verifyResult.data.amount / 100,
      customer:   verifyResult.data.customer?.email,
      metadata:   verifyResult.data.metadata,
      paid_at:    verifyResult.data.paid_at,
    });

    const txStatus = verifyResult.data.status;

    if (txStatus !== 'success') {
      console.log(`\n  ⚠️  Transaction status is "${txStatus}" — payment not yet completed.`);
      console.log(`     Complete the payment at the link above, then re-run this script`);
      console.log(`     with REFERENCE=${reference} to proceed to the refund step.\n`);

      // Still record what we have
      log('Recorded reference for later refund', { reference, paymentLink });
      summarize({ reference, paymentLink, breakdown, status: txStatus, refund: null });
      return;
    }

    // ──────────────────────────────────────────────────────────────────────
    // STEP 4: Initiate refund (service amount only — R500)
    // ──────────────────────────────────────────────────────────────────────
    logStep(4, `Initiate refund of R${breakdown.serviceAmount} (service amount only)`);

    try {
      const refundResult = await paystackService.refundTransaction(
        reference,
        breakdown.serviceAmount,  // R500 ZAR — service converts to kobo internally
        'E2E live test: Slice customer full service refund'
      );

      log('Refund initiated ✅', {
        refund_id:        refundResult.data.id,
        transaction_ref:  refundResult.data.transaction?.reference || reference,
        amount_kobo:      refundResult.data.amount,
        amount_zar:       refundResult.data.amount / 100,
        status:           refundResult.data.status,
        refunded_at:      refundResult.data.refunded_at,
        currency:         refundResult.data.currency,
      });

      summarize({ reference, paymentLink, breakdown, status: txStatus, refund: refundResult.data });

    } catch (err) {
      logError('refundTransaction', err);
      summarize({ reference, paymentLink, breakdown, status: txStatus, refund: null, refundError: err?.message });
    }

  } catch (err) {
    logError('verifyTransaction', err);
    process.exit(1);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
function summarize({ reference, paymentLink, breakdown, status, refund, refundError }) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  📋 E2E SUMMARY — Slice customer, R500 service');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Reference:        ${reference}`);
  console.log(`  Payment link:     ${paymentLink}`);
  console.log(`  Transaction:      ${status}`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Service amount:   R${breakdown.serviceAmount}  (refundable)`);
  console.log(`  Markup (5%):      R${breakdown.markupAmount}   (non-refundable)`);
  console.log(`  Agent fee (10%):  R${breakdown.agentServiceFee}   (non-refundable)`);
  console.log(`  Total paid:       R${breakdown.totalAmount}`);
  console.log(`  ─────────────────────────────────────────`);
  if (refund) {
    console.log(`  Refund ID:        ${refund.id}`);
    console.log(`  Refund amount:    R${refund.amount / 100}`);
    console.log(`  Refund status:    ${refund.status}`);
    console.log(`  Refunded at:      ${refund.refunded_at || 'pending'}`);
  } else if (refundError) {
    console.log(`  Refund:           ❌ ${refundError}`);
  } else {
    console.log(`  Refund:           ⏳ Awaiting payment completion`);
  }
  console.log(`${'═'.repeat(60)}\n`);
}

runE2E().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
