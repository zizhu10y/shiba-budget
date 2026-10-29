'use strict';

// ---------- 数据 ----------
// 货币由页面设置（人民币版在 cny/index.html 里设 window.CURRENCY = 'CNY'），默认澳元
const CUR = window.CURRENCY === 'CNY' ? 'CNY' : 'AUD';
const CUR_CFG = { AUD: { locale: 'en-AU', sym: '$', rentFreq: 'week' }, CNY: { locale: 'zh-CN', sym: '¥', rentFreq: 'month' } }[CUR];
// 两个版本在同一个域名下，存储键要分开；澳元版沿用原来的键，已有数据不受影响
const KEY = CUR === 'AUD' ? 'shiba-budget-v1' : 'shiba-budget-cny-v1';
const FREQ = { week: '每周', fortnight: '每两周', month: '每月', year: '每年' };
const TO_MONTH = { week: 52 / 12, fortnight: 26 / 12, month: 1, year: 1 / 12 };
const CATS = [
  { id: 'food', name: '餐饮', e: '🍜' },
  { id: 'grocery', name: '买菜', e: '🥬' },
  { id: 'transport', name: '交通', e: '🚃' },
  { id: 'shopping', name: '购物', e: '🛍️' },
  { id: 'fun', name: '娱乐', e: '🎮' },
  { id: 'coffee', name: '咖啡', e: '☕' },
  { id: 'daily', name: '日用', e: '🧻' },
  { id: 'other', name: '其他', e: '🐾' },
];

const blank = () => ({
  v: 1,
  settings: { income: 0, incomeFreq: 'month', rent: 0, rentFreq: CUR_CFG.rentFreq, fixed: [] },
  expenses: [],
  goals: [],
});

let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.settings) return { ...blank(), ...s, settings: { ...blank().settings, ...s.settings } };
  } catch (e) {}
  return blank();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('保存失败：存储空间不可用'); }
}

// ---------- 工具 ----------
const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat(CUR_CFG.locale, { style: 'currency', currency: CUR });
const money = (n) => fmt.format(Math.round(n * 100) / 100);
const moneyShort = (n) => money(n).replace(/\.00$/, '');
const toMonth = (amt, freq) => (Number(amt) || 0) * (TO_MONTH[freq] || 1);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const thisMonth = () => ymd(new Date()).slice(0, 7);
const catOf = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 1800);
}

// ---------- 计算 ----------
function fixedMonthly() {
  const s = state.settings;
  return toMonth(s.rent, s.rentFreq) + s.fixed.reduce((a, f) => a + toMonth(f.amount, f.freq), 0);
}
// 某个月（'YYYY-MM'）的收支；收入和固定支出按当前设置计算
function monthStats(m) {
  const income = toMonth(state.settings.income, state.settings.incomeFreq);
  const fixed = fixedMonthly();
  const monthExp = state.expenses.filter((e) => e.date.startsWith(m));
  const spent = monthExp.reduce((a, e) => a + e.amount, 0);
  const saved = state.goals.reduce(
    (a, g) => a + g.deposits.filter((d) => d.date.startsWith(m)).reduce((x, d) => x + d.amount, 0), 0);
  const budget = income - fixed;
  const byCat = {};
  monthExp.forEach((e) => (byCat[e.cat] = (byCat[e.cat] || 0) + e.amount));
  return { income, fixed, spent, saved, budget, remaining: budget - spent - saved, monthExp, byCat };
}
function summary() {
  const now = new Date();
  const s = monthStats(thisMonth());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const daysLeft = daysInMonth - day + 1;
  const today = ymd(now);
  const spentToday = s.monthExp.filter((e) => e.date === today).reduce((a, e) => a + e.amount, 0);
  // 今天的额度 = (剩余 + 今天已花) ÷ 剩余天数（含今天）
  const todayBudget = (s.remaining + spentToday) / daysLeft;
  // 按目前（不含今天）的日均花销推算月底总花销
  const pastSpent = s.spent - spentToday;
  const projected = day > 3 ? pastSpent / (day - 1) * daysInMonth : null;
  return { ...s, daysLeft, daysInMonth, spentToday, todayBudget, todayLeft: todayBudget - spentToday,
    daily: s.remaining / daysLeft, projected };
}
// 第一笔数据所在的月份（没有数据就是本月）
function firstMonth() {
  const dates = [...state.expenses.map((e) => e.date), ...state.goals.flatMap((g) => g.deposits.map((d) => d.date))];
  return dates.length ? dates.sort()[0].slice(0, 7) : thisMonth();
}

