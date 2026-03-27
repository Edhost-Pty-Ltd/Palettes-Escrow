/**
 * Bug 1 Tests — routes/refunds.js POST handler
 *
 * 2.2 Fix-checking test: assert refund payload `transaction` field is a string matching transaction.reference
 * 2.3 Preservation test: assert transaction status verification before refund still occurs
 */

const axios = require('axios');

// Mock axios to avoid real HTTP calls
jest.mock('axios');

// Load the router after mocking axios
const express = require('express');
const refundsRouter = require('../routes/refunds');

const request = require('express').Router;

// Helper: build a minimal Express app with the refunds router
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/refund', refundsRouter);
  return app;
}

// Helper: make a supertest-style request without supertest (use http module)
const http = require('http');

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
// 2.2 Fix-checking test
// ============================================================================
describe('Bug 1 Fix — POST /refund sends transaction.reference (string), not transaction.id (number)', () => {
  test('refund payload transaction field equals transaction.reference string', async () => {
    const transaction = {
      id: 1234567,
      reference: 'T123456789',
      status: 'success',
    };

    // Mock verify call
    axios.get.mockResolvedValueOnce({
      data: { data: transaction },
    });

    // Capture the refund POST payload
    let capturedPayload = null;
    axios.post.mockImplementationOnce((_url, payload, _config) => {
      capturedPayload = payload;
      return Promise.resolve({ data: { status: true, message: 'Refund initiated' } });
    });

    const app = buildApp();
    const result = await postRefund(app, { reference: 'T123456789' });

    expect(result.status).toBe(200);
    expect(capturedPayload).not.toBeNull();

    // The fix: payload.transaction must be the string reference, not the numeric id
    expect(typeof capturedPayload.transaction).toBe('string');
    expect(capturedPayload.transaction).toBe(transaction.reference); // 'T123456789'
    expect(capturedPayload.transaction).not.toBe(transaction.id);    // not 1234567
  });
});

// ============================================================================
// 2.3 Preservation test
// ============================================================================
describe('Bug 1 Preservation — transaction status is verified before refund is processed', () => {
  test('refund is NOT initiated when transaction status is not "success"', async () => {
    const transaction = {
      id: 1234567,
      reference: 'T123456789',
      status: 'failed',
    };

    axios.get.mockResolvedValueOnce({
      data: { data: transaction },
    });

    const app = buildApp();
    const result = await postRefund(app, { reference: 'T123456789' });

    // Should return 400 — refund must not proceed for non-success transactions
    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/not successful/i);

    // axios.post (the refund call) must NOT have been called
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('refund IS initiated when transaction status is "success"', async () => {
    const transaction = {
      id: 1234567,
      reference: 'T123456789',
      status: 'success',
    };

    axios.get.mockResolvedValueOnce({
      data: { data: transaction },
    });

    axios.post.mockResolvedValueOnce({
      data: { status: true, message: 'Refund initiated' },
    });

    const app = buildApp();
    const result = await postRefund(app, { reference: 'T123456789' });

    expect(result.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
