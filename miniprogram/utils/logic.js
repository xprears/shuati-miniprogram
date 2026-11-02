/* 纯逻辑模块：评分 / 题池 / 格式化 / 结构树（无 wx 依赖，可在 Node 中单测）
 * 题库运行期加载：bank-store（storage 分片，Node 回退为测试脚本注入的内置题库）。
 * 导入新题库后调 logic.reload(bank?) 重建 QLIST/QMAP/TREE；页面均在 onShow 读取，自动生效。
 */
const bankStore = require('./bank-store.js');

const TYPE_LABEL = { judge: '判断题', single: '单选题', multi: '多选题', blank: '填空题', essay: '论述题', scenario: '情景题', case: '案例分析', operation: '实操模拟' };
/* 顺序即设置页题型 chip 的展示顺序：客观题在前，填空紧跟多选（同为可机器判分），再主观题 */
const TYPE_ORDER = ['judge', 'single', 'multi', 'blank', 'essay', 'scenario', 'case', 'operation'];

/* 空位正则：全角「（ ）」与半角「( )」，允许中间夹任意空白（含全角空格）。
 * 与 bank-validate.js 里的 BLANK_RE 必须保持一致——那边是双端模块，不能 require 本文件。 */
const BLANK_RE = /（[ \t\u3000]*）|\([ \t\u3000]*\)/g;

/* bank 为紧凑态数组（bank-store.load() 的返回形态） */
let QLIST = [], QMAP = {}, TREE = [];

function build(bank) {
  QLIST = (bank || []).map(function (q) {
    var isBlank = q.t === 'blank';
    return {
      id: q.i, type: q.t, stem: q.s, part: q.p, chapter: q.c,
      category: q.g || null,
      options: q.o ? q.o.map(function (o) { return { key: o[0], text: o[1] }; }) : null,
      answer: isBlank ? null : (q.a || null),
      blanks: isBlank ? (Array.isArray(q.a) ? q.a.slice() : (q.a == null || q.a === '' ? [] : [String(q.a)])) : null,
      reference: q.r || null,
      analysis: q.x || null
    };
  });
  QMAP = {};
  QLIST.forEach(function (q) { QMAP[q.id] = q; });
  TREE = [];
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
}

/* 题卡小标签用的短名：去掉序号与【…】后缀（如「二、专业题【铁塔】」→「专业题」） */
function shortPart(p) { return (p || '').replace(/^[一二三四五]、/, '').replace(/【.*?】/g, ''); }
/* 分类展示用的完整名：去序号后，专业题保留【…】后缀（多个「专业题」靠后缀区分），通用题不带后缀 */
function partLabel(p) {
  var s = (p || '').replace(/^[一二三四五]、/, '');
  return s.indexOf('通用题') === 0 ? s.replace(/【.*?】/g, '') : s;
}
function shortChapter(c) { return (c || '').replace(/【.*?】/g, ''); }

function answerKey(q, ans) { return q.type === 'judge' ? (ans === '√' ? 'A' : 'B') : ans; }

/* ---------- 填空题 ---------- */
/* 题干拆成「文本段 + 空位段」：WXML 里不能调方法，段落必须在这里算好。
 * 返回 { segs:[{t:'text',v}|{t:'blank',n}], count } —— count 是空位个数。 */
function splitBlanks(stem) {
  var s = String(stem == null ? '' : stem);
  var re = new RegExp(BLANK_RE.source, 'g');
  var segs = [], last = 0, n = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) segs.push({ t: 'text', v: s.slice(last, m.index) });
    n++;
    segs.push({ t: 'blank', n: n });
    last = m.index + m[0].length;
  }
  if (last < s.length) segs.push({ t: 'text', v: s.slice(last) });
  return { segs: segs, count: n };
}
function countBlanks(stem) { return splitBlanks(stem).count; }

/* 每空的可接受答案：q.blanks（或旧形态 q.answer 数组），一个元素里用 | 分隔等价写法 */
function blanksOf(q) {
  if (!q) return [];
  if (Array.isArray(q.blanks) && q.blanks.length) return q.blanks;
  if (Array.isArray(q.answer) && q.answer.length) return q.answer;
  return [];
}

/* 答案归一化：全角 ASCII → 半角、去所有空白、英文小写、去首尾标点。
 * 不做中文数字互换（二/2）、不忽略单位（3 与 3m 不同）—— 那两类会静默把错答案判对。 */
