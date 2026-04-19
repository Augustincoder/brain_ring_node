'use strict';

require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { seedAdmin } = require('./utils/adminSeeder');
const { initSockets } = require('./sockets');

// ── Route imports ─────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const gameRoutes = require('./routes/game');

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS SETUP
// ─────────────────────────────────────────────────────────────────────────────
const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' })); // Support large question bulk imports
app.use(express.urlencoded({ extended: true }));

// ── Health check (no auth required) ─────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/game', gameRoutes);

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[GlobalError]', err.stack ?? err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error.',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP + SOCKET.IO SERVER
// ─────────────────────────────────────────────────────────────────────────────
const httpServer = http.createServer(app);
initSockets(httpServer);

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 5000;

const start = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Seed hardcoded admin account
    await seedAdmin();

    // 3. Start listening
    httpServer.listen(PORT, () => {
      console.log(`\n🚀 Brain-Ring backend running on http://localhost:${PORT}`);
      console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   MongoDB     : ${process.env.MONGODB_URI}`);
      console.log(`   WebSocket   : ws://localhost:${PORT}\n`);
    });
  } catch (error) {
    console.error('[startup] Fatal error:', error.message);
    process.exit(1);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\n[shutdown] Received ${signal}. Closing server gracefully...`);
  httpServer.close(async () => {
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    console.log('[shutdown] MongoDB connection closed. Goodbye.');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  shutdown('unhandledRejection');
});

start();
