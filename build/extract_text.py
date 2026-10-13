#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PDF / Word / 纯文本 → 标准化文本（题库生产第一步）。

支持输入：
  .pdf            pptplumber 解析（需 pip install pdfplumber）
  .docx           Word 文档，用标准库直接解析（无需额外依赖）；同时提取段落与表格
  .txt / .md      直接读取

输出：每页 / 整篇以 ===PAGE N=== 分隔的文本，交给 parse_bank.py 解析。
（.doc 旧格式无法解析，请先在 Word 里另存为 .docx）

用法：
  python3 build/extract_text.py                    # 自动找项目根目录下的 .pdf / .docx
  python3 build/extract_text.py 题库.docx
  python3 build/extract_text.py 题库.pdf -o build/raw_text.txt

依赖：
  PDF  : pip install pdfplumber
  Word : 无（标准库解析 docx）
"""
import argparse
import glob
import os
import sys
import zipfile
import xml.etree.ElementTree as ET

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def find_source():
    """项目根目录下唯一的 .pdf / .docx（多个时列出让用户指定）。"""
    cands = sorted(glob.glob(os.path.join(ROOT, '*.pdf')) + glob.glob(os.path.join(ROOT, '*.docx')))
    if not cands:
        return None
    if len(cands) > 1:
        print('项目根目录有多个候选文件，请显式指定：')
        for p in cands:
            print('  ', os.path.relpath(p, ROOT))
        return None
    return cands[0]


def read_pdf_lines(path):
    try:
        import pdfplumber
    except ImportError:
        raise SystemExit('缺少依赖 pdfplumber，请先安装：pip install pdfplumber')
    pages = []
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            pages.append('===PAGE %d===\n%s' % (i + 1, page.extract_text() or ''))
    return '\n'.join(pages)


def _para_text(el):
    return ''.join(t.text or '' for t in el.iter(W + 't'))


def read_docx_lines(path):
    """按文档顺序提取段落与表格（表格每行用制表符连接单元格）。"""
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml')
    root = ET.fromstring(xml)
    body = root.find(W + 'body')
    lines = []
    for el in list(body):
        if el.tag == W + 'p':
            lines.append(_para_text(el).strip())
        elif el.tag == W + 'tbl':
            for tr in el.findall(W + 'tr'):
                cells = [_para_text(tc).strip() for tc in tr.findall(W + 'tc')]
                lines.append('\t'.join(cells))
    return lines


def read_text_lines(path):
    return [l.rstrip('\n') for l in open(path, encoding='utf-8', errors='replace')]


def main():
    ap = argparse.ArgumentParser(description='PDF / Word / 文本 → 标准化文本')
    ap.add_argument('src', nargs='?', help='输入文件（默认项目根目录下唯一的 .pdf / .docx）')
    ap.add_argument('-o', '--out', default=os.path.join(BASE, 'raw_text.txt'), help='输出文本路径')
    a = ap.parse_args()

    path = os.path.abspath(a.src) if a.src else find_source()
    if not path or not os.path.exists(path):
        print('找不到输入文件。把题库 PDF / Word 放到项目根目录，或显式传入路径。')
        return 1

    ext = os.path.splitext(path)[1].lower()
    if ext == '.pdf':
        full = read_pdf_lines(path)
    elif ext == '.docx':
        lines = read_docx_lines(path)
        full = '===PAGE 1===\n' + '\n'.join(lines)
    elif ext in ('.txt', '.md'):
        full = '\n'.join(read_text_lines(path))
    elif ext == '.doc':
        print('.doc 是旧版二进制格式，无法解析。请在 Word 里「另存为」.docx 后重试。')
        return 1
    else:
        print('不支持的格式：%s（支持 .pdf / .docx / .txt / .md）' % ext)
        return 1

    with open(a.out, 'w', encoding='utf-8') as f:
        f.write(full)
    print('src  :', os.path.relpath(path, ROOT))
    print('txt  :', os.path.relpath(a.out, ROOT))
    print('chars:', len(full))
    print('\n下一步：python3 build/parse_bank.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