// ---------- 页面 ----------
let tab = 'home';
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#view').innerHTML = { home: homeView, overview: overviewView, goals: goalsView, settings: settingsView }[tab]();
  window.scrollTo(0, 0);
}

function homeView() {
  const s = summary();
  const hasSetup = s.income > 0;
  const used = s.budget > 0 ? Math.min(100, ((s.spent + s.saved) / s.budget) * 100) : 0;
  const neg = s.remaining < 0;
  const mood = !hasSetup ? '🐕 先去「设置」填收入吧' : neg ? '🥺 呜…这个月超支了' : used > 80 ? '🐕 省着点花哦' : '🐕 汪！这个月还能花';
  const list = s.monthExp.slice().sort((a, b) => (b.date + b.t).localeCompare(a.date + a.t));
  return `
    <h1>${new Date().getMonth() + 1} 月</h1>
    <section class="card hero">
      <div class="label">${mood}</div>
      <div class="big num ${neg ? 'neg' : ''}">${money(s.remaining)}</div>
      <div class="bar ${neg ? 'over' : ''}"><i style="width:${neg ? 100 : used}%"></i></div>
      <div class="daily">
        <span class="label">每天可花</span>
        <b class="num ${neg ? 'neg' : ''}">${money(Math.max(0, s.daily))}</b>
        <span class="label">· 剩 ${s.daysLeft} 天</span>
      </div>
    </section>
    ${hasSetup ? homeWarning(s) : ''}
    <section class="card rows">
      <div class="row"><span>月收入</span><span class="num">${money(s.income)}</span></div>
      <div class="row"><span>固定支出</span><span class="num">−${money(s.fixed)}</span></div>
      <div class="row"><span>本月已花</span><span class="num">−${money(s.spent)}</span></div>
      ${s.saved ? `<div class="row"><span>存入目标</span><span class="num">−${money(s.saved)}</span></div>` : ''}
      <div class="row"><span>今天额度</span><span class="num">${money(Math.max(0, s.todayBudget))}</span></div>
      <div class="row"><span>今天已花</span><span class="num">${money(s.spentToday)}</span></div>
    </section>
    <h2>本月明细</h2>
    <div class="list">
      ${list.length ? list.map((e) => {
        const c = catOf(e.cat);
        return `<div class="item">
          <div class="emoji">${c.e}</div>
          <div class="mid"><div>${c.name}</div><div>${e.date.slice(5).replace('-', '/')}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
          <div class="amt num">${money(e.amount)}</div>
          <button class="del" data-del-exp="${e.id}" aria-label="删除">×</button>
        </div>`;
      }).join('') : '<div class="empty">🐾 还没有记录，点右下角 ＋ 记一笔</div>'}
    </div>`;
}

// ---------- 总览 ----------
let ovMode = 'month', ovMonth = thisMonth(), ovYear = new Date().getFullYear();
const shiftMonth = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5) - 1 + n, 1); return ymd(d).slice(0, 7); };

function catBreakdown(byCat) {
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  if (!rows.length) return '<div class="empty">🐾 这段时间没有支出</div>';
  return rows.map(([id, v]) => {
    const c = catOf(id), pct = (v / total) * 100;
    return `<div class="item cat-row">
      <div class="emoji">${c.e}</div>
      <div class="mid"><div>${c.name} <small>${pct.toFixed(0)}%</small></div><div class="bar thin"><i style="width:${pct}%"></i></div></div>
      <div class="amt num">${money(v)}</div>
    </div>`;
  }).join('');
}

