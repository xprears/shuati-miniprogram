/* 云服务客户端（分包内）：解析反馈的读写
 * 只在本分包使用；主包不依赖它，因此 SDK 体积不进主包。
 * 配置来自 lib/config.js（不入库，模板见 config.example.js）；未配置时优雅降级，
 * 只影响"反馈"入口，刷题主功能不受影响。 */
const { createMiniProgramWorkBuddyCloud } = require('../vendor/workbuddy-cloud-sdk.js');
const { createDiagnosticWx } = require('../vendor/workbuddy-cloud-diagnostics.js');

let CFG = {};
try { CFG = require('./config.js') || {}; } catch (e) { CFG = {}; }

const ENDPOINT = CFG.endpoint || '';
const PUBLISHABLE_KEY = CFG.publishableKey || '';
const TABLE = CFG.table || 'question_feedback';
const TAG_KEY = 'yjtx.feedback.tag';

const NOT_READY = '云服务未配置（缺少 lib/config.js）';

let db = null;
let inited = false;

/* 懒初始化：未配置 endpoint/key 时返回 null，由调用方给出友好提示 */
function database() {
  if (!inited) {
    inited = true;
    if (ENDPOINT && PUBLISHABLE_KEY) {
      try {
        db = createMiniProgramWorkBuddyCloud({
          endpoint: ENDPOINT,
          publishableKey: PUBLISHABLE_KEY,
          wx: createDiagnosticWx(wx)
        }).database;
      } catch (e) {
        db = null;
      }
    }
  }
  return db;
}

/* 提交端标记：同一台设备稳定不变，用于区分"几个人反馈了同一题" */
function tag() {
  let v = '';
  try { v = wx.getStorageSync(TAG_KEY) || ''; } catch (e) { v = ''; }
  if (!v) {
    v = Math.random().toString(36).slice(2, 8).toUpperCase();
    try { wx.setStorageSync(TAG_KEY, v); } catch (e) { /* 忽略 */ }
  }
  return v;
}

/* 面向用户的一句话错误说明，不透出后端细节 */
function friendly(err) {
  const code = err && err.code;
  if (code === '42P01') return '反馈表尚未就绪，请稍后再试';
  if (code === '42501') return '当前没有提交权限';
  if (code === '23505') return '这条反馈已经提交过了';
  return '提交失败，请检查网络后重试';
}

/* 提交一条解析反馈；成功返回 { ok:true } */
function submitFeedback(q, kind, content) {
  const d = database();
  if (!d) return Promise.resolve({ ok: false, msg: NOT_READY });
  const noMatch = /\d+/.exec(String(q.id));
  const row = {
    question_id: q.id,
    qno: noMatch ? parseInt(noMatch[0], 10) : null,
    chapter: q.chapter || null,
    part: q.part || null,
    qtype: q.type || null,
    stem: q.stem || null,
    kind: kind,
    content: content || null,
    client_tag: tag()
  };
  return d.from(TABLE).insert(row).select()
    .then(function (res) {
      if (res && res.error) return { ok: false, msg: friendly(res.error) };
      return { ok: true };
    }, function (err) {
      return { ok: false, msg: friendly(err) };
    });
}

/* 拉取全部反馈，按时间倒序 */
function fetchFeedback(limit) {
  const d = database();
  if (!d) return Promise.resolve({ ok: false, msg: NOT_READY });
  return d.from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit || 500)
    .then(function (res) {
      if (res && res.error) return { ok: false, msg: friendly(res.error) };
      return { ok: true, rows: (res && res.data) || [] };
    }, function (err) {
      return { ok: false, msg: friendly(err) };
    });
}

const KINDS = [
  { k: 'wrong', t: '解析有误' },
  { k: 'unclear', t: '看不懂解析' },
  { k: 'other', t: '其他问题' }
];

const KIND_LABEL = {
  wrong: '解析有误',
  unclear: '看不懂解析',
  other: '其他问题'
};

module.exports = { submitFeedback, fetchFeedback, KINDS, KIND_LABEL };
