/* 小程序 practice 页回归测试
 * 复现并锁定「多选题点选项无反应」类 bug：任何一次交互后，
 * 页面 data（选项样式 / 反馈 / 答题卡）必须与 store 的真实状态一致。
 * 运行：node build/mp-practice-regress.js
 */
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram');
const storeMod = path.join(MP, 'utils', 'store.js');
const logicMod = path.join(MP, 'utils', 'logic.js');
const pageMod = process.env.PRACTICE_JS || path.join(MP, 'pages', 'practice', 'practice.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
}

const mem = {};
const toasts = [];
const modals = [];   // showModal 不自动点确认，只留证据供断言（弹窗文案也是产品的一部分）
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete mem[k]; },
  showToast: (o) => { toasts.push(o.title); }, showModal: (o) => { modals.push(o); }, navigateBack: () => {},
  navigateTo: () => {}, redirectTo: () => {}, switchTab: () => {},
  setNavigationBarTitle: () => {}, pageScrollTo: () => {},
  setClipboardData: (o) => { global.__copied = o.data; }, chooseMessageFile: () => {},
  showLoading: () => {}, hideLoading: () => {},
  getFileSystemManager: () => ({ readFile: () => {} }),
  /* 剪贴板兜底读取：global.__clip = null 表示 fail，否则 success 回吐 */
  getClipboardData: (o) => {
    if (global.__clip == null) { o.fail(); return; }
    o.success({ data: global.__clip });
  }
};
global.__clip = null;
global.setInterval = () => 0;
global.clearInterval = () => {};

let cfg = null;
global.Page = c => { cfg = c; };
/* 仓库不带 qbank.js（构建产物，发布物也被排除）。缺了先按示例题库构建一份，
 * 否则首次 clone 后跑本测试直接 require 失败。 */
const QB = path.join(MP, 'utils', 'qbank.js');
if (!require('fs').existsSync(QB)) {
  require('child_process').execFileSync(process.execPath,
    [path.join(__dirname, 'build_bank.js'), '--sample'], { stdio: 'inherit' });
}
/* Node 回退注入：bank-store 不直接 require qbank.js（发布包会排除它），由测试脚本注入 */
require(path.join(MP, 'utils', 'bank-store.js')).__setNodeBank(require(QB));
const store = require(storeMod);
const logic = require(logicMod);
require(pageMod);
const practiceCfg = cfg;   // 后面还会 require 其它页面，Page 配置会被覆盖，这里先把练习页留住

function newPage() {
  const p = Object.create(cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch, cb) { Object.keys(patch).forEach(k => { p.data[k] = patch[k]; }); if (cb) cb(); };
  return p;
}
const tap = (page, key) => page.onOption({ currentTarget: { dataset: { key: key } } });

store.init();
store.ui.setupTypes = ['judge', 'single', 'multi'];

/* ---------- 1. 随机练习 50 题：逐题逐选项校验界面状态 ---------- */
store.ui.setupCount = 50;
store.ui.setupScope = 'all';
const pool = logic.poolIds({ scope: 'all', chapters: [], types: store.ui.setupTypes, hidden: {} });
store.startPractice('rand', pool);
let page = newPage();
page.onLoad();

const P = () => store.S.practice;
const curQ = () => logic.QMAP[P().ids[P().idx]];

let checkedMulti = 0, checkedOther = 0;
const n = P().ids.length;
for (let i = 0; i < n; i++) {
  P().idx = i;
  page.renderQuestion();
  const q = curQ();

  if (!q.options) continue; // 主观题（默认题型里不会出现）
  // 解析接线：qbank.x -> QLIST.analysis -> page.data.q.analysis（非空才可能在反馈区渲染）
  ok(page.data.q.analysis === (q.analysis || '') && !!page.data.q.analysis,
    '#' + (i + 1) + ' 题目解析已注入页面 data', 'analysis=' + (page.data.q.analysis || '（空）').slice(0, 12));

  if (q.type === 'multi') {
    checkedMulti++;
    // 逐个选项点一遍：每次点击后，该选项必须立刻变成 sel（原 bug：点了界面毫无变化）
    const keys = q.options.map(o => o.key);
    keys.forEach((k, ki) => {
      tap(page, k);
      const item = page.data.q.options.find(o => o.key === k);
      const selNow = P().ans[q.id].sel.indexOf(k) >= 0;
      ok(item.cls.indexOf('sel') >= 0 === selNow,
        '多选 #' + (i + 1) + ' 点 ' + k + ' 后选项高亮与选择状态一致',
        'cls="' + item.cls + '" 选中=' + selNow);
      ok(page.data.a.sel.join(',') === P().ans[q.id].sel.join(','),
        '多选 #' + (i + 1) + ' 点 ' + k + ' 后 page.a.sel 同步', page.data.a.sel.join(','));
      if (ki === 0) tap(page, k); // 再点一次取消，验证取消也要刷新
    });
    // 重新选前两个，然后提交
    tap(page, keys[0]); if (keys[1]) tap(page, keys[1]);
    page.submitCurrent();
    const fb = P().fb[q.id];
    ok(fb === 1 || fb === -1, '多选 #' + (i + 1) + ' 提交后写入判分', 'fb=' + fb);
    ok(page.data.fb === fb, '多选 #' + (i + 1) + ' 页面 fb 与 store 一致', page.data.fb);
    ok(page.data.q.options.every(o => o.cls.indexOf('locked') >= 0), '多选 #' + (i + 1) + ' 提交后选项锁定');
    ok(page.data.q.options.every(o => o.hover === 'none'), '多选 #' + (i + 1) + ' 提交后 hover 置 none');
    const ansKeys = q.answer.split('');
    ok(ansKeys.every(k => page.data.q.options.find(o => o.key === k).cls.indexOf('correct') >= 0),
      '多选 #' + (i + 1) + ' 正确答案标绿');
  } else {
    checkedOther++;
    const k = q.options[0].key;
    tap(page, k);
    const item = page.data.q.options.find(o => o.key === k);
    const fb = P().fb[q.id];
    ok(fb === 1 || fb === -1, q.type + ' #' + (i + 1) + ' 点选即判分', 'fb=' + fb);
    ok(item.cls.indexOf('sel') >= 0 && page.data.fb === fb,
      q.type + ' #' + (i + 1) + ' 点选后高亮 + 反馈同步', 'cls="' + item.cls + '" data.fb=' + page.data.fb);
    ok(page.data.fb !== undefined, q.type + ' #' + (i + 1) + ' setData 不含 undefined');
    // 已判分再点：必须无效（锁定）
    const before = JSON.stringify(P().ans[q.id].sel);
    tap(page, q.options[1] ? q.options[1].key : k);
    ok(JSON.stringify(P().ans[q.id].sel) === before, q.type + ' #' + (i + 1) + ' 判分后点选项被锁定');
  }

  // 答题卡计数必须随时与 store 一致
  const answered = P().ids.filter(id => P().ans[id] && P().ans[id].sel.length).length;
  ok(page.data.acardAnswered === answered, '第 ' + (i + 1) + ' 题后答题卡已答数同步', page.data.acardAnswered + ' vs ' + answered);
  ok(page.data.acardCells.length === P().ids.length, '答题卡格子数 = 题量');
  ok(page.data.acardCells[i].cls.indexOf('cur') >= 0, '答题卡高亮当前题');
}
console.log('随机练习：多选 ' + checkedMulti + ' 道、客观题 ' + checkedOther + ' 道 全部校验完毕');

