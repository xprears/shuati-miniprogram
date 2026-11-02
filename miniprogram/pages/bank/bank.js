const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');
const bankStore = require('../../utils/bank-store.js');

function fmtAt(ts) {
  var d = new Date(ts || 0);
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: {
    parts: [],
    empty: false,
    bankName: '',
    bankInfo: '',
    allFolded: false
  },

  onShow() {
    const S = store.S;
    const info = bankStore.info();
    const empty = logic.QLIST.length === 0;
    this.setData({
      empty: empty,
      bankName: (info && info.name) || '',
      bankInfo: info && info.count ? (info.count + ' 题 · 导入于 ' + fmtAt(info.at)) : ''
    });
    if (empty) {
      this.setData({ parts: [], allFolded: false });
      return;
    }
    /* 折叠状态存 S.collapsed[大部全名]，默认不折叠（新用户先看到全貌）；
       用户折过一次之后，下次打开沿用——折起来是为了「这个分类不用看」，
       每次重新展开等于白折。 */
    const parts = logic.TREE.map(p => {
      const key = p.full || p.name;
      let done = 0, total = 0, ansAll = 0, rightAll = 0;
      const chapters = p.chapters.map(c => {
        let doneC = 0, right = 0, ans = 0;
        c.ids.forEach(id => {
          const st = S.qs[id];
          if (st) { ans += st.r + st.w; right += st.r; if (st.r + st.w > 0) doneC++; }
        });
        done += doneC; total += c.count; ansAll += ans; rightAll += right;
        const cats = Object.keys(c.cats);
        return {
          name: c.name,
          count: c.count,
          hidden: !!S.hidden[c.name],
          done: doneC,
          acc: ans ? logic.pct(right, ans) + '%' : '-',
          sub: c.count + ' 题' + (cats.length ? ' · 分类：' + cats.join('、') : '')
        };
      });
      return {
        name: p.label || p.name,
        key: key,
        count: p.count,
        done: done,
        total: total,
        /* 折起来以后章节都在里面，聚合数字留在标题上，不然整块什么都没了 */
        agg: '已练 ' + done + '/' + total + (ansAll ? ' · ' + logic.pct(rightAll, ansAll) + '%' : ''),
        folded: !!S.collapsed[key],
        chapters: chapters
      };
    });
    this.setData({
      parts: parts,
      allFolded: parts.length > 0 && parts.every(x => x.folded)
    });
  },

  onTogglePart(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const S = store.S;
    if (S.collapsed[key]) delete S.collapsed[key]; else S.collapsed[key] = true;
    store.save();
    this.onShow();
  },

  /* 章节多的时候逐个点太慢：全收起 / 全展开一键切换 */
  onToggleAll() {
    const S = store.S;
    if (this.data.allFolded) {
      S.collapsed = {};
    } else {
      logic.TREE.forEach(p => { S.collapsed[p.full || p.name] = true; });
    }
    store.save();
    this.onShow();
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

  goManage() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  /* 空态还缺「先看看长什么样」这一步：示例题库一键进入导入页的已校验状态 */
  goDemo() {
    wx.navigateTo({ url: '/pages/import/import?demo=1' });
  },

  onShareAppMessage() {
    return { title: '刷题本子 · 分类练习', path: '/pages/bank/bank' };
  },

  onShareTimeline() {
    return { title: '刷题本子 · 刷题练习工具' };
  }
});
