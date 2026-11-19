const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const QueueStore = require('./lib/queue');
const PasswordSettings = require('./lib/password');
const { Config, validate: validateConfig } = require('./lib/config');
const QueueSchema = require('./assets/settings-schema');
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
function ticketHtml(num, wait, settings = QueueSchema.defaults, label) {
    const padNum = escapeHtml(label || QueueSchema.format(num, settings));
    const timeStr = new Date().toLocaleTimeString();

    const values = { center:settings.brand.centerName, number:label || QueueSchema.format(num, settings), wait, time:timeStr };
    const text = value => escapeHtml(QueueSchema.template(value, values));
    // 1. 精细缩小字号与各段落间距的 HTML
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            @page { 
                size: 80mm auto; 
                margin: 0; 
            }
            html, body { 
                margin: 0; 
                padding: 0; 
                width: 74mm; 
                background: #fff; 
                color: #000;
                font-family: 'Microsoft YaHei', 'SimHei', sans-serif;
            }
            .wrapper {
                width: 100%;
                padding: 8px 10px; /* 缩减上下内边距，使其更紧凑 */
                text-align: center;
                box-sizing: border-box;
            }
            /* 标题字号从 18px 降到 15px */
            .title { font-size: 15px; font-weight: bold; margin: 2px 0; letter-spacing: 0.5px; }
            /* 减号分割线上下间距收紧 */
            .text-line { font-size: 12px; font-weight: bold; margin: 4px 0; color: #000; letter-spacing: -1px; }
            /* 提示语字号降到 12px */
            .tip { font-size: 12px; margin-bottom: 2px; color: #333; }
            /* 号码字号从 38px 进一步回收到 28px，确保大小适中不臃肿 */
            .number { font-size: 28px; font-weight: bold; margin: 3px 0; letter-spacing: 0.5px; }
            /* 等待人数降到 12px */
            .wait { font-size: 12px; font-weight: bold; margin: 2px 0; }
            /* 页脚说明间距与字号同步微调 */
            .footer { font-size: 11px; margin-top: 2px; line-height: 1.4; color: #222; }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="title">${text(settings.ticket.header)}</div>
            <div class="title">${text(settings.ticket.title)}</div>
            
            <div class="text-line">--------------------------------</div>
            
            <div class="tip">${text(settings.ticket.numberLabel)}</div>
            <div class="number">${padNum}</div>
            <div class="wait">${text(settings.ticket.waitTemplate)}</div>
            
            <div class="text-line">--------------------------------</div>
            
            <div class="footer">${text(settings.ticket.timeTemplate)}</div>
            <div class="footer">${text(settings.ticket.footer).replace(/\r?\n/g, '<br>')}</div>
        </div>
    </body>
    </html>
    `;

    return htmlContent;
}

function printTicket(num, wait, settings = QueueSchema.defaults, label, done = () => {}) {
    const padNum = label || QueueSchema.format(num, settings);
    const htmlContent = ticketHtml(num, wait, settings, label);
    const htmlPath = path.join(__dirname, 'ticket.html');
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');

    // 2. 稳定的后台静默打印调用
    const sumatraPath = path.join(__dirname, 'node_modules', 'pdf-to-printer', 'dist', 'SumatraPDF-3.4.6-32.exe');
    const printCmd = `"${sumatraPath}" -print-to-default -silent -print-settings "noscale" "${htmlPath}"`;
    
    const onPrinted = (err) => {
        if (err) {
            console.error(`[ERROR] 打印发送失败: ${err.message}`);
        } else {
            console.log(`[INFO] 打印任务已发送 -> 号码: ${padNum}, 等待人数: ${wait}`);
        }
        setTimeout(() => { if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath); }, 6000);
        done(err);
    };
    if (settings.printing.printerName) {
        execFile(sumatraPath, ['-print-to', settings.printing.printerName, '-silent', '-print-settings', 'noscale', htmlPath], { windowsHide: true }, onPrinted);
    } else {
        exec(printCmd, onPrinted);
    }
}



function createSystem(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const initPassFile = path.join(dataDir, 'initpass.txt');
  if (!fs.existsSync(initPassFile)) fs.writeFileSync(initPassFile, '\ufeff窗口初始密码：000000\r\n管理初始密码：000002\r\n\r\n初始密码可在管理中心修改。此文件仅说明初始密码，不记录修改后的密码。\r\n', { mode:0o600 });
  const passwords = new PasswordSettings(path.join(dataDir, 'settings.json'));
  const adminPasswords = new PasswordSettings(path.join(dataDir, 'admin-password.json'), '000002');
  const config = new Config(path.join(dataDir, 'config.json'));
  const store = new QueueStore(path.join(dataDir, 'queue.json'));
  const sessions = new Map(), limits = new Map(), speech = [];
  let speaking = false;
  const printer = options.printTicket || printTicket;
  const listPrinters = options.listPrinters || require('./lib/printers').listPrinters;
  const say = options.speak || ((job, done) => {
    const safeText = job.text.replace(/'/g, "''");
    const script = `${job.chime ? "if (Test-Path 'C:\\Windows\\Media\\notify.wav') { (New-Object System.Media.SoundPlayer('C:\\Windows\\Media\\notify.wav')).PlaySync() };" : ''} $v = New-Object -ComObject SAPI.SpVoice; $v.Rate = ${job.rate}; $v.Volume = ${job.volume}; $v.Speak('${safeText}')`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 60000, windowsHide: true }, done);
  });
  function speakNext() {
    if (speaking || !speech.length) return;
    speaking = true;
    say(speech.shift(), err => {
      if (err) console.error('语音播报失败:', err.message);
      speaking = false;
      speakNext();
    });
  }
  function enqueueVoice(num, windowId, label) {
    const v = config.values.voice;
    if (!v.enabled) return;
    const spokenNumber = v.includePrefix ? label : String(num + config.values.numbering.start - 1);
    const text = QueueSchema.template(v.template, { number:spokenNumber, window:windowId, center:config.values.brand.centerName });
    speech.push({ text:Array(v.repeat).fill(text).join(' '), rate:v.rate, volume:v.volume, chime:v.chime });
    speakNext();
  }
  function view() { return { ...store.view(), config:config.values, configRevision:config.revision }; }
  const kiosk = express(), win = express();
  for (const app of [kiosk, win]) {
    app.disable('x-powered-by');
    app.use((req, res, next) => {
      res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" });
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: '不允许跨站操作' });
      next();
    });
    app.use(express.json({ limit: '512kb' }));
    app.use('/assets', express.static(path.join(__dirname, 'assets')));
    app.get('/api/status', (req, res) => res.json(view()));
  }
  function limited(req, scope, max, duration) {
    const key = `${scope}:${req.socket.remoteAddress}`;
    const now = Date.now();
    const entry = limits.get(key);
    if (!entry || entry.until < now) { limits.set(key, { count: 1, until: now + duration }); return false; }
    return ++entry.count > max;
  }
  function token(req) { return /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1]; }
  function authorized(req) { return (sessions.get(token(req))?.expires || 0) > Date.now(); }
  function auth(req, res, next) { if (!authorized(req)) return res.status(401).json({ error: '登录已失效，请重新登录' }); next(); }
  function admin(req, res, next) { if (sessions.get(token(req)).role !== 'admin') return res.status(403).json({ error:'此操作需要管理员登录' }); next(); }
  kiosk.post('/api/take', (req, res, next) => {
    const id = req.body?.requestId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) return res.status(400).json({ error: '取号请求编号无效' });
    if (limited(req, 'take', 20, 60000)) return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
    try {
      const ticket = store.take(id, n => QueueSchema.format(n, config.values), config.values.service.maxWaiting);
      if (!ticket.duplicate) {
        try { printer(ticket.num, ticket.wait, config.values, ticket.label); } catch (err) { console.error('打印执行失败:', err.message); }
        broadcast();
      }
      res.json(ticket);
    } catch (err) { next(err); }
  });
  win.post('/api/login', (req, res) => {
    if (limited(req, 'login', 10, 60000)) return res.status(429).json({ error: '登录尝试过多，请一分钟后重试' });
    const windowId = req.body?.windowId;
    const isAdmin = req.body?.role === 'admin';
    if (req.body?.role !== undefined && !['admin','operator'].includes(req.body.role)) return res.status(400).json({ error:'登录入口不正确' });
    if (isAdmin && !adminPasswords.verify(req.body?.password)) return res.status(401).json({ error:'管理员密码错误' });
    if (!isAdmin && (!Number.isInteger(windowId) || windowId < 1 || windowId > 99)) return res.status(400).json({ error: '窗口号必须是 1–99 的整数' });
    if (!isAdmin && !passwords.verify(req.body?.password)) return res.status(401).json({ error: '密码错误' });
    sessions.delete(token(req));
    const id = crypto.randomBytes(32).toString('hex');
    const session = { expires: Date.now() + 12 * 3600000, windowId:isAdmin ? null : windowId, role:isAdmin ? 'admin' : 'operator' };
    sessions.set(id, session);
    res.cookie('session', id, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 12 * 3600000 });
    res.json({ ok: true, windowId:session.windowId, role:session.role });
  });
  win.get('/api/session', (req, res) => { const s = authorized(req) ? sessions.get(token(req)) : null; res.json({ authenticated:!!s, windowId:s?.windowId, role:s?.role }); });
  win.post('/api/logout', (req, res) => { sessions.delete(token(req)); res.clearCookie('session'); res.json({ ok: true }); });
  win.post('/api/settings/password', auth, admin, (req, res, next) => {
    if (limited(req, 'password', 10, 60000)) return res.status(429).json({ error: '尝试过多，请一分钟后再试' });
    const { currentPassword, newPassword, targetRole } = req.body || {};
    if (!['admin','operator'].includes(targetRole)) return res.status(400).json({ error:'请选择密码类型' });
    if (!adminPasswords.verify(currentPassword)) return res.status(400).json({ error: '管理员当前密码不正确' });
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 64 || !newPassword.trim()) return res.status(400).json({ error: '新密码需为 6–64 个字符' });
    try {
      const other = targetRole === 'admin' ? passwords : adminPasswords;
      if (other.verify(newPassword)) return res.status(400).json({ error:'管理员和窗口密码不能相同' });
      (targetRole === 'admin' ? adminPasswords : passwords).save(newPassword);
      for (const [id, session] of sessions) if (id !== token(req) && session.role === targetRole) sessions.delete(id);
      for (const client of wss.clients) if (!sessions.has(client.session)) client.close(1008, 'Password changed');
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
  win.get('/api/admin/config', auth, admin, (req, res) => res.json({ values:config.values, revision:config.revision }));
  win.post('/api/admin/config', auth, admin, async (req, res, next) => {
    try {
      const values = validateConfig(req.body?.values);
      if (JSON.stringify(values.numbering) !== JSON.stringify(config.values.numbering) && store.state.currentNumber > 0) throw new Error('请在队列办理完毕并执行本轮清零后，再修改号码规则');
      if (values.printing.printerName && values.printing.printerName !== config.values.printing.printerName) {
        const installed = await listPrinters();
        if (!installed.printers.some(p => p.name === values.printing.printerName)) throw new Error('所选打印机未在服务器上安装，请刷新打印机列表');
      }
      // The printer query may yield while a window issues a ticket.
      if (JSON.stringify(values.numbering) !== JSON.stringify(config.values.numbering) && store.state.currentNumber > 0) throw new Error('已发出新号码，请先处理完队列并清零再修改号码规则');
      config.save(values, req.body.revision);
      broadcast(); res.json({ values:config.values, revision:config.revision });
    } catch (err) { next(err); }
  });
  win.get('/api/admin/printers', auth, admin, async (req, res) => {
    if (limited(req, 'printers', 12, 60000)) return res.status(429).json({ error:'刷新过于频繁，请稍后再试' });
    try { res.json(await listPrinters()); } catch (err) { console.error('读取打印机失败:', err.message); res.status(503).json({ error:'无法读取服务器打印机，请检查 Windows 打印服务后重试' }); }
  });
  win.post('/api/admin/test-print', auth, admin, async (req, res) => {
    if (limited(req, 'test-print', 2, 60000)) return res.status(429).json({ error:'测试打印过于频繁，请一分钟后再试' });
    try {
      const installed = await listPrinters();
      const target = config.values.printing.printerName || installed.defaultPrinter;
      if (!target || !installed.printers.some(p => p.name === target)) return res.status(400).json({ error:'没有可用的目标打印机，请先选择并保存打印设置' });
      const testSettings = structuredClone(config.values);
      testSettings.ticket.title = '指定打印机测试';
      testSettings.ticket.waitTemplate = '前方等待人数：test';
      testSettings.ticket.footer = '本凭条仅用于打印检查，不参与排队。';
      await new Promise((resolve, reject) => printer(1, 0, testSettings, '测试凭条', err => err ? reject(err) : resolve()));
      res.json({ ok:true, printer:target, message:'测试任务已发送；实际出纸请在打印机旁确认。本次未取号。' });
    } catch (err) { console.error('测试打印失败:',err.message); res.status(503).json({ error:'测试打印发送失败，请检查打印机、驱动及打印服务' }); }
  });
  win.get('/api/admin/ticket-preview', auth, admin, (req, res) => {
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.type('html').send(ticketHtml(1, 3, config.values));
  });
  win.post('/api/admin/voice-test', auth, admin, (req, res) => {
    if (limited(req, 'voice-test', 3, 60000) || speech.length >= 30) return res.status(429).json({ error:'试听过于频繁，请稍后再试' });
    if (!config.values.voice.enabled) return res.status(400).json({ error:'语音目前已关闭，请先开启并保存' });
    enqueueVoice(1, 1, QueueSchema.format(1, config.values)); res.json({ ok:true });
  });
  win.post('/api/admin/action', auth, admin, (req, res, next) => {
    if (!['PAUSE','RESET'].includes(req.body?.type)) return res.status(400).json({ error:'不支持的管理操作' });
    try { store.action(req.body.type, null); broadcast(); res.json(view()); } catch (err) { next(err); }
  });
  win.post('/api/action', auth, (req, res, next) => {
    if (sessions.get(token(req)).role !== 'operator') return res.status(403).json({ error:'请使用窗口账号进行叫号' });
    const { type, windowId } = req.body || {};
    if (!Number.isInteger(windowId) || windowId < 1 || windowId > 99) return res.status(400).json({ error: '窗口号必须是 1–99 的整数' });
    if (windowId !== sessions.get(token(req)).windowId) return res.status(403).json({ error: '当前登录窗口不匹配，请退出后重新选择窗口' });
    if (type === 'PAUSE' && !config.values.service.operatorPause) return res.status(403).json({ error:'请由管理员进行此操作' });
    if (req.body.targetNum !== undefined && (type !== 'NEXT' || !config.values.service.allowSpecific || !Number.isSafeInteger(req.body.targetNum))) return res.status(403).json({ error:'当前不允许指定号码叫号' });
    if (limited(req, 'action', 60, 60000)) return res.status(429).json({ error: '操作过于频繁' });
    if (['NEXT', 'RECALL'].includes(type) && speech.length >= 30) return res.status(429).json({ error: '播报繁忙，请稍后操作' });
    try {
      const num = store.action(type, windowId, req.body.expectedNum, req.body.targetNum);
      if (type === 'NEXT' || type === 'RECALL') enqueueVoice(num, windowId, store.state.windows[windowId].label);
      broadcast();
      res.json(view());
    } catch (err) { next(err); }
  });
  kiosk.use(express.static(path.join(__dirname, 'kiosk_public')));
  win.use(express.static(path.join(__dirname, 'window_public')));
  for (const app of [kiosk, win]) app.use((err, req, res, next) => {
    const storageError = Boolean(err.code);
    if (storageError) console.error('存储失败:', err);
    res.status(storageError ? 503 : 400).json({ error: storageError ? '数据保存失败，请联系管理员检查磁盘' : (err.type === 'entity.parse.failed' ? '请求格式错误' : err.message) });
  });
  const serverKiosk = require('http').createServer(kiosk);
  const serverWin = require('http').createServer(win);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  serverWin.on('upgrade', (req, socket, head) => {
    if (!authorized(req) || req.headers.origin !== `http://${req.headers.host}`) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => { ws.session = token(req); ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.on('error', () => {}); ws.send(JSON.stringify(view())); });
  });
  function broadcast() { const data = JSON.stringify(view()); for (const client of wss.clients) if (client.readyState === 1) client.send(data); }
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expires < now) sessions.delete(id);
    for (const [id, value] of limits) if (value.until < now) limits.delete(id);
    for (const ws of wss.clients) { if (!ws.alive || !sessions.has(ws.session)) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  }, 30000);
  heartbeat.unref();
  return { store, serverKiosk, serverWin, close: async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await Promise.all([serverKiosk, serverWin].map(s => new Promise(resolve => s.close(resolve))));
  } };
}
if (require.main === module) {
  const system = createSystem();
  system.serverKiosk.listen(Number(process.env.KIOSK_PORT || 8000), process.env.KIOSK_HOST || '0.0.0.0', () => console.log('取号屏: http://localhost:' + (process.env.KIOSK_PORT || 8000)));
  system.serverWin.listen(Number(process.env.WINDOW_PORT || 3000), process.env.WINDOW_HOST || '0.0.0.0', () => console.log('窗口操作台: http://localhost:' + (process.env.WINDOW_PORT || 3000) + '\n管理中心: /admin.html\n大厅展示屏: /display.html\n初始密码请在 data/initpass.txt 下查看，可在管理中心修改。'));
  for (const server of [system.serverKiosk, system.serverWin]) server.on('error', err => { console.error('启动失败:', err.message); process.exit(1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { system.close().then(() => process.exit(0)); });
}
module.exports = { createSystem, ticketHtml };