/* ---------- 2. 反馈关闭模式：点选只高亮、不判分 ---------- */
store.S.settings.feedback = false;
store.ui.setupCount = 20;
store.startPractice('rand', logic.poolIds({ scope: 'all', chapters: [], types: store.ui.setupTypes, hidden: {} }));
page = newPage();
page.onLoad();
for (let i = 0; i < P().ids.length; i++) {
  P().idx = i;
  page.renderQuestion();
  const q = curQ();
  if (!q.options || q.type === 'multi') continue;
  const k = q.options[0].key;
  tap(page, k);
  const item = page.data.q.options.find(o => o.key === k);
  ok(item.cls.indexOf('sel') >= 0, '反馈关闭 第' + (i + 1) + '题 点选有高亮');
  ok(page.data.fb === null && P().fb[q.id] === undefined, '反馈关闭 第' + (i + 1) + '题 不即时判分');
}
store.S.settings.feedback = true;

/* ---------- 3. 考试模式：多选点选也要有高亮 ---------- */
store.ui.setupCount = 20;
store.startPractice('exam', logic.poolIds({ scope: 'all', chapters: [], types: store.ui.setupTypes, hidden: {} }));
page = newPage();
page.onLoad();
let examMultiChecked = 0;
for (let i = 0; i < P().ids.length && examMultiChecked < 3; i++) {
  P().idx = i;
  page.renderQuestion();
  const q = curQ();
  if (!q.options) continue;
  const keys = q.options.map(o => o.key);
  if (q.type === 'multi') {
    examMultiChecked++;
    tap(page, keys[0]);
    const item = page.data.q.options.find(o => o.key === keys[0]);
    ok(item.cls.indexOf('sel') >= 0, '考试模式 多选 #' + (i + 1) + ' 点选有高亮', 'cls="' + item.cls + '"');
    ok(page.data.fb === null, '考试模式 多选 #' + (i + 1) + ' 不即时反馈');
  } else {
    tap(page, keys[0]);
    const item = page.data.q.options.find(o => o.key === keys[0]);
    ok(item.cls.indexOf('sel') >= 0 && page.data.fb === null, '考试模式 单选/判断 #' + (i + 1) + ' 点选有高亮、不判分');
  }
  // 标记疑题 → 答题卡要同步
  page.onFlag();
  ok(page.data.acardCells[i].cls.indexOf('flagged') >= 0, '考试模式 第' + (i + 1) + ' 题标记同步到答题卡');
}
console.log('考试模式：多选 ' + examMultiChecked + ' 道已校验');

/* ---------- 4. 掌握度标记按钮 ---------- */
console.log('== 4. 已掌握/未掌握按钮 ==');
/* 本节只验「手动标记」：关掉自动掌握，否则前面章节已把这个题答对过一次，
   这里再答对就触发连续答对自动掌握，mkM 断言会误判。自动掌握另有专节。 */
store.S.settings.autoMaster = 0;
store.S.qs = {};
store.S.mastered = {};
store.S.wrong = {};
store.S.settings.feedback = true;
store.ui.setupCount = 20;
store.startPractice('seq', logic.poolIds({ scope: 'all', chapters: [], types: ['single'], hidden: {} }).slice(0, 6));
page = newPage();
page.onLoad();

// 未判分时按钮不出现
ok(page.data.canMark === false, '未判分时不显示掌握度按钮', 'canMark=' + page.data.canMark);

// 答对 → canMark 出现，点「已掌握」写 mastered
P().idx = 0;
page.renderQuestion();
let q0 = curQ();
tap(page, logic.answerKey(q0, q0.answer));
ok(page.data.canMark === true, '判分后显示掌握度按钮');
ok(page.data.mkM === false && page.data.mkU === false, '初始未标记', page.data.mkM + '/' + page.data.mkU);
page.onMark({ currentTarget: { dataset: { id: page.data.qid, v: 1 } } });
ok(store.isMastered(q0.id) === true, '点已掌握 → 写 mastered');
ok(page.data.mkM === true, '按钮状态回显为已掌握');
ok(store.S.wrong[q0.id] === undefined, '已掌握不入未掌握列表');

