# -*- coding: utf-8 -*-
import os, re, json, itertools
from collections import OrderedDict, Counter

BASE = os.path.dirname(os.path.abspath(__file__))
RAW = os.environ.get("BANK_RAW") or os.path.join(BASE, "raw_text.txt")
OUT = os.environ.get("BANK_OUT") or os.path.join(BASE, "questions.json")

TYPE_MAP = {
    "判断题": "judge", "单选题": "single", "多选题": "multi",
    "论述题": "essay", "情景判断题": "scenario", "案例分析题": "case",
    "实操模拟题": "operation", "论述及计算题": "essay",
}
FW = {ord('Ａ')+i: chr(ord('A')+i) for i in range(26)}
def norm(s): return s.translate(FW)

lines = open(RAW, encoding="utf-8").read().splitlines()
clean = []
for l in lines:
    s = l.strip()
    if re.match(r"^===PAGE \d+===$", s): continue
    if re.match(r"^\d+/\d+$", s): continue
    clean.append(norm(l))

re_part    = re.compile(r"^([一二三四五])、(.+)$")
re_chapter = re.compile(r"^第([一二三四五六七八九十百]+)章\s*(判断题|单选题|多选题|论述题|情景判断题|案例分析题|实操模拟题|论述及计算题)【(\d+)题】\s*$")
re_cat     = re.compile(r"^第([一二三四五六七八九十]+)类\s*(.+?)【(\d+)题】\s*$")
re_qstart  = re.compile(r"^(\d+)、\s*(.*)$")
ANS_RE = re.compile(r"[（(]\s*([A-H]{1,8}|[√×])\s*[）)]")
OPT_BOUND = re.compile(r"(?<![A-H])([A-H])[ \t]*[\.．、]")
OPT_BOUND_A = re.compile(r"(?<![A-H])A[ \t]*(?:[\.．、]|(?=\d))")

def find_boundaries(text):
    out = [(bm.group(1), bm.start(), bm.end()) for bm in OPT_BOUND.finditer(text)]
    for bm in OPT_BOUND_A.finditer(text):
        out.append(("A", bm.start(), bm.end()))
    out.sort(key=lambda x: x[1])
    return out

def clean_text(s):
    s = re.sub(r"\s*\n\s*", "", s)
    s = re.sub(r"[ \u3000]+", " ", s)
    return s.strip()

def collapse_dup(text, key):
    """折叠选项内自我重复边界，如 '中继器B.中继器' -> '中继器'"""
    pat = re.compile(r"^(.*?)(?<![A-H])" + key + r"[ \t]*[\.．、](.*)$")
    m = pat.match(text)
    if m:
        a, b = m.group(1), m.group(2)
        if b == a or (len(a) >= 2 and b.startswith(a)):
            return a
    return text

def select_occurrences(cands, letters):
    best = None
    for combo in itertools.product(*[cands[L] for L in letters]):
        pos = sorted(combo)
        span = pos[-1][0] - pos[0][0]
        key = (span, tuple(p[0] for p in pos))
        if best is None or key < best[0]:
            best = (key, {L: c for L, c in zip(letters, combo)})
    return best[1] if best else None

def try_parse_options(tail, need_letters=None):
    cands = {}
    for L, s0, e0 in find_boundaries(tail):
        cands.setdefault(L, []).append((s0, e0))
    present = sorted(cands.keys())
    k = 0
    while chr(ord('A')+k) in cands and k < 8: k += 1
    if need_letters:
        mx = max(ord(c) - ord('A') for c in need_letters) + 1
        while k < mx and k < 8:
            L = chr(ord('A')+k)
            if L in cands: k += 1
            else: break
    if k < 2: return None
    letters = [chr(ord('A')+i) for i in range(k)]
    # 单缺口补号：把多出来的那个字母并入选择，输出时改键名
    extra = [L for L in present if L not in letters]
    rename = None
    sel_letters = list(letters)
    if len(extra) == 1 and ord(extra[0]) - ord('A') == k + 1:
        rename = (extra[0], chr(ord('A')+k))
        sel_letters.append(extra[0])
    pos = select_occurrences(cands, sel_letters)
    if not pos: return None
    doc = sorted(pos.items(), key=lambda kv: kv[1][0])
    texts = {}
    for idx, (L, (s0, e0)) in enumerate(doc):
        nxt = doc[idx+1][1][0] if idx+1 < len(doc) else len(tail)
        t = clean_text(tail[e0:nxt]).strip(" 。；;.")
        texts[L] = t
    if any(not texts[L] for L in sel_letters): return None
    options = []
    for L in letters:
        options.append({"key": L, "text": collapse_dup(texts[L], L)})
    if rename:
        L0, L1 = rename
        options.append({"key": L1, "text": collapse_dup(texts[L0], L1)})
    first_pos = min(p[0] for p in pos.values())
    return options, first_pos

