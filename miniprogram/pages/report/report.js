const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

Page({
  data: {
    totalAns: 0,
    accuracy: '-',
    days: 0,
    streakN: 0,
    wrongN: 0,
    masteredN: 0,
    examN: 0,
    trend: [],
    trendLabels: [],
    trendMax: 1,
    typeStats: [],
    chapterStats: [],
    weak: [],
    history: [],
    feedback: true
  },

  onShow() {
    const S = store.S;
    let totalAns = 0, totalRight = 0;
    Object.keys(S.qs).forEach(k => { totalAns += S.qs[k].r + S.qs[k].w; totalRight += S.qs[k].r; });

    // 近 14 天趋势
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.getFullYear() + '-' + logic.pad(d.getMonth() + 1) + '-' + logic.pad(d.getDate());
      days.push({ key: key, label: (d.getMonth() + 1) + '/' + d.getDate(), n: S.days[key] || 0 });
    }
    const maxN = Math.max.apply(null, days.map(x => x.n).concat([1]));

    // 题型正确率
    const typeStat = {};
    Object.keys(S.qs).forEach(id => {
      const q = logic.QMAP[id];
      if (!q) return;
      const t = typeStat[q.type] || (typeStat[q.type] = { r: 0, w: 0 });
      t.r += S.qs[id].r; t.w += S.qs[id].w;
    });
    const typeStats = Object.keys(typeStat)
      .map(t => {
        const x = typeStat[t];
        const p = logic.pct(x.r, x.r + x.w);
        return { name: logic.TYPE_LABEL[t] || t, pct: p, color: p >= 80 ? '#16A34A' : p >= 60 ? '#D97706' : '#DC2626' };
      })
      .sort((a, b) => b.pct - a.pct);

    // 章节掌握度（练习量前 8）
    const chStat = {};
    Object.keys(S.qs).forEach(id => {
      const q = logic.QMAP[id];
      if (!q) return;
      const c = chStat[q.chapter] || (chStat[q.chapter] = { r: 0, w: 0 });
      c.r += S.qs[id].r; c.w += S.qs[id].w;
    });
    const chapterStats = Object.keys(chStat)
      .sort((a, b) => (chStat[b].r + chStat[b].w) - (chStat[a].r + chStat[a].w))
      .slice(0, 8)
      .map(c => {
        const x = chStat[c];
        const p = logic.pct(x.r, x.r + x.w);
        return { name: logic.shortChapter(c), pct: p, color: p >= 80 ? '#16A34A' : p >= 60 ? '#D97706' : '#DC2626' };
      });

    // 薄弱环节
    const weak = Object.keys(chStat)
      .map(c => ({ name: logic.shortChapter(c), full: c, pct: logic.pct(chStat[c].r, chStat[c].r + chStat[c].w), n: chStat[c].r + chStat[c].w }))
      .filter(x => x.n >= 10)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);

    this.setData({
      totalAns: totalAns,
      accuracy: totalAns ? logic.pct(totalRight, totalAns) + '%' : '-',
      days: Object.keys(S.days).length,
      streakN: S.streak.n,
      wrongN: store.wrongCount(),
      masteredN: store.masteredCount(),
      examN: S.history.length,
      trend: days,
      trendLabels: days.map((x, i) => (i % 3 === 0 || i === 13) ? x.label : ''),
      trendMax: maxN,
      typeStats: typeStats,
      chapterStats: chapterStats,
      weak: weak,
      history: S.history.slice().reverse().slice(0, 20).map(x => ({
        score: x.score, scope: x.scopeLabel, total: x.total,
        time: logic.fmtDateTime(x.at), dur: logic.fmtDur(x.duration),
        bg: x.score >= 80 ? '#E9F8EF' : x.score >= 60 ? '#FDF3E3' : '#FDECEC',
        color: x.score >= 80 ? '#16A34A' : x.score >= 60 ? '#D97706' : '#DC2626'
      })),
      feedback: S.settings.feedback
    });
  },

  onToggleFeedback() {
    const S = store.S;
    S.settings.feedback = !S.settings.feedback;
    store.save();
    this.setData({ feedback: S.settings.feedback });
    wx.showToast({ title: S.settings.feedback ? '已开启即时反馈' : '已关闭即时反馈', icon: 'none' });
  },

  onClearPractice() {
    wx.showModal({
      title: '提示', content: '确定清除当前练习进度？', confirmText: '清除',
      success: (res) => {
        if (res.confirm) { store.S.practice = null; store.save(); wx.showToast({ title: '已清除', icon: 'none' }); }
      }
    });
  },

  onClearWrong() {
    wx.showModal({
      title: '提示', content: '确定清空未掌握列表？', confirmText: '清空', confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) { store.S.wrong = {}; store.save(); wx.showToast({ title: '已清空', icon: 'none' }); this.onShow(); }
      }
    });
  },

  onClearMastered() {
    wx.showModal({
      title: '提示', content: '清除全部「已掌握」标记？这些题之后恢复正常出现概率。',
      confirmText: '清除', confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) { store.S.mastered = {}; store.save(); wx.showToast({ title: '已清除', icon: 'none' }); this.onShow(); }
      }
    });
  },

  onResetAll() {
    wx.showModal({
      title: '危险操作', content: '将清空全部答题记录、未掌握列表、已掌握标记、考试记录与设置，且不可恢复。确定？',
      confirmText: '全部重置', confirmColor: '#DC2626',
      success: (res) => {
        if (res.confirm) {
          const dflt = { v: 1, qs: {}, wrong: {}, mastered: {}, hidden: {}, practice: null, history: [], days: {}, streak: { last: '', n: 0 }, settings: { feedback: true } };
          Object.keys(store.S).forEach(k => { delete store.S[k]; });
          Object.assign(store.S, dflt);
          store.save();
          wx.showToast({ title: '已重置', icon: 'none' });
          wx.switchTab({ url: '/pages/index/index' });
        }
      }
    });
  },

  onWeakPractice(e) {
    const full = e.currentTarget.dataset.full;
    store.ui.setupMode = 'rand';
    store.ui.setupScope = 'custom';
    store.ui.setupChapters = [full];
    wx.navigateTo({ url: '/pages/setup/setup?mode=rand' });
  },

  onShareAppMessage() {
    return { title: '刷题宝 · 学习报告', path: '/pages/report/report' };
  }
});
