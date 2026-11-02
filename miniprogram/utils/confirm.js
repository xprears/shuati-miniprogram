/* 危险操作统一确认：两次弹窗
 *
 * 为什么不是一次：清空未掌握、清除题库、重置全部都是不可恢复的，而且它们挤在设置区
 * 一排灰色按钮里，误触成本很低。第一跳讲清后果与具体数量（「将清空 37 道未掌握题」
 * 比「确定清空？」有用得多），第二跳只留一句「不可恢复」，确认键统一红色 ——
 * 必须连点两次才生效。
 *
 * 不做「清空后 5 秒可撤销」：要加页面内提示条 + 计时器 + 撤销栈，收益低于两跳确认，
 * 还多一处状态要维护。真正需要留后路的地方（练习记录）用「导出」解决。
 */
function confirmDanger(opts, onOk) {
  opts = opts || {};
  var confirmText = opts.confirmText || '继续';
  wx.showModal({
    title: opts.title || '确认操作',
    content: opts.content || '',
    confirmText: confirmText,
    cancelText: '取消',
    confirmColor: '#DC2626',
    success: function (res) {
      if (!res.confirm) return;
      wx.showModal({
        title: '最后确认',
        content: opts.again || '该操作不可恢复，确认执行？',
        confirmText: confirmText,
        cancelText: '再想想',
        confirmColor: '#DC2626',
        success: function (res2) { if (res2.confirm) onOk(); }
      });
    }
  });
}

module.exports = { confirmDanger: confirmDanger };
