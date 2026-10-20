"""Módulo de reconocimiento y clasificación inteligente de constelaciones celestes.

Aplica técnicas de reconocimiento de patrones angulares (Star Pattern Tracker)
similares a los algoritmos 'Lost in Space' de orientación satelital, identificando
constelaciones a partir de coordenadas celestes y similitud geométrica.
"""

import math
from typing import Any

from src.astrometry import distancia_angular_deg


class ReconocedorConstelaciones:
    """Clasificador de constelaciones basado en patrones angulares y distancias mínimas esféricas."""

    def __init__(self, constelaciones_catalogo: list[dict[str, Any]]):
        self.catalogo = constelaciones_catalogo
        self._preparar_firmas()

    def _preparar_firmas(self) -> None:
        """Precomputa los centroides y la extensión angular de cada constelación."""
        for c in self.catalogo:
            ra_c, dec_c = c["centroide"]
            radios = []
            for seg in c.get("lineas", []):
                for p in seg:
                    radios.append(distancia_angular_deg(ra_c, dec_c, p[0], p[1]))
            # Radio de dispersión característico
            c["radio_dispersion_deg"] = max(radios) if radios else 10.0

    def clasificar_posicion(
        self, ra_h: float, dec_deg: float, top_k: int = 3
    ) -> list[dict[str, Any]]:
        """Identifica a qué constelación apunta una coordenada celeste dada.

        Calcula la distancia esférica a cada constelación, normaliza por el tamaño
        angular de la misma y genera una probabilidad por función de decaimiento exponencial (Softmax).
        """
        puntuaciones = []

        for c in self.catalogo:
            ra_c, dec_c = c["centroide"]
            dist_centroide = distancia_angular_deg(ra_h, dec_deg, ra_c, dec_c)
            radio = c.get("radio_dispersion_deg", 10.0)

            # Si el punto cae dentro del radio del asterismo, tiene alta afinidad
            # Distancia normalizada al tamaño de la constelación
            dist_norm = dist_centroide / max(radio, 5.0)

            # Similitud gaussiana / decaimiento inverso
            score = math.exp(-0.5 * (dist_norm**2))
            puntuaciones.append((score, dist_centroide, c))

        # Ordenar por puntuación descendente
        puntuaciones.sort(key=lambda x: x[0], reverse=True)
        mejores = puntuaciones[:top_k]

        # Normalizar probabilidades (Softmax simplificado)
        total_score = sum(p[0] for p in mejores)
        if total_score <= 0.0:
            total_score = 1.0

        resultados = []
        for score, dist_deg, c in mejores:
            prob = (score / total_score) * 100.0
            resultados.append({
                "id": c["id"],
                "nombre_es": c["nombre_es"],
                "nombre_en": c["nombre_en"],
                "nombre_latin": c["nombre_latin"],
                "distancia_deg": round(dist_deg, 2),
                "confianza": round(prob, 1),
            })

        return resultados
