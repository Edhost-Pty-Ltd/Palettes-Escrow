const paystackService = require('../services/paystack');
const callbackEvents = require('../events');

const createToken = async (req, res) => {
  try {
    const { input } = req.body;

    if (!input.bankAccount?.bank || !input.bankAccount?.accountNumber) {
      return res.status(400).json({
        error: 'Bank account details are required',
        message: 'Please provide bankAccount.bank and bankAccount.accountNumber in the input'
      });
    }

    const subaccountData = {
      business_name: input.name || `${input.user?.givenName} ${input.user?.familyName}`,
      settlement_bank: input.bankAccount.bank,
      account_number: input.bankAccount.accountNumber,
      percentage_charge: 95,
      primary_contact_email: input.user?.email,
      primary_contact_name: `${input.user?.givenName} ${input.user?.familyName}`,
      primary_contact_phone: input.user?.mobile,
      metadata: {
        user: input.user,
        organization: input.organization,
      },
    };

    const result = await paystackService.createSubaccount(subaccountData);

    callbackEvents.emit('tokenCreated', result);

    res.json({
      data: {
        tokenCreate: {
          id: result.data.subaccount_code,
          name: result.data.business_name,
        },
      },
    });
  } catch (error) {
    console.error('Error in createToken:', error);
    res.status(500).json({ error: error.message });
  }
};

const getTokenStatement = async (req, res) => {
  try {
    const { id, first, page } = req.body;

    const result = await paystackService.listTransactions({
      perPage: first || 10,
      page: page || 1,
    });

    const formattedData = result.data.map(txn => ({
      type: txn.channel,
      amount: txn.amount / 100,
      status: txn.status,
      reference: txn.reference,
      createdAt: txn.created_at,
      updatedAt: txn.paid_at,
    }));

    res.json({
      data: {
        tokenStatement: {
          data: formattedData,
        },
      },
    });
  } catch (error) {
    console.error('Error in getTokenStatement:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateToken = async (req, res) => {
  try {
    const { id, input } = req.body;

    const updateData = {
      business_name: input.name || input.organization?.name,
      settlement_bank: input.bankAccount?.bank,
      account_number: input.bankAccount?.accountNumber,
      primary_contact_email: input.user?.email,
      primary_contact_name: `${input.user?.givenName} ${input.user?.familyName}`,
      primary_contact_phone: input.user?.mobile,
      metadata: {
        user: input.user,
        organization: input.organization,
      },
    };

    const result = await paystackService.updateSubaccount(id, updateData);

    res.json({
      data: {
        tokenUpdate: {
          id: result.data.subaccount_code,
          name: result.data.business_name,
          user: input.user,
          organization: input.organization,
          bankAccount: input.bankAccount,
        },
      },
    });
  } catch (error) {
    console.error('Error in updateToken:', error);
    res.status(500).json({ error: error.message });
  }
};

const getTokenDetails = async (req, res) => {
  try {
    const { id } = req.body;

    const result = await paystackService.makePaystackRequest('GET', `/subaccount/${id}`);

    callbackEvents.emit('tokenCreated', result);

    res.json({
      data: {
        token: {
          id: result.data.subaccount_code,
          name: result.data.business_name,
          user: result.data.metadata?.user || {},
          organization: result.data.metadata?.organization || {},
          bankAccount: {
            accountNumber: result.data.settlement_bank,
            bank: result.data.bank,
          },
        },
      },
    });
  } catch (error) {
    console.error('Error in getTokenDetails:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createToken,
  getTokenStatement,
  updateToken,
  getTokenDetails,
};
