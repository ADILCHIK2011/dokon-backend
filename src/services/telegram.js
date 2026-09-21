const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Market = require('../models/Market');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Groq = require('groq-sdk');
const { getOrCreateBriefing, runToolLoop } = require('../controllers/ai.controller');
const { buildMarketingTools, executeMarketingTool, buildMarketingSystemPrompt } = require('./marketingAiTools');
const { formatMoney } = require('../utils/formatMoney');

let bot = null;
let botUsername = null;

// In-memory per-chat login state for the /start flow (slug -> username ->
// password). Lost on restart, which just means an in-progress login has to
// be redone with /start — no data at risk since nothing is persisted until
// the final step succeeds.
const loginSessions = new Map();

const KEYBOARD = {
  reply_markup: {
    keyboard: [['📊 Bugungi hisobot', '🔥 Top mahsulotlar'], ['📦 Kam qolgan mahsulotlar']],
    resize_keyboard: true,
  },
};

const UPGRADE_MESSAGE =
  "Bu bot faqat Pro rejadagi do'konlar uchun mavjud. Davom etish uchun Pro rejaga o'ting.";

// Telegram bot is a Pro-plan feature (same gate as telegram.routes.js), but
// a plan downgrade only takes effect at the HTTP layer via loadMarket() —
// an already-linked chat has no per-request middleware, so every entry
// point below (notifyOwners, /start, and the general message handler) has
// to re-check this itself instead of trusting telegramChatId being set.
function isMarketPro(market) {
  return !!market && market.plan === 'pro' && market.active && market.subscriptionExpiresAt >= new Date();
}

// No-ops silently when the bot isn't configured, so controllers never need
// to check whether Telegram is enabled on this deployment before calling in.
async function notifyOwners(marketId, text) {
  if (!bot) return;
  const market = await Market.findById(marketId).select('plan active subscriptionExpiresAt');
  if (!isMarketPro(market)) return;

  const owners = await User.find({ market: marketId, role: 'owner', telegramChatId: { $exists: true, $ne: null } });
  await Promise.all(
    owners.map((owner) =>
      bot.sendMessage(owner.telegramChatId, text).catch((err) => console.error('Telegram sendMessage error', err.message))
    )
  );
}

async function handleStart(msg) {
  const chatId = msg.chat.id;

  const existing = await User.findOne({ telegramChatId: String(chatId) }).populate(
    'market',
    'name plan active subscriptionExpiresAt'
  );
  if (existing) {
    if (!isMarketPro(existing.market)) {
      existing.telegramChatId = undefined;
      await existing.save();
      await bot.sendMessage(chatId, UPGRADE_MESSAGE, { reply_markup: { remove_keyboard: true } });
      return;
    }
    await bot.sendMessage(chatId, 'Siz allaqachon ulangansiz.', KEYBOARD);
    return;
  }

  loginSessions.set(chatId, { step: 'slug' });
  await bot.sendMessage(chatId, "Xush kelibsiz! Do'koningiz kodini (slug) yuboring.");
}

async function handleStop(msg) {
  const chatId = msg.chat.id;
  loginSessions.delete(chatId);
  const owner = await User.findOne({ telegramChatId: String(chatId) });
  if (owner) {
    owner.telegramChatId = undefined;
    await owner.save();
  }
  await bot.sendMessage(chatId, 'Bot uzildi. Qayta ulash uchun /start yuboring.', {
    reply_markup: { remove_keyboard: true },
  });
}