// 两个按钮互斥：在已掌握题上点「未掌握」应反转状态（已掌握 → 未掌握）
const midQ = curQ();
page.onMark({ currentTarget: { dataset: { id: page.data.qid, v: -1 } } });
ok(store.isMastered(midQ.id) === false, '在已掌握题上点未掌握 → 清掉已掌握标记');
ok(!!store.S.wrong[midQ.id], '在已掌握题上点未掌握 → 进入未掌握列表');
ok(page.data.mkM === false && page.data.mkU === true, '按钮状态互斥回显', page.data.mkM + '/' + page.data.mkU);

// 手动点「未掌握」= 视同错题入库
P().idx = 1;
page.renderQuestion();
let q1 = curQ();
tap(page, logic.answerKey(q1, q1.answer));
page.onMark({ currentTarget: { dataset: { id: page.data.qid, v: -1 } } });
ok(!!store.S.wrong[q1.id], '点未掌握 → 入未掌握列表（视同错题）');
ok(store.isMastered(q1.id) === false, '点未掌握 → 清除已掌握标记');
ok(page.data.mkU === true, '按钮状态回显为未掌握');
// 再点「已掌握」应从未掌握列表移出
page.onMark({ currentTarget: { dataset: { id: page.data.qid, v: 1 } } });
ok(store.S.wrong[q1.id] === undefined, '改点已掌握 → 移出未掌握列表');
ok(store.isMastered(q1.id) === true, '改点已掌握 → 写 mastered');

// 考试模式不显示按钮
store.ui.setupCount = 10;
store.startPractice('exam', logic.poolIds({ scope: 'all', chapters: [], types: ['single'], hidden: {} }).slice(0, 5));
page = newPage();
page.onLoad();
P().idx = 0;
page.renderQuestion();
tap(page, curQ().options[0].key);
ok(page.data.canMark === false, '考试模式不显示掌握度按钮', 'canMark=' + page.data.canMark);

/* ---------- N. 导入页：粘贴模板 -> 校验 -> 启用 -> logic 重建 ---------- */
const BV = require(path.join(MP, 'utils', 'bank-validate.js'));
const importPagePath = path.join(MP, 'pages', 'import', 'import.js');
delete require.cache[require.resolve(importPagePath)];
let importCfg = null;
global.Page = c => { importCfg = c; };
require(importPagePath);
const ip = Object.create(importCfg);
ip.data = JSON.parse(JSON.stringify(importCfg.data));
ip.setData = function (patch) { Object.keys(patch).forEach(k => { ip.data[k] = patch[k]; }); };

ip.raw = BV.TEMPLATE_TEXT;
ip.onValidate();
ok(ip.data.step === 1 && ip.data.result && ip.data.result.count === 8,
  '导入页：模板粘贴校验通过（8 题）', 'step=' + ip.data.step + ' count=' + (ip.data.result || {}).count);

ip.onEnable();
ok(logic.QLIST.length === 8, '导入页：启用后 logic 重建为 8 题', '' + logic.QLIST.length);
/* 题库元信息现在落在 wb.banks.index（多题库布局预留），不再是 wb.bank.meta */
function bankIndex() {
  const v = mem['wb.banks.index'];
  const o = typeof v === 'string' ? JSON.parse(v) : v;
  return (o && o.list && o.list[0]) || null;
}
const idxAfterImport = bankIndex();
ok(!!idxAfterImport && idxAfterImport.count === 8, '导入页：题库分片写入 storage（索引）',
  JSON.stringify(idxAfterImport && { c: idxAfterImport.count, chunks: idxAfterImport.chunks }));
ok(logic.poolIds({ types: ['judge', 'single', 'multi'] }).length === 3, '导入页：启用后题池可用');

ip.raw = '[{"a":1,}]';
ip.onValidate();
ok(ip.data.step === 2 && ip.data.parseErr.indexOf('JSON') >= 0, '导入页：坏 JSON 进入失败态',
  'step=' + ip.data.step);

/* ---------- N+1. 复现 bug：复制模板 -> 校验并导入，原来报「粘贴的内容为空」 ---------- */
global.__clip = null;
ip.onClearInput();
ok(!ip.raw && ip.data.rawLen === 0 && ip.data.filled === false && ip.data.step === 0,
  '导入页：清空后回到初始态');
ip.onCopyTemplate();
ok(ip.raw === BV.TEMPLATE_TEXT && ip.data.rawLen === BV.TEMPLATE_TEXT.length && ip.data.filled === true,
  '导入页：复制模板即填入校验源，无需手动粘贴', 'rawLen=' + ip.data.rawLen + ' filled=' + ip.data.filled);
ip.onValidate();
ok(ip.data.step === 1 && ip.data.result && ip.data.result.count === 8,
  '导入页：复制模板后直接校验通过（8 题）', 'step=' + ip.data.step);

/* 输入框为空但剪贴板里有题库 JSON：回退读剪贴板 */
ip.onClearInput();
global.__clip = BV.TEMPLATE_TEXT;
ip.onValidate();
ok(ip.data.step === 1 && ip.data.result && ip.data.result.count === 8 && ip.raw === BV.TEMPLATE_TEXT,
  '导入页：输入框为空时回退读剪贴板并通过校验', 'step=' + ip.data.step);

/* 剪贴板里是提示词文案：明确提示，不报难懂的 JSON 错误 */
ip.onClearInput();
global.__clip = '你是题库结构化助手。我会给你一份题库文档原文';
toasts.length = 0;
ip.onValidate();
ok(ip.data.step === 0 && toasts.indexOf('剪贴板里不是题库 JSON，请粘贴到输入框') >= 0,
  '导入页：剪贴板非题库 JSON 时给出明确提示', toasts.join(' / '));

/* 输入框与剪贴板均空：保持原来的空提示 */
ip.onClearInput();
global.__clip = '';
toasts.length = 0;
ip.onValidate();
ok(ip.data.step === 0 && toasts.indexOf('粘贴的内容为空') >= 0,
  '导入页：输入框与剪贴板均空时提示为空', toasts.join(' / '));
