/* 状态存储模块：单例，localStorage(wx.storage) 持久化，页面间共享 */
const logic = require('./logic.js');
const bankStore = require('./bank-store.js');

const LS_KEY = 'yjtx.v1';

function defaultState() {
  return {
    v: 1,
    qs: {},         // qid -> {r,w,cs,last,at}  cs=连续答对次数（自动掌握用）
    wrong: {},      // qid -> {n,at,last}  未掌握（错题本）
    mastered: {},   // qid -> ts           已掌握（抽题降权）
    hidden: {},     // chapter -> true
    collapsed: {},  // part -> true       分类页大标题折叠（下次打开沿用）
    qedits: {},     // qid -> {at, before} 单题修改的原值备份，供「还原为原始版本」
    practice: null, // 进行中的练习会话
    history: [],
    days: {},
    streak: { last: '', n: 0 },
    /* autoMaster：连续答对几次自动标记「已掌握」，0=关闭。见 _recordAnswer */
    settings: { feedback: true, autoMaster: 2 },
    bankFp: ''          // 练习记录所属题库的指纹（换库后据此对账，见 reconcileBank）
  };
}

const S = defaultState();
const ui = {
  setupMode: 'seq',
  setupScope: 'all',      // all | general | custom
  setupChapters: [],
  /* 默认全选题型：曾经默认只勾判断/单选/多选，导入的主观题（论述/情景/案例/实操）
     4 类默认不出现，用户会以为题库丢题。设置页按「当前题库实际有的题型」再收敛。 */
  setupTypes: logic.TYPE_ORDER.slice(),
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
      if (d && d.v === 1) {
        ['qs', 'wrong', 'mastered', 'hidden', 'collapsed', 'qedits', 'practice', 'history', 'days', 'streak', 'settings', 'bankFp'].forEach(function (k) {
          if (d[k] !== undefined) S[k] = d[k];
        });
      }
    }
    if (!S.mastered) S.mastered = {};   // 旧存档（无 mastered 字段）兜底
    if (!S.collapsed) S.collapsed = {}; // 旧存档（无 collapsed 字段）兜底
    if (!S.qedits) S.qedits = {};
    /* 旧存档的 settings 里没有 autoMaster：补默认值 2（不能补 0，否则升级后功能悄悄失效） */
    if (S.settings.autoMaster === undefined) S.settings.autoMaster = 2;
  } catch (e) { console.warn('状态读取失败', e); }
}

/* 写入失败必须让用户知道一次：原来只 console.warn，存储写不进去时界面照常显示
 * 「已标记」「已答对」，下次进来记录全没了，比报错更难排查。只提示一次，避免每次
 * 操作都弹 toast。 */
let saveWarned = false;
function save() {
  try { wx.setStorageSync(LS_KEY, S); }
  catch (e) {
    console.warn('状态保存失败', e);
    if (saveWarned) return;
    saveWarned = true;
    try {
      wx.showToast({ title: '本机存储写入失败，本次记录可能未保存', icon: 'none', duration: 2500 });
    } catch (_) {}
  }
}

/* 自动掌握门槛：0 = 关闭 */
function autoMasterThreshold() {
  var v = S.settings && S.settings.autoMaster;
  return typeof v === 'number' ? v : 2;
}

/* 记一次答题。返回 true 表示本次触发了「自动标记已掌握」。
 * autoMaster 只在练习模式传 true —— 测验答对一次不代表掌握，且测验不给即时反馈，
 * 自动掌握会让用户莫名多出一批「已掌握」；所以测验既不推进 cs，也不自动掌握。
 * cs（连续答对）只在练习模式推进，答错一律清零。 */
function _recordAnswer(qid, ok, autoMaster) {
  var st = S.qs[qid] || (S.qs[qid] = { r: 0, w: 0, last: 0, at: 0 });
  if (ok) st.r++; else st.w++;
  st.last = ok ? 1 : -1;
  st.at = Date.now();
  if (!ok) {
    st.cs = 0;
    /* 答错必须同时离开「已掌握」：原来只写 wrong 不删 mastered，同一道题会同时
       计入已掌握与未掌握（报告页两格都 +1，自相矛盾） */
    if (S.mastered[qid]) delete S.mastered[qid];
  } else if (autoMaster) {
    st.cs = (st.cs || 0) + 1;
  }
  var d = logic.today();
  S.days[d] = (S.days[d] || 0) + 1;
  if (S.streak.last !== d) {
    S.streak.n = (S.streak.last && logic.dayAfter(S.streak.last) === d) ? S.streak.n + 1 : 1;
    S.streak.last = d;
  }
  var th = autoMasterThreshold();
  if (ok && autoMaster && th > 0 && (st.cs || 0) >= th && !S.mastered[qid]) {
    S.mastered[qid] = Date.now();
    delete S.wrong[qid];
    return true;
  }
  return false;
}

