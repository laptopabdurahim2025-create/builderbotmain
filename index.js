// index.js — FULL REDESIGNED VERSION with COLORFUL Buttons 🎨

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
// ✨ UI CONSTANTS
// ============================================================
const UI = {
  line: "━━━━━━━━━━━━━━━━━━━━━━━━━",
  doubleLine: "══════════════════════════",
  sparkLine: "✦ ━━━━━━━━━━━━━━━━━━━ ✦",
};

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
// 🎨 COLORFUL KEYBOARDS
// ============================================================
function isAdmin(userId) {
  return userId === ADMIN_ID;
}

// 🎨 MAIN MENU — Rangli ReplyKeyboard
function getMainKeyboard(userId) {
  const keyboard = [
    [
      { text: "🛍 Botlar do'koni", style: "primary" },
      { text: "📱 Mening botlarim", style: "primary" },
    ],
    [
      { text: "💎 Pul ishlash", style: "success" },
      { text: "💳 Balansni to'ldirish", style: "success" },
    ],
    [
      { text: "📈 Statistika", style: "primary" },
      { text: "🆘 Yordam", style: "primary" },
    ],
  ];
  if (isAdmin(userId)) {
    keyboard.push([{ text: "⚙️ Admin panel", style: "danger" }]);
  }
  return { reply_markup: { keyboard, resize_keyboard: true } };
}

// 🎨 EARN MONEY — Rangli InlineKeyboard
function getEarnMoneyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🎟 Promokod kiritish",
            callback_data: "earn_promo",
            style: "success",
          },
        ],
        [
          {
            text: "🎁 Kunlik sovg'a",
            callback_data: "earn_daily",
            style: "success",
          },
        ],
        [
          {
            text: "👥 Do'stlarni taklif qilish",
            callback_data: "earn_referral",
            style: "primary",
          },
        ],
        [
          {
            text: "💳 Balansni to'ldirish",
            callback_data: "go_topup",
            style: "primary",
          },
        ],
        [
          {
            text: "🏠 Bosh menyu",
            callback_data: "back_main",
            style: "danger",
          },
        ],
      ],
    },
  };
}

// 🎨 ADMIN PANEL — Rangli
function getAdminKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📥 Shablon yuklash",
            callback_data: "admin_add",
            style: "success",
          },
          {
            text: "📋 Shablonlar",
            callback_data: "admin_list",
            style: "primary",
          },
        ],
        [
          {
            text: "🗑 O'chirish",
            callback_data: "admin_delete",
            style: "danger",
          },
          {
            text: "✏️ Tahrirlash",
            callback_data: "admin_edit",
            style: "primary",
          },
        ],
        [
          {
            text: "👥 Foydalanuvchilar",
            callback_data: "admin_users",
            style: "primary",
          },
          {
            text: "📊 Statistika",
            callback_data: "admin_stats",
            style: "primary",
          },
        ],
        [
          {
            text: "📢 Broadcast",
            callback_data: "admin_broadcast",
            style: "success",
          },
          {
            text: "🔄 Restart bot",
            callback_data: "admin_restart_bot",
            style: "danger",
          },
        ],
        [
          {
            text: "🗂 Deploymentlar",
            callback_data: "admin_deployments",
            style: "primary",
          },
        ],
        [
          {
            text: "🎟 Promokodlar",
            callback_data: "admin_promo",
            style: "success",
          },
          {
            text: "💳 To'lovlar",
            callback_data: "admin_topups",
            style: "primary",
          },
        ],
        [
          {
            text: "🏠 Bosh menyu",
            callback_data: "back_main",
            style: "danger",
          },
        ],
      ],
    },
  };
}

function getBackToMainInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🏠 Bosh menyu",
            callback_data: "back_main",
            style: "danger",
          },
        ],
      ],
    },
  };
}

function getBackToAdminInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "⬅️ Admin panelga",
            callback_data: "back_admin",
            style: "primary",
          },
        ],
      ],
    },
  };
}

function getCancelInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✖️ Bekor qilish",
            callback_data: "admin_cancel",
            style: "danger",
          },
        ],
      ],
    },
  };
}

function getCancelMainInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✖️ Bekor qilish",
            callback_data: "back_main",
            style: "danger",
          },
        ],
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
      `${UI.sparkLine}\n\n${phListText}\n\n${UI.line}\n\n${prompt}`,
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
            `🎉 *Yangi referal!*\n${UI.sparkLine}\n\n👤 ${msg.from.first_name || "Foydalanuvchi"}\n💰 +${formatUZS(REFERRAL_BONUS)}\n💼 Balans: *${formatUZS(referrer.balance)}*\n\n${UI.sparkLine}`,
            { parse_mode: "Markdown" },
          )
          .catch(() => {});

        sendToChannel(
          `🔗 *Referal!*\n\n👤 ${maskUsername(msg.from.username || "")}\n🎯 ${maskUsername(referrer.username || "")}\n💰 +${formatUZS(REFERRAL_BONUS)}\n\n${BOT_HANDLE}`,
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
    `✨ *Xush kelibsiz!*\n${UI.doubleLine}\n\n` +
      `🤖 *Telegram Bot Builder* — botlar dunyosi\n\n` +
      `${UI.line}\n\n📊 *Sizning hisobingiz:*\n` +
      `  💼 Balans: *${formatUZS(balance)}*\n` +
      `  🤖 Botlarim: *${myBots}* ta\n\n${UI.line}\n\n` +
      `🎯 *Imkoniyatlar:*\n\n  🛍 Tayyor bot shablonlari\n  ⚡ 1 daqiqada avtomatik deploy\n  💎 Pul ishlash — bonus, referal\n  🔧 To'liq bot boshqaruvi\n  💳 Qulay to'lov usullari\n\n` +
      `${UI.doubleLine}\n\n👇 *Quyidagi bo'limlardan tanlang:*`,
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
    `👤 *Sizning ma'lumotlaringiz:*\n${UI.sparkLine}\n\n🆔 ID: \`${msg.from.id}\`\n📛 Ism: *${msg.from.first_name || "—"}*\n👤 Username: ${msg.from.username ? "@" + msg.from.username : "—"}\n\n${UI.sparkLine}`,
    { parse_mode: "Markdown" },
  );
});

