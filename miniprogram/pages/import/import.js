// 导入题库页：粘贴 / 聊天会话选文件 -> normalize+validate -> 启用
const logic = require('../../utils/logic.js');
const bankStore = require('../../utils/bank-store.js');
const BV = require('../../utils/bank-validate.js');
const store = require('../../utils/store.js');
const contact = require('../../utils/contact.js');
const confirm = require('../../utils/confirm.js');

/* AI 提示词：唯一事实源是 docs/ai-bank-prompt.md，由 build/gen_prompts.js
 * 生成 utils/prompts.js（含发布态去敏）与 GitHub 上的 skills/bank-json/SKILL.md。
 * 不要在这里手写提示词——2026-10-18 文档整体换版时，这里手抄的浓缩版没跟着换，
 * App 里一直发的是旧版本。
 *
 * 2026-11-02：默认入口改成 SHORT_PROMPT（一句话 + 仓库链接），一万字的
 * PROMPT 降级为「AI 打不开链接时」的兜底。两者同一份文档生成，规则不会漂。 */
const prompts = require('../../utils/prompts.js');
const PROMPT = prompts.PROMPT;
const ANALYSIS_PROMPT = prompts.ANALYSIS_PROMPT;
const SHORT_PROMPT = prompts.SHORT_PROMPT;
const SHORT_ANALYSIS_PROMPT = prompts.SHORT_ANALYSIS_PROMPT;

