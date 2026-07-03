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

// ✅ NEWS CHANNEL
const NEWS_CHANNEL_ID = "@org081";
const BOT_HANDLE = "@builderdevrobot";

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

// Username ni xiralash: @username → @us***me
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

    // ✅ Yangi user — kanalga xabar
    const totalUsers = db.users.length;
    sendToChannel(
      `👤 *Yangi foydalanuvchi!*\n\n` +
        `🆔 ${maskUsername(username || "")}\n` +
        `👥 Jami foydalanuvchilar: *${totalUsers}* ta\n\n` +
        `🤖 ${BOT_HANDLE}`,
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
  return Number(amount).toLocaleString("uz-UZ").replace(/,/g, " ") + " UZS";
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
      "🔑 BotFather dan olgan bot tokeningizni yuboring:\n\nFormat: `123456789:ABCdefGhIjKlMnOpQrStUvWxYz`",
    validate: (val) => /^\d{8,}:[A-Za-z0-9_-]{35,}$/.test(val.trim()),
    error:
      "❌ Token formati noto'g'ri!\nFormat: `123456789:ABCdefGhIjKlMnOpQrStUvWxYz`\n\nQaytadan yuboring:",
  },
  YOUR_TELEGRAM_ID: {
    label: "👤 Telegram ID",
    prompt: "👤 Telegram ID raqamingizni yuboring:\n\nSizning ID: `{USER_ID}`",
    validate: (val) => /^\d{5,15}$/.test(val.trim()),
    error: "❌ ID faqat raqamlardan iborat bo'lishi kerak! Qaytadan yuboring:",
  },
  YOUR_ADMIN_ID: {
    label: "👑 Admin ID",
    prompt: "👑 Admin Telegram ID kiriting:\n\nSizning ID: `{USER_ID}`",
    validate: (val) => /^\d{5,15}$/.test(val.trim()),
    error: "❌ ID faqat raqam bo'lishi kerak! Qaytadan yuboring:",
  },
  YOUR_API_KEY: {
    label: "🔐 API Key",
    prompt: "🔐 API kalitini kiriting:",
    validate: () => true,
    error: "",
  },
  YOUR_DATABASE_URL: {
    label: "🗄️ Database URL",
    prompt:
      "🗄️ Database URL kiriting:\nMasalan: `mongodb://localhost:27017/mydb`",
    validate: (val) => val.trim().length > 5,
    error: "❌ URL juda qisqa. Qaytadan kiriting:",
  },
  YOUR_WEBHOOK_URL: {
    label: "🌐 Webhook URL",
    prompt:
      "🌐 Webhook URL kiriting:\nMasalan: `https://yourdomain.com/webhook`",
    validate: (val) => val.trim().startsWith("http"),
    error: '❌ URL "http" bilan boshlanishi kerak. Qaytadan kiriting:',
  },
  YOUR_CHANNEL_ID: {
    label: "📢 Channel ID",
    prompt: "📢 Kanal ID kiriting:\nMasalan: `@kanalnom` yoki `-1001234567890`",
    validate: (val) => val.trim().length > 2,
    error: "❌ Noto'g'ri format. Qaytadan kiriting:",
  },
  YOUR_GROUP_ID: {
    label: "👥 Group ID",
    prompt: "👥 Guruh ID kiriting:\nMasalan: `-1001234567890`",
    validate: (val) => val.trim().length > 2,
    error: "❌ Noto'g'ri format. Qaytadan kiriting:",
  },
  YOUR_PAYMENT_TOKEN: {
    label: "💳 Payment Token",
    prompt: "💳 To'lov provider tokenini kiriting:",
    validate: (val) => val.trim().length > 5,
    error: "❌ Token juda qisqa. Qaytadan kiriting:",
  },
};

// ============================================================
// KEYBOARDS
// ============================================================
function isAdmin(userId) {
  return userId === ADMIN_ID;
}

function getMainKeyboard(userId) {
  const keyboard = [
    [{ text: "🛒 Botlar katalogi" }, { text: "📦 Mening botlarim" }],
    [{ text: "💰 Pul ishlash" }, { text: "💳 Hamyonni to'ldirish" }],
    [{ text: "📊 Statistika" }, { text: "ℹ️ Yordam" }],
  ];
  if (isAdmin(userId)) keyboard.push([{ text: "⚙️ Admin panel" }]);
  return { reply_markup: { keyboard, resize_keyboard: true } };
}

function getEarnMoneyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎟️ Promokod", callback_data: "earn_promo" }],
        [{ text: "🎁 Kunlik bonus", callback_data: "earn_daily" }],
        [{ text: "🔗 Referal havola", callback_data: "earn_referral" }],
        [{ text: "🔙 Asosiy menyu", callback_data: "back_main" }],
      ],
    },
  };
}

function getAdminKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "➕ Shablon qo'shish", callback_data: "admin_add" },
          { text: "📋 Shablonlar", callback_data: "admin_list" },
        ],
        [
          { text: "🗑️ O'chirish", callback_data: "admin_delete" },
          { text: "✏️ Tahrirlash", callback_data: "admin_edit" },
        ],
        [
          { text: "👥 Foydalanuvchilar", callback_data: "admin_users" },
          { text: "📊 Statistika", callback_data: "admin_stats" },
        ],
        [
          { text: "📤 Broadcast", callback_data: "admin_broadcast" },
          { text: "🔄 Botni restart", callback_data: "admin_restart_bot" },
        ],
        [{ text: "🗂️ Deploymentlar", callback_data: "admin_deployments" }],
        [
          { text: "🎟️ Promokodlar", callback_data: "admin_promo" },
          { text: "💳 To'lovlar", callback_data: "admin_topups" },
        ],
        [{ text: "🔙 Asosiy menyu", callback_data: "back_main" }],
      ],
    },
  };
}

function getBackToMainInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Asosiy menyu", callback_data: "back_main" }],
      ],
    },
  };
}

function getBackToAdminInline() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Admin panel", callback_data: "back_admin" }],
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
    return "❌ Loglarni olishda xatolik yoki bot topilmadi.";
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
  if (days > 0) return `${days} kun, ${hours % 24} soat`;
  if (hours > 0) return `${hours} soat, ${minutes % 60} daqiqa`;
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

  await bot.sendMessage(
    chatId,
    `📋 *Kerakli ma'lumotlar (${uniquePlaceholders.length} ta):*\n\n` +
      uniquePlaceholders
        .map((ph, i) => `${i + 1}. ${PLACEHOLDER_INFO[ph]?.label || ph}`)
        .join("\n") +
      `\n\n${"─".repeat(30)}\n\n${prompt}`,
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
            `🎉 *Yangi referal!*\n\n👤 ${msg.from.first_name || "Foydalanuvchi"} sizning havolangiz orqali qo'shildi.\n💰 +${formatUZS(REFERRAL_BONUS)}\n💼 Yangi balans: *${formatUZS(referrer.balance)}*`,
            { parse_mode: "Markdown" },
          )
          .catch(() => {});

        // ✅ Referal — kanalga xabar
        sendToChannel(
          `🔗 *Yangi referal!*\n\n` +
            `👤 ${maskUsername(msg.from.username || "")} referal orqali qo'shildi\n` +
            `🎯 Taklif qiluvchi: ${maskUsername(referrer.username || "")}\n` +
            `💰 Bonus: +${formatUZS(REFERRAL_BONUS)}\n\n` +
            `🤖 ${BOT_HANDLE}`,
        );
      }
    }
  }

  bot.sendMessage(
    userId,
    `🤖 *Telegram Bot Builder* ga xush kelibsiz!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 Tayyor bot shablonlarini sotib oling\n` +
      `🚀 Avtomatik deploy — 1 daqiqada\n` +
      `💳 To'lov — Hamyon (UZS) yoki ⭐ Telegram Stars\n` +
      `💰 Pul ishlash — promokod, kunlik bonus, referal\n` +
      `🔧 Bot boshqaruvi — to'xtatish, restart, loglar\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👇 Quyidagi tugmalardan birini tanlang:`,
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
    `👤 *Sizning Telegram ID:*\n\n\`${msg.from.id}\``,
    { parse_mode: "Markdown" },
  );
});

// ============================================================
// CATALOG
// ============================================================
async function showCatalog(chatId, userId) {
  const db = loadDB();
  if (db.templates.length === 0) {
    return bot.sendMessage(chatId, "📭 *Hozircha shablonlar mavjud emas.*", {
      parse_mode: "Markdown",
      ...getBackToMainInline(),
    });
  }

  await bot.sendMessage(
    chatId,
    `🛒 *Botlar katalogi*\n\n📦 Jami ${db.templates.length} ta shablon:\n${"━".repeat(25)}`,
    { parse_mode: "Markdown" },
  );

  for (const tmpl of db.templates) {
    const placeholders = scanTemplatePlaceholders(tmpl.fileName);
    const phList =
      placeholders.length > 0
        ? placeholders.map((p) => PLACEHOLDER_INFO[p]?.label || p).join(", ")
        : "Faqat token";
    const priceUZS = tmpl.priceUZS || tmpl.price * 100;

    const text = `📦 *${tmpl.name}*\n\n⭐ Stars: *${tmpl.price} Stars*\n💰 UZS: *${formatUZS(priceUZS)}*\n📋 Kerakli: ${phList}\n🆔 ID: \`${tmpl.id}\``;
    const buttonText = isAdmin(userId)
      ? `👑 Bepul deploy — ${tmpl.name}`
      : `🛒 Sotib olish — ${tmpl.name}`;

    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: buttonText, callback_data: `buy_${tmpl.id}` }],
        ],
      },
    });
  }
}

