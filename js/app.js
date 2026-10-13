/* ============================================================
 * 应急通信技能比武 · 理论考核刷题小程序
 * 功能：分类管理 / 顺序·随机·模拟考试 / 答题卡 / 进度保存 /
 *       客观题自动评分 / 错题本 / 成绩统计与学习报告
 * 数据：localStorage 持久化（key: yjtx.v1）
 * ============================================================ */
(function () {
"use strict";

/* ==================== 工具 ==================== */
var $ = function (s, el) { return (el || document).querySelector(s); };
var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
function h(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function dayAfter(ds) { var d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function fmtDur(ms) {
  var s = Math.max(0, Math.round(ms / 1000));
  var m = Math.floor(s / 60); s -= m * 60;
  if (m >= 60) { var hh = Math.floor(m / 60); m -= hh * 60; return hh + "小时" + m + "分"; }
  return m + ":" + pad(s);
}
function fmtClock(ms) {
  var s = Math.max(0, Math.ceil(ms / 1000));
  var m = Math.floor(s / 60); s -= m * 60;
  return pad(m) + ":" + pad(s);
}
function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
function toast(msg) {
  var root = $("#toast-root");
  var t = h("div", "toast", msg);
  root.appendChild(t);
  setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 1600);
  setTimeout(function () { t.remove(); }, 2000);
}

/* ==================== 题库索引 ==================== */
var TYPE_LABEL = { judge: "判断题", single: "单选题", multi: "多选题", essay: "论述题", scenario: "情景题", case: "案例分析", operation: "实操模拟" };
var TYPE_ORDER = ["judge", "single", "multi", "essay", "scenario", "case", "operation"];
var QLIST = window.QBANK.map(function (q) {
  return {
    id: q.i, type: q.t, stem: q.s, part: q.p, chapter: q.c,
    category: q.g || null,
    options: q.o ? q.o.map(function (o) { return { key: o[0], text: o[1] }; }) : null,
    answer: q.a || null,
    reference: q.r || null,
    analysis: q.x || null
  };
});
var QMAP = {};
QLIST.forEach(function (q) { QMAP[q.id] = q; });
function shortPart(p) { return (p || "").replace(/^[一二三四五]、/, "").replace(/【.*?】/g, ""); }
function partLabel(p) {
  var s = (p || "").replace(/^[一二三四五]、/, "");
  return s.indexOf("通用题") === 0 ? s.replace(/【.*?】/g, "") : s;
}
function shortChapter(c) { return (c || "").replace(/【.*?】/g, ""); }

/* 结构树：part -> chapter */
var TREE = [];
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
  TREE = Object.keys(pMap).map(function (k) { return pMap[k]; });
})();

/* ==================== 持久化状态 ==================== */
var LS_KEY = "yjtx.v1";
function defaultState() {
  return {
    v: 1,
    qs: {},        // qid -> {r,w,last,at}
    wrong: {},     // qid -> {n,at,last}
    hidden: {},    // chapter -> true
    practice: null,
    rec: null,     // 已即时判分记录 {qid: 1|-1}
    history: [],
    days: {},
    streak: { last: "", n: 0 },
    settings: { feedback: true }
  };
}
var S = defaultState();
(function load() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.v === 1) S = Object.assign(defaultState(), d);
    }
  } catch (e) { console.warn("状态读取失败", e); }
})();
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); }
  catch (e) { console.warn("状态保存失败", e); }
}

/* ==================== 全局 UI 状态 ==================== */
var ui = {
  tab: "home",
  view: "home",
  setupMode: "seq",
  setupScope: "all",     // all | general | custom
  setupChapters: [],
  setupTypes: ["judge", "single", "multi"],
  setupCount: 50,
  setupDur: 60,
  showRef: false,
  selfReview: null,
  resultData: null
};

