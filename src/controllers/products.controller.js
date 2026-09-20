const Product = require('../models/Product');
const { emitToMarket } = require('../socket');
const { paginationParams } = require('../utils/pagination');
const { escapeRegex } = require('../utils/escapeRegex');

async function list(req, res) {
  const filter = { market: req.user.market, active: true };
  if (req.query.search) {
    filter.name = { $regex: escapeRegex(req.query.search), $options: 'i' };
  }
  if (req.query.maxStock !== undefined) {
    filter.stock = { $lte: Number(req.query.maxStock) };
  }
  const sort = req.query.maxStock !== undefined ? { stock: 1 } : { name: 1 };
  const { page, limit, skip } = paginationParams(req.query, { defaultLimit: 20, maxLimit: 100 });
  const [products, total] = await Promise.all([
    Product.find(filter).sort(sort).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ products, total, page, limit });
}

async function getByBarcode(req, res) {
  const product = await Product.findOne({
    barcode: req.params.barcode,
    market: req.user.market,
    active: true,
  });
  if (!product) {
    return res.status(404).json({ message: 'Mahsulot topilmadi' });
  }
  res.json({ product });
}

async function create(req, res) {
  const { barcode, name, price, costPrice, stock } = req.body;
  if (!barcode || !name || price === undefined) {
    return res.status(400).json({ message: 'Shtrix-kod, nomi va narxi kerak' });
  }

  const existing = await Product.findOne({ barcode, market: req.user.market });
  if (existing) {
    return res.status(409).json({ message: 'Bu shtrix-kod allaqachon mavjud' });
  }

  const product = await Product.create({
    market: req.user.market,
    barcode,
    name,
    price,
    costPrice,
    stock: stock || 0,
    active: true,
  });
  emitToMarket(req.user.market, 'stock:changed', [
    { productId: product._id, stock: product.stock, name: product.name, barcode: product.barcode },
  ]);
  res.status(201).json({ product });
}

async function update(req, res) {
  const { name, price, costPrice, stock, active } = req.body;
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, market: req.user.market },
    {
      ...(name !== undefined && { name }),
      ...(price !== undefined && { price }),
      ...(costPrice !== undefined && { costPrice }),
      ...(stock !== undefined && { stock }),
      ...(active !== undefined && { active }),
    },
    { new: true, runValidators: true }
  );
  if (!product) {
    return res.status(404).json({ message: 'Mahsulot topilmadi' });
  }
  emitToMarket(req.user.market, 'stock:changed', [
    { productId: product._id, stock: product.stock, name: product.name, barcode: product.barcode },
  ]);
  res.json({ product });
}

async function remove(req, res) {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, market: req.user.market },
    { active: false },
    { new: true }
  );
  if (!product) {
    return res.status(404).json({ message: 'Mahsulot topilmadi' });
  }
  emitToMarket(req.user.market, 'product:removed', { productId: product._id });
  res.json({ product });
}

async function bulkImport(req, res) {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Mahsulotlar roʻyxati boʻsh boʻlmasligi kerak" });
  }

  const errors = [];
  const ops = [];

  items.forEach((item, index) => {
    const barcode = String(item.barcode || '').trim();
    const name = String(item.name || '').trim();
    const price = Number(item.price);
    const stock = item.stock !== undefined && item.stock !== '' ? Number(item.stock) : 0;

    if (!barcode || !name || Number.isNaN(price)) {
      errors.push({ row: index + 1, message: 'Shtrix-kod, nomi va toʻgʻri narx kerak' });
      return;
    }

    ops.push({
      updateOne: {
        filter: { barcode, market: req.user.market },
        update: { $set: { barcode, name, price, stock, market: req.user.market, active: true } },
        upsert: true,
      },
    });
  });

  let result = { matchedCount: 0, upsertedCount: 0 };
  if (ops.length > 0) {
    result = await Product.bulkWrite(ops);
    emitToMarket(req.user.market, 'products:bulk-changed');
  }

  res.json({
    imported: ops.length,
    created: result.upsertedCount || 0,
    updated: result.matchedCount || 0,
    errors,
  });
}

module.exports = { list, getByBarcode, create, update, remove, bulkImport };
