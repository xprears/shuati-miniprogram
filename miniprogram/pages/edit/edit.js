/* 单题修改页：题干 / 选项 / 答案 / 参考答案 / 解析
 *
 * 为什么需要这个页面：题库和解析都是用户自己导入或 AI 生成的，题干错字、答案标错
 * 一定会出现。没有修改入口时，用户只能整库重新导入一遍——练习记录全废。
 *
 * 两条关键实现约束：
 * 1. 保存走 bankStore.patchQuestion（内部 save(..., {keepFp:true})）。指纹含「题干长度 +
 *    选项数」，直接 save 会被 store.reconcileBank 判成「换题库」并清掉练习记录。
 * 2. 保存后调 store.invalidateMarks：这道题的旧判定已失效（答案可能刚被改正），
 *    已掌握/未掌握一并摘掉、连续答对清零；历史答题次数 r/w 保留，那是「练过几次」的事实。
 *
 * 原值留底在 S.qedits[qid].before，只在第一次修改时写入，支持「还原为修改前的版本」。
 */
const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');
const bankStore = require('../../utils/bank-store.js');
const BV = require('../../utils/bank-validate.js');

const MAX_OPTIONS = 8;

Page({
  data: {
    qid: '',
    typeLabel: '',
    isSubj: false,
    isBlank: false,
    isJudge: false,
    isMulti: false,
    stem: '',
    options: [],       // [{key, text, on}]  on = 该选项是正确答案
    answer: '',        // judge: √/×   single: 'A'   multi: 'ABC'   主观题/填空题: ''
    blanks: [],        // [{n, val}]  填空题逐空答案（一个空可写 3e8|3×10^8）
    blankN: 0,         // 题干里（ ）的个数，用于提示「答案与空位是否对齐」
    reference: '',
    analysis: '',
    errs: [],
    canRestore: false,
    ready: false
  },

  onLoad(options) {
    const id = (options && options.qid) || '';
    const q = logic.QMAP[id];
    if (!q) {
      wx.showToast({ title: '题目不存在', icon: 'none' });
      this._backTimer = setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.qid = id;
    this.part = q.part;
    this.chapter = q.chapter;
    this.type = q.type;
    /* 题干/参考答案/解析放进 draft 而不是每次按键都 setData：
       题干可能有几百字，逐字符 setData 会明显卡顿。textarea 只在初始化与还原时被赋值。 */
    this.draft = { stem: q.stem || '', reference: q.reference || '', analysis: q.analysis || '' };
    this.opts = (q.options || []).map(o => ({ key: o.key, text: o.text }));
    /* 填空题答案放 this.blanks（内存），和题干一样不在输入时 setData */
    this.blanks = logic.isFillBlank(q) ? logic.blanksOf(q).map(x => String(x == null ? '' : x)) : [];
    this.setData({
      qid: id,
      typeLabel: logic.TYPE_LABEL[q.type] || q.type,
      isSubj: logic.isSubjective(q),
      isBlank: logic.isFillBlank(q),
      isJudge: q.type === 'judge',
      isMulti: q.type === 'multi',
      stem: this.draft.stem,
      reference: this.draft.reference,
      analysis: this.draft.analysis,
      answer: q.answer || '',
      blanks: this.blankRows(),
      blankN: logic.countBlanks(this.draft.stem),
      options: this.markAnswer(q.answer || ''),
      canRestore: !!store.S.qedits[id],
      ready: true
    });
    wx.setNavigationBarTitle({ title: '修改题目 · ' + id });
  },

  onUnload() {
    if (this._backTimer) clearTimeout(this._backTimer);
  },

  /* ---------- 输入 ---------- */
  onStem(e) { this.draft.stem = e.detail.value || ''; this.armGuard(); },
  onRef(e) { this.draft.reference = e.detail.value || ''; this.armGuard(); },
  onAnalysis(e) { this.draft.analysis = e.detail.value || ''; this.armGuard(); },

  onOptionInput(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (!this.opts[i]) return;
    this.opts[i].text = e.detail.value || '';
    this.setData({ options: this.markAnswer(this.data.answer) });
    this.armGuard();
  },

  /* ---------- 填空题答案 ----------
   * 行数由题干里的（ ）个数决定，而不是由已有答案数决定：用户可能刚补了一个空，
   * 也可能删掉一个空，行数必须跟着题干走，否则会出现「多出来的空格子」或「答案没地方填」。 */
  blankRows() {
    const n = logic.countBlanks(this.draft.stem);
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ n: i + 1, val: this.blanks[i] || '' });
    return rows;
  },

  onBlankAnswer(e) {
    const i = Number(e.currentTarget.dataset.i);
    while (this.blanks.length <= i) this.blanks.push('');
    this.blanks[i] = e.detail.value || '';
    this.armGuard();
  },

  /* 改完题干点一下：按新的空位数重排输入行（题干 textarea 是逐字输入的，不能每次按键都重算） */
  onSyncBlanks() {
    const n = logic.countBlanks(this.draft.stem);
    this.setData({ blanks: this.blankRows(), blankN: n });
    this.armGuard();
    wx.showToast({ title: n ? '已按 ' + n + ' 个空位重排' : '题干里还没空位（ ）', icon: 'none' });
  },

  onAddOption() {
    if (this.opts.length >= MAX_OPTIONS) {
      wx.showToast({ title: '最多 ' + MAX_OPTIONS + ' 个选项', icon: 'none' });
      return;
    }
    this.opts.push({ key: String.fromCharCode(65 + this.opts.length), text: '' });
    this.setData({ options: this.markAnswer(this.data.answer) });
    this.armGuard();
  },

  /* 删选项后必须把剩下的选项重新连续编号（校验器要求 A..H 连续），
     并把答案里的字母跟着搬到新编号上，否则答案会指向错的选项。 */
  onRemoveOption(e) {
    if (this.opts.length <= 2) {
      wx.showToast({ title: '至少保留 2 个选项', icon: 'none' });
      return;
    }
    const i = Number(e.currentTarget.dataset.i);
    if (!this.opts[i]) return;
    const oldKeys = this.opts.map(o => o.key);
    oldKeys.splice(i, 1);
    this.opts.splice(i, 1);
    const remap = {};
    this.opts.forEach((o, k) => {
      const nk = String.fromCharCode(65 + k);
      remap[oldKeys[k]] = nk;
      o.key = nk;
    });
    let ans = this.data.answer || '';
    if (!this.data.isJudge) {
      ans = ans.split('').map(ch => remap[ch] || '').join('');
    }
    this.setData({ answer: ans, options: this.markAnswer(ans) });
    this.armGuard();
  },

  onPickAnswer(e) {
    const k = e.currentTarget.dataset.k;
    let ans = this.data.answer || '';
    if (this.data.isMulti) {
      ans = ans.indexOf(k) >= 0
        ? ans.split('').filter(c => c !== k).join('')
        : (ans + k).split('').sort().join('');
    } else {
      ans = k;   // 单选与判断题直接替换
    }
    this.setData({ answer: ans, options: this.markAnswer(ans) });
    this.armGuard();
  },

  markAnswer(answer) {
    const a = String(answer || '');
    return this.opts.map(o => ({ key: o.key, text: o.text, on: a.indexOf(o.key) >= 0 }));
  },

  /* ---------- 未保存提醒 ---------- */
  armGuard() {
    if (this._guarded) return;
    this._guarded = true;
    try {
      if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '修改还没保存，确定离开？' });
    } catch (e) { /* 低版本基础库没有，退化为不提醒 */ }
  },

  disarmGuard() {
    if (!this._guarded) return;
    this._guarded = false;
    try { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); } catch (e) {}
  },

  /* ---------- 保存 ---------- */
  onSave() {
    if (!this.data.ready) return;
    const d = this.draft;
    const isSubj = this.data.isSubj;
    const isBlank = this.data.isBlank;
    /* 填空题答案按「题干里现有几个空」截断：用户删掉一个空后，多出来的旧答案不能跟着存进去 */
    const nBlank = isBlank ? logic.countBlanks(d.stem) : 0;
    const q = {
      id: this.qid,
      type: this.type,
      stem: String(d.stem || '').trim(),
      part: this.part,
      chapter: this.chapter,
      options: (isSubj || isBlank) ? null : this.data.options.map(o => ({ key: o.key, text: String(o.text || '').trim() })),
      answer: (isSubj || isBlank) ? null : (this.data.answer || ''),
      blanks: isBlank ? this.blanks.slice(0, nBlank).map(x => String(x == null ? '' : x).trim()) : null,
      reference: String(d.reference || '').trim() || null,
      analysis: String(d.analysis || '').trim() || null
    };
    const v = BV.validateOne(q);
    if (v.errs.length) {
      this.setData({ errs: v.errs.slice(0, 6) });
      wx.showToast({ title: '还有 ' + v.errs.length + ' 处问题', icon: 'none' });
      return;
    }
    const patch = { s: q.stem, r: q.reference, x: q.analysis };
    if (isBlank) {
      patch.a = q.blanks.length ? q.blanks : null;
      patch.o = null;                       // 填空题不该带选项
    } else {
      patch.a = q.answer;
      if (!isSubj) patch.o = q.options.map(o => [o.key, o.text]);
    }
    const r = bankStore.patchQuestion(this.qid, patch);
    if (!r.ok) {
      wx.showModal({ title: '保存失败', content: r.err || '未知原因', showCancel: false });
      return;
    }
    /* 原值只在第一次修改时留底：多次修改后「还原」应回到最初，而不是回到上一次保存 */
    const S = store.S;
    if (!S.qedits[this.qid]) S.qedits[this.qid] = { at: Date.now(), before: r.before };
    else S.qedits[this.qid].at = Date.now();
    store.save();
    store.invalidateMarks(this.qid);
    logic.reload(r.bank);
    this.setData({ errs: [], canRestore: true });
    this.disarmGuard();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  /* ---------- 还原 ---------- */
  onRestore() {
    const rec = store.S.qedits[this.qid];
    if (!rec || !rec.before) {
      wx.showToast({ title: '没有可还原的版本', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '还原为修改前的版本',
      content: '会把这道题的题干、选项、答案、解析恢复成你第一次修改之前的样子，之前的修改全部丢失。',
      confirmText: '还原',
      confirmColor: '#DC2626',
      success: (res) => {
        if (!res.confirm) return;
        const b = rec.before;
        const patch = {
          s: b.s || '',
          o: b.o === undefined ? null : b.o,
          a: b.a === undefined ? null : b.a,
          r: b.r === undefined ? null : b.r,
          x: b.x === undefined ? null : b.x
        };
        const r = bankStore.patchQuestion(this.qid, patch);
        if (!r.ok) {
          wx.showModal({ title: '还原失败', content: r.err || '未知原因', showCancel: false });
          return;
        }
        delete store.S.qedits[this.qid];
        store.save();
        store.invalidateMarks(this.qid);
        logic.reload(r.bank);
        this.disarmGuard();
        wx.showToast({ title: '已还原', icon: 'none' });
        this.onLoad({ qid: this.qid });
      }
    });
  },

  onShareAppMessage() {
    return { title: '刷题本子', path: '/pages/index/index' };
  }
});
