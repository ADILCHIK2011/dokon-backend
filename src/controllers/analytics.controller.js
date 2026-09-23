const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const { paginationParams } = require('../utils/pagination');

function buildMatch(req) {
  const match = { market: new mongoose.Types.ObjectId(req.user.market), status: 'completed' };

  const range = {};
  if (req.query.from) range.$gte = new Date(req.query.from);
  if (req.query.to) range.$lte = new Date(req.query.to);
  if (range.$gte || range.$lte) match.completedAt = range;

  return match;
}

async function summary(req, res) {
  const match = buildMatch(req);
  const [result] = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$total' },
        totalTransactions: { $sum: 1 },
      },
    },
  ]);

  const totalRevenue = result?.totalRevenue || 0;
  const totalTransactions = result?.totalTransactions || 0;
  res.json({
    totalRevenue,
    totalTransactions,
    averageSale: totalTransactions > 0 ? Math.round(totalRevenue / totalTransactions) : 0,
  });
}

async function topProducts(req, res) {
  const match = buildMatch(req);
  const limit = Math.min(Number(req.query.limit) || 10, 100);

  const rows = await Sale.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        name: { $first: '$items.name' },
        barcode: { $first: '$items.barcode' },
        unit: { $first: '$items.unit' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineTotal' },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);

  res.json({ products: rows });
}

async function daily(req, res) {
  const match = buildMatch(req);

  const rows = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } },
        revenue: { $sum: '$total' },
        transactions: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({ days: rows.map((r) => ({ date: r._id, revenue: r.revenue, transactions: r.transactions })) });
}

async function deadStock(req, res) {
  const days = Number(req.query.days) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const lastSold = await Sale.aggregate([
    { $match: { market: new mongoose.Types.ObjectId(req.user.market), status: 'completed' } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', lastSoldAt: { $max: '$completedAt' } } },
  ]);
  const lastSoldMap = new Map(lastSold.map((r) => [r._id.toString(), r.lastSoldAt]));

  const products = await Product.find({ market: req.user.market, active: true, stock: { $gt: 0 } });
  const allRows = products
    .map((p) => ({
      _id: p._id,
      name: p.name,
      barcode: p.barcode,
      stock: p.stock,
      unit: p.unit,
      price: p.price,
      lastSoldAt: lastSoldMap.get(p._id.toString()) || null,
    }))
    .filter((p) => !p.lastSoldAt || p.lastSoldAt < cutoff)
    .sort((a, b) => (a.lastSoldAt || 0) - (b.lastSoldAt || 0));

  const { page, limit, skip } = paginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });
  const rows = allRows.slice(skip, skip + limit);

  res.json({ products: rows, total: allRows.length, page, limit, days });
}

module.exports = { summary, topProducts, daily, deadStock };