# ===== 空位还原 =====
# 原 PDF 把单选题/多选题的正确答案字母直接印在题干空位处，形如「在（B）米及以上」。
# 旧解析把「（B）」整段剥掉，导致空位消失（题干变成「在米及以上」，易混淆）。
# 现改为：识别被剥掉的标记是「空位」还是「句末答案键」，是空位则补回全角空括号「（ ）」。
BLANK = "（ ）"
BLANK_RE = re.compile(r"[（(]\s*[）)]")
SEP_RE = re.compile(r"[、，；;,]")
END_BLANK_RE = re.compile(r"[（(]\s*[）)]$")
BLANK_LOG = []

def _has_content(s):
    """去掉标点/空白后是否还有实质内容"""
    PUNCT = "，。、；：,. ;:!！?？（）()“”\"‘’—…-"
    return bool("".join(c for c in s if c not in PUNCT).strip())

def _ends_with_blank(s):
    return bool(END_BLANK_RE.search(s.rstrip("。.？?！! \u3000")))

def _slot_count(qtype, options, ans):
    """本题一共需要几个空位。
    多选：答案字母个数（每个空对应一个选项）；
    单选：各选项若为同一套并列模板（分隔符数量一致），空位数=分隔符数+1，否则视为 1 个空。
    """
    if qtype == "multi":
        return len(ans)
    seps = {len(SEP_RE.findall(o["text"])) for o in options}
    if len(seps) == 1:
        return seps.pop() + 1
    return 1

def parse_objective(text, qtype):
    ans_fmt = {"judge": r"^[√×]$", "single": r"^[A-H]$", "multi": r"^[A-H]{2,8}$"}[qtype]
    parens = [m for m in ANS_RE.finditer(text) if re.match(ans_fmt, m.group(1))]
    if not parens: return None
    if qtype == "judge":
        m = parens[-1]
        stem = clean_text(text[:m.start()] + text[m.end():]).rstrip("。.")
        return stem, [{"key":"A","text":"正确"},{"key":"B","text":"错误"}], m.group(1)
    best = None
    for m in reversed(parens):
        r = try_parse_options(text[m.end():], need_letters=m.group(1))
        if r:
            options, first_pos = r
            key = (len(options), m.start())
            if best is None or key > best[0]:
                best = (key, m, options, first_pos)
    if not best: return None
    _, m, options, first_pos = best
    ans = m.group(1)
    head, tail = text[:m.start()], text[m.end():]
    pre, post = clean_text(head), clean_text(tail[:first_pos])
    # 判定被消费的答案标记是「题干空位」还是「附在句末的答案键」
    insert_blank = False
    if _has_content(post):
        # 标记后面还有正文 => 空位在句子中间；除非紧跟在句末标点后（那是答案键）
        if not (pre and pre[-1] in "。）)】!！?？"):
            insert_blank = True
    else:
        # 标记落在题干末尾：仅当题干里已出现空括号、且该空位数量还差一个时才补
        # （末尾单独一个空位的题（如「…属于室外设备是」）读起来不歧义，不动它）
        joined = pre + post
        n_blank = len(BLANK_RE.findall(joined))
        key_like = bool(pre) and pre[-1] in "。）)】!！?？"
        if (n_blank >= 1) and (not key_like) and (not _ends_with_blank(joined)):
            if qtype == "multi":
                dangling = joined[-1:] in "，,、和及与或"
                if dangling and n_blank < len(ans):
                    insert_blank = True
            elif n_blank < _slot_count(qtype, options, ans):
                insert_blank = True
    stem = (pre + BLANK + post) if insert_blank else (pre + post)
    stem = re.sub(r"[（(]\s*[A-H]{1,8}\s*[）)]\s*[。\.]?\s*$", "", stem).strip()
    stem = re.sub(r"[ \t]*[A-H][ \t]*[\.．、]?[ \t]*$", "", stem).strip()
    stem = stem.rstrip("。.")
    if not stem: return None
    if any(c not in [o["key"] for o in options] for c in ans): return None
    if insert_blank:
        BLANK_LOG.append((chapter_full, cur_qno, "句中" if _has_content(post) else "句末", stem))
    return stem, options, ans

