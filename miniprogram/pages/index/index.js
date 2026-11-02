const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');
const bankStore = require('../../utils/bank-store.js');

Page({
  data: {
    total: 0,
    parts: 0,
    chapters: 0,
    totalAns: 0,
    accuracy: '-',
    wrongN: 0,
    streakN: 0,
    bankName: '',
    resume: null,
    recent: [],
    empty: false
  },

  onShow() {
    const S = store.S;
    const empty = logic.QLIST.length === 0;
    const st = store.stats();   // 统计口径统一在 store：只算当前题库里的题，空态归零
    let chapters = 0;
    logic.TREE.forEach(p => { chapters += p.chapters.length; });

    let resume = null;
    if (!empty) {
      const p = S.practice;
      if (p && !p.done && p.ids && p.ids.length) {
        // 如果进行中的题目有任何一道已不在当前题库中，不展示错误的断点
        const valid = p.ids.every(id => !!logic.QMAP[id]);
        if (valid) {
          const answered = p.ids.filter(id => logic.isAnswered(logic.QMAP[id], p.ans[id] && p.ans[id].sel)).length;
          const left = p.exam ? p.exam.endsAt - Date.now() : 0;
          resume = {
            title: p.title,
            progress: Math.min(p.idx + 1, p.ids.length) + '/' + p.ids.length,
            answered: answered,
            /* 测验退出后计时不暂停：这里直接把剩余时间摊开，超时就说超时，
               不要等用户点进去才「一进来就 0 分」 */
            left: p.exam ? (left > 0 ? '剩余 ' + logic.fmtClock(left) : '已超时，点开即交卷') : '',
            btn: p.mode === 'exam' ? (left > 0 ? '继续测验' : '查看成绩') : '继续练习'
          };
        }
      }
    }

    this.setData({
      empty: empty,
      total: logic.QLIST.length,
      parts: logic.TREE.length,
      chapters: chapters,
      bankName: empty ? '' : ((bankStore.info() || {}).name || ''),
      totalAns: st.totalAns,
      accuracy: st.accuracy,
      wrongN: st.wrongN,
      streakN: st.streakN,
      resume: resume,
      recent: empty ? [] : S.history.slice(-3).reverse().map(x => {
        const bg = x.score >= 80 ? '#E9F8EF' : x.score >= 60 ? '#FDF3E3' : '#FDECEC';
        const color = x.score >= 80 ? '#16A34A' : x.score >= 60 ? '#D97706' : '#DC2626';
        return {
          id: x.at,
          score: x.score, scope: x.scopeLabel, total: x.total,
          time: logic.fmtDateTime(x.at), dur: logic.fmtDur(x.duration),
          bg: bg, color: color,
          cls: x.score >= 80 ? 'pass' : x.score >= 60 ? 'mid' : 'fail'
        };
      })
    });
  },

  onModeTap(e) {
    if (!logic.QLIST.length) {
      wx.showToast({ title: '请先导入题库', icon: 'none' });
      return;
    }
    const mode = e.currentTarget.dataset.mode;
    store.ui.setupMode = mode;
    wx.navigateTo({ url: '/pages/setup/setup?mode=' + mode });
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  /* 小白最缺的是「先跑通一遍」：示例题库直接进入导入页的已校验状态，一键启用即可体验 */
  goDemo() {
    wx.navigateTo({ url: '/pages/import/import?demo=1' });
  },

  onResumeTap() {
    wx.navigateTo({ url: '/pages/practice/practice' });
  },

  goReport() {
    wx.switchTab({ url: '/pages/report/report' });
  },

  onShareAppMessage() {
    return { title: '刷题本子 · 刷题练习工具', path: '/pages/index/index' };
  },

  onShareTimeline() {
    return { title: '刷题本子 · 刷题练习工具' };
  }
});
