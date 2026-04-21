'use strict';

const GameHistory = require('../models/GameHistory');
const User = require('../models/User');
const { roomStore } = require('../sockets/gameState');

/**
 * POST /api/game/override
 * Exclusive admin-only action: flips a player's wrong answer → correct
 * for a specific question in a specific GameHistory document, then
 * recalculates that player's lifetime stats atomically.
 *
 * Body: { gameHistoryId, questionId, userId }
 */
const overrideAnswer = async (req, res) => {
  try {
    const { gameHistoryId, questionId, userId } = req.body;

    if (!gameHistoryId || !questionId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'gameHistoryId, questionId, and userId are all required.',
      });
    }

    const game = await GameHistory.findById(gameHistoryId);
    if (!game) {
      return res.status(404).json({ success: false, message: 'Game record not found.' });
    }

    // ── Authorization: room creator OR global admin ─────────────────────────
    const requesterId = req.user._id.toString();
    const isCreator   = game.creatorId?.toString() === requesterId;
    const isAdmin     = req.user.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the match creator or an admin can override answers.',
      });
    }

    // ── Locate the match log entry for the given question ──────────────────
    const logEntry = game.matchLog.find(
      (entry) => entry.questionId.toString() === questionId
    );

    if (!logEntry) {
      return res.status(404).json({
        success: false,
        message: 'Question not found in this match log.',
      });
    }

    // ── Locate the specific player's answer ────────────────────────────────
    const playerAnswer = logEntry.playerAnswers.find(
      (pa) => pa.userId.toString() === userId
    );

    if (!playerAnswer) {
      return res.status(404).json({
        success: false,
        message: 'This player did not answer this question.',
      });
    }

    if (playerAnswer.isCorrect) {
      return res.status(409).json({
        success: false,
        message: 'Answer is already marked as correct. No override needed.',
      });
    }

    if (playerAnswer.wasOverridden) {
      return res.status(409).json({
        success: false,
        message: 'This answer has already been overridden.',
      });
    }

    // ── Apply override in the match log ────────────────────────────────────
    playerAnswer.isCorrect = true;
    playerAnswer.wasOverridden = true;

    // ── Update participant summary in this game record ─────────────────────
    const participant = game.participants.find(
      (p) => p.userId.toString() === userId
    );
    if (participant) {
      participant.score = Math.max(0, participant.score + 1);
      participant.correctAnswers = Math.max(0, (participant.correctAnswers || 0) + 1);
      participant.wrongAnswers = Math.max(0, (participant.wrongAnswers || 0) - 1);
    }

    // Track override metadata on the game record
    game.overrides.push({
      questionId,
      userId,
      appliedBy: req.user._id,
      appliedAt: new Date(),
    });

    await game.save();

    // ── Recalculate user's lifetime stats atomically ───────────────────────
    await User.findByIdAndUpdate(userId, {
      $inc: {
        totalCorrectAnswers: 1,
        totalWrongAnswers: -1,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Answer overridden and user stats updated successfully.',
    });
  } catch (error) {
    console.error('[gameController.overrideAnswer]', error);
    res.status(500).json({ success: false, message: 'Failed to apply override.' });
  }
};

/**
 * GET /api/game/history/me
 * Returns the authenticated player's personal match history.
 */
const getMyGameHistory = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      GameHistory.find({ 'participants.userId': req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('matchLog.questionId', 'questionText correctAnswer')
        .lean(),
      GameHistory.countDocuments({ 'participants.userId': req.user._id }),
    ]);

    res.status(200).json({
      success: true,
      data: records,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[gameController.getMyGameHistory]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch game history.' });
  }
};

/**
 * GET /api/game/room/check/:code
 * Checks if a room exists and is in the 'waiting' state.
 */
const checkRoomStatus = async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    
    if (!/^\d{4}$/.test(code)) {
      return res.status(200).json({
        exists: false,
        message: 'Kodni 4 ta raqam ko\'rinishida kiriting.',
      });
    }

    console.log(`[gameController] Room check for: "${code}" | Active: [${Array.from(roomStore.keys()).join(', ')}]`);

    const room = roomStore.get(code);

    if (!room) {
      return res.status(200).json({
        exists: false,
        message: 'Xona topilmadi. Kodni tekshirib ko\'ring yoki yangi xona oching.',
      });
    }

    if (room.state === 'finished') {
      return res.status(200).json({
        exists: false,
        message: 'Ushbu o\'yin allaqachon tugagan.',
      });
    }

    return res.status(200).json({
      exists: true,
      gameType: room.gameType,
      playerCount: room.players.size,
      state: room.state,
    });
  } catch (error) {
    console.error('[gameController.checkRoomStatus]', error);
    res.status(200).json({ exists: false, message: 'Serverda xatolik yuz berdi.' });
  }
};

module.exports = { overrideAnswer, getMyGameHistory, checkRoomStatus };
