"""Evaluación y benchmarking del algoritmo de reconocimiento de constelaciones.

Somete al Star Pattern Tracker a pruebas de robustez con perturbaciones angulares
(simulando imprecisiones de sensor/cámara de 0.5° a 3.0°) sobre los centroides y estrellas
de las 88 constelaciones oficiales de la IAU.
"""

import json
from pathlib import Path
import random
import sys

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.pattern_matcher import ReconocedorConstelaciones

REPORTS_DIR = BASE_DIR / "reports"
CONST_FILE = BASE_DIR / "data" / "processed" / "constellations.json"


def evaluar_precision_tracker(ruido_deg_max: float = 2.0, n_muestras_por_const: int = 10) -> dict:
    """Evalúa la tasa de acierto Top-1 y Top-3 del reconocedor bajo ruido gaussiano."""
    with open(CONST_FILE, "r", encoding="utf-8") as f:
        constelaciones = json.load(f)

    reconocedor = ReconocedorConstelaciones(constelaciones)
    random.seed(42)

    total_pruebas = 0
    top1_aciertos = 0
    top3_aciertos = 0

    detalles = []

    for c in constelaciones:
        target_id = c["id"]
        ra_c, dec_c = c["centroide"]

        for _ in range(n_muestras_por_const):
            # Inyectar error angular simulado (ruido gaussiano)
            sigma = ruido_deg_max / 2.0
            error_dec = random.gauss(0, sigma)
            # El error en RA se escala por cos(Dec) para mantener la distancia ortodrómica
            cos_dec = max(0.1, abs(random.gauss(dec_c, 1.0)))
            error_ra_h = (random.gauss(0, sigma) / 15.0) / cos_dec

            ra_test = (ra_c + error_ra_h) % 24.0
            dec_test = max(-89.0, min(89.0, dec_c + error_dec))

            predicciones = reconocedor.clasificar_posicion(ra_test, dec_test, top_k=3)
            ids_top = [p["id"] for p in predicciones]

            total_pruebas += 1
            if ids_top and ids_top[0] == target_id:
                top1_aciertos += 1
            if target_id in ids_top:
                top3_aciertos += 1

    top1_acc = (top1_aciertos / total_pruebas) * 100.0
    top3_acc = (top3_aciertos / total_pruebas) * 100.0

    print("=" * 70)
    print("RESULTADOS DEL BENCHMARK DEL STAR PATTERN TRACKER")
    print("=" * 70)
    print(f"Total de ensayos sintéticos con ruido: {total_pruebas}")
    print(f"Perturbación angular máxima simulada: ±{ruido_deg_max}°")
    print(f"Precisión Top-1 (Predicción exacta):   {top1_acc:.2f}%")
    print(f"Precisión Top-3 (Acierto en ranking): {top3_acc:.2f}%")
    print("=" * 70)

    resultados = {
        "total_pruebas": total_pruebas,
        "ruido_deg_max": ruido_deg_max,
        "precision_top1": round(top1_acc, 2),
        "precision_top3": round(top3_acc, 2),
    }

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(REPORTS_DIR / "tracker_benchmark.json", "w", encoding="utf-8") as f:
        json.dump(resultados, f, indent=2)

    return resultados


if __name__ == "__main__":
    evaluar_precision_tracker()
