const admin = require('firebase-admin');

const serviceAccount = {
  projectId: process.env.FB_PROJECT_ID,
  clientEmail: process.env.FB_CLIENT_EMAIL,
  privateKey: process.env.FB_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

module.exports = db;
module.exports.admin = admin;