function statRows(s, label) {
  return `<div class="row"><span>收入</span><span class="num">${money(s.income)}</span></div>
    <div class="row"><span>固定支出</span><span class="num">−${money(s.fixed)}</span></div>
    <div class="row"><span>日常花销</span><span class="num">−${money(s.spent)}</span></div>
    ${s.saved ? `<div class="row"><span>存入目标</span><span class="num">−${money(s.saved)}</span></div>` : ''}
    <div class="row total"><span>${label}</span><span class="num ${s.remaining < 0 ? 'neg' : ''}">${money(s.remaining)}</span></div>`;
}

function overviewView() {
  const seg = `<div class="seg ov-seg">
    <button data-ov="month" class="${ovMode === 'month' ? 'on' : ''}">月</button>
    <button data-ov="year" class="${ovMode === 'year' ? 'on' : ''}">年</button></div>`;
  return `<h1>总览</h1>${seg}` + (ovMode === 'month' ? monthOverview() : yearOverview());
}

function monthOverview() {
  const m = ovMonth, cur = m === thisMonth();
  const s = monthStats(m);
  const over = s.remaining < 0;
  return `
    <div class="pager">
      <button data-ov-shift="-1" ${m <= firstMonth() ? 'disabled' : ''} aria-label="上个月">‹</button>
      <strong>${m.slice(0, 4)} 年 ${+m.slice(5)} 月</strong>
      <button data-ov-shift="1" ${cur ? 'disabled' : ''} aria-label="下个月">›</button>
    </div>
    <section class="card rows">
      ${over ? `<div class="warn">🥺 这个月超支了 ${money(-s.remaining)}</div>` : ''}
      ${statRows(s, cur ? '目前剩余' : '当月结余')}
    </section>
    <h2>分类</h2>
    <div class="list">${catBreakdown(s.byCat)}</div>`;
}

function yearOverview() {
  const y = ovYear, nowY = new Date().getFullYear();
  const start = firstMonth(), end = thisMonth();
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
  const stats = months.map((m) => (m >= start && m <= end ? monthStats(m) : null));
  const counted = stats.filter(Boolean);
  const tot = { income: 0, fixed: 0, spent: 0, saved: 0, remaining: 0 }, byCat = {};
  counted.forEach((s) => {
    for (const k in tot) tot[k] += s[k];
    for (const c in s.byCat) byCat[c] = (byCat[c] || 0) + s.byCat[c];
  });
  // 柱子 = 日常花销 + 存入目标；虚线 = 每月可花额度
  const budget = counted[0] ? counted[0].budget : 0;
  const max = Math.max(budget, ...counted.map((s) => s.spent + s.saved), 1);
  const overMonths = counted.filter((s) => s.remaining < 0).length;
  return `
    <div class="pager">
      <button data-ov-year="-1" ${y <= +firstMonth().slice(0, 4) ? 'disabled' : ''} aria-label="上一年">‹</button>
      <strong>${y} 年</strong>
      <button data-ov-year="1" ${y >= nowY ? 'disabled' : ''} aria-label="下一年">›</button>
    </div>
    ${counted.length ? `
    <section class="card rows">
      ${overMonths ? `<div class="warn">🥺 有 ${overMonths} 个月超支</div>` : ''}
      <div class="row muted-note"><span>统计 ${counted.length} 个月</span><span></span></div>
      ${statRows(tot, '全年结余')}
    </section>
    <section class="card">
      <div class="chart" style="--b:${(budget / max).toFixed(4)}">
        ${budget > 0 ? '<div class="budget-line"></div>' : ''}
        ${stats.map((s, i) => `<button class="col ${s ? '' : 'off'} ${s && s.remaining < 0 ? 'over' : ''}" ${s ? `data-ov-month="${months[i]}"` : 'disabled'}
            aria-label="${i + 1} 月 ${s ? money(s.spent + s.saved) : '无数据'}">
          <i style="height:${s ? ((s.spent + s.saved) / max) * 100 : 0}%"></i><span>${i + 1}</span></button>`).join('')}
      </div>
      <div class="legend"><span><i class="sw"></i>每月花销+存入</span>${budget > 0 ? `<span><i class="sw dash"></i>每月可花 ${moneyShort(Math.round(budget))}</span>` : ''}</div>
      <p class="hint">点柱子看那个月的明细</p>
    </section>
    <h2>全年分类</h2>
    <div class="list">${catBreakdown(byCat)}</div>`
    : '<div class="card empty">🐾 这一年还没有记录</div>'}`;
}

