/* 云服务配置示例：复制本文件为 config.js 并填入自己的值。
 *
 * 这两项来自 WorkBuddy 云服务激活结果（publicConfig）：
 *   endpoint       云服务接入点，如 https://mp-api.app.workbuddy.host
 *   publishableKey 可公开的客户端密钥，形如 wbpk_<appId>_xxxxxxxx
 *   table          收集反馈的数据表名（默认 question_feedback）
 *
 * 没有云服务也能跑：不建 config.js 时，反馈入口会提示"云服务未配置"，
 * 刷题、分类、错题本、学习报告等主功能不受任何影响。
 */
module.exports = {
  endpoint: '',
  publishableKey: '',
  table: 'question_feedback'
};
