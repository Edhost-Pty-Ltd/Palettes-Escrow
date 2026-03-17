const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const SECRET_KEY = process.env.JWT_SECRET;

// Mock database (replace with real database logic)
const users = [];

/**
 * Signup Controller
 */
const signup = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    // Check if user already exists
    const existingUser = users.find(user => user.username === username);
    if (existingUser) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save user to database
    const newUser = { username, password: hashedPassword };
    users.push(newUser);

    return res.status(201).json({ message: 'User created successfully.' });
  } catch (error) {
    console.error('Error during signup:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

/**
 * Login Controller
 */
const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    // Check if user exists
    const user = users.find(user => user.username === username);
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    // Generate JWT token
    const token = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '2y' });

    return res.status(200).json({ token });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

module.exports = { signup, login };
