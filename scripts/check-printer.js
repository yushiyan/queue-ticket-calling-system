// Read-only by default. --print explicitly sends one real test ticket.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listPrinters } = require('../lib/printers');
const { createSystem } = require('../server');

async function main() {
  const devices = await listPrinters();
  console.log(JSON.stringify(devices, null, 2));
  if (!process.argv.includes('--print')) return;
  const target = process.argv.find(arg => arg.startsWith('--printer='))?.slice('--printer='.length) || '';
  if (target && !devices.printers.some(p => p.name === target)) throw new Error('指定打印机未安装');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-printer-check-'));
  const system = createSystem({ dataDir });
  try {
    await new Promise(resolve => system.serverWin.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${system.serverWin.address().port}`;
    const post = (url, body, cookie) => fetch(base + url, { method:'POST', headers:{ 'Content-Type':'application/json', ...(cookie ? { Cookie:cookie } : {}) }, body:JSON.stringify(body) });
    const login = await post('/api/login', { role:'admin', password:'000002' });
    if (!login.ok) throw new Error('诊断会话登录失败');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const listed = await fetch(base + '/api/admin/printers', { headers:{ Cookie:cookie } });
    if (!listed.ok) throw new Error('管理打印机接口失败');
    console.log('管理打印机接口:', listed.status);
    const config = await (await fetch(base + '/api/admin/config', { headers:{ Cookie:cookie } })).json();
    config.values.printing.printerName = target;
    config.values.ticket.title = target ? '指定打印机测试' : '默认打印机测试';
    config.values.ticket.footer = '本凭条仅用于打印检查，不参与排队。';
    const saved = await post('/api/admin/config', config, cookie);
    if (!saved.ok) throw new Error((await saved.json()).error);
    const before = JSON.stringify(system.store.state);
    const result = await post('/api/admin/test-print', {}, cookie);
    const payload = await result.json();
    console.log('真实测试打印结果:', result.status, JSON.stringify(payload));
    if (!result.ok) throw new Error(payload.error);
    if (JSON.stringify(system.store.state) !== before) throw new Error('测试意外改变队列');
    console.log('检查完成：实际业务数据未修改，队列未取号。请人工确认出纸。');
  } finally {
    await system.close();
    // mkdtemp creates this exact disposable directory under the OS temp directory.
    if (path.dirname(dataDir) !== os.tmpdir() || !path.basename(dataDir).startsWith('queue-printer-check-')) throw new Error('临时目录校验失败');
    fs.rmSync(dataDir, { recursive:true, force:true });
  }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
