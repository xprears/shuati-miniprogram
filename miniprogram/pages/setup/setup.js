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
    typesOnN: 0,
    presets: [],
    counts: [],
    durs: [],
    poolN: 0,
    startN: 0,
    tip: '',
    empty: false
  },

  onLoad(options) {
    const mode = options.mode || 'seq';
    store.ui.setupMode = mode;
    const isExam = mode === 'exam';
    const isWrong = mode === 'wrong';
    const S = store.S;
    /* 题型勾选是全局记忆的，换题库后可能全是新库里没有的题型（题池变 0 且看不出原因），
       这里先收敛到当前题库真实存在的题型 */
    normalizeTypes();
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
    const isExam = this.data.isExam;
    const isWrong = this.data.isWrong;
    const avail = {};
    logic.QLIST.forEach(q => { avail[q.type] = true; });
    const types = logic.TYPE_ORDER.filter(t => avail[t]).map(t => ({
      key: t, label: logic.TYPE_LABEL[t], on: store.ui.setupTypes.indexOf(t) >= 0
    }));
    /* 预设当前态：逐个取消题型后要能一眼看出「现在不是任何一个预设」 */
    const allT = types.map(t => t.key);
    const objT = typesByKind('objective');
    const subT = typesByKind('subjective');
    let preset = 'custom';
    if (sameSet(store.ui.setupTypes, allT)) preset = 'all';
    else if (sameSet(store.ui.setupTypes, objT)) preset = 'objective';
    else if (subT.length && sameSet(store.ui.setupTypes, subT)) preset = 'subjective';
    const presets = [
      { key: 'all', label: '全选', on: preset === 'all', off: false },
      { key: 'objective', label: '仅客观题', on: preset === 'objective', off: false },
      /* 纯主观/纯客观题库里缺的那一档置灰，点了只会有空题池 */
      { key: 'subjective', label: '仅主观题', on: preset === 'subjective', off: !subT.length }
    ];
    const typesOnN = allT.filter(t => store.ui.setupTypes.indexOf(t) >= 0).length;
    const pool = this.currentPool();

    if (!logic.QLIST.length) {
      this.setData({
        empty: true, types: types, typesOnN: 0, presets: [], counts: [], durs: [],
        poolN: 0, startN: 0, tip: ''
      });
      return;
    }

    /* 开始按钮的题量 = 实际抽题数，不是题池总数（原来选 20 题时按钮写着「60 题」）。
       题量选项只留「小于题池」的固定档 + 题池总数（标「全部」）并去重：
       原来 20/50/100 都 ≥ 题池时统统标成「全部」，7 题的库会出现 4 个「全部」。 */
    /* 题量档位：固定档 20/50/100 给「今天想做二十题」这种明确目标，再补比例档
       10% / 25%（大题库里固定档太少：3000 题抽 50 连 2% 都不到）。比例档只在
       池 ≥ 100 时出现，小题库再加只会挤出一堆没意义的数字。最后补「全部」。 */
    let counts = [], startN = pool.length;
    if (pool.length && (this.data.mode === 'rand' || isExam)) {
      const base = [20, 50, 100].filter(n => n < pool.length);
      if (pool.length >= 100) {
        [0.1, 0.25].forEach(r => {
          const n = Math.round(pool.length * r / 10) * 10;   // 取整到十位，不出现「137 题」这种档
          if (n > 0 && n < pool.length) base.push(n);
        });
      }
      const uniq = base.concat([pool.length]).filter((n, i, a) => a.indexOf(n) === i).sort((x, y) => x - y);
      if (uniq.indexOf(store.ui.setupCount) < 0) store.ui.setupCount = uniq[uniq.length - 1];
      counts = uniq.map(n => ({ n: n, label: n === pool.length ? '全部' : n + '题', on: store.ui.setupCount === n }));
      startN = Math.min(store.ui.setupCount, pool.length);
    }
    const durs = isExam ? [30, 60, 90, 120].map(n => ({ n: n, label: n + '分钟', on: store.ui.setupDur === n })) : [];

    this.setData({
      empty: false, types: types, typesOnN: typesOnN, presets: presets,
      counts: counts, durs: durs,
      poolN: pool.length, startN: startN, tip: pool.length ? '' : this.emptyTip()
    });
  },

  /* 当前筛选下的题池：未掌握重练也要尊重「隐藏章节不参与任何练习」的承诺 */
  currentPool() {
    const S = store.S;
    if (this.data.isWrong) {
      return Object.keys(S.wrong).filter(id => {
        const q = logic.QMAP[id];
        return q && !S.hidden[q.chapter];
      });
    }
    return logic.poolIds({
      scope: store.ui.setupScope, chapters: store.ui.setupChapters,
      types: store.ui.setupTypes, hidden: S.hidden
    });
  },

  /* 题池为空时要说清为什么：原来只把按钮变灰，用户不知道是没选章节还是题型没勾 */
  emptyTip() {
    if (this.data.isWrong) return '未掌握清单是空的：答错的题、手动标「未掌握」的题会进这里。';
    if (store.ui.setupScope === 'custom' && !store.ui.setupChapters.length) return '还没选章节：在上面勾选要练的章节';
    const anyType = logic.poolIds({ scope: store.ui.setupScope, chapters: store.ui.setupChapters, types: logic.TYPE_ORDER, hidden: store.S.hidden });
    if (!anyType.length) return '当前范围没有题目：章节可能被隐藏了，去「分类」页恢复';
    return '当前筛选下没有题目：把题型多勾几个试试';
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
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
    if (i >= 0) {
      /* 原来点掉最后一个题型是静默无反应，看着像点坏了；明确告诉用户为什么点不掉 */
      if (arr.length <= 1) {
        wx.showToast({ title: '至少保留一个题型', icon: 'none' });
        return;
      }
      arr.splice(i, 1);
    } else arr.push(key);
    this.refresh();
  },

  /* 题型预设：用「选目标集合」替代「逐个取消」，覆盖全选/仅客观/仅主观三种常用场景；
     逐题 chip 保留，想「只练多选+判断」仍可手动勾 */
  onPresetTypes(e) {
    const kind = e.currentTarget.dataset.kind;
    const arr = kind === 'all' ? typesByKind('all') : typesByKind(kind);
    if (!arr.length) {
      wx.showToast({ title: '这套题库没有主观题', icon: 'none' });
      return;
    }
    store.ui.setupTypes = arr.slice();
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
    if (this._starting) return;
    const S = store.S;
    const pool = this.currentPool();
    if (!pool.length) {
      wx.showToast({ title: '当前范围没有题目', icon: 'none' });
      return;
    }
    const doStart = () => {
      this._starting = true;
      store.startPractice(this.data.mode, pool);
      wx.navigateTo({
        url: '/pages/practice/practice',
        complete: () => { setTimeout(() => { this._starting = false; }, 600); }
      });
    };
    if (S.practice && !S.practice.done) {
      wx.showModal({
        title: '提示',
        content: '已有进行中的「' + S.practice.title + '」，开始新练习将覆盖旧进度。',
        confirmText: '覆盖',
        cancelText: '取消',
        success: (res) => { if (res.confirm) doStart(); }
      });
    } else {
      doStart();
    }
  },

  onShareAppMessage() {
    return { title: '刷题本子 · 练习设置', path: '/pages/setup/setup' };
  },

  onShareTimeline() {
    return { title: '刷题本子 · 刷题练习工具' };
  }
});

/* 题型按「客观/主观」分组：logic.isSubjective 看的是有没有 options 而不是题型名
 * （blank 恒为客观，与判分口径一致），所以必须按当前题库实时算，不能写死题型清单。 */
function typesByKind(kind) {
  const avail = {};
  logic.QLIST.forEach(q => {
    const subj = logic.isSubjective(q);
    if (kind === 'all' || (kind === 'subjective') === subj) avail[q.type] = true;
  });
  return logic.TYPE_ORDER.filter(t => avail[t]);
}

/* 顺序无关的集合比较：setupTypes 的排列取决于用户点击顺序，直接 join 比会误判 */
function sameSet(a, b) {
  if (!a || !b) return false;
  return a.slice().sort().join(',') === b.slice().sort().join(',');
}

/* 勾选题型收敛到当前题库真实有的题型；一个都没剩下就全选 */
function normalizeTypes() {
  const avail = {};
  logic.QLIST.forEach(q => { avail[q.type] = true; });
  const keep = store.ui.setupTypes.filter(t => avail[t]);
  store.ui.setupTypes = keep.length ? keep : logic.TYPE_ORDER.filter(t => avail[t]);
}