function _addWrong(qid) {
  var w = S.wrong[qid] || (S.wrong[qid] = { n: 0, at: Date.now(), last: Date.now() });
  w.n++; w.last = Date.now();
  if (S.mastered[qid]) delete S.mastered[qid];   // 答错即退出已掌握
}

function _removeWrong(qid) {
  delete S.wrong[qid];
}

/* ---------- 答题记录 ---------- */
/* autoMaster 传 true（仅练习模式）时按 settings.autoMaster 门槛自动标记掌握。
 * 返回 { mastered }：mastered=true 表示这次答对触发了自动掌握，页面据此提示用户。 */
function recordAnswer(qid, ok, autoMaster) {
  var mastered = _recordAnswer(qid, ok, !!autoMaster);
  save();
  return { mastered: mastered };
}
function addWrong(qid) {
  _addWrong(qid);
  save();
}
function removeWrong(qid) {
  _removeWrong(qid);
  save();
}
function wrongCount() { return Object.keys(S.wrong).length; }

/* ---------- 掌握度标记 ----------
 * 「未掌握」沿用 wrong 表（错题本），手动点「未掌握」即入库；
 * 「已掌握」记 mastered 表，抽题时权重降低。答错自动入库，答对自动出库。
 */
function markUnmastered(qid) {
  // 手动标记不累加「答错次数」（n 仅在真正答错时 +1），已有记录保留原 n
  var w = S.wrong[qid];
  if (w) w.last = Date.now();
  else S.wrong[qid] = { n: 0, at: Date.now(), last: Date.now() };
  if (S.mastered[qid]) delete S.mastered[qid];
  // 连续答对计数要清零：否则下次答对立刻又被自动掌握，用户会觉得按钮没生效
  if (S.qs[qid]) S.qs[qid].cs = 0;
  save();
}
function markMastered(qid) {
  S.mastered[qid] = Date.now();
  if (S.wrong[qid]) delete S.wrong[qid];
  save();
}
function isMastered(qid) { return !!S.mastered[qid]; }
function masteredCount() { return Object.keys(S.mastered).length; }

/* 抽题权重：未掌握 4 / 未作答 2 / 已掌握 1 */
function weightOf(qid) {
  if (S.wrong[qid]) return 4;
  if (S.mastered[qid]) return 1;
  return 2;
}

/* 加权不放回抽样：按权重把 id 重复投进池子再洗牌去重，权重高的更靠前 */
function weightedPick(ids, n) {
  var bag = [];
  for (var i = 0; i < ids.length; i++) {
    var w = weightOf(ids[i]);
    for (var k = 0; k < w; k++) bag.push(ids[i]);
  }
  var sh = logic.shuffle(bag);
  var seen = {}, out = [];
  for (var j = 0; j < sh.length && out.length < n; j++) {
    if (seen[sh[j]]) continue;
    seen[sh[j]] = 1;
    out.push(sh[j]);
  }
  // 池子被去重后不足 n（理论上不会，权重≥1 保证 bag ≥ ids），兜底补齐
  if (out.length < n) {
    for (var m = 0; m < ids.length && out.length < n; m++) {
      if (!seen[ids[m]]) { seen[ids[m]] = 1; out.push(ids[m]); }
    }
  }
  return out;
}

/* ---------- 练习会话 ---------- */
function startPractice(mode, pool) {
  var ids = pool.slice();
  if (mode === 'rand') {
    // 随机练习按掌握度加权抽题：已掌握的出现更少，未掌握/错题出现更多
    ids = weightedPick(ids, Math.min(ui.setupCount, ids.length));
  } else if (mode === 'exam') {
    ids = logic.shuffle(ids).slice(0, Math.min(ui.setupCount, ids.length));
  } else {
    ids = ids.slice(0, ids.length);
  }

  var scopeLabel = mode === 'wrong' ? '未掌握题'
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
    if (!q) return; // 防御：若当前题已不在当前题库中，跳过避免空指针异常
    breakdown[q.type] = breakdown[q.type] || { total: 0, right: 0 };
    breakdown[q.type].total++;
    var ok;
    if (logic.isSubjective(q)) {
      if (p.fb[id] === undefined) return;
      ok = p.fb[id] === 1;
    } else {
      var a = p.ans[id];
      if (!logic.isAnswered(q, a && a.sel)) return;   // 填空题只填一半 = 没答
      ok = logic.isCorrect(q, a.sel);
    }
    answered++;
    if (ok) { right++; breakdown[q.type].right++; }
    else wrongIds.push(id);
    if (S.settings.feedback) return; // 已在作答时记录
    _recordAnswer(id, ok, true);     // 关闭即时反馈时也在练习模式，照样算连续答对
    if (ok) _removeWrong(id); else _addWrong(id);
  });
  if (!S.settings.feedback && answered > 0) save();
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
  try { wx.setStorageSync('lastResult', ui.lastResult); } catch (e) {}
  S.practice = null;
  save();
  return ui.lastResult;
}

