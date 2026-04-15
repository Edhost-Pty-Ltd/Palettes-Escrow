/**
 * Integration Tests for Payment Refund E2E Bugfix
 *
 * Task 7: Integration tests that exercise multiple components together
 * (routes + controllers + services), mocking only external dependencies
 * (Paystack API, Firestore, Firebase).
 *
 * 7.1 Full refund flow: initialize transaction → charge.success webhook → POST /refund → verify Paystack receives string reference
 * 7.2 Refund list flow: stored refunds with underscore UIDs → GET /refunds → verify correct user filtering
 * 7.3 Webhook → Firestore → lookup flow: charge.success → Firestore update → reference-based lookup succeeds
 */

const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const http = require('http');

// Mock external dependencies
jest.mock('axios');
jest.mock('../firebase');
jest.mock('../events');

// Load modules after mocking
const db = require('../config/firebase');
const callbackEvents = require('../events');
const refundsRouter = require('../routes/refunds');
const transactionsController = require('../controllers/transactionsController');

// Helper: build Express app with routes
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/refunds', refundsRouter);
  return app;
}

// Helper: make HTTP request to Express app
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
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (data) req.write(data);
      req.end();
    });
  });
}

// Helper: compute HMAC signature for webhook
function computeWebhookSignature(payload) {
  return crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(payload))
    .digest('hex');
}

beforeEach(() => {
  jest.clearAllMocks();
  
  // Mock Firestore collection/query methods
  const mockDoc = {
    id: 'doc123',
    data: () => ({
      bookingId: 'booking_1700000000_abc',
      status: 'PENDING',
      allocations: [],
    }),
  };
  
  const mockQuerySnapshot = {
    empty: false,
    forEach: (callback) => callback(mockDoc),
  };
  
  const mockDocRef = {
    update: jest.fn().mockResolvedValue({}),
  };
  
  const mockQuery = {
    get: jest.fn().mockResolvedValue(mockQuerySnapshot),
  };
  
  const mockCollection = {
    where: jest.fn().mockReturnValue(mockQuery),
    doc: jest.fn().mockReturnValue(mockDocRef),
  };
  
  db.collection = jest.fn().mockReturnValue(mockCollection);
  
  // Mock event emitter
  callbackEvents.emit = jest.fn();
  callbackEvents.on = jest.fn();
});

