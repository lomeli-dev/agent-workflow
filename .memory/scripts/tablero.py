#!/usr/bin/env python3
"""Kanban local de .memory/plans, sin dependencias ni importaciones del validador."""
import argparse
import json
import os
import re
import stat
import sys
import tempfile
from datetime import datetime
from pathlib import Path


ESTADOS = ("backlog", "listo", "en-curso", "esperando", "revision", "bloqueado", "hecho", "descartado")
FIELD_RE = re.compile(r"^([A-Za-z0-9_]+):\s*(.*)$")
SECTION_RE = re.compile(r"^##\s+(.+?)\s*$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$")


class UsageParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, f"uso: tablero.py ver <raiz> [--json] | mover <raiz> <slug> <estado> --motivo <texto>\n{message}\n")


def is_iso(value):
    if not ISO_RE.fullmatch(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def markdown_lines(lines, start=0):
    """Líneas fuera de fences, con sus índices para conservar el archivo original."""
    fence = None
    for i in range(start, len(lines)):
        line = lines[i]
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line.rstrip("\r\n"))
        if fence is not None:
            if (marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence)
                    and not marker[2].strip()):
                fence = None
            continue
        if marker:
            fence = marker[1]
            continue
        yield i, line


def sections(lines, start):
    """Rangos de contenido, sin reserializar el markdown original."""
    result = {}
    current = None
    for i, line in markdown_lines(lines, start):
        match = SECTION_RE.match(line.rstrip("\r\n"))
        if match:
            if current is not None:
                result[current][1] = i
            current = match.group(1).strip()
            result[current] = [i + 1, len(lines)]
    return result


def read_plan(path):
    with path.open(encoding="utf-8", newline="") as stream:
        lines = stream.read().splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError(f"{path.name}: falta frontmatter")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ValueError(f"{path.name}: frontmatter sin cierre")
    fields, positions = {}, {}
    for i in range(1, end):
        match = FIELD_RE.match(lines[i].rstrip("\r\n"))
        if match:
            key, value = match.groups()
            if key in fields:
                raise ValueError(f"{path.name}: clave duplicada {key}")
            fields[key] = value.strip().strip('\"\'')
            positions[key] = i
    for key in ("name", "description", "date"):
        if not fields.get(key):
            raise ValueError(f"{path.name}: falta {key}")
    if not is_iso(fields["date"]):
        raise ValueError(f"{path.name}: date no es ISO-8601")
    check_estado(fields.get("estado", "backlog"))
    ranges = sections(lines, end + 1)
    for title in ("Pasos", "Dependencias", "Riesgos"):
        start, stop = ranges.get(title, (0, 0))
        content = re.sub(r"<!--.*?-->", "", "".join(lines[start:stop]), flags=re.DOTALL)
        if not content.strip():
            raise ValueError(f"{path.name}: falta contenido en ## {title}")
    return lines, fields, positions, ranges


def check_estado(estado):
    if estado not in ESTADOS:
        raise ValueError(f"estado inválido {estado!r}; válidos: {', '.join(ESTADOS)}")


def table_cells(line):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|") and not line.endswith("\\|"):
        line = line[:-1]
    cells, start, backticks = [], 0, None
    for match in re.finditer(r"\\.|`+|\|", line):
        token = match[0]
        if token.startswith("`"):
            if backticks == token:
                backticks = None
            elif backticks is None:
                # Un backtick sin cierre es texto, no un code span.
                closing = re.search(r"(?<!`)" + re.escape(token) + r"(?!`)", line[match.end():])
                if closing:
                    backticks = token
        elif token == "|" and backticks is None:
            cells.append(line[start:match.start()].strip())
            start = match.end()
    cells.append(line[start:].strip())
    return cells


def progress(lines):
    visible = dict(markdown_lines(lines))
    lines = [visible.get(i, "") for i in range(len(lines))]
    for i in range(len(lines) - 1):
        headers = [cell.casefold() for cell in table_cells(lines[i])]
        if "estado" not in headers or "|" not in lines[i]:
            continue
        separator = table_cells(lines[i + 1])
        if len(separator) != len(headers) or not all(re.fullmatch(r":?-+:?", c) for c in separator):
            continue
        column = headers.index("estado")
        done, total = 0, 0
        for line in lines[i + 2:]:
            cells = table_cells(line)
            if "|" not in line or len(cells) != len(headers):
                break
            total += 1
            done += cells[column] in ("completed", "hecho")
        return {"hechas": done, "total": total}
    return None


def card(path):
    lines, fields, _, ranges = read_plan(path)
    start, stop = ranges.get("Orquestación", (0, 0))
    progreso = progress(lines[start:stop])
    start, stop = ranges.get("Historial", (0, 0))
    history = [line.strip() for _, line in markdown_lines(lines[start:stop])
               if line.strip() and not line.strip().startswith("<!--")]
    last_change = fields["date"]
    if history:
        date = re.sub(r"^-\s+", "", history[-1]).split(" · ", 1)[0].strip()
        if not is_iso(date):
            raise ValueError(f"{path.name}: última línea de Historial sin fecha ISO-8601")
        last_change = date
    return {"slug": path.stem, "estado": fields.get("estado", "backlog"),
            "sin_estado": "estado" not in fields, "description": fields["description"],
            "progreso": progreso, "ultimo_cambio": last_change}


