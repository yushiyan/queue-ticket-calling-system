const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const QueueStore = require('../lib/queue');
const { createSystem } = require('../server');
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-test-')); t.after(() => fs.rmSync(dir, { recursive:true, force:true })); return dir; }
test('队列持久化、幂等取号、办理状态、暂停与清零保护', t => {
  const file = path.join(temporary(t), 'queue.json');
  let q = new QueueStore(file);
  assert.equal(q.take('request-00000000001').num, 1);
  assert.equal(q.take('request-00000000001').duplicate, true);
  q.take('request-00000000002');
  q = new QueueStore(file);
  assert.equal(q.view().wait, 2);
  assert.equal(q.action('NEXT', 1), 1);
  assert.throws(() => q.action('NEXT', 1), /先完成/);
  assert.throws(() => q.action('COMPLETE', 1, 2), /已变化/);
  assert.equal(q.action('RECALL', 1, 1), 1);
  q.action('COMPLETE', 1, 1);
  assert.throws(() => q.action('RESET', 1), /不能清零/);
  q.action('PAUSE', 1);
  assert.throws(() => q.take('request-00000000003'), /暂停/);
  assert.equal(q.action('NEXT', 2), 2);
  q.action('SKIP', 2, 2);
  assert.equal(q.view().completed, 1); assert.equal(q.view().skipped, 1);
  q.action('RESET', 1);
  assert.equal(q.view().currentNumber, 0);
  assert.equal(q.view().history[0].type, 'RESET');
});
test('保存失败不会改变内存队列，损坏文件不会静默清空', t => {
  const dir = temporary(t), file = path.join(dir, 'queue.json');
  const q = new QueueStore(file);
  fs.mkdirSync(file + '.tmp');
  assert.throws(() => q.take('request-00000000001'));
  assert.equal(q.view().wait, 0); assert.equal(q.view().currentNumber, 0);
  fs.writeFileSync(file, '{broken');
  assert.throws(() => new QueueStore(file));
});
test('小票自定义保留原始 CSS、80mm 纸宽、默认打印命令与清理方式', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').replace(/\r\n/g, '\n');
  const original = fs.readFileSync(path.join(__dirname, 'printing-original.txt'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(source.match(/<style>([\s\S]*?)<\/style>/)[1], original.match(/<style>([\s\S]*?)<\/style>/)[1]);
  for (const marker of ["const htmlPath = path.join(__dirname, 'ticket.html');", 'fs.writeFileSync(htmlPath, htmlContent, \'utf8\');', original.split('\n').find(line => line.includes('const printCmd =')).trim(), original.split('\n').find(line => line.includes('setTimeout')).trim()]) assert.ok(source.includes(marker));
  assert.ok(source.includes("execFile(sumatraPath, ['-print-to', settings.printing.printerName, '-silent', '-print-settings', 'noscale', htmlPath]"));
  const { ticketHtml } = require('../server');
  const schema = require('../assets/settings-schema');
  const settings = structuredClone(schema.defaults);
  settings.brand.centerName = '<script>test</script>';
  settings.ticket.footer = '第一行\n第二行';
  const html = ticketHtml(1, 3, settings);
  assert.match(html, /&lt;script&gt;test&lt;\/script&gt;/);
  assert.match(html, /第一行<br>第二行/);
  assert.match(html, /A001/);
});
test('HTTP鉴权、跨站拦截、非法输入、WebSocket同步与重启恢复', async t => {
  const dataDir = temporary(t), prints = [], spoken = [];
  const system = createSystem({ dataDir, printTicket:(...args) => prints.push(args), speak:(text, done) => { spoken.push(text); done(); } });
  t.after(() => system.close());
  await Promise.all([system.serverKiosk, system.serverWin].map(s => new Promise(resolve => s.listen(0, '127.0.0.1', resolve))));
  const kiosk = `http://127.0.0.1:${system.serverKiosk.address().port}`, win = `http://127.0.0.1:${system.serverWin.address().port}`;
  const post = (base, url, data, headers = {}) => fetch(base + url, { method:'POST', headers:{'Content-Type':'application/json', ...headers}, body:JSON.stringify(data) });
  for (const [base, file] of [[kiosk, '/'], [win, '/'], [win, '/display.html'], [win, '/assets/style.css'], [kiosk, '/assets/kiosk.js']]) {
    const response = await fetch(base + file);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.equal((await post(win, '/api/action', { type:'NEXT', windowId:1 })).status, 401);
  assert.equal((await fetch(kiosk + '/api/take')).status, 404);
  assert.equal((await post(kiosk, '/api/take', { requestId:'bad' })).status, 400);
  assert.equal((await post(kiosk, '/api/take', { requestId:'request-00000000001' }, { Origin:'http://evil.invalid' })).status, 403);
  assert.equal((await post(win, '/api/login', { password:'000000', windowId:0 })).status, 400);
  assert.equal((await post(win, '/api/login', { password:'wrong', windowId:1 })).status, 401);
  const login = await post(win, '/api/login', { password:'000000', windowId:1 });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  const ws = new WebSocket(win.replace('http:', 'ws:'), { headers:{ Cookie, Origin:win } });
  const initial = once(ws, 'message'); await once(ws, 'open'); await initial;
  t.after(() => ws.terminate());
  const update = once(ws, 'message');
  const ticket = await (await post(kiosk, '/api/take', { requestId:'request-00000000001' })).json();
  assert.equal(ticket.num, 1); assert.equal(JSON.parse((await update)[0]).wait, 1);
  await post(kiosk, '/api/take', { requestId:'request-00000000001' });
  assert.equal(prints.length, 1);
  assert.equal((await post(win, '/api/action', { type:'NEXT', windowId:"1';bad" }, { Cookie })).status, 400);
  assert.equal((await post(win, '/api/action', { type:'NEXT', windowId:2 }, { Cookie })).status, 403);
  assert.equal((await (await fetch(win + '/api/session', { headers:{ Cookie } })).json()).windowId, 1);
  assert.equal((await post(win, '/api/action', { type:'NEXT', windowId:1 }, { Cookie })).status, 200);
  assert.equal(spoken.length, 1);
  ws.send('{invalid-json');
  assert.equal((await fetch(win + '/api/status')).status, 200);
  assert.equal(new QueueStore(path.join(dataDir, 'queue.json')).view().windows[1].num, 1);
  assert.equal((await post(win, '/api/action', { type:'COMPLETE', windowId:1, expectedNum:2 }, { Cookie })).status, 400);
  assert.equal((await post(win, '/api/action', { type:'COMPLETE', windowId:1, expectedNum:1 }, { Cookie })).status, 200);
  const otherLogin = await post(win, '/api/login', { password:'000000', windowId:2 });
  const otherCookie = otherLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await post(win, '/api/settings/password', { currentPassword:'000000', newPassword:'123456', targetRole:'operator' }, { Cookie })).status, 403);
  const adminLogin = await post(win, '/api/login', { password:'000002', role:'admin' });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await post(win, '/api/settings/password', { currentPassword:'wrong', newPassword:'123456', targetRole:'operator' }, { Cookie:adminCookie })).status, 400);
  assert.equal((await post(win, '/api/settings/password', { currentPassword:'000002', newPassword:'123', targetRole:'operator' }, { Cookie:adminCookie })).status, 400);
  assert.equal((await post(win, '/api/settings/password', { currentPassword:'000002', newPassword:'000002', targetRole:'operator' }, { Cookie:adminCookie })).status, 400);
  assert.equal((await post(win, '/api/settings/password', { currentPassword:'000002', newPassword:'123456', targetRole:'operator' }, { Cookie:adminCookie })).status, 200);
  assert.equal((await post(win, '/api/action', { type:'PAUSE', windowId:2 }, { Cookie:otherCookie })).status, 401);
  assert.equal((await post(win, '/api/login', { password:'000000', windowId:1 })).status, 401);
  assert.equal((await post(win, '/api/login', { password:'123456', windowId:1 })).status, 200);
  const PasswordSettings = require('../lib/password');
  const restored = new PasswordSettings(path.join(dataDir, 'settings.json'));
  assert.equal(restored.verify('123456'), true);
  assert.equal(restored.verify('000000'), false);
  assert.equal(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8').includes('123456'), false);
  await post(win, '/api/logout', {}, { Cookie });
  assert.equal((await post(win, '/api/action', { type:'NEXT', windowId:1 }, { Cookie })).status, 401);
});

