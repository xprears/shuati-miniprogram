/* 小程序项目静态校验：
 * 1. 所有 js 语法检查（含分包，排除 node_modules）
 * 2. app.json 声明的页面文件齐全（主包 + 分包）
 * 3. WXML 只使用小程序合法标签，且 bindtap 事件在 js 中有对应方法
 * 4. js 中调用的 wx API 合法
 * 5. JSON 文件合法性（排除 node_modules）
 * 6. 主包 / 分包大小（主包 2MB，单个分包 2MB）
 * 7. --release：空壳发布检查（发布物不得含内置题库 utils/qbank.js，且 require 依赖可达）
 * 9. 版本号一致性：utils/version.js 的 BASE_VERSION 与 miniprogram/package.json 同版
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const NODE = process.execPath;

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const SUBPACKAGES = appJson.subPackages || appJson.subpackages || [];
const SUB_ROOTS = SUBPACKAGES.map(s => s.root);
/* node_modules 不参与打包（微信只认 miniprogram_npm），因此全部检查都跳过它 */
const ALWAYS_SKIP = new Set(['node_modules']);

/* 主包页面 + 分包页面（分包页面路径为 root/page） */
const ALL_PAGES = appJson.pages.slice();
SUBPACKAGES.forEach(sp => sp.pages.forEach(pg => ALL_PAGES.push(sp.root + '/' + pg)));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
}

function collect(dir, exts, excludeSub, out) {
  out = out || [];
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (ALWAYS_SKIP.has(f)) return;
      if (excludeSub && SUB_ROOTS.indexOf(path.relative(ROOT, p)) >= 0) return;
      collect(p, exts, excludeSub, out);
    } else if (exts.some(e => f.endsWith(e))) {
      out.push(p);
    }
  });
  return out;
}

function sizeOf(dir, excludeSub) {
  let n = 0;
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (ALWAYS_SKIP.has(f)) return;
      if (excludeSub && SUB_ROOTS.indexOf(path.relative(ROOT, p)) >= 0) return;
      n += sizeOf(p, excludeSub);
    } else n += fs.statSync(p).size;
  });
  return n;
}

/* 1. JS 语法 */
console.log('== 1. JS 语法检查 ==');
const jsFiles = collect(ROOT, ['.js'], false);
jsFiles.forEach(f => {
  try {
    execSync(NODE + ' --check "' + f + '"', { stdio: 'pipe' });
    ok(true, path.relative(ROOT, f));
  } catch (e) {
    ok(false, path.relative(ROOT, f), e.stderr.toString().split('\n')[0]);
  }
});

/* 2. 页面文件齐全 */
console.log('== 2. 页面文件齐全性 ==');
ALL_PAGES.forEach(pg => {
  const okAll = ['js', 'json', 'wxml', 'wxss'].every(ext =>
    fs.existsSync(path.join(ROOT, pg + '.' + ext)) || ext === 'wxss');
  ok(okAll, pg);
});
appJson.tabBar.list.forEach(item => {
  ['iconPath', 'selectedIconPath'].forEach(k => {
    ok(fs.existsSync(path.join(ROOT, item[k])), item[k]);
  });
});

/* 3. WXML 标签与事件 */
console.log('== 3. WXML 标签与事件绑定 ==');
const LEGAL_TAGS = new Set(['view', 'text', 'button', 'scroll-view', 'block', 'image', 'navigator', 'icon', 'progress', 'form', 'input', 'textarea', 'swiper', 'swiper-item', 'movable-view', 'cover-view', 'rich-text', 'canvas', 'slot', 'import', 'include', 'wxs', 'audio', 'video']);
let tagErr = 0, evtErr = 0;
ALL_PAGES.forEach(pg => {
  const wxmlPath = path.join(ROOT, pg + '.wxml');
  if (!fs.existsSync(wxmlPath)) return;
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const jsSrc = fs.readFileSync(path.join(ROOT, pg + '.js'), 'utf8');
  const tags = wxml.match(/<([a-zA-Z][\w-]*)(\s|>|\/)/g) || [];
  tags.forEach(t => {
    const tag = t.replace(/[<\s/>]/g, '');
    if (!LEGAL_TAGS.has(tag)) { tagErr++; console.log('    非法标签 <' + tag + '> @ ' + pg); }
  });
  const evts = wxml.match(/bind(?:tap|change|input|confirm|longpress)?="(\w+)"/g) || [];
  evts.forEach(e => {
    const m = e.match(/"(\w+)"/);
    if (m && jsSrc.indexOf(m[1]) < 0) { evtErr++; console.log('    缺少事件方法 ' + m[1] + ' @ ' + pg); }
  });
  const catchs = wxml.match(/catchtap="(\w+)"/g) || [];
  catchs.forEach(e => {
    const m = e.match(/"(\w+)"/);
    if (m && jsSrc.indexOf(m[1]) < 0) { evtErr++; console.log('    缺少 catchtap 方法 ' + m[1] + ' @ ' + pg); }
  });
});
ok(tagErr === 0, 'WXML 标签全部合法', tagErr + ' 个非法');
ok(evtErr === 0, 'WXML 事件方法全部已定义', evtErr + ' 个缺失');

