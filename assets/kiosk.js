const $ = id => document.getElementById(id);
let busy = false, paused = true, hideTimer;
let settings = QueueSchema.defaults;
function requestId() { return Array.from(crypto.getRandomValues(new Uint8Array(20)), n => n.toString(16).padStart(2, '0')).join(''); }
async function refresh() {
  try { const res = await fetch('/api/status', { signal:AbortSignal.timeout(8000) }); if (!res.ok) throw Error(); const s = await res.json(); settings = s.config; QueueUI.apply(settings); document.body.dataset.kioskTheme = settings.kiosk.theme; $('welcome').textContent = settings.kiosk.welcome; $('ticket-hint').textContent = settings.kiosk.ticketHint; $('waiting').textContent = s.wait; const wasPaused = paused; paused = s.paused; if (!busy) { $('take').disabled = paused; $('take').textContent = paused ? '暂停取号' : settings.kiosk.buttonText; if (paused) $('message').textContent = settings.display.pausedNotice; else if (wasPaused) $('message').textContent = ''; } }
  catch { if (!busy) { $('take').disabled = true; $('take').textContent = '连接中，请稍候…'; } }
}
$('take').addEventListener('click', async () => {
  if (busy || paused) return;
  busy = true; $('take').disabled = true; $('take').textContent = '正在取号…'; $('message').textContent = '';
  clearTimeout(hideTimer); $('ticket').hidden = true; $('idle-hint').hidden = false;
  let id = sessionStorage.getItem('pending-ticket');
  if (!id) { id = requestId(); sessionStorage.setItem('pending-ticket', id); }
  try {
    const res = await fetch('/api/take', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: id }), signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok) { sessionStorage.removeItem('pending-ticket'); throw Error(data.error); }
    sessionStorage.removeItem('pending-ticket');
    $('ticket').hidden = false; $('idle-hint').hidden = true; $('number').textContent = data.label; $('number').classList.toggle('long-number', data.label.length > 6); $('ahead').textContent = `取号时前方等待 ${data.wait} 人`;
    hideTimer = setTimeout(() => { $('ticket').hidden = true; $('idle-hint').hidden = false; }, settings.kiosk.displaySeconds * 1000);
  } catch (err) { $('message').textContent = err.message === 'Failed to fetch' || err.name === 'TimeoutError' ? '网络异常，请重试；重试会确认原取号请求。' : err.message; }
  finally { setTimeout(() => { busy = false; refresh(); }, 2000); }
});
async function poll() { await refresh(); setTimeout(poll,3000); }
poll();
setInterval(() => { $('clock').textContent = new Date().toLocaleString('zh-CN'); }, 1000);
