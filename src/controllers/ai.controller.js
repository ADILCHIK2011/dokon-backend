const mongoose = require('mongoose');
const Groq = require('groq-sdk');
const Market = require('../models/Market');
const Briefing = require('../models/Briefing');
const { TOOLS, executeTool } = require('../services/aiTools');

const MAX_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 20;

function buildSystemPrompt(marketName, today) {
  return `Siz "${marketName}" do'koni uchun "Do'kon" boshqaruv panelidagi AI yordamchisiz. Bugungi sana: ${today}.

Kimsiz:
- Siz do'kon egasining ICHKI biznes yordamchisisiz (mijozlar bilan emas, egasi bilan gaplashyapsiz).
- Faqat "${marketName}" do'koniga tegishli ma'lumotlarga kirish huquqingiz bor. Boshqa do'konlar haqida hech narsa bilmaysiz.

Qat'iy qoidalar:
1. Savdo, daromad, mahsulot yoki ombor haqida raqam so'ralganda — HAR DOIM avval mos vositani (tool) chaqiring. Hech qachon xotiradan yoki taxmindan raqam aytmang.
2. Savol qaysi davrga tegishli ekani noaniq bo'lsa (masalan "qancha sotildi" — qaysi kun?), taxmin qilmang, qisqa aniqlashtiruvchi savol bering.
3. So'ralgan mahsulot/ma'lumot topilmasa, buni ochiq aytib qo'ying — to'qib chiqarmang, kerak bo'lsa muqobil qidiruv taklif qiling.
4. Savol do'kon ma'lumotlariga umuman aloqasi yo'q mavzuda bo'lsa (umumiy bilim, kod yozish, boshqa mavzular) — muloyimlik bilan rad eting va faqat do'kon ma'lumotlari bo'yicha yordam bera olishingizni aytib qo'ying.
5. Javoblarni o'zbek tilida, qisqa, tabiiy va aniq yozing — ortiqcha rasmiylik yoki cho'zilishga hojat yo'q. Pul miqdorlarini har doim "so'm" bilan va minglik ajratgich bilan ko'rsating (masalan: 591 000 so'm).`;
}

function buildBriefingPrompt(marketName, today) {
  return `Siz "${marketName}" do'koni uchun "Do'kon" boshqaruv panelidagi AI yordamchisiz. Bugungi sana: ${today}.

Vazifa: do'kon egasi uchun kunlik qisqa hisobot yozing — buni ish kuni boshida o'qiydi.

Qat'iy qoidalar:
1. Avval mos vositalarni (tool) chaqirib haqiqiy raqamlarni oling: so'nggi savdo statistikasi, eng ko'p sotilgan mahsulotlar, kam qolgan yoki uzoq vaqt sotilmagan mahsulotlar. Hech qachon raqamni taxmin qilmang.
2. Natijani 3-5 qisqa gapdan iborat, o'zbek tilida, tabiiy va do'stona ohangda yozing — ro'yxat emas, bog'langan matn.
3. Eng muhim narsani birinchi ayting: yaxshi natija bo'lsa qisqa maqtang, muammo bo'lsa (masalan kam qoldiq yoki savdo pasayishi) buni ochiq ayting.
4. Pul miqdorlarini "so'm" bilan va minglik ajratgich bilan yozing (masalan: 591 000 so'm).
5. Ma'lumot yetarli bo'lmasa yoki savdo umuman bo'lmagan bo'lsa, shuni tabiiy tarzda ayting — to'qib chiqarmang.`;
}

// Shared tool-calling loop for both the interactive chat and the daily
// briefing generator — the only difference between the two is the seed
// messages passed in. Returns the assistant's final text, or null if the
// model never settled on a plain-text reply within MAX_ITERATIONS.
async function runToolLoop(groq, chatMessages, marketId) {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: chatMessages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
    });

    const message = completion.choices[0].message;
    chatMessages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content || '';
    }

    for (const call of message.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await executeTool(call.function.name, args, marketId);
      chatMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }
  return null;
}

async function chat(req, res) {
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ message: "AI yordamchi sozlanmagan. Administrator bilan bog'laning." });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ message: 'Xabar kerak' });
  }

  const history = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));

  if (history.length === 0) {
    return res.status(400).json({ message: 'Xabar kerak' });
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  // req.user.market comes from the JWT as a plain string. Model.find() casts
  // that automatically, but Model.aggregate() sends the pipeline to MongoDB
  // as-is — a bare string never matches an ObjectId field there, so every
  // aggregate-based tool would silently return zero results without this.
  const marketId = new mongoose.Types.ObjectId(req.user.market);
  const market = await Market.findById(marketId).select('name');
  const today = new Date().toISOString().slice(0, 10);
  const chatMessages = [
    { role: 'system', content: buildSystemPrompt(market?.name || "Sizning do'koningiz", today) },
    ...history,
  ];

  try {
    const reply = await runToolLoop(groq, chatMessages, marketId);
    res.json({ reply: reply ?? "Kechirasiz, so'rovni to'liq bajarib bo'lmadi. Iltimos savolni qayta so'rang." });
  } catch (err) {
    console.error('AI chat error', err);
    res.status(502).json({ message: "AI xizmati bilan bog'lanishda xatolik yuz berdi." });
  }
}

// One briefing per market per calendar day (UTC, matching aiTools' date
// convention) — cached in Mongo so repeat page loads never re-spend a Groq
// call. Router-level requirePlan('pro') already keeps this Pro-only.
async function briefing(req, res) {
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ message: "AI yordamchi sozlanmagan. Administrator bilan bog'laning." });
  }

  const marketId = new mongoose.Types.ObjectId(req.user.market);
  const today = new Date().toISOString().slice(0, 10);

  const existing = await Briefing.findOne({ market: marketId, date: today });
  if (existing) {
    return res.json({ text: existing.text, date: existing.date });
  }

  const market = await Market.findById(marketId).select('name');
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const chatMessages = [
    { role: 'system', content: buildBriefingPrompt(market?.name || "Sizning do'koningiz", today) },
    { role: 'user', content: 'Bugungi kunlik hisobotni tayyorlang.' },
  ];

  try {
    const text = await runToolLoop(groq, chatMessages, marketId);
    if (!text) {
      return res.status(502).json({ message: "Hisobotni tayyorlab bo'lmadi. Birozdan keyin qayta urining." });
    }

    let saved;
    try {
      saved = await Briefing.create({ market: marketId, date: today, text });
    } catch (err) {
      // Two tabs loading Overview at once can both miss the findOne above;
      // the loser of the race hits the unique index instead of duplicating.
      if (err.code === 11000) {
        saved = await Briefing.findOne({ market: marketId, date: today });
      } else {
        throw err;
      }
    }

    res.json({ text: saved.text, date: saved.date });
  } catch (err) {
    console.error('AI briefing error', err);
    res.status(502).json({ message: "AI xizmati bilan bog'lanishda xatolik yuz berdi." });
  }
}

module.exports = { chat, briefing };