/* 4. wx API 白名单 */
console.log('== 4. wx API 调用检查 ==');
const WX_APIS = new Set(['getStorageSync', 'setStorageSync', 'removeStorageSync', 'showToast', 'showModal', 'navigateTo', 'navigateBack', 'redirectTo', 'switchTab', 'setNavigationBarTitle', 'pageScrollTo', 'setClipboardData', 'getClipboardData', 'stopPullDownRefresh', 'clearInterval', 'setInterval', 'chooseMessageFile', 'getFileSystemManager', 'showLoading', 'hideLoading', 'env', 'getAccountInfoSync', 'enableAlertBeforeUnload', 'disableAlertBeforeUnload']);
/* 第三方 SDK（vendor/ 下）内部直接调用 wx.request 等底层 API，属供应商实现，跳过 */
let apiErr = 0;
collect(ROOT, ['.js'], false).filter(f => f.indexOf(path.sep + 'vendor' + path.sep) < 0).forEach(f => {
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const calls = src.match(/wx\.(\w+)/g) || [];
  calls.forEach(c => {
    const api = c.slice(3);
    if (!WX_APIS.has(api)) { apiErr++; console.log('    未知 API wx.' + api + ' @ ' + path.relative(ROOT, f)); }
  });
});
ok(apiErr === 0, 'wx API 调用均在白名单内', apiErr + ' 个未知');

/* 5. JSON 合法性 */
console.log('== 5. JSON 文件合法性 ==');
collect(ROOT, ['.json'], false).forEach(f => {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(true, path.relative(ROOT, f));
  } catch (e) {
    ok(false, path.relative(ROOT, f), e.message);
  }
});

/* 6. 包体积 */
console.log('== 6. 包体积（主包 / 单分包均限 2MB） ==');
const MB = 1024 * 1024;
const mainSize = sizeOf(ROOT, true);
ok(mainSize < 2 * MB, '主包 ' + (mainSize / MB).toFixed(2) + ' MB < 2MB');
SUBPACKAGES.forEach(sp => {
  const s = sizeOf(path.join(ROOT, sp.root), false);
  ok(s < 2 * MB, '分包 ' + sp.root + ' ' + (s / MB).toFixed(2) + ' MB < 2MB');
});

/* 7. --release：空壳发布检查（题库改为用户运行期导入，发布物不得内置题库）
 * 开发副本保留 utils/qbank.js 供 Node 测试（bank-store.js 的 Node 回退由测试脚本
 * 经 __setNodeBank 注入，包内代码不 require 它）；发布时按 project.config.json 的
 * packOptions.ignore 排除该文件。两种情况都不算违规：物理删除，或已在 packOptions.ignore 中。
 * 另查 require 依赖可达：发布包里所有字面量 require 的目标必须存在且未被 ignore 排除
 * ——打包器静态解析字面量 require，目标不在发布包内即校验失败（qbank.js 踩过一次：
 * bank-store 曾直接 require 它，ignore 后发布报 "Couldn't resolve the Js file"）。 */
