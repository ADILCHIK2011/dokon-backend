const bcrypt = require('bcryptjs');
const Market = require('../models/Market');
const User = require('../models/User');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const { paginationParams } = require('../utils/pagination');
const { setMarketStatus } = require('../services/marketCache');

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

async function list(req, res) {
  const { page, limit, skip } = paginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });
  const [markets, total] = await Promise.all([
    Market.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    Market.countDocuments(),
  ]);
  res.json({ markets, total, page, limit });
}

async function create(req, res) {
  const { name, slug, months, plan, ownerName, ownerUsername, ownerPassword } = req.body;
  if (!name || !slug || !ownerName || !ownerUsername || !ownerPassword) {
    return res.status(400).json({ message: "Nomi, kodi, egasining ismi, login va paroli kerak" });
  }

  const normalizedSlug = slug.toLowerCase().trim();
  const existing = await Market.findOne({ slug: normalizedSlug });
  if (existing) {
    return res.status(409).json({ message: 'Bu doʻkon kodi band' });
  }

  const market = await Market.create({
    name,
    slug: normalizedSlug,
    plan: plan === 'pro' ? 'pro' : 'starter',
    subscriptionExpiresAt: addMonths(new Date(), months || 1),
    active: true,
  });

  const passwordHash = await bcrypt.hash(ownerPassword, 10);
  const owner = await User.create({
    name: ownerName,
    username: ownerUsername,
    passwordHash,
    role: 'owner',
    market: market._id,
    active: true,
  });

  const { passwordHash: _omit, ...safeOwner } = owner.toObject();
  res.status(201).json({ market, owner: safeOwner });
}

async function detail(req, res) {
  const market = await Market.findById(req.params.id);
  if (!market) {
    return res.status(404).json({ message: 'Doʻkon topilmadi' });
  }

  const [owner, workersCount, activeWorkersCount, productsCount, salesAgg] = await Promise.all([
    User.findOne({ market: market._id, role: 'owner' }).select('name username createdAt'),
    User.countDocuments({ market: market._id, role: 'cashier' }),
    User.countDocuments({ market: market._id, role: 'cashier', active: true }),
    Product.countDocuments({ market: market._id, active: true }),
    Sale.aggregate([
      { $match: { market: market._id, status: 'completed' } },
      { $group: { _id: null, totalRevenue: { $sum: '$total' }, totalTransactions: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    market,
    owner,
    workersCount,
    activeWorkersCount,
    productsCount,
    totalRevenue: salesAgg[0]?.totalRevenue || 0,
    totalTransactions: salesAgg[0]?.totalTransactions || 0,
  });
}

async function renew(req, res) {
  const { months } = req.body;
  const market = await Market.findById(req.params.id);
  if (!market) {
    return res.status(404).json({ message: 'Doʻkon topilmadi' });
  }
  const base = market.subscriptionExpiresAt > new Date() ? market.subscriptionExpiresAt : new Date();
  market.subscriptionExpiresAt = addMonths(base, months || 1);
  market.active = true;
  await market.save();
  setMarketStatus(market);
  res.json({ market });
}

async function update(req, res) {
  const { name, active, plan } = req.body;
  if (plan !== undefined && plan !== 'starter' && plan !== 'pro') {
    return res.status(400).json({ message: "Reja 'starter' yoki 'pro' bo'lishi kerak" });
  }
  const market = await Market.findByIdAndUpdate(
    req.params.id,
    {
      ...(name !== undefined && { name }),
      ...(active !== undefined && { active }),
      ...(plan !== undefined && { plan }),
    },
    { new: true, runValidators: true }
  );
  if (!market) {
    return res.status(404).json({ message: 'Doʻkon topilmadi' });
  }
  setMarketStatus(market);
  res.json({ market });
}

module.exports = { list, detail, create, renew, update };
