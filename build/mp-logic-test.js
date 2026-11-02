/* 小程序逻辑层全流程测试：mock wx API，驱动 store + logic 完整业务链路
 * 题库无关：题数/章节/题型等期望值一律从当前题库推导；
 * 真实题库（3238 题）下额外执行严格口径校验，示例题库下自动降级为结构校验。
 * 运行：node build/mp-logic-test.js
 */
const path = require('path');
const fs = require('fs');
const MP = path.join(__dirname, '..', 'miniprogram');
/* 仓库不带 qbank.js（它是构建产物，发布物也被 packOptions 排除）。
 * 首次 clone 后直接跑测试会 require 失败，所以缺了就先按示例题库构建一份；
 * 产物被 .gitignore 忽略，不影响发布校验。 */
const QB = MP + '/utils/qbank.js';
if (!fs.existsSync(QB)) {
  require('child_process').execFileSync(process.execPath,
    [path.join(__dirname, 'build_bank.js'), '--sample'], { stdio: 'inherit' });
}
/* Node 回退注入：bank-store 不直接 require qbank.js（发布包会排除它，见其注释），
 * 由测试脚本注入开发副本内置题库，行为与旧版「无 wx 时回退读 qbank.js」一致 */
require(MP + '/utils/bank-store.js').__setNodeBank(require(QB));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
}
function skip(name, why) { console.log('  – ' + name + '（跳过：' + why + '）'); }
function freshStore(keepStorage) {
  delete require.cache[require.resolve(MP + '/utils/store.js')];
  delete require.cache[require.resolve(MP + '/utils/logic.js')];
  const saved = global.wx && global.wx._s;
  global.wx = {
    _s: {},
    getStorageSync(k) {
      const v = this._s[k];
      if (v === undefined) return '';
      try { return JSON.parse(v); } catch (e) { return v; }
    },
    setStorageSync(k, v) { this._s[k] = JSON.stringify(v); },
    showToast() {}, showModal() {}
  };
  if (keepStorage && saved) global.wx._s = saved;
  return require(MP + '/utils/store.js');
}

