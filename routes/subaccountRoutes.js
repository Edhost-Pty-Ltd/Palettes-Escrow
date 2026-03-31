const express = require("express");
const { createSubaccount } = require("../controllers/createSubaccount");
const authenticateJWT = require("../middleware/authJwt");

const router = express.Router();

// POST /api/subaccounts/create
// Body: { business_name, account_number, bank_code, currency?, vendorId? }
// If vendorId is provided, checks Firestore cache before calling Paystack.
router.post("/create", authenticateJWT, createSubaccount);

module.exports = router;
