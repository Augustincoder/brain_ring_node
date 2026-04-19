'use strict';

const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  bulkCreateQuestions,
  getAllQuestions,
  deleteQuestion,
  getGameHistory,
} = require('../controllers/adminController');

// All admin routes require a valid JWT + admin role
router.use(protect, authorize('admin'));

// ── User Management ──────────────────────────────────────────────────────────
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.post('/users', createUser);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// ── Question Management ──────────────────────────────────────────────────────
router.get('/questions', getAllQuestions);
router.post('/questions/bulk', bulkCreateQuestions);
router.delete('/questions/:id', deleteQuestion);

// ── Analytics ────────────────────────────────────────────────────────────────
router.get('/games/history', getGameHistory);

module.exports = router;
