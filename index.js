// index.js — FULL REDESIGNED VERSION with Beautiful UI

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs-extra");
const path = require("path");
const { execSync } = require("child_process");
const {
  deploy,
  undeploy,
  scanTemplatePlaceholders,
  TEMPLATES_DIR,
  DEPLOYMENTS_DIR,
} = require("./deploy");

// ============================================================
// CONFIGURATION
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

const CARD_NUMBER = "8600 0609 9034 6414";
const MIN_TOPUP = 1000;
const MAX_TOPUP = 500000;
const TOPUP_TIMEOUT_MS = 5 * 60 * 1000;
const REFERRAL_BONUS = 1000;
const DAILY_BONUS = 700;
const DAILY_BONUS_INTERVAL_MS = 24 * 60 * 60 * 1000;

const NEWS_CHANNEL_ID = "@org081";
const BOT_HANDLE = "@builderdevrobot";

// ============================================================
// ✨ BEAUTIFUL UI CONSTANTS
// ============================================================
const UI = {
  // Chiziqlar
  line: "━━━━━━━━━━━━━━━━━━━━━━━━━",
  doubleLine: "══════════════════════════",
  waveLine: "〰️〰️〰️〰️〰️〰️〰️〰️〰️〰️〰️〰️〰️",
  dotLine: "• • • • • • • • • • • • •",
  sparkLine: "✦ ━━━━━━━━━━━━━━━━━━━ ✦",
  starLine: "⭐━━━━━━━━━━━━━━━━━━━⭐",
  diamondLine: "◆━━━━━━━━━━━━━━━━━━━◆",

  // Ramkalar
  topBorder: "╔══════════════════════════╗",
  bottomBorder: "╚══════════════════════════╝",
  sideBorder: "║",

  // Progress bar
  progressFull: "█",
  progressEmpty: "░",
  progressHalf: "▓",

  // Dekoratsiyalar
  arrow: "➤",
  bullet: "◈",
  diamond: "◆",
  star: "✦",
  sparkle: "✨",
  fire: "🔥",
  rocket: "🚀",
  check: "✅",
  cross: "❌",
  warning: "⚠️",
  info: "ℹ️",
  crown: "👑",
  gem: "💎",
  money: "💰",
  card: "💳",
  gift: "🎁",
  trophy: "🏆",
  chart: "📊",
  folder: "📁",
  package: "📦",
  robot: "🤖",
  shield: "🛡️",
  key: "🔑",
  lock: "🔒",
  globe: "🌐",
  lightning: "⚡",
  heart: "❤️",
  celebration: "🎉",
};

// Chiroyli matn formatlash
function beautyBox(title, content, emoji = "✨") {
  return (
    `${emoji} *${title}*\n` +
    `${UI.sparkLine}\n\n` +
    `${content}\n\n` +
    `${UI.sparkLine}`
  );
}

function beautyHeader(text, emoji = "🔷") {
  return `\n${emoji} *${text}*\n${UI.line}\n`;
}

function beautyItem(emoji, label, value) {
  return `${emoji} ${label}: *${value}*`;
}

function progressBar(percent, length = 20) {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)} ${percent}%`;
}

// ============================================================
// NEWS CHANNEL HELPER
// ============================================================
async function sendToChannel(text, options = {}) {
  try {
    await bot.sendMessage(NEWS_CHANNEL_ID, text, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      ...options,
    });
  } catch (err) {
    console.error("Channel send error:", err.message);
  }
}

function maskUsername(username) {
  if (!username) return "Yashirin";
  const clean = username.replace("@", "");
  if (clean.length <= 4) return "@" + clean[0] + "***";
  return "@" + clean.slice(0, 2) + "***" + clean.slice(-2);
}

// ============================================================
// DATABASE
// ============================================================
const DB_PATH = path.join(__dirname, "database.json");

function loadDB() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!data.users) data.users = [];
    if (!data.templates) data.templates = [];
    if (!data.purchases) data.purchases = [];
    if (!data.pending) data.pending = {};
    if (!data.promoCodes) data.promoCodes = [];
    if (!data.topups) data.topups = [];

    for (const u of data.users) {
      if (typeof u.balance !== "number") u.balance = 0;
      if (u.referredBy === undefined) u.referredBy = null;
      if (u.lastDailyBonus === undefined) u.lastDailyBonus = null;
      if (!u.usedPromoCodes) u.usedPromoCodes = [];
      if (typeof u.referralCount !== "number") u.referralCount = 0;
      if (typeof u.referralEarnings !== "number") u.referralEarnings = 0;
    }

    for (const t of data.templates) {
      if (typeof t.priceUZS !== "number") t.priceUZS = t.price * 100;
    }

    for (const p of data.purchases) {
      if (!p.deployId) p.deployId = `${p.userId}_${p.id}`;
      if (!p.processName) p.processName = `bot_${p.deployId}`;
    }

    return data;
  } catch {
    const fresh = {
      templates: [],
      purchases: [],
      pending: {},
      users: [],
      promoCodes: [],
      topups: [],
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function trackUser(userId, firstName, username) {
  const db = loadDB();
  if (!db.users) db.users = [];
  const existing = db.users.find((u) => u.id === userId);
  if (existing) {
    existing.firstName = firstName || existing.firstName;
    existing.username = username || existing.username;
    existing.lastSeen = new Date().toISOString();
    saveDB(db);
    return { isNew: false, user: existing };
  } else {
    const newUser = {
      id: userId,
      firstName: firstName || "Unknown",
      username: username || "",
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      balance: 0,
      referredBy: null,
      lastDailyBonus: null,
      usedPromoCodes: [],
      referralCount: 0,
      referralEarnings: 0,
    };
    db.users.push(newUser);
    saveDB(db);

    const totalUsers = db.users.length;
    sendToChannel(
      `👤 *Yangi foydalanuvchi!*\n\n` +
        `🆔 ${maskUsername(username || "")}\n` +
        `👥 Jami: *${totalUsers}* ta\n\n` +
        `${BOT_HANDLE}`,
    );

    return { isNew: true, user: newUser };
  }
}

// ============================================================
// WALLET HELPERS
// ============================================================
function getUser(userId) {
  const db = loadDB();
  return db.users.find((u) => u.id === userId) || null;
}

function getBalance(userId) {
  const u = getUser(userId);
  return u ? u.balance : 0;
}

function formatUZS(amount) {
  return Number(amount).toLocaleString("uz-UZ").replace(/,/g, " ") + " so'm";
}

let BOT_USERNAME = null;
async function getBotUsername() {
  if (BOT_USERNAME) return BOT_USERNAME;
  try {
    const me = await bot.getMe();
    BOT_USERNAME = me.username;
  } catch {
    BOT_USERNAME = "";
  }
  return BOT_USERNAME;
}

fs.ensureDirSync(TEMPLATES_DIR);
fs.ensureDirSync(DEPLOYMENTS_DIR);

// ============================================================
// BOT
// ============================================================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Bot Builder started!");

// ============================================================
// STATE
// ============================================================
const userStates = {};
function clearState(userId) {
  delete userStates[userId];
}
function getState(userId) {
  return userStates[userId] || null;
}
function setState(userId, state) {
  userStates[userId] = state;
}

// ============================================================
// PLACEHOLDER INFO
// ============================================================
const PLACEHOLDER_INFO = {
  YOUR_BOT_TOKEN_HERE: {
    label: "🔑 Bot Token",
    prompt:
      "🔑 *Bot tokeningizni kiriting:*\n\n💡 BotFather dan olingan token\n📝 Format: `123456789:ABCdefGhIjKlMnOpQrStUvWxYz`",
    validate: (val) => /^\d{8,}:[A-Za-z0-9_-]{35,}$/.test(val.trim()),
    error:
      "❌ *Token formati noto'g'ri!*\n\n📝 Format: `123456789:ABCdefGhIjKlMnOpQrStUvWxYz`\n\nQaytadan yuboring:",
  },
  YOUR_TELEGRAM_ID: {
    label: "👤 Telegram ID",
    prompt:
      "👤 *Telegram ID raqamingizni yuboring:*\n\n💡 Sizning ID: `{USER_ID}`",
    validate: (val) => /^\d{5,15}$/.test(val.trim()),
    error: "❌ ID faqat raqamlardan iborat bo'lishi kerak!",
  },
  YOUR_ADMIN_ID: {
    label: "👑 Admin ID",
    prompt: "👑 *Admin Telegram ID kiriting:*\n\n💡 Sizning ID: `{USER_ID}`",
    validate: (val) => /^\d{5,15}$/.test(val.trim()),
    error: "❌ ID faqat raqam bo'lishi kerak!",
  },
  YOUR_API_KEY: {
    label: "🔐 API Key",
    prompt: "🔐 *API kalitini kiriting:*",
    validate: () => true,
    error: "",
  },
  YOUR_DATABASE_URL: {
    label: "🗄️ Database URL",
    prompt:
      "🗄️ *Database URL kiriting:*\n\n📝 Masalan: `mongodb://localhost:27017/mydb`",
    validate: (val) => val.trim().length > 5,
    error: "❌ URL juda qisqa!",
  },
  YOUR_WEBHOOK_URL: {
    label: "🌐 Webhook URL",
    prompt:
      "🌐 *Webhook URL kiriting:*\n\n📝 Masalan: `https://yourdomain.com/webhook`",
    validate: (val) => val.trim().startsWith("http"),
    error: '❌ URL "http" bilan boshlanishi kerak!',
  },
  YOUR_CHANNEL_ID: {
    label: "📢 Channel ID",
    prompt:
      "📢 *Kanal ID kiriting:*\n\n📝 Masalan: `@kanalnom` yoki `-1001234567890`",
    validate: (val) => val.trim().length > 2,
    error: "❌ Noto'g'ri format!",
  },
  YOUR_GROUP_ID: {
    label: "👥 Group ID",
    prompt: "👥 *Guruh ID kiriting:*\n\n📝 Masalan: `-1001234567890`",
    validate: (val) => val.trim().length > 2,
    error: "❌ Noto'g'ri format!",
  },
  YOUR_PAYMENT_TOKEN: {
    label: "💳 Payment Token",
    prompt: "💳 *To'lov provider tokenini kiriting:*",
    validate: (val) => val.trim().length > 5,
    error: "❌ Token juda qisqa!",
  },
};

// ============================================================
// ✨ BEAUTIFUL KEYBOARDS
// ============================================================
function isAdmin(userId) {
  return userId === ADMIN_ID;
}

function getMainKeyboard(userId) {
  const keyboard = [
    [{ text: "🛍 Botlar do'koni" }, { text: "📱 Mening botlarim" }],
    [{ text: "💎 Pul ishlash" }, { text: "💳 Balansni to'ldirish" }],
    [{ text: "📈 Statistika" }, { text: "🆘 Yordam" }],
  ];
  if (isAdmin(userId)) keyboard.push([{ text: "⚙️ Admin panel" }]);
  return { reply_markup: { keyboard, resize_keyboard: true } };
}

function getEarnMoneyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎟 Promokod kiritish", callback_data: "earn_promo" }],
        [{ text: "🎁 Kunlik sovg'a", callback_data: "earn_daily" }],
        [
          {
            text: "👥 Do'stlarni taklif qilish",
            callback_data: "earn_referral",
          },
        ],
        [{ text: "💳 Balansni to'ldirish", callback_data: "go_topup" }],
        [{ text: "🏠 Bosh menyu", callback_data: "back_main" }],
      ],
    },
  };
}

function getAdminKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📥 Shablon yuklash", callback_data: "admin_add" },
          { text: "📋 Shablonlar ro'yxati", callback_data: "admin_list" },
        ],
        [
          { text: "🗑 O'chirish", callback_data: "admin_delete" },
          { text: "✏️ Tahrirlash", callback_data: "admin_edit" },
        ],
        [
          { text: "👥 Foydalanuvchilar", callback_data: "admin_users" },
          { text: "📊 Batafsil statistika", callback_data: "admin_stats" },
        ],
        [
          { text: "📢 Xabar yuborish", callback_data: "admin_broadcast" },
          {
            text: "🔄 Botni qayta ishga tushirish",
            callback_data: "admin_restart_bot",
          },
        ],
        [{ text: "🗂 Barcha deploylar", callback_data: "admin_deployments" }],
        [
          { text: "🎟 Promokodlar boshqaruvi", callback_data: "admin_promo" },
          { text: "💳 To'lovlar nazorati", callback_data: "admin_topups" },
        ],
        [{ text: "🏠 Bosh menyu", callback_data: "back_main" }],
      ],
    },
  };
}

function getBackToMainInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🏠 Bosh menyu", callback_data: "back_main" }],
      ],
    },
  };
}

function getBackToAdminInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "⬅️ Admin panelga", callback_data: "back_admin" }],
      ],
    },
  };
}

function getCancelInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✖️ Bekor qilish", callback_data: "admin_cancel" }],
      ],
    },
  };
}

function getCancelMainInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✖️ Bekor qilish", callback_data: "back_main" }],
      ],
    },
  };
}

// ============================================================
// PM2 HELPERS
// ============================================================
function getPm2Status(processName) {
  try {
    const output = execSync(`pm2 jlist`, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const processes = JSON.parse(output);
    const proc = processes.find((p) => p.name === processName);
    if (!proc) return null;
    return {
      status: proc.pm2_env.status,
      uptime: proc.pm2_env.pm_uptime,
      restarts: proc.pm2_env.restart_time,
      cpu: proc.monit?.cpu || 0,
      memory: proc.monit?.memory || 0,
    };
  } catch {
    return null;
  }
}

function getPm2Logs(processName, lines = 15) {
  try {
    const output = execSync(
      `pm2 logs ${processName} --nostream --lines ${lines}`,
      { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return output.trim().slice(0, 3500) || "Loglar bo'sh.";
  } catch {
    return "❌ Loglarni olishda xatolik.";
  }
}

function restartPm2Process(processName) {
  try {
    execSync(`pm2 restart ${processName}`, { stdio: "pipe", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function stopPm2Process(processName) {
  try {
    execSync(`pm2 stop ${processName}`, { stdio: "pipe", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// HELPERS
// ============================================================
function formatUptime(uptimeMs) {
  if (!uptimeMs) return "N/A";
  const diff = Date.now() - uptimeMs;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}k ${hours % 24}s`;
  if (hours > 0) return `${hours}s ${minutes % 60}d`;
  if (minutes > 0) return `${minutes} daqiqa`;
  return `${seconds} soniya`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

// ============================================================
// PLACEHOLDER COLLECTION
// ============================================================
async function startPlaceholderCollection(
  chatId,
  userId,
  template,
  purchaseId,
) {
  const placeholders = scanTemplatePlaceholders(template.fileName);
  if (!placeholders.includes("YOUR_BOT_TOKEN_HERE"))
    placeholders.unshift("YOUR_BOT_TOKEN_HERE");
  const tokenIdx = placeholders.indexOf("YOUR_BOT_TOKEN_HERE");
  if (tokenIdx > 0) {
    placeholders.splice(tokenIdx, 1);
    placeholders.unshift("YOUR_BOT_TOKEN_HERE");
  }

  const uniquePlaceholders = [...new Set(placeholders)];
  const firstPh = uniquePlaceholders[0];
  const firstInfo = PLACEHOLDER_INFO[firstPh];
  const prompt = (
    firstInfo?.prompt || `"${firstPh}" qiymatini kiriting:`
  ).replace("{USER_ID}", String(userId));

  setState(userId, {
    step: "collecting_placeholders",
    templateId: template.id,
    templateName: template.name,
    fileName: template.fileName,
    purchaseId,
    placeholders: uniquePlaceholders,
    currentIndex: 0,
    collectedValues: {},
  });

  const phListText = uniquePlaceholders
    .map((ph, i) => {
      const label = PLACEHOLDER_INFO[ph]?.label || ph;
      const num =
        ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"][i] ||
        `${i + 1}.`;
      return `  ${num} ${label}`;
    })
    .join("\n");

  await bot.sendMessage(
    chatId,
    `📋 *Sozlash — ${uniquePlaceholders.length} ta ma'lumot kerak*\n` +
      `${UI.sparkLine}\n\n` +
      `${phListText}\n\n` +
      `${UI.line}\n\n` +
      `${prompt}`,
    { parse_mode: "Markdown" },
  );
}

// ============================================================
// /start
// ============================================================
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const userId = msg.from.id;
  clearState(userId);
  const { isNew } = trackUser(userId, msg.from.first_name, msg.from.username);

  const payload = match && match[1] ? match[1].trim() : "";
  if (isNew && payload.startsWith("ref_")) {
    const referrerId = Number(payload.replace("ref_", ""));
    if (referrerId && referrerId !== userId) {
      const db = loadDB();
      const referrer = db.users.find((u) => u.id === referrerId);
      const self = db.users.find((u) => u.id === userId);
      if (referrer && self && !self.referredBy) {
        self.referredBy = referrerId;
        referrer.balance =
          Math.round((referrer.balance + REFERRAL_BONUS) * 100) / 100;
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        referrer.referralEarnings =
          Math.round(
            ((referrer.referralEarnings || 0) + REFERRAL_BONUS) * 100,
          ) / 100;
        saveDB(db);

        bot
          .sendMessage(
            referrerId,
            `🎉 *Yangi referal qo'shildi!*\n` +
              `${UI.sparkLine}\n\n` +
              `👤 ${msg.from.first_name || "Foydalanuvchi"}\n` +
              `💰 Bonus: +${formatUZS(REFERRAL_BONUS)}\n` +
              `💼 Balans: *${formatUZS(referrer.balance)}*\n\n` +
              `${UI.sparkLine}`,
            { parse_mode: "Markdown" },
          )
          .catch(() => {});

        sendToChannel(
          `🔗 *Referal!*\n\n` +
            `👤 ${maskUsername(msg.from.username || "")} qo'shildi\n` +
            `🎯 ${maskUsername(referrer.username || "")}\n` +
            `💰 +${formatUZS(REFERRAL_BONUS)}\n\n${BOT_HANDLE}`,
        );
      }
    }
  }

  const balance = getBalance(userId);
  const db = loadDB();
  const myBots = db.purchases.filter(
    (p) => p.userId === userId && p.deployed,
  ).length;

  bot.sendMessage(
    userId,
    `✨ *Xush kelibsiz!*\n` +
      `${UI.doubleLine}\n\n` +
      `🤖 *Telegram Bot Builder* — botlar dunyosi\n\n` +
      `${UI.line}\n\n` +
      `📊 *Sizning hisobingiz:*\n` +
      `  💼 Balans: *${formatUZS(balance)}*\n` +
      `  🤖 Botlarim: *${myBots}* ta\n\n` +
      `${UI.line}\n\n` +
      `🎯 *Imkoniyatlar:*\n\n` +
      `  🛍 Tayyor bot shablonlari\n` +
      `  ⚡ 1 daqiqada avtomatik deploy\n` +
      `  💎 Pul ishlash — bonus, referal\n` +
      `  🔧 To'liq bot boshqaruvi\n` +
      `  💳 Qulay to'lov usullari\n\n` +
      `${UI.doubleLine}\n\n` +
      `👇 *Quyidagi bo'limlardan tanlang:*`,
    { parse_mode: "Markdown", ...getMainKeyboard(userId) },
  );
});

bot.onText(/\/help/, (msg) => {
  clearState(msg.from.id);
  sendHelpMessage(msg.chat.id, msg.from.id);
});

bot.onText(/\/myid/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `👤 *Sizning ma'lumotlaringiz:*\n` +
      `${UI.sparkLine}\n\n` +
      `🆔 ID: \`${msg.from.id}\`\n` +
      `📛 Ism: *${msg.from.first_name || "—"}*\n` +
      `👤 Username: ${msg.from.username ? "@" + msg.from.username : "—"}\n\n` +
      `${UI.sparkLine}`,
    { parse_mode: "Markdown" },
  );
});

// ============================================================
// ✨ CATALOG — BEAUTIFUL VERSION
// ============================================================
async function showCatalog(chatId, userId) {
  const db = loadDB();
  if (db.templates.length === 0) {
    return bot.sendMessage(
      chatId,
      `🛍 *Botlar do'koni*\n` +
        `${UI.sparkLine}\n\n` +
        `📭 Hozircha shablonlar mavjud emas.\n` +
        `⏳ Tez orada yangi botlar qo'shiladi!\n\n` +
        `${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getBackToMainInline() },
    );
  }

  const buttons = [];

  for (let i = 0; i < db.templates.length; i++) {
    const tmpl = db.templates[i];
    const priceUZS = tmpl.priceUZS || tmpl.price * 100;

    // Har xil emoji bilan chiroyli ko'rinish
    const emojis = ["🔵", "🟢", "🟡", "🟣", "🔴", "🟠", "⚪", "🔷", "🟩", "🟨"];
    const emoji = emojis[i % emojis.length];

    if (isAdmin(userId)) {
      buttons.push([
        {
          text: `${emoji} ${tmpl.name} 👑 Bepul`,
          callback_data: `viewbot_${tmpl.id}`,
        },
      ]);
    } else {
      buttons.push([
        {
          text: `${emoji} ${tmpl.name} • ${formatUZS(priceUZS)}`,
          callback_data: `viewbot_${tmpl.id}`,
        },
      ]);
    }
  }

  buttons.push([{ text: "🏠 Bosh menyu", callback_data: "back_main" }]);

  await bot.sendMessage(
    chatId,
    `🛍 *Botlar do'koni*\n` +
      `${UI.doubleLine}\n\n` +
      `📦 Mavjud shablonlar: *${db.templates.length}* ta\n` +
      `⚡ Sotib oling va 1 daqiqada ishga tushiring!\n\n` +
      `${UI.line}\n\n` +
      `👇 *Bot tanlang:*`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    },
  );
}

// ============================================================
// ✨ VIEW BOT DETAILS — BEAUTIFUL
// ============================================================
async function showBotDetails(chatId, userId, templateId) {
  const db = loadDB();
  const tmpl = db.templates.find((t) => t.id === templateId);
  if (!tmpl) return bot.sendMessage(chatId, "❌ Shablon topilmadi.");

  const placeholders = scanTemplatePlaceholders(tmpl.fileName);
  const phList =
    placeholders.length > 0
      ? placeholders
          .map((p) => `  ◈ ${PLACEHOLDER_INFO[p]?.label || p}`)
          .join("\n")
      : "  ◈ Faqat bot token";
  const priceUZS = tmpl.priceUZS || tmpl.price * 100;

  const purchaseCount = db.purchases.filter(
    (p) => p.templateId === tmpl.id,
  ).length;

  const text =
    `🤖 *${tmpl.name}*\n` +
    `${UI.doubleLine}\n\n` +
    `💰 *Narxlar:*\n` +
    `  ⭐ Stars: *${tmpl.price} Stars*\n` +
    `  💵 So'm: *${formatUZS(priceUZS)}*\n\n` +
    `${UI.line}\n\n` +
    `📋 *Kerakli sozlamalar:*\n` +
    `${phList}\n\n` +
    `${UI.line}\n\n` +
    `📊 *Ma'lumot:*\n` +
    `  🛒 Sotilgan: *${purchaseCount}* marta\n` +
    `  🆔 ID: \`${tmpl.id}\`\n\n` +
    `${UI.doubleLine}`;

  const buyText = isAdmin(userId) ? "👑 Bepul deploy" : "🛒 Sotib olish";

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: `${buyText}`, callback_data: `buy_${tmpl.id}` }],
        [{ text: "⬅️ Katalogga qaytish", callback_data: "go_catalog" }],
      ],
    },
  });
}

