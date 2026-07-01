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

// ============================================================
// DATABASE
// ============================================================
const DB_PATH = path.join(__dirname, "database.json");

function loadDB() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    // Ensure all needed fields exist
    if (!data.users) data.users = [];
    if (!data.templates) data.templates = [];
    if (!data.purchases) data.purchases = [];
    if (!data.pending) data.pending = {};
    return data;
  } catch {
    const fresh = { templates: [], purchases: [], pending: {}, users: [] };
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
  } else {
    db.users.push({
      id: userId,
      firstName: firstName || "Unknown",
      username: username || "",
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });
  }
  saveDB(db);
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
    prompt:
      "👤 Telegram ID raqamingizni yuboring:\n\nSizning ID: `{USER_ID}` — shuni yuboring yoki boshqa ID kiriting:",
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
    [{ text: "📊 Statistika" }, { text: "ℹ️ Yordam" }],
  ];
  if (isAdmin(userId)) {
    keyboard.push([{ text: "⚙️ Admin panel" }]);
  }
  return { reply_markup: { keyboard, resize_keyboard: true } };
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
        [
          { text: "🗂️ Deploymentlar", callback_data: "admin_deployments" },
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
    const output = execSync(`pm2 logs ${processName} --nostream --lines ${lines}`, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
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
// Placeholder collection start helper
// ============================================================
async function startPlaceholderCollection(chatId, userId, template, purchaseId) {
  const placeholders = scanTemplatePlaceholders(template.fileName);

  if (!placeholders.includes("YOUR_BOT_TOKEN_HERE")) {
    placeholders.unshift("YOUR_BOT_TOKEN_HERE");
  }

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
    purchaseId: purchaseId,
    placeholders: uniquePlaceholders,
    currentIndex: 0,
    collectedValues: {},
  });

  await bot.sendMessage(
    chatId,
    `📋 *Kerakli ma'lumotlar (${uniquePlaceholders.length} ta):*\n\n` +
      uniquePlaceholders
        .map((ph, i) => {
          const info = PLACEHOLDER_INFO[ph];
          return `${i + 1}. ${info?.label || ph}`;
        })
        .join("\n") +
      `\n\n${"─".repeat(30)}\n\n${prompt}`,
    { parse_mode: "Markdown" },
  );
}

// ============================================================
// /start
// ============================================================
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  clearState(userId);
  trackUser(userId, msg.from.first_name, msg.from.username);

  bot.sendMessage(
    userId,
    `🤖 *Telegram Bot Builder* ga xush kelibsiz!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 Tayyor bot shablonlarini sotib oling\n` +
      `🚀 Avtomatik deploy — 1 daqiqada\n` +
      `⭐ To'lov Telegram Stars orqali\n` +
      `🔧 Bot boshqaruvi — to'xtatish, restart, loglar\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👇 Quyidagi tugmalardan birini tanlang:`,
    { parse_mode: "Markdown", ...getMainKeyboard(userId) },
  );
});

// ============================================================
// /help
// ============================================================
bot.onText(/\/help/, (msg) => {
  clearState(msg.from.id);
  sendHelpMessage(msg.chat.id, msg.from.id);
});

