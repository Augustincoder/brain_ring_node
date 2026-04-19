'use strict';

const mongoose = require('mongoose');

// ── Sub-document: per-player answer log for a single question ─────────────
const PlayerAnswerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isCorrect: { type: Boolean, required: true },
    timeTaken: { type: Number, required: true }, // seconds
    exactAnswerText: { type: String, trim: true, default: '' },
    /**
     * Tracks whether an admin override changed this answer from wrong → correct.
     * Critical for audit trails and re-calculation triggers.
     */
    wasOverridden: { type: Boolean, default: false },
  },
  { _id: false }
);

// ── Sub-document: log entry per question ─────────────────────────────────────
const MatchLogEntrySchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
    },
    playerAnswers: [PlayerAnswerSchema],
  },
  { _id: false }
);

// ── Sub-document: per-participant summary ─────────────────────────────────────
const ParticipantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    score: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    wrongAnswers: { type: Number, default: 0 },
    averageTime: { type: Number, default: 0 }, // seconds
  },
  { _id: false }
);

// ── Main GameHistory schema ───────────────────────────────────────────────────
const GameHistorySchema = new mongoose.Schema(
  {
    matchId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    gameType: {
      type: String,
      enum: ['solo', '1v1', 'group'],
      required: true,
    },
    participants: [ParticipantSchema],
    matchLog: [MatchLogEntrySchema],
    /**
     * Tracks overrides applied by admin after the match.
     * Stored separately for O(1) lookup during override operations.
     */
    overrides: [
      {
        questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        appliedAt: { type: Date, default: Date.now },
        appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient history queries by game type + date
GameHistorySchema.index({ gameType: 1, createdAt: -1 });

module.exports = mongoose.model('GameHistory', GameHistorySchema);