// ============================================================
// 🎨 CATALOG — Rangli tugmalar
// ============================================================
async function showCatalog(chatId, userId) {
  const db = loadDB();
  if (db.templates.length === 0) {
    return bot.sendMessage(
      chatId,
      `🛍 *Botlar do'koni*\n${UI.sparkLine}\n\n📭 Hozircha shablonlar yo'q.\n⏳ Tez orada qo'shiladi!\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getBackToMainInline() },
    );
  }

  const buttons = [];
  const styles = ["primary", "success"]; // Almashinib turadi

  for (let i = 0; i < db.templates.length; i++) {
    const tmpl = db.templates[i];
    const priceUZS = tmpl.priceUZS || tmpl.price * 100;
    const style = styles[i % styles.length];

    if (isAdmin(userId)) {
      buttons.push([
        {
          text: `${tmpl.name} 👑 Bepul`,
          callback_data: `viewbot_${tmpl.id}`,
          style: style,
        },
      ]);
    } else {
      buttons.push([
        {
          text: `${tmpl.name} • ${formatUZS(priceUZS)}`,
          callback_data: `viewbot_${tmpl.id}`,
          style: style,
        },
      ]);
    }
  }

  buttons.push([
    { text: "🏠 Bosh menyu", callback_data: "back_main", style: "danger" },
  ]);

  await bot.sendMessage(
    chatId,
    `🛍 *Botlar do'koni*\n${UI.doubleLine}\n\n📦 Mavjud: *${db.templates.length}* ta\n⚡ Sotib oling va ishga tushiring!\n\n${UI.line}\n\n👇 *Bot tanlang:*`,
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } },
  );
}

// ============================================================
// 🎨 VIEW BOT DETAILS
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
    `🤖 *${tmpl.name}*\n${UI.doubleLine}\n\n` +
    `💰 *Narxlar:*\n  ⭐ Stars: *${tmpl.price} Stars*\n  💵 So'm: *${formatUZS(priceUZS)}*\n\n` +
    `${UI.line}\n\n📋 *Kerakli sozlamalar:*\n${phList}\n\n` +
    `${UI.line}\n\n📊 *Ma'lumot:*\n  🛒 Sotilgan: *${purchaseCount}* marta\n  🆔 ID: \`${tmpl.id}\`\n\n${UI.doubleLine}`;

  const buyText = isAdmin(userId) ? "👑 Bepul deploy" : "🛒 Sotib olish";

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: buyText, callback_data: `buy_${tmpl.id}`, style: "success" }],
        [
          {
            text: "⬅️ Katalogga qaytish",
            callback_data: "go_catalog",
            style: "primary",
          },
        ],
      ],
    },
  });
}

