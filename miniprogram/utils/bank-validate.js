/* 题库规范化 / 校验 / 压缩 —— Node（构建、测试）与小程序（运行期导入）双端复用，零依赖
 *
 * 两种输入形态，normalize() 自动识别：
 *   详细态  {id,type,stem,options,answer,reference,part,chapter,category,analysis}  （提示词 A 产出）
 *   紧凑态  {i,t,s,p,c,g,o,a,r,x}                                                  （qbank.js 内容，即本模块 compact() 的产物）
 * 粘贴整个 qbank.js 文件内容时，自动剥离注释头与 module.exports 包装；AI 输出常带的 ``` 围栏也会剥掉。
 */
'use strict';

var TYPES = ['judge', 'single', 'multi', 'blank', 'essay', 'scenario', 'case', 'operation'];
/* 题型中文名必须与 miniprogram/utils/logic.js 的 TYPE_LABEL 逐项一致（mp-lint 第 11 项钉着）。
 * 曾经这里是「情景判断题 / 案例分析题 / 实操模拟题」，而 App 内标签是「情景题 / 案例分析 /
 * 实操模拟」——导入页统计与练习页标签两套叫法，用户对着同一个题型看到两个名字。 */
var TYPE_CN = {
  judge: '判断题', single: '单选题', multi: '多选题', blank: '填空题', essay: '论述题',
  scenario: '情景题', case: '案例分析', operation: '实操模拟'
};

/* 空位正则：必须与 miniprogram/utils/logic.js 的 BLANK_RE 完全一致（本模块双端复用，不能 require logic） */
var BLANK_RE = /（[ \t\u3000]*）|\([ \t\u3000]*\)/g;
var MAX_BLANKS = 8;

function countBlanks(stem) {
  var m = String(stem == null ? '' : stem).match(BLANK_RE);
  return m ? m.length : 0;
}

/* ---------- 文本预处理 ---------- */
function stripText(raw) {
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  // AI 输出常带 ```json 围栏
  var fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // 整个 qbank.js 文件：剥离行注释（JSON 字符串内不可能出现行首 //，故安全）
  text = text.replace(/^[ \t]*\/\/[^\n]*$/gm, '').trim();
  // 剥 module.exports = 包装与尾部分号
  text = text.replace(/^\s*module\.exports\s*=\s*/, '').trim();
  text = text.replace(/;\s*$/, '').trim();
  return text;
}

function detect(first) {
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
  if (first.id && first.type && first.stem) return 'verbose';
  if (first.i && first.t && first.s) return 'compact';
  return null;
}

function expand(d) {
  var isBlank = d.t === 'blank';
  return {
    id: d.i, type: d.t, stem: d.s, part: d.p, chapter: d.c,
    options: d.o ? d.o.map(function (o) { return { key: o[0], text: o[1] }; }) : null,
    answer: isBlank ? null : (d.a == null ? null : d.a),
    blanks: isBlank ? toBlanks(d.a) : null,
    category: d.g || null,
    reference: d.r || null,
    analysis: d.x || null
  };
}

/* 填空题答案统一成数组：紧凑态 a 可能是数组（标准）、单个字符串（AI 少写方括号）或 null */
function toBlanks(a) {
  if (a == null || a === '') return [];
  if (Array.isArray(a)) return a.map(function (x) { return String(x == null ? '' : x); });
  return [String(a)];
}

/* 填空题题干容错：AI 常写成下划线空，统一成全角（ ）；半角 ( ) 也一并转正，
 * 免得「能导入但 App 里认不出空位」。只对 blank 生效，不影响选择题题干里正常的括号。 */
function fixBlankStem(q) {
  if (!q || q.type !== 'blank') return q;
  var s = String(q.stem == null ? '' : q.stem);
  s = s.replace(/[＿_]{2,}/g, '（ ）');
  s = s.replace(BLANK_RE, '（ ）');
  q.stem = s;
  /* 兼容 AI 直接把答案写成数组 answer 的形态 */
  if (!Array.isArray(q.blanks) || !q.blanks.length) {
    if (Array.isArray(q.answer)) q.blanks = toBlanks(q.answer);
  }
  if (Array.isArray(q.answer)) q.answer = null;
  if (Array.isArray(q.blanks)) q.blanks = q.blanks.map(function (x) { return String(x == null ? '' : x); });
  return q;
}

