#!/usr/bin/env python3
"""Calcula el reparto y resuelve perfiles de orquesta, usando solo la stdlib."""
import argparse
import fnmatch
import json
import math
import re
import sys
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path


TIPOS = ("backend", "frontend", "tests", "db", "docs", "quickfix", "infra")
FABRICA = {
    "_base": {"solo_lectura": False},
    "backend": {"agente": "claude"},
    "frontend": {"agente": "antigravity"},
    "tests": {"agente": "codex", "no_toca": ["src/**"]},
    "db": {"agente": "claude", "esfuerzo": "high"},
    "docs": {"agente": "opencode2"},
    "quickfix": {"agente": "opencode", "max_minutos": 8},
    "reviewer": {"agente": "codex", "solo_lectura": True},
    "destripador": {"agente": "claude", "esfuerzo": "high", "solo_lectura": True},
}


class UsageParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "uso: reparto.py plan <archivo.json | -> [--max-agentes N] "
                  "[--max-paralelo N] [--texto] | perfil <nombre> [--config <ruta>]\n"
                  + message + "\n")


def positive(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("se requiere un entero positivo")
    if number < 1:
        raise argparse.ArgumentTypeError("se requiere un entero positivo")
    return number


def string_list(value, field):
    if not isinstance(value, list) or any(not isinstance(v, str) or not v.strip() for v in value):
        raise ValueError(f"{field}: se requiere una lista de textos no vacíos")
    return list(dict.fromkeys(value))


def point_units(piece):
    """Centésimas exactas para comparar umbrales sin redondeo previo."""
    return (len(piece["archivos"]) * 100 + piece["lineas"]
            + {"db": 200, "infra": 100}.get(piece["tipo"], 0))


def rounded_points(units):
    with localcontext() as context:
        context.prec = len(str(units)) + 3
        rounded = (Decimal(units) / 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    result = float(rounded)
    if not math.isfinite(result):
        raise ValueError("lineas demasiado grande para representar puntos en JSON")
    return result


def points(piece):
    return rounded_points(point_units(piece))


def validate(data):
    if not isinstance(data, dict) or not isinstance(data.get("piezas"), list):
        raise ValueError("se requiere un objeto con una lista piezas")
    if not data["piezas"]:
        raise ValueError("no hay piezas: no encontré qué cambiar")
    pieces = {}
    for item in data["piezas"]:
        if not isinstance(item, dict):
            raise ValueError("pieza: se requiere un objeto")
        name = item.get("id")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9+-]*", name):
            raise ValueError(f"id inválido: {name!r}")
        if name in pieces:
            raise ValueError(f"id duplicado: {name}")
        if item.get("tipo") not in TIPOS:
            raise ValueError(f"pieza {name}: tipo inválido {item.get('tipo')!r}")
        if type(item.get("lineas")) is not int or item["lineas"] < 0:
            raise ValueError(f"pieza {name}: lineas debe ser un entero ≥ 0")
        for key in ("titulo", "criterio"):
            if not isinstance(item.get(key), str):
                raise ValueError(f"pieza {name}: {key} debe ser texto")
        if not item["criterio"].strip():
            raise ValueError(f"pieza {name}: criterio no puede estar vacío")
        piece = {key: item[key] for key in ("id", "titulo", "lineas", "tipo", "criterio")}
        piece["archivos"] = string_list(item.get("archivos"), f"pieza {name}: archivos")
        if not piece["archivos"]:
            raise ValueError(f"pieza {name}: archivos no puede estar vacío")
        piece["deps"] = string_list(item.get("deps", []), f"pieza {name}: deps")
        piece["puntos"] = points(piece)
        pieces[name] = piece
    for name, piece in pieces.items():
        for dep in piece["deps"]:
            if dep not in pieces:
                raise ValueError(f"pieza {name}: dep inexistente {dep}")
    return pieces


def reaches(pieces, start, target):
    pending, seen = list(pieces[start]["deps"]), set()
    while pending:
        name = pending.pop()
        if name == target:
            return True
        if name not in seen:
            seen.add(name)
            pending.extend(pieces[name]["deps"])
    return False


def merge_small(pieces):
    merged = []
    while True:
        pair = None
        small = sorted(name for name, p in pieces.items() if point_units(p) < 150)
        for i, a in enumerate(small):
            for b in small[i + 1:]:
                if (pieces[a]["tipo"] == pieces[b]["tipo"]
                        and set(pieces[a]["archivos"]) & set(pieces[b]["archivos"])
                        and not any(reaches(pieces, x, y) for x, y in
                                    ((a, b), (b, a), (a, a), (b, b)))):
                    pair = a, b
                    break
            if pair:
                break
        if pair is None:
            return merged
        a, b = pair
        name = "+".join(sorted(a.split("+") + b.split("+")))
        if name in pieces:
            raise ValueError(f"colisión de id al fusionar: {name} ya existe; renombra la pieza")
        left, right = pieces.pop(a), pieces.pop(b)
        piece = {
            "id": name, "titulo": left["titulo"] + " + " + right["titulo"],
            "criterio": left["criterio"] + "\n" + right["criterio"],
            "archivos": sorted(set(left["archivos"] + right["archivos"])),
            "lineas": left["lineas"] + right["lineas"],
            "tipo": left["tipo"],
            "deps": sorted(set(left["deps"] + right["deps"]) - {a, b}),
        }
        piece["puntos"] = points(piece)
        pieces[name] = piece
        for other in pieces.values():
            other["deps"] = sorted({name if dep in pair else dep for dep in other["deps"]})
        merged.append({"de": [a, b], "a": name})


def topological_levels(pieces):
    """DFS iterativo: conserva un camino para explicar ciclos sin límite de recursión."""
    levels, active, path = {}, set(), []
    for root in sorted(pieces):
        if root in levels:
            continue
        stack = [(root, False)]
        while stack:
            name, closing = stack.pop()
            if closing:
                levels[name] = 1 + max((levels[d] for d in pieces[name]["deps"]), default=0)
                active.remove(name)
                path.pop()
            elif name in active:
                raise ValueError("ciclo: " + " → ".join(path[path.index(name):] + [name]))
            elif name not in levels:
                active.add(name)
                path.append(name)
                stack.append((name, True))
                stack.extend((dep, False) for dep in reversed(sorted(pieces[name]["deps"])))
    return levels


def waves(pieces):
    """List scheduling: cada iteración consume al menos una pieza, máximo n olas."""
    topological_levels(pieces)  # Rechazar ciclos antes de construir el reparto.
    pending, done = set(pieces), set()
    scheduled, conflicts = [], []
    effective = {name: set(piece["deps"]) for name, piece in pieces.items()}
    for _ in range(len(pieces)):
        if not pending:
            break
        ready = sorted(name for name in pending if effective[name] <= done)
        if not ready:
            raise ValueError("no hay piezas listas: dependencias sin resolver")
        databases = [name for name in ready if pieces[name]["tipo"] == "db"]
        if databases:
            wave = [databases[0]]
            for name in ready:
                if name != wave[0]:
                    effective[name].add(wave[0])
        else:
            wave = []
            for name in ready:
                blockers = []
                for earlier in wave:
                    shared = sorted(set(pieces[earlier]["archivos"]) & set(pieces[name]["archivos"]))
                    if shared:
                        blockers.append(earlier)
                        conflicts.extend({"archivo": filename, "piezas": [earlier, name],
                                          "accion": "en fila"} for filename in shared)
                if blockers:
                    effective[name].update(blockers)
                else:
                    wave.append(name)
        scheduled.append(wave)
        pending.difference_update(wave)
        done.update(wave)
    for name, piece in pieces.items():
        piece["deps_efectivas"] = sorted(effective[name])
    return scheduled, conflicts


def plan(data, max_agents=6, max_parallel=4):
    pieces = validate(data)
    merged = merge_small(pieces)
    scheduled, conflicts = waves(pieces)
    # El total suma los puntos publicados, conservando centésimas enteras.
    total_units = sum(((point_units(p) + 5) // 10) * 10 for p in pieces.values())
    total = rounded_points(total_units)
    by_size = max(1, (total_units + 299) // 300)
    count = min(len(pieces), max_agents)
    cap = "max_agentes" if count < len(pieces) else "piezas"
    scheduled = [wave[i:i + max_parallel] for wave in scheduled
                 for i in range(0, len(wave), max_parallel)]
    # Una barrera entre olas conserva db-sola y max_paralelo al lanzar con --ready,
    # incluso si una tarea independiente de una ola anterior tarda más que otra.
    previous = []
    for wave in scheduled:
        for name in wave:
            pieces[name]["deps_efectivas"] = sorted(set(pieces[name]["deps_efectivas"]) | set(previous))
        previous = wave
    ordered = [name for wave in scheduled for name in wave]
    # Un prefijo topológico queda cerrado bajo deps originales y efectivas.
    apartadas = ordered[count:]
    selected = set(ordered[:count])
    scheduled = [[name for name in wave if name in selected] for wave in scheduled]
    scheduled = [wave for wave in scheduled if wave]
    assigned = {name: i for i, wave in enumerate(scheduled, 1) for name in wave}
    for name, piece in pieces.items():
        piece["perfil_sugerido"] = "backend" if piece["tipo"] == "infra" else piece["tipo"]
        piece["ola"] = assigned.get(name)
        units = point_units(piece)
        if units > 600:
            piece.update(partir=True, sugerencia=f"dividir en {(units + 299) // 300} piezas")
    return {"piezas": [pieces[name] for name in sorted(pieces)], "olas": scheduled,
            "total_puntos": total, "n_por_tamano": by_size, "n": count, "tope": cap,
            "apartadas": apartadas, "fusionadas": merged, "conflictos": conflicts}


def load_profiles(path):
    if not path.exists():
        return FABRICA
    with path.open(encoding="utf-8") as stream:
        config = json.load(stream)
    if not isinstance(config, dict) or not isinstance(config.get("orquesta", {}), dict):
        raise ValueError("config: se requiere un objeto orquesta")
    profiles = config.get("orquesta", {}).get("perfiles", {})
    if not isinstance(profiles, dict):
        raise ValueError("config: perfiles debe ser un objeto")
    if not profiles:
        return FABRICA
    # Personalizar un nombre de fábrica conserva sus restricciones como las de un padre.
    merged = {**FABRICA, **profiles}
    for name in FABRICA.keys() & profiles.keys():
        item = profiles[name]
        merged[name] = restrict_profile(FABRICA[name], item, f"perfil {name}")
        if "extends" in item:
            merged[name]["extends"] = item["extends"]
    return merged


def glob_subset(child, parent):
    """Prueba conservadora: igualdad, ruta literal o subárbol bajo prefijo literal.

    No se intenta demostrar inclusión entre globs arbitrarios; los componentes
    vacíos, . y .. se rechazan para no confundir prefijos con rutas normalizadas.
    """
    def safe(pattern):
        return not any(part in ("", ".", "..") for part in pattern.split("/"))

    if child == parent:
        return True
    if not safe(child) or not safe(parent):
        return False
    if parent == "**":
        return True
    magic = re.compile(r"[*?\[]")
    if parent.endswith("/**"):
        prefix = parent[:-2]
        if not magic.search(prefix) and child.startswith(prefix):
            return True
    # fnmatch se aplica por componente: '*' y '?' no atraviesan directorios.
    if not magic.search(child):
        parts, patterns = child.split("/"), parent.split("/")
        return len(parts) == len(patterns) and all(
            fnmatch.fnmatchcase(part, pattern) for part, pattern in zip(parts, patterns))
    return False


def restrict_profile(parent, item, prefix):
    """Fusiona campos sin relajar permisos, tanto para fábrica como para extends."""
    if not isinstance(item, dict):
        raise ValueError(f"{prefix}: se requiere un objeto")
    allowed = {"extends", "agente", "modelo", "esfuerzo", "solo_lectura",
               "archivos", "no_toca", "max_minutos"}
    unknown = sorted(set(item) - allowed)
    if unknown:
        raise ValueError(f"{prefix}: claves desconocidas: {', '.join(unknown)}")
    resolved = dict(parent)
    for key in ("agente", "modelo", "esfuerzo"):
        if key in item:
            if not isinstance(item[key], str) or not item[key].strip():
                raise ValueError(f"{prefix}: {key} debe ser texto no vacío")
            resolved[key] = item[key]
    if "solo_lectura" in item:
        if type(item["solo_lectura"]) is not bool:
            raise ValueError(f"{prefix}: solo_lectura debe ser bool")
        if resolved.get("solo_lectura") and not item["solo_lectura"]:
            raise ValueError(f"{prefix}: un hijo solo puede restringir (solo_lectura)")
        resolved["solo_lectura"] = item["solo_lectura"]
    if "archivos" in item:
        files = string_list(item["archivos"], f"{prefix}: archivos")
        if "archivos" in resolved and not all(
                any(glob_subset(child, parent) for parent in resolved["archivos"])
                for child in files):
            raise ValueError(f"{prefix}: un hijo solo puede restringir (archivos)")
        resolved["archivos"] = files
    if "no_toca" in item:
        blocked = string_list(item["no_toca"], f"{prefix}: no_toca")
        resolved["no_toca"] = list(dict.fromkeys(resolved.get("no_toca", []) + blocked))
    if "max_minutos" in item:
        minutes = item["max_minutos"]
        if type(minutes) is not int or minutes < 0:
            raise ValueError(f"{prefix}: max_minutos debe ser un entero ≥ 0")
        resolved["max_minutos"] = min(minutes, resolved.get("max_minutos", minutes))
    return resolved


def profile(name, profiles):
    if name == "_base":
        raise ValueError("_base es abstracto")
    chain, current = [], name
    while current is not None:
        if current in chain:
            raise ValueError("ciclo en extends: " + " → ".join(chain + [current]))
        if current not in profiles:
            raise ValueError(f"perfil inexistente: {current}")
        item = profiles[current]
        if not isinstance(item, dict):
            raise ValueError(f"perfil {current}: se requiere un objeto")
        allowed = {"extends", "agente", "modelo", "esfuerzo", "solo_lectura",
                   "archivos", "no_toca", "max_minutos"}
        unknown = sorted(set(item) - allowed)
        if unknown:
            raise ValueError(f"perfil {current}: claves desconocidas: {', '.join(unknown)}")
        chain.append(current)
        parent = item.get("extends", None if current == "_base" else "_base")
        if parent is not None and (not isinstance(parent, str) or not parent):
            raise ValueError(f"perfil {current}: extends debe ser un nombre")
        if parent is None and current != "_base":
            raise ValueError(f"perfil {current}: extends debe ser un nombre")
        current = parent
    resolved = {}
    for current in reversed(chain):
        item = profiles[current]
        prefix = f"perfil {current}"
        resolved = restrict_profile(resolved, item, prefix)
    resolved["cadena"] = list(reversed(chain))
    return resolved


def show_text(result):
    print("pieza | perfil | puntos | ola | deps efectivas | criterio")
    by_id = {piece["id"]: piece for piece in result["piezas"]}
    order = [name for wave in result["olas"] for name in wave] + result["apartadas"]
    for name in order:
        piece = by_id[name]
        wave = piece["ola"] if piece["ola"] is not None else "apartada"
        print(f"{piece['id']} | {piece['perfil_sugerido']} | {piece['puntos']:.1f} | "
              f"{wave} | {', '.join(piece['deps_efectivas']) or '—'} | "
              + " / ".join(piece["criterio"].splitlines()))
        if piece.get("partir"):
            print(f"  {piece['sugerencia']}")
    print(f"Olas: {len(result['olas'])}")
    print(f"N = {result['n']} agentes (mandó: {result['tope']})")
    for key in ("apartadas", "conflictos", "fusionadas"):
        if result[key]:
            print(f"{key}: {json.dumps(result[key], ensure_ascii=False)}")


def main(argv=None):
    parser = UsageParser(description=__doc__, allow_abbrev=False)
    commands = parser.add_subparsers(dest="command", required=True)
    planning = commands.add_parser("plan", allow_abbrev=False)
    planning.add_argument("archivo")
    planning.add_argument("--max-agentes", type=positive, default=6)
    planning.add_argument("--max-paralelo", type=positive, default=4)
    planning.add_argument("--texto", action="store_true")
    profiles = commands.add_parser("perfil", allow_abbrev=False)
    profiles.add_argument("nombre")
    profiles.add_argument("--config", type=Path,
                          default=Path.home() / ".config/memoria-sesion/config.json")
    args = parser.parse_args(argv)
    try:
        if args.command == "plan":
            if args.archivo == "-":
                data = json.load(sys.stdin)
            else:
                with Path(args.archivo).open(encoding="utf-8") as stream:
                    data = json.load(stream)
            result = plan(data, args.max_agentes, args.max_paralelo)
            if args.texto:
                show_text(result)
                return 0
        else:
            result = profile(args.nombre, load_profiles(args.config))
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, UnicodeError, ValueError, OverflowError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
