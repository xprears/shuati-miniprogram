const store = require('../../utils/store.js');
const logic = require('../../utils/logic.js');
const contact = require('../../utils/contact.js');
const bankStore = require('../../utils/bank-store.js');
const confirm = require('../../utils/confirm.js');

const AUTO_OPTIONS = [
  { v: 0, label: '不自动' },
  { v: 2, label: '连续 2 次' },
  { v: 3, label: '连续 3 次' }
];

Page({
  data: {
    totalAns: 0,
    touchedN: 0,
    bankTotal: 0,
    touchPct: '-',
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
    feedback: true,
    autoMaster: 2,
    autoOptions: AUTO_OPTIONS,
    bankName: '',
    fbReady: false,
    fbCustomer: false,
    fbWechat: '',
    fbEmail: ''
  },

  onShow() {
    const S = store.S;
    const st = store.stats();   // 统计口径统一在 store：只算当前题库里的题，空态归零

    // 近 14 天趋势
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.getFullYear() + '-' + logic.pad(d.getMonth() + 1) + '-' + logic.pad(d.getDate());
      days.push({ key: key, label: (d.getMonth() + 1) + '/' + d.getDate(), n: S.days[key] || 0 });
    }
    const maxN = Math.max.apply(null, days.map(x => x.n).concat([1]));

    // 题型与章节统计（合并为单次遍历）
    const typeStat = {};
    const chStat = {};
    Object.keys(S.qs).forEach(id => {
      const q = logic.QMAP[id];
      if (!q) return;
      const rec = S.qs[id];
      const t = typeStat[q.type] || (typeStat[q.type] = { r: 0, w: 0 });
      t.r += rec.r; t.w += rec.w;
      const c = chStat[q.chapter] || (chStat[q.chapter] = { r: 0, w: 0 });
      c.r += rec.r; c.w += rec.w;
    });

    const typeStats = Object.keys(typeStat)
      .map(t => {
        const x = typeStat[t];
        const p = logic.pct(x.r, x.r + x.w);
        return { name: logic.TYPE_LABEL[t] || t, pct: p, color: p >= 80 ? '#16A34A' : p >= 60 ? '#D97706' : '#DC2626' };
      })
      .sort((a, b) => b.pct - a.pct);
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
      totalAns: st.totalAns,
      /* 去重口径进度：累计答题是次数，同一题刷 5 次算 5，看不出题库覆盖了多少 */
      touchedN: st.touchedN,
      bankTotal: st.bankTotal,
      touchPct: st.bankTotal ? logic.pct(st.touchedN, st.bankTotal) : '-',
      accuracy: st.accuracy,
      days: st.days,
      streakN: st.streakN,
      wrongN: st.wrongN,
      masteredN: st.masteredN,
      examN: st.examN,
      trend: days,
      trendLabels: days.map((x, i) => (i % 3 === 0 || i === 13) ? x.label : ''),
      trendMax: maxN,
      typeStats: typeStats,
      chapterStats: chapterStats,
      weak: weak,
      history: st.noBank ? [] : S.history.slice().reverse().slice(0, 20).map(x => ({
        id: x.at,
        score: x.score, scope: x.scopeLabel, total: x.total,
        time: logic.fmtDateTime(x.at), dur: logic.fmtDur(x.duration),
        bg: x.score >= 80 ? '#E9F8EF' : x.score >= 60 ? '#FDF3E3' : '#FDECEC',
        color: x.score >= 80 ? '#16A34A' : x.score >= 60 ? '#D97706' : '#DC2626'
      })),
      feedback: S.settings.feedback,
      autoMaster: store.autoMasterThreshold(),
      bankName: (bankStore.info() || {}).name || '',
      fbReady: contact.ready(),
      fbCustomer: !!contact.CONTACT.useCustomerService,
      fbWechat: contact.CONTACT.wechatId,
      fbEmail: contact.CONTACT.email
    });
  },

  onToggleFeedback() {
    const S = store.S;
    S.settings.feedback = !S.settings.feedback;
    store.save();
    this.setData({ feedback: S.settings.feedback });
    wx.showToast({ title: S.settings.feedback ? '已开启即时反馈' : '已关闭即时反馈', icon: 'none' });
  },

  /* 自动掌握门槛：连续答对几次自动标记「已掌握」。只在练习模式生效，测验不算 */
  onSetAutoMaster(e) {
    const v = Number(e.currentTarget.dataset.v);
    store.S.settings.autoMaster = v;
    store.save();
    this.setData({ autoMaster: v });
    wx.showToast({ title: v ? '连续答对 ' + v + ' 次即标记掌握' : '已关闭自动标记', icon: 'none' });
  },

  /* 备用通道：复制微信号。主入口是微信客服（open-type="contact"，见 report.wxml），
     这条留着是因为「后台没配客服人员时客服按钮点了没反应」——总得有条能走通的路 */
  onCopyWechat() {
    const id = contact.CONTACT.wechatId;
    if (!id) return;
    wx.setClipboardData({
      data: id,
      success: () => {
        wx.showModal({
          title: '微信号已复制',
          content: id + '\n\n打开微信 → 添加朋友 → 粘贴搜索，加我后把题号或截图发过来。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  onCopyEmail() {
    const mail = contact.CONTACT.email;
    if (!mail) return;
    wx.setClipboardData({
      data: mail,
      success: () => { wx.showToast({ title: '邮箱已复制', icon: 'none' }); }
    });
  },

  /* 诊断信息：微信客服会话只透传聊天内容，不带任何上下文 —— 用户点进去只会打
   * 「导入不进去」。把版本、题库、练习统计拼好让他粘一下，能省掉好几轮来回。 */
  onCopyDiagnostics() {
    const S = store.S;
    const st = store.stats();
    const info = bankStore.info() || {};
    const h = S.history.length ? S.history[S.history.length - 1] : null;
    const text = contact.buildTemplate({
      total: info.count || logic.QLIST.length,
      bankName: info.name || '',
      fp: info.fp || '',
      ansN: st.totalAns,
      touched: st.touchedN + '/' + st.bankTotal,
      acc: st.accuracy,
      wrongN: st.wrongN,
      masteredN: st.masteredN,
      examN: st.examN,
      lastExam: h ? (logic.fmtDateTime(h.at) + ' · ' + h.score + ' 分') : '',
      page: '练习报告'
    });
    wx.setClipboardData({
      data: text,
      success: () => wx.showModal({
        title: '诊断信息已复制',
        content: '进入客服会话后粘贴发送即可。\n\n带上版本号、题库和练习统计，能少来回好几次。',
        showCancel: false,
        confirmText: '知道了'
      }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    });
  },

  /* ---------- 危险操作：统一两跳确认（utils/confirm.js） ---------- */
  onClearPractice() {
    confirm.confirmDanger({
      title: '清除练习进度',
      content: '将丢弃当前这场练习的作答（没提交的不会计入任何记录）。别的数据不受影响。',
      again: '当前练习进度会被丢弃，无法恢复，确认？',
      confirmText: '清除'
    }, () => {
      store.S.practice = null;
      store.save();
      wx.showToast({ title: '已清除', icon: 'none' });
    });
  },

  onClearWrong() {
    const n = store.stats().wrongN;
    confirm.confirmDanger({
      title: '清空未掌握列表',
      content: '将清空 ' + n + ' 道未掌握题，这些题会恢复正常出现概率。答题次数与正确率统计不受影响。',
      again: '这 ' + n + ' 道题的未掌握标记将全部丢失，无法恢复，确认？',
      confirmText: '清空'
    }, () => {
      store.S.wrong = {};
      store.save();
      wx.showToast({ title: '已清空', icon: 'none' });
      this.onShow();
    });
  },

  onClearMastered() {
    const n = store.stats().masteredN;
    confirm.confirmDanger({
      title: '清除已掌握标记',
      content: '将清除 ' + n + ' 道已掌握标记，这些题之后恢复正常出现概率。',
      again: '已掌握标记无法恢复（重新答对可再自动积累），确认？',
      confirmText: '清除'
    }, () => {
      store.S.mastered = {};
      store.save();
      wx.showToast({ title: '已清除', icon: 'none' });
      this.onShow();
    });
  },

  /* 不可逆操作的唯一后路：把记录导出成 JSON 存到剪贴板，用户可以自己存起来。
   * 重置前弹窗里会提示先做这一步。 */
  onExportRecords() {
    const S = store.S;
    const info = bankStore.info() || {};
    const dump = {
      app: '刷题本子',
      v: 1,
      at: new Date().toISOString(),
      bank: { name: info.name || '', count: info.count || 0, fp: info.fp || '' },
      qs: S.qs, wrong: S.wrong, mastered: S.mastered,
      history: S.history, days: S.days, streak: S.streak
    };
    wx.setClipboardData({
      data: JSON.stringify(dump),
      success: () => wx.showToast({ title: '记录已复制，粘到记事本保存', icon: 'none', duration: 2200 }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    });
  },

  onResetAll() {
    confirm.confirmDanger({
      title: '重置所有练习数据',
      content: '将清空全部答题记录、未掌握列表、已掌握标记、测验记录与设置。题库本身和单题修改不受影响。\n\n建议先点「导出练习记录」备份。',
      again: '全部练习数据将被清空且无法恢复，确认重置？',
      confirmText: '全部重置'
    }, () => {
      /* 题库指纹、折叠状态、单题修改留底由 store.resetAll 保留 —— 丢了指纹
         下次启动会被当成「换题库」，平白弹一次清记录询问 */
      store.resetAll();
      wx.showToast({ title: '已重置', icon: 'none' });
      wx.switchTab({ url: '/pages/index/index' });
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
    return { title: '刷题本子 · 练习报告', path: '/pages/report/report' };
  },

  onShareTimeline() {
    return { title: '刷题本子 · 刷题练习工具' };
  }
});