/* ---------- 规范化：任意粘贴文本 -> 详细态数组 ---------- */
function normalize(raw) {
  var text = stripText(raw);
  if (!text) return { ok: false, err: '内容为空' };
  var arr;
  try {
    arr = JSON.parse(text);
  } catch (e) {
    return { ok: false, err: '不是合法的 JSON：' + e.message + '（常见原因：多了尾逗号、用了单引号或中文引号）' };
  }
  if (!Array.isArray(arr)) return { ok: false, err: '根节点必须是题目数组（[ {...}, {...} ]）' };
  if (!arr.length) return { ok: false, err: '数组里没有题目' };
  var shape = detect(arr[0]);
  if (!shape) {
    return { ok: false, err: '无法识别字段形态：既不是详细态（id/type/stem），也不是紧凑态（i/t/s）。请粘贴 AI 生成的标准题库 JSON。' };
  }
  var qs = shape === 'compact' ? arr.map(expand) : arr;
  qs.forEach(fixBlankStem);   // 填空题：下划线空 → （ ），answer 数组 → blanks
  return { ok: true, qs: qs };
}

/* ---------- 校验（规则与 build/build_bank.js 完全一致，勿单方面修改） ---------- */
function validate(qs) {
  var errs = [], warns = [], seen = {};
  qs.forEach(function (q) {
    var id = q && q.id;
    if (id) seen[id] = (seen[id] || 0) + 1;
  });
  Object.keys(seen).forEach(function (id) {
    if (seen[id] > 1) errs.push('id 重复：' + id + ' ×' + seen[id]);
  });
  qs.forEach(function (q) {
    var tag = (q && q.id) || '(缺 id)';
    var t = q && q.type;
    ['id', 'type', 'stem', 'part', 'chapter'].forEach(function (k) {
      if (!q || !q[k]) errs.push(tag + ' 缺必填字段 ' + k);
    });
    if (q && q.id && !/^[a-zA-Z0-9_\-\.]+$/.test(q.id)) {
      errs.push(tag + ' 题目 id 格式非法（只允许字母、数字、点、下划线和连字符）');
    }
    if (TYPES.indexOf(t) < 0) {
      errs.push(tag + ' 题型非法 ' + JSON.stringify(t) + '（可选：' + TYPES.join('/') + '）');
      return;
    }
    if (t === 'judge' || t === 'single' || t === 'multi') {
      var opts = q.options || [];
      var keys = opts.map(function (o) { return o && o.key; });
      var want = keys.map(function (_, i) { return String.fromCharCode(65 + i); });
      if (keys.join(',') !== want.join(',')) {
        errs.push(tag + ' 选项键须从 A 起连续编号，当前 [' + keys.join(',') + ']');
      }
      if (opts.some(function (o) { return !o || !String(o.text || '').trim(); })) {
        errs.push(tag + ' 存在空选项文本');
      }
      var a = q.answer || '';
      if (t === 'judge' && a !== '√' && a !== '×') {
        errs.push(tag + ' 判断题答案须为 √ 或 ×，当前 ' + JSON.stringify(a));
      }
      if (t === 'single' && !/^[A-H]$/.test(a)) {
        errs.push(tag + ' 单选题答案须为单个字母，当前 ' + JSON.stringify(a));
      }
      if (t === 'multi' && !/^[A-H]{2,8}$/.test(a)) {
        errs.push(tag + ' 多选题答案须为 2 个以上字母，当前 ' + JSON.stringify(a));
      }
      if (a && a.split('').some(function (c) { return c !== '√' && c !== '×' && keys.indexOf(c) < 0; })) {
        errs.push(tag + ' 答案含不存在的选项：' + a);
      }
    } else if (t === 'blank') {
      /* 填空题的核心约束：题干里标了几个空，就必须有几个答案。
       * 不匹配时宁可报错让用户/AI 修，也不静默截断或补空——那会让「第 2 空」永远判错。 */
      var bl = Array.isArray(q.blanks) ? q.blanks : null;
      var cnt = countBlanks(q.stem);
      if (!cnt) {
        errs.push(tag + ' 填空题题干里没有空位：请用全角（ ）标出每个空');
      }
      if (!bl || !bl.length) {
        errs.push(tag + ' 填空题缺 blanks 数组（按空位顺序写每空的答案，一个空的多种写法用 | 分隔）');
      } else {
        if (cnt && bl.length !== cnt) {
          errs.push(tag + ' 空位数不匹配：题干里有 ' + cnt + ' 个（ ），blanks 有 ' + bl.length + ' 项');
        }
        if (bl.length > MAX_BLANKS) {
          errs.push(tag + ' 单个填空题最多 ' + MAX_BLANKS + ' 个空，当前 ' + bl.length);
        }
        bl.forEach(function (v, i) {
          if (!String(v == null ? '' : v).trim()) errs.push(tag + ' 第 ' + (i + 1) + ' 个空的答案为空');
        });
      }
      if (q.options) warns.push(tag + ' 填空题带了 options，App 会忽略');
    } else if (!String(q.reference || '').trim()) {
      warns.push(tag + ' 主观题无 reference（参考要点），App 里将显示空');
    }
  });
  return { errs: errs, warns: warns };
}