// 首页预警：已超支 > 今天超额 > 按速度月底会超支
function homeWarning(s) {
  if (s.remaining < 0) return `<div class="warn card">🥺 本月已超支 ${money(-s.remaining)}，剩下 ${s.daysLeft} 天尽量别花啦</div>`;
  if (s.todayLeft < 0) return `<div class="warn card soft">🐕 今天超出额度 ${money(-s.todayLeft)}，后面几天要省一点哦</div>`;
  const cap = s.budget - s.saved;
  if (s.projected != null && s.projected > cap) {
    return `<div class="warn card soft">📈 按现在每天的花法，月底约超支 ${money(s.projected - cap)}</div>`;
  }
  return '';
}

function goalsView() {
  return `
    <h1>存钱目标 🦴</h1>
    ${state.goals.map((g) => {
      const saved = g.deposits.reduce((a, d) => a + d.amount, 0);
      const pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0;
      return `<section class="card goal">
        <div class="top"><span class="name">${esc(g.name)}</span><span class="pct num">${Math.floor(pct)}%${pct >= 100 ? ' 🎉' : ''}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="sub num">已存 ${money(saved)} / ${moneyShort(g.target)}${pct < 100 ? ` · 还差 ${money(g.target - saved)}` : ''}</div>
        <div class="actions">
          <button class="btn" data-deposit="${g.id}">存入</button>
          <button class="btn soft" data-withdraw="${g.id}">取出</button>
          <button class="btn ghost" data-edit-goal="${g.id}">编辑</button>
        </div>
      </section>`;
    }).join('') || '<div class="card empty">还没有目标，给柴柴定个小目标吧</div>'}
    <button class="btn" data-new-goal>＋ 新目标</button>
    <p class="hint">存入的钱会从当月「剩余可花」中扣除。</p>`;
}

function settingsView() {
  const s = state.settings;
  const otherTotal = s.fixed.reduce((a, f) => a + toMonth(f.amount, f.freq), 0);
  return `
    <h1>设置</h1>
    <div class="list">
      <button class="set-row" data-set="income"><span>收入</span><span class="chev num">${moneyShort(s.income)} ${FREQ[s.incomeFreq]}</span></button>
      <button class="set-row" data-set="rent"><span>房租</span><span class="chev num">${moneyShort(s.rent)} ${FREQ[s.rentFreq]}</span></button>
      <button class="set-row" data-set="fixed"><span>其他固定支出</span><span class="chev num">${s.fixed.length} 项 · ${money(otherTotal)}/月</span></button>
    </div>
    <p class="hint">换算按 1 年 52 周：每周 × 52 ÷ 12 = 每月。固定支出合计 ${money(fixedMonthly())}/月。</p>
    <h2>备份</h2>
    <button class="btn soft" data-export>导出 JSON 备份</button>
    <button class="btn ghost" data-import>从 JSON 导入</button>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
    <p class="hint">数据只保存在本机浏览器里，换手机或清除 Safari 数据前记得先导出。</p>
    <h2>危险操作</h2>
    <button class="btn danger" data-reset>清空所有数据</button>
    <p class="hint" style="text-align:center;margin-top:24px">🐕 柴柴账本 · 金额单位 ${CUR}</p>`;
}

