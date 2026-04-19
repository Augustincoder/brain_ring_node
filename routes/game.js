'use strict';

const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { overrideAnswer, getMyGameHistory } = require('../controllers/gameController');

// POST /api/game/override — admin only
router.post('/override', protect, authorize('admin'), overrideAnswer);

// GET /api/game/history/me — authenticated player's own history
router.get('/history/me', protect, getMyGameHistory);

module.exports = router;
