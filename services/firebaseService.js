const db = require("../config/firebase");
const { createSubaccount, updateSubaccount } = require("../services/paystack");

const PLATFORM_PERCENTAGE_CHARGE = 20;

const getVendorSubaccount = async (userId) => {
  if (!userId) throw new Error("userId is required");

  const querySnap = await db.collection("users")
    .where("professionalVendorID", "==", userId)
    .limit(1)
    .get();

  if (querySnap.empty) {
    throw new Error(`Vendor ${userId} not found`);
  }

  const vendorSnap = querySnap.docs[0];
  const vendorData = vendorSnap.data();

  if (vendorData.role !== "professional") {
    throw new Error("User is not a professional");
  }

  let subaccountCode = vendorData.paystack_subaccount_code;

  if (!subaccountCode) {

    const { accountDetails } = vendorData;
    if (!accountDetails?.accountNumber || !accountDetails?.branchNumber) {
      throw new Error(`Vendor ${userId} has incomplete banking details`);
    }

    const bankCode = accountDetails.paystackBankCode || accountDetails.branchNumber;

    const subaccountPayload = {
      business_name: accountDetails.accountHolder || vendorData.displayName || userId,
      settlement_bank: bankCode,
      account_number: accountDetails.accountNumber,
      percentage_charge: PLATFORM_PERCENTAGE_CHARGE,
      currency: "ZAR",
    };

    const result = await createSubaccount(subaccountPayload);

    if (!result || !result.status || !result.data?.subaccount_code) {
      throw new Error(`Subaccount creation failed: ${result?.message || 'No subaccount_code returned'}`);
    }

    subaccountCode = result.data.subaccount_code;

    await vendorSnap.ref.update({
      paystack_subaccount_code: subaccountCode,
      paystack_percentage_charge: PLATFORM_PERCENTAGE_CHARGE,
    });
  } else {
    const storedPercentage = vendorData.paystack_percentage_charge;
    if (storedPercentage !== PLATFORM_PERCENTAGE_CHARGE) {
      try {
        await updateSubaccount(subaccountCode, { percentage_charge: PLATFORM_PERCENTAGE_CHARGE });
        await vendorSnap.ref.update({ paystack_percentage_charge: PLATFORM_PERCENTAGE_CHARGE });
      } catch (migrationErr) {
        console.error(`[getVendorSubaccount] Migration failed for ${subaccountCode}:`, migrationErr.message);
      }
    }
  }

  const vendorAuthUID = vendorSnap.id;

  return {
    userID: vendorAuthUID,
    professionalVendorID: vendorData.professionalVendorID,
    subaccountCode
  };
};

module.exports = { getVendorSubaccount };
