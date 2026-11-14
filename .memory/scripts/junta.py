#!/usr/bin/env python3
"""Junta de revisión (/m-orca-junta): vigía de calidad del trabajo de varios workers antes de integrarlo.

  python3 junta.py revisar <repo> <entrada.json | -> [--texto]

Solo lee el repo (git diff contra la base); nunca hace checkout, merge ni escribe nada.
Exit 0 si pudo revisar (aunque el veredicto sea malo) · 1 error de datos ('error: …') · 2 uso.
Autocontenido (stdlib): los patrones de secretos son copia de validate.py, no se importan.
"""
import argparse
import errno
import json
import os
import re
import subprocess
import sys
import warnings

# Ninguna advertencia de Python se imprime: un ResourceWarning/FutureWarning puede incluir rutas o
# valores de la entrada sin redactar (aunque el entorno traiga PYTHONWARNINGS=always/error).
warnings.simplefilter("ignore")


REGLAS = ("all_success", "all_done")
ESTADOS_WORKER = ("succeeded", "failed", "stopped", "lost", "sin_reporte")
NO_LLEGO = ("lost", "sin_reporte")
NOTA_ALL_DONE = "all_done: terminaron ≠ salieron bien; solo se integran las piezas ok"

# Secretos: copia de validate.py (SECRET_PATTERNS, GENERIC_SECRET_RE y _looks_like_secret).
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
GENERIC_LABEL = "credencial asignada (api_key/token/password = …)"

HUNK_RE = re.compile(r"^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
TEST_NAME_RE = re.compile(
    r"^(?:test_.+\.py|.+_test\.py|.+_test\.exs|.+\.(?:test|spec)\.(?:ts|tsx|js|jsx))$"
)
TEST_DIRS = ("test", "tests", "__tests__")


USO = "uso: junta.py revisar <repo> <entrada.json | -> [--texto]"
# Regla de salida: NINGÚN texto de una excepción, de argparse o de git se imprime tal cual (pueden
# traer valores de la entrada ya escapados con repr, y entonces la redacción no los reconoce).
# Solo mensajes propios, con datos crudos (redactados) o códigos (errno, exit de git).
REQUIRED_RE = re.compile(r"the following arguments are required: [a-z_]+(?:, [a-z_]+)*")


class UsageParser(argparse.ArgumentParser):
    def error(self, message):
        # De argparse solo pasa la lista de argumentos faltantes (nombres fijos); lo demás puede
        # repetir el valor inválido ("invalid choice: '…'"), así que se resume sin el valor.
        detalle = "faltan argumentos" if REQUIRED_RE.fullmatch(message) else "argumento inválido"
        write_err(f"{USO}\n{detalle}")
        sys.exit(2)


class DataError(Exception):
    """Error de datos de entrada o del repo: exit 1."""


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


REDACTADO_PREFIX = "[REDACTADO"
SENSITIVE_KEY_RE = re.compile(r"(?i)\A" + GENERIC_KEY + r"\Z")
_MASKS = {}  # valor secreto → n: la misma máscara para el mismo valor, distinta para valores distintos


def mask(secret):
    """[REDACTADO-n] estable por valor durante la corrida: redactar no junta dos ids distintos en uno."""
    if secret not in _MASKS:
        _MASKS[secret] = len(_MASKS) + 1
    return f"[REDACTADO-{_MASKS[secret]}]"


def redact(value, sensitive=False):
    """Toda salida pasa por aquí (JSON, --texto, errores, rutas, ids, stderr de git) ANTES de cualquier
    repr/escape/serialización: los patrones se aplican al texto crudo. Recorre dicts/listas; el valor
    texto bajo una clave sensible (password, token, api_key, secret…) se enmascara entero."""
    if isinstance(value, dict):
        return {redact(k): redact(v, isinstance(k, str) and bool(SENSITIVE_KEY_RE.search(k)))
                for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v, sensitive) for v in value]
    if not isinstance(value, str):
        return value
    if sensitive and value.strip():
        return mask(value)
    for _, rx in SECRET_PATTERNS:
        value = rx.sub(lambda m: mask(m.group(0)), value)

    def generic(m):
        if not _looks_like_secret(m.group("value"), m.group("key")):
            return m.group(0)
        return m.group(0)[:m.start("value") - m.start(0)] + mask(m.group("value"))

    return GENERIC_SECRET_RE.sub(generic, value)


