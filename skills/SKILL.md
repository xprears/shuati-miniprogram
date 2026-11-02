---
name: shuati-bao
description: 把题库文档（PDF / Word / 文本）变成可直接发布的微信小程序刷题应用，或发布「空壳版」——小程序不含题库，由终端用户在 App 内自行粘贴 JSON / 从微信聊天导入。当用户说「做个刷题小程序」「把题库做成小程序」「题库转小程序」「生成刷题 App」「用刷题本子」「刷题练习工具」，或提交了题库文件希望变成应用时使用。技能会拉取仓库、生成小程序并拉起预览。
---

# 刷题本子 · 题库练习小程序

把用户提交的题库文档变成微信小程序，并拉起预览给用户扫码试用。

**全程不需要用户装任何东西**（不要要求用户安装 Python、不要要求用户敲构建命令）——你负责把下面的事做完。

---

## 第 0 步：拿到代码

按顺序判断，选一个：

1. **当前工作目录已经是刷题本子项目**（存在 `miniprogram/` 与 `build/build_bank.js`）→ 直接用它，跳到第 1 步。
2. **用户给了目标目录**，且里面已有项目 → 切到该目录。
3. **都没有** → 克隆一份到用户的工作目录下：

```bash
git clone --depth 1 https://github.com/xprears/shuati-miniprogram.git shuati-bao
```

克隆后所有命令都在 `shuati-bao/` 下执行。若网络不通，让用户提供仓库压缩包解压后再继续。

> 如果用户已经打开了本仓库（技能来自本仓库的 `skills/SKILL.md`），第 1 条就满足，不要重复克隆。

## 第 0.5 步：确定发布形态（默认空壳）

| 形态 | 什么时候用 | 做法 |
| --- | --- | --- |
| **空壳发布（默认）** | 做通用刷题工具上架；题库由终端用户自行导入 | **跳过第 1–3 步**（不生成 qbank.js），直接进第 4 步，发布前跑 `mp-lint.js --release` |
| 预置题库 | 给固定人群交付，用户开箱即刷 | 走完整第 1–4 步，把题库编译进 `miniprogram/utils/qbank.js` |

拿不准就问用户一句：「要内置题库，还是发布空壳版让用户自己导入？」——**没有明确要求内置时，按空壳发布**。

---

## 预置题库形态（可选）：把题库编译进小程序

### 第 1 步：文档 → 标准题库 JSON

读取用户提交的题库文档（PDF / Word / 文本），按 **`docs/ai-bank-prompt.md` 的「提示词 A」** 转成 `build/questions.json`。

关键约束（细节见该文件）：

- 根节点是**数组**，每道题一个对象：`id` / `type` / `stem` / `options` / `answer` / `reference` / `part` / `chapter` / `category` / `qno`
- `type` 只能取：`judge` `single` `multi` `essay` `scenario` `case` `operation`
- **题干空位一律写全角「（ ）」**（U+FF08 + 空格 + U+FF09）；原文把答案字母印在空位里（如「在（B）米及以上」）时要换成「（ ）」
- 客观题 `options` 的 `key` 必须从 A 起连续；`answer`：判断 `√`/`×`、单选单字母、多选 2 个以上字母
- 主观题没有 `options` / `answer`，只有 `reference`
- 选项数不固定（3 项、5 项都合法），不要写死 A–D

**题量大时**（超过 150 题）分批生成，最后合并成一个完整数组；每批之间保持 `id` 连续。写完后**必须复查 JSON 合法性**（无尾逗号、无注释、双引号），可以用 Read 打开检查，或让构建脚本替你报错。

### 第 2 步：解析 JSON（原文有答案要点时才做）

如果文档里带答案解析、参考要点，就按 **`docs/ai-bank-prompt.md` 的「提示词 B」** 生成「题号 → 解析」映射，存为：

```
build/explanations/ch1_analysis.json      # 文件名必须是 ch<数字>_analysis.json
build/explanations/ch2_analysis.json
```

原文没有解析就**跳过这步**，App 里该题不显示解析，不影响使用。

### 第 3 步：生成小程序题库

```bash
node build/build_bank.js
```

零依赖，只要 Node（WorkBuddy 自带）。脚本会校验 id 重复、题型非法、选项键断号、答案越界，并报告解析覆盖到多少题——有 ✗ 就回到第 1 步修 JSON 再跑一次。

---

## 空壳形态（默认）：发布物不含题库

用户拿到的小程序里**没有任何题库**，第一次打开是空态 + 导入引导。终端用户在 App 内完成：

1. 导入页点「复制 AI 提示词」→ 发给任意 AI 并附上题库文档 → 拿到标准 JSON（或直接粘贴已有 JSON 文件内容）
2. 粘贴到文本框，或把 JSON 文件发到微信聊天后「从聊天记录选文件」
3. 实时校验（错误按题号列出）→ 点「启用题库」→ 回首页开刷

校验规则与第 1 步的格式要求**完全一致**（同一个 `utils/bank-validate.js`，Node 与小程序双端复用），所以第 1 步的约束同样是用户导入时的约束。

---

## 第 4 步：静态校验

```bash
node build/mp-lint.js
```

它会检查页面文件齐全、WXML 标签与事件合法、JSON 合法、主包与分包体积。

**空壳发布前必须**：