test('管理员权限、自定义配置、指定叫号、号码一致性及设置持久化', async t => {
  const dataDir = temporary(t), spoken = [], prints = [];
  const system = createSystem({ dataDir, printTicket:(...args) => prints.push(args), speak:(job, done) => { spoken.push(job); done(); } });
  t.after(() => system.close());
  await Promise.all([system.serverKiosk, system.serverWin].map(s => new Promise(resolve => s.listen(0,'127.0.0.1',resolve))));
  const win = `http://127.0.0.1:${system.serverWin.address().port}`, kiosk = `http://127.0.0.1:${system.serverKiosk.address().port}`;
  const post = (base, url, data, Cookie) => fetch(base + url,{ method:'POST', headers:{'Content-Type':'application/json', ...(Cookie ? { Cookie } : {})}, body:JSON.stringify(data) });
  const login = async data => { const res = await post(win,'/api/login',data); assert.equal(res.status,200); return res.headers.get('set-cookie').split(';')[0]; };
  const operator = await login({password:'000000',windowId:1});
  const admin = await login({password:'000002',role:'admin'});
  const session = await (await fetch(win+'/api/session',{headers:{Cookie:admin}})).json();
  assert.equal(session.role,'admin'); assert.equal(session.windowId,null);
  assert.equal((await fetch(win+'/api/admin/config',{headers:{Cookie:operator}})).status,403);
  assert.equal((await post(win,'/api/admin/action',{type:'PAUSE'},operator)).status,403);
  assert.equal((await post(win,'/api/action',{type:'RESET',windowId:1},operator)).status,200);
  assert.equal((await post(win,'/api/action',{type:'NEXT',windowId:1},admin)).status,403);
  const saved = await (await fetch(win+'/api/admin/config',{headers:{Cookie:admin}})).json();
  saved.values.brand.centerName = '星河服务站'; saved.values.brand.iconMode = 'none';
  saved.values.numbering = {prefix:'B',digits:4,start:101};
  saved.values.voice.template = "请 {number} 到 {window} 窗口，O'Brien。";
  saved.values.voice.includePrefix = true; saved.values.voice.repeat = 3; saved.values.voice.rate = 2;
  saved.values.service.allowSpecific = true;
  const response = await post(win,'/api/admin/config',saved,admin); assert.equal(response.status,200);
  let latest = await response.json();
  assert.equal((await post(win,'/api/admin/config',saved,admin)).status,400);
  const ticket = await (await post(kiosk,'/api/take',{requestId:'custom-request-00001'})).json();
  assert.equal(ticket.label,'B0101'); assert.equal(prints[0][3],'B0101');
  const change = structuredClone(latest); change.values.numbering.prefix = 'C';
  assert.equal((await post(win,'/api/admin/config',change,admin)).status,400);
  latest.values.display.notice = '欢迎办理';
  latest = await (await post(win,'/api/admin/config',latest,admin)).json();
  assert.equal((await post(win,'/api/action',{type:'NEXT',windowId:1},operator)).status,200);
  assert.equal(spoken[0].rate,2); assert.match(spoken[0].text,/B0101/); assert.equal(spoken[0].text.split("O'Brien").length,4);
  await post(win,'/api/action',{type:'COMPLETE',windowId:1,expectedNum:1},operator);
  for (const id of [2,3]) await post(kiosk,'/api/take',{requestId:`custom-request-0000${id}`});
  assert.equal((await post(win,'/api/action',{type:'NEXT',windowId:1,targetNum:3},operator)).status,200);
  assert.equal(system.store.state.windows[1].label,'B0103');
  await post(win,'/api/action',{type:'COMPLETE',windowId:1,expectedNum:3},operator);
  await post(win,'/api/action',{type:'NEXT',windowId:1},operator);
  await post(win,'/api/action',{type:'COMPLETE',windowId:1,expectedNum:2},operator);
  assert.equal((await post(win,'/api/admin/action',{type:'RESET'},admin)).status,200);
  latest.values.numbering = {prefix:'C',digits:3,start:1};
  const update = await post(win,'/api/admin/config',latest,admin); assert.equal(update.status,200);
  const nextTicket = await (await post(kiosk,'/api/take',{requestId:'custom-request-00004'})).json();
  assert.equal(nextTicket.label,'C001');
  const Config = require('../lib/config').Config;
  assert.equal(new Config(path.join(dataDir,'config.json')).values.brand.centerName,'星河服务站');
  const restored = new QueueStore(path.join(dataDir,'queue.json'));
  assert.equal(restored.state.history.find(h => h.type === 'COMPLETE').label,'B0102');
  const preview = await fetch(win+'/api/admin/ticket-preview',{headers:{Cookie:admin}});
  assert.match(preview.headers.get('content-security-policy'), /style-src 'unsafe-inline'/);
  assert.match(await preview.text(),/星河服务站/);
  assert.equal((await fetch(win+'/api/admin/ticket-preview',{headers:{Cookie:operator}})).status,403);
});