// ============================================================
// MY BOTS
// ============================================================
async function showMyBots(chatId, userId) {
  const db = loadDB();
  const myPurchases = db.purchases.filter(
    (p) => p.userId === userId && p.deployed,
  );

  if (myPurchases.length === 0) {
    return bot.sendMessage(
      chatId,
      "📭 *Sizda deploy qilingan botlar yo'q.*\n\n🛒 Katalogdan shablon sotib oling!",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🛒 Katalogga", callback_data: "go_catalog" }],
            [{ text: "🔙 Asosiy menyu", callback_data: "back_main" }],
          ],
        },
      },
    );
  }

  await bot.sendMessage(
    chatId,
    `📦 *Mening botlarim*\n\n🤖 Jami ${myPurchases.length} ta bot:\n${"━".repeat(25)}`,
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

    let text = `🤖 *${purchase.templateName}*\n\n${statusEmoji} Status: *${statusText}*\n📁 Process: \`${processName}\`\n📅 Deploy: ${new Date(purchase.date).toLocaleDateString("uz-UZ")}`;
    if (pm2Info && pm2Info.status === "online") {
      text += `\n⏱ Uptime: ${formatUptime(pm2Info.uptime)}\n💾 Xotira: ${formatBytes(pm2Info.memory)}\n🔄 Restartlar: ${pm2Info.restarts}`;
    }

    const buttons = [];
    if (pm2Info && pm2Info.status === "online") {
      buttons.push([
        { text: "🛑 To'xtatish", callback_data: `bot_stop_${purchase.id}` },
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
      { text: "📋 Loglar", callback_data: `bot_logs_${purchase.id}` },
      { text: "🗑️ O'chirish", callback_data: `undeploy_${purchase.id}` },
    ]);
    buttons.push([
      { text: "🔄 Yangilash", callback_data: `bot_refresh_${purchase.id}` },
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
  let text =
    `📊 *Statistika*\n\n${"━".repeat(25)}\n\n` +
    `📦 Shablonlar: *${db.templates.length}* ta\n` +
    `🚀 Deploy: *${db.purchases.filter((p) => p.deployed).length}* ta\n` +
    `👥 Foydalanuvchilar: *${db.users.length}* ta\n` +
    `💰 Xaridlar: *${db.purchases.length}* ta\n\n`;
  if (db.templates.length > 0) {
    text += `📋 *Mavjud shablonlar:*\n`;
    for (const t of db.templates)
      text += `  • ${t.name} — ⭐ ${t.price} / 💰 ${formatUZS(t.priceUZS || t.price * 100)}\n`;
  }
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
    `ℹ️ *Yordam — Telegram Bot Builder*\n\n${"━".repeat(30)}\n\n` +
    `🛒 *Botlar katalogi* — Sotib olish\n📦 *Mening botlarim* — Boshqarish\n` +
    `💰 *Pul ishlash* — Promokod, bonus, referal\n💳 *Hamyonni to'ldirish*\n📊 *Statistika*\n\n` +
    `${"━".repeat(30)}\n\n📝 *Qanday ishlaydi?*\n\n` +
    `1️⃣ Katalogdan tanlang\n2️⃣ To'lang\n3️⃣ Ma'lumot kiriting\n4️⃣ Bot deploy bo'ladi ✅\n\n` +
    `🆘 /start /help /myid\n\n📢 Kanal: ${NEWS_CHANNEL_ID}`;
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
  await bot.sendMessage(
    chatId,
    `💰 *Pul ishlash*\n\n💼 Balans: *${formatUZS(balance)}*\n\n${"━".repeat(28)}\n\n` +
      `🎟️ *Promokod* — bonus oling\n🎁 *Kunlik bonus* — ${formatUZS(DAILY_BONUS)}\n🔗 *Referal* — ${formatUZS(REFERRAL_BONUS)}\n\n👇 Tanlang:`,
    { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
  );
}

async function handlePromoStart(chatId, userId) {
  setState(userId, { step: "waiting_promo_code" });
  await bot.sendMessage(chatId, "🎟️ *Promokodni kiriting:*", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "❌ Bekor qilish", callback_data: "back_main" }],
      ],
    },
  });
}

async function redeemPromoCode(chatId, userId, rawCode) {
  const code = rawCode.trim().toUpperCase();
  const db = loadDB();
  const promo = db.promoCodes.find((p) => p.code.toUpperCase() === code);
  if (!promo || !promo.active)
    return bot.sendMessage(chatId, "❌ Promokod topilmadi.", {
      ...getEarnMoneyKeyboard(),
    });

  const user = db.users.find((u) => u.id === userId);
  if (!user) return bot.sendMessage(chatId, "❌ Xatolik.");
  if (!user.usedPromoCodes) user.usedPromoCodes = [];
  if (user.usedPromoCodes.includes(promo.code))
    return bot.sendMessage(chatId, "⚠️ Allaqachon ishlatgansiz.", {
      ...getEarnMoneyKeyboard(),
    });
  if (promo.maxUses && promo.usedCount >= promo.maxUses)
    return bot.sendMessage(chatId, "❌ Limit tugagan.", {
      ...getEarnMoneyKeyboard(),
    });

  user.usedPromoCodes.push(promo.code);
  user.balance = Math.round((user.balance + promo.amount) * 100) / 100;
  promo.usedCount = (promo.usedCount || 0) + 1;
  saveDB(db);

  await bot.sendMessage(
    chatId,
    `✅ *Promokod qabul qilindi!*\n\n💰 +${formatUZS(promo.amount)}\n💼 Balans: *${formatUZS(user.balance)}*`,
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
      `⏳ Keyingi bonusgacha: *${h} soat ${m} daqiqa*`,
      { parse_mode: "Markdown", ...getEarnMoneyKeyboard() },
    );
  }

  user.lastDailyBonus = new Date(now).toISOString();
  user.balance = Math.round((user.balance + DAILY_BONUS) * 100) / 100;
  saveDB(db);

  await bot.sendMessage(
    chatId,
    `🎁 *Kunlik bonus!*\n\n💰 +${formatUZS(DAILY_BONUS)}\n💼 Balans: *${formatUZS(user.balance)}*`,
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
    `🔗 *Referal dasturi*\n\nHar bir yangi user uchun *${formatUZS(REFERRAL_BONUS)}*!\n\n🔗 Havola:\n\`${link}\`\n\n👥 Taklif: *${user?.referralCount || 0}* ta\n💰 Daromad: *${formatUZS(user?.referralEarnings || 0)}*`,
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
    `💳 *Hamyonni to'ldirish*\n\n💼 Balans: *${formatUZS(getBalance(userId))}*\n\nMiqdor kiriting.\nMin: *${formatUZS(MIN_TOPUP)}* | Max: *${formatUZS(MAX_TOPUP)}*`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor qilish", callback_data: "back_main" }],
        ],
      },
    },
  );
}

