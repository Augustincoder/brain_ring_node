'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { overrideAnswer, getMyGameHistory, checkRoomStatus } = require('../controllers/gameController');

// POST /api/game/override — creator or admin
router.post('/override', protect, overrideAnswer);

// GET /api/game/history/me — authenticated player's own history
router.get('/history/me', protect, getMyGameHistory);

// GET /api/game/room/check/:code — check existence before join
router.get('/room/check/:code', protect, checkRoomStatus);

module.exports = router;
