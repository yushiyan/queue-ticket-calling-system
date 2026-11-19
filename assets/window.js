const $ = id => document.getElementById(id);
const labels = { NEXT:'呼叫', RECALL:'重叫', COMPLETE:'完成', SKIP:'过号', PAUSE:'切换取号状态', RESET:'本轮清零' };
let state, socket, reconnectTimer, pollTimer, active = false, busy = false, selectedWindow;
let preferences = { large:false, history:true, ownHistory:false, confirmSkip:true };
$('login-window').value = localStorage.getItem('window-id') || '1';
const format = item => QueueUI.label(item, state?.config);
async function api(url, body) {
  const res = await fetch(url, { signal:AbortSignal.timeout(15000), ...(body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }) });
  const data = await res.json();
  if (!res.ok) { if (res.status === 401 && active) leave(); throw Error(data.error || '服务异常'); }
  return data;
}
function render(next) {
  state = next; QueueUI.apply(state.config);
  for (const name of ['wait','issued','completed','skipped']) $(name).textContent = state[name];
  const current = state.windows[selectedWindow];
  $('current').textContent = format(current);
  $('current').classList.toggle('extra-large', preferences.large);
  $('queue').replaceChildren(...state.waiting.map(item => { const el = document.createElement('span'); el.className = 'chip'; el.textContent = format(item); return el; }));
  if (!state.wait) $('queue').textContent = '暂无等待，服务有序进行中';
  $('operator-service').hidden = !state.config.service.operatorPause;
  $('service').textContent = state.paused ? '已暂停新取号，已有队列仍可办理。' : '取号服务开放中';
  $('pause').textContent = state.paused ? '恢复取号' : '暂停取号';
  $('history-card').hidden = !preferences.history;
  $('history').replaceChildren(...state.history.filter(h => !preferences.ownHistory || h.win === selectedWindow).slice(0,30).map(item => {
    const row = document.createElement('tr');
    for (const value of [new Date(item.time).toLocaleTimeString('zh-CN'), item.win || '管理', format(item), labels[item.type] || item.type]) { const td = document.createElement('td'); td.textContent = value; row.append(td); } return row;
  }));
  $('specific-call').hidden = !state.config.service.allowSpecific;
  const previousTarget = $('specific-number').value;
  $('specific-number').replaceChildren(...state.waiting.map(item => { const option = document.createElement('option'); option.value = item.num; option.textContent = format(item); return option; }));
  if (state.waiting.some(item => String(item.num) === previousTarget)) $('specific-number').value = previousTarget;
  $('specific-button').disabled = busy || !!current || !state.wait;
  for (const btn of document.querySelectorAll('[data-action]')) {
    const type = btn.dataset.action;
    btn.disabled = busy || (type === 'NEXT' && (!!current || !state.wait)) || (['RECALL','COMPLETE','SKIP'].includes(type) && !current);
  }
}
function connect() {
  if (!active) return;
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
  socket = connection;
  connection.onopen = () => { $('connection').textContent = '实时连接正常'; };
  connection.onmessage = e => { try { render(JSON.parse(e.data)); } catch { $('message').textContent = '接收数据异常'; } };
  connection.onclose = () => { if (active && socket === connection) { $('connection').textContent = '连接恢复中'; clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 2000); } };
  connection.onerror = () => connection.close();
}
async function enter(session) {
  if (session.role === 'admin') { location.href = '/admin.html'; return; }
  selectedWindow = session.windowId;
  $('window-title').textContent = `${selectedWindow} 号窗口`; $('window-badge').textContent = `${selectedWindow} 号窗口`;
  localStorage.setItem('window-id', String(selectedWindow));
  try { preferences = { ...preferences, ...JSON.parse(localStorage.getItem(`window-preferences:${selectedWindow}`) || '{}') }; } catch {}
  render(await api('/api/status'));
  active = true; $('login').hidden = true; $('console').hidden = false;
  connect(); clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try { const session = await api('/api/session'); if (!session.authenticated) { leave(); return; } if (session.role !== 'operator' || session.windowId !== selectedWindow) { location.reload(); return; } render(await api('/api/status')); }
    catch { $('connection').textContent = '服务连接异常'; }
  }, 5000);
}
function leave() { active = false; clearTimeout(reconnectTimer); clearInterval(pollTimer); socket?.close(); $('settings').close(); $('console').hidden = true; $('login').hidden = false; $('password').value = ''; }
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true; $('login-error').textContent = '';
  try { const session = await api('/api/login', { password:$('password').value, windowId:Number($('login-window').value), role:'operator' }); $('password').value = ''; await enter(session); }
  catch (err) { $('login-error').textContent = err.message; }
  finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await api('/api/logout', {}); leave(); } catch (err) { $('message').textContent = err.message; } });
$('settings-open').addEventListener('click', () => {
  for (const [id,key] of [['pref-large','large'],['pref-history','history'],['pref-own-history','ownHistory'],['pref-confirm-skip','confirmSkip']]) $(id).checked = preferences[key];
  $('preferences-message').textContent = ''; $('settings').showModal();
});
$('settings-close').addEventListener('click', () => $('settings').close());
$('preferences-form').addEventListener('submit', e => {
  e.preventDefault();
  for (const [id,key] of [['pref-large','large'],['pref-history','history'],['pref-own-history','ownHistory'],['pref-confirm-skip','confirmSkip']]) preferences[key] = $(id).checked;
  localStorage.setItem(`window-preferences:${selectedWindow}`, JSON.stringify(preferences)); render(state); $('settings').close();
});
async function act(type, targetNum) {
  if (busy) return;
  if (type === 'RESET' && !confirm('确认将本轮号码和统计清零？须先处理完全部等待与办理中的号码，历史记录会保留。')) return;
  if (type === 'SKIP' && preferences.confirmSkip && !confirm(`确认将 ${format(state.windows[selectedWindow])} 标记为过号？`)) return;
  if (targetNum !== undefined && !confirm(`确认呼叫指定号码 ${format(state.waiting.find(t => t.num === targetNum))}？`)) return;
  const expectedNum = state.windows[selectedWindow]?.num || null;
  busy = true; $('message').textContent = ''; render(state);
  try { render(await api('/api/action', { type, windowId:selectedWindow, expectedNum, ...(targetNum === undefined ? {} : { targetNum }) })); }
  catch (err) { $('message').textContent = err.message + '；若网络中断，请先确认当前号码再操作。'; }
  finally { busy = false; if (state) render(state); }
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => act(button.dataset.action));
$('specific-button').addEventListener('click', () => act('NEXT', Number($('specific-number').value)));
api('/api/status').then(s => QueueUI.apply(s.config)).catch(() => {});
api('/api/session').then(s => { if (s.authenticated) return enter(s); }).catch(() => { $('login-error').textContent = '暂时无法连接服务'; });
