"""Módulo de cálculos astrométricos y transformaciones de coordenadas celestes.

Implementa la física de conversión de coordenadas ecuatoriales (J2000 RA/Dec) a
coordenadas locales horizontales (Altitud/Azimut) según la ubicación GPS del
observador y el tiempo sidéreo local (LST).
"""

from datetime import datetime, timezone
import math


def fecha_a_dia_juliano(dt: datetime) -> float:
    """Calcula el Día Juliano (JD) a partir de una fecha UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)

    ano = dt.year
    mes = dt.month
    dia = dt.day + (dt.hour + (dt.minute + dt.second / 60.0) / 60.0) / 24.0

    if mes <= 2:
        ano -= 1
        mes += 12

    a = math.floor(ano / 100)
    b = 2 - a + math.floor(a / 4)
    jd = math.floor(365.25 * (ano + 4716)) + math.floor(30.6001 * (mes + 1)) + dia + b - 1524.5
    return jd


def calcular_gmst(jd: float) -> float:
    """Calcula el Tiempo Sidéreo Medio de Greenwich (GMST) en grados (0..360)."""
    t = (jd - 2451545.0) / 36525.0
    # Fórmula IAU-82 / Meeus
    gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * (t**2) - (t**3) / 38710000.0
    return gmst % 360.0


def calcular_lst(dt: datetime, longitud_deg: float) -> float:
    """Calcula el Tiempo Sidéreo Local (LST) en horas (0..24).

    Longitud este positiva, oeste negativa (p. ej. Bilbao/España: longitud -2.93°).
    """
    jd = fecha_a_dia_juliano(dt)
    gmst_deg = calcular_gmst(jd)
    lst_deg = (gmst_deg + longitud_deg) % 360.0
    return lst_deg / 15.0


def ecuatorial_a_horizontal(
    ra_horas: float, dec_deg: float, latitud_deg: float, longitud_deg: float, dt: datetime
) -> tuple[float, float]:
    """Convierte coordenadas celestes ecuatoriales (RA horas, Dec grados) a horizontales locales (Alt, Az grados).

    Retorna:
        altitud_deg: Ángulo sobre el horizonte (-90° a +90°).
        azimut_deg: Ángulo en el plano horizontal medido desde el Norte (0° N, 90° E, 180° S, 270° O).
    """
    lst_horas = calcular_lst(dt, longitud_deg)
    h_horas = lst_horas - ra_horas  # Ángulo horario
    h_rad = math.radians(h_horas * 15.0)

    dec_rad = math.radians(dec_deg)
    lat_rad = math.radians(latitud_deg)

    # Seno de la altitud
    sin_alt = math.sin(lat_rad) * math.sin(dec_rad) + math.cos(lat_rad) * math.cos(dec_rad) * math.cos(h_rad)
    sin_alt = max(-1.0, min(1.0, sin_alt))
    alt_rad = math.asin(sin_alt)

    # Componentes para el Azimut (convención astronómica: 0° Norte, 90° Este)
    cos_alt = math.cos(alt_rad)
    if cos_alt < 1e-7:
        # En el cenit o nadir exacto, azimut arbitrario
        return math.degrees(alt_rad), 0.0

    sin_az = -math.cos(dec_rad) * math.sin(h_rad)
    cos_az = (math.sin(dec_rad) - math.sin(lat_rad) * math.sin(alt_rad)) / (math.cos(lat_rad) * cos_alt)

    az_rad = math.atan2(sin_az, cos_az)
    az_deg = (math.degrees(az_rad) + 360.0) % 360.0

    return math.degrees(alt_rad), az_deg


def distancia_angular_deg(ra1_h: float, dec1_deg: float, ra2_h: float, dec2_deg: float) -> float:
    """Calcula la distancia angular ortodrómica en grados entre dos puntos de la esfera celeste."""
    a1 = math.radians(ra1_h * 15.0)
    d1 = math.radians(dec1_deg)
    a2 = math.radians(ra2_h * 15.0)
    d2 = math.radians(dec2_deg)

    # Ley del semiverseno (Haversine esférico)
    delta_a = a2 - a1
    delta_d = d2 - d1

    h = math.sin(delta_d / 2.0) ** 2 + math.cos(d1) * math.cos(d2) * (math.sin(delta_a / 2.0) ** 2)
    h = max(0.0, min(1.0, h))
    theta_rad = 2.0 * math.asin(math.sqrt(h))
    return math.degrees(theta_rad)