function normBlank(v) {
  var s = String(v == null ? '' : v);
  s = s.replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  s = s.replace(/\u3000/g, ' ');
  s = s.replace(/\s+/g, '');
  s = s.toLowerCase();
  s = s.replace(/^[，。、；：！？,.;:!?'"“”‘’]+/, '').replace(/[，。、；：!？,.;:!'"“”‘’]+$/, '');
  return s;
}
function acceptList(raw) {
  return String(raw == null ? '' : raw).split('|').map(normBlank).filter(function (x) { return !!x; });
}

/* 逐空判分：UI 要按空标红、按空给答案，所以不只返回整体对错 */
function blankCheck(q, sel) {
  var ans = blanksOf(q);
  var list = Array.isArray(sel) ? sel : [];
  return ans.map(function (raw, i) {
    var acc = acceptList(raw);
    var got = normBlank(list[i]);
    return { ok: !!got && acc.indexOf(got) >= 0, accept: acc, raw: String(raw == null ? '' : raw) };
  });
}
function isBlankCorrect(q, sel) {
  var ans = blanksOf(q);
  if (!ans.length) return false;
  if (!Array.isArray(sel) || sel.length !== ans.length) return false;
  return blankCheck(q, sel).every(function (r) { return r.ok; });
}

/* 主观题判定必须显式：填空题没有 options，若还用「没有 options 就是主观题」，
 * 它会掉进自评流程、在测验里永远 0 分且不算未作答。 */
function isSubjective(q) { return !!q && q.type !== 'blank' && !q.options; }
function isFillBlank(q) { return !!q && q.type === 'blank'; }

/* 「已答」的唯一口径：答题卡、测验未作答提示、交卷统计必须共用，
 * 否则「答题卡显示已答 3 题」和「还有 5 题未作答」会互相打脸。
 * 填空题要求每个空都非空才算答了 —— 只填第一空就等于没做完。 */
function isAnswered(q, sel) {
  var list = Array.isArray(sel) ? sel : [];
  if (!q) return false;
  if (q.type === 'blank') {
    var n = blanksOf(q).length;
    if (!n || list.length < n) return false;
    for (var i = 0; i < n; i++) { if (!normBlank(list[i])) return false; }
    return true;
  }
  return list.length > 0;
}

function isCorrect(q, sel) {
  if (!sel || !sel.length) return false;
  if (q.type === 'judge') return sel[0] === answerKey(q, q.answer);
  if (q.type === 'single') return sel.length === 1 && sel[0] === q.answer;
  if (q.type === 'blank') return isBlankCorrect(q, sel);
  if (q.type === 'multi') {
    var rawAns = String(q.answer || '').replace(/[^A-Za-z]/g, '').toUpperCase();
    var a = rawAns.split('').sort();
    var b = sel.map(function (x) { return String(x).toUpperCase(); }).sort();
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
function dayAfter(ds) {
  var parts = String(ds || '').split('-');
  if (parts.length === 3) {
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, day = parseInt(parts[2], 10);
    var d = new Date(y, m, day + 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  var fallback = new Date(ds);
  fallback.setDate(fallback.getDate() + 1);
  return fallback.getFullYear() + '-' + pad(fallback.getMonth() + 1) + '-' + pad(fallback.getDate());
}
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
const SETUP_MODE_NAME = { seq: '顺序练习', rand: '随机练习', exam: '模拟测验', wrong: '未掌握重练' };

const api = {
  QLIST, QMAP, TREE, TYPE_LABEL, TYPE_ORDER, SETUP_MODE_NAME,
  shortPart, partLabel, shortChapter, answerKey, isCorrect, poolIds, shuffle,
  splitBlanks, countBlanks, blanksOf, normBlank, blankCheck, isBlankCorrect,
  isSubjective, isFillBlank, isAnswered,
  pct, pad, today, dayAfter, fmtDur, fmtClock, fmtDateTime,
  /* 导入/清除题库后调用：传紧凑态数组直接重建，不传则从 bank-store 重读 */
  reload: function (bank) {
    build(bank || bankStore.load());
    api.QLIST = QLIST; api.QMAP = QMAP; api.TREE = TREE;
  }
};
module.exports = api;

build(bankStore.load());
api.QLIST = QLIST; api.QMAP = QMAP; api.TREE = TREE;
