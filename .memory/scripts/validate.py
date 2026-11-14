#!/usr/bin/env python3
"""Valida la integridad de .memory/ (read-only, no repara). Exit 0 = ok, 1 = problemas, 2 = uso.
Uso: python3 validate.py [raiz-del-proyecto] [--no-secrets]  (default: cwd; corre desde la raíz del repo)
  --no-secrets  omite el escaneo de secretos (regla 6). Úsalo solo para un falso positivo puntual.
Las líneas `aviso:` (p. ej. STATE.md ## Git distinto del repo real) NO cambian el exit code.
"""
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REQUIRED_STATE = ("## Tarea", "## En qué quedamos", "## Decisiones", "## Blockers", "## Próximo paso", "## Git", "## Verificación")
CHECKPOINT_FIELDS = ("**Task**", "**State**", "**Files changed**", "**Decisions**", "**Discoveries**", "**Next step**", "**Blockers**", "**Uncertainties**", "**Verification**")
PLAN_SECTIONS = ("## Pasos", "## Dependencias", "## Riesgos")
PLAN_ESTADOS = ("backlog", "listo", "en-curso", "esperando", "revision", "bloqueado", "hecho", "descartado")
HISTORIAL_RE = re.compile(r"^- (\S+) · (\S+) → (\S+) · (.+)$")
PLAN_WARNINGS = []
LESSON_KINDS = {"bug", "decision", "deadend", "trap", "drift"}
CONFIDENCE = {"verified", "user_confirmed", "reported"}
LESSON_KEYS = ("ts", "kind", "area", "title", "body", "confidence", "evidence")
EVIDENCE_PLACEHOLDERS = {"n/a", "na", "none", "ninguno", "pendiente", "-", "--", "...", "tbd"}
SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$")
LINK_RE = re.compile(r"\]\(([^)#\s]+\.md)(?:\s+\"[^\"]*\")?(?:#[^)]*)?\)")
WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
FIELD_NEXT_RE = re.compile(r"\*\*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+\*\*")

