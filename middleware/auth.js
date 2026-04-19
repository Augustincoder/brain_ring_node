'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware: verifies the Authorization Bearer JWT and attaches
 * the decoded user document to req.user.
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: 'Token is valid but user not found.' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res
        .status(401)
        .json({ success: false, message: 'Token expired. Please log in again.' });
    }
    return res
      .status(401)
      .json({ success: false, message: 'Invalid token.' });
  }
};

/**
 * Middleware factory: restricts access to specific roles.
 * Always chain AFTER protect().
 * @param {...string} roles - Allowed roles (e.g. 'admin', 'player')
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this route.`,
      });
    }
    next();
  };
};

/**
 * Socket.io middleware: authenticates WebSocket handshake using the
 * JWT passed in socket.handshake.auth.token.
 */
const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Authentication error: No token provided.'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return next(new Error('Authentication error: User not found.'));
    }

    socket.user = user; // Attach user to socket for use in handlers
    next();
  } catch {
    return next(new Error('Authentication error: Invalid or expired token.'));
  }
};

module.exports = { protect, authorize, socketAuth };
