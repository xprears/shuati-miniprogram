/* 截图数据采集：在 Node 里跑真实页面 JS（mock wx），把每页 onLoad/onShow 后的 data 落成 JSON。
 * 数据全部由真实逻辑算出（store/logic/report 的计算口径），不手写界面字段。
 * 用法：node build/shots/collect.js   ->  build/shots/data/*.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../miniprogram');
const OUT = path.join(__dirname, 'data');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- mock wx ---------- */
const storage = new Map();
function noop() {}
function ok(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); }
global.wx = {
  getStorageSync: k => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  removeStorageSync: k => storage.delete(k),
  clearStorageSync: () => storage.clear(),
  showToast: noop, hideToast: noop, showModal: ok, showLoading: noop, hideLoading: noop,
  navigateTo: noop, redirectTo: noop, switchTab: noop, navigateBack: noop, reLaunch: noop,
  setNavigationBarTitle: noop, setNavigationBarColor: noop,
  setClipboardData: ok, getClipboardData: ok,
  enableAlertBeforeUnload: noop, disableAlertBeforeUnload: noop,
  pageScrollTo: noop, nextTick: cb => cb && cb(),
  vibrateShort: noop, openCustomerServiceChat: noop, chooseMessageFile: noop,
  getFileSystemManager: () => ({ readFile: ok }),
  getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 44, screenWidth: 390 })
};
global.getApp = () => ({ globalData: {} });

/* ---------- 注入示例题库（与真实运行同一条链路：bank-store.save -> storage -> logic.reload） ---------- */
const bankRaw = require(path.join(ROOT, 'utils/qbank.js'));
const bankStore = require(path.join(ROOT, 'utils/bank-store.js'));
bankStore.__setNodeBank(bankRaw);
const BANK_NAME = '示例题库';
bankStore.save(bankRaw, { name: BANK_NAME });   // 让 import / 分类页能看到「当前题库」与题库名
const logic = require(path.join(ROOT, 'utils/logic.js'));
logic.reload(bankRaw);
const store = require(path.join(ROOT, 'utils/store.js'));
store.init();

const IDS = bankRaw.map(q => q.i);
const T = (m, d, h, mi) => new Date(2026, m - 1, d, h || 10, mi || 0).getTime();

/* ---------- 造练习记录 ---------- */
function resetS() {
  const S = store.S;
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, store.defaultState());
  S.bankFp = bankStore.currentFingerprint();
}

/* 36 次答题 / 30 对 6 错 = 83%；未掌握 2 题；已掌握 5 题 */
function seedStats() {
  resetS();
  const S = store.S;
  const rows = {
    q0001: [5, 0], q0002: [6, 1], q0003: [4, 1], q0004: [5, 0],
    q0005: [2, 2], q0006: [3, 1], q0007: [2, 1], q0008: [3, 0]
  };
  Object.keys(rows).forEach((id, i) => {
    S.qs[id] = { r: rows[id][0], w: rows[id][1], last: rows[id][1] ? -1 : 1, at: T(10, 29 - i, 14, 20) };
  });
  S.wrong = {
    q0005: { n: 2, at: T(10, 27, 9, 41), last: T(10, 30, 9, 12) },
    q0006: { n: 1, at: T(10, 29, 16, 8), last: T(10, 29, 16, 8) }
  };
  S.mastered = {};
  ['q0001', 'q0002', 'q0004', 'q0007', 'q0008'].forEach((id, i) => { S.mastered[id] = T(10, 28 + (i % 2), 20, 5); });
  S.days = {
    '2026-10-17': 18, '2026-10-19': 26, '2026-10-20': 12, '2026-10-22': 34,
    '2026-10-23': 8, '2026-10-25': 22, '2026-10-26': 30, '2026-10-27': 14,
    '2026-10-29': 40, '2026-10-30': 16
  };
  S.streak = { last: '2026-10-30', n: 3 };
  S.settings = { feedback: true };
  S.history = [
    { mode: 'exam', scopeLabel: '全部题库', types: ['judge', 'single', 'multi'], total: 12, correct: 11, score: 92, duration: 6 * 60000 + 12000, at: T(10, 26, 15, 2), breakdown: {} },
    { mode: 'exam', scopeLabel: '全部题库', types: ['judge', 'single', 'multi'], total: 12, correct: 10, score: 86, duration: 7 * 60000, at: T(10, 29, 20, 14), breakdown: {} }
  ];
}

