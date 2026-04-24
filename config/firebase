const admin = require('firebase-admin');
const serviceAccount = require('../your-firebase-service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Export db as default so existing require('../config/firebase') still works
// Export admin as a named property for middleware that needs it
module.exports = db;
module.exports.admin = admin;