global.__clip = null;

/* 清空按钮必须同时清掉 textarea 的受控值（原来只清内存变量，屏幕上一个字都没少） */
ip.raw = '{"x":1}';
ip.setData({ taValue: '{"x":1}', rawLen: 6 });
ip.onClearInput();
ok(ip.raw === '' && ip.data.taValue === '' && ip.data.rawLen === 0,
  '导入页：清空同时清掉输入框内容', 'taValue="' + ip.data.taValue + '"');

/* 解析映射合并：提示词 B 的产物原来在页内没有任何入口 */
const mapText = JSON.stringify({ q0001: '这是合并进来的解析文本', zz9999: '当前题库里没有这个题号' });
ip.raw = mapText;
ip.onValidate();
ok(ip.data.analysis && ip.data.analysis.total === 2 && ip.data.analysis.hit === 1 && ip.data.analysis.miss === 1,
  '导入页：识别解析映射并给出命中数', JSON.stringify(ip.data.analysis));
ip.onMergeAnalysis();
ok(logic.QMAP['q0001'].analysis === '这是合并进来的解析文本',
  '导入页：合并解析写进题库', String(logic.QMAP['q0001'].analysis).slice(0, 10));
ok(!!mem['wb.banks.index'], '导入页：合并解析后题库重新落盘');

/* 提示词必须与 docs/ai-bank-prompt.md 同版：原来是手抄的浓缩版，文档换版后
 * App 里发出去的还是旧的（用户 2026-10-30 反馈「还是老版本」）。 */
console.log('== 导入页提示词 ==');
/* 2026-11-02：默认入口换成一两句 + 仓库链接（原来只能整段复制 1.2 万字，
 * 手机上没法用）。断言三件事：够短、指向 GitHub raw、不含发布态敏词。 */
ip.onCopyShortPrompt();
const shortA = String(global.__copied || '');
ok(shortA.length < 400 && shortA.indexOf('https://raw.githubusercontent.com/xprears/shuati-miniprogram') >= 0,
  '复制转换指令：一句话 + 仓库链接，不是万字长文', 'len=' + shortA.length);
ok(shortA.indexOf('只输出 JSON 数组') >= 0, '转换指令带输出约束（不靠 AI 自由发挥）');
ok(!/考试|培训|考核|授课|备考|学习/.test(shortA), '转换指令不含教育属性敏词');
ip.onCopyShortAnalysisPrompt();
const shortB = String(global.__copied || '');
ok(shortB.length < 400 && shortB.indexOf('analysis.md') >= 0,
  '复制解析指令：指向解析规范文件', 'len=' + shortB.length);
ip.onCopyPrompt();
const copiedA = String(global.__copied || '');
ok(copiedA.indexOf('你是一个专业的题库结构化助手') === 0 && copiedA.length > 8000,
  '复制 AI 提示词：发的是文档长规范，不是旧浓缩版', 'len=' + copiedA.length);
ok(!/考试|培训|考核|授课|备考|学习/.test(copiedA), '提示词 A 不含教育属性敏词');
ip.onCopyAnalysisPrompt();
const copiedB = String(global.__copied || '');
ok(copiedB.indexOf('# 角色定义') === 0 && copiedB.length > 5000,
  '复制解析提示词：发的是文档长规范', 'len=' + copiedB.length);
ok(!/考试|培训|考核|授课|备考|学习/.test(copiedB), '提示词 B 不含教育属性敏词');

/* ---------- N+2. 主观题练习模式（回归用例此前只覆盖 judge/single/multi） ---------- */
console.log('== 主观题自评回归 ==');
cfg = practiceCfg;
store.S.settings.feedback = true;
store.ui.setupTypes = ['essay', 'scenario', 'case', 'operation'];
const subjPool = logic.poolIds({ scope: 'all', chapters: [], types: store.ui.setupTypes, hidden: {} });
ok(subjPool.length === 4, '示例题库含 4 道主观题', '' + subjPool.length);
store.startPractice('seq', subjPool);
page = newPage();
let renderErr = '';
try { page.onLoad(); } catch (e) { renderErr = e.message; }
ok(!renderErr, '主观题 renderQuestion 不抛异常（原来 q.answer.split 必崩）', renderErr);
ok(page.data.q && page.data.q.isSubj === true, '主观题标记 isSubj');
ok(page.data.fbTitle === '' && page.data.fbText === '', '主观题不计算「正确答案」文本', page.data.fbTitle + '/' + page.data.fbText);
ok(page.data.canMark === false, '主观题不出现与自评重复的掌握度按钮', 'canMark=' + page.data.canMark);

const subjId0 = P().ids[P().idx];
const rBase = (store.S.qs[subjId0] || {}).r || 0;   // 同号题在前面的用例里可能有历史记录，按增量断言
page.judgeSubjective({ currentTarget: { dataset: { v: 1 } } });
ok(page.data.fb === 1 && P().fb[subjId0] === 1, '主观题「标记已掌握」写入判分与状态', 'fb=' + page.data.fb);
ok(store.isMastered(subjId0) === true && !store.S.wrong[subjId0], '主观题标记已掌握 → 入 mastered、不进未掌握');
ok(page.data.q.options.length === 0, '主观题没有选项列表');

/* 自评点错了必须能改：改判只动掌握度，不重复累计答题次数 */
page.judgeSubjective({ currentTarget: { dataset: { v: -1 } } });
ok(!!store.S.wrong[subjId0] && !store.isMastered(subjId0), '主观题可改判：已掌握 → 未掌握');
ok(store.S.qs[subjId0].r === rBase + 1 && store.S.qs[subjId0].w === 0, '主观题改判不重复累计答题次数',
  JSON.stringify(store.S.qs[subjId0]) + ' base=' + rBase);

