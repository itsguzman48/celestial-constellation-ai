"""Pipeline ETL para construcción del catálogo estelar y constelaciones.

Descarga y procesa el catálogo HYG v4.1 (NASA/Hipparcos/Yale) y las líneas oficiales
de constelaciones de la Unión Astronómica Internacional (IAU), exportando los datos
optimizados para inferencia astrométrica y visualización web.
"""

import gzip
import io
import json
from pathlib import Path
import sys
import urllib.request
import csv

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PROCESSED_DIR = DATA_DIR / "processed"

HYG_URL = "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv"
CONST_LINES_URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json"
CONST_NAMES_URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json"


def calcular_color_bv(ci: float | None, spect: str | None) -> str:
    """Calcula el color RGB aproximado de una estrella según su índice de color B-V o clase espectral."""
    if ci is not None:
        if ci < -0.2:
            return "#9db4ff"  # Azul intenso (Clase O)
        elif ci < 0.15:
            return "#bbccff"  # Azul claro / Blanco azulado (Clase B)
        elif ci < 0.4:
            return "#f8f9ff"  # Blanco puro (Clase A - Vega/Sirius)
        elif ci < 0.7:
            return "#fff4e8"  # Blanco amarillento / Amarillo (Clase F/G - Sol/Capella)
        elif ci < 1.2:
            return "#ffd2a1"  # Naranja (Clase K - Arturo/Aldebarán)
        else:
            return "#ffaa77"  # Rojo anaranjado (Clase M - Betelgeuse/Antares)

    # Fallback por tipo espectral si ci es nulo
    if spect:
        primera_letra = spect.strip()[:1].upper()
        colores = {
            "O": "#9db4ff",
            "B": "#bbccff",
            "A": "#f8f9ff",
            "F": "#fff4e8",
            "G": "#fff4e8",
            "K": "#ffd2a1",
            "M": "#ffaa77",
        }
        return colores.get(primera_letra, "#ffffff")

    return "#ffffff"


