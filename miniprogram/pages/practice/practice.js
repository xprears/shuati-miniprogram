const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');

Page({
  data: {
    // 题目
    q: null,
    qid: '',              // 当前题目的 id，供「解析反馈」跳转使用
    a: { sel: [], flag: false },
    canSubmit: false,     // 多选/填空的「提交答案」是否可点（= 已答完）
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
    nextBtnText: '下一题',
    // 掌握度标记（非测验模式、已判分后可用）
    canMark: false,
    mkM: false,
    mkU: false,
    // 测验
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
      this._backTimer = setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    if (!logic.QLIST.length) {
      wx.showToast({ title: '还没有导入题库', icon: 'none' });
      this._backTimer = setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.renderQuestion();
    if (p.exam) {
      this.startTimer();
      this.armBackGuard();
    }
  },

  onUnload() {
    this.stopTimer();
    if (this._backTimer) clearTimeout(this._backTimer);
  },

  onShow() {
    // 页面回前台：补偿超时判断（定时器可能被节流）
    const p = store.S.practice;
    if (p && p.exam && !p.done && !this.data.selfReview) {
      if (p.exam.endsAt - Date.now() <= 0) {
        this.stopTimer();
        this.gradeExpired();
        return;
      }
    }
    /* 从「修改题目」页返回时题目内容可能已改（logic.reload 过），必须重渲染一次，
       否则屏幕上是旧的题干/选项。selfReview 阶段不重渲染，那是另一套界面。 */
    if (!this.data.selfReview && p && p.ids && p.ids.length) this.renderQuestion();
  },

  /* 退出期间计时不暂停：回到页面发现已超时，先说清楚再按已作答内容交卷，
   * 不然用户只会看到「一进来就 0 分」，以为数据坏了。 */
  gradeExpired() {
    if (this._expirePrompt || this._grading) return;
    this._expirePrompt = true;
    wx.showModal({
      title: '测验已超时',
      content: '计时在退出期间不会暂停，本次测验时间已到，将按已作答内容交卷。未作答的题算错，但不会计入「未掌握」。',
      confirmText: '查看成绩', showCancel: false,
      success: () => { this._expirePrompt = false; this.doGrade(true); },
      fail: () => { this._expirePrompt = false; }
    });
  },

  /* 系统返回键 / 侧滑返回与页面内「退出练习」同一口径。
   * 只有页面按钮弹了确认框时，导航栏返回能直接走人——测验进度与计时都被绕过。 */
  armBackGuard() {
    try {
      if (wx.enableAlertBeforeUnload) {
        wx.enableAlertBeforeUnload({ message: '退出测验？计时不会暂停，超时自动交卷。' });
        this._guarded = true;
      }
    } catch (e) { /* 低版本基础库没有这个能力，退化为仅按钮确认 */ }
  },

  disarmBackGuard() {
    if (!this._guarded) return;
    this._guarded = false;
    try { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); } catch (e) {}
  },

  /* ---------- 渲染 ---------- */
  renderQuestion() {
    const p = store.S.practice;
    if (!p) { wx.navigateBack(); return; }
    if (p.idx >= p.ids.length) { this.finishPractice(); return; }

    const q = logic.QMAP[p.ids[p.idx]];
    if (!q) {
      // 题库被替换/清除：会话里的题号已不存在，退出并引导重新导入
      wx.showToast({ title: '题库已更换，请重新开始练习', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
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

    /* 只有客观题有 answer；主观题（论述/情景/案例/实操）走自评，没有正确答案文本。
     * 原来无条件 q.answer.split('')，主观题必抛 TypeError，按钮点了没反应。 */
    /* 掌握度状态要先算：反馈文案里要带「已标记掌握」（连续答对达标时自动标记） */
    const mkM = store.isMastered(q.id);
    const mkU = !!(store.S.wrong[q.id]);

    /* 填空题：题干分段与逐空输入状态都必须在 JS 算好（WXML 里不能调方法）。
     * val 从 a.sel 取而不是从 data 回读——输入过程只写内存，允许中间任意 setData
     * 都不会把已输入的内容冲掉。 */
    const isBlank = logic.isFillBlank(q);
    let segments = [], blankRows = [];
    if (isBlank) {
      const sb = logic.splitBlanks(q.stem);
      segments = sb.segs.map((s, i) => s.t === 'blank'
        ? { t: 'blank', mark: '（' + s.n + '）', i: i }
        : { t: 'text', v: s.v, i: i });
      const checks = logic.blankCheck(q, a.sel);
      let bi = -1;
      sb.segs.forEach(s => {
        if (s.t !== 'blank') return;
        bi++;
        const c = checks[bi] || { ok: false, accept: [], raw: '' };
        blankRows.push({
          n: s.n,
          val: a.sel[bi] == null ? '' : String(a.sel[bi]),
          cls: fb === null ? '' : (c.ok ? 'ok' : 'bad'),
          /* 展示原始写法（3×10^8|3e8），不展示归一化后的串——用户要照着题库原样记 */
          accept: fb === null ? '' : String(c.raw || '').split('|').join(' / '),
          locked: fb !== null
        });
      });
    }

    let fbTitle = '', fbText = '';
    if (fb !== null && q.options) {
      const ansText = q.type === 'judge' ? (q.answer === '√' ? '正确' : '错误')
        : q.type === 'single' ? q.answer
        : q.answer.split('').join('、');
      if (fb === 1) {
        fbTitle = '✓ 回答正确';
        /* 自动掌握不能悄悄发生：否则用户不知道系统替他改了权重 */
        fbText = '正确答案：' + ansText + (mkM ? ' · 已标记掌握，出现概率降低' : '');
      } else {
        fbTitle = '✗ 回答错误';
        fbText = '正确答案：' + ansText + '，已自动收入未掌握';
      }
    } else if (fb !== null && isBlank) {
      /* 填空是逐空判分：一并给出每空的标准答案，错的那空才看得懂错在哪 */
      const ansText = logic.blankCheck(q, a.sel)
        .map((c, i) => '第' + (i + 1) + '空 ' + c.raw).join('；');
      if (fb === 1) {
        fbTitle = '✓ 全部正确';
        fbText = '正确答案：' + ansText + (mkM ? ' · 已标记掌握，出现概率降低' : '');
      } else {
        fbTitle = '✗ 有错误';
        fbText = '正确答案：' + ansText + '，已自动收入未掌握';
      }
    }

    const ac = this.buildAcard();

    // 掌握度标记：仅非测验模式、判分后才允许（主观题由自评按钮标记）
    const isLast = (p.idx + 1) >= p.ids.length;
    let nextBtnText = '下一题';
    if (isExam) {
      nextBtnText = isLast ? '交卷' : '下一题';
    } else if (fb !== null) {
      nextBtnText = isLast ? '完成练习' : '下一题';
    } else if (feedbackOn) {
      nextBtnText = isLast ? '完成' : '跳过';
    } else {
      nextBtnText = isLast ? '完成练习' : '下一题';
    }

    this.setData({
      qid: q.id,
      q: {
        stem: q.stem,
        typeLabel: logic.TYPE_LABEL[q.type],
        part: logic.partLabel(q.part),
        category: q.category || '',
        wrongTag: (st && st.last === -1) ? '错过 ' + st.w + ' 次' : '',
        options: options,
        isSubj: logic.isSubjective(q),
        isBlank: isBlank,
        segments: segments,
        blanks: blankRows,
        reference: q.reference || '',
        analysis: q.analysis || ''
      },
      a: { sel: a.sel.slice(), flag: a.flag },
      canSubmit: logic.isAnswered(q, a.sel),
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
      nextBtnText: nextBtnText,
      selfReview: null,
      /* 判分后（或关闭反馈时答完）都可标记；主观题没有 options，走自评按钮，测验模式不给标记。
       * 填空题没有 options 但属于客观题，这里必须用 isSubjective 而不是 !q.options。 */
      canMark: !isExam && !logic.isSubjective(q) && (fb !== null || (!feedbackOn && logic.isAnswered(q, a.sel))),
      mkM: mkM,
      mkU: mkU,
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
    if (!q) return;                      // 题库中途被换掉/清掉：题号已不存在，静默退出比抛异常好
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
    if (!q) return;
    const a = curAns();
    if (!logic.isAnswered(q, a.sel)) {
      wx.showToast({ title: logic.isFillBlank(q) ? '请把每个空都填上' : '请先选择答案', icon: 'none' });
      return;
    }
    if (p.fb[q.id] !== undefined) return;
    const ok = logic.isCorrect(q, a.sel);
    p.fb[q.id] = ok ? 1 : -1;
    /* 第三个参数 = 允许自动掌握。测验答对一次不代表掌握，所以只在练习模式传 true */
    store.recordAnswer(q.id, ok, p.mode !== 'exam');
    if (ok) store.removeWrong(q.id); else store.addWrong(q.id);
    store.save();
    this.renderQuestion();
  },

  /* ---------- 填空题输入 ----------
   * 输入过程中绝不 setData：每敲一个字就把 value 回写 data，光标会跳到末尾，
   * 长题干还会明显卡（和导入页 textarea 同一个坑）。这里只写内存里的 a.sel，
   * 失焦 / 提交 / 切题时才落盘；renderQuestion 从 a.sel 读值，所以中途任何
   * 重渲染都不会丢已输入的内容。 */
  onBlankInput(e) {
    const p = store.S.practice;
    if (!p) return;
    const q = logic.QMAP[p.ids[p.idx]];
    if (!q) return;
    if (p.fb[q.id] !== undefined) return;      // 已判分锁定
    const i = Number(e.currentTarget.dataset.i);
    const a = p.ans[q.id] || (p.ans[q.id] = { sel: [], flag: false });
    while (a.sel.length <= i) a.sel.push('');
    a.sel[i] = e.detail.value || '';
  },

  onBlankBlur() { store.save(); },

  judgeSubjective(e) {
    const p = store.S.practice;
    if (!p) return;
    const q = logic.QMAP[p.ids[p.idx]];
    if (!q) return;
    const v = Number(e.currentTarget.dataset.v);
    /* 主观题是自评，点错了必须能改：首次判分记答题次数，改判只改掌握度状态
     * （否则一次误触就把这道题永久锁死，还得去未掌握列表手动捞回来） */
    if (p.fb[q.id] === undefined) store.recordAnswer(q.id, v === 1);
    p.fb[q.id] = v;
    if (v === 1) store.markMastered(q.id); else store.markUnmastered(q.id);
    store.save();
    this.renderQuestion();
  },

  /* 掌握度标记：已掌握 → 降权并移出未掌握；未掌握 → 视同错题入库 */
  onMark(e) {
    const p = store.S.practice;
    if (!p) return;
    const id = e.currentTarget.dataset.id || this.data.qid;
    const v = Number(e.currentTarget.dataset.v);
    if (!id) return;
    if (v === 1) {
      store.markMastered(id);
      wx.showToast({ title: '已标记掌握，出现概率降低', icon: 'none' });
    } else {
      store.markUnmastered(id);
      wx.showToast({ title: '已收入未掌握', icon: 'none' });
    }
    this.renderQuestion();
  },

  onToggleRef() {
    this.setData({ showRef: !this.data.showRef });
  },

  /* 无解析提示条：跳到导入页拿「解析提示词」（那里也能直接合并 AI 返回的解析）
   * 用 navigateTo 而非 switchTab：import 不是 tabBar 页，练习页留在栈里，返回后进度不丢 */
  goAddAnalysis() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  /* 单题纠错：跳编辑页。返回时 onShow 会重渲染，改完立刻看到新内容 */
  goEdit() {
    if (!this.data.qid) return;
    wx.navigateTo({ url: '/pages/edit/edit?qid=' + this.data.qid });
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
      /* 已答口径统一走 logic.isAnswered：填空题填一半不算答过 */
      if (logic.isAnswered(logic.QMAP[id], a && a.sel)) { cls.push('done'); answered++; }
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

  /* ---------- 测验倒计时 ---------- */
  startTimer() {
    this.stopTimer();
    let lastUrgent = this.data.examUrgent;
    const tick = () => {
      const p = store.S.practice;
      if (!p || !p.exam) { this.stopTimer(); return; }
      const left = p.exam.endsAt - Date.now();
      const urgent = left < 60000;
      const patch = { examLeft: logic.fmtClock(left) };
      if (urgent !== lastUrgent) {
        patch.examUrgent = urgent;
        lastUrgent = urgent;
      }
      this.setData(patch);
      if (left <= 0) {
        /* 走 gradeExpired 而不是直接 doGrade：冷启动进入一场早已超时的测验时，
           原来 tick() 同步触发判分，用户一进来就被送到成绩页，完全不知道发生了什么。
           这里先弹说明，确认后再按已作答内容交卷。 */
        this.stopTimer();
        this.gradeExpired();
      }
    };
    tick();
    this._timer = setInterval(tick, 1000);
  },

  stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  /* ---------- 交卷 ---------- */
  submitExam(auto) {
    const p = store.S.practice;
    if (!p || p.mode !== 'exam') return;
    this.stopTimer();
    /* 主观题交卷后才逐题自评，界面上没有任何可选项：把它们算成「未作答」，
       会让每一场含主观题的测验都弹「还有 N 题未作答」，与成绩页的口径也对不上。 */
    const unanswered = p.ids.filter(id => {
      const q = logic.QMAP[id];
      if (!q || logic.isSubjective(q)) return false;
      const a = p.ans[id];
      return !logic.isAnswered(q, a && a.sel);
    }).length;
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
    if (this._grading) return;          // 交卷按钮连点 / 定时器与 onShow 同时触发
    this._grading = true;
    try {
      const base = store.gradeExam();
      if (!base) {
        this._grading = false;
        return;
      }
      this.disarmBackGuard();
      if (base.subjIds.length) {
        this.renderSelfReview(base);
      } else {
        store.finishExam(base, 0);
        wx.redirectTo({ url: '/pages/result/result' });
      }
    } catch (e) {
      this._grading = false;
      console.error('交卷判分异常', e);
      wx.showToast({ title: '交卷失败，请重试', icon: 'none' });
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
        title: '退出测验？',
        content: '计时不会暂停，稍后可从首页「继续测验」接着答；超时会按已作答内容自动交卷，未作答的题不计入未掌握。',
        confirmText: '退出测验', confirmColor: '#DC2626',
        success: (res) => { if (res.confirm) { this.disarmBackGuard(); wx.navigateBack(); } }
      });
    } else {
      wx.navigateBack();
    }
  },

  onShareAppMessage() {
    const p = store.S.practice;
    return { title: p ? p.title : '刷题本子', path: '/pages/index/index' };
  },

  noop() {},

  onShareTimeline() {
    return { title: '刷题本子 · 刷题练习工具' };
  }
});

function curAns() {
  const p = store.S.practice;
  if (!p || !p.ids || p.idx == null) return { sel: [], flag: false };
  const id = p.ids[p.idx];
  if (!id) return { sel: [], flag: false };
  return p.ans[id] || (p.ans[id] = { sel: [], flag: false });
}
