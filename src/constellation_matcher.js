/**
 * Motor de inferencia y clasificación de constelaciones en cliente.
 * Determina qué constelación u objeto astronómico se está observando
 * a partir de la distancia esférica angular y similitud geométrica.
 */

import { distanciaAngularDeg } from "./astrometry.js";

export class ConstellationMatcher {
  constructor(constellations) {
    this.constellations = constellations;
    this.prepararFirmas();
  }

  prepararFirmas() {
    for (const c of this.constellations) {
      const [raC, decC] = c.centroide;
      let maxDist = 5.0;
      if (c.lineas) {
        for (const seg of c.lineas) {
          for (const p of seg) {
            const d = distanciaAngularDeg(raC, decC, p[0], p[1]);
            if (d > maxDist) maxDist = d;
          }
        }
      }
      c.radioDispersion = Math.min(25.0, Math.max(maxDist, 5.0));
    }
  }

  clasificar(raH, decDeg, topK = 3) {
    const scores = [];

    for (const c of this.constellations) {
      const [raC, decC] = c.centroide;
      const dist = distanciaAngularDeg(raH, decDeg, raC, decC);
      const radio = c.radioDispersion || 10.0;

      // Afinidad mediante kernel gaussiano sobre distancia esférica normalizada
      const distNorm = dist / Math.max(radio, 4.0);
      const score = Math.exp(-2.5 * (distNorm * distNorm));

      scores.push({
        score,
        dist,
        constelacion: c,
      });
    }

    scores.sort((a, b) => b.score - a.score);
    const top = scores.slice(0, topK);

    let totalScore = top.reduce((acc, cur) => acc + cur.score, 0);
    if (totalScore <= 0) totalScore = 1.0;

    return top.map((item) => ({
      id: item.constelacion.id,
      nombre_es: item.constelacion.nombre_es,
      nombre_latin: item.constelacion.nombre_latin,
      nombre_en: item.constelacion.nombre_en,
      distancia_deg: Math.round(item.dist * 10) / 10,
      confianza: Math.round((item.score / totalScore) * 1000) / 10,
      lineas: item.constelacion.lineas,
      centroide: item.constelacion.centroide,
    }));
  }
}
