const mongoose = require('mongoose');
const { UNIT_VALUES } = require('../utils/units');

const saleItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  unit: { type: String, enum: UNIT_VALUES, default: 'dona' },
  lineTotal: { type: Number, required: true },
}, { _id: false });

const saleSchema = new mongoose.Schema({
  market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market', required: true },
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: { type: [saleItemSchema], default: [] },
  total: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['open', 'completed', 'cancelled'], default: 'open' },
  paymentMethod: { type: String, enum: ['cash', 'card', 'online', 'nasiya'], default: 'cash' },
  // Set only when paymentMethod === 'nasiya' — who the sale's total was
  // credited to (see sales.controller.js's complete()).
  debtor: { type: mongoose.Schema.Types.ObjectId, ref: 'Debtor' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  // Set when a cashier cancels an open ticket. Cancelling is a soft-delete
  // (see sales.controller.js's cancel()) so the AI night-cashier report can
  // count how many tickets got cancelled the day before.
  cancelledAt: { type: Date },
});

// Sale had no indexes at all beyond _id — sales history, every analytics
// endpoint, every AI reporting tool, the night-cashier report, and the
// per-shift revenue breakdown all filter by market (+status, +completedAt
// range, +cashier) and were full-collection-scanning every sale ever made
// by every tenant on every request. These two compound indexes cover that
// family of query shapes; dropping the leading `market` field out of either
// would defeat the whole point, since market is the field every query filters
// on first (see CLAUDE.md's multi-tenancy note).
saleSchema.index({ market: 1, status: 1, completedAt: -1 });
saleSchema.index({ market: 1, cashier: 1, status: 1, completedAt: -1 });

module.exports = mongoose.model('Sale', saleSchema);
