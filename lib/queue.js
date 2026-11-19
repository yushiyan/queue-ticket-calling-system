const fs = require('fs');
const path = require('path');

class QueueStore {
  constructor(file) {
    this.file = file;
    this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
      version: 1, currentNumber: 0, queue: [], windows: {}, history: [], requests: {}, paused: false, issued: 0, completed: 0, skipped: 0
    };
    const s = this.state;
    const count = n => Number.isSafeInteger(n) && n >= 0;
    const ticket = t => t && count(t.num) && t.num > 0 && t.num <= s.currentNumber && typeof t.time === 'string';
    if (!s || s.version !== 1 || !count(s.currentNumber) || !Array.isArray(s.queue) || !s.queue.every(ticket)
      || !s.windows || typeof s.windows !== 'object' || Array.isArray(s.windows)
      || !Object.entries(s.windows).every(([win, t]) => /^[1-9]\d?$/.test(win) && ticket(t))
      || !Array.isArray(s.history) || !s.history.every(h => h && typeof h.type === 'string' && typeof h.time === 'string')
      || !s.requests || typeof s.requests !== 'object' || Array.isArray(s.requests)
      || !Object.values(s.requests).every(t => t && count(t.num) && t.num > 0 && count(t.wait))
      || typeof s.paused !== 'boolean' || ![s.issued, s.completed, s.skipped].every(count)) {
      throw new Error('队列数据格式异常，请保留数据文件并检查');
    }
    const numbers = [...s.queue, ...Object.values(s.windows)].map(t => t.num);
    if (new Set(numbers).size !== numbers.length || s.issued !== s.currentNumber || s.issued !== s.completed + s.skipped + numbers.length) throw new Error('队列数据不一致，请保留数据文件并检查');
    // Older data used A001-style labels; preserve those printed numbers on upgrade.
    for (const item of [...s.queue, ...Object.values(s.windows), ...s.history, ...Object.values(s.requests)]) {
      if (item.num && !item.label) item.label = `A${String(item.num).padStart(3, '0')}`;
    }
  }
  change(fn) {
    const next = structuredClone(this.state);
    const result = fn(next);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    this.state = next;
    return result;
  }
  take(id, labelFor = n => `A${String(n).padStart(3, '0')}`, maxWaiting = 2000) {
    if (this.state.requests[id]) return { ...this.state.requests[id], duplicate: true };
    return this.change(s => {
      if (s.paused) throw new Error('取号已暂停，请咨询工作人员');
      if (s.queue.length >= maxWaiting) throw new Error('等待人数已达上限，请咨询工作人员');
      const ticket = { num: ++s.currentNumber, wait: s.queue.length };
      ticket.label = labelFor(ticket.num);
      s.queue.push({ num: ticket.num, label: ticket.label, time: new Date().toISOString() });
      s.issued++;
      s.requests[id] = ticket;
      const keys = Object.keys(s.requests);
      if (keys.length > 1000) delete s.requests[keys[0]];
      return ticket;
    });
  }
  action(type, win, expectedNum, targetNum) {
    return this.change(s => {
      const current = s.windows[win];
      if (['RECALL', 'COMPLETE', 'SKIP'].includes(type) && expectedNum !== current?.num) throw new Error('窗口号码已变化，请刷新后确认');
      let num, label;
      if (type === 'NEXT') {
        if (current) throw new Error('请先完成或标记过号，再叫下一位');
        if (!s.queue.length) throw new Error('目前大厅没有人排队');
        const index = targetNum === undefined ? 0 : s.queue.findIndex(t => t.num === targetNum);
        if (index < 0) throw new Error('指定号码已不在等待队列中');
        const item = s.queue.splice(index, 1)[0];
        num = item.num; label = item.label;
        s.windows[win] = { num, label, time: new Date().toISOString() };
      } else if (['RECALL', 'COMPLETE', 'SKIP'].includes(type)) {
        if (!current) throw new Error('当前窗口没有正在办理的号码');
        num = current.num;
        label = current.label;
        if (type !== 'RECALL') {
          delete s.windows[win];
          s[type === 'COMPLETE' ? 'completed' : 'skipped']++;
        }
      } else if (type === 'PAUSE') s.paused = !s.paused;
      else if (type === 'RESET') {
        if (s.queue.length || Object.keys(s.windows).length) throw new Error('仍有等待或办理中的号码，不能清零');
        s.currentNumber = s.issued = s.completed = s.skipped = 0;
        s.requests = {};
      } else throw new Error('未知操作');
      s.history.unshift({ type, win, num, label, time: new Date().toISOString() });
      s.history = s.history.slice(0, 500);
      return num;
    });
  }
  view() {
    const { queue, requests, ...rest } = this.state;
    return { ...rest, wait: queue.length, waiting: queue.slice(0, 100), type: 'UPDATE' };
  }
}
module.exports = QueueStore;
