const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
// true when started as `node server.js` (not when imported by tests or scripts)
const IS_MAIN = Boolean(require.main) && path.basename(require.main.filename) === 'server.js';
const PORT = process.env.PORT || 3000;
const SECURE = process.env.COOKIE_SECURE === '1';
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Example: postgresql://user:pass@host/dbname?sslmode=require');
  if (IS_MAIN) process.exit(1);
}
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'mohammed';

module.exports = { PORT, SECURE, ADMIN_USERNAME, ROOT, IS_MAIN };
