const logic = require('../../utils/logic.js');
const cloud = require('../lib/cloud.js');

function p2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

Page({
  data: {
    loading: true,
    list: [],
    total: 0,
    qCount: 0,
    hint: ''
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load(true);
  },

  onShow() {
    if (this._loaded) this.load();
  },

  load(fromPull) {
    const self = this;
    this.setData({ loading: true, hint: '' });
    cloud.fetchFeedback(500).then(function (r) {
      if (fromPull) wx.stopPullDownRefresh();
      if (!r.ok) {
        self.setData({ loading: false });
        wx.showToast({ title: r.msg, icon: 'none', duration: 2400 });
        return;
      }
      const rows = r.rows;
      const cnt = {};
      rows.forEach(function (x) { cnt[x.question_id] = (cnt[x.question_id] || 0) + 1; });
      const list = rows.map(function (x) {
        const q = logic.QMAP[x.question_id] || {};
        const chapter = x.chapter || q.chapter || '';
        return {
          id: x.id,
          no: x.qno || String(x.question_id).replace(/\D/g, ''),
          kindText: cloud.KIND_LABEL[x.kind] || '其他问题',
          kindCls: x.kind === 'wrong' ? 'red' : (x.kind === 'unclear' ? 'orange' : 'gray'),
          stem: x.stem || q.stem || '（题干缺失）',
          content: x.content || '',
          meta: chapter + (cnt[x.question_id] > 1 ? ' · 该题共 ' + cnt[x.question_id] + ' 条' : ''),
          time: fmtTime(x.created_at)
        };
      });
      self._loaded = true;
      self.setData({
        loading: false,
        list: list,
        total: rows.length,
        qCount: Object.keys(cnt).length
      });
    });
  },

  onReload() {
    this.load();
  },

  onCopy() {
    const rows = this.data.list;
    if (!rows.length) return;
    const lines = ['【应急通信题库 · 解析反馈】共 ' + rows.length + ' 条，涉及 ' + this.data.qCount + ' 道题', ''];
    rows.forEach(function (r, i) {
      lines.push((i + 1) + '. 第 ' + r.no + ' 题 · ' + r.meta);
      lines.push('   题干：' + r.stem);
      lines.push('   反馈：' + r.kindText + (r.content ? ' —— ' + r.content : ''));
      lines.push('   时间：' + r.time);
      lines.push('');
    });
    wx.setClipboardData({
      data: lines.join('\n'),
      success: function () {
        wx.showToast({ title: '已复制全部反馈', icon: 'success' });
      }
    });
  },

  onShareAppMessage() {
    return { title: '应急通信刷题', path: '/pages/index/index' };
  }
});
