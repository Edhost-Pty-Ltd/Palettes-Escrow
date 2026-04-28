# Palettes Escrow API - Complete Flow Documentation

## Overview

This API implements a complete payment and escrow system with Paystack integration, featuring split payments between a platform and sellers, vendor subaccount management, and refund processing. All amounts are in **ZAR (South African Rand)**.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Authentication Flow](#authentication-flow)
3. [Transaction Initialization Flow](#transaction-initialization-flow)
4. [Subaccount Management](#subaccount-management)
5. [Split Payment System](#split-payment-system)
6. [Webhook Callback Processing](#webhook-callback-processing)
7. [Refund Flow](#refund-flow)
8. [API Endpoints Reference](#api-endpoints-reference)

---

## Architecture

### Technology Stack

- **Framework**: Express.js
- **Database**: Firebase Firestore
- **Payment Provider**: Paystack
- **Authentication**: JWT (JSON Web Tokens)
- **Password Hashing**: bcrypt

### Key Collections in Firestore

- `users` - Stores user/vendor information with subaccount details
- `escrowTransactions` - Escrow payment records
- `appointments_bookings` - Booking/service records
- `refunds` - Refund transaction records
- `webhook_failures` - Failed webhook deliveries

---

## Authentication Flow

### User Registration

```
POST /api/payments/signup
Content-Type: application/json

{
  "username": "vendor@example.com",
  "password": "securepassword123"
}
```

**Process:**
1. Validates username and password are provided
2. Checks if username already exists
3. Hashes password using bcrypt (10 salt rounds)
4. Creates user document in Firestore with timestamp

**Response:**
```json
{
  "message": "User created successfully."
}
```

### User Login

```
POST /api/payments/login
Content-Type: application/json

{
  "username": "vendor@example.com",
  "password": "securepassword123"
}
```

**Process:**
1. Finds user by username
2. Compares provided password with hashed password
3. Generates JWT token (expires in 2 years)
4. Returns token for subsequent authenticated requests

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Using the Token:**
Include in all subsequent authenticated requests:
```
Authorization: Bearer <token>
```

---

## Transaction Initialization Flow

### Step 1: Create Transaction with Payment Link

```
POST /api/payments/transactionCreate
Authorization: Bearer <token>
Content-Type: application/json

{
  "input": {
    "amount": 500,                          // ZAR - service amount
    "buyer": {
      "email": "buyer@example.com",
      "givenName": "John",
      "familyName": "Doe"
    },
    "booking_id": "booking123",             // Optional
    "seller_subaccount": "ACCT_xyz123",     // Optional - vendor's subaccount
    "escrow_id": "escrow456",               // Optional - escrow reference
    "title": "Professional Service",
    "description": "Service description"
  }
}
```

### Flow Diagram: Transaction Initialization

```
┌─────────────────────────────────────────────────────────────────┐
│ Client sends transaction creation request with payment details  │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │ 1. Validate Input                      │
        │    - Amount (positive, finite number)  │
        │    - Email (valid format)              │
        │    - Optional fields (type check)      │
        └────────────────────┬───────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │ 2. Resolve Seller Subaccount           │
        │    - Use provided subaccount OR        │
        │    - Fetch from escrow metadata        │
        └────────────────────┬───────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │ 3. Prepare Payment Data                │
        │    - Amount in ZAR                     │
        │    - Store metadata (booking, buyer)   │
        │    - Attach subaccount if available    │
        └────────────────────┬───────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │ 4. Call Paystack initializeTransaction │
        │    - Converts ZAR to Kobo (×100)       │
        │    - Sends to Paystack API             │
        └────────────────────┬───────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │ 5. Return Payment Link to Client       │
        │    - authorization_url (Paystack form) │
        │    - reference (transaction ID)        │
        │    - amount & currency                 │
        └────────────────────────────────────────┘
```

**Response:**
```json
{
  "paymentLink": "https://checkout.paystack.com/...",
  "reference": "1234567890",
  "amount": 500,
  "currency": "ZAR"
}
```

### Step 2: Customer Completes Payment

1. Customer clicks payment link → redirects to Paystack checkout
2. Customer enters payment method (card, bank transfer, USSD)
3. Paystack processes payment
4. Callback sent to your server (webhook)

---

## Subaccount Management

### Understanding Subaccounts

Subaccounts in Paystack enable **split payments**:
- Platform keeps a percentage (20%)
- Vendor receives the remainder (80%)
- Settlement happens automatically to vendor's bank account

### Creating a Subaccount (Automatic)

Subaccounts are **automatically created** when:
1. A transaction is created with a vendor's escrow
2. The vendor has incomplete banking details

**Process:**
```
Vendor triggers escrow creation
        │
        ▼
API fetches vendor from Firebase
        │
        ▼
Checks if paystack_subaccount_code exists
        │
        ├─ If exists: Use existing
        │
        └─ If not: AUTO-CREATE
              │
              ▼
         Validate banking details:
         - accountNumber
         - branchNumber (or paystackBankCode)
              │
              ▼
         Call Paystack createSubaccount:
         - business_name
         - settlement_bank (bank code)
         - account_number
         - percentage_charge: 20%
         - currency: ZAR
              │
              ▼
         Save subaccount_code to Firebase:
         - paystack_subaccount_code
         - paystack_percentage_charge
```

### Manual Subaccount Creation

```
POST /api/payments/create-subaccount
Authorization: Bearer <token>
Content-Type: application/json

{
  "input": {
    "name": "John's Services",
    "user": {
      "email": "john@example.com",
      "givenName": "John",
      "familyName": "Doe",
      "mobile": "+27812345678"
    },
    "bankAccount": {
      "bank": "007",                    // Paystack bank code
      "accountNumber": "1234567890"
    },
    "organization": {
      "name": "John's Business"
    }
  }
}
```

**Response:**
```json
{
  "data": {
    "tokenCreate": {
      "id": "ACCT_xyz123",
      "name": "John's Services"
    }
  }
}
```

---

## Split Payment System

### How Split Payments Work

When a transaction is created with a subaccount:

**Amount: R500 (total paid by customer)**

```
┌────────────────────────────────────────┐
│ Total Payment: R500 (ZAR)              │
├────────────────────────────────────────┤
│ Platform Fee (20%):    R100            │  ← Platform keeps
├────────────────────────────────────────┤
│ Vendor Receives (80%): R400            │  ← Automatically settled
└────────────────────────────────────────┘
```

### Configuration

- **Platform percentage**: 20% (defined in `firebaseService.js`)
- **Vendor percentage**: 80% (automatic)
- Set via `percentage_charge` in Paystack subaccount
- Can be updated via `updateSubaccount` endpoint

### Automatic Settlement

Paystack automatically:
1. Deducts platform fee (20%)
2. Settles remaining 80% to vendor's bank account
3. Sends settlement notifications

---

## Webhook Callback Processing

### Webhook Signature Verification

When Paystack sends a callback:

```
POST /api/payments/callback
Content-Type: application/json
X-Paystack-Signature: <HMAC-SHA512-signature>

{
  "event": "charge.success",
  "data": {
    "id": 12345,
    "reference": "1234567890",
    "amount": 50000,
    "status": "success",
    "customer": { ... },
    "metadata": { ... },
    "authorization": { ... }
  }
}
```

**Signature Verification Process:**

```javascript
hash = HMAC-SHA512(
  payload = JSON.stringify(callbackPayload),
  secret = PAYSTACK_SECRET_KEY
)

if (hash !== X-Paystack-Signature header) {
  reject as invalid
}
```

### Handling Payment Success

**Event:** `charge.success` or `preauthorization.success`

```
Webhook received
    │
    ▼
Verify signature using PAYSTACK_SECRET_KEY
    │
    ▼
Extract transaction data:
- reference
- amount (in kobo, divide by 100 for ZAR)
- status
- metadata
    │
    ▼
Set state = "FUNDS_RECEIVED"
    │
    ▼
Emit "FUNDS_RECEIVED" event
    │
    ▼
Search Firestore for booking:
- Query by metadata.booking_id
- Retry up to 5 times (2s intervals)
    │
    ▼
Update booking document:
- Add transaction details
- Set status = "PAID"
- Store allocations
    │
    ▼
If escrow_id in metadata:
- Update escrowTransaction
- Set paymentStatus = "paid"
- Set status = "active"
    │
    ▼
Return 200 OK
```

### Handling Refund Webhooks

**Events:** `refund.processed` or `refund.failed`

```
Webhook received
    │
    ▼
Extract refund status and reference
    │
    ▼
Find refund record in Firestore
    │
    ▼
Update refund status:
- Set status = "processed" or "failed"
- Update timestamp
```

### Error Handling

If booking not found after 5 retries:
1. Log error with booking_id
2. Store failure in `webhook_failures` collection
3. Manual intervention may be required
4. Can retry later with same reference

---

## Refund Flow

### Step 1: Initiate Refund

```
POST /api/refunds/
Authorization: Bearer <token>
Content-Type: application/json

{
  "reference": "1234567890",    // Paystack transaction reference
  "amount": 500                 // Optional - specific amount, defaults to full service amount
}
```

### Complete Refund Flow Diagram

```
┌──────────────────────────────────────────────────────┐
│ Client submits refund request                        │
└─────────────────────┬────────────────────────────────┘
                      │
                      ▼
    ┌─────────────────────────────────┐
    │ 1. Validate Input               │
    │    - Reference required         │
    │    - No duplicate refunds       │
    └──────────────┬──────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │ 2. Verify Transaction           │
    │    - Call Paystack verify API   │
    │    - Confirm status = success   │
    └──────────────┬──────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │ 3. Extract Metadata             │
    │    - service_amount             │
    │    - markup_amount              │
    │    - agent_service_fee          │
    │    - booking_id, escrow_id      │
    └──────────────┬──────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │ 4. Calculate Refund Amount      │
    │    - If amount provided: use it │
    │    - Max = service_amount       │
    │    (markup/fees non-refundable) │
    └──────────────┬──────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │ 5. Call Paystack Refund API     │
    │    - Send reference & amount    │
    │    - Paystack processes refund  │
    └──────────────┬──────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │ 6. Store Refund Record          │
    │    - Save to refunds collection │
    │    - Status = pending           │
    └──────────────┬──────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │ 7. Update Escrow (if applicable)│
    │    - Set status = refunded      │
    │    - Set payoutStatus = refunded│
    └──────────────┬──────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │ 8. Wait for Webhook Callback    │
    │    - Paystack sends refund event│
    │    - Status updated to processed│
    └──────────────────────────────────┘
```

### Refund Amount Calculation

**Original Transaction: R500**

| Component | Amount | Status |
|-----------|--------|--------|
| Service Amount | R400 | ✅ Refundable |
| Platform Fee (20%) | R100 | ❌ Non-refundable |
| **Total Refund Possible** | **R400** | |

**Refund Request Options:**

```javascript
// Option 1: Full service amount refund
POST /api/refunds/
{ "reference": "1234567890" }
// → Refunds R400

// Option 2: Partial refund
POST /api/refunds/
{ 
  "reference": "1234567890",
  "amount": 250  
}
// → Refunds R250 (within service amount limit)

// Option 3: Attempt invalid refund
POST /api/refunds/
{ 
  "reference": "1234567890",
  "amount": 450  
}
// → ERROR: Cannot exceed service amount (R400)
```

### Refund Record Structure

```json
{
  "reference": "1234567890",
  "paystackRefundId": 67890,
  "firebaseUID": "user123",
  "bookingId": "booking123",
  "escrowId": "escrow456",
  "refundedAmount": 400,
  "serviceAmount": 400,
  "totalPaid": 500,
  "currency": "ZAR",
  "status": "pending",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Refund Webhook Updates

When Paystack sends refund webhook:

```
Event: refund.processed
    │
    ▼
Update refund record:
- status = "processed"
- updatedAt = now

Event: refund.failed
    │
    ▼
Update refund record:
- status = "failed"
- updatedAt = now
```

---

## API Endpoints Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payments/signup` | ❌ | Register new user |
| POST | `/api/payments/login` | ❌ | Login and get JWT token |

### Transactions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payments/transactionCreate` | ✅ | Create transaction & payment link |
| GET | `/api/payments/verify/:reference` | ❌ | Verify payment status |
| POST | `/api/payments/callback` | ❌ | Paystack webhook handler |

### Refunds

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/refunds/` | ✅ | Initiate refund |
| GET | `/api/refunds/` | ✅ | Get user's refunds |

### Subaccounts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payments/create-subaccount` | ✅ | Create vendor subaccount |
| POST | `/api/payments/updateToken` | ✅ | Update subaccount |
| POST | `/api/payments/tokenDetails` | ✅ | Get subaccount info |

### Allocations/Delivery

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payments/allocationStartDelivery` | ✅ | Start delivery |
| POST | `/api/payments/allocationAcceptDelivery` | ✅ | Accept/complete delivery |
| POST | `/api/payments/allocationDetails` | ✅ | Get allocation info |

### Escrow

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/escrow` | ✅ | Create escrow |
| GET | `/api/escrow/:id` | ✅ | Get escrow details |

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | ❌ | API health check |
| GET | `/api/test` | ❌ | Test backend |

---

## Data Flow Summary

### Complete End-to-End Flow

```
1. USER AUTHENTICATION
   └─→ signup → Firebase user
   └─→ login → JWT token

2. VENDOR SETUP (Automatic)
   └─→ Transaction creation
   └─→ Fetch vendor details
   └─→ Auto-create Paystack subaccount
   └─→ Store subaccount code

3. PAYMENT INITIALIZATION
   └─→ Create transaction request
   └─→ Validate buyer email & amount
   └─→ Prepare split payment data
   └─→ Call Paystack initialize
   └─→ Return payment link to client

4. CUSTOMER PAYS
   └─→ Customer clicks link
   └─→ Paystack checkout form
   └─→ Customer completes payment
   └─→ Paystack processes charge

5. WEBHOOK NOTIFICATION
   └─→ Paystack sends callback
   └─→ Verify signature
   └─→ Update booking status
   └─→ Update escrow transaction

6. SETTLEMENT
   └─→ Paystack holds funds temporarily
   └─→ Deducts platform fee (20%)
   └─→ Settles vendor amount (80%)
   └─→ Sends settlement notification

7. OPTIONAL: REFUND
   └─→ Refund request with reference
   └─→ Verify transaction eligible
   └─→ Calculate refundable amount
   └─→ Call Paystack refund API
   └─→ Paystack processes refund
   └─→ Refund webhook updates status
```

---

## Environment Variables

```env
# Paystack Configuration
PAYSTACK_SECRET_KEY=sk_live_xxxxx
PAYSTACK_BASE_URL=https://api.paystack.co
PAYSTACK_CALLBACK_URL=https://yourserver.com/api/payments/callback

# Firebase Configuration
FIREBASE_PROJECT_ID=your-project
FIREBASE_PRIVATE_KEY=-----BEGIN...
FIREBASE_CLIENT_EMAIL=firebase@...

# JWT Configuration
JWT_SECRET=your-secret-key-here

# Server Configuration
PORT=3000
NODE_ENV=production
```

---

## Error Handling

### Common Error Responses

```json
{
  "error": "Validation failed",
  "message": "Buyer email is required"
}
```

```json
{
  "error": "Payment initialization failed",
  "message": "No authorization data returned"
}
```

```json
{
  "message": "Cannot determine refundable amount. service_amount not found in transaction metadata."
}
```

### Webhook Failure Handling

If webhook processing fails:
1. Error is logged with details
2. Record stored in `webhook_failures` collection
3. Contains: event data, failure reason, timestamp
4. Manual intervention recommended for review

---

## Best Practices

### For Integrators

1. **Always verify payment** before delivering service
   - Call `GET /api/payments/verify/:reference`
   - Check status is "success"

2. **Store transaction reference** for refund tracking
   - Reference is unique per transaction
   - Required for refunds and reconciliation

3. **Implement retry logic** for webhook processing
   - Network issues may cause delays
   - Store webhook events and process idempotently

4. **Validate metadata** in callbacks
   - Extract booking_id and customer details
   - Use for matching with your order system

5. **Monitor webhook failures**
   - Query `webhook_failures` collection regularly
   - Investigate and retry as needed

### For Security

1. **Keep JWT tokens secure**
   - Don't expose in logs
   - Use HTTPS for transmission
   - Implement token rotation if needed

2. **Verify webhook signatures**
   - Never skip signature verification
   - Always use PAYSTACK_SECRET_KEY
   - Reject requests without valid signature

3. **Validate all user inputs**
   - Email format validation
   - Amount validation (positive, finite)
   - Type checking for all parameters

4. **Use HTTPS in production**
   - All API calls must be over HTTPS
   - Webhooks must use HTTPS callback URLs

---

## Troubleshooting

### Payment Link Returns Error

**Issue**: "Payment initialization failed. No authorization data returned."

**Solutions**:
- Verify PAYSTACK_SECRET_KEY is correct
- Check Paystack account has correct currency (ZAR)
- Ensure email format is valid
- Verify amount is > 0

### Webhook Not Received

**Issue**: Payment completed but booking not updated

**Solutions**:
- Check webhook_failures collection
- Verify callback URL is correct and accessible
- Check firewall allows Paystack IPs
- Verify signature verification code
- Ensure server responds with 200 OK

### Refund Fails

**Issue**: "Refund failed — no response from Paystack"

**Solutions**:
- Verify transaction status is "success"
- Check refund amount doesn't exceed service amount
- Ensure no duplicate refund exists
- Verify Paystack account has refund permissions

### Subaccount Not Created

**Issue**: "Subaccount creation failed"

**Solutions**:
- Verify vendor banking details are complete
- Check bank code is valid Paystack bank code
- Ensure account number is correct
- Verify user role is "professional"

---

## Support & Monitoring

### Logs to Monitor

- Authentication failures
- Payment initialization failures
- Webhook signature verification failures
- Subaccount creation errors
- Refund processing errors
- Database transaction failures

### Metrics to Track

- Transaction success rate
- Average payment processing time
- Refund success rate
- Webhook delivery success rate
- API response times

---

**Last Updated**: April 2026
**API Version**: 1.0
**Status**: Production Ready
