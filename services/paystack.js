const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';

if (!PAYSTACK_SECRET_KEY) {
  throw new Error('PAYSTACK_SECRET_KEY is required in environment variables');
}

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

    if (data && (method === 'POST' || method === 'PUT')) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`Paystack API Error: ${error.response.data.message || error.response.statusText}`);
    } else if (error.request) {
      throw new Error('Network error: Unable to reach Paystack API');
    } else {
      throw new Error(`Request error: ${error.message}`);
    }
  }
};

const initializeTransaction = async (transactionData) => {
  if (!transactionData.email) {
    throw new Error('Customer email is required');
  }

  if (!transactionData.amount || transactionData.amount <= 0) {
    throw new Error('Valid amount is required');
  }

  const payload = {
    email: transactionData.email,
    amount: zarToKobo(transactionData.amount),
    currency: transactionData.currency || 'ZAR',
    callback_url: transactionData.callback_url,
    metadata: transactionData.metadata || {},
  };

  if (transactionData.subaccount) {
    payload.subaccount = transactionData.subaccount;

    if (transactionData.transaction_charge) {
      payload.transaction_charge = zarToKobo(transactionData.transaction_charge);
    }
  }

  return await makePaystackRequest('POST', '/transaction/initialize', payload);
};

const verifyTransaction = async (reference) => {
  if (!reference) {
    throw new Error('Transaction reference is required');
  }

  return await makePaystackRequest('GET', `/transaction/verify/${reference}`);
};

const listTransactions = async (options = {}) => {
  const queryParams = new URLSearchParams();

  if (options.perPage) queryParams.append('perPage', options.perPage);
  if (options.page) queryParams.append('page', options.page);
  if (options.status) queryParams.append('status', options.status);
  if (options.customer) queryParams.append('customer', options.customer);

  const endpoint = `/transaction${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  return await makePaystackRequest('GET', endpoint);
};

const refundTransaction = async (reference, amount = null, reason = 'Customer refund request') => {
  if (!reference) {
    throw new Error('Transaction reference is required');
  }

  const payload = {
    transaction: reference,
    reason: reason
  };

  if (amount) {
    if (amount <= 0) {
      throw new Error('Refund amount must be positive');
    }
    payload.amount = zarToKobo(amount);
  }

  return await makePaystackRequest('POST', '/refund', payload);
};

const listRefunds = async (options = {}) => {
  const queryParams = new URLSearchParams();

  if (options.perPage) queryParams.append('perPage', options.perPage);
  if (options.page) queryParams.append('page', options.page);
  if (options.reference) queryParams.append('reference', options.reference);

  const endpoint = `/refund${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  return await makePaystackRequest('GET', endpoint);
};

const createSubaccount = async (subaccountData) => {
  const requiredFields = ['business_name', 'settlement_bank', 'account_number'];

  for (const field of requiredFields) {
    if (!subaccountData[field]) {
      throw new Error(`${field} is required for subaccount creation`);
    }
  }

  return await makePaystackRequest('POST', '/subaccount', subaccountData);
};

const listSubaccounts = async (options = {}) => {
  const queryParams = new URLSearchParams();

  if (options.perPage) queryParams.append('perPage', options.perPage);
  if (options.page) queryParams.append('page', options.page);

  const endpoint = `/subaccount${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  return await makePaystackRequest('GET', endpoint);
};

const updateSubaccount = async (subaccountCode, updateData) => {
  if (!subaccountCode) {
    throw new Error('Subaccount code is required');
  }

  return await makePaystackRequest('PUT', `/subaccount/${subaccountCode}`, updateData);
};

const createTransferRecipient = async ({ name, account_number, bank_code, currency = 'ZAR' }) => {
  if (!name || !account_number || !bank_code) {
    throw new Error('name, account_number, and bank_code are required');
  }
  return await makePaystackRequest('POST', '/transferrecipient', {
    type: 'nuban',
    name,
    account_number,
    bank_code,
    currency,
  });
};

const initiateTransfer = async ({ amount, recipient, reason = 'Escrow payout' }) => {
  if (!amount || !recipient) {
    throw new Error('amount and recipient are required');
  }
  return await makePaystackRequest('POST', '/transfer', {
    source: 'balance',
    amount: zarToKobo(amount),
    recipient,
    reason,
    currency: 'ZAR',
  });
};

const verifyWebhookSignature = (payload, signature) => {
  if (!signature || !PAYSTACK_SECRET_KEY) {
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(payload))
      .digest('hex');

    return hash === signature;
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
};

const createCustomer = async (customerData) => {
  if (!customerData.email) {
    throw new Error('Customer email is required');
  }

  return await makePaystackRequest('POST', '/customer', customerData);
};

const getCustomer = async (customerCode) => {
  if (!customerCode) {
    throw new Error('Customer code or email is required');
  }

  return await makePaystackRequest('GET', `/customer/${customerCode}`);
};

const listBanks = async (country = 'ZA') => {
  return await makePaystackRequest('GET', `/bank?country=${country}`);
};

const resolveAccountNumber = async (accountNumber, bankCode) => {
  if (!accountNumber || !bankCode) {
    throw new Error('Account number and bank code are required');
  }

  return await makePaystackRequest('GET', `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
};

const zarToKobo = (amount) => {
  if (typeof amount !== 'number' || amount < 0) {
    throw new Error('Amount must be a positive number');
  }
  return Math.round(amount * 100);
};

const koboToZar = (kobo) => {
  if (typeof kobo !== 'number' || kobo < 0) {
    throw new Error('Kobo amount must be a positive number');
  }
  return kobo / 100;
};

const formatAmount = (amount, currency = 'ZAR') => {
  const zar = koboToZar(amount);
  return `R${zar.toFixed(2)}`;
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  listTransactions,
  refundTransaction,
  listRefunds,
  createSubaccount,
  listSubaccounts,
  updateSubaccount,
  createTransferRecipient,
  initiateTransfer,
  createCustomer,
  getCustomer,
  listBanks,
  resolveAccountNumber,
  verifyWebhookSignature,
  zarToKobo,
  koboToZar,
  formatAmount,
  makePaystackRequest
};