async function handleTopupAmount(chatId, userId, text) {
  const amount = parseInt(text.replace(/\s/g, ""), 10);
  if (isNaN(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
    return bot.sendMessage(
      chatId,
      `❌ Noto'g'ri! Min: ${formatUZS(MIN_TOPUP)}, Max: ${formatUZS(MAX_TOPUP)}`,
    );
  }
  setState(userId, {
    step: "waiting_topup_screenshot",
    amount,
    expiresAt: Date.now() + TOPUP_TIMEOUT_MS,
  });
  await bot.sendMessage(
    chatId,
    `💳 *To'lov*\n\nKarta: \`${CARD_NUMBER}\`\nMiqdor: *${formatUZS(amount)}*\n⏰ *5 daqiqa*\n\nChek rasmini yuboring.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor qilish", callback_data: "back_main" }],
        ],
      },
    },
  );
}

async function handleTopupScreenshot(msg, state) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (Date.now() > state.expiresAt) {
    clearState(userId);
    return bot.sendMessage(chatId, "⏰ Vaqt tugadi.", {
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
    `✅ *Chek qabul qilindi!*\n\n💰 ${formatUZS(state.amount)}\n\nAdmin tekshiradi.`,
    { parse_mode: "Markdown", ...getBackToMainInline() },
  );

  await bot
    .sendPhoto(ADMIN_ID, photo.file_id, {
      caption: `💳 *To'lov cheki!*\n\n👤 [${msg.from.first_name || "User"}](tg://user?id=${userId})\n🆔 \`${userId}\`\n💰 *${formatUZS(state.amount)}*\n🆔 \`${topup.id}\``,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Tasdiqlash",
              callback_data: `approve_topup_${topup.id}`,
            },
            { text: "❌ Rad", callback_data: `reject_topup_${topup.id}` },
          ],
        ],
      },
    })
    .catch(() => {});
}

async function showAdminTopups(chatId) {
  const db = loadDB();
  const pending = db.topups.filter((t) => t.status === "pending");
  if (pending.length === 0)
    return bot.sendMessage(chatId, "💳 Kutilayotgan to'lovlar yo'q.", {
      ...getBackToAdminInline(),
    });
  let text = `💳 *Kutilayotgan — ${pending.length} ta*\n\n`;
  for (const t of pending)
    text += `\`${t.id}\` — \`${t.userId}\` — ${formatUZS(t.amount)}\n`;
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToAdminInline(),
  });
}

// ============================================================
// ADMIN: PROMO, STATS, USERS, DEPLOYMENTS
// ============================================================
async function showAdminPromo(chatId) {
  const db = loadDB();
  let text = `🎟️ *Promokodlar*\n\n`;
  if (db.promoCodes.length === 0) text += "📭 Yo'q.";
  else
    for (const p of db.promoCodes)
      text += `\`${p.code}\` — ${formatUZS(p.amount)} | ${p.usedCount || 0}/${p.maxUses || "∞"} | ${p.active ? "🟢" : "🔴"}\n`;
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Yangi promokod", callback_data: "admin_promo_add" }],
        [{ text: "🔙 Admin panel", callback_data: "back_admin" }],
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

  const recentPurchases = db.purchases.slice(-5).reverse();
  let recentText = "";
  for (const p of recentPurchases)
    recentText += `  ${p.deployed ? "🟢" : "⚪"} ${p.templateName} — \`${p.userId}\` — ${new Date(p.date).toLocaleDateString("uz-UZ")}\n`;

  await bot.sendMessage(
    chatId,
    `📊 *Admin Statistika*\n\n${"━".repeat(30)}\n\n` +
      `📦 Shablonlar: *${db.templates.length}*\n💰 Xaridlar: *${db.purchases.length}*\n🚀 Deploylar: *${db.purchases.filter((p) => p.deployed).length}*\n` +
      `👥 Userlar: *${db.users.length}*\n🔧 PM2: *${pm2Count}*\n\n📋 *So'nggi:*\n${recentText || "  Yo'q"}`,
    { parse_mode: "Markdown", ...getBackToAdminInline() },
  );
}

async function showAdminUsers(chatId) {
  const db = loadDB();
  if (db.users.length === 0)
    return bot.sendMessage(chatId, "👥 Userlar yo'q.", {
      ...getBackToAdminInline(),
    });
  let text = `👥 *Foydalanuvchilar — ${db.users.length} ta*\n\n`;
  const showUsers = db.users.slice(-20).reverse();
  for (let i = 0; i < showUsers.length; i++) {
    const u = showUsers[i];
    const purchases = db.purchases.filter((p) => p.userId === u.id);
    text += `${i + 1}. *${u.firstName}* ${u.username ? "@" + u.username : "—"}\n   🆔 \`${u.id}\` | 🛒 ${purchases.length} | 💼 ${formatUZS(u.balance || 0)}\n\n`;
  }
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToAdminInline(),
  });
}

