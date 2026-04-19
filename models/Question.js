'use strict';

const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema(
  {
    questionText: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true,
      maxlength: [1000, 'Question text cannot exceed 1000 characters'],
    },
    correctAnswer: {
      type: String,
      required: [true, 'Correct answer is required'],
      trim: true,
    },
    explanation: {
      type: String,
      trim: true,
      default: '',
    },
    /**
     * Category tag for future filtering (optional but useful for analytics).
     */
    category: {
      type: String,
      trim: true,
      default: 'General',
    },
    /**
     * Difficulty level for adaptive question selection (future use).
     */
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    },
    /**
     * How many times this question has been answered across all matches.
     * Incremented during match finalization to compute global statistics.
     */
    timesAnswered: { type: Number, default: 0 },
    timesAnsweredCorrectly: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: global accuracy percentage for admin analytics
QuestionSchema.virtual('globalAccuracy').get(function () {
  if (this.timesAnswered === 0) return 0;
  return parseFloat(
    ((this.timesAnsweredCorrectly / this.timesAnswered) * 100).toFixed(2)
  );
});

// Text index for future fuzzy-search on question bank management
QuestionSchema.index({ questionText: 'text', category: 1 });

module.exports = mongoose.model('Question', QuestionSchema);