test('配置拒绝非法语音参数、图片、缺失占位符和超长字段', () => {
  const {validate} = require('../lib/config'); const {defaults} = require('../assets/settings-schema');
  for (const mutate of [v => v.voice.rate = 100, v => v.voice.template = '没有号码', v => v.brand.iconImage = 'data:image/svg+xml;base64,xxxx', v => v.brand.centerName = '长'.repeat(50), v => v.numbering.prefix = "'bad", v => v.service.maxWaiting = -1]) {
    const values = structuredClone(defaults); mutate(values); assert.throws(() => validate(values));
  }
  assert.equal(validate(structuredClone(defaults)).brand.centerName,'业务办理中心');
  const image = structuredClone(defaults);
  image.brand.iconMode = 'image';
  image.brand.iconImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEZkAAAAASUVORK5CYII=';
  assert.equal(validate(image).brand.iconMode,'image');
});

test('独立登录入口、普通窗口清零、选打印机和测试打印不影响队列', async t => {
  const dataDir = temporary(t), prints = [];
  const system = createSystem({ dataDir,
    printTicket:(num, wait, config, label, done) => { prints.push({num,wait,printer:config.printing.printerName,label,ticket:structuredClone(config.ticket)}); done?.(); },
    listPrinters:async () => ({printers:[{name:'XP-80C'},{name:'Office "Printer" & (test)'}],defaultPrinter:'XP-80C'}),
    speak:(job,done) => done()
  });
  t.after(() => system.close());
  await Promise.all([system.serverKiosk,system.serverWin].map(s => new Promise(resolve => s.listen(0,'127.0.0.1',resolve))));
  const win = `http://127.0.0.1:${system.serverWin.address().port}`, kiosk = `http://127.0.0.1:${system.serverKiosk.address().port}`;
  const post = (base,url,data,Cookie) => fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(Cookie ? {Cookie} : {})},body:JSON.stringify(data)});
  assert.equal((await post(win,'/api/login',{role:'operator',password:'000002',windowId:1})).status,401);
  assert.equal((await post(win,'/api/login',{role:'admin',password:'000000'})).status,401);
  const opLogin = await post(win,'/api/login',{role:'operator',password:'000000',windowId:1});
  const operator = opLogin.headers.get('set-cookie').split(';')[0];
  const adminLogin = await post(win,'/api/login',{role:'admin',password:'000002'});
  const admin = adminLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(win+'/api/admin/printers',{headers:{Cookie:operator}})).status,403);
  assert.equal((await post(win,'/api/admin/test-print',{},operator)).status,403);
  const list = await (await fetch(win+'/api/admin/printers',{headers:{Cookie:admin}})).json();
  assert.equal(list.printers[0].name,'XP-80C');
  let saved = await (await fetch(win+'/api/admin/config',{headers:{Cookie:admin}})).json();
  saved.values.printing.printerName = 'not-installed';
  assert.equal((await post(win,'/api/admin/config',saved,admin)).status,400);
  saved.values.printing.printerName = 'Office "Printer" & (test)'; saved.values.kiosk.theme = 'ocean';
  const result = await post(win,'/api/admin/config',saved,admin); assert.equal(result.status,200); saved = await result.json();
  const before = JSON.stringify(system.store.state);
  assert.equal((await post(win,'/api/admin/test-print',{},admin)).status,200);
  assert.equal(JSON.stringify(system.store.state),before);
  assert.equal(prints[0].label,'测试凭条'); assert.equal(prints[0].printer,'Office "Printer" & (test)');
  assert.equal(prints[0].ticket.title,'指定打印机测试');
  assert.equal(prints[0].ticket.waitTemplate,'前方等待人数：test');
  assert.match(prints[0].ticket.footer,/^本凭条仅用于打印检查，不参与排队。?$/);
  const first = await (await post(kiosk,'/api/take',{requestId:'printing-request-00001'})).json();
  assert.equal(first.label,'A001'); assert.equal(prints[1].printer,'Office "Printer" & (test)');
  assert.equal(prints[1].ticket.title,'排队凭条');
  assert.equal((await post(win,'/api/action',{type:'RESET',windowId:1},operator)).status,400);
  await post(win,'/api/action',{type:'NEXT',windowId:1},operator);
  assert.equal((await post(win,'/api/action',{type:'RESET',windowId:1},operator)).status,400);
  await post(win,'/api/action',{type:'COMPLETE',windowId:1,expectedNum:1},operator);
  assert.equal((await post(win,'/api/action',{type:'RESET',windowId:1},operator)).status,200);
  assert.equal(system.store.state.currentNumber,0);
  assert.match(fs.readFileSync(path.join(dataDir,'initpass.txt'),'utf8'),/000002/);
  assert.equal((await fetch(win+'/data/initpass.txt')).status,404);
});

