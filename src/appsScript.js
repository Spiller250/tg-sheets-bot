'use strict';
// Storage through a Google Apps Script web app (apps-script/Code.gs).
// No Google Cloud project or service account key needed: the script runs
// inside the spreadsheet and the bot calls it over HTTPS with a shared secret.
const { withRetry } = require('./sheets');

function createAppsScriptStore({ url, secret, fetchImpl = globalThis.fetch, retry, timeoutMs = 15000 }) {
  async function call(method, body, query = '') {
    let res;
    try {
      res = await fetchImpl(url + query, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        redirect: 'follow', // Apps Script answers through a redirect to googleusercontent.com
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = new Error('Apps Script недоступен: ' + err.message); e.code = 'ECONNRESET'; throw e;
    }
    if (!res.ok) { const e = new Error(`Apps Script ответил HTTP ${res.status}`); e.code = res.status; throw e; }
    let data;
    try { data = JSON.parse(await res.text()); } catch {
      const e = new Error('Apps Script вернул не JSON. Проверьте, что веб-приложение развёрнуто с доступом «Все».'); e.code = 400; throw e;
    }
    if (!data.ok) { const e = new Error('Apps Script: ' + data.error); e.code = data.error === 'forbidden' ? 403 : 400; throw e; }
    return data;
  }

  return {
    async ensureHeader() { /* the script writes the header itself */ },
    async append(row) {
      const data = await withRetry(() => call('POST', { secret, row }), retry);
      return { rowNumber: data.rowNumber ?? null };
    },
    async recent(limit = 5) {
      const q = `?secret=${encodeURIComponent(secret)}&limit=${limit}`;
      const data = await withRetry(() => call('GET', null, q), retry);
      return { total: data.total, last: data.last };
    },
  };
}

module.exports = { createAppsScriptStore };
