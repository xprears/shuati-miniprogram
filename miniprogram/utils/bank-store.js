/* 题库存储层：wx.storage 分片（单 key 上限 1MB、总量 10MB，硬限）
 *
 * key 布局（2026-11 起为多题库预留，本期恒为 1 个库）：
 *   wb.banks.index      = { v:1, active:'main', list:[{id,name,count,size,chunks,at,fp}] }
 *   wb.bank.0 … N       主库（id='main'）分片，**沿用单库时代的前缀** ⇒ 老用户升级零重写
 *   wb.bank.<id>.0 … N  其他库分片（第二期开放多库时才出现）
 *
 * 为什么先埋布局：多题库要动 key 结构，晚改一次就多迁一次数据。现在改成「索引 + 按库前缀」
 * 但界面只认 1 个库，后续开放多库不需要再迁存档。
 *
 * 小程序运行时只走 storage；Node（测试/脚本）没有 wx 时读 __setNodeBank 注入的内置题库
 * （由测试脚本注入开发副本的 utils/qbank.js，bank-store 自身不 require 它——发布包用
 * packOptions.ignore 排除 qbank.js，包内任何指向它的字面量 require 都会让发布校验失败）。
 * 真机运行时不兜底：发布物无 qbank.js，空库即空态。
 */
'use strict';

var INDEX_KEY = 'wb.banks.index';
var LEGACY_META_KEY = 'wb.bank.meta';   // 单库时代元信息，迁移后删除
var BASE_PREFIX = 'wb.bank.';           // 主库分片前缀（兼容旧存档）
var CHUNK_BYTES = 700 * 1024;           // 单 key 1MB 硬限内留足余量
var MAX_BYTES = 9 * 1024 * 1024;        // 总量 10MB 内留 1MB 给状态存档
var MAX_NAME = 20;                      // 题库名上限（UI 一行放得下）

/* UTF-8 字节数：手写实现，不依赖 Buffer / TextEncoder / unescape 等运行时能力 */
function utf8Len(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; } // 代理对 = 4 字节
    else n += 3;
  }
  return n;
}

/* 题库指纹：题数 + 每题特征（id / 题型 / 题干长度 / 选项数）的滚动哈希。
 * O(n) 且不遍历题干全文。用途是判定「练习记录属于哪个题库」——两个题库的 id
 * 都从 q0001 起编号，复用必然发生，指纹是唯一可靠的区分依据。
 * 空库返回 ''（与「未导入题库」同义）。
 *
 * ⚠️ 指纹只回答「是不是同一套题库」，不是内容校验和。单题修改（改题干/增删选项）
 * 会让它变，从而被 reconcileBank 误判为换题库并清记录 —— 所以 patchQuestion()
 * 走 save(..., {keepFp:true}) 强制沿用旧指纹。 */
function fingerprint(qs) {
  if (!Array.isArray(qs) || !qs.length) return '';
  var h = 2166136261;
  for (var i = 0; i < qs.length; i++) {
    var q = qs[i];
    var sig = String(q.i) + '|' + String(q.t) + '|' + String(q.s || '').length + '|' + ((q.o && q.o.length) || 0);
    for (var j = 0; j < sig.length; j++) h = Math.imul(h ^ sig.charCodeAt(j), 16777619) >>> 0;
  }
  return qs.length + '-' + h.toString(36);
}

function hasWx() { return typeof wx !== 'undefined' && !!wx.getStorageSync; }
/* 真机运行时有 wx.env；Node 测试的 mock 不带 —— 用它区分「真机」与「Node + mock」 */
function isMiniProgram() { return hasWx() && !!wx.env; }

/* 按 UTF-8 字节贪心切分（代理对不拆） */
function splitByUtf8(s, limit) {
  var chunks = [], cur = '', curLen = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    var cp = s.charCodeAt(i);
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < s.length) ch += s[++i]; // 代理对整体搬运
    var l = utf8Len(ch);
    if (curLen + l > limit && cur) { chunks.push(cur); cur = ''; curLen = 0; }
    cur += ch; curLen += l;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/* ---------- 索引 ---------- */
function readRaw(key) {
  if (!hasWx()) return null;
  try {
    var v = wx.getStorageSync(key);
    /* 双形态兼容：正常情况下存取一致直接拿对象；个别环境取出的是 JSON 字符串，解析后再用 */
    if (typeof v === 'string' && v) {
      try { v = JSON.parse(v); } catch (e) { return null; }
    }
    return (v && typeof v === 'object') ? v : null;
  } catch (e) { return null; }
}

function entryOf(idx, id) {
  if (!idx || !idx.list) return null;
  for (var i = 0; i < idx.list.length; i++) if (idx.list[i].id === id) return idx.list[i];
  return null;
}