def printable(value):
    """Texto seguro para imprimir en UTF-8: rutas no-UTF-8 de git (surrogateescape) → \\xNN."""
    if isinstance(value, dict):
        return {printable(k): printable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [printable(v) for v in value]
    if not isinstance(value, str):
        return value
    try:
        value.encode("utf-8")
        return value
    except UnicodeEncodeError:
        try:
            return value.encode("utf-8", "surrogateescape").decode("utf-8", "backslashreplace")
        except UnicodeEncodeError:
            return value.encode("utf-8", "backslashreplace").decode("ascii")


def check_unicode(value, where="la entrada"):
    """Un surrogate suelto (\\ud800) pasa json.loads pero no se puede imprimir: error de datos."""
    if isinstance(value, dict):
        for k, v in value.items():
            check_unicode(k, where)
            check_unicode(v, where)
    elif isinstance(value, list):
        for v in value:
            check_unicode(v, where)
    elif isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise DataError(f"{where} tiene texto Unicode inválido (surrogate suelto)")


def secret_kind(line):
    """Tipo del primer patrón que casa en la línea, o None. Nunca devuelve el valor."""
    for label, rx in SECRET_PATTERNS:
        if rx.search(line):
            return label
    for m in GENERIC_SECRET_RE.finditer(line):
        if _looks_like_secret(m.group("value"), m.group("key")):
            return GENERIC_LABEL
    return None


# ---- globs
def glob_to_regex(pattern):
    """Convierte un glob de rutas a regex anclada. Conversión propia (fnmatch.translate no sirve:
    su '*' cruza '/'). Reglas:
      '**'  cruza directorios ('lib/**' casa 'lib/a/b.py'); '**/' también casa cero directorios
            ('**/x.py' casa 'x.py' y 'a/b/x.py'; 'a/**/b' casa 'a/b').
      '*'   cualquier cosa dentro de UN segmento ('lib/*' casa 'lib/a.py', no 'lib/a/b.py').
      '?'   un carácter que no es '/'.   '[abc]' / '[!abc]' clase de caracteres (nunca casa '/').
      Un './' o '/' inicial se ignora; un '/' final equivale a '/**' (todo lo de ese directorio).
    Se compara contra la ruta completa relativa a la raíz del repo, sensible a mayúsculas.
    """
    pat = pattern.strip()
    if ".." in pat.split("/"):
        raise re.error("componente padre no permitido")
    while pat.startswith("./"):
        pat = pat[2:]
    pat = pat.lstrip("/")
    if pat.endswith("/"):
        pat += "**"
    out, i, n = [], 0, len(pat)
    while i < n:
        c = pat[i]
        if c == "*":
            if pat.startswith("**", i):
                i += 2
                while i < n and pat[i] == "*":
                    i += 1
                if i < n and pat[i] == "/":
                    out.append("(?:.*/)?")
                    i += 1
                else:
                    out.append(".*")
                continue
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        elif c == "[":
            j = i + 1
            if j < n and pat[j] in "!^":
                j += 1
            if j < n and pat[j] == "]":
                j += 1
            while j < n and pat[j] != "]":
                j += 1
            if j >= n:
                out.append(re.escape(c))
            else:
                body = pat[i + 1:j]
                neg = body[:1] in ("!", "^")
                if neg:
                    body = body[1:]
                body = body.replace("\\", "\\\\")
                out.append("(?!/)[" + ("^" if neg else "") + body + "]")
                i = j
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile(r"(?s)\A" + "".join(out) + r"\Z")


def matches_any(path, regexes):
    return any(rx.match(path) for rx in regexes)


# ---- git (solo lectura)
# Nada de lo que corre aquí puede escribir ni descargar en el repo revisado:
#  · GIT_NO_LAZY_FETCH=1: un clon parcial no baja blobs (además se detecta y no se revisa).
#  · Se quitan las variables que redirigen el repo (GIT_DIR, GIT_INDEX_FILE, …): manda `-C <repo>`.
#  · Sin tracing: fuera GIT_TRACE* / GIT_TRACE2* del entorno y GIT_TRACE2{,_EVENT,_PERF}=0 (un
#    destino de traza dentro del repo crearía archivos). Ojo: trace2 se lee de la config global/
#    sistema ANTES de aplicar `-c`, así que `-c trace2.*Target=` no basta; el entorno sí la anula. Fuera también la config inyectada por
#    entorno (GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT/KEY_n/VALUE_n): solo cuenta la de -c de aquí.
# La config del repo no puede ocultar cambios: submódulos siempre visibles, --text (ni atributos
# -diff, ni NUL, ni core.bigFileThreshold hacen "binario" un archivo), sin textconv/ext-diff.
GIT_ENV_DROP = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR",
                "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_CEILING_DIRECTORIES",
                "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_EXTERNAL_DIFF")
