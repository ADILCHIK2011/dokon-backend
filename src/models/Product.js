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

// Without these, every Products-page list/search and every low-stock widget
// (ProductsPage, OverviewPage, NotificationBell, the AI tools, dead-stock)
// was a full collection scan across every product of every tenant, sorted
// in memory — which MongoDB caps at 32MB and will hard-error past, not just
// slow down. These cover the two sort orders list() actually uses (by name,
// and by stock for the maxStock/low-stock path) scoped to one market's
// active products.
productSchema.index({ market: 1, active: 1, name: 1 });
productSchema.index({ market: 1, active: 1, stock: 1 });

module.exports = mongoose.model('Product', productSchema);