// ============================================================
// /myid
// ============================================================
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
    return bot.sendMessage(
      chatId,
      "📭 *Hozircha shablonlar mavjud emas.*\n\nAdmin shablonlar qo'shgandan keyin bu yerda ko'rinadi.",
      { parse_mode: "Markdown", ...getBackToMainInline() },
    );
  }

  await bot.sendMessage(
    chatId,
    `🛒 *Botlar katalogi*\n\n📦 Jami ${db.templates.length} ta shablon mavjud:\n${"━".repeat(25)}`,
    { parse_mode: "Markdown" },
  );

  for (const tmpl of db.templates) {
    const placeholders = scanTemplatePlaceholders(tmpl.fileName);
    const phList =
      placeholders.length > 0
        ? placeholders.map((p) => PLACEHOLDER_INFO[p]?.label || p).join(", ")
        : "Faqat token";

    const text =
      `📦 *${tmpl.name}*\n\n` +
      `⭐ Narxi: *${tmpl.price} Stars*\n` +
      `📋 Kerakli: ${phList}\n` +
      `🆔 ID: \`${tmpl.id}\``;

    const buttonText = isAdmin(userId)
      ? `👑 Bepul deploy — ${tmpl.name}`
      : `⭐ Sotib olish — ${tmpl.price} Stars`;

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
      "📭 *Sizda deploy qilingan botlar yo'q.*\n\n🛒 Botlar katalogidan shablon sotib oling va deploy qiling!",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🛒 Katalogga o'tish", callback_data: "go_catalog" }],
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
    const processName = `bot_${userId}`;
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

    let text =
      `🤖 *${purchase.templateName}*\n\n` +
      `${statusEmoji} Status: *${statusText}*\n` +
      `📁 Process: \`${processName}\`\n` +
      `📅 Deploy: ${new Date(purchase.date).toLocaleDateString("uz-UZ")}`;

    if (pm2Info && pm2Info.status === "online") {
      text += `\n⏱ Uptime: ${formatUptime(pm2Info.uptime)}`;
      text += `\n💾 Xotira: ${formatBytes(pm2Info.memory)}`;
      text += `\n🔄 Restartlar: ${pm2Info.restarts}`;
    }

    const buttons = [];
    if (pm2Info && pm2Info.status === "online") {
      buttons.push([
        {
          text: "🛑 To'xtatish",
          callback_data: `bot_stop_${purchase.id}`,
        },
        {
          text: "🔄 Restart",
          callback_data: `bot_restart_${purchase.id}`,
        },
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
      {
        text: "📋 Loglar",
        callback_data: `bot_logs_${purchase.id}`,
      },
      {
        text: "🗑️ O'chirish",
        callback_data: `undeploy_${purchase.id}`,
      },
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
  const totalTemplates = db.templates.length;
  const totalDeploys = db.purchases.filter((p) => p.deployed).length;
  const totalUsers = db.users ? db.users.length : 0;
  const totalPurchases = db.purchases.length;

  let text =
    `📊 *Statistika*\n\n` +
    `${"━".repeat(25)}\n\n` +
    `📦 Shablonlar: *${totalTemplates}* ta\n` +
    `🚀 Deploy qilingan: *${totalDeploys}* ta\n` +
    `👥 Foydalanuvchilar: *${totalUsers}* ta\n` +
    `💰 Jami xaridlar: *${totalPurchases}* ta\n\n`;

  if (totalTemplates > 0) {
    text += `📋 *Mavjud shablonlar:*\n`;
    for (const t of db.templates) {
      text += `  • ${t.name} — ⭐ ${t.price} Stars\n`;
    }
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
    `ℹ️ *Yordam — Telegram Bot Builder*\n\n` +
    `${"━".repeat(30)}\n\n` +
    `🛒 *Botlar katalogi* — Tayyor bot shablonlarini ko'rish va sotib olish\n\n` +
    `📦 *Mening botlarim* — Deploy qilingan botlaringizni boshqarish:\n` +
    `  • 🛑 To'xtatish\n` +
    `  • 🔄 Qayta ishga tushirish\n` +
    `  • 📋 Loglarni ko'rish\n` +
    `  • 🗑️ O'chirish\n\n` +
    `📊 *Statistika* — Umumiy ma'lumotlar\n\n` +
    `${"━".repeat(30)}\n\n` +
    `📝 *Qanday ishlaydi?*\n\n` +
    `1️⃣ Katalogdan bot tanlang\n` +
    `2️⃣ ⭐ Stars orqali to'lang\n` +
    `3️⃣ Bot token va kerakli ma'lumotlarni kiriting\n` +
    `4️⃣ Bot avtomatik deploy qilinadi ✅\n\n` +
    `${"━".repeat(30)}\n\n` +
    `🆘 *Buyruqlar:*\n` +
    `  /start — Bosh menyu\n` +
    `  /help — Yordam\n` +
    `  /myid — Telegram ID\n\n` +
    `❓ Savol va muammolar uchun adminga murojaat qiling.`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToMainInline(),
  });
}

// ============================================================
// ADMIN STATISTICS
// ============================================================
async function showAdminStats(chatId) {
  const db = loadDB();
  const totalTemplates = db.templates.length;
  const totalPurchases = db.purchases.length;
  const activeDeploys = db.purchases.filter((p) => p.deployed).length;
  const totalUsers = db.users ? db.users.length : 0;
  const totalRevenue = db.purchases.reduce(
    (sum, p) => sum + (p.amount || 0),
    0,
  );

  // Recent purchases (last 5)
  const recentPurchases = db.purchases.slice(-5).reverse();
  let recentText = "";
  for (const p of recentPurchases) {
    const date = new Date(p.date).toLocaleDateString("uz-UZ");
    const status = p.deployed ? "🟢" : "⚪";
    recentText += `  ${status} ${p.templateName} — User \`${p.userId}\` — ${date}\n`;
  }

  // PM2 processes
  let pm2Count = 0;
  try {
    const output = execSync("pm2 jlist", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const processes = JSON.parse(output);
    pm2Count = processes.filter((p) => p.name.startsWith("bot_")).length;
  } catch {}

  const text =
    `📊 *Admin Statistika*\n\n` +
    `${"━".repeat(30)}\n\n` +
    `📦 Shablonlar: *${totalTemplates}*\n` +
    `💰 Jami xaridlar: *${totalPurchases}*\n` +
    `🚀 Aktiv deploylar: *${activeDeploys}*\n` +
    `👥 Foydalanuvchilar: *${totalUsers}*\n` +
    `⭐ Jami daromad: *${totalRevenue} Stars*\n` +
    `🔧 PM2 botlar: *${pm2Count}*\n\n` +
    `${"━".repeat(30)}\n\n` +
    `📋 *So'nggi xaridlar:*\n${recentText || "  Xaridlar yo'q"}`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToAdminInline(),
  });
}

// ============================================================
// ADMIN USERS LIST
// ============================================================
async function showAdminUsers(chatId) {
  const db = loadDB();
  const users = db.users || [];

  if (users.length === 0) {
    return bot.sendMessage(
      chatId,
      "👥 *Foydalanuvchilar*\n\n📭 Hali foydalanuvchilar yo'q.",
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

  let text = `👥 *Foydalanuvchilar — ${users.length} ta*\n\n${"━".repeat(30)}\n\n`;

  // Show last 20 users
  const showUsers = users.slice(-20).reverse();
  for (let i = 0; i < showUsers.length; i++) {
    const u = showUsers[i];
    const purchases = db.purchases.filter((p) => p.userId === u.id);
    const deployed = purchases.filter((p) => p.deployed).length;
    const username = u.username ? `@${u.username}` : "—";
    const lastSeen = new Date(u.lastSeen).toLocaleDateString("uz-UZ");

    text +=
      `${i + 1}. *${u.firstName}* ${username}\n` +
      `   🆔 \`${u.id}\` | 🛒 ${purchases.length} xarid | 🚀 ${deployed} deploy\n` +
      `   📅 Oxirgi: ${lastSeen}\n\n`;
  }

  if (users.length > 20) {
    text += `\n... va yana ${users.length - 20} ta foydalanuvchi`;
  }

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...getBackToAdminInline(),
  });
}

// ============================================================
// ADMIN DEPLOYMENTS
// ============================================================
async function showAdminDeployments(chatId) {
  const db = loadDB();
  const activeDeploys = db.purchases.filter((p) => p.deployed);

  if (activeDeploys.length === 0) {
    return bot.sendMessage(
      chatId,
      "🗂️ *Deploymentlar*\n\n📭 Hozircha aktiv deploymentlar yo'q.",
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

  let text = `🗂️ *Aktiv deploymentlar — ${activeDeploys.length} ta*\n\n${"━".repeat(30)}\n\n`;

  for (const p of activeDeploys) {
    const processName = `bot_${p.userId}`;
    const pm2Info = getPm2Status(processName);
    const statusEmoji = pm2Info
      ? pm2Info.status === "online"
        ? "🟢"
        : "🔴"
      : "⚪";
    const statusText = pm2Info ? pm2Info.status : "noma'lum";

    text +=
      `${statusEmoji} *${p.templateName}*\n` +
      `  👤 User: \`${p.userId}\`\n` +
      `  🔧 Process: \`${processName}\` — ${statusText}\n\n`;
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

  // Track user
  trackUser(userId, msg.from.first_name, msg.from.username);

  // ── Menu buttons ──
  if (text === "🛒 Botlar katalogi") {
    clearState(userId);
    return showCatalog(chatId, userId);
  }

  if (text === "📦 Mening botlarim") {
    clearState(userId);
    return showMyBots(chatId, userId);
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
    return bot.sendMessage(
      chatId,
      `⚙️ *Admin Panel*\n\n👋 Xush kelibsiz, admin!\nQuyidagi tugmalardan birini tanlang:`,
      {
        parse_mode: "Markdown",
        ...getAdminKeyboard(),
      },
    );
  }

  // ── State-based handlers ──
  const state = getState(userId);
  if (!state) return;

  // Admin: template name
  if (state.step === "waiting_template_name" && isAdmin(userId)) {
    state.templateName = text;
    state.step = "waiting_template_price";
    setState(userId, state);
    return bot.sendMessage(
      chatId,
      "⭐ Shablon narxini kiriting (Stars soni):",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Bekor qilish", callback_data: "admin_cancel" }],
          ],
        },
      },
    );
  }

  // Admin: template price
  if (state.step === "waiting_template_price" && isAdmin(userId)) {
    const price = parseInt(text);
    if (isNaN(price) || price < 1) {
      return bot.sendMessage(
        chatId,
        "❌ Narx musbat son bo'lishi kerak! Qaytadan:",
      );
    }
    state.templatePrice = price;
    state.step = "waiting_template_zip";
    setState(userId, state);
    return bot.sendMessage(chatId, "📎 Endi ZIP faylni yuboring:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor qilish", callback_data: "admin_cancel" }],
        ],
      },
    });
  }

  // Admin: broadcast message
  if (state.step === "waiting_broadcast_message" && isAdmin(userId)) {
    clearState(userId);
    return executeBroadcast(chatId, userId, text);
  }

  // Admin: edit template name
  if (state.step === "waiting_edit_name" && isAdmin(userId)) {
    const db = loadDB();
    const tmpl = db.templates.find((t) => t.id === state.templateId);
    if (tmpl) {
      tmpl.name = text;
      saveDB(db);
      clearState(userId);
      return bot.sendMessage(
        chatId,
        `✅ Shablon nomi o'zgartirildi: *${text}*`,
        { parse_mode: "Markdown", ...getBackToAdminInline() },
      );
    }
    clearState(userId);
    return bot.sendMessage(chatId, "❌ Shablon topilmadi.");
  }

  // Admin: edit template price
  if (state.step === "waiting_edit_price" && isAdmin(userId)) {
    const price = parseInt(text);
    if (isNaN(price) || price < 1) {
      return bot.sendMessage(
        chatId,
        "❌ Narx musbat son bo'lishi kerak! Qaytadan:",
      );
    }
    const db = loadDB();
    const tmpl = db.templates.find((t) => t.id === state.templateId);
    if (tmpl) {
      tmpl.price = price;
      saveDB(db);
      clearState(userId);
      return bot.sendMessage(
        chatId,
        `✅ Shablon narxi o'zgartirildi: *${price} Stars*`,
        { parse_mode: "Markdown", ...getBackToAdminInline() },
      );
    }
    clearState(userId);
    return bot.sendMessage(chatId, "❌ Shablon topilmadi.");
  }

  // User: collecting placeholders
  if (state.step === "collecting_placeholders") {
    const currentPh = state.placeholders[state.currentIndex];
    const info = PLACEHOLDER_INFO[currentPh];

    if (info && !info.validate(text)) {
      return bot.sendMessage(chatId, info.error, { parse_mode: "Markdown" });
    }

    state.collectedValues[currentPh] = text.trim();
    state.currentIndex++;

    if (state.currentIndex < state.placeholders.length) {
      const nextPh = state.placeholders[state.currentIndex];
      const nextInfo = PLACEHOLDER_INFO[nextPh];
      const prompt = (
        nextInfo?.prompt || `"${nextPh}" qiymatini kiriting:`
      ).replace("{USER_ID}", String(userId));
      setState(userId, state);
      return bot.sendMessage(chatId, prompt, { parse_mode: "Markdown" });
    }

    clearState(userId);
    return executeDeploy(
      chatId,
      userId,
      state.templateId,
      state.collectedValues,
    );
  }
});

