'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const flow = require('../src/flow');
const { createSheetsStore, withRetry } = require('../src/sheets');
const { createQueue } = require('../src/queue');
const { createBot } = require('../src/bot');

test('validation accepts phone, email, @username and rejects junk', () => {
  for (const ok of ['+7 701 123-45-67', 'name@mail.kz', '@bogdan_dev']) assert.equal(flow.validate('contact', ok).ok, true, ok);
  for (const bad of ['123', 'hello', '@ab', 'a@b']) assert.equal(flow.validate('contact', bad).ok, false, bad);
  assert.equal(flow.validate('name', 'Я').ok, false);
  assert.equal(flow.validate('request', 'x'.repeat(1001)).ok, false);
});

test('conversation goes name → contact → request → confirm, and can restart', () => {
  let r = flow.answer(flow.start(), 'Алия');
  assert.equal(r.state.step, 'contact');
  r = flow.answer(r.state, 'не номер');
  assert.equal(r.state.step, 'contact', 'stays on the step after a bad answer');
  r = flow.answer(r.state, '+77011234567');
  r = flow.answer(r.state, 'Нужен лендинг для кофейни');
  assert.equal(r.state.step, 'confirm');
  assert.match(r.reply, /Алия/);
  const again = flow.answer(r.state, 'Заново');
  assert.equal(again.state.step, 'name');
  const done = flow.answer(r.state, 'Отправить');
  assert.equal(done.done, true);
  assert.deepEqual(done.data, { name: 'Алия', contact: '+77011234567', request: 'Нужен лендинг для кофейни' });
});

test('rows are formula-safe and time-stamped in the configured time zone', () => {
  assert.equal(flow.safeCell('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(flow.safeCell('+7701'), "'+7701");
  const row = flow.toRow({ name: 'A', contact: '@user_one', request: 'test' }, { id: 42, username: 'u' }, new Date('2026-10-13T10:00:00Z'), 'Asia/Almaty');
  assert.equal(row[0], '2026-10-13 15:00:00');
  assert.equal(row[4], "'@user_one", 'contacts starting with @ are escaped too');
  assert.equal(row[6], 'новая');
});

function fakeSheets({ failTimes = 0, code = 503 } = {}) {
  const calls = []; let fails = failTimes; const rows = [];
  const values = {
    async get({ range }) { calls.push(['get', range]); return { data: { values: range.endsWith('A1:G1') ? [] : rows } }; },
    async update(a) { calls.push(['update', a.range, a.requestBody.values[0].length]); return { data: {} }; },
    async append(a) {
      calls.push(['append', a.range]);
      if (fails-- > 0) { const e = new Error('unavailable'); e.code = code; throw e; }
      rows.push(a.requestBody.values[0]);
      return { data: { updates: { updatedRange: `'Заявки'!A${rows.length + 1}:G${rows.length + 1}` } } };
    },
  };
  return { client: { spreadsheets: { values } }, calls, rows };
}

test('sheets store writes a header once, appends rows and reports the row number', async () => {
  const f = fakeSheets();
  const store = createSheetsStore({ client: f.client, spreadsheetId: 'id', retry: { baseMs: 1 } });
  await store.ensureHeader();
  assert.deepEqual(f.calls[1], ['update', "'Заявки'!A1:G1", 7]);
  const r = await store.append(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(r.rowNumber, 2);
  const { total, last } = await store.recent(5);
  assert.equal(total, 1); assert.equal(last[0][0], 'a');
});

test('temporary Google errors are retried; permanent ones are not', async () => {
  const f = fakeSheets({ failTimes: 2, code: 503 });
  const store = createSheetsStore({ client: f.client, spreadsheetId: 'id', retry: { baseMs: 1 } });
  await store.append(['x']);
  assert.equal(f.calls.filter((c) => c[0] === 'append').length, 3);
  let n = 0;
  await assert.rejects(() => withRetry(async () => { n++; const e = new Error('forbidden'); e.code = 403; throw e; }, { baseMs: 1 }));
  assert.equal(n, 1, '403 (no access to the sheet) is not retried');
});

test('queue keeps rows that fail and sends them later', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'q-')), 'pending.jsonl');
  const q = createQueue(file);
  q.push(['r1']); q.push(['r2']);
  let ok = false;
  const send = async (row) => { if (!ok && row[0] === 'r2') throw new Error('down'); };
  assert.deepEqual(await q.flush(send), { sent: 1, left: 1 });
  ok = true;
  assert.deepEqual(await q.flush(send), { sent: 1, left: 0 });
  assert.equal(q.size(), 0);
});

