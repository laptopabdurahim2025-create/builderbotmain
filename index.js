require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs-extra");
const path = require("path");
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
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    const fresh = { templates: [], purchases: [], pending: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
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
// HELPERS
// ============================================================
function isAdmin(userId) {
  return userId === ADMIN_ID;
}

function getMainKeyboard(userId) {
  const keyboard = [
    [{ text: "🛒 Botlar katalogi" }],
    [{ text: "📦 Mening botlarim" }],
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
        [{ text: "➕ Yangi shablon qo'shish", callback_data: "admin_add" }],
        [{ text: "📋 Shablonlar ro'yxati", callback_data: "admin_list" }],
        [{ text: "🗑️ Shablon o'chirish", callback_data: "admin_delete" }],
      ],
    },
  };
}

// ============================================================
// Placeholder collection start helper
// ============================================================
async function startPlaceholderCollection(
  chatId,
  userId,
  template,
  purchaseId,
) {
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
  bot.sendMessage(
    userId,
    `🤖 *Telegram Bot Builder* ga xush kelibsiz!\n\n` +
      `Bu bot orqali tayyor bot shablonlarini sotib oling va avtomatik deploy qiling.\n\n` +
      `⭐ To'lov Telegram Stars orqali.`,
    { parse_mode: "Markdown", ...getMainKeyboard(userId) },
  );
});

// ============================================================
// CATALOG
// ============================================================
async function showCatalog(chatId, userId) {
  const db = loadDB();
  if (db.templates.length === 0) {
    return bot.sendMessage(chatId, "📭 Hozircha shablonlar mavjud emas.");
  }

  for (const tmpl of db.templates) {
    const placeholders = scanTemplatePlaceholders(tmpl.fileName);
    const phList =
      placeholders.length > 0
        ? placeholders.map((p) => PLACEHOLDER_INFO[p]?.label || p).join(", ")
        : "Faqat token";

    const text =
      `📦 *${tmpl.name}*\n\n` +
      `⭐ Narxi: ${tmpl.price} Stars\n` +
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
    return bot.sendMessage(chatId, "📭 Sizda deploy qilingan botlar yo'q.");
  }

  for (const purchase of myPurchases) {
    const text =
      `🤖 *${purchase.templateName}*\n\n` +
      `📁 Process: \`bot_${userId}\`\n` +
      `📅 Sana: ${purchase.date}\n` +
      `✅ Status: Deployed`;

    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🛑 To'xtatish va o'chirish",
              callback_data: `undeploy_${purchase.id}`,
            },
          ],
        ],
      },
    });
  }
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

  // Menu buttons
  if (text === "🛒 Botlar katalogi") {
    clearState(userId);
    return showCatalog(chatId, userId);
  }

  if (text === "📦 Mening botlarim") {
    clearState(userId);
    return showMyBots(chatId, userId);
  }

  if (text === "⚙️ Admin panel" && isAdmin(userId)) {
    clearState(userId);
    return bot.sendMessage(chatId, "⚙️ *Admin Panel*", {
      parse_mode: "Markdown",
      ...getAdminKeyboard(),
    });
  }

  // State-based
  const state = getState(userId);
  if (!state) return;

  // Admin: template name
  if (state.step === "waiting_template_name" && isAdmin(userId)) {
    state.templateName = text;
    state.step = "waiting_template_price";
    setState(userId, state);
    return bot.sendMessage(chatId, "⭐ Shablon narxini kiriting (Stars soni):");
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
    return bot.sendMessage(chatId, "📎 Endi ZIP faylni yuboring:");
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
      { parse_mode: "Markdown", ...getAdminKeyboard() },
    );
  } catch (err) {
    console.error("Upload error:", err);
    bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`);
    clearState(userId);
  }
});

// ============================================================
// CALLBACK QUERY HANDLER
// ============================================================
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  // Admin: Add template
  if (data === "admin_add" && isAdmin(userId)) {
    setState(userId, { step: "waiting_template_name" });
    return bot.sendMessage(chatId, "📝 Shablon nomini kiriting:");
  }

  // Admin: List templates
  if (data === "admin_list" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0) {
      return bot.sendMessage(chatId, "📭 Shablonlar yo'q.");
    }
    let text = "📋 *Shablonlar ro'yxati:*\n\n";
    for (const t of db.templates) {
      text += `📦 *${t.name}*\n   ⭐ ${t.price} Stars | 🆔 \`${t.id}\`\n   📎 ${t.originalName}\n\n`;
    }
    return bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  // Admin: Delete template
  if (data === "admin_delete" && isAdmin(userId)) {
    const db = loadDB();
    if (db.templates.length === 0) {
      return bot.sendMessage(chatId, "📭 O'chirish uchun shablon yo'q.");
    }
    const buttons = db.templates.map((t) => [
      {
        text: `🗑️ ${t.name}`,
        callback_data: `confirm_delete_${t.id}`,
      },
    ]);
    return bot.sendMessage(chatId, "🗑️ Qaysi shablonni o'chirmoqchisiz?", {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // Admin: Confirm delete
  if (data.startsWith("confirm_delete_") && isAdmin(userId)) {
    const templateId = data.replace("confirm_delete_", "");
    const db = loadDB();
    const idx = db.templates.findIndex((t) => t.id === templateId);
    if (idx === -1) return bot.sendMessage(chatId, "❌ Shablon topilmadi.");

    const template = db.templates[idx];
    const filePath = path.join(TEMPLATES_DIR, template.fileName);
    if (fs.existsSync(filePath)) fs.removeSync(filePath);

    db.templates.splice(idx, 1);
    saveDB(db);

    return bot.sendMessage(chatId, `✅ *"${template.name}"* o'chirildi.`, {
      parse_mode: "Markdown",
      ...getAdminKeyboard(),
    });
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

  // Undeploy
  if (data.startsWith("undeploy_")) {
    const purchaseId = data.replace("undeploy_", "");
    const db = loadDB();
    const purchase = db.purchases.find(
      (p) => p.id === purchaseId && p.userId === userId,
    );

    if (!purchase) return bot.sendMessage(chatId, "❌ Xarid topilmadi.");

    try {
      await bot.sendMessage(chatId, "🛑 Bot to'xtatilmoqda...");
      const result = await undeploy(userId);
      purchase.deployed = false;
      saveDB(db);

      await bot.sendMessage(
        chatId,
        `✅ *Bot to'xtatildi va o'chirildi*\n\n🆔 Process: \`${result.processName}\``,
        { parse_mode: "Markdown" },
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
    `⏳ *Bot deploy qilinmoqda...*\n\n📦 Shablon: ${template.name}\n📂 ZIP ochilmoqda...`,
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
      `⏳ *Bot deploy qilinmoqda...*\n\n📦 Shablon: ${template.name}\n🔄 Placeholder'lar almashtirilmoqda...`,
    );

    const result = await deploy(template.fileName, userId, replacements);

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
        `📦 Shablon: ${template.name}\n` +
        `🔧 Process: \`${result.processName}\`\n` +
        `📁 Papka: \`deployments/${userId}/\`\n` +
        `📄 Main: \`${result.mainFile}\`\n` +
        `🟢 Status: Running\n\n` +
        `📋 Kiritilgan ma'lumotlar:\n${phSummary}\n\n` +
        `🎉 Botingiz ishga tushdi!`,
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
        `❌ *Deploy xatoligi!*\n\n📦 Shablon: ${template.name}\n🔴 Xatolik: \`${err.message}\`\n\nAdminga murojaat qiling.`,
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
