const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['superadmin', 'owner', 'cashier'], required: true },
  market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market' }, // null for superadmin
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

// Usernames only need to be unique within a market (two markets can both
// have a "kassir1"). Superadmins have market: null; Mongo treats null as
// a normal value for uniqueness, so distinct superadmin usernames still work.
userSchema.index({ market: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
