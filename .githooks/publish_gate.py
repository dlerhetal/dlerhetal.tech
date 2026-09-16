# -*- coding: utf-8 -*-
"""
THE PUBLISH GATE for every client namespace in dlerhetal.tech.

A client namespace is any top-level directory holding an HTML file that is not
listed in gate_config.json "exclude". Discovery is dynamic, so a new client
directory is covered the moment it exists.

UNIVERSAL CHECKS (every client namespace)
  1. robots.txt carries  Disallow: /<ns>/
  2. every HTML page carries a robots noindex meta
  3. no text file carries a loopback endpoint (127.0.0.1, localhost, 0.0.0.0)
  4. no relative or root-relative href/src is dangling
  5. STAMPING, if the namespace has any page that POSTs: each posting page must
     carry an endpoint shim marker (gate_config "stampMarkers") or post only to
     resolvable https, non-loopback endpoints

OPT-IN CHECKS (gate_config "namespaces" -> <ns>)
  homeButtonMarker   every non-root-index page must contain this string

The files checked are read from a git commit (default HEAD), because a push
publishes commits, not the working tree. --worktree reads disk instead.

USAGE
  python .githooks/publish_gate.py                 all namespaces at HEAD
  python .githooks/publish_gate.py --rev <sha>     all namespaces at a commit
  python .githooks/publish_gate.py --worktree      all namespaces, files on disk
  python .githooks/publish_gate.py --ns <name>     one namespace
  python .githooks/publish_gate.py --pre-push      hook mode, refs on stdin
Exit 0 = safe to push. Anything else = do not push.
"""
import argparse
import json
import posixpath
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CONFIG = HERE / "gate_config.json"
ZERO = "0" * 40
RULE = "=" * 78

NOINDEX_PAT = re.compile(
    r"<meta\b[^>]*\bname\s*=\s*[\"']?robots[\"']?[^>]*noindex"
    r"|<meta\b[^>]*noindex[^>]*\bname\s*=\s*[\"']?robots",
    re.I)
LINK_PAT = re.compile(r"""\b(?:href|src)\s*=\s*(["'])(.*?)\1""", re.I | re.S)
SCHEME_PAT = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:")
TEMPLATE_BITS = ("${", "{{", "<%", "'+", "' +", "\"+", "\" +", "+'", "+\"", "\\")
POST_METHOD_PAT = re.compile(r"""\bmethod\s*:\s*["'`]post["'`]""", re.I)
FORM_POST_PAT = re.compile(r"""<form\b[^>]*\bmethod\s*=\s*["']?post""", re.I)
XHR_POST_PAT = re.compile(r"""\.open\s*\(\s*["'`]post["'`]\s*,\s*([^,)]+)""", re.I)
BEACON_PAT = re.compile(r"""sendBeacon\s*\(\s*([^,)]+)""")
FETCH_PAT = re.compile(r"\bfetch\s*\(")