P().idx = 1;
page.renderQuestion();
const subjId1 = P().ids[1];
page.judgeSubjective({ currentTarget: { dataset: { v: -1 } } });
ok(!!store.S.wrong[subjId1] && !store.isMastered(subjId1), '主观题标记未掌握 → 入未掌握');

/* ---------- N+2.5 填空题：逐空输入 / 全对才判对 / 锁定与标准答案 ---------- */
console.log('== 填空题答题回归 ==');
cfg = practiceCfg;
store.S.settings.feedback = true;
store.S.qs = {}; store.S.wrong = {}; store.S.mastered = {};
store.ui.setupTypes = ['blank'];
const blankPool = logic.poolIds({ scope: 'all', chapters: [], types: ['blank'], hidden: {} });
/* 此处题库是导入页启用的模板库（8 题），含 1 道 2 空的填空题 */
ok(blankPool.length === 1, '模板库含 1 道填空题', '' + blankPool.length);
store.startPractice('seq', blankPool);
page = newPage();
page.onLoad();
const bq = logic.QMAP[P().ids[P().idx]];
ok(page.data.q.isBlank === true && page.data.q.isSubj === false,
  '填空：isBlank 为 true 且不走主观题分支（!q.options 的老判定会把它当主观题）');
ok(page.data.q.blanks.length === logic.blanksOf(bq).length,
  '填空：输入行数 = 空位数', page.data.q.blanks.length + '/' + logic.blanksOf(bq).length);
ok(page.data.q.segments.some(s => s.t === 'blank' && s.mark === '（1）'), '填空：题干空位替换为（1）编号');
ok(page.data.q.options.length === 0, '填空：没有选项列表');
ok(page.data.fb === null && page.data.fbText === '', '填空：未判分时不显示正确答案');

/* 输入过程只写会话内存：setData 会让输入框重建、光标跳到末尾 */
const aSnapshot = JSON.stringify(page.data.a);
page.onBlankInput({ currentTarget: { dataset: { i: 0 } }, detail: { value: '随便写' } });
ok(P().ans[bq.id].sel[0] === '随便写', '填空：输入立即写入会话内存');
ok(JSON.stringify(page.data.a) === aSnapshot, '填空：输入过程不 setData（否则光标跳动）');

/* 只填一半：提交只提示，不判分、不计入答题卡已答 */
const bAnsLen = logic.blanksOf(bq).length;
for (let i = 0; i < bAnsLen - 1; i++) page.onBlankInput({ currentTarget: { dataset: { i } }, detail: { value: '半截' } });
ok(page.buildAcard().answered === 0, '填空：只填一半不计入「已答」', '' + page.buildAcard().answered);
toasts.length = 0;
page.submitCurrent();
ok(toasts.indexOf('请把每个空都填上') >= 0 && page.data.fb === null,
  '填空：没填满时提交只提示不判分', toasts.join(' / '));

/* 错一空：整题判错，但要逐空标出对错并给出标准答案 */
const bAccept = logic.blanksOf(bq).map(x => String(x).split('|')[0]);
bAccept.forEach((v, i) => page.onBlankInput({ currentTarget: { dataset: { i } }, detail: { value: i === 0 ? v + 'zz' : v } }));
page.submitCurrent();
ok(page.data.fb === -1 && !!store.S.wrong[bq.id], '填空：错一空整题判错并收入未掌握');
ok(page.data.q.blanks[0].cls === 'bad' && page.data.q.blanks[1].cls === 'ok', '填空：逐空标出对错',
  page.data.q.blanks.map(b => b.cls).join(','));
ok(page.data.q.blanks[0].locked === true && page.data.q.blanks[0].accept.length > 0,
  '填空：判分后锁定并给出该空标准答案', page.data.q.blanks[0].accept);
ok(page.data.fbText.indexOf('第1空') >= 0, '填空：反馈文案按空列出正确答案', page.data.fbText);

/* 全对：判对、移出未掌握 */
store.startPractice('seq', [bq.id]);
page = newPage();
page.onLoad();
bAccept.forEach((v, i) => page.onBlankInput({ currentTarget: { dataset: { i } }, detail: { value: ' ' + v + ' ' } }));
page.submitCurrent();
ok(page.data.fb === 1 && !store.S.wrong[bq.id], '填空：全对判对并移出未掌握（首尾空格不影响）');
ok(page.data.fbTitle.indexOf('全部正确') >= 0, '填空：全对文案', page.data.fbTitle);

/* ---------- N+3. 设置页：题量文案 / 「全部」去重 / 空池提示 / 隐藏章节 ---------- */
console.log('== 练习设置页 ==');
const setupPath = path.join(MP, 'pages', 'setup', 'setup.js');
delete require.cache[require.resolve(setupPath)];
let setupCfg = null;
global.Page = c => { setupCfg = c; };
require(setupPath);
function newSetupPage(opts) {
  const p = Object.create(setupCfg);
  p.data = JSON.parse(JSON.stringify(setupCfg.data));
  p.setData = function (patch) { Object.keys(patch).forEach(k => { p.data[k] = patch[k]; }); };
  p.onLoad(opts || {});
  return p;
}

store.ui.setupTypes = logic.TYPE_ORDER.slice();
store.ui.setupCount = 50;
store.ui.setupScope = 'all';
store.ui.setupChapters = [];
let sp = newSetupPage({ mode: 'rand' });
const labels = sp.data.counts.map(c => c.label);
ok(sp.data.poolN === 8, '设置页：8 题题库题池 8 题', '' + sp.data.poolN);
ok(labels.filter(l => l === '全部').length === 1, '题量选项只有一个「全部」', labels.join('/'));
ok(new Set(labels).size === labels.length, '题量选项无重复', labels.join('/'));
ok(sp.data.startN === 8, '开始按钮题量 = 实际抽题数', '' + sp.data.startN);

