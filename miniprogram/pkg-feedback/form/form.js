const logic = require('../../utils/logic.js');
const cloud = require('../lib/cloud.js');

Page({
  data: {
    q: null,
    kinds: cloud.KINDS,
    kind: 'wrong',
    content: '',
    submitting: false
  },

  onLoad(options) {
    const q = logic.QMAP[options.id];
    if (!q) {
      wx.showToast({ title: '题目不存在', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 900);
      return;
    }
    this.q = q;
    this.setData({
      q: {
        no: String(q.id).replace(/\D/g, ''),
        type: logic.TYPE_LABEL[q.type] || '',
        part: logic.shortPart(q.part),
        chapter: q.chapter || '',
        stem: q.stem,
        hasAnalysis: !!q.analysis
      }
    });
    wx.setNavigationBarTitle({ title: '解析反馈' });
  },

  onKind(e) {
    this.setData({ kind: e.currentTarget.dataset.k });
  },

  onInput(e) {
    this.setData({ content: e.detail.value });
  },

  onSubmit() {
    if (this.data.submitting) return;
    const self = this;
    this.setData({ submitting: true });
    cloud.submitFeedback(this.q, this.data.kind, (this.data.content || '').trim())
      .then(function (r) {
        if (!r.ok) {
          self.setData({ submitting: false });
          wx.showToast({ title: r.msg, icon: 'none', duration: 2400 });
          return;
        }
        self.setData({ submitting: false });
        wx.showToast({ title: '已提交，谢谢', icon: 'success', duration: 1200 });
        setTimeout(function () { wx.navigateBack(); }, 1000);
      });
  },

  onShareAppMessage() {
    return { title: '应急通信刷题', path: '/pages/index/index' };
  }
});
