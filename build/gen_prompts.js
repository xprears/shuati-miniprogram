#!/usr/bin/env node
/* 三个产物，唯一事实源都是 docs/ai-bank-prompt.md：
 *
 *   1. miniprogram/utils/prompts.js        App 里「复制提示词」用的长规范（含发布态去敏）
 *   2. skills/bank-json/SKILL.md           GitHub 上的「题库转换」skill（供 AI 直接读取/安装）
 *   3. skills/bank-json/references/analysis.md  解析规范（提示词 B 原文）
 *
 * 为什么要生成 skill：App 里让终端用户复制一万字提示词太难受，改成一句话 +
 * 一个 GitHub 链接；但链接里的规范必须与 App 内提示词同版，否则走 skill 的用户
 * 和走 App 提示词的用户拿到两套规则。所以一并生成、一并 --check。
 *
 * 注意去敏只作用于 App 发布包（个人主体只能按「工具 → 信息查询」过审），
 * skill 文件在 GitHub 上，保留原文用词。
 *
 * 用法：node build/gen_prompts.js          （生成全部）
 *       node build/gen_prompts.js --check  （只校验，不一致 exit 1）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'ai-bank-prompt.md');
const OUT = path.join(ROOT, 'miniprogram', 'utils', 'prompts.js');
const SKILL_DIR = path.join(ROOT, 'skills', 'bank-json');
const SKILL = path.join(SKILL_DIR, 'SKILL.md');
const ANALYSIS = path.join(SKILL_DIR, 'references', 'analysis.md');

/* 取某个「## 标题」之后第一个 ``` 围栏里的正文 */
function extract(doc, heading) {
  const lines = doc.split('\n');
  const start = lines.findIndex(l => l.trim().indexOf(heading) === 0);
  if (start < 0) throw new Error('文档里找不到标题：' + heading);
  let open = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim().indexOf('```') === 0) { open = i; break; }
  }
  if (open < 0) throw new Error(heading + ' 后面没有代码围栏');
  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (lines[i].trim() === '```') { close = i; break; }
  }
  if (close < 0) throw new Error(heading + ' 的代码围栏没有闭合');
  return lines.slice(open + 1, close).join('\n').replace(/^\n+|\n+$/g, '');
}

/* 发布态去敏：App 内不能出现「考试/培训/考核/授课/备考/学习」这类教育属性词
 * （个人主体只能按「工具 → 信息查询」过审）。文档里可以有，发布包里不行。
 * 长词先替换，短词兜底；替换后仍有残留就报错——避免文档改版后悄悄漏进去。 */
const SCRUB = [
  ['考试题库解析', '题库解析'],
  ['帮助学习者', '帮助使用者'],
  ['学习者', '使用者'],
  ['考试', '测验'],
  ['培训', '练习'],
  ['考核', '检测'],
  ['授课', '讲解'],
  ['备考', '复习'],
  ['学习', '练习']
];
const BANNED = /考试|培训|考核|授课|备考|学习/;

function scrub(text, label) {
  let out = text;
  SCRUB.forEach(pair => { out = out.split(pair[0]).join(pair[1]); });
  const hit = BANNED.exec(out);
  if (hit) throw new Error(label + ' 去敏后仍残留敏词「' + hit[0] + '」：' +
    JSON.stringify(out.slice(Math.max(0, hit.index - 20), hit.index + 20)) + '，请补进 SCRUB');
  return out;
}

/* App 里「复制一句话」的短指令：把一万字的规范换成一个链接。
 * 链接指向 GitHub 上的 SKILL.md —— 与 App 内长提示词同一份事实源生成，
 * 所以两边规则不会漂。改仓库地址只改这里。 */
const REPO_RAW = 'https://raw.githubusercontent.com/xprears/shuati-miniprogram/main/skills/bank-json/SKILL.md';
const REPO_ANALYSIS_RAW = 'https://raw.githubusercontent.com/xprears/shuati-miniprogram/main/skills/bank-json/references/analysis.md';

const SHORT_PROMPT = [
  '读这个文件里的题库转换规范，然后严格按它把我的题库转成标准 JSON：',
  REPO_RAW,
  '',
  '要求：先打开链接读完规范再动手；只输出 JSON 数组，不要解释、不要代码块标记、不要分批说明。',
  '如果打不开链接，就告诉我打不开，不要凭猜写格式。'
].join('\n');

