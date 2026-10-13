#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""题库构建入口：把 questions.json（+ 解析）编译成小程序题库产物。

产物：
  miniprogram/utils/qbank.js  -> module.exports = [...]   （小程序读取）

用法：
  python3 build/build_bank.py                    # 用 build/questions.json 构建
  python3 build/build_bank.py --sample           # 用内置示例题库构建（先看效果）
  python3 build/build_bank.py -i 我的题库.json    # 指定题库文件
  可选参数：
    --no-analysis       不注入解析
    --out-mp            自定义输出路径（例如输出到 /tmp 试跑）
"""
import argparse
import glob
import json
import os
import re
import sys
from collections import Counter

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
sys.path.insert(0, BASE)
import bank_export  # noqa: E402  （压缩/导出唯一实现）

SAMPLE_DIR = os.path.join(BASE, 'sample')
TYPES = ('judge', 'single', 'multi', 'essay', 'scenario', 'case', 'operation')
TYPE_CN = {'judge': '判断题', 'single': '单选题', 'multi': '多选题', 'essay': '论述题',
           'scenario': '情景判断题', 'case': '案例分析题', 'operation': '实操模拟题'}


def rel(p):
    r = os.path.relpath(p, ROOT)
    return p if r.startswith('..') else r


def load_analyses(exp_dir, sample=False):
    """读取 id -> 解析 映射。
    - 常规模式：只认 chN_analysis.json（与 build/explanations/ 命名约定一致）
    - 示例模式：读 sample 目录下全部 *.json
    """
    m = {}
    if not os.path.isdir(exp_dir):
        return m
    pattern = '*.json' if sample else 'ch*_analysis.json'
    for f in sorted(glob.glob(os.path.join(exp_dir, pattern))):
        if not sample and not re.fullmatch(r'ch\d+_analysis\.json', os.path.basename(f)):
            continue
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception as e:
            print('  ! 跳过无法解析的文件 %s：%s' % (rel(f), e))
            continue
        if not isinstance(d, dict):
            print('  ! 跳过非映射结构的文件 %s（应为 {"题号": "解析"}）' % rel(f))
            continue
        m.update({k: v for k, v in d.items() if isinstance(v, str)})
    return m


def validate(qs):
    """轻量格式校验：只报明显会跑挂的错，不阻断构建。"""
    errs, warns = [], []
    for i, c in Counter(q.get('id') for q in qs).items():
        if i and c > 1:
            errs.append('id 重复：%s ×%d' % (i, c))
    for q in qs:
        tag = q.get('id') or '(缺 id)'
        t = q.get('type')
        for k in ('id', 'type', 'stem', 'part', 'chapter'):
            if not q.get(k):
                errs.append('%s 缺必填字段 %s' % (tag, k))
        if t not in TYPES:
            errs.append('%s 题型非法 %r（可选：%s）' % (tag, t, '/'.join(TYPES)))
            continue
        if t in ('judge', 'single', 'multi'):
            opts = q.get('options') or []
            keys = [o.get('key') for o in opts]
            want = [chr(ord('A') + i) for i in range(len(keys))]
            if keys != want:
                errs.append('%s 选项键须从 A 起连续编号，当前 %s' % (tag, keys or '无'))
            if any(not (o.get('text') or '').strip() for o in opts):
                errs.append('%s 存在空选项文本' % tag)
            a = q.get('answer') or ''
            if t == 'judge' and a not in ('√', '×'):
                errs.append('%s 判断题答案须为 √ 或 ×，当前 %r' % (tag, a))
            if t == 'single' and not re.fullmatch(r'[A-H]', a):
                errs.append('%s 单选题答案须为单个字母，当前 %r' % (tag, a))
            if t == 'multi' and not re.fullmatch(r'[A-H]{2,8}', a):
                errs.append('%s 多选题答案须为 2 个以上字母，当前 %r' % (tag, a))
            if a and any(c not in keys for c in a if c not in ('√', '×')):
                errs.append('%s 答案含不存在的选项：%s' % (tag, a))
        else:
            if not (q.get('reference') or '').strip():
                warns.append('%s 主观题无 reference（参考要点），App 里将显示空' % tag)
    return errs, warns


def main():
    ap = argparse.ArgumentParser(description='题库构建：questions.json -> miniprogram/utils/qbank.js')
    ap.add_argument('-i', '--input', help='题库 JSON 路径（默认 build/questions.json）')
    ap.add_argument('--sample', action='store_true', help='用 build/sample/ 内置示例题库构建')
    ap.add_argument('--no-analysis', action='store_true', help='不注入解析')
    ap.add_argument('--out-mp', help='输出路径（默认 miniprogram/utils/qbank.js）')
    a = ap.parse_args()

    sample = a.sample
    if a.input:
        bank_path = os.path.abspath(a.input)
    elif sample:
        bank_path = os.path.join(SAMPLE_DIR, 'questions.sample.json')
    else:
        bank_path = os.path.join(BASE, 'questions.json')
        if not os.path.exists(bank_path):
            sample = True
            bank_path = os.path.join(SAMPLE_DIR, 'questions.sample.json')
            print('未找到 build/questions.json，已自动改用内置示例题库。')
            print('（放好你自己的题库后重跑本脚本即可，示例数据仅用于预览界面。）\n')

    if not os.path.exists(bank_path):
        print('题库文件不存在：%s' % bank_path)
        return 1
    qs = json.load(open(bank_path, encoding='utf-8'))
    if not isinstance(qs, list):
        print('题库根节点必须是数组（[{题目对象}, ...]）')
        return 1
    print('题库：%s（%d 题）' % (rel(bank_path), len(qs)))

    errs, warns = validate(qs)
    if errs:
        print('\n发现 %d 处格式错误（构建继续，但 App 里可能出现异常）：' % len(errs))
        for e in errs[:20]:
            print('  ✗', e)
        if len(errs) > 20:
            print('  ... 另有 %d 处' % (len(errs) - 20))
    for w in warns[:10]:
        print('  ! ', w)

    if a.no_analysis:
        an = {}
        print('\n解析：已按参数跳过')
    else:
        exp_dir = os.path.join(SAMPLE_DIR, 'explanations') if sample else os.path.join(BASE, 'explanations')
        an = load_analyses(exp_dir, sample=sample)
        for q in qs:
            if q.get('id') in an:
                q['analysis'] = an[q['id']]
        have = sum(1 for q in qs if (q.get('analysis') or '').strip())
        miss = [q.get('id') for q in qs if not (q.get('analysis') or '').strip()]
        print('\n解析：来源 %s，命中 %d/%d 题' % (rel(exp_dir), have, len(qs)))
        if miss:
            print('  未覆盖 %d 题（App 中该题不显示解析）：%s%s'
                  % (len(miss), ', '.join(miss[:8]), ' ...' if len(miss) > 8 else ''))

    mp = a.out_mp or bank_export.MP
    bank_export.export(qs, mp=mp)

    print('\n题型分布：' + '，'.join('%s %d' % (TYPE_CN.get(k, k), v)
                                     for k, v in Counter(q['type'] for q in qs).most_common()))
    print('产物：')
    print('  %-38s %8.1f KB' % (rel(mp), os.path.getsize(mp) / 1024))
    print('\n小程序主包上限 2MB：解析全量注入后若逼近上限，可把题库挪进分包。')
    return 0 if not errs else 2


if __name__ == '__main__':
    sys.exit(main())
