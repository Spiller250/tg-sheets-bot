'use strict';
const fs = require('fs');
const path = require('path');
const { createBot } = require('./src/bot');
const { createSheetsStore, googleClientFromKeyFile } = require('./src/sheets');
const { createQueue } = require('./src/queue');
const { createAppsScriptStore } = require('./src/appsScript');

// Minimal .env loader (no extra dependency)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const useAppsScript = Boolean(process.env.APPS_SCRIPT_URL);
const need = useAppsScript ? ['BOT_TOKEN', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_SECRET'] : ['BOT_TOKEN', 'SPREADSHEET_ID', 'GOOGLE_KEY_FILE'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Заполните в .env: ${missing.join(', ')}. Пример в .env.example.`);
  process.exit(1);
}

async function main() {
  const store = useAppsScript
    ? createAppsScriptStore({ url: process.env.APPS_SCRIPT_URL, secret: process.env.APPS_SCRIPT_SECRET })
    : createSheetsStore({
      client: googleClientFromKeyFile(path.resolve(__dirname, process.env.GOOGLE_KEY_FILE)),
      spreadsheetId: process.env.SPREADSHEET_ID,
      sheetName: process.env.SHEET_NAME || 'Заявки',
    });
  console.log('Хранилище:', useAppsScript ? 'Google Apps Script' : 'Google Sheets API (сервисный аккаунт)');
  await store.ensureHeader();
  const queue = createQueue(path.join(__dirname, 'pending.jsonl'));
  const { bot } = createBot({
    token: process.env.BOT_TOKEN, store, queue,
    adminChatId: process.env.ADMIN_CHAT_ID, timeZone: process.env.TIME_ZONE || 'Asia/Almaty',
  });

  // Re-send anything that failed earlier, every minute.
  setInterval(async () => {
    if (!queue.size()) return;
    const r = await queue.flush((row) => store.append(row));
    if (r.sent) console.log(`Отправлено из очереди: ${r.sent}, осталось: ${r.left}`);
  }, 60_000);

  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать' },
    { command: 'cancel', description: 'Отменить заявку' },
    { command: 'report', description: 'Отчёт (для администратора)' },
  ]);
  console.log('Бот запущен. Остановить: Ctrl+C');
  bot.start();
}

main().catch((err) => { console.error('Не удалось запустить:', err.message); process.exit(1); });
