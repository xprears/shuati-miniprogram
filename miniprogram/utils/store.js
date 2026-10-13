/* 状态存储模块：单例，localStorage(wx.storage) 持久化，页面间共享 */
const logic = require('./logic.js');

const LS_KEY = 'yjtx.v1';

function defaultState() {
  return {
    v: 1,
    qs: {},         // qid -> {r,w,last,at}
    wrong: {},      // qid -> {n,at,last}
    hidden: {},     // chapter -> true
    practice: null, // 进行中的练习会话
    history: [],
    days: {},
    streak: { last: '', n: 0 },
    settings: { feedback: true }
  };
}

const S = defaultState();
const ui = {
  setupMode: 'seq',
  setupScope: 'all',      // all | general | custom
  setupChapters: [],
  setupTypes: ['judge', 'single', 'multi'],
  setupCount: 50,
  setupDur: 60,
  lastResult: null        // 成绩页数据
};

let inited = false;

function init() {
  if (inited) return;
  inited = true;
  try {
    var raw = wx.getStorageSync(LS_KEY);
    if (raw) {
      var d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (d && d.v === 1) Object.assign(S, d);
    }
  } catch (e) { console.warn('状态读取失败', e); }
}

function save() {
  try { wx.setStorageSync(LS_KEY, S); } catch (e) { console.warn('状态保存失败', e); }
}

/* ---------- 答题记录 ---------- */
function recordAnswer(qid, ok) {
  var st = S.qs[qid] || (S.qs[qid] = { r: 0, w: 0, last: 0, at: 0 });
  if (ok) st.r++; else st.w++;
  st.last = ok ? 1 : -1;
  st.at = Date.now();
  var d = logic.today();
  S.days[d] = (S.days[d] || 0) + 1;
  if (S.streak.last !== d) {
    S.streak.n = (S.streak.last && logic.dayAfter(S.streak.last) === d) ? S.streak.n + 1 : 1;
    S.streak.last = d;
  }
  save();
}
function addWrong(qid) {
  var w = S.wrong[qid] || (S.wrong[qid] = { n: 0, at: Date.now(), last: Date.now() });
  w.n++; w.last = Date.now();
  save();
}
function removeWrong(qid) { delete S.wrong[qid]; save(); }
function wrongCount() { return Object.keys(S.wrong).length; }

/* ---------- 练习会话 ---------- */
function startPractice(mode, pool) {
  var ids = pool.slice();
  if (mode === 'rand' || mode === 'exam') ids = logic.shuffle(ids);
  var limit = (mode === 'rand' || mode === 'exam') ? Math.min(ui.setupCount, ids.length) : ids.length;
  ids = ids.slice(0, limit);

  var scopeLabel = mode === 'wrong' ? '错题本'
    : ui.setupScope === 'all' ? '全部题库'
    : ui.setupScope === 'general' ? '通用题'
    : '自选章节';

  S.practice = {
    mode: mode,
    title: logic.SETUP_MODE_NAME[mode],
    scopeLabel: scopeLabel,
    types: ui.setupTypes.slice(),
    ids: ids,
    idx: 0,
    ans: {},
    fb: {},
    startedAt: Date.now(),
    exam: mode === 'exam' ? { duration: ui.setupDur * 60000, endsAt: Date.now() + ui.setupDur * 60000 } : null,
    done: false
  };
  save();
  return S.practice;
}

/* 交卷后统一落库：反馈开启时逐题已记录，未记录的在此补录 */
function finalizePracticeResults() {
  var p = S.practice;
  if (!p) return { answered: 0, right: 0, breakdown: {}, wrongIds: [] };
  var answered = 0, right = 0, breakdown = {}, wrongIds = [];
  p.ids.forEach(function (id) {
    var q = logic.QMAP[id];
    breakdown[q.type] = breakdown[q.type] || { total: 0, right: 0 };
    breakdown[q.type].total++;
    var ok;
    if (!q.options) {
      if (p.fb[id] === undefined) return;
      ok = p.fb[id] === 1;
    } else {
      var a = p.ans[id];
      if (!a || !a.sel.length) return;
      ok = logic.isCorrect(q, a.sel);
    }
    answered++;
    if (ok) { right++; breakdown[q.type].right++; }
    else wrongIds.push(id);
    if (S.settings.feedback) return; // 已在作答时记录
    recordAnswer(id, ok);
    if (ok) removeWrong(id); else addWrong(id);
  });
  return { answered: answered, right: right, breakdown: breakdown, wrongIds: wrongIds };
}

