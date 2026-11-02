const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

Page({
  data: {
    isExam: false,
    score: 0,
    verdict: '',
    verdictCls: '',
    bigNum: '',
    bigLbl: '',
    kvs: [],
    breakdown: [],
    wrongList: [],
    wrongMore: 0,
    note: ''
  },

  onLoad() {
    let r = store.ui.lastResult;
    if (!r) {
      try {
        const cached = wx.getStorageSync('lastResult');
        if (cached) {
          r = cached;
          store.ui.lastResult = cached;
        }
      } catch (e) {}
    }
    if (!r) {
      wx.showToast({ title: '无成绩数据', icon: 'none' });
      this._backTimer = setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 800);
      return;
    }
    const isExam = r.mode === 'exam';
    const kvs = [];
    kvs.push({ label: '正确率', value: isExam ? r.score + '%' : (r.answered ? logic.pct(r.correct, r.answered) + '%' : '-') });
    kvs.push({ label: '用时', value: logic.fmtDur(r.duration) });
    if (isExam) {
      kvs.push({ label: '题量', value: r.total + ' 题' });
      kvs.push({ label: '答对', value: r.correct + ' 题' });
      if (r.unanswered) kvs.push({ label: '未作答', value: r.unanswered + ' 题' });
    }
    /* 未作答与超时要说清楚：只丢进成绩里算错，不进未掌握（否则一次超时几十道题全变未掌握） */
    const notes = [];
    if (r.timedOut) notes.push('本次测验到时间自动交卷');
    if (r.unanswered) notes.push('未作答的 ' + r.unanswered + ' 题按错误计分，未计入「未掌握」');
    const breakdown = [];
    if (r.breakdown) {
      Object.keys(r.breakdown).forEach(t => {
        const x = r.breakdown[t];
        if (!x.total) return;
        const p = logic.pct(x.right, x.total);
        breakdown.push({
          name: logic.TYPE_LABEL[t] || t,
          pct: p,
          color: p >= 80 ? '#16A34A' : p >= 60 ? '#D97706' : '#DC2626',
          val: x.right + '/' + x.total
        });
      });
    }
    const wrongList = (r.wrongIds || []).slice(0, 20).map((id, i) => {
      const q = logic.QMAP[id];
      return { no: i + 1, stem: q ? q.stem : '' };
    });

    this.setData({
      isExam: isExam,
      score: r.score || 0,
      verdict: isExam ? (r.score >= 80 ? '优秀' : r.score >= 60 ? '及格' : '未通过') : '',
      verdictCls: isExam ? (r.score >= 80 ? 'pass' : 'fail') : '',
      bigNum: isExam ? String(r.score) : (r.answered + '/' + r.total),
      bigLbl: isExam ? '得分（满分100）' : '完成题量 · 答对 ' + r.correct + ' 题',
      kvs: kvs,
      breakdown: breakdown,
      wrongList: wrongList,
      wrongMore: Math.max(0, (r.wrongIds || []).length - 20),
      note: notes.join('；')
    });
    wx.setNavigationBarTitle({ title: isExam ? '测验成绩' : '练习完成' });
  },

  onAgain() {
    const r = store.ui.lastResult;
    const mode = r && r.mode === 'exam' ? 'exam' : (r && r.mode === 'rand' ? 'rand' : 'seq');
    store.ui.setupMode = mode;
    wx.redirectTo({ url: '/pages/setup/setup?mode=' + mode });
  },

  onGoWrong() {
    wx.switchTab({ url: '/pages/wrong/wrong' });
  },

  onGoHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onShareAppMessage() {
    const r = store.ui.lastResult;
    return {
      title: r && r.mode === 'exam' ? '我测验拿了 ' + r.score + ' 分' : '刷题本子 · 练习完成',
      path: '/pages/index/index'
    };
  },

  onUnload() {
    if (this._backTimer) clearTimeout(this._backTimer);
  },

  onShareTimeline() {
    return { title: '刷题本子 · 刷题练习工具' };
  }
});
