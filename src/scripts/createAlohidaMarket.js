// Provisions a market flagged `alohida` — one deliberately kept outside the
// superadmin dashboard entirely (see models/Market.js and
// admin.controller.js's ALOHIDA_FILTER). There's no admin-UI path to create
// one; this script is the only way. Always Pro, never expires in practice.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Market = require('../models/Market');
const User = require('../models/User');

const ALOHIDA_YEARS = 100;
function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

async function run() {
  const [name, slug, ownerName, ownerUsername, ownerPassword] = process.argv.slice(2);
  if (!name || !slug || !ownerName || !ownerUsername || !ownerPassword) {
    console.error(
      'Usage: node src/scripts/createAlohidaMarket.js "<Market name>" <slug> "<Owner name>" <owner-username> <owner-password>'
    );
    process.exit(1);
  }

  await connectDB();

  const normalizedSlug = slug.toLowerCase().trim();
  const existing = await Market.findOne({ slug: normalizedSlug });
  if (existing) {
    console.error(`A market with slug "${normalizedSlug}" already exists.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const market = await Market.create({
    name,
    slug: normalizedSlug,
    plan: 'pro',
    subscriptionExpiresAt: addYears(new Date(), ALOHIDA_YEARS),
    alohida: true,
    active: true,
  });

  const passwordHash = await bcrypt.hash(ownerPassword, 10);
  await User.create({
    name: ownerName,
    username: ownerUsername,
    passwordHash,
    role: 'owner',
    market: market._id,
    active: true,
  });

  console.log(`Created alohida market "${market.name}" (slug: ${market.slug}).`);
  console.log(`Owner login — slug: ${market.slug}, username: ${ownerUsername}, password: (as provided)`);
  console.log('This market is excluded from every superadmin dashboard endpoint (see admin.controller.js).');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Failed to create alohida market', err);
  process.exit(1);
});
