/**
 * Motor de renderizado en HTML5 Canvas para la cúpula celeste nocturna.
 * Proyecta estrellas y constelaciones a 60 FPS con soporte High-DPI y efectos de resplandor.
 */

import { ecuatorialAHorizontal, proyectarPlano } from "./astrometry.js";

export class SkyRenderer {
  constructor(canvas, stars, constellations) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.stars = stars;
    this.constellations = constellations;

    this.latDeg = 43.26; // Bilbao por defecto
    this.lonDeg = -2.93;
    this.fecha = new Date();

    this.mostrarLineas = true;
    this.mostrarNombres = true;
    this.mostrarEstrellasNombres = true;
    this.constelacionSeleccionada = null;
    this.estrellaSeleccionada = null;
    this.estrellaHover = null;

    // Cache de proyecciones
    this.proyeccionesEstrellas = [];
    this.proyeccionesLineas = [];

    this.ajustarResolucion();
    window.addEventListener("resize", () => this.ajustarResolucion());
  }

  ajustarResolucion() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.ancho = rect.width;
    this.alto = rect.height;

    this.canvas.width = this.ancho * dpr;
    this.canvas.height = this.alto * dpr;
    this.ctx.scale(dpr, dpr);

    this.cx = this.ancho / 2;
    this.cy = this.alto / 2;
    this.radioCielo = Math.min(this.ancho, this.alto) * 0.44;
  }

  setUbicacion(lat, lon) {
    this.latDeg = lat;
    this.lonDeg = lon;
  }

  setFecha(fecha) {
    this.fecha = new Date(fecha);
  }

  actualizarProyecciones() {
    this.proyeccionesEstrellas = [];
    this.proyeccionesLineas = [];

    // 1. Proyectar estrellas visibles
    for (const s of this.stars) {
      const { alt, az } = ecuatorialAHorizontal(
        s.ra,
        s.dec,
        this.latDeg,
        this.lonDeg,
        this.fecha
      );
      const punto = proyectarPlano(alt, az, this.radioCielo, this.cx, this.cy);
      if (punto && punto.visible) {
        this.proyeccionesEstrellas.push({
          estrella: s,
          x: punto.x,
          y: punto.y,
          alt,
          az,
        });
      }
    }

    // 2. Proyectar líneas de constelaciones
    for (const c of this.constellations) {
      const segmentosProyectados = [];
      for (const seg of c.lineas) {
        const p1Coord = ecuatorialAHorizontal(seg[0][0], seg[0][1], this.latDeg, this.lonDeg, this.fecha);
        const p2Coord = ecuatorialAHorizontal(seg[1][0], seg[1][1], this.latDeg, this.lonDeg, this.fecha);

        const pt1 = proyectarPlano(p1Coord.alt, p1Coord.az, this.radioCielo, this.cx, this.cy);
        const pt2 = proyectarPlano(p2Coord.alt, p2Coord.az, this.radioCielo, this.cx, this.cy);

        if (pt1 && pt2 && (pt1.visible || pt2.visible)) {
          segmentosProyectados.push([pt1, pt2]);
        }
      }

      // Proyectar centroide para el rótulo
      const centroCoord = ecuatorialAHorizontal(c.centroide[0], c.centroide[1], this.latDeg, this.lonDeg, this.fecha);
      const ptCentro = proyectarPlano(centroCoord.alt, centroCoord.az, this.radioCielo, this.cx, this.cy);

      this.proyeccionesLineas.push({
        constelacion: c,
        segmentos: segmentosProyectados,
        centroide: ptCentro && ptCentro.visible ? ptCentro : null,
      });
    }
  }

  dibujar() {
    this.actualizarProyecciones();
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.ancho, this.alto);

    // Fondo del espacio profundo
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, this.ancho, this.alto);

    // Bóveda celeste circular con gradiente de cielo nocturno
    const gradCielo = ctx.createRadialGradient(
      this.cx,
      this.cy,
      0,
      this.cx,
      this.cy,
      this.radioCielo
    );
    gradCielo.addColorStop(0, "#0d1424");
    gradCielo.addColorStop(0.7, "#080d19");
    gradCielo.addColorStop(1, "#04070e");

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radioCielo, 0, Math.PI * 2);
    ctx.fillStyle = gradCielo;
    ctx.fill();

    // Horizonte y resplandor atmosférico
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(79, 134, 198, 0.4)";
    ctx.stroke();

    // Cuadrícula altazimutal tenue (anillos de 30° y 60°)
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radioCielo * (30 / 90), 0, Math.PI * 2);
    ctx.arc(this.cx, this.cy, this.radioCielo * (60 / 90), 0, Math.PI * 2);
    ctx.stroke();

    // Cruz cenital
    ctx.beginPath();
    ctx.moveTo(this.cx - 6, this.cy);
    ctx.lineTo(this.cx + 6, this.cy);
    ctx.moveTo(this.cx, this.cy - 6);
    ctx.lineTo(this.cx, this.cy + 6);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.stroke();

    // 1. Dibujar líneas de constelaciones
    if (this.mostrarLineas) {
      for (const item of this.proyeccionesLineas) {
        const esSeleccionada =
          this.constelacionSeleccionada &&
          this.constelacionSeleccionada.id === item.constelacion.id;

        ctx.beginPath();
        for (const [p1, p2] of item.segmentos) {
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }

        if (esSeleccionada) {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "#4fd1c5";
          ctx.shadowColor = "#4fd1c5";
          ctx.shadowBlur = 8;
        } else {
          ctx.lineWidth = 0.9;
          ctx.strokeStyle = "rgba(100, 150, 220, 0.22)";
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Rótulos de constelación
        if (this.mostrarNombres && item.centroide) {
          ctx.font = esSeleccionada
            ? "bold 13px Inter, sans-serif"
            : "10px Inter, sans-serif";
          ctx.fillStyle = esSeleccionada
            ? "#63b3ed"
            : "rgba(180, 205, 240, 0.45)";
          ctx.textAlign = "center";
          ctx.fillText(item.constelacion.nombre_es, item.centroide.x, item.centroide.y);
        }
      }
    }

    // 2. Dibujar estrellas
    for (const item of this.proyeccionesEstrellas) {
      const s = item.estrella;
      // Escala de tamaño por magnitud visual inversa: Sirius (-1.46) -> radio grande, mag 5 -> radio chico
      const radio = Math.max(0.6, (6.5 - s.mag) * 0.65);
      const esHover = this.estrellaHover && this.estrellaHover.id === s.id;
      const esSeleccionada = this.estrellaSeleccionada && this.estrellaSeleccionada.id === s.id;

      ctx.beginPath();
      ctx.arc(item.x, item.y, esHover || esSeleccionada ? radio * 1.8 : radio, 0, Math.PI * 2);
      ctx.fillStyle = s.color || "#ffffff";

      if (s.mag < 2.0 || esHover || esSeleccionada) {
        ctx.shadowColor = s.color || "#ffffff";
        ctx.shadowBlur = esHover || esSeleccionada ? 12 : 5;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.fill();
      ctx.shadowBlur = 0;

      // Nombres de estrellas principales
      if (this.mostrarEstrellasNombres && (s.mag <= 2.2 || s.name || esHover)) {
        if (s.name) {
          ctx.font = esHover ? "bold 11px Inter, sans-serif" : "9px Inter, sans-serif";
          ctx.fillStyle = esHover ? "#ffffff" : "rgba(220, 230, 255, 0.75)";
          ctx.textAlign = "left";
          ctx.fillText(s.name, item.x + 5, item.y - 4);
        }
      }
    }

    ctx.restore();

    // 3. Puntos cardinales alrededor del círculo exterior
    this.dibujarPuntosCardinales(ctx);
  }

  dibujarPuntosCardinales(ctx) {
    const cardinales = [
      { texto: "N", az: 0 },
      { texto: "NE", az: 45 },
      { texto: "E", az: 90 },
      { texto: "SE", az: 135 },
      { texto: "S", az: 180 },
      { texto: "SO", az: 225 },
      { texto: "O", az: 270 },
      { texto: "NO", az: 315 },
    ];

    ctx.font = "bold 12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const c of cardinales) {
      const azRad = (c.az * Math.PI) / 180.0;
      const r = this.radioCielo + 18;
      const x = this.cx + r * Math.sin(azRad);
      const y = this.cy - r * Math.cos(azRad);

      ctx.fillStyle = c.texto === "N" ? "#fc8181" : "rgba(200, 220, 255, 0.6)";
      ctx.fillText(c.texto, x, y);
    }
  }

  buscarObjetoEnPosicion(mouseX, mouseY) {
    // Buscar estrella más cercana dentro de un radio de tolerancia de 10px
    let estrellaCercana = null;
    let minDistEstrella = 12;

    for (const item of this.proyeccionesEstrellas) {
      const dx = item.x - mouseX;
      const dy = item.y - mouseY;
      const d = Math.hypot(dx, dy);
      if (d < minDistEstrella) {
        minDistEstrella = d;
        estrellaCercana = item.estrella;
      }
    }

    // Convertir coordenadas del canvas (x, y) a coordenadas celestes inversas (Alt, Az -> RA, Dec)
    const dx = mouseX - this.cx;
    const dy = mouseY - this.cy;
    const r = Math.hypot(dx, dy);

    if (r > this.radioCielo) {
      return { estrella: estrellaCercana, raH: null, decDeg: null };
    }

    const altDeg = 90.0 - (r / this.radioCielo) * 90.0;
    let azRad = Math.atan2(dx, -dy);
    let azDeg = (azRad * 180.0) / Math.PI;
    if (azDeg < 0) azDeg += 360.0;

    // Inversa horizontal -> ecuatorial
    const latRad = (this.latDeg * Math.PI) / 180.0;
    const altRad = (altDeg * Math.PI) / 180.0;
    azRad = (azDeg * Math.PI) / 180.0;

    const sinDec = Math.sin(latRad) * Math.sin(altRad) + Math.cos(latRad) * Math.cos(altRad) * Math.cos(azRad);
    const decRad = Math.asin(Math.max(-1.0, Math.min(1.0, sinDec)));
    const decDeg = (decRad * 180.0) / Math.PI;

    const cosDec = Math.cos(decRad);
    let hRad = 0;
    if (cosDec > 1e-6) {
      const sinH = (-Math.cos(altRad) * Math.sin(azRad)) / cosDec;
      const cosH = (Math.sin(altRad) - Math.sin(latRad) * sinDec) / (Math.cos(latRad) * cosDec);
      hRad = Math.atan2(sinH, cosH);
    }

    const hHoras = (hRad * 180.0) / Math.PI / 15.0;
    // LST
    const d = new Date(this.fecha);
    const year = d.getUTCFullYear();
    let month = d.getUTCMonth() + 1;
    let y = year;
    let m = month;
    if (m <= 2) { y -= 1; m += 12; }
    const day = d.getUTCDate() + (d.getUTCHours() + (d.getUTCMinutes() + d.getUTCSeconds() / 60.0) / 60.0) / 24.0;
    const jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + (2 - Math.floor(y / 100) + Math.floor(Math.floor(y / 100) / 4)) - 1524.5;
    const t = (jd - 2451545.0) / 36525.0;
    let gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000.0) % 360;
    if (gmst < 0) gmst += 360;
    let lstH = ((gmst + this.lonDeg) % 360) / 15.0;
    if (lstH < 0) lstH += 24.0;

    let raH = (lstH - hHoras) % 24.0;
    if (raH < 0) raH += 24.0;

    return {
      estrella: estrellaCercana,
      raH,
      decDeg,
      altDeg,
      azDeg,
    };
  }
}