GIT_ENV_DROP_PREFIX = ("GIT_TRACE", "GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_")
GIT_CFG = ("-c", "core.quotePath=false", "-c", "diff.ignoreSubmodules=none", "-c", "core.bigFileThreshold=1g",
           "-c", "trace2.eventTarget=", "-c", "trace2.normalTarget=", "-c", "trace2.perfTarget=",
           "-c", "core.fsmonitor=false")
CONFIG_ERR_RE = re.compile(r"(?i)\bbad (?:boolean |numeric )?config\b|\bbad config line\b|\binvalid config\b"
                           r"|\bunable to parse .*config|\bconfig value\b.*\binvalid\b")
NOT_REPO_RE = re.compile(r"(?i)not a git repository")
DIFF_OPTS = ("--no-color", "--no-ext-diff", "--no-textconv", "-M", "--ignore-submodules=none",
             "--submodule=short")
MAX_BYTES = 20 * 1024 * 1024  # por archivo; más grande = 'no revisado' (falla), nunca aprobado en silencio
NULL_SHA = re.compile(r"\A0+\Z")
PARCIAL = "clon parcial: no reviso para no descargar objetos"


def max_bytes():
    try:
        return int(os.environ.get("JUNTA_MAX_BYTES", MAX_BYTES))
    except ValueError:
        return MAX_BYTES


def git(top, *args, stdin=None):
    env = {k: v for k, v in os.environ.items()
           if k not in GIT_ENV_DROP and not k.startswith(GIT_ENV_DROP_PREFIX)}
    env.update(GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0", LC_ALL="C",
               GIT_TRACE2="0", GIT_TRACE2_EVENT="0", GIT_TRACE2_PERF="0")
    try:
        r = subprocess.run(["git", "-C", top, *GIT_CFG, *args], input=stdin, capture_output=True,
                           env=env, timeout=120)
    except FileNotFoundError:
        raise DataError("git no está instalado")
    except subprocess.TimeoutExpired:
        raise DataError("git tardó demasiado: " + " ".join(args[:2]))
    return r.returncode, r.stdout, r.stderr.decode("utf-8", "replace").strip()


def _cause(what, rc, err):
    """Mensaje propio según la causa. El stderr de git solo se CLASIFICA (LC_ALL=C), nunca se
    reenvía: puede repetir valores de config o rutas escapadas."""
    if CONFIG_ERR_RE.search(err):
        return f"config de git inválida (exit {rc}): revisa git config del repo y la global"
    return f"{what} falló (exit {rc})"


def _failed(what, rc, err=""):
    return RuntimeError(_cause(what, rc, err))


def toplevel(repo):
    if not os.path.isdir(repo):
        raise DataError("no existe el directorio del repo")
    rc, out, err = git(repo, "rev-parse", "--show-toplevel")
    if rc != 0:
        if NOT_REPO_RE.search(err):
            raise DataError(f"el directorio no es un repo git (git exit {rc})")
        raise DataError(_cause("git rev-parse", rc, err))
    return out.decode("utf-8", "surrogateescape").strip()


def is_partial_clone(top):
    """Clon parcial (extensions.partialClone o remote.*.promisor): leer blobs ausentes los descargaría."""
    rc, out, _ = git(top, "config", "--get", "extensions.partialClone")
    if rc == 0 and out.strip():
        return True
    rc, out, _ = git(top, "config", "--get-regexp", r"^remote\..*\.promisor$")
    for line in out.decode("utf-8", "replace").splitlines():
        if line.split()[-1].lower() in ("true", "yes", "on", "1"):
            return True
    return False


def resolve(top, ref):
    """SHA del commit de `ref`, o None si no existe. Rechaza refs que parecen opciones."""
    if not ref or ref.startswith("-") or "\n" in ref or "\0" in ref:
        return None
    rc, out, _ = git(top, "rev-parse", "--verify", "--quiet", ref + "^{commit}")
    return out.decode().strip() if rc == 0 else None


def raw_changes(top, base_sha, rama_sha):
    """[{estado, archivo, desde?}] y, aparte, {archivo: (modo nuevo, sha nuevo)} de `git diff --raw -z`."""
    rc, out, err = git(top, "diff", *DIFF_OPTS, "--raw", "-z", "--no-abbrev",
                       f"{base_sha}...{rama_sha}", "--")
    if rc != 0:
        raise _failed("git diff", rc, err)
    tokens = out.decode("utf-8", "surrogateescape").split("\0")
    cambios, blobs, i = [], {}, 0
    while i < len(tokens) and tokens[i].startswith(":"):
        _, new_mode, _, new_sha, status = tokens[i][1:].split()
        letter = status[0]
        if letter in "RC":
            cambio = {"estado": letter, "archivo": tokens[i + 2], "desde": tokens[i + 1]}
            i += 3
        else:
            cambio = {"estado": letter, "archivo": tokens[i + 1]}
            i += 2
        cambios.append(cambio)
        if letter != "D" and new_mode != "160000" and not NULL_SHA.match(new_sha):
            blobs[cambio["archivo"]] = new_sha
    return cambios, blobs


