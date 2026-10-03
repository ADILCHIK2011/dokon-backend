const mongoose = require('mongoose');
const { UNIT_VALUES } = require('../utils/units');

const productSchema = new mongoose.Schema({
  market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market', required: true },
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  costPrice: { type: Number },
  stock: { type: Number, required: true, default: 0 },
  // 'dona' = sold/counted as whole pieces (integer quantities only). 'kg'/
  // 'metr' = sold by weight/length — price is per-unit, stock and sale
  // quantities can be fractional (e.g. 0.758 kg, 2.5 metr).
  unit: { type: String, enum: UNIT_VALUES, default: 'dona' },
  active: { type: Boolean, default: true },
}, { timestamps: true });

productSchema.index({ barcode: 1, market: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