function finishPractice() {
  var p = S.practice;
  if (!p) return null;
  if (p.mode === 'exam') return null;
  var r = finalizePracticeResults();
  p.done = true;
  ui.lastResult = {
    mode: p.mode, total: p.ids.length,
    answered: r.answered, correct: r.right,
    duration: Date.now() - p.startedAt, scopeLabel: p.scopeLabel,
    breakdown: r.breakdown, wrongIds: r.wrongIds
  };
  S.practice = null;
  save();
  return ui.lastResult;
}

/* ---------- 考试 ---------- */
function gradeExam() {
  var p = S.practice;
  if (!p || p.mode !== 'exam') return null;
  var breakdown = {};
  var correct = 0, total = 0;
  var wrongIds = [], subjIds = [];
  p.ids.forEach(function (id) {
    var q = logic.QMAP[id];
    total++;
    breakdown[q.type] = breakdown[q.type] || { total: 0, right: 0 };
    breakdown[q.type].total++;
    if (!q.options) { subjIds.push(id); return; }
    var a = p.ans[id];
    var ok = logic.isCorrect(q, a && a.sel);
    if (ok) { correct++; breakdown[q.type].right++; recordAnswer(id, true); removeWrong(id); }
    else { wrongIds.push(id); recordAnswer(id, false); addWrong(id); }
  });
  save();
  return { correct: correct, total: total, breakdown: breakdown, wrongIds: wrongIds, subjIds: subjIds };
}

function submitSelfReview(results, base) {
  // base 由页面先经 gradeExam() 得到（客观题已记录），此处只补主观题并完赛
  if (!base) return null;
  var subjRight = 0;
  base.subjIds.forEach(function (id) {
    var v = results[id];
    recordAnswer(id, v === 1);
    if (v === 1) { subjRight++; removeWrong(id); } else { addWrong(id); }
  });
  return finishExam(base, subjRight);
}

function finishExam(base, subjRight) {
  var p = S.practice;
  var total = base.total;
  var correct = base.correct + (subjRight || 0);
  var score = total ? Math.round(correct / total * 100) : 0;
  var duration = Date.now() - p.startedAt;
  S.history.push({
    mode: 'exam', scopeLabel: p.scopeLabel, types: p.types,
    total: total, correct: correct, score: score,
    duration: duration, at: Date.now(), breakdown: base.breakdown
  });
  if (S.history.length > 100) S.history = S.history.slice(-100);
  p.done = true;
  ui.lastResult = {
    mode: 'exam', score: score, total: total, correct: correct,
    duration: duration, breakdown: base.breakdown,
    wrongIds: base.wrongIds, scopeLabel: p.scopeLabel
  };
  S.practice = null;
  save();
  return ui.lastResult;
}

/* 超时自动交卷（由 practice 页定时器/onShow 触发）；
 * 返回 { selfReview: [主观题ids] } 表示需进入自评，否则返回 lastResult */
function onExamTimeout() {
  var p = S.practice;
  if (!p || p.mode !== 'exam' || p.done) return null;
  var base = gradeExam();
  if (base.subjIds.length) return { selfReview: base.subjIds, base: base };
  return finishExam(base, 0);
}

module.exports = {
  S, ui, init, save,
  recordAnswer, addWrong, removeWrong, wrongCount,
  startPractice, finishPractice, finalizePracticeResults,
  gradeExam, submitSelfReview, finishExam, onExamTimeout
};
