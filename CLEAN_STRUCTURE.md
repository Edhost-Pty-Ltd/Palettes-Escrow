# Clean Paystack API Structure

## Files Kept (Essential Only)

### Core Application
- `server.js` - Main server entry point
- `package.json` - Dependencies (cleaned up)
- `.env` - Environment variables
- `README.md` - Documentation

### Controllers (Business Logic)
- `controllers/jwtController.js` - Authentication
- `controllers/paymentController.js` - Payment verification
- `controllers/tokenController.js` - Subaccount management
- `controllers/transactionsController.js` - Transaction processing
- `controllers/allocationsController.js` - Delivery management

### Services
- `services/paystack.js` - Paystack API integration

### Routes
- `routes/payments.js` - API endpoints (cleaned)

### Middleware
- `middleware/authJwt.js` - JWT authentication

### Configuration
- `events.js` - Event handling
- `firebase.js` - Database connection
- `ENDPOINTS_SIMPLE_LIST.txt` - API reference

## Files Removed
- All documentation files (API_DOCUMENTATION.md, etc.)
- GraphQL implementation (not needed for REST API)
- Test files and Postman collections
- Unused middleware (webhookVerification.js)
- Unnecessary dependencies (GraphQL, Apollo, etc.)

## Essential Endpoints Only

### Authentication
- POST /api/payments/signup
- POST /api/payments/login

### Core Payment Flow
- POST /api/payments/transactionCreate
- GET /api/payments/verify/:reference
- POST /api/payments/refund

### Subaccount Management
- POST /api/payments/tokenCreate
- POST /api/payments/updateToken
- POST /api/payments/tokenDetails

### Delivery Management
- POST /api/payments/allocationStartDelivery
- POST /api/payments/allocationAcceptDelivery
- POST /api/payments/allocationDetails

### Webhooks
- POST /api/payments/callback

## Clean Dependencies
```json
{
  "axios": "HTTP client for Paystack API",
  "bcrypt": "Password hashing",
  "dotenv": "Environment variables",
  "express": "Web framework",
  "firebase-admin": "Database",
  "jsonwebtoken": "Authentication"
}
```

The codebase is now clean, minimal, and focused only on essential payment functionality.