/* 进行中的练习会话：停在 idx 指向的题，之前已答 */
function seedPractice(mode, opt) {
  seedStats();
  const S = store.S;
  const ids = IDS.slice();
  const ans = {};
  const fb = {};
  const stopAt = opt.idx;
  ids.slice(0, stopAt).forEach((id, i) => {
    const q = logic.QMAP[id];
    if (!q.options) return;
    ans[id] = { sel: [q.type === 'judge' ? 'A' : String(q.answer)[0]], flag: false };
    fb[id] = i === 2 ? -1 : 1;               // 第 3 题答错过一次，其余都对
  });
  const cur = logic.QMAP[ids[stopAt]];
  if (mode !== 'exam' && opt.answeredCurrent) {
    ans[cur.id] = { sel: opt.answeredCurrent, flag: false };
    fb[cur.id] = -1;
  }
  S.practice = {
    mode: mode,
    title: logic.SETUP_MODE_NAME[mode],
    scopeLabel: '全部题库',
    types: logic.TYPE_ORDER.slice(),
    ids: ids,
    idx: stopAt,
    ans: ans,
    fb: fb,
    startedAt: Date.now() - 9 * 60000,
    exam: mode === 'exam' ? { duration: 60 * 60000, endsAt: Date.now() + 41 * 60000 } : null,
    done: false
  };
  return S.practice;
}

/* ---------- 页面装载器 ---------- */
function setPath(obj, key, val) {
  if (key.indexOf('.') < 0) { obj[key] = val; return; }
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}
function makePage(rel, options, pre, post) {
  let cfg = null;
  global.Page = c => { cfg = c; };
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  require(abs);
  if (!cfg) throw new Error('Page 未注册: ' + rel);
  const inst = Object.assign({}, cfg);
  inst.data = JSON.parse(JSON.stringify(cfg.data || {}));
  inst.setData = function (obj, cb) {
    Object.keys(obj || {}).forEach(k => setPath(inst.data, k, obj[k]));
    if (cb) cb();
  };
  if (pre) pre(inst);
  if (typeof inst.onLoad === 'function') inst.onLoad.call(inst, options || {});
  if (typeof inst.onShow === 'function') inst.onShow.call(inst);
  if (post) post(inst);
  return inst;
}

