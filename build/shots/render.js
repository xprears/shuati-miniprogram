/* WXML -> HTML 渲染 + 截图：真实 app.wxss / 页面 wxss，真实页面 data。
 * 用法：node build/shots/render.js [只截某个]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../miniprogram');
const DATA = path.join(__dirname, 'data');
const OUTDIR = path.resolve(__dirname, '../../docs/screenshots');
const W = 390;      // iPhone 14 逻辑宽
const H = 844;

/* ---------------- WXML 解析 ---------------- */
const VOID = new Set(['input', 'img', 'br']);
function parseAttrs(str) {
  const attrs = {};
  let i = 0;
  while (i < str.length) {
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;
    let name = '';
    while (i < str.length && !/[\s=]/.test(str[i])) name += str[i++];
    while (i < str.length && /\s/.test(str[i])) i++;
    if (str[i] === '=') {
      i++;
      while (i < str.length && /\s/.test(str[i])) i++;
      const q = str[i];
      if (q === '"' || q === "'") {
        i++;
        let v = '';
        while (i < str.length && str[i] !== q) v += str[i++];
        i++;
        attrs[name] = v;
      } else {
        let v = '';
        while (i < str.length && !/\s/.test(str[i])) v += str[i++];
        attrs[name] = v;
      }
    } else attrs[name] = true;
  }
  return attrs;
}
function tokenize(src) {
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  const root = [];
  const stack = [{ children: root }];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '<') {
      let j = i + 1, quote = null;
      while (j < src.length) {
        const c = src[j];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      const raw = src.slice(i + 1, j);
      if (raw[0] === '/') {
        stack.pop();
      } else {
        const selfClose = raw.trimEnd().endsWith('/');
        const body = selfClose ? raw.trimEnd().slice(0, -1) : raw;
        const m = body.match(/^([a-zA-Z0-9-]+)/);
        const tag = m[1];
        const node = { tag, attrs: parseAttrs(body.slice(m[1].length)), children: [] };
        stack[stack.length - 1].children.push(node);
        if (!selfClose && !VOID.has(tag)) stack.push(node);
      }
      i = j + 1;
    } else {
      let j = src.indexOf('<', i);
      if (j < 0) j = src.length;
      const text = src.slice(i, j);
      if (text.trim()) stack[stack.length - 1].children.push({ tag: '#text', text: text.trim() });
      i = j;
    }
  }
  return root;
}

