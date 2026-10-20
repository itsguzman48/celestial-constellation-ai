/**
 * Módulo de cálculos astrométricos en JavaScript para renderizado en navegador.
 * Convierte coordenadas ecuatoriales (RA/Dec) a locales horizontales (Alt/Az)
 * y realiza la proyección estereográfica de la bóveda celeste.
 */

export function fechaADiaJuliano(date) {
  const d = new Date(date);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1;
  const day = d.getUTCDate() +
    (d.getUTCHours() + (d.getUTCMinutes() + d.getUTCSeconds() / 60.0) / 60.0) / 24.0;

  if (month <= 2) {
    year -= 1;
    month += 12;
  }

  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

export function calcularGMST(jd) {
  const t = (jd - 2451545.0) / 36525.0;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) +
    0.000387933 * (t * t) - (t * t * t) / 38710000.0;
  gmst = gmst % 360.0;
  if (gmst < 0) gmst += 360.0;
  return gmst;
}

export function calcularLST(date, lonDeg) {
  const jd = fechaADiaJuliano(date);
  const gmst = calcularGMST(jd);
  let lstDeg = (gmst + lonDeg) % 360.0;
  if (lstDeg < 0) lstDeg += 360.0;
  return lstDeg / 15.0; // en horas (0..24h)
}

export function ecuatorialAHorizontal(raHoras, decDeg, latDeg, lonDeg, date) {
  const lstHoras = calcularLST(date, lonDeg);
  const hHoras = lstHoras - raHoras;
  const hRad = (hHoras * 15.0 * Math.PI) / 180.0;

  const decRad = (decDeg * Math.PI) / 180.0;
  const latRad = (latDeg * Math.PI) / 180.0;

  let sinAlt = Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(hRad);
  sinAlt = Math.max(-1.0, Math.min(1.0, sinAlt));
  const altRad = Math.asin(sinAlt);
  const altDeg = (altRad * 180.0) / Math.PI;

  const cosAlt = Math.cos(altRad);
  if (cosAlt < 1e-7) {
    return { alt: altDeg, az: 0.0 };
  }

  const sinAz = -Math.cos(decRad) * Math.sin(hRad);
  const cosAz = (Math.sin(decRad) - Math.sin(latRad) * Math.sin(altRad)) /
    (Math.cos(latRad) * cosAlt);

  let azRad = Math.atan2(sinAz, cosAz);
  let azDeg = (azRad * 180.0) / Math.PI;
  azDeg = (azDeg + 360.0) % 360.0;

  return { alt: altDeg, az: azDeg };
}

/**
 * Proyección azimutal cenital equidistante para la cúpula celeste plana.
 * Cenit (Alt = 90°) -> centro (r = 0).
 * Horizonte (Alt = 0°) -> circunferencia exterior (r = R).
 */
export function proyectarPlano(altDeg, azDeg, radioMax, cx, cy) {
  // Solo se proyecta si está visible o muy cerca del horizonte (> -10°)
  if (altDeg < -10.0) return null;

  // Distancia cenital normalizada: 90° altitud = 0 radio; 0° altitud = radioMax
  const r = ((90.0 - altDeg) / 90.0) * radioMax;
  const azRad = (azDeg * Math.PI) / 180.0;

  // 0° Norte (arriba, y negativo), 90° Este (derecha, x positivo)
  const x = cx + r * Math.sin(azRad);
  const y = cy - r * Math.cos(azRad);

  return { x, y, visible: altDeg >= 0.0 };
}

export function distanciaAngularDeg(ra1H, dec1Deg, ra2H, dec2Deg) {
  const a1 = (ra1H * 15.0 * Math.PI) / 180.0;
  const d1 = (dec1Deg * Math.PI) / 180.0;
  const a2 = (ra2H * 15.0 * Math.PI) / 180.0;
  const d2 = (dec2Deg * Math.PI) / 180.0;

  const da = a2 - a1;
  const dd = d2 - d1;

  let h = Math.sin(dd / 2.0) ** 2 + Math.cos(d1) * Math.cos(d2) * (Math.sin(da / 2.0) ** 2);
  h = Math.max(0.0, Math.min(1.0, h));
  return (2.0 * Math.asin(Math.sqrt(h)) * 180.0) / Math.PI;
}