async function showAdminDeployments(chatId) {
  const db = loadDB();
  const active = db.purchases.filter((p) => p.deployed);
  if (active.length === 0)
    return bot.sendMessage(chatId, "🗂️ Aktiv deploymentlar yo'q.", {
      ...getBackToAdminInline(),
    });
  let text = `🗂️ *Deploymentlar — ${active.length} ta*\n\n`;
  for (const p of active) {
    const pn = p.processName || `bot_${p.userId}_${p.id}`;
    const info = getPm2Status(pn);
    text += `${info ? (info.status === "online" ? "🟢" : "🔴") : "⚪"} *${p.templateName}*\n  👤 \`${p.userId}\` | \`${pn}\`\n\n`;
  }
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

  if (text === "🛒 Botlar katalogi") {
    clearState(userId);
    return showCatalog(chatId, userId);
  }
  if (text === "📦 Mening botlarim") {
    clearState(userId);
    return showMyBots(chatId, userId);
  }
  if (text === "💰 Pul ishlash") {
    clearState(userId);
    return showEarnMoney(chatId, userId);
  }
  if (text === "💳 Hamyonni to'ldirish") {
    clearState(userId);
    return showWalletTopupPrompt(chatId, userId);
  }
  if (text === "📊 Statistika") {
    clearState(userId);
    return showStatistics(chatId, userId);
  }
  if (text === "ℹ️ Yordam") {
    clearState(userId);
    return sendHelpMessage(chatId, userId);
  }
  if (text === "⚙️ Admin panel" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(chatId, `⚙️ *Admin Panel*`, {
      parse_mode: "Markdown",
      ...getAdminKeyboard(),
    });
  }

  const state = getState(userId);
  if (!state) return;

  // Admin: template name
  if (state.step === "waiting_template_name" && isAdmin(userId)) {
    state.templateName = text;
    state.step = "waiting_template_price";
    setState(userId, state);
    return bot.sendMessage(chatId, "⭐ *Stars* narxini kiriting:", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
    });
  }
  // Admin: template price Stars
  if (state.step === "waiting_template_price" && isAdmin(userId)) {
    const price = parseInt(text);
    if (isNaN(price) || price < 1)
      return bot.sendMessage(chatId, "❌ Musbat son kiriting!");
    state.templatePrice = price;
    state.step = "waiting_template_price_uzs";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `⭐ ${price} Stars ✅\n\n💰 *UZS* narxini kiriting:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
          ],
        },
      },
    );
  }
  // Admin: template price UZS
  if (state.step === "waiting_template_price_uzs" && isAdmin(userId)) {
    const priceUZS = parseInt(text.replace(/\s/g, ""), 10);
    if (isNaN(priceUZS) || priceUZS < 100)
      return bot.sendMessage(chatId, "❌ Min 100 UZS!");
    state.templatePriceUZS = priceUZS;
    state.step = "waiting_template_zip";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      `✅ ⭐ ${state.templatePrice} Stars | 💰 ${formatUZS(priceUZS)}\n\n📎 ZIP yuboring:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
          ],
        },
      },
    );
  }
  // Admin: broadcast
  if (state.step === "waiting_broadcast_message" && isAdmin(userId)) {
    clearState(userId);
    return executeBroadcast(chatId, userId, text);
  }
  // Admin: edit name
  if (state.step === "waiting_edit_name" && isAdmin(userId)) {
    const db = loadDB();
    const tmpl = db.templates.find((t) => t.id === state.templateId);
    if (tmpl) {
      tmpl.name = text;
      saveDB(db);
      clearState(userId);
      return bot.sendMessage(chatId, `✅ Nom: *${text}*`, {
        parse_mode: "Markdown",
        ...getBackToAdminInline(),
      });
    }
    clearState(userId);
    return bot.sendMessage(chatId, "❌ Topilmadi.");
  }
  // Admin: edit price Stars
  if (state.step === "waiting_edit_price" && isAdmin(userId)) {
    const price = parseInt(text);
    if (isNaN(price) || price < 1)
      return bot.sendMessage(chatId, "❌ Musbat son!");
    state.editPrice = price;
    state.step = "waiting_edit_price_uzs";
    setState(userId, state);
    return bot.sendMessage(chatId, `⭐ ${price} ✅\n\n💰 UZS kiriting:`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
    });
  }
  // Admin: edit price UZS
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
        `✅ ⭐ ${state.editPrice} | 💰 ${formatUZS(priceUZS)}`,
        { parse_mode: "Markdown", ...getBackToAdminInline() },
      );
    }
    clearState(userId);
    return bot.sendMessage(chatId, "❌ Topilmadi.");
  }
  // User: promo
  if (state.step === "waiting_promo_code") {
    clearState(userId);
    return redeemPromoCode(chatId, userId, text);
  }
  // User: topup
  if (state.step === "waiting_topup_amount") {
    return handleTopupAmount(chatId, userId, text);
  }
  // Admin: promo code input
  if (state.step === "waiting_promo_code_input" && isAdmin(userId)) {
    const code = text.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code))
      return bot.sendMessage(chatId, "❌ 3-20 belgi, harf/raqam/_/-");
    const db = loadDB();
    if (db.promoCodes.some((p) => p.code === code))
      return bot.sendMessage(chatId, "❌ Mavjud!");
    state.promoCode = code;
    state.step = "waiting_promo_amount";
    setState(userId, state);
    return bot.sendMessage(chatId, "💰 Bonus miqdori (UZS):", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
    });
  }
  // Admin: promo amount
  if (state.step === "waiting_promo_amount" && isAdmin(userId)) {
    const amount = parseInt(text, 10);
    if (isNaN(amount) || amount < 1)
      return bot.sendMessage(chatId, "❌ Musbat son!");
    state.promoAmount = amount;
    state.step = "waiting_promo_maxuses";
    setState(userId, state);
    return bot.sendMessage(chatId, "🔢 Necha marta? (0 = cheklovsiz):", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
    });
  }
  // Admin: promo max uses
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

    // ✅ Promokod yaratildi — kanalga spoiler bilan
    sendToChannel(
      `🎟️ *Yangi promokod!*\n\n` +
        `🔑 Kod: ||${promo.code}||\n` +
        `_(ustiga bosing)_\n\n` +
        `💰 Bonus: *${formatUZS(promo.amount)}*\n` +
        `🔢 Aktivatsiyalar: *${promo.maxUses || "cheklovsiz"}* ta\n\n` +
        `🤖 ${BOT_HANDLE}`,
      { parse_mode: "MarkdownV2" },
    ).catch(() => {
      // MarkdownV2 ishlamasa oddiy Markdown bilan
      sendToChannel(
        `🎟️ *Yangi promokod!*\n\n` +
          `🔑 Kod: \`${promo.code}\`\n\n` +
          `💰 Bonus: *${formatUZS(promo.amount)}*\n` +
          `🔢 Aktivatsiyalar: *${promo.maxUses || "cheklovsiz"}* ta\n\n` +
          `🤖 ${BOT_HANDLE}`,
      );
    });

    return bot.sendMessage(
      chatId,
      `✅ *Promokod yaratildi!*\n\n🎟️ \`${promo.code}\`\n💰 ${formatUZS(promo.amount)}\n🔢 ${promo.maxUses || "cheklovsiz"}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }
  // User: collecting placeholders
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
      setState(userId, state);
      return bot.sendMessage(chatId, prompt, { parse_mode: "Markdown" });
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
// DOCUMENT HANDLER — Admin ZIP
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
    await bot.sendMessage(chatId, "📥 Yuklanmoqda...");
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
            .map((p) => `  • ${PLACEHOLDER_INFO[p]?.label || p}`)
            .join("\n")
        : "  • Faqat token";

    await bot.sendMessage(
      chatId,
      `✅ *Shablon qo'shildi!*\n\n📦 ${template.name}\n⭐ ${template.price} Stars\n💰 ${formatUZS(template.priceUZS)}\n📎 ${doc.file_name}\n🆔 \`${template.id}\`\n\n📋 Placeholders:\n${phList}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );

    // ✅ Yangi shablon — kanalga
    sendToChannel(
      `📦 *Yangi bot shablon qo'shildi!*\n\n` +
        `🤖 *${template.name}*\n` +
        `⭐ Stars: *${template.price} Stars*\n` +
        `💰 UZS: *${formatUZS(template.priceUZS)}*\n\n` +
        `🛒 Sotib olish uchun: ${BOT_HANDLE}\n\n` +
        `📢 ${NEWS_CHANNEL_ID}`,
    );
  } catch (err) {
    console.error("Upload error:", err);
    bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
    clearState(userId);
  }
});

