/**
 * Scenario Tests: Customer "Slice" — R500 service
 *
 * Covers:
 *  - Split payment calculation for R500
 *  - Refund flow (full service amount refund)
 *  - Transaction controller (refundTransaction)
 *  - E2E: initialize → charge.success webhook → POST /refund → GET /refunds
 */

const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const http = require('http');

// ── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('axios');
jest.mock('../firebase');
jest.mock('../events');

const db = require('../config/firebase');
const callbackEvents = require('../events');
const refundsRouter = require('../routes/refunds');
const transactionsController = require('../controllers/transactionsController');
const paystackService = require('../services/paystack');

// ── Constants ─────────────────────────────────────────────────────────────────
const SERVICE_AMOUNT = 500;          // R500 ZAR
const MARKUP_AMOUNT = 25;            // 5% of 500
const AGENT_FEE = 50;                // 10% of 500
const TOTAL_AMOUNT = 575;            // 500 + 25 + 50
const TOTAL_KOBO = 57500;            // 575 * 100
const SERVICE_KOBO = 50000;          // 500 * 100

const CUSTOMER_EMAIL = 'slice@example.com';
const CUSTOMER_UID = 'slice_user_uid';
const BOOKING_ID = `booking_1700000000_${CUSTOMER_UID}`;
const REFERENCE = 'SLICE_REF_500';
const TRANSACTION_ID = 9876543;
const SECRET = 'test_secret_slice';

// ── Helpers ───────────────────────────────────────────────────────────────────
function computeSig(payload) {
  return crypto.createHmac('sha512', SECRET).update(JSON.stringify(payload)).digest('hex');
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/refunds', refundsRouter);
  return app;
}

function makeRequest(app, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : '';
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(data && { 'Content-Length': Buffer.byteLength(data) }),
        },
      };
      const req = http.request(options, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

function mockFirestore() {
  const mockDocRef = { update: jest.fn().mockResolvedValue({}) };
  const mockSnapshot = {
    empty: false,
    forEach: (cb) => cb({ id: 'doc1', data: () => ({ allocations: [], status: 'PENDING' }) }),
  };
  const mockQuery = { get: jest.fn().mockResolvedValue(mockSnapshot) };
  const mockCollection = {
    where: jest.fn().mockReturnValue(mockQuery),
    doc: jest.fn().mockReturnValue(mockDocRef),
  };
  db.collection = jest.fn().mockReturnValue(mockCollection);
  return mockDocRef;
}

beforeAll(() => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
});

beforeEach(() => {
  jest.clearAllMocks();
  callbackEvents.emit = jest.fn();
  callbackEvents.on = jest.fn();
});

// ============================================================================
// 1. Split payment calculation — R500 service
// ============================================================================
describe('Split payment: R500 service (Slice)', () => {
  test('calculates correct breakdown for R500', () => {
    const breakdown = paystackService.calculateSplitPayment(SERVICE_AMOUNT);

    expect(breakdown.serviceAmount).toBe(500);
    expect(breakdown.markupAmount).toBe(25);       // 5%
    expect(breakdown.agentServiceFee).toBe(50);    // 10%
    expect(breakdown.totalAmount).toBe(575);       // 500 + 25 + 50
    expect(breakdown.refundableAmount).toBe(500);  // only service amount
  });

  test('zarToKobo converts R575 total to 57500 kobo', () => {
    expect(paystackService.zarToKobo(TOTAL_AMOUNT)).toBe(TOTAL_KOBO);
  });

  test('zarToKobo converts R500 service to 50000 kobo', () => {
    expect(paystackService.zarToKobo(SERVICE_AMOUNT)).toBe(SERVICE_KOBO);
  });

  test('non-refundable portion is R75 (markup + agent fee)', () => {
    const breakdown = paystackService.calculateSplitPayment(SERVICE_AMOUNT);
    const nonRefundable = breakdown.markupAmount + breakdown.agentServiceFee;
    expect(nonRefundable).toBe(75);
  });
});

// ============================================================================
// 2. Refund service — R500 refund via paystackService
// ============================================================================
describe('Refund service: R500 full refund (Slice)', () => {
  test('refundTransaction sends correct reference and R500 in kobo to Paystack', async () => {
    let capturedPayload = null;

    // Single mock that captures the payload
    axios.mockImplementationOnce((config) => {
      capturedPayload = config.data;
      return Promise.resolve({
        data: {
          status: true,
          data: { id: 1, transaction: REFERENCE, amount: SERVICE_KOBO, status: 'pending' },
        },
      });
    });

    await paystackService.refundTransaction(REFERENCE, SERVICE_AMOUNT);

    expect(capturedPayload.transaction).toBe(REFERENCE);          // string reference
    expect(capturedPayload.amount).toBe(SERVICE_KOBO);            // 50000 kobo (single conversion)
  });

  test('refundTransaction rejects if reference is missing', async () => {
    await expect(paystackService.refundTransaction(null, SERVICE_AMOUNT))
      .rejects.toThrow('Transaction reference is required');
  });
});