def unreviewable(top, blobs):
    """Archivos cuyo contenido nuevo no se puede revisar: {archivo: razón} (demasiado grande o ausente)."""
    if not blobs:
        return {}
    shas = sorted(set(blobs.values()))
    rc, out, err = git(top, "cat-file", "--batch-check", stdin=("\n".join(shas) + "\n").encode())
    if rc != 0:
        raise _failed("git cat-file", rc, err)
    info = {}
    for line in out.decode("utf-8", "replace").splitlines():
        parts = line.split()
        if len(parts) == 3:
            info[parts[0]] = int(parts[2])
    limit, malos = max_bytes(), {}
    for archivo, sha in blobs.items():
        size = info.get(sha)
        if size is None:
            malos[archivo] = "objeto ausente"
        elif size > limit:
            malos[archivo] = f"{size} bytes > límite {limit}"
    return malos


def path_secrets(cambios):
    """Un secreto en el NOMBRE de un archivo también queda en el repo: se reporta con línea 0."""
    hits = []
    for c in cambios:
        if c["estado"] == "D":
            continue
        kind = secret_kind(c["archivo"])
        if kind:
            hits.append({"archivo": c["archivo"], "linea": 0, "tipo": kind + " en el nombre del archivo"})
    return hits


def _unquote(path):
    """Desescapa una ruta C-quoted de git ("a\\tb" o "\\303\\261")."""
    if not (path.startswith('"') and path.endswith('"')):
        return path
    raw = path[1:-1].encode("utf-8", "surrogateescape").decode("unicode_escape")
    return raw.encode("latin-1", "surrogateescape").decode("utf-8", "surrogateescape")


def added_secrets(top, base_sha, rama_sha, excluir=()):
    """Secretos en líneas AGREGADAS del diff -U0 --text: [{archivo, linea, tipo}], sin el valor.
    `excluir`: rutas que no se leen (ya marcadas como 'no revisado')."""
    pathspec = ["--"] + ([":/"] + [":(exclude,literal,top)" + p for p in excluir] if excluir else [])
    rc, out, err = git(top, "diff", *DIFF_OPTS, "--text", "-U0", "--src-prefix=a/", "--dst-prefix=b/",
                       f"{base_sha}...{rama_sha}", *pathspec)
    if rc != 0:
        raise _failed("git diff", rc, err)
    hits = []
    archivo, line_no, old_left, new_left = None, 0, 0, 0
    for raw in out.decode("utf-8", "replace").split("\n"):
        if old_left > 0 or new_left > 0:  # dentro de un hunk: cuenta exacta, '+++' aquí es contenido
            if raw.startswith("+"):
                new_left -= 1
                kind = secret_kind(raw[1:])
                if kind and archivo:
                    hits.append({"archivo": archivo, "linea": line_no, "tipo": kind})
                line_no += 1
            elif raw.startswith("-"):
                old_left -= 1
            elif raw.startswith(" "):
                old_left -= 1
                new_left -= 1
                line_no += 1
            continue
        if raw.startswith("diff --git "):
            archivo = None
        elif raw.startswith("+++ "):
            dest = _unquote(raw[4:].rstrip("\t"))
            archivo = dest[2:] if dest.startswith("b/") else None
        else:
            m = HUNK_RE.match(raw)
            if m:
                old_left = int(m.group(1)) if m.group(1) is not None else 1
                line_no = int(m.group(2))
                new_left = int(m.group(3)) if m.group(3) is not None else 1
    return hits


# ---- clasificadores
def is_test_name(path):
    return bool(TEST_NAME_RE.match(path.rsplit("/", 1)[-1]))


def in_test_dir(path):
    return any(p in TEST_DIRS for p in path.split("/")[:-1])


def is_test(path):
    return is_test_name(path) or in_test_dir(path)


def test_lost_by_rename(old, new):
    """Un renombre 'borra' un test si pierde el nombre de test (tests/test_x.py → tests/README.md)
    o si sale de la carpeta de tests sin quedar con nombre de test (tests/check.sh → docs/check.sh)."""
    return (is_test_name(old) and not is_test_name(new)) or (in_test_dir(old) and not is_test(new))


def is_memory(path):
    return ".memory" in path.split("/")[:-1]


def is_env(path):
    name = path.rsplit("/", 1)[-1]
    return name == ".env" or name.startswith(".env.")