// ============================================================
// PHOTO HANDLER — top-up screenshot
// ============================================================
bot.on("message", async (msg) => {
  if (!msg.photo) return;
  const state = getState(msg.from.id);
  if (!state || state.step !== "waiting_topup_screenshot") return;
  await handleTopupScreenshot(msg, state);
});

// ============================================================
// BROADCAST — ✅ kanalga ham yuboradi
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
    `📤 *Broadcast...*\n\n👥 ${users.length} ta`,
    { parse_mode: "Markdown" },
  );
  let sent = 0,
    failed = 0;

  for (const user of users) {
    if (user.id === adminId) continue;
    try {
      await bot.sendMessage(user.id, `📢 *Yangilik!*\n\n${message}`, {
        parse_mode: "Markdown",
      });
      sent++;
    } catch {
      failed++;
    }
    if ((sent + failed) % 25 === 0)
      await new Promise((r) => setTimeout(r, 1000));
  }

  try {
    await bot.editMessageText(
      `✅ *Broadcast tugadi!*\n\n📤 ${sent} ✅ | ❌ ${failed} | 👥 ${users.length}`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "Markdown",
      },
    );
  } catch {}

  // ✅ Kanalga ham broadcast
  sendToChannel(`📢 *Yangilik!*\n\n${message}\n\n🤖 ${BOT_HANDLE}`);
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
    return bot.sendMessage(chatId, "🏠 *Asosiy menyu*", {
      parse_mode: "Markdown",
      ...getMainKeyboard(userId),
    });
  }
  if (data === "back_admin" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(chatId, "⚙️ *Admin Panel*", {
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
    return bot.sendMessage(chatId, "❌ Bekor.", { ...getBackToAdminInline() });
  }

  if (data === "admin_add" && isAdmin(userId)) {
    setState(userId, { step: "waiting_template_name" });
    return bot.sendMessage(chatId, "📝 Shablon nomi:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
    });
  }

  if (data === "admin_list" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0)
      return bot.sendMessage(chatId, "📭 Yo'q.", { ...getBackToAdminInline() });
    let text = `📋 *Shablonlar — ${db.templates.length} ta*\n\n`;
    for (const t of db.templates) {
      const ph = scanTemplatePlaceholders(t.fileName);
      text += `📦 *${t.name}*\n   ⭐ ${t.price} | 💰 ${formatUZS(t.priceUZS || t.price * 100)} | 📋 ${ph.length}\n\n`;
    }
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
      { text: `🗑️ ${t.name}`, callback_data: `confirm_delete_${t.id}` },
    ]);
    buttons.push([{ text: "🔙 Admin", callback_data: "back_admin" }]);
    return bot.sendMessage(chatId, "🗑️ Qaysi?", {
      reply_markup: { inline_keyboard: buttons },
    });
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
      { text: `✏️ ${t.name}`, callback_data: `edit_tmpl_${t.id}` },
    ]);
    buttons.push([{ text: "🔙 Admin", callback_data: "back_admin" }]);
    return bot.sendMessage(chatId, "✏️ Qaysi?", {
      reply_markup: { inline_keyboard: buttons },
    });
  }
  if (data.startsWith("edit_tmpl_") && isAdmin(userId)) {
    const id = data.replace("edit_tmpl_", "");
    const db = loadDB();
    const t = db.templates.find((x) => x.id === id);
    if (!t) return bot.sendMessage(chatId, "❌ Topilmadi.");
    return bot.sendMessage(
      chatId,
      `✏️ *${t.name}*\n\n⭐ ${t.price} | 💰 ${formatUZS(t.priceUZS || t.price * 100)}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📝 Nom", callback_data: `editname_${id}` }],
            [{ text: "💱 Narx", callback_data: `editprice_${id}` }],
            [{ text: "🔙 Admin", callback_data: "back_admin" }],
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
    return bot.sendMessage(chatId, "📝 Yangi nom:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
    });
  }
  if (data.startsWith("editprice_") && isAdmin(userId)) {
    setState(userId, {
      step: "waiting_edit_price",
      templateId: data.replace("editprice_", ""),
    });
    return bot.sendMessage(chatId, "⭐ Yangi Stars narxi:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
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
    return bot.sendMessage(chatId, "📤 Xabarni yozing:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
    });
  }
  if (data === "admin_restart_bot" && isAdmin(userId)) {
    return bot.sendMessage(chatId, "⚠️ *Restart?*", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Ha", callback_data: "confirm_restart_main" },
            { text: "❌ Yo'q", callback_data: "back_admin" },
          ],
        ],
      },
    });
  }
  if (data === "confirm_restart_main" && isAdmin(userId)) {
    await bot.sendMessage(chatId, "🔄 3 soniya...");
    setTimeout(() => process.exit(0), 3000);
    return;
  }
  if (data === "admin_promo_add" && isAdmin(userId)) {
    setState(userId, { step: "waiting_promo_code_input" });
    return bot.sendMessage(chatId, "🎟️ Promokod nomi (masalan: `BONUS2026`):", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor", callback_data: "admin_cancel" }],
        ],
      },
    });
  }

  if (data === "earn_promo") return handlePromoStart(chatId, userId);
  if (data === "earn_daily") return handleDailyBonus(chatId, userId);
  if (data === "earn_referral") return showReferralInfo(chatId, userId);
  if (data === "go_topup") return showWalletTopupPrompt(chatId, userId);

  // Approve/Reject topup
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
    await bot.sendMessage(chatId, `✅ Tasdiqlandi: ${formatUZS(topup.amount)}`);
    bot
      .sendMessage(
        topup.userId,
        `✅ *To'lov tasdiqlandi!*\n\n💰 +${formatUZS(topup.amount)}\n💼 Balans: *${formatUZS(user ? user.balance : 0)}*`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});

    // ✅ To'lov tasdiqlandi — kanalga
    sendToChannel(
      `💳 *To'lov tasdiqlandi!*\n\n` +
        `👤 ${maskUsername(user?.username || "")}\n` +
        `💰 +${formatUZS(topup.amount)}\n\n` +
        `🤖 ${BOT_HANDLE}`,
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
    await bot.sendMessage(chatId, `❌ Rad: ${formatUZS(topup.amount)}`);
    bot
      .sendMessage(
        topup.userId,
        `❌ *To'lov rad etildi.*\n\n💰 ${formatUZS(topup.amount)}`,
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
      stopPm2Process(pn) ? `🛑 To'xtatildi: \`${pn}\`` : "❌ Xatolik.",
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
      restartPm2Process(pn) ? `🔄 Restart: \`${pn}\`` : "❌ Xatolik.",
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
      `📋 *${pn}*\n\n\`\`\`\n${getPm2Logs(pn)}\n\`\`\``,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Yangilash", callback_data: `bot_logs_${pid}` }],
            [{ text: "🔙 Botlarimga", callback_data: "go_mybots" }],
          ],
        },
      },
    );
    return;
  }
  if (data.startsWith("bot_refresh_")) return showMyBots(chatId, userId);

  // Buy template
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
        `👑 *Admin — bepul deploy!*\n\n📦 ${template.name}`,
        { parse_mode: "Markdown" },
      );
      return startPlaceholderCollection(chatId, userId, template, purchase.id);
    }

    const balance = getBalance(userId);
    return bot.sendMessage(
      chatId,
      `📦 *${template.name}*\n\n⭐ *${template.price} Stars*\n💰 *${formatUZS(priceUZS)}*\n💼 Balans: *${formatUZS(balance)}*\n\n💳 Qanday to'laysiz?`,
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
                text: `⭐ Stars — ${template.price}`,
                callback_data: `paystars_${template.id}`,
              },
            ],
            [{ text: "🔙 Katalogga", callback_data: "go_catalog" }],
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
        `❌ *Yetarli emas!*\n\n💼 ${formatUZS(user.balance)}\n💰 Kerak: ${formatUZS(priceUZS)}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💳 To'ldirish", callback_data: "go_topup" }],
              [{ text: "🔙 Katalog", callback_data: "go_catalog" }],
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
      `✅ *To'lov muvaffaqiyatli!*\n\n📦 ${template.name}\n💳 ${formatUZS(priceUZS)}\n💼 Qoldi: ${formatUZS(user.balance)}`,
      { parse_mode: "Markdown" },
    );
    bot
      .sendMessage(
        ADMIN_ID,
        `💰 *Xarid (hamyon)!*\n\n👤 \`${userId}\`\n📦 ${template.name}\n💵 ${formatUZS(priceUZS)}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});

    // ✅ Xarid — kanalga
    sendToChannel(
      `🎉 *Yangi xarid!*\n\n` +
        `👤 ${maskUsername(user.username || "")}\n` +
        `📦 *${template.name}* ni sotib oldi!\n` +
        `💰 ${formatUZS(priceUZS)}\n\n` +
        `🤖 ${BOT_HANDLE}`,
    );

    return startPlaceholderCollection(chatId, userId, template, purchase.id);
  }

  // Pay Stars
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
    return bot.sendMessage(chatId, `⚠️ *${p.templateName}* o'chirilsinmi?`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Ha", callback_data: `confirm_undeploy_${pid}` },
            { text: "❌ Yo'q", callback_data: "go_mybots" },
          ],
        ],
      },
    });
  }
  if (data.startsWith("confirm_undeploy_")) {
    const pid = data.replace("confirm_undeploy_", "");
    const db = loadDB();
    const p = db.purchases.find(
      (x) => x.id === pid && (x.userId === userId || isAdmin(userId)),
    );
    if (!p) return bot.sendMessage(chatId, "❌ Topilmadi.");
    try {
      await bot.sendMessage(chatId, "🛑 To'xtatilmoqda...");
      const result = await undeploy(p.userId, p.id);
      p.deployed = false;
      p.processName = null;
      p.deployId = null;
      saveDB(db);
      await bot.sendMessage(
        chatId,
        `✅ *O'chirildi*\n\n\`${result.processName}\``,
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
    `✅ *To'lov muvaffaqiyatli!*\n\n📦 ${template.name}\n⭐ ${payment.total_amount} Stars`,
    { parse_mode: "Markdown" },
  );
  bot
    .sendMessage(
      ADMIN_ID,
      `💰 *Xarid (Stars)!*\n\n👤 [${msg.from.first_name}](tg://user?id=${userId})\n📦 ${template.name}\n⭐ ${payment.total_amount}`,
      { parse_mode: "Markdown" },
    )
    .catch(() => {});

  // ✅ Stars xarid — kanalga
  const user = getUser(userId);
  sendToChannel(
    `🎉 *Yangi xarid!*\n\n` +
      `👤 ${maskUsername(user?.username || msg.from.username || "")}\n` +
      `📦 *${template.name}* ni sotib oldi!\n` +
      `⭐ ${payment.total_amount} Stars\n\n` +
      `🤖 ${BOT_HANDLE}`,
  );

  await startPlaceholderCollection(chatId, userId, template, purchase.id);
});

