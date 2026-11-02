const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');
const confirm = require('../../utils/confirm.js');

Page({
  data: {
    total: 0,
    masteredN: 0,
    list: [],
    detail: null
  },

  onShow() {
    const S = store.S;
    /* 只列当前题库里的题：旧题库遗留的 id 在 QMAP 查不到，直接渲染会白屏。
       换库时由 store.reconcileBank 清理，这里再滤一道兜底。 */
    const ids = Object.keys(S.wrong).filter(id => logic.QMAP[id]);
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
    this.setData({ total: ids.length, masteredN: store.stats().masteredN, list: list, detail: null });
  },

  onRedo(e) {
    if (this._redoing) return;
    const mode = e.currentTarget.dataset.mode;
    /* 与设置页同口径：隐藏章节的题不参与任何练习 */
    const ids = Object.keys(store.S.wrong).filter(id => {
      const q = logic.QMAP[id];
      return q && !store.S.hidden[q.chapter];
    });
    if (!ids.length) { wx.showToast({ title: '未掌握列表为空', icon: 'none' }); return; }
    this._redoing = true;
    store.startPractice('wrong', mode === 'rand' ? logic.shuffle(ids) : ids);
    wx.navigateTo({
      url: '/pages/practice/practice',
      complete: () => { setTimeout(() => { this._redoing = false; }, 600); }
    });
  },

  onClear() {
    const n = this.data.total;
    confirm.confirmDanger({
      title: '清空未掌握列表',
      content: '将清空 ' + n + ' 道未掌握题，这些题之后恢复正常出现概率。答题次数与正确率统计不受影响。',
      again: '这 ' + n + ' 道题的未掌握标记将全部丢失，无法恢复，确认？',
      confirmText: '清空'
    }, () => {
      store.S.wrong = {};
      store.save();
      wx.showToast({ title: '已清空', icon: 'none' });
      this.onShow();
    });
  },

  onClearMastered() {
    const n = this.data.masteredN;
    confirm.confirmDanger({
      title: '清除已掌握标记',
      content: '将清除 ' + n + ' 道已掌握标记，这些题之后恢复正常出现概率。',
      again: '已掌握标记无法恢复（重新答对可再自动积累），确认？',
      confirmText: '清除'
    }, () => {
      store.S.mastered = {};
      store.save();
      wx.showToast({ title: '已清除', icon: 'none' });
      this.onShow();
    });
  },

  onDetail(e) {
    const id = e.currentTarget.dataset.id;
    const q = logic.QMAP[id];
    if (!q) {
      wx.showToast({ title: '该题目已不在当前题库中', icon: 'none' });
      return;
    }
    let opts = [];
    let ansText = '';
    if (q.options) {
      const ansKey = logic.answerKey(q, q.answer);
      opts = (q.options || []).map(o => {
        const isAns = q.type === 'multi' ? (q.answer && q.answer.indexOf(o.key) >= 0) : o.key === ansKey;
        return { key: o.key, text: o.text, isAns: isAns };
      });
      ansText = q.type === 'judge' ? (q.answer === '√' ? '正确' : '错误')
        : q.type === 'multi' ? (q.answer ? q.answer.split('').join('、') : '') : (q.answer || '');
    } else if (logic.isFillBlank(q)) {
      /* 填空没有选项，正确答案按空逐行列出（含 | 分隔的等价写法），
         否则详情里「正确答案」那一行会整块不渲染，用户看不到答案 */
      ansText = logic.blanksOf(q).map((a, i) =>
        '第' + (i + 1) + '空：' + String(a == null ? '' : a).split('|').join(' / ')).join('\n');
    }
    this.setData({
      detail: {
        id: id,
        stem: q.stem,
        options: opts,
        ansText: ansText,
        hasAns: !!ansText,
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

  /* 从详情弹层直接改题：未掌握列表里最容易发现「这题答案标错了」 */
  onEditDetail() {
    const d = this.data.detail;
    if (!d || !d.id) return;
    wx.navigateTo({ url: '/pages/edit/edit?qid=' + d.id });
  },

  noop() {},

  onShareAppMessage() {
    return { title: '刷题本子 · 未掌握', path: '/pages/wrong/wrong' };
  },

  onShareTimeline() {
    return { title: '刷题本子 · 刷题练习工具' };
  }
});