// ---------- 记一笔 ----------
let amt = '', cat = 'food';
function openAdd() {
  amt = '';
  cat = 'food';
  $('#addNote').value = '';
  $('#addDate').value = ymd(new Date());
  $('#catGrid').innerHTML = CATS.map((c) => `<button class="cat" data-cat="${c.id}"><span>${c.e}</span>${c.name}</button>`).join('');
  $('#keypad').innerHTML = '<button class="key ok" data-k="ok">完成</button>' +
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `<button class="key" data-k="${k}">${k}</button>`).join('');
  updateAdd();
  open('#addSheet');
}
function updateAdd() {
  $('#addAmount').textContent = CUR_CFG.sym + (amt || '0');
  document.querySelectorAll('.cat').forEach((b) => b.classList.toggle('sel', b.dataset.cat === cat));
  $('.key.ok').disabled = !(parseFloat(amt) > 0);
  const w = addWarning(parseFloat(amt) || 0);
  const el = $('#addWarn');
  el.hidden = !w;
  if (w) { el.textContent = w.text; el.className = 'add-warn ' + w.level; }
}
// 记这笔之前的超支检查：level 'over' = 会让当月超支，'tight' = 超过今天额度
function addWarning(n) {
  if (!(n > 0) || !(state.settings.income > 0)) return null;
  const date = $('#addDate').value || ymd(new Date());
  const m = date.slice(0, 7);
  if (m !== thisMonth()) {
    const after = monthStats(m).remaining - n;
    return after < 0 ? { level: 'over', text: `⚠️ 这笔会让 ${+m.slice(5)} 月超支 ${money(-after)}` } : null;
  }
  const s = summary();
  const after = s.remaining - n;
  if (after < 0) {
    return { level: 'over', text: s.remaining < 0
      ? `⚠️ 本月已经超支，记下后共超支 ${money(-after)}`
      : `⚠️ 这笔会让本月超支 ${money(-after)}` };
  }
  if (date === ymd(new Date()) && n > s.todayLeft) {
    return { level: 'tight', text: `🐕 超过今天额度（还剩 ${money(Math.max(0, s.todayLeft))}），之后每天可花降到 ${money(after / s.daysLeft)}` };
  }
  return null;
}
function pressKey(k) {
  if (k === 'ok') return commitAdd();
  if (k === '⌫') amt = amt.slice(0, -1);
  else if (k === '.') { if (!amt.includes('.')) amt = (amt || '0') + '.'; }
  else {
    const [i, d] = amt.split('.');
    if (d !== undefined && d.length >= 2) return;
    if (d === undefined && i.length >= 7) return;
    amt = amt === '0' ? k : amt + k;
  }
  updateAdd();
}
function commitAdd() {
  const n = Math.round(parseFloat(amt) * 100) / 100;
  if (!(n > 0)) return;
  const w = addWarning(n);
  if (w && w.level === 'over' && !confirm(`${w.text.replace('⚠️ ', '')}。\n还要记下这笔吗？`)) return;
  state.expenses.push({
    id: uid(), amount: n, cat,
    note: $('#addNote').value.trim(),
    date: $('#addDate').value || ymd(new Date()),
    t: new Date().toTimeString().slice(0, 8),
  });
  save();
  close('#addSheet');
  tab = 'home';
  render();
  toast(w && w.level === 'over' ? `🥺 已记下，本月超支了` : `${catOf(cat).e} 记下 ${money(n)}`);
}

// ---------- 通用表单 ----------
let onFormSave = null;
function openForm(title, html, saveFn, afterRender) {
  $('#formTitle').textContent = title;
  $('#formBody').innerHTML = html;
  onFormSave = saveFn;
  $('#formBody').oninput = null;
  afterRender && afterRender($('#formBody'));
  open('#formSheet');
}
const moneyInput = (name, val, ph = '0.00') =>
  `<input name="${name}" type="text" inputmode="decimal" placeholder="${ph}" value="${val ? val : ''}">`;
const num = (v) => Math.max(0, Math.round((parseFloat(String(v).replace(/[^\d.]/g, '')) || 0) * 100) / 100);
const segHtml = (name, val, keys) =>
  `<div class="seg" data-seg="${name}">${keys.map((k) => `<button type="button" data-v="${k}" class="${k === val ? 'on' : ''}">${FREQ[k]}</button>`).join('')}</div><input type="hidden" name="${name}" value="${val}">`;
