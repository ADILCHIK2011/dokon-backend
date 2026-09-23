const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  unit: { type: String, enum: ['dona', 'kg'], default: 'dona' },
  lineTotal: { type: Number, required: true },
}, { _id: false });

const saleSchema = new mongoose.Schema({
  market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market', required: true },
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: { type: [saleItemSchema], default: [] },
  total: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['open', 'completed'], default: 'open' },
  paymentMethod: { type: String, enum: ['cash', 'card', 'online'], default: 'cash' },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
});

module.exports = mongoose.model('Sale', saleSchema);
