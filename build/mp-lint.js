/* 小程序项目静态校验：
 * 1. 所有 js 语法检查（含分包，排除 node_modules）
 * 2. app.json 声明的页面文件齐全（主包 + 分包）
 * 3. WXML 只使用小程序合法标签，且 bindtap 事件在 js 中有对应方法
 * 4. js 中调用的 wx API 合法
 * 5. JSON 文件合法性（排除 node_modules）
 * 6. 主包 / 分包大小（主包 2MB，单个分包 2MB）
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
const WX_APIS = new Set(['getStorageSync', 'setStorageSync', 'removeStorageSync', 'showToast', 'showModal', 'navigateTo', 'navigateBack', 'redirectTo', 'switchTab', 'setNavigationBarTitle', 'pageScrollTo', 'setClipboardData', 'stopPullDownRefresh', 'clearInterval', 'setInterval']);
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

console.log('\n静态校验: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
