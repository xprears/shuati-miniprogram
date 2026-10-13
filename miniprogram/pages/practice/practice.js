const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

let timer = null;

Page({
  data: {
    // 题目
    q: null,
    qid: '',              // 当前题目的 id，供「解析反馈」跳转使用
    a: { sel: [], flag: false },
    fb: null,             // 1 对 / -1 错 / null 未判分（setData 不用 undefined）
    feedbackOn: true,
    isExam: false,
    showRef: false,
    fbTitle: '',
    fbText: '',
    // 进度
    title: '',
    idx: 0,
    total: 0,
    // 考试
    examLeft: '',
    examUrgent: false,
    // 自评
    selfReview: null,
    // 答题卡
    acardOpen: false,
    acardCells: [],
    acardAnswered: 0,
    acardFlagged: 0
  },

  onLoad() {
    const p = store.S.practice;
    if (!p || !p.ids || !p.ids.length) {
      wx.showToast({ title: '没有进行中的练习', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.renderQuestion();
    if (p.exam) this.startTimer();
  },

  onUnload() {
    this.stopTimer();
  },

  onShow() {
    // 页面回前台：补偿超时判断（定时器可能被节流）
    const p = store.S.practice;
    if (p && p.exam && !p.done && !this.data.selfReview) {
      if (p.exam.endsAt - Date.now() <= 0) {
        this.stopTimer();
        this.doGrade(true);
      }
    }
  },

  /* ---------- 渲染 ---------- */
  renderQuestion() {
    const p = store.S.practice;
    if (!p) { wx.navigateBack(); return; }
    if (p.idx >= p.ids.length) { this.finishPractice(); return; }

    const q = logic.QMAP[p.ids[p.idx]];
    const a = p.ans[q.id] || (p.ans[q.id] = { sel: [], flag: false });
    const isExam = p.mode === 'exam';
    const feedbackOn = !isExam && store.S.settings.feedback;
    const raw = feedbackOn ? p.fb[q.id] : undefined;
    const fb = raw === undefined ? null : raw;   // setData 不传 undefined，统一用 null
    const st = store.S.qs[q.id];

    const options = (q.options || []).map(o => {
      let cls = [];
      let hover = 'hover';
      const selected = a.sel.indexOf(o.key) >= 0;
      if (selected) cls.push('sel');
      if (fb !== null) {
        cls.push('locked');
        hover = 'none';   // 锁定态禁用按压效果；WXML 里不能写 .indexOf()，必须在 JS 算好
        const isAns = q.type === 'multi' ? q.answer.indexOf(o.key) >= 0 : o.key === logic.answerKey(q, q.answer);
        if (isAns) cls.push('correct');
        else if (selected) cls.push('wrong');
      }
      return { key: o.key, text: o.text, cls: cls.join(' '), hover: hover };
    });

    let fbTitle = '', fbText = '';
    if (fb !== null) {
      const ansText = q.type === 'judge' ? (q.answer === '√' ? '正确' : '错误')
        : q.type === 'single' ? q.answer
        : q.answer.split('').join('、');
      if (fb === 1) { fbTitle = '✓ 回答正确'; fbText = '正确答案：' + ansText; }
      else { fbTitle = '✗ 回答错误'; fbText = '正确答案：' + ansText + '，已自动收入错题本'; }
    }

    const ac = this.buildAcard();

    this.setData({
      qid: q.id,
      q: {
        stem: q.stem,
        typeLabel: logic.TYPE_LABEL[q.type],
        part: logic.shortPart(q.part),
        category: q.category || '',
        wrongTag: (st && st.last === -1) ? '错过 ' + st.w + ' 次' : '',
        options: options,
        isSubj: !q.options,
        reference: q.reference || '',
        analysis: q.analysis || ''
      },
      a: { sel: a.sel.slice(), flag: a.flag },
      fb: fb,
      feedbackOn: feedbackOn,
      isExam: isExam,
      isMulti: q.type === 'multi',
      showRef: false,
      fbTitle: fbTitle,
      fbText: fbText,
      title: p.title,
      idx: p.idx + 1,
      total: p.ids.length,
      selfReview: null,
      acardCells: ac.cells,
      acardAnswered: ac.answered,
      acardFlagged: ac.flagged
    });

    // 换题回到顶部：原来一直沿用上一题的滚动位置，长题会停在中段/底部，看不到题干与选项
    if (this._lastQid !== q.id) {
      this._lastQid = q.id;
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    }
    wx.setNavigationBarTitle({ title: p.title + ' ' + (p.idx + 1) + '/' + p.ids.length });
  },

  /* ---------- 答题交互 ---------- */
  onOption(e) {
    const p = store.S.practice;
    if (!p) return;
    const q = logic.QMAP[p.ids[p.idx]];
    if (p.fb[q.id] !== undefined) return; // 已判分锁定
    const key = e.currentTarget.dataset.key;
    const a = p.ans[q.id] || (p.ans[q.id] = { sel: [], flag: false });
    if (q.type === 'multi') {
      const i = a.sel.indexOf(key);
      if (i >= 0) a.sel.splice(i, 1); else a.sel.push(key);
      a.sel.sort();
      store.save();
      this.renderQuestion();   // 必须整题重算：选项高亮来自 q.options[].cls，只 setData({a}) 界面不会变
      return;
    }
    a.sel = [key];
    store.save();
    if (p.mode === 'exam' || !store.S.settings.feedback) {
      this.renderQuestion();
      return;
    }
    this.submitCurrent();
  },

  submitCurrent() {
    const p = store.S.practice;
    if (!p) return;
    const q = logic.QMAP[p.ids[p.idx]];
    const a = curAns();
    if (!a.sel.length) { wx.showToast({ title: '请先选择答案', icon: 'none' }); return; }
    if (p.fb[q.id] !== undefined) return;
    const ok = logic.isCorrect(q, a.sel);
    p.fb[q.id] = ok ? 1 : -1;
    store.recordAnswer(q.id, ok);
    if (ok) store.removeWrong(q.id); else store.addWrong(q.id);
    store.save();
    this.renderQuestion();
  },

  judgeSubjective(e) {
    const p = store.S.practice;
    if (!p) return;
    const q = logic.QMAP[p.ids[p.idx]];
    if (p.fb[q.id] !== undefined) return;
    const v = Number(e.currentTarget.dataset.v);
    p.fb[q.id] = v;
    store.recordAnswer(q.id, v === 1);
    if (v === 1) store.removeWrong(q.id); else store.addWrong(q.id);
    store.save();
    this.renderQuestion();
  },

  onToggleRef() {
    this.setData({ showRef: !this.data.showRef });
  },

  /* 解析反馈：跳转到分包表单页（云 SDK 放在分包里，不进主包体积） */
  onFeedback(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pkg-feedback/form/form?id=' + id });
  },

  onPrev() {
    const p = store.S.practice;
    if (!p || p.idx <= 0) return;
    p.idx--;
    store.save();
    this.renderQuestion();
  },

  onNext() {
    const p = store.S.practice;
    if (!p) return;
    if (p.idx >= p.ids.length - 1) {
      if (p.mode === 'exam') this.submitExam(false);
      else this.finishPractice();
      return;
    }
    p.idx++;
    store.save();
    this.renderQuestion();
  },

  onFlag() {
    const p = store.S.practice;
    if (!p) return;
    const a = curAns();
    a.flag = !a.flag;
    store.save();
    this.renderQuestion();   // 标记状态也要同步到答题卡
  },

  onSubmitExam() {
    this.setData({ acardOpen: false });
    this.submitExam(false);
  },

  onFinishFromAcard() {
    this.setData({ acardOpen: false });
    this.finishPractice();
  },

  noop() {},

  /* ---------- 答题卡 ---------- */
  onOpenAcard() {
    const ac = this.buildAcard();
    this.setData({ acardCells: ac.cells, acardAnswered: ac.answered, acardFlagged: ac.flagged, acardOpen: true });
  },

  onCloseAcard() {
    this.setData({ acardOpen: false });
  },

  /* 答题卡格子（纯计算，renderQuestion 与开卡时都调用，避免状态不同步） */
  buildAcard() {
    const p = store.S.practice;
    if (!p) return { cells: [], answered: 0, flagged: 0 };
    let answered = 0, flagged = 0;
    const cells = p.ids.map((id, i) => {
      const a = p.ans[id];
      const cls = [];
      if (a && a.sel.length) { cls.push('done'); answered++; }
      if (a && a.flag) { cls.push('flagged'); flagged++; }
      if (i === p.idx) cls.push('cur');
      if (p.fb[id] === -1) cls.push('mark-wrong');
      if (p.fb[id] === 1) cls.push('mark-right');
      return { n: i + 1, cls: cls.join(' ') };
    });
    return { cells: cells, answered: answered, flagged: flagged };
  },

  onJumpCell(e) {
    const p = store.S.practice;
    if (!p) return;
    const i = Number(e.currentTarget.dataset.i);
    p.idx = i;
    store.save();
    this.setData({ acardOpen: false });
    this.renderQuestion();
  },

  /* ---------- 考试倒计时 ---------- */
  startTimer() {
    this.stopTimer();
    const tick = () => {
      const p = store.S.practice;
      if (!p || !p.exam) { this.stopTimer(); return; }
      const left = p.exam.endsAt - Date.now();
      this.setData({ examLeft: logic.fmtClock(left), examUrgent: left < 60000 });
      if (left <= 0) {
        this.stopTimer();
        this.doGrade(true);
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  },

  stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  },

  /* ---------- 交卷 ---------- */
  submitExam(auto) {
    const p = store.S.practice;
    if (!p || p.mode !== 'exam') return;
    this.stopTimer();
    const unanswered = p.ids.filter(id => !p.ans[id] || !p.ans[id].sel.length).length;
    if (!auto && unanswered > 0) {
      wx.showModal({
        title: '提示',
        content: '还有 ' + unanswered + ' 题未作答，确定交卷？未作答按错误计。',
        confirmText: '确定交卷',
        success: (res) => { if (res.confirm) this.doGrade(false); }
      });
    } else {
      this.doGrade(auto);
    }
  },

  doGrade(auto) {
    const base = store.gradeExam();
    if (!base) return;
    if (base.subjIds.length) {
      this.renderSelfReview(base);
    } else {
      store.finishExam(base, 0);
      wx.redirectTo({ url: '/pages/result/result' });
    }
  },

  renderSelfReview(base) {
    const sr = { ids: base.subjIds, idx: 0, results: {}, base: base };
    this.selfReview = sr;
    const q = logic.QMAP[sr.ids[0]];
    this.setData({
      selfReview: {
        qid: sr.ids[0],
        idx: 1,
        total: sr.ids.length,
        stem: q.stem,
        typeLabel: logic.TYPE_LABEL[q.type],
        reference: q.reference || '（无）',
        analysis: q.analysis || ''
      }
    });
    wx.setNavigationBarTitle({ title: '主观题自评' });
  },

  onSelfReviewJudge(e) {
    const sr = this.selfReview;
    if (!sr) return;
    const v = Number(e.currentTarget.dataset.v);
    const id = sr.ids[sr.idx];
    sr.results[id] = v;
    sr.idx++;
    if (sr.idx >= sr.ids.length) {
      store.submitSelfReview(sr.results, sr.base);
      wx.redirectTo({ url: '/pages/result/result' });
      return;
    }
    const q = logic.QMAP[sr.ids[sr.idx]];
    this.setData({
      selfReview: {
        qid: sr.ids[sr.idx],
        idx: sr.idx + 1,
        total: sr.ids.length,
        stem: q.stem,
        typeLabel: logic.TYPE_LABEL[q.type],
        reference: q.reference || '（无）',
        analysis: q.analysis || ''
      }
    });
  },

  /* ---------- 结束练习 ---------- */
  finishPractice() {
    const r = store.finishPractice();
    if (r) wx.redirectTo({ url: '/pages/result/result' });
    else wx.navigateBack();
  },

  onBackTap() {
    const p = store.S.practice;
    if (p && p.mode === 'exam' && !p.done) {
      wx.showModal({
        title: '提示', content: '退出考试？当前答题进度已保存，稍可从首页继续。',
        confirmText: '退出考试', confirmColor: '#DC2626',
        success: (res) => { if (res.confirm) wx.navigateBack(); }
      });
    } else {
      wx.navigateBack();
    }
  },

  onShareAppMessage() {
    const p = store.S.practice;
    return { title: p ? p.title : '刷题宝', path: '/pages/index/index' };
  }
});

function curAns() {
  const p = store.S.practice;
  const id = p.ids[p.idx];
  return p.ans[id] || (p.ans[id] = { sel: [], flag: false });
}