(async function () {
  /* ===== 1. 题库与树结构 ===== */
  console.log('== 1. 题库索引 ==');
  const logic = require(MP + '/utils/logic.js');
  const N = logic.QLIST.length;
  const REAL = N === 3238;               // 真实题库指纹（3238 题），示例题库为 12 题
  const SUBJ = logic.QLIST.filter(q => !q.options).length;
  const byType = {};
  logic.QLIST.forEach(q => { byType[q.type] = (byType[q.type] || 0) + 1; });
  const chapters = logic.TREE.reduce((n, p) => n + p.chapters.length, 0);

  ok(N > 0, '题库加载成功（当前 ' + N + ' 题' + (REAL ? '，真实题库' : '，示例题库') + '）', '' + N);
  if (REAL) {
    ok(logic.TREE.length === 5, '5 大部');
    ok(chapters === 22, '22 章', '' + chapters);
    ok(byType.judge === 775 && byType.single === 1709 && byType.multi === 713, '题型分布正确', JSON.stringify(byType));
  } else {
    ok(logic.TREE.length >= 1, '结构树非空（' + logic.TREE.length + ' 大部）');
    ok(chapters >= 1, '章节非空（' + chapters + ' 章）', '' + chapters);
    ok(byType.judge > 0 && byType.single > 0 && byType.multi > 0, '客观题三类齐全', JSON.stringify(byType));
    ok(logic.TYPE_ORDER.every(t => byType[t] > 0), '8 种题型均有覆盖（示例题库预期形态）', JSON.stringify(byType));
  }
  ok(logic.QMAP['q0001'] && logic.QMAP['q0001'].type === 'judge', 'QMAP 索引可用');
  const idSet = new Set(logic.QLIST.map(q => q.id));
  ok(idSet.size === N, '题目 id 全局唯一', idSet.size + '/' + N);

  // 解析接线：qbank.x -> QLIST.analysis，每题都应带解析且非空
  const noAn = logic.QLIST.filter(q => !q.analysis || q.analysis.length < 20);
  ok(noAn.length === 0, N + ' 题均带解析（≥20字）',
    noAn.length + ' 题缺：' + noAn.slice(0, 5).map(q => q.id).join(','));

  /* ===== 2. 顺序练习 + 即时反馈 ===== */
  console.log('== 2. 顺序练习全流程 ==');
  let store = freshStore();
  store.init();
  store.ui.setupTypes = ['judge', 'single', 'multi'];
  const pool = logic.poolIds({ scope: 'all', types: store.ui.setupTypes, hidden: store.S.hidden });
  ok(pool.length === N - SUBJ, '默认范围 ' + (N - SUBJ) + ' 题（不含主观 ' + SUBJ + '）', '' + pool.length);
  const SEQ_N = Math.min(20, pool.length);
  const half = Math.floor(SEQ_N / 2);
  store.startPractice('seq', pool.slice(0, SEQ_N));
  let p = store.S.practice;
  ok(p.ids.length === SEQ_N && p.mode === 'seq', '会话创建 ' + SEQ_N + ' 题');
  // 前一半答对，后一半答错
  p.ids.forEach((id, i) => {
    const q = logic.QMAP[id];
    const a = p.ans[id] || (p.ans[id] = { sel: [], flag: false });
    if (i < half) a.sel = [logic.answerKey(q, q.answer)];
    else a.sel = [logic.answerKey(q, q.answer) === 'A' ? 'B' : 'A']; // 确定错误
    const okk = logic.isCorrect(q, a.sel);
    p.fb[id] = okk ? 1 : -1;
    store.recordAnswer(id, okk);
    if (okk) store.removeWrong(id); else store.addWrong(id);
  });
  store.save();
  ok(Object.keys(store.S.wrong).length > 0, '答错入错题本', '' + Object.keys(store.S.wrong).length);
  const r = store.finishPractice();
  ok(r && r.mode === 'seq' && r.answered === SEQ_N, '结束练习返回结果', JSON.stringify({ a: r.answered, c: r.correct }));
  ok(r.correct === half, '答对 ' + half + ' 题（前一半按正确答案作答）', '' + r.correct);
  ok(store.S.practice === null, '会话已清空');
  ok(store.S.streak.n === 1 && store.S.days[logic.today()] === SEQ_N, '连续打卡与每日统计', store.S.streak.n + '天/' + store.S.days[logic.today()] + '题');

  /* ===== 3. 模拟考试 + 主观自评 ===== */
  console.log('== 3. 模拟考试全流程 ==');
  store = freshStore();
  store.init();
  store.ui.setupTypes = logic.TYPE_ORDER.slice();
  store.ui.setupDur = 30;
  const pool2 = logic.poolIds({ scope: 'all', types: store.ui.setupTypes, hidden: store.S.hidden });
  ok(pool2.length === N, '含主观题范围 ' + N, '' + pool2.length);
  // 混合组卷：22 客观 + 3 主观（样本库容量不足时按实际题量）
  const subjPool = pool2.filter(id => !logic.QMAP[id].options);
  const objPool = pool2.filter(id => logic.QMAP[id].options);
  const objPick = Math.min(22, objPool.length);
  const subjPick = Math.min(3, subjPool.length);
  const examTotal = objPick + subjPick;
  store.startPractice('exam', objPool.slice(0, objPick).concat(subjPool.slice(0, subjPick)));
  p = store.S.practice;
  ok(p.ids.length === examTotal, '组卷 ' + objPick + ' 客观 + ' + subjPick + ' 主观', '' + p.ids.length);
  ok(p.exam && p.exam.duration === 30 * 60000, '考试时长 30 分钟');
  // 客观题全答对（只答有选项的），主观题留空
  p.ids.forEach(id => {
    const q = logic.QMAP[id];
    if (!q.options) return;
    const a = p.ans[id] || (p.ans[id] = { sel: [], flag: false });
    if (q.type === 'multi') a.sel = q.answer.split('');
    else a.sel = [logic.answerKey(q, q.answer)];
  });
  const base = store.gradeExam();
  const objRight = base.correct;
  ok(objRight === examTotal - base.subjIds.length, '客观题全对', objRight + '/' + (examTotal - base.subjIds.length));
  ok(base.subjIds.length > 0, '存在主观题待自评', '' + base.subjIds.length);
  // 自评：一半掌握
  const results = {};
  base.subjIds.forEach((id, i) => { results[id] = i % 2 === 0 ? 1 : -1; });
  const subjRight = Object.keys(results).filter(k => results[k] === 1).length;
  const last = store.submitSelfReview(results, base);
  ok(last.mode === 'exam' && last.score === Math.round((objRight + subjRight) / examTotal * 100), '总分 = (客观对+主观自评对)/总量', 'score=' + last.score);
  ok(store.S.history.length === 1 && store.S.history[0].score === last.score, '考试记录入历史');
  ok(store.S.practice === null, '考后会话清空');
  const expectWrong = base.subjIds.filter(id => results[id] === -1).length;
  const wAfterExam = Object.keys(store.S.wrong).length;
  ok(wAfterExam === expectWrong, '未掌握主观题入错题本', wAfterExam + '/' + expectWrong);

  /* ===== 4. 超时自动交卷 ===== */
  console.log('== 4. 超时自动交卷 ==');
  store = freshStore();
  store.init();
  store.ui.setupTypes = ['single'];
  store.ui.setupDur = 30;
  store.startPractice('exam', logic.poolIds({ scope: 'all', types: ['single'], hidden: {} }).slice(0, 10));
  store.S.practice.exam.endsAt = Date.now() - 1000;
  const to = store.onExamTimeout();
  ok(to && to.score !== undefined, '超时直接完赛（无主观题）', 'score=' + (to && to.score));
  ok(store.S.practice === null, '超时后会话清空');

  /* ===== 5. 错题重做答对移出 ===== */
  console.log('== 5. 错题重做 ==');
  store = freshStore();
  store.init();
  const wq = logic.poolIds({ scope: 'all', types: ['judge'], hidden: {} }).slice(0, 5);
  wq.forEach(id => store.addWrong(id));
  ok(store.wrongCount() === wq.length, '错题本 ' + wq.length + ' 题', '' + store.wrongCount());
  store.startPractice('wrong', wq);
  p = store.S.practice;
  // 全部答对
  p.ids.forEach(id => {
    const q = logic.QMAP[id];
    const a = p.ans[id] || (p.ans[id] = { sel: [], flag: false });
    a.sel = [logic.answerKey(q, q.answer)];
    p.fb[id] = 1;
    store.recordAnswer(id, true);
    store.removeWrong(id);
  });
  ok(store.wrongCount() === 0, '答对后错题本清空');
  const r2 = store.finishPractice();
  ok(r2 && r2.correct === wq.length, '错题练习结果 ' + wq.length + ' 对', '' + (r2 && r2.correct));

  /* ===== 6. 分类隐藏 ===== */
  console.log('== 6. 分类管理 ==');
  store = freshStore();
  store.init();
  const before = logic.poolIds({ scope: 'all', hidden: {} }).length;
  const ch0 = logic.TREE[0].chapters[0];   // 取当前题库第一章，不再写死章节名与题数
  const hidden = { [ch0.name]: true };
  const after = logic.poolIds({ scope: 'all', hidden: hidden }).length;
  ok(after === before - ch0.count, '隐藏「' + ch0.name + '」排除 ' + ch0.count + ' 题', before + ' -> ' + after);
  store.S.hidden = hidden;
  store.save();
  // round-trip：重新加载
  const store2 = freshStore(true);
  store2.init();
  ok(store2.S.hidden[ch0.name] === true, '隐藏状态持久化 round-trip');
  const after2 = logic.poolIds({ scope: 'all', hidden: store2.S.hidden }).length;
  ok(after2 === before - ch0.count, '重载后排除生效', '' + after2);

  /* ===== 7. 评分正确性 ===== */
  console.log('== 7. 评分函数 ==');
  const judgeQ = logic.QMAP['q0001'];
  ok(logic.isCorrect(judgeQ, ['A']) === (judgeQ.answer === '√'), '判断题评分');
  const multiQ = logic.QLIST.find(q => q.type === 'multi');
  const right = multiQ.answer.split('');
  const wrongSel = right.slice(0, -1);
  ok(logic.isCorrect(multiQ, right.slice().reverse()) === true, '多选顺序无关');
  ok(logic.isCorrect(multiQ, wrongSel) === false, '多选漏选判错');
  ok(logic.isCorrect(multiQ, right.concat(['Z'])) === false, '多选多选判错');
  const singleQ = logic.QLIST.find(q => q.type === 'single');
  ok(logic.isCorrect(singleQ, [singleQ.answer]) === true, '单选正确');
  ok(logic.isCorrect(singleQ, [singleQ.answer === 'A' ? 'B' : 'A']) === false, '单选错误');

  /* 填空题：归一化匹配 / 逐空判分 / 已答口径 */
  const blankQ = logic.QLIST.find(q => q.type === 'blank');
  ok(!!blankQ && logic.blanksOf(blankQ).length === logic.countBlanks(blankQ.stem),
    '填空：题干空位数与答案项数一致',
    blankQ && (logic.countBlanks(blankQ.stem) + ' 空 / ' + logic.blanksOf(blankQ).length + ' 答'));
  const bAccept = logic.blanksOf(blankQ).map(x => String(x).split('|')[0]);
  ok(logic.isCorrect(blankQ, bAccept) === true, '填空：标准写法判对');
  ok(logic.isCorrect(blankQ, bAccept.map(x => ' ' + x + ' ')) === true, '填空：忽略首尾空格');
  ok(logic.isCorrect(blankQ, bAccept.map(x => x.toUpperCase())) === true, '填空：英文大小写不敏感');
  ok(logic.isCorrect(blankQ, bAccept.map(x => x + '。')) === true, '填空：忽略句末标点');
  ok(logic.isCorrect(blankQ, bAccept.map(x => x.replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0xFEE0)))) === true,
    '填空：全角数字自动转半角');
  const bAlt = logic.blanksOf(blankQ).map(x => String(x).split('|').slice(-1)[0]);
  ok(logic.isCorrect(blankQ, bAlt) === true, '填空：| 分隔的等价写法任一命中');
  ok(logic.isCorrect(blankQ, bAccept.slice(0, -1)) === false, '填空：漏填最后一空判错');
  ok(logic.isCorrect(blankQ, bAccept.map((x, i) => (i === 0 ? x + 'x' : x))) === false, '填空：任一空错即整题错');
  ok(logic.isCorrect(blankQ, []) === false, '填空：空答案判错');
  ok(logic.isCorrect(blankQ, bAccept.map(() => '完全不相关的答案')) === false, '填空：无关答案判错');
  ok(logic.isSubjective(blankQ) === false, '填空：属于客观题，不能走自评');
  ok(logic.isAnswered(blankQ, bAccept) === true, '填空：全部填完算已答');
  ok(logic.isAnswered(blankQ, bAccept.slice(0, -1)) === false, '填空：只填一半不算已答');
  const segsBlank = logic.splitBlanks(blankQ.stem).segs;
  ok(segsBlank.filter(s => s.t === 'blank').length === logic.blanksOf(blankQ).length,
    '填空：题干分段与空位一一对应');
  ok(segsBlank.map(s => s.t).join(',').indexOf('blank') >= 0, '填空：分段里含空位段');

  /* ===== 8. 持久化完整性 ===== */
  console.log('== 8. 持久化完整性 ==');
  store = freshStore();
  store.init();
  store.startPractice('seq', logic.poolIds({ scope: 'all', types: ['judge'], hidden: {} }).slice(0, 5));
  store.S.practice.ans['q0001'] = { sel: ['A'], flag: true };
  store.save();
  const raw = JSON.parse(global.wx._s['yjtx.v1']);
  ok(raw.practice && raw.practice.ans['q0001'].flag === true, '练习会话（含标记）落盘');
  ok(raw.v === 1, '版本号正确');

  /* ===== 9. 掌握度标记 + 加权抽题 ===== */
  console.log('== 9. 掌握度标记与加权抽题 ==');
  store = freshStore();
  store.init();
  const judgePool = logic.poolIds({ scope: 'all', types: ['judge'], hidden: {} });
  const K = Math.min(10, judgePool.length);
  if (K < 2) {
    skip('掌握度标记与加权抽题全节', '判断题不足 2 道');
  } else {
    const wq2 = judgePool.slice(0, K);
    const mk = Math.floor(K / 2);          // 前一半已掌握，后一半未掌握
    const masteredIds = wq2.slice(0, mk);
    const unmasteredIds = wq2.slice(mk);
    masteredIds.forEach(id => store.markMastered(id));
    unmasteredIds.forEach(id => store.markUnmastered(id));
    ok(store.masteredCount() === masteredIds.length, '已掌握 ' + masteredIds.length + ' 题', '' + store.masteredCount());
    ok(store.wrongCount() === unmasteredIds.length, '未掌握 ' + unmasteredIds.length + ' 题', '' + store.wrongCount());
    ok(store.isMastered(masteredIds[0]) === true, 'isMastered 命中');
    ok(store.isMastered(unmasteredIds[unmasteredIds.length - 1]) === false, '未标记不算已掌握');
    // 互斥：同一题不能同时已掌握和未掌握
    store.markMastered(unmasteredIds[0]);
    ok(store.wrongCount() === unmasteredIds.length - 1 && store.isMastered(unmasteredIds[0]), '已掌握会移出未掌握列表');
    store.markUnmastered(unmasteredIds[0]);
    ok(store.wrongCount() === unmasteredIds.length && !store.isMastered(unmasteredIds[0]), '未掌握会清掉已掌握标记');
    ok(store.S.wrong[unmasteredIds[0]].n === 0, '手动标记未掌握不虚增答错次数', '' + store.S.wrong[unmasteredIds[0]].n);
    // 已掌握会整体移出未掌握记录（与「答对移出错题本」同口径），再标未掌握等于重新入库，n 从 0 起
    if (unmasteredIds.length >= 2) {
      store.addWrong(unmasteredIds[1]);
      ok(store.S.wrong[unmasteredIds[1]].n === 1, '答错累加 n', '' + store.S.wrong[unmasteredIds[1]].n);
      store.markMastered(unmasteredIds[1]);
      store.markUnmastered(unmasteredIds[1]);
      ok(store.S.wrong[unmasteredIds[1]] && store.S.wrong[unmasteredIds[1]].n === 0,
        '标已掌握后再标未掌握 = 重新入库（n 归零）', '' + (store.S.wrong[unmasteredIds[1]] || {}).n);
    } else {
      skip('答错累加 n / 重新入库归零', '未掌握题不足 2 道');
    }

    // 加权抽样：未掌握题出现次数应显著多于已掌握题
    const bigPool = judgePool.slice(0, 400);
    const mSet = new Set(masteredIds), uSet = new Set(unmasteredIds);
    if (bigPool.length >= 20) {
      let hitM = 0, hitU = 0;
      const R = 200;
      for (let i = 0; i < R; i++) {
        store.weightedPick(bigPool, 60).forEach(id => {
          if (mSet.has(id)) hitM++;
          if (uSet.has(id)) hitU++;
        });
      }
      ok(hitU > hitM, '未掌握题出现次数 > 已掌握题', '未掌握 ' + hitU + ' vs 已掌握 ' + hitM);
      // 大样本下比例应接近 4:1
      const ratio = hitU / Math.max(1, hitM);
      ok(ratio > 2.2 && ratio < 7, '未掌握/已掌握 出现比接近 4:1', 'ratio=' + ratio.toFixed(2));
    } else {
      skip('加权抽题统计显著性（4:1）', '样本库判断题仅 ' + bigPool.length + ' 道，需 ≥20 才有统计意义');
    }
    // 抽题不重复、数量正确
    const pickedN = Math.min(50, bigPool.length);
    const picked = store.weightedPick(bigPool, 50);
    ok(picked.length === pickedN && new Set(picked).size === pickedN, '加权抽题不重复且数量正确', picked.length + '/' + new Set(picked).size);
    // 边界：池子小于目标数
    const edge = bigPool.slice(0, Math.min(7, bigPool.length));
    ok(store.weightedPick(edge, 50).length === edge.length, '池子不足时返回全部');

    // 考试模式不加权（公平随机）
    store.ui.setupCount = 20;
    store.startPractice('exam', bigPool);
    ok(store.S.practice.ids.length === Math.min(20, bigPool.length), '考试仍取设定题量（受池容量限制）', '' + store.S.practice.ids.length);
    store.ui.setupCount = 50;
    store.startPractice('rand', bigPool);
    ok(store.S.practice.ids.length === Math.min(50, bigPool.length), '随机练习按题量加权抽取', '' + store.S.practice.ids.length);

    // 标记持久化 round-trip
    store.save();
    const store3 = freshStore(true);
    store3.init();
    ok(store3.S.mastered && Object.keys(store3.S.mastered).length === masteredIds.length, '已掌握标记持久化', JSON.stringify(Object.keys(store3.S.mastered || {}).length));
    // 旧存档（无 mastered 字段）不崩
    const old = JSON.parse(global.wx._s['yjtx.v1']);
    delete old.mastered;
    global.wx._s['yjtx.v1'] = JSON.stringify(old);
    const store4 = freshStore(true);
    store4.init();
    ok(store4.S.mastered && typeof store4.S.mastered === 'object', '旧存档缺 mastered 时兜底为空对象');
  }

  /* ===== 10. 题库导入：bank-validate / bank-store / logic.reload ===== */
  console.log('== 10. 题库导入与运行期加载 ==');
  const BV = require(MP + '/utils/bank-validate.js');
  const bankStore = require(MP + '/utils/bank-store.js');

  // 本节自带 storage mock（含 removeStorageSync，freshStore 的 mock 没有）
  const bankMem = {};
  global.wx = {
    _s: bankMem,
    getStorageSync(k) { const v = this._s[k]; if (v === undefined) return ''; try { return JSON.parse(v); } catch (e) { return v; } },
    setStorageSync(k, v) { this._s[k] = JSON.stringify(v); },
    removeStorageSync(k) { delete this._s[k]; },
    showToast() {}, showModal() {}
  };

  // A. normalize：围栏 / module.exports 包装 / 紧凑态识别 / 各类坏输入
  const tpl = BV.normalize(BV.TEMPLATE_TEXT);
  ok(tpl.ok && tpl.qs.length === 8, 'normalize：8 题型模板可直接解析', '' + (tpl.qs || []).length);
  ok(BV.normalize('```json\n' + BV.TEMPLATE_TEXT + '\n```').ok, 'normalize：剥离 ``` 围栏');
  const wrapped = '// 题库数据：12 题\nmodule.exports = ' + JSON.stringify(BV.compact(tpl.qs)) + ';';
  const nw = BV.normalize(wrapped);
  ok(nw.ok && nw.qs[0].id === 'q0001' && nw.qs[0].options[0].key === 'A' && nw.qs[3].reference,
    'normalize：剥离 module.exports 包装并识别紧凑态');
  ok(!BV.normalize('[{"a":1,}]').ok, 'normalize：坏 JSON 报错');
  ok(!BV.normalize('{"a":1}').ok, 'normalize：非数组根节点报错');
  ok(!BV.normalize('   ').ok, 'normalize：空内容报错');
  ok(!BV.normalize('[{"x":1}]').ok, 'normalize：无法识别字段形态报错');

  // B. validate：模板零错误；九类 error 逐类触发；主观题缺 reference 仅警告
  ok(BV.validate(tpl.qs).errs.length === 0, 'validate：模板零错误');
  function mutate(fn) { const qs = JSON.parse(JSON.stringify(tpl.qs)); fn(qs); return qs; }
  const errHas = (qs, kw) => BV.validate(qs).errs.some(e => e.indexOf(kw) >= 0);
  ok(errHas(mutate(qs => { qs[1].id = qs[0].id; }), 'id 重复'), 'validate：id 重复');
  ok(errHas(mutate(qs => { delete qs[0].stem; }), '缺必填字段 stem'), 'validate：必填字段缺失');
  ok(errHas(mutate(qs => { qs[0].type = 'fill'; }), '题型非法'), 'validate：题型非法');
  ok(errHas(mutate(qs => { qs[1].options[2].key = 'C'; qs[1].options.splice(1, 1); }), '选项键须从 A 起连续'), 'validate：选项键断号');
  ok(errHas(mutate(qs => { delete qs[0].answer; }), '判断题答案须为'), 'validate：判断题答案非法');
  ok(errHas(mutate(qs => { qs[1].answer = 'AB'; }), '单选题答案须为单个字母'), 'validate：单选答案非法');
  ok(errHas(mutate(qs => { qs[2].answer = 'A'; }), '多选题答案须为 2 个以上字母'), 'validate：多选答案不足 2 字母');
  ok(errHas(mutate(qs => { qs[1].answer = 'Z'; }), '答案含不存在的选项'), 'validate：答案越界');
  ok(BV.validate(mutate(qs => { delete qs[3].reference; })).warns.length === 1, 'validate：主观题缺 reference 仅警告');

  /* 填空题校验：空位数、空答案、上限、options 冗余；以及下划线空位的容错 */
  const bIdx = tpl.qs.findIndex(q => q.type === 'blank');
  ok(bIdx >= 0, '模板含填空题');
  ok(errHas(mutate(qs => { qs[bIdx].blanks = qs[bIdx].blanks.slice(1); }), '空位数不匹配'),
    'validate：填空题空位数与答案项数不匹配');
  ok(errHas(mutate(qs => { qs[bIdx].blanks = []; }), '缺 blanks 数组'), 'validate：填空题缺 blanks');
  ok(errHas(mutate(qs => { qs[bIdx].blanks[0] = '  '; }), '个空的答案为空'), 'validate：填空题存在空答案');
  ok(errHas(mutate(qs => { qs[bIdx].stem = '没有空位的题干'; }), '题干里没有空位'), 'validate：填空题题干无空位');
  ok(errHas(mutate(qs => { qs[bIdx].stem = '（ ）'.repeat(9); qs[bIdx].blanks = new Array(9).fill('a'); }), '最多 8 个空'),
    'validate：填空题空位上限 8');
  ok(BV.validate(mutate(qs => { qs[bIdx].options = [{ key: 'A', text: '多余选项' }]; })).warns
    .some(w => w.indexOf('App 会忽略') >= 0), 'validate：填空题带 options 只警告');
  const nb = BV.normalize(JSON.stringify([
    { id: 'b1', type: 'blank', stem: '纤芯直径为____μm，包层直径为____μm', answer: ['9', '125'], part: 'p', chapter: 'c' }
  ]));
  ok(nb.ok && nb.qs[0].stem === '纤芯直径为（ ）μm，包层直径为（ ）μm' && nb.qs[0].blanks.length === 2 && nb.qs[0].answer === null,
    'normalize：填空题下划线空位与数组答案自动转正', JSON.stringify(nb.qs && nb.qs[0]));
  const c1 = BV.compact(tpl.qs);
  ok(JSON.stringify(c1) === JSON.stringify(BV.compact(BV.normalize(JSON.stringify(c1)).qs)), 'compact：紧凑态往返一致');

  // B2. 解析映射：提示词 B 的产物（{"q0001":"解析"}）识别与合并
  const am = BV.parseAnalysisMap('{"q0001":"解析一","q0002":"解析二"}');
  ok(am.ok && Object.keys(am.map).length === 2, 'parseAnalysisMap：识别解析映射');
  ok(!BV.parseAnalysisMap('[{"id":"q0001"}]').ok, 'parseAnalysisMap：题目数组不误判为解析映射');
  ok(!BV.parseAnalysisMap('{"q0001":1}').ok, 'parseAnalysisMap：非字符串值不认');
  ok(!BV.parseAnalysisMap('{"q0001":"  "}').ok, 'parseAnalysisMap：空字符串不认');
  const mg = BV.mergeAnalysis(c1, { q0001: '合并后的解析', zz9999: '无主题' });
  ok(mg.hit === 1 && mg.miss.length === 1 && mg.miss[0] === 'zz9999', 'mergeAnalysis：命中 1 / 未命中 1', JSON.stringify({ h: mg.hit, m: mg.miss }));
  ok(mg.bank[0].x === '合并后的解析' && c1[0].x === undefined, 'mergeAnalysis：写回 x 且不改原数组');

  // C. bank-store：Node 回退、UTF-8 切分、分片存取往返、清除
  ok(bankStore.load().length === 14, 'bank-store：Node 无 meta 时回退 qbank.js（' + bankStore.load().length + ' 题）');
  ok(bankStore.utf8Len('abc') === 3 && bankStore.utf8Len('中') === 3 && bankStore.utf8Len('😀') === 4,
    'utf8Len：ASCII 1 / 中文 3 / emoji 4 字节');
  const longStr = 'x'.repeat(50) + '中'.repeat(50);
  const parts = bankStore.splitByUtf8(longStr, 30);
  ok(parts.join('') === longStr && parts.every(p => bankStore.utf8Len(p) <= 30) && parts.length > 1,
    'splitByUtf8：小限分片且拼接还原', parts.length + ' 片');
  const big = [];
  for (let bi = 0; bi < 300; bi++) {
    big.push({ i: 'b' + bi, t: 'single', s: '题干'.repeat(40), p: '一、大部', c: '第一章', o: [['A', '甲'], ['B', '乙']], a: 'A', x: '解析'.repeat(40) });
  }
  const saveR = bankStore.save(big);
  ok(saveR.ok && saveR.meta.count === 300, 'bank-store：保存 300 题');
  ok(saveR.meta.chunks >= 1, 'bank-store：分片数 ' + saveR.meta.chunks);
  const back = bankStore.readStorage();
  ok(Array.isArray(back) && back.length === 300 && back[0].i === 'b0' && back[299].x.length > 0,
    'bank-store：分片读回一致');
  ok(bankStore.info() && bankStore.info().count === 300, 'bank-store：info 反映题数');
  bankStore.clear();
  const cleared = bankStore.readStorage();
  ok(Array.isArray(cleared) && cleared.length === 0, 'bank-store：清除后为空库（不回退）');

  // D. logic.reload：换库 / 空库全链路重建
  logic.reload(BV.compact(tpl.qs));
  ok(logic.QLIST.length === 8 && logic.QMAP['q0004'] && logic.QMAP['q0004'].type === 'essay',
    'reload：换库后 QMAP 重建');
  ok(logic.TREE.length === 2 && logic.poolIds({ types: ['judge', 'single', 'multi'] }).length === 3,
    'reload：结构树与题池同步', logic.TREE.length + ' 大部');
  logic.reload([]);
  ok(logic.QLIST.length === 0 && logic.TREE.length === 0 && logic.poolIds({}).length === 0,
    'reload([])：空库全链路为空');

  /* ===== 11. 题库指纹与换库对账 ===== */
  console.log('== 11. 题库指纹与换库对账 ==');
  /* 重新 require 一对互相对齐的 store/logic：前面 freshStore 清过 logic 缓存，
     模块里因此存在两个 logic 实例（测试变量与 store 内部各持一个）。本节要 reload
     题库并读stats，必须打到 store 自己用的那个实例，否则断言的是另一份 QLIST。 */
  delete require.cache[require.resolve(MP + '/utils/store.js')];
  delete require.cache[require.resolve(MP + '/utils/logic.js')];
  const store11 = require(MP + '/utils/store.js');
  const logic11 = require(MP + '/utils/logic.js');
  const bank2 = BV.compact(tpl.qs);                 // 7 题模板库
  const sv2 = bankStore.save(bank2);
  ok(sv2.ok && !!sv2.meta.fp, 'save：指纹随 meta 落盘（' + (sv2.meta.fp || '空') + '）');
  ok(bankStore.currentFingerprint() === sv2.meta.fp, 'currentFingerprint 与 meta.fp 一致');
  ok(bankStore.fingerprint([]) === '' &&
    bankStore.fingerprint(bank2) !== bankStore.fingerprint(bank2.concat([{ i: 'q9999', t: 'judge', s: 'x' }])),
    'fingerprint：空库为空串、内容变化即变指纹');

  // 旧题库遗留：q0001/q0002 是新库也有的同号题，ghostX 只存在于旧库
  logic11.reload(bank2);
  store11.S.qs = { q0001: { r: 2, w: 1, last: 1, at: 1 }, ghostX: { r: 5, w: 5, last: 1, at: 1 } };
  store11.S.wrong = { ghostX: { n: 2, at: 1, last: 1 }, q0002: { n: 1, at: 1, last: 1 } };
  store11.S.mastered = { ghostX: 1 };
  store11.S.days = { '2026-01-01': 9 };
  store11.S.history = [{ mode: 'exam', score: 60, total: 10, correct: 6, at: 1, duration: 1, scopeLabel: '旧库', types: [], breakdown: {} }];
  store11.S.practice = { ids: ['q0001'], ans: {}, idx: 0 };
  store11.S.bankFp = 'old-bank-fingerprint';
  store11.S.settings.feedback = false;

  ok(store11.reconcileBank() === 'changed', 'reconcileBank：指纹不同判为换库');
  ok(!store11.S.qs.ghostX && !store11.S.wrong.ghostX && !store11.S.mastered.ghostX, 'reconcileBank：幽灵 id 已清理');
  ok(!!store11.S.qs.q0001 && !!store11.S.wrong.q0002, 'reconcileBank：新库同号记录保留（是否清由用户决定）');
  ok(store11.S.practice === null, 'reconcileBank：换库清掉进行中的会话');
  ok(store11.S.bankFp === sv2.meta.fp, 'reconcileBank：记录改绑到当前题库');

  const st1 = store11.stats();
  ok(!st1.noBank && st1.totalAns === 3 && st1.accuracy === logic11.pct(2, 3) + '%',
    'stats：幽灵 id 不计入（totalAns=' + st1.totalAns + '）', st1.accuracy);
  ok(st1.wrongN === 1 && st1.masteredN === 0, 'stats：未掌握/已掌握只算库内题',
    st1.wrongN + '/' + st1.masteredN);

  ok(store11.reconcileBank() === 'same' && !!store11.S.qs.q0001, 'reconcileBank：同一题库重复对账为 same 且不动记录');
  bankStore.clear();
  ok(store11.reconcileBank() === 'same' && store11.S.bankFp === sv2.meta.fp, 'reconcileBank：清库后绑定保持（等重导同库）');
  bankStore.save(bank2);
  ok(store11.reconcileBank() === 'same', 'reconcileBank：重导同一题库不误报换库');

  logic11.reload([]);
  const st0 = store11.stats();
  ok(st0.noBank && st0.totalAns === 0 && st0.wrongN === 0 && st0.streakN === 0 && st0.examN === 0,
    'stats：空态全部归零，不显示上一套题库的数字', JSON.stringify(st0));

  ok(store11.hasStats(), 'hasStats：识别出练习痕迹');
  store11.resetStats();
  ok(!store11.hasStats() && store11.S.settings.feedback === false && store11.S.bankFp === sv2.meta.fp,
    'resetStats：清空痕迹并保留设置与题库指纹');

  /* ===== 12. 测验幂等 / 超时未答不入未掌握 / 断签归零 ===== */
  console.log('== 12. 测验幂等与超时保护 ==');
  logic11.reload(bank2);
  const reset12 = () => {
    store11.S.qs = {}; store11.S.wrong = {}; store11.S.mastered = {}; store11.S.history = [];
    store11.S.days = {}; store11.S.streak = { last: '', n: 0 }; store11.S.practice = null;
    store11.S.settings.feedback = true;
  };
  reset12();
  store11.ui.setupTypes = logic11.TYPE_ORDER.slice();
  store11.ui.setupDur = 30;
  const allIds = logic11.QLIST.map(q => q.id);
  /* 客观题 = 有选项的 + 填空题。填空题没有 options，若仍按 q.options 判定，
     它会被排除在 objIds 之外、却在下文被 gradeExam 计为「未作答」，断言就对不上。 */
  const objIds = allIds.filter(id => !logic11.isSubjective(logic11.QMAP[id]));
  const choiceIds = objIds.filter(id => logic11.QMAP[id].options);
  /* 全量组卷：setupCount 小于题数时 startPractice 会随机抽样，
     「未作答数 == 客观题数-1」这类断言会随机失败 */
  store11.ui.setupCount = allIds.length;
  store11.startPractice('exam', allIds);
  let p12 = store11.S.practice;
  ok(p12.ids.length === allIds.length, '组卷全部 ' + allIds.length + ' 题（含主观）', '' + p12.ids.length);

  // 只答对 1 道单选题，其余全空
  const oneId = choiceIds[0];
  const q12 = logic11.QMAP[oneId];
  p12.ans[oneId] = { sel: [logic11.answerKey(q12, q12.answer)], flag: false };
  const pendingId = objIds.filter(id => id !== oneId)[0];
  const b1 = store11.gradeExam();
  ok(store11.S.qs[oneId] && store11.S.qs[oneId].r === 1, '判分后记录一次答对');
  ok(b1.unansweredIds.length === objIds.length - 1, '未作答题被单独统计', '' + b1.unansweredIds.length);
  ok(Object.keys(store11.S.wrong).length === 0, '未作答题不写入未掌握（原超时误伤）', '' + Object.keys(store11.S.wrong).length);
  ok(store11.S.qs[pendingId] === undefined, '未作答题不记答题次数');

  // 重复交卷：幂等，不得二次累加
  const b2 = store11.gradeExam();
  ok(b2.correct === b1.correct && store11.S.qs[oneId].r === 1,
    '重复交卷不重复记账（1 → 仍是 1）', 'r=' + store11.S.qs[oneId].r);
  ok(b2.unansweredIds.length === b1.unansweredIds.length, '重复交卷统计口径一致');

  // 自评：主观题全部标未掌握，成绩页数据完整
  const res12 = {};
  b2.subjIds.forEach(id => { res12[id] = -1; });
  const last12 = store11.submitSelfReview(res12, b2);
  ok(last12 && last12.score === Math.round(1 / allIds.length * 100), '总分 = 答对 1 / 总 ' + allIds.length, 'score=' + (last12 && last12.score));
  ok(last12.unanswered === objIds.length - 1, '成绩页带未作答数', '' + (last12 && last12.unanswered));
  ok(store11.S.history.length === 1, '重复判分也只记一场测验', '' + store11.S.history.length);
  const wrongCount12 = Object.keys(store11.S.wrong).length;
  ok(wrongCount12 === b2.subjIds.length, '只有自评未掌握的主观题入库', wrongCount12 + '/' + b2.subjIds.length);

  // 超时自动交卷：客观题池，答 1 题，其余按错计分但不入未掌握
  reset12();
  store11.ui.setupCount = objIds.length;   // 全量取池，否则随机抽样会与 objIds.length 对不上
  store11.startPractice('exam', objIds);
  p12 = store11.S.practice;
  /* 必须挑一道有选项的题来作答：填空题的 sel 是逐空文本，用 answerKey 拼不出正确答案 */
  const okQ = logic11.QMAP[p12.ids.filter(id => logic11.QMAP[id].options)[0]];
  const okSel = okQ.type === 'multi' ? okQ.answer.split('') : [logic11.answerKey(okQ, okQ.answer)];
  p12.ans[okQ.id] = { sel: okSel, flag: false };
  p12.exam.endsAt = Date.now() - 1000;
  const to2 = store11.onExamTimeout();
  ok(to2 && to2.score === Math.round(1 / objIds.length * 100), '超时按已作答内容交卷', 'score=' + (to2 && to2.score));
  ok(to2.timedOut === true, '成绩页标记为超时交卷');
  ok(Object.keys(store11.S.wrong).length === 0, '超时未作答的题不进未掌握', '' + Object.keys(store11.S.wrong).length);
  ok(store11.S.practice === null, '超时后会话清空');

  // 断签归零：只有在「下次答题」时修正是不够的，首页/报告页必须实时折算
  reset12();
  const todayKey = logic11.today();
  const yD = new Date(); yD.setDate(yD.getDate() - 1);
  const yKey = yD.getFullYear() + '-' + logic11.pad(yD.getMonth() + 1) + '-' + logic11.pad(yD.getDate());
  store11.S.streak = { last: '2026-01-01', n: 9 };
  ok(store11.stats().streakN === 0, '断签后连续打卡实时归零（原一直显示旧值）', '' + store11.stats().streakN);
  store11.S.streak = { last: yKey, n: 5 };
  ok(store11.stats().streakN === 5, '昨天答过 → 连续未断', '' + store11.stats().streakN);
  store11.S.streak = { last: todayKey, n: 9 };
  ok(store11.stats().streakN === 9, '今天答过 → 连续保持', '' + store11.stats().streakN);

  /* ===== 13. 自动掌握 / 题库命名 / 单题修改 ===== */
  console.log('== 13. 自动掌握与题库命名 ==');
  const bank13 = require(MP + '/utils/bank-store.js');
  const BV13 = require(MP + '/utils/bank-validate.js');
  function reset13() {
    store11.S.qs = {}; store11.S.wrong = {}; store11.S.mastered = {};
    store11.S.settings.autoMaster = 2; store11.S.settings.feedback = true;
    store11.S.qedits = {};
  }
  logic11.reload(bank2);
  reset13();
  const objId = logic11.QLIST.filter(q => q.options)[0].id;

  // A. 自动掌握：连续答对 2 次
  let r13 = store11.recordAnswer(objId, true, true);
  ok(!r13.mastered && !store11.isMastered(objId) && store11.S.qs[objId].cs === 1,
    '连续答对 1 次不自动掌握（cs=' + store11.S.qs[objId].cs + '）');
  r13 = store11.recordAnswer(objId, true, true);
  ok(r13.mastered && store11.isMastered(objId), '连续答对 2 次自动标记已掌握');
  store11.recordAnswer(objId, false, true);
  ok(!store11.isMastered(objId) && store11.S.qs[objId].cs === 0,
    '答错 → 退出已掌握 + 连续计数清零（原 bug：mastered/wrong 两表并存）');

  // 答错打断连续：对-错-对 只有 1 次连续
  store11.recordAnswer(objId, true, true);
  store11.recordAnswer(objId, false, true);
  store11.recordAnswer(objId, true, true);
  ok(!store11.isMastered(objId), '答错打断连续：之后只答对 1 次不掌握');

  // 测验既不推进连续计数、也不自动掌握
  reset13();
  store11.recordAnswer(objId, true, false);
  store11.recordAnswer(objId, true, false);
  ok(!store11.isMastered(objId) && !store11.S.qs[objId].cs, '测验模式不自动掌握、不推进连续计数');

  // 门槛 0 = 关闭
  reset13();
  store11.S.settings.autoMaster = 0;
  store11.recordAnswer(objId, true, true);
  store11.recordAnswer(objId, true, true);
  ok(!store11.isMastered(objId), '门槛设为 0 时关闭自动掌握');

  // 手动标未掌握要清 cs，否则下一次答对立刻又被自动掌握
  reset13();
  store11.recordAnswer(objId, true, true);
  store11.markUnmastered(objId);
  store11.recordAnswer(objId, true, true);
  ok(!store11.isMastered(objId) && !!store11.S.wrong[objId],
    '手动标未掌握后清 cs → 不会立刻被自动掌握又移出');

  // P0：答错不得与已掌握并存
  reset13();
  store11.S.mastered[objId] = Date.now();
  store11.addWrong(objId);
  ok(!store11.isMastered(objId) && !!store11.S.wrong[objId], 'addWrong 顺手清 mastered（同一题不会两格都算）');

  // B. 题库命名
  const sv13 = bank13.save(bank2, { name: '电力安全规程 2024' });
  ok(sv13.ok && sv13.meta.name === '电力安全规程 2024' && bank13.info().name === '电力安全规程 2024',
    'save：题库名随元信息落盘');
  const fp13 = bank13.currentFingerprint();
  ok(bank13.setName('改名后的题库').ok && bank13.info().name === '改名后的题库', 'setName：改名生效');
  ok(bank13.currentFingerprint() === fp13, 'setName：不改指纹（练习记录不受影响）');
  ok(bank13.info().count === bank2.length, 'setName：不改题数与题库数据');
  bank13.save(bank2);   // 不传 name —— 合并解析走的就是这条
  ok(bank13.info().name === '改名后的题库', 'save 不传 name 时沿用旧名（合并解析不会把名字洗掉）');
  bank13.setName('超长名字'.repeat(10));
  ok(bank13.info().name.length <= 20, '题库名截断到 20 字', '' + bank13.info().name.length);

  // C. 单题修改：内容生效、指纹不变
  bank13.setName('原始题库');
  const fpC = bank13.currentFingerprint();
  const tq = bank2.filter(q => q.t === 'single')[0];
  const pr = bank13.patchQuestion(tq.i, { s: tq.s + '（修正）', a: 'B' });
  ok(pr.ok && pr.before.s === tq.s, 'patchQuestion：返回改前原值（供还原）');
  const aq = bank13.load().filter(q => q.i === tq.i)[0];
  ok(aq.s.indexOf('（修正）') >= 0 && aq.a === 'B', 'patchQuestion：题干与答案都已写入');
  ok(bank13.currentFingerprint() === fpC, 'patchQuestion：指纹不变（否则会被判成换题库清记录）');
  ok(bank13.info().count === bank2.length, 'patchQuestion：题数不变');
  const dl = bank13.patchQuestion('zzz_not_exist', { s: 'x' });
  ok(!dl.ok && /没有这道题/.test(dl.err), 'patchQuestion：题号不存在时报错');

  // 编辑页保存前的单题校验
  const qtmp = {
    id: 'zz1', type: 'single', stem: '题干', part: '一、通用题', chapter: '第一章',
    options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: 'Z'
  };
  ok(BV13.validateOne(qtmp).errs.some(e => e.indexOf('不存在的选项') >= 0), 'validateOne：答案越界能拦住');
  qtmp.answer = 'A';
  ok(BV13.validateOne(qtmp).errs.length === 0, 'validateOne：合法题目零错误');
  ok(BV13.validateOne(Object.assign({}, qtmp, { stem: '' })).errs.some(e => e.indexOf('stem') >= 0),
    'validateOne：空题干能拦住');

  // D. 旧单库存档迁移（老用户升级路径，最容易出事的一段）
  delete bankMem['wb.banks.index'];
  bankMem['wb.bank.meta'] = JSON.stringify({ count: 1, size: 10, chunks: 1, at: 1, fp: 'legacy-fp', name: '旧题库' });
  /* 分片必须是「字符串」：真机 setStorageSync 存字符串、getStorageSync 取回的还是字符串。
     直接往 mem 写 JSON 串会被 mock 再解析成数组，读分片的分支（要求 typeof === 'string'）
     就走不到了 —— 用 setStorageSync 走一遍才是真实形态。 */
  global.wx.setStorageSync('wb.bank.0', JSON.stringify([{ i: 'l0001', t: 'judge', s: '旧题', p: '一、通用题', c: '第一章', o: [['A', '正确'], ['B', '错误']], a: '√' }]));
  const migrated = bank13.load();
  ok(migrated.length === 1 && migrated[0].i === 'l0001', '迁移：只有旧 wb.bank.meta 时也能读回题库');
  ok(bank13.info().name === '旧题库' && bank13.currentFingerprint() === 'legacy-fp',
    '迁移：名字与指纹沿用旧值');
  bank13.setName('迁移后改名');
  ok(!!bankMem['wb.banks.index'] && bankMem['wb.bank.meta'] === undefined,
    '迁移：首次写操作后落成索引并删掉旧 meta（不留两处事实源）');
  ok(JSON.parse(bankMem['wb.banks.index']).list[0].name === '迁移后改名', '迁移：改名写进新索引');

  console.log('\n逻辑层测试: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(2); });