/* ==================== 评分与记录 ==================== */
function answerKey(q, ans) { return q.type === "judge" ? (ans === "√" ? "A" : "B") : ans; }
function isCorrect(q, sel) {
  if (!sel || !sel.length) return false;
  if (q.type === "judge") return sel[0] === answerKey(q, q.answer);
  if (q.type === "single") return sel.length === 1 && sel[0] === q.answer;
  if (q.type === "multi") {
    var a = q.answer.split("").slice().sort();
    var b = sel.slice().sort();
    return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
  }
  return null; // 主观题
}
function recordAnswer(qid, ok) {
  var st = S.qs[qid] || (S.qs[qid] = { r: 0, w: 0, last: 0, at: 0 });
  if (ok) st.r++; else st.w++;
  st.last = ok ? 1 : -1;
  st.at = Date.now();
  var d = today();
  S.days[d] = (S.days[d] || 0) + 1;
  if (S.streak.last !== d) {
    S.streak.n = (S.streak.last && dayAfter(S.streak.last) === d) ? S.streak.n + 1 : 1;
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

/* ==================== 题池 ==================== */
function poolIds(opts) {
  opts = opts || {};
  var types = opts.types || TYPE_ORDER.slice();
  var out = [];
  QLIST.forEach(function (q) {
    if (S.hidden[q.chapter]) return;
    if (types.indexOf(q.type) < 0) return;
    if (opts.scope === "general" && q.part.indexOf("通用题") < 0) return;
    if (opts.scope === "custom" && opts.chapters && opts.chapters.indexOf(q.chapter) < 0) return;
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

/* ==================== 视图框架 ==================== */
var view = $("#view"), topTitle = $("#topbar-title"), btnBack = $("#btn-back"), topExtra = $("#topbar-extra");
var timerEl = null, timer = null;

function setChrome(title, opts) {
  opts = opts || {};
  topTitle.textContent = title;
  topTitle.classList.toggle("left", !!opts.titleLeft);
  btnBack.hidden = !opts.back;
  if (opts.back) btnBack.onclick = opts.back;
  topExtra.innerHTML = "";
  if (opts.extra) topExtra.appendChild(opts.extra);
  $("#tabbar").style.display = opts.tabbar === false ? "none" : "flex";
}
function switchTab(tab) {
  ui.tab = tab; ui.view = tab;
  $$(".tab").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); });
  if (tab === "home") renderHome();
  else if (tab === "bank") renderBank();
  else if (tab === "wrong") renderWrong();
  else if (tab === "report") renderReport();
}
$$(".tab").forEach(function (b) {
  b.addEventListener("click", function () { switchTab(b.dataset.tab); });
});

/* ==================== 模态 ==================== */
function openSheet(build) {
  closeSheet();
  var mask = h("div", "mask");
  var sheet = h("div", "sheet");
  mask.appendChild(sheet);
  mask.addEventListener("click", function (e) { if (e.target === mask) closeSheet(); });
  $("#modal-root").appendChild(mask);
  build(sheet);
  return sheet;
}
function closeSheet() { $("#modal-root").innerHTML = ""; }
function confirmDialog(msg, okText, danger, onOk) {
  var mask = h("div", "mask center");
  var dlg = h("div", "dialog");
  var body = h("div", "body"); body.textContent = msg;
  var foot = h("div", "foot");
  var no = h("button", "", "取消");
  var yes = h("button", danger ? "danger" : "", okText || "确定");
  no.onclick = closeSheet;
  yes.onclick = function () { closeSheet(); onOk && onOk(); };
  foot.appendChild(no); foot.appendChild(yes);
  dlg.appendChild(body); dlg.appendChild(foot);
  mask.appendChild(dlg);
  mask.addEventListener("click", function (e) { if (e.target === mask) closeSheet(); });
  $("#modal-root").appendChild(mask);
}

/* ==================== 首页 ==================== */
function renderHome() {
  ui.view = "home";
  view.innerHTML = "";
  view.scrollTop = 0;

  var hero = h("div", "hero");
  hero.appendChild(h("h2", "", "2026 应急通信技能比武 · 理论考核"));
  var chTotal = TREE.reduce(function (n, p) { return n + p.chapters.length; }, 0);
  hero.appendChild(h("div", "sub", "共 " + QLIST.length + " 题 · " + TREE.length + " 大分类 · " + chTotal + " 个章节"));
  var totalAns = 0, totalRight = 0;
  Object.keys(S.qs).forEach(function (k) { totalAns += S.qs[k].r + S.qs[k].w; totalRight += S.qs[k].r; });
  var st = h("div", "hero-stats");
  [
    ["累计答题", totalAns],
    ["总正确率", totalAns ? pct(totalRight, totalAns) + "%" : "-"],
    ["错题本", wrongCount()],
    ["连续打卡", S.streak.n + "天"]
  ].forEach(function (x) {
    var d = h("div"); d.appendChild(h("b", "", x[1])); d.appendChild(h("span", "", x[0]));
    st.appendChild(d);
  });
  hero.appendChild(st);
  view.appendChild(hero);

  // 继续练习横幅
  var p = S.practice;
  if (p && !p.done && p.ids && p.ids.length) {
    var ban = h("div", "resume-banner");
    var g = h("div", "grow");
    g.appendChild(h("b", "", "继续" + p.title));
    var answered = p.ids.filter(function (id) { return p.ans[id] && p.ans[id].sel.length; }).length;
    g.appendChild(h("span", "", "进度 " + Math.min(p.idx + 1, p.ids.length) + "/" + p.ids.length + " · 已答 " + answered + " 题"));
    ban.appendChild(g);
    var go = h("button", "btn sm", p.mode === "exam" ? "继续考试" : "继续练习");
    go.onclick = function () { enterPractice(); };
    ban.appendChild(go);
    view.appendChild(ban);
  }

  // 模式入口
  var grid = h("div", "mode-grid");
  var modes = [
    { m: "seq", cls: "blue", icon: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', name: "顺序练习", desc: "按题库顺序刷题，即时判分" },
    { m: "rand", cls: "teal", icon: '<svg viewBox="0 0 24 24"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M21 16v5h-5M14 14l7 7M3 8V3h5M10 10L3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', name: "随机练习", desc: "随机抽题打乱，防止记位置" },
    { m: "exam", cls: "orange", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9v4l2.5 2.5M9 2h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', name: "模拟考试", desc: "限时答题卡交卷，自动评分" },
    { m: "wrong", cls: "red", icon: '<svg viewBox="0 0 24 24"><path d="M12 3l9.5 16.5H2.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1" fill="currentColor"/></svg>', name: "错题复习", desc: "重做错题本，答对移出" }
  ];
  modes.forEach(function (x) {
    var c = h("button", "mode-card");
    var ic = h("div", "ic " + x.cls); ic.innerHTML = x.icon;
    c.appendChild(ic);
    c.appendChild(h("b", "", x.name));
    c.appendChild(h("span", "", x.desc));
    c.onclick = function () { openSetup(x.m); };
    grid.appendChild(c);
  });
  view.appendChild(grid);

  // 最近考试
  if (S.history.length) {
    var card = h("div", "card");
    card.appendChild(h("div", "card-title", "最近考试"));
    S.history.slice(-3).reverse().forEach(function (x) { card.appendChild(historyRow(x)); });
    var more = h("button", "btn ghost sm", "查看全部学习报告");
    more.style.marginTop = "10px";
    more.onclick = function () { switchTab("report"); };
    card.appendChild(more);
    view.appendChild(card);
  }
  setChrome("应急通信刷题", { back: null });
}
function historyRow(x) {
  var row = h("div", "hist-row");
  var sc = h("div", "sc", x.score);
  sc.style.background = x.score >= 80 ? "var(--green-bg)" : x.score >= 60 ? "var(--orange-bg)" : "var(--red-bg)";
  sc.style.color = x.score >= 80 ? "var(--green)" : x.score >= 60 ? "var(--orange)" : "var(--red)";
  sc.appendChild(h("span", "", "分"));
  var g = h("div", "grow");
  g.appendChild(h("b", "", x.scopeLabel + " · " + x.total + "题"));
  g.appendChild(h("span", "", new Date(x.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " · 用时" + fmtDur(x.duration)));
  row.appendChild(sc); row.appendChild(g);
  return row;
}

/* ==================== 分类管理 ==================== */
function renderBank() {
  ui.view = "bank";
  view.innerHTML = "";
  view.scrollTop = 0;

  var tip = h("div", "card");
  tip.appendChild(h("div", "card-title", "分类管理"));
  tip.appendChild(h("div", "muted", "点击眼睛图标隐藏/显示章节，隐藏的章节不参与所有练习与考试。每章可直接开始顺序或随机练习。"));
  view.appendChild(tip);

  TREE.forEach(function (p) {
    var block = h("div", "part-block");
    var pn = h("div", "part-name");
    pn.appendChild(h("span", "", p.label || p.name));
    pn.appendChild(h("span", "count", p.count + " 题"));
    block.appendChild(pn);
    p.chapters.forEach(function (c) { block.appendChild(chapterCard(p, c)); });
    view.appendChild(block);
  });
  setChrome("分类管理", { back: null });
}
function chapterCard(p, c) {
  var row = h("div", "chapter-row" + (S.hidden[c.name] ? " dim" : ""));
  var head = h("div", "head");
  var g = h("div", "grow");
  g.appendChild(h("b", "", c.name));
  var sub = [c.count + " 题"];
  var catNames = Object.keys(c.cats);
  if (catNames.length) sub.push("分类：" + catNames.join("、"));
  g.appendChild(h("div", "sub", sub.join(" · ")));
  head.appendChild(g);
  var eye = h("button", "eye-btn" + (S.hidden[c.name] ? " off" : ""));
  eye.innerHTML = S.hidden[c.name]
    ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.4 3M6.5 8.5C4 10.2 3 12 3 12s4 6 9 6c1.2 0 2.3-.3 3.3-.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 5c5 0 9 6 9 6s-4 6-9 6-9-6-9-6 4-6 9-6z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="11" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  eye.title = S.hidden[c.name] ? "显示该章" : "隐藏该章";
  eye.onclick = function () {
    if (S.hidden[c.name]) delete S.hidden[c.name]; else S.hidden[c.name] = true;
    save();
    toast(S.hidden[c.name] ? "已隐藏「" + c.name + "」" : "已恢复「" + c.name + "」");
    renderBank();
  };
  head.appendChild(eye);
  row.appendChild(head);

  var done = 0, right = 0, ans = 0;
  c.ids.forEach(function (id) {
    var st = S.qs[id];
    if (st) { ans += st.r + st.w; right += st.r; if (st.r + st.w > 0) done++; }
  });
  var ms = h("div", "mini-stats");
  ms.appendChild(h("span", "", "已练 "));
  ms.appendChild(h("b", "", done + "/" + c.count));
  ms.appendChild(h("span", "", "正确率 "));
  ms.appendChild(h("b", "", ans ? pct(right, ans) + "%" : "-"));
  row.appendChild(ms);

  var acts = h("div", "chapter-actions");
  var b1 = h("button", "btn", "顺序练习");
  b1.onclick = function () {
    ui.setupMode = "seq"; ui.setupScope = "custom"; ui.setupChapters = [c.name];
    openSetup("seq");
  };
  var b2 = h("button", "btn ghost", "随机练习");
  b2.onclick = function () {
    ui.setupMode = "rand"; ui.setupScope = "custom"; ui.setupChapters = [c.name];
    openSetup("rand");
  };
  acts.appendChild(b1); acts.appendChild(b2);
  row.appendChild(acts);
  return row;
}

/* ==================== 练习设置 ==================== */
var SETUP_MODE_NAME = { seq: "顺序练习", rand: "随机练习", exam: "模拟考试", wrong: "错题复习" };
function openSetup(mode) {
  ui.setupMode = mode;
  ui.view = "setup";
  view.innerHTML = "";
  view.scrollTop = 0;

  var isExam = mode === "exam";
  var isWrong = mode === "wrong";

  var scopeCard = h("div", "card");
  scopeCard.appendChild(h("div", "card-title", "练习范围"));
  if (isWrong) {
    scopeCard.appendChild(h("div", "muted", "当前错题本共 " + wrongCount() + " 题。进入后按顺序重做，答对自动移出错题本。"));
  } else {
    var chips = h("div", "chip-row");
    [["all", "全部题库"], ["general", "仅通用题"], ["custom", "自选章节"]].forEach(function (x) {
      var c = h("button", "chip" + (ui.setupScope === x[0] ? " on" : ""), x[1]);
      c.onclick = function () { ui.setupScope = x[0]; openSetup(mode); };
      chips.appendChild(c);
    });
    scopeCard.appendChild(chips);
    if (ui.setupScope === "custom") {
      var list = h("div", "scope-list");
      list.style.marginTop = "10px";
      TREE.forEach(function (p) {
        p.chapters.forEach(function (c) {
          if (S.hidden[c.name]) return;
          var item = h("div", "scope-item");
          var ck = h("div", "check" + (ui.setupChapters.indexOf(c.name) >= 0 ? " on" : ""));
          ck.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          var g = h("div", "grow");
          g.appendChild(h("b", "", c.name));
          g.appendChild(h("span", "", (p.label || p.name) + " · " + c.count + " 题"));
          item.appendChild(ck); item.appendChild(g);
          item.onclick = function () {
            var i = ui.setupChapters.indexOf(c.name);
            if (i >= 0) ui.setupChapters.splice(i, 1); else ui.setupChapters.push(c.name);
            openSetup(mode);
          };
          list.appendChild(item);
        });
      });
      scopeCard.appendChild(list);
      if (!ui.setupChapters.length) scopeCard.appendChild(h("div", "muted-2", "请至少选择一个章节"));
    }
  }
  view.appendChild(scopeCard);

  var typeCard = h("div", "card");
  typeCard.appendChild(h("div", "card-title", "题型"));
  var tchips = h("div", "chip-row");
  TYPE_ORDER.forEach(function (t) {
    var c = h("button", "chip" + (ui.setupTypes.indexOf(t) >= 0 ? " on" : ""), TYPE_LABEL[t]);
    c.onclick = function () {
      var i = ui.setupTypes.indexOf(t);
      if (i >= 0) { if (ui.setupTypes.length > 1) ui.setupTypes.splice(i, 1); }
      else ui.setupTypes.push(t);
      openSetup(mode);
    };
    tchips.appendChild(c);
  });
  typeCard.appendChild(tchips);
  view.appendChild(typeCard);

  var pool = isWrong
    ? Object.keys(S.wrong)
    : poolIds({ scope: ui.setupScope, chapters: ui.setupChapters, types: ui.setupTypes });

  if (mode === "rand" || isExam) {
    var cntCard = h("div", "card");
    cntCard.appendChild(h("div", "card-title", "题量（当前范围共 " + pool.length + " 题）"));
    var crow = h("div", "chip-row");
    var counts = [20, 50, 100];
    if (pool.length && counts.indexOf(pool.length) < 0) counts.push(pool.length);
    counts.forEach(function (n) {
      var c = h("button", "count-pill" + (ui.setupCount === n ? " on" : ""), n >= pool.length && pool.length ? "全部" : n + "题");
      c.onclick = function () { ui.setupCount = n; openSetup(mode); };
      crow.appendChild(c);
    });
    cntCard.appendChild(crow);
    view.appendChild(cntCard);
  }
  if (isExam) {
    var durCard = h("div", "card");
    durCard.appendChild(h("div", "card-title", "考试时长"));
    var drow = h("div", "chip-row");
    [30, 60, 90, 120].forEach(function (n) {
      var c = h("button", "count-pill" + (ui.setupDur === n ? " on" : ""), n + "分钟");
      c.onclick = function () { ui.setupDur = n; openSetup(mode); };
      drow.appendChild(c);
    });
    durCard.appendChild(drow);
    view.appendChild(durCard);
  }

  var startBtn = h("button", "btn", "开始" + SETUP_MODE_NAME[mode] + "（" + pool.length + " 题）");
  if (!pool.length) startBtn.disabled = true;
  startBtn.onclick = function () { if (pool.length) startPractice(mode, pool); };
  view.appendChild(startBtn);

  setChrome(SETUP_MODE_NAME[mode], { back: function () { switchTab("home"); }, titleLeft: true });
}

/* ==================== 练习引擎 ==================== */
function startPractice(mode, pool) {
  var ids = pool.slice();
  if (mode === "rand" || mode === "exam") ids = shuffle(ids);
  var limit = (mode === "rand" || mode === "exam") ? Math.min(ui.setupCount, ids.length) : ids.length;
  ids = ids.slice(0, limit);

  var scopeLabel = mode === "wrong" ? "错题本"
    : ui.setupScope === "all" ? "全部题库"
    : ui.setupScope === "general" ? "通用题"
    : "自选章节";

  S.practice = {
    mode: mode,
    title: SETUP_MODE_NAME[mode],
    scopeLabel: scopeLabel,
    types: ui.setupTypes.slice(),
    ids: ids,
    idx: 0,
    ans: {},
    fb: {},
    startedAt: Date.now(),
    exam: mode === "exam" ? { duration: ui.setupDur * 60000, endsAt: Date.now() + ui.setupDur * 60000 } : null,
    done: false
  };
  save();
  enterPractice();
}
function enterPractice() {
  var p = S.practice;
  if (!p || !p.ids || !p.ids.length) { toast("没有进行中的练习"); return; }
  ui.view = "practice";
  ui.showRef = false;
  if (timer) { clearInterval(timer); timer = null; }
  if (p.exam) startTimer();
  if (!S.practice) return; // 超时已自动交卷，成绩页已展示，勿再渲染答题页
  renderQuestion();
}
function startTimer() {
  var p = S.practice;
  timerEl = h("span", "exam-timer", "");
  function tick() {
    if (!S.practice || !S.practice.exam) return;
    var left = S.practice.exam.endsAt - Date.now();
    timerEl.textContent = "⏱ " + fmtClock(left);
    timerEl.classList.toggle("urgent", left < 60000);
    if (left <= 0) { clearInterval(timer); timer = null; submitExam(true); }
  }
  tick();
  timer = setInterval(tick, 1000);
}
function examBack() {
  confirmDialog("退出考试？当前答题进度已保存，稍可从首页继续。", "退出考试", true, function () {
    if (timer) { clearInterval(timer); timer = null; }
    switchTab("home");
  });
}
function curQ() { return QMAP[S.practice.ids[S.practice.idx]]; }
function curAns() {
  var p = S.practice;
  var id = p.ids[p.idx];
  return p.ans[id] || (p.ans[id] = { sel: [], flag: false });
}

function renderQuestion() {
  var p = S.practice;
  if (!p) { switchTab("home"); return; }
  if (p.idx >= p.ids.length) { finishPractice(); return; }
  var q = curQ();
  var a = curAns();
  view.innerHTML = "";
  view.scrollTop = 0;

  var card = h("div", "card");
  var meta = h("div", "qmeta");
  meta.appendChild(h("span", "tag", TYPE_LABEL[q.type]));
  meta.appendChild(h("span", "tag gray", shortPart(q.part)));
  if (q.category) meta.appendChild(h("span", "tag gray", q.category));
  var st = S.qs[q.id];
  if (st && st.last === -1) meta.appendChild(h("span", "tag red", "错过 " + st.w + " 次"));
  card.appendChild(meta);
  card.appendChild(h("div", "qstem", q.stem));
  view.appendChild(card);

  var isExam = p.mode === "exam";
  var feedbackOn = !isExam && S.settings.feedback;
  var fb = feedbackOn ? p.fb[q.id] : undefined;

  // 选项
  if (q.options) {
    var list = h("div");
    q.options.forEach(function (o) {
      var b = h("button", "opt");
      b.appendChild(h("span", "key", o.key));
      b.appendChild(h("span", "txt", o.text));
      var selected = a.sel.indexOf(o.key) >= 0;
      if (selected) b.classList.add("sel");
      if (fb !== undefined) {
        b.classList.add("locked");
        var isAns = q.type === "multi" ? q.answer.indexOf(o.key) >= 0 : o.key === answerKey(q, q.answer);
        if (isAns) b.classList.add("correct");
        else if (selected) b.classList.add("wrong");
      }
      b.onclick = function () { onOption(q, o.key); };
      list.appendChild(b);
    });
    view.appendChild(list);
  }

  // 主观题
  if (!q.options) {
    if (ui.showRef && q.reference) {
      var rb = h("div", "ref-box");
      rb.appendChild(h("h4", "", "参考答案"));
      rb.appendChild(h("div", "", q.reference));
      view.appendChild(rb);
    }
    if (ui.showRef && q.analysis) {
      var anSub = h("div", "ref-box");
      anSub.appendChild(h("h4", "", "题目解析"));
      anSub.appendChild(h("div", "", q.analysis));
      view.appendChild(anSub);
    }
    var selfCard = h("div", "card");
    var row1 = h("div", "row");
    var refBtn = h("button", "btn ghost", ui.showRef ? "收起参考答案" : "查看参考答案");
    refBtn.onclick = function () { ui.showRef = !ui.showRef; renderQuestion(); };
    row1.appendChild(refBtn);
    selfCard.appendChild(row1);
    if (feedbackOn) {
      var row2 = h("div", "row");
      row2.style.marginTop = "10px";
      var yesBtn = h("button", "btn" + (fb === 1 ? " green" : " gray"), fb === 1 ? "✓ 已掌握" : "标记掌握");
      var noBtn = h("button", "btn" + (fb === -1 ? "" : " gray"), fb === -1 ? "✗ 未掌握" : "标记未掌握");
      yesBtn.onclick = function () { judgeSubjective(q, 1); };
      noBtn.onclick = function () { judgeSubjective(q, -1); };
      row2.appendChild(yesBtn); row2.appendChild(noBtn);
      selfCard.appendChild(row2);
    }
    view.appendChild(selfCard);
  }

  // 即时反馈
  if (fb !== undefined && q.options) {
    var ok = fb === 1;
    var fbd = h("div", "feedback " + (ok ? "right" : "wrong"));
    fbd.appendChild(h("b", "", ok ? "✓ 回答正确" : "✗ 回答错误"));
    var ansText = q.type === "judge" ? (q.answer === "√" ? "正确" : "错误")
      : q.type === "single" ? q.answer
      : q.answer.split("").join("、");
    fbd.appendChild(h("div", "", "正确答案：" + ansText + (ok ? "" : "，已自动收入错题本")));
    view.appendChild(fbd);
  }

  // 题目解析（客观题答完即时展示；考试模式与关闭反馈时不展示，避免泄题）
  if (fb !== undefined && q.options && q.analysis) {
    var anBox = h("div", "ref-box");
    anBox.appendChild(h("h4", "", "题目解析"));
    anBox.appendChild(h("div", "", q.analysis));
    view.appendChild(anBox);
  }

  // 底部操作
  var foot = h("div", "qfoot");
  var prev = h("button", "btn gray", "上一题");
  prev.disabled = p.idx === 0;
  prev.onclick = function () { p.idx--; ui.showRef = false; save(); renderQuestion(); };

  if (isExam) {
    var flag = h("button", "btn gray", a.flag ? "取消标记" : "标记疑题");
    flag.onclick = function () { a.flag = !a.flag; save(); renderQuestion(); };
    foot.appendChild(flag);
    foot.appendChild(prev);
    var next = h("button", "btn", p.idx >= p.ids.length - 1 ? "交卷" : "下一题");
    next.onclick = function () {
      if (p.idx >= p.ids.length - 1) { submitExam(false); return; }
      p.idx++; ui.showRef = false; save(); renderQuestion();
    };
    foot.appendChild(next);
  } else {
    foot.appendChild(prev);
    if (q.options && q.type === "multi" && fb === undefined && S.settings.feedback) {
      var sub = h("button", "btn", "提交答案");
      sub.disabled = !a.sel.length;
      sub.onclick = submitCurrent;
      foot.appendChild(sub);
    } else {
      var label;
      if (fb !== undefined) label = p.idx >= p.ids.length - 1 ? "完成练习" : "下一题";
      else label = S.settings.feedback ? (p.idx >= p.ids.length - 1 ? "完成" : "跳过") : (p.idx >= p.ids.length - 1 ? "完成练习" : "下一题");
      var nx = h("button", "btn", label);
      nx.onclick = function () {
        if (p.idx >= p.ids.length - 1) { finishPractice(); return; }
        p.idx++; ui.showRef = false; save(); renderQuestion();
      };
      foot.appendChild(nx);
    }
  }
  view.appendChild(foot);

  setChrome(p.title + " " + (p.idx + 1) + "/" + p.ids.length, {
    back: practiceBack,
    titleLeft: true,
    tabbar: false,
    extra: isExam ? timerEl : acardBtn()
  });
}
function acardBtn() {
  var b = h("button", "txt-btn", "答题卡");
  b.onclick = openAnswerCard;
  return b;
}
function practiceBack() {
  confirmDialog("退出练习？进度已自动保存，可随时从首页继续。", "退出", true, function () {
    if (timer) { clearInterval(timer); timer = null; }
    switchTab("home");
  });
}
function onOption(q, key) {
  var p = S.practice;
  if (p.fb[q.id] !== undefined) return; // 已判分锁定
  var a = p.ans[q.id] || (p.ans[q.id] = { sel: [], flag: false });
  if (q.type === "multi") {
    var i = a.sel.indexOf(key);
    if (i >= 0) a.sel.splice(i, 1); else a.sel.push(key);
    a.sel.sort();
    save();
    renderQuestion();
  } else {
    a.sel = [key];
    save();
    if (p.mode === "exam" || !S.settings.feedback) { renderQuestion(); return; }
    submitCurrent();
  }
}
function submitCurrent() {
  var p = S.practice;
  var q = curQ();
  var a = curAns();
  if (!a.sel.length) { toast("请先选择答案"); return; }
  if (p.fb[q.id] !== undefined) return;
  var ok = isCorrect(q, a.sel);
  p.fb[q.id] = ok ? 1 : -1;
  recordAnswer(q.id, ok);
  if (ok) removeWrong(q.id); else addWrong(q.id);
  save();
  renderQuestion();
}
function judgeSubjective(q, v) {
  var p = S.practice;
  if (p.fb[q.id] !== undefined) return;
  p.fb[q.id] = v;
  recordAnswer(q.id, v === 1);
  if (v === 1) removeWrong(q.id); else addWrong(q.id);
  save();
  renderQuestion();
}

/* ==================== 答题卡 ==================== */
function openAnswerCard() {
  var p = S.practice;
  if (!p) return;
  openSheet(function (sheet) {
    var head = h("div", "sheet-head");
    head.appendChild(h("b", "", "答题卡"));
    var close = h("button", "txt-btn", "关闭");
    close.onclick = closeSheet;
    head.appendChild(close);
    sheet.appendChild(head);

    var body = h("div", "sheet-body");
    var answered = 0, flagged = 0;
    p.ids.forEach(function (id) {
      if (p.ans[id] && p.ans[id].sel.length) answered++;
      if (p.ans[id] && p.ans[id].flag) flagged++;
    });
    body.appendChild(h("div", "muted-2", "已答 " + answered + " / " + p.ids.length + (flagged ? " · 标记 " + flagged : "")));
    var legend = h("div", "acard-legend");
    [["<i style='background:#F0F3F8'></i>未答"], ["<i style='background:var(--primary)'></i>已答"], ["<i style='background:var(--orange)'></i>标记"], ["<i style='background:var(--green-bg);border:1px solid var(--green)'></i>答对"], ["<i style='background:var(--red-bg);border:1px solid var(--red)'></i>答错"]]
      .forEach(function (x) {
        var s = h("span");
        s.innerHTML = x[0];
        legend.appendChild(s);
      });
    body.appendChild(legend);

    var grid = h("div", "acard-grid");
    p.ids.forEach(function (id, i) {
      var cell = h("button", "acell");
      var a = p.ans[id];
      if (a && a.sel.length) cell.classList.add("done");
      if (a && a.flag) cell.classList.add("flagged");
      if (i === p.idx) cell.classList.add("cur");
      if (p.fb[id] === -1) cell.classList.add("mark-wrong");
      if (p.fb[id] === 1) cell.classList.add("mark-right");
      cell.textContent = i + 1;
      cell.onclick = function () { p.idx = i; ui.showRef = false; save(); closeSheet(); renderQuestion(); };
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    sheet.appendChild(body);

    var foot = h("div", "sheet-foot");
    if (p.mode === "exam") {
      var submit = h("button", "btn", "交卷");
      submit.onclick = function () { closeSheet(); submitExam(false); };
      foot.appendChild(submit);
    } else {
      var finish = h("button", "btn", "结束练习");
      finish.onclick = function () { closeSheet(); finishPractice(); };
      foot.appendChild(finish);
    }
    sheet.appendChild(foot);
  });
}

/* ==================== 交卷与成绩 ==================== */
function submitExam(auto) {
  var p = S.practice;
  if (!p || p.mode !== "exam") return;
  if (timer) { clearInterval(timer); timer = null; }
  var unanswered = p.ids.filter(function (id) { return !p.ans[id] || !p.ans[id].sel.length; });
  if (!auto && unanswered.length) {
    confirmDialog("还有 " + unanswered.length + " 题未作答，确定交卷？未作答按错误计。", "确定交卷", true, gradeExam);
  } else {
    gradeExam();
  }
}
function gradeExam() {
  var p = S.practice;
  var breakdown = {};
  var correct = 0, wrong = 0, total = 0;
  var wrongIds = [], subjIds = [];
  p.ids.forEach(function (id) {
    var q = QMAP[id];
    total++;
    breakdown[q.type] = breakdown[q.type] || { total: 0, right: 0 };
    breakdown[q.type].total++;
    if (!q.options) { subjIds.push(id); return; }
    var a = p.ans[id];
    var ok = isCorrect(q, a && a.sel);
    if (ok) { correct++; breakdown[q.type].right++; recordAnswer(id, true); removeWrong(id); }
    else { wrong++; wrongIds.push(id); recordAnswer(id, false); addWrong(id); }
  });
  save();
  if (subjIds.length) {
    ui.selfReview = { ids: subjIds, idx: 0, results: {} };
    renderSelfReview({ correct: correct, wrong: wrong, total: total, breakdown: breakdown, wrongIds: wrongIds });
  } else {
    finishExam({ correct: correct, wrong: wrong, total: total, breakdown: breakdown, wrongIds: wrongIds, subjRight: 0 });
  }
}
function renderSelfReview(base) {
  var sr = ui.selfReview;
  if (!sr) return;
  if (sr.idx >= sr.ids.length) {
    var subjRight = Object.keys(sr.results).filter(function (k) { return sr.results[k] === 1; }).length;
    finishExam(Object.assign({}, base, { subjRight: subjRight }));
    return;
  }
  var q = QMAP[sr.ids[sr.idx]];
  ui.view = "selfreview";
  view.innerHTML = "";
  view.scrollTop = 0;

  var info = h("div", "card");
  info.appendChild(h("div", "muted", "客观题已自动评分。下面逐题自评主观题（" + (sr.idx + 1) + "/" + sr.ids.length + "），请对照参考答案判断自己是否掌握。"));
  view.appendChild(info);

  var card = h("div", "card");
  var meta = h("div", "qmeta");
  meta.appendChild(h("span", "tag", TYPE_LABEL[q.type]));
  card.appendChild(meta);
  card.appendChild(h("div", "qstem", q.stem));
  view.appendChild(card);

  var rb = h("div", "ref-box");
  rb.appendChild(h("h4", "", "参考答案"));
  rb.appendChild(h("div", "", q.reference || "（无）"));
  view.appendChild(rb);

  if (q.analysis) {
    var anSR = h("div", "ref-box");
    anSR.appendChild(h("h4", "", "题目解析"));
    anSR.appendChild(h("div", "", q.analysis));
    view.appendChild(anSR);
  }

  var row = h("div", "row");
  var yes = h("button", "btn green", "✓ 掌握了");
  var no = h("button", "btn", "✗ 未掌握");
  yes.onclick = function () {
    sr.results[q.id] = 1; recordAnswer(q.id, true); removeWrong(q.id);
    save(); sr.idx++; renderSelfReview(base);
  };
  no.onclick = function () {
    sr.results[q.id] = -1; recordAnswer(q.id, false); addWrong(q.id);
    save(); sr.idx++; renderSelfReview(base);
  };
  row.appendChild(yes); row.appendChild(no);
  view.appendChild(row);

  setChrome("主观题自评", { back: function () {}, tabbar: false, titleLeft: true });
}
function finishExam(data) {
  var p = S.practice;
  var total = data.total;
  var correct = data.correct + data.subjRight;
  var score = total ? Math.round(correct / total * 100) : 0;
  var duration = Date.now() - p.startedAt;
  S.history.push({
    mode: "exam", scopeLabel: p.scopeLabel, types: p.types,
    total: total, correct: correct, score: score,
    duration: duration, at: Date.now(), breakdown: data.breakdown
  });
  if (S.history.length > 100) S.history = S.history.slice(-100);
  p.done = true;
  ui.selfReview = null;
  save();
  showResult({
    mode: "exam", score: score, total: total, correct: correct,
    duration: duration, breakdown: data.breakdown,
    wrongIds: data.wrongIds, scopeLabel: p.scopeLabel
  });
  S.practice = null;
  save();
}
function finishPractice() {
  var p = S.practice;
  if (!p) { switchTab("home"); return; }
  if (p.mode === "exam") { submitExam(false); return; }
  var answered = 0, right = 0, breakdown = {}, wrongIds = [];
  p.ids.forEach(function (id) {
    var q = QMAP[id];
    breakdown[q.type] = breakdown[q.type] || { total: 0, right: 0 };
    breakdown[q.type].total++;
    var ok;
    if (!q.options) {
      if (p.fb[id] === undefined) return; // 未自评
      ok = p.fb[id] === 1;
    } else {
      var a = p.ans[id];
      if (!a || !a.sel.length) return;    // 未答
      ok = isCorrect(q, a.sel);
    }
    answered++;
    if (ok) { right++; breakdown[q.type].right++; }
    else wrongIds.push(id);
    // 反馈关闭时未即时记录的题在此统一记录
    if (S.settings.feedback) return;      // 已在 submitCurrent 记录过
    recordAnswer(id, ok);
    if (ok) removeWrong(id); else addWrong(id);
  });
  save();
  p.done = true;
  save();
  showResult({
    mode: p.mode, total: p.ids.length, answered: answered, correct: right,
    duration: Date.now() - p.startedAt, scopeLabel: p.scopeLabel,
    breakdown: breakdown, wrongIds: wrongIds
  });
  S.practice = null;
  save();
}
function showResult(r) {
  ui.resultData = r;
  ui.view = "result";
  view.innerHTML = "";
  view.scrollTop = 0;

  var hero = h("div", "card score-hero");
  if (r.mode === "exam") {
    hero.appendChild(h("div", "num", r.score));
    hero.appendChild(h("div", "lbl", "得分（满分100）"));
    hero.appendChild(h("div", "verdict " + (r.score >= 80 ? "pass" : "fail"), r.score >= 80 ? "优秀" : r.score >= 60 ? "及格" : "未通过"));
  } else {
    hero.appendChild(h("div", "num", r.answered + "/" + r.total));
    hero.appendChild(h("div", "lbl", "完成题量 · 答对 " + r.correct + " 题"));
  }
  view.appendChild(hero);

  var kv = h("div", "card");
  var grid = h("div", "kv-grid");
  grid.appendChild(kvBox("正确率", r.answered ? pct(r.correct, r.answered) + "%" : (r.mode === "exam" ? r.score + "%" : "-")));
  grid.appendChild(kvBox("用时", fmtDur(r.duration)));
  if (r.mode === "exam") {
    grid.appendChild(kvBox("题量", r.total + " 题"));
    grid.appendChild(kvBox("答对", r.correct + " 题"));
  }
  kv.appendChild(grid);
  view.appendChild(kv);

  if (r.breakdown) {
    var bd = h("div", "card");
    bd.appendChild(h("div", "card-title", "题型分布"));
    Object.keys(r.breakdown).forEach(function (t) {
      var x = r.breakdown[t];
      if (!x.total) return;
      var row = h("div", "bar-row");
      row.appendChild(h("span", "name", TYPE_LABEL[t] || t));
      var tr = h("div", "track");
      var f = h("div");
      var p = pct(x.right, x.total);
      f.style.width = p + "%";
      f.style.background = p >= 80 ? "var(--green)" : p >= 60 ? "var(--orange)" : "var(--red)";
      tr.appendChild(f);
      row.appendChild(tr);
      row.appendChild(h("span", "val", x.right + "/" + x.total));
      bd.appendChild(row);
    });
    view.appendChild(bd);
  }

  if (r.wrongIds && r.wrongIds.length) {
    var wc = h("div", "card");
    wc.appendChild(h("div", "card-title", "错题回顾（" + r.wrongIds.length + "）"));
    r.wrongIds.slice(0, 20).forEach(function (id, i) {
      var q = QMAP[id];
      var row = h("div", "result-row");
      row.appendChild(h("span", "no", i + 1));
      row.appendChild(h("span", "grow", q.stem));
      row.appendChild(h("span", "st", "✗"));
      wc.appendChild(row);
    });
    if (r.wrongIds.length > 20) wc.appendChild(h("div", "muted-2", "还有 " + (r.wrongIds.length - 20) + " 题，见错题本"));
    view.appendChild(wc);
  }

  var acts = h("div", "card");
  var r1 = h("div", "row");
  var again = h("button", "btn", r.mode === "exam" ? "再考一次" : "再练一轮");
  again.onclick = function () { openSetup(r.mode === "exam" ? "exam" : (r.mode === "rand" ? "rand" : "seq")); };
  r1.appendChild(again);
  var wrongBtn = h("button", "btn ghost", "去刷错题");
  wrongBtn.onclick = function () { switchTab("wrong"); };
  r1.appendChild(wrongBtn);
  acts.appendChild(r1);
  var homeBtn = h("button", "btn gray", "返回首页");
  homeBtn.style.marginTop = "10px";
  homeBtn.onclick = function () { switchTab("home"); };
  acts.appendChild(homeBtn);
  view.appendChild(acts);

  setChrome(r.mode === "exam" ? "考试成绩" : "练习完成", { back: function () { switchTab("home"); }, titleLeft: true });
}
function kvBox(label, val) {
  var d = h("div", "kv");
  d.appendChild(h("b", "", val));
  d.appendChild(h("span", "", label));
  return d;
}

/* ==================== 错题本 ==================== */
function renderWrong() {
  ui.view = "wrong";
  view.innerHTML = "";
  view.scrollTop = 0;
  var ids = Object.keys(S.wrong);
  if (!ids.length) {
    var em = h("div", "empty");
    em.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3l9.5 16.5H2.5z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    em.appendChild(h("div", "", "错题本是空的"));
    em.appendChild(h("div", "muted-2", "练习和考试中答错的题会自动出现在这里"));
    view.appendChild(em);
    setChrome("错题本", { back: null });
    return;
  }

  var head = h("div", "card");
  head.appendChild(h("div", "card-title", "共 " + ids.length + " 道错题"));
  var row = h("div", "row");
  var b1 = h("button", "btn", "顺序重做");
  b1.onclick = function () { startPractice("wrong", ids); };
  var b2 = h("button", "btn ghost", "随机重做");
  b2.onclick = function () { startPractice("wrong", shuffle(ids)); };
  row.appendChild(b1); row.appendChild(b2);
  head.appendChild(row);
  var clearBtn = h("button", "btn gray sm", "清空错题本");
  clearBtn.style.marginTop = "10px";
  clearBtn.onclick = function () {
    confirmDialog("确定清空错题本？该操作不可恢复。", "清空", true, function () {
      S.wrong = {}; save(); renderWrong(); toast("错题本已清空");
    });
  };
  head.appendChild(clearBtn);
  view.appendChild(head);

  ids.sort(function (a, b) { return S.wrong[b].n - S.wrong[a].n; });
  ids.forEach(function (id) {
    var q = QMAP[id];
    var w = S.wrong[id];
    var row = h("div", "wrong-row");
    var hr = h("div", "head");
    hr.appendChild(h("span", "tag", TYPE_LABEL[q.type]));
    hr.appendChild(h("div", "grow", q.stem));
    row.appendChild(hr);
    var meta = h("div", "meta");
    meta.appendChild(h("span", "", shortPart(q.part) + " · " + q.chapter));
    meta.appendChild(h("span", "", "错 " + w.n + " 次"));
    row.appendChild(meta);
    var acts = h("div", "chapter-actions");
    var see = h("button", "btn ghost sm", "查看解析");
    see.onclick = (function (qid) { return function () { showAnswerDetail(qid); }; })(id);
    var del = h("button", "btn gray sm", "移出");
    del.onclick = (function (qid) {
      return function () { removeWrong(qid); renderWrong(); toast("已移出错题本"); };
    })(id);
    acts.appendChild(see); acts.appendChild(del);
    row.appendChild(acts);
    view.appendChild(row);
  });
  setChrome("错题本", { back: null });
}
function showAnswerDetail(qid) {
  var q = QMAP[qid];
  openSheet(function (sheet) {
    var head = h("div", "sheet-head");
    head.appendChild(h("b", "", "题目解析"));
    var close = h("button", "txt-btn", "关闭");
    close.onclick = closeSheet;
    head.appendChild(close);
    sheet.appendChild(head);
    var body = h("div", "sheet-body");
    body.appendChild(h("div", "qstem", q.stem));
    if (q.options) {
      var list = h("div");
      list.style.marginTop = "12px";
      var ansKey = answerKey(q, q.answer);
      q.options.forEach(function (o) {
        var isAns = q.type === "multi" ? q.answer.indexOf(o.key) >= 0 : o.key === ansKey;
        var b = h("div", "opt" + (isAns ? " correct locked" : " locked"));
        b.appendChild(h("span", "key", o.key));
        b.appendChild(h("span", "txt", o.text + (isAns ? " ✓" : "")));
        list.appendChild(b);
      });
      body.appendChild(list);
      body.appendChild(h("div", "muted", "正确答案：" + (q.type === "judge" ? (q.answer === "√" ? "正确" : "错误") : q.type === "multi" ? q.answer.split("").join("、") : q.answer)));
    }
    if (q.reference) {
      var rb = h("div", "ref-box");
      rb.style.marginTop = "12px";
      rb.appendChild(h("h4", "", "参考答案"));
      rb.appendChild(h("div", "", q.reference));
      body.appendChild(rb);
    }
    if (q.analysis) {
      var ab = h("div", "ref-box");
      ab.style.marginTop = "12px";
      ab.appendChild(h("h4", "", "题目解析"));
      ab.appendChild(h("div", "", q.analysis));
      body.appendChild(ab);
    }
    sheet.appendChild(body);
  });
}

/* ==================== 学习报告 ==================== */
function renderReport() {
  ui.view = "report";
  view.innerHTML = "";
  view.scrollTop = 0;

  var totalAns = 0, totalRight = 0;
  Object.keys(S.qs).forEach(function (k) { totalAns += S.qs[k].r + S.qs[k].w; totalRight += S.qs[k].r; });

  var ov = h("div", "card");
  ov.appendChild(h("div", "card-title", "学习总览"));
  var grid = h("div", "kv-grid");
  grid.appendChild(kvBox("累计答题", totalAns));
  grid.appendChild(kvBox("总正确率", totalAns ? pct(totalRight, totalAns) + "%" : "-"));
  grid.appendChild(kvBox("练习天数", Object.keys(S.days).length));
  grid.appendChild(kvBox("连续打卡", S.streak.n + " 天"));
  grid.appendChild(kvBox("错题待复习", wrongCount()));
  grid.appendChild(kvBox("考试场次", S.history.length));
  ov.appendChild(grid);
  view.appendChild(ov);

  var days = [];
  for (var i = 13; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    days.push({ key: key, label: (d.getMonth() + 1) + "/" + d.getDate(), n: S.days[key] || 0 });
  }
  var maxN = Math.max.apply(null, days.map(function (x) { return x.n; }).concat([1]));
  var tc = h("div", "card");
  tc.appendChild(h("div", "card-title", "近 14 天刷题量"));
  tc.appendChild(renderTrendChart(days, maxN));
  view.appendChild(tc);

  var typeStat = {};
  Object.keys(S.qs).forEach(function (id) {
    var q = QMAP[id]; if (!q) return;
    var t = typeStat[q.type] || (typeStat[q.type] = { r: 0, w: 0 });
    t.r += S.qs[id].r; t.w += S.qs[id].w;
  });
  var tkeys = Object.keys(typeStat);
  if (tkeys.length) {
    var tcard = h("div", "card");
    tcard.appendChild(h("div", "card-title", "题型正确率"));
    tkeys.sort(function (a, b) { return pct(typeStat[b].r, typeStat[b].r + typeStat[b].w) - pct(typeStat[a].r, typeStat[a].r + typeStat[a].w); });
    tkeys.forEach(function (t) {
      var x = typeStat[t];
      var row = h("div", "bar-row");
      row.appendChild(h("span", "name", TYPE_LABEL[t] || t));
      var tr = h("div", "track");
      var f = h("div");
      var p = pct(x.r, x.r + x.w);
      f.style.width = p + "%";
      f.style.background = p >= 80 ? "var(--green)" : p >= 60 ? "var(--orange)" : "var(--red)";
      tr.appendChild(f);
      row.appendChild(tr);
      row.appendChild(h("span", "val", p + "%"));
      tcard.appendChild(row);
    });
    view.appendChild(tcard);
  }

  var chStat = {};
  Object.keys(S.qs).forEach(function (id) {
    var q = QMAP[id]; if (!q) return;
    var c = chStat[q.chapter] || (chStat[q.chapter] = { r: 0, w: 0 });
    c.r += S.qs[id].r; c.w += S.qs[id].w;
  });
  var ckeys = Object.keys(chStat).sort(function (a, b) { return (chStat[b].r + chStat[b].w) - (chStat[a].r + chStat[a].w); }).slice(0, 8);
  if (ckeys.length) {
    var ccard = h("div", "card");
    ccard.appendChild(h("div", "card-title", "章节掌握度（按练习量）"));
    ckeys.forEach(function (c) {
      var x = chStat[c];
      var row = h("div", "bar-row");
      row.appendChild(h("span", "name", shortChapter(c)));
      var tr = h("div", "track");
      var f = h("div");
      var p = pct(x.r, x.r + x.w);
      f.style.width = p + "%";
      f.style.background = p >= 80 ? "var(--green)" : p >= 60 ? "var(--orange)" : "var(--red)";
      tr.appendChild(f);
      row.appendChild(tr);
      row.appendChild(h("span", "val", p + "%"));
      ccard.appendChild(row);
    });
    view.appendChild(ccard);
  }

  var weak = Object.keys(chStat)
    .map(function (c) { return { c: c, p: pct(chStat[c].r, chStat[c].r + chStat[c].w), n: chStat[c].r + chStat[c].w }; })
    .filter(function (x) { return x.n >= 10; })
    .sort(function (a, b) { return a.p - b.p; })
    .slice(0, 5);
  if (weak.length) {
    var wcard = h("div", "card");
    wcard.appendChild(h("div", "card-title", "薄弱环节（练习≥10题）"));
    weak.forEach(function (x, i) {
      var row = h("div", "weak-item");
      row.appendChild(h("span", "rank", i + 1));
      var g = h("div", "grow");
      g.appendChild(h("b", "", shortChapter(x.c)));
      g.appendChild(h("div", "muted-2", "已练 " + x.n + " 题"));
      row.appendChild(g);
      row.appendChild(h("span", "tag red", x.p + "%"));
      var go = h("button", "btn sm ghost", "练");
      go.onclick = (function (name) {
        return function () {
          ui.setupMode = "rand"; ui.setupScope = "custom"; ui.setupChapters = [name];
          openSetup("rand");
        };
      })(x.c);
      row.appendChild(go);
      wcard.appendChild(row);
    });
    view.appendChild(wcard);
  }

  var hcard = h("div", "card");
  hcard.appendChild(h("div", "card-title", "考试记录（" + S.history.length + "）"));
  if (S.history.length) {
    S.history.slice().reverse().slice(0, 20).forEach(function (x) { hcard.appendChild(historyRow(x)); });
  } else {
    hcard.appendChild(h("div", "muted", "还没有考试记录，去「模拟考试」试试吧"));
  }
  view.appendChild(hcard);

  var set = h("div", "card");
  set.appendChild(h("div", "card-title", "设置"));
  var fbRow = h("div", "scope-item");
  fbRow.appendChild(h("div", "grow", "练习模式即时反馈"));
  var sw = h("div", "check" + (S.settings.feedback ? " on" : ""));
  sw.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  sw.onclick = function () { S.settings.feedback = !S.settings.feedback; save(); renderReport(); };
  fbRow.appendChild(sw);
  set.appendChild(fbRow);
  set.appendChild(h("div", "muted-2", "关闭后，练习模式不显示即时判分，统一在结束练习时评分。"));
  set.appendChild(h("div", "divider"));
  var b1 = h("button", "btn gray sm", "清除进行中的练习进度");
  b1.onclick = function () {
    confirmDialog("确定清除当前练习进度？", "清除", true, function () { S.practice = null; save(); toast("已清除"); renderReport(); });
  };
  set.appendChild(b1);
  var b2 = h("button", "btn gray sm", "清空错题本");
  b2.style.marginTop = "8px";
  b2.onclick = function () {
    confirmDialog("确定清空错题本？", "清空", true, function () { S.wrong = {}; save(); toast("已清空"); renderReport(); });
  };
  set.appendChild(b2);
  var b3 = h("button", "btn gray sm", "重置所有学习数据");
  b3.style.marginTop = "8px";
  b3.onclick = function () {
    confirmDialog("将清空全部答题记录、错题本、考试记录与设置，且不可恢复。确定？", "全部重置", true, function () {
      S = defaultState(); save(); toast("已重置"); switchTab("home");
    });
  };
  set.appendChild(b3);
  view.appendChild(set);

  setChrome("学习报告", { back: null });
}
function renderTrendChart(days, maxN) {
  var W = 320, H = 130, padL = 4, padB = 18, padT = 8;
  var bw = (W - padL * 2) / days.length;
  var svg = "<svg class='trend-chart' viewBox='0 0 " + W + " " + H + "' xmlns='http://www.w3.org/2000/svg'>";
  days.forEach(function (d, i) {
    var bh = d.n ? Math.max(3, (d.n / maxN) * (H - padB - padT)) : 2;
    var x = padL + i * bw + bw * 0.18;
    var y = H - padB - bh;
    var color = d.n === 0 ? "#EDF1F7" : "#2E6FD8";
    svg += "<rect x='" + x.toFixed(1) + "' y='" + y.toFixed(1) + "' width='" + (bw * 0.64).toFixed(1) + "' height='" + bh.toFixed(1) + "' rx='3' fill='" + color + "'/>";
    if (d.n > 0) {
      svg += "<text x='" + (x + bw * 0.32).toFixed(1) + "' y='" + (y - 3).toFixed(1) + "' font-size='8.5' fill='#5A6679' text-anchor='middle'>" + d.n + "</text>";
    }
    if (i % 3 === 0 || i === days.length - 1) {
      svg += "<text x='" + (x + bw * 0.32).toFixed(1) + "' y='" + (H - 5) + "' font-size='8.5' fill='#93A0B4' text-anchor='middle'>" + d.label + "</text>";
    }
  });
  svg += "</svg>";
  var wrap = h("div");
  wrap.innerHTML = svg;
  return wrap;
}

/* ==================== 启动 ==================== */
switchTab("home");

document.addEventListener("visibilitychange", function () {
  if (!document.hidden && ui.view === "practice" && S.practice && S.practice.exam && !S.practice.done) {
    if (S.practice.exam.endsAt - Date.now() <= 0) submitExam(true);
  }
});
})();