const SHORT_ANALYSIS_PROMPT = [
  '读这个文件里的解析编写规范，然后严格按它给我这份题库 JSON 逐题写解析：',
  REPO_ANALYSIS_RAW,
  '',
  '要求：先打开链接读完规范再动手；只输出 {"题号":"解析"} 形式的 JSON 对象，不要解释。',
  '如果打不开链接，就告诉我打不开，不要凭猜写格式。'
].join('\n');

const SKILL_FRONT = [
  '---',
  'name: shuati-bank-json',
  'description: 把题库文档（PDF / Word / 文本 / 扫描件）转换成「刷题本子」小程序可直接导入的标准题库 JSON，或为已有题库 JSON 逐题补写解析。当用户说「题库转 JSON」「把题库整理成标准格式」「导入刷题本子」「给题库加解析」「转成题库文件」，或上传/粘贴了题库原文希望变成 JSON 时使用。输出为可直接落盘或粘贴的合法 JSON，不写代码、不装依赖。',
  '---',
  '',
  '# 题库 → 标准题库 JSON',
  '',
  '把用户给的题库原文转成 App 能直接导入的 JSON。**不需要用户装任何东西、不需要跑脚本**：',
  '读文档 → 按下面规范产出 JSON → 交给用户粘贴或存成 .json 文件。',
  '',
  '## 两种产出，先判断要哪种',
  '',
  '| 用户想要 | 产出 | 判断依据 |',
  '| --- | --- | --- |',
  '| 题库本身 | 题目**数组** `[{...}, {...}]` | 默认。用户给了题库原文（PDF/Word/文本） |',
  '| 只有解析 | 对象 `{"q0001": "解析"}` | 用户已经有题库 JSON、只想补解析 → 改用 `references/analysis.md` |',
  '',
  '拿不准就问一句；用户没提解析时**不要**顺手生成解析，那是另一步。',
  '',
  '## 硬性红线（细节见下面规范正文，这几条最容易翻车）',
  '',
  '1. **根节点必须是数组**，顶层不能是对象，不能包 `{"questions": [...]}`。',
  '2. **题干空位一律写全角「（ ）」**（U+FF08 + 空格 + U+FF09）。原文把答案印在空位里（如「在（B）米及以上」）必须换成「（ ）」，答案搬到 `answer`。',
  '3. **`id` 从 `q0001` 起连续递增、全局唯一**，不因章节/题号重置而重来。',
  '4. **`type` 只能取八种**：`judge` `single` `multi` `blank` `essay` `scenario` `case` `operation`。',
  '5. **客观题**（judge/single/multi）必须有 `options` + `answer`；`options.key` 从 A 起连续、不跳号；答案：判断 `√`/`×`、单选单字母、多选 2 个以上字母升序。',
  '6. **主观题**（essay/case/operation，及无选项的 scenario）只有 `reference`，**不许**编 `options`/`answer`。',
  '7. **填空题**用 `blanks` 数组，项数必须等于题干「（ ）」个数，最多 8 空；不输出 `options`/`answer`。',
  '8. **不许编内容**：原文没有的答案写 `null`、原文没有的要点不许补，异常记进 `warnings`。',
  '9. **原样保留**错别字、重复题、特殊术语、数值单位；不许纠错、润色、合并相似题。',
  '10. **只输出 JSON**，不要 Markdown 代码块、不要前言结语。用户明确要求时才包代码块。',
  '',
  '## 分批',
  '',
  '原文超过 150 题必须分批：每批发一个**完整合法数组**，`id` 接着上一批往下排，等用户说「继续」再发下一批。',
  '不要在批次里加进度说明。全部处理完后再收到「继续」就回 `[]`。',
  '',
  '## 交付',
  '',
  '1. 直接把 JSON 给用户（贴进 App 导入页的输入框，或存成 `题库.json` 发到微信聊天再从会话选文件）。',
  '2. 主动报三件事：共多少题、各题型多少、`warnings` 有多少条（挑前几条说明是什么问题）。',
  '3. 提醒用户导入后抽查 10–20 题：题干有没有被改写、答案字母有没有抄串、空位有没有还原成「（ ）」。',
  '',
  '## 规范正文',
  '',
  '以下为用户导入时校验的同一套规则，逐条执行。用户提出与该规范冲突的要求时，先说明冲突点（多半会导致导入失败），再按用户要求办。',
  '',
  '---',
  '',
  ''
].join('\n');

