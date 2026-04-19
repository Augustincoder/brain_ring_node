'use strict';

const { socketAuth } = require('../middleware/auth');
const { registerGameHandlers } = require('./gameHandlers');

/**
 * Bootstraps Socket.io on the given server instance.
 * Attaches JWT authentication middleware before any handler runs.
 *
 * @param {import('http').Server} httpServer
 * @param {import('socket.io').ServerOptions} opts
 * @returns {import('socket.io').Server}
 */
const initSockets = (httpServer, opts = {}) => {
  const { Server } = require('socket.io');

  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60_000,    // 60s before considering a client disconnected
    pingInterval: 25_000,   // heartbeat every 25s
    ...opts,
  });

  // ── Global auth middleware ─────────────────────────────────────────────────
  io.use(socketAuth);

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(
      `[socket] Connected: ${socket.user.username} (${socket.id})`
    );

    registerGameHandlers(io, socket);
  });

  return io;
};

module.exports = { initSockets };
