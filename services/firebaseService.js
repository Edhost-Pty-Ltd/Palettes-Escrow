const db = require("../config/firebase");
const { createSubaccount, updateSubaccount } = require("../services/paystack");

const PLATFORM_PERCENTAGE_CHARGE = 20; // 10% markup + 10% service fee (covers Paystack fees)

/**
 * Fetch vendor using Firebase UID (document ID)
 */
const getVendorSubaccount = async (userId) => {
  if (!userId) throw new Error("userId is required");

  console.log("[getVendorSubaccount] Received userId:", userId);

  // Query by professionalVendorID field
  const querySnap = await db.collection("users")
    .where("professionalVendorID", "==", userId)
    .limit(1)
    .get();

  if (querySnap.empty) {
    console.log("[getVendorSubaccount] No document found for professionalVendorID:", userId);
    throw new Error(`Vendor ${userId} not found`);
  }

  const vendorSnap = querySnap.docs[0];
  const vendorData = vendorSnap.data();
  console.log("[getVendorSubaccount] Document found. role:", vendorData.role, "| userID field:", vendorData.userID, "| professionalVendorID:", vendorData.professionalVendorID);
  console.log("[getVendorSubaccount] accountDetails:", JSON.stringify(vendorData.accountDetails));

  // 🔥 Ensure it's actually a professional
  if (vendorData.role !== "professional") {
    console.log("[getVendorSubaccount] Role mismatch — expected 'professional', got:", vendorData.role);
    throw new Error("User is not a professional");
  }

  let subaccountCode = vendorData.paystack_subaccount_code;
  console.log("[getVendorSubaccount] paystack_subaccount_code:", subaccountCode);

  if (!subaccountCode) {
    console.log("[getVendorSubaccount] No subaccount found, auto-creating...");

    const { accountDetails } = vendorData;
    if (!accountDetails?.accountNumber || !accountDetails?.branchNumber) {
      throw new Error(`Vendor ${userId} has incomplete banking details`);
    }

    // Prefer paystackBankCode (correct Paystack bank identifier) over branchNumber
    const bankCode = accountDetails.paystackBankCode || accountDetails.branchNumber;
    if (!accountDetails.paystackBankCode) {
      console.warn(`[getVendorSubaccount] paystackBankCode not set for vendor ${userId} — falling back to branchNumber. This may cause subaccount issues. Vendor should set paystackBankCode via GET /api/payments/banks.`);
    }

    const subaccountPayload = {
      business_name: accountDetails.accountHolder || vendorData.displayName || userId,
      settlement_bank: bankCode,
      account_number: accountDetails.accountNumber,
      percentage_charge: PLATFORM_PERCENTAGE_CHARGE,
      currency: "ZAR",
    };
    console.log("[getVendorSubaccount] Creating subaccount with payload:", JSON.stringify(subaccountPayload));

    const result = await createSubaccount(subaccountPayload);
    console.log("[getVendorSubaccount] Paystack createSubaccount response:", JSON.stringify(result));

    if (!result || !result.status || !result.data?.subaccount_code) {
      throw new Error(`Subaccount creation failed: ${result?.message || 'No subaccount_code returned'}`);
    }

    subaccountCode = result.data.subaccount_code;
    console.log("[getVendorSubaccount] Subaccount created:", subaccountCode);

    // Persist subaccount code and current percentage to Firestore
    await vendorSnap.ref.update({
      paystack_subaccount_code: subaccountCode,
      paystack_percentage_charge: PLATFORM_PERCENTAGE_CHARGE,
    });
  } else {
    // Lazy migration: update existing subaccounts that are on an old percentage
    const storedPercentage = vendorData.paystack_percentage_charge;
    if (storedPercentage !== PLATFORM_PERCENTAGE_CHARGE) {
      // Run migration in the background — never block or fail the main escrow flow
      try {
        console.log(`[getVendorSubaccount] Migrating subaccount ${subaccountCode} from ${storedPercentage}% to ${PLATFORM_PERCENTAGE_CHARGE}%`);
        await updateSubaccount(subaccountCode, { percentage_charge: PLATFORM_PERCENTAGE_CHARGE });
        // Only update Firestore after Paystack confirms the change
        await vendorSnap.ref.update({ paystack_percentage_charge: PLATFORM_PERCENTAGE_CHARGE });
        console.log(`[getVendorSubaccount] Migration complete for ${subaccountCode}`);
      } catch (migrationErr) {
        // Log and continue — the subaccount still works, just on the old percentage
        console.error(`[getVendorSubaccount] Migration failed for ${subaccountCode}:`, migrationErr.message);
      }
    }
  }

  // Use the Firestore document ID as the authoritative Firebase Auth UID
  const vendorAuthUID = vendorSnap.id;
  console.log("[getVendorSubaccount] Returning:", { vendorAuthUID, professionalVendorID: vendorData.professionalVendorID, subaccountCode });

  return {
    userID: vendorAuthUID, // Firestore doc ID = Firebase Auth UID
    professionalVendorID: vendorData.professionalVendorID,
    subaccountCode
  };
};

module.exports = { getVendorSubaccount };