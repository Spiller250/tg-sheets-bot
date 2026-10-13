'use strict';
// Conversation logic for collecting a request. Pure functions: no Telegram, no network,
// so every step is unit-tested.

const STEPS = ['name', 'contact', 'request', 'confirm'];

const PROMPTS = {
  name: 'Как вас зовут?',
  contact: 'Как с вами связаться? Телефон, email или @username в Telegram. Можно нажать кнопку «Отправить номер».',
  request: 'Опишите коротко, что нужно сделать.',
};

const PHONE = /^\+?[0-9][0-9\s()-]{6,18}[0-9]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TG_USERNAME = /^@[A-Za-z0-9_]{5,32}$/;

function validate(step, raw) {
  const value = String(raw ?? '').trim();
  if (step === 'name') {
    if (value.length < 2 || value.length > 60) return { ok: false, error: 'Имя должно быть от 2 до 60 символов.' };
    return { ok: true, value };
  }
  if (step === 'contact') {
    if (PHONE.test(value) || EMAIL.test(value) || TG_USERNAME.test(value)) return { ok: true, value };
    return { ok: false, error: 'Не похоже на телефон, email или @username. Попробуйте ещё раз.' };
  }
  if (step === 'request') {
    if (value.length < 5) return { ok: false, error: 'Напишите хотя бы пару слов о задаче.' };
    if (value.length > 1000) return { ok: false, error: 'Слишком длинно: уложитесь в 1000 символов.' };
    return { ok: true, value };
  }
  return { ok: false, error: 'Неизвестный шаг.' };
}

function start() {
  return { step: 'name', data: {} };
}

/** Apply a user's answer to the current state. Returns { state, reply, done }. */
function answer(state, text) {
  if (!state || !STEPS.includes(state.step)) return { state: start(), reply: PROMPTS.name, done: false };
  if (state.step === 'confirm') {
    const t = String(text).trim().toLowerCase();
    if (['да', 'отправить', 'yes'].includes(t)) return { state: null, reply: null, done: true, data: state.data };
    if (['нет', 'заново', 'no'].includes(t)) return { state: start(), reply: 'Хорошо, начнём заново. ' + PROMPTS.name, done: false };
    return { state, reply: 'Нажмите «Отправить» или «Заново».', done: false };
  }
  const v = validate(state.step, text);
  if (!v.ok) return { state, reply: v.error, done: false };
  const data = { ...state.data, [state.step]: v.value };
  const next = STEPS[STEPS.indexOf(state.step) + 1];
  if (next === 'confirm') return { state: { step: 'confirm', data }, reply: summary(data), done: false };
  return { state: { step: next, data }, reply: PROMPTS[next], done: false };
}

function summary(d) {
  return `Проверьте заявку:\n\nИмя: ${d.name}\nКонтакт: ${d.contact}\nЗадача: ${d.request}\n\nВсё верно?`;
}

// A cell starting with = + - @ would be run as a formula by Google Sheets / Excel.
function safeCell(v) {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function toRow(data, from, now = new Date(), timeZone = 'Asia/Almaty') {
  const stamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now);
  return [stamp, String(from.id), from.username ? '@' + from.username : '', data.name, data.contact, data.request, 'новая'].map(safeCell);
}

module.exports = { STEPS, PROMPTS, validate, start, answer, summary, safeCell, toRow };
