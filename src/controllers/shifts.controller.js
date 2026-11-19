const Shift = require('../models/Shift');
const User = require('../models/User');
const { notifyOwnerChat } = require('../services/telegram');
const { paginationParams } = require('../utils/pagination');
const { shiftRevenueMap } = require('../utils/revenue');

function formatTashkentTime(date) {
  return date.toLocaleTimeString('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function current(req, res) {
  const shift = await Shift.findOne({ market: req.user.market, cashier: req.user.id, status: 'open' });
  res.json({ shift });
}

async function start(req, res) {
  const existing = await Shift.findOne({ market: req.user.market, cashier: req.user.id, status: 'open' });
  if (existing) {
    return res.status(409).json({ message: 'Sizda allaqachon ochiq smena bor' });
  }

  const shift = await Shift.create({ market: req.user.market, cashier: req.user.id });

  const user = await User.findById(req.user.id).select('name');
  notifyOwnerChat(`🟢 ${user?.name || 'Xodim'} ishni boshladi (${formatTashkentTime(shift.startedAt)})`).catch((err) =>
    console.error('Telegram notify error', err)
  );

  res.status(201).json({ shift });
}

async function end(req, res) {
  const shift = await Shift.findOne({ market: req.user.market, cashier: req.user.id, status: 'open' });
  if (!shift) {
    return res.status(404).json({ message: 'Ochiq smena topilmadi' });
  }

  shift.status = 'closed';
  shift.endedAt = new Date();
  await shift.save();

  const user = await User.findById(req.user.id).select('name');
  notifyOwnerChat(`🔴 ${user?.name || 'Xodim'} ishni tugatdi (${formatTashkentTime(shift.endedAt)})`).catch((err) =>
    console.error('Telegram notify error', err)
  );

  res.json({ shift });
}

// Attaches how much money each shift actually took in (see utils/revenue.js —
// nasiya sales count only once the debt is repaid, debt payments count in the
// shift of whoever recorded them).
async function attachRevenue(shifts, marketId) {
  if (shifts.length === 0) return [];

  const byShift = await shiftRevenueMap(shifts, marketId);
  return shifts.map((shift) => {
    const { revenue = 0, transactions = 0 } = byShift.get(shift._id.toString()) || {};
    return { ...shift.toObject(), revenue, transactions };
  });
}

// Owner-only: every worker's shift log, newest first, for the Workers page.
// Filterable to one cashier via ?cashier=<id> for a per-worker history view.
async function history(req, res) {
  const { cashier } = req.query;
  const query = { market: req.user.market };
  if (cashier) query.cashier = cashier;

  const { page, limit, skip } = paginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });
  const [shiftsRaw, total] = await Promise.all([
    Shift.find(query).sort({ startedAt: -1 }).skip(skip).limit(limit).populate('cashier', 'name'),
    Shift.countDocuments(query),
  ]);
  const shifts = await attachRevenue(shiftsRaw, req.user.market);
  res.json({ shifts, total, page, limit });
}

module.exports = { current, start, end, history };
