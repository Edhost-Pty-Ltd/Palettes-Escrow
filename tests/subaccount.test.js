/**
 * Tests for controllers/createSubaccount.js
 *
 * Covers:
 *  - createSubaccount HTTP handler (direct + vendor cache flow)
 */

// ── Service mock ─────────────────────────────────────────────────────────────
const mockPaystackCreate = jest.fn();
jest.mock("../services/paystack", () => ({
  createSubaccount: mockPaystackCreate,
}));

// ── Firebase mock ─────────────────────────────────────────────────────────────
const mockVendorSet = jest.fn().mockResolvedValue();
const mockVendorGet = jest.fn();

jest.mock("../config/firebase", () => ({
  collection: jest.fn(() => ({
    doc: jest.fn(() => ({
      get: mockVendorGet,
      set: mockVendorSet,
    })),
  })),
}));

const { createSubaccount } = require("../controllers/createSubaccount");

// ── HTTP helper ───────────────────────────────────────────────────────────────
const express = require("express");
const http = require("http");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post("/subaccount", createSubaccount);
  return app;
}

function postSubaccount(app, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const data = JSON.stringify(body);
      const options = {
        hostname: "127.0.0.1",
        port,
        path: "/subaccount",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      };
      const req = http.request(options, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        });
      });
      req.on("error", (err) => { server.close(); reject(err); });
      req.write(data);
      req.end();
    });
  });
}

beforeEach(() => jest.clearAllMocks());

// ============================================================================
// Direct creation (no vendorId)
// ============================================================================
describe("createSubaccount — direct (no vendorId)", () => {
  test("returns 400 when required fields are missing", async () => {
    const result = await postSubaccount(buildApp(), { business_name: "Acme Ltd" });
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
  });

  test("returns success and subaccount_code on valid response", async () => {
    mockPaystackCreate.mockResolvedValueOnce({
      data: { subaccount_code: "ACCT_abc123" },
    });

    const result = await postSubaccount(buildApp(), {
      business_name: "Acme Ltd",
      account_number: "1234567890",
      bank_code: "058",
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.subaccount_code).toBe("ACCT_abc123");
    expect(result.body.cached).toBe(false);
  });

  test("sends correct payload to service including default currency ZAR", async () => {
    mockPaystackCreate.mockResolvedValueOnce({ data: { subaccount_code: "ACCT_xyz" } });

    await postSubaccount(buildApp(), {
      business_name: "Acme Ltd",
      account_number: "1234567890",
      bank_code: "058",
    });

    expect(mockPaystackCreate).toHaveBeenCalledWith({
      business_name: "Acme Ltd",
      settlement_bank: "058",
      account_number: "1234567890",
      percentage_charge: 0,
      currency: "ZAR",
    });
  });

  test("respects custom currency when provided", async () => {
    mockPaystackCreate.mockResolvedValueOnce({ data: { subaccount_code: "ACCT_xyz" } });

    await postSubaccount(buildApp(), {
      business_name: "Acme Ltd",
      account_number: "1234567890",
      bank_code: "058",
      currency: "NGN",
    });

    expect(mockPaystackCreate).toHaveBeenCalledWith(expect.objectContaining({ currency: "NGN" }));
  });

  test("returns 500 when service throws", async () => {
    mockPaystackCreate.mockRejectedValueOnce(new Error("Network Error"));

    const result = await postSubaccount(buildApp(), {
      business_name: "Acme Ltd",
      account_number: "1234567890",
      bank_code: "058",
    });

    expect(result.status).toBe(500);
    expect(result.body.success).toBe(false);
  });
});

// ============================================================================
// Vendor cache flow (vendorId provided)
// ============================================================================
describe("createSubaccount — vendor cache flow", () => {
  test("returns 404 when vendor does not exist", async () => {
    mockVendorGet.mockResolvedValueOnce({ exists: false });

    const result = await postSubaccount(buildApp(), {
      vendorId: "ghost_vendor",
      business_name: "Acme Ltd",
      account_number: "1234567890",
      bank_code: "058",
    });

    expect(result.status).toBe(404);
    expect(result.body.success).toBe(false);
    expect(mockPaystackCreate).not.toHaveBeenCalled();
  });

  test("returns cached subaccount_code without calling Paystack", async () => {
    mockVendorGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ paystack_subaccount_code: "ACCT_cached" }),
    });

    const result = await postSubaccount(buildApp(), {
      vendorId: "vendor_1",
      business_name: "Acme Ltd",
      account_number: "1234567890",
      bank_code: "058",
    });

    expect(result.status).toBe(200);
    expect(result.body.subaccount_code).toBe("ACCT_cached");
    expect(result.body.cached).toBe(true);
    expect(mockPaystackCreate).not.toHaveBeenCalled();
  });

  test("creates subaccount and caches code when vendor has none stored", async () => {
    mockVendorGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({}),
    });

    mockPaystackCreate.mockResolvedValueOnce({ data: { subaccount_code: "ACCT_new" } });

    const result = await postSubaccount(buildApp(), {
      vendorId: "vendor_1",
      business_name: "Acme Ltd",
      account_number: "1234567890",
      bank_code: "058",
    });

    expect(result.status).toBe(200);
    expect(result.body.subaccount_code).toBe("ACCT_new");
    expect(result.body.cached).toBe(false);
    expect(mockVendorSet).toHaveBeenCalledWith(
      { paystack_subaccount_code: "ACCT_new" },
      { merge: true }
    );
  });
});
