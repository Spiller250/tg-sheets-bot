# tg-sheets-bot

Telegram bot that takes requests from clients and saves each one as a row in Google Sheets.

**Stack:** Node.js, [grammY](https://grammy.dev), Google Sheets API (`googleapis`).

## How it works

**Client side**

1. The client taps "Leave a request".
2. The bot asks for name, contact and a short description. The contact can be a phone number, an email or a Telegram @username, and the client can share their phone with one tap.
3. The client reviews the request and taps "Send", or "Start over".

**What happens next**

- The request is added as a row to the Google Sheet: date, time, Telegram ID, name, contact, request, status.
- The administrator gets a message with the row number.
- `/report` (admin only) shows the total number of requests and the last five.

**Reliability**

- Temporary Google API errors (429, 5xx, network) are retried with exponential backoff.
- If the sheet is unavailable, the request is saved to `pending.jsonl` and re-sent automatically every minute. The client is never left without an answer.

**Data safety**

- Input is validated: phone, email or @username for the contact, and a length limit on every field.
- Cells that start with `= + - @` are escaped, so nothing a client types can run as a spreadsheet formula.

## Setup

Allow about 10 minutes. There are two ways to connect the sheet. Option 1 is simpler and does not need Google Cloud.

1. **Bot.**
   1. Message [@BotFather](https://t.me/BotFather) and send `/newbot`.
   2. Copy the token into `BOT_TOKEN`.
2. **Admin.**
   1. Message [@userinfobot](https://t.me/userinfobot).
   2. Put your chat ID in `ADMIN_CHAT_ID`.

### Option 1: Google Apps Script (recommended)

1. Create a Google Sheet (sheets.new) and open **Extensions → Apps Script**.
2. Replace the editor's contents with the code from `apps-script/Code.gs`.
3. Set your own `SECRET`: any long random string.
4. Save, then go to **Deploy → New deployment**.
   1. Click the gear icon and choose **Web app**.
   2. Set "Execute as" to **Me** and "Who has access" to **Anyone**.
   3. Click **Deploy** and grant access to your Google account. If Google warns "app isn't verified", choose "Advanced", then "Go to project".
5. Copy the web app URL (it ends in `/exec`) into `APPS_SCRIPT_URL`, and the same secret into `APPS_SCRIPT_SECRET`.

If you edit the script later, deploy again with **Deploy → Manage deployments → Edit → New version**.

### Option 2: Google Cloud service account

Use this option if your Google account is allowed to create service account keys.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Sheets API**.
2. Create a service account and give it a **JSON key**. Save the key as `google-key.json` next to the project.
3. Share the sheet with the service account's email with **Editor** access.
4. Put the sheet ID in `SPREADSHEET_ID` and leave `APPS_SCRIPT_URL` empty.

### Run

```bash
npm install
cp .env.example .env   # fill in the values
npm start
```

## Tests

```bash
npm test
```

There are 11 tests and none of them use the network:

- conversation logic and input validation;
- formula escaping and time zones;
- writing to the sheet and retries, using a fake Google client and a fake Apps Script endpoint;
- the offline queue;
- full conversations through grammY with the Telegram API replaced by a recorder, including a run with Google Sheets down and the admin-only `/report` check.

## Project structure

```
index.js          start: .env, Google connection, queue, bot
src/flow.js       conversation steps and validation (pure functions)
src/sheets.js     Google Sheets API: header, append, read, retries
src/appsScript.js storage through Apps Script (no Google Cloud key)
apps-script/      Code.gs to paste into the sheet
src/queue.js      offline queue for when the sheet is down
src/bot.js        Telegram: commands, buttons, notifications
test/             node:test
```
