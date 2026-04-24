# Paystack Payment API

A clean, minimal Paystack payment API with split payment functionality for service bookings.

## Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/Edhost-Pty-Ltd/Palettes-Escrow.git
cd Palettes-Escrow
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**
```bash
cp .env.example .env
# Edit .env with your actual values
```

4. **Configure Firebase**
```bash
cp firebase.example.json your-firebase-service-account.json
# Update firebase.js to point to your service account file
```

5. **Start the server**
```bash
npm start
```

Server runs on `https://nonempty-sierra-paradoxically.ngrok-free.dev`

## Essential Endpoints

### Authentication
- `POST /api/payments/signup` - User registration
- `POST /api/payments/login` - User login

### Payment Processing
- `POST /api/payments/transactionCreate` - Create payment with split logic
- `GET /api/payments/verify/:reference` - Verify payment status
- `POST /api/payments/refund` - Process refund (service amount only)

### Token Management
- `POST /api/payments/tokenCreate` - Create seller subaccount
- `POST /api/payments/updateToken` - Update seller details
- `POST /api/payments/tokenDetails` - Get seller details

### Webhooks
- `POST /api/payments/callback` - Paystack webhook handler

## Split Payment System

- **Customer pays**: Service amount + 15% (5% markup + 10% agent fee)
- **Seller receives**: Service amount only (85% of total payment)
- **Platform keeps**: 15% (covers fees + commission)
- **Refunds**: Only service amount is refundable

## Environment Variables

```env
PORT=3000
PAYSTACK_SECRET_KEY=sk_test_your_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_key_here
PAYSTACK_CALLBACK_URL=https://nonempty-sierra-paradoxically.ngrok-free.dev/api/payments/callback
JWT_SECRET=your_jwt_secret_here
NODE_ENV=development
```

## Security Notes

- Never commit `.env` files or Firebase service account keys
- Use environment variables for all sensitive data
- Firebase service account file should be kept secure and not tracked in git