if (process.argv.indexOf('--release') >= 0) {
  console.log('== 7. 空壳发布检查 ==');
  const qbRel = 'utils/qbank.js';
  let ignored = false, packIgnore = [];
  try {
    const pc = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf8'));
    const ign = ((pc.packOptions && pc.packOptions.ignore) || [])
      .map(r => String((r || {}).value || '').replace(/\\/g, '/'));
    ignored = ign.indexOf(qbRel) >= 0;
    packIgnore = ign;
  } catch (e) { /* 配置读不到则按「未排除」处理，走物理删除口径 */ }
  ok(!fs.existsSync(path.join(ROOT, 'utils', 'qbank.js')) || ignored,
    '发布物不含内置题库（qbank.js 已删除，或已被 packOptions.ignore 排除）');

  /* 7b. require 依赖可达：字面量 require 的目标必须在发布包内（存在且未被 ignore）。
   * 非字面量 require（变量 / 拼接路径）无法静态追踪，不在检查范围。 */
  const REQ_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
  let reqErr = 0;
  collect(ROOT, ['.js'], false).forEach(f => {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    let m;
    while ((m = REQ_RE.exec(src)) !== null) {
      if (m[2].charAt(0) !== '.') continue;   // 只查相对路径；裸模块名走 node_modules / miniprogram_npm
      const rel = path.relative(ROOT, path.resolve(path.dirname(f), m[2])).replace(/\\/g, '/');
      if (packIgnore.indexOf(rel) >= 0) {
        reqErr++; console.log('    require 目标被发布包排除: ' + m[2] + ' @ ' + path.relative(ROOT, f));
      } else if (!fs.existsSync(path.join(ROOT, rel))) {
        reqErr++; console.log('    require 目标不存在: ' + m[2] + ' @ ' + path.relative(ROOT, f));
      }
    }
  });
  ok(reqErr === 0, 'require 依赖可达（目标存在且未被发布包排除）', reqErr + ' 处断裂');
}

/* 8. 提示词与文档同版：miniprogram/utils/prompts.js 由 build/gen_prompts.js 从
 * docs/ai-bank-prompt.md 生成。文档换版后忘了重跑生成 ⇒ App 里发出去的还是旧提示词
 * （2026-10-18 换版就漏了这一次，用户 10-30 才发现）。docs/ 不存在时跳过。 */
const DOC_ABS = path.join(__dirname, '..', 'docs', 'ai-bank-prompt.md');
if (fs.existsSync(DOC_ABS)) {
  console.log('== 8. 提示词同版检查 ==');
  let syncErr = '';
  try {
    execSync(NODE + ' "' + path.join(__dirname, 'gen_prompts.js') + '" --check', { stdio: 'pipe' });
  } catch (e) {
    syncErr = String((e.stdout || '') + (e.stderr || '')).trim() || '生成脚本执行失败';
  }
  ok(!syncErr, '提示词与文档同版（不一致请跑 node build/gen_prompts.js）', syncErr);
}

/* 9. 版本号单一来源：utils/version.js 的 BASE_VERSION 必须与 miniprogram/package.json
 * 的 version 一致。反馈模板里的版本号由 version.js 输出（正式版取 wx.getAccountInfoSync
 * 的真实版本，非正式版退回 BASE_VERSION）—— 两处常量漂移过一次（模板写着 1.0.0
 * 而实际已发布新版本），所以这里卡死。 */