def touched_paths(cambios):
    paths = []
    for c in cambios:
        for p in (c.get("desde"), c["archivo"]):
            if p and p not in paths:
                paths.append(p)
    return paths


def _lista(nombres, limite=5):
    extra = len(nombres) - limite
    return ", ".join(nombres[:limite]) + (f" (+{extra})" if extra > 0 else "")


# ---- entrada
def _globs(pieza, key, pid):
    value = pieza.get(key)
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(g, str) and g.strip() for g in value):
        raise DataError(f"pieza {pid}: '{key}' debe ser una lista de globs (texto no vacío)")
    compilados = []
    for g in value:
        try:
            compilados.append(glob_to_regex(g))
        except re.error as exc:
            raise DataError(f"pieza {pid}: glob inválido en '{key}' (#{len(compilados) + 1})")
    return compilados


def load_input(source):
    try:
        if source == "-":
            text = sys.stdin.read()
        else:
            with open(source, encoding="utf-8") as stream:
                text = stream.read()
    except OSError as exc:  # sin str(exc): repetiría la ruta escapada con repr
        code = errno.errorcode.get(exc.errno, "error de E/S") if exc.errno else "error de E/S"
        raise DataError(f"no pude leer la entrada ({code})")
    except UnicodeError:
        raise DataError("no pude leer la entrada (no es UTF-8)")
    try:
        data = json.loads(text)
    except ValueError as exc:
        donde = f" (línea {exc.lineno}, columna {exc.colno})" if isinstance(exc, json.JSONDecodeError) else ""
        raise DataError("la entrada no es JSON válido" + donde)
    if not isinstance(data, dict):
        raise DataError("la entrada debe ser un objeto JSON")
    check_unicode(data)
    base = data.get("base")
    if not isinstance(base, str) or not base.strip():
        raise DataError("falta 'base' (rama base, p. ej. main)")
    regla = data.get("regla", "all_success")
    if regla not in REGLAS:
        raise DataError(f"'regla' inválida; válidas: {', '.join(REGLAS)}")  # sin eco del valor
    piezas = data.get("piezas")
    if not isinstance(piezas, list) or not piezas:
        raise DataError("'piezas' debe ser una lista no vacía")
    vistas, normal = set(), []
    for n, p in enumerate(piezas, 1):
        if not isinstance(p, dict):
            raise DataError(f"pieza #{n}: debe ser un objeto")
        pid = p.get("id")
        if not isinstance(pid, str) or not pid.strip():
            raise DataError(f"pieza #{n}: falta 'id'")
        if pid in vistas or redact(pid) in vistas:
            raise DataError(f"pieza {pid}: id duplicado")
        if REDACTADO_PREFIX in pid:
            raise DataError(f"pieza #{n}: el id no puede contener {REDACTADO_PREFIX}")
        vistas.update((pid, redact(pid)))
        rama = p.get("rama")
        if rama is not None and not isinstance(rama, str):
            raise DataError(f"pieza {pid}: 'rama' debe ser texto")
        estado = p.get("estado_worker", "sin_reporte")
        if estado not in ESTADOS_WORKER:
            raise DataError(f"pieza {pid}: estado_worker inválido; válidos: {', '.join(ESTADOS_WORKER)}")
        solo = p.get("solo_lectura", False)
        if not isinstance(solo, bool):
            raise DataError(f"pieza {pid}: 'solo_lectura' debe ser true o false")
        pbase = p.get("base")
        if pbase is not None and (not isinstance(pbase, str) or not pbase.strip()):
            raise DataError(f"pieza {pid}: 'base' debe ser texto no vacío (rama contra la que se compara esta pieza)")
        base_de = p.get("base_de")
        if "base_de" in p:
            if (not isinstance(base_de, list) or not base_de
                    or any(not isinstance(x, str) or not x.strip() for x in base_de)):
                raise DataError(f"pieza {pid}: 'base_de' debe ser una lista no vacía de ids")
            if not pbase:
                raise DataError(f"pieza {pid}: 'base_de' requiere 'base'")
            if pid in base_de:
                raise DataError(f"pieza {pid}: 'base_de' no puede incluir su propio id")
            base_de = list(dict.fromkeys(base_de))
        normal.append({"id": pid, "rama": rama or None, "base": pbase or None, "base_de": base_de,
                       "estado_worker": estado, "solo_lectura": solo,
                       "archivos": _globs(p, "archivos", pid),
                       "archivos_perfil": _globs(p, "archivos_perfil", pid) if "archivos_perfil" in p else None,
                       "no_toca": _globs(p, "no_toca", pid)})
    return base, regla, normal


