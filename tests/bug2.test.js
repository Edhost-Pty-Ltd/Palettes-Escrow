/**
 * Bug 2 Tests — routes/refunds.js GET handler
 *
 * 3.2 Fix-checking test: user with UID "abc_def" and booking_id "booking_1700000000_abc_def"
 *     receives their refunds (would fail with .pop() but passes with .slice(2).join('_'))
 *
 * 3.3 Preservation test: user with simple UID (no underscores) still receives their refunds
 */

const axios = require('axios');

jest.mock('axios');

const express = require('express');
const refundsRouter = require('../routes/refunds');
const http = require('http');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/refunds', refundsRouter);
  return app;
}

function getRefunds(app, userUID) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/refunds',
        method: 'GET',
        headers: {
          'x-user-id': userUID,
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
      req.end();
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// 3.2 Fix-checking test
// ============================================================================
describe('Bug 2 Fix — GET /refunds filters correctly for UIDs containing underscores', () => {
  test('user with UID "abc_def" receives refund with booking_id "booking_1700000000_abc_def"', async () => {
    const refundList = [
      {
        id: 1,
        amount: 1000,
        transaction: {
          id: 99,
          reference: 'REF_ABC_DEF',
          // No metadata here — forces full transaction fetch
        },
      },
    ];

    // Mock the refund list call
    axios.get.mockResolvedValueOnce({
      data: { data: refundList },
    });

    // Mock the full transaction verify call (metadata fetch)
    axios.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 99,
          reference: 'REF_ABC_DEF',
          metadata: {
            booking_id: 'booking_1700000000_abc_def',
            // firebaseUID absent — forces bookingUID comparison
          },
        },
      },
    });

    const app = buildApp();
    const result = await getRefunds(app, 'abc_def');

    expect(result.status).toBe(200);
    expect(result.body.count).toBeGreaterThan(0);
    expect(result.body.data).toHaveLength(1);
  });
});

// ============================================================================
// 3.3 Preservation test
// ============================================================================
describe('Bug 2 Preservation — GET /refunds still works for UIDs without underscores', () => {
  test('user with simple UID "simpleUID" receives refund with booking_id "booking_1700000000_simpleUID"', async () => {
    const refundList = [
      {
        id: 2,
        amount: 2000,
        transaction: {
          id: 88,
          reference: 'REF_SIMPLE',
        },
      },
    ];

    // Mock the refund list call
    axios.get.mockResolvedValueOnce({
      data: { data: refundList },
    });

    // Mock the full transaction verify call
    axios.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 88,
          reference: 'REF_SIMPLE',
          metadata: {
            booking_id: 'booking_1700000000_simpleUID',
          },
        },
      },
    });

    const app = buildApp();
    const result = await getRefunds(app, 'simpleUID');

    expect(result.status).toBe(200);
    expect(result.body.count).toBeGreaterThan(0);
    expect(result.body.data).toHaveLength(1);
  });
});
