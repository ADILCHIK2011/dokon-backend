const mongoose = require('mongoose');
const { UNIT_VALUES } = require('../utils/units');

const productSchema = new mongoose.Schema({
  market: { type: mongoose.Schema.Types.ObjectId, ref: 'Market', required: true },
  barcode: { type: String, required: true },
  // Additional barcodes that also resolve to this same product (e.g. a
  // product restocked under a different manufacturer code, or sold in
  // multiple pack sizes each with their own code). `barcode` above stays the
  // one canonical code used for CSV export/import and the auto-generated
  // sequential-barcode flow; these are purely extra lookup keys — see
  // products.controller.js's getByBarcode and the uniqueness checks in
  // create/update, which treat every value here as equally claimable as the
  // primary `barcode` field.
  extraBarcodes: { type: [String], default: [] },
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

// Multikey unique index: MongoDB enforces uniqueness per (market, array
// element) pair, so no two products in the same market can share an extra
// barcode value. Doesn't catch a collision against another product's
// *primary* `barcode` field (different field, different index) — that cross-
// field case is checked in the application layer, see products.controller.js.
//
// partialFilterExpression is required here, not optional: every product that
// existed before this field was added has no `extraBarcodes` key at all, and
// a plain unique index treats "field entirely missing" as an indexed `null`
// — every pre-existing product in the same market collides on that same
// `null` entry and the index build fails outright. `sparse: true` does NOT
// fix this for a compound index: sparse only excludes a document when it's
// missing *every* indexed field, and `market` is always present, so sparse
// alone still produced the exact same E11000 (confirmed by hand against this
// collection). A partial filter expression is the only thing that actually
// excludes "missing extraBarcodes" documents from this index; a present-but-
// empty `[]` (every product saved through create()/update() going forward)
// already contributes zero multikey entries on its own regardless, so this
// doesn't weaken the uniqueness guarantee for any document that actually has
// extra barcodes.
productSchema.index(
  { market: 1, extraBarcodes: 1 },
  { unique: true, partialFilterExpression: { extraBarcodes: { $exists: true } } }
);

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
