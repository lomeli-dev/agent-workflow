#!/usr/bin/env python3
"""Búsqueda local BM25 sobre .memory/ (facts, lessons activas, plans) — stdlib, sin red.

Comandos:
  search.py index <root>                     → (re)construye el índice local y registra el proyecto
  search.py search <root> "<q>" [--global] [--json] [--limit N]
                                             → rankea con BM25 + n-gramas (tolerancia a tildes y typos)
  search.py dup <root> <slug> [<descripción>] → avisa si el slug ya existe (o es muy parecido) en OTRO proyecto

- Índice: .memory/.sync/search-index.json (derivado, no se edita). Se regenera SOLO si cambió el
  contenido (hash de los docs) y se guarda en .memory/.sync/.
- Registro global: ~/.config/memoria-sesion/proyectos.json (se llena en `index` = /m-save).
- Fail-open SIEMPRE: sin .memory/, sin permisos o con JSON roto imprime una línea y sale 0.
- Nunca borra ni mueve nada: `dup` solo AVISA.
"""
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

K1, B = 1.5, 0.75
DUP_JACCARD = 0.6
NG_W = 2.0      # peso del solape de n-gramas (tolerancia morfológica/typos) sobre BM25
NG_N = 3        # tamaño de los n-gramas de caracteres
_FOLD = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüñç", "aaaaaeeeeiiiiooooouuuunc")


def _fold(s):
    return s.translate(_FOLD)


def cfg_dir():
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "memoria-sesion"


_STOP = {"el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "en", "con",
         "por", "para", "y", "o", "u", "a", "que", "es", "son", "se", "lo", "le", "me", "su",
         "the", "an", "and", "or", "of", "to", "in", "for", "is", "on", "with", "it", "this", "that", "as"}


def tokenize(s):
    return [t for t in re.findall(r"[a-z0-9]+", _fold(s.lower())) if t not in _STOP]


def _ngrams(text, n=NG_N):
    t = re.sub(r"[^a-z0-9]+", "", _fold(text.lower()))
    return {t[i:i + n] for i in range(len(t) - n + 1)}


def _parse_md(txt):
    """Devuelve (frontmatter_dict, body)."""
    txt = txt.lstrip("\ufeff").replace("\r\n", "\n")
    m = re.match(r"^---[ \t]*\n(.*?)\n---[ \t]*\n?", txt, re.S)
    if not m:
        return {}, txt
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm, txt[m.end():]


def _collect_docs(mem):
    """Lista de docs {id, kind, path, title, text}. Omitimos lecciones retiradas."""
    docs = []
    for kind, dname in (("fact", "facts"), ("plan", "plans")):
        for p in sorted((mem / dname).glob("*.md")):
            try:
                fm, body = _parse_md(p.read_text(encoding="utf-8", errors="replace"))
            except Exception:
                continue  # un .md ilegible no ciega toda la búsqueda
            title = fm.get("description") or p.stem
            docs.append({"id": f"{kind}-{p.stem}", "kind": kind, "path": f"{dname}/{p.name}",
                         "title": title, "text": f"{title}\n{fm.get('description', '')}\n{body}"})
    retired = set()
    lessons = []
    lj = mem / "lessons.jsonl"
    if lj.is_file():
        for line in lj.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            lessons.append(d)
            retired.update(d.get("supersedes") or [])
    anon = 0
    for d in lessons:
        if d.get("id") in retired:
            continue
        lid = d.get("id") or f"anon-{anon}"
        anon += 1
        title = d.get("title") or lid or "lesson"
        body = d.get("body") or ""
        docs.append({"id": f"lesson-{lid}", "kind": "lesson",
                     "path": f"lessons.jsonl#{lid}",
                     "title": title, "text": f"{title}\n{body}"})
    return docs


def _content_hash(docs):
    h = hashlib.sha256()
    for d in docs:
        h.update(d["path"].encode("utf-8"))
        h.update(b"\0")
        h.update(d["text"].encode("utf-8", "replace"))
        h.update(b"\0")
    return h.hexdigest()


