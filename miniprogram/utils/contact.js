/* 反馈联系方式（唯一配置点）
 *
 * 反馈该收什么：本产品是空壳形态，题库和解析都是用户自己导入 / AI 生成的，
 * 所以「解析写错了」不归我们管（该去找写解析的那个 AI）。真正的痛点是：
 *   1. 导入校验不通过、卡在导入页走不下去（最高频）
 *   2. 判分不对、记录丢失、闪退（bug）
 *   3. 功能建议
 * 因此导入页报错处有「复制报错并反馈」，报告页底部有通用「反馈与支持」。
 *
 * 三条通道，按优先级：
 *   A. 微信客服（主）：`<button open-type="contact">` 直接进会话，不用加好友。
 *      消息落在微信的「小程序客服」系统里——不进数据库、不落本地，自己用
 *      mp 后台「客服」页或手机「小程序客服」进小程序处理。
 *      ⚠️ **必须在 mp 后台「功能 → 客服 → 客服人员」加过客服人员**，否则点了
 *      **静默无反应**（没有 fail 回调，用户只会以为按钮坏了）。
 *      ⚠️ 客服会话只透传聊天内容，不带任何上下文——所以下面是 B。
 *   B. 复制诊断信息：版本 / 题库 / 练习统计拼成一段文本，用户粘进会话。
 *      没有这段，客服收到的就是「导入不进去」四个字，谁也定位不了问题。
 *   C. 复制微信号：兜底。客服没配、或用户不想用会话时还能加到人。
 *
 * 为什么不走 wx.openCustomerServiceChat：那要企业微信的 corpId + kfid（企业微信需验证），
 * 个人主体没必要为这个注册企业。open-type="contact" 走小程序自己的客服，够用。
 *
 * 本文件是**唯一配置点**：三条通道全空 ⇒ 报告页反馈卡整块不渲染（线上不出空按钮）。
 */
const version = require('./version.js');

const CONTACT = {
  /* 2026-11-02 起小程序是自己账号下的正式版，客服可在 mp 后台自行配置。
     配好客服人员后保持 true；没配之前先置 false，免得线上出现「点了没反应」的按钮。 */
  useCustomerService: true,
  wechatId: 'diandituandui01',   // 备用微信号（个人号即可）
  email: ''                      // 可选：填了会多出一个「复制邮箱」按钮
};

/* 有任何一条通道可用就渲染整块 */
function ready() {
  return !!(CONTACT.useCustomerService || CONTACT.wechatId || CONTACT.email);
}

/* 反馈模板。ctx 可选字段：
 *   total      当前题库题数
 *   bankName   题库名
 *   fp         题库指纹（只取前 8 位，能确认是不是同一套库）
 *   ansN / acc 累计答题数 / 正确率
 *   wrongN     未掌握数
 *   masteredN  已掌握数
 *   examN      测验场次
 *   lastExam   上次测验（"11-01 20:15 · 85 分"）
 *   page       用户当时在哪个页面
 *   errs       校验错误数组（导入页 step 2）
 *   parseErr   解析阶段的致命错误（JSON 压根不合法）
 *   rawLen     用户粘贴的原始字符数
 * 带上报错原文与统计是关键：只有「导入不了」四个字，没法定位问题。 */
function buildTemplate(ctx) {
  ctx = ctx || {};
  const bank = [String(ctx.total || 0) + ' 题'];
  if (ctx.fp) bank.push('指纹 ' + String(ctx.fp).slice(0, 8));
  const head = ctx.bankName
    ? ctx.bankName + '（' + bank.join(' · ') + '）'
    : bank.join(' · ');

  const lines = ['【刷题本子】问题反馈', '· 版本：' + version.appVersionLabel(), '· 题库：' + head];

  const stat = [];
  if (ctx.ansN !== undefined) stat.push('已答 ' + ctx.ansN + ' 题');
  if (ctx.acc) stat.push('正确率 ' + ctx.acc);
  if (ctx.wrongN !== undefined) stat.push('未掌握 ' + ctx.wrongN);
  if (ctx.masteredN !== undefined) stat.push('已掌握 ' + ctx.masteredN);
  if (ctx.examN !== undefined) stat.push('测验 ' + ctx.examN + ' 场');
  if (stat.length) lines.push('· 练习：' + stat.join(' · '));
  if (ctx.lastExam) lines.push('· 上次测验：' + ctx.lastExam);
  if (ctx.page) lines.push('· 页面：' + ctx.page);
  if (ctx.rawLen) lines.push('· 粘贴长度：' + ctx.rawLen + ' 字符');

  const detail = [];
  if (ctx.parseErr) detail.push(ctx.parseErr);
  (ctx.errs || []).forEach(function (e) {
    if (detail.indexOf(e) < 0) detail.push(e);
  });
  if (detail.length) {
    lines.push('· 报错：');
    detail.slice(0, 6).forEach(function (e) { lines.push('  ' + e); });
    if (detail.length > 6) lines.push('  …另有 ' + (detail.length - 6) + ' 条');
  }
  lines.push('· 问题：导入校验不通过 / 判分不对 / 记录丢失 / 功能建议（选一个）');
  lines.push('· 说明：');
  return lines.join('\n');
}

module.exports = {
  CONTACT: CONTACT,
  VERSION: version.BASE_VERSION,
  ready: ready,
  buildTemplate: buildTemplate
};