/* ---------- 测验 ---------- */
/* 判分：只允许记账一次。
 * 幂等是为了挡住三种真实路径：① 交卷按钮连点；② 交卷后杀进程/自评中途退出再进来又交一次；
 * ③ 倒计时与 onShow 补偿同时触发。没有这道锁时同一题的答题次数与未掌握次数会成倍累加。
 * 未作答题只在成绩里算错：不记答题次数、不进未掌握——退出测验隔天回来超时自动交卷，
 * 曾把几十道从没见过的题一次性灌进未掌握列表。 */
function gradeExam() {
  var p = S.practice;
  if (!p || p.mode !== 'exam') return null;
  if (p.graded && p.gradeResult) return p.gradeResult;

  var breakdown = {};
  var correct = 0, total = 0, answeredN = 0;
  var wrongIds = [], subjIds = [], unansweredIds = [];
  p.ids.forEach(function (id) {
    var q = logic.QMAP[id];
    if (!q) { unansweredIds.push(id); total++; return; }
    total++;
    breakdown[q.type] = breakdown[q.type] || { total: 0, right: 0 };
    breakdown[q.type].total++;
    if (logic.isSubjective(q)) { subjIds.push(id); return; }
    var a = p.ans[id];
    if (!logic.isAnswered(q, a && a.sel)) { unansweredIds.push(id); return; }
    answeredN++;
    var ok = logic.isCorrect(q, a.sel);
    if (ok) { correct++; breakdown[q.type].right++; _recordAnswer(id, true); _removeWrong(id); }
    else { wrongIds.push(id); _recordAnswer(id, false); _addWrong(id); }
  });
  p.graded = true;
  p.gradeResult = {
    correct: correct, total: total, answered: answeredN,
    breakdown: breakdown, wrongIds: wrongIds, subjIds: subjIds, unansweredIds: unansweredIds
  };
  save();
  return p.gradeResult;
}

function submitSelfReview(results, base) {
  // base 由页面先经 gradeExam() 得到（客观题已记录），此处只补主观题并完赛
  if (!base) return null;
  var p = S.practice;
  if (!p || p.done) return null;
  var subjRight = 0;
  if (!p.subjGraded) {
    base.subjIds.forEach(function (id) {
      var v = results[id];
      _recordAnswer(id, v === 1);
      if (v === 1) { subjRight++; _removeWrong(id); } else { _addWrong(id); }
    });
    p.subjGraded = true;
    p.subjRight = subjRight;
    save();
  } else {
    subjRight = p.subjRight || 0;   // 自评已记过账：重复提交只补完赛，不再累加
  }
  return finishExam(base, subjRight);
}

function finishExam(base, subjRight) {
  var p = S.practice;
  if (!p || !base) return null;
  if (p.done) return ui.lastResult;
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
    wrongIds: base.wrongIds, scopeLabel: p.scopeLabel,
    unanswered: (base.unansweredIds || []).length,
    timedOut: !!(p.exam && p.exam.endsAt <= Date.now())
  };
  try { wx.setStorageSync('lastResult', ui.lastResult); } catch (e) {}
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

/* ---------- 题库对账：练习记录跟着题库走 ----------
 * 空壳形态下换题库是常态，而两个题库的 id 都从 q0001 起编号——旧记录按题号
 * 无法可靠归属（q0001 既是旧库第 1 题也是新库第 1 题），只能用题库指纹判定：
 *   指纹相同 = 同一个题库（含清库后重导），记录一律保留；
 *   指纹不同 = 换库了 → 当前题库里查不到的记录（幽灵 id）与进行中的会话清掉，
 *              同号记录算新库的，由导入页问用户是否连旧记录一起清。
 * 无题库时（空态）一律不动数据：等新题库进来再对账，避免误删。
 */
function pruneGhosts() {
  ['qs', 'wrong', 'mastered'].forEach(function (t) {
    Object.keys(S[t] || {}).forEach(function (id) { if (!logic.QMAP[id]) delete S[t][id]; });
  });
}

