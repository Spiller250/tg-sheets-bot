'use strict';
// Google Sheets storage. The API client is injected, so tests use a fake one.

const HEADER = ['Дата и время', 'Telegram ID', 'Username', 'Имя', 'Контакт', 'Задача', 'Статус'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err) {
  const code = err && (err.code || (err.response && err.response.status));
  return code === 429 || (typeof code === 'number' && code >= 500) || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code);
}

async function withRetry(fn, { attempts = 3, baseMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr;
}

function createSheetsStore({ client, spreadsheetId, sheetName = 'Заявки', retry }) {
  const range = (a1) => `'${sheetName.replace(/'/g, "''")}'!${a1}`;

  async function ensureHeader() {
    const res = await withRetry(() => client.spreadsheets.values.get({ spreadsheetId, range: range('A1:G1') }), retry);
    const first = (res.data.values && res.data.values[0]) || [];
    if (first.length === 0) {
      await withRetry(() => client.spreadsheets.values.update({
        spreadsheetId, range: range('A1:G1'), valueInputOption: 'RAW', requestBody: { values: [HEADER] },
      }), retry);
    }
  }

  async function append(row) {
    const res = await withRetry(() => client.spreadsheets.values.append({
      spreadsheetId, range: range('A:G'), valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    }), retry);
    const updated = res.data.updates && res.data.updates.updatedRange; // e.g. 'Заявки'!A12:G12
    const m = updated && updated.match(/!A(\d+)/);
    return { rowNumber: m ? Number(m[1]) : null };
  }

  async function recent(limit = 5) {
    const res = await withRetry(() => client.spreadsheets.values.get({ spreadsheetId, range: range('A2:G') }), retry);
    const rows = res.data.values || [];
    return { total: rows.length, last: rows.slice(-limit).reverse() };
  }

  return { ensureHeader, append, recent };
}

function googleClientFromKeyFile(keyFile) {
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

module.exports = { HEADER, createSheetsStore, googleClientFromKeyFile, withRetry, isRetryable };
