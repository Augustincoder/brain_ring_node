'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getMyProfile, getLeaderboard } = require('../controllers/userController');

// GET /api/user/me — authenticated player profile
router.get('/me', protect, getMyProfile);

// GET /api/user/leaderboard — all authenticated users can view
router.get('/leaderboard', protect, getLeaderboard);

module.exports = router;
