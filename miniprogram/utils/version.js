/* 版本号的唯一出口。
 *
 * 为什么不能写死：反馈模板里的版本号原先是 contact.js 里的常量 '1.0.0'，
 * 上传新版本后没人记得改它，用户发回来的反馈永远写着 1.0.0 —— 等于没写。
 *
 * 权威值只有微信一处：每次上传时在开发者工具 / mp 后台填的版本号，
 * 运行时用 wx.getAccountInfoSync().miniProgram.version 取。
 * ⚠️ 该字段只有正式版（envVersion = 'release'）才有值，开发版 / 体验版返回空串，
 *    这时退回本地基线 BASE_VERSION，并在文案里标清环境，避免把基线误当成线上版本。
 *
 * BASE_VERSION 必须与 miniprogram/package.json 的 version 一致，
 * build/mp-lint.js 第 9 项会校验，不一致直接失败。
 *
 * ⚠️ 这个号**不是语义化版本，不要自己定 1.1.0 之类**：线上版本号由发布流程
 *    自动递增（1.0.0 起每次「分享 → 更新」+0.0.1），人工改不了。这里的值只是
 *    「当前代码大致对应哪一版」的本地标注，正式版运行时读的是微信给的真实值。
 *    发布一次后回来 +0.0.1 与线上对齐，别让开发版显示一个线上不存在的号。
 */
const BASE_VERSION = '1.0.7';

const ENV_LABEL = { develop: '开发版', trial: '体验版', release: '正式版' };

function runtime() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function') {
      const info = wx.getAccountInfoSync() || {};
      const mp = info.miniProgram || {};
      return { version: String(mp.version || ''), env: String(mp.envVersion || '') };
    }
  } catch (e) { /* 取不到就当没有，退回基线 */ }
  return { version: '', env: '' };
}

/* 纯版本号：正式版 = 线上真实版本；其余 = 本地基线 */
function appVersion() {
  return runtime().version || BASE_VERSION;
}

/* 带环境标注，给反馈模板用：'1.0.7 · 正式版' / '1.0.7 · 开发版' */
function appVersionLabel() {
  const r = runtime();
  const label = ENV_LABEL[r.env] || '';
  const v = r.version || BASE_VERSION;
  return label ? v + ' · ' + label : v;
}

module.exports = {
  BASE_VERSION: BASE_VERSION,
  appVersion: appVersion,
  appVersionLabel: appVersionLabel
};
