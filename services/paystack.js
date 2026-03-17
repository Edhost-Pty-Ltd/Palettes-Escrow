// ============================================================================
// PAYSTACK SPLIT PAYMENT SERVICE
// ============================================================================
// This service handles all Paystack payment operations including:
// - Split payment calculations (15% markup: 5% + 10%)
// - Transaction initialization and verification
// - Refund processing (service amount only)
// - Webhook signature verification
// - Subaccount management for fund distribution
// ============================================================================

const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// ============================================================================
// PAYSTACK CONFIGURATION
// ============================================================================

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';

// Validate required environment variables
if (!PAYSTACK_SECRET_KEY) {
  throw new Error('PAYSTACK_SECRET_KEY is required in environment variables');
}

// ============================================================================
// SPLIT PAYMENT CALCULATION
// ============================================================================

/**
 * Calculates split payment breakdown for service bookings
 * 
 * This function implements the 15% markup system where:
 * - 5% markup covers Paystack transaction fees (non-refundable)
 * - 10% agent service fee goes to platform/agents (non-refundable)
 * - Only the original service amount is refundable to customers
 * 
 * @param {number} serviceAmount - The original service cost in ZAR (e.g., 10.00 = R10.00)
 * @returns {Object} Payment breakdown object
 * @returns {number} returns.serviceAmount - Original service cost in ZAR (refundable portion)
 * @returns {number} returns.markupAmount - 5% markup in ZAR to cover Paystack fees (non-refundable)
 * @returns {number} returns.agentServiceFee - 10% agent service fee in ZAR (non-refundable)
 * @returns {number} returns.totalAmount - Total amount customer pays in ZAR (service + markup + agent fee)
 * @returns {number} returns.refundableAmount - Maximum refundable amount in ZAR (equals serviceAmount)
 * 
 * @throws {Error} When serviceAmount is not provided
 * @throws {Error} When serviceAmount is not a number
 * @throws {Error} When serviceAmount is not positive
 * @throws {Error} When serviceAmount is not finite
 * 
 * @example
 * // Calculate split payment for R10.00 service
 * const breakdown = calculateSplitPayment(10.00);
 * // Returns:
 * // {
 * //   serviceAmount: 10.00,     // R10.00 (goes to seller)
 * //   markupAmount: 0.50,       // R0.50 (covers Paystack fees)
 * //   agentServiceFee: 1.00,    // R1.00 (agent commission)
 * //   totalAmount: 11.50,       // R11.50 (customer pays)
 * //   refundableAmount: 10.00   // R10.00 (max refund)
 * // }
 */
const calculateSplitPayment = (serviceAmount) => {
  // ========================================
  // INPUT VALIDATION
  // ========================================
  
  // Check if service amount is provided
  if (!serviceAmount) {
    throw new Error("Service amount is required");
  }
  
  // Ensure service amount is a number
  if (typeof serviceAmount !== "number") {
    throw new Error("Service amount must be a number");
  }
  
  // Ensure service amount is positive
  if (serviceAmount <= 0) {
    throw new Error("Service amount must be a positive number");
  }
  
  // Ensure service amount is finite (not Infinity or NaN)
  if (!Number.isFinite(serviceAmount)) {
    throw new Error("Service amount must be a finite number");
  }
  
  // ========================================
  // SPLIT PAYMENT CALCULATION (IN RANDS)
  // ========================================
  
  // Define percentage rates for split payment
  const markupPercentage = 5;           // 5% to cover Paystack fees
  const agentServiceFeePercentage = 10; // 10% agent service fee
  
  // Calculate markup amount (5% of service amount) - rounded to 2 decimal places
  const markupAmount = Math.round(serviceAmount * (markupPercentage / 100) * 100) / 100;
  
  // Calculate agent service fee (10% of service amount) - rounded to 2 decimal places
  const agentServiceFee = Math.round(serviceAmount * (agentServiceFeePercentage / 100) * 100) / 100;
  
  // Calculate total amount customer pays (all in ZAR)
  // Total = Original Service + Markup + Agent Fee
  const totalAmount = Math.round((serviceAmount + markupAmount + agentServiceFee) * 100) / 100;
  
  // ========================================
  // RETURN PAYMENT BREAKDOWN (ALL IN ZAR)
  // ========================================
  
  return {
    serviceAmount,                    // Original service cost in ZAR (85% - goes to seller)
    markupAmount,                     // 5% markup in ZAR (non-refundable - covers Paystack fees)
    agentServiceFee,                  // 10% agent fee in ZAR (non-refundable - platform commission)
    totalAmount,                      // Total customer pays in ZAR (100%)
    refundableAmount: serviceAmount   // Only service amount is refundable (in ZAR)
  };
};

