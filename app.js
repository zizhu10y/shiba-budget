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
  // incomeMode：'fixed' = 固定收入（按设置换算）；'weekly' = 每周不固定，按实际到账记录
  settings: { income: 0, incomeFreq: 'month', incomeMode: 'fixed', rent: 0, rentFreq: CUR_CFG.rentFreq, fixed: [] },
  expenses: [],
  incomes: [],
  goals: [],
  // 小金猪（总积蓄）的进出记录；每条记录和目标存款一样带 month 标记：
  // month !== false 表示这笔钱来自/回到当月收入，会算进当月；false = 已有积蓄或积蓄之间挪动，不算任何月
  piggy: [],
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
// 按分取整，避免 0.1 + 0.2 这类浮点误差把刚好花完算成「超支 $0.00」
const cents = (n) => Math.round(n * 100) / 100;
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
const variableIncome = () => state.settings.incomeMode === 'weekly';
const hasIncome = () => (variableIncome() ? state.incomes.length > 0 : state.settings.income > 0);
// 某个月（'YYYY-MM'）的收支；固定支出按当前设置计算，
// 收入：固定模式按设置换算，不固定模式 = 当月实际到账的收入记录之和
const sum = (arr) => arr.reduce((a, x) => a + x.amount, 0);
const countsIn = (m) => (x) => x.month !== false && x.date.startsWith(m);
const goalBalance = (g) => sum(g.deposits);
const piggyBalance = () => sum(state.piggy);
// 固定支出：固定收入模式按月全额；每周不固定模式下每周一扣一周的量（月 × 12 ÷ 52），本月只算到今天
function fixedFor(m) {
  if (!variableIncome()) return { fixed: fixedMonthly(), weeks: null };
  const [y, mo] = m.split('-').map(Number);
  const last = m === thisMonth() ? new Date().getDate() : new Date(y, mo, 0).getDate();
  let weeks = 0;
  for (let d = 1; d <= last; d++) if (new Date(y, mo - 1, d).getDay() === 1) weeks++;
  return { fixed: (fixedMonthly() * 12 / 52) * weeks, weeks };
}
function monthStats(m) {
  const monthInc = state.incomes.filter((i) => i.date.startsWith(m));
  const income = variableIncome()
    ? monthInc.reduce((a, i) => a + i.amount, 0)
    : toMonth(state.settings.income, state.settings.incomeFreq);
  const { fixed, weeks } = fixedFor(m);
  const monthExp = state.expenses.filter((e) => e.date.startsWith(m));
  const spent = monthExp.reduce((a, e) => a + e.amount, 0);
  // 存起来的钱：所有目标（含已放进小金猪的）和小金猪里，来自当月收入的部分
  const moves = [...state.goals.flatMap((g) => g.deposits), ...state.piggy].filter(countsIn(m));
  // 存入、取出分开记（总览里分两行显示），saved 是净额
  const savedIn = sum(moves.filter((x) => x.amount > 0));
  const savedOut = -sum(moves.filter((x) => x.amount < 0));
  const saved = savedIn - savedOut;
  const budget = income - fixed;
  const byCat = {};
  monthExp.forEach((e) => (byCat[e.cat] = (byCat[e.cat] || 0) + e.amount));
  return { income, fixed, weeks, spent, saved, savedIn, savedOut, budget, remaining: cents(budget - spent - saved), monthExp, monthInc, byCat };
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
  return { ...s, daysLeft, daysInMonth, spentToday, todayBudget, todayLeft: cents(todayBudget - spentToday),
    daily: s.remaining / daysLeft, projected };
}
// 第一笔数据所在的月份（没有数据就是本月）
function firstMonth() {
  const dates = [...state.expenses.map((e) => e.date), ...state.incomes.map((i) => i.date), ...state.goals.flatMap((g) => g.deposits.map((d) => d.date)), ...state.piggy.map((p) => p.date)];
  return dates.length ? dates.sort()[0].slice(0, 7) : thisMonth();
}

// ---------- 页面 ----------
let tab = 'home';
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('fab').hidden = tab !== 'home'; // 记一笔只在首页
  $('#view').innerHTML = { home: homeView, overview: overviewView, goals: goalsView, settings: settingsView }[tab]();
  window.scrollTo(0, 0);
}

