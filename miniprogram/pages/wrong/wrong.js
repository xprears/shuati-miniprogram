const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

Page({
  data: {
    total: 0,
    list: [],
    detail: null
  },

  onShow() {
    const S = store.S;
    const ids = Object.keys(S.wrong);
    ids.sort((a, b) => S.wrong[b].n - S.wrong[a].n);
    const list = ids.map(id => {
      const q = logic.QMAP[id];
      const w = S.wrong[id];
      return {
        id: id,
        type: logic.TYPE_LABEL[q.type],
        stem: q.stem,
        meta: logic.shortPart(q.part) + ' · ' + q.chapter,
        wrongN: w.n
      };
    });
    this.setData({ total: ids.length, list: list, detail: null });
  },

  onRedo(e) {
    const mode = e.currentTarget.dataset.mode;
    const ids = Object.keys(store.S.wrong);
    if (!ids.length) { wx.showToast({ title: '错题本为空', icon: 'none' }); return; }
    store.startPractice('wrong', mode === 'rand' ? logic.shuffle(ids) : ids);
    wx.navigateTo({ url: '/pages/practice/practice' });
  },

  onClear() {
    wx.showModal({
      title: '提示',
      content: '确定清空错题本？该操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) {
          store.S.wrong = {};
          store.save();
          wx.showToast({ title: '已清空', icon: 'none' });
          this.onShow();
        }
      }
    });
  },

  onDetail(e) {
    const id = e.currentTarget.dataset.id;
    const q = logic.QMAP[id];
    const ansKey = logic.answerKey(q, q.answer);
    const opts = (q.options || []).map(o => {
      const isAns = q.type === 'multi' ? q.answer.indexOf(o.key) >= 0 : o.key === ansKey;
      return { key: o.key, text: o.text, isAns: isAns };
    });
    const ansText = q.type === 'judge' ? (q.answer === '√' ? '正确' : '错误')
      : q.type === 'multi' ? q.answer.split('').join('、') : q.answer;
    this.setData({
      detail: {
        id: id,
        stem: q.stem,
        options: opts,
        ansText: ansText,
        hasRef: !!q.reference,
        reference: q.reference || '',
        hasAnalysis: !!q.analysis,
        analysis: q.analysis || ''
      }
    });
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id;
    store.removeWrong(id);
    wx.showToast({ title: '已移出', icon: 'none' });
    this.onShow();
  },

  onCloseDetail() {
    this.setData({ detail: null });
  },

  /* 解析反馈：跳转分包表单页 */
  onFeedback(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pkg-feedback/form/form?id=' + id });
  },

  noop() {},

  onShareAppMessage() {
    return { title: '应急通信错题本', path: '/pages/wrong/wrong' };
  }
});
