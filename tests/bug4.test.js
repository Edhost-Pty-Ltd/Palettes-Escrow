/**
 * Bug 4 Tests — controllers/transactionsController.js handleCallback
 *
 * 5.2 Fix-checking test: assert Firestore update payload contains reference: "T123456789" (string)
 * 5.3 Preservation test: assert charge.success webhook updates booking status to PAID and emits FUNDS_RECEIVED
 */

const crypto = require('crypto');

// ── Mock firebase (db) ──────────────────────────────────────────────────────
const mockUpdate = jest.fn().mockResolvedValue({});
const mockDocRef = { update: mockUpdate };
const mockGet = jest.fn();
const mockWhere = jest.fn();
const mockCollection = jest.fn();

jest.mock('../firebase', () => ({
  collection: (...args) => mockCollection(...args),
}));

// ── Mock events ─────────────────────────────────────────────────────────────
const mockEmit = jest.fn();
jest.mock('../events', () => ({ emit: mockEmit, on: jest.fn() }));

// ── Helpers ──────────────────────────────────────────────────────────────────
const SECRET = 'test_secret_key';

function buildWebhookPayload(overrides = {}) {
  const base = {
    event: 'charge.success',
    data: {
      id: 1234567,
      reference: 'T123456789',
      amount: 1150,
      paid_at: '2024-01-01T00:00:00.000Z',
      authorization_code: 'AUTH_abc123',
      metadata: {
        booking_id: 'booking_1700000000_abc',
        service_amount: 10.00,
        markup_amount: 0.50,
        agent_service_fee: 1.00,
      },
    },
  };
  return { ...base, ...overrides };
}

function computeSignature(payload) {
  return crypto
    .createHmac('sha512', SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
}

function buildReq(payload) {
  const sig = computeSignature(payload);
  return {
    body: payload,
    headers: { 'x-paystack-signature': sig },
  };
}

function buildRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

// ── Setup ────────────────────────────────────────────────────────────────────
beforeAll(() => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
});

beforeEach(() => {
  jest.clearAllMocks();

  // Wire up the Firestore mock chain: db.collection().where().get()
  mockGet.mockResolvedValue({
    empty: false,
    forEach: (cb) => {
      cb({ id: 'doc1', data: () => ({ allocations: [] }) });
    },
  });
  mockWhere.mockReturnValue({ get: mockGet });
  mockCollection.mockReturnValue({
    where: mockWhere,
    doc: () => mockDocRef,
  });
});

// ── Require controller AFTER mocks are set up ────────────────────────────────
const { handleCallback } = require('../controllers/transactionsController');

// ============================================================================
// 5.2 Fix-checking test
// ============================================================================
describe('Bug 4 Fix — handleCallback Firestore update includes reference string field', () => {
  test('Firestore update payload contains reference: "T123456789" (string)', async () => {
    const payload = buildWebhookPayload();
    const req = buildReq(payload);
    const res = buildRes();

    await handleCallback(req, res);

    expect(res._status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const updateArg = mockUpdate.mock.calls[0][0];

    // Primary assertion: reference must be the string from data.reference
    expect(updateArg).toHaveProperty('reference', 'T123456789');
    expect(typeof updateArg.reference).toBe('string');
  });
});

// ============================================================================
// 5.3 Preservation test
// ============================================================================
describe('Bug 4 Preservation — charge.success still sets status PAID and emits FUNDS_RECEIVED', () => {
  test('Firestore update includes status: "PAID" for charge.success event', async () => {
    const payload = buildWebhookPayload();
    const req = buildReq(payload);
    const res = buildRes();

    await handleCallback(req, res);

    expect(res._status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg).toHaveProperty('status', 'PAID');
  });

  test('FUNDS_RECEIVED event is emitted for charge.success event', async () => {
    const payload = buildWebhookPayload();
    const req = buildReq(payload);
    const res = buildRes();

    await handleCallback(req, res);

    expect(mockEmit).toHaveBeenCalledWith('FUNDS_RECEIVED', expect.any(Array));
  });
});
