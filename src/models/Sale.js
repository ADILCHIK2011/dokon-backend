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
  paymentMethod: { type: String, enum: ['cash', 'card', 'online'], default: 'cash' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  // Set when a cashier cancels an open ticket. Cancelling is a soft-delete
  // (see sales.controller.js's cancel()) so the AI night-cashier report can
  // count how many tickets got cancelled the day before.
  cancelledAt: { type: Date },
});

module.exports = mongoose.model('Sale', saleSchema);
