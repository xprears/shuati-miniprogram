/* 纯逻辑模块：评分 / 题池 / 格式化 / 结构树（无 wx 依赖，可在 Node 中单测） */
const QBANK = require('./qbank.js');

const TYPE_LABEL = { judge: '判断题', single: '单选题', multi: '多选题', essay: '论述题', scenario: '情景题', case: '案例分析', operation: '实操模拟' };
const TYPE_ORDER = ['judge', 'single', 'multi', 'essay', 'scenario', 'case', 'operation'];

const QLIST = QBANK.map(function (q) {
  return {
    id: q.i, type: q.t, stem: q.s, part: q.p, chapter: q.c,
    category: q.g || null,
    options: q.o ? q.o.map(function (o) { return { key: o[0], text: o[1] }; }) : null,
    answer: q.a || null,
    reference: q.r || null,
    analysis: q.x || null
  };
});
const QMAP = {};
QLIST.forEach(function (q) { QMAP[q.id] = q; });

/* 题卡小标签用的短名：去掉序号与【…】后缀（如「二、专业题【铁塔】」→「专业题」） */
function shortPart(p) { return (p || '').replace(/^[一二三四五]、/, '').replace(/【.*?】/g, ''); }
/* 分类展示用的完整名：去序号后，专业题保留【…】后缀（多个「专业题」靠后缀区分），通用题不带后缀 */
function partLabel(p) {
  var s = (p || '').replace(/^[一二三四五]、/, '');
  return s.indexOf('通用题') === 0 ? s.replace(/【.*?】/g, '') : s;
}
function shortChapter(c) { return (c || '').replace(/【.*?】/g, ''); }

/* part -> chapter 结构树 */
const TREE = [];
(function buildTree() {
  var pMap = {}, cMap = {};
  QLIST.forEach(function (q) {
    var p = pMap[q.part] || (pMap[q.part] = { name: shortPart(q.part), label: partLabel(q.part), full: q.part, chapters: [], count: 0 });
    p.count++;
    var c = cMap[q.chapter] || (cMap[q.chapter] = { name: q.chapter, part: q.part, cats: {}, count: 0, ids: [] });
    if (p.chapters.indexOf(c) < 0) p.chapters.push(c);
    c.count++; c.ids.push(q.id);
    if (q.category) c.cats[q.category] = (c.cats[q.category] || 0) + 1;
  });
  Object.keys(pMap).forEach(function (k) { TREE.push(pMap[k]); });
})();

function answerKey(q, ans) { return q.type === 'judge' ? (ans === '√' ? 'A' : 'B') : ans; }

function isCorrect(q, sel) {
  if (!sel || !sel.length) return false;
  if (q.type === 'judge') return sel[0] === answerKey(q, q.answer);
  if (q.type === 'single') return sel.length === 1 && sel[0] === q.answer;
  if (q.type === 'multi') {
    var a = q.answer.split('').slice().sort();
    var b = sel.slice().sort();
    return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
  }
  return null; // 主观题
}

function poolIds(opts) {
  opts = opts || {};
  var types = opts.types || TYPE_ORDER.slice();
  var out = [];
  QLIST.forEach(function (q) {
    if (opts.hidden && opts.hidden[q.chapter]) return;
    if (types.indexOf(q.type) < 0) return;
    if (opts.scope === 'general' && q.part.indexOf('通用题') < 0) return;
    if (opts.scope === 'custom' && opts.chapters && opts.chapters.indexOf(q.chapter) < 0) return;
    out.push(q.id);
  });
  return out;
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function dayAfter(ds) { var d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDur(ms) {
  var s = Math.max(0, Math.round(ms / 1000));
  var m = Math.floor(s / 60); s -= m * 60;
  if (m >= 60) { var hh = Math.floor(m / 60); m -= hh * 60; return hh + '小时' + m + '分'; }
  return m + ':' + pad(s);
}
function fmtClock(ms) {
  var s = Math.max(0, Math.ceil(ms / 1000));
  var m = Math.floor(s / 60); s -= m * 60;
  return pad(m) + ':' + pad(s);
}
function fmtDateTime(ts) {
  var d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* 页面设置项（跨页共享，存 store.ui） */
const SETUP_MODE_NAME = { seq: '顺序练习', rand: '随机练习', exam: '模拟考试', wrong: '错题复习' };

module.exports = {
  QLIST, QMAP, TREE, TYPE_LABEL, TYPE_ORDER, SETUP_MODE_NAME,
  shortPart, partLabel, shortChapter, answerKey, isCorrect, poolIds, shuffle,
  pct, pad, today, dayAfter, fmtDur, fmtClock, fmtDateTime
};