// ============================================================
// 🎨 MY BOTS — Rangli
// ============================================================
async function showMyBots(chatId, userId) {
  const db = loadDB();
  const myPurchases = db.purchases.filter(
    (p) => p.userId === userId && p.deployed,
  );

  if (myPurchases.length === 0) {
    return bot.sendMessage(
      chatId,
      `📱 *Mening botlarim*\n${UI.sparkLine}\n\n📭 Hali deploy qilingan bot yo'q.\n\n💡 Katalogdan bot tanlang!\n\n${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🛍 Do'konga o'tish",
                callback_data: "go_catalog",
                style: "success",
              },
            ],
            [
              {
                text: "🏠 Bosh menyu",
                callback_data: "back_main",
                style: "danger",
              },
            ],
          ],
        },
      },
    );
  }

  await bot.sendMessage(
    chatId,
    `📱 *Mening botlarim*\n${UI.doubleLine}\n\n🤖 Jami: *${myPurchases.length}* ta\n\n${UI.line}`,
    { parse_mode: "Markdown" },
  );

  for (const purchase of myPurchases) {
    const processName =
      purchase.processName || `bot_${purchase.userId}_${purchase.id}`;
    const pm2Info = getPm2Status(processName);

    let statusEmoji, statusText;
    if (pm2Info) {
      if (pm2Info.status === "online") {
        statusEmoji = "🟢";
        statusText = "Ishlayapti";
      } else if (pm2Info.status === "stopped") {
        statusEmoji = "🔴";
        statusText = "To'xtatilgan";
      } else {
        statusEmoji = "🟡";
        statusText = pm2Info.status;
      }
    } else {
      statusEmoji = "⚪";
      statusText = "Noma'lum";
    }

    let text = `🤖 *${purchase.templateName}*\n${UI.sparkLine}\n\n${statusEmoji} Status: *${statusText}*\n📁 Process: \`${processName}\`\n📅 Deploy: ${new Date(purchase.date).toLocaleDateString("uz-UZ")}\n`;

    if (pm2Info && pm2Info.status === "online") {
      const memPercent = Math.min(
        100,
        Math.round((pm2Info.memory / (512 * 1024 * 1024)) * 100),
      );
      text += `\n📊 *Monitoring:*\n  ⏱ Uptime: *${formatUptime(pm2Info.uptime)}*\n  💾 Xotira: *${formatBytes(pm2Info.memory)}*\n  🔄 Restartlar: *${pm2Info.restarts}*\n  📈 RAM: ${progressBar(memPercent, 10)}\n`;
    }
    text += `\n${UI.sparkLine}`;

    const buttons = [];
    if (pm2Info && pm2Info.status === "online") {
      buttons.push([
        {
          text: "⏹ To'xtatish",
          callback_data: `bot_stop_${purchase.id}`,
          style: "danger",
        },
        {
          text: "🔄 Restart",
          callback_data: `bot_restart_${purchase.id}`,
          style: "primary",
        },
      ]);
    } else if (pm2Info && pm2Info.status === "stopped") {
      buttons.push([
        {
          text: "▶️ Ishga tushirish",
          callback_data: `bot_restart_${purchase.id}`,
          style: "success",
        },
      ]);
    }
    buttons.push([
      {
        text: "📋 Loglar",
        callback_data: `bot_logs_${purchase.id}`,
        style: "primary",
      },
      {
        text: "🗑 O'chirish",
        callback_data: `undeploy_${purchase.id}`,
        style: "danger",
      },
    ]);
    buttons.push([
      {
        text: "🔄 Yangilash",
        callback_data: `bot_refresh_${purchase.id}`,
        style: "primary",
      },
    ]);

    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

// ============================================================
// STATISTICS
// ============================================================
async function showStatistics(chatId, userId) {
  const db = loadDB();
  const user = getUser(userId);
  const myBots = db.purchases.filter(
    (p) => p.userId === userId && p.deployed,
  ).length;
  const myPurchases = db.purchases.filter((p) => p.userId === userId).length;

  let text =
    `📈 *Statistika*\n${UI.doubleLine}\n\n` +
    `👤 *Sizning hisobingiz:*\n  💼 Balans: *${formatUZS(user?.balance || 0)}*\n  🤖 Botlarim: *${myBots}* ta\n  🛒 Xaridlar: *${myPurchases}* ta\n  👥 Referallar: *${user?.referralCount || 0}* ta\n  💰 Ref. daromad: *${formatUZS(user?.referralEarnings || 0)}*\n\n` +
    `${UI.line}\n\n🌐 *Umumiy:*\n  📦 Shablonlar: *${db.templates.length}* ta\n  🚀 Deploylar: *${db.purchases.filter((p) => p.deployed).length}* ta\n  👥 Userlar: *${db.users.length}* ta\n  🛒 Xaridlar: *${db.purchases.length}* ta\n\n`;

  if (db.templates.length > 0) {
    text += `${UI.line}\n\n📋 *Shablonlar:*\n`;
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
// HELP
// ============================================================
async function sendHelpMessage(chatId, userId) {
  const text =
    `🆘 *Yordam markazi*\n${UI.doubleLine}\n\n` +
    `🛍 *Botlar do'koni* — Bot sotib olish\n📱 *Mening botlarim* — Boshqaruv\n💎 *Pul ishlash* — Bonus, referal\n💳 *Balansni to'ldirish* — Karta orqali\n📈 *Statistika* — Ma'lumotlar\n\n` +
    `${UI.line}\n\n⚡ *Qanday ishlaydi?*\n\n  1️⃣ Do'kondan bot tanlang\n  2️⃣ To'lang\n  3️⃣ Ma'lumot kiriting\n  4️⃣ Deploy ✅\n\n` +
    `${UI.line}\n\n🔧 *Buyruqlar:*\n  /start /help /myid\n\n📢 Kanal: ${NEWS_CHANNEL_ID}\n🤖 Bot: ${BOT_HANDLE}\n\n${UI.doubleLine}`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToMainInline(),
  });
}

// ============================================================
// EARN MONEY
// ============================================================
async function showEarnMoney(chatId, userId) {
  const balance = getBalance(userId);
  const user = getUser(userId);

  await bot.sendMessage(
    chatId,
    `💎 *Pul ishlash markazi*\n${UI.doubleLine}\n\n💼 Balans: *${formatUZS(balance)}*\n\n` +
      `${UI.line}\n\n🎟 *Promokod* — bonus kodlar\n🎁 *Kunlik* — ${formatUZS(DAILY_BONUS)}\n👥 *Referal* — ${formatUZS(REFERRAL_BONUS)}\n\n` +
      `${UI.line}\n\n📊 *Natijalaringiz:*\n  👥 Takliflar: *${user?.referralCount || 0}* ta\n  💰 Daromad: *${formatUZS(user?.referralEarnings || 0)}*\n\n${UI.doubleLine}\n\n👇 *Bo'lim tanlang:*`,
    { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
  );
}

async function handlePromoStart(chatId, userId) {
  setState(userId, { step: "waiting_promo_code" });
  await bot.sendMessage(
    chatId,
    `🎟 *Promokod kiritish*\n${UI.sparkLine}\n\n📝 Promokodni kiriting:\n\n💡 Promokodlar: ${NEWS_CHANNEL_ID}\n\n${UI.sparkLine}`,
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
      `❌ *Promokod topilmadi!*\n\n📝 \`${code}\``,
      { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
    );
  }

  const user = db.users.find((u) => u.id === userId);
  if (!user) return bot.sendMessage(chatId, "❌ Xatolik.");
  if (!user.usedPromoCodes) user.usedPromoCodes = [];

  if (user.usedPromoCodes.includes(promo.code)) {
    return bot.sendMessage(chatId, `⚠️ *Bu kodni allaqachon ishlatgansiz!*`, {
      parse_mode: "Markdown",
      ...getEarnMoneyKeyboard(),
    });
  }

  if (promo.maxUses && promo.usedCount >= promo.maxUses) {
    return bot.sendMessage(chatId, `❌ *Limit tugagan!*`, {
      parse_mode: "Markdown",
      ...getEarnMoneyKeyboard(),
    });
  }

  user.usedPromoCodes.push(promo.code);
  user.balance = Math.round((user.balance + promo.amount) * 100) / 100;
  promo.usedCount = (promo.usedCount || 0) + 1;
  saveDB(db);

  await bot.sendMessage(
    chatId,
    `🎉 *Promokod qabul qilindi!*\n${UI.sparkLine}\n\n🎟 \`${code}\`\n💰 +${formatUZS(promo.amount)}\n💼 Balans: *${formatUZS(user.balance)}*\n\n${UI.sparkLine}`,
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
      `⏳ *Keyingi bonusgacha:*\n${UI.sparkLine}\n\n🕐 *${h} soat ${m} daqiqa*\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
    );
  }

  user.lastDailyBonus = new Date(now).toISOString();
  user.balance = Math.round((user.balance + DAILY_BONUS) * 100) / 100;
  saveDB(db);

  await bot.sendMessage(
    chatId,
    `🎁 *Kunlik bonus olindi!*\n${UI.sparkLine}\n\n💰 +${formatUZS(DAILY_BONUS)}\n💼 Balans: *${formatUZS(user.balance)}*\n\n${UI.sparkLine}`,
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
    `👥 *Referal dasturi*\n${UI.doubleLine}\n\n💰 Har bir do'st = *${formatUZS(REFERRAL_BONUS)}*\n\n` +
      `${UI.line}\n\n🔗 *Havolangiz:*\n\n\`${link}\`\n\n` +
      `${UI.line}\n\n📊 *Natijalar:*\n  👥 Takliflar: *${user?.referralCount || 0}* ta\n  💰 Daromad: *${formatUZS(user?.referralEarnings || 0)}*\n\n${UI.doubleLine}`,
    { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
  );
}

// ============================================================
// WALLET TOP-UP
// ============================================================
async function showWalletTopupPrompt(chatId, userId) {
  setState(userId, { step: "waiting_topup_amount" });
  await bot.sendMessage(
    chatId,
    `💳 *Balansni to'ldirish*\n${UI.doubleLine}\n\n💼 Balans: *${formatUZS(getBalance(userId))}*\n\n${UI.line}\n\n📝 Miqdorni kiriting:\n\n  ◈ Min: *${formatUZS(MIN_TOPUP)}*\n  ◈ Max: *${formatUZS(MAX_TOPUP)}*\n\n💡 Masalan: \`5000\`\n\n${UI.doubleLine}`,
    { parse_mode: "Markdown", ...getCancelMainInline() },
  );
}

async function handleTopupAmount(chatId, userId, text) {
  const amount = parseInt(text.replace(/\s/g, ""), 10);
  if (isNaN(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
    return bot.sendMessage(
      chatId,
      `❌ *Noto'g'ri miqdor!*\n\nMin: ${formatUZS(MIN_TOPUP)}\nMax: ${formatUZS(MAX_TOPUP)}`,
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
    `💳 *To'lov*\n${UI.doubleLine}\n\n🏦 Karta:\n\`${CARD_NUMBER}\`\n\n💰 Miqdor: *${formatUZS(amount)}*\n\n${UI.line}\n\n⏰ *5 daqiqa*\n\n📸 Chek rasmini yuboring\n\n${UI.doubleLine}`,
    { parse_mode: "Markdown", ...getCancelMainInline() },
  );
}

async function handleTopupScreenshot(msg, state) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (Date.now() > state.expiresAt) {
    clearState(userId);
    return bot.sendMessage(chatId, `⏰ *Vaqt tugadi!*`, {
      parse_mode: "Markdown",
      ...getBackToMainInline(),
    });
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
    `✅ *Chek qabul qilindi!*\n${UI.sparkLine}\n\n💰 *${formatUZS(state.amount)}*\n📋 \`${topup.id}\`\n\n⏳ Admin tekshirmoqda...\n\n${UI.sparkLine}`,
    { parse_mode: "Markdown", ...getBackToMainInline() },
  );

  await bot
    .sendPhoto(ADMIN_ID, photo.file_id, {
      caption: `💳 *To'lov cheki!*\n${UI.sparkLine}\n\n👤 [${msg.from.first_name || "User"}](tg://user?id=${userId})\n🆔 \`${userId}\`\n💰 *${formatUZS(state.amount)}*\n📋 \`${topup.id}\`\n\n${UI.sparkLine}`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Tasdiqlash",
              callback_data: `approve_topup_${topup.id}`,
              style: "success",
            },
            {
              text: "❌ Rad etish",
              callback_data: `reject_topup_${topup.id}`,
              style: "danger",
            },
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
      `💳 *To'lovlar*\n${UI.sparkLine}\n\n📭 Yo'q.\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }
  let text = `💳 *Kutilayotgan — ${pending.length} ta*\n${UI.sparkLine}\n\n`;
  for (const t of pending)
    text += `  ◈ \`${t.id}\`\n    👤 \`${t.userId}\` — ${formatUZS(t.amount)}\n\n`;
  text += UI.sparkLine;
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToAdminInline(),
  });
}

// ============================================================
// ADMIN FUNCTIONS
// ============================================================
async function showAdminPromo(chatId) {
  const db = loadDB();
  let text = `🎟 *Promokodlar*\n${UI.doubleLine}\n\n`;

  if (db.promoCodes.length === 0) text += "📭 Yo'q.\n";
  else {
    for (const p of db.promoCodes) {
      const icon = p.active ? "🟢" : "🔴";
      text += `${icon} \`${p.code}\`\n  💰 ${formatUZS(p.amount)} | 🔢 ${p.usedCount || 0}/${p.maxUses || "∞"}\n\n`;
    }
  }
  text += UI.doubleLine;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "➕ Yangi promokod",
            callback_data: "admin_promo_add",
            style: "success",
          },
        ],
        [
          {
            text: "⬅️ Admin panelga",
            callback_data: "back_admin",
            style: "primary",
          },
        ],
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
    return d.toDateString() === new Date().toDateString();
  }).length;

  const recentPurchases = db.purchases.slice(-5).reverse();
  let recentText = "";
  for (const p of recentPurchases) {
    recentText += `  ${p.deployed ? "🟢" : "⚪"} ${p.templateName}\n    👤 \`${p.userId}\`\n\n`;
  }

  await bot.sendMessage(
    chatId,
    `📊 *Admin statistikasi*\n${UI.doubleLine}\n\n` +
      `📦 *Kontent:*\n  ◈ Shablonlar: *${db.templates.length}*\n  ◈ Xaridlar: *${db.purchases.length}*\n  ◈ Deploylar: *${db.purchases.filter((p) => p.deployed).length}*\n\n` +
      `👥 *Userlar:*\n  ◈ Jami: *${db.users.length}*\n  ◈ Bugun: *${todayUsers}*\n\n` +
      `💰 *Moliya:*\n  ◈ Tushum: *${formatUZS(totalRevenue)}*\n  ◈ Promokodlar: *${db.promoCodes.length}*\n\n` +
      `🔧 *Tizim:*\n  ◈ PM2: *${pm2Count}*\n\n${UI.line}\n\n📋 *So'nggi:*\n\n${recentText || "  📭 Yo'q"}\n${UI.doubleLine}`,
    { parse_mode: "Markdown", ...getBackToAdminInline() },
  );
}

async function showAdminUsers(chatId) {
  const db = loadDB();
  if (db.users.length === 0)
    return bot.sendMessage(chatId, `👥 *Yo'q*`, {
      parse_mode: "Markdown",
      ...getBackToAdminInline(),
    });

  let text = `👥 *Userlar — ${db.users.length} ta*\n${UI.doubleLine}\n\n`;
  const showUsers = db.users.slice(-20).reverse();
  for (let i = 0; i < showUsers.length; i++) {
    const u = showUsers[i];
    const purchases = db.purchases.filter((p) => p.userId === u.id);
    text += `${i + 1}. *${u.firstName}* ${u.username ? "@" + u.username : "—"}\n   🆔 \`${u.id}\` | 🛒 ${purchases.length} | 💼 ${formatUZS(u.balance || 0)}\n\n`;
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
  if (active.length === 0)
    return bot.sendMessage(chatId, `🗂 *Yo'q*`, {
      parse_mode: "Markdown",
      ...getBackToAdminInline(),
    });

  let text = `🗂 *Deploylar — ${active.length} ta*\n${UI.doubleLine}\n\n`;
  for (const p of active) {
    const pn = p.processName || `bot_${p.userId}_${p.id}`;
    const info = getPm2Status(pn);
    const icon = info ? (info.status === "online" ? "🟢" : "🔴") : "⚪";
    text += `${icon} *${p.templateName}*\n  👤 \`${p.userId}\` | 📁 \`${pn}\`\n\n`;
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
      `⚙️ *Admin Panel*\n${UI.doubleLine}\n\n🔧 Bo'lim tanlang:\n\n${UI.doubleLine}`,
      { parse_mode: "Markdown", ...getAdminKeyboard() },
    );
  }

  const state = getState(userId);
  if (!state) return;

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
      return bot.sendMessage(chatId, "❌ Musbat son!");
    state.templatePrice = price;
    state.step = "waiting_template_price_uzs";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `⭐ *${price}* ✅\n\n💰 *UZS* narxini kiriting:`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (state.step === "waiting_template_price_uzs" && isAdmin(userId)) {
    const priceUZS = parseInt(text.replace(/\s/g, ""), 10);
    if (isNaN(priceUZS) || priceUZS < 100)
      return bot.sendMessage(chatId, "❌ Min 100!");
    state.templatePriceUZS = priceUZS;
    state.step = "waiting_template_zip";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `✅ Narxlar:\n  ⭐ ${state.templatePrice}\n  💰 ${formatUZS(priceUZS)}\n\n📎 ZIP faylni yuboring:`,
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
      return bot.sendMessage(chatId, `✅ *Nom:* ${text}`, {
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
    return bot.sendMessage(chatId, `⭐ ${price} ✅\n\n💰 UZS kiriting:`, {
      parse_mode: "Markdown",
      ...getCancelInline(),
    });
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
        `✅ Narx: ⭐ ${state.editPrice} | 💰 ${formatUZS(priceUZS)}`,
        { parse_mode: "Markdown", ...getBackToAdminInline() },
      );
    }
    clearState(userId);
    return bot.sendMessage(chatId, "❌ Topilmadi.");
  }

  if (state.step === "waiting_promo_code") {
    clearState(userId);
    return redeemPromoCode(chatId, userId, text);
  }
  if (state.step === "waiting_topup_amount")
    return handleTopupAmount(chatId, userId, text);

  if (state.step === "waiting_promo_code_input" && isAdmin(userId)) {
    const code = text.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code))
      return bot.sendMessage(chatId, "❌ 3-20 belgi!");
    const db = loadDB();
    if (db.promoCodes.some((p) => p.code === code))
      return bot.sendMessage(chatId, "❌ Mavjud!");
    state.promoCode = code;
    state.step = "waiting_promo_amount";
    setState(userId, state);
    return bot.sendMessage(chatId, `🎟 \`${code}\` ✅\n\n💰 Bonus (UZS):`, {
      parse_mode: "Markdown",
      ...getCancelInline(),
    });
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
      `💰 ${formatUZS(amount)} ✅\n\n🔢 Necha marta? (0 = cheklovsiz):`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (state.step === "waiting_promo_maxuses" && isAdmin(userId)) {
    const maxUses = parseInt(text, 10);
    if (isNaN(maxUses) || maxUses < 0)
      return bot.sendMessage(chatId, "❌ 0 yoki musbat!");
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
      `🎟 *Yangi promokod!*\n${UI.sparkLine}\n\n🔑 \`${promo.code}\`\n💰 *${formatUZS(promo.amount)}*\n🔢 *${promo.maxUses || "cheklovsiz"}*\n\n${UI.sparkLine}\n\n🤖 ${BOT_HANDLE}`,
    );

    return bot.sendMessage(
      chatId,
      `✅ *Promokod yaratildi!*\n${UI.sparkLine}\n\n🎟 \`${promo.code}\`\n💰 ${formatUZS(promo.amount)}\n🔢 ${promo.maxUses || "cheklovsiz"}\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

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
        `✅ Qabul qilindi! (${state.currentIndex}/${state.placeholders.length})\n📊 ${progressBar(progress, 15)}\n\n${UI.line}\n\n${prompt}`,
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
// DOCUMENT HANDLER
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
    return bot.sendMessage(chatId, "❌ Faqat ZIP!");

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
      `✅ *Shablon qo'shildi!*\n${UI.doubleLine}\n\n📦 *${template.name}*\n⭐ ${template.price} Stars\n💰 ${formatUZS(template.priceUZS)}\n📎 ${doc.file_name}\n🆔 \`${template.id}\`\n\n📋 Placeholders:\n${phList}\n\n${UI.doubleLine}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );

    sendToChannel(
      `📦 *Yangi bot!*\n${UI.sparkLine}\n\n🤖 *${template.name}*\n⭐ ${template.price} Stars\n💰 ${formatUZS(template.priceUZS)}\n\n🛒 ${BOT_HANDLE}\n\n${UI.sparkLine}`,
    );
  } catch (err) {
    console.error("Upload error:", err);
    bot.sendMessage(chatId, `❌ ${err.message}`);
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
    return bot.sendMessage(chatId, "📭 Yo'q.", { ...getBackToAdminInline() });

  const statusMsg = await bot.sendMessage(
    chatId,
    `📢 *Broadcast...*\n\n👥 ${users.length} ta\n📊 ${progressBar(0)}`,
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
      `✅ *Tugadi!*\n${UI.sparkLine}\n\n📊 ${progressBar(100)}\n\n📤 ${sent} ✅ | ❌ ${failed} | 👥 ${users.length}\n\n${UI.sparkLine}`,
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
    return bot.sendMessage(chatId, `⚙️ *Admin Panel*`, {
      parse_mode: "Markdown",
      ...getAdminKeyboard(),
    });
  }
  if (data === "go_catalog") {
    clearState(userId);
    return showCatalog(chatId, userId);
  }
  if (data === "go_mybots") return showMyBots(chatId, userId);
  if (data === "admin_cancel" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(chatId, "✖️ *Bekor.*", {
      parse_mode: "Markdown",
      ...getBackToAdminInline(),
    });
  }

  if (data.startsWith("viewbot_")) {
    return showBotDetails(chatId, userId, data.replace("viewbot_", ""));
  }

  if (data === "admin_add" && isAdmin(userId)) {
    setState(userId, { step: "waiting_template_name" });
    return bot.sendMessage(
      chatId,
      `📥 *Yangi shablon*\n${UI.sparkLine}\n\n📝 Nomni kiriting:\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }

  if (data === "admin_list" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0)
      return bot.sendMessage(chatId, "📭 Yo'q.", { ...getBackToAdminInline() });
    let text = `📋 *Shablonlar — ${db.templates.length}*\n${UI.doubleLine}\n\n`;
    for (const t of db.templates) {
      const ph = scanTemplatePlaceholders(t.fileName);
      text += `📦 *${t.name}*\n  ⭐ ${t.price} | 💰 ${formatUZS(t.priceUZS || t.price * 100)} | 📋 ${ph.length}\n\n`;
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
      {
        text: `🗑 ${t.name}`,
        callback_data: `confirm_delete_${t.id}`,
        style: "danger",
      },
    ]);
    buttons.push([
      { text: "⬅️ Admin", callback_data: "back_admin", style: "primary" },
    ]);
    return bot.sendMessage(
      chatId,
      `🗑 *O'chirish*\n${UI.sparkLine}\n\nQaysi?\n\n${UI.sparkLine}`,
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
    return bot.sendMessage(chatId, `✅ *"${t.name}"* o'chirildi.`, {
      parse_mode: "Markdown",
      ...getBackToAdminInline(),
    });
  }

  if (data === "admin_edit" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0)
      return bot.sendMessage(chatId, "📭 Yo'q.", { ...getBackToAdminInline() });
    const buttons = db.templates.map((t) => [
      {
        text: `✏️ ${t.name}`,
        callback_data: `edit_tmpl_${t.id}`,
        style: "primary",
      },
    ]);
    buttons.push([
      { text: "⬅️ Admin", callback_data: "back_admin", style: "primary" },
    ]);
    return bot.sendMessage(
      chatId,
      `✏️ *Tahrirlash*\n${UI.sparkLine}\n\nQaysi?\n\n${UI.sparkLine}`,
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
      `✏️ *${t.name}*\n${UI.sparkLine}\n\n⭐ ${t.price} | 💰 ${formatUZS(t.priceUZS || t.price * 100)}\n\n${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📝 Nom",
                callback_data: `editname_${id}`,
                style: "primary",
              },
            ],
            [
              {
                text: "💱 Narx",
                callback_data: `editprice_${id}`,
                style: "primary",
              },
            ],
            [
              {
                text: "⬅️ Admin",
                callback_data: "back_admin",
                style: "primary",
              },
            ],
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
    return bot.sendMessage(chatId, "📝 *Yangi nom:*", {
      parse_mode: "Markdown",
      ...getCancelInline(),
    });
  }
  if (data.startsWith("editprice_") && isAdmin(userId)) {
    setState(userId, {
      step: "waiting_edit_price",
      templateId: data.replace("editprice_", ""),
    });
    return bot.sendMessage(chatId, "⭐ *Yangi Stars narxi:*", {
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
      `📢 *Broadcast*\n${UI.sparkLine}\n\nXabarni yozing:\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }
  if (data === "admin_restart_bot" && isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      `⚠️ *Restart?*\n${UI.sparkLine}\n\nRostdan ham?\n\n${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Ha",
                callback_data: "confirm_restart_main",
                style: "success",
              },
              { text: "❌ Yo'q", callback_data: "back_admin", style: "danger" },
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
      `🎟 *Yangi promokod*\n${UI.sparkLine}\n\nKod nomini kiriting:\n💡 \`BONUS2026\`\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown", ...getCancelInline() },
    );
  }

  if (data === "earn_promo") return handlePromoStart(chatId, userId);
  if (data === "earn_daily") return handleDailyBonus(chatId, userId);
  if (data === "earn_referral") return showReferralInfo(chatId, userId);
  if (data === "go_topup") return showWalletTopupPrompt(chatId, userId);

  if (data.startsWith("approve_topup_") && isAdmin(userId)) {
    const topupId = data.replace("approve_topup_", "");
    const db = loadDB();
    const topup = db.topups.find((t) => t.id === topupId);
    if (!topup) return bot.sendMessage(chatId, "❌ Topilmadi.");
    if (topup.status !== "pending")
      return bot.sendMessage(chatId, "⚠️ Ko'rilgan.");
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
        `✅ *To'lov tasdiqlandi!*\n${UI.sparkLine}\n\n💰 +${formatUZS(topup.amount)}\n💼 *${formatUZS(user ? user.balance : 0)}*\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
    sendToChannel(
      `💳 *To'lov tasdiqlandi!*\n\n👤 ${maskUsername(user?.username || "")}\n💰 +${formatUZS(topup.amount)}\n\n${BOT_HANDLE}`,
    );
    return;
  }
  if (data.startsWith("reject_topup_") && isAdmin(userId)) {
    const topupId = data.replace("reject_topup_", "");
    const db = loadDB();
    const topup = db.topups.find((t) => t.id === topupId);
    if (!topup) return bot.sendMessage(chatId, "❌ Topilmadi.");
    if (topup.status !== "pending")
      return bot.sendMessage(chatId, "⚠️ Ko'rilgan.");
    topup.status = "rejected";
    topup.resolvedAt = new Date().toISOString();
    saveDB(db);
    await bot.sendMessage(chatId, `❌ *Rad:* ${formatUZS(topup.amount)}`, {
      parse_mode: "Markdown",
    });
    bot
      .sendMessage(
        topup.userId,
        `❌ *To'lov rad etildi*\n${UI.sparkLine}\n\n💰 ${formatUZS(topup.amount)}\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
    return;
  }

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
      stopPm2Process(pn) ? `⏹ *To'xtatildi*` : "❌ Xatolik.",
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
      restartPm2Process(pn) ? `🔄 *Restart*` : "❌ Xatolik.",
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
      `📋 *${pn}*\n${UI.sparkLine}\n\n\`\`\`\n${getPm2Logs(pn)}\n\`\`\`\n\n${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🔄 Yangilash",
                callback_data: `bot_logs_${pid}`,
                style: "primary",
              },
            ],
            [
              {
                text: "📱 Botlarim",
                callback_data: "go_mybots",
                style: "primary",
              },
            ],
          ],
        },
      },
    );
    return;
  }
  if (data.startsWith("bot_refresh_")) return showMyBots(chatId, userId);

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
        `👑 *Admin — bepul!*\n${UI.sparkLine}\n\n📦 ${template.name}\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      );
      return startPlaceholderCollection(chatId, userId, template, purchase.id);
    }

    const balance = getBalance(userId);
    return bot.sendMessage(
      chatId,
      `🛒 *Sotib olish*\n${UI.doubleLine}\n\n📦 *${template.name}*\n\n⭐ *${template.price} Stars*\n💰 *${formatUZS(priceUZS)}*\n\n${UI.line}\n\n💼 Balans: *${formatUZS(balance)}*\n\n${UI.doubleLine}\n\n💳 *To'lov usulini tanlang:*`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `💳 Hamyon — ${formatUZS(priceUZS)}`,
                callback_data: `paywallet_${template.id}`,
                style: "success",
              },
            ],
            [
              {
                text: `⭐ Telegram Stars — ${template.price} ⭐`,
                callback_data: `paystars_${template.id}`,
                style: "primary",
              },
            ],
            [
              {
                text: "⬅️ Katalogga",
                callback_data: "go_catalog",
                style: "danger",
              },
            ],
          ],
        },
      },
    );
  }

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
        `❌ *Mablag' yetmadi!*\n${UI.sparkLine}\n\n💼 Balans: *${formatUZS(user.balance)}*\n💰 Kerak: *${formatUZS(priceUZS)}*\n📉 Kamomad: *${formatUZS(priceUZS - user.balance)}*\n\n${UI.sparkLine}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "💳 To'ldirish",
                  callback_data: "go_topup",
                  style: "success",
                },
              ],
              [
                {
                  text: "⬅️ Katalog",
                  callback_data: "go_catalog",
                  style: "primary",
                },
              ],
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
      `✅ *To'lov muvaffaqiyatli!*\n${UI.sparkLine}\n\n📦 ${template.name}\n💳 ${formatUZS(priceUZS)}\n💼 Qoldi: *${formatUZS(user.balance)}*\n\n${UI.sparkLine}`,
      { parse_mode: "Markdown" },
    );
    bot
      .sendMessage(
        ADMIN_ID,
        `💰 *Xarid!*\n${UI.sparkLine}\n\n👤 \`${userId}\`\n📦 ${template.name}\n💵 ${formatUZS(priceUZS)}\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
    sendToChannel(
      `🎉 *Yangi xarid!*\n\n👤 ${maskUsername(user.username || "")}\n📦 *${template.name}*\n💰 ${formatUZS(priceUZS)}\n\n${BOT_HANDLE}`,
    );

    return startPlaceholderCollection(chatId, userId, template, purchase.id);
  }

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

  if (data.startsWith("undeploy_")) {
    const pid = data.replace("undeploy_", "");
    const db = loadDB();
    const p = db.purchases.find(
      (x) => x.id === pid && (x.userId === userId || isAdmin(userId)),
    );
    if (!p) return bot.sendMessage(chatId, "❌ Topilmadi.");
    return bot.sendMessage(
      chatId,
      `⚠️ *O'chirasizmi?*\n${UI.sparkLine}\n\n🤖 *${p.templateName}*\n\n⚠️ Qaytarib bo'lmaydi!\n\n${UI.sparkLine}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Ha, o'chirish",
                callback_data: `confirm_undeploy_${pid}`,
                style: "danger",
              },
              { text: "❌ Yo'q", callback_data: "go_mybots", style: "primary" },
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
        `✅ *O'chirildi!*\n${UI.sparkLine}\n\n📁 \`${result.processName}\`\n\n${UI.sparkLine}`,
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
    `✅ *To'lov!*\n${UI.sparkLine}\n\n📦 ${template.name}\n⭐ ${payment.total_amount} Stars\n\n${UI.sparkLine}`,
    { parse_mode: "Markdown" },
  );
  bot
    .sendMessage(
      ADMIN_ID,
      `⭐ *Xarid (Stars)!*\n${UI.sparkLine}\n\n👤 [${msg.from.first_name}](tg://user?id=${userId})\n📦 ${template.name}\n⭐ ${payment.total_amount}\n\n${UI.sparkLine}`,
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
// DEPLOY EXECUTION
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
    `⚡ *Deploy...*\n${UI.doubleLine}\n\n📦 ${template.name}\n\n📂 ZIP...\n📊 ${progressBar(15)}\n\n${UI.doubleLine}`,
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
      `⚡ *Deploy...*\n${UI.doubleLine}\n\n📦 ${template.name}\n\n🔄 Sozlash...\n📊 ${progressBar(40)}\n\n${UI.doubleLine}`,
    );

    const result = await deploy(
      template.fileName,
      userId,
      purchaseId,
      replacements,
    );

    await updateStatus(
      `⚡ *Deploy...*\n${UI.doubleLine}\n\n📦 ${template.name}\n\n🟢 Ishga tushirilmoqda...\n📊 ${progressBar(80)}\n\n${UI.doubleLine}`,
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
      `🎉 *Deploy muvaffaqiyatli!*\n${UI.doubleLine}\n\n📦 *${template.name}*\n🔧 \`${result.processName}\`\n📄 \`${result.mainFile}\`\n🟢 *Running*\n\n${UI.line}\n\n📋 *Ma'lumotlar:*\n${phSummary}\n\n${UI.line}\n\n📊 ${progressBar(100)}\n\n✨ *Botingiz ishga tushdi!*\n\n${UI.doubleLine}`,
    );

    bot
      .sendMessage(
        ADMIN_ID,
        `🚀 *Deploy!*\n${UI.sparkLine}\n\n👤 \`${userId}\`\n📦 ${template.name}\n🔧 \`${result.processName}\`\n🟢 Running\n\n${UI.sparkLine}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
    const user = getUser(userId);
    const totalDeploys = db.purchases.filter((p) => p.deployed).length;
    sendToChannel(
      `🚀 *Yangi deploy!*\n${UI.sparkLine}\n\n📦 *${template.name}*\n👤 ${maskUsername(user?.username || "")}\n🟢 Running\n📊 Jami: *${totalDeploys}*\n\n${BOT_HANDLE}`,
    );
  } catch (err) {
    console.error("Deploy error:", err);
    try {
      await updateStatus(
        `❌ *Deploy xato!*\n${UI.sparkLine}\n\n📦 ${template.name}\n\n🔴 \`${err.message.slice(0, 300)}\`\n\n${UI.sparkLine}`,
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
console.log("✅ Bot is ready with COLORFUL buttons! 🎨");