// ============================================================
// DEPLOY EXECUTION — ✅ kanalga deploy xabari
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
    `⏳ *Deploy...*\n\n📦 ${template.name}\n📂 ZIP ochilmoqda...\n\n${"▓".repeat(3)}${"░".repeat(17)} 15%`,
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
      `⏳ *Deploy...*\n\n📦 ${template.name}\n🔄 Placeholders...\n\n${"▓".repeat(8)}${"░".repeat(12)} 40%`,
    );
    const result = await deploy(
      template.fileName,
      userId,
      purchaseId,
      replacements,
    );
    await updateStatus(
      `⏳ *Deploy...*\n\n📦 ${template.name}\n🟢 Ishga tushirilmoqda...\n\n${"▓".repeat(16)}${"░".repeat(4)} 80%`,
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
        return `  ${label}: \`${masked}\``;
      })
      .join("\n");

    await updateStatus(
      `✅ *Deploy muvaffaqiyatli!*\n\n${"━".repeat(28)}\n\n📦 ${template.name}\n🔧 \`${result.processName}\`\n📄 \`${result.mainFile}\`\n🟢 *Running*\n\n${"━".repeat(28)}\n\n📋 *Ma'lumotlar:*\n${phSummary}\n\n${"▓".repeat(20)} 100% ✅\n\n🎉 *Botingiz ishga tushdi!*`,
    );

    bot
      .sendMessage(
        ADMIN_ID,
        `🚀 *Deploy!*\n\n👤 \`${userId}\`\n📦 ${template.name}\n🔧 \`${result.processName}\`\n🟢 Running`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});

    // ✅ Deploy — kanalga
    const user = getUser(userId);
    const totalDeploys = db.purchases.filter((p) => p.deployed).length;
    sendToChannel(
      `🚀 *Yangi bot deploy qilindi!*\n\n` +
        `📦 *${template.name}*\n` +
        `👤 ${maskUsername(user?.username || "")}\n` +
        `🟢 Status: *Running*\n\n` +
        `📊 Jami deploylar: *${totalDeploys}* ta\n\n` +
        `🤖 ${BOT_HANDLE}`,
    );
  } catch (err) {
    console.error("Deploy error:", err);
    try {
      await updateStatus(
        `❌ *Deploy xatoligi!*\n\n📦 ${template.name}\n🔴 \`${err.message.slice(0, 300)}\`\n\nAdminga murojaat qiling.`,
      );
    } catch {
      bot.sendMessage(chatId, `❌ ${err.message}`);
    }
    bot
      .sendMessage(
        ADMIN_ID,
        `❌ *Deploy xato!*\n\n👤 \`${userId}\`\n📦 ${template.name}\n🔴 \`${err.message.slice(0, 300)}\``,
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
