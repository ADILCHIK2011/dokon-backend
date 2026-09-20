const mongoose = require('mongoose');

const marketSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  active: { type: Boolean, default: true },
  plan: { type: String, enum: ['starter', 'pro'], default: 'starter' },
  subscriptionExpiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Market', marketSchema);