```bash
rm miniprogram/utils/qbank.js   # 开发副本里可能留着示例题库，发布物不能带（或保留文件、在 packOptions.ignore 中排除）
node build/mp-lint.js --release # 检查「发布物不含 qbank.js」且字面量 require 目标均在包内，不过就是没过
```

> ⚠️ 包内代码（`utils/bank-store.js`）绝不能 `require` qbank.js——被 ignore 排除后发布校验会报
> "Couldn't resolve the Js file"。Node 测试回退由测试脚本经 `bankStore.__setNodeBank` 注入。

## 第 5 步：拉起小程序预览

用 WorkBuddy 的小程序预览能力打开项目里的 `miniprogram/` 目录，生成**小程序产物卡片**，让用户点开卡片、扫码在真机上试。

- 空壳形态：预览时会看到空态引导，可以让用户直接扫码体验一遍「粘贴模板 JSON → 启用」的导入流程（导入页有 8 题型模板，一键复制）。
- 预览面板右上角 **「分享 / Share」→ 发布**：选「试用小程序」出体验版，或「绑定已有小程序」发到用户自己的正式小程序。
- ⚠️ 小程序的「部署」只是把代码登记到应用名下，**不出分享链接**；上传与提审都在预览面板「分享 → 发布」里完成。

## 第 6 步：告诉用户怎么改内容

- **空壳形态**：用户自己在 App 内导入页换题库（粘贴 / 聊天文件），无需任何命令；导入页也支持「导出到剪贴板」备份、「清除题库」。
- **预置形态**：改题库 → 编辑 `build/questions.json` 后重跑 `node build/build_bank.js`；改解析 → 编辑 `build/explanations/ch1_analysis.json` 后重跑同一条命令。
- 改标题 / 配色 → `miniprogram/app.json`（`navigationBarTitleText`、`tabBar`）与 `miniprogram/app.wxss`

---

## 硬性注意

- **不要手改 `miniprogram/utils/qbank.js`** —— 它是构建产物，下次构建即被覆盖。
- **不要手写 App 内提示词**：`miniprogram/utils/prompts.js` 由 `node build/gen_prompts.js` 从 `docs/ai-bank-prompt.md` 的提示词 A / B 抽取生成（同时做发布态去敏：考试/培训/考核/授课/备考/学习 一律替换，残留则脚本报错）。改提示词只改文档，然后重跑生成脚本；`node build/mp-lint.js` 的第 8 项会校验两者是否同版。
- **不要把用户的题库 / 解析提交到 GitHub**：`.gitignore` 已排除 `build/questions.json`、`build/explanations/`、`miniprogram/utils/qbank.js`，不要用 `git add -f` 绕过。
- **空壳发布的隐私声明**：用户用「从聊天记录选文件」导入时，需在小程序后台「用户隐私保护指引」声明「从聊天会话中选择文件」；复制提示词 / 模板用的剪贴板写入一并勾选。漏配会导致选文件接口被静默拦截（导入页会引导改用粘贴）。
- **零后端**：产品不连任何服务器（题库/记录/掌握度全在本地 `wx.storage`），没有账号系统。用户要加云同步/反馈收集时再上后端，默认不要主动引入。
- **反馈走微信客服，不是后端**：报告页 / 导入页报错态各有一个 `<button open-type="contact">`，配一个「复制诊断信息」把版本、题库、统计拼成一段文本让用户粘进会话。`utils/contact.js` 是唯一配置点；**mp 后台没加客服人员时这个按钮点了静默无反应**，配好前把 `CONTACT.useCustomerService` 置 false，否则线上会出现一个坏按钮。
- **题库存储的 key 布局已为多题库预留**：`wb.banks.index`（`{v,active,list}`）+ `wb.bank.<id>.0..N`，主库 id 固定 `main` 且沿用旧前缀 `wb.bank.N`。老存档只有 `wb.bank.meta` 时会自动迁移（首次写操作时落成索引并删掉旧 meta）。改存储**必须**保住这条迁移路径，否则老用户的题库直接消失。当前界面只认 1 个库，开放多库前不要动 `active` 语义。
- **单题修改必须走 `bankStore.patchQuestion`**：它内部用 `save(qs, {keepFp:true})` 沿用旧指纹。指纹含「题干长度 + 选项数」，直接 `save()` 改题干或增删选项会被 `store.reconcileBank` 判成换题库并清掉练习记录（`mp-lint` 第 10 项钉着这条）。
- **破坏性操作一律两跳确认**：清空未掌握 / 清除已掌握 / 清除题库 / 全部重置走 `utils/confirm.js` 的 `confirmDanger`（第一跳写清数量与后果，第二跳只留「不可恢复」）。不要在新加的清空按钮里退回单次 `wx.showModal`。
- **自动掌握只在练习模式生效**：`store.recordAnswer(qid, ok, autoMaster)` 的第三个参数由练习页传 `p.mode !== 'exam'`；测验既不推进 `cs` 也不自动标记。答错必须同时 `delete S.mastered[qid]`（否则同一题会同时计入已掌握与未掌握）。
- 用户的题量、章节结构、题型都可能和示例不同：一切以他的文档为准，不要套用示例里的 12 题或章节名。
- 测试三件套（改完代码必跑）：`node build/mp-logic-test.js`（逻辑层，含导入/分片/迁移/reload）、`node build/mp-practice-regress.js`（练习页与分类/导入/编辑页交互）、`node build/mp-lint.js --release`（静态校验，含单题修改链路检查）。当前基线：62 / 150 / 215。
