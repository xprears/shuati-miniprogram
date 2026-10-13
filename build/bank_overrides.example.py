# -*- coding: utf-8 -*-
"""题库解析的人工兜底配置（示例 / 模板）。

用法：把本文件复制成 bank_overrides.py，再按自己的题库填写。
parse_bank.py 会自动 import bank_overrides；文件不存在时三项配置为空，解析照常进行。

三项配置：
  OVERRIDE_APPEND   集合 {(章节前缀, 题号), ...}
                    规则判定不出空位、需要在题干末尾补一个「（ ）」的题。
  OVERRIDE_REPLACE  集合 {(章节前缀, 题号), ...}
                    空位被题干里别的括号顶掉、需要插到句中的题。
  RECOVER           列表 [(锚点题干关键字, {题目对象}), ...]
                    原文排版坏掉被自动丢弃、需要按锚点插回的题。题目对象字段与 questions.json 一致
                    （type/stem/options/answer/id，可选 reference），part/chapter/category 由脚本
                    从锚点题自动继承。

章节前缀用章节全名的前几个字即可（如 "第七章"、"第十六章"），题号是原文里的题号（qno）。
改完重跑：python3 build/parse_bank.py
"""

# 示例：第七章第 56 题、第十六章第 41 题需要补末尾空位
OVERRIDE_APPEND = {
    # ("第七章", 56),
    # ("第十六章", 41),
}

# 示例：第七章第 239 题的正确答案空位被「(C/N值)」顶掉，要插回句中
OVERRIDE_REPLACE = {
    # ("第七章", 239),
}

# 示例：某题在原文里排版坏掉被丢弃，按锚点题（题干关键字）插回其后
RECOVER = [
    # ("锚点题的题干关键字", {
    #     "type": "multi", "qno": 61,
    #     "stem": "题干（ ）",
    #     "options": [{"key": "A", "text": "选项A"}, {"key": "B", "text": "选项B"}],
    #     "answer": "AB", "id": "q9001",
    # }),
]
