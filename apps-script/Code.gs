// Google Apps Script for tg-sheets-bot.
// Paste into the sheet's script editor (Extensions → Apps Script) and deploy as a Web app.
// The bot sends rows here instead of using a Google Cloud service account.

const SECRET = 'ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТ'; // the same value as APPS_SCRIPT_SECRET in the bot's .env
const SHEET_NAME = 'Заявки';
const HEADER = ['Дата и время', 'Telegram ID', 'Username', 'Имя', 'Контакт', 'Задача', 'Статус'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADER);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Add one row: POST {"secret": "...", "row": [...]}
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return json_({ ok: false, error: 'forbidden' });
    if (!Array.isArray(body.row)) return json_({ ok: false, error: 'row must be an array' });
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sh = sheet_();
      sh.appendRow(body.row.slice(0, HEADER.length).map(String));
      return json_({ ok: true, rowNumber: sh.getLastRow() });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Report: GET ?secret=...&limit=5 → total and the latest rows
function doGet(e) {
  if ((e.parameter.secret || '') !== SECRET) return json_({ ok: false, error: 'forbidden' });
  const sh = sheet_();
  const lastRow = sh.getLastRow();
  const total = Math.max(0, lastRow - 1);
  const limit = Math.min(Number(e.parameter.limit) || 5, 50);
  if (!total) return json_({ ok: true, total: 0, last: [] });
  const first = Math.max(2, lastRow - limit + 1);
  const rows = sh.getRange(first, 1, lastRow - first + 1, HEADER.length).getDisplayValues().reverse();
  return json_({ ok: true, total: total, last: rows });
}
