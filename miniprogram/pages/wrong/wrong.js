const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

Page({
  data: {
    total: 0,
    masteredN: 0,
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
    this.setData({ total: ids.length, masteredN: store.masteredCount(), list: list, detail: null });
  },

  onRedo(e) {
    const mode = e.currentTarget.dataset.mode;
    const ids = Object.keys(store.S.wrong);
    if (!ids.length) { wx.showToast({ title: '未掌握列表为空', icon: 'none' }); return; }
    store.startPractice('wrong', mode === 'rand' ? logic.shuffle(ids) : ids);
    wx.navigateTo({ url: '/pages/practice/practice' });
  },

  onClear() {
    wx.showModal({
      title: '提示',
      content: '确定清空未掌握列表？该操作不可恢复。',
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

  onClearMastered() {
    wx.showModal({
      title: '提示',
      content: '清除全部「已掌握」标记？这些题之后会恢复正常出现概率。',
      confirmText: '清除',
      confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) {
          store.S.mastered = {};
          store.save();
          wx.showToast({ title: '已清除', icon: 'none' });
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

  /* 从未掌握列表移除 = 视为已掌握（抽题降权），与练习页的「已掌握」同一口径 */
  onRemove(e) {
    const id = e.currentTarget.dataset.id;
    store.markMastered(id);
    wx.showToast({ title: '已标记掌握', icon: 'none' });
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
    return { title: '刷题宝 · 未掌握', path: '/pages/wrong/wrong' };
  }
});