// ============================================================
// ✨ MY BOTS — BEAUTIFUL
// ============================================================
async function showMyBots(chatId, userId) {
  const db = loadDB();
  const myPurchases = db.purchases.filter(
    (p) => p.userId === userId && p.deployed,
  );

  if (myPurchases.length === 0) {
    return bot.sendMessage(
      chatId,
      `📱 *Mening botlarim*\n` +
        `${UI.sparkLine}\n\n` +
        `📭 Sizda hali deploy qilingan bot yo'q.\n\n` +
        `💡 Katalogdan bot tanlang va\n` +
        `⚡ 1 daqiqada ishga tushiring!\n\n` +
        `${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🛍 Do'konga o'tish", callback_data: "go_catalog" }],
            [{ text: "🏠 Bosh menyu", callback_data: "back_main" }],
          ],
        },
      },
    );
  }

  await bot.sendMessage(
    chatId,
    `📱 *Mening botlarim*\n` +
      `${UI.doubleLine}\n\n` +
      `🤖 Jami: *${myPurchases.length}* ta bot\n\n` +
      `${UI.line}`,
    { parse_mode: "Markdown" },
  );

  for (const purchase of myPurchases) {
    const processName =
      purchase.processName || `bot_${purchase.userId}_${purchase.id}`;
    const pm2Info = getPm2Status(processName);

    let statusEmoji, statusText, statusColor;
    if (pm2Info) {
      if (pm2Info.status === "online") {
        statusEmoji = "🟢";
        statusText = "Ishlayapti";
        statusColor = "✅";
      } else if (pm2Info.status === "stopped") {
        statusEmoji = "🔴";
        statusText = "To'xtatilgan";
        statusColor = "⛔";
      } else {
        statusEmoji = "🟡";
        statusText = pm2Info.status;
        statusColor = "⚠️";
      }
    } else {
      statusEmoji = "⚪";
      statusText = "Noma'lum";
      statusColor = "❓";
    }

    let text =
      `🤖 *${purchase.templateName}*\n` +
      `${UI.sparkLine}\n\n` +
      `${statusEmoji} Status: *${statusText}*\n` +
      `📁 Process: \`${processName}\`\n` +
      `📅 Deploy: ${new Date(purchase.date).toLocaleDateString("uz-UZ")}\n`;

    if (pm2Info && pm2Info.status === "online") {
      const memPercent = Math.min(
        100,
        Math.round((pm2Info.memory / (512 * 1024 * 1024)) * 100),
      );
      text +=
        `\n📊 *Monitoring:*\n` +
        `  ⏱ Uptime: *${formatUptime(pm2Info.uptime)}*\n` +
        `  💾 Xotira: *${formatBytes(pm2Info.memory)}*\n` +
        `  🔄 Restartlar: *${pm2Info.restarts}*\n` +
        `  📈 RAM: ${progressBar(memPercent, 10)}\n`;
    }

    text += `\n${UI.sparkLine}`;

    const buttons = [];
    if (pm2Info && pm2Info.status === "online") {
      buttons.push([
        { text: "⏹ To'xtatish", callback_data: `bot_stop_${purchase.id}` },
        { text: "🔄 Restart", callback_data: `bot_restart_${purchase.id}` },
      ]);
    } else if (pm2Info && pm2Info.status === "stopped") {
      buttons.push([
        {
          text: "▶️ Ishga tushirish",
          callback_data: `bot_restart_${purchase.id}`,
        },
      ]);
    }
    buttons.push([
      { text: "📋 Loglar ko'rish", callback_data: `bot_logs_${purchase.id}` },
      { text: "🗑 O'chirish", callback_data: `undeploy_${purchase.id}` },
    ]);
    buttons.push([
      {
        text: "🔄 Ma'lumotni yangilash",
        callback_data: `bot_refresh_${purchase.id}`,
      },
    ]);

    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

// ============================================================
// ✨ STATISTICS — BEAUTIFUL
// ============================================================
async function showStatistics(chatId, userId) {
  const db = loadDB();
  const user = getUser(userId);
  const myBots = db.purchases.filter(
    (p) => p.userId === userId && p.deployed,
  ).length;
  const myPurchases = db.purchases.filter((p) => p.userId === userId).length;

  let text =
    `📈 *Statistika*\n` +
    `${UI.doubleLine}\n\n` +
    `👤 *Sizning hisobingiz:*\n` +
    `  💼 Balans: *${formatUZS(user?.balance || 0)}*\n` +
    `  🤖 Botlarim: *${myBots}* ta\n` +
    `  🛒 Xaridlarim: *${myPurchases}* ta\n` +
    `  👥 Referallarim: *${user?.referralCount || 0}* ta\n` +
    `  💰 Ref. daromad: *${formatUZS(user?.referralEarnings || 0)}*\n\n` +
    `${UI.line}\n\n` +
    `🌐 *Umumiy statistika:*\n` +
    `  📦 Shablonlar: *${db.templates.length}* ta\n` +
    `  🚀 Barcha deploylar: *${db.purchases.filter((p) => p.deployed).length}* ta\n` +
    `  👥 Foydalanuvchilar: *${db.users.length}* ta\n` +
    `  🛒 Jami xaridlar: *${db.purchases.length}* ta\n\n`;

  if (db.templates.length > 0) {
    text += `${UI.line}\n\n📋 *Mavjud shablonlar:*\n`;
    for (const t of db.templates) {
      text += `  ◈ ${t.name} — ⭐${t.price} / ${formatUZS(t.priceUZS || t.price * 100)}\n`;
    }
  }

  text += `\n${UI.doubleLine}`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToMainInline(),
  });
}

// ============================================================
// ✨ HELP — BEAUTIFUL
// ============================================================
async function sendHelpMessage(chatId, userId) {
  const text =
    `🆘 *Yordam markazi*\n` +
    `${UI.doubleLine}\n\n` +
    `🛍 *Botlar do'koni*\n` +
    `  Bot shablonlarini ko'ring va sotib oling\n\n` +
    `📱 *Mening botlarim*\n` +
    `  Deploy qilingan botlarni boshqaring\n\n` +
    `💎 *Pul ishlash*\n` +
    `  Promokod, kunlik bonus, referal\n\n` +
    `💳 *Balansni to'ldirish*\n` +
    `  Karta orqali hisobni to'ldiring\n\n` +
    `📈 *Statistika*\n` +
    `  Umumiy va shaxsiy statistika\n\n` +
    `${UI.line}\n\n` +
    `⚡ *Qanday ishlaydi?*\n\n` +
    `  1️⃣ Do'kondan bot tanlang\n` +
    `  2️⃣ To'lovni amalga oshiring\n` +
    `  3️⃣ Kerakli ma'lumotlarni kiriting\n` +
    `  4️⃣ Bot avtomatik deploy bo'ladi ✅\n\n` +
    `${UI.line}\n\n` +
    `🔧 *Buyruqlar:*\n` +
    `  /start — Botni boshlash\n` +
    `  /help — Yordam\n` +
    `  /myid — ID ko'rish\n\n` +
    `📢 Kanal: ${NEWS_CHANNEL_ID}\n` +
    `🤖 Bot: ${BOT_HANDLE}\n\n` +
    `${UI.doubleLine}`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToMainInline(),
  });
}

