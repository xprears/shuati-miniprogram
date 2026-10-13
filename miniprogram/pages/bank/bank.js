const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

Page({
  data: {
    parts: []
  },

  onShow() {
    const S = store.S;
    const parts = logic.TREE.map(p => {
      const chapters = p.chapters.map(c => {
        let done = 0, right = 0, ans = 0;
        c.ids.forEach(id => {
          const st = S.qs[id];
          if (st) { ans += st.r + st.w; right += st.r; if (st.r + st.w > 0) done++; }
        });
        const cats = Object.keys(c.cats);
        return {
          name: c.name,
          count: c.count,
          hidden: !!S.hidden[c.name],
          done: done,
          acc: ans ? logic.pct(right, ans) + '%' : '-',
          sub: c.count + ' 题' + (cats.length ? ' · 分类：' + cats.join('、') : '')
        };
      });
      return { name: p.label || p.name, count: p.count, chapters: chapters };
    });
    this.setData({ parts: parts });
  },

  onEyeTap(e) {
    const name = e.currentTarget.dataset.name;
    const S = store.S;
    if (S.hidden[name]) delete S.hidden[name]; else S.hidden[name] = true;
    store.save();
    wx.showToast({ title: S.hidden[name] ? '已隐藏' : '已恢复', icon: 'none', duration: 1200 });
    this.onShow();
  },

  onPracticeTap(e) {
    const name = e.currentTarget.dataset.name;
    const mode = e.currentTarget.dataset.mode;
    store.ui.setupMode = mode;
    store.ui.setupScope = 'custom';
    store.ui.setupChapters = [name];
    wx.navigateTo({ url: '/pages/setup/setup?mode=' + mode });
  },

  onShareAppMessage() {
    return { title: '应急通信理论考核题库分类', path: '/pages/bank/bank' };
  }
});