console.log('== 9. 版本号一致性 ==');
try {
  const pkgVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const vsrc = fs.readFileSync(path.join(ROOT, 'utils', 'version.js'), 'utf8');
  const m = vsrc.match(/BASE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  ok(!!m, 'utils/version.js 可解析出 BASE_VERSION', '未找到 BASE_VERSION 常量');
  if (m) {
    ok(m[1] === pkgVer, '版本号一致（version.js ' + m[1] + ' / package.json ' + pkgVer + '）',
      '不一致：version.js=' + m[1] + '，package.json=' + pkgVer);
  }
} catch (e) {
  ok(false, '版本号一致性检查', e.message);
}

/* 10. 单题修改链路：两个不可回退的约定，只能靠静态检查钉住
 *   ① patchQuestion 必须沿用旧指纹 —— 指纹含「题干长度 + 选项数」，改题干或增删选项
 *      就会变，store.reconcileBank 随即判成换题库并清掉练习记录。
 *   ② 保存后必须调 invalidateMarks —— 答案若被改正，该题旧的已掌握/未掌握判定已失效。 */
console.log('== 10. 单题修改链路 ==');
try {
  const bsSrc = fs.readFileSync(path.join(ROOT, 'utils', 'bank-store.js'), 'utf8');
  ok(/function patchQuestion[\s\S]{0,1600}keepFp:\s*true/.test(bsSrc),
    'patchQuestion 用 keepFp 保存（否则单题修改会被判成换题库）');
  const edSrc = fs.readFileSync(path.join(ROOT, 'pages', 'edit', 'edit.js'), 'utf8');
  ok(/patchQuestion\([\s\S]{0,500}invalidateMarks/.test(edSrc),
    '编辑页保存后清理该题的旧判定（invalidateMarks）');
} catch (e) {
  ok(false, '单题修改链路检查', e.message);
}

/* 11. 题型一致性：题型清单散落在两个双端模块里，加新题型最容易只改一边
 *   —— logic.TYPE_ORDER 决定设置页 chip 与默认勾选，bank-validate.TYPES 决定导入校验。
 *   两边不一致时，新题型要么导不进来，要么导进来但练习时选不到。
 *   空位正则也必须同源：一边改了另一半不改，会出现「校验通过但 App 认不出空位」。 */
console.log('== 11. 题型一致性 ==');
try {
  const L = require(path.join(ROOT, 'utils', 'logic.js'));
  const BV = require(path.join(ROOT, 'utils', 'bank-validate.js'));
  ok(JSON.stringify(L.TYPE_ORDER) === JSON.stringify(BV.TYPES),
    '题型清单与顺序一致（logic.TYPE_ORDER / bank-validate.TYPES）',
    L.TYPE_ORDER.join(',') + ' vs ' + BV.TYPES.join(','));
  const noLabel = BV.TYPES.filter(t => !L.TYPE_LABEL[t] || !BV.TYPE_CN[t]);
  ok(noLabel.length === 0, '每种题型都有中文标签', noLabel.join(','));
  /* 同一个题型在 App 里必须只有一个名字：练习页/报告页用 logic.TYPE_LABEL，
     导入页统计用 bank-validate.TYPE_CN，两处曾长期不一致（情景题 vs 情景判断题） */
  const labelMismatch = BV.TYPES.filter(t => L.TYPE_LABEL[t] !== BV.TYPE_CN[t]);
  ok(labelMismatch.length === 0, '题型中文名两端一致（logic.TYPE_LABEL / bank-validate.TYPE_CN）',
    labelMismatch.map(t => t + '：' + L.TYPE_LABEL[t] + ' vs ' + BV.TYPE_CN[t]).join(' '));
  /* build_bank.py 是文档里写给用户的另一条构建链，它带一份独立的 TYPE_CN，同样不能漂 */
  try {
    const pySrc = fs.readFileSync(path.join(__dirname, 'build_bank.py'), 'utf8');
    const region = (pySrc.match(/TYPE_CN\s*=\s*\{([\s\S]*?)\}/) || [])[1] || '';
    const pyMap = {};
    region.replace(/'(\w+)':\s*'([^']+)'/g, (m, k, v) => { pyMap[k] = v; return m; });
    const pyBad = BV.TYPES.filter(t => pyMap[t] !== L.TYPE_LABEL[t]);
    ok(Object.keys(pyMap).length >= BV.TYPES.length && pyBad.length === 0,
      'build_bank.py 的 TYPE_CN 与 App 一致', pyBad.map(t => t + '：' + (pyMap[t] || '缺')).join(' '));
  } catch (e) {
    ok(false, 'build_bank.py 题型名校验', e.message);
  }
  const grab = f => {
    const m = fs.readFileSync(path.join(ROOT, 'utils', f), 'utf8').match(/BLANK_RE = (\/[^\n]*?\/g);/);
    return m ? m[1] : '';
  };
  const lre = grab('logic.js'), bre = grab('bank-validate.js');
  ok(!!lre && lre === bre, '空位正则两端一致（logic.js / bank-validate.js）', lre + ' vs ' + bre);
} catch (e) {
  ok(false, '题型一致性检查', e.message);
}

console.log('\n静态校验: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