/* 是否已有任何练习痕迹（换库时用它决定要不要问用户） */
function hasStats() {
  return Object.keys(S.qs).length > 0 || Object.keys(S.wrong).length > 0 ||
         Object.keys(S.mastered).length > 0 || S.history.length > 0 ||
         Object.keys(S.days).length > 0 || !!(S.practice && S.practice.ids && S.practice.ids.length);
}

/* 与当前题库对账；返回 'changed' 时调用方应提示用户「旧记录按题号可能对不上」 */
function reconcileBank() {
  var cur = bankStore.currentFingerprint() || '';
  var prev = S.bankFp || '';
  if (!cur) return 'same';                 // 无题库：保持原绑定，等新题库来了再对账
  if (prev === cur) return 'same';         // 同一个题库
  var changed = hasStats();
  S.bankFp = cur;
  pruneGhosts();
  S.practice = null;                        // 进行中的会话属于旧题库，题号已对不上
  save();
  return changed ? 'changed' : 'same';
}

/* 清空全部练习痕迹，保留设置、题库指纹、折叠状态与单题修改留底 */
function resetStats() {
  var keep = { settings: S.settings, bankFp: S.bankFp, collapsed: S.collapsed, qedits: S.qedits };
  var fresh = defaultState();
  Object.keys(S).forEach(function (k) { delete S[k]; });
  Object.assign(S, fresh, keep);
  save();
}

/* 全部重置（报告页「重置所有练习数据」）：记录与设置一起回默认值。
 * 保留题库指纹（丢了下次启动会被当成换题库，平白弹一次清记录询问）、
 * 折叠状态与单题修改留底（这两项不是「练习痕迹」）。 */
function resetAll() {
  var keep = { bankFp: S.bankFp, collapsed: S.collapsed, qedits: S.qedits };
  var fresh = defaultState();
  Object.keys(S).forEach(function (k) { delete S[k]; });
  Object.assign(S, fresh, keep);
  save();
}

/* 连续打卡的「当前值」：S.streak.n 只在答题时递增，断签后不会自己归零——
 * 最后答题是 2026-01-01、n=9 时，今天照样显示「9 天」。这里按最后答题日实时折算：
 * 今天答过、或昨天答过（今天还没答）都算连续，再早就已断签，显示 0。 */
function currentStreak() {
  var last = S.streak && S.streak.last;
  var n = (S.streak && S.streak.n) || 0;
  if (!last || !n) return 0;
  var d = logic.today();
  if (last === d) return n;
  if (logic.dayAfter(last) === d) return n;
  return 0;
}

/* 统计口径（首页与报告页共用）：只算当前题库里的题，旧题库遗留的 id 一律不计；
 * 没有题库就没有练习统计——归零，而不是显示上一套题库的数字。 */
function stats() {
  var noBank = !logic.QLIST.length;
  var totalAns = 0, totalRight = 0;
  if (!noBank) {
    Object.keys(S.qs).forEach(function (id) {
      if (!logic.QMAP[id]) return;
      totalAns += S.qs[id].r + S.qs[id].w;
      totalRight += S.qs[id].r;
    });
  }
  function inBank(table) {
    return Object.keys(table).filter(function (id) { return !!logic.QMAP[id]; }).length;
  }
  return {
    noBank: noBank,
    totalAns: totalAns,
    accuracy: totalAns ? logic.pct(totalRight, totalAns) + '%' : '-',
    days: noBank ? 0 : Object.keys(S.days).length,
    streakN: noBank ? 0 : currentStreak(),
    wrongN: noBank ? 0 : inBank(S.wrong),
    masteredN: noBank ? 0 : inBank(S.mastered),
    examN: noBank ? 0 : S.history.length
  };
}

/* 单题内容被修改后，这道题的旧判定已失效：摘掉已掌握/未掌握，并清连续答对计数。
 * 不重算历史答题次数（r/w 保留——「练过几次」是事实，不随答案修订而改变）。 */
function invalidateMarks(qid) {
  delete S.mastered[qid];
  delete S.wrong[qid];
  if (S.qs[qid]) S.qs[qid].cs = 0;
  save();
}

module.exports = {
  S, ui, init, save, defaultState,
  reconcileBank, pruneGhosts, hasStats, resetStats, resetAll, stats, currentStreak,
  recordAnswer, addWrong, removeWrong, wrongCount,
  markUnmastered, markMastered, isMastered, masteredCount, weightedPick,
  autoMasterThreshold, invalidateMarks,
  startPractice, finishPractice, finalizePracticeResults,
  gradeExam, submitSelfReview, finishExam, onExamTimeout
};
