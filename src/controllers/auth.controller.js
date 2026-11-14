const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Market = require('../models/Market');

function signToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      market: user.market ? user.market.toString() : null,
    },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function publicUser(user, market) {
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    role: user.role,
    permissions: user.permissions || [],
    market: market
      ? {
          id: market._id,
          name: market.name,
          slug: market.slug,
          plan: market.plan,
          subscriptionExpiresAt: market.subscriptionExpiresAt,
        }
      : null,
  };
}

// Tenant login: owner/cashier, scoped to one market via its slug.
async function login(req, res) {
  const { marketSlug, username, password } = req.body;
  if (!marketSlug || !username || !password) {
    return res.status(400).json({ message: "Do'kon kodi, login va parol kerak" });
  }

  const market = await Market.findOne({ slug: marketSlug.toLowerCase().trim() });
  if (!market || !market.active) {
    return res.status(404).json({ message: "Do'kon topilmadi" });
  }
  if (market.subscriptionExpiresAt < new Date()) {
    return res.status(403).json({ message: 'Obuna muddati tugagan. Administrator bilan bogʻlaning.' });
  }

  const user = await User.findOne({ market: market._id, username, active: true });
  if (!user) {
    return res.status(401).json({ message: 'Login yoki parol notoʻgʻri' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Login yoki parol notoʻgʻri' });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user, market) });
}

// client-alohida login: password only, no market code or username. Each
// alohida deployment serves a small, fixed set of users, so instead of
// asking for a market/username we scan active users across alohida markets
// and bcrypt.compare the password against each until one matches.
async function alohidaLogin(req, res) {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: 'Parol kerak' });
  }

  const markets = await Market.find({ alohida: true, active: true });
  const validMarketIds = markets
    .filter((market) => market.subscriptionExpiresAt > new Date())
    .map((market) => market._id);
  if (validMarketIds.length === 0) {
    return res.status(401).json({ message: 'Parol notoʻgʻri' });
  }

  const users = await User.find({ market: { $in: validMarketIds }, active: true });
  for (const user of users) {
    if (await bcrypt.compare(password, user.passwordHash)) {
      const market = markets.find((m) => m._id.equals(user.market));
      const token = signToken(user);
      return res.json({ token, user: publicUser(user, market) });
    }
  }

  res.status(401).json({ message: 'Parol notoʻgʻri' });
}

// Superadmin login: no market involved.
async function adminLogin(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Login va parol kerak' });
  }

  const user = await User.findOne({ role: 'superadmin', username, active: true });
  if (!user) {
    return res.status(401).json({ message: 'Login yoki parol notoʻgʻri' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Login yoki parol notoʻgʻri' });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user, null) });
}

async function me(req, res) {
  const user = await User.findById(req.user.id).select('-passwordHash');
  if (!user) {
    return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
  }
  const market = user.market ? await Market.findById(user.market) : null;
  res.json({ user: publicUser(user, market) });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Joriy va yangi parol kerak' });
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
  }

  const match = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!match) {
    return res.status(401).json({ message: 'Joriy parol notoʻgʻri' });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.json({ message: 'Parol yangilandi' });
}

module.exports = { login, alohidaLogin, adminLogin, me, changePassword };