// ============================================================
// ✨ EARN MONEY — BEAUTIFUL
// ============================================================
async function showEarnMoney(chatId, userId) {
  const balance = getBalance(userId);
  const user = getUser(userId);

  await bot.sendMessage(
    chatId,
    `💎 *Pul ishlash markazi*\n` +
      `${UI.doubleLine}\n\n` +
      `💼 Balans: *${formatUZS(balance)}*\n\n` +
      `${UI.line}\n\n` +
      `🎟 *Promokod* — maxsus kodlar orqali bonus\n` +
      `🎁 *Kunlik sovg'a* — har kuni ${formatUZS(DAILY_BONUS)}\n` +
      `👥 *Referal* — har bir do'st uchun ${formatUZS(REFERRAL_BONUS)}\n\n` +
      `${UI.line}\n\n` +
      `📊 *Sizning natijalaringiz:*\n` +
      `  👥 Taklif qilganlar: *${user?.referralCount || 0}* ta\n` +
      `  💰 Ref. daromad: *${formatUZS(user?.referralEarnings || 0)}*\n\n` +
      `${UI.doubleLine}\n\n` +
      `👇 *Bo'limni tanlang:*`,
    { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
  );
}

async function handlePromoStart(chatId, userId) {
  setState(userId, { step: "waiting_promo_code" });
  await bot.sendMessage(
    chatId,
    `🎟 *Promokod kiritish*\n` +
      `${UI.sparkLine}\n\n` +
      `📝 Promokodni kiriting:\n\n` +
      `💡 Promokodlar kanalda e'lon qilinadi\n` +
      `📢 ${NEWS_CHANNEL_ID}\n\n` +
      `${UI.sparkLine}`,
    { parse_mode: "Markdown", ...getCancelMainInline() },
  );
}

async function redeemPromoCode(chatId, userId, rawCode) {
  const code = rawCode.trim().toUpperCase();
  const db = loadDB();
  const promo = db.promoCodes.find((p) => p.code.toUpperCase() === code);

  if (!promo || !promo.active) {
    return bot.sendMessage(
      chatId,
      `❌ *Promokod topilmadi!*\n\n` +
        `📝 Kiritilgan: \`${code}\`\n` +
        `💡 To'g'ri promokod kiriting`,
      { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
    );
  }

  const user = db.users.find((u) => u.id === userId);
  if (!user) return bot.sendMessage(chatId, "❌ Xatolik.");
  if (!user.usedPromoCodes) user.usedPromoCodes = [];

  if (user.usedPromoCodes.includes(promo.code)) {
    return bot.sendMessage(
      chatId,
      `⚠️ *Bu promokodni allaqachon ishlatgansiz!*\n\n🎟 \`${code}\``,
      { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
    );
  }

  if (promo.maxUses && promo.usedCount >= promo.maxUses) {
    return bot.sendMessage(
      chatId,
      `❌ *Promokod limiti tugagan!*\n\n🎟 \`${code}\``,
      { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
    );
  }

  user.usedPromoCodes.push(promo.code);
  user.balance = Math.round((user.balance + promo.amount) * 100) / 100;
  promo.usedCount = (promo.usedCount || 0) + 1;
  saveDB(db);

  await bot.sendMessage(
    chatId,
    `🎉 *Promokod qabul qilindi!*\n` +
      `${UI.sparkLine}\n\n` +
      `🎟 Kod: \`${code}\`\n` +
      `💰 Bonus: +${formatUZS(promo.amount)}\n` +
      `💼 Yangi balans: *${formatUZS(user.balance)}*\n\n` +
      `${UI.sparkLine}`,
    { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
  );
}

async function handleDailyBonus(chatId, userId) {
  const db = loadDB();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return bot.sendMessage(chatId, "❌ Xatolik.");

  const now = Date.now();
  const last = user.lastDailyBonus
    ? new Date(user.lastDailyBonus).getTime()
    : 0;

  if (now - last < DAILY_BONUS_INTERVAL_MS) {
    const remaining = DAILY_BONUS_INTERVAL_MS - (now - last);
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    return bot.sendMessage(
      chatId,
      `⏳ *Keyingi bonusgacha:*\n` +
        `${UI.sparkLine}\n\n` +
        `🕐 *${h} soat ${m} daqiqa*\n\n` +
        `💡 Har kuni ${formatUZS(DAILY_BONUS)} bonus!\n\n` +
        `${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
    );
  }

  user.lastDailyBonus = new Date(now).toISOString();
  user.balance = Math.round((user.balance + DAILY_BONUS) * 100) / 100;
  saveDB(db);

  await bot.sendMessage(
    chatId,
    `🎁 *Kunlik bonus olindi!*\n` +
      `${UI.sparkLine}\n\n` +
      `💰 Bonus: +${formatUZS(DAILY_BONUS)}\n` +
      `💼 Yangi balans: *${formatUZS(user.balance)}*\n\n` +
      `⏰ Keyingi bonus: 24 soatdan so'ng\n\n` +
      `${UI.sparkLine}`,
    { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
  );
}

async function showReferralInfo(chatId, userId) {
  const username = await getBotUsername();
  const user = getUser(userId);
  const link = username
    ? `https://t.me/${username}?start=ref_${userId}`
    : `ID: ${userId}`;

  await bot.sendMessage(
    chatId,
    `👥 *Referal dasturi*\n` +
      `${UI.doubleLine}\n\n` +
      `💰 Har bir yangi do'st = *${formatUZS(REFERRAL_BONUS)}*\n\n` +
      `${UI.line}\n\n` +
      `🔗 *Sizning referal havolangiz:*\n\n` +
      `\`${link}\`\n\n` +
      `${UI.line}\n\n` +
      `📊 *Natijalaringiz:*\n` +
      `  👥 Taklif qilganlar: *${user?.referralCount || 0}* ta\n` +
      `  💰 Jami daromad: *${formatUZS(user?.referralEarnings || 0)}*\n\n` +
      `${UI.line}\n\n` +
      `💡 *Qanday ishlaydi?*\n` +
      `  1. Havolani do'stlaringizga yuboring\n` +
      `  2. Ular botga qo'shiladi\n` +
      `  3. Siz bonus olasiz! 🎉\n\n` +
      `${UI.doubleLine}`,
    { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
  );
}

// ============================================================
// ✨ WALLET TOP-UP — BEAUTIFUL
// ============================================================
async function showWalletTopupPrompt(chatId, userId) {
  setState(userId, { step: "waiting_topup_amount" });

  await bot.sendMessage(
    chatId,
    `💳 *Balansni to'ldirish*\n` +
      `${UI.doubleLine}\n\n` +
      `💼 Joriy balans: *${formatUZS(getBalance(userId))}*\n\n` +
      `${UI.line}\n\n` +
      `📝 To'ldirish miqdorini kiriting:\n\n` +
      `  ◈ Minimum: *${formatUZS(MIN_TOPUP)}*\n` +
      `  ◈ Maximum: *${formatUZS(MAX_TOPUP)}*\n\n` +
      `💡 Masalan: \`5000\` yoki \`50000\`\n\n` +
      `${UI.doubleLine}`,
    { parse_mode: "Markdown", ...getCancelMainInline() },
  );
}

async function handleTopupAmount(chatId, userId, text) {
  const amount = parseInt(text.replace(/\s/g, ""), 10);
  if (isNaN(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
    return bot.sendMessage(
      chatId,
      `❌ *Noto'g'ri miqdor!*\n\n` +
        `◈ Min: ${formatUZS(MIN_TOPUP)}\n` +
        `◈ Max: ${formatUZS(MAX_TOPUP)}`,
      { parse_mode: "Markdown" },
    );
  }

  setState(userId, {
    step: "waiting_topup_screenshot",
    amount,
    expiresAt: Date.now() + TOPUP_TIMEOUT_MS,
  });

  await bot.sendMessage(
    chatId,
    `💳 *To'lov ma'lumotlari*\n` +
      `${UI.doubleLine}\n\n` +
      `🏦 *Karta raqami:*\n` +
      `\`${CARD_NUMBER}\`\n\n` +
      `💰 *To'lov miqdori:*\n` +
      `*${formatUZS(amount)}*\n\n` +
      `${UI.line}\n\n` +
      `⏰ Vaqt: *5 daqiqa*\n\n` +
      `📸 To'lovdan so'ng *chek rasmini* yuboring\n\n` +
      `${UI.doubleLine}`,
    { parse_mode: "Markdown", ...getCancelMainInline() },
  );
}

async function handleTopupScreenshot(msg, state) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (Date.now() > state.expiresAt) {
    clearState(userId);
    return bot.sendMessage(
      chatId,
      `⏰ *Vaqt tugadi!*\n\nQaytadan urinib ko'ring.`,
      { parse_mode: "Markdown", ...getBackToMainInline() },
    );
  }

  const photo = msg.photo[msg.photo.length - 1];
  const db = loadDB();
  const topup = {
    id: `topup_${Date.now()}`,
    userId,
    amount: state.amount,
    status: "pending",
    fileId: photo.file_id,
    date: new Date().toISOString(),
  };
  db.topups.push(topup);
  saveDB(db);
  clearState(userId);

  await bot.sendMessage(
    chatId,
    `✅ *Chek qabul qilindi!*\n` +
      `${UI.sparkLine}\n\n` +
      `💰 Miqdor: *${formatUZS(state.amount)}*\n` +
      `📋 ID: \`${topup.id}\`\n\n` +
      `⏳ Admin tekshirmoqda...\n` +
      `🔔 Natija haqida xabar beriladi\n\n` +
      `${UI.sparkLine}`,
    { parse_mode: "Markdown", ...getBackToMainInline() },
  );

  await bot
    .sendPhoto(ADMIN_ID, photo.file_id, {
      caption:
        `💳 *Yangi to'lov cheki!*\n` +
        `${UI.sparkLine}\n\n` +
        `👤 [${msg.from.first_name || "User"}](tg://user?id=${userId})\n` +
        `🆔 \`${userId}\`\n` +
        `💰 *${formatUZS(state.amount)}*\n` +
        `📋 \`${topup.id}\`\n\n` +
        `${UI.sparkLine}`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Tasdiqlash",
              callback_data: `approve_topup_${topup.id}`,
            },
            { text: "❌ Rad etish", callback_data: `reject_topup_${topup.id}` },
          ],
        ],
      },
    })
    .catch(() => {});
}

async function showAdminTopups(chatId) {
  const db = loadDB();
  const pending = db.topups.filter((t) => t.status === "pending");
  if (pending.length === 0) {
    return bot.sendMessage(
      chatId,
      `💳 *To'lovlar nazorati*\n${UI.sparkLine}\n\n📭 Kutilayotgan to'lovlar yo'q.\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

  let text = `💳 *Kutilayotgan to'lovlar — ${pending.length} ta*\n${UI.sparkLine}\n\n`;
  for (const t of pending) {
    text += `  ◈ \`${t.id}\`\n    👤 \`${t.userId}\` — ${formatUZS(t.amount)}\n\n`;
  }
  text += UI.sparkLine;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToAdminInline(),
  });
}

// ============================================================
// ✨ ADMIN — BEAUTIFUL
// ============================================================
async function showAdminPromo(chatId) {
  const db = loadDB();
  let text = `🎟 *Promokodlar boshqaruvi*\n${UI.doubleLine}\n\n`;

  if (db.promoCodes.length === 0) {
    text += "📭 Hali promokod yaratilmagan.\n";
  } else {
    for (const p of db.promoCodes) {
      const statusIcon = p.active ? "🟢" : "🔴";
      text +=
        `${statusIcon} \`${p.code}\`\n` +
        `  💰 ${formatUZS(p.amount)} | 🔢 ${p.usedCount || 0}/${p.maxUses || "∞"}\n\n`;
    }
  }

  text += UI.doubleLine;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "➕ Yangi promokod yaratish",
            callback_data: "admin_promo_add",
          },
        ],
        [{ text: "⬅️ Admin panelga", callback_data: "back_admin" }],
      ],
    },
  });
}