# ---- revisión
def revisar_pieza(top, base, base_sha, p):
    res = {"id": p["id"], "rama": p["rama"], "base": base, "estado_worker": p["estado_worker"], "error": None,
           "cambios": [], "fuera_de_alcance": [], "solo_lectura_violado": False, "tests_borrados": [],
           "memoria": [], "env": [], "secretos": [], "no_revisados": [], "resoluciones": [],
           "veredicto": "falla", "motivos": []}
    motivos = res["motivos"]
    if not p["archivos"]:
        motivos.append("sin alcance: la pieza no declara archivos")
    if p["estado_worker"] in NO_LLEGO:
        motivos.append(f"la rama de {p['id']} no llegó (worker {p['estado_worker']})")
    elif p["estado_worker"] != "succeeded":
        motivos.append(f"worker {p['estado_worker']}")

    rama_sha = resolve(top, p["rama"]) if p["rama"] and base_sha != PARCIAL else None
    if base_sha == PARCIAL:
        res["error"] = PARCIAL
    elif p["rama"] is None:
        res["error"] = "rama no indicada"
    elif base_sha is None:
        res["error"] = f"rama inexistente: base {base}"
    elif rama_sha is None:
        res["error"] = f"rama inexistente: {p['rama']}"
    else:
        try:
            rc, _, _ = git(top, "merge-base", base_sha, rama_sha)
            if rc == 1:
                raise RuntimeError("sin ancestro común con la base")
            res["cambios"], blobs = raw_changes(top, base_sha, rama_sha)
            if not res["cambios"] and not p["solo_lectura"]:
                motivos.append("sin cambios: el worker no dejó commits en su rama")
            res["no_revisados"] = [{"archivo": a, "razon": r}
                                   for a, r in sorted(unreviewable(top, blobs).items())]
            res["secretos"] = path_secrets(res["cambios"]) + added_secrets(
                top, base_sha, rama_sha, [x["archivo"] for x in res["no_revisados"]])
        except RuntimeError as exc:  # mensajes propios (_failed / merge-base), nunca stderr de git
            res["error"] = str(exc)
    if res["error"]:
        motivos.append(res["error"])

    cambios = res["cambios"]
    tocados = touched_paths(cambios)
    permitidos, prohibidos = p["archivos"], p["no_toca"]
    perfil = p.get("archivos_perfil")
    res["fuera_de_alcance"] = [f for f in tocados
                               if (permitidos and not matches_any(f, permitidos))
                               or (perfil is not None and not matches_any(f, perfil))
                               or matches_any(f, prohibidos)]
    res["solo_lectura_violado"] = bool(p["solo_lectura"] and cambios)
    borrados = []
    for c in cambios:
        if c["estado"] == "D" and is_test(c["archivo"]):
            borrados.append(c["archivo"])
        elif c["estado"] == "R" and test_lost_by_rename(c["desde"], c["archivo"]):
            borrados.append(c["desde"])
    res["tests_borrados"] = borrados
    res["memoria"] = [f for f in tocados if is_memory(f)]
    res["env"] = [c["archivo"] for c in cambios if c["estado"] in "AMRCT" and is_env(c["archivo"])]

    if perfil == [] and cambios:
        motivos.append("archivos_perfil vacío: no permite ningún archivo (todo cambio queda fuera de alcance)")
    if res["fuera_de_alcance"]:
        motivos.append("fuera de alcance: " + _lista(res["fuera_de_alcance"]))
    if res["solo_lectura_violado"]:
        motivos.append(f"solo lectura pero cambió {len(cambios)} archivo(s)")
    if borrados:
        motivos.append("borró tests: " + _lista(borrados))
    if res["memoria"]:
        motivos.append("tocó .memory/ (un worker no escribe la memoria): " + _lista(res["memoria"]))
    if res["env"]:
        motivos.append("agregó/modificó .env: " + _lista(res["env"]))
    if res["secretos"]:
        motivos.append("posible secreto en " + _lista(
            [f"{s['archivo']}:{s['linea']} ({s['tipo']})" for s in res["secretos"]], 3))
    for x in res["no_revisados"]:  # conservador: lo que no se pudo leer no se aprueba
        motivos.append(f"no revisado: {x['archivo']} ({x['razon']})")
    if not motivos:
        res["veredicto"] = "ok"
    return res


