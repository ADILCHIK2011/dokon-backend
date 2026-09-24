const mongoose = require('mongoose');

const marketSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  active: { type: Boolean, default: true },
  plan: { type: String, enum: ['starter', 'pro'], default: 'starter' },
  subscriptionExpiresAt: { type: Date, required: true },
  // A standalone deployment (its own frontend, own branding — e.g. KHAL.uz)
  // that happens to share this backend/database, but is deliberately outside
  // the superadmin's reach: admin.controller.js excludes alohida markets from
  // every list/detail/update/renew endpoint, so they're invisible to and
  // unmanageable from the admin dashboard entirely. Provisioned only via
  // scripts/createAlohidaMarket.js, never through the admin API. Always
  // created on the Pro plan with subscriptionExpiresAt pushed far into the
  // future, so every existing plan/expiry check (login, loadMarket, telegram)
  // just naturally passes without any special-casing.
  alohida: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Market', marketSchema);
