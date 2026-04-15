const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const db = require('../config/firebase');
require('dotenv').config();

const SECRET_KEY = process.env.JWT_SECRET;
const USERS_COLLECTION = 'users';

/**
 * Signup Controller — persists user to Firestore
 */
const signup = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    // Check if username already exists
    const existing = await db.collection(USERS_COLLECTION)
      .where('username', '==', username)
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();

    await db.collection(USERS_COLLECTION).doc(userId).set({
      username,
      password: hashedPassword,
      createdAt: FieldValue.serverTimestamp(),
    });

    return res.status(201).json({ message: 'User created successfully.' });
  } catch (error) {
    console.error('Error during signup:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

/**
 * Login Controller — verifies against Firestore
 */
const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const snapshot = await db.collection(USERS_COLLECTION)
      .where('username', '==', username)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const userDoc = snapshot.docs[0];
    const user = userDoc.data();

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      { id: userDoc.id, username: user.username },
      SECRET_KEY,
      { expiresIn: '2y' }
    );

    return res.status(200).json({ token });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

module.exports = { signup, login };
