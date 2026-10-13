#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 build/explanations/ch*_analysis.json 的解析合入题库产物（不重跑 PDF 解析）。

- 读 build/questions.json -> 注入 analysis 字段 -> 回写
- 调 bank_export.export() 重写 miniprogram/utils/qbank.js

用法: python3 build/merge_analysis.py
"""
import json, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import bank_export

QB = os.path.join(BASE, 'questions.json')


def main():
    questions = json.load(open(QB, encoding='utf-8'))
    an = bank_export.load_analyses()
    miss = [q['id'] for q in questions if q['id'] not in an]
    extra = sorted(set(an) - {q['id'] for q in questions})
    for q in questions:
        if q['id'] in an:
            q['analysis'] = an[q['id']]
        else:
            q.pop('analysis', None)
    json.dump(questions, open(QB, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    bank_export.export(questions)
    print('题库', len(questions), '题；注入解析', len(questions) - len(miss), '条；缺', len(miss), miss[:8])
    print('解析中题库外 id:', extra[:8], ' 共', len(extra))
    print('questions.json', os.path.getsize(QB), 'bytes | qbank.js', os.path.getsize(bank_export.MP))


if __name__ == '__main__':
    main()