test('旧设置文件升级时补齐取号背景和打印机字段并保留原值', t => {
  const {Config} = require('../lib/config'); const {defaults} = require('../assets/settings-schema');
  const file = path.join(temporary(t),'config.json');
  const values = structuredClone(defaults); delete values.printing; delete values.kiosk.theme;
  values.brand.centerName = '已有名称';
  fs.writeFileSync(file,JSON.stringify({revision:7,values}));
  const restored = new Config(file);
  assert.equal(restored.values.brand.centerName,'已有名称'); assert.equal(restored.values.kiosk.theme,'jade'); assert.equal(restored.values.printing.printerName,''); assert.equal(restored.revision,7);
});

test('打印机 JSON 解析不依赖 PowerShell 排版，兼容中文、冒号、网络路径和空列表', () => {
  const {parsePrinters} = require('../lib/printers');
  const devices = [
    {name:'XP-80C',isDefault:true},
    {name:'导出为 WPS PDF: A4',isDefault:false},
    {name:'\\\\192.168.1.2\\Office "Printer"',isDefault:false}
  ];
  const parsed = parsePrinters('\ufeff' + JSON.stringify(devices,null,2) + '\r\n');
  assert.equal(parsed.defaultPrinter,'XP-80C');
  assert.deepEqual(parsed.printers,devices.map(p=>({name:p.name})));
  assert.equal(parsePrinters(JSON.stringify(devices[0])).printers.length,1);
  for (const value of ['', '[]', 'null', ' \r\n']) assert.deepEqual(parsePrinters(value),{printers:[],defaultPrinter:''});
  assert.throws(()=>parsePrinters('Name : XP-80C\r\n\r\n'),/JSON|Unexpected/);
  assert.throws(()=>parsePrinters('[{"name":"XP-80C"}]'),/数据格式/);
});

test('干净数据目录首次启动直接使用默认状态，无额外初始化步骤', async t => {
  const dataDir = temporary(t);
  const system = createSystem({dataDir,printTicket:()=>{},speak:(job,done)=>done()});
  t.after(()=>system.close());
  await new Promise(resolve=>system.serverWin.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${system.serverWin.address().port}`;
  const status = await (await fetch(base+'/api/status')).json();
  assert.equal(status.wait,0); assert.equal(status.currentNumber,0); assert.deepEqual(status.windows,{});
  assert.equal(status.paused,false); assert.equal(status.config.brand.centerName,'业务办理中心');
  assert.equal(status.config.printing.printerName,''); assert.equal(status.config.numbering.start,1);
  for (const body of [{role:'operator',password:'000000',windowId:1},{role:'admin',password:'000002'}]) {
    const login = await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(login.status,200);
  }
  assert.match(fs.readFileSync(path.join(dataDir,'initpass.txt'),'utf8'),/初始密码/);
});