# ---------------------------------------------------------------- git access
def git(*args, inp=None):
    r = subprocess.run(["git", *args], cwd=str(REPO), input=inp, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("git %s failed: %s" % (" ".join(args), r.stderr.decode("utf-8", "replace")))
    return r.stdout


def list_rev(rev):
    return [n for n in git("ls-tree", "-r", "-z", "--name-only", rev).decode("utf-8").split("\0") if n]


def read_rev(rev, paths):
    if not paths:
        return {}
    inp = "".join("%s:%s\n" % (rev, p) for p in paths).encode("utf-8")
    out = git("cat-file", "--batch", inp=inp)
    res, i = {}, 0
    for p in paths:
        nl = out.index(b"\n", i)
        header = out[i:nl].decode("utf-8", "replace").split()
        i = nl + 1
        if len(header) < 3 or header[-1] == "missing":
            res[p] = ""
            continue
        size = int(header[2])
        res[p] = out[i:i + size].decode("utf-8", "replace")
        i += size + 1
    return res


def list_worktree():
    raw = git("ls-files", "-z", "--cached", "--others", "--exclude-standard").decode("utf-8")
    return [n for n in raw.split("\0") if n and (REPO / n).is_file()]


def read_worktree(paths):
    return {p: (REPO / p).read_text(encoding="utf-8", errors="replace") for p in paths}


# ---------------------------------------------------------------- helpers
def line_of(s, pos):
    return s.count("\n", 0, pos) + 1


def call_span(s, open_paren):
    """Index just past the paren that closes the one at open_paren. Quote aware."""
    depth, quote, i = 0, None, open_paren
    while i < len(s):
        c = s[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(s)


def resolve_target(expr, s):
    """Turn the first argument of a send call into a URL string, or None."""
    expr = expr.strip()
    m = re.match(r"""^(["'`])(.*?)\1""", expr, re.S)
    if m:
        return m.group(2)
    m = re.match(r"^([A-Za-z_$][\w$]*)", expr)
    if m:
        name = re.escape(m.group(1))
        d = re.search(r"""(?:\bvar|\blet|\bconst)\s+%s\s*=\s*(["'`])(.*?)\1""" % name, s, re.S)
        if d:
            return d.group(2)
    return None


def post_targets(s):
    """[(line, raw_expr, resolved_url_or_None)] for every POST the page can make."""
    out = []
    for m in FETCH_PAT.finditer(s):
        end = call_span(s, m.end() - 1)
        call = s[m.end():end - 1]
        if not POST_METHOD_PAT.search(call):
            continue
        first = call.split(",", 1)[0]
        out.append((line_of(s, m.start()), first.strip(), resolve_target(first, s)))
    for m in XHR_POST_PAT.finditer(s):
        out.append((line_of(s, m.start()), m.group(1).strip(), resolve_target(m.group(1), s)))
    for m in BEACON_PAT.finditer(s):
        out.append((line_of(s, m.start()), m.group(1).strip(), resolve_target(m.group(1), s)))
    for m in FORM_POST_PAT.finditer(s):
        a = re.search(r"""\baction\s*=\s*["']([^"']*)["']""", m.group(0), re.I)
        out.append((line_of(s, m.start()), "<form method=post>", a.group(1) if a else None))
    return out


def dangling_links(path, s, tree):
    bad = set()
    for m in LINK_PAT.finditer(s):
        u = m.group(2).strip()
        if not u or u.startswith(("#", "//")) or SCHEME_PAT.match(u):
            continue
        if any(t in u for t in TEMPLATE_BITS) or "\n" in u:
            continue
        target = unquote(re.split(r"[?#]", u, 1)[0])
        if not target:
            continue
        base = "" if target.startswith("/") else posixpath.dirname(path)
        full = posixpath.normpath(posixpath.join(base, target.lstrip("/")))
        if full.startswith(".."):
            bad.add("%s (escapes the site root)" % u)
            continue
        full = "" if full == "." else full
        if full in tree or posixpath.join(full, "index.html") in tree:
            continue
        bad.add(u)
    return sorted(bad)


# ---------------------------------------------------------------- the checks
def check_namespace(ns, files, text, tree, robots, cfg):
    fails = []
    loop = re.compile(cfg["loopbackPattern"], re.I)
    exts = tuple(e.lower() for e in cfg["textExtensions"])
    markers = cfg.get("stampMarkers", [])
    opt = cfg.get("namespaces", {}).get(ns, {})
    mine = [f for f in files if f.startswith(ns + "/")]
    pages = [f for f in mine if f.lower().endswith((".html", ".htm"))]

    if not re.search(r"(?im)^\s*Disallow:\s*/%s/\s*$" % re.escape(ns), robots):
        fails.append("robots.txt :: no 'Disallow: /%s/' line" % ns)

    for f in mine:
        if not f.lower().endswith(exts):
            continue
        hits = sorted({line_of(text[f], m.start()) for m in loop.finditer(text[f])})
        if hits:
            fails.append("%s :: loopback endpoint on line(s) %s" % (f, ", ".join(map(str, hits))))

    for f in pages:
        s = text[f]
        if not NOINDEX_PAT.search(s):
            fails.append("%s :: no robots noindex meta" % f)
        for u in dangling_links(f, s, tree):
            fails.append("%s :: dangling link %s" % (f, u))

    # stamping applies because this namespace has a page that POSTs
    posting = {f: post_targets(text[f]) for f in pages}
    posting = {f: t for f, t in posting.items() if t}
    for f, targets in posting.items():
        s = text[f]
        if any(('id="%s"' % mk) in s or ("id='%s'" % mk) in s for mk in markers):
            continue
        for ln, expr, url in targets:
            if url is None:
                fails.append("%s :: POSTs (line %d, target %s) with no endpoint shim and an unresolvable target"
                             % (f, ln, expr))
            elif not url.lower().startswith("https://") or loop.search(url):
                fails.append("%s :: POSTs (line %d) to %s with no endpoint shim, so it is not stamped"
                             % (f, ln, url))

    marker = opt.get("homeButtonMarker")
    if marker:
        for f in pages:
            if f == ns + "/index.html":
                continue
            if marker not in text[f]:
                fails.append("%s :: no home button (%s)" % (f, marker))

    return fails, len(pages), sorted(posting)


def discover(files, cfg):
    exclude = set(cfg.get("exclude", []))
    tops = {f.split("/", 1)[0] for f in files if "/" in f and f.lower().endswith((".html", ".htm"))}
    return sorted(t for t in tops if t not in exclude and not t.startswith("."))


def run(rev, worktree, only, cfg, label):
    files = list_worktree() if worktree else list_rev(rev)
    tree = set(files)
    all_ns = discover(files, cfg)
    targets = all_ns if only is None else [n for n in all_ns if n in only]
    exts = tuple(e.lower() for e in cfg["textExtensions"])
    wanted = [f for f in files if f == "robots.txt"
              or (f.split("/", 1)[0] in targets and f.lower().endswith(exts))]
    text = read_worktree(wanted) if worktree else read_rev(rev, wanted)
    robots = text.get("robots.txt", "")

    print(RULE)
    print("PUBLISH GATE  source: %s" % label)
    print("client namespaces discovered: %s" % (", ".join(all_ns) or "(none)"))
    skipped = [n for n in all_ns if n not in targets]
    print("checked this run         : %s" % (", ".join(targets) or "(none)"))
    if skipped:
        print("not touched, not checked : %s" % ", ".join(skipped))
    print(RULE)

    total = 0
    for ns in targets:
        fails, npages, posting = check_namespace(ns, files, text, tree, robots, cfg)
        total += len(fails)
        extra = ("; POSTing pages: %s" % ", ".join(posting)) if posting else ""
        print("%-4s  %s/  (%d page(s)%s)" % ("PASS" if not fails else "FAIL", ns, npages, extra))
        for f in fails:
            print("        FAIL  %s" % f)
    print(RULE)
    print("RESULT: %s" % ("PASS. Safe to push." if total == 0 else "%d failure(s). Do not push." % total))
    print(RULE)
    return 0 if total == 0 else 1


def pre_push(cfg):
    triggers = cfg.get("globalTriggers", [])
    rc = 0
    lines = [l.split() for l in sys.stdin.read().splitlines() if l.strip()]
    for parts in lines:
        if len(parts) != 4:
            continue
        local_ref, local_sha, remote_ref, remote_sha = parts
        if local_sha == ZERO:
            continue
        known = remote_sha != ZERO and subprocess.run(
            ["git", "cat-file", "-e", remote_sha + "^{commit}"], cwd=str(REPO),
            capture_output=True).returncode == 0
        if known:
            changed = git("diff", "--name-only", remote_sha, local_sha).decode("utf-8").split("\n")
        else:
            changed = git("log", "--name-only", "--format=", local_sha, "--not", "--remotes").decode("utf-8").split("\n")
        changed = [c for c in changed if c]
        if not known and not changed:
            changed = list(triggers)       # unknown history: check everything
        if any(c == t or c.startswith(t) for c in changed for t in triggers):
            only = None
        else:
            only = {c.split("/", 1)[0] for c in changed if "/" in c}
        if only is not None and not only.intersection(discover(list_rev(local_sha), cfg)):
            print("pre-push: %s touches no client namespace. Gate not needed." % local_ref)
            continue
        rc |= run(local_sha, False, only, cfg, "%s at %s" % (local_ref, local_sha[:7]))
    return rc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rev", default="HEAD")
    ap.add_argument("--worktree", action="store_true")
    ap.add_argument("--ns", action="append")
    ap.add_argument("--pre-push", dest="prepush", action="store_true")
    ap.add_argument("hookargs", nargs="*")
    a = ap.parse_args()
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if a.prepush:
        return pre_push(cfg)
    only = set(a.ns) if a.ns else None
    label = "working tree" if a.worktree else a.rev
    return run(a.rev, a.worktree, only, cfg, label)


if __name__ == "__main__":
    sys.exit(main())
