---
name: shuati-bao
description: 把题库文档（PDF / Word / 文本）变成可直接发布的微信小程序刷题应用。当用户说「做个刷题小程序」「把题库做成小程序」「题库转小程序」「生成刷题 App」「用刷题宝」「把这个 PDF/Word 做成刷题软件」，或提交了题库文件希望变成应用时使用。技能会拉取仓库、把文档转成标准题库 JSON 与解析 JSON、生成小程序并拉起预览。
---

# 刷题宝 · 题库练习小程序

把用户提交的题库文档变成微信小程序，并拉起预览给用户扫码试用。

**全程不需要用户装任何东西**（不要要求用户安装 Python、不要要求用户敲构建命令）——你负责把下面的事做完。

---

## 第 0 步：拿到代码

按顺序判断，选一个：

1. **当前工作目录已经是刷题宝项目**（存在 `miniprogram/` 与 `build/build_bank.js`）→ 直接用它，跳到第 1 步。
2. **用户给了目标目录**，且里面已有项目 → 切到该目录。
3. **都没有** → 克隆一份（在这个技能所在目录，或用户指定的工作目录下）：

```bash
git clone --depth 1 https://github.com/xprears/shuati-miniprogram.git shuati-bao
```

克隆后所有命令都在 `shuati-bao/` 下执行。若网络不通，让用户提供仓库压缩包解压后再继续。

> 如果用户是在本仓库目录里打开 WorkBuddy 的（`.workbuddy/skills/shuati-bao` 就在项目里），那第 1 条已经满足，不要重复克隆。

---

## 第 1 步：文档 → 标准题库 JSON

读取用户提交的题库文档（PDF / Word / 文本），按 **`docs/ai-bank-prompt.md` 的「提示词 A」** 转成 `build/questions.json`。

关键约束（细节见该文件）：

- 根节点是**数组**，每道题一个对象：`id` / `type` / `stem` / `options` / `answer` / `reference` / `part` / `chapter` / `category` / `qno`
- `type` 只能取：`judge` `single` `multi` `essay` `scenario` `case` `operation`
- **题干空位一律写全角「（ ）」**（U+FF08 + 空格 + U+FF09）；原文把答案字母印在空位里（如「在（B）米及以上」）时要换成「（ ）」
- 客观题 `options` 的 `key` 必须从 A 起连续；`answer`：判断 `√`/`×`、单选单字母、多选 2 个以上字母
- 主观题没有 `options` / `answer`，只有 `reference`
- 选项数不固定（3 项、5 项都合法），不要写死 A–D

**题量大时**（超过 150 题）分批生成，最后合并成一个完整数组；每批之间保持 `id` 连续。写完后**必须复查 JSON 合法性**（无尾逗号、无注释、双引号），可以用 Read 打开检查，或让构建脚本替你报错。

## 第 2 步：解析 JSON（原文有答案要点时才做）

如果文档里带答案解析、参考要点，就按 **`docs/ai-bank-prompt.md` 的「提示词 B」** 生成「题号 → 解析」映射，存为：

```
build/explanations/ch1_analysis.json      # 文件名必须是 ch<数字>_analysis.json
build/explanations/ch2_analysis.json
```

原文没有解析就**跳过这步**，App 里该题不显示解析，不影响使用。

## 第 3 步：生成小程序题库

```bash
node build/build_bank.js
```

零依赖，只要 Node（WorkBuddy 自带）。脚本会校验 id 重复、题型非法、选项键断号、答案越界，并报告解析覆盖到多少题——有 ✗ 就回到第 1 步修 JSON 再跑一次。

## 第 4 步：静态校验

```bash
node build/mp-lint.js
```

它会检查页面文件齐全、WXML 标签与事件合法、JSON 合法、主包与分包体积。**主包上限 2MB**：题库大 + 解析长时容易逼近（数千题 + 全量解析约 1.7MB），超了就把 `miniprogram/utils/qbank.js` 挪进分包，或精简解析。

## 第 5 步：拉起小程序预览

用 WorkBuddy 的小程序预览能力打开项目里的 `miniprogram/` 目录，生成**小程序产物卡片**，让用户点开卡片、扫码在真机上试。

- 预览面板右上角 **「分享 / Share」→ 发布**：选「试用小程序」出体验版，或「绑定已有小程序」发到用户自己的正式小程序。
- ⚠️ 小程序**不要**用 sites 类的一键部署（部署预检会拒绝小程序目录），走产物卡片。

## 第 6 步：告诉用户怎么改内容

- 改题库 → 编辑 `build/questions.json` 后重跑 `node build/build_bank.js`
- 改解析 → 编辑 `build/explanations/ch1_analysis.json` 后重跑同一条命令
- 改标题 / 配色 → `miniprogram/app.json`（`navigationBarTitleText`、`tabBar`）与 `miniprogram/app.wxss`
- 解析反馈（可选，需要云服务）→ `miniprogram/pkg-feedback/lib/config.example.js` 复制为 `config.js` 并填 endpoint / publishableKey

---

## 硬性注意

- **不要手改 `miniprogram/utils/qbank.js`** —— 它是构建产物，下次构建即被覆盖。
- **不要把用户的题库 / 解析提交到 GitHub**：`.gitignore` 已排除 `build/questions.json`、`build/explanations/`、`miniprogram/utils/qbank.js`，不要用 `git add -f` 绕过。
- 用户没配云服务时，反馈入口会提示「云服务未配置」——这是预期行为，刷题主功能不受影响，不要当成 bug 去修。
- 用户的题量、章节结构、题型都可能和示例不同：一切以他的文档为准，不要套用示例里的 12 题或章节名。