# Secretos (regla 6): patrones de tokens conocidos + asignaciones genéricas con pinta de credencial.
# Se reporta archivo:línea y el TIPO; el valor nunca se imprime.
SECRET_PATTERNS = (
    ("key sk-… (OpenAI/Anthropic/DeepSeek/OpenRouter)", re.compile(r"\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{20,}")),
    ("GitHub token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|\bgithub_pat_[A-Za-z0-9_]{22,}")),
    ("GitLab token", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("Telegram bot token", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("private key PEM", re.compile(r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----")),
    ("cabecera Bearer/Basic", re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}")),
    # usuario:clave dentro de una URL (no los marcadores de documentación como user:password@)
    ("credencial en URL", re.compile(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s:/@]+:(?!(?:password|passwd|pass|changeme|secret|x+|\*+)@)(?![$<{%])[^\s/@]{6,}@")),
)
# Admite claves de entorno con prefijos/sufijos; los metadatos se filtran por su sufijo.
GENERIC_KEY = r"[A-Za-z0-9_-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd)[A-Za-z0-9_-]*"
BENIGN_KEY_SUFFIX_RE = re.compile(r"(?i)(?:[_-](?:type|name|env|hint|path|file|url)|izer)$")
GENERIC_SECRET_RE = re.compile(
    r"(?i)(?<![A-Za-z0-9_-])(?P<key>" + GENERIC_KEY
    + r")['\"]?\s*[:=]\s*['\"]?(?P<value>[A-Za-z0-9/+_.=~:-]{16,})"
)


def read_text(p):
    try:
        return p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None


def is_iso(s):
    if not isinstance(s, str) or not ISO_RE.match(s):
        return False
    try:
        datetime.fromisoformat(s.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


FUTURE_TOLERANCE_MIN = 10
FUTURE_WARNINGS = []


def chk_future(s, label):
    """Aviso (no error) si una fecha ISO-8601 cae en el futuro (> ahora + tolerancia).

    Típico de un modelo que escribe la hora UTC con el offset local (o al revés):
    la fecha queda horas adelante y desordena /m-journal. Sin zona → hora local.
    """
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.astimezone()
        ahead = (dt - datetime.now(timezone.utc)).total_seconds() / 60
    except (TypeError, ValueError, AttributeError, OverflowError, OSError):
        # Fechas extremas (año 1, año 9999) o sin soporte de la plataforma: es un aviso,
        # nunca debe tumbar al validador.
        return
    if ahead > FUTURE_TOLERANCE_MIN:
        FUTURE_WARNINGS.append(
            f"{label}: fecha en el futuro ({s}, {ahead / 60:.1f} h adelante) — saca la hora de `date -Iseconds`"
        )


def strip_html_comments(txt):
    return re.sub(r"<!--.*?-->", "", txt, flags=re.DOTALL)


def strip_code_fences(txt):
    txt = re.sub(r"```.*?```", "", txt, flags=re.DOTALL)
    txt = re.sub(r"~~~.*?~~~", "", txt, flags=re.DOTALL)
    for marker in ("```", "~~~"):
        idx = txt.find(marker)
        if idx != -1:
            txt = txt[:idx]
    return txt


def section_has_content(lines):
    """Verdadero si hay contenido real: no solo comentarios HTML ni blancos. 'n/a' sí cuenta (es explícito)."""
    return bool(strip_html_comments("\n".join(lines)).strip())


def parse_frontmatter(txt):
    """Frontmatter YAML `--- ... ---` al inicio. Devuelve dict o None.
    Claves duplicadas se guardan en fm['__dup__'] (lista)."""
    if txt is None or not txt.startswith("---"):
        return None
    lines = txt.splitlines()
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return None
    fm = {}
    dup = []
    for line in lines[1:end]:
        m = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
        if m:
            key = m.group(1)
            if key in fm:
                dup.append(key)
            fm[key] = m.group(2).strip().strip('"\'')
    if dup:
        fm["__dup__"] = dup
    return fm


def _no_constant(s):
    raise ValueError(f"constante JSON no permitida: {s}")


def _make_dup_pairs():
    dups = []
    def hook(pairs):
        d = {}
        seen = set()
        for k, v in pairs:
            if k in seen:
                dups.append(k)
            seen.add(k)
            d[k] = v
        return d
    return hook, dups


def _finite(x):
    if isinstance(x, float):
        return x == x and x not in (float("inf"), float("-inf"))
    if isinstance(x, dict):
        return all(_finite(v) for v in x.values())
    if isinstance(x, list):
        return all(_finite(v) for v in x)
    return True


def field_has_content(txt, field):
    """El campo `**Field**` debe tener contenido real después (hasta el siguiente **campo**)."""
    m = re.search(re.escape(field), txt)
    if m is None:
        return False
    rest = txt[m.end():]
    nxt = FIELD_NEXT_RE.search(rest)
    content = rest[:nxt.start()] if nxt else rest
    content = strip_html_comments(content)
    content = re.sub(r"^:\s*", "", content.strip())
    return bool(content.strip())


def split_sections(txt):
    """Divide un markdown por encabezados `## X` → {título: [líneas]}."""
    sections = {}
    current = None
    fence = None  # misma regla que tablero.py: ``` o ~~~ (3+), hasta 3 espacios de sangría
    for line in txt.splitlines():
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence is not None:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence) \
                    and not marker.group(2).strip():
                fence = None
            if current is not None:
                sections[current].append(line)
            continue
        if marker:
            fence = marker.group(1)
            if current is not None:
                sections[current].append(line)
            continue
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            current = m.group(1).strip()
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    return sections


RAICES_TIPICAS = {"home", "Users", "var", "tmp", "opt", "usr", "etc", "srv", "run", "mnt", "media",
                  "Volumes", "private", "root", "app", "data", "workspace", "workspaces", "proc", "sys", "dev"}


def _parece_ruta(v):
    """Ruta o URL benigna, NO un secreto: URL sin credenciales en el userinfo, o ruta con
    prefijo (/ ./ ../ ~/) de al menos 2 segmentos sin ninguno con pinta aleatoria
    (mayúsculas + minúsculas + dígitos, 16+). '/Qk7mZp2xLr9Ttw4Vb8Hs' NO es ruta."""
    m = re.match(r"^[a-z][a-z0-9+.-]*://([^/]*)", v)
    if m:
        return "@" not in m.group(1)
    if v.startswith(("/", "./", "../", "~/")):
        partes = [x for x in re.split(r"/+", v) if x not in ("", ".", "..", "~")]
        # Absoluta: solo si arranca en un directorio típico; '/Qk7mZ/p2xLr…' no es una ruta.
        if v.startswith("/") and (not partes or partes[0] not in RAICES_TIPICAS):
            return False
        return (len(partes) >= 2
                and all(re.fullmatch(r"[A-Za-z0-9._-]+", x) for x in partes)
                and not any(len(x) >= 16 and re.search(r"[a-z]", x) and re.search(r"[A-Z]", x)
                            and re.search(r"\d", x) for x in partes))
    return False


def _looks_like_secret(v, key=""):
    """Filtro del patrón genérico: descarta nombres de variable (TODO_MAYUSCULAS), placeholders y
    valores sin dígitos o sin minúsculas (un secreto real casi siempre mezcla ambos)."""
    if BENIGN_KEY_SUFFIX_RE.search(key):
        return False
    if _parece_ruta(v):
        return False
    if v.count("/") >= 2 and all(re.fullmatch(r"[a-z0-9._-]+", part) for part in v.split("/")):
        return False
    if re.fullmatch(r"[A-Z0-9_]+", v):
        return False
    if not re.search(r"\d", v) or not re.search(r"[a-z]", v):
        return False
    if re.search(r"(?i)x{4,}|\.\.\.|redact|placeholder|example|ejemplo|changeme", v):
        return False
    return True


def scan_secrets(mem, problems):
    """Regla 6: nunca guardar secretos. Revisa *.md y lessons.jsonl de .memory/ (no scripts/)."""
    for p in sorted(mem.rglob("*")):
        if not p.is_file():
            continue
        rel_parts = p.relative_to(mem).parts
        if "scripts" in rel_parts[:-1]:
            continue
        if p.suffix != ".md" and p.name != "lessons.jsonl":
            continue
        txt = read_text(p)
        if txt is None:
            continue
        rel = "/".join(rel_parts)
        for i, line in enumerate(txt.splitlines(), 1):
            hit = None
            for label, rx in SECRET_PATTERNS:
                if rx.search(line):
                    hit = label
                    break
            if hit is None:
                for m in GENERIC_SECRET_RE.finditer(line):
                    if _looks_like_secret(m.group("value"), m.group("key")):
                        hit = "credencial asignada (api_key/token/password = …)"
                        break
            if hit:
                problems.append(f"posible secreto en {rel}:{i} ({hit}) — redáctalo antes de guardar (regla 6)")


def _git(root, *args):
    """git read-only con timeout; None si no hay git, no es repo o falla (fail-open)."""
    try:
        r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    return r.stdout.strip()


def git_warnings(root, state_txt):
    """Contrasta `## Git` de STATE.md con el repo real. Solo AVISOS (no cambian el exit code):
    un HEAD distinto puede ser el commit de cierre normal de /m-end, no un error de contenido."""
    warnings = []
    if state_txt is None:
        return warnings
    git_line = " ".join(split_sections(state_txt).get("Git", [])).strip()
    if not git_line:
        return warnings
    if _git(root, "rev-parse", "--is-inside-work-tree") != "true":
        if "n/a" not in git_line:
            warnings.append("STATE.md ## Git describe un repo, pero aquí no hay repo git (¿corres desde la raíz?)")
        return warnings
    if "sin repo" in git_line:
        warnings.append("STATE.md ## Git dice 'sin repo' pero sí hay repo git")
        return warnings
    head = _git(root, "rev-parse", "HEAD")
    if "sin commits" in git_line:
        if head:
            warnings.append("STATE.md ## Git dice 'sin commits' pero el repo ya tiene HEAD")
        return warnings
    branch = _git(root, "branch", "--show-current")
    mb = re.search(r"branch\s+(\S+)", git_line)
    mh = re.search(r"head\s+([0-9a-fA-F]{7,40})", git_line)
    if mb and branch:
        stored = mb.group(1).strip("`'\",;·")
        if stored != branch:
            warnings.append(f"STATE.md ## Git branch '{stored}' ≠ branch actual '{branch}'")
    if mh and head:
        stored = mh.group(1).lower()
        if not head.lower().startswith(stored):
            warnings.append(
                f"STATE.md ## Git head {stored[:12]} ≠ HEAD actual {head[:12]} "
                "(stale memory, o el commit de cierre de /m-end: contrasta con git antes de confiar en STATE)"
            )
    return warnings


def main(root: Path, secret_scan: bool = True) -> int:
    mem = root / ".memory"
    if not mem.is_dir():
        print(f"error: no existe .memory/ en {root}")
        return 1
    problems = []

    if not (mem / "STATE.md").is_file():
        problems.append("falta .memory/STATE.md (o no es un archivo)")
    if not (mem / "MEMORY.md").is_file():
        problems.append("falta .memory/MEMORY.md (o no es un archivo)")
    if not (mem / "facts").is_dir():
        problems.append("falta .memory/facts/")
    if not (mem / "checkpoints").is_dir():
        problems.append("falta .memory/checkpoints/")
    if not (mem / "checkpoints" / "INDEX.md").is_file():
        problems.append("falta .memory/checkpoints/INDEX.md (o no es un archivo)")

    facts_dir = mem / "facts"
    plans_dir = mem / "plans"
    cp_dir = mem / "checkpoints"

    def chk_links(txt, ctx):
        for m in WIKILINK_RE.finditer(strip_code_fences(txt)):
            slug = m.group(1).strip()
            if not (facts_dir / f"{slug}.md").is_file() and not (plans_dir / f"{slug}.md").is_file():
                problems.append(f"{ctx}: link [[{slug}]] sin resolver")

    # STATE.md: secciones reales con contenido + H1 fecha + Verificación con entorno
    state = mem / "STATE.md"
    state_txt = None
    if state.is_file():
        txt = read_text(state)
        state_txt = txt
        if txt is None:
            problems.append("STATE.md ilegible (no UTF-8 o sin permisos)")
        else:
            sections = split_sections(txt)
            for sec in REQUIRED_STATE:
                title = sec[3:]
                if title not in sections:
                    problems.append(f"STATE.md sin sección {sec}")
                elif not section_has_content(sections[title]):
                    problems.append(f"STATE.md sección {sec} vacía")
            git = "".join(sections.get("Git", []))
            if git and "branch" not in git and "n/a" not in git:
                problems.append("STATE.md ## Git sin branch/head ni n/a")
            # H1 fecha (M5)
            first = next((l.strip() for l in txt.splitlines() if l.strip()), "")
            mh = re.match(r"^#\s*STATE\s*[—-]\s*(.+)$", first)
            if mh:
                date_part = mh.group(1).strip()
                tok = date_part.split()[0] if date_part else ""
                if not (tok and is_iso(tok)):
                    problems.append(f"STATE.md H1 fecha no ISO-8601: {date_part}")
                else:
                    chk_future(tok, "STATE.md H1")
            elif first.startswith("#"):
                problems.append(f"STATE.md H1 mal formado (se espera '# STATE — <fecha>'): {first}")
            # Verificación con entorno (A4, heurístico: conteo pelado de tests sin nada más)
            verif = "".join(sections.get("Verificación", [])).strip()
            if verif and re.fullmatch(r"\s*\d+\s*(tests?|pruebas?)[.,]?(?:\s*,\s*\d+\s*(failures?|fallos?)[.,]?)?\s*", verif):
                problems.append("STATE.md ## Verificación sin entorno nombrado")
            chk_links(txt, "STATE.md")

    # lessons.jsonl (opcional como archivo; directorio = error)
    lessons = mem / "lessons.jsonl"
    lesson_objs = []
    all_ids = []
    if lessons.exists() and not lessons.is_file():
        problems.append("lessons.jsonl es un directorio, no un archivo")
    elif lessons.is_file():
        raw = read_text(lessons)
        if raw is None:
            problems.append("lessons.jsonl ilegible (no UTF-8 o sin permisos)")
        else:
            seen_ids = set()
            for i, line in enumerate(raw.splitlines(), 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    hook, dups = _make_dup_pairs()
                    obj = json.loads(line, parse_constant=_no_constant, object_pairs_hook=hook)
                except (json.JSONDecodeError, ValueError):
                    problems.append(f"lessons.jsonl línea {i}: JSON inválido")
                    continue
                if not isinstance(obj, dict):
                    problems.append(f"lessons.jsonl línea {i}: no es un objeto JSON")
                    continue
                if dups:
                    problems.append(f"lessons.jsonl línea {i}: claves duplicadas en JSON: {', '.join(dups)}")
                if not _finite(obj):
                    problems.append(f"lessons.jsonl línea {i}: número no finito (desbordamiento/NaN)")
                for k in LESSON_KEYS:
                    if k not in obj:
                        problems.append(f"lessons.jsonl línea {i}: falta '{k}'")
                        continue
                    v = obj[k]
                    if not isinstance(v, str):
                        problems.append(f"lessons.jsonl línea {i}: '{k}' debe ser string")
                    elif k != "evidence" and not v.strip():
                        problems.append(f"lessons.jsonl línea {i}: '{k}' debe ser string no vacío")
                if not is_iso(obj.get("ts")):
                    problems.append(f"lessons.jsonl línea {i}: ts no ISO-8601")
                else:
                    chk_future(obj.get("ts"), f"lessons.jsonl línea {i}")
                kind = obj.get("kind")
                if not isinstance(kind, str) or kind not in LESSON_KINDS:
                    problems.append(f"lessons.jsonl línea {i}: kind inválido '{kind}'")
                conf = obj.get("confidence")
                if not isinstance(conf, str) or conf not in CONFIDENCE:
                    problems.append(f"lessons.jsonl línea {i}: confidence inválido '{conf}'")
                if conf == "verified":
                    ev = obj.get("evidence")
                    if not isinstance(ev, str) or not ev.strip():
                        problems.append(f"lessons.jsonl línea {i}: verified exige evidencia real (no vacía ni placeholder)")
                    elif ev.strip().lower().rstrip(".,;:") in EVIDENCE_PLACEHOLDERS:
                        problems.append(f"lessons.jsonl línea {i}: verified exige evidencia real (no vacía ni placeholder)")
                # id obligatorio y único (A5)
                lid = obj.get("id")
                if not isinstance(lid, str) or not lid.strip():
                    problems.append(f"lessons.jsonl línea {i}: falta 'id' válido")
                else:
                    if lid in seen_ids:
                        problems.append(f"lessons.jsonl línea {i}: id duplicado '{lid}'")
                    seen_ids.add(lid)
                    all_ids.append(lid)
                lesson_objs.append(obj)
            # supersedes apunta a ids existentes (A5)
            for obj in lesson_objs:
                sup = obj.get("supersedes")
                if sup is None:
                    continue
                if not isinstance(sup, list):
                    problems.append(f"lessons.jsonl: 'supersedes' debe ser lista")
                    continue
                for sid in sup:
                    if sid not in all_ids:
                        problems.append(f"lessons.jsonl: supersedes apunta a id inexistente '{sid}'")

    # facts + MEMORY.md (bidireccional; bullet real; dedup; sin escape; sin .MD/subdirs)
    facts = {p.stem for p in facts_dir.glob("*.md")} if facts_dir.is_dir() else set()
    index = mem / "MEMORY.md"
    indexed = set()
    bullet_targets = []
    if index.is_file():
        txt = read_text(index)
        if txt is None:
            problems.append("MEMORY.md ilegible (no UTF-8 o sin permisos)")
        else:
            txt = strip_html_comments(strip_code_fences(txt))
            for line in txt.splitlines():
                is_bullet = bool(re.match(r"^\s*-\s", line))
                for m in LINK_RE.finditer(line):
                    path = m.group(1)
                    if not path.startswith("facts/"):
                        problems.append(f"MEMORY.md link no apunta a facts/: {path}")
                        continue
                    target = (mem / path).resolve()
                    try:
                        target.relative_to(facts_dir.resolve())
                    except ValueError:
                        problems.append(f"MEMORY.md link escapa de facts/: {path}")
                        continue
                    if is_bullet:
                        slug = Path(path).stem
                        indexed.add(slug)
                        bullet_targets.append(slug)
                    if not target.is_file():
                        problems.append(f"MEMORY.md apunta a archivo inexistente: {path}")
    for slug, cnt in Counter(bullet_targets).items():
        if cnt > 1:
            problems.append(f"MEMORY.md bullet duplicado: {slug}")
    for slug in sorted(facts - indexed):
        problems.append(f"fact sin indexar en MEMORY.md: {slug}")

    if facts_dir.is_dir():
        for p in sorted(facts_dir.iterdir()):
            if p.is_dir():
                problems.append(f"facts/ no admite subdirectorios: {p.name}")
            elif p.is_file() and not p.name.endswith(".md") and not p.name.startswith("."):
                problems.append(f"fact con extensión no-.md: {p.name}")
        for f in facts_dir.glob("*.md"):
            txt = read_text(f)
            if txt is None:
                problems.append(f"fact ilegible: {f.name}")
                continue
            fm = parse_frontmatter(txt)
            if fm is None:
                problems.append(f"fact sin frontmatter ---: {f.name}")
                continue
            if fm.get("__dup__"):
                problems.append(f"fact frontmatter con claves duplicadas: {', '.join(fm['__dup__'])} ({f.name})")
            name = fm.get("name")
            if not name:
                problems.append(f"fact sin name: {f.name}")
            elif name != f.stem:
                problems.append(f"fact name '{name}' no coincide con el archivo '{f.stem}'")
            elif not SLUG_RE.match(name):
                problems.append(f"fact name '{name}' no es un slug válido")
            if not is_iso(fm.get("date")):
                problems.append(f"fact date no ISO-8601: {f.name}")
            else:
                chk_future(fm.get("date"), f"fact {f.name}")
            if not fm.get("description"):
                problems.append(f"fact sin description: {f.name}")
            chk_links(txt, f"fact {f.name}")

    # checkpoints (INDEX con formato de línea; frontmatter + name + campos con contenido + wikilinks)
    cp_idx = cp_dir / "INDEX.md"
    cp_files = {p.stem for p in cp_dir.glob("CP-*.md")} if cp_dir.is_dir() else set()
    cp_indexed = set()
    if cp_idx.is_file():
        txt = read_text(cp_idx)
        if txt is None:
            problems.append("checkpoints/INDEX.md ilegible (no UTF-8 o sin permisos)")
        else:
            txt = strip_html_comments(strip_code_fences(txt))
            for line in txt.splitlines():
                m = re.match(r"^(CP-\d{3,})\s+[—-]\s+(\d{4}-\d{2}-\d{2})", line.strip())
                if m:
                    cid = m.group(1)
                    cp_indexed.add(cid)
                    if not (cp_dir / f"{cid}.md").is_file():
                        problems.append(f"INDEX.md apunta a checkpoint inexistente: {cid}")
                elif re.search(r"CP-", line):
                    problems.append(f"INDEX.md línea mal formada (se espera 'CP-NNN — fecha — frase'): {line.strip()[:60]}")
    for cp in sorted(cp_files - cp_indexed):
        problems.append(f"checkpoint sin línea en INDEX.md: {cp}")
    if cp_dir.is_dir():
        for f in sorted(cp_dir.glob("CP-*.md")):
            if not re.fullmatch(r"CP-\d{3,}", f.stem):
                problems.append(f"checkpoint sin padding (mín. 3 dígitos): {f.name}")
            txt = read_text(f)
            if txt is None:
                problems.append(f"checkpoint ilegible: {f.name}")
                continue
            fm = parse_frontmatter(txt)
            if fm is None:
                problems.append(f"checkpoint sin frontmatter ---: {f.name}")
            else:
                if fm.get("__dup__"):
                    problems.append(f"checkpoint frontmatter con claves duplicadas: {', '.join(fm['__dup__'])} ({f.name})")
                name = fm.get("name")
                if not name:
                    problems.append(f"checkpoint sin name: {f.name}")
                elif not re.match(r"^checkpoint-", name):
                    problems.append(f"checkpoint name '{name}' no empieza por 'checkpoint-': {f.name}")
                if not is_iso(fm.get("date")):
                    problems.append(f"checkpoint date no ISO-8601: {f.name}")
                else:
                    chk_future(fm.get("date"), f"checkpoint {f.name}")
            for field in CHECKPOINT_FIELDS:
                if field not in txt:
                    problems.append(f"checkpoint sin {field}: {f.name}")
                elif not field_has_content(txt, field):
                    problems.append(f"checkpoint {field} vacío: {f.name}")
            chk_links(txt, f"checkpoint {f.name}")

    # plans (secciones con contenido + frontmatter + wikilinks)
    if plans_dir.is_dir():
        for f in sorted(plans_dir.glob("*.md")):
            txt = read_text(f)
            if txt is None:
                problems.append(f"plan ilegible: {f.name}")
                continue
            fm = parse_frontmatter(txt)
            if fm is None:
                problems.append(f"plan sin frontmatter ---: {f.name}")
            else:
                if fm.get("__dup__"):
                    problems.append(f"plan frontmatter con claves duplicadas: {', '.join(fm['__dup__'])} ({f.name})")
                if not fm.get("name"):
                    problems.append(f"plan sin name: {f.name}")
                if not is_iso(fm.get("date")):
                    problems.append(f"plan date no ISO-8601: {f.name}")
                else:
                    chk_future(fm.get("date"), f"plan {f.name}")
                estado = fm.get("estado")
                if estado is not None and estado not in PLAN_ESTADOS:
                    problems.append(f"plan estado '{estado}' inválido (válidos: {', '.join(PLAN_ESTADOS)}): {f.name}")
                hist = [l for l in split_sections(txt).get("Historial", [])
                        if l.strip() and not l.strip().startswith("<!--")]
                last_to = None
                for hl in hist:
                    mh = HISTORIAL_RE.match(hl.strip())
                    if not mh:
                        problems.append(f"plan ## Historial línea con formato inválido ('- <ISO> · <de|—> → <a> · <motivo>'): {f.name}")
                        continue
                    when, de, a, _ = mh.groups()
                    if not is_iso(when):
                        problems.append(f"plan ## Historial fecha no ISO-8601 ({when}): {f.name}")
                    else:
                        chk_future(when, f"plan {f.name} ## Historial")
                    if de != "—" and de not in PLAN_ESTADOS:
                        problems.append(f"plan ## Historial estado '{de}' inválido: {f.name}")
                    if a not in PLAN_ESTADOS:
                        problems.append(f"plan ## Historial estado '{a}' inválido: {f.name}")
                    last_to = a
                if estado and last_to and last_to != estado:
                    PLAN_WARNINGS.append(f"plan {f.name}: estado '{estado}' ≠ último cambio del Historial '{last_to}' (usa tablero.py mover)")
            sections = split_sections(txt)
            for sec in PLAN_SECTIONS:
                title = sec[3:]
                if sec not in txt:
                    problems.append(f"plan sin sección {sec}: {f.name}")
                elif not section_has_content(sections.get(title, [])):
                    problems.append(f"plan sección {sec} vacía: {f.name}")
            chk_links(txt, f"plan {f.name}")

    # secretos (regla 6) — error de contenido, se corrige antes de cerrar
    if secret_scan:
        scan_secrets(mem, problems)

    # STATE.md ## Git vs repo real — solo avisos
    warnings = git_warnings(root, state_txt) + FUTURE_WARNINGS + PLAN_WARNINGS

    for p in problems:
        print("problema:", p)
    for w in warnings:
        print("aviso:", w)
    if problems:
        print(f"{len(problems)} problema(s) en .memory/")
        return 1
    print("ok: .memory/ válido" + (f" ({len(warnings)} aviso(s))" if warnings else ""))
    return 0


if __name__ == "__main__":
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    unknown = flags - {"--no-secrets"}
    if unknown or len(args) > 1:
        print("uso: python3 validate.py [raiz-del-proyecto] [--no-secrets]")
        sys.exit(2)
    root = Path(args[0]) if args else Path.cwd()
    sys.exit(main(root, secret_scan="--no-secrets" not in flags))