function fmtKB(bytes) {
  if (!bytes) return '0 KB';
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : Math.round(bytes / 1024) + ' KB';
}
function fmtAt(ts) {
  var d = new Date(ts || 0);
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: {
    hasBank: false,
    info: null,
    step: 0,          // 0 未校验 1 通过 2 失败
    rawLen: 0,
    filled: false,    // true = 模板已由「复制模板」按钮填入 raw（文本框同步显示）
    taValue: '',      // textarea 的受控值：只在「填入模板 / 清空 / 启用」时 setData
    errs: [],
    warns: [],
    parseErr: '',
    result: null,
    analysis: null,   // 粘贴的是解析映射时的合并预览
    showTemplate: false,
    showAnalysis: false,
    fbReady: false,    // 有任何反馈通道才显示「复制报错 / 客服」
    fbCustomer: false  // 微信客服是否启用（后台没配客服人员时关掉，否则点了没反应）
  },

  /* 首页「试用示例题库」：直接带着已校验的 7 题模板进来，一步即可启用 */
  onLoad(options) {
    if (options && options.demo) {
      this.raw = BV.TEMPLATE_TEXT;
      this.setData({ taValue: BV.TEMPLATE_TEXT, rawLen: this.raw.length, filled: true });
      this.tryImport(this.raw, '示例题库');
    }
  },

  onShow() {
    var info = bankStore.info();
    var has = logic.QLIST.length > 0;
    this.setData({
      hasBank: has,
      info: info ? {
        count: info.count, sizeText: fmtKB(info.size), atText: fmtAt(info.at),
        name: info.name || ''
      } : null,
      fbReady: contact.ready(),
      fbCustomer: !!contact.CONTACT.useCustomerService
    });
  },

  /* 改名：只动索引上的名字，不重写题库数据、不动指纹，练习记录完全不受影响。
   * 用 editable 弹窗而不是自建弹层——小程序基础库 2.17+ 原生支持，少一个页面状态。 */
  onRename() {
    var info = bankStore.info();
    if (!info || !info.count) return;
    wx.showModal({
      title: '题库名称（20 字内）',
      editable: true,
      content: info.name || '',
      placeholderText: '例如 电力安全规程 2024',
      confirmText: '保存',
      success: (res) => {
        if (!res.confirm) return;
        var r = bankStore.setName(res.content);
        if (!r.ok) {
          wx.showToast({ title: r.err || '保存失败', icon: 'none' });
          return;
        }
        this.onShow();
        wx.showToast({ title: r.name ? '已改名' : '已清空名称', icon: 'none' });
      }
    });
  },

  /* ---------- 输入（value 只在「清空 / 填入模板」时更新：大文本每次 setData 会卡死渲染） ---------- */
  onInput(e) {
    this.raw = e.detail.value || '';
    this.setData({ rawLen: this.raw.length, filled: false });
  },
  onClearInput() {
    this.raw = '';
    /* 必须把 textarea 的 value 一起清掉：原来只清内存变量，框里文字还在，
      接着点「校验并导入」却报「粘贴的内容为空」——屏幕明明有字 */
    this.setData({ taValue: '', rawLen: 0, filled: false, step: 0, errs: [], warns: [], parseErr: '', result: null, analysis: null });
  },

  /* ---------- 引导材料 ---------- */
  /* 短指令是默认入口：一句话 + 仓库 raw 链接，AI 读完规范自己转。
   * 原来只能整段复制 1.2 万字，在手机上基本没法用。 */
  onCopyShortPrompt() { copy(SHORT_PROMPT, '转换指令已复制，连同题库文档一起发给 AI'); },
  onCopyPrompt() { copy(PROMPT, '完整提示词已复制，去粘贴给 AI 吧'); },
  onCopyShortAnalysisPrompt() { copy(SHORT_ANALYSIS_PROMPT, '解析指令已复制'); },
  onCopyAnalysisPrompt() { copy(ANALYSIS_PROMPT, '完整解析提示词已复制'); },
  onToggleAnalysis() { this.setData({ showAnalysis: !this.data.showAnalysis }); },
  onCopyTemplate() {
    /* 复制的同时把模板填进校验源 this.raw，并把 textarea 的 value 一起更新：
     * 原来只改内存，框里是空的，用户接着点「校验并导入」必然报「粘贴的内容为空」。 */
    this.raw = BV.TEMPLATE_TEXT;
    this.setData({ taValue: this.raw, rawLen: this.raw.length, filled: true });
    copy(BV.TEMPLATE_TEXT, '模板已复制并填入');
  },
  onToggleTemplate() { this.setData({ showTemplate: !this.data.showTemplate }); },

  /* ---------- 校验 ---------- */
  onValidate() {
    if (this.raw && String(this.raw).trim()) {
      this.tryImport(this.raw, '粘贴的内容');
      return;
    }
    /* 输入框为空时回退读剪贴板：用户常是「复制了 JSON 就回来点校验」，
     * 未必手动粘进文本框。剪贴板里不是题库 JSON 时给明确提示，
     * 不要把复制过的提示词文案送进校验报难懂的 JSON 错误。 */
    var self = this;
    wx.getClipboardData({
      success: function (res) {
        var text = res.data || '';
        if (!String(text).trim()) {
          wx.showToast({ title: '粘贴的内容为空', icon: 'none' });
          return;
        }
        if (!looksLikeBankJson(text)) {
          wx.showToast({ title: '剪贴板里不是题库 JSON，请粘贴到输入框', icon: 'none' });
          return;
        }
        self.raw = text;
        self.setData({ rawLen: text.length, filled: false });
        self.tryImport(text, '剪贴板内容');
      },
      fail: function (err) {
        /* 隐私保护指引没同意时，接口报 errno 104 —— 这时说「内容为空」是错的，
           用户会以为是自己的复制出了问题。 */
        var msg = String((err && err.errMsg) || '');
        wx.showToast({
          title: msg.indexOf('privacy') >= 0 ? '需先同意隐私保护指引才能读取剪贴板' : '粘贴的内容为空',
          icon: 'none'
        });
      }
    });
  },

  /* 校验失败时一键把报错原文发出去：只发「导入不了」四个字，谁也定位不了问题。
   * 带上校验错误、JSON 致命错误、粘贴长度、当前题库题数。 */
  onCopyFeedback() {
    if (!contact.ready()) return;
    var text = contact.buildTemplate({
      total: logic.QLIST.length,
      errs: this.data.errs,
      parseErr: this.data.parseErr,
      rawLen: this.data.rawLen,
      page: '导入题库'
    });
    var wxId = contact.CONTACT.wechatId;
    var tip = wxId
      ? '微信号：' + wxId + '\n\n打开微信 → 添加朋友 → 粘贴搜索，把刚复制的内容发我，我看是哪条规则没收下。'
      : '回到本页点「联系客服」，进会话后粘贴发送。';
    wx.setClipboardData({
      data: text,
      success: function () {
        wx.showModal({
          title: '报错已复制',
          content: tip,
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  onChooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        var f = (res.tempFiles || [])[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) {
          wx.showToast({ title: '文件超过 5MB，请精简后重试', icon: 'none' });
          return;
        }
        /* 文件名顺手当题库默认名：粘贴导入没有名字可用，选文件至少有 我的题库.json */
        var base = String(f.name || '').replace(/\.json$/i, '').trim();
        if (base) this._srcName = base.slice(0, 20);
        wx.showLoading({ title: '读取文件中', mask: true });
        wx.getFileSystemManager().readFile({
          filePath: f.path,
          encoding: 'utf8',
          success: (r) => {
            wx.hideLoading();
            /* 文本框里可能还留着之前填入的模板：内容已换成文件，别让它继续误导 */
            this.raw = '';
            this.setData({ taValue: '', rawLen: 0, filled: false });
            this.tryImport(r.data, '文件');
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '文件读取失败', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        var msg = String((err && err.errMsg) || '');
        if (msg.indexOf('cancel') >= 0) return;   // 用户自己取消选择，不该弹提示
        wx.showToast({
          title: msg.indexOf('privacy') >= 0
            ? '需先同意隐私保护指引才能选择文件'
            : '请从微信聊天里打开小程序再选文件，或改用粘贴',
          icon: 'none', duration: 2500
        });
      }
    });
  },

  tryImport(text, from) {
    if (!text || !String(text).trim()) {
      wx.showToast({ title: from + '为空', icon: 'none' });
      return;
    }
    /* 先认「题号 -> 解析」映射（提示词 B 的产物）：这类内容不是题库，
     * 走数组校验只会报「根节点必须是题目数组」，用户在页内也没有合并入口。 */
    var am = BV.parseAnalysisMap(text);
    if (am.ok) {
      var cur = bankStore.load();
      if (!cur.length) {
        wx.showToast({ title: '先导入题库，再合并解析', icon: 'none', duration: 2000 });
        return;
      }
      var r = BV.mergeAnalysis(cur, am.map);
      this.pendingAnalysis = r;
      this.setData({
        step: 0, errs: [], warns: [], parseErr: '', result: null,
        analysis: {
          total: Object.keys(am.map).length,
          hit: r.hit,
          miss: r.miss.length,
          missSample: r.miss.slice(0, 3).join('、')
        }
      });
      return;
    }
    var n = BV.normalize(text);
    if (!n.ok) {
      this.setData({ step: 2, errs: [], warns: [], parseErr: n.err, result: null });
      return;
    }
    var v = BV.validate(n.qs);
    if (v.errs.length) {
      var list = v.errs.slice(0, 10);
      if (v.errs.length > 10) list.push('…另有 ' + (v.errs.length - 10) + ' 处问题，修完这些再刷新');
      this.setData({ step: 2, errs: list, warns: [], parseErr: '', result: null });
      return;
    }
    var st = BV.stat(n.qs);
    this.pending = BV.compact(n.qs);
    this.setData({
      step: 1,
      errs: [],
      warns: v.warns.slice(0, 5),
      parseErr: '',
      result: {
        count: st.total,
        distText: BV.distText(n.qs),
        sizeText: fmtKB(bankStore.utf8Len(JSON.stringify(this.pending))),
        coveredText: st.withAnalysis ? ('已覆盖 ' + st.withAnalysis + '/' + st.total + ' 题') : ''
      }
    });
  },

  /* 合并解析：只改 x 字段并重存，题量/题型/指纹都不变，练习记录不受影响 */
  onMergeAnalysis() {
    var r = this.pendingAnalysis;
    if (!r) return;
    var sv = bankStore.save(r.bank);
    if (!sv.ok) {
      wx.showModal({ title: '无法保存', content: sv.err, showCancel: false });
      return;
    }
    logic.reload(r.bank);
    this.pendingAnalysis = null;
    this.setData({ analysis: null, step: 0, taValue: '', rawLen: 0, filled: false });
    this.raw = '';
    wx.showToast({ title: '已合并 ' + r.hit + ' 题解析', icon: 'success' });
    this.onShow();
  },

  /* ---------- 启用 / 导出 / 清除 ---------- */
  onEnable() {
    if (!this.pending) return;
    var cur = bankStore.info();
    /* 同一套题库重导（指纹相同，含清库后重导）沿用旧名；换了一套则用文件名，没有就留空待命名 */
    var sameBank = !!cur && !!cur.fp && cur.fp === bankStore.fingerprint(this.pending);
    var name = sameBank ? (cur.name || '') : (this._srcName || '');
    var r = bankStore.save(this.pending, { name: name });
    if (!r.ok) {
      wx.showModal({ title: '无法保存', content: r.err, showCancel: false });
      return;
    }
    logic.reload(this.pending);
    /* 换题库：旧记录的题号与新库不一定对得上（两库 id 都从 q0001 起），问一次再走 */
    var changed = store.reconcileBank() === 'changed';
    var count = this.pending.length;
    this.pending = null;
    this.pendingAnalysis = null;
    this.raw = '';
    this._srcName = '';
    this.setData({ taValue: '', rawLen: 0, filled: false, analysis: null });
    var self = this;
    function done() {
      var info = bankStore.info();
      if (info && info.count && !info.name) {
        /* 没名字就地取一个：以后换题库、多题库时，名字是用户唯一能认出「这是哪套」的东西 */
        wx.showModal({
          title: '给题库起个名字',
          editable: true,
          placeholderText: '例如 电力安全规程 2024',
          confirmText: '保存',
          cancelText: '以后再说',
          success: function (res) {
            if (res.confirm) bankStore.setName(res.content);
            wx.navigateBack();
          },
          fail: function () { wx.navigateBack(); }
        });
        return;
      }
      wx.showToast({ title: '已导入 ' + count + ' 题', icon: 'success' });
      self._doneTimer = setTimeout(function () { wx.navigateBack(); }, 900);
    }
    if (changed) {
      wx.showModal({
        title: '题库已更换',
        content: '上一套题库的练习记录按题号与新题库对不上，继续保留可能不准。要清空这些记录吗？',
        confirmText: '清空记录', cancelText: '保留', confirmColor: '#DC2626',
        success: function (res) { if (res.confirm) store.resetStats(); done(); },
        fail: done
      });
    } else done();
  },

  onExport() {
    var qs = bankStore.load();
    if (!qs.length) {
      wx.showToast({ title: '当前没有题库', icon: 'none' });
      return;
    }
    copy(JSON.stringify(qs), '题库 JSON 已复制（' + qs.length + ' 题）');
  },

  onUnload() {
    if (this._doneTimer) clearTimeout(this._doneTimer);
    this.raw = null;
    this.pending = null;
    this.pendingAnalysis = null;
  },

  onClearBank() {
    var info = bankStore.info();
    var n = info ? info.count : 0;
    confirm.confirmDanger({
      title: '清除题库',
      content: '将删除本机的 ' + n + ' 道题' + (info && info.name ? '（' + info.name + '）' : '') + '，需要重新导入才能练习。\n\n答题记录会保留，但换库后按题号匹配不上，可能不准。',
      again: '题库删除后无法恢复（没有云端备份），确认清除？',
      confirmText: '清除题库'
    }, () => {
      bankStore.clear();
      logic.reload();
      this.onShow();
      wx.showToast({ title: '已清除', icon: 'none' });
    });
  }
});

function copy(text, toast) {
  wx.setClipboardData({
    data: text,
    success: () => wx.showToast({ title: toast, icon: 'none' }),
    fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
  });
}

/* 粗判剪贴板内容是否题库 JSON：剥 ``` 围栏后须以 [ 或 { 开头 */
function looksLikeBankJson(text) {
  var t = String(text || '').trim();
  if (!t) return false;
  var f = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (f) t = f[1].trim();
  var c = t.charAt(0);
  return c === '[' || c === '{';
}
