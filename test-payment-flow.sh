#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3000/api"

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Palettes Escrow - Payment Flow Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}\n"

# Check if server is running
echo -e "${BLUE}📋 Checking server health...${NC}"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ "$HEALTH" != "200" ]; then
  echo -e "${RED}❌ Server is not running. Start the server with: npm start${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Server is running\n${NC}"

# Generate unique username
UNIQUE_ID=$(date +%s)
USERNAME="testuser_$UNIQUE_ID"
PASSWORD="testpass123"

# Step 1: Signup
echo -e "${BLUE}Step 1️⃣  Signup User${NC}"
echo "Username: $USERNAME"
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\"
  }")

echo "$SIGNUP_RESPONSE" | jq '.' 2>/dev/null || echo "$SIGNUP_RESPONSE"
echo ""

# Step 2: Login
echo -e "${BLUE}Step 2️⃣  Login & Get JWT Token${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\"
  }")

echo "$LOGIN_RESPONSE" | jq '.' 2>/dev/null || echo "$LOGIN_RESPONSE"

# Extract JWT token
JWT_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token' 2>/dev/null)

if [ -z "$JWT_TOKEN" ] || [ "$JWT_TOKEN" == "null" ]; then
  echo -e "${RED}❌ Failed to get JWT token${NC}"
  exit 1
fi

echo -e "${GREEN}✅ JWT Token obtained: ${JWT_TOKEN:0:50}...${NC}\n"

# Step 3: Create Transaction
echo -e "${BLUE}Step 3️⃣  Create Payment Transaction${NC}"
BOOKING_ID="booking_test_$UNIQUE_ID"

TRANSACTION_RESPONSE=$(curl -s -X POST "$BASE_URL/payments/transactionCreate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d "{
    \"input\": {
      \"amount\": 500,
      \"email\": \"testbuyer_$UNIQUE_ID@example.com\",
      \"buyer\": {
        \"givenName\": \"Test\",
        \"familyName\": \"Buyer\"
      },
      \"title\": \"Service Payment\",
      \"description\": \"Test payment for escrow service\",
      \"booking_id\": \"$BOOKING_ID\"
    }
  }")

echo "$TRANSACTION_RESPONSE" | jq '.' 2>/dev/null || echo "$TRANSACTION_RESPONSE"

# Extract reference
PAYMENT_REFERENCE=$(echo "$TRANSACTION_RESPONSE" | jq -r '.reference' 2>/dev/null)

if [ -z "$PAYMENT_REFERENCE" ] || [ "$PAYMENT_REFERENCE" == "null" ]; then
  echo -e "${RED}❌ Failed to create transaction${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Transaction created with reference: $PAYMENT_REFERENCE${NC}\n"

# Display payment link
PAYMENT_LINK=$(echo "$TRANSACTION_RESPONSE" | jq -r '.paymentLink' 2>/dev/null)
echo -e "${BLUE}💳 Payment Link:${NC}"
echo "$PAYMENT_LINK"
echo ""

# Step 4: Verify Payment (may show as pending until Paystack callback)
echo -e "${BLUE}Step 4️⃣  Verify Payment Status${NC}"
echo "Waiting 2 seconds for Paystack to process..."
sleep 2

VERIFY_RESPONSE=$(curl -s -X GET "$BASE_URL/payments/verify/$PAYMENT_REFERENCE" \
  -H "Content-Type: application/json")

echo "$VERIFY_RESPONSE" | jq '.' 2>/dev/null || echo "$VERIFY_RESPONSE"

# Extract status
PAYMENT_STATUS=$(echo "$VERIFY_RESPONSE" | jq -r '.paymentStatus' 2>/dev/null)

if [ "$PAYMENT_STATUS" == "completed" ]; then
  echo -e "${GREEN}✅ Payment verified as completed${NC}"
elif [ "$PAYMENT_STATUS" == "pending" ]; then
  echo -e "${BLUE}⏳ Payment is still pending (waiting for Paystack callback)${NC}"
else
  echo -e "${BLUE}ℹ️  Payment status: $PAYMENT_STATUS${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Test Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "📊 Summary:"
echo -e "  • Username: $USERNAME"
echo -e "  • Booking ID: $BOOKING_ID"
echo -e "  • Payment Reference: $PAYMENT_REFERENCE"
echo -e "  • Amount: 500 ZAR"
echo -e "  • Status: $PAYMENT_STATUS"
echo ""
echo -e "💡 Manual Verification:"
echo -e "  curl -X GET \"$BASE_URL/payments/verify/$PAYMENT_REFERENCE\""