async function showAdminStats(chatId) {
  const db = loadDB();
  let pm2Count = 0;
  try {
    const o = execSync("pm2 jlist", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    pm2Count = JSON.parse(o).filter((p) => p.name.startsWith("bot_")).length;
  } catch {}

  const totalRevenue = db.purchases.reduce(
    (sum, p) => sum + (p.amount || 0),
    0,
  );
  const todayUsers = db.users.filter((u) => {
    const d = new Date(u.joinedAt);
    const t = new Date();
    return d.toDateString() === t.toDateString();
  }).length;

  const recentPurchases = db.purchases.slice(-5).reverse();
  let recentText = "";
  for (const p of recentPurchases) {
    recentText += `  ${p.deployed ? "🟢" : "⚪"} ${p.templateName}\n    👤 \`${p.userId}\` — ${new Date(p.date).toLocaleDateString("uz-UZ")}\n\n`;
  }

  await bot.sendMessage(
    chatId,
    `📊 *Admin statistikasi*\n` +
      `${UI.doubleLine}\n\n` +
      `📦 *Kontentlar:*\n` +
      `  ◈ Shablonlar: *${db.templates.length}* ta\n` +
      `  ◈ Xaridlar: *${db.purchases.length}* ta\n` +
      `  ◈ Deploylar: *${db.purchases.filter((p) => p.deployed).length}* ta\n\n` +
      `👥 *Foydalanuvchilar:*\n` +
      `  ◈ Jami: *${db.users.length}* ta\n` +
      `  ◈ Bugun: *${todayUsers}* ta\n\n` +
      `💰 *Moliya:*\n` +
      `  ◈ Jami tushum: *${formatUZS(totalRevenue)}*\n` +
      `  ◈ Promokodlar: *${db.promoCodes.length}* ta\n\n` +
      `🔧 *Tizim:*\n` +
      `  ◈ PM2 botlar: *${pm2Count}* ta\n\n` +
      `${UI.line}\n\n` +
      `📋 *So'nggi xaridlar:*\n\n${recentText || "  📭 Hali yo'q"}\n` +
      `${UI.doubleLine}`,
    { parse_mode: "Markdown", ...getBackToAdminInline() },
  );
}

async function showAdminUsers(chatId) {
  const db = loadDB();
  if (db.users.length === 0) {
    return bot.sendMessage(
      chatId,
      `👥 *Foydalanuvchilar*\n${UI.sparkLine}\n\n📭 Hali yo'q.\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

  let text = `👥 *Foydalanuvchilar — ${db.users.length} ta*\n${UI.doubleLine}\n\n`;
  const showUsers = db.users.slice(-20).reverse();
  const nums = [
    "1️⃣",
    "2️⃣",
    "3️⃣",
    "4️⃣",
    "5️⃣",
    "6️⃣",
    "7️⃣",
    "8️⃣",
    "9️⃣",
    "🔟",
    "1️⃣1️⃣",
    "1️⃣2️⃣",
    "1️⃣3️⃣",
    "1️⃣4️⃣",
    "1️⃣5️⃣",
    "1️⃣6️⃣",
    "1️⃣7️⃣",
    "1️⃣8️⃣",
    "1️⃣9️⃣",
    "2️⃣0️⃣",
  ];

  for (let i = 0; i < showUsers.length; i++) {
    const u = showUsers[i];
    const purchases = db.purchases.filter((p) => p.userId === u.id);
    text +=
      `${nums[i] || i + 1 + "."} *${u.firstName}*\n` +
      `  ${u.username ? "  @" + u.username : "  —"}\n` +
      `  🆔 \`${u.id}\` | 🛒 ${purchases.length} | 💼 ${formatUZS(u.balance || 0)}\n\n`;
  }

  text += UI.doubleLine;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToAdminInline(),
  });
}

async function showAdminDeployments(chatId) {
  const db = loadDB();
  const active = db.purchases.filter((p) => p.deployed);
  if (active.length === 0) {
    return bot.sendMessage(
      chatId,
      `🗂 *Deploymentlar*\n${UI.sparkLine}\n\n📭 Aktiv deploy yo'q.\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

  let text = `🗂 *Aktiv deploymentlar — ${active.length} ta*\n${UI.doubleLine}\n\n`;
  for (const p of active) {
    const pn = p.processName || `bot_${p.userId}_${p.id}`;
    const info = getPm2Status(pn);
    const icon = info ? (info.status === "online" ? "🟢" : "🔴") : "⚪";
    text +=
      `${icon} *${p.templateName}*\n` +
      `  👤 \`${p.userId}\` | 📁 \`${pn}\`\n\n`;
  }

  text += UI.doubleLine;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToAdminInline(),
  });
}

