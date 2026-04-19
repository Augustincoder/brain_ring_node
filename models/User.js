'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Never returned in queries by default
    },
    role: {
      type: String,
      enum: ['admin', 'player'],
      default: 'player',
    },

    // ── Statistics ──────────────────────────────────────────────────────────
    totalGamesPlayed: { type: Number, default: 0 },
    totalCorrectAnswers: { type: Number, default: 0 },
    totalWrongAnswers: { type: Number, default: 0 },
    /**
     * Running average of how long (in seconds) the user takes to answer.
     * Recalculated after every match using Welford's online algorithm.
     */
    averageAnswerTime: { type: Number, default: 0 },

    // ── Streak & Calendar ────────────────────────────────────────────────────
    currentStreak: { type: Number, default: 0 },
    /**
     * Array of date strings ('YYYY-MM-DD') representing every unique day the
     * user played a game. The frontend renders this as a calendar heatmap.
     * Duplicates are never inserted (enforced in the finalization logic).
     */
    activityCalendar: {
      type: [String], // e.g. ['2026-04-01', '2026-04-02']
      default: [],
    },
    /**
     * ISO string of the last date the user played.
     * Used to compute streak continuity (gap > 48h → reset streak).
     */
    lastPlayedAt: { type: Date, default: null },

    // ── Progression ──────────────────────────────────────────────────────────
    /**
     * Array of Question ObjectIds the user has already answered in Solo mode.
     * MongoDB $nin queries use this to guarantee non-repeating question pools.
     */
    playedQuestions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question',
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Pre-save hook: hash password ─────────────────────────────────────────────
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ── Instance method: compare passwords ──────────────────────────────────────
UserSchema.methods.comparePassword = async function (plainText) {
  return bcrypt.compare(plainText, this.password);
};

/**
 * Recalculates currentStreak from the activityCalendar array.
 * Sorts dates descending and counts consecutive days from the most recent.
 * A gap of more than 1 calendar day breaks the streak.
 */
UserSchema.methods.recalculateStreak = function () {
  if (!this.activityCalendar || this.activityCalendar.length === 0) {
    this.currentStreak = 0;
    return;
  }

  const sorted = [...new Set(this.activityCalendar)]
    .map((d) => new Date(d))
    .sort((a, b) => b - a); // descending

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const mostRecent = new Date(sorted[0]);
  mostRecent.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((today - mostRecent) / 86_400_000);

  // If the last played day was more than 1 day ago the streak is broken
  if (diffDays > 1) {
    this.currentStreak = 0;
    return;
  }

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    prev.setHours(0, 0, 0, 0);
    curr.setHours(0, 0, 0, 0);
    const gap = Math.floor((prev - curr) / 86_400_000);
    if (gap === 1) {
      streak++;
    } else {
      break;
    }
  }

  this.currentStreak = streak;
};

module.exports = mongoose.model('User', UserSchema);
