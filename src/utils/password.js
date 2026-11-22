const bcrypt = require('bcryptjs');

// Alohida markets (see Market.js's `alohida` flag) deliberately store
// passwords in plaintext in `User.passwordHash` instead of bcrypt-hashed —
// a one-off exception requested for that deployment. Every site that reads
// or writes a password goes through these two functions so the exception
// stays in one place instead of an `if (market.alohida)` scattered across
// auth.controller.js / workers.controller.js.
async function hashPassword(plainPassword, market) {
  if (market?.alohida) return plainPassword;
  return bcrypt.hash(plainPassword, 10);
}

async function verifyPassword(plainPassword, passwordHash, market) {
  if (market?.alohida) return plainPassword === passwordHash;
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = { hashPassword, verifyPassword };