def revisar(repo, base, regla, piezas):
    top = toplevel(repo)
    # Cada pieza se compara contra SU base (la rama de su dependencia, si partió de ella) o la global.
    parcial = is_partial_clone(top)
    shas = {}

    def base_sha_de(b):
        if parcial:
            return PARCIAL
        if b not in shas:
            shas[b] = resolve(top, b)
        return shas[b]

    resultados = []
    for p in piezas:
        pb = p.get("base") or base
        resultados.append(revisar_pieza(top, pb, base_sha_de(pb), p))
    propagar_dependencias(top, piezas, resultados, base)
    ok = [r["id"] for r in resultados if r["veredicto"] == "ok"]
    malas = [{"id": r["id"], "motivos": r["motivos"]} for r in resultados if r["veredicto"] != "ok"]
    if regla == "all_success":
        integrar = ok if not malas else []
        decision = "integrar" if not malas else "no integrar"
    else:
        integrar = ok
        decision = "integrar" if not malas else ("integrar parcial" if ok else "no integrar")
    salida = {"regla": regla, "base": base, "piezas": resultados, "integrar": integrar,
              "faltan": malas, "decision": decision}
    if regla == "all_done":
        salida["nota"] = NOTA_ALL_DONE
    return salida


def tree_entries(top, sha, paths):
    """Entradas exactas (modo/tipo/objeto), incluyendo ausencias, sin interpretar pathspecs."""
    rc, out, err = git(top, "ls-tree", "-r", "-z", "--full-tree", sha)
    if rc != 0:
        raise _failed("git ls-tree", rc, err)
    entries = {}
    for entry in out.split(b"\0"):
        if not entry:
            continue
        metadata, raw_path = entry.split(b"\t", 1)
        path = raw_path.decode("utf-8", "surrogateescape")
        if path in paths:
            entries[path] = tuple(metadata.split())
    return entries


def comprobar_base_combinada(top, base_global, p, por_id):
    """Revisa el contenido integrado y exige identidad para archivos con un único autor.
    Archivos tocados por varias piezas son resoluciones explícitas, igualmente escaneadas."""
    base_sha, global_sha = resolve(top, p["base"]), resolve(top, base_global)
    if not base_sha or not global_sha:
        raise RuntimeError("base combinada no verificable: rama base inexistente")
    autores, shas = {}, {}
    for pid in p["base_de"]:
        madre = por_id[pid]
        sha = resolve(top, madre["rama"]) if madre["rama"] else None
        if not sha:
            raise RuntimeError(f"base combinada: rama inexistente para {pid}")
        rc, _, err = git(top, "merge-base", "--is-ancestor", sha, base_sha)
        if rc == 1:
            raise RuntimeError(f"base combinada: la rama de {pid} no es ancestro de la base")
        if rc != 0:
            raise _failed("git merge-base", rc, err)
        shas[pid] = sha
        for path in touched_paths(madre["cambios"]):
            autores.setdefault(path, []).append(pid)

    # Reutiliza todos los escáneres y diagnósticos de una pieza (también límites y errores).
    integrada = {**p, "rama": p["base"], "estado_worker": "succeeded", "solo_lectura": False,
                 "archivos": [glob_to_regex("**")], "archivos_perfil": None, "no_toca": []}
    revision = revisar_pieza(top, base_global, global_sha, integrada)
    motivos = ["base combinada: " + m for m in revision["motivos"]
               if m != "sin cambios: el worker no dejó commits en su rama"]
    paths = set(touched_paths(revision["cambios"]))
    if not paths <= autores.keys():
        motivos.append("base combinada con cambios no revisados")
    # Todas las rutas que tocaron las piezas, aunque la base las haya revertido o borrado
    # (no aparecen en el diff final, pero integrarlas cambiaría lo que ya se aprobó).
    todas = paths | set(autores)
    base_entries = tree_entries(top, base_sha, todas)
    madres = {}
    resoluciones = []
    for path in sorted(todas & autores.keys()):
        ids = autores[path]
        if len(ids) > 1:
            resoluciones.append(path)
            continue
        pid = ids[0]
        if pid not in madres:
            madres[pid] = tree_entries(top, shas[pid], todas)
        if base_entries.get(path) != madres[pid].get(path):
            extra = " (revertido o borrado en la base)" if path not in base_entries else ""
            motivos.append(f"base combinada con contenido no revisado: {path}{extra}")
    return motivos, resoluciones


