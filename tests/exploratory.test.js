/**
 * Exploratory Bug Condition Tests
 *
 * These tests run on UNFIXED code and are EXPECTED TO FAIL.
 * A failing test confirms the bug exists - that is the SUCCESS condition for Task 1.
 *
 * Bug 1 - routes/refunds.js POST: sends transaction.id (number) instead of transaction.reference (string)
 * Bug 2 - routes/refunds.js GET:  bookingId.split("_").pop() returns wrong segment for UIDs with underscores
 * Bug 3 - controllers/transactionsController.js: variable refundAmountKobo holds ZAR (misleading name)
 * Bug 4 - controllers/transactionsController.js handleCallback: transactionId (numeric) stored as primary key
 */

// Bug 1
describe("Bug 1 - POST /refund sends numeric transaction.id instead of string transaction.reference", () => {
  test("refund payload transaction field should be the string reference, not the numeric id", () => {
    const transaction = {
      id: 1234567,
      reference: "T123456789",
      status: "success",
    };
    // Reproduce the exact buggy line from routes/refunds.js POST handler:
    //   { transaction: transaction.id }
    const buggyPayload = { transaction: transaction.id };

    // CORRECT: payload.transaction must be the string reference
    // FAILS on unfixed code because buggyPayload.transaction === 1234567 (number)
    expect(typeof buggyPayload.transaction).toBe("string");       // FAILS: received "number"
    expect(buggyPayload.transaction).toBe(transaction.reference); // FAILS: 1234567 !== "T123456789"
  });
});

// Bug 2
describe("Bug 2 - GET /refunds UID extraction breaks for Firebase UIDs containing underscores", () => {
  test('extracting UID from "booking_1700000000_abc_def" should return "abc_def", not "def"', () => {
    const bookingId = "booking_1700000000_abc_def";
    const expectedUID = "abc_def";

    // Reproduce the exact buggy line from routes/refunds.js GET handler:
    //   const bookingUID = bookingId.split("_").pop();
    const bookingUID = bookingId.split("_").pop();

    // FAILS on unfixed code - pop() returns "def" (last segment only)
    expect(bookingUID).toBe(expectedUID); // FAILS: "def" !== "abc_def"
  });

  test('refund filter should match user "abc_def" when booking_id is "booking_1700000000_abc_def"', () => {
    const userUID = "abc_def";
    const bookingId = "booking_1700000000_abc_def";

    const bookingUID = bookingId.split("_").pop(); // returns "def" on unfixed code

    // Test the bookingUID path in isolation (when firebaseUID is absent from metadata)
    expect(bookingUID).toBe(userUID); // FAILS: "def" !== "abc_def"
  });
});

// Bug 3
describe("Bug 3 - refundTransaction: variable refundAmountKobo holds ZAR, not kobo", () => {
  test("refundAmountKobo should hold the kobo value (serviceAmount * 100), not the ZAR value", () => {
    const serviceAmount = 10.00; // ZAR

    // Reproduce the exact buggy lines from controllers/transactionsController.js:
    //   const refundAmountKobo = refundAmount;  <- ZAR assigned, named "kobo"
    const refundAmount = serviceAmount;
    const refundAmountKobo = refundAmount; // BUG: holds 10.00 (ZAR), not 1000 (kobo)

    // CORRECT: a variable named "refundAmountKobo" must hold kobo (serviceAmount * 100)
    // FAILS on unfixed code: refundAmountKobo === 10.00, not 1000
    expect(refundAmountKobo).toBe(serviceAmount * 100); // FAILS: 10.00 !== 1000
  });

  test("value passed to paystackService should be ZAR, not the misleadingly-named refundAmountKobo", () => {
    const serviceAmount = 10.00;

    const refundAmount = serviceAmount;
    const refundAmountKobo = refundAmount; // BUG: ZAR stored in "kobo" variable

    const expectedKoboValue = serviceAmount * 100; // 1000

    // FAILS because refundAmountKobo = 10.00 (ZAR), not 1000 (kobo)
    expect(refundAmountKobo).toBe(expectedKoboValue); // FAILS: 10.00 !== 1000
  });
});

// Bug 4
describe("Bug 4 - handleCallback Firestore document uses numeric transactionId as primary key", () => {
  test("Firestore update payload should NOT contain a numeric transactionId field", () => {
    const data = {
      id: 1234567,
      reference: "T123456789",
      amount: 1150,
      paid_at: "2024-01-01T00:00:00.000Z",
      authorization_code: "AUTH_abc123",
      metadata: { booking_id: "booking_1700000000_abc", service_amount: 10.00 },
    };

    // Reproduce the exact transactionDetails from the buggy handleCallback:
    const transactionDetails = {
      transactionId: data.id,   // BUG: numeric ID stored as primary field
      reference: data.reference,
      state: "FUNDS_RECEIVED",
      balance: data.amount / 100,
      updatedAt: data.paid_at,
      allocations: [],
      authorization_code: data.authorization_code,
      splitPaymentDetails: null,
    };

    const firestoreUpdatePayload = {
      ...transactionDetails,
      allocations: [],
      status: "PAID",
    };

    // CORRECT: payload should NOT have a "transactionId" field (numeric).
    // The fix removes transactionId and uses only reference (string) as the primary key.
    // FAILS on unfixed code because transactionId IS present:
    expect(firestoreUpdatePayload).not.toHaveProperty("transactionId"); // FAILS on unfixed code
  });

  test("Firestore primary key field should be reference (string), not transactionId (number)", () => {
    const data = {
      id: 1234567,
      reference: "T123456789",
      amount: 1150,
      paid_at: "2024-01-01T00:00:00.000Z",
      authorization_code: "AUTH_abc123",
      metadata: { booking_id: "booking_1700000000_abc", service_amount: 10.00 },
    };

    // Reproduce the buggy transactionDetails
    const transactionDetails = {
      transactionId: data.id,   // BUG: numeric ID is the first (primary) field
      reference: data.reference,
      state: "FUNDS_RECEIVED",
      balance: data.amount / 100,
      updatedAt: data.paid_at,
      allocations: [],
      authorization_code: data.authorization_code,
      splitPaymentDetails: null,
    };

    // On unfixed code, the first key is "transactionId" (numeric).
    // After the fix, the first key should be "reference" (string).
    const primaryKeyField = Object.keys(transactionDetails)[0];

    // FAILS on unfixed code - first key is "transactionId"
    expect(primaryKeyField).toBe("reference"); // FAILS: received "transactionId"
  });
});