/* 60 题池选 20 题：按钮必须写 20，不是 60（原 bug） */
const bigBank = [];
for (let i = 0; i < 60; i++) {
  bigBank.push({ i: 'x' + i, t: 'single', s: '第 ' + i + ' 题的题干文字', p: '一、通用题', c: '第一章 单选题', o: [['A', '甲'], ['B', '乙']], a: 'A' });
}
logic.reload(bigBank);
store.ui.setupTypes = ['single'];
store.ui.setupCount = 20;
sp = newSetupPage({ mode: 'rand' });
ok(sp.data.poolN === 60 && sp.data.startN === 20, '60 题池选 20 题 → 按钮写 20 题',
  'pool=' + sp.data.poolN + ' start=' + sp.data.startN);
ok(sp.data.counts.map(c => c.label).join('/') === '20题/50题/全部', '题量档位 20/50/全部',
  sp.data.counts.map(c => c.label).join('/'));
ok(sp.data.counts.filter(c => c.on).length === 1 && sp.data.counts[0].on, '当前选中档位唯一且高亮');

/* 自选章节一个不勾 → 0 题，且要说明原因 */
store.ui.setupScope = 'custom';
store.ui.setupChapters = [];
sp = newSetupPage({ mode: 'seq' });
ok(sp.data.poolN === 0 && sp.data.startN === 0, '自选章节未勾选 → 0 题', '' + sp.data.poolN);
ok(/勾选/.test(sp.data.tip), '自选章节未勾选 → 给出提示', sp.data.tip);

/* 隐藏章节不参与未掌握重练 */
store.ui.setupScope = 'all';
const firstCh = logic.QLIST[0].chapter;
store.S.wrong = { x0: { n: 1, at: 1, last: 1 }, x1: { n: 1, at: 1, last: 1 } };
store.S.hidden = {};
sp = newSetupPage({ mode: 'wrong' });
ok(sp.data.poolN === 2, '未掌握重练默认带上全部未掌握题', '' + sp.data.poolN);
store.S.hidden[firstCh] = true;
sp = newSetupPage({ mode: 'wrong' });
ok(sp.data.poolN === 0, '隐藏章节的题不参与未掌握重练', '' + sp.data.poolN);
store.S.hidden = {};

/* 未掌握重练空池也要有提示 */
store.S.wrong = {};
sp = newSetupPage({ mode: 'wrong' });
ok(sp.data.poolN === 0 && /未掌握清单是空的/.test(sp.data.tip), '未掌握列表为空时给出提示', sp.data.tip);

/* ---------- N+4. 测验交卷口径：主观题不算未作答；超时进来先说明 ---------- */
console.log('== 测验交卷口径 ==');
cfg = practiceCfg;
logic.reload();                                   // 回到 8 题示例题库（4 客观 + 4 主观）
store.ui.setupTypes = logic.TYPE_ORDER.slice();
store.ui.setupScope = 'all';
store.ui.setupChapters = [];

const examPool = () => logic.poolIds({ scope: 'all', chapters: [], types: logic.TYPE_ORDER, hidden: {} });
const setAns = (id, key) => {
  const a = P().ans[id] || (P().ans[id] = { sel: [], flag: false });
  a.sel = [key];
};
/* 客观题作答：填空题没有选项，要逐空写答案（取每空的第一种可接受写法），
   否则它会被 logic.isAnswered 判成「未作答」，与断言的未作答数对不上 */
const answerObj = (id) => {
  const q = logic.QMAP[id];
  const a = P().ans[id] || (P().ans[id] = { sel: [], flag: false });
  if (logic.isFillBlank(q)) a.sel = logic.blanksOf(q).map(x => String(x).split('|')[0]);
  else a.sel = [q.options[0].key];
};

store.startPractice('exam', examPool());
let ep = newPage();
ep.onLoad();
const objIds = P().ids.filter(id => !logic.isSubjective(logic.QMAP[id]));
ok(objIds.length === 4 && P().ids.length - objIds.length === 4, '测验组卷 8 题（4 客观 + 4 主观）',
  objIds.length + ' 客观 / ' + (P().ids.length - objIds.length) + ' 主观');

/* 主观题界面上没有任何可选项，交卷后才自评：不能算成「未作答」 */
objIds.forEach(answerObj);
modals.length = 0;
ep.submitExam(false);
ok(modals.length === 0, '测验：客观题答完、只剩主观题时不弹「未作答」提示',
  modals.length ? modals[0].content : '无弹窗');

/* 漏 1 道客观题：提示数只该是 1，而不是 1 + 4 道主观题 */
store.startPractice('exam', examPool());
ep = newPage();
ep.onLoad();
const objIds2 = P().ids.filter(id => !logic.isSubjective(logic.QMAP[id]));
objIds2.slice(1).forEach(answerObj);
modals.length = 0;
ep.submitExam(false);
ok(modals.length === 1 && /还有 1 题未作答/.test(modals[0].content),
  '测验：未作答计数只算客观题', modals.length ? modals[0].content : '无弹窗');

/* 冷启动进入一场早已超时的测验：先解释「计时没有暂停」，不能一进来就甩成绩页 */
store.startPractice('exam', examPool());
P().exam.endsAt = Date.now() - 1000;
ep = newPage();
modals.length = 0;
ep.onLoad();
ok(modals.length === 1 && /已超时/.test(modals[0].title), '超时测验进入时先弹说明再交卷',
  modals.length ? modals[0].title : '无弹窗');