// ============================================================
// DOCUMENT HANDLER — Admin ZIP upload
// ============================================================
bot.on("message", async (msg) => {
  if (!msg.document) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isAdmin(userId)) return;

  const state = getState(userId);
  if (!state || state.step !== "waiting_template_zip") return;

  const doc = msg.document;
  if (!doc.file_name.endsWith(".zip")) {
    return bot.sendMessage(chatId, "❌ Faqat ZIP fayl yuboring!");
  }

  try {
    await bot.sendMessage(chatId, "📥 Fayl yuklanmoqda...");

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
      fileName: fileName,
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
      `✅ *Shablon qo'shildi!*\n\n` +
        `📦 Nomi: ${template.name}\n` +
        `⭐ Narxi: ${template.price} Stars\n` +
        `📎 Fayl: ${doc.file_name}\n` +
        `🆔 ID: \`${template.id}\`\n\n` +
        `📋 Topilgan placeholder'lar:\n${phList}`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  } catch (err) {
    console.error("Upload error:", err);
    bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
    clearState(userId);
  }
});

// ============================================================
// BROADCAST
// ============================================================
async function executeBroadcast(chatId, adminId, message) {
  const db = loadDB();
  const users = db.users || [];

  if (users.length === 0) {
    return bot.sendMessage(chatId, "📭 Foydalanuvchilar ro'yxati bo'sh.", {
      ...getBackToAdminInline(),
    });
  }

  const statusMsg = await bot.sendMessage(
    chatId,
    `📤 *Broadcast yuborilmoqda...*\n\n👥 Jami: ${users.length} ta foydalanuvchi`,
    { parse_mode: "Markdown" },
  );

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (user.id === adminId) continue; // Don't send to admin
    try {
      await bot.sendMessage(
        user.id,
        `📢 *Yangilik!*\n\n${message}`,
        { parse_mode: "Markdown" },
      );
      sent++;
    } catch {
      failed++;
    }

    // Rate limiting
    if ((sent + failed) % 25 === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  try {
    await bot.editMessageText(
      `✅ *Broadcast yakunlandi!*\n\n` +
        `📤 Yuborildi: *${sent}*\n` +
        `❌ Xato: *${failed}*\n` +
        `👥 Jami: *${users.length}*`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "Markdown",
      },
    );
  } catch {}
}

