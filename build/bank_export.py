#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""题库产物的统一导出器（唯一实现）。

- load_analyses(): 汇总 build/explanations/ch*_analysis.json -> {id: 解析}
- compact():       questions(list[dict]) -> 压缩字段列表
- export():        写出 miniprogram/utils/qbank.js（module.exports）

字段约定: i=id t=类型 s=题干 p=大部 c=章节 g=分类 o=选项 a=答案 r=参考答案 x=解析
"""
import json, os, glob, re

BASE = os.path.dirname(os.path.abspath(__file__))
EXP = os.path.join(BASE, 'explanations')
MP = os.path.join(BASE, '..', 'miniprogram', 'utils', 'qbank.js')


def load_analyses(exp=EXP):
    """汇总各章 ch*_analysis.json（id -> 解析）。"""
    m = {}
    for f in sorted(glob.glob(os.path.join(exp, 'ch*_analysis.json'))):
        if re.fullmatch(r'ch\d+_analysis\.json', os.path.basename(f)):
            m.update(json.load(open(f, encoding='utf-8')))
    return m


def compact(qs):
    out = []
    for q in qs:
        d = {"i": q["id"], "t": q["type"], "s": q["stem"], "p": q["part"], "c": q["chapter"]}
        if q.get("options"):
            d["o"] = [[o["key"], o["text"]] for o in q["options"]]
        if q.get("answer") is not None:
            d["a"] = q["answer"]
        if q.get("category"):
            d["g"] = q["category"]
        if q.get("reference"):
            d["r"] = q["reference"]
        if q.get("analysis"):
            d["x"] = q["analysis"]
        out.append(d)
    return out


def export(qs, mp=MP):
    """把题库写成小程序产物（module.exports = [...]）。"""
    payload = json.dumps(compact(qs), ensure_ascii=False, separators=(",", ":"))
    with open(mp, "w", encoding="utf-8") as f:
        f.write("// 题库数据：%d 题（由 build/build_bank.py 生成，勿手改）\n"
                "// 字段: i=id t=类型 s=题干 p=大部 c=章节 g=分类 o=选项 a=答案 r=参考答案 x=解析\n"
                "module.exports = " % len(qs) + payload + ";")
    return payload


if __name__ == '__main__':
    # 自检：统计解析覆盖（无题库时只报解析条数）
    qb_path = os.path.join(BASE, 'questions.json')
    an = load_analyses()
    if os.path.exists(qb_path):
        qb = json.load(open(qb_path, encoding='utf-8'))
        miss = [q['id'] for q in qb if q['id'] not in an]
        print('题库', len(qb), '题；解析', len(an), '条；缺', len(miss))
    else:
        print('未找到 build/questions.json；解析目录共', len(an), '条')
        print('构建产物请用：python3 build/build_bank.py')
