const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const { emitToMarket } = require('../socket');
const { paginationParams } = require('../utils/pagination');
const { notifyOwners } = require('../services/telegram');

const PAYMENT_METHODS = ['cash', 'card', 'online'];

async function saveWithConflictHandling(res, sale) {
  try {
    await sale.save();
    return true;
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) {
      res.status(409).json({ message: 'Savdo boshqa amaliyot tomonidan yangilandi. Qayta urinib koʻring.' });
      return false;
    }
    throw err;
  }
}

async function listMine(req, res) {
  const sales = await Sale.find({
    cashier: req.user.id,
    market: req.user.market,
    status: 'open',
  }).sort({ createdAt: 1 });
  res.json({ sales });
}

async function listHistory(req, res) {
  const { from, to, cashier, paymentMethod } = req.query;
  const query = { market: req.user.market, status: 'completed' };

  if (req.user.role === 'cashier') {
    query.cashier = req.user.id;
  } else if (cashier) {
    query.cashier = cashier;
  }

  if (paymentMethod && PAYMENT_METHODS.includes(paymentMethod)) {
    query.paymentMethod = paymentMethod;
  }

  if (from || to) {
    query.completedAt = {};
    if (from) query.completedAt.$gte = new Date(from);
    if (to) query.completedAt.$lte = new Date(to);
  }

  const { page, limit, skip } = paginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });
  const [sales, total] = await Promise.all([
    Sale.find(query).sort({ completedAt: -1 }).skip(skip).limit(limit).populate('cashier', 'name'),
    Sale.countDocuments(query),
  ]);
  res.json({ sales, total, page, limit });
}

async function create(req, res) {
  const sale = await Sale.create({
    market: req.user.market,
    cashier: req.user.id,
    items: [],
    total: 0,
    status: 'open',
  });
  res.status(201).json({ sale });
}

async function getOne(req, res) {
  const sale = await Sale.findOne({ _id: req.params.id, market: req.user.market }).populate(
    'cashier',
    'name'
  );
  if (!sale) {
    return res.status(404).json({ message: 'Savdo topilmadi' });
  }
  if (req.user.role === 'cashier' && sale.cashier._id.toString() !== req.user.id) {
    return res.status(403).json({ message: 'Ruxsat yoʻq' });
  }
  res.json({ sale });
}

async function findOpenOwned(req) {
  const sale = await Sale.findOne({ _id: req.params.id, market: req.user.market });
  if (!sale) return { error: 404, message: 'Savdo topilmadi' };
  if (sale.cashier.toString() !== req.user.id) return { error: 403, message: 'Ruxsat yoʻq' };
  if (sale.status !== 'open') return { error: 409, message: 'Bu savdo allaqachon yakunlangan' };
  return { sale };
}

async function updateItems(req, res) {
  const { error, message, sale } = await findOpenOwned(req);
  if (error) return res.status(error).json({ message });

  const { items } = req.body; // [{ productId, quantity }]
  if (!Array.isArray(items)) {
    return res.status(400).json({ message: "Mahsulotlar roʻyxati kerak" });
  }

  const resolvedItems = [];
  for (const { productId, quantity } of items) {
    if (!quantity || quantity <= 0) continue;
    const product = await Product.findOne({
      _id: productId,
      market: req.user.market,
      active: true,
    });
    if (!product) {
      return res.status(404).json({ message: 'Mahsulot topilmadi' });
    }
    if (quantity > product.stock) {
      return res.status(409).json({
        message: `Omborda faqat ${product.stock} dona "${product.name}" bor`,
        productId: product._id,
        available: product.stock,
      });
    }
    resolvedItems.push({
      product: product._id,
      barcode: product.barcode,
      name: product.name,
      price: product.price,
      quantity,
      lineTotal: product.price * quantity,
    });
  }

  sale.items = resolvedItems;
  sale.total = resolvedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  if (!(await saveWithConflictHandling(res, sale))) return;
  res.json({ sale });
}

async function complete(req, res) {
  const { paymentMethod } = req.body || {};
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ message: "To'lov turini tanlang" });
  }

  const { error, message, sale } = await findOpenOwned(req);
  if (error) return res.status(error).json({ message });

  if (sale.items.length === 0) {
    return res.status(400).json({ message: "Boʻsh savdoni yakunlab boʻlmaydi" });
  }

  const products = [];
  for (const item of sale.items) {
    const product = await Product.findById(item.product);
    if (!product || product.stock < item.quantity) {
      return res.status(409).json({ message: `Omborda "${item.name}" uchun yetarli miqdor yoʻq` });
    }
    products.push(product);
  }

  const stockDiffs = [];
  for (let i = 0; i < sale.items.length; i++) {
    const item = sale.items[i];
    const product = products[i];
    await Product.updateOne({ _id: item.product }, { $inc: { stock: -item.quantity } });
    stockDiffs.push({
      productId: product._id,
      stock: product.stock - item.quantity,
      name: product.name,
      barcode: product.barcode,
    });
  }

  sale.status = 'completed';
  sale.completedAt = new Date();
  sale.paymentMethod = paymentMethod;
  if (!(await saveWithConflictHandling(res, sale))) return;
  emitToMarket(req.user.market, 'stock:changed', stockDiffs);

  const outOfStock = stockDiffs.filter((d) => d.stock === 0);
  if (outOfStock.length > 0) {
    const names = outOfStock.map((d) => `"${d.name}"`).join(', ');
    notifyOwners(req.user.market, `🚨 Omborda tugadi: ${names}`).catch((err) =>
      console.error('Telegram notify error', err)
    );
  }

  res.json({ sale });
}

async function cancel(req, res) {
  const { error, message, sale } = await findOpenOwned(req);
  if (error) return res.status(error).json({ message });
  await Sale.deleteOne({ _id: sale._id });
  res.json({ message: 'Bekor qilindi' });
}

module.exports = { listMine, listHistory, create, getOne, updateItems, complete, cancel };