def show(root, as_json):
    memory = root / ".memory"
    if not memory.is_dir():
        raise ValueError(f"no hay .memory/ en {root}")
    cards, errors = [], []
    for path in sorted((memory / "plans").glob("*.md")):
        try:
            cards.append(card(path))
        except (OSError, UnicodeError, ValueError) as exc:
            reason = str(exc)
            if reason.startswith(f"{path.name}: "):
                reason = reason[len(path.name) + 2:]
            errors.append({"slug": path.stem, "error": reason})
    cards.sort(key=lambda item: ESTADOS.index(item["estado"]))
    if as_json:
        print(json.dumps(cards + errors, ensure_ascii=False))
    elif not cards and not errors:
        print("tablero vacío")
    else:
        groups = {estado: [item for item in cards if item["estado"] == estado] for estado in ESTADOS}
        print(" · ".join(f"{estado} {len(group)}" for estado, group in groups.items()))
        for estado, group in groups.items():
            if not group:
                continue
            print(f"## {estado} ({len(group)})")
            for item in group:
                label = item["slug"] + (" (sin estado)" if item["sin_estado"] else "")
                parts = [f"- {label} — {item['description']}"]
                if item["progreso"] is not None:
                    p = item["progreso"]
                    parts.append(f"{p['hechas']}/{p['total']} tareas")
                parts.append(f"últ. cambio {item['ultimo_cambio']}")
                print(" · ".join(parts))
        if errors:
            print(f"## errores ({len(errors)})")
            for item in errors:
                print(f"- {item['slug']}.md — error: {item['error']}")
    return 1 if errors else 0


def atomic_write(path, content):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", dir=path.parent,
                                         prefix=f".{path.name}.", delete=False) as stream:
            temporary = stream.name
            os.fchmod(stream.fileno(), stat.S_IMODE(path.stat().st_mode))
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            os.unlink(temporary)


def move(root, slug, estado, motivo, registrar=False):
    check_estado(estado)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", slug):
        raise ValueError(f"slug inválido: {slug}")
    path = root / ".memory" / "plans" / f"{slug}.md"
    if not path.is_file():
        raise ValueError(f"no existe el plan {slug}: {path}")
    lines, fields, positions, _ = read_plan(path)
    same = fields.get("estado", "backlog") == estado and "estado" in fields
    if fields.get("estado", "backlog") == estado and not registrar:
        print(f"sin cambio: {slug} ya está en {estado}")
        return
    previous = fields.get("estado", "—")
    newline = "\r\n" if lines[0].endswith("\r\n") else "\n"
    if "estado" in positions:
        index = positions["estado"]
        ending = "\r\n" if lines[index].endswith("\r\n") else "\n"
        lines[index] = f"estado: {estado}{ending}"
    else:
        lines.insert(positions["date"] + 1, f"estado: {estado}{newline}")
    ranges = sections(lines, 1)
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    entry = f"- {now} · {previous} → {estado} · {motivo}{newline}"
    if "Historial" in ranges:
        start, stop = ranges["Historial"]
        while stop > start and not lines[stop - 1].strip():
            stop -= 1
        if stop and not lines[stop - 1].endswith("\n"):
            lines[stop - 1] += newline
        lines.insert(stop, entry)
    else:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += newline
        lines.extend([newline, f"## Historial{newline}", entry])
    atomic_write(path, "".join(lines))
    if same:
        print(f"ok: {slug} sigue en {estado}; registrado en Historial")
    else:
        print(f"ok: {slug} {previous} → {estado}")


def main(argv=None):
    parser = UsageParser(description=__doc__, allow_abbrev=False)
    commands = parser.add_subparsers(dest="command", required=True)
    ver = commands.add_parser("ver", allow_abbrev=False)
    ver.add_argument("raiz", type=Path)
    ver.add_argument("--json", action="store_true")
    mover = commands.add_parser("mover", allow_abbrev=False)
    mover.add_argument("raiz", type=Path)
    mover.add_argument("slug")
    mover.add_argument("estado")
    mover.add_argument("--motivo", required=True)
    mover.add_argument("--registrar", action="store_true",
                       help="si ya está en ese estado, agrega igual la línea al Historial (hito sin cambio de estado)")
    args = parser.parse_args(argv)
    if args.command == "mover":
        motivo_lines = args.motivo.splitlines()
        if len(motivo_lines) != 1 or not args.motivo.strip() or motivo_lines[0] != args.motivo:
            parser.error("--motivo requiere texto no vacío en una sola línea, sin separadores de línea")
    try:
        if args.command == "ver":
            return show(args.raiz, args.json)
        else:
            move(args.raiz, args.slug, args.estado, args.motivo, args.registrar)
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
