#!/usr/bin/env python3
"""memoria-sesion → supermemory (opcional, fail-open). Solo stdlib.

Uso (desde la raíz del repo, igual que validate.py):
  python3 .memory/scripts/sm.py push   [raiz] [--dry-run]     sube facts/lessons/plans nuevos o cambiados
  python3 .memory/scripts/sm.py search [raiz] "texto" [--global] [--limit N] [--json]
  python3 .memory/scripts/sm.py status [raiz]

Config GLOBAL (tuya, nunca en el repo): ~/.config/memoria-sesion/config.json
  {"supermemory": {"enabled": true}}                      ← mínimo
  campos opcionales: "api_key_env" (SUPERMEMORY_API_KEY), "base_url" (https://api.supermemory.ai),
                     "namespace_prefix" ("ms-"), "include" (["facts","lessons","plans"]), "timeout" (15)
La API key SOLO vive en la variable de entorno. Un archivo vacío .memory/.nosync apaga la subida en ese proyecto.
Sin config, sin key, sin red o con error de la API: imprime una línea y sale con 0. Nunca bloquea un /m-save.
`push` corre antes validate.py (mismo directorio): si .memory/ tiene problemas (p. ej. un secreto) o el validador
truena, no sube nada; solo si validate.py no existe sube sin validar (y lo dice).
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULTS = {
    "enabled": False,
    "api_key_env": "SUPERMEMORY_API_KEY",
    "base_url": "https://api.supermemory.ai",
    "namespace_prefix": "ms-",
    "include": ["facts", "lessons", "plans"],
    "timeout": 15,
}
SAFE_ID = re.compile(r"[^A-Za-z0-9_.-]+")
SAFE_NS = re.compile(r"[^A-Za-z0-9_:-]+")


# ----------------------------------------------------------------- utilidades
def say(msg):
    print(msg)


def config_path():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return Path(base) / "memoria-sesion" / "config.json"


def load_config():
    cfg = dict(DEFAULTS)
    p = config_path()
    if p.is_file():
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError) as ex:
            return cfg, f"config ilegible ({p}): {ex}"
        if not isinstance(raw, dict):
            return cfg, f"config inválida ({p}): se esperaba un objeto JSON"
        sm = raw.get("supermemory") or {}
        if isinstance(sm, dict):
            if "enable" in sm and "enabled" not in sm:  # typo común
                sm = dict(sm)
                sm["enabled"] = sm.pop("enable")
            cfg.update({k: v for k, v in sm.items() if k in DEFAULTS})
    if not isinstance(cfg.get("include"), list) or not all(isinstance(x, str) for x in cfg.get("include", [])):
        cfg["include"] = list(DEFAULTS["include"])
    return cfg, None


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def frontmatter(txt):
    fm = {}
    if txt.startswith("---"):
        lines = txt.splitlines()
        for line in lines[1:]:
            if line.strip() == "---":
                break
            m = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
            if m:
                fm[m.group(1)] = m.group(2).strip().strip("\"'")
    return fm


def md_payload(kind, slug, txt):
    """Texto que se sube por un .md: una línea de cabecera con slug y description + el cuerpo sin frontmatter.
    El hash de sincronización se calcula sobre el archivo completo, no sobre esto."""
    fm = frontmatter(txt)
    body = re.sub(r"^---.*?\n---\s*\n?", "", txt, count=1, flags=re.DOTALL) if txt.startswith("---") else txt
    head = f"{kind.capitalize()} {slug}" + (f": {fm['description']}" if fm.get("description") else "")
    return head + "\n\n" + body.strip() + "\n"


def project_slug(root):
    name = None
    try:
        r = subprocess.run(["git", "-C", str(root), "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            name = Path(r.stdout.strip()).name
    except (OSError, subprocess.SubprocessError):
        pass
    if not name:
        name = root.resolve().name or "proyecto"
    return SAFE_NS.sub("-", name).strip("-").lower() or "proyecto"


def namespace_for(root, cfg):
    ns = (cfg["namespace_prefix"] + project_slug(root))
    return SAFE_NS.sub("-", ns)[:100]


def doc_id(kind, slug):
    return SAFE_ID.sub("-", f"{kind}-{slug}")[:100]


def iso_date(value):
    if not value:
        return None
    try:
        datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return str(value)
    except ValueError:
        return None


# ----------------------------------------------------------------- fuentes
def collect_items(mem, include):
    """[(clave, id, kind, path_rel, raw, payload, date)] — lo que existe hoy en .memory/.
    `raw` decide el hash de sincronización; `payload` es lo que se sube."""
    items = []
    if "facts" in include and (mem / "facts").is_dir():
        for f in sorted((mem / "facts").glob("*.md")):
            txt = f.read_text(encoding="utf-8")
            items.append((f"facts/{f.name}", doc_id("fact", f.stem), "fact", f"facts/{f.name}", txt, md_payload("fact", f.stem, txt), iso_date(frontmatter(txt).get("date"))))
    if "plans" in include and (mem / "plans").is_dir():
        for f in sorted((mem / "plans").glob("*.md")):
            txt = f.read_text(encoding="utf-8")
            items.append((f"plans/{f.name}", doc_id("plan", f.stem), "plan", f"plans/{f.name}", txt, md_payload("plan", f.stem, txt), iso_date(frontmatter(txt).get("date"))))
    if "checkpoints" in include and (mem / "checkpoints").is_dir():
        for f in sorted((mem / "checkpoints").glob("CP-*.md")):
            txt = f.read_text(encoding="utf-8")
            items.append((f"checkpoints/{f.name}", doc_id("checkpoint", f.stem), "checkpoint", f"checkpoints/{f.name}", txt, md_payload("checkpoint", f.stem, txt), iso_date(frontmatter(txt).get("date"))))
    lessons = mem / "lessons.jsonl"
    if "lessons" in include and lessons.is_file():
        objs = []
        for line in lessons.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if isinstance(o, dict) and isinstance(o.get("id"), str):
                objs.append((o, line))
        retired = set()
        for o, _ in objs:
            for sid in o.get("supersedes") or []:
                retired.add(sid)
        for o, line in objs:
            if o["id"] in retired:
                continue
            body = "\n".join(filter(None, [
                f"Lección ({o.get('kind', '?')}, {o.get('area', '?')}, confianza {o.get('confidence', '?')}): {o.get('title', '')}",
                o.get("body", ""),
                f"Evidencia: {o['evidence']}" if o.get("evidence") else "",
            ]))
            items.append((f"lessons/{o['id']}", doc_id("lesson", o["id"]), "lesson", f"lessons.jsonl#{o['id']}", line, body, iso_date(o.get("ts"))))
    return items


# ----------------------------------------------------------------- HTTP
class Api:
    def __init__(self, cfg, key):
        self.base = cfg["base_url"].rstrip("/")
        self.key = key
        self.timeout = float(cfg.get("timeout") or 15)

    def call(self, method, path, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self.key)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                raw = r.read().decode("utf-8")
                return r.status, (json.loads(raw) if raw.strip() else {})
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8")[:200]
            except Exception:
                detail = ""
            return e.code, {"error": detail}
        # URLError / timeout / ConnectionError → excepción hacia arriba (fail-open en el llamador)


# ----------------------------------------------------------------- estado
def state_path(mem):
    return mem / ".sync" / "supermemory.json"


def load_state(mem):
    p = state_path(mem)
    if p.is_file():
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(d, dict) and isinstance(d.get("items"), dict):
                return d
        except (OSError, ValueError):
            pass
    return {"namespace": None, "items": {}}


def save_state(mem, st):
    atomic_write(state_path(mem), json.dumps(st, ensure_ascii=False, indent=1, sort_keys=True) + "\n")


# ----------------------------------------------------------------- resolución común
def resolve(root):
    """Devuelve (cfg, key, ns, mem, motivo_off). motivo_off != None ⇒ todo apagado."""
    mem = root / ".memory"
    cfg, err = load_config()
    if err:
        return cfg, None, None, mem, err
    if not mem.is_dir():
        return cfg, None, None, mem, f"no existe .memory/ en {root}"
    if (mem / ".nosync").exists():
        return cfg, None, None, mem, "off (.memory/.nosync)"
    if not cfg.get("enabled"):
        return cfg, None, None, mem, f"off (sin {config_path()} o enabled=false)"
    key = (os.environ.get(cfg["api_key_env"]) or "").strip()
    if not key:
        return cfg, None, None, mem, f"off (falta la variable {cfg['api_key_env']})"
    return cfg, key, namespace_for(root, cfg), mem, None


def run_validator(root, mem):
    v = Path(__file__).resolve().parent / "validate.py"
    if not v.is_file():
        v = mem / "scripts" / "validate.py"
    if not v.is_file():
        return True, "validate.py no encontrado (se sube sin validar)"
    try:
        r = subprocess.run([sys.executable, str(v), str(root)], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as ex:
        return False, f"validate.py no corrió ({type(ex).__name__})"
    if r.returncode != 0:
        n = sum(1 for l in r.stdout.splitlines() if l.startswith("problema:"))
        return False, (f"validate.py reporta {n} problema(s)" if n else f"validate.py falló (exit {r.returncode})")
    return True, None


# ----------------------------------------------------------------- comandos
def cmd_push(root, dry_run):
    cfg, key, ns, mem, off = resolve(root)
    if off:
        say(f"supermemory: {off}")
        return 0
    ok, note = run_validator(root, mem)
    if not ok:
        say(f"supermemory: no se sube nada — {note} (corrige y repite /m-save)")
        return 0
    items = collect_items(mem, cfg["include"])
    st = load_state(mem)
    if st.get("namespace") not in (None, ns):
        st = {"namespace": ns, "items": {}}  # cambió de nombre el proyecto: empezar de cero
    st["namespace"] = ns
    known = st["items"]
    api = Api(cfg, key)
    nuevos = actualizados = sin_cambio = fallidos = 0
    down = False
    for clave, did, kind, rel, raw, payload, date in items:
        h = sha(raw)
        prev = known.get(clave)
        if prev and prev.get("hash") == h and prev.get("id") == did:
            sin_cambio += 1
            continue
        if down:
            fallidos += 1
            continue
        if dry_run:
            say(f"  {'PATCH' if prev else 'POST'} {did} ({rel})")
            nuevos += 0 if prev else 1
            actualizados += 1 if prev else 0
            continue
        body = {"content": payload, "metadata": {"kind": kind, "path": rel, "project": ns, "source": "memoria-sesion"}}
        if date:
            body["date"] = date
        try:
            if prev:
                code, resp = api.call("PATCH", f"/ns/{ns}/document/{did}", body)
                if code == 404:
                    body["id"] = did
                    code, resp = api.call("POST", f"/ns/{ns}/document", body)
            else:
                body["id"] = did
                code, resp = api.call("POST", f"/ns/{ns}/document", body)
        except Exception as ex:  # red caída, DNS, timeout: fail-open
            say(f"aviso: supermemory inalcanzable ({type(ex).__name__}); lo pendiente se reintenta en el próximo /m-save")
            fallidos += 1
            down = True
            continue
        if 200 <= code < 300:
            known[clave] = {"hash": h, "id": did, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            if prev:
                actualizados += 1
            else:
                nuevos += 1
        else:
            fallidos += 1
            say(f"aviso: supermemory HTTP {code} al subir {rel}")
            if code in (401, 403):
                say("aviso: la key fue rechazada; revisa la variable de entorno")
                down = True
    # huérfanos en el estado (facts borrados localmente): se olvidan del estado; no se borra remoto en v1
    vivos = {clave for clave, *_ in items}
    for clave in list(known):
        if clave not in vivos:
            del known[clave]
    if not dry_run:
        save_state(mem, st)
    say(f"supermemory: +{nuevos} subidos · {actualizados} actualizados · {sin_cambio} sin cambio · {fallidos} fallidos (ns {ns}{', dry-run' if dry_run else ''})")
    if note:
        say(f"aviso: {note}")
    return 0


def search_ns(api, ns, query, limit):
    code, resp = api.call("POST", f"/ns/{ns}/search", {"query": query, "limit": limit, "searchMode": "hybrid", "include": {"documents": True}})
    if not (200 <= code < 300):
        raise RuntimeError(f"HTTP {code} en {ns}")
    out = []
    for r in resp.get("results") or []:
        doc = (r.get("included") or {}).get("document") or {}
        meta = doc.get("metadata") or r.get("metadata") or {}
        out.append({
            "ns": ns,
            "similarity": round(float(r.get("similarity") or 0), 3),
            "kind": meta.get("kind") or "?",
            "path": meta.get("path") or doc.get("id") or r.get("id"),
            "text": (r.get("memory") or r.get("chunk") or "").strip().replace("\n", " ")[:160],
        })
    return out


def cmd_search(root, query, glob, limit, as_json):
    cfg, key, ns, mem, off = resolve(root)
    if off:
        say(f"supermemory: {off}")
        return 0
    api = Api(cfg, key)
    results = []
    try:
        spaces = [ns]
        if glob:
            code, resp = api.call("GET", "/namespaces")
            names = []
            if 200 <= code < 300:
                raw = (resp.get("namespaces") or resp.get("results") or resp.get("data")) if isinstance(resp, dict) else resp
                for n in raw or []:
                    name = (n.get("name") or n.get("namespace") or n.get("id")) if isinstance(n, dict) else n
                    if isinstance(name, str) and name.startswith(cfg["namespace_prefix"]):
                        names.append(name)
            spaces = sorted(set(names) | {ns})
        for s in spaces:
            results.extend(search_ns(api, s, query, limit))
    except Exception as ex:
        say(f"supermemory: aviso — {ex if isinstance(ex, RuntimeError) else type(ex).__name__}; usa el modo léxico")
        return 0
    results.sort(key=lambda r: -r["similarity"])
    results = results[:limit]
    if as_json:
        say(json.dumps({"namespace": ns, "global": glob, "results": results}, ensure_ascii=False))
        return 0
    if not results:
        say(f"supermemory: 0 resultados en {', '.join(spaces)}")
        return 0
    for r in results:
        where = f"{r['ns']}:" if glob else ""
        say(f"{r['similarity']:.2f} · {r['kind']} · {where}{r['path']} · {r['text']}")
    return 0


def cmd_status(root):
    cfg, key, ns, mem, off = resolve(root)
    say(f"config: {config_path()} ({'existe' if config_path().is_file() else 'no existe'})")
    say(f"enabled: {bool(cfg.get('enabled'))} · key {cfg['api_key_env']}: {'presente' if (os.environ.get(cfg['api_key_env']) or '').strip() else 'ausente'} · base_url: {cfg['base_url']}")
    if off:
        say(f"estado: {off}")
    if not mem.is_dir():
        return 0
    ns = ns or namespace_for(root, cfg)
    say(f"namespace: {ns} · include: {', '.join(cfg['include'])}")
    items = collect_items(mem, cfg["include"])
    known = load_state(mem).get("items", {})
    pend = []
    for clave, did, kind, rel, raw, payload, date in items:
        prev = known.get(clave)
        if not (prev and prev.get("hash") == sha(raw) and prev.get("id") == did):
            pend.append(clave)
    say(f"locales: {len(items)} · sincronizados: {len(items) - len(pend)} · pendientes: {len(pend)}")
    for clave in pend[:10]:
        say(f"  pendiente: {clave}")
    return 0


def parse(argv):
    """cmd, args posicionales, flags booleanas, limit."""
    cmd, rest = argv[0], argv[1:]
    args, flags, limit = [], set(), 8
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--limit" and i + 1 < len(rest):
            limit = max(1, int(rest[i + 1]))
            i += 2
            continue
        if a.startswith("--"):
            flags.add(a)
        else:
            args.append(a)
        i += 1
    return cmd, args, flags, limit


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        say(__doc__.strip())
        return 2
    cmd, args, flags, limit = parse(argv)
    if cmd == "push":
        return cmd_push(Path(args[0]) if args else Path.cwd(), "--dry-run" in flags)
    if cmd == "search":
        if not args:
            say("uso: sm.py search [raiz] \"texto\" [--global] [--limit N] [--json]")
            return 2
        if len(args) > 1:
            root, q = Path(args[0]), " ".join(args[1:])
        else:
            root, q = Path.cwd(), args[0]
        return cmd_search(root, q, "--global" in flags, limit, "--json" in flags)
    if cmd == "status":
        return cmd_status(Path(args[0]) if args else Path.cwd())
    say("uso: sm.py push|search|status [raiz] …")
    return 2


if __name__ == "__main__":
    as_json = "--json" in sys.argv[1:]
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as ex:  # cualquier cosa rara: nunca romper el comando que nos llamó
        if as_json:
            print(json.dumps({"supermemory": True, "error": f"{type(ex).__name__}: {ex}"},
                             ensure_ascii=False))
        else:
            print(f"supermemory: aviso — {type(ex).__name__}: {ex}")
        sys.exit(0)