/* ---------- 场景表：setup 在采集时即时执行，避免状态被后面的场景覆盖 ---------- */
const SCN = [
  {
    /* 空态首页：发布物的默认第一屏（无题库）。临时清空题库，采完再恢复 */
    name: '00-home-empty', page: 'pages/index/index.js', title: '刷题本子', tab: 0,
    setup: () => { bankStore.clear(); logic.reload([]); resetS(); },
    post: () => { bankStore.save(bankRaw, { name: BANK_NAME }); logic.reload(bankRaw); }
  },
  {
    name: '01-home', page: 'pages/index/index.js', title: '刷题本子', tab: 0,
    setup: () => {
      seedPractice('seq', { idx: 3 });
      store.S.practice.ans = { q0001: { sel: ['A'], flag: false }, q0002: { sel: ['B'], flag: false }, q0003: { sel: ['B'], flag: false } };
      store.S.practice.fb = { q0001: 1, q0002: 1, q0003: 1 };
    }
  },
  {
    name: '02-import', page: 'pages/import/import.js', title: '导入题库', noTab: true, setup: seedStats,
    /* 粘贴的是「详细态」题库 JSON（提示词 A 的产出格式），校验通过后显示 12 题 */
    post: inst => {
      const txt = JSON.stringify(bankRaw.map(q => ({
        id: q.i, type: q.t, stem: q.s, part: q.p, chapter: q.c, category: q.g || null,
        options: q.o ? q.o.map(o => ({ key: o[0], text: o[1] })) : null,
        answer: q.a == null ? null : q.a,
        reference: q.r || null,
        analysis: q.x || null
      })), null, 2);
      inst.raw = txt;
      inst.setData({ taValue: txt, rawLen: txt.length, filled: false });
      inst.tryImport(txt, '粘贴的内容');
    }
  },
  { name: '03-bank', page: 'pages/bank/bank.js', title: '分类管理', tab: 1, setup: seedStats },
  {
    name: '04-setup', page: 'pages/setup/setup.js', title: '练习设置', noTab: true, options: { mode: 'rand' },
    setup: seedStats,
    /* 切到「自选章节」并勾两章：设置页真实能力（章节级选取）在截图里才看得见 */
    post: inst => {
      inst.onScopeTap({ currentTarget: { dataset: { key: 'custom' } } });
      const names = inst.data.chapters.slice(0, 2).map(c => c.name);
      names.forEach(n => inst.onChapterTap({ currentTarget: { dataset: { name: n } } }));
    }
  },
  {
    name: '05-practice', page: 'pages/practice/practice.js', title: '顺序练习 5/12', noTab: true,
    setup: () => seedPractice('seq', { idx: 4, answeredCurrent: ['B'] })
  },
  {
    name: '06-acard', page: 'pages/practice/practice.js', title: '模拟测验 6/12', noTab: true,
    setup: () => {
      const p = seedPractice('exam', { idx: 5 });
      p.ans[IDS[0]] = { sel: ['A'], flag: false };
      p.ans[IDS[1]] = { sel: ['A'], flag: false };
      p.ans[IDS[2]] = { sel: ['B'], flag: true };
      p.ans[IDS[3]] = { sel: ['C'], flag: false };
      p.ans[IDS[4]] = { sel: ['B'], flag: false };
      p.ans[IDS[6]] = { sel: ['A', 'C'], flag: true };
      ['q0001', 'q0002', 'q0003', 'q0004', 'q0005', 'q0007'].forEach((id, i) => { p.fb[id] = i === 2 ? -1 : 1; });
    },
    post: inst => inst.setData({ acardOpen: true })
  },
  { name: '07-wrong', page: 'pages/wrong/wrong.js', title: '未掌握', tab: 2, setup: seedStats },
  { name: '08-report', page: 'pages/report/report.js', title: '练习报告', tab: 3, setup: seedStats },
  {
    /* 并排展示用的短版：只到「薄弱环节」为止（前 5 张卡），渲染后裁掉后面的卡 */
    name: '08-report-top', page: 'pages/report/report.js', title: '练习报告', tab: 3,
    cards: 5, setup: seedStats
  },
  {
    name: '09-result', page: 'pages/result/result.js', title: '成绩', noTab: true,
    setup: () => {
      seedStats();
      store.ui.lastResult = {
        mode: 'exam', score: 92, total: 12, correct: 11, duration: 11 * 60000 + 20000,
        scopeLabel: '全部题库',
        breakdown: { judge: { total: 3, right: 3 }, single: { total: 3, right: 3 }, multi: { total: 2, right: 1 } },
        wrongIds: ['q0008'], unanswered: 0, timedOut: false
      };
    }
  },
  {
    /* 单题修改：以单选题为例（选项 + 答案 chip 都能看到） */
    name: '10-edit', page: 'pages/edit/edit.js', title: '修改题目', noTab: true,
    options: { qid: 'q0002' }, setup: seedStats
  }
];

/* ---------- 逐页采集 ---------- */
const done = [];
SCN.forEach(scn => {
  if (scn.setup) scn.setup();
  const inst = makePage(scn.page, scn.options, null, scn.post);
  const payload = {
    name: scn.name, title: scn.title, tab: scn.tab, noTab: !!scn.noTab,
    page: scn.page, cards: scn.cards || 0, data: inst.data
  };
  fs.writeFileSync(path.join(OUT, scn.name + '.json'), JSON.stringify(payload, null, 2));
  done.push(scn.name);
  if (scn.name === '05-practice') {
    console.log('[practice] stem=', inst.data.q && inst.data.q.stem);
    console.log('[practice] fb=', inst.data.fb, 'cls=', (inst.data.q.options || []).map(o => o.key + ':' + o.cls).join(' '), 'canMark=', inst.data.canMark);
  }
});

console.log('采集完成：', done.join(', '));
process.exit(0);
