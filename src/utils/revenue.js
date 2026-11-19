const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const DebtPayment = require('../models/DebtPayment');

// Revenue is counted cash-basis: a nasiya (credit) sale puts no money in the
// till, so it isn't revenue when it's completed — it becomes revenue only
// when the customer pays the debt down (debtors.controller.js's
// recordPayment()). Everything that reports "daromad" therefore sums two
// streams, each bucketed by the date the money actually arrived:
//   - completed non-nasiya sales (by completedAt)
//   - debt payments (by createdAt)
//
// Returns need no special handling: returnItems() shrinks Sale.total for cash
// sales, and lowers Debtor.balance for nasiya sales, so a later repayment is
// smaller by exactly the refunded amount — either way it never reaches
// revenue at its original size.
//
// `range` is a Mongo date range ({ $gte, $lte }) applied to each stream's own
// date field, or omitted for an all-time total.
function revenueSourcesPipeline(marketId, range) {
  const market = new mongoose.Types.ObjectId(marketId);

  const saleMatch = { market, status: 'completed' };
  if (range) saleMatch.completedAt = range;

  const paymentMatch = { market };
  if (range) paymentMatch.createdAt = range;

  return [
    { $match: saleMatch },
    // A nasiya receipt still counts as a sale (`saleCount: 1`) — it just
    // contributes no revenue until the debt is repaid.
    {
      $project: {
        amount: { $cond: [{ $eq: ['$paymentMethod', 'nasiya'] }, 0, '$total'] },
        date: '$completedAt',
        saleCount: { $literal: 1 },
      },
    },
    {
      $unionWith: {
        coll: DebtPayment.collection.name,
        pipeline: [
          { $match: paymentMatch },
          { $project: { amount: '$amount', date: '$createdAt', saleCount: { $literal: 0 } } },
        ],
      },
    },
  ];
}

// { totalRevenue, totalTransactions } for a market over an optional date
// range. `totalTransactions` counts every completed sale (nasiya receipts
// included — they are still sales, just not money collected yet).
async function revenueTotals(marketId, range) {
  const [row] = await Sale.aggregate([
    ...revenueSourcesPipeline(marketId, range),
    { $group: { _id: null, totalRevenue: { $sum: '$amount' }, totalTransactions: { $sum: '$saleCount' } } },
  ]);
  return { totalRevenue: row?.totalRevenue || 0, totalTransactions: row?.totalTransactions || 0 };
}

// Per-day revenue for the daily chart: [{ date: 'YYYY-MM-DD', revenue, transactions }].
async function revenueByDay(marketId, range) {
  const rows = await Sale.aggregate([
    ...revenueSourcesPipeline(marketId, range),
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        revenue: { $sum: '$amount' },
        transactions: { $sum: '$saleCount' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({ date: r._id, revenue: r.revenue, transactions: r.transactions }));
}

// Revenue per shift, keyed by shift id. A shift's revenue is the till money
// that moved during it: non-nasiya sales rung up by that cashier plus debt
// payments that cashier recorded. `shifts` may have `cashier` populated or
// bare — callers pass Shift documents either way.
async function shiftRevenueMap(shifts, marketId) {
  const map = new Map();
  if (shifts.length === 0) return map;

  const cashierId = (s) => String(s.cashier?._id || s.cashier);
  const cashierIds = [...new Set(shifts.map(cashierId))];
  const earliestStart = shifts.reduce((min, s) => (s.startedAt < min ? s.startedAt : min), shifts[0].startedAt);

  const [sales, payments] = await Promise.all([
    Sale.find({
      market: marketId,
      status: 'completed',
      cashier: { $in: cashierIds },
      completedAt: { $gte: earliestStart },
    }).select('cashier total paymentMethod completedAt'),
    DebtPayment.find({
      market: marketId,
      recordedBy: { $in: cashierIds },
      createdAt: { $gte: earliestStart },
    }).select('recordedBy amount createdAt'),
  ]);

  for (const shift of shifts) {
    const id = cashierId(shift);
    const end = shift.endedAt || new Date();
    const within = (date) => date >= shift.startedAt && date <= end;

    const shiftSales = sales.filter((s) => String(s.cashier) === id && within(s.completedAt));
    const shiftPayments = payments.filter((p) => String(p.recordedBy) === id && within(p.createdAt));

    map.set(String(shift._id), {
      revenue:
        shiftSales.reduce((sum, s) => sum + (s.paymentMethod === 'nasiya' ? 0 : s.total), 0) +
        shiftPayments.reduce((sum, p) => sum + p.amount, 0),
      transactions: shiftSales.length,
    });
  }
  return map;
}

module.exports = { revenueTotals, revenueByDay, shiftRevenueMap };