def _build_index(docs):
    for d in docs:
        d["tokens"] = tokenize(d["text"])
        d["n"] = len(d["tokens"])
        d["ngrams"] = sorted(_ngrams(d["text"]))
    N = len(docs)
    df = {}
    for d in docs:
        for t in set(d["tokens"]):
            df[t] = df.get(t, 0) + 1
    avgdl = (sum(d["n"] for d in docs) / N) if N else 0.0
    return {"version": 2, "hash": _content_hash(docs), "N": N, "avgdl": avgdl, "df": df,
            "docs": [{"id": d["id"], "kind": d["kind"], "path": d["path"],
                      "title": d["title"], "tokens": d["tokens"], "n": d["n"],
                      "ngrams": d["ngrams"]} for d in docs]}


def _bm25(qtokens, doc, idx):
    df, N, avgdl = idx["df"], idx["N"], idx["avgdl"]
    dl = doc["n"]
    if dl == 0:
        return 0.0
    score = 0.0
    for t in qtokens:
        dft = df.get(t)
        if not dft:
            continue
        idf = math.log(1.0 + (N - dft + 0.5) / (dft + 0.5))
        tf = doc["tokens"].count(t)
        score += idf * (tf * (K1 + 1.0)) / (tf + K1 * (1.0 - B + B * dl / avgdl))
    return score


def _index_path(mem):
    sync = mem / ".sync"
    try:
        sync.mkdir(parents=True, exist_ok=True)
    except Exception:
        return None  # .sync es un archivo o no se puede crear
    return sync / "search-index.json"


def _load_or_build(root):
    mem = Path(root) / ".memory"
    if not mem.is_dir():
        return None, None
    docs = _collect_docs(mem)
    idx = _build_index(docs)
    ip = _index_path(mem)
    if ip is not None and ip.is_file():
        try:
            old = json.loads(ip.read_text(encoding="utf-8"))
            if (old.get("hash") == idx["hash"] and old.get("version") == 2
                    and isinstance(old.get("docs"), list)):
                return old, mem  # al día y estructuralmente válido
        except Exception:
            pass
    if ip is not None:
        try:
            ip.write_text(json.dumps(idx, ensure_ascii=False))
        except Exception:
            pass  # .sync roto/read-only: degradar, no romper (fail-open)
    return idx, mem


def _load_reg():
    rp = cfg_dir() / "proyectos.json"
    if rp.is_file():
        try:
            return json.loads(rp.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"proyectos": {}}


def _save_reg(reg):
    c = cfg_dir()
    c.mkdir(parents=True, exist_ok=True)
    (c / "proyectos.json").write_text(json.dumps(reg, indent=2, ensure_ascii=False))


def _register(root):
    r = str(Path(root).resolve())
    reg = _load_reg()
    reg.setdefault("proyectos", {})
    cur = reg["proyectos"].get(r, {})
    cur["slug"] = Path(r).name
    cur["last_save"] = _now()
    reg["proyectos"][r] = cur
    _save_reg(reg)


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def cmd_index(root):
    idx, mem = _load_or_build(root)
    if idx is None:
        print("local: off (sin .memory/)")
        return 0
    _register(root)
    print(f"local: {idx['N']} docs indexados (.memory/.sync/search-index.json)")
    return 0


def cmd_search(root, q, global_=False, as_json=False, limit=8):
    idx, mem = _load_or_build(root)
    qt = tokenize(q)
    qng = _ngrams(q)
    results = []
    if idx is not None and (qt or qng):
        results = _rank(qt, qng, idx, limit)
    if global_:
        cur = str(Path(root).resolve())
        for other, info in _load_reg().get("proyectos", {}).items():
            if other == cur:
                continue
            try:
                oidx, _ = _load_or_build(other)
            except Exception:
                continue  # un proyecto roto no aborta la búsqueda global
            if oidx is None:
                continue
            for d in _rank(qt, qng, oidx, limit):
                d["proyecto"] = info.get("slug", Path(other).name)
                results.append(d)
        results.sort(key=lambda d: -d["score"])
        results = results[:limit]
    if as_json:
        print(json.dumps({"local": True, "global": global_, "results": results},
                         ensure_ascii=False))
        return 0
    if not results:
        print("local: 0 matches")
        return 0
    for d in results:
        proj = f" [{d['proyecto']}]" if d.get("proyecto") else ""
        print(f"{d['score']:.2f} · {d['kind']} · {d['path']}{proj} · {d['title']}")
    return 0


