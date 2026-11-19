const $ = id => document.getElementById(id);
let values, revision, selected = 'brand', dirty = false, authenticated = false, polling;
const controls = new Map();
const copy = value => structuredClone(value);
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
async function api(url, body) {
  const response = await fetch(url, { signal:AbortSignal.timeout(15000), ...(body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) leave(); throw Error(result.error || '操作失败'); }
  return result;
}
function leave() { authenticated = false; clearInterval(polling); $('admin-console').hidden = true; $('admin-login').hidden = false; $('admin-password').value = ''; }
function showSection(id) {
  selected = id;
  $('config-area').hidden = ['operations','accounts'].includes(id);
  for (const group of QueueSchema.groups) $(`section-${group.id}`).hidden = group.id !== id;
  $('operations').hidden = id !== 'operations'; $('accounts').hidden = id !== 'accounts';
  for (const button of $('settings-nav').querySelectorAll('button')) { const chosen = button.dataset.section === id; button.classList.toggle('selected', chosen); button.setAttribute('aria-current', chosen ? 'page' : 'false'); }
}
function markDirty() { dirty = true; $('save-state').textContent = '有未保存的更改'; preview(); }
function formValues() {
  const next = copy(values);
  for (const group of QueueSchema.groups) for (const [key,,type] of group.fields) {
    const input = controls.get(`${group.id}.${key}`);
    if (type === 'image') continue;
    next[group.id][key] = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value;
  }
  return next;
}
function fill(next) {
  values = copy(next);
  for (const group of QueueSchema.groups) for (const [key,,type] of group.fields) {
    const input = controls.get(`${group.id}.${key}`);
    if (type === 'image') { input.value = ''; continue; }
    if (type === 'checkbox') input.checked = values[group.id][key]; else input.value = values[group.id][key];
  }
  preview();
}
function preview() {
  if (!values) return;
  const v = formValues();
  const sample = QueueSchema.format(1, v);
  const data = { center:v.brand.centerName, number:sample, window:1, wait:3, time:'09:30:00' };
  const text = template => QueueSchema.template(template, data);
  $('preview-center').textContent = v.brand.centerName; $('preview-slogan').textContent = v.brand.slogan;
  const icon = $('preview-icon'); icon.hidden = v.brand.iconMode === 'none';
  if (v.brand.iconMode === 'image' && v.brand.iconImage) { const img = el('img'); img.src = v.brand.iconImage; img.alt = ''; icon.replaceChildren(img); }
  else icon.textContent = v.brand.iconText;
  for (const [id,key] of [['preview-ticket-header','header'],['preview-ticket-title','title'],['preview-number-label','numberLabel'],['preview-wait','waitTemplate'],['preview-time','timeTemplate'],['preview-footer','footer']]) $(id).textContent = text(v.ticket[key]);
  $('preview-number').textContent = sample;
  $('preview-speech').textContent = v.voice.enabled ? QueueSchema.template(v.voice.template, { ...data, number:v.voice.includePrefix ? sample : v.numbering.start }) : '语音播报已关闭';
}
function buildForm() {
  for (const group of QueueSchema.groups) {
    const nav = el('button','',group.title); nav.type = 'button'; nav.dataset.section = group.id; nav.addEventListener('click', () => showSection(group.id)); $('settings-nav').append(nav);
    const section = el('section','card settings-section'); section.id = `section-${group.id}`;
    section.append(el('div','brand','全局个性化'),el('h2','',group.title),el('p','muted',group.description));
    const fields = el('div','settings-fields');
    for (const [key,label,type,initial,min,max] of group.fields) {
      const id = `field-${group.id}-${key}`, wrapper = el('div', type === 'textarea' || type === 'image' ? 'setting-field wide-field' : 'setting-field');
      const title = el('label','',label); title.htmlFor = id;
      let input;
      if (type === 'printer') { input = el('select'); input.append(new Option('跟随 Windows 默认打印机','')); }
      else if (type === 'select') { input = el('select'); min.forEach((value,i) => { const option = el('option','',max[i]); option.value = value; input.append(option); }); }
      else if (type === 'textarea') { input = el('textarea'); input.rows = 3; input.maxLength = max; }
      else { input = el('input'); input.type = type === 'image' ? 'file' : type === 'checkbox' ? 'checkbox' : type; if (type === 'number') { input.min = min; input.max = max; input.step = 1; input.required = true; } if (type === 'text') { input.maxLength = max; input.required = min > 0; } }
      input.id = id; controls.set(`${group.id}.${key}`,input);
      if (type === 'image') {
        input.accept = 'image/png,image/jpeg,image/webp';
        input.addEventListener('change', async () => {
          const file = input.files[0]; if (!file) return;
          if (file.size > 250 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) { $('config-message').textContent = '请使用 250KB 以内的 PNG、JPG 或 WebP 图片'; input.value = ''; return; }
          try { values.brand.iconImage = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); controls.get('brand.iconMode').value = 'image'; markDirty(); }
          catch { $('config-message').textContent = '图片读取失败，请重新选择'; }
        });
        wrapper.append(title,input,el('small','muted','建议使用正方形图片；支持 PNG / JPG / WebP，最大 250KB。'));
        const remove = el('button','secondary','移除已上传图片'); remove.type = 'button'; remove.addEventListener('click', () => { values.brand.iconImage = ''; input.value = ''; controls.get('brand.iconMode').value = 'text'; markDirty(); }); wrapper.append(remove);
      } else if (type === 'checkbox') { const check = el('label','check-field'); check.htmlFor = id; check.append(input,document.createTextNode(label)); wrapper.append(check); input.addEventListener('change',markDirty); }
      else { wrapper.append(title,input); input.addEventListener('input',markDirty); }
      if (type === 'printer') {
        wrapper.classList.add('wide-field');
        const tools = el('div','printer-tools');
        const refresh = el('button','secondary','刷新打印机列表'); refresh.type = 'button'; refresh.addEventListener('click',refreshPrinters);
        const test = el('button','','测试打印一张'); test.type = 'button'; test.id = 'test-print'; test.addEventListener('click',testPrint);
        tools.append(refresh,test); wrapper.append(tools,el('p','muted','使用已保存的目标打印机。测试凭条不占用号码、不改变队列。'));
        const message = el('p','notice'); message.id = 'printer-message'; message.setAttribute('role','status'); wrapper.append(message);
      }
      const tokens = QueueSchema.tokensFor(group.id,key);
      if (tokens.length) {
        input.placeholder = '可插入：' + tokens.map(([token,meaning]) => `${token}（${meaning}）`).join('、');
        const hints = el('div','template-hints'); hints.id = `${id}-hints`; input.setAttribute('aria-describedby',hints.id);
        hints.append(el('small','','点击插入变量：'));
        for (const [token,meaning] of tokens) {
          const button = el('button','template-token',`${token} ${meaning}`); button.type = 'button';
          button.addEventListener('click', () => {
            const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
            if (input.value.length - (end-start) + token.length > max) { $('config-message').textContent = `${label}已达到长度上限`; return; }
            input.setRangeText(token,start,end,'end'); input.focus(); markDirty();
          }); hints.append(button);
        }
        wrapper.append(hints);
      }
      fields.append(wrapper);
    }
    section.append(fields); $('settings-sections').append(section);
  }
  for (const [id,title] of [['operations','运行管理与备份'],['accounts','密码与权限']]) { const button = el('button','nav-separated',title); button.dataset.section = id; button.addEventListener('click',() => showSection(id)); $('settings-nav').append(button); }
}
async function loadSettings() {
  const saved = await api('/api/admin/config'); revision = saved.revision; setPrinterOptions([],saved.values.printing.printerName); fill(saved.values); dirty = false; $('save-state').textContent = '设置已加载'; $('config-message').textContent = ''; QueueUI.apply(saved.values);
  refreshPrinters();
}
function setPrinterOptions(printers, selectedPrinter) {
  const input = controls.get('printing.printerName');
  input.replaceChildren(new Option('跟随 Windows 默认打印机',''), ...printers.map(p => new Option(p.name,p.name)));
  if (selectedPrinter && !printers.some(p => p.name === selectedPrinter)) input.append(new Option(`${selectedPrinter}（已保存，当前列表未找到）`,selectedPrinter));
  input.value = selectedPrinter || '';
}
async function refreshPrinters() {
  const message = $('printer-message'); message.textContent = '正在读取服务器打印机…';
  try { const result = await api('/api/admin/printers'); const selectedPrinter = controls.get('printing.printerName').value; setPrinterOptions(result.printers,selectedPrinter); message.textContent = result.printers.length ? `共 ${result.printers.length} 台，Windows 默认：${result.defaultPrinter || '未设置'}` : '服务器没有已安装的打印机，请先在 Windows 中安装驱动。'; }
  catch (err) { message.textContent = err.message; }
}
async function testPrint() {
  if (dirty) { $('printer-message').textContent = '请先保存全部设置，再测试打印。'; return; }
  if (!confirm('将向已保存的打印机发送一张测试凭条，不会取号。确认打印？')) return;
  $('test-print').disabled = true; $('printer-message').textContent = '正在发送测试任务…';
  try { const result = await api('/api/admin/test-print',{}); $('printer-message').textContent = result.message; }
  catch (err) { $('printer-message').textContent = err.name === 'TimeoutError' ? '等待结果超时，请先查看打印机是否已出纸，再决定是否重试。' : err.message; }
  finally { $('test-print').disabled = false; }
}
async function refreshStatus() {
  try {
    const session = await api('/api/session');
    if (!session.authenticated || session.role !== 'admin') { leave(); return; }
    const status = await api('/api/status');
    for (const key of ['wait','issued','completed','skipped']) $(`op-${key}`).textContent = status[key];
    $('op-status').textContent = status.paused ? '已暂停新取号，当前队列继续办理。' : '取号服务开放中。';
    $('admin-pause').textContent = status.paused ? '恢复取号' : '暂停取号';
    if (status.configRevision !== revision) $('save-state').textContent = '设置有更新，请重新加载后编辑';
  } catch (err) { $('op-status').textContent = err.message; }
}
async function enter() {
  await loadSettings(); authenticated = true; $('admin-login').hidden = true; $('admin-console').hidden = false; showSection(selected);
  await refreshStatus(); clearInterval(polling); polling = setInterval(refreshStatus,5000);
}
$('admin-login-form').addEventListener('submit', async e => {
  e.preventDefault(); e.submitter.disabled = true; $('login-error').textContent = '';
  try { await api('/api/login',{ password:$('admin-password').value, role:'admin' }); $('admin-password').value = ''; await enter(); }
  catch (err) { $('login-error').textContent = err.message; }
  finally { e.submitter.disabled = false; }
});
$('admin-logout').addEventListener('click', async () => { if (dirty && !confirm('还有未保存的设置，确认退出？')) return; try { await api('/api/logout',{}); dirty = false; leave(); } catch (err) { $('config-message').textContent = err.message; } });
$('reload').addEventListener('click', async () => { if (dirty && !confirm('重新加载会放弃未保存的设置，是否继续？')) return; try { await loadSettings(); } catch (err) { $('config-message').textContent = err.message; } });
$('config-form').addEventListener('submit', async e => {
  e.preventDefault();
  for (const [key,input] of controls) {
    if (!input.checkValidity()) { showSection(key.split('.')[0]); input.reportValidity(); return; }
  }
  $('save-config').disabled = true; $('config-message').textContent = '';
  try { const saved = await api('/api/admin/config',{ values:formValues(), revision }); revision = saved.revision; fill(saved.values); dirty = false; $('save-state').textContent = '全部设置已保存'; $('config-message').textContent = '保存成功，大屏与取号页面会自动更新。'; QueueUI.apply(saved.values); }
  catch (err) { $('config-message').textContent = err.message; }
  finally { $('save-config').disabled = false; }
});
$('restore-group').addEventListener('click', () => { if (!confirm('恢复当前分类的默认值？保存后才会生效。')) return; const next = formValues(); next[selected] = copy(QueueSchema.defaults[selected]); fill(next); markDirty(); });
$('voice-test').addEventListener('click', async () => { try { await api('/api/admin/voice-test',{}); $('preview-message').textContent = '已提交试听，请留意服务器音箱。'; } catch (err) { $('preview-message').textContent = err.message; } });
for (const [id,type] of [['admin-pause','PAUSE'],['admin-reset','RESET']]) $(id).addEventListener('click', async () => {
  if (type === 'RESET' && !confirm('确认清零本轮编号与统计？须先完成所有等待及办理中的号码。')) return;
  $(id).disabled = true;
  try { await api('/api/admin/action',{ type }); $('op-message').textContent = '操作成功'; await refreshStatus(); }
  catch (err) { $('op-message').textContent = err.message; }
  finally { $(id).disabled = false; }
});
$('account-form').addEventListener('submit', async e => {
  e.preventDefault(); $('account-message').textContent = '';
  if ($('new-role-password').value !== $('confirm-role-password').value) { $('account-message').textContent = '两次输入的新密码不一致'; return; }
  e.submitter.disabled = true;
  try { await api('/api/settings/password',{ targetRole:$('target-role').value, currentPassword:$('current-admin-password').value, newPassword:$('new-role-password').value }); $('account-form').reset(); $('account-message').textContent = '密码已保存。该类账号的其他登录已失效。'; }
  catch (err) { $('account-message').textContent = err.message; }
  finally { e.submitter.disabled = false; }
});
$('export-config').addEventListener('click', async () => {
  try { const saved = await api('/api/admin/config'); const url = URL.createObjectURL(new Blob([JSON.stringify({ format:'queue-config-v1', values:saved.values }, null, 2)],{type:'application/json'})); const link = el('a'); link.href = url; link.download = '排队系统个性化设置.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
  catch (err) { $('op-message').textContent = err.message; }
});
$('import-config').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try { if (file.size > 512 * 1024) throw Error('设置文件不能超过 512KB'); const imported = JSON.parse(await file.text()); if (imported.format !== 'queue-config-v1') throw Error('设置文件格式不正确');
    if (!imported.values || typeof imported.values !== 'object') throw Error('设置内容无效');
    const next = QueueSchema.withDefaults(imported.values);
    setPrinterOptions([],next.printing.printerName);
    for (const group of QueueSchema.groups) for (const [key] of group.fields) if (next?.[group.id]?.[key] === undefined) throw Error('设置文件缺少字段');
    fill(next); markDirty(); $('op-message').textContent = '已载入，请检查各分类并保存全部设置后生效。'; showSection('brand');
  } catch (err) { $('op-message').textContent = '导入失败：' + err.message; } finally { e.target.value = ''; }
});
window.addEventListener('beforeunload', e => { if (dirty && authenticated) { e.preventDefault(); e.returnValue = ''; } });
buildForm();
api('/api/status').then(s => QueueUI.apply(s.config)).catch(() => {});
api('/api/session').then(s => { if (s.authenticated && s.role === 'admin') return enter(); }).catch(err => { $('login-error').textContent = err.message; });