/* ---------- N+5. 自动掌握：连续答对 2 次自动标记，且必须让用户看见 ---------- */
console.log('== 自动掌握 ==');
cfg = practiceCfg;
logic.reload();                                  // 回到 8 题示例题库
store.S.qs = {}; store.S.mastered = {}; store.S.wrong = {};
store.S.settings.feedback = true;
store.S.settings.autoMaster = 2;
store.ui.setupTypes = ['judge', 'single', 'multi'];
const anchorQ = logic.QLIST.filter(q => q.options)[0];
function answerAnchor() {
  store.startPractice('seq', [anchorQ.id]);
  page = newPage();
  page.onLoad();
  const q = logic.QMAP[anchorQ.id];
  tap(page, logic.answerKey(q, q.answer));
}
answerAnchor();
ok(page.data.fbText.indexOf('已标记掌握') < 0, '第 1 次答对不提示已掌握', page.data.fbText);
answerAnchor();
ok(page.data.fbText.indexOf('已标记掌握') >= 0, '第 2 次答对提示「已标记掌握」', page.data.fbText);
ok(page.data.mkM === true, '第 2 次答对后「已掌握」按钮回显高亮');
ok(store.stats().masteredN === 1, '统计里已掌握 +1', '' + store.stats().masteredN);

store.startPractice('seq', [anchorQ.id]);
page = newPage();
page.onLoad();
const qa = logic.QMAP[anchorQ.id];
tap(page, logic.answerKey(qa, qa.answer) === 'A' ? 'B' : 'A');
ok(!store.isMastered(anchorQ.id) && !!store.S.wrong[anchorQ.id],
  '答错 → 立刻退出已掌握并进未掌握（原 bug：两表并存）');

/* ---------- N+6. 危险操作：两跳确认 ---------- */
console.log('== 危险操作二次确认 ==');
const confirmMod = require(path.join(MP, 'utils', 'confirm.js'));
let fired = 0;
modals.length = 0;
confirmMod.confirmDanger({ title: 'T', content: 'C' }, () => { fired++; });
ok(modals.length === 1 && modals[0].title === 'T', '第一跳弹出并说明后果');
modals[0].success({ confirm: true });
ok(modals.length === 2 && modals[1].title === '最后确认', '第一跳确认后弹第二跳');
ok(fired === 0, '第一跳确认后还没执行');
modals[1].success({ confirm: false });
ok(fired === 0, '第二跳取消 → 不执行');

modals.length = 0; fired = 0;
confirmMod.confirmDanger({}, () => { fired++; });
modals[0].success({ confirm: true });
modals[1].success({ confirm: true });
ok(fired === 1, '两跳都确认才执行');

modals.length = 0; fired = 0;
confirmMod.confirmDanger({}, () => { fired++; });
modals[0].success({ confirm: false });
ok(modals.length === 1 && fired === 0, '第一跳取消 → 直接结束，不弹第二跳');

/* 页面真的接上了：报告页「清空未掌握」必须走两跳，且不确认就不动数据 */
const reportPath = path.join(MP, 'pages', 'report', 'report.js');
delete require.cache[require.resolve(reportPath)];
let repCfg = null;
global.Page = c => { repCfg = c; };
require(reportPath);
const rp = Object.create(repCfg);
rp.data = JSON.parse(JSON.stringify(repCfg.data));
rp.setData = function (patch) { Object.keys(patch).forEach(k => { rp.data[k] = patch[k]; }); };
store.S.wrong = { [anchorQ.id]: { n: 1, at: 1, last: 1 } };
rp.onShow();
modals.length = 0;
rp.onClearWrong();
ok(modals.length === 1 && /未掌握/.test(modals[0].content) && /1 道/.test(modals[0].content),
  '报告页清空未掌握：第一跳写清数量与后果', modals[0] && modals[0].content);
modals[0].success({ confirm: true });
ok(modals.length === 2 && /无法恢复|丢失/.test(modals[1].content),
  '报告页清空未掌握：第二跳提示不可恢复', modals[1] && modals[1].content);
modals[1].success({ confirm: false });
ok(!!store.S.wrong[anchorQ.id], '取消后未掌握列表原样保留');
modals[1].success({ confirm: true });
ok(!store.S.wrong[anchorQ.id], '两跳都确认后才真正清空');

/* ---------- N+7. 分类页大标题折叠 ---------- */
console.log('== 分类页折叠 ==');
const bankPath = path.join(MP, 'pages', 'bank', 'bank.js');
delete require.cache[require.resolve(bankPath)];
let bankCfg = null;
global.Page = c => { bankCfg = c; };
require(bankPath);
function newBankPage() {
  const p = Object.create(bankCfg);
  p.data = JSON.parse(JSON.stringify(bankCfg.data));
  p.setData = function (patch) { Object.keys(patch).forEach(k => { p.data[k] = patch[k]; }); };
  return p;
}
store.S.collapsed = {};
let bp = newBankPage();
bp.onShow();
ok(bp.data.parts.length >= 1, '分类页渲染出分类块', '' + bp.data.parts.length);
ok(bp.data.parts.every(x => !x.folded), '默认全部展开');
ok(/已练/.test(bp.data.parts[0].agg), '大标题带聚合进度', bp.data.parts[0].agg);
const pk = bp.data.parts[0].key;
bp.onTogglePart({ currentTarget: { dataset: { key: pk } } });
ok(bp.data.parts[0].folded === true, '点大标题 → 该块折叠');
ok(bp.data.parts[0].chapters.length > 0, '折叠只影响渲染，章节数据仍在');
const dump7 = mem['yjtx.v1'];
ok(!!dump7 && !!dump7.collapsed && dump7.collapsed[pk] === true, '折叠状态已落盘（下次打开沿用）');
bp.onTogglePart({ currentTarget: { dataset: { key: pk } } });
ok(bp.data.parts[0].folded === false, '再点一次 → 展开');
bp.onToggleAll();
ok(bp.data.parts.every(x => x.folded) && bp.data.allFolded === true, '一键全部收起');
bp.onToggleAll();
ok(bp.data.parts.every(x => !x.folded) && bp.data.allFolded === false, '一键全部展开');

