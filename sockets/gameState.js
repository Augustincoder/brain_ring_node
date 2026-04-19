'use strict';

/**
 * roomStore — the single source of truth for all active game rooms.
 *
 * Structure (per room):
 * {
 *   roomCode:       string,          // 4-digit code
 *   hostId:         string,          // socket.user._id of room creator
 *   gameType:       string,          // 'solo' | '1v1' | 'group'
 *   players: Map<userId, {           // key = userId string
 *     socketId:     string,
 *     username:     string,
 *     score:        number,
 *     correctAnswers: number,
 *     wrongAnswers:   number,
 *     totalTime:      number,        // cumulative seconds spent answering
 *     answeredCount:  number,
 *   }>,
 *   state:          string,          // 'waiting' | 'reading' | 'answering' | 'reveal' | 'finished'
 *   questions:      Question[],      // 10 fetched documents
 *   currentQIndex:  number,
 *   currentQuestion: Question|null,
 *   buzzerId:       string|null,     // userId of player currently holding the buzzer
 *   chancesLeft:    number,          // 3 chances per question across all players
 *   readingTimer:   NodeJS.Timeout|null,
 *   answerTimer:    NodeJS.Timeout|null,
 *   matchLog:       array,           // accumulated per-question logs
 *   currentAnswers: Map<userId, {isCorrect, timeTaken, exactAnswerText}>,
 *   questionStartedAt: number|null,  // Date.now() when reading started
 *   buzzerOpenAt:      number|null,  // Date.now() when floor was opened
 * }
 */
const roomStore = new Map();

const TOTAL_QUESTIONS = 10;
const READING_TIME_MS = 15_000;
const ANSWER_TIME_MS = 7_000;
const MAX_CHANCES = 3;

/**
 * Generates a random 4-digit room code that is not already in use.
 */
const generateRoomCode = () => {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (roomStore.has(code));
  return code;
};

/**
 * Returns a fresh room state object.
 */
const createRoomState = ({ roomCode, hostId, gameType }) => ({
  roomCode,
  hostId,
  gameType,
  players: new Map(),
  state: 'waiting',
  questions: [],
  currentQIndex: -1,
  currentQuestion: null,
  buzzerId: null,
  chancesLeft: MAX_CHANCES,
  readingTimer: null,
  answerTimer: null,
  matchLog: [],
  currentAnswers: new Map(),
  questionStartedAt: null,
  buzzerOpenAt: null,
});

/**
 * Safely clears both timers on a room to prevent double-firing.
 */
const clearRoomTimers = (room) => {
  if (room.readingTimer) {
    clearTimeout(room.readingTimer);
    room.readingTimer = null;
  }
  if (room.answerTimer) {
    clearTimeout(room.answerTimer);
    room.answerTimer = null;
  }
};

/**
 * Returns a plain serializable summary of the room's player map,
 * safe to emit over the socket.
 */
const serializePlayers = (room) => {
  const result = [];
  for (const [userId, data] of room.players.entries()) {
    result.push({ userId, ...data });
  }
  return result;
};

module.exports = {
  roomStore,
  TOTAL_QUESTIONS,
  READING_TIME_MS,
  ANSWER_TIME_MS,
  MAX_CHANCES,
  generateRoomCode,
  createRoomState,
  clearRoomTimers,
  serializePlayers,
};
