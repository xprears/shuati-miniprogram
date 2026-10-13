#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PDF → 纯文本（题库生产第一步）。

用法：
  python3 build/extract_pdf.py                    # 自动取项目根目录下的 .pdf
  python3 build/extract_pdf.py 题库.pdf            # 指定 PDF
  python3 build/extract_pdf.py 题库.pdf -o out.txt # 指定输出

依赖：pip install pdfplumber
产物：build/raw_text.txt（每页以 ===PAGE N=== 分隔，供 parse_bank.py 解析）
"""
import argparse
import glob
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)


def find_pdf():
    pdfs = sorted(glob.glob(os.path.join(ROOT, '*.pdf')))
    if not pdfs:
        return None
    if len(pdfs) > 1:
        print('项目根目录有多个 PDF，请显式指定：')
        for p in pdfs:
            print('  ', os.path.relpath(p, ROOT))
        return None
    return pdfs[0]


def main():
    ap = argparse.ArgumentParser(description='PDF → 纯文本')
    ap.add_argument('pdf', nargs='?', help='PDF 路径（默认项目根目录下唯一的 .pdf）')
    ap.add_argument('-o', '--out', default=os.path.join(BASE, 'raw_text.txt'), help='输出文本路径')
    a = ap.parse_args()

    path = os.path.abspath(a.pdf) if a.pdf else find_pdf()
    if not path or not os.path.exists(path):
        print('找不到 PDF。把题库 PDF 放到项目根目录，或显式传入路径。')
        return 1

    try:
        import pdfplumber
    except ImportError:
        print('缺少依赖 pdfplumber，请先安装：pip install pdfplumber')
        return 1

    with pdfplumber.open(path) as pdf:
        n = len(pdf.pages)
        print('pages:', n)
        chunks = []
        for i, page in enumerate(pdf.pages):
            t = page.extract_text() or ''
            chunks.append('===PAGE %d===\n%s' % (i + 1, t))
        full = '\n'.join(chunks)

    with open(a.out, 'w', encoding='utf-8') as f:
        f.write(full)
    print('pdf :', os.path.relpath(path, ROOT))
    print('txt :', os.path.relpath(a.out, ROOT))
    print('chars:', len(full))
    return 0


if __name__ == '__main__':
    sys.exit(main())