/* ---------- 单题校验（编辑页保存前用） ----------
 * 直接复用 validate 的全套规则，只是把它套在单题上：答案越界、多选不足两字母、
 * 选项键断号、判断题答案非 √/× 这些错都是改完题最容易犯的。
 * 题干/选项/答案 都做了 trimmed 判空，避免用户把题干删空后点保存。 */
function validateOne(q) {
  if (!q) return { errs: ['题目为空'], warns: [] };
  var copy = {};
  Object.keys(q).forEach(function (k) { copy[k] = q[k]; });
  if (!String(copy.stem || '').trim()) copy.stem = '';   // 空题干交给 validate 报「缺必填字段」
  return validate([copy]);
}

/* ---------- 压缩：详细态 -> 紧凑态（与 build_bank.js 产物同形） ---------- */
function compact(qs) {
  return qs.map(function (q) {
    var d = { i: q.id, t: q.type, s: q.stem, p: q.part, c: q.chapter };
    if (q.options && q.options.length) d.o = q.options.map(function (o) { return [o.key, o.text]; });
    if (q.type === 'blank') {
      var bl = toBlanks(q.blanks || (Array.isArray(q.answer) ? q.answer : null));
      if (bl.length) d.a = bl;
    } else if (q.answer !== null && q.answer !== undefined) {
      d.a = q.answer;
    }
    if (q.category) d.g = q.category;
    if (q.reference) d.r = q.reference;
    if (q.analysis) d.x = q.analysis;
    return d;
  });
}

/* ---------- 解析映射（提示词 B 的产物：{"q0001":"解析文字"}） ----------
 * 提示词 B 让 AI 输出「题号 -> 解析」的对象，本模块把它识别出来，
 * 由导入页合并进现有题库——否则用户拿到结果没有任何地方可以放（旧版是死路）。 */
function parseAnalysisMap(raw) {
  var text = stripText(raw);
  if (!text || text.charAt(0) !== '{') return { ok: false };
  var obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  var keys = Object.keys(obj), map = {};
  for (var i = 0; i < keys.length; i++) {
    var v = obj[keys[i]];
    if (typeof v !== 'string' || !v.trim()) return { ok: false };  // 混入非字符串 ⇒ 不是解析映射
    map[keys[i]] = v.trim();
  }
  if (!keys.length) return { ok: false };
  return { ok: true, map: map };
}

/* 把解析映射合并进紧凑态题库：返回新数组 + 命中/未命中题号 */
function mergeAnalysis(bank, map) {
  var hit = 0, ids = {};
  var out = (bank || []).map(function (q) {
    ids[q.i] = 1;
    var x = map[q.i];
    if (typeof x === 'string' && x.trim()) {
      hit++;
      var c = {};
      Object.keys(q).forEach(function (k) { c[k] = q[k]; });
      c.x = x.trim();
      return c;
    }
    return q;
  });
  var miss = Object.keys(map).filter(function (k) { return !ids[k]; });
  return { bank: out, hit: hit, miss: miss };
}

/* ---------- 统计 ---------- */
function stat(qs) {
  var byType = {}, withAnalysis = 0;
  qs.forEach(function (q) {
    byType[q.type] = (byType[q.type] || 0) + 1;
    if (String(q.analysis || '').trim()) withAnalysis++;
  });
  return { total: qs.length, byType: byType, withAnalysis: withAnalysis };
}

