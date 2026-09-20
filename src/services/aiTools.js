const Product = require('../models/Product');
const Sale = require('../models/Sale');
const { escapeRegex } = require('../utils/escapeRegex');

// OpenAI-compatible function-calling schemas (Groq uses the same shape).
// Every executor below takes the caller's market id explicitly — the model
// never supplies or sees it, so a tenant's data can't leak across markets.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_sales_summary',
      description:
        "Berilgan sana oralig'idagi umumiy savdo statistikasi: jami daromad, savdolar soni, o'rtacha chek. Sana ko'rsatilmasa (null bo'lsa), oxirgi 30 kun olinadi.",
      parameters: {
        type: 'object',
        properties: {
          from: { type: ['string', 'null'], description: "Boshlanish sanasi (YYYY-MM-DD), bo'lmasa null" },
          to: { type: ['string', 'null'], description: "Tugash sanasi (YYYY-MM-DD), bo'lmasa null" },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_products',
      description: "Berilgan davrda eng ko'p daromad keltirgan mahsulotlar ro'yxati.",
      parameters: {
        type: 'object',
        properties: {
          from: { type: ['string', 'null'], description: "Boshlanish sanasi (YYYY-MM-DD), bo'lmasa null" },
          to: { type: ['string', 'null'], description: "Tugash sanasi (YYYY-MM-DD), bo'lmasa null" },
          limit: { type: ['integer', 'null'], description: "Nechta mahsulot qaytarilsin, bo'lmasa null (standart 10)" },
        },
        required: ['from', 'to', 'limit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        "Mahsulotlarni nomi bo'yicha qidirish, yoki qoldiq (stock) chegarasi bo'yicha filtrlash (masalan kam qolgan mahsulotlarni topish uchun).",
      parameters: {
        type: 'object',
        properties: {
          search: { type: ['string', 'null'], description: "Mahsulot nomida qidiriladigan matn, bo'lmasa null" },
          maxStock: {
            type: ['integer', 'null'],
            description: "Faqat shu sondan kam yoki teng qoldiqli mahsulotlarni qaytarish, bo'lmasa null",
          },
          limit: { type: ['integer', 'null'], description: "Bo'lmasa null (standart 20, maksimal 50)" },
        },
        required: ['search', 'maxStock', 'limit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dead_stock',
      description: "Omborda turgan, lekin ko'rsatilgan kun ichida sotilmagan mahsulotlar ro'yxati.",
      parameters: {
        type: 'object',
        properties: { days: { type: ['integer', 'null'], description: "Bo'lmasa null (standart 30)" } },
        required: ['days'],
      },
    },
  },
];

function dateRangeMatch(args) {
  const range = {};
  // A bare "YYYY-MM-DD" parses as exactly midnight UTC. When the model uses
  // the same date for both "from" and "to" (e.g. asking about "today"), that
  // collapses the window to a single instant unless "to" is pushed to the
  // end of that day.
  if (args.from) range.$gte = new Date(args.from);
  if (args.to) {
    const to = new Date(args.to);
    to.setUTCHours(23, 59, 59, 999);
    range.$lte = to;
  }
  if (!args.from && !args.to) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    range.$gte = d;
  }
  return range;
}

async function executeTool(name, args, marketId) {
  switch (name) {
    case 'get_sales_summary': {
      const match = { market: marketId, status: 'completed', completedAt: dateRangeMatch(args) };
      const [result] = await Sale.aggregate([
        { $match: match },
        { $group: { _id: null, totalRevenue: { $sum: '$total' }, totalTransactions: { $sum: 1 } } },
      ]);
      const totalRevenue = result?.totalRevenue || 0;
      const totalTransactions = result?.totalTransactions || 0;
      return {
        totalRevenue,
        totalTransactions,
        averageSale: totalTransactions > 0 ? Math.round(totalRevenue / totalTransactions) : 0,
      };
    }

    case 'get_top_products': {
      const match = { market: marketId, status: 'completed', completedAt: dateRangeMatch(args) };
      const limit = Math.min(Number(args.limit) || 10, 50);
      const rows = await Sale.aggregate([
        { $match: match },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: limit },
      ]);
      return { products: rows.map((r) => ({ name: r.name, quantity: r.quantity, revenue: r.revenue })) };
    }

    case 'search_products': {
      const filter = { market: marketId, active: true };
      if (args.search) filter.name = { $regex: escapeRegex(args.search), $options: 'i' };
      if (args.maxStock !== undefined && args.maxStock !== null) filter.stock = { $lte: Number(args.maxStock) };
      const limit = Math.min(Number(args.limit) || 20, 50);
      const products = await Product.find(filter).sort({ stock: 1 }).limit(limit);
      return { products: products.map((p) => ({ name: p.name, barcode: p.barcode, price: p.price, stock: p.stock })) };
    }

    case 'get_dead_stock': {
      const days = Number(args.days) || 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const lastSold = await Sale.aggregate([
        { $match: { market: marketId, status: 'completed' } },
        { $unwind: '$items' },
        { $group: { _id: '$items.product', lastSoldAt: { $max: '$completedAt' } } },
      ]);
      const lastSoldMap = new Map(lastSold.map((r) => [r._id.toString(), r.lastSoldAt]));
      const products = await Product.find({ market: marketId, active: true, stock: { $gt: 0 } });
      const rows = products
        .map((p) => ({ name: p.name, stock: p.stock, lastSoldAt: lastSoldMap.get(p._id.toString()) || null }))
        .filter((p) => !p.lastSoldAt || p.lastSoldAt < cutoff)
        .slice(0, 30);
      return { products: rows };
    }

    default:
      return { error: `Noma'lum funksiya: ${name}` };
  }
}

module.exports = { TOOLS, executeTool };