def propagar_dependencias(top, piezas, resultados, base_global):
    """Una base propia debe ser otra pieza aprobada o declarar con base_de las piezas
    que combina: todas aprobadas, ancestras de esa base y cubriendo sus rutas cambiadas.
    Los rechazos se propagan por todas las dependencias hasta alcanzar un punto fijo."""
    por_id = {r["id"]: r for r in resultados}
    rama_a_id = {p["rama"]: p["id"] for p in piezas if p.get("rama")}
    dep = {}
    for p in piezas:
        pb = p.get("base")
        r = por_id[p["id"]]
        if p.get("base_de"):
            dep[p["id"]] = p["base_de"]
            ausentes = [pid for pid in p["base_de"] if pid not in por_id]
            if ausentes:
                r["veredicto"] = "falla"
                r["motivos"].append("base combinada: ids fuera del lote: " + _lista(ausentes))
            elif r["veredicto"] == "ok":
                try:
                    motivos, r["resoluciones"] = comprobar_base_combinada(top, base_global, p, por_id)
                    r["motivos"].extend(motivos)
                    if motivos:
                        r["veredicto"] = "falla"
                except RuntimeError as exc:  # solo mensajes propios, sin stderr de git
                    r["veredicto"] = "falla"
                    r["motivos"].append(str(exc))
            continue
        if not pb or pb == base_global:
            continue
        if pb == p.get("rama"):
            r["veredicto"] = "falla"
            r["motivos"].append("su base es su propia rama: no hay nada que revisar")
        elif pb not in rama_a_id:
            r["veredicto"] = "falla"
            r["motivos"].append("base no revisada: no es la base global ni la rama de otra pieza de esta junta")
        else:
            dep[p["id"]] = [rama_a_id[pb]]
    cambio = True
    while cambio:
        cambio = False
        for hija, madres in dep.items():
            rh = por_id[hija]
            for madre in madres:
                rm = por_id.get(madre)
                if rm is not None and rm["veredicto"] != "ok":
                    motivo = f"depende de {madre}, que no se integra (integrarla arrastraría sus cambios)"
                    if motivo not in rh["motivos"]:
                        rh["motivos"].append(motivo)
                    if rh["veredicto"] == "ok":
                        rh["veredicto"] = "falla"
                        cambio = True


def texto(s):
    filas = [("pieza", "worker", "cambios", "veredicto", "motivos")]
    for r in s["piezas"]:
        filas.append((r["id"], r["estado_worker"], str(len(r["cambios"])), r["veredicto"],
                      "; ".join(r["motivos"] + (["resoluciones: " + _lista(r["resoluciones"])]
                                                if r["resoluciones"] else [])) or "—"))
    anchos = [max(len(f[i]) for f in filas) for i in range(4)]
    lineas = []
    for n, f in enumerate(filas):
        lineas.append(" | ".join(f[i].ljust(anchos[i]) for i in range(4)) + " | " + f[4])
        if n == 0:
            lineas.append("-+-".join("-" * a for a in anchos) + "-+-" + "-" * 7)
    lineas.append("")
    if "nota" in s:
        lineas.append("Nota: " + s["nota"])
    detalle = []
    if s["integrar"]:
        detalle.append("integrar " + ", ".join(s["integrar"]))
    if s["faltan"]:
        detalle.append(("no integra por " if s["regla"] == "all_success" else "faltan ")
                       + ", ".join(f["id"] for f in s["faltan"]))
    lineas.append(f"Decisión ({s['regla']}): {s['decision']}" + (" — " + " · ".join(detalle) if detalle else ""))
    return "\n".join(lineas)


def main(argv=None):
    parser = UsageParser(prog="junta.py", description=__doc__, allow_abbrev=False)  # prog fijo: argv[0] no se imprime
    commands = parser.add_subparsers(dest="command", required=True)
    rev = commands.add_parser("revisar", allow_abbrev=False)
    rev.add_argument("repo")
    rev.add_argument("entrada")
    rev.add_argument("--texto", action="store_true")
    args = parser.parse_args(argv)
    try:
        base, regla, piezas = load_input(args.entrada)
        salida = printable(redact(revisar(args.repo, base, regla, piezas)))
        out = texto(salida) if args.texto else json.dumps(salida, ensure_ascii=False, indent=2)
        data = (out + "\n").encode("utf-8")
    except DataError as exc:
        return fail(f"error: {exc}")
    except Exception as exc:  # sin traceback ni str(exc): podría arrastrar valores de la entrada
        return fail(f"error: fallo interno ({type(exc).__name__})")
    try:
        sys.stdout.flush()
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    except OSError:  # stdout cerrado (BrokenPipe): salida silenciosa, exit 1, sin traceback
        _silence(sys.stdout)
        return 1
    return 0


def _silence(stream):
    """Apunta el descriptor a /dev/null para que el flush final de Python no vuelva a fallar."""
    try:
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, stream.fileno())
        os.close(devnull)
    except (OSError, ValueError):
        pass


def write_err(message):
    try:
        sys.stderr.flush()
        sys.stderr.buffer.write((printable(redact(message)) + "\n").encode("utf-8"))
        sys.stderr.buffer.flush()
    except OSError:
        _silence(sys.stderr)


def fail(message):
    write_err(message)
    return 1


if __name__ == "__main__":
    sys.exit(main())