// ============================================================
// TEXT MESSAGE HANDLER
// ============================================================
bot.on("message", async (msg) => {
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  if (text.startsWith("/")) return;

  trackUser(userId, msg.from.first_name, msg.from.username);

  // ✨ Updated menu button texts
  if (text === "🛍 Botlar do'koni") {
    clearState(userId);
    return showCatalog(chatId, userId);
  }
  if (text === "📱 Mening botlarim") {
    clearState(userId);
    return showMyBots(chatId, userId);
  }
  if (text === "💎 Pul ishlash") {
    clearState(userId);
    return showEarnMoney(chatId, userId);
  }
  if (text === "💳 Balansni to'ldirish") {
    clearState(userId);
    return showWalletTopupPrompt(chatId, userId);
  }
  if (text === "📈 Statistika") {
    clearState(userId);
    return showStatistics(chatId, userId);
  }
  if (text === "🆘 Yordam") {
    clearState(userId);
    return sendHelpMessage(chatId, userId);
  }
  if (text === "⚙️ Admin panel" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(
      chatId,
      `⚙️ *Admin Panel*\n${UI.doubleLine}\n\n🔧 Boshqaruv bo'limini tanlang:\n\n${UI.doubleLine}`,
      { parse_mode: "Markdown", ...getAdminKeyboard() },
    );
  }

  const state = getState(userId);
  if (!state) return;

  // Admin states
  if (state.step === "waiting_template_name" && isAdmin(userId)) {
    state.templateName = text;
    state.step = "waiting_template_price";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `📝 Nom: *${text}* ✅\n\n⭐ *Stars* narxini kiriting:`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (state.step === "waiting_template_price" && isAdmin(userId)) {
    const price = parseInt(text);
    if (isNaN(price) || price < 1)
      return bot.sendMessage(chatId, "❌ Musbat son kiriting!");
    state.templatePrice = price;
    state.step = "waiting_template_price_uzs";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `⭐ Stars: *${price}* ✅\n\n💰 *UZS* narxini kiriting:`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (state.step === "waiting_template_price_uzs" && isAdmin(userId)) {
    const priceUZS = parseInt(text.replace(/\s/g, ""), 10);
    if (isNaN(priceUZS) || priceUZS < 100)
      return bot.sendMessage(chatId, "❌ Min 100 UZS!");
    state.templatePriceUZS = priceUZS;
    state.step = "waiting_template_zip";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `✅ *Narxlar belgilandi:*\n` +
        `  ⭐ ${state.templatePrice} Stars\n` +
        `  💰 ${formatUZS(priceUZS)}\n\n` +
        `📎 Endi *ZIP faylni* yuboring:`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (state.step === "waiting_broadcast_message" && isAdmin(userId)) {
    clearState(userId);
    return executeBroadcast(chatId, userId, text);
  }
  if (state.step === "waiting_edit_name" && isAdmin(userId)) {
    const db = loadDB();
    const tmpl = db.templates.find((t) => t.id === state.templateId);
    if (tmpl) {
      tmpl.name = text;
      saveDB(db);
      clearState(userId);
      return bot.sendMessage(chatId, `✅ *Nom yangilandi:* ${text}`, {
        parse_mode: "Markdown",
        ...getBackToAdminInline(),
      });
    }
    clearState(userId);
    return bot.sendMessage(chatId, "❌ Topilmadi.");
  }
  if (state.step === "waiting_edit_price" && isAdmin(userId)) {
    const price = parseInt(text);
    if (isNaN(price) || price < 1)
      return bot.sendMessage(chatId, "❌ Musbat son!");
    state.editPrice = price;
    state.step = "waiting_edit_price_uzs";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `⭐ ${price} Stars ✅\n\n💰 Yangi UZS narxini kiriting:`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (state.step === "waiting_edit_price_uzs" && isAdmin(userId)) {
    const priceUZS = parseInt(text.replace(/\s/g, ""), 10);
    if (isNaN(priceUZS) || priceUZS < 100)
      return bot.sendMessage(chatId, "❌ Min 100!");
    const db = loadDB();
    const tmpl = db.templates.find((t) => t.id === state.templateId);
    if (tmpl) {
      tmpl.price = state.editPrice;
      tmpl.priceUZS = priceUZS;
      saveDB(db);
      clearState(userId);
      return bot.sendMessage(
        chatId,
        `✅ *Narx yangilandi:*\n  ⭐ ${state.editPrice} Stars\n  💰 ${formatUZS(priceUZS)}`,
        { parse_mode: "Markdown", ...getBackToAdminInline() },
      );
    }
    clearState(userId);
    return bot.sendMessage(chatId, "❌ Topilmadi.");
  }

  // User states
  if (state.step === "waiting_promo_code") {
    clearState(userId);
    return redeemPromoCode(chatId, userId, text);
  }
  if (state.step === "waiting_topup_amount") {
    return handleTopupAmount(chatId, userId, text);
  }

  // Admin promo creation
  if (state.step === "waiting_promo_code_input" && isAdmin(userId)) {
    const code = text.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code))
      return bot.sendMessage(chatId, "❌ 3-20 belgi, harf/raqam/_/-");
    const db = loadDB();
    if (db.promoCodes.some((p) => p.code === code))
      return bot.sendMessage(chatId, "❌ Bu kod mavjud!");
    state.promoCode = code;
    state.step = "waiting_promo_amount";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `🎟 Kod: \`${code}\` ✅\n\n💰 Bonus miqdorini kiriting (UZS):`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (state.step === "waiting_promo_amount" && isAdmin(userId)) {
    const amount = parseInt(text, 10);
    if (isNaN(amount) || amount < 1)
      return bot.sendMessage(chatId, "❌ Musbat son!");
    state.promoAmount = amount;
    state.step = "waiting_promo_maxuses";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `💰 Bonus: ${formatUZS(amount)} ✅\n\n🔢 Necha marta ishlatilsin?\n\n💡 0 = cheklovsiz`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (state.step === "waiting_promo_maxuses" && isAdmin(userId)) {
    const maxUses = parseInt(text, 10);
    if (isNaN(maxUses) || maxUses < 0)
      return bot.sendMessage(chatId, "❌ 0 yoki musbat son!");
    const db = loadDB();
    const promo = {
      code: state.promoCode,
      amount: state.promoAmount,
      maxUses: maxUses > 0 ? maxUses : null,
      usedCount: 0,
      active: true,
      createdAt: new Date().toISOString(),
    };
    db.promoCodes.push(promo);
    saveDB(db);
    clearState(userId);

    sendToChannel(
      `🎟 *Yangi promokod!*\n` +
        `${UI.sparkLine}\n\n` +
        `🔑 Kod: \`${promo.code}\`\n` +
        `💰 Bonus: *${formatUZS(promo.amount)}*\n` +
        `🔢 Limit: *${promo.maxUses || "cheklovsiz"}* ta\n\n` +
        `${UI.sparkLine}\n\n` +
        `🤖 ${BOT_HANDLE}`,
    );

    return bot.sendMessage(
      chatId,
      `✅ *Promokod yaratildi!*\n` +
        `${UI.sparkLine}\n\n` +
        `🎟 Kod: \`${promo.code}\`\n` +
        `💰 Bonus: ${formatUZS(promo.amount)}\n` +
        `🔢 Limit: ${promo.maxUses || "cheklovsiz"}\n\n` +
        `${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

  // Placeholder collection
  if (state.step === "collecting_placeholders") {
    const currentPh = state.placeholders[state.currentIndex];
    const info = PLACEHOLDER_INFO[currentPh];
    if (info && !info.validate(text))
      return bot.sendMessage(chatId, info.error, { parse_mode: "Markdown" });

    state.collectedValues[currentPh] = text.trim();
    state.currentIndex++;

    if (state.currentIndex < state.placeholders.length) {
      const nextPh = state.placeholders[state.currentIndex];
      const nextInfo = PLACEHOLDER_INFO[nextPh];
      const prompt = (nextInfo?.prompt || `"${nextPh}" kiriting:`).replace(
        "{USER_ID}",
        String(userId),
      );

      const progress = Math.round(
        (state.currentIndex / state.placeholders.length) * 100,
      );
      setState(userId, state);
      return bot.sendMessage(
        chatId,
        `✅ Qabul qilindi! (${state.currentIndex}/${state.placeholders.length})\n` +
          `📊 ${progressBar(progress, 15)}\n\n` +
          `${UI.line}\n\n${prompt}`,
        { parse_mode: "Markdown" },
      );
    }

    clearState(userId);
    return executeDeploy(
      chatId,
      userId,
      state.templateId,
      state.purchaseId,
      state.collectedValues,
    );
  }
});

// ============================================================
// DOCUMENT HANDLER — ZIP
// ============================================================
bot.on("message", async (msg) => {
  if (!msg.document) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isAdmin(userId)) return;
  const state = getState(userId);
  if (!state || state.step !== "waiting_template_zip") return;

  const doc = msg.document;
  if (!doc.file_name.endsWith(".zip"))
    return bot.sendMessage(chatId, "❌ Faqat ZIP fayl!");

  try {
    await bot.sendMessage(chatId, "📥 *Yuklanmoqda...*", {
      parse_mode: "Markdown",
    });
    const fileLink = await bot.getFileLink(doc.file_id);
    const fileName = `template_${Date.now()}.zip`;
    const filePath = path.join(TEMPLATES_DIR, fileName);
    const https = require("https");
    const http = require("http");
    const protocol = fileLink.startsWith("https") ? https : http;

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      protocol
        .get(fileLink, (response) => {
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", reject);
    });

    const db = loadDB();
    const template = {
      id: `tmpl_${Date.now()}`,
      name: state.templateName,
      price: state.templatePrice,
      priceUZS: state.templatePriceUZS,
      fileName,
      originalName: doc.file_name,
      createdAt: new Date().toISOString(),
    };
    db.templates.push(template);
    saveDB(db);
    clearState(userId);

    const placeholders = scanTemplatePlaceholders(fileName);
    const phList =
      placeholders.length > 0
        ? placeholders
            .map((p) => `  ◈ ${PLACEHOLDER_INFO[p]?.label || p}`)
            .join("\n")
        : "  ◈ Faqat token";

    await bot.sendMessage(
      chatId,
      `✅ *Shablon muvaffaqiyatli qo'shildi!*\n` +
        `${UI.doubleLine}\n\n` +
        `📦 Nom: *${template.name}*\n` +
        `⭐ Stars: *${template.price}*\n` +
        `💰 UZS: *${formatUZS(template.priceUZS)}*\n` +
        `📎 Fayl: ${doc.file_name}\n` +
        `🆔 ID: \`${template.id}\`\n\n` +
        `📋 *Placeholders:*\n${phList}\n\n` +
        `${UI.doubleLine}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );

    sendToChannel(
      `📦 *Yangi bot shablon!*\n` +
        `${UI.sparkLine}\n\n` +
        `🤖 *${template.name}*\n` +
        `⭐ ${template.price} Stars\n` +
        `💰 ${formatUZS(template.priceUZS)}\n\n` +
        `🛒 Sotib olish: ${BOT_HANDLE}\n\n` +
        `${UI.sparkLine}`,
    );
  } catch (err) {
    console.error("Upload error:", err);
    bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
    clearState(userId);
  }
});

// ============================================================
// PHOTO HANDLER
// ============================================================
bot.on("message", async (msg) => {
  if (!msg.photo) return;
  const state = getState(msg.from.id);
  if (!state || state.step !== "waiting_topup_screenshot") return;
  await handleTopupScreenshot(msg, state);
});

// ============================================================
// BROADCAST
// ============================================================
async function executeBroadcast(chatId, adminId, message) {
  const db = loadDB();
  const users = db.users || [];
  if (users.length === 0)
    return bot.sendMessage(chatId, "📭 Userlar yo'q.", {
      ...getBackToAdminInline(),
    });

  const statusMsg = await bot.sendMessage(
    chatId,
    `📢 *Broadcast boshlanmoqda...*\n\n👥 ${users.length} ta foydalanuvchi\n📊 ${progressBar(0)}`,
    { parse_mode: "Markdown" },
  );
  let sent = 0,
    failed = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    if (user.id === adminId) continue;
    try {
      await bot.sendMessage(
        user.id,
        `📢 *Yangilik!*\n${UI.sparkLine}\n\n${message}\n\n${UI.sparkLine}\n\n🤖 ${BOT_HANDLE}`,
        { parse_mode: "Markdown" },
      );
      sent++;
    } catch {
      failed++;
    }

    // Update progress every 10 messages
    if ((sent + failed) % 10 === 0) {
      const percent = Math.round(((i + 1) / users.length) * 100);
      try {
        await bot.editMessageText(
          `📢 *Broadcast...*\n\n📊 ${progressBar(percent)}\n✅ ${sent} | ❌ ${failed}`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: "Markdown",
          },
        );
      } catch {}
    }

    if ((sent + failed) % 25 === 0)
      await new Promise((r) => setTimeout(r, 1000));
  }

  try {
    await bot.editMessageText(
      `✅ *Broadcast tugadi!*\n` +
        `${UI.sparkLine}\n\n` +
        `📊 ${progressBar(100)}\n\n` +
        `📤 Yuborildi: *${sent}* ✅\n` +
        `❌ Xato: *${failed}*\n` +
        `👥 Jami: *${users.length}*\n\n` +
        `${UI.sparkLine}`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "Markdown",
      },
    );
  } catch {}

  sendToChannel(
    `📢 *Yangilik!*\n${UI.sparkLine}\n\n${message}\n\n${UI.sparkLine}\n\n🤖 ${BOT_HANDLE}`,
  );
}

// ============================================================
// CALLBACK QUERY HANDLER
// ============================================================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  await bot.answerCallbackQuery(query.id);

  if (data === "back_main") {
    clearState(userId);
    return bot.sendMessage(chatId, `🏠 *Bosh menyu*`, {
      parse_mode: "Markdown",
      ...getMainKeyboard(userId),
    });
  }
  if (data === "back_admin" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(
      chatId,
      `⚙️ *Admin Panel*\n${UI.doubleLine}\n\n🔧 Bo'limni tanlang:\n\n${UI.doubleLine}`,
      { parse_mode: "Markdown", ...getAdminKeyboard() },
    );
  }
  if (data === "go_catalog") {
    clearState(userId);
    return showCatalog(chatId, userId);
  }
  if (data === "go_mybots") return showMyBots(chatId, userId);
  if (data === "admin_cancel" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(chatId, "✖️ *Bekor qilindi.*", {
      parse_mode: "Markdown",
      ...getBackToAdminInline(),
    });
  }

  if (data.startsWith("viewbot_")) {
    const templateId = data.replace("viewbot_", "");
    return showBotDetails(chatId, userId, templateId);
  }

  if (data === "admin_add" && isAdmin(userId)) {
    setState(userId, { step: "waiting_template_name" });
    return bot.sendMessage(
      chatId,
      `📥 *Yangi shablon yuklash*\n${UI.sparkLine}\n\n📝 Shablon nomini kiriting:\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }

  if (data === "admin_list" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0)
      return bot.sendMessage(chatId, "📭 Shablonlar yo'q.", {
        ...getBackToAdminInline(),
      });
    let text = `📋 *Shablonlar — ${db.templates.length} ta*\n${UI.doubleLine}\n\n`;
    for (const t of db.templates) {
      const ph = scanTemplatePlaceholders(t.fileName);
      text += `📦 *${t.name}*\n  ⭐ ${t.price} | 💰 ${formatUZS(t.priceUZS || t.price * 100)} | 📋 ${ph.length} parametr\n\n`;
    }
    text += UI.doubleLine;
    return bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...getBackToAdminInline(),
    });
  }

  if (data === "admin_delete" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0)
      return bot.sendMessage(chatId, "📭 Yo'q.", { ...getBackToAdminInline() });
    const buttons = db.templates.map((t) => [
      { text: `🗑 ${t.name}`, callback_data: `confirm_delete_${t.id}` },
    ]);
    buttons.push([{ text: "⬅️ Admin panelga", callback_data: "back_admin" }]);
    return bot.sendMessage(
      chatId,
      `🗑 *O'chirish*\n${UI.sparkLine}\n\nQaysi shablonni o'chirmoqchisiz?\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } },
    );
  }
  if (data.startsWith("confirm_delete_") && isAdmin(userId)) {
    const id = data.replace("confirm_delete_", "");
    const db = loadDB();
    const idx = db.templates.findIndex((t) => t.id === id);
    if (idx === -1) return bot.sendMessage(chatId, "❌ Topilmadi.");
    const t = db.templates[idx];
    const fp = path.join(TEMPLATES_DIR, t.fileName);
    if (fs.existsSync(fp)) fs.removeSync(fp);
    db.templates.splice(idx, 1);
    saveDB(db);
    return bot.sendMessage(
      chatId,
      `✅ *"${t.name}"* muvaffaqiyatli o'chirildi.`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

  if (data === "admin_edit" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0)
      return bot.sendMessage(chatId, "📭 Yo'q.", { ...getBackToAdminInline() });
    const buttons = db.templates.map((t) => [
      { text: `✏️ ${t.name}`, callback_data: `edit_tmpl_${t.id}` },
    ]);
    buttons.push([{ text: "⬅️ Admin panelga", callback_data: "back_admin" }]);
    return bot.sendMessage(
      chatId,
      `✏️ *Tahrirlash*\n${UI.sparkLine}\n\nQaysi shablonni tahrirlaysiz?\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } },
    );
  }
  if (data.startsWith("edit_tmpl_") && isAdmin(userId)) {
    const id = data.replace("edit_tmpl_", "");
    const db = loadDB();
    const t = db.templates.find((x) => x.id === id);
    if (!t) return bot.sendMessage(chatId, "❌ Topilmadi.");
    return bot.sendMessage(
      chatId,
      `✏️ *${t.name} — tahrirlash*\n` +
        `${UI.sparkLine}\n\n` +
        `⭐ Stars: *${t.price}*\n` +
        `💰 UZS: *${formatUZS(t.priceUZS || t.price * 100)}*\n\n` +
        `${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📝 Nomni o'zgartirish",
                callback_data: `editname_${id}`,
              },
            ],
            [
              {
                text: "💱 Narxni o'zgartirish",
                callback_data: `editprice_${id}`,
              },
            ],
            [{ text: "⬅️ Admin panelga", callback_data: "back_admin" }],
          ],
        },
      },
    );
  }
  if (data.startsWith("editname_") && isAdmin(userId)) {
    setState(userId, {
      step: "waiting_edit_name",
      templateId: data.replace("editname_", ""),
    });
    return bot.sendMessage(chatId, "📝 *Yangi nomni kiriting:*", {
      parse_mode: "Markdown",
      ...getCancelInline(),
    });
  }
  if (data.startsWith("editprice_") && isAdmin(userId)) {
    setState(userId, {
      step: "waiting_edit_price",
      templateId: data.replace("editprice_", ""),
    });
    return bot.sendMessage(chatId, "⭐ *Yangi Stars narxini kiriting:*", {
      parse_mode: "Markdown",
      ...getCancelInline(),
    });
  }

  if (data === "admin_users" && isAdmin(userId)) return showAdminUsers(chatId);
  if (data === "admin_stats" && isAdmin(userId)) return showAdminStats(chatId);
  if (data === "admin_deployments" && isAdmin(userId))
    return showAdminDeployments(chatId);
  if (data === "admin_topups" && isAdmin(userId))
    return showAdminTopups(chatId);
  if (data === "admin_promo" && isAdmin(userId)) return showAdminPromo(chatId);

  if (data === "admin_broadcast" && isAdmin(userId)) {
    setState(userId, { step: "waiting_broadcast_message" });
    return bot.sendMessage(
      chatId,
      `📢 *Broadcast xabari*\n${UI.sparkLine}\n\nBarcha foydalanuvchilarga yuboriladigan xabarni yozing:\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (data === "admin_restart_bot" && isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      `⚠️ *Botni qayta ishga tushirish*\n${UI.sparkLine}\n\nRostdan ham restart qilasizmi?\n\n${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Ha, restart", callback_data: "confirm_restart_main" },
              { text: "❌ Yo'q", callback_data: "back_admin" },
            ],
          ],
        },
      },
    );
  }
  if (data === "confirm_restart_main" && isAdmin(userId)) {
    await bot.sendMessage(chatId, "🔄 *3 soniyada restart...*", {
      parse_mode: "Markdown",
    });
    setTimeout(() => process.exit(0), 3000);
    return;
  }
  if (data === "admin_promo_add" && isAdmin(userId)) {
    setState(userId, { step: "waiting_promo_code_input" });
    return bot.sendMessage(
      chatId,
      `🎟 *Yangi promokod yaratish*\n${UI.sparkLine}\n\nPromokod nomini kiriting:\n\n💡 Masalan: \`BONUS2026\`\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }

  // Earn money
  if (data === "earn_promo") return handlePromoStart(chatId, userId);
  if (data === "earn_daily") return handleDailyBonus(chatId, userId);
  if (data === "earn_referral") return showReferralInfo(chatId, userId);
  if (data === "go_topup") return showWalletTopupPrompt(chatId, userId);

  // Topup approval/rejection
  if (data.startsWith("approve_topup_") && isAdmin(userId)) {
    const topupId = data.replace("approve_topup_", "");
    const db = loadDB();
    const topup = db.topups.find((t) => t.id === topupId);
    if (!topup) return bot.sendMessage(chatId, "❌ Topilmadi.");
    if (topup.status !== "pending")
      return bot.sendMessage(chatId, "⚠️ Allaqachon ko'rilgan.");
    topup.status = "approved";
    topup.resolvedAt = new Date().toISOString();
    const user = db.users.find((u) => u.id === topup.userId);
    if (user)
      user.balance = Math.round((user.balance + topup.amount) * 100) / 100;
    saveDB(db);

    await bot.sendMessage(
      chatId,
      `✅ *Tasdiqlandi:* ${formatUZS(topup.amount)}`,
      { parse_mode: "Markdown" },
    );
    bot
      .sendMessage(
        topup.userId,
        `✅ *To'lov tasdiqlandi!*\n` +
          `${UI.sparkLine}\n\n` +
          `💰 +${formatUZS(topup.amount)}\n` +
          `💼 Yangi balans: *${formatUZS(user ? user.balance : 0)}*\n\n` +
          `${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});

    sendToChannel(
      `💳 *To'lov tasdiqlandi!*\n\n` +
        `👤 ${maskUsername(user?.username || "")}\n` +
        `💰 +${formatUZS(topup.amount)}\n\n${BOT_HANDLE}`,
    );
    return;
  }
  if (data.startsWith("reject_topup_") && isAdmin(userId)) {
    const topupId = data.replace("reject_topup_", "");
    const db = loadDB();
    const topup = db.topups.find((t) => t.id === topupId);
    if (!topup) return bot.sendMessage(chatId, "❌ Topilmadi.");
    if (topup.status !== "pending")
      return bot.sendMessage(chatId, "⚠️ Allaqachon ko'rilgan.");
    topup.status = "rejected";
    topup.resolvedAt = new Date().toISOString();
    saveDB(db);
    await bot.sendMessage(
      chatId,
      `❌ *Rad etildi:* ${formatUZS(topup.amount)}`,
      { parse_mode: "Markdown" },
    );
    bot
      .sendMessage(
        topup.userId,
        `❌ *To'lov rad etildi*\n${UI.sparkLine}\n\n💰 ${formatUZS(topup.amount)}\n\n💡 Iltimos, to'g'ri chek yuboring\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
    return;
  }

  // Bot management
  if (data.startsWith("bot_stop_")) {
    const pid = data.replace("bot_stop_", "");
    const db = loadDB();
    const p = db.purchases.find(
      (x) => x.id === pid && (x.userId === userId || isAdmin(userId)),
    );
    if (!p) return bot.sendMessage(chatId, "❌ Topilmadi.");
    const pn = p.processName || `bot_${p.userId}_${p.id}`;
    await bot.sendMessage(
      chatId,
      stopPm2Process(pn) ? `⏹ *To'xtatildi:* \`${pn}\`` : "❌ Xatolik.",
      { parse_mode: "Markdown" },
    );
    return showMyBots(chatId, userId);
  }
  if (data.startsWith("bot_restart_")) {
    const pid = data.replace("bot_restart_", "");
    const db = loadDB();
    const p = db.purchases.find(
      (x) => x.id === pid && (x.userId === userId || isAdmin(userId)),
    );
    if (!p) return bot.sendMessage(chatId, "❌ Topilmadi.");
    const pn = p.processName || `bot_${p.userId}_${p.id}`;
    await bot.sendMessage(
      chatId,
      restartPm2Process(pn) ? `🔄 *Restart:* \`${pn}\`` : "❌ Xatolik.",
      { parse_mode: "Markdown" },
    );
    return showMyBots(chatId, userId);
  }
  if (data.startsWith("bot_logs_")) {
    const pid = data.replace("bot_logs_", "");
    const db = loadDB();
    const p = db.purchases.find(
      (x) => x.id === pid && (x.userId === userId || isAdmin(userId)),
    );
    if (!p) return bot.sendMessage(chatId, "❌ Topilmadi.");
    const pn = p.processName || `bot_${p.userId}_${p.id}`;
    await bot.sendMessage(
      chatId,
      `📋 *Loglar — ${pn}*\n${UI.sparkLine}\n\n\`\`\`\n${getPm2Logs(pn)}\n\`\`\`\n\n${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Yangilash", callback_data: `bot_logs_${pid}` }],
            [{ text: "📱 Botlarimga", callback_data: "go_mybots" }],
          ],
        },
      },
    );
    return;
  }
  if (data.startsWith("bot_refresh_")) return showMyBots(chatId, userId);

  // Buy
  if (data.startsWith("buy_")) {
    const templateId = data.replace("buy_", "");
    const db = loadDB();
    const template = db.templates.find((t) => t.id === templateId);
    if (!template) return bot.sendMessage(chatId, "❌ Topilmadi.");
    const priceUZS = template.priceUZS || template.price * 100;

    if (isAdmin(userId)) {
      const purchase = {
        id: `purchase_${Date.now()}`,
        userId,
        templateId: template.id,
        templateName: template.name,
        fileName: template.fileName,
        amount: 0,
        method: "admin",
        date: new Date().toISOString(),
        deployed: false,
        deployId: null,
        processName: null,
      };
      db.purchases.push(purchase);
      saveDB(db);
      await bot.sendMessage(
        chatId,
        `👑 *Admin — bepul deploy!*\n${UI.sparkLine}\n\n📦 ${template.name}\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      );
      return startPlaceholderCollection(chatId, userId, template, purchase.id);
    }

    const balance = getBalance(userId);
    return bot.sendMessage(
      chatId,
      `🛒 *Sotib olish*\n` +
        `${UI.doubleLine}\n\n` +
        `📦 *${template.name}*\n\n` +
        `⭐ Stars: *${template.price}*\n` +
        `💰 So'm: *${formatUZS(priceUZS)}*\n\n` +
        `${UI.line}\n\n` +
        `💼 Sizning balansingiz: *${formatUZS(balance)}*\n\n` +
        `${UI.doubleLine}\n\n` +
        `💳 *To'lov usulini tanlang:*`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `💳 Hamyon — ${formatUZS(priceUZS)}`,
                callback_data: `paywallet_${template.id}`,
              },
            ],
            [
              {
                text: `⭐ Telegram Stars — ${template.price} ⭐`,
                callback_data: `paystars_${template.id}`,
              },
            ],
            [{ text: "⬅️ Katalogga qaytish", callback_data: "go_catalog" }],
          ],
        },
      },
    );
  }

  // Pay wallet
  if (data.startsWith("paywallet_")) {
    const templateId = data.replace("paywallet_", "");
    const db = loadDB();
    const template = db.templates.find((t) => t.id === templateId);
    if (!template) return bot.sendMessage(chatId, "❌ Topilmadi.");
    const user = db.users.find((u) => u.id === userId);
    if (!user) return bot.sendMessage(chatId, "❌ Xatolik.");
    const priceUZS = template.priceUZS || template.price * 100;

    if (user.balance < priceUZS) {
      return bot.sendMessage(
        chatId,
        `❌ *Mablag' yetarli emas!*\n` +
          `${UI.sparkLine}\n\n` +
          `💼 Balans: *${formatUZS(user.balance)}*\n` +
          `💰 Kerak: *${formatUZS(priceUZS)}*\n` +
          `📉 Kamomad: *${formatUZS(priceUZS - user.balance)}*\n\n` +
          `${UI.sparkLine}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💳 Balansni to'ldirish", callback_data: "go_topup" }],
              [{ text: "⬅️ Katalogga", callback_data: "go_catalog" }],
            ],
          },
        },
      );
    }

    user.balance = Math.round((user.balance - priceUZS) * 100) / 100;
    const purchase = {
      id: `purchase_${Date.now()}`,
      userId,
      templateId: template.id,
      templateName: template.name,
      fileName: template.fileName,
      amount: priceUZS,
      method: "wallet",
      date: new Date().toISOString(),
      deployed: false,
      deployId: null,
      processName: null,
    };
    db.purchases.push(purchase);
    saveDB(db);

    await bot.sendMessage(
      chatId,
      `✅ *To'lov muvaffaqiyatli!*\n` +
        `${UI.sparkLine}\n\n` +
        `📦 ${template.name}\n` +
        `💳 To'landi: ${formatUZS(priceUZS)}\n` +
        `💼 Qoldi: *${formatUZS(user.balance)}*\n\n` +
        `${UI.sparkLine}`,
      { parse_mode: "Markdown" },
    );

    bot
      .sendMessage(
        ADMIN_ID,
        `💰 *Yangi xarid!*\n${UI.sparkLine}\n\n👤 \`${userId}\`\n📦 ${template.name}\n💵 ${formatUZS(priceUZS)}\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});

    sendToChannel(
      `🎉 *Yangi xarid!*\n\n👤 ${maskUsername(user.username || "")}\n📦 *${template.name}*\n💰 ${formatUZS(priceUZS)}\n\n${BOT_HANDLE}`,
    );

    return startPlaceholderCollection(chatId, userId, template, purchase.id);
  }

  // Pay stars
  if (data.startsWith("paystars_")) {
    const templateId = data.replace("paystars_", "");
    const db = loadDB();
    const template = db.templates.find((t) => t.id === templateId);
    if (!template) return bot.sendMessage(chatId, "❌ Topilmadi.");
    try {
      await bot.sendInvoice(
        chatId,
        template.name,
        `"${template.name}" sotib olish`,
        `${template.id}_${userId}_${Date.now()}`,
        "",
        "XTR",
        [{ label: template.name, amount: template.price }],
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ ${err.message}`);
    }
    return;
  }

  // Undeploy
  if (data.startsWith("undeploy_")) {
    const pid = data.replace("undeploy_", "");
    const db = loadDB();
    const p = db.purchases.find(
      (x) => x.id === pid && (x.userId === userId || isAdmin(userId)),
    );
    if (!p) return bot.sendMessage(chatId, "❌ Topilmadi.");
    return bot.sendMessage(
      chatId,
      `⚠️ *Rostdan ham o'chirasizmi?*\n` +
        `${UI.sparkLine}\n\n` +
        `🤖 *${p.templateName}*\n\n` +
        `⚠️ Bu amalni qaytarib bo'lmaydi!\n\n` +
        `${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Ha, o'chirish",
                callback_data: `confirm_undeploy_${pid}`,
              },
              { text: "❌ Yo'q", callback_data: "go_mybots" },
            ],
          ],
        },
      },
    );
  }
  if (data.startsWith("confirm_undeploy_")) {
    const pid = data.replace("confirm_undeploy_", "");
    const db = loadDB();
    const p = db.purchases.find(
      (x) => x.id === pid && (x.userId === userId || isAdmin(userId)),
    );
    if (!p) return bot.sendMessage(chatId, "❌ Topilmadi.");
    try {
      await bot.sendMessage(chatId, "🛑 *O'chirilmoqda...*", {
        parse_mode: "Markdown",
      });
      const result = await undeploy(p.userId, p.id);
      p.deployed = false;
      p.processName = null;
      p.deployId = null;
      saveDB(db);
      await bot.sendMessage(
        chatId,
        `✅ *Muvaffaqiyatli o'chirildi!*\n` +
          `${UI.sparkLine}\n\n` +
          `📁 \`${result.processName}\`\n\n` +
          `${UI.sparkLine}`,
        { parse_mode: "Markdown", ...getBackToMainInline() },
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ ${err.message}`);
    }
  }
});

// ============================================================
// PRE-CHECKOUT
// ============================================================
bot.on("pre_checkout_query", async (query) => {
  try {
    await bot.answerPreCheckoutQuery(query.id, true);
  } catch (err) {
    console.error("Pre-checkout:", err);
  }
});

// ============================================================
// SUCCESSFUL PAYMENT
// ============================================================
bot.on("message", async (msg) => {
  if (!msg.successful_payment) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const payment = msg.successful_payment;
  const templateId = payment.invoice_payload.split("_").slice(0, 2).join("_");
  const db = loadDB();
  const template = db.templates.find((t) => t.id === templateId);
  if (!template) return bot.sendMessage(chatId, "❌ Shablon topilmadi.");

  const purchase = {
    id: `purchase_${Date.now()}`,
    userId,
    templateId: template.id,
    templateName: template.name,
    fileName: template.fileName,
    amount: payment.total_amount,
    method: "stars",
    date: new Date().toISOString(),
    deployed: false,
    deployId: null,
    processName: null,
  };
  db.purchases.push(purchase);
  saveDB(db);

  await bot.sendMessage(
    chatId,
    `✅ *To'lov muvaffaqiyatli!*\n` +
      `${UI.sparkLine}\n\n` +
      `📦 ${template.name}\n` +
      `⭐ ${payment.total_amount} Stars\n\n` +
      `${UI.sparkLine}`,
    { parse_mode: "Markdown" },
  );

  bot
    .sendMessage(
      ADMIN_ID,
      `⭐ *Yangi xarid (Stars)!*\n${UI.sparkLine}\n\n👤 [${msg.from.first_name}](tg://user?id=${userId})\n📦 ${template.name}\n⭐ ${payment.total_amount}\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown" },
    )
    .catch(() => {});

  const user = getUser(userId);
  sendToChannel(
    `🎉 *Yangi xarid!*\n\n👤 ${maskUsername(user?.username || msg.from.username || "")}\n📦 *${template.name}*\n⭐ ${payment.total_amount} Stars\n\n${BOT_HANDLE}`,
  );

  await startPlaceholderCollection(chatId, userId, template, purchase.id);
});

// ============================================================
// ✨ DEPLOY EXECUTION — BEAUTIFUL
// ============================================================
async function executeDeploy(
  chatId,
  userId,
  templateId,
  purchaseId,
  replacements,
) {
  const db = loadDB();
  const template = db.templates.find((t) => t.id === templateId);
  if (!template) return bot.sendMessage(chatId, "❌ Topilmadi.");

  const statusMsg = await bot.sendMessage(
    chatId,
    `⚡ *Deploy jarayoni*\n` +
      `${UI.doubleLine}\n\n` +
      `📦 ${template.name}\n\n` +
      `📂 ZIP ochilmoqda...\n` +
      `📊 ${progressBar(15)}\n\n` +
      `${UI.doubleLine}`,
    { parse_mode: "Markdown" },
  );

  const updateStatus = async (text) => {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "Markdown",
      });
    } catch {}
  };

  try {
    await updateStatus(
      `⚡ *Deploy jarayoni*\n` +
        `${UI.doubleLine}\n\n` +
        `📦 ${template.name}\n\n` +
        `🔄 Sozlamalar kiritilmoqda...\n` +
        `📊 ${progressBar(40)}\n\n` +
        `${UI.doubleLine}`,
    );

    const result = await deploy(
      template.fileName,
      userId,
      purchaseId,
      replacements,
    );

    await updateStatus(
      `⚡ *Deploy jarayoni*\n` +
        `${UI.doubleLine}\n\n` +
        `📦 ${template.name}\n\n` +
        `🟢 Bot ishga tushirilmoqda...\n` +
        `📊 ${progressBar(80)}\n\n` +
        `${UI.doubleLine}`,
    );

    const purchase = db.purchases.find((p) => p.id === purchaseId);
    if (purchase) {
      purchase.deployed = true;
      purchase.processName = result.processName;
      purchase.deployId = result.processName;
      purchase.deployDir = result.deployDir;
      saveDB(db);
    }

    const phSummary = Object.entries(replacements)
      .map(([key, val]) => {
        const label = PLACEHOLDER_INFO[key]?.label || key;
        const masked =
          key.includes("TOKEN") || key.includes("KEY")
            ? val.substring(0, 8) + "..." + val.substring(val.length - 4)
            : val;
        return `  ◈ ${label}: \`${masked}\``;
      })
      .join("\n");

    await updateStatus(
      `🎉 *Deploy muvaffaqiyatli!*\n` +
        `${UI.doubleLine}\n\n` +
        `📦 *${template.name}*\n` +
        `🔧 Process: \`${result.processName}\`\n` +
        `📄 Fayl: \`${result.mainFile}\`\n` +
        `🟢 Status: *Running*\n\n` +
        `${UI.line}\n\n` +
        `📋 *Kiritilgan ma'lumotlar:*\n${phSummary}\n\n` +
        `${UI.line}\n\n` +
        `📊 ${progressBar(100)}\n\n` +
        `✨ *Botingiz muvaffaqiyatli ishga tushdi!*\n\n` +
        `${UI.doubleLine}`,
    );

    bot
      .sendMessage(
        ADMIN_ID,
        `🚀 *Yangi deploy!*\n${UI.sparkLine}\n\n👤 \`${userId}\`\n📦 ${template.name}\n🔧 \`${result.processName}\`\n🟢 Running\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});

    const user = getUser(userId);
    const totalDeploys = db.purchases.filter((p) => p.deployed).length;
    sendToChannel(
      `🚀 *Yangi bot deploy!*\n${UI.sparkLine}\n\n📦 *${template.name}*\n👤 ${maskUsername(user?.username || "")}\n🟢 Running\n📊 Jami: *${totalDeploys}* ta\n\n${BOT_HANDLE}`,
    );
  } catch (err) {
    console.error("Deploy error:", err);
    try {
      await updateStatus(
        `❌ *Deploy xatoligi!*\n` +
          `${UI.sparkLine}\n\n` +
          `📦 ${template.name}\n\n` +
          `🔴 \`${err.message.slice(0, 300)}\`\n\n` +
          `💡 Admin bilan bog'laning\n\n` +
          `${UI.sparkLine}`,
      );
    } catch {
      bot.sendMessage(chatId, `❌ ${err.message}`);
    }
    bot
      .sendMessage(
        ADMIN_ID,
        `❌ *Deploy xato!*\n${UI.sparkLine}\n\n👤 \`${userId}\`\n📦 ${template.name}\n🔴 \`${err.message.slice(0, 300)}\`\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
  }
}

// ============================================================
// ERROR HANDLING
// ============================================================
bot.on("polling_error", (err) => console.error("Polling:", err.message));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));
process.on("uncaughtException", (err) => console.error("Uncaught:", err));

console.log(`👑 Admin: ${ADMIN_ID}`);
console.log(`📢 Channel: ${NEWS_CHANNEL_ID}`);
console.log("📁 Templates:", TEMPLATES_DIR);
console.log("📁 Deployments:", DEPLOYMENTS_DIR);
console.log("✅ Bot is ready!");
