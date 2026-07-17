#!/usr/bin/env python3
"""Parse the 'final' 2026 predicted-question compilation (with branch questions)
into data/banks.json — replaces the earlier 8-file compiled-bank parse."""
import json, re, sys

SRC = "/Users/gbs/Desktop/Vader/deepvader - UPSC_CSE_Mains_2026_Final_Predicted_Questions.md"
DEST = "/Users/gbs/Documents/upsc-mains-companion/data/banks.json"

GS_WORDS = {10: 150, 15: 250, 20: 300}
PUBAD_WORDS = {10: 150, 15: 225, 20: 300}

PAPER_HEADS = [
    (re.compile(r'^#\s+PAPER 0\s*—\s*ESSAY'), dict(id='essay', short='Essay', icon='✍️', title='Essay')),
    (re.compile(r'^#\s+GS PAPER 1\b'), dict(id='gs1', short='GS1', icon='📜', title='GS-1 History, Culture, Geography & Society')),
    (re.compile(r'^#\s+GS PAPER 2\b'), dict(id='gs2', short='GS2', icon='🏛', title='GS-2 Polity, Governance & International Relations')),
    (re.compile(r'^#\s+GS PAPER 3\b'), dict(id='gs3', short='GS3', icon='🔬', title='GS-3 Economy, Agriculture, S&T, Environment, DM & Security')),
    (re.compile(r'^#\s+GS PAPER 4\b'), dict(id='gs4', short='GS4', icon='⚖️', title='GS-4 Ethics, Integrity & Aptitude')),
    (re.compile(r'^#\s+PUBLIC ADMINISTRATION\s*—\s*PAPER I:'), dict(id='pubad1', short='PubAd I', icon='📜', title='Public Administration Paper I — Administrative Theory', optional=True)),
    (re.compile(r'^#\s+PUBLIC ADMINISTRATION\s*—\s*PAPER II:'), dict(id='pubad2', short='PubAd II', icon='🇮🇳', title='Public Administration Paper II — Indian Administration', optional=True)),
]

SECTION_RE = re.compile(r'^##\s+(.+?)\s*\((\d+)[^)]*\)')
SECTION_RE_NOCOUNT = re.compile(r'^##\s+(Section [A-Z].*)$')
Q_RE = re.compile(r'^\*\*([\w]+)\.\s*(?:\[([^\]]*)\])?\s*\*\*\s*(.*)$')
BRANCH_RE = re.compile(r'^-\s*↳\s*\*Branch(?:\s*\(([^)]*)\))?:\*\s*(.+)$')

def words_for(marks, is_pubad):
    table = PUBAD_WORDS if is_pubad else GS_WORDS
    return table.get(marks, marks * 15)

def parse_bracket(bracket):
    tier = None
    m = re.search(r'T([123])', bracket or '')
    if m: tier = int(m.group(1))
    marks = None
    m = re.search(r'(\d+)\s*M\b', bracket or '')
    if m: marks = int(m.group(1))
    return tier, marks

def extract_title(text):
    m = re.match(r'^\*\*(.+?)\.\*\*\s*(.*)$', text)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None, text.strip('*').strip()

def build():
    text = open(SRC, encoding='utf-8').read()
    lines = text.splitlines()
    papers = []
    cur_paper = None       # {meta, sections: []}
    cur_section = None     # {t, qs: []}
    cur_q = None           # last question dict, for attaching branches

    for line in lines:
        line = line.rstrip()
        matched_paper = False
        for rx, meta in PAPER_HEADS:
            if rx.match(line):
                cur_paper = {**meta, 'sections': []}
                papers.append(cur_paper)
                cur_section = None
                cur_q = None
                matched_paper = True
                break
        if matched_paper:
            continue
        if cur_paper is None:
            continue

        sm = SECTION_RE.match(line)
        if sm:
            cur_section = {'t': sm.group(1).strip(' —-'), 'qs': []}
            cur_paper['sections'].append(cur_section)
            cur_q = None
            continue
        sm2 = SECTION_RE_NOCOUNT.match(line) if line.startswith('##') else None
        if sm2:
            title = re.sub(r'\s*\([^)]*\)\s*$', '', sm2.group(1)).strip(' —-')
            cur_section = {'t': title, 'qs': []}
            cur_paper['sections'].append(cur_section)
            cur_q = None
            continue

        if cur_section is None:
            continue

        qm = Q_RE.match(line)
        if qm:
            n, bracket, rest = qm.groups()
            tier, marks = parse_bracket(bracket)
            is_pubad = cur_paper['id'] in ('pubad1', 'pubad2')
            is_essay = cur_paper['id'] == 'essay'
            is_case_study = cur_paper['id'] == 'gs4' and 'Case Stud' in cur_section['t']
            title, qtext = extract_title(rest)
            if is_essay:
                marks, words = 125, 1100
            elif marks is None and is_case_study:
                marks, words = 20, 250
            else:
                marks = marks or 15
                words = words_for(marks, is_pubad)
            cur_q = {
                'n': 0, 'srcNo': n, 'q': qtext,  # n is reassigned paper-wide below (must be unique per paper, not per section)
                'm': marks, 'w': words,
            }
            if tier: cur_q['tier'] = tier
            if title: cur_q['title'] = title
            cur_section['qs'].append(cur_q)
            continue

        bm = BRANCH_RE.match(line)
        if bm and cur_q is not None:
            label, btext = bm.groups()
            is_pubad = cur_paper['id'] in ('pubad1', 'pubad2')
            is_essay = cur_paper['id'] == 'essay'
            bmarks, btier = cur_q['m'], cur_q.get('tier')
            blabel = (label or '').strip().lower()
            if blabel == 'short' and not is_essay:
                bmarks = 10
            tm = re.match(r't([123])$', blabel)
            if tm:
                btier = int(tm.group(1))
            bwords = 1100 if is_essay else words_for(bmarks, is_pubad)
            branch = {'q': btext.strip(), 'm': bmarks, 'w': bwords}
            if btier: branch['tier'] = btier
            if label and not blabel == str(btier): branch['label'] = label.strip()
            cur_q.setdefault('branches', []).append(branch)
            continue

    return papers

papers = build()
# n must be unique across the WHOLE paper (qid = paperId + n) — reassign paper-wide
for p in papers:
    i = 0
    for s in p['sections']:
        for q in s['qs']:
            i += 1
            q['n'] = i

total_main = sum(len(s['qs']) for p in papers for s in p['sections'])
total_branch = sum(len(q.get('branches', [])) for p in papers for s in p['sections'] for q in s['qs'])
for p in papers:
    n = sum(len(s['qs']) for s in p['sections'])
    b = sum(len(q.get('branches', [])) for s in p['sections'] for q in s['qs'])
    print(f"  {p['id']:8s} {n:3d} main + {b:3d} branch  in {len(p['sections'])} sections", file=sys.stderr)

json.dump(papers, open(DEST, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"TOTAL {total_main} main + {total_branch} branch → {DEST}", file=sys.stderr)
