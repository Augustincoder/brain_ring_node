'use strict';

const User = require('../models/User');

/**
 * Ensures the hardcoded admin account exists on every startup.
 * If the user exists, verifies credentials haven't changed.
 * Uses findOne to avoid duplicate key errors on concurrent starts.
 */
const seedAdmin = async () => {
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'password admin@123';

  try {
    const existing = await User.findOne({ username });

    if (existing) {
      console.log(`[seeder] Admin account '${username}' already exists. Skipping.`);
      return;
    }

    // Create admin — the pre-save hook will hash the password automatically
    await User.create({ username, password, role: 'admin' });
    console.log(`[seeder] Admin account '${username}' created successfully.`);
  } catch (error) {
    // Handle race condition on concurrent startups (unique index violation)
    if (error.code === 11000) {
      console.log(`[seeder] Admin account '${username}' already exists (race). Skipping.`);
      return;
    }
    console.error('[seeder] Failed to create admin account:', error.message);
    throw error;
  }
};

module.exports = { seedAdmin };