/* ---------------- 表达式 ---------------- */
const HAS_MUSTACHE = /\{\{[\s\S]*?\}\}/;
function evalExpr(expr, scope) {
  try {
    return Function('s', 'with(s){ return (' + expr + '); }')(scope);
  } catch (e) { return ''; }
}
function interp(str, scope) {
  if (typeof str !== 'string') return str;
  /* 整串只有一个 {{...}} 时保留原始类型（数组/数字）。必须确认第一个 }} 就在末尾，
     否则「{{a}} · 用时{{b}}」会被当成一个表达式（曾把整行渲染成空）。 */
  if (/^\{\{/.test(str) && str.slice(-2) === '}}' && str.indexOf('}}') === str.length - 2) {
    return evalExpr(str.slice(2, -2), scope);
  }
  return str.replace(/\{\{([\s\S]*?)\}\}/g, (m, e) => {
    const v = evalExpr(e, scope);
    return v === null || v === undefined ? '' : String(v);
  });
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------- 渲染 ---------------- */
function renderChildren(nodes, scope) {
  let out = '';
  let chain = null;   // null=无 if 链；true=已命中；false=还没命中
  for (const node of nodes) {
    if (node.tag === '#text') { out += esc(interp(node.text, scope)); chain = null; continue; }
    const a = node.attrs;
    if ('wx:if' in a) {
      const v = !!interp(a['wx:if'], scope);
      chain = v;
      if (v) out += renderNode(node, scope);
      continue;
    }
    if ('wx:elif' in a) {
      if (chain === false) {
        const v = !!interp(a['wx:elif'], scope);
        chain = v;
        if (v) out += renderNode(node, scope);
      }
      continue;
    }
    if ('wx:else' in a) {
      if (chain === false) out += renderNode(node, scope);
      chain = null;
      continue;
    }
    chain = null;
    out += renderNode(node, scope);
  }
  return out;
}
function renderNode(node, scope) {
  const a = node.attrs;
  if ('wx:for' in a) {
    let list = interp(a['wx:for'], scope);
    if (typeof list === 'number') list = Array.from({ length: list }, (_, i) => i);
    if (!Array.isArray(list)) list = [];
    const itemName = a['wx:for-item'] || 'item';
    const idxName = a['wx:for-index'] || 'index';
    let out = '';
    list.forEach((it, i) => {
      const s = Object.create(scope);
      s[itemName] = it; s[idxName] = i;
      out += renderNode(Object.assign({}, node, { attrs: stripFor(a) }), s);
    });
    return out;
  }
  if (node.tag === 'block') return renderChildren(node.children, scope);

  const cls = a.class ? String(interp(a.class, scope)).replace(/\s+/g, ' ').trim() : '';
  const style = a.style ? String(interp(a.style, scope)) : '';
  const attr = (cls ? ` class="${esc(cls)}"` : '') + (style ? ` style="${esc(style)}"` : '');
  const inner = node.children && node.children.length ? renderChildren(node.children, scope) : '';

  switch (node.tag) {
    case 'view':
    case 'scroll-view':
    case 'block':
      return `<view${attr}>${inner}</view>`;
    case 'text':
      return `<text${attr}>${inner}</text>`;
    case 'button':
      return `<button${attr}>${inner}</button>`;
    case 'textarea': {
      const val = a.value ? String(interp(a.value, scope)) : '';
      const ph = a.placeholder ? String(interp(a.placeholder, scope)) : '';
      return `<view${attr} data-ph="${esc(ph)}">${esc(val.slice(0, 1200))}</view>`;
    }
    /* input 没有子节点，走 default 分支会被整块丢掉（选项文字全空）。
     * 单行输入框用 view + 值文本模拟；空值时由 data-ph 显示占位符。 */
    case 'input': {
      const val = a.value ? String(interp(a.value, scope)) : '';
      const ph = a.placeholder ? String(interp(a.placeholder, scope)) : '';
      return `<view${attr} data-ph="${esc(ph)}">${esc(val)}</view>`;
    }
    default:
      return inner ? `<view${attr}>${inner}</view>` : '';
  }
}
function stripFor(attrs) {
  const o = Object.assign({}, attrs);
  ['wx:for', 'wx:for-item', 'wx:for-index', 'wx:key'].forEach(k => delete o[k]);
  return o;
}

/* ---------------- 样式 ---------------- */
/* 只装「全局 + 当前页自己的 wxss」。原来固定拼 import.wxss，导致其它页的页面级样式
 * （edit.wxss 的 .opt-edit/.ipt）在截图里全部失效——选项行塌成一列字母就是这个原因。 */
function loadCss(pageRel) {
  let css = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8');
  css = css.replace(/(^|[\s,}])page(\s*[,{])/g, '$1:root$2');
  if (pageRel) {
    const own = path.join(ROOT, pageRel.replace(/\.js$/, '.wxss'));
    if (fs.existsSync(own)) css += '\n' + fs.readFileSync(own, 'utf8');
  }
  return css;
}
const BASE_CSS = `
html,body{margin:0!important;padding:0!important;background:#F4F6FA;width:390px;overflow-x:hidden;}
view,scroll-view,block{display:block;}
text{display:inline;}
button{display:flex;border:none;outline:none;}
.device{width:390px;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);}
.navbar{height:44px;background:#1B4F9C;color:#fff;display:flex;align-items:center;justify-content:center;position:relative;flex:0 0 auto;font-size:17px;font-weight:500;letter-spacing:.2px;}
.navbar .back{position:absolute;left:14px;top:50%;transform:translateY(-52%);font-size:24px;line-height:1;opacity:.92;font-family:-apple-system,"PingFang SC",sans-serif;}
.screen{flex:1 0 auto;box-sizing:border-box;width:100%;overflow-x:hidden;padding:14px 14px 18px;background:var(--bg);color:var(--text);font-size:15px;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;}
.tabbar{height:51px;background:#fff;display:flex;flex:0 0 auto;border-top:1px solid #EDF0F5;}
.tabbar .tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10px;color:#93A0B4;}
.tabbar .tab.on{color:#1B4F9C;}
.tabbar img{width:23px;height:23px;display:block;}
.ta{white-space:pre-wrap;word-break:break-all;overflow:hidden;color:#5A6679;}
.ta:empty:before{content:attr(data-ph);color:#A8B4C6;}
[data-ph]:empty:before{content:attr(data-ph);color:#A8B4C6;}
`;
const TABS = [
  { text: '首页', icon: 'tab-home', on: 'tab-home-on' },
  { text: '分类', icon: 'tab-bank', on: 'tab-bank-on' },
  { text: '未掌握', icon: 'tab-wrong', on: 'tab-wrong-on' },
  { text: '报告', icon: 'tab-report', on: 'tab-report-on' }
];
function iconB64(name) {
  const p = path.join(ROOT, 'assets', name + '.png');
  return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
}
function buildHtml(payload) {
  const tree = tokenize(fs.readFileSync(path.join(ROOT, payload.page.replace(/\.js$/, '.wxml')), 'utf8'));
  const scope = Object.assign(Object.create(null), payload.data);
  const body = renderChildren(tree, scope);
  const showBack = !!payload.noTab;   // 只有子页面（导入/练习/成绩）才有左上返回
  const nav = `<div class="navbar">${showBack ? '<span class="back">‹</span>' : ''}<span>${esc(payload.title)}</span></div>`;
  const tab = payload.noTab ? '' : `<div class="tabbar">${TABS.map((t, i) =>
    `<div class="tab ${payload.tab === i ? 'on' : ''}"><img src="${iconB64(payload.tab === i ? t.on : t.icon)}"><span>${t.text}</span></div>`
  ).join('')}</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${BASE_CSS}\n${loadCss(payload.page)}</style></head>
<body><div class="device">${nav}<div class="screen">${body}</div>${tab}</div></body></html>`;
}

/* ---------------- 截图 ---------------- */
/* --share：朋友圈九宫格用的统一画布（390×940 @2x = 780×1880），9 张宽高完全一致。
 * 长页面靠删掉次要卡片压进一屏（保留导航栏 / tabBar），不缩放、不裁半行字。 */
const SHARE = process.argv.includes('--share');
const SHARE_H = 940;
const SHARE_AVAIL = SHARE_H - 44 - 51;        // .screen 可用高
const SHARE_SKIP = ['00-home-empty', '08-report-top'];
const SHARE_TRIM = {
  /* 先删深层 hint（此时卡片顺序未变），最后删第一张「当前题库」卡 */
  '02-import': {
    drop: [
      '.screen > view.card:nth-child(3) .hint',
      '.screen > view.card:nth-child(2) .hint:last-of-type',
      '.screen > view.card:first-child'
    ]
  },
  '03-bank': { chapterRows: 3 },
  /* 设置页切到「自选章节」，章节行只留 3 个（7 个会把页面顶出屏） */
  '04-setup': { rows: { sel: '.scope-item', n: 3 }, drop: ['.screen > view.card:first-child .muted-2'] },
  '08-report': { cards: 3 },
  '09-result': { drop: ['.screen > view.card:nth-child(4) .muted-2:last-of-type'] }
};
const SHARE_CSS = `
.device{height:${SHARE_H}px;min-height:0;overflow:hidden;}
.screen{flex:1 1 auto;min-height:0;overflow:hidden;}
`;

(async () => {
  const args = process.argv.slice(2);
  const only = args.find(a => !a.startsWith('--'));
  const outdir = SHARE ? path.resolve(__dirname, '../../docs/screenshots/share') : OUTDIR;
  fs.mkdirSync(outdir, { recursive: true });
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json')).sort()
    .filter(f => !only || f.indexOf(only) >= 0);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: SHARE ? SHARE_H : H }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const report = [];
  for (const f of files) {
    const payload = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
    if (SHARE && SHARE_SKIP.indexOf(payload.name) >= 0) continue;
    let html = buildHtml(payload);
    if (SHARE) html = html.replace('</style>', SHARE_CSS + '</style>');
    fs.writeFileSync(path.join(DATA, payload.name + (SHARE ? '.share' : '') + '.html'), html);
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(120);

    /* 裁剪：cards = 只保留前 N 张卡；drop = 按选择器删除；chapterRows = 章节列表只留前 N 个 */
    const trim = SHARE ? SHARE_TRIM[payload.name] : null;
    const cards = (trim && trim.cards) || payload.cards;
    if (cards) {
      await page.evaluate(n => {
        const list = [...document.querySelectorAll('.screen > view.card')];
        list.slice(n).forEach(c => c.remove());
      }, cards);
    }
    if (trim && trim.drop) {
      await page.evaluate(sels => {
        sels.forEach(sel => [...document.querySelectorAll(sel)].forEach(e => e.remove()));
      }, trim.drop);
    }
    if (trim && trim.chapterRows) {
      await page.evaluate(n => {
        const rows = [...document.querySelectorAll('.chapter-row')];
        rows.slice(n).forEach(r => r.remove());
        [...document.querySelectorAll('.part-block')].forEach(b => { if (!b.querySelector('.chapter-row')) b.remove(); });
      }, trim.chapterRows);
    }
    if (trim && trim.rows) {
      await page.evaluate(({ sel, n }) => {
        [...document.querySelectorAll(sel)].slice(n).forEach(e => e.remove());
      }, trim.rows);
    }

    const dims = await page.evaluate(() => {
      const s = document.querySelector('.screen');
      return { content: s.scrollHeight, client: s.clientHeight };
    });
    const out = path.join(outdir, payload.name + '.png');
    await page.screenshot({ path: out, fullPage: !SHARE });
    const over = dims.content - dims.client;
    const flag = SHARE && over > 0 ? `  ⚠ 溢出 ${over}px（被裁）` : '';
    report.push(`${payload.name}  内容 ${dims.content}px / 可视 ${dims.client}px${flag}`);
  }
  await browser.close();
  console.log(report.join('\n'));
})();