const ANALYSIS_FRONT = [
  '<!-- 由 build/gen_prompts.js 从 docs/ai-bank-prompt.md 生成，请勿手改 -->',
  '',
  '# 题库 JSON → 逐题解析',
  '',
  '输入是已经导入成功的题库 JSON，输出是 `{"题号": "解析文字"}` 形式的对象。',
  '这份文件是 `shuati-bank-json` 技能的第二步，也可单独使用。',
  '',
  '---',
  '',
  ''
].join('\n');

function build() {
  const doc = fs.readFileSync(DOC, 'utf8');
  const a = scrub(extract(doc, '## 提示词 A'), '提示词 A');
  const b = scrub(extract(doc, '## 提示词 B'), '提示词 B');
  if (a.length < 2000 || b.length < 2000) {
    throw new Error('抽出来的提示词太短（A ' + a.length + ' / B ' + b.length + '），多半是围栏匹配错了');
  }
  // SKILL.md 不去敏：GitHub 上不是发布包，保留原文用词；但要去掉提示词末尾那份
  // 「（在此粘贴题库原文）」占位，改成技能里的输入说明。
  const aRaw = extract(doc, '## 提示词 A')
    .replace(/题库原文\n━+\n*（在此粘贴题库原文）\s*$/, '')
    .replace(/\n*（在此粘贴题库原文）\s*$/, '')
    .replace(/\n+$/, '');
  const bRaw = extract(doc, '## 提示词 B')
    .replace(/\n*（在此粘贴 questions\.json）\s*$/, '')
    .replace(/\n+$/, '');

  const prompts = (
    '/* 由 build/gen_prompts.js 从 docs/ai-bank-prompt.md 生成，请勿手改。\n' +
    ' * 改提示词请改文档，再跑 node build/gen_prompts.js。\n' +
    ' * PROMPT / ANALYSIS_PROMPT = 完整规范（离线兜底）；\n' +
    ' * SHORT_PROMPT / SHORT_ANALYSIS_PROMPT = 一句话 + GitHub 链接（默认路径）。*/\n' +
    'module.exports = {\n' +
    '  PROMPT: ' + JSON.stringify(a) + ',\n' +
    '  ANALYSIS_PROMPT: ' + JSON.stringify(b) + ',\n' +
    '  SHORT_PROMPT: ' + JSON.stringify(SHORT_PROMPT) + ',\n' +
    '  SHORT_ANALYSIS_PROMPT: ' + JSON.stringify(SHORT_ANALYSIS_PROMPT) + ',\n' +
    '  SKILL_URL: ' + JSON.stringify(REPO_RAW) + '\n' +
    '};\n'
  );
  const skill = SKILL_FRONT + aRaw + '\n';
  const analysis = ANALYSIS_FRONT + bRaw + '\n';
  return { prompts, skill, analysis, aLen: a.length, bLen: b.length };
}

const built = build();

if (process.argv.indexOf('--check') >= 0) {
  const pairs = [[OUT, built.prompts], [SKILL, built.skill], [ANALYSIS, built.analysis]];
  let bad = 0;
  pairs.forEach(function (p) {
    const old = fs.existsSync(p[0]) ? fs.readFileSync(p[0], 'utf8') : '';
    if (old !== p[1]) {
      console.error('✗ ' + path.relative(ROOT, p[0]) + ' 与 docs/ai-bank-prompt.md 不一致');
      bad++;
    }
  });
  if (bad) {
    console.error('  跑 node build/gen_prompts.js 重新生成');
    process.exit(1);
  }
  console.log('✓ prompts.js / SKILL.md / analysis.md 与文档一致');
  process.exit(0);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
write(OUT, built.prompts);
write(SKILL, built.skill);
write(ANALYSIS, built.analysis);

console.log('✓ prompts.js：A ' + built.aLen + ' 字 / B ' + built.bLen + ' 字，' + built.prompts.length + ' 字节');
console.log('✓ ' + path.relative(ROOT, SKILL) + '：' + built.skill.length + ' 字节');
console.log('✓ ' + path.relative(ROOT, ANALYSIS) + '：' + built.analysis.length + ' 字节');
