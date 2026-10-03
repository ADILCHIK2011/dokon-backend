const mongoose = require('mongoose');

// Records that a given market's daily Telegram push (morning briefing or
// night-cashier report) already went out today — the dedup key that makes
// catch-up-on-boot safe. Without this, a restart at 08:05 (after a missed
// cron tick) and the normal 08:00 cron on a later, uninterrupted day would
// have no way to tell "already sent" from "not yet due", and a restart
// mid-morning could resend the same day's report twice.
const telegramDailyLogSchema = new mongoose.Schema({
  market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market', required: true },
  type: { type: String, enum: ['briefing', 'night-cashier'], required: true },
  date: { type: String, required: true }, // YYYY-MM-DD (UTC day, matches Briefing.date's convention)
  sentAt: { type: Date, default: Date.now },
});

telegramDailyLogSchema.index({ market: 1, type: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('TelegramDailyLog', telegramDailyLogSchema);