const freqSelect = (val) =>
  `<select>${Object.keys(FREQ).map((k) => `<option value="${k}" ${k === val ? 'selected' : ''}>${FREQ[k].replace('每', '/')}</option>`).join('')}</select>`;

function amountFreqForm(title, field, freqField, freqs, label) {
  const s = state.settings;
  openForm(title, `
    <label><span>${label}</span>${moneyInput('amt', s[field])}</label>
    <label><span>频率</span>${segHtml('freq', s[freqField], freqs)}</label>
    <div class="calc num" data-calc></div>`,
    (f) => { s[field] = num(f.amt.value); s[freqField] = f.freq.value; },
    (form) => {
      const upd = () => {
        const v = toMonth(num(form.amt.value), form.freq.value);
        form.querySelector('[data-calc]').textContent = form.freq.value === 'month' ? '' : `≈ 每月 ${money(v)}`;
      };
      form.oninput = upd;
      upd();
      setTimeout(() => form.amt.focus(), 250);
    });
}

function fixedLine(f = { name: '', amount: '', freq: 'month' }) {
  return `<div class="fixed-line">
    <input class="n" placeholder="名称，如 话费" value="${esc(f.name)}" maxlength="20">
    <input class="a" inputmode="decimal" placeholder="金额" value="${f.amount || ''}">
    ${freqSelect(f.freq)}
    <button type="button" class="x" data-rm-line aria-label="删除">×</button>
  </div>`;
}
function fixedForm() {
  openForm('其他固定支出', `
    <div data-lines>${state.settings.fixed.map(fixedLine).join('')}</div>
    <button type="button" class="btn soft" data-add-line style="margin-top:12px">＋ 添加一项</button>
    <p class="hint">例如话费、网费、保险、订阅、交通卡。</p>`,
    (form) => {
      state.settings.fixed = [...form.querySelectorAll('.fixed-line')].map((l) => ({
        name: l.querySelector('.n').value.trim() || '固定支出',
        amount: num(l.querySelector('.a').value),
        freq: l.querySelector('select').value,
      })).filter((f) => f.amount > 0);
    },
    (form) => { if (!state.settings.fixed.length) form.querySelector('[data-lines]').innerHTML = fixedLine(); });
}

function goalForm(g) {
  openForm(g ? '编辑目标' : '新目标', `
    <label><span>目标名称</span><input name="name" placeholder="如 日本旅行" value="${esc(g?.name)}" maxlength="20"></label>
    <label><span>目标金额 (${CUR})</span>${moneyInput('target', g?.target)}</label>
    ${g ? '<button type="button" class="btn danger" data-del-goal style="margin-top:20px">删除这个目标</button>' : ''}`,
    (f) => {
      const name = f.name.value.trim(), target = num(f.target.value);
      if (!name || !target) { toast('请填写名称和金额'); return false; }
      if (g) Object.assign(g, { name, target });
      else state.goals.push({ id: uid(), name, target, deposits: [] });
    },
    (form) => {
      const del = form.querySelector('[data-del-goal]');
      if (del) del.onclick = () => {
        if (!confirm(`删除「${g.name}」？`)) return;
        state.goals = state.goals.filter((x) => x !== g);
        save(); close('#formSheet'); render();
      };
      if (!g) setTimeout(() => form.name.focus(), 250);
    });
}

function depositForm(g, sign) {
  openForm(sign > 0 ? `存入 · ${g.name}` : `取出 · ${g.name}`, `
    <label><span>金额 (${CUR})</span>${moneyInput('amt', '')}</label>`,
    (f) => {
      const n = num(f.amt.value);
      if (!n) { toast('请输入金额'); return false; }
      const after = summary().remaining - sign * n;
      if (sign > 0 && state.settings.income > 0 && after < 0 &&
        !confirm(`存入后本月会超支 ${money(-after)}，还要存吗？`)) return false;
      g.deposits.push({ date: ymd(new Date()), amount: sign * n });
      toast(sign > 0 ? `🦴 存入 ${money(n)}` : `取出 ${money(n)}`);
    },
    (form) => setTimeout(() => form.amt.focus(), 250));
}