// End-to-end through grammY with Telegram's API replaced by a recorder (no network).
function harness({ storeFails = false } = {}) {
  const sent = []; const appended = []; const queued = [];
  const store = {
    async append(row) { if (storeFails) throw new Error('Sheets down'); appended.push(row); return { rowNumber: appended.length + 1 }; },
    async recent() { return { total: appended.length, last: appended.slice().reverse() }; },
  };
  const queue = { push: (r) => queued.push(r), size: () => queued.length };
  const { bot } = createBot({
    token: '123:TEST', store, queue, adminChatId: 999, timeZone: 'Asia/Almaty',
    botOptions: { botInfo: { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } },
  });
  bot.api.config.use(async (prev, method, payload) => { sent.push({ method, chat: payload.chat_id, text: payload.text }); return { ok: true, result: true }; });
  let id = 0;
  const say = (text, chatId = 7, extra = {}) => bot.handleUpdate({
    update_id: ++id,
    message: { message_id: id, date: 1760342400, chat: { id: chatId, type: 'private' }, from: { id: chatId, is_bot: false, first_name: 'U', username: 'client' }, text, ...extra },
  });
  return { bot, sent, appended, queued, say };
}

test('a full conversation writes one row and notifies the admin', async () => {
  const h = harness();
  await h.say('/start', 7, { entities: [{ type: 'bot_command', offset: 0, length: 6 }] });
  await h.say('Оставить заявку');
  await h.say('Алия');
  await h.say('@aliya_shop');
  await h.say('Нужен лендинг для кофейни');
  await h.say('Отправить');
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0][3], 'Алия');
  assert.ok(h.sent.some((m) => m.chat === 999 && /Новая заявка \(строка 2\)/.test(m.text)));
  assert.ok(h.sent.some((m) => m.chat === 7 && /Заявка принята, мы свяжемся/.test(m.text)));
});

test('if Google Sheets is down the request goes to the queue and the client is still answered', async () => {
  const h = harness({ storeFails: true });
  for (const t of ['Оставить заявку', 'Иван', '+77011234567', 'Починить форму на сайте', 'Отправить']) await h.say(t);
  assert.equal(h.queued.length, 1);
  assert.ok(h.sent.some((m) => m.chat === 7 && /сохраню её чуть позже/.test(m.text)));
});

test('/report is only for the admin', async () => {
  const h = harness();
  await h.say('/report', 7, { entities: [{ type: 'bot_command', offset: 0, length: 7 }] });
  assert.match(h.sent.at(-1).text, /только администратору/);
  await h.say('/report', 999, { entities: [{ type: 'bot_command', offset: 0, length: 7 }] });
  assert.match(h.sent.at(-1).text, /Всего заявок: 0/);
});

// Apps Script storage with a fake fetch
const { createAppsScriptStore } = require('../src/appsScript');
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status ? r.status < 400 : true, status: r.status || 200, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { fn, calls };
}

test('Apps Script store posts the row with the secret and returns the row number', async () => {
  const f = fakeFetch([{ body: { ok: true, rowNumber: 5 } }, { body: { ok: true, total: 4, last: [['x']] } }]);
  const store = createAppsScriptStore({ url: 'https://script.test/exec', secret: 's3', fetchImpl: f.fn, retry: { baseMs: 1 } });
  assert.deepEqual(await store.append(['a', 'b']), { rowNumber: 5 });
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { secret: 's3', row: ['a', 'b'] });
  assert.equal(f.calls[0].opts.redirect, 'follow');
  const rec = await store.recent(3);
  assert.equal(rec.total, 4);
  assert.match(f.calls[1].url, /\?secret=s3&limit=3$/);
});

test('Apps Script: network errors and 5xx are retried, a wrong secret is not', async () => {
  const f = fakeFetch([new Error('socket hang up'), { status: 503, body: 'busy' }, { body: { ok: true, rowNumber: 2 } }]);
  const store = createAppsScriptStore({ url: 'u', secret: 's', fetchImpl: f.fn, retry: { baseMs: 1 } });
  assert.deepEqual(await store.append(['x']), { rowNumber: 2 });
  assert.equal(f.calls.length, 3);
  const g = fakeFetch([{ body: { ok: false, error: 'forbidden' } }]);
  const bad = createAppsScriptStore({ url: 'u', secret: 'wrong', fetchImpl: g.fn, retry: { baseMs: 1 } });
  await assert.rejects(() => bad.append(['x']), /forbidden/);
  assert.equal(g.calls.length, 1);
  const h = fakeFetch([{ body: '<html>Sign in</html>' }]);
  const html = createAppsScriptStore({ url: 'u', secret: 's', fetchImpl: h.fn, retry: { baseMs: 1 } });
  await assert.rejects(() => html.append(['x']), /не JSON/);
});