// ============================================================================
// 3. Transaction controller — refundTransaction for R500
// ============================================================================
describe('Transaction controller: refundTransaction R500 (Slice)', () => {
  const verifyMockResponse = {
    status: true,
    data: {
      id: TRANSACTION_ID,
      reference: REFERENCE,
      status: 'success',
      amount: TOTAL_KOBO,
      metadata: {
        service_amount: SERVICE_AMOUNT,
        markup_amount: MARKUP_AMOUNT,
        agent_service_fee: AGENT_FEE,
      },
    },
  };

  test('controller passes R500 ZAR (not kobo) to paystackService', async () => {
    const verifySpy = jest.spyOn(paystackService, 'verifyTransaction')
      .mockResolvedValueOnce(verifyMockResponse);

    let capturedAmount = null;
    const refundSpy = jest.spyOn(paystackService, 'refundTransaction')
      .mockImplementationOnce((_ref, amount) => {
        capturedAmount = amount;
        return Promise.resolve({ status: true, data: { id: 99, status: 'pending', refunded_at: new Date().toISOString() } });
      });

    const app = express();
    app.use(express.json());
    app.post('/refund', transactionsController.refundTransaction);

    const result = await makeRequest(app, 'POST', '/refund', { reference: REFERENCE });

    expect(result.status).toBe(200);
    expect(capturedAmount).toBe(SERVICE_AMOUNT);   // R500 ZAR — NOT 50000 kobo
    expect(result.body.data.refunded_amount).toBe(SERVICE_AMOUNT);
    expect(result.body.data.service_amount).toBe(SERVICE_AMOUNT);
    expect(result.body.data.markup_retained).toBe(MARKUP_AMOUNT);
    expect(result.body.data.agent_fee_retained).toBe(AGENT_FEE);

    verifySpy.mockRestore();
    refundSpy.mockRestore();
  });

  test('controller rejects partial refund above R500', async () => {
    const verifySpy = jest.spyOn(paystackService, 'verifyTransaction')
      .mockResolvedValueOnce(verifyMockResponse);

    const app = express();
    app.use(express.json());
    app.post('/refund', transactionsController.refundTransaction);

    const result = await makeRequest(app, 'POST', '/refund', { reference: REFERENCE, amount: 600 });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/cannot exceed/i);

    verifySpy.mockRestore();
  });
});

// ============================================================================
// 4. E2E: initialize → charge.success → POST /refund → GET /refunds
// ============================================================================
describe('E2E: Slice customer R500 full flow', () => {
  test('charge.success webhook stores reference, then POST /refund sends string reference to Paystack', async () => {
    const mockDocRef = mockFirestore();

    // Step 1: charge.success webhook
    const webhookPayload = {
      event: 'charge.success',
      data: {
        id: TRANSACTION_ID,
        reference: REFERENCE,
        amount: TOTAL_KOBO,
        paid_at: '2024-06-01T10:00:00.000Z',
        authorization_code: 'AUTH_slice123',
        metadata: {
          booking_id: BOOKING_ID,
          service_amount: SERVICE_AMOUNT,
          markup_amount: MARKUP_AMOUNT,
          agent_service_fee: AGENT_FEE,
          firebaseUID: CUSTOMER_UID,
        },
      },
    };

    const webhookReq = {
      body: webhookPayload,
      headers: { 'x-paystack-signature': computeSig(webhookPayload) },
    };
    const webhookRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await transactionsController.handleCallback(webhookReq, webhookRes);

    // Webhook processed
    expect(webhookRes.status).toHaveBeenCalledWith(200);
    expect(callbackEvents.emit).toHaveBeenCalledWith('FUNDS_RECEIVED', expect.any(Array));

    // Firestore stored string reference as primary key
    const firestoreUpdate = mockDocRef.update.mock.calls[0][0];
    expect(firestoreUpdate.reference).toBe(REFERENCE);
    expect(typeof firestoreUpdate.reference).toBe('string');
    expect(firestoreUpdate.status).toBe('PAID');

    // Step 2: POST /refund
    axios.get.mockResolvedValueOnce({
      data: {
        data: { id: TRANSACTION_ID, reference: REFERENCE, status: 'success' },
      },
    });

    let capturedRefundPayload = null;
    axios.post.mockImplementationOnce((_url, payload) => {
      capturedRefundPayload = payload;
      return Promise.resolve({
        data: {
          status: true,
          data: { id: 'refund_slice', status: 'pending', refunded_at: new Date().toISOString() },
        },
      });
    });

    const app = buildApp();
    const refundResult = await makeRequest(app, 'POST', '/refunds', { reference: REFERENCE });

    expect(refundResult.status).toBe(200);
    // Bug 1 fix: string reference sent, not numeric ID
    expect(typeof capturedRefundPayload.transaction).toBe('string');
    expect(capturedRefundPayload.transaction).toBe(REFERENCE);
    expect(capturedRefundPayload.transaction).not.toBe(TRANSACTION_ID);
  });

  test('GET /refunds returns Slice customer refund filtered by UID with underscore', async () => {
    // Mock refund list — Slice user has underscore in UID
    axios.get.mockResolvedValueOnce({
      data: {
        status: true,
        data: [
          {
            id: 'refund_slice',
            amount: SERVICE_KOBO,
            transaction: {
              id: TRANSACTION_ID,
              reference: REFERENCE,
              metadata: {
                firebaseUID: CUSTOMER_UID,
                booking_id: BOOKING_ID,
                service_amount: SERVICE_AMOUNT,
              },
            },
            status: 'success',
            refunded_at: '2024-06-01T11:00:00.000Z',
          },
          {
            id: 'refund_other',
            amount: 20000,
            transaction: {
              id: 111,
              reference: 'OTHER_REF',
              metadata: {
                firebaseUID: 'other_user',
                booking_id: 'booking_1700000000_other_user',
                service_amount: 200,
              },
            },
            status: 'success',
            refunded_at: '2024-06-01T12:00:00.000Z',
          },
        ],
      },
    });

    const app = buildApp();
    const result = await makeRequest(app, 'GET', '/refunds', null, {
      'x-user-id': CUSTOMER_UID,
    });

    expect(result.status).toBe(200);
    expect(result.body.count).toBe(1);
    expect(result.body.data[0].metadata.firebaseUID).toBe(CUSTOMER_UID);
    // amount_zar should be R500.00
    expect(result.body.data[0].amount_zar).toBe('500.00');
  });
});
