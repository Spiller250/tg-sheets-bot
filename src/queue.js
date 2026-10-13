'use strict';
// If Google Sheets is down, a request is not lost: it is written to a local file
// and re-sent later. One JSON object per line.
const fs = require('fs');

function createQueue(file) {
  const read = () => {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  const write = (items) => fs.writeFileSync(file, items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''));

  return {
    push(row) { fs.appendFileSync(file, JSON.stringify(row) + '\n'); },
    size() { return read().length; },
    /** Try to send every queued row; keep the ones that still fail. */
    async flush(send) {
      const items = read();
      const failed = [];
      let sent = 0;
      for (const row of items) {
        try { await send(row); sent++; } catch { failed.push(row); }
      }
      write(failed);
      return { sent, left: failed.length };
    },
  };
}

module.exports = { createQueue };