SUBJ_SPLIT = re.compile(r"答案要点|参考答案|答案：")
part_full = chapter_full = cat = None
ch_type = None
questions, warn = [], []
cur_block, cur_qno = [], None

def close_block():
    global cur_block, cur_qno
    if cur_qno is None:
        cur_block = []; return
    text = "\n".join(cur_block)
    q = None
    if ch_type in ("judge", "single", "multi"):
        r = parse_objective(text, ch_type)
        if r is None:
            warn.append(f"[{chapter_full}] q{cur_qno}: {clean_text(text)[:70]}")
        else:
            stem, options, ans = r
            q = {"type": ch_type, "stem": stem, "options": options, "answer": ans}
    else:
        full = re.sub(r"[ \t]+", " ", text).strip()
        m = SUBJ_SPLIT.search(full)
        qtext, ref = (full[:m.start()].strip(), full[m.start():].strip()) if m else (full, "")
        ref = re.sub(r"^(答案要点|参考答案|答案：)\s*", "", ref).strip()
        q = {"type": ch_type, "stem": qtext, "options": None, "answer": None, "reference": ref}
    if q:
        q["id"] = f"q{len(questions)+1:04d}"
        q["part"] = part_full; q["chapter"] = chapter_full
        q["category"] = cat; q["qno"] = cur_qno
        questions.append(q)
    cur_block = []; cur_qno = None

SUBJ = {"essay", "scenario", "case", "operation"}
for line in clean:
    s = line.strip()
    if not s: continue
    mp, mc, mk, mq = re_part.match(s), re_chapter.match(s), re_cat.match(s), re_qstart.match(s)
    if mc and not mp:
        close_block(); chapter_full = s; ch_type = TYPE_MAP[mc.group(2)]; cat = None; continue
    if mk:
        close_block(); cat = mk.group(2).strip(); continue
    if mp:
        close_block(); part_full = s; continue
    if mq:
        close_block(); cur_qno = int(mq.group(1))
        cur_block = [mq.group(2)] if mq.group(2) else []
        continue
    if cur_qno is not None:
        cur_block.append(line)
close_block()

# ===== 人工兜底（项目特定配置外置在 bank_overrides.py，不入库）=====
# 少数题的空位无法由规则判定（选项内无分隔符 / 原文排版粘连），需要逐个补。
# 自己的题库需要兜底时：复制 bank_overrides.example.py 为 bank_overrides.py 再填。
try:
    from bank_overrides import OVERRIDE_APPEND, OVERRIDE_REPLACE, RECOVER
except ImportError:
    OVERRIDE_APPEND, OVERRIDE_REPLACE, RECOVER = set(), set(), []

for q in questions:
    if q["type"] not in ("single", "multi"):
        continue
    for _pre, _no in OVERRIDE_APPEND:
        if q["chapter"].startswith(_pre) and q["qno"] == _no:
            if not q["stem"].rstrip().endswith("）"):
                q["stem"] = q["stem"].rstrip("。.") + BLANK
            BLANK_LOG.append((q["chapter"], q["qno"], "兜底", q["stem"]))

# 空位被「(C/N值)」这类括号顶掉、需要插在句中
for q in questions:
    if q["type"] != "single":
        continue
    for _pre, _no in OVERRIDE_REPLACE:
        if q["chapter"].startswith(_pre) and q["qno"] == _no and "门限(C/N值)" in q["stem"]:
            q["stem"] = q["stem"].replace("门限(C/N值)", "门限" + BLANK + "(C/N值)")
            BLANK_LOG.append((q["chapter"], q["qno"], "兜底-句中", q["stem"]))

