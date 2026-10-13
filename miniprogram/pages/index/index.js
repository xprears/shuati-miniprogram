const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

Page({
  data: {
    total: 0,
    parts: 0,
    chapters: 0,
    totalAns: 0,
    accuracy: '-',
    wrongN: 0,
    streakN: 0,
    resume: null,
    recent: []
  },

  onShow() {
    const S = store.S;
    let totalAns = 0, totalRight = 0;
    Object.keys(S.qs).forEach(k => { totalAns += S.qs[k].r + S.qs[k].w; totalRight += S.qs[k].r; });
    let chapters = 0;
    logic.TREE.forEach(p => { chapters += p.chapters.length; });

    let resume = null;
    const p = S.practice;
    if (p && !p.done && p.ids && p.ids.length) {
      const answered = p.ids.filter(id => p.ans[id] && p.ans[id].sel.length).length;
      resume = {
        title: p.title,
        progress: Math.min(p.idx + 1, p.ids.length) + '/' + p.ids.length,
        answered: answered,
        btn: p.mode === 'exam' ? '继续考试' : '继续练习'
      };
    }

    this.setData({
      total: logic.QLIST.length,
      parts: logic.TREE.length,
      chapters: chapters,
      totalAns: totalAns,
      accuracy: totalAns ? logic.pct(totalRight, totalAns) + '%' : '-',
      wrongN: store.wrongCount(),
      streakN: S.streak.n,
      resume: resume,
      recent: S.history.slice(-3).reverse().map(x => ({
        score: x.score, scope: x.scopeLabel, total: x.total,
        time: logic.fmtDateTime(x.at), dur: logic.fmtDur(x.duration),
        cls: x.score >= 80 ? 'pass' : x.score >= 60 ? 'mid' : 'fail'
      }))
    });
  },

  onModeTap(e) {
    const mode = e.currentTarget.dataset.mode;
    store.ui.setupMode = mode;
    wx.navigateTo({ url: '/pages/setup/setup?mode=' + mode });
  },

  onResumeTap() {
    wx.navigateTo({ url: '/pages/practice/practice' });
  },

  goReport() {
    wx.switchTab({ url: '/pages/report/report' });
  },

  /* 进入分包内的反馈汇总页（云 SDK 在分包里，主包不背这个体积） */
  goFeedback() {
    wx.navigateTo({ url: '/pkg-feedback/list/list' });
  },

  onShareAppMessage() {
    return { title: '2026应急通信技能比武理论考核刷题', path: '/pages/index/index' };
  }
});
