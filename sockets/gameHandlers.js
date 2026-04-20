'use strict';

const Question = require('../models/Question');
const GameHistory = require('../models/GameHistory');
const User = require('../models/User');
const {
  roomStore,
  TOTAL_QUESTIONS,
  READING_TIME_MS,
  ANSWER_TIME_MS,
  MAX_CHANCES,
  generateRoomCode,
  createRoomState,
  clearRoomTimers,
  serializePlayers,
} = require('./gameState');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize an answer string for comparison:
 * lowercase, strip punctuation, collapse whitespace.
 */
const normalizeAnswer = (str) =>
  str
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Fetch exactly TOTAL_QUESTIONS random questions.
 * For Solo mode, excludes the user's already-played questions.
 * Uses MongoDB $sample for true randomness with a single aggregation.
 */
const fetchQuestions = async (gameType, userId) => {
  const pipeline = [];

  if (gameType === 'solo' && userId) {
    const user = await User.findById(userId).select('playedQuestions').lean();
    const excluded = user?.playedQuestions ?? [];
    if (excluded.length > 0) {
      pipeline.push({ $match: { _id: { $nin: excluded } } });
    }
  }

  pipeline.push({ $sample: { size: TOTAL_QUESTIONS } });

  const questions = await Question.aggregate(pipeline);

  if (questions.length < TOTAL_QUESTIONS) {
    throw new Error(
      `Not enough unique questions. Found ${questions.length}, need ${TOTAL_QUESTIONS}.`
    );
  }

  return questions;
};

/**
 * Compute today's date string in YYYY-MM-DD (UTC).
 */
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Finalizes the match: persists GameHistory, updates all user stats,
 * and emits match_results to the room.
 */
const finalizeMatch = async (io, room) => {
  clearRoomTimers(room);
  room.state = 'finished';

  // ── Build participants summary from room.players ──────────────────────────
  const participants = [];
  for (const [userId, pData] of room.players.entries()) {
    const avgTime =
      pData.answeredCount > 0
        ? parseFloat((pData.totalTime / pData.answeredCount).toFixed(2))
        : 0;

    participants.push({
      userId,
      score: pData.score,
      correctAnswers: pData.correctAnswers,
      wrongAnswers: pData.wrongAnswers,
      averageTime: avgTime,
    });
  }

  // ── Persist to GameHistory ─────────────────────────────────────────────────
  const matchId = `${room.roomCode}-${Date.now()}`;
  let gameHistoryId = null;

  try {
    const record = await GameHistory.create({
      matchId,
      gameType: room.gameType,
      creatorId: room.hostId,          // room creator = override authority
      participants,
      matchLog: room.matchLog,
    });
    gameHistoryId = record._id;
  } catch (err) {
    console.error('[finalizeMatch] GameHistory save failed:', err.message);
  }

  // ── Update each player's lifetime stats ────────────────────────────────────
  const today = todayStr();
  const updatePromises = [];

  for (const [userId, pData] of room.players.entries()) {
    const questionIds = room.questions.map((q) => q._id);

    updatePromises.push(
      (async () => {
        try {
          const user = await User.findById(userId);
          if (!user) return;

          // ── Stats ──────────────────────────────────────────────────────────
          user.totalGamesPlayed += 1;
          user.totalCorrectAnswers += pData.correctAnswers;
          user.totalWrongAnswers += pData.wrongAnswers;

          // Welford's online algorithm for rolling average answer time
          if (pData.answeredCount > 0) {
            const sessionAvg = pData.totalTime / pData.answeredCount;
            const totalPrevAnswers =
              user.totalCorrectAnswers +
              user.totalWrongAnswers -
              pData.correctAnswers -
              pData.wrongAnswers;
            const totalAnswers = totalPrevAnswers + pData.answeredCount;

            if (totalAnswers > 0) {
              user.averageAnswerTime = parseFloat(
                (
                  (user.averageAnswerTime * totalPrevAnswers +
                    sessionAvg * pData.answeredCount) /
                  totalAnswers
                ).toFixed(2)
              );
            }
          }

          // ── Played questions (Solo deduplication) ─────────────────────────
          const existingIds = new Set(
            user.playedQuestions.map((id) => id.toString())
          );
          for (const qId of questionIds) {
            if (!existingIds.has(qId.toString())) {
              user.playedQuestions.push(qId);
            }
          }

          // ── Activity calendar ─────────────────────────────────────────────
          if (!user.activityCalendar.includes(today)) {
            user.activityCalendar.push(today);
          }
          user.lastPlayedAt = new Date();

          // ── Streak recalculation ──────────────────────────────────────────
          user.recalculateStreak();

          await user.save();
        } catch (err) {
          console.error(`[finalizeMatch] Failed to update user ${userId}:`, err.message);
        }
      })()
    );
  }

  await Promise.all(updatePromises);

  // ── Build results payload ─────────────────────────────────────────────────
  const resultsPayload = {
    gameHistoryId,
    matchId,
    gameType: room.gameType,
    participants: participants.map((p) => {
      const pData = room.players.get(p.userId.toString());
      return {
        userId: p.userId,
        username: pData?.username ?? 'Unknown',
        score: p.score,
        correctAnswers: p.correctAnswers,
        wrongAnswers: p.wrongAnswers,
        averageTime: p.averageTime,
      };
    }),
    questions: room.questions.map((q, i) => ({
      questionText: q.questionText,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    })),
  };

  io.to(room.roomCode).emit('match_results', resultsPayload);

  // Cleanup the room from memory after a short delay
  setTimeout(() => {
    roomStore.delete(room.roomCode);
  }, 30_000);
};

