/**
 * Módulo de cálculos astrométricos en JavaScript para renderizado en navegador.
 * Convierte coordenadas ecuatoriales (RA/Dec) a locales horizontales (Alt/Az),
 * cálculo de tiempo sidéreo local (LST), proyección plana cenital y
 * proyección estereográfica panorámica 3D en 360° para cámara móvil y brújula.
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

  const sinAz = -Math.cos(decRad) * Math.sin(hRad);
  const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt) / Math.cos(latRad);

  let azRad = Math.atan2(sinAz, cosAz);
  let azDeg = (azRad * 180.0) / Math.PI;
  azDeg = (azDeg + 360.0) % 360.0;

  return { alt: altDeg, az: azDeg };
}

/**
 * Convierte coordenadas horizontales locales (Altitud y Azimut) a ecuatoriales (RA y Dec).
 */
export function horizontalAEcuatorial(altDeg, azDeg, latDeg, lonDeg, date) {
  const latRad = (latDeg * Math.PI) / 180.0;
  const altRad = (altDeg * Math.PI) / 180.0;
  const azRad = (azDeg * Math.PI) / 180.0;

  const sinDec = Math.sin(latRad) * Math.sin(altRad) + Math.cos(latRad) * Math.cos(altRad) * Math.cos(azRad);
  const decRad = Math.asin(Math.max(-1.0, Math.min(1.0, sinDec)));
  const decDeg = (decRad * 180.0) / Math.PI;

  const sinH = -Math.sin(azRad) * Math.cos(altRad);
  const cosH = (Math.sin(altRad) - Math.sin(latRad) * Math.sin(decRad)) / Math.cos(latRad);
  const hRad = Math.atan2(sinH, cosH);

  const hHoras = (hRad * 180.0) / Math.PI / 15.0;
  const lstHoras = calcularLST(date, lonDeg);
  let raHoras = (lstHoras - hHoras) % 24.0;
  if (raHoras < 0) raHoras += 24.0;

  return { ra: raHoras, dec: decDeg };
}

/**
 * Proyección azimutal cenital equidistante para la cúpula celeste plana.
 * Cenit (Alt = 90°) -> centro (r = 0).
 * Horizonte (Alt = 0°) -> circunferencia exterior (r = R).
 */
export function proyectarPlano(altDeg, azDeg, radioMax, cx, cy) {
  if (altDeg < -10.0) return null;

  const r = ((90.0 - altDeg) / 90.0) * radioMax;
  const azRad = (azDeg * Math.PI) / 180.0;

  const x = cx + r * Math.sin(azRad);
  const y = cy - r * Math.cos(azRad);

  return { x, y, visible: altDeg >= 0.0 };
}

/**
 * Proyección esférica 3D para cámara panorámica 360° (estilo Stellarium / Star Walk).
 * Permite rotar el observador libremente en cualquier azimut (0..360°) y elevación (-90°..+90°).
 */
export function proyectarCamara360(altDeg, azDeg, camAltDeg, camAzDeg, camRollDeg, fovDeg, ancho, alto) {
  const altRad = (altDeg * Math.PI) / 180.0;
  const azRad = (azDeg * Math.PI) / 180.0;
  const cAltRad = (camAltDeg * Math.PI) / 180.0;
  const cAzRad = (camAzDeg * Math.PI) / 180.0;
  const rollRad = ((camRollDeg || 0) * Math.PI) / 180.0;

  // Vector unitario del astro en marco topocéntrico (Este, Norte, Cenit)
  const px = Math.cos(altRad) * Math.sin(azRad);
  const py = Math.cos(altRad) * Math.cos(azRad);
  const pz = Math.sin(altRad);

  // Eje frontal de la cámara (Forward)
  const fx = Math.cos(cAltRad) * Math.sin(cAzRad);
  const fy = Math.cos(cAltRad) * Math.cos(cAzRad);
  const fz = Math.sin(cAltRad);

  // Eje derecho horizontal (Right)
  const rx = Math.cos(cAzRad);
  const ry = -Math.sin(cAzRad);
  const rz = 0.0;

  // Eje vertical perpendicular (Up = Right x Forward)
  const ux = -Math.sin(cAzRad) * Math.sin(cAltRad);
  const uy = -Math.cos(cAzRad) * Math.sin(cAltRad);
  const uz = Math.cos(cAltRad);

  // Aplicar inclinación (Roll) si existe
  const cosRoll = Math.cos(rollRad);
  const sinRoll = Math.sin(rollRad);

  const rPrimeX = cosRoll * rx + sinRoll * ux;
  const rPrimeY = cosRoll * ry + sinRoll * uy;
  const rPrimeZ = cosRoll * rz + sinRoll * uz;

  const uPrimeX = -sinRoll * rx + cosRoll * ux;
  const uPrimeY = -sinRoll * ry + cosRoll * uy;
  const uPrimeZ = -sinRoll * rz + cosRoll * uz;

  // Proyección de P en el sistema de la cámara
  const dx = px * rPrimeX + py * rPrimeY + pz * rPrimeZ;
  const dy = px * uPrimeX + py * uPrimeY + pz * uPrimeZ;
  const dz = px * fx + py * fy + pz * fz;

  if (dz <= 0) return null;

  const angleFromCenter = Math.acos(Math.max(-1.0, Math.min(1.0, dz)));
  const maxFovRad = ((fovDeg + 30.0) * Math.PI) / 180.0;
  if (angleFromCenter > maxFovRad) return null;

  const fovRad = (fovDeg * Math.PI) / 180.0;
  const cx = ancho / 2.0;
  const cy = alto / 2.0;

  // Proyección estereográfica conformal
  const focal = Math.min(ancho, alto) / (4.0 * Math.tan(fovRad / 4.0));
  const rScreen = 2.0 * focal * Math.tan(angleFromCenter / 2.0);

  const dTrans = Math.hypot(dx, dy);
  let x = cx;
  let y = cy;
  if (dTrans > 1e-7) {
    x = cx + rScreen * (dx / dTrans);
    y = cy - rScreen * (dy / dTrans);
  }

  const visible = x >= -100 && x <= ancho + 100 && y >= -100 && y <= alto + 100;

  return {
    x,
    y,
    dz,
    angleFromCenter: (angleFromCenter * 180.0) / Math.PI,
    visible,
    altDeg,
    azDeg
  };
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