def procesar_catalogo_estelar(limite_magnitud: float = 6.0) -> list[dict]:
    """Descarga HYG y extrae estrellas visibles a ojo desnudo con atributos físicos esenciales."""
    print(f"Descargando catálogo estelar HYG desde {HYG_URL}...")
    req = urllib.request.Request(HYG_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read().decode("utf-8")

    reader = csv.DictReader(io.StringIO(content))
    estrellas = []

    for row in reader:
        try:
            mag = float(row["mag"])
            # Filtrar estrellas no visibles a simple vista excepto si tienen nombre propio
            nombre = row.get("proper", "").strip()
            if mag > limite_magnitud and not nombre:
                continue

            ra = float(row["ra"])  # en horas (0..24)
            dec = float(row["dec"])  # en grados (-90..+90)
            ci_str = row.get("ci", "").strip()
            ci = float(ci_str) if ci_str else None
            spect = row.get("spect", "").strip()
            dist_pc = float(row["dist"]) if row.get("dist") else None
            dist_ly = round(dist_pc * 3.26156, 1) if dist_pc and dist_pc < 100000 else None

            estrellas.append({
                "id": int(row["id"]),
                "hip": int(row["hip"]) if row.get("hip") and row["hip"].isdigit() else None,
                "name": nombre if nombre else None,
                "bayer": row.get("bayer", "").strip() or None,
                "con": row.get("con", "").strip() or None,
                "ra": round(ra, 4),
                "dec": round(dec, 4),
                "mag": round(mag, 2),
                "color": calcular_color_bv(ci, spect),
                "dist_ly": dist_ly,
                "spect": spect or None,
            })
        except (ValueError, KeyError):
            continue

    print(f"Estrellas procesadas y filtradas: {len(estrellas)} (magnitud <= {limite_magnitud})")
    return estrellas


def procesar_constelaciones() -> list[dict]:
    """Descarga y fusiona las líneas oficiales de asterismos y los nombres en español."""
    print("Descargando geometría de líneas y nombres de constelaciones...")
    req_lines = urllib.request.Request(CONST_LINES_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req_lines, timeout=20) as r:
        lines_geojson = json.loads(r.read().decode("utf-8"))

    req_names = urllib.request.Request(CONST_NAMES_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req_names, timeout=20) as r:
        names_geojson = json.loads(r.read().decode("utf-8"))

    # Mapa de nombres por ID (código IAU de 3 letras)
    nombres_map = {}
    for feat in names_geojson.get("features", []):
        cid = feat.get("id")
        props = feat.get("properties", {})
        nombre_es = (props.get("es") or props.get("name") or cid).replace("\u2005", " ").replace("\u00a0", " ").strip()
        nombre_en = (props.get("en") or props.get("name") or cid).replace("\u2005", " ").replace("\u00a0", " ").strip()
        nombre_latin = (props.get("name") or cid).replace("\u2005", " ").replace("\u00a0", " ").strip()
        nombres_map[cid] = {
            "nombre_es": nombre_es,
            "nombre_en": nombre_en,
            "nombre_latin": nombre_latin,
        }

    constelaciones = []
    for feat in lines_geojson.get("features", []):
        cid = feat.get("id")
        meta = nombres_map.get(cid, {"nombre_es": cid, "nombre_en": cid, "nombre_latin": cid})
        geom_type = feat.get("geometry", {}).get("type", "")
        raw_coords = feat.get("geometry", {}).get("coordinates", [])

        # Normalizar líneas a pares de segmentos [ [ra1, dec1], [ra2, dec2] ]
        segmentos = []
        if geom_type == "MultiLineString":
            for linestring in raw_coords:
                for i in range(len(linestring) - 1):
                    p1 = linestring[i]
                    p2 = linestring[i + 1]
                    # Convertir RA de grados a horas (0..24h)
                    segmentos.append([
                        [round((p1[0] % 360) / 15.0, 4), round(p1[1], 4)],
                        [round((p2[0] % 360) / 15.0, 4), round(p2[1], 4)],
                    ])
        elif geom_type == "LineString":
            for i in range(len(raw_coords) - 1):
                p1 = raw_coords[i]
                p2 = raw_coords[i + 1]
                segmentos.append([
                    [round((p1[0] % 360) / 15.0, 4), round(p1[1], 4)],
                    [round((p2[0] % 360) / 15.0, 4), round(p2[1], 4)],
                ])

        if not segmentos:
            continue

        # Calcular centroide aproximado en RA y Dec para etiquetado
        ra_sum = sum(p[0][0] + p[1][0] for p in segmentos)
        dec_sum = sum(p[0][1] + p[1][1] for p in segmentos)
        n_puntos = len(segmentos) * 2

        constelaciones.append({
            "id": cid,
            "nombre_es": meta["nombre_es"],
            "nombre_en": meta["nombre_en"],
            "nombre_latin": meta["nombre_latin"],
            "centroide": [round(ra_sum / n_puntos, 4), round(dec_sum / n_puntos, 4)],
            "lineas": segmentos,
        })

    print(f"Constelaciones procesadas con líneas de asterismos: {len(constelaciones)}")
    return constelaciones


def main():
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    estrellas = procesar_catalogo_estelar(limite_magnitud=6.0)
    constelaciones = procesar_constelaciones()

    stars_file = PROCESSED_DIR / "stars.json"
    const_file = PROCESSED_DIR / "constellations.json"

    with open(stars_file, "w", encoding="utf-8") as f:
        json.dump(estrellas, f, ensure_ascii=False, indent=None)

    with open(const_file, "w", encoding="utf-8") as f:
        json.dump(constelaciones, f, ensure_ascii=False, indent=2)

    print(f"Catálogo de estrellas guardado en: {stars_file} ({stars_file.stat().st_size / 1024:.1f} KB)")
    print(f"Catálogo de constelaciones guardado en: {const_file} ({const_file.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
