// Isolated visual preview: no real printing, speech or production data.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSystem } = require('../server');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-preview-'));
const system = createSystem({ dataDir, printTicket: (num, wait, config, label, done) => done?.(), listPrinters: async () => ({ printers:[{name:'XP-80C（预览）'}], defaultPrinter:'XP-80C（预览）' }), speak: (text, done) => done() });
for (let i = 0; i < 24; i++) system.store.take(`preview-request-${String(i).padStart(6, '0')}`);
for (const win of [1, 2, 3]) system.store.action('NEXT', win);
system.serverWin.listen(3100, '127.0.0.1', () => console.log('PREVIEW http://127.0.0.1:3100'));
system.serverKiosk.listen(8100, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await system.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
});
