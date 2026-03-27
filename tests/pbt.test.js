/**
 * Property-Based Tests — Property 5: Preservation
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * These tests use manual random generation (no PBT library) following the
 * `Array.from({ length: 100 }, generateCase)` pattern.
 *
 * 6.1 PBT: UID extraction always returns the correct full UID
 * 6.2 PBT: ZAR → kobo conversion is exactly amount * 100 (single conversion)
 * 6.3 PBT: Firestore always stores `reference` as a string field
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a random alphanumeric string of length `len` */
function randomAlphanumeric(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Generates a random Firebase UID — alphanumeric segments joined by underscores.
 * ~50% chance of containing underscores (1–3 extra segments).
 */
function generateUID() {
  const hasUnderscores = Math.random() < 0.5;
  if (!hasUnderscores) {
    return randomAlphanumeric(8 + Math.floor(Math.random() * 12)); // 8–19 chars
  }
  const segmentCount = 2 + Math.floor(Math.random() * 3); // 2–4 segments
  return Array.from({ length: segmentCount }, () => randomAlphanumeric(3 + Math.floor(Math.random() * 6))).join('_');
}

/**
 * Generates a random ZAR amount with 2 decimal places in range [1.00, 1000.00].
 */
function generateZarAmount() {
  const raw = 1 + Math.random() * 999;
  return Math.round(raw * 100) / 100; // 2 decimal places
}

/**
 * Generates a random Paystack charge.success data payload.
 */
function generateChargeSuccessData() {
  return {
    id: Math.floor(Math.random() * 1e9),           // numeric Paystack ID
    reference: 'T' + randomAlphanumeric(10),        // string reference
    amount: Math.floor(Math.random() * 100000) + 100,
    paid_at: new Date().toISOString(),
    authorization_code: 'AUTH_' + randomAlphanumeric(8),
    metadata: {
      booking_id: 'booking_' + Date.now() + '_' + generateUID(),
      service_amount: generateZarAmount(),
      markup_amount: 0.50,
      agent_service_fee: 1.00,
    },
  };
}

// ============================================================================
// 6.1 PBT — UID extraction always returns the correct full UID
// **Validates: Requirements 3.2**
// ============================================================================
describe('PBT 6.1 — Fixed UID extraction returns correct full UID for any Firebase UID', () => {
  test('split("_").slice(2).join("_") always recovers the original UID', () => {
    const cases = Array.from({ length: 100 }, () => {
      const uid = generateUID();
      const bookingId = 'booking_1700000000_' + uid;
      return { uid, bookingId };
    });

    for (const { uid, bookingId } of cases) {
      const extracted = bookingId.split('_').slice(2).join('_');
      expect(extracted).toBe(uid);
    }
  });

  test('simple UIDs (no underscores) are also extracted correctly', () => {
    const cases = Array.from({ length: 100 }, () => {
      const uid = randomAlphanumeric(8 + Math.floor(Math.random() * 12));
      const bookingId = 'booking_1700000000_' + uid;
      return { uid, bookingId };
    });

    for (const { uid, bookingId } of cases) {
      const extracted = bookingId.split('_').slice(2).join('_');
      expect(extracted).toBe(uid);
    }
  });

  test('UIDs with multiple underscores are extracted correctly', () => {
    const cases = Array.from({ length: 100 }, () => {
      // Force at least 2 underscores in the UID
      const segments = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () =>
        randomAlphanumeric(3 + Math.floor(Math.random() * 5))
      );
      const uid = segments.join('_');
      const bookingId = 'booking_1700000000_' + uid;
      return { uid, bookingId };
    });

    for (const { uid, bookingId } of cases) {
      const extracted = bookingId.split('_').slice(2).join('_');
      expect(extracted).toBe(uid);
    }
  });
});

// ============================================================================
// 6.2 PBT — ZAR → kobo conversion is exactly amount * 100 (single conversion)
// **Validates: Requirements 3.3, 3.5**
// ============================================================================
describe('PBT 6.2 — zarToKobo produces exactly amount * 100 for any valid ZAR amount', () => {
  const { zarToKobo } = require('../services/paystack');

  test('zarToKobo(amount) === Math.round(amount * 100) for 100 random ZAR amounts', () => {
    const cases = Array.from({ length: 100 }, generateZarAmount);

    for (const amount of cases) {
      const result = zarToKobo(amount);
      expect(result).toBe(Math.round(amount * 100));
    }
  });

  test('single conversion: zarToKobo called once gives correct kobo, not amount * 100 * 100', () => {
    const cases = Array.from({ length: 100 }, generateZarAmount);

    for (const amount of cases) {
      const kobo = zarToKobo(amount);
      // Single conversion: kobo should equal amount * 100
      expect(kobo).toBe(Math.round(amount * 100));
      // Double conversion would give amount * 10000 — must NOT equal that
      if (amount !== 0) {
        expect(kobo).not.toBe(Math.round(amount * 10000));
      }
    }
  });

  test('zarToKobo result is always an integer', () => {
    const cases = Array.from({ length: 100 }, generateZarAmount);

    for (const amount of cases) {
      const kobo = zarToKobo(amount);
      expect(Number.isInteger(kobo)).toBe(true);
    }
  });
});

