const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market', required: true },
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  costPrice: { type: Number },
  stock: { type: Number, required: true, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

productSchema.index({ barcode: 1, market: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
