const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { execSync } = require('child_process');

const DEPLOYMENTS_DIR = path.join(__dirname, 'deployments');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.ogg', '.webm',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.node', '.lock'
]);

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return false;
  if (filePath.includes('node_modules')) return false;
  try {
    const buffer = fs.readFileSync(filePath);
    const sample = buffer.slice(0, 8192);
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return false;
    }
    return true;
  } catch { return false; }
}

function getAllFiles(dirPath, filesList = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      getAllFiles(fullPath, filesList);
    } else {
      filesList.push(fullPath);
    }
  }
  return filesList;
}

function replacePlaceholders(deployDir, replacements) {
  console.log(`🔍 Scanning files in: ${deployDir}`);
  const files = getAllFiles(deployDir);
  let replacedCount = 0;

  for (const filePath of files) {
    if (!isTextFile(filePath)) continue;
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      let changed = false;

      for (const [placeholder, value] of Object.entries(replacements)) {
        if (content.includes(placeholder)) {
          console.log(`  📝 Replacing "${placeholder}" in: ${path.relative(deployDir, filePath)}`);
          content = content.split(placeholder).join(value);
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(filePath, content, 'utf8');
        replacedCount++;
      }
    } catch (err) {
      console.warn(`  ⚠️ Could not process: ${filePath} — ${err.message}`);
    }
  }

  console.log(`✅ Replaced placeholders in ${replacedCount} file(s)`);
  return replacedCount;
}

function detectMainFile(deployDir) {
  const pkgPath = path.join(deployDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.main && fs.existsSync(path.join(deployDir, pkg.main))) return pkg.main;
    } catch {}
  }
  const fallbacks = ['index.js', 'bot.js', 'app.js', 'server.js', 'main.js'];
  for (const f of fallbacks) {
    if (fs.existsSync(path.join(deployDir, f))) return f;
  }
  return 'index.js';
}

function scanTemplatePlaceholders(templateFileName) {
  const zipPath = path.join(TEMPLATES_DIR, templateFileName);
  if (!fs.existsSync(zipPath)) return [];

  const KNOWN_PLACEHOLDERS = [
    'YOUR_BOT_TOKEN_HERE', 'YOUR_TELEGRAM_ID', 'YOUR_ADMIN_ID',
    'YOUR_API_KEY', 'YOUR_DATABASE_URL', 'YOUR_WEBHOOK_URL',
    'YOUR_CHANNEL_ID', 'YOUR_GROUP_ID', 'YOUR_PAYMENT_TOKEN'
  ];

  const found = new Set();
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const ext = path.extname(entry.entryName).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      try {
        const content = entry.getData().toString('utf8');
        for (const ph of KNOWN_PLACEHOLDERS) {
          if (content.includes(ph)) found.add(ph);
        }
      } catch {}
    }
  } catch (err) {
    console.error(`Error scanning template: ${err.message}`);
  }
  return Array.from(found);
}

async function deploy(templateFileName, userId, replacements = {}) {
  const zipPath = path.join(TEMPLATES_DIR, templateFileName);
  const deployDir = path.join(DEPLOYMENTS_DIR, String(userId));
  const processName = `bot_${userId}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 DEPLOYING for user ${userId}`);
  console.log(`   Template: ${templateFileName}`);
  console.log(`${'='.repeat(60)}`);

  // Stop existing
  try { execSync(`pm2 delete ${processName}`, { stdio: 'ignore' }); console.log(`🛑 Stopped: ${processName}`); } catch {}

  // Validate ZIP
  if (!fs.existsSync(zipPath)) throw new Error(`Template not found: ${templateFileName}`);

  // Clean deploy folder
  if (fs.existsSync(deployDir)) {
    console.log('🗑️ Removing old deployment...');
    fs.removeSync(deployDir);
  }
  fs.ensureDirSync(deployDir);
  console.log(`📁 Created: ${deployDir}`);

  // Extract
  try {
    console.log('📦 Extracting ZIP...');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(deployDir, true);

    // Unwrap single root folder
    const items = fs.readdirSync(deployDir);
    if (items.length === 1) {
      const singleItem = path.join(deployDir, items[0]);
      if (fs.statSync(singleItem).isDirectory()) {
        console.log('📂 Unwrapping single root folder...');
        const innerItems = fs.readdirSync(singleItem);
        for (const item of innerItems) {
          fs.moveSync(path.join(singleItem, item), path.join(deployDir, item), { overwrite: true });
        }
        fs.removeSync(singleItem);
      }
    }
    console.log('✅ Extraction complete');
  } catch (err) {
    throw new Error(`Failed to extract ZIP: ${err.message}`);
  }

  // Replace placeholders
  console.log('🔄 Replacing placeholders...');
  replacePlaceholders(deployDir, replacements);

  // npm install
  const pkgPath = path.join(deployDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      console.log('📥 Running npm install...');
      execSync('npm install --production', { cwd: deployDir, stdio: 'pipe', timeout: 120000 });
      console.log('✅ npm install complete');
    } catch (err) {
      const stderr = (err.stderr && err.stderr.toString().trim()) ? err.stderr.toString().slice(0, 500) : err.message;
      throw new Error(`npm install failed:\n${stderr}`);
    }
  } else {
    console.log('⚠️ No package.json — skipping npm install');
  }

  // PM2 start
  const mainFile = detectMainFile(deployDir);
  try {
    console.log(`🟢 Starting PM2: ${processName} → ${mainFile}`);
    execSync(`pm2 start ${mainFile} --name ${processName}`, { cwd: deployDir, stdio: 'pipe', timeout: 45000 });
    try { execSync('pm2 save', { stdio: 'ignore' }); } catch {}
    console.log(`✅ Bot deployed as "${processName}"`);
  } catch (err) {
    const stderr = (err.stderr && err.stderr.toString().trim()) ? err.stderr.toString().slice(0, 500) : err.message;
    throw new Error(`PM2 start failed:\n${stderr}`);
  }

  return { success: true, processName, deployDir, mainFile, userId };
}

async function undeploy(userId) {
  const processName = `bot_${userId}`;
  const deployDir = path.join(DEPLOYMENTS_DIR, String(userId));
  try { execSync(`pm2 delete ${processName}`, { stdio: 'ignore' }); } catch {}
  if (fs.existsSync(deployDir)) fs.removeSync(deployDir);
  try { execSync('pm2 save', { stdio: 'ignore' }); } catch {}
  return { success: true, processName };
}

module.exports = { deploy, undeploy, scanTemplatePlaceholders, TEMPLATES_DIR, DEPLOYMENTS_DIR };