// ─────────────────────────────────────────────────────────────────────────────
// GAME LOOP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advances to the next question or finalizes the match if all 10 are done.
 */
const advanceQuestion = (io, room) => {
  clearRoomTimers(room);

  room.currentQIndex += 1;

  if (room.currentQIndex >= room.questions.length) {
    finalizeMatch(io, room);
    return;
  }

  room.currentQuestion = room.questions[room.currentQIndex];
  room.state = 'reading';
  room.buzzerId = null;
  room.chancesLeft = Math.min(MAX_CHANCES, Math.max(1, room.players.size));
  room.currentAnswers = new Map();
  room.questionStartedAt = Date.now();
  room.buzzerOpenAt = null;

  io.to(room.roomCode).emit('question_ready', {
    questionIndex: room.currentQIndex,
    totalQuestions: room.questions.length,
    questionText: room.currentQuestion.questionText,
    readingTimeMs: READING_TIME_MS,
    endTime: room.questionStartedAt + READING_TIME_MS,
    chancesLeft: room.chancesLeft,
    players: serializePlayers(room),
  });

  // 15-second reading timer — if no one buzzes, skip to next question
  room.readingTimer = setTimeout(() => {
    if (room.state !== 'reading') return;

    setTimeout(() => openBuzzerFloor(io, room), 0);
  }, READING_TIME_MS);
};

/**
 * Opens the buzzer floor to all remaining players (used after reading or a wrong answer).
 */
const openBuzzerFloor = (io, room) => {
  clearRoomTimers(room);
  room.state = 'buzzing';
  room.buzzerId = null;
  room.buzzerOpenAt = Date.now();

  io.to(room.roomCode).emit('buzzer_open', {
    chancesLeft: room.chancesLeft,
    answerTimeMs: ANSWER_TIME_MS,
    endTime: room.buzzerOpenAt + ANSWER_TIME_MS,
  });

  // If nobody buzzes within the answer window, move on
  room.answerTimer = setTimeout(() => {
    if (room.state !== 'buzzing') return;

    // Log remaining question as no-answer
    const existingLog = room.matchLog.find(
      (l) => l.questionId.toString() === room.currentQuestion._id.toString()
    );
    if (!existingLog) {
      room.matchLog.push({
        questionId: room.currentQuestion._id,
        playerAnswers: Array.from(room.currentAnswers.values()),
      });
    }

    io.to(room.roomCode).emit('question_timeout', {
      questionIndex: room.currentQIndex,
      correctAnswer: room.currentQuestion.correctAnswer,
      explanation: room.currentQuestion.explanation,
    });

    setTimeout(() => advanceQuestion(io, room), 3_000);
  }, ANSWER_TIME_MS);
};

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET EVENT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

