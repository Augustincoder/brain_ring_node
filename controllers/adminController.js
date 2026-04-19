'use strict';

const User = require('../models/User');
const Question = require('../models/Question');
const GameHistory = require('../models/GameHistory');

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/users
 * Returns all users (excluding password field).
 */
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: 'admin' } })
      .select('-password -playedQuestions')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    console.error('[adminController.getAllUsers]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
};

/**
 * GET /api/admin/users/:id
 * Returns a single user with full details.
 */
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('[adminController.getUserById]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user.' });
  }
};

/**
 * POST /api/admin/users
 * Creates a new player. Only admins can do this (invite-only).
 * Body: { username, password, role? }
 */
const createUser = async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'Username and password are required.' });
    }

    const existing = await User.findOne({ username: username.toLowerCase().trim() });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, message: 'Username already taken.' });
    }

    const user = await User.create({
      username,
      password,
      role: role === 'admin' ? 'admin' : 'player',
    });

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('[adminController.createUser]', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(', ') });
    }
    res.status(500).json({ success: false, message: 'Failed to create user.' });
  }
};

/**
 * PATCH /api/admin/users/:id
 * Updates a user's username or role. Password updates require separate flow.
 */
const updateUser = async (req, res) => {
  try {
    const { username, role, password } = req.body;
    const updateFields = {};

    if (username) updateFields.username = username.toLowerCase().trim();
    if (role && ['admin', 'player'].includes(role)) updateFields.role = role;

    // Password change: handled independently to trigger the pre-save bcrypt hook
    if (password) {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }
      user.password = password;
      Object.assign(user, updateFields);
      await user.save();
      return res.status(200).json({ success: true, data: { _id: user._id, username: user.username, role: user.role } });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('[adminController.updateUser]', error);
    res.status(500).json({ success: false, message: 'Failed to update user.' });
  }
};

/**
 * DELETE /api/admin/users/:id
 * Permanently removes a user. Prevents deleting the admin account.
 */
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (user.role === 'admin') {
      return res
        .status(403)
        .json({ success: false, message: 'Cannot delete the admin account.' });
    }

    await user.deleteOne();
    res.status(200).json({ success: true, message: 'User deleted successfully.' });
  } catch (error) {
    console.error('[adminController.deleteUser]', error);
    res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/questions/bulk
 * Accepts a JSON array of question objects and inserts them in bulk.
 * Body: [{ questionText, correctAnswer, explanation?, category?, difficulty? }, ...]
 */
const bulkCreateQuestions = async (req, res) => {
  try {
    const questions = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Provide a non-empty JSON array of questions.' });
    }

    // Validate required fields on each question before inserting
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.questionText || !q.correctAnswer) {
        return res.status(400).json({
          success: false,
          message: `Question at index ${i} is missing 'questionText' or 'correctAnswer'.`,
        });
      }
    }

    const result = await Question.insertMany(questions, { ordered: false });

    res.status(201).json({
      success: true,
      message: `${result.length} questions inserted successfully.`,
      insertedCount: result.length,
    });
  } catch (error) {
    console.error('[adminController.bulkCreateQuestions]', error);
    // ordered: false may cause BulkWriteError with partial inserts
    if (error.name === 'BulkWriteError') {
      return res.status(207).json({
        success: 'partial',
        message: 'Some questions were inserted; others had errors.',
        insertedCount: error.result?.nInserted ?? 0,
        errors: error.writeErrors?.map((e) => e.errmsg),
      });
    }
    res.status(500).json({ success: false, message: 'Failed to insert questions.' });
  }
};

/**
 * GET /api/admin/questions
 * Returns the full question bank with pagination.
 */
const getAllQuestions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [questions, total] = await Promise.all([
      Question.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      Question.countDocuments(),
    ]);

    res.status(200).json({
      success: true,
      data: questions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[adminController.getAllQuestions]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch questions.' });
  }
};

/**
 * DELETE /api/admin/questions/:id
 * Removes a single question from the bank.
 */
const deleteQuestion = async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found.' });
    }
    res.status(200).json({ success: true, message: 'Question deleted.' });
  } catch (error) {
    console.error('[adminController.deleteQuestion]', error);
    res.status(500).json({ success: false, message: 'Failed to delete question.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/games/history
 * Returns all game history records with populated user + question data.
 * Supports pagination via ?page=&limit= query params.
 */
const getGameHistory = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;
    const gameType = req.query.gameType; // optional filter

    const filter = gameType ? { gameType } : {};

    const [records, total] = await Promise.all([
      GameHistory.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('participants.userId', 'username role')
        .populate('matchLog.questionId', 'questionText correctAnswer category')
        .populate('matchLog.playerAnswers.userId', 'username'),
      GameHistory.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: records,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[adminController.getGameHistory]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch game history.' });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  bulkCreateQuestions,
  getAllQuestions,
  deleteQuestion,
  getGameHistory,
};
