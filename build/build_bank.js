#!/usr/bin/env node
/**
 * 题库构建：questions.json（+ 解析）→ miniprogram/utils/qbank.js
 *
 * 零依赖，只需要 Node（WorkBuddy 自带）。等价于 build/build_bank.py。
 *
 * 用法：
 *   node build/build_bank.js                  # 用 build/questions.json 构建
 *   node build/build_bank.js --sample         # 用内置示例题库构建（先看效果）
 *   node build/build_bank.js -i 我的题库.json  # 指定题库文件
 *   node build/build_bank.js --no-analysis    # 不注入解析
 *   node build/build_bank.js --out-mp <路径>   # 自定义输出路径
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const ROOT = path.dirname(BASE);
const SAMPLE_DIR = path.join(BASE, 'sample');
const MP = path.join(ROOT, 'miniprogram', 'utils', 'qbank.js');
/* 校验/压缩规则与小程序运行期导入共用同一实现（勿在此复制一份） */
const BV = require(path.join(ROOT, 'miniprogram', 'utils', 'bank-validate.js'));
const TYPES = BV.TYPES;
const TYPE_CN = BV.TYPE_CN;

function rel(p) {
  const r = path.relative(ROOT, p);
  return r.startsWith('..') ? p : r;
}

function printHelp() {
  console.log([
    '题库构建：questions.json -> miniprogram/utils/qbank.js',
    '',
    '用法：',
    '  node build/build_bank.js                  用 build/questions.json',
    '  node build/build_bank.js --sample         用内置示例题库',
    '  node build/build_bank.js -i 题库.json      指定题库文件',
    '  node build/build_bank.js --no-analysis    不注入解析',
    '  node build/build_bank.js --out-mp <路径>   自定义输出路径'
  ].join('\n'));
}

/* ---------- 参数 ---------- */
const args = { sample: false, noAnalysis: false, input: null, out: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--sample') args.sample = true;
  else if (a === '--no-analysis') args.noAnalysis = true;
  else if (a === '-i' || a === '--input') args.input = argv[++i];
  else if (a === '--out-mp') args.out = argv[++i];
  else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
  else { console.error('未知参数：' + a + '\n'); printHelp(); process.exit(1); }
}

/* ---------- 解析（id -> 解析文本） ---------- */
function loadAnalyses(dir, isSample) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).sort().forEach(function (f) {
    if (!f.endsWith('.json')) return;
    if (!isSample && !/^ch\d+_analysis\.json$/.test(f)) return;
    const full = path.join(dir, f);
    try {
      const d = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        Object.keys(d).forEach(function (k) { if (typeof d[k] === 'string') out[k] = d[k]; });
      } else {
        console.log('  ! 跳过非映射结构的文件 ' + rel(full) + '（应为 {"题号": "解析"}）');
      }
    } catch (e) {
      console.log('  ! 跳过无法解析的文件 ' + rel(full) + '：' + e.message);
    }
  });
  return out;
}

/* ---------- 导出 ---------- */
function exportBank(qs, outPath) {
  const payload = JSON.stringify(BV.compact(qs));
  const head = '// 题库数据：' + qs.length + ' 题（由 build/build_bank.js 生成，勿手改）\n' +
    '// 字段: i=id t=类型 s=题干 p=大部 c=章节 g=分类 o=选项 a=答案 r=参考答案 x=解析\n';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, head + 'module.exports = ' + payload + ';', 'utf8');
  return payload;
}

/* ---------- 主流程 ---------- */
function main() {
  let isSample = args.sample;
  let bankPath;

  if (args.input) {
    bankPath = path.resolve(args.input);
  } else if (isSample) {
    bankPath = path.join(SAMPLE_DIR, 'questions.sample.json');
  } else {
    bankPath = path.join(BASE, 'questions.json');
    if (!fs.existsSync(bankPath)) {
      isSample = true;
      bankPath = path.join(SAMPLE_DIR, 'questions.sample.json');
      console.log('未找到 build/questions.json，已自动改用内置示例题库。');
      console.log('（放好你自己的题库后重跑本脚本即可。）\n');
    }
  }

  if (!fs.existsSync(bankPath)) {
    console.log('题库文件不存在：' + bankPath);
    return 1;
  }

  let qs;
  try {
    qs = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  } catch (e) {
    console.log('题库 JSON 解析失败：' + e.message);
    console.log('（常见原因：多了尾逗号、用了单引号、或不是合法 JSON）');
    return 1;
  }
  if (!Array.isArray(qs)) {
    console.log('题库根节点必须是数组（[{题目对象}, ...]）');
    return 1;
  }
  console.log('题库：' + rel(bankPath) + '（' + qs.length + ' 题）');

  const v = BV.validate(qs);
  if (v.errs.length) {
    console.log('\n发现 ' + v.errs.length + ' 处格式错误（构建继续，但 App 里可能出现异常）：');
    v.errs.slice(0, 20).forEach(function (e) { console.log('  ✗ ' + e); });
    if (v.errs.length > 20) console.log('  ... 另有 ' + (v.errs.length - 20) + ' 处');
  }
  v.warns.slice(0, 10).forEach(function (w) { console.log('  ! ' + w); });

  if (args.noAnalysis) {
    console.log('\n解析：已按参数跳过');
  } else {
    const expDir = isSample ? path.join(SAMPLE_DIR, 'explanations') : path.join(BASE, 'explanations');
    const an = loadAnalyses(expDir, isSample);
    qs.forEach(function (q) {
      if (an[q.id]) q.analysis = an[q.id];
    });
    const miss = qs.filter(function (q) { return !String(q.analysis || '').trim(); })
      .map(function (q) { return q.id; });
    console.log('\n解析：来源 ' + rel(expDir) + '，命中 ' + (qs.length - miss.length) + '/' + qs.length + ' 题');
    if (miss.length) {
      console.log('  未覆盖 ' + miss.length + ' 题（App 中该题不显示解析）：' +
        miss.slice(0, 8).join(', ') + (miss.length > 8 ? ' ...' : ''));
    }
  }

  const outPath = args.out ? path.resolve(args.out) : MP;
  exportBank(qs, outPath);

  const stat = {};
  qs.forEach(function (q) { stat[q.type] = (stat[q.type] || 0) + 1; });
  const parts = Object.keys(stat).sort(function (a, b) { return stat[b] - stat[a]; })
    .map(function (k) { return (TYPE_CN[k] || k) + ' ' + stat[k]; });
  console.log('\n题型分布：' + parts.join('，'));
  console.log('产物：');
  console.log('  ' + rel(outPath) + '  ' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');
  console.log('\n小程序主包上限 2MB：解析全量注入后若逼近上限，可把题库挪进分包。');
  return v.errs.length ? 2 : 0;
}

process.exit(main());
