const $ = id => document.getElementById(id);
let settings = QueueSchema.defaults;
const number = item => QueueUI.label(item, settings);
function element(tag, className, text) { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; }
let lastSignature = '';
async function refresh() {
  try {
    const res = await fetch('/api/status', { signal:AbortSignal.timeout(8000) }); if (!res.ok) throw Error(); const s = await res.json();
    settings = s.config; QueueUI.apply(settings);
    $('number-caption').textContent = settings.display.numberCaption;
    $('recent-panel').hidden = !settings.display.showRecent;
    $('waiting-panel').hidden = !settings.display.showWait;
    $('completed-line').hidden = !settings.display.showCompleted;
    $('hall-clock').hidden = !settings.display.showClock;
    document.querySelector('.hall-layout').classList.toggle('without-sidebar', !settings.display.showRecent && !settings.display.showWait);
    $('wait').textContent = s.wait; $('completed').textContent = s.completed;
    const reset = s.history.findIndex(h => h.type === 'RESET');
    const calls = (reset < 0 ? s.history : s.history.slice(0, reset)).filter(h => h.type === 'NEXT' || h.type === 'RECALL');
    const last = calls[0];
    const signature = JSON.stringify([s.windows, calls.slice(0,8), s.configRevision]);
    if (signature !== lastSignature) {
      $('latest-number').textContent = last ? number(last) : '等候叫号';
      $('latest-number').classList.toggle('hero-empty', !last);
      $('latest-number').classList.toggle('long-number', !!last && number(last).length > 6);
      $('latest-window').textContent = last ? String(last.win).padStart(2,'0') : '—';
      $('latest-label').textContent = last?.type === 'RECALL' ? '再次呼叫' : '最新呼叫';
      $('call-hint').textContent = last ? QueueSchema.template(settings.display.callTemplate, { number:number(last), window:last.win, center:settings.brand.centerName }) : '欢迎光临，请先前往自助取号机领取号码';
      $('windows').replaceChildren(...Object.entries(s.windows).map(([win, item]) => {
        const card = element('article', 'window-tile');
        card.append(element('span', 'window-name', `${String(win).padStart(2,'0')} 号窗口`), element('strong', `window-ticket${number(item).length > 6 ? ' long-number' : ''}`, number(item)), element('span', 'window-status', '办理中')); return card;
      }));
      if (!Object.keys(s.windows).length) $('windows').append(element('div', 'hall-empty', '当前暂无办理中的号码，请耐心等候叫号'));
      $('recent').replaceChildren(...calls.slice(0,settings.display.recentCount).map(h => {
        const row = element('div', 'recent-row'); row.append(element('strong', '', number(h)), element('span', 'recent-arrow', '→'), element('span', '', `${String(h.win).padStart(2,'0')} 号窗口`)); return row;
      }));
      if (!calls.length) $('recent').append(element('div', 'hall-empty', '暂无叫号记录'));
      lastSignature = signature;
    }
    $('notice').textContent = s.paused ? settings.display.pausedNotice : settings.display.notice;
    $('network').textContent = '● 服务正常'; $('network').classList.remove('offline');
  } catch { $('network').textContent = '● 连接恢复中'; $('network').classList.add('offline'); $('notice').textContent = '正在恢复连接，请以现场语音广播为准。'; }
}
function tick() { const now = new Date(); $('clock').textContent = now.toLocaleTimeString('zh-CN', { hour12:false }); $('date').textContent = now.toLocaleDateString('zh-CN', {year:'numeric',month:'long',day:'numeric',weekday:'long'}); }
async function poll() { await refresh(); setTimeout(poll, 2000); }
poll(); tick(); setInterval(tick, 1000);