/* ---------- N+8. 单题编辑：改完生效、指纹不变、旧判定清掉、可还原 ---------- */
console.log('== 单题编辑 ==');
const bankMod = require(path.join(MP, 'utils', 'bank-store.js'));
const editPath = path.join(MP, 'pages', 'edit', 'edit.js');
delete require.cache[require.resolve(editPath)];
let editCfg = null;
global.Page = c => { editCfg = c; };
require(editPath);
function newEditPage(qid) {
  const p = Object.create(editCfg);
  p.data = JSON.parse(JSON.stringify(editCfg.data));
  p.setData = function (patch) { Object.keys(patch).forEach(k => { p.data[k] = patch[k]; }); };
  p.onLoad({ qid: qid });
  return p;
}
logic.reload();
const tq = logic.QLIST.filter(q => q.type === 'single')[0];
const origStem = tq.stem, origAns = tq.answer;
const fpBefore = bankMod.currentFingerprint();
store.S.qedits = {};
store.S.mastered[tq.id] = Date.now();                          // 模拟已掌握，改完应被摘掉
store.S.qs[tq.id] = { r: 3, w: 0, cs: 2, last: 1, at: 1 };
let edp = newEditPage(tq.id);
ok(edp.data.stem === origStem && edp.data.options.length === tq.options.length,
  '编辑页带出原题干与选项');
edp.draft.stem = origStem + '（修正）';
const otherKey = tq.options.find(o => o.key !== origAns).key;
edp.onPickAnswer({ currentTarget: { dataset: { k: otherKey } } });
ok(edp.data.options.find(o => o.key === otherKey).on === true, '选答案后选项高亮联动');
edp.onSave();
ok(logic.QMAP[tq.id].stem.indexOf('（修正）') >= 0, '保存后题干立刻生效');
ok(logic.QMAP[tq.id].answer === otherKey, '保存后答案立刻生效', logic.QMAP[tq.id].answer);
ok(bankMod.currentFingerprint() === fpBefore, '单题修改不改指纹（否则会被判成换题库清记录）');
ok(!store.isMastered(tq.id) && (store.S.qs[tq.id] || {}).cs === 0,
  '保存后该题旧判定清掉（已掌握摘掉 + 连续计数归零）');
ok(store.S.qs[tq.id].r === 3, '保存后历史答题次数保留', 'r=' + store.S.qs[tq.id].r);
ok(!!store.S.qedits[tq.id], '原值留底，可还原');

/* 加/删选项：编号必须保持连续，答案跟着搬 */
edp = newEditPage(tq.id);
const optN = edp.data.options.length;
edp.onAddOption();
ok(edp.data.options.length === optN + 1, '加选项生效', '' + edp.data.options.length);
let keys8 = edp.data.options.map(o => o.key).join('');
ok(keys8 === keys8.split('').map((_, i) => String.fromCharCode(65 + i)).join(''),
  '加选项后编号连续', keys8);
edp.onRemoveOption({ currentTarget: { dataset: { i: 0 } } });
keys8 = edp.data.options.map(o => o.key).join('');
ok(edp.data.options.length === optN && keys8 === keys8.split('').map((_, i) => String.fromCharCode(65 + i)).join(''),
  '删选项后编号重新连续', keys8);
ok(edp.data.options.length >= 2, '选项不会删到少于 2 个');

/* 改坏的东西拦得住：空题干 */
edp = newEditPage(tq.id);
edp.draft.stem = '   ';
edp.onSave();
ok(edp.data.errs.length > 0, '空题干保存被拦住并给出原因', JSON.stringify(edp.data.errs));

/* 还原 */
modals.length = 0;
edp = newEditPage(tq.id);
edp.onRestore();
ok(modals.length === 1 && /还原/.test(modals[0].title), '还原前要确认');
modals[0].success({ confirm: true });
ok(logic.QMAP[tq.id].stem === origStem && logic.QMAP[tq.id].answer === origAns,
  '还原回原始题干与答案', logic.QMAP[tq.id].answer);
ok(!store.S.qedits[tq.id], '还原后清掉留底');

/* ---------- N+9. 反馈通道：微信客服 + 诊断信息 ---------- */
console.log('== 反馈与诊断信息 ==');
const contactMod = require(path.join(MP, 'utils', 'contact.js'));
ok(contactMod.ready() === true, '有客服通道时反馈区渲染');
const keepWx = contactMod.CONTACT.wechatId;
contactMod.CONTACT.wechatId = '';
ok(contactMod.ready() === true, '只开客服、没填微信号也渲染');
contactMod.CONTACT.useCustomerService = false;
ok(contactMod.ready() === false, '三条通道全关 ⇒ 反馈卡整块不渲染');
contactMod.CONTACT.useCustomerService = true;
contactMod.CONTACT.wechatId = keepWx;

/* 诊断信息必须自带上下文：客服会话只透传聊天内容，没有这些等于「导入不进去」四个字 */
rp.onShow();
global.__copied = '';
rp.onCopyDiagnostics();
const diag = String(global.__copied || '');
ok(!!diag && diag.indexOf('【刷题本子】问题反馈') === 0, '诊断信息以标题开头');
ok(diag.indexOf('· 版本：') >= 0, '诊断信息带版本号', diag.split('\n')[1]);
ok(/· 题库：.*\d+ 题/.test(diag), '诊断信息带题库名与题数', diag.split('\n')[2]);
ok(/· 练习：已答 \d+ 题/.test(diag) && diag.indexOf('正确率') >= 0, '诊断信息带练习统计',
  (diag.split('\n')[3] || ''));
ok(diag.indexOf('· 页面：练习报告') >= 0, '诊断信息带用户所在页面');

const tplImport = contactMod.buildTemplate({ total: 5, page: '导入题库', errs: ['q0001 缺必填字段 stem'] });
ok(tplImport.indexOf('· 页面：导入题库') >= 0 && tplImport.indexOf('q0001 缺必填字段') >= 0,
  '导入页模板带页面与报错明细');
ok(tplImport.indexOf('· 练习：') < 0, '没传统计字段时不硬塞「练习」行');

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
