/**
 * Bug 3 Tests — controllers/transactionsController.js refundTransaction
 *
 * 4.2 Fix-checking test: assert service receives ZAR value (not pre-converted kobo)
 *     i.e. paystackService.refundTransaction is called with 10.00, not 1000
 *
 * 4.3 Preservation test: assert partial refund cap logic still rejects amounts above serviceAmount
 */

// Mock the paystack service before requiring the controller
jest.mock('../services/paystack');

const paystackService = require('../services/paystack');
const express = require('express');
const http = require('http');
const { refundTransaction } = require('../controllers/transactionsController');

// Build a minimal Express app wiring the controller directly
function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/refund', refundTransaction);
  return app;
}

function postRefund(app, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const data = JSON.stringify(body);
      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/refund',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };
      const req = http.request(options, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.write(data);
      req.end();
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// 4.2 Fix-checking test
// ============================================================================
describe('Bug 3 Fix — refundTransaction passes ZAR amount to paystackService (single conversion)', () => {
  test('paystackService.refundTransaction receives 10.00 (ZAR), not 1000 (kobo)', async () => {
    const serviceAmount = 10.00;

    // Mock verifyTransaction to return a transaction with service_amount in metadata
    paystackService.verifyTransaction.mockResolvedValueOnce({
      status: true,
      data: {
        id: 1234567,
        reference: 'T123456789',
        status: 'success',
        amount: 1150, // 11.50 ZAR in kobo
        metadata: {
          service_amount: serviceAmount,
          markup_amount: 0.50,
          agent_service_fee: 1.00,
        },
      },
    });

    // Capture the amount argument passed to refundTransaction
    let capturedAmount = null;
    paystackService.refundTransaction.mockImplementationOnce((_ref, amount) => {
      capturedAmount = amount;
      return Promise.resolve({
        status: true,
        data: {
          id: 99,
          status: 'pending',
          refunded_at: new Date().toISOString(),
        },
      });
    });

    const app = buildApp();
    const result = await postRefund(app, { reference: 'T123456789' });

    expect(result.status).toBe(200);
    expect(capturedAmount).not.toBeNull();

    // The fix: service must receive ZAR (10.00), not pre-converted kobo (1000)
    expect(capturedAmount).toBe(serviceAmount);       // 10.00 ZAR
    expect(capturedAmount).not.toBe(serviceAmount * 100); // NOT 1000 kobo
  });
});

// ============================================================================
// 4.3 Preservation test
// ============================================================================
describe('Bug 3 Preservation — partial refund cap still rejects amounts above serviceAmount', () => {
  test('returns 400 when requested refund amount exceeds serviceAmount', async () => {
    const serviceAmount = 10.00;
    const excessiveAmount = 15.00; // exceeds serviceAmount

    paystackService.verifyTransaction.mockResolvedValueOnce({
      status: true,
      data: {
        id: 1234567,
        reference: 'T123456789',
        status: 'success',
        amount: 1150,
        metadata: {
          service_amount: serviceAmount,
          markup_amount: 0.50,
          agent_service_fee: 1.00,
        },
      },
    });

    const app = buildApp();
    const result = await postRefund(app, { reference: 'T123456789', amount: excessiveAmount });

    // Should be rejected — amount exceeds refundable service amount
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/cannot exceed/i);

    // paystackService.refundTransaction must NOT have been called
    expect(paystackService.refundTransaction).not.toHaveBeenCalled();
  });

  test('accepts partial refund amount at or below serviceAmount', async () => {
    const serviceAmount = 10.00;
    const partialAmount = 5.00; // within serviceAmount

    paystackService.verifyTransaction.mockResolvedValueOnce({
      status: true,
      data: {
        id: 1234567,
        reference: 'T123456789',
        status: 'success',
        amount: 1150,
        metadata: {
          service_amount: serviceAmount,
          markup_amount: 0.50,
          agent_service_fee: 1.00,
        },
      },
    });

    paystackService.refundTransaction.mockResolvedValueOnce({
      status: true,
      data: {
        id: 100,
        status: 'pending',
        refunded_at: new Date().toISOString(),
      },
    });

    const app = buildApp();
    const result = await postRefund(app, { reference: 'T123456789', amount: partialAmount });

    expect(result.status).toBe(200);
    expect(paystackService.refundTransaction).toHaveBeenCalledTimes(1);
  });
});