function activeId(idx) { return (idx && idx.active) || 'main'; }

/* 读索引；无索引时用旧 meta 合成一个（不落盘，写操作时才真正迁移） */
function readIndex() {
  var idx = readRaw(INDEX_KEY);
  if (idx && Array.isArray(idx.list)) return idx;
  var legacy = readRaw(LEGACY_META_KEY);
  if (!legacy) return null;
  return {
    v: 1,
    active: 'main',
    list: [{
      id: 'main', name: legacy.name || '',
      count: legacy.count || 0, size: legacy.size || 0,
      chunks: legacy.chunks || 0, at: legacy.at || 0, fp: legacy.fp || ''
    }]
  };
}

function writeIndex(idx) {
  if (!hasWx()) return;
  wx.setStorageSync(INDEX_KEY, idx);
  /* 索引成了唯一事实源，旧 meta 不能留着 —— 两处并存必然有一天不同步 */
  try { wx.removeStorageSync(LEGACY_META_KEY); } catch (e) {}
}

function upsert(idx, meta) {
  var e = entryOf(idx, meta.id);
  if (e) { Object.keys(meta).forEach(function (k) { e[k] = meta[k]; }); return; }
  idx.list.push(meta);
}

function prefixOf(id) { return id === 'main' ? BASE_PREFIX : BASE_PREFIX + id + '.'; }

/* 只读 storage：无索引返回 null（区别于「已清除」的空库 []），供测试与回退判定 */
function readStorage(libId) {
  var idx = readIndex();
  var e = entryOf(idx, libId || activeId(idx));
  if (!e) return null;
  if (!e.chunks) return [];
  var pre = prefixOf(e.id);
  var parts = [];
  for (var i = 0; i < e.chunks; i++) {
    var c = wx.getStorageSync(pre + i);
    if (typeof c !== 'string') return null;
    parts.push(c);
  }
  try { var arr = JSON.parse(parts.join('')); return Array.isArray(arr) ? arr : []; }
  catch (e2) { return null; }
}

/* Node 回退读注入的内置题库（__setNodeBank）。bank-store 不直接 require qbank.js：
 * 发布包经 packOptions.ignore 排除该文件，包内任何指向它的字面量 require 都会让
 * 发布校验报 "Couldn't resolve the Js file"。真机分支永不走到这里。 */
var nodeBank = null;
var nodeFp = null;
function nodeFallback() {
  if (isMiniProgram()) return [];   // 真机不兜底
  return Array.isArray(nodeBank) ? nodeBank : [];
}

/* 当前题库指纹：小程序读索引（save 时算好），Node 用注入库算一次并缓存 */
function currentFingerprint() {
  if (!hasWx()) {
    if (nodeFp === null) nodeFp = fingerprint(nodeBank || []);
    return nodeFp;
  }
  var idx = readIndex();
  var e = entryOf(idx, activeId(idx));
  return (e && e.fp) || '';
}

/* 运行期加载：storage 优先，Node 回退注入题库 */
function load(libId) {
  var s = hasWx() ? readStorage(libId) : null;
  if (s) return s;
  return nodeFallback();
}

/* 保存紧凑数组；返回 {ok, meta} 或 {ok:false, err}
 * opts.name     新名字（不传则沿用旧名，改名不会丢）
 * opts.keepFp   沿用旧指纹（单题修改用：改题干/增删选项不该被当成「换题库」） */
function save(qs, opts) {
  opts = opts || {};
  if (!hasWx()) return { ok: false, err: '当前环境不支持存储' };
  var idx = readIndex() || { v: 1, active: 'main', list: [] };
  var id = activeId(idx);
  var prev = entryOf(idx, id);
  var arr = Array.isArray(qs) ? qs : [];
  var s = JSON.stringify(arr);
  var bytes = utf8Len(s);
  if (bytes > MAX_BYTES) {
    return { ok: false, err: '题库体积 ' + (bytes / 1048576).toFixed(1) + 'MB 超过 9MB 上限，请删减解析或分批导入' };
  }
  var chunks = splitByUtf8(s, CHUNK_BYTES);
  var name = opts.name === undefined ? ((prev && prev.name) || '') : String(opts.name || '').trim().slice(0, MAX_NAME);
  var meta = {
    id: id,
    name: name,
    count: arr.length,
    size: bytes,
    chunks: chunks.length,
    at: Date.now(),
    fp: (opts.keepFp && prev && prev.fp) ? prev.fp : fingerprint(arr)
  };
  var pre = prefixOf(id);
  try {
    // 1. 先写新 chunk（不提前删旧 chunk，避免中途崩溃导致旧数据损坏且新数据残缺）
    chunks.forEach(function (c, i) { wx.setStorageSync(pre + i, c); });
    // 2. 更新索引作为提交点（commit point）
    upsert(idx, meta);
    writeIndex(idx);
  } catch (e) {
    return { ok: false, err: '本地存储写入失败：' + (e && e.message ? e.message : '空间不足或存储异常') };
  }
  // 3. 提交成功后再清理多余的旧分片
  if (prev && prev.chunks > chunks.length) {
    for (var i = chunks.length; i < prev.chunks; i++) {
      try { wx.removeStorageSync(pre + i); } catch (e) {}
    }
  }
  return { ok: true, meta: meta };
}