# ===== 补录残题（原文排版缺陷被自动解析丢弃时按锚点插回；内容在 bank_overrides.py）=====
# RECOVER 结构：[("锚点题干关键字", {题目对象…}), ...]，按序插在锚点题之后。
for anchor, item in reversed(RECOVER):
    pos = next(i for i, x in enumerate(questions) if x["stem"] == anchor)
    ref = questions[pos]
    item.update(part=ref["part"], chapter=ref["chapter"], category=ref["category"])
    questions.insert(pos + 1, item)

print("解析题目总数:", len(questions))
stat = OrderedDict()
for q in questions:
    d = stat.setdefault(q["chapter"], {"count":0,"types":Counter(),"qnos":[]})
    d["count"] += 1; d["types"][q["type"]] += 1; d["qnos"].append(q["qno"])
for k, v in stat.items():
    qnos = v["qnos"]
    missing = sorted(set(range(1, max(qnos)+1)) - set(qnos)) if qnos else []
    print(f"  {k}: {v['count']} | {dict(v['types'])}" + (f" | 缺题号 {missing}" if missing else ""))
print("丢弃:", len(warn))
for w in warn: print("  DROP", w)

bad = 0
for q in questions:
    a = q["answer"]
    if q["type"] == "judge" and a not in ("√","×"): bad += 1; print("BAD judge", q["id"], repr(a))
    if q["type"] == "single" and not re.match(r"^[A-H]$", a or ""): bad += 1; print("BAD single", q["id"], repr(a))
    if q["type"] == "multi" and not re.match(r"^[A-H]{2,8}$", a or ""): bad += 1; print("BAD multi", q["id"], repr(a))
    if q["type"] in ("single","multi"):
        ks = [o["key"] for o in q["options"]]
        if ks != [chr(ord('A')+i) for i in range(len(ks))]: bad += 1; print("BAD keys", q["id"], ks, q["stem"][:30])
        if any(not o["text"] for o in q["options"]): bad += 1; print("BAD empty", q["id"])
        if any(re.search(r"(?<![A-H])[A-H][ \t]*[\.．、]", o["text"]) for o in q["options"]):
            # 仅报告非 H.xxx/G.xxx 类残留
            for o in q["options"]:
                for mm in re.finditer(r"(?<![A-H])([A-H])[ \t]*[\.．、]", o["text"]):
                    if not re.match(r"^[A-H]\.\d", o["text"][mm.start():]):
                        bad += 1; print("RESIDUE", q["id"], o["key"], repr(o["text"][:50])); break
                else: continue
                break
print("异常合计:", bad)
print("选项数分布:", dict(sorted(Counter(len(q["options"]) for q in questions if q["options"]).items())))
print("题型分布:", dict(Counter(q["type"] for q in questions)))

# ===== 注入题目解析（build/explanations/ch*_analysis.json，id -> 解析）=====
import bank_export
_AN = bank_export.load_analyses()
_miss = [q["id"] for q in questions if q["id"] not in _AN]
for q in questions:
    if q["id"] in _AN:
        q["analysis"] = _AN[q["id"]]
print("解析已注入:", len(questions) - len(_miss), "/", len(questions), "缺:", len(_miss), _miss[:8])

json.dump(questions, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
import os
print("written:", OUT, os.path.getsize(OUT), "bytes")

# ===== 空位还原统计 =====
print("空位已还原:", len(BLANK_LOG), "  (句中", sum(1 for x in BLANK_LOG if x[2]=="句中"),
      "/ 句末", sum(1 for x in BLANK_LOG if x[2]=="句末"), ")")
import collections as _c
print("  按章:", dict(_c.Counter(x[0][:12] for x in BLANK_LOG)))
json.dump([{"chapter":a,"qno":b,"pos":c,"stem":d} for a,b,c,d in BLANK_LOG],
          open(os.path.join(BASE, "blank_log.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

# ===== 同步生成 H5 / 小程序 题库（与 questions.json 同源，压缩逻辑见 bank_export.py）=====
import bank_export
bank_export.export(questions)
print("已同步:", bank_export.H5, os.path.getsize(bank_export.H5),
      "|", bank_export.MP, os.path.getsize(bank_export.MP))