const registerGameHandlers = (io, socket) => {
  const userId = socket.user._id.toString();
  const username = socket.user.username;

  // ── create_room ────────────────────────────────────────────────────────────
  socket.on('create_room', ({ gameType } = {}) => {
    try {
      if (!['solo', '1v1', 'group'].includes(gameType)) {
        return socket.emit('error', { message: 'Invalid gameType. Use solo, 1v1, or group.' });
      }

      const roomCode = generateRoomCode();
      const room = createRoomState({ roomCode, hostId: userId, gameType });

      room.players.set(userId, {
        socketId: socket.id,
        username,
        score: 0,
        correctAnswers: 0,
        wrongAnswers: 0,
        totalTime: 0,
        answeredCount: 0,
      });

      roomStore.set(roomCode, room);
      socket.join(roomCode);
      socket.roomCode = roomCode;

      socket.emit('room_created', {
        roomCode,
        gameType,
        hostId: room.hostId,
        players: serializePlayers(room),
      });

      console.log(`[socket] Room ${roomCode} created by ${username} (${gameType})`);
    } catch (err) {
      console.error('[socket.create_room]', err);
      socket.emit('error', { message: 'Failed to create room.' });
    }
  });

  // ── join_room ──────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomCode } = {}) => {
    try {
      const room = roomStore.get(roomCode);

      if (!room) {
        return socket.emit('error', { message: 'Room not found. Check your code.' });
      }
      if (room.state !== 'waiting') {
        const existingPlayer = room.players.get(userId);
        if (!existingPlayer) {
          return socket.emit('error', { message: 'Game already in progress.' });
        }
        
        // --- RECONNECTION LOGIC ---
        existingPlayer.socketId = socket.id;
        existingPlayer.isOffline = false;
        socket.join(roomCode);
        socket.roomCode = roomCode;
        
        // Refresh local basic state
        socket.emit('room_created', {
          roomCode,
          gameType: room.gameType,
          hostId: room.hostId,
          players: serializePlayers(room),
        });

        // Trigger arena transition locally 
        socket.emit('game_starting', {
          gameType: room.gameType,
          totalQuestions: room.questions ? room.questions.length : 0,
          players: serializePlayers(room)
        });

        // Hydrate current active state
        const activeStates = ['reading', 'buzzing', 'answering', 'results'];
        if (activeStates.includes(room.state)) {
          const q = room.currentQuestion;
          if (q) {
            socket.emit('question_ready', {
              questionIndex: room.currentQIndex,
              totalQuestions: room.questions.length,
              questionText: q.questionText,
              readingTimeMs: READING_TIME_MS,
              // For reconnect: endTime is anchored to when reading STARTED, so
              // the client computes the actual time remaining correctly.
              endTime: (room.questionStartedAt || Date.now()) + READING_TIME_MS,
              chancesLeft: room.chancesLeft,
              players: serializePlayers(room),
            });
          }
          
          if (room.state === 'buzzing' || room.state === 'answering') {
            socket.emit('buzzer_open', {
              chancesLeft: room.chancesLeft,
              answerTimeMs: ANSWER_TIME_MS,
              // For reconnect: endTime anchored to when the buzzer floor OPENED.
              endTime: (room.buzzerOpenAt || Date.now()) + ANSWER_TIME_MS,
            });
            if (room.state === 'answering' && room.buzzerId) {
               socket.emit('player_answering', {
                 buzzerId: room.buzzerId,
                 buzzerUsername: room.players.get(room.buzzerId)?.username,
                 answerTimeMs: ANSWER_TIME_MS,
                 // For reconnect: anchored to when the buzzer was pressed.
                 endTime: (room.buzzerOpenAt || Date.now()) + ANSWER_TIME_MS,
               });
            }
          } else if (room.state === 'results') {
             // Let them quickly see standard results
             socket.emit('answer_result', {
               userId: room.lastAnsweredId || '',
               username: room.players.get(room.lastAnsweredId)?.username,
               isCorrect: false,
               correctAnswer: null,
               chancesLeft: room.chancesLeft,
             })
          }
        } else if (room.state === 'reveal') {
            if (room.currentQuestion) {
              socket.emit('question_reveal', {
                questionIndex: room.currentQIndex,
                correctAnswer: room.currentQuestion.correctAnswer,
                explanation: room.currentQuestion.explanation,
              });
            }
        } else if (room.state === 'finished') {
           // We do not have match results cached lightly, fallback
           socket.emit('error', { message: 'Game has already finished.' });
        }

        console.log(`[socket] ${username} reconnected to room ${roomCode} mid-game`);
        
        // Broadcast arrival
        io.to(roomCode).emit('player_joined', {
          userId,
          username,
          players: serializePlayers(room),
        });
        
        return;
      }

      if (room.gameType === 'solo' && room.players.size >= 1) {
        return socket.emit('error', { message: 'Solo rooms allow only 1 player.' });
      }
      if (room.gameType === '1v1' && room.players.size >= 2) {
        return socket.emit('error', { message: '1v1 room is full.' });
      }

      room.players.set(userId, {
        socketId: socket.id,
        username,
        score: 0,
        correctAnswers: 0,
        wrongAnswers: 0,
        totalTime: 0,
        answeredCount: 0,
      });

      socket.join(roomCode);
      socket.roomCode = roomCode;

      // Send the room details to the joining player so local state hydrates
      socket.emit('room_created', {
        roomCode,
        gameType: room.gameType,
        hostId: room.hostId,
        players: serializePlayers(room),
      });

      // Broadcast updated player list to everyone in the room
      io.to(roomCode).emit('player_joined', {
        userId,
        username,
        players: serializePlayers(room),
      });

      console.log(`[socket] ${username} joined room ${roomCode}`);
    } catch (err) {
      console.error('[socket.join_room]', err);
      socket.emit('error', { message: 'Failed to join room.' });
    }
  });

  // ── start_game ─────────────────────────────────────────────────────────────
  socket.on('start_game', async () => {
    try {
      const room = roomStore.get(socket.roomCode);

      if (!room) return socket.emit('error', { message: 'Room not found.' });
      if (room.hostId !== userId) {
        return socket.emit('error', { message: 'Only the room host can start the game.' });
      }
      if (room.state !== 'waiting') {
        return socket.emit('error', { message: 'Game has already started.' });
      }
      if (room.gameType !== 'solo' && room.players.size < 2) {
        return socket.emit('error', { message: 'Need at least 2 players to start.' });
      }

      // Fetch questions — excludes played ones for Solo mode
      const soloUserId = room.gameType === 'solo' ? userId : null;
      room.questions = await fetchQuestions(room.gameType, soloUserId);

      io.to(room.roomCode).emit('game_starting', {
        gameType: room.gameType,
        totalQuestions: room.questions.length,
        players: serializePlayers(room),
      });

      // Brief countdown before first question
      setTimeout(() => advanceQuestion(io, room), 3_000);
    } catch (err) {
      console.error('[socket.start_game]', err);
      socket.emit('error', { message: err.message || 'Failed to start game.' });
    }
  });

  // ── buzz_in ────────────────────────────────────────────────────────────────
  socket.on('buzz_in', () => {
    try {
      const room = roomStore.get(socket.roomCode);

      if (!room) return;
      if (room.state !== 'buzzing') return; // strictly only accept during active buzzer floor phase
      if (!room.players.has(userId)) return;

      // ── RACE CONDITION GUARD ───────────────────────────────────────────────
      // The first atomic write wins. Subsequent buzz_in events are silently
      // dropped because state transitions immediately to 'answering'.
      if (room.buzzerId !== null) return;
      if (room.currentAnswers.has(userId)) {
        return socket.emit('error', { message: 'Siz ushbu savolga allaqachon javob bergansiz.' });
      }

      clearRoomTimers(room);
      room.buzzerId = userId;
      room.state = 'answering';
      room.buzzerOpenAt = Date.now();

      io.to(room.roomCode).emit('player_answering', {
        buzzerId: userId,
        buzzerUsername: username,
        answerTimeMs: ANSWER_TIME_MS,
        endTime: room.buzzerOpenAt + ANSWER_TIME_MS,
      });

      // 7-second answer timer
      room.answerTimer = setTimeout(() => {
        if (room.state !== 'answering' || room.buzzerId !== userId) return;

        // Treat timeout as a wrong answer
        const pData = room.players.get(userId);
        if (pData) {
          pData.wrongAnswers += 1;
          pData.answeredCount += 1;
          pData.totalTime += ANSWER_TIME_MS / 1000;
        }

        room.currentAnswers.set(userId, {
          userId,
          isCorrect: false,
          timeTaken: ANSWER_TIME_MS / 1000,
          exactAnswerText: '[TIMEOUT]',
        });

        room.chancesLeft -= 1;
        room.buzzerId = null;

        io.to(room.roomCode).emit('answer_result', {
          userId,
          username,
          isCorrect: false,
          correctAnswer:
            room.chancesLeft === 0 ? room.currentQuestion.correctAnswer : null,
          chancesLeft: room.chancesLeft,
          timedOut: true,
          givenAnswer: '[TIMEOUT]',
        });

        if (room.chancesLeft <= 0) {
          // Finalize log entry, reveal answer, move on
          room.matchLog.push({
            questionId: room.currentQuestion._id,
            playerAnswers: Array.from(room.currentAnswers.values()),
          });

          io.to(room.roomCode).emit('question_reveal', {
            questionIndex: room.currentQIndex,
            correctAnswer: room.currentQuestion.correctAnswer,
            explanation: room.currentQuestion.explanation,
          });

          setTimeout(() => advanceQuestion(io, room), 3_000);
        } else {
          room.state = 'results'; // Wait state to show timeout to others
          setTimeout(() => openBuzzerFloor(io, room), 3000);
        }
      }, ANSWER_TIME_MS);
    } catch (err) {
      console.error('[socket.buzz_in]', err);
    }
  });

  // ── submit_answer ──────────────────────────────────────────────────────────
  socket.on('submit_answer', (payload = {}) => {
    try {
      // Handle both { answer: "..." } and { answerText: "..." } for compatibility
      const answer = payload.answerText || payload.answer;
      const room = roomStore.get(socket.roomCode);

      if (!room) return;
      if (room.state !== 'answering') return;
      if (room.buzzerId !== userId) {
        return socket.emit('error', { message: 'You do not have the buzzer.' });
      }
      if (!answer || typeof answer !== 'string') {
        return socket.emit('error', { message: 'Invalid answer.' });
      }

      clearRoomTimers(room);

      const timeTaken = parseFloat(
        ((Date.now() - room.buzzerOpenAt) / 1000).toFixed(2)
      );

      const isCorrect =
        normalizeAnswer(answer) ===
        normalizeAnswer(room.currentQuestion.correctAnswer);

      const pData = room.players.get(userId);
      if (pData) {
        if (isCorrect) {
          pData.score += 1;
          pData.correctAnswers += 1;
        } else {
          pData.wrongAnswers += 1;
        }
        pData.answeredCount += 1;
        pData.totalTime += timeTaken;
      }

      room.currentAnswers.set(userId, {
        userId,
        isCorrect,
        timeTaken,
        exactAnswerText: answer.trim(),
      });

      room.buzzerId = null;
      room.state = 'reveal';

      if (isCorrect) {
        // Correct → save log entry, broadcast, advance
        room.matchLog.push({
          questionId: room.currentQuestion._id,
          playerAnswers: Array.from(room.currentAnswers.values()),
        });

        io.to(room.roomCode).emit('answer_result', {
          userId,
          username,
          isCorrect: true,
          correctAnswer: room.currentQuestion.correctAnswer,
          chancesLeft: room.chancesLeft,
          players: serializePlayers(room),
        });

        io.to(room.roomCode).emit('question_reveal', {
          questionIndex: room.currentQIndex,
          correctAnswer: room.currentQuestion.correctAnswer,
          explanation: room.currentQuestion.explanation,
        });

        setTimeout(() => advanceQuestion(io, room), 3_000);
      } else {
        // Wrong answer
        room.chancesLeft -= 1;

        io.to(room.roomCode).emit('answer_result', {
          userId,
          username,
          isCorrect: false,
          correctAnswer:
            room.chancesLeft === 0 ? room.currentQuestion.correctAnswer : null,
          chancesLeft: room.chancesLeft,
          givenAnswer: answer,
        });

        if (room.chancesLeft <= 0) {
          // All chances exhausted
          room.matchLog.push({
            questionId: room.currentQuestion._id,
            playerAnswers: Array.from(room.currentAnswers.values()),
          });

          io.to(room.roomCode).emit('question_reveal', {
            questionIndex: room.currentQIndex,
            correctAnswer: room.currentQuestion.correctAnswer,
            explanation: room.currentQuestion.explanation,
          });

          setTimeout(() => advanceQuestion(io, room), 3_000);
        } else {
          // Reopen buzzer floor for remaining players after 3 seconds so they can see the wrong answer
          room.state = 'results';
          setTimeout(() => openBuzzerFloor(io, room), 3000);
        }
      }
    } catch (err) {
      console.error('[socket.submit_answer]', err);
    }
  });

  // ── disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    try {
      const roomCode = socket.roomCode;
      if (!roomCode) return;

      const room = roomStore.get(roomCode);
      if (!room) return;

      if (room.state === 'waiting') {
        room.players.delete(userId);
      } else {
        const p = room.players.get(userId);
        if (p) p.isOffline = true;
      }

      io.to(roomCode).emit('player_left', {
        userId,
        username,
        players: serializePlayers(room),
      });

      console.log(`[socket] ${username} disconnected from room ${roomCode}`);

      // If the room is completely empty (or everyone is offline), clean up
      const activePlayers = Array.from(room.players.values()).filter(p => !p.isOffline);
      if (activePlayers.length === 0) {
        clearRoomTimers(room);
        roomStore.delete(roomCode);
        console.log(`[socket] Room ${roomCode} deleted (all players offline)`);
        return;
      }

      // If the disconnected player held the buzzer, open the floor
      if (room.buzzerId === userId && room.state === 'answering') {
        room.chancesLeft -= 1;
        room.buzzerId = null;

        if (room.chancesLeft <= 0) {
          clearRoomTimers(room);
          room.matchLog.push({
            questionId: room.currentQuestion._id,
            playerAnswers: Array.from(room.currentAnswers.values()),
          });
          io.to(roomCode).emit('question_reveal', {
            questionIndex: room.currentQIndex,
            correctAnswer: room.currentQuestion.correctAnswer,
            explanation: room.currentQuestion.explanation,
          });
          setTimeout(() => advanceQuestion(io, room), 3_000);
        } else {
          openBuzzerFloor(io, room);
        }
      }

      // Reassign host if needed
      if (room.hostId === userId && room.state === 'waiting') {
        const nextHost = room.players.keys().next().value;
        if (nextHost) {
          room.hostId = nextHost;
          io.to(roomCode).emit('host_changed', { newHostId: nextHost });
        }
      }
    } catch (err) {
      console.error('[socket.disconnect]', err);
    }
  });
};

module.exports = { registerGameHandlers };