function homeView() {
  const s = summary();
  const hasSetup = hasIncome();
  const vi = variableIncome();
  const used = s.budget > 0 ? Math.min(100, ((s.spent + s.saved) / s.budget) * 100) : 0;
  const neg = s.remaining < 0;
  const mood = !hasSetup ? (vi ? '🐕 发工资了就点 ＋ 记一笔收入' : '🐕 先去「设置」填收入吧') : neg ? '🥺 呜…这个月超支了' : s.remaining === 0 && s.budget > 0 ? '🐕 这个月刚好花完啦' : used > 80 ? '🐕 省着点花哦' : '🐕 汪！这个月还能花';
  const list = [...s.monthExp, ...(vi ? s.monthInc.map((i) => ({ ...i, inc: true })) : [])]
    .sort((a, b) => (b.date + b.t).localeCompare(a.date + a.t));
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
    ${rentReminder()}
    ${deadlineWarning()}
    <section class="card rows">
      <div class="row"><span>${vi ? `本月已到账收入${s.monthInc.length ? `（${s.monthInc.length} 笔）` : ''}` : '月收入'}</span><span class="num">${money(s.income)}</span></div>
      <div class="row"><span>固定支出${s.weeks != null ? `（已扣 ${s.weeks} 周）` : ''}</span><span class="num">−${money(s.fixed)}</span></div>
      <div class="row"><span>本月已花</span><span class="num">−${money(s.spent)}</span></div>
      ${savedRow(s.saved)}
      <div class="row"><span>今天额度</span><span class="num">${money(Math.max(0, s.todayBudget))}</span></div>
      <div class="row"><span>今天已花</span><span class="num">${money(s.spentToday)}</span></div>
    </section>
    <h2>本月明细</h2>
    <div class="list">
      ${list.length ? list.map((e) => {
        if (e.inc) return `<div class="item">
          <div class="emoji">💰</div>
          <div class="mid"><div>收入</div><div>${e.date.slice(5).replace('-', '/')}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
          <div class="amt num plus">+${money(e.amount)}</div>
          <button class="del" data-del-inc="${e.id}" aria-label="删除">×</button>
        </div>`;
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

// 当月存钱净额那一行：存的比取的多显示「存起来的钱 −$X」，取的多显示「从积蓄取出 +$X」
function savedRow(saved) {
  if (!saved) return '';
  return saved > 0
    ? `<div class="row"><span>存起来的钱</span><span class="num">−${money(saved)}</span></div>`
    : `<div class="row"><span>从积蓄取出</span><span class="num">+${money(-saved)}</span></div>`;
}
// label：结余那一行的名字；savedLabel：「共省下」那一行的名字
function statRows(s, label, savedLabel) {
  const kept = s.saved + s.remaining;
  return `<div class="row"><span>收入</span><span class="num">${money(s.income)}</span></div>
    <div class="row"><span>固定支出</span><span class="num">−${money(s.fixed)}</span></div>
    <div class="row"><span>日常花销</span><span class="num">−${money(s.spent)}</span></div>
    ${s.savedIn ? `<div class="row"><span>存入积蓄</span><span class="num">−${money(s.savedIn)}</span></div>` : ''}
    ${s.savedOut ? `<div class="row"><span>从积蓄取出</span><span class="num">+${money(s.savedOut)}</span></div>` : ''}
    <div class="row total"><span>${label}</span><span class="num ${s.remaining < 0 ? 'neg' : ''}">${money(s.remaining)}</span></div>
    <div class="kept ${kept < 0 ? 'neg-bg' : ''}">
      <div><span>🐷 ${savedLabel}</span><b class="num">${money(kept)}</b></div>
      <small class="num">${[
        s.savedIn ? `存入 ${money(s.savedIn)}` : '',
        s.savedOut ? `− 取出 ${money(s.savedOut)}` : '',
        `${s.savedIn || s.savedOut ? '+ ' : ''}${label} ${money(s.remaining)}`,
      ].filter(Boolean).join(' ')}</small>
    </div>`;
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
      ${statRows(s, cur ? '目前剩余' : '当月结余', cur ? '本月目前共省下' : '这个月共省下')}
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
  const tot = { income: 0, fixed: 0, spent: 0, saved: 0, savedIn: 0, savedOut: 0, remaining: 0 }, byCat = {};
  counted.forEach((s) => {
    for (const k in tot) tot[k] += s[k];
    for (const c in s.byCat) byCat[c] = (byCat[c] || 0) + s.byCat[c];
  });
  // 柱子 = 日常花销 + 存入目标；虚线 = 每月可花额度
  const budget = counted.length ? counted.reduce((a, s) => a + s.budget, 0) / counted.length : 0;
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
      ${statRows(tot, '全年结余', '全年共省下')}
    </section>
    <section class="card">
      <div class="chart" style="--b:${(budget / max).toFixed(4)}">
        ${budget > 0 ? '<div class="budget-line"></div>' : ''}
        ${stats.map((s, i) => `<button class="col ${s ? '' : 'off'} ${s && s.remaining < 0 ? 'over' : ''}" ${s ? `data-ov-month="${months[i]}"` : 'disabled'}
            aria-label="${i + 1} 月 ${s ? money(s.spent + s.saved) : '无数据'}">
          <i style="height:${s ? ((s.spent + s.saved) / max) * 100 : 0}%"></i><span>${i + 1}</span></button>`).join('')}
      </div>
      <div class="legend"><span><i class="sw"></i>每月花销+存入</span>${budget > 0 ? `<span><i class="sw dash"></i>${variableIncome() ? '月均可花' : '每月可花'} ${moneyShort(Math.round(budget))}</span>` : ''}</div>
      <p class="hint">点柱子看那个月的明细</p>
    </section>
    <h2>全年分类</h2>
    <div class="list">${catBreakdown(byCat)}</div>`
    : '<div class="card empty">🐾 这一年还没有记录</div>'}`;
}

// 目标截止日期：距今天数（负数 = 已过期）、还差多少、每周/每月需要存多少
function goalDeadline(g) {
  if (!g.due) return null;
  const left = Math.max(0, g.target - goalBalance(g));
  const [y, m, d] = g.due.split('-').map(Number);
  const now = new Date();
  const days = Math.round((new Date(y, m - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  const weeks = Math.max(1, days / 7);
  return { left, days, perWeek: left / weeks, perMonth: left / Math.max(1, days / (365 / 12)),
    label: (y === now.getFullYear() ? '' : `${y}/`) + `${m}/${d}` };
}
function deadlineLine(g) {
  const dl = goalDeadline(g);
  if (!dl) return "";
  // 必须完成的目标：7 天内（含已过）颜色稍微醒目一点；不着急的目标一直保持低调
  const cls = !g.relaxed && dl.days <= 7 ? "due soon" : "due";
  if (dl.left === 0) return `<div class="due ok">🎉 ${dl.label} 前已经存够啦</div>`;
  if (dl.days < 0) return `<div class="${cls}">🐾 目标日 ${dl.label} 已过，还差 ${money(dl.left)}，慢慢来</div>`;
  if (dl.days === 0) return `<div class="${cls}">🐾 今天是目标日，还差 ${money(dl.left)}</div>`;
  return `<div class="${cls}">🐾 目标日 ${dl.label} · 还有 ${dl.days} 天${dl.days >= 7
    ? ` · 每周存 ${money(dl.perWeek)} 就够${dl.days >= 28 ? `（每月约 ${money(dl.perMonth)}）` : ""}`
    : ` · 还差 ${money(dl.left)}`}</div>`;
}
// 首页温和提醒：没存够、已过目标日或 14 天内到期的目标里，最近的一个
function deadlineWarning() {
  const urgent = state.goals.filter((g) => !g.archived)
    .map((g) => ({ g, dl: goalDeadline(g) }))
    .filter(({ g, dl }) => dl && !g.relaxed && dl.left > 0 && dl.days <= 14)
    .sort((a, b) => a.dl.days - b.dl.days)[0];
  if (!urgent) return "";
  const { g, dl } = urgent;
  const msg = dl.days < 0 ? `目标日 ${dl.label} 已过，还差 ${money(dl.left)}，要不要把日期往后挪挪？`
    : dl.days === 0 ? `今天是目标日，还差 ${money(dl.left)}`
    : dl.days >= 7 ? `还有 ${dl.days} 天，每周存 ${money(dl.perWeek)} 就够啦`
    : `还有 ${dl.days} 天，还差 ${money(dl.left)}，加油～`;
  return `<div class="warn card soft">🐾「${esc(g.name)}」${msg}</div>`;
}

// 下次交房租：从设置里记的某一次交租日期，按频率往后推到今天或之后
function nextRent() {
  const s = state.settings;
  if (!s.rentDate || !s.rent) return null;
  const [y, m, d] = s.rentDate.split("-").map(Number);
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(y, m - 1, d);
  if (s.rentFreq === "month") {
    let i = 0;
    while (next < today) next = new Date(y, m - 1 + ++i, Math.min(d, new Date(y, m + i, 0).getDate()));
  } else {
    const step = s.rentFreq === "week" ? 7 : 14;
    const behind = Math.round((today - next) / 864e5);
    if (behind > 0) next = new Date(y, m - 1, d + Math.ceil(behind / step) * step);
  }
  return { date: next, days: Math.round((next - today) / 864e5) };
}
// 首页交租提醒：到期前 2 天开始显示
function rentReminder() {
  const r = nextRent();
  if (!r || r.days > 2) return "";
  const when = ["今天", "明天", "后天"][r.days];
  return `<div class="warn card soft">🏠 ${when}交房租 ${money(state.settings.rent)}</div>`;
}

// 首页预警：已超支 > 今天超额 > 按速度月底会超支
function homeWarning(s) {
  if (s.remaining < 0) return `<div class="warn card">🥺 本月已超支 ${money(-s.remaining)}，剩下 ${s.daysLeft} 天尽量别花啦</div>`;
  if (s.todayLeft < 0) return `<div class="warn card soft">🐕 今天超出额度 ${money(-s.todayLeft)}，后面几天要省一点哦</div>`;
  const cap = s.budget - s.saved;
  if (!variableIncome() && s.projected != null && s.projected > cap) {
    return `<div class="warn card soft">📈 按现在每天的花法，月底约超支 ${money(s.projected - cap)}</div>`;
  }
  return '';
}

function goalsView() {
  const goals = state.goals.filter((g) => !g.archived);
  const pig = piggyBalance();
  return `
    <h1>存钱 💰</h1>
    <section class="card piggy">
      <div class="pig-top">
        <div class="pig-face" aria-hidden="true">🐷</div>
        <div><div class="label">小金猪</div><div class="pig-amt num">${money(pig)}</div></div>
      </div>
      <div class="actions">
        <button class="btn" data-piggy="1">存入</button>
        <button class="btn soft" data-piggy="-1" ${pig > 0 ? '' : 'disabled'}>取出</button>
      </div>
    </section>
    <h2>存钱目标 🦴</h2>
    ${goals.map((g) => {
      const saved = goalBalance(g);
      const pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0;
      return `<section class="card goal">
        <div class="top"><span class="name">${esc(g.name)}</span><span class="pct num">${Math.floor(pct)}%${pct >= 100 ? ' 🎉' : ''}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="sub num">已存 ${money(saved)} / ${moneyShort(g.target)}${pct < 100 ? ` · 还差 ${money(g.target - saved)}` : ''}</div>
        ${deadlineLine(g)}
        <div class="actions">
          <button class="btn" data-deposit="${g.id}">存入</button>
          <button class="btn soft" data-withdraw="${g.id}">取出</button>
          <button class="btn ghost" data-edit-goal="${g.id}">编辑</button>
        </div>
        ${saved > 0 ? `<button class="btn pig-btn" data-to-piggy="${g.id}">🐷 放进小金猪</button>` : ''}
      </section>`;
    }).join('') || '<div class="card empty">还没有目标，给柴柴定个小目标吧</div>'}
    <button class="btn" data-new-goal>＋ 新目标</button>
    <p class="hint">从「本月收入」存的钱会从当月可花里扣掉；已有积蓄、小金猪和目标之间挪来挪去的钱，不算进任何一个月。</p>`;
}

function settingsView() {
  const s = state.settings;
  const otherTotal = s.fixed.reduce((a, f) => a + toMonth(f.amount, f.freq), 0);
  return `
    <h1>设置</h1>
    <div class="list">
      <button class="set-row" data-set="income"><span>收入</span><span class="chev num">${s.incomeMode === 'weekly' ? '每周不固定' : `${moneyShort(s.income)} ${FREQ[s.incomeFreq]}`}</span></button>
      <button class="set-row" data-set="rent"><span>房租</span><span class="chev num">${moneyShort(s.rent)} ${FREQ[s.rentFreq]}${nextRent() ? ` · 下次 ${nextRent().date.getMonth() + 1}/${nextRent().date.getDate()}` : ""}</span></button>
      <button class="set-row" data-set="fixed"><span>其他固定支出</span><span class="chev num">${s.fixed.length} 项 · ${money(otherTotal)}/月</span></button>
    </div>
    <p class="hint">换算按 1 年 52 周：每周 × 52 ÷ 12 = 每月。固定支出合计 ${money(fixedMonthly())}/月${s.incomeMode === 'weekly' ? `；收入不固定时，每周一扣一次 ${money(fixedMonthly() * 12 / 52)}` : ''}。</p>
    ${nextRent() ? '<button class="btn soft" data-rent-cal style="margin-top:12px">📅 加到手机日历，交房租前一天提醒</button>' : ""}
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
let amt = '', cat = 'food', kind = 'exp';
function openAdd() {
  amt = '';
  cat = 'food';
  kind = 'exp';
  $('#kindSeg').hidden = !variableIncome();
  $('#addNote').value = '';
  $('#addDate').value = ymd(new Date());
  $('#catGrid').innerHTML = CATS.map((c) => `<button class="cat" data-cat="${c.id}"><span>${c.e}</span>${c.name}</button>`).join('');
  $('#keypad').innerHTML = '<button class="key ok" data-k="ok">完成</button>' +
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `<button class="key" data-k="${k}">${k}</button>`).join('');
  updateAdd();
  open('#addSheet');
}
function updateAdd() {
  const inc = kind === 'inc';
  $('#addAmount').textContent = (inc ? '+' : '') + CUR_CFG.sym + (amt || '0');
  $('#addAmount').classList.toggle('plus', inc);
  document.querySelectorAll('#kindSeg button').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
  $('#catGrid').hidden = inc;
  $('#addNote').placeholder = inc ? '备注（可选），如 第 3 周工资' : '备注（可选）';
  $('.key.ok').textContent = inc ? '记收入' : '完成';
  document.querySelectorAll('.cat').forEach((b) => b.classList.toggle('sel', b.dataset.cat === cat));
  $('.key.ok').disabled = !(parseFloat(amt) > 0);
  const w = inc ? null : addWarning(parseFloat(amt) || 0);
  const el = $('#addWarn');
  el.hidden = !w;
  if (w) { el.textContent = w.text; el.className = 'add-warn ' + w.level; }
}
// 记这笔之前的超支检查：level 'over' = 会让当月超支，'tight' = 超过今天额度
function addWarning(n) {
  if (!(n > 0) || !hasIncome()) return null;
  const date = $('#addDate').value || ymd(new Date());
  const m = date.slice(0, 7);
  if (m !== thisMonth()) {
    const after = cents(monthStats(m).remaining - n);
    return after < 0 ? { level: 'over', text: `⚠️ 这笔会让 ${+m.slice(5)} 月超支 ${money(-after)}` } : null;
  }
  const s = summary();
  const after = cents(s.remaining - n);
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
async function commitAdd() {
  const n = Math.round(parseFloat(amt) * 100) / 100;
  if (!(n > 0)) return;
  if (kind === 'inc') return commitIncome(n);
  const w = addWarning(n);
  if (w && w.level === 'over' && !(await ask(`${w.text.replace('⚠️ ', '')}。还要记下这笔吗？`, { ok: '还是记下' }))) return;
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

function commitIncome(n) {
  state.incomes.push({
    id: uid(), amount: n,
    note: $('#addNote').value.trim(),
    date: $('#addDate').value || ymd(new Date()),
    t: new Date().toTimeString().slice(0, 8),
  });
  save();
  close('#addSheet');
  tab = 'home';
  render();
  toast(`💰 收入 +${money(n)}`);
}

// ---------- 通用表单 ----------
let onFormSave = null;
function openForm(title, html, saveFn, afterRender) {
  $('#formTitle').textContent = title;
  $('#formSave').textContent = '保存';
  $('#formBody').innerHTML = html;
  onFormSave = saveFn;
  $('#formBody').oninput = null;
  afterRender && afterRender($('#formBody'));
  open('#formSheet');
}
const moneyInput = (name, val, ph = '0.00') =>
  `<input name="${name}" type="text" inputmode="decimal" placeholder="${ph}" value="${val ? val : ''}">`;
const num = (v) => Math.max(0, Math.round((parseFloat(String(v).replace(/[^\d.]/g, '')) || 0) * 100) / 100);
const segHtml = (name, val, keys, labels = FREQ) =>
  `<div class="seg" data-seg="${name}">${keys.map((k) => `<button type="button" data-v="${k}" class="${k === val ? 'on' : ''}">${labels[k]}</button>`).join('')}</div><input type="hidden" name="${name}" value="${val}">`;
const freqSelect = (val) =>
  `<select>${Object.keys(FREQ).map((k) => `<option value="${k}" ${k === val ? 'selected' : ''}>${FREQ[k].replace('每', '/')}</option>`).join('')}</select>`;

function amountFreqForm(title, field, freqField, freqs, label, withDate) {
  const s = state.settings;
  openForm(title, `
    <label><span>${label}</span>${moneyInput('amt', s[field])}</label>
    <label><span>频率</span>${segHtml('freq', s[freqField], freqs)}</label>
    <div class="calc num" data-calc></div>
    ${withDate ? `<label><span>最近一次交房租的日期（用来提醒你，可选）</span><input name="rentDate" type="date" value="${s.rentDate || ''}"></label>` : ''}`,
    (f) => { s[field] = num(f.amt.value); s[freqField] = f.freq.value; if (withDate) s.rentDate = f.rentDate.value || ''; },
    (form) => {
      const upd = () => {
        const v = toMonth(num(form.amt.value), form.freq.value);
        form.querySelector('[data-calc]').textContent = form.freq.value === 'month' ? '' : `≈ 每月 ${money(v)}`;
      };
      form.oninput = upd;
      upd();
      setTimeout(() => form.amt?.focus(), 250);
    });
}

function incomeForm() {
  const s = state.settings;
  openForm('收入', `
    <label><span>收入方式</span>${segHtml('mode', s.incomeMode, ['fixed', 'weekly'], { fixed: '固定', weekly: '每周不固定' })}</label>
    <div data-fixed>
      <label><span>税后收入 (${CUR})</span>${moneyInput('amt', s.income)}</label>
      <label><span>频率</span>${segHtml('freq', s.incomeFreq, ['week', 'fortnight', 'month'])}</label>
      <div class="calc num" data-calc></div>
    </div>
    <p class="hint" data-weekly>每次发工资时，点 ＋ 切到「收入」记一笔。本月可花 = 本月已到账的收入 − 固定支出 − 已花，不做预估。</p>`,
    (f) => { s.incomeMode = f.mode.value; s.income = num(f.amt.value); s.incomeFreq = f.freq.value; },
    (form) => {
      const upd = () => {
        const weekly = form.mode.value === 'weekly';
        form.querySelector('[data-fixed]').hidden = weekly;
        form.querySelector('[data-weekly]').hidden = !weekly;
        const v = toMonth(num(form.amt.value), form.freq.value);
        form.querySelector('[data-calc]').textContent = form.freq.value === 'month' ? '' : `≈ 每月 ${money(v)}`;
      };
      form.oninput = upd;
      upd();
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
    <label><span>截止日期（可选）：这天之前要存够</span><input name="due" type="date" value="${g?.due || ''}"></label>
    <button type="button" class="link" data-clear-due style="margin-top:6px${g?.due ? '' : ';display:none'}">不设截止日期</button>
    <label><span>这个目标</span>${segHtml('level', g?.relaxed ? 'relaxed' : 'must', ['must', 'relaxed'], { must: '必须完成', relaxed: '不着急' })}</label>
    ${g ? '<button type="button" class="btn danger" data-del-goal style="margin-top:20px">删除这个目标</button>' : ''}`,
    (f) => {
      const name = f.name.value.trim(), target = num(f.target.value), due = f.due.value || '', relaxed = f.level.value === 'relaxed';
      if (!name || !target) { toast('请填写名称和金额'); return false; }
      if (g) Object.assign(g, { name, target, due, relaxed });
      else state.goals.push({ id: uid(), name, target, due, relaxed, deposits: [] });
    },
    (form) => {
      const clr = form.querySelector('[data-clear-due]');
      // 有日期才显示「不设截止日期」；清掉后选了新日期，按钮会再出现
      const syncClr = () => { clr.style.display = form.due.value ? '' : 'none'; };
      form.due.addEventListener('input', syncClr);
      form.due.addEventListener('change', syncClr);
      clr.onclick = () => { form.due.value = ''; syncClr(); toast('已取消截止日期，保存后生效'); };
      const del = form.querySelector('[data-del-goal]');
      if (del) del.onclick = async () => {
        const bal = goalBalance(g);
        if (!(await ask(bal > 0 ? `删除「${g.name}」？里面的 ${money(bal)} 会放进小金猪。` : `删除「${g.name}」？`, { ok: '删除', danger: true }))) return;
        close('#formSheet');
        goalToPiggy(g);
      };
      if (!g) setTimeout(() => form.querySelector('[name=name]')?.focus(), 250);
    });
}

// 从当月收入存钱前的超支确认
async function confirmSaveFromMonth(n) {
  const after = cents(summary().remaining - n);
  return !(hasIncome() && after < 0) || ask(`存入后本月会超支 ${money(-after)}，还要存吗？`, { ok: '还是存' });
}
const today = () => ymd(new Date());

function depositForm(g, sign) {
  const pig = piggyBalance(), bal = goalBalance(g);
  const src = sign > 0
    ? segHtml('src', 'month', ['month', 'piggy'], { month: '本月收入', piggy: `从小金猪（${moneyShort(pig)}）` })
    : segHtml('src', 'month', ['month', 'piggy'], { month: '拿出来花', piggy: '挪回小金猪' });
  openForm(sign > 0 ? `存入 · ${g.name}` : `取出 · ${g.name}`, `
    <label><span>金额 (${CUR})</span>${moneyInput('amt', '')}</label>
    <label><span>${sign > 0 ? '钱从哪来' : '取出来做什么'}</span>${src}</label>
    <p class="hint">${sign > 0 ? '「本月收入」会从这个月可花里扣掉；「从小金猪」只是挪一下，不算进这个月。' : `这个目标里有 ${money(bal)}。「拿出来花」会加回这个月可花；「挪回小金猪」只是换个罐子存，这个月可花不变。`}</p>`,
    async (f) => {
      const n = num(f.amt.value), fromPig = f.src.value === 'piggy';
      if (!n) { toast('请输入金额'); return false; }
      if (sign < 0 && n > bal) { toast(`目标里只有 ${money(bal)}`); return false; }
      if (sign > 0 && fromPig && n > pig) { toast(`小金猪里只有 ${money(pig)}`); return false; }
      if (sign > 0 && !fromPig && !(await confirmSaveFromMonth(n))) return false;
      g.deposits.push({ date: today(), amount: sign * n, month: !fromPig });
      if (fromPig) state.piggy.push({ id: uid(), date: today(), amount: -sign * n, month: false, note: sign > 0 ? `分给 ${g.name}` : `来自 ${g.name}` });
      toast(sign > 0 ? `🦴 存入 ${money(n)}` : fromPig ? `🐷 挪回小金猪 ${money(n)}` : `取出 ${money(n)}`);
    },
    (form) => setTimeout(() => form.amt?.focus(), 250));
}

function piggyForm(sign) {
  const pig = piggyBalance();
  openForm(sign > 0 ? '🐷 存进小金猪' : '🐷 从小金猪取出', `
    <label><span>金额 (${CUR})</span>${moneyInput('amt', '')}</label>
    ${sign > 0 ? `<label><span>钱从哪来</span>${segHtml('src', state.piggy.length ? 'month' : 'old', ['month', 'old'], { month: '本月收入', old: '已有积蓄' })}</label>
    <p class="hint">「已有积蓄」是以前就攒下的钱，不算进任何一个月；「本月收入」会从这个月可花里扣掉。</p>`
    : `<p class="hint">小金猪里有 ${money(pig)}。取出的钱会加回这个月可花里。</p>`}`,
    async (f) => {
      const n = num(f.amt.value), old = sign > 0 && f.src.value === 'old';
      if (!n) { toast('请输入金额'); return false; }
      if (sign < 0 && n > pig) { toast(`小金猪里只有 ${money(pig)}`); return false; }
      if (sign > 0 && !old && !(await confirmSaveFromMonth(n))) return false;
      state.piggy.push({ id: uid(), date: today(), amount: sign * n, month: !old, note: old ? '已有积蓄' : '' });
      toast(sign > 0 ? `🐷 存进 ${money(n)}` : `🐷 取出 ${money(n)}`);
    },
    (form) => setTimeout(() => form.amt?.focus(), 250));
}

// 目标里的钱整笔倒进小金猪，目标归档（保留存款记录，以前月份的统计不变）
function goalToPiggy(g) {
  const bal = goalBalance(g);
  if (bal > 0) {
    g.deposits.push({ date: today(), amount: -bal, month: false });
    state.piggy.push({ id: uid(), date: today(), amount: bal, month: false, note: `来自 ${g.name}` });
  }
  g.archived = true;
  save(); render();
  toast(bal > 0 ? `🐷 「${g.name}」的 ${money(bal)} 放进小金猪啦` : `已移除「${g.name}」`);
}

// ---------- 交房租日历 ----------
// iPhone 主屏幕 App 里没法直接导入日历文件，改成一步步教你在「日历」里建一个重复事件
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function rentCalendarGuide(r) {
  const s = state.settings, title = `🏠 交房租 ${moneyShort(s.rent)}`;
  const repeat = { week: "每周", fortnight: "每两周", month: "每月" }[s.rentFreq];
  openForm("加到 iPhone 日历", `
    <ol class="steps">
      <li>打开 iPhone 自带的「<b>日历</b>」，点右上角 <b>＋</b></li>
      <li>标题填 <b>${esc(title)}</b> <button type="button" class="link" data-copy-title>复制</button></li>
      <li>打开「<b>全天</b>」，日期选 <b>${r.date.getMonth() + 1} 月 ${r.date.getDate()} 日</b></li>
      <li>「重复」选 <b>${repeat}</b></li>
      <li>「提醒」选 <b>提前 1 天（上午 9:00）</b></li>
      <li>点右上角「<b>添加</b>」</li>
    </ol>
    <p class="hint">只要设一次，以后每次交房租前一天日历都会提醒你。房租改了的话，记得也改一下日历里的这个事件。</p>`,
    () => {},
    (form) => {
      $("#formSave").textContent = "好的";
      form.querySelector("[data-copy-title]").onclick = async () => {
        try { await navigator.clipboard.writeText(title); toast("已复制"); } catch (e) { toast("复制失败，手动输入一下吧"); }
      };
    });
}
// 其他手机：生成一个按房租频率重复的全天事件，前一天早上 9 点提醒，交给系统日历去响
function rentCalendar() {
  const r = nextRent();
  if (!r) return;
  if (isIOS) return rentCalendarGuide(r);
  const s = state.settings, d = ymd(r.date).replace(/-/g, "");
  const end = new Date(r.date); end.setDate(end.getDate() + 1);
  const rule = { week: "FREQ=WEEKLY", fortnight: "FREQ=WEEKLY;INTERVAL=2", month: "FREQ=MONTHLY" }[s.rentFreq];
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//shiba-budget//CN", "BEGIN:VEVENT",
    `UID:rent-${uid()}@shiba-budget`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${ymd(end).replace(/-/g, "")}`, `RRULE:${rule}`,
    `SUMMARY:🏠 交房租 ${moneyShort(s.rent)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15H", `DESCRIPTION:明天交房租 ${moneyShort(s.rent)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = "rent.ics";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
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
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !d.settings || !Array.isArray(d.expenses)) throw 0;
      if (!(await ask(`导入将覆盖当前数据（${d.expenses.length} 条支出，${(d.goals || []).length} 个目标），继续？`, { ok: '导入', danger: true }))) return;
      state = { ...blank(), ...d, settings: { ...blank().settings, ...d.settings }, goals: d.goals || [], incomes: d.incomes || [], piggy: d.piggy || [] };
      save(); render(); toast('✅ 导入成功');
    } catch (e) { toast('文件格式不对'); }
  };
  r.readAsText(file);
}

// ---------- 弹层 ----------
function open(sel) { $(sel).hidden = false; }
function close(sel) { $(sel).hidden = true; }
// 应用内的确认框，代替浏览器自带的确认对话框：有些环境（预览面板、部分 App 内置浏览器）会直接屏蔽它
function ask(msg, { ok = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    const bg = $('#confirmSheet');
    $('#confirmMsg').textContent = msg;
    $('#confirmOk').textContent = ok;
    $('#confirmOk').className = 'btn' + (danger ? ' danger' : '');
    // 刚弹出的 0.35 秒内不响应，防止同一次点按（或手快的双击）落在刚出现的按钮上
    const openedAt = Date.now();
    const done = (v) => { if (Date.now() - openedAt < 350) return; bg.hidden = true; resolve(v); };
    $('#confirmOk').onclick = () => done(true);
    $('#confirmCancel').onclick = () => done(false);
    bg.onclick = (e) => { if (e.target === bg) done(false); };
    bg.hidden = false;
  });
}

// ---------- 事件 ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, .sheet-bg');
  if (!t || t.closest('#confirmSheet')) return;
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
  if (d.kind) { kind = d.kind; return updateAdd(); }
  if (d.k) return pressKey(d.k);
  if (t.id === 'formSave') {
    if (onFormSave && (await onFormSave($('#formBody'))) === false) return;
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
    if (x && (await ask(`删除这笔 ${catOf(x.cat).name} ${money(x.amount)}？`, { ok: '删除', danger: true }))) {
      state.expenses = state.expenses.filter((y) => y !== x);
      save(); render();
    }
    return;
  }
  if (d.delInc) {
    const x = state.incomes.find((x) => x.id === d.delInc);
    if (x && (await ask(`删除这笔收入 ${money(x.amount)}？`, { ok: '删除', danger: true }))) {
      state.incomes = state.incomes.filter((y) => y !== x);
      save(); render();
    }
    return;
  }
  if ('newGoal' in d) return goalForm();
  if (d.editGoal) return goalForm(state.goals.find((g) => g.id === d.editGoal));
  if (d.deposit) return depositForm(state.goals.find((g) => g.id === d.deposit), 1);
  if (d.withdraw) return depositForm(state.goals.find((g) => g.id === d.withdraw), -1);
  if (d.piggy) return piggyForm(+d.piggy);
  if (d.toPiggy) {
    const g = state.goals.find((g) => g.id === d.toPiggy);
    if (g && (await ask(`把「${g.name}」里的 ${money(goalBalance(g))} 放进小金猪？这个目标会被移除。`, { ok: '🐷 放进去' }))) goalToPiggy(g);
    return;
  }

  if (d.set === 'income') return incomeForm();
  if (d.set === 'rent') return amountFreqForm('房租', 'rent', 'rentFreq', ['week', 'fortnight', 'month'], `房租 (${CUR})`, true);
  if ('rentCal' in d) return rentCalendar();
  if (d.set === 'fixed') return fixedForm();
  if ('export' in d) return exportData();
  if ('import' in d) return $('#importFile').click();
  if ('reset' in d) {
    if (await ask('确定清空所有数据？建议先导出备份。', { ok: '清空', danger: true }) &&
      await ask('真的要清空吗？无法恢复。', { ok: '确定清空', danger: true })) {
      state = blank(); save(); render(); toast('已清空');
    }
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'importFile' && e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
});
$('#addDate').addEventListener('change', updateAdd);
$('#formBody').addEventListener('submit', (e) => { e.preventDefault(); $('#formSave').click(); });

// ---------- 月末结余自动进小金猪 ----------
// 进入新月份后，把之前每个月没花完的钱记成那个月最后一天存进小金猪（算那个月的存入）。
// autoPiggyUpTo 记到哪个月已经处理过；第一次用这个功能时只处理上个月，不翻旧账。
const addMonths = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5) - 1 + n, 1); return ymd(d).slice(0, 7); };
function autoPiggy() {
  const last = addMonths(thisMonth(), -1);
  let m = state.autoPiggyUpTo ? addMonths(state.autoPiggyUpTo, 1) : last;
  if (m > last) return;
  const moved = [];
  for (; m <= last; m = addMonths(m, 1)) {
    const used = [state.expenses, state.incomes, state.piggy].some((xs) => xs.some((x) => x.date.startsWith(m)));
    const left = used && hasIncome() ? monthStats(m).remaining : 0;
    if (left > 0) {
      const end = ymd(new Date(+m.slice(0, 4), +m.slice(5), 0));
      state.piggy.push({ id: uid(), date: end, amount: left, month: true, note: `${+m.slice(5)} 月结余` });
      moved.push(`${+m.slice(5)} 月剩下的 ${money(left)}`);
    }
  }
  state.autoPiggyUpTo = last;
  save();
  if (moved.length) setTimeout(() => toast(`🐷 ${moved.join("、")} 自动放进小金猪啦`), 600);
}

// 回到前台时刷新（跨天、跨月）
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#addSheet').hidden && $('#formSheet').hidden && $('#confirmSheet').hidden) { autoPiggy(); render(); } });

autoPiggy();
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register(window.SW_PATH || 'sw.js').catch(() => {});
  // 新版本接管后自动刷新一次（首次安装不刷新；正在记账或填表时不打断）
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && $('#addSheet').hidden && $('#formSheet').hidden && $('#confirmSheet').hidden) location.reload();
  });
}
