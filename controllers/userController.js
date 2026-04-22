'use strict';

const User = require('../models/User');

/**
 * GET /api/user/me
 * Returns the authenticated user's full profile:
 * - Stats (games played, correct/wrong, avg time)
 * - Streak + activityCalendar for the calendar heatmap
 * - Excludes password and raw playedQuestions array for performance
 */
const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -playedQuestions');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const prevStreak = user.currentStreak;
    user.recalculateStreak();
    
    if (user.currentStreak !== prevStreak) {
      await user.save();
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('[userController.getMyProfile]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
};

/**
 * GET /api/user/leaderboard
 * Returns top 20 players sorted by totalCorrectAnswers then totalGamesPlayed.
 * Public endpoint for all authenticated users to view rankings.
 */
const getLeaderboard = async (req, res) => {
  try {
    const players = await User.find({ role: 'player' })
      .select('username totalCorrectAnswers totalGamesPlayed currentStreak averageAnswerTime')
      .sort({ totalCorrectAnswers: -1, totalGamesPlayed: -1 })
      .limit(20)
      .lean();

    res.status(200).json({ success: true, data: players });
  } catch (error) {
    console.error('[userController.getLeaderboard]', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard.' });
  }
};

module.exports = { getMyProfile, getLeaderboard };