/* 清除：索引里留一条空记录而非删除整个索引，避免 Node 回退再次读到注入题库 */
function clear() {
  if (!hasWx()) return;
  var idx = readIndex() || { v: 1, active: 'main', list: [] };
  var id = activeId(idx);
  var prev = entryOf(idx, id);
  var pre = prefixOf(id);
  if (prev && prev.chunks) {
    for (var i = 0; i < prev.chunks; i++) {
      try { wx.removeStorageSync(pre + i); } catch (e) {}
    }
  }
  upsert(idx, { id: id, name: '', count: 0, size: 0, chunks: 0, at: Date.now(), fp: '' });
  writeIndex(idx);
}

/* 当前题库元信息；无记录返回 null */
function info() {
  var idx = readIndex();
  var e = entryOf(idx, activeId(idx));
  if (!e) return null;
  return {
    count: e.count || 0, size: e.size || 0, chunks: e.chunks || 0,
    at: e.at || 0, fp: e.fp || '', name: e.name || ''
  };
}

/* 全部库的元信息（第二期多库 UI 用；本期只会有一条） */
function listBanks() {
  var idx = readIndex();
  if (!idx || !idx.list) return [];
  return idx.list.map(function (e) {
    return { id: e.id, name: e.name || '', count: e.count || 0, size: e.size || 0, at: e.at || 0, fp: e.fp || '' };
  });
}

/* 改题库名：只动索引，不重写分片、不动指纹，练习记录完全不受影响 */
function setName(name) {
  var idx = readIndex();
  if (!idx) return { ok: false, err: '还没有题库' };
  var e = entryOf(idx, activeId(idx));
  if (!e) return { ok: false, err: '还没有题库' };
  e.name = String(name || '').trim().slice(0, MAX_NAME);
  try { writeIndex(idx); } catch (err) { return { ok: false, err: '写入失败' }; }
  return { ok: true, name: e.name };
}

/* 单题修改：只改这一题的紧凑字段，沿用旧指纹。
 * patch 可含 s / o / a / r / x（紧凑字段），值为 null 表示删除该字段。
 * 返回 { ok, bank, before }；before 是改前的原值，调用方存起来供「还原」用。 */
function patchQuestion(qid, patch) {
  var arr = load();
  if (!arr.length) return { ok: false, err: '当前没有题库' };
  var i = -1;
  for (var k = 0; k < arr.length; k++) if (arr[k].i === qid) { i = k; break; }
  if (i < 0) return { ok: false, err: '题库里没有这道题' };
  var q = arr[i];
  var before = {};
  ['s', 'o', 'a', 'r', 'x'].forEach(function (key) { if (q[key] !== undefined) before[key] = q[key]; });
  var p = patch || {};
  ['s', 'o', 'a', 'r', 'x'].forEach(function (key) {
    if (p[key] === undefined) return;
    if (p[key] === null || p[key] === '') { if (key !== 's') delete q[key]; return; }
    q[key] = p[key];
  });
  var sv = save(arr, { keepFp: true });
  if (!sv.ok) return sv;
  return { ok: true, bank: arr, before: before };
}

module.exports = {
  INDEX_KEY: INDEX_KEY, META_KEY: LEGACY_META_KEY, CHUNK_PREFIX: BASE_PREFIX,
  CHUNK_BYTES: CHUNK_BYTES, MAX_BYTES: MAX_BYTES,
  utf8Len: utf8Len, splitByUtf8: splitByUtf8, fingerprint: fingerprint, currentFingerprint: currentFingerprint,
  load: load, readStorage: readStorage, save: save, clear: clear, info: info,
  listBanks: listBanks, setName: setName, patchQuestion: patchQuestion,
  /* 仅 Node 测试/脚本用：注入开发副本的内置题库（utils/qbank.js 内容）。
   * 小程序包里无 qbank.js，也不需要注入——真机只走 storage。 */
  __setNodeBank: function (arr) { nodeBank = Array.isArray(arr) ? arr : null; nodeFp = null; }
};