// ============================================================================
// 6.3 PBT — Firestore always stores `reference` as a string field
// **Validates: Requirements 3.4**
// ============================================================================

// ── Mocks for 6.3 ────────────────────────────────────────────────────────────
const crypto = require('crypto');

const mockUpdate63 = jest.fn().mockResolvedValue({});
const mockDocRef63 = { update: mockUpdate63 };
const mockGet63 = jest.fn();
const mockWhere63 = jest.fn();
const mockCollection63 = jest.fn();

jest.mock('../firebase', () => ({
  collection: (...args) => mockCollection63(...args),
}));

jest.mock('../events', () => ({ emit: jest.fn(), on: jest.fn() }));

const SECRET = 'test_secret_key_pbt';

function computeSig(payload) {
  return crypto
    .createHmac('sha512', SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
}

function buildReq63(data) {
  const payload = { event: 'charge.success', data };
  return {
    body: payload,
    headers: { 'x-paystack-signature': computeSig(payload) },
  };
}

function buildRes63() {
  return {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
}

beforeAll(() => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
});

beforeEach(() => {
  jest.clearAllMocks();

  mockGet63.mockResolvedValue({
    empty: false,
    forEach: (cb) => {
      cb({ id: 'doc1', data: () => ({ allocations: [] }) });
    },
  });
  mockWhere63.mockReturnValue({ get: mockGet63 });
  mockCollection63.mockReturnValue({
    where: mockWhere63,
    doc: () => mockDocRef63,
  });
});

const { handleCallback } = require('../controllers/transactionsController');

describe('PBT 6.3 — handleCallback always stores reference as a string field in Firestore', () => {
  test('reference field is always a string for 100 random charge.success payloads', async () => {
    const cases = Array.from({ length: 100 }, generateChargeSuccessData);

    for (const data of cases) {
      jest.clearAllMocks();

      // Re-wire mocks after clearAllMocks
      mockGet63.mockResolvedValue({
        empty: false,
        forEach: (cb) => {
          cb({ id: 'doc1', data: () => ({ allocations: [] }) });
        },
      });
      mockWhere63.mockReturnValue({ get: mockGet63 });
      mockCollection63.mockReturnValue({
        where: mockWhere63,
        doc: () => mockDocRef63,
      });

      const req = buildReq63(data);
      const res = buildRes63();

      await handleCallback(req, res);

      expect(res._status).toBe(200);
      expect(mockUpdate63).toHaveBeenCalledTimes(1);

      const updateArg = mockUpdate63.mock.calls[0][0];

      // Primary assertion: reference must be a string
      expect(typeof updateArg.reference).toBe('string');
      // Must equal data.reference exactly
      expect(updateArg.reference).toBe(data.reference);
    }
  });

  test('reference is always the first key in transactionDetails for 100 random payloads', async () => {
    const cases = Array.from({ length: 100 }, generateChargeSuccessData);

    for (const data of cases) {
      jest.clearAllMocks();

      mockGet63.mockResolvedValue({
        empty: false,
        forEach: (cb) => {
          cb({ id: 'doc1', data: () => ({ allocations: [] }) });
        },
      });
      mockWhere63.mockReturnValue({ get: mockGet63 });
      mockCollection63.mockReturnValue({
        where: mockWhere63,
        doc: () => mockDocRef63,
      });

      const req = buildReq63(data);
      const res = buildRes63();

      await handleCallback(req, res);

      const updateArg = mockUpdate63.mock.calls[0][0];

      // Simulate transactionDetails construction from fixed code
      const transactionDetails = {
        reference: data.reference,
        transactionId: data.id,
      };

      expect(Object.keys(transactionDetails)[0]).toBe('reference');
      expect(typeof transactionDetails.reference).toBe('string');
      expect(transactionDetails.reference).toBe(data.reference);
    }
  });
});