// ---------- 备份 ----------
async function exportData() {
  const name = `shiba-budget-${CUR.toLowerCase()}-${ymd(new Date())}.json`;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  // iPhone 主屏幕模式下用系统分享面板最稳（可存到「文件」或发给自己）
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !d.settings || !Array.isArray(d.expenses)) throw 0;
      if (!confirm(`导入将覆盖当前数据（${d.expenses.length} 条支出，${(d.goals || []).length} 个目标），继续？`)) return;
      state = { ...blank(), ...d, settings: { ...blank().settings, ...d.settings }, goals: d.goals || [] };
      save(); render(); toast('✅ 导入成功');
    } catch (e) { toast('文件格式不对'); }
  };
  r.readAsText(file);
}

// ---------- 弹层 ----------
function open(sel) { $(sel).hidden = false; }
function close(sel) { $(sel).hidden = true; }

// ---------- 事件 ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .sheet-bg');
  if (!t) return;
  const d = t.dataset;

  if (t.classList.contains('sheet-bg')) { if (e.target === t) t.hidden = true; return; }
  if ('close' in d) return (t.closest('.sheet-bg').hidden = true);
  if (d.tab) {
    if (d.tab === 'overview' && tab !== 'overview') { ovMonth = thisMonth(); ovYear = new Date().getFullYear(); }
    tab = d.tab; return render();
  }
  if (d.ov) { ovMode = d.ov; return render(); }
  if (d.ovShift) { ovMonth = shiftMonth(ovMonth, +d.ovShift); return render(); }
  if (d.ovYear) { ovYear += +d.ovYear; return render(); }
  if (d.ovMonth) { ovMonth = d.ovMonth; ovMode = 'month'; return render(); }
  if (t.id === 'fab') return openAdd();
  if (d.cat) { cat = d.cat; return updateAdd(); }
  if (d.k) return pressKey(d.k);
  if (t.id === 'formSave') {
    if (onFormSave && onFormSave($('#formBody')) === false) return;
    save(); close('#formSheet'); return render();
  }
  if (d.v && t.parentElement.dataset.seg) {
    const seg = t.parentElement;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t));
    seg.nextElementSibling.value = d.v;
    seg.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if ('addLine' in d) return $('[data-lines]').insertAdjacentHTML('beforeend', fixedLine());
  if ('rmLine' in d) return t.closest('.fixed-line').remove();

  if (d.delExp) {
    const x = state.expenses.find((x) => x.id === d.delExp);
    if (x && confirm(`删除这笔 ${money(x.amount)}？`)) {
      state.expenses = state.expenses.filter((y) => y !== x);
      save(); render();
    }
    return;
  }
  if ('newGoal' in d) return goalForm();
  if (d.editGoal) return goalForm(state.goals.find((g) => g.id === d.editGoal));
  if (d.deposit) return depositForm(state.goals.find((g) => g.id === d.deposit), 1);
  if (d.withdraw) return depositForm(state.goals.find((g) => g.id === d.withdraw), -1);

  if (d.set === 'income') return amountFreqForm('收入', 'income', 'incomeFreq', ['week', 'fortnight', 'month'], `税后收入 (${CUR})`);
  if (d.set === 'rent') return amountFreqForm('房租', 'rent', 'rentFreq', ['week', 'fortnight', 'month'], `房租 (${CUR})`);
  if (d.set === 'fixed') return fixedForm();
  if ('export' in d) return exportData();
  if ('import' in d) return $('#importFile').click();
  if ('reset' in d) {
    if (confirm('确定清空所有数据？建议先导出备份。') && confirm('真的要清空吗？无法恢复。')) {
      state = blank(); save(); render(); toast('已清空');
    }
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'importFile' && e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
});
$('#addDate').addEventListener('change', updateAdd);
$('#formBody').addEventListener('submit', (e) => { e.preventDefault(); $('#formSave').click(); });

// 回到前台时刷新（跨天、跨月）
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#addSheet').hidden && $('#formSheet').hidden) render(); });

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register(window.SW_PATH || 'sw.js').catch(() => {});
}