def _rank(qt, qng, idx, limit):
    # BM25 (solape léxico) SIEMPRE por delante de los n-gramas. Los n-gramas solo rescatan
    # typos/morfología cuando NO hay ningún match léxico (nunca invierten el top-1).
    exact, fuzzy = [], []
    for d in idx["docs"]:
        b = _bm25(qt, d, idx)
        if b > 0:
            exact.append({"id": d["id"], "kind": d["kind"], "path": d["path"],
                          "title": d["title"], "score": round(b, 4)})
        elif qng:
            ng = _jaccard(qng, d["ngrams"])
            if ng > 0:
                fuzzy.append({"id": d["id"], "kind": d["kind"], "path": d["path"],
                              "title": d["title"], "score": round(NG_W * ng, 4)})
    exact.sort(key=lambda x: -x["score"])
    fuzzy.sort(key=lambda x: -x["score"])
    return (exact + fuzzy)[:limit]


def _fact_descriptions(other_mem):
    """slug → description (o título) de los facts de OTRO proyecto, para dup."""
    out = {}
    for p in sorted((other_mem / "facts").glob("*.md")):
        fm, _ = _parse_md(p.read_text(encoding="utf-8", errors="replace"))
        out[p.stem] = fm.get("description") or p.stem
    return out


def _jaccard(a, b):
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def cmd_dup(root, slug, desc=""):
    cur = str(Path(root).resolve())
    reg = _load_reg().get("proyectos", {})
    warnings = []
    qt = tokenize(desc)
    for other, info in reg.items():
        if other == cur:
            continue
        other_mem = Path(other) / ".memory"
        if not other_mem.is_dir():
            continue
        slug_name = info.get("slug", Path(other).name)
        if (other_mem / "facts" / f"{slug}.md").is_file():
            warnings.append(f"el fact '{slug}' ya existe en '{slug_name}' (mismo slug)")
            continue
        if qt:
            for s2, desc2 in _fact_descriptions(other_mem).items():
                if _jaccard(qt, tokenize(desc2)) >= DUP_JACCARD:
                    warnings.append(
                        f"'{slug}' se parece al fact '{s2}' de '{slug_name}' (similitud alta)")
                    break
    if warnings:
        for w in warnings:
            print(f"aviso: {w} — considera enlazarlo con [[{slug}]] o Related")
    return 0


def main():
    a = sys.argv[1:]
    if not a:
        print("uso: search.py index|search|dup <root> [...]")
        return 2
    cmd, rest = a[0], a[1:]
    as_json = "--json" in rest
    try:
        if cmd == "index" and rest:
            return cmd_index(rest[0])
        if cmd == "search" and len(rest) >= 2:
            root, q = rest[0], rest[1]
            global_ = "--global" in rest
            limit = 8
            if "--limit" in rest:
                i = rest.index("--limit")
                if i + 1 < len(rest):
                    try:
                        limit = max(1, int(rest[i + 1]))
                    except ValueError:
                        limit = 8
            return cmd_search(root, q, global_, as_json, limit)
        if cmd == "dup" and len(rest) >= 2:
            root, slug = rest[0], rest[1]
            desc = " ".join(rest[2:]) if len(rest) > 2 else ""
            return cmd_dup(root, slug, desc)
    except Exception as ex:
        if as_json:
            print(json.dumps({"local": True, "error": f"{type(ex).__name__}: {ex}"},
                             ensure_ascii=False))
        else:
            print(f"local: aviso — {type(ex).__name__}: {ex}")
        return 0
    print("uso: search.py index|search|dup <root> [...]")
    return 2


if __name__ == "__main__":
    sys.exit(main())