// Mirrors auth.controller.js's tenant login checks (market by slug, active +
// subscription, then user by username/password) since this is the same
// login, just carried over chat messages instead of one HTTP request —
// plus the role check that HTTP login has no need for, since only owners
// get the bot.
async function handleLoginStep(msg) {
  const chatId = msg.chat.id;
  const session = loginSessions.get(chatId);
  if (!session) return false;

  const text = (msg.text || '').trim();
  if (!text) return true;

  if (session.step === 'slug') {
    session.slug = text.toLowerCase();
    session.step = 'username';
    await bot.sendMessage(chatId, 'Login (foydalanuvchi nomi)ni yuboring.');
    return true;
  }

  if (session.step === 'username') {
    session.username = text;
    session.step = 'password';
    await bot.sendMessage(chatId, 'Parolni yuboring.');
    return true;
  }

  // step === 'password' — final step. Delete the message right away so the
  // plaintext password doesn't linger in the chat history.
  loginSessions.delete(chatId);
  bot.deleteMessage(chatId, msg.message_id).catch(() => {});

  const market = await Market.findOne({ slug: session.slug });
  if (!market || !market.active || market.subscriptionExpiresAt < new Date()) {
    await bot.sendMessage(chatId, "❌ Do'kon topilmadi yoki obuna muddati tugagan. Qaytadan urinish uchun /start yuboring.");
    return true;
  }
  if (market.plan !== 'pro') {
    await bot.sendMessage(chatId, UPGRADE_MESSAGE);
    return true;
  }

  const user = await User.findOne({ market: market._id, username: session.username, active: true });
  const passwordMatches = user && (await bcrypt.compare(text, user.passwordHash));
  if (!passwordMatches) {
    await bot.sendMessage(chatId, "❌ Login yoki parol noto'g'ri. Qaytadan urinish uchun /start yuboring.");
    return true;
  }

  if (user.role !== 'owner') {
    await bot.sendMessage(chatId, "❌ Ushbu bot faqat do'kon egalari uchun mavjud. Kassir hisoblari ulana olmaydi.");
    return true;
  }

  user.telegramChatId = String(chatId);
  await user.save();
  await bot.sendMessage(
    chatId,
    `✅ Ulandi! Endi "${market.name}" do'koni uchun bildirishnomalar shu yerga keladi.`,
    KEYBOARD
  );
  return true;
}

async function handleBriefing(chatId, marketId) {
  const result = await getOrCreateBriefing(marketId);
  await bot.sendMessage(chatId, result.error || result.text, KEYBOARD);
}

async function handleTopProducts(chatId, marketId) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await Sale.aggregate([
    { $match: { market: marketId, status: 'completed', completedAt: { $gte: startOfDay } } },
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
    { $limit: 5 },
  ]);

  if (rows.length === 0) {
    await bot.sendMessage(chatId, "Bugun hali savdo bo'lmagan.", KEYBOARD);
    return;
  }
  const lines = rows.map((r, i) => `${i + 1}. ${r.name} — ${r.quantity} dona, ${formatMoney(r.revenue)}`);
  await bot.sendMessage(chatId, `🔥 Bugungi top mahsulotlar:\n\n${lines.join('\n')}`, KEYBOARD);
}

async function handleLowStock(chatId, marketId) {
  const products = await Product.find({ market: marketId, active: true, stock: { $lte: 5 } })
    .sort({ stock: 1 })
    .limit(10);

  if (products.length === 0) {
    await bot.sendMessage(chatId, "Kam qolgan mahsulot yo'q. 👍", KEYBOARD);
    return;
  }
  const lines = products.map((p) => `• ${p.name} — ${p.stock} dona`);
  await bot.sendMessage(chatId, `📦 Kam qolgan mahsulotlar:\n\n${lines.join('\n')}`, KEYBOARD);
}