// ============================================================================
// 7.1 Integration test: full refund flow
// ============================================================================
describe('7.1 Integration: Full refund flow', () => {
  test('initialize transaction → charge.success webhook → POST /refund → Paystack receives string reference', async () => {
    const reference = 'T123456789';
    const transactionId = 1234567;
    
    // Step 1: Simulate charge.success webhook
    const webhookPayload = {
      event: 'charge.success',
      data: {
        id: transactionId,
        reference: reference,
        amount: 1150, // 11.50 ZAR in kobo
        status: 'success',
        paid_at: '2024-01-01T00:00:00.000Z',
        customer: { email: 'buyer@example.com' },
        metadata: {
          booking_id: 'booking_1700000000_abc',
          service_amount: 10.00,
          markup_amount: 0.50,
          agent_service_fee: 1.00,
          firebaseUID: 'abc',
        },
      },
    };
    
    const signature = computeWebhookSignature(webhookPayload);
    
    // Mock request/response for handleCallback
    const req = {
      body: webhookPayload,
      headers: { 'x-paystack-signature': signature },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    
    // Call handleCallback
    await transactionsController.handleCallback(req, res);
    
    // Verify webhook processed successfully
    expect(res.status).toHaveBeenCalledWith(200);
    expect(callbackEvents.emit).toHaveBeenCalledWith('FUNDS_RECEIVED', expect.any(Array));
    
    // Step 2: Call POST /refund
    const transaction = {
      id: transactionId,
      reference: reference,
      status: 'success',
    };
    
    // Mock verify call
    axios.get.mockResolvedValueOnce({
      data: { data: transaction },
    });
    
    // Capture refund POST payload
    let capturedRefundPayload = null;
    axios.post.mockImplementationOnce((_url, payload, _config) => {
      capturedRefundPayload = payload;
      return Promise.resolve({
        data: {
          status: true,
          data: {
            id: 'refund_123',
            reference: reference,
            amount: 1000, // 10.00 ZAR in kobo
            status: 'pending',
          },
        },
      });
    });
    
    const app = buildApp();
    const refundResult = await makeRequest(app, 'POST', '/refunds', { reference });
    
    // Step 3: Verify Paystack receives string reference (not numeric ID)
    expect(refundResult.status).toBe(200);
    expect(capturedRefundPayload).not.toBeNull();
    expect(typeof capturedRefundPayload.transaction).toBe('string');
    expect(capturedRefundPayload.transaction).toBe(reference); // 'T123456789'
    expect(capturedRefundPayload.transaction).not.toBe(transactionId); // not 1234567
  });
});

// ============================================================================
// 7.2 Integration test: refund list flow with underscore UIDs
// ============================================================================
describe('7.2 Integration: Refund list flow with underscore UIDs', () => {
  test('stored refunds with underscore UIDs → GET /refunds → verify correct user filtering', async () => {
    const userUID = 'abc_def'; // UID with underscore
    const bookingId = `booking_1700000000_${userUID}`;
    
    // Mock Paystack refund list response
    const refundListResponse = {
      data: {
        status: true,
        data: [
          {
            id: 'refund_1',
            transaction: {
              id: 1234567,
              reference: 'T123456789',
              metadata: {
                firebaseUID: userUID,
                booking_id: bookingId,
                service_amount: 10.00,
              },
            },
            amount: 1000, // 10.00 ZAR in kobo
            status: 'success',
            refunded_at: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'refund_2',
            transaction: {
              id: 7654321,
              reference: 'T987654321',
              metadata: {
                firebaseUID: 'xyz',
                booking_id: 'booking_1700000000_xyz',
                service_amount: 20.00,
              },
            },
            amount: 2000, // 20.00 ZAR in kobo
            status: 'success',
            refunded_at: '2024-01-02T00:00:00.000Z',
          },
        ],
      },
    };
    
    axios.get.mockResolvedValueOnce(refundListResponse);
    
    // Call GET /refunds with user UID containing underscore
    const app = buildApp();
    const result = await makeRequest(app, 'GET', '/refunds', null, {
      'x-user-id': userUID,
    });
    
    // Verify correct filtering
    expect(result.status).toBe(200);
    expect(result.body.status).toBe(true);
    expect(result.body.count).toBe(1); // Only the refund for abc_def
    expect(result.body.data[0].metadata.firebaseUID).toBe(userUID);
    expect(result.body.data[0].metadata.booking_id).toBe(bookingId);
  });
  
  test('different user gets 0 refunds (isolation)', async () => {
    const userUID = 'xyz'; // Different user
    
    // Mock Paystack refund list response (same as above)
    const refundListResponse = {
      data: {
        status: true,
        data: [
          {
            id: 'refund_1',
            transaction: {
              id: 1234567,
              reference: 'T123456789',
              metadata: {
                firebaseUID: 'abc_def',
                booking_id: 'booking_1700000000_abc_def',
                service_amount: 10.00,
              },
            },
            amount: 1000,
            status: 'success',
            refunded_at: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    };
    
    axios.get.mockResolvedValueOnce(refundListResponse);
    
    // Call GET /refunds with different user
    const app = buildApp();
    const result = await makeRequest(app, 'GET', '/refunds', null, {
      'x-user-id': userUID,
    });
    
    // Verify isolation - user xyz should get 0 refunds
    expect(result.status).toBe(200);
    expect(result.body.count).toBe(0);
    expect(result.body.data).toEqual([]);
  });
});

// ============================================================================
// 7.3 Integration test: webhook → Firestore → lookup flow
// ============================================================================
describe('7.3 Integration: Webhook → Firestore → lookup flow', () => {
  test('charge.success → Firestore update → reference-based lookup succeeds', async () => {
    const reference = 'T123456789';
    const transactionId = 1234567;
    
    // Step 1: Call handleCallback with charge.success event
    const webhookPayload = {
      event: 'charge.success',
      data: {
        id: transactionId,
        reference: reference,
        amount: 1150,
        status: 'success',
        paid_at: '2024-01-01T00:00:00.000Z',
        customer: { email: 'buyer@example.com' },
        metadata: {
          booking_id: 'booking_1700000000_abc',
          service_amount: 10.00,
          markup_amount: 0.50,
          agent_service_fee: 1.00,
          firebaseUID: 'abc',
        },
      },
    };
    
    const signature = computeWebhookSignature(webhookPayload);
    
    const req = {
      body: webhookPayload,
      headers: { 'x-paystack-signature': signature },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    
    // Capture Firestore update payload
    let capturedFirestorePayload = null;
    const mockDocRef = {
      update: jest.fn().mockImplementation((payload) => {
        capturedFirestorePayload = payload;
        return Promise.resolve({});
      }),
    };
    
    const mockQuerySnapshot = {
      empty: false,
      forEach: (callback) => callback({
        id: 'doc123',
        data: () => ({
          bookingId: 'booking_1700000000_abc',
          status: 'PENDING',
          allocations: [],
        }),
      }),
    };
    
    const mockQuery = {
      get: jest.fn().mockResolvedValue(mockQuerySnapshot),
    };
    
    const mockCollection = {
      where: jest.fn().mockReturnValue(mockQuery),
      doc: jest.fn().mockReturnValue(mockDocRef),
    };
    
    db.collection.mockReturnValue(mockCollection);
    
    // Call handleCallback
    await transactionsController.handleCallback(req, res);
    
    // Step 2: Verify Firestore update contains reference field
    expect(res.status).toHaveBeenCalledWith(200);
    expect(capturedFirestorePayload).not.toBeNull();
    expect(capturedFirestorePayload.reference).toBe(reference); // string reference stored
    expect(typeof capturedFirestorePayload.reference).toBe('string');
    
    // Step 3: Simulate generateCheckoutLink lookup using stored reference
    // paystackService.verifyTransaction calls axios(config) directly (not axios.get)
    // so we mock axios as a callable function
    axios.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          id: transactionId,
          reference: reference,
          status: 'success',
          authorization_url: 'https://checkout.paystack.com/abc123',
        },
      },
    });
    
    // Call generateCheckoutLink with reference
    const lookupReq = {
      body: { reference: reference },
    };
    const lookupRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    
    await transactionsController.generateCheckoutLink(lookupReq, lookupRes);
    
    // Verify lookup succeeds (reference-based, not numeric ID-based)
    expect(lookupRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: reference,
      })
    );
    // Verify axios was called with a URL containing the string reference
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining(reference),
      })
    );
  });
});
