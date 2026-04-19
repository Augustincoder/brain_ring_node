'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/** Sign and return a JWT for the given user id */
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

/**
 * POST /api/auth/login
 * Accepts { username, password }.
 * Returns JWT + sanitized user object on success.
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'Username and password are required.' });
    }

    // Explicitly select password which is excluded by default
    const user = await User.findOne({ username: username.toLowerCase().trim() }).select(
      '+password'
    );

    if (!user || !(await user.comparePassword(password))) {
      return res
        .status(401)
        .json({ success: false, message: 'Invalid username or password.' });
    }

    const token = signToken(user._id);

    // Strip sensitive fields before sending
    const userPayload = {
      _id: user._id,
      username: user.username,
      role: user.role,
      totalGamesPlayed: user.totalGamesPlayed,
      totalCorrectAnswers: user.totalCorrectAnswers,
      totalWrongAnswers: user.totalWrongAnswers,
      averageAnswerTime: user.averageAnswerTime,
      currentStreak: user.currentStreak,
    };

    res.status(200).json({
      success: true,
      token,
      user: userPayload,
    });
  } catch (error) {
    console.error('[authController.login]', error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

module.exports = { login };