// Anything typed that isn't a login step or a keyboard button — free-text
// marketing/business questions, answered by the same tool-calling loop the
// dashboard AI assistant uses (ai.controller.js's runToolLoop), but with the
// marketing-scoped tool set (sales/stock tools + flag_question) and system
// prompt from marketingAiTools.js.
async function handleMarketingChat(chatId, marketId, marketName, question) {
  if (!process.env.GROQ_API_KEY) {
    await bot.sendMessage(chatId, "AI yordamchi sozlanmagan.", KEYBOARD);
    return;
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const chatMessages = [
    { role: 'system', content: buildMarketingSystemPrompt(marketName) },
    { role: 'user', content: question },
  ];

  try {
    const text = await runToolLoop(groq, chatMessages, marketId, {
      tools: buildMarketingTools(),
      executeToolFn: executeMarketingTool,
      context: { question },
    });
    await bot.sendMessage(chatId, text || "Kechirasiz, javob topilmadi.", KEYBOARD);
  } catch (err) {
    console.error('Telegram marketing chat error', err);
    await bot.sendMessage(chatId, "AI xizmati bilan bog'lanishda xatolik yuz berdi.", KEYBOARD);
  }
}

function registerHandlers() {
  bot.onText(/^\/start$/, (msg) => {
    handleStart(msg).catch((err) => console.error('Telegram /start error', err));
  });

  bot.onText(/^\/stop$/, (msg) => {
    handleStop(msg).catch((err) => console.error('Telegram /stop error', err));
  });

  bot.on('message', (msg) => {
    const text = (msg.text || '').trim();
    if (!text || text.startsWith('/')) return; // commands are handled by onText above

    handleLoginStep(msg)
      .then((handled) => {
        if (handled) return null;
        return User.findOne({ telegramChatId: String(msg.chat.id) })
          .populate('market', 'name plan active subscriptionExpiresAt')
          .then((owner) => {
            if (!owner) return null;
            if (!isMarketPro(owner.market)) {
              owner.telegramChatId = undefined;
              return owner
                .save()
                .then(() => bot.sendMessage(msg.chat.id, UPGRADE_MESSAGE, { reply_markup: { remove_keyboard: true } }));
            }
            const marketId = owner.market._id;
            if (text === '📊 Bugungi hisobot') return handleBriefing(msg.chat.id, marketId);
            if (text === '🔥 Top mahsulotlar') return handleTopProducts(msg.chat.id, marketId);
            if (text === '📦 Kam qolgan mahsulotlar') return handleLowStock(msg.chat.id, marketId);
            return handleMarketingChat(msg.chat.id, marketId, owner.market.name, text);
          });
      })
      .catch((err) => console.error('Telegram message handler error', err));
  });

  bot.on('polling_error', (err) => console.error('Telegram polling error', err.message));
}

// Pushed only to Pro markets — matches the Pro-only gate on GET
// /api/ai/briefing (requirePlan('pro') in ai.routes.js).
function scheduleBriefingJob() {
  cron.schedule(
    '0 8 * * *',
    async () => {
      const markets = await Market.find({ plan: 'pro', active: true }).select('_id');
      for (const market of markets) {
        try {
          const result = await getOrCreateBriefing(market._id);
          if (!result.error) {
            await notifyOwners(market._id, `📊 Kunlik hisobot:\n\n${result.text}`);
          }
        } catch (err) {
          console.error('Telegram daily briefing job error', err);
        }
      }
    },
    { timezone: 'Asia/Tashkent' }
  );
}

// Exact-day thresholds (not "<= N days") so each market gets one reminder
// per threshold instead of a daily message throughout the whole window.
function scheduleSubscriptionReminderJob() {
  const THRESHOLDS = new Set([7, 3, 1, 0]);
  cron.schedule(
    '0 9 * * *',
    async () => {
      const markets = await Market.find({ active: true });
      const now = new Date();
      for (const market of markets) {
        const daysLeft = Math.ceil((market.subscriptionExpiresAt - now) / (1000 * 60 * 60 * 24));
        if (!THRESHOLDS.has(daysLeft)) continue;
        const text =
          daysLeft === 0
            ? "⚠️ Obuna muddati bugun tugaydi. Yangilash uchun administrator bilan bog'laning."
            : `⚠️ Obuna muddati ${daysLeft} kundan so'ng tugaydi. Yangilash uchun administrator bilan bog'laning.`;
        try {
          await notifyOwners(market._id, text);
        } catch (err) {
          console.error('Telegram subscription reminder job error', err);
        }
      }
    },
    { timezone: 'Asia/Tashkent' }
  );
}

function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled');
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  bot
    .getMe()
    .then((me) => {
      botUsername = me.username;
      console.log(`Telegram bot @${botUsername} started`);
    })
    .catch((err) => console.error('Telegram getMe error', err.message));

  registerHandlers();
  scheduleBriefingJob();
  scheduleSubscriptionReminderJob();
}

function getBotUsername() {
  return botUsername;
}

function isEnabled() {
  return bot !== null;
}

module.exports = { initBot, notifyOwners, getBotUsername, isEnabled };
