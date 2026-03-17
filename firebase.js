const admin = require('firebase-admin');
const serviceAccount = require('./nnakki-firebase-adminsdk-zjgoq-2af66f2d10.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = db;