// ============================================================
// CALLBACK QUERY HANDLER
// ============================================================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  // ── Navigation ──
  if (data === "back_main") {
    clearState(userId);
    return bot.sendMessage(
      chatId,
      "🏠 *Asosiy menyu*\n\n👇 Tanlang:",
      { parse_mode: "Markdown", ...getMainKeyboard(userId) },
    );
  }

  if (data === "back_admin" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(
      chatId,
      `⚙️ *Admin Panel*\n\n👋 Tanlang:`,
      { parse_mode: "Markdown", ...getAdminKeyboard() },
    );
  }

  if (data === "go_catalog") {
    clearState(userId);
    return showCatalog(chatId, userId);
  }

  // ── Admin: Cancel ──
  if (data === "admin_cancel" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(chatId, "❌ Bekor qilindi.", {
      ...getBackToAdminInline(),
    });
  }

  // ── Admin: Add template ──
  if (data === "admin_add" && isAdmin(userId)) {
    setState(userId, { step: "waiting_template_name" });
    return bot.sendMessage(chatId, "📝 Shablon nomini kiriting:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor qilish", callback_data: "admin_cancel" }],
        ],
      },
    });
  }

  // ── Admin: List templates ──
  if (data === "admin_list" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0) {
      return bot.sendMessage(chatId, "📭 Shablonlar yo'q.", {
        ...getBackToAdminInline(),
      });
    }
    let text = `📋 *Shablonlar ro'yxati — ${db.templates.length} ta*\n\n${"━".repeat(30)}\n\n`;
    for (const t of db.templates) {
      const placeholders = scanTemplatePlaceholders(t.fileName);
      text +=
        `📦 *${t.name}*\n` +
        `   ⭐ ${t.price} Stars | 🆔 \`${t.id}\`\n` +
        `   📎 ${t.originalName}\n` +
        `   📋 Placeholders: ${placeholders.length}\n` +
        `   📅 ${new Date(t.createdAt).toLocaleDateString("uz-UZ")}\n\n`;
    }
    return bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...getBackToAdminInline(),
    });
  }

  // ── Admin: Delete template ──
  if (data === "admin_delete" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0) {
      return bot.sendMessage(chatId, "📭 O'chirish uchun shablon yo'q.", {
        ...getBackToAdminInline(),
      });
    }
    const buttons = db.templates.map((t) => [
      {
        text: `🗑️ ${t.name} — ⭐${t.price}`,
        callback_data: `confirm_delete_${t.id}`,
      },
    ]);
    buttons.push([
      { text: "🔙 Admin panel", callback_data: "back_admin" },
    ]);
    return bot.sendMessage(chatId, "🗑️ Qaysi shablonni o'chirmoqchisiz?", {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // ── Admin: Confirm delete ──
  if (data.startsWith("confirm_delete_") && isAdmin(userId)) {
    const templateId = data.replace("confirm_delete_", "");
    const db = loadDB();
    const idx = db.templates.findIndex((t) => t.id === templateId);
    if (idx === -1)
      return bot.sendMessage(chatId, "❌ Shablon topilmadi.", {
        ...getBackToAdminInline(),
      });

    const template = db.templates[idx];
    const filePath = path.join(TEMPLATES_DIR, template.fileName);
    if (fs.existsSync(filePath)) fs.removeSync(filePath);

    db.templates.splice(idx, 1);
    saveDB(db);

    return bot.sendMessage(
      chatId,
      `✅ *"${template.name}"* o'chirildi.`,
      { parse_mode: "Markdown", ...getBackToAdminInline() },
    );
  }

  // ── Admin: Edit template (choose which one) ──
  if (data === "admin_edit" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0) {
      return bot.sendMessage(chatId, "📭 Tahrirlash uchun shablon yo'q.", {
        ...getBackToAdminInline(),
      });
    }
    const buttons = db.templates.map((t) => [
      {
        text: `✏️ ${t.name} — ⭐${t.price}`,
        callback_data: `edit_tmpl_${t.id}`,
      },
    ]);
    buttons.push([
      { text: "🔙 Admin panel", callback_data: "back_admin" },
    ]);
    return bot.sendMessage(chatId, "✏️ Qaysi shablonni tahrirlash?", {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // ── Admin: Edit template options ──
  if (data.startsWith("edit_tmpl_") && isAdmin(userId)) {
    const templateId = data.replace("edit_tmpl_", "");
    const db = loadDB();
    const tmpl = db.templates.find((t) => t.id === templateId);
    if (!tmpl)
      return bot.sendMessage(chatId, "❌ Shablon topilmadi.", {
        ...getBackToAdminInline(),
      });

    return bot.sendMessage(
      chatId,
      `✏️ *${tmpl.name}* — nimani o'zgartirmoqchisiz?\n\n⭐ Hozirgi narx: ${tmpl.price} Stars`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📝 Nomini o'zgartirish",
                callback_data: `editname_${templateId}`,
              },
            ],
            [
              {
                text: "⭐ Narxini o'zgartirish",
                callback_data: `editprice_${templateId}`,
              },
            ],
            [{ text: "🔙 Admin panel", callback_data: "back_admin" }],
          ],
        },
      },
    );
  }

  // ── Admin: Edit name ──
  if (data.startsWith("editname_") && isAdmin(userId)) {
    const templateId = data.replace("editname_", "");
    setState(userId, { step: "waiting_edit_name", templateId });
    return bot.sendMessage(chatId, "📝 Yangi nomni kiriting:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor qilish", callback_data: "admin_cancel" }],
        ],
      },
    });
  }

  // ── Admin: Edit price ──
  if (data.startsWith("editprice_") && isAdmin(userId)) {
    const templateId = data.replace("editprice_", "");
    setState(userId, { step: "waiting_edit_price", templateId });
    return bot.sendMessage(chatId, "⭐ Yangi narxni kiriting (Stars soni):", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Bekor qilish", callback_data: "admin_cancel" }],
        ],
      },
    });
  }

  // ── Admin: Users ──
  if (data === "admin_users" && isAdmin(userId)) {
    return showAdminUsers(chatId);
  }

  // ── Admin: Stats ──
  if (data === "admin_stats" && isAdmin(userId)) {
    return showAdminStats(chatId);
  }

  // ── Admin: Broadcast ──
  if (data === "admin_broadcast" && isAdmin(userId)) {
    setState(userId, { step: "waiting_broadcast_message" });
    return bot.sendMessage(
      chatId,
      "📤 *Broadcast*\n\nBarcha foydalanuvchilarga yuboriladigan xabarni yozing:",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Bekor qilish", callback_data: "admin_cancel" }],
          ],
        },
      },
    );
  }

  // ── Admin: Restart main bot ──
  if (data === "admin_restart_bot" && isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      `⚠️ *Botni qayta yuklash*\n\nIshonchingiz komilmi?`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Ha, restart",
                callback_data: "confirm_restart_main",
              },
              { text: "❌ Yo'q", callback_data: "back_admin" },
            ],
          ],
        },
      },
    );
  }

  if (data === "confirm_restart_main" && isAdmin(userId)) {
    await bot.sendMessage(
      chatId,
      "🔄 Bot 3 soniyadan keyin qayta yuklanadi...",
    );
    setTimeout(() => {
      process.exit(0); // PM2 will restart
    }, 3000);
    return;
  }

  // ── Admin: Deployments ──
  if (data === "admin_deployments" && isAdmin(userId)) {
    return showAdminDeployments(chatId);
  }

  // ============================================================
  // BOT MANAGEMENT (User)
  // ============================================================

  // ── Bot Stop ──
  if (data.startsWith("bot_stop_")) {
    const purchaseId = data.replace("bot_stop_", "");
    const db = loadDB();
    const purchase = db.purchases.find(
      (p) => p.id === purchaseId && (p.userId === userId || isAdmin(userId)),
    );
    if (!purchase)
      return bot.sendMessage(chatId, "❌ Bot topilmadi.");

    const processName = `bot_${purchase.userId}`;
    const stopped = stopPm2Process(processName);

    if (stopped) {
      await bot.sendMessage(
        chatId,
        `🛑 *Bot to'xtatildi*\n\n🔧 Process: \`${processName}\``,
        { parse_mode: "Markdown" },
      );
    } else {
      await bot.sendMessage(chatId, "❌ Botni to'xtatishda xatolik.");
    }

    // Refresh bot list
    return showMyBots(chatId, userId);
  }

  // ── Bot Restart ──
  if (data.startsWith("bot_restart_")) {
    const purchaseId = data.replace("bot_restart_", "");
    const db = loadDB();
    const purchase = db.purchases.find(
      (p) => p.id === purchaseId && (p.userId === userId || isAdmin(userId)),
    );
    if (!purchase)
      return bot.sendMessage(chatId, "❌ Bot topilmadi.");

    const processName = `bot_${purchase.userId}`;
    const restarted = restartPm2Process(processName);

    if (restarted) {
      await bot.sendMessage(
        chatId,
        `🔄 *Bot qayta ishga tushirildi*\n\n🔧 Process: \`${processName}\``,
        { parse_mode: "Markdown" },
      );
    } else {
      await bot.sendMessage(chatId, "❌ Botni restart qilishda xatolik.");
    }

    // Refresh bot list
    return showMyBots(chatId, userId);
  }

  // ── Bot Logs ──
  if (data.startsWith("bot_logs_")) {
    const purchaseId = data.replace("bot_logs_", "");
    const db = loadDB();
    const purchase = db.purchases.find(
      (p) => p.id === purchaseId && (p.userId === userId || isAdmin(userId)),
    );
    if (!purchase)
      return bot.sendMessage(chatId, "❌ Bot topilmadi.");

    const processName = `bot_${purchase.userId}`;
    const logs = getPm2Logs(processName);

    await bot.sendMessage(
      chatId,
      `📋 *Loglar — ${processName}*\n\n\`\`\`\n${logs}\n\`\`\``,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🔄 Yangilash",
                callback_data: `bot_logs_${purchaseId}`,
              },
            ],
            [
              {
                text: "🔙 Botlarimga",
                callback_data: "go_mybots",
              },
            ],
          ],
        },
      },
    );
    return;
  }

  // ── Bot Refresh ──
  if (data.startsWith("bot_refresh_")) {
    return showMyBots(chatId, userId);
  }

  // ── Go to my bots ──
  if (data === "go_mybots") {
    return showMyBots(chatId, userId);
  }

  // ============================================================
  // BUY TEMPLATE — Admin bepul, User Telegram Stars
  // ============================================================
  if (data.startsWith("buy_")) {
    const templateId = data.replace("buy_", "");
    const db = loadDB();
    const template = db.templates.find((t) => t.id === templateId);

    if (!template) {
      return bot.sendMessage(chatId, "❌ Shablon topilmadi.");
    }

    // ✅ ADMIN — BEPUL DEPLOY
    if (isAdmin(userId)) {
      const purchase = {
        id: `purchase_${Date.now()}`,
        userId,
        templateId: template.id,
        templateName: template.name,
        fileName: template.fileName,
        amount: 0,
        date: new Date().toISOString(),
        deployed: false,
      };

      db.purchases.push(purchase);
      saveDB(db);

      await bot.sendMessage(
        chatId,
        `👑 *Admin — bepul deploy!*\n\n📦 Shablon: ${template.name}\n\nMa'lumotlarni so'raymiz...`,
        { parse_mode: "Markdown" },
      );

      return startPlaceholderCollection(chatId, userId, template, purchase.id);
    }

    // ✅ USER — TELEGRAM STARS TO'LOV
    try {
      await bot.sendInvoice(
        chatId,
        template.name,
        `"${template.name}" bot shablonini sotib olish va avtomatik deploy qilish.`,
        `${template.id}_${userId}_${Date.now()}`,
        "",
        "XTR",
        [{ label: template.name, amount: template.price }],
      );
    } catch (err) {
      console.error("Invoice error:", err);
      bot.sendMessage(chatId, `❌ To'lov xatoligi: ${err.message}`);
    }
  }

  // ── Undeploy ──
  if (data.startsWith("undeploy_")) {
    const purchaseId = data.replace("undeploy_", "");
    const db = loadDB();
    const purchase = db.purchases.find(
      (p) => p.id === purchaseId && (p.userId === userId || isAdmin(userId)),
    );

    if (!purchase)
      return bot.sendMessage(chatId, "❌ Xarid topilmadi.");

    // Confirmation
    return bot.sendMessage(
      chatId,
      `⚠️ *${purchase.templateName}* botini o'chirmoqchimisiz?\n\nBu qaytarib bo'lmaydi!`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Ha, o'chirish",
                callback_data: `confirm_undeploy_${purchaseId}`,
              },
              {
                text: "❌ Yo'q",
                callback_data: "go_mybots",
              },
            ],
          ],
        },
      },
    );
  }

  // ── Confirm undeploy ──
  if (data.startsWith("confirm_undeploy_")) {
    const purchaseId = data.replace("confirm_undeploy_", "");
    const db = loadDB();
    const purchase = db.purchases.find(
      (p) => p.id === purchaseId && (p.userId === userId || isAdmin(userId)),
    );

    if (!purchase) return bot.sendMessage(chatId, "❌ Xarid topilmadi.");

    try {
      await bot.sendMessage(chatId, "🛑 Bot to'xtatilmoqda...");
      const result = await undeploy(purchase.userId);
      purchase.deployed = false;
      saveDB(db);

      await bot.sendMessage(
        chatId,
        `✅ *Bot to'xtatildi va o'chirildi*\n\n🆔 Process: \`${result.processName}\``,
        { parse_mode: "Markdown", ...getBackToMainInline() },
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
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
    console.error("Pre-checkout error:", err);
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
  const payload = payment.invoice_payload;

  const templateId = payload.split("_").slice(0, 2).join("_");
  const db = loadDB();
  const template = db.templates.find((t) => t.id === templateId);

  if (!template) {
    return bot.sendMessage(
      chatId,
      "❌ Shablon topilmadi. Adminga murojaat qiling.",
    );
  }

  const purchase = {
    id: `purchase_${Date.now()}`,
    userId,
    templateId: template.id,
    templateName: template.name,
    fileName: template.fileName,
    amount: payment.total_amount,
    date: new Date().toISOString(),
    deployed: false,
  };
  db.purchases.push(purchase);
  saveDB(db);

  await bot.sendMessage(
    chatId,
    `✅ *To'lov muvaffaqiyatli!*\n\n📦 Shablon: ${template.name}\n⭐ To'langan: ${payment.total_amount} Stars\n\nMa'lumotlarni so'raymiz...`,
    { parse_mode: "Markdown" },
  );

  // Notify admin
  bot
    .sendMessage(
      ADMIN_ID,
      `💰 *Yangi xarid!*\n\n👤 User: [${msg.from.first_name}](tg://user?id=${userId})\n🆔 ID: \`${userId}\`\n📦 Shablon: ${template.name}\n⭐ Summa: ${payment.total_amount} Stars`,
      { parse_mode: "Markdown" },
    )
    .catch(() => {});

  await startPlaceholderCollection(chatId, userId, template, purchase.id);
});

// ============================================================
// DEPLOY EXECUTION
// ============================================================
async function executeDeploy(chatId, userId, templateId, replacements) {
  const db = loadDB();
  const template = db.templates.find((t) => t.id === templateId);
  if (!template) return bot.sendMessage(chatId, "❌ Shablon topilmadi.");

  const statusMsg = await bot.sendMessage(
    chatId,
    `⏳ *Bot deploy qilinmoqda...*\n\n` +
      `📦 Shablon: ${template.name}\n` +
      `📂 ZIP ochilmoqda...\n\n` +
      `${"▓".repeat(3)}${"░".repeat(17)} 15%`,
    { parse_mode: "Markdown" },
  );

  try {
    const updateStatus = async (text) => {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "Markdown",
        });
      } catch {}
    };

    await updateStatus(
      `⏳ *Bot deploy qilinmoqda...*\n\n` +
        `📦 Shablon: ${template.name}\n` +
        `🔄 Placeholder'lar almashtirilmoqda...\n\n` +
        `${"▓".repeat(8)}${"░".repeat(12)} 40%`,
    );

    const result = await deploy(template.fileName, userId, replacements);

    await updateStatus(
      `⏳ *Bot deploy qilinmoqda...*\n\n` +
        `📦 Shablon: ${template.name}\n` +
        `🟢 Bot ishga tushirilmoqda...\n\n` +
        `${"▓".repeat(16)}${"░".repeat(4)} 80%`,
    );

    const purchase = db.purchases.find(
      (p) => p.userId === userId && p.templateId === templateId && !p.deployed,
    );
    if (purchase) {
      purchase.deployed = true;
      purchase.processName = result.processName;
      purchase.deployDir = result.deployDir;
      saveDB(db);
    }

    const phSummary = Object.entries(replacements)
      .map(([key, val]) => {
        const info = PLACEHOLDER_INFO[key];
        const label = info?.label || key;
        const masked =
          key.includes("TOKEN") || key.includes("KEY")
            ? val.substring(0, 8) + "..." + val.substring(val.length - 4)
            : val;
        return `  ${label}: \`${masked}\``;
      })
      .join("\n");

    await updateStatus(
      `✅ *Bot muvaffaqiyatli deploy qilindi!*\n\n` +
        `${"━".repeat(28)}\n\n` +
        `📦 Shablon: ${template.name}\n` +
        `🔧 Process: \`${result.processName}\`\n` +
        `📁 Papka: \`deployments/${userId}/\`\n` +
        `📄 Main: \`${result.mainFile}\`\n` +
        `🟢 Status: *Running*\n\n` +
        `${"━".repeat(28)}\n\n` +
        `📋 *Kiritilgan ma'lumotlar:*\n${phSummary}\n\n` +
        `${"▓".repeat(20)} 100% ✅\n\n` +
        `🎉 *Botingiz ishga tushdi!*`,
    );

    bot
      .sendMessage(
        ADMIN_ID,
        `🚀 *Bot deploy qilindi!*\n\n👤 User: \`${userId}\`\n📦 Shablon: ${template.name}\n🔧 Process: \`${result.processName}\`\n🟢 Status: Running`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
  } catch (err) {
    console.error("Deploy error:", err);
    try {
      await bot.editMessageText(
        `❌ *Deploy xatoligi!*\n\n` +
          `👤 User: \`${userId}\`\n` +
          `📦 Shablon: ${template.name}\n` +
          `🔴 Xatolik: \`${err.message}\`\n\n` +
          `Adminga murojaat qiling.`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "Markdown",
        },
      );
    } catch {
      bot.sendMessage(chatId, `❌ Deploy xatoligi: ${err.message}`);
    }

    bot
      .sendMessage(
        ADMIN_ID,
        `❌ *Deploy xatoligi!*\n\n👤 User: \`${userId}\`\n📦 Shablon: ${template.name}\n🔴 Xatolik: \`${err.message}\``,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
  }
}

// ============================================================
// ERROR HANDLING
// ============================================================
bot.on("polling_error", (err) => console.error("Polling error:", err.message));
process.on("unhandledRejection", (err) =>
  console.error("Unhandled rejection:", err),
);
process.on("uncaughtException", (err) =>
  console.error("Uncaught exception:", err),
);

console.log(`👑 Admin ID: ${ADMIN_ID}`);
console.log("📁 Templates:", TEMPLATES_DIR);
console.log("📁 Deployments:", DEPLOYMENTS_DIR);
console.log("✅ Bot is ready!");
