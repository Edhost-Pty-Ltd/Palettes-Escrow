const db = require("../config/firebase");
const { createSubaccount: paystackCreateSubaccount } = require("../services/paystack");
const PLATFORM_PERCENTAGE_CHARGE = 20;

const createSubaccount = async (req, res) => {
  const { vendorId, business_name, account_number, bank_code, currency = "ZAR" } = req.body;
  if (!business_name || !account_number || !bank_code) {
    return res.status(400).json({
      success: false,
      message: "business_name, account_number, and bank_code are required",
    });
  }

  try {
    if (vendorId) {
      const querySnap = await db.collection("users")
        .where("professionalVendorID", "==", vendorId)
        .limit(1)
        .get();

      if (querySnap.empty) {
        return res.status(404).json({ success: false, message: `Vendor ${vendorId} not found` });
      }

      const vendorSnap = querySnap.docs[0];

      if (vendorSnap.data().paystack_subaccount_code) {
        return res.json({
          success: true,
          subaccount_code: vendorSnap.data().paystack_subaccount_code,
          cached: true,
        });
      }

      const result = await paystackCreateSubaccount({
        business_name,
        settlement_bank: bank_code,
        account_number,
        percentage_charge: PLATFORM_PERCENTAGE_CHARGE,
        currency,
      });
      const subaccount_code = result.data.subaccount_code;

      await vendorSnap.ref.set({ paystack_subaccount_code: subaccount_code, paystack_percentage_charge: PLATFORM_PERCENTAGE_CHARGE }, { merge: true });

      return res.json({ success: true, subaccount_code, cached: false });
    }

    

  } catch (error) {
    console.error(error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to create subaccount",
    });
  }
};

module.exports = { createSubaccount };
