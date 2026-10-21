"""Pruebas unitarias de física astrométrica, transformación de coordenadas y Star Tracker."""

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.astrometry import (
    distancia_angular_deg,
    ecuatorial_a_horizontal,
    fecha_a_dia_juliano,
    horizontal_a_ecuatorial,
)
from src.pattern_matcher import ReconocedorConstelaciones

BASE_DIR = Path(__file__).resolve().parent.parent


def test_fecha_a_dia_juliano_j2000() -> None:
    """Verifica que el Día Juliano para la época estándar J2000.0 (1 de enero de 2000, 12:00 UTC) sea 2451545.0."""
    dt_j2000 = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    jd = fecha_a_dia_juliano(dt_j2000)
    assert jd == pytest.approx(2451545.0, abs=1e-5)


def test_ecuatorial_a_horizontal_polaris() -> None:
    """Verifica que la Estrella Polar (Dec ≈ +89.26°) se observe a una altitud casi idéntica a la latitud del observador."""
    lat_bilbao = 43.26
    lon_bilbao = -2.93
    dt = datetime(2026, 10, 20, 22, 0, 0, tzinfo=timezone.utc)

    ra_polaris = 2.53  # horas
    dec_polaris = 89.26  # grados

    alt, az = ecuatorial_a_horizontal(ra_polaris, dec_polaris, lat_bilbao, lon_bilbao, dt)

    assert alt == pytest.approx(lat_bilbao, abs=1.0)
    assert az < 5.0 or az > 355.0


def test_transformacion_inversa_astrometrica() -> None:
    """Verifica la reversibilidad exacta del ciclo RA/Dec -> Alt/Az -> RA/Dec."""
    lat = 40.4168
    lon = -3.7038
    dt = datetime(2026, 10, 21, 23, 30, 0, tzinfo=timezone.utc)

    ra_orig = 5.919  # Betelgeuse (aprox. 5h 55m)
    dec_orig = 7.407  # +7° 24'

    alt, az = ecuatorial_a_horizontal(ra_orig, dec_orig, lat, lon, dt)
    ra_recup, dec_recup = horizontal_a_ecuatorial(alt, az, lat, lon, dt)

    assert ra_recup == pytest.approx(ra_orig, abs=0.01)
    assert dec_recup == pytest.approx(dec_orig, abs=0.01)


def test_distancia_angular_misma_estrella() -> None:
    """Verifica que la distancia angular ortodrómica de un astro consigo mismo sea cero."""
    d = distancia_angular_deg(5.5, 20.0, 5.5, 20.0)
    assert d == pytest.approx(0.0, abs=1e-7)


def test_distancia_angular_polos() -> None:
    """Verifica que la distancia entre el Polo Norte Celeste y el Polo Sur Celeste sea 180° exactos."""
    d = distancia_angular_deg(0.0, 90.0, 12.0, -90.0)
    assert d == pytest.approx(180.0, abs=1e-5)


def test_reconocedor_constelaciones_exacto() -> None:
    """Verifica que apuntar al centroide de la Osa Mayor clasifique 'UMa' en la primera posición."""
    const_file = BASE_DIR / "data" / "processed" / "constellations.json"
    with open(const_file, "r", encoding="utf-8") as f:
        catalogo = json.load(f)

    reconocedor = ReconocedorConstelaciones(catalogo)
    uma = next(c for c in catalogo if c["id"] == "UMa")
    ra_c, dec_c = uma["centroide"]

    predicciones = reconocedor.clasificar_posicion(ra_c, dec_c, top_k=3)
    assert len(predicciones) == 3
    assert predicciones[0]["id"] == "UMa"
    assert predicciones[0]["confianza"] > 70.0


def test_catalogo_procesado_consistente() -> None:
    """Verifica la integridad estructural de los ficheros JSON del catálogo procesado."""
    stars_file = BASE_DIR / "data" / "processed" / "stars.json"
    const_file = BASE_DIR / "data" / "processed" / "constellations.json"

    assert stars_file.exists(), "El fichero stars.json debe existir en data/processed/"
    assert const_file.exists(), "El fichero constellations.json debe existir en data/processed/"

    with open(stars_file, "r", encoding="utf-8") as f:
        estrellas = json.load(f)
    assert len(estrellas) >= 3000, "Deben procesarse al menos 3.000 estrellas visibles"

    primera = estrellas[0]
    for campo in ("id", "ra", "dec", "mag", "color"):
        assert campo in primera, f"La estrella debe contener el campo '{campo}'"
