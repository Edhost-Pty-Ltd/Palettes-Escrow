const jwt = require('jsonwebtoken');
const { admin } = require('../config/firebase');
require('dotenv').config();

const SECRET_KEY = process.env.JWT_SECRET;

const authenticateJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token is missing or invalid' });
  }

  // 1. Try verifying as backend-issued JWT first
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    // Normalise to always expose both .id and .uid
    req.user = { ...decoded, uid: decoded.uid || decoded.id };
    return next();
  } catch {
    // Not a backend JWT — fall through to Firebase check
  }

  // 2. Try verifying as a Firebase ID token
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    // Map Firebase fields to the same shape the rest of the app expects
    req.user = {
      uid: decoded.uid,
      id: decoded.uid,
      username: decoded.email || decoded.uid,
      email: decoded.email || null,
    };
    return next();
  } catch {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

module.exports = authenticateJWT;
