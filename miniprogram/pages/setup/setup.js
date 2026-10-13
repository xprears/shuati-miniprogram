const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

Page({
  data: {
    mode: 'seq',
    modeName: '顺序练习',
    isExam: false,
    isWrong: false,
    scope: 'all',
    scopeChips: [
      { key: 'all', label: '全部题库' },
      { key: 'general', label: '仅通用题' },
      { key: 'custom', label: '自选章节' }
    ],
    chapters: [],
    types: [],
    counts: [],
    durs: [],
    poolN: 0
  },

  onLoad(options) {
    const mode = options.mode || 'seq';
    store.ui.setupMode = mode;
    const isExam = mode === 'exam';
    const isWrong = mode === 'wrong';
    const S = store.S;
    // 章节列表（排除隐藏）
    const chapters = [];
    logic.TREE.forEach(p => {
      p.chapters.forEach(c => {
        if (S.hidden[c.name]) return;
        chapters.push({ name: c.name, part: p.label || p.name, count: c.count, sel: store.ui.setupChapters.indexOf(c.name) >= 0 });
      });
    });
    this.setData({
      mode: mode,
      modeName: logic.SETUP_MODE_NAME[mode],
      isExam: isExam,
      isWrong: isWrong,
      scope: store.ui.setupScope,
      chapters: chapters
    });
    this.refresh();
  },

  refresh() {
    const S = store.S;
    const isExam = this.data.isExam;
    const isWrong = this.data.isWrong;
    const types = logic.TYPE_ORDER.map(t => ({
      key: t, label: logic.TYPE_LABEL[t], on: store.ui.setupTypes.indexOf(t) >= 0
    }));
    const pool = isWrong ? Object.keys(S.wrong)
      : logic.poolIds({ scope: store.ui.setupScope, chapters: store.ui.setupChapters, types: store.ui.setupTypes, hidden: S.hidden });

    let counts = [];
    if (this.data.mode === 'rand' || isExam) {
      const base = [20, 50, 100];
      if (pool.length && base.indexOf(pool.length) < 0) base.push(pool.length);
      counts = base.map(n => ({
        n: n,
        label: (n >= pool.length && pool.length) ? '全部' : n + '题',
        on: store.ui.setupCount === n
      }));
    }
    const durs = isExam ? [30, 60, 90, 120].map(n => ({ n: n, label: n + '分钟', on: store.ui.setupDur === n })) : [];

    this.setData({ types: types, counts: counts, durs: durs, poolN: pool.length });
  },

  onScopeTap(e) {
    store.ui.setupScope = e.currentTarget.dataset.key;
    this.setData({ scope: store.ui.setupScope });
    this.refresh();
  },

  onChapterTap(e) {
    const name = e.currentTarget.dataset.name;
    const arr = store.ui.setupChapters;
    const i = arr.indexOf(name);
    if (i >= 0) arr.splice(i, 1); else arr.push(name);
    const chapters = this.data.chapters.map(c => ({ ...c, sel: arr.indexOf(c.name) >= 0 }));
    this.setData({ chapters: chapters });
    this.refresh();
  },

  onTypeTap(e) {
    const key = e.currentTarget.dataset.key;
    const arr = store.ui.setupTypes;
    const i = arr.indexOf(key);
    if (i >= 0) { if (arr.length > 1) arr.splice(i, 1); }
    else arr.push(key);
    this.refresh();
  },

  onCountTap(e) {
    store.ui.setupCount = Number(e.currentTarget.dataset.n);   // dataset 可能是字符串，统一转数字
    this.refresh();
  },

  onDurTap(e) {
    store.ui.setupDur = Number(e.currentTarget.dataset.n);
    this.refresh();
  },

  onStart() {
    const S = store.S;
    const isWrong = this.data.isWrong;
    const pool = isWrong ? Object.keys(S.wrong)
      : logic.poolIds({ scope: store.ui.setupScope, chapters: store.ui.setupChapters, types: store.ui.setupTypes, hidden: S.hidden });
    if (!pool.length) {
      wx.showToast({ title: '当前范围没有题目', icon: 'none' });
      return;
    }
    const doStart = () => {
      store.startPractice(this.data.mode, pool);
      wx.navigateTo({ url: '/pages/practice/practice' });
    };
    if (S.practice && !S.practice.done) {
      wx.showModal({
        title: '提示',
        content: '已有进行中的「' + S.practice.title + '」，开始新练习将覆盖旧进度。',
        confirmText: '继续',
        success: (res) => { if (res.confirm) doStart(); }
      });
    } else {
      doStart();
    }
  },

  onShareAppMessage() {
    return { title: '应急通信刷题练习设置', path: '/pages/setup/setup' };
  }
});