// ============================================================================
// PAYSTACK API HELPER FUNCTIONS
// ============================================================================

/**
 * Makes authenticated requests to Paystack API
 * 
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} endpoint - API endpoint path
 * @param {Object} data - Request payload (for POST/PUT requests)
 * @returns {Promise<Object>} API response data
 * @throws {Error} When API request fails
 */
const makePaystackRequest = async (method, endpoint, data = null) => {
  try {
    const config = {
      method,
      url: `${PAYSTACK_BASE_URL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    // Add data for POST/PUT requests
    if (data && (method === 'POST' || method === 'PUT')) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    // Enhanced error handling
    if (error.response) {
      // API returned an error response
      throw new Error(`Paystack API Error: ${error.response.data.message || error.response.statusText}`);
    } else if (error.request) {
      // Network error
      throw new Error('Network error: Unable to reach Paystack API');
    } else {
      // Other error
      throw new Error(`Request error: ${error.message}`);
    }
  }
};

// ============================================================================
// TRANSACTION MANAGEMENT
// ============================================================================

/**
 * Initialize a transaction with Paystack
 * 
 * @param {Object} transactionData - Transaction details
 * @param {string} transactionData.email - Customer email
 * @param {number} transactionData.amount - Amount in ZAR (e.g., 11.50)
 * @param {string} transactionData.currency - Currency code (e.g., 'ZAR')
 * @param {string} transactionData.callback_url - Webhook callback URL
 * @param {Object} transactionData.metadata - Additional transaction data
 * @param {string} transactionData.subaccount - Seller subaccount (optional)
 * @param {number} transactionData.transaction_charge - Platform charge in ZAR (optional)
 * @returns {Promise<Object>} Transaction initialization response
 * 
 * @example
 * const result = await initializeTransaction({
 *   email: 'customer@example.com',
 *   amount: 11.50, // R11.50 in ZAR
 *   currency: 'ZAR',
 *   callback_url: 'https://yoursite.com/callback',
 *   metadata: { booking_id: 'booking_123' },
 *   subaccount: 'ACCT_seller123',
 *   transaction_charge: 1.50 // R1.50 platform fee
 * });
 */
const initializeTransaction = async (transactionData) => {
  // Validate required fields
  if (!transactionData.email) {
    throw new Error('Customer email is required');
  }
  
  if (!transactionData.amount || transactionData.amount <= 0) {
    throw new Error('Valid amount is required');
  }

  // Prepare transaction payload
  const payload = {
    email: transactionData.email,
    amount: zarToKobo(transactionData.amount), // Convert ZAR to kobo for Paystack API
    currency: transactionData.currency || 'ZAR',
    callback_url: transactionData.callback_url,
    metadata: transactionData.metadata || {},
  };

  // Add subaccount for split payment if provided
  if (transactionData.subaccount) {
    payload.subaccount = transactionData.subaccount;
    
    // Add transaction charge (platform fee) if provided - convert to kobo
    if (transactionData.transaction_charge) {
      payload.transaction_charge = zarToKobo(transactionData.transaction_charge);
    }
  }

  return await makePaystackRequest('POST', '/transaction/initialize', payload);
};

/**
 * Verify a transaction with Paystack
 * 
 * @param {string} reference - Transaction reference
 * @returns {Promise<Object>} Transaction verification response
 * 
 * @example
 * const verification = await verifyTransaction('ref_123456');
 * console.log(verification.data.status); // 'success' or 'failed'
 */
const verifyTransaction = async (reference) => {
  if (!reference) {
    throw new Error('Transaction reference is required');
  }

  return await makePaystackRequest('GET', `/transaction/verify/${reference}`);
};

/**
 * List all transactions
 * 
 * @param {Object} options - Query options
 * @param {number} options.perPage - Number of transactions per page (default: 50)
 * @param {number} options.page - Page number (default: 1)
 * @param {string} options.status - Filter by status ('success', 'failed', 'abandoned')
 * @param {string} options.customer - Filter by customer ID
 * @returns {Promise<Object>} List of transactions
 */
const listTransactions = async (options = {}) => {
  const queryParams = new URLSearchParams();
  
  if (options.perPage) queryParams.append('perPage', options.perPage);
  if (options.page) queryParams.append('page', options.page);
  if (options.status) queryParams.append('status', options.status);
  if (options.customer) queryParams.append('customer', options.customer);

  const endpoint = `/transaction${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  return await makePaystackRequest('GET', endpoint);
};

// ============================================================================
// REFUND MANAGEMENT
// ============================================================================

/**
 * Process a refund (service amount only for split payments)
 * 
 * @param {string} reference - Transaction reference
 * @param {number} amount - Refund amount in kobo (optional, defaults to full refundable amount)
 * @param {string} reason - Refund reason (optional)
 * @returns {Promise<Object>} Refund response
 * 
 * @example
 * // Full refund (service amount only)
 * const refund = await refundTransaction('ref_123456');
 * 
 * // Partial refund
 * const partialRefund = await refundTransaction('ref_123456', 50000, 'Partial service cancellation');
 */
const refundTransaction = async (reference, amount = null, reason = 'Customer refund request') => {
  if (!reference) {
    throw new Error('Transaction reference is required');
  }

  const payload = {
    transaction: reference,
    reason: reason
  };

  // Add amount if specified (for partial refunds) - convert to kobo
  if (amount) {
    if (amount <= 0) {
      throw new Error('Refund amount must be positive');
    }
    payload.amount = zarToKobo(amount);
  }

  return await makePaystackRequest('POST', '/refund', payload);
};

/**
 * List all refunds
 * 
 * @param {Object} options - Query options
 * @param {number} options.perPage - Number of refunds per page (default: 50)
 * @param {number} options.page - Page number (default: 1)
 * @param {string} options.reference - Filter by transaction reference
 * @returns {Promise<Object>} List of refunds
 */
const listRefunds = async (options = {}) => {
  const queryParams = new URLSearchParams();
  
  if (options.perPage) queryParams.append('perPage', options.perPage);
  if (options.page) queryParams.append('page', options.page);
  if (options.reference) queryParams.append('reference', options.reference);

  const endpoint = `/refund${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  return await makePaystackRequest('GET', endpoint);
};

// ============================================================================
// SUBACCOUNT MANAGEMENT
// ============================================================================

/**
 * Create a subaccount for sellers
 * 
 * @param {Object} subaccountData - Subaccount details
 * @param {string} subaccountData.business_name - Business name
 * @param {string} subaccountData.settlement_bank - Bank code
 * @param {string} subaccountData.account_number - Account number
 * @param {number} subaccountData.percentage_charge - Platform percentage (0-100)
 * @returns {Promise<Object>} Subaccount creation response
 */
const createSubaccount = async (subaccountData) => {
  const requiredFields = ['business_name', 'settlement_bank', 'account_number'];
  
  for (const field of requiredFields) {
    if (!subaccountData[field]) {
      throw new Error(`${field} is required for subaccount creation`);
    }
  }

  return await makePaystackRequest('POST', '/subaccount', subaccountData);
};

/**
 * List all subaccounts
 * 
 * @param {Object} options - Query options
 * @returns {Promise<Object>} List of subaccounts
 */
const listSubaccounts = async (options = {}) => {
  const queryParams = new URLSearchParams();
  
  if (options.perPage) queryParams.append('perPage', options.perPage);
  if (options.page) queryParams.append('page', options.page);

  const endpoint = `/subaccount${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  return await makePaystackRequest('GET', endpoint);
};

/**
 * Update a subaccount
 * 
 * @param {string} subaccountCode - Subaccount code
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} Update response
 */
const updateSubaccount = async (subaccountCode, updateData) => {
  if (!subaccountCode) {
    throw new Error('Subaccount code is required');
  }

  return await makePaystackRequest('PUT', `/subaccount/${subaccountCode}`, updateData);
};

// ============================================================================
// WEBHOOK VERIFICATION
// ============================================================================

/**
 * Verify Paystack webhook signature
 * 
 * @param {Object} payload - Webhook payload
 * @param {string} signature - X-Paystack-Signature header value
 * @returns {boolean} True if signature is valid
 * 
 * @example
 * const isValid = verifyWebhookSignature(req.body, req.headers['x-paystack-signature']);
 * if (!isValid) {
 *   return res.status(400).json({ error: 'Invalid signature' });
 * }
 */
const verifyWebhookSignature = (payload, signature) => {
  if (!signature || !PAYSTACK_SECRET_KEY) {
    return false;
  }

  try {
    // Create hash using webhook payload and secret key
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(payload))
      .digest('hex');

    // Compare with provided signature
    return hash === signature;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
};

// ============================================================================
// CUSTOMER MANAGEMENT
// ============================================================================

/**
 * Create a customer
 * 
 * @param {Object} customerData - Customer details
 * @param {string} customerData.email - Customer email
 * @param {string} customerData.first_name - First name (optional)
 * @param {string} customerData.last_name - Last name (optional)
 * @param {string} customerData.phone - Phone number (optional)
 * @returns {Promise<Object>} Customer creation response
 */
const createCustomer = async (customerData) => {
  if (!customerData.email) {
    throw new Error('Customer email is required');
  }

  return await makePaystackRequest('POST', '/customer', customerData);
};

/**
 * Get customer details
 * 
 * @param {string} customerCode - Customer code or email
 * @returns {Promise<Object>} Customer details
 */
const getCustomer = async (customerCode) => {
  if (!customerCode) {
    throw new Error('Customer code or email is required');
  }

  return await makePaystackRequest('GET', `/customer/${customerCode}`);
};

// ============================================================================
// BANK AND VERIFICATION
// ============================================================================

/**
 * List supported banks
 * 
 * @param {string} country - Country code (e.g., 'ZA' for South Africa)
 * @returns {Promise<Object>} List of banks
 */
const listBanks = async (country = 'ZA') => {
  return await makePaystackRequest('GET', `/bank?country=${country}`);
};

/**
 * Resolve account number
 * 
 * @param {string} accountNumber - Account number
 * @param {string} bankCode - Bank code
 * @returns {Promise<Object>} Account details
 */
const resolveAccountNumber = async (accountNumber, bankCode) => {
  if (!accountNumber || !bankCode) {
    throw new Error('Account number and bank code are required');
  }

  return await makePaystackRequest('GET', `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert amount from ZAR to kobo (cents)
 * 
 * @param {number} amount - Amount in ZAR
 * @returns {number} Amount in kobo
 * 
 * @example
 * const kobo = zarToKobo(10.50); // Returns 1050
 */
const zarToKobo = (amount) => {
  if (typeof amount !== 'number' || amount < 0) {
    throw new Error('Amount must be a positive number');
  }
  return Math.round(amount * 100);
};

/**
 * Convert amount from kobo (cents) to ZAR
 * 
 * @param {number} kobo - Amount in kobo
 * @returns {number} Amount in ZAR
 * 
 * @example
 * const zar = koboToZar(1050); // Returns 10.50
 */
const koboToZar = (kobo) => {
  if (typeof kobo !== 'number' || kobo < 0) {
    throw new Error('Kobo amount must be a positive number');
  }
  return kobo / 100;
};

/**
 * Format amount for display
 * 
 * @param {number} amount - Amount in cents
 * @param {string} currency - Currency code (default: 'ZAR')
 * @returns {string} Formatted amount
 * 
 * @example
 * const formatted = formatAmount(1150, 'ZAR'); // Returns "R11.50"
 */
const formatAmount = (amount, currency = 'ZAR') => {
  const zar = koboToZar(amount);
  return `R${zar.toFixed(2)}`;
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Split payment calculation
  calculateSplitPayment,
  
  // Transaction management
  initializeTransaction,
  verifyTransaction,
  listTransactions,
  
  // Refund management
  refundTransaction,
  listRefunds,
  
  // Subaccount management
  createSubaccount,
  listSubaccounts,
  updateSubaccount,
  
  // Customer management
  createCustomer,
  getCustomer,
  
  // Bank and verification
  listBanks,
  resolveAccountNumber,
  
  // Webhook verification
  verifyWebhookSignature,
  
  // Utility functions
  zarToKobo,
  koboToZar,
  formatAmount,
  
  // Low-level API function (for custom requests)
  makePaystackRequest
};