function distText(qs) {
  var st = stat(qs);
  return TYPES.filter(function (t) { return st.byType[t]; })
    .map(function (t) { return (TYPE_CN[t] || t) + ' ' + st.byType[t]; }).join(' · ');
}

/* ---------- 8 题型最小模板（导入页内置常量，与 build/sample 同源） ---------- */
var TEMPLATE = [
  { id: 'q0001', type: 'judge', stem: '光在光纤中的传播速度低于光在真空中的传播速度', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: '√', part: '一、通用题', chapter: '第一章 判断题', category: '通信基础' },
  { id: 'q0002', type: 'single', stem: 'OSI 参考模型共分为（ ）层', options: [{ key: 'A', text: '七' }, { key: 'B', text: '五' }, { key: 'C', text: '四' }], answer: 'A', part: '一、通用题', chapter: '第二章 单选题', category: '通信基础' },
  { id: 'q0003', type: 'multi', stem: '下列协议中，属于应用层协议的有（ ）', options: [{ key: 'A', text: 'HTTP' }, { key: 'B', text: 'DNS' }, { key: 'C', text: 'SMTP' }, { key: 'D', text: 'ARP' }], answer: 'ABC', part: '一、通用题', chapter: '第三章 多选题', category: '通信基础' },
  { id: 'q0004', type: 'essay', stem: '请简述 TCP 建立连接采用三次握手的原因。', reference: '答案要点：\n(1) 确认双方收发能力均正常；\n(2) 同步初始序号，防止历史失效连接请求造成资源浪费；\n(3) 两次握手无法确认客户端的接收能力，四次握手无必要。', part: '一、通用题', chapter: '第四章 论述题', category: '通信基础' },
  { id: 'q0005', type: 'scenario', stem: '情景描述：某无人值守站点上报链路中断告警，现场检查发现光缆接头盒进水。请判断：直接更换接头盒并回填防水胶后复测光功率，这一处置是否恰当，并说明理由。', reference: '参考要点：\n(1) 处置方向正确，进水是接头盒损耗增大的常见原因；\n(2) 更换前应先断开两端设备、做好尾纤保护，避免二次损伤；\n(3) 复测应包含双向光功率与熔接点损耗，确认达标后再恢复业务。', part: '二、专业题【网络】', chapter: '第五章 情景判断题', category: null },
  { id: 'q0006', type: 'case', stem: '案例背景：某单位视频会议在高峰期频繁卡顿，但低峰期正常。问题：请分析最可能的原因并给出排查步骤。', reference: '参考要点：\n(1) 高峰期带宽被其他业务挤占，视频流缺乏 QoS 保障；\n(2) 查看交换机/路由器 CPU 占用，排除设备转发瓶颈；\n(3) 在链路层查丢包与重传，区分拥塞丢包与线路误码；\n(4) 为视频业务配置带宽保障与优先级队列后复测。', part: '二、专业题【网络】', chapter: '第六章 案例分析题', category: null },
  { id: 'q0007', type: 'operation', stem: '请描述使用频谱分析仪测量某信号占用带宽的完整操作步骤。', reference: '参考要点：\n(1) 连接被测信号，注意加衰减器保护输入端；\n(2) 设置中心频率、扫频宽度与参考电平，使信号完整落入屏幕；\n(3) 调整分辨率带宽，使频谱包络稳定；\n(4) 用标记功能读取占用带宽并记录。', part: '二、专业题【网络】', chapter: '第七章 实操模拟题', category: null },
  { id: 'q0008', type: 'blank', stem: '光在真空中的传播速度约为（ ）m/s，单模光纤的纤芯直径通常为（ ）μm。', blanks: ['3×10^8|3e8|3*10^8', '9|9.0'], part: '二、专业题【网络】', chapter: '第八章 填空题', category: null }
];
var TEMPLATE_TEXT = JSON.stringify(TEMPLATE, null, 2);

module.exports = {
  TYPES: TYPES, TYPE_CN: TYPE_CN, MAX_BLANKS: MAX_BLANKS,
  stripText: stripText, detect: detect, normalize: normalize, validate: validate,
  validateOne: validateOne, countBlanks: countBlanks,
  parseAnalysisMap: parseAnalysisMap, mergeAnalysis: mergeAnalysis,
  compact: compact, stat: stat, distText: distText,
  TEMPLATE: TEMPLATE, TEMPLATE_TEXT: TEMPLATE_TEXT
};
