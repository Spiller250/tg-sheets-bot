'use strict';
// Telegram wiring (grammY). Logic lives in flow.js; storage in sheets.js / queue.js.
const { Bot, Keyboard } = require('grammy');
const flow = require('./flow');

const MENU = new Keyboard().text('Оставить заявку').resized();
const CONFIRM = new Keyboard().text('Отправить').text('Заново').resized().oneTime();
const CONTACT = new Keyboard().requestContact('Отправить номер').resized().oneTime();

function createBot({ token, store, queue, adminChatId, timeZone, botOptions }) {
  const bot = new Bot(token, botOptions);
  const sessions = new Map(); // chat id -> conversation state
  const isAdmin = (ctx) => adminChatId && String(ctx.chat.id) === String(adminChatId);

  const ask = (ctx, state, text) => {
    const kb = state && state.step === 'contact' ? CONTACT : state && state.step === 'confirm' ? CONFIRM : { remove_keyboard: true };
    return ctx.reply(text, { reply_markup: kb });
  };

  bot.command('start', async (ctx) => {
    sessions.delete(ctx.chat.id);
    await ctx.reply('Здравствуйте! Я принимаю заявки. Нажмите «Оставить заявку» — это займёт минуту.', { reply_markup: MENU });
  });

  bot.command('cancel', async (ctx) => {
    sessions.delete(ctx.chat.id);
    await ctx.reply('Заявка отменена.', { reply_markup: MENU });
  });

  bot.command('report', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Эта команда доступна только администратору.');
    try {
      const { total, last } = await store.recent(5);
      const lines = last.map((r) => `${r[0]} — ${r[3]}, ${r[4]}: ${String(r[5]).slice(0, 80)}`);
      const pending = queue.size();
      await ctx.reply(`Всего заявок: ${total}${pending ? `\nЖдут отправки в таблицу: ${pending}` : ''}\n\nПоследние:\n${lines.join('\n') || 'пока нет'}`);
    } catch (err) {
      await ctx.reply('Не удалось прочитать таблицу: ' + err.message);
    }
  });

  bot.hears('Оставить заявку', async (ctx) => {
    const state = flow.start();
    sessions.set(ctx.chat.id, state);
    await ask(ctx, state, flow.PROMPTS.name);
  });

  async function handle(ctx, text) {
    const state = sessions.get(ctx.chat.id);
    if (!state) return ctx.reply('Нажмите «Оставить заявку», чтобы начать.', { reply_markup: MENU });
    const res = flow.answer(state, text);
    if (!res.done) {
      sessions.set(ctx.chat.id, res.state);
      return ask(ctx, res.state, res.reply);
    }
    sessions.delete(ctx.chat.id);
    const row = flow.toRow(res.data, ctx.from, new Date(), timeZone);
    let saved = null;
    try { saved = await store.append(row); } catch (err) {
      queue.push(row);
      console.error('Sheets append failed, queued:', err.message);
    }
    await ctx.reply(saved ? 'Спасибо! Заявка принята, мы свяжемся с вами.' : 'Спасибо! Заявка принята. Таблица сейчас недоступна, сохраню её чуть позже автоматически.', { reply_markup: MENU });
    if (adminChatId) {
      const where = saved && saved.rowNumber ? ` (строка ${saved.rowNumber})` : ' (в очереди)';
      await bot.api.sendMessage(adminChatId, `Новая заявка${where}\n${res.data.name}, ${res.data.contact}\n${res.data.request}`).catch(() => {});
    }
  }

  bot.on('message:contact', (ctx) => handle(ctx, ctx.message.contact.phone_number));
  bot.on('message:text', (ctx) => handle(ctx, ctx.message.text));

  bot.catch((err) => console.error('Bot error:', err.error || err));
  return { bot, sessions };
}

module.exports = { createBot };
