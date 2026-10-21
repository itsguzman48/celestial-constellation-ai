/**
 * Motor de renderizado en HTML5 Canvas para la experiencia móvil tipo Android / Planetario.
 * Soporta modo cámara panorámica 360° con giro libre, brújula interactiva, HUD de cinta
 * azimutal, retícula de puntería con reconocimiento en tiempo real y modo noche rojo.
 */

import {
  ecuatorialAHorizontal,
  horizontalAEcuatorial,
  proyectarPlano,
  proyectarCamara360,
} from "./astrometry.js";

export class SkyRenderer {
  constructor(canvas, stars, constellations) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.stars = stars;
    this.constellations = constellations;

    // Ubicación del observador (Bilbao por defecto)
    this.latDeg = 43.2627;
    this.lonDeg = -2.9348;
    this.fecha = new Date();

    // Modos de visualización
    this.modoVista = "camara360"; // 'camara360' (estilo Android) o 'plano' (cenital)
    this.modoNoche = false; // Modo rojo para astronomía de campo

    // Estado de la cámara 360°
    this.camAz = 0.0;     // Azimut: 0=N, 90=E, 180=S, 270=O
    this.camAlt = 35.0;   // Altitud: 0=Horizonte, 90=Cénit, -90=Nadir
    this.camRoll = 0.0;   // Inclinación
    this.fov = 65.0;      // Campo de visión en grados (25..95)

    // Inercia de movimiento
    this.velAz = 0.0;
    this.velAlt = 0.0;

    // Brújula y Giroscopio
    this.gyroActivo = false;
    this.gyroCalibracionAz = 0.0;

    // Capas visuales
    this.mostrarLineas = true;
    this.mostrarNombres = true;
    this.mostrarEstrellasNombres = true;
    this.mostrarHorizonte = true;
    this.mostrarHUD = true;
    this.mostrarReticula = true;

    // Selección
    this.constelacionSeleccionada = null;
    this.estrellaSeleccionada = null;
    this.estrellaHover = null;
    this.objetoEnReticula = null;

    // Caché de proyecciones
    this.proyeccionesEstrellas = [];
    this.proyeccionesLineas = [];

    // Ajustar DPI y tamaño
    this.ajustarResolucion();
    window.addEventListener("resize", () => this.ajustarResolucion());
  }

  ajustarResolucion() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.ancho = Math.max(rect.width, 320);
    this.alto = Math.max(rect.height, 320);

    this.canvas.width = Math.floor(this.ancho * dpr);
    this.canvas.height = Math.floor(this.alto * dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
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

  setFov(nuevoFov) {
    this.fov = Math.max(25.0, Math.min(95.0, nuevoFov));
  }

  rotarCamara(deltaAz, deltaAlt) {
    this.camAz = (this.camAz + deltaAz + 360.0) % 360.0;
    this.camAlt = Math.max(-85.0, Math.min(88.0, this.camAlt + deltaAlt));
  }

  aplicarInercia() {
    if (Math.abs(this.velAz) > 0.005 || Math.abs(this.velAlt) > 0.005) {
      this.rotarCamara(this.velAz, this.velAlt);
      this.velAz *= 0.90;
      this.velAlt *= 0.90;
      return true;
    }
    this.velAz = 0;
    this.velAlt = 0;
    return false;
  }

  mirarHacia(azDeg, altDeg, animar = true) {
    if (!animar) {
      this.camAz = (azDeg + 360.0) % 360.0;
      this.camAlt = Math.max(-85.0, Math.min(88.0, altDeg));
      return;
    }

    // Animación suave hacia el objetivo
    let diffAz = ((azDeg - this.camAz + 540.0) % 360.0) - 180.0;
    let diffAlt = altDeg - this.camAlt;

    const paso = () => {
      diffAz = ((azDeg - this.camAz + 540.0) % 360.0) - 180.0;
      diffAlt = altDeg - this.camAlt;

      if (Math.abs(diffAz) > 0.2 || Math.abs(diffAlt) > 0.2) {
        this.rotarCamara(diffAz * 0.15, diffAlt * 0.15);
        this.dibujar();
        requestAnimationFrame(paso);
      } else {
        this.camAz = (azDeg + 360.0) % 360.0;
        this.camAlt = altDeg;
        this.dibujar();
      }
    };
    paso();
  }

  actualizarProyecciones() {
    this.proyeccionesEstrellas = [];
    this.proyeccionesLineas = [];

    const es360 = this.modoVista === "camara360";

    // 1. Proyectar estrellas
    for (const s of this.stars) {
      const { alt, az } = ecuatorialAHorizontal(
        s.ra,
        s.dec,
        this.latDeg,
        this.lonDeg,
        this.fecha
      );

      let punto = null;
      if (es360) {
        punto = proyectarCamara360(
          alt,
          az,
          this.camAlt,
          this.camAz,
          this.camRoll,
          this.fov,
          this.ancho,
          this.alto
        );
      } else {
        punto = proyectarPlano(alt, az, this.radioCielo, this.cx, this.cy);
      }

      if (punto && punto.visible) {
        this.proyeccionesEstrellas.push({
          estrella: s,
          x: punto.x,
          y: punto.y,
          alt,
          az,
          dz: punto.dz || 1.0,
        });
      }
    }

    // 2. Proyectar líneas de constelaciones
    for (const c of this.constellations) {
      const segmentosProyectados = [];
      for (const seg of c.lineas) {
        const p1Coord = ecuatorialAHorizontal(seg[0][0], seg[0][1], this.latDeg, this.lonDeg, this.fecha);
        const p2Coord = ecuatorialAHorizontal(seg[1][0], seg[1][1], this.latDeg, this.lonDeg, this.fecha);

        let pt1, pt2;
        if (es360) {
          pt1 = proyectarCamara360(p1Coord.alt, p1Coord.az, this.camAlt, this.camAz, this.camRoll, this.fov, this.ancho, this.alto);
          pt2 = proyectarCamara360(p2Coord.alt, p2Coord.az, this.camAlt, this.camAz, this.camRoll, this.fov, this.ancho, this.alto);
        } else {
          pt1 = proyectarPlano(p1Coord.alt, p1Coord.az, this.radioCielo, this.cx, this.cy);
          pt2 = proyectarPlano(p2Coord.alt, p2Coord.az, this.radioCielo, this.cx, this.cy);
        }

        if (pt1 && pt2 && (pt1.visible || pt2.visible)) {
          segmentosProyectados.push([pt1, pt2]);
        }
      }

      // Proyectar centroide para rótulo
      const centroCoord = ecuatorialAHorizontal(c.centroide[0], c.centroide[1], this.latDeg, this.lonDeg, this.fecha);
      let ptCentro = null;
      if (es360) {
        ptCentro = proyectarCamara360(centroCoord.alt, centroCoord.az, this.camAlt, this.camAz, this.camRoll, this.fov, this.ancho, this.alto);
      } else {
        ptCentro = proyectarPlano(centroCoord.alt, centroCoord.az, this.radioCielo, this.cx, this.cy);
      }

      this.proyeccionesLineas.push({
        constelacion: c,
        segmentos: segmentosProyectados,
        centroide: ptCentro && ptCentro.visible ? ptCentro : null,
      });
    }

    // 3. Evaluar qué hay en la retícula central
    if (es360) {
      const coordCentral = horizontalAEcuatorial(this.camAlt, this.camAz, this.latDeg, this.lonDeg, this.fecha);
      this.objetoEnReticula = {
        alt: this.camAlt,
        az: this.camAz,
        ra: coordCentral.ra,
        dec: coordCentral.dec,
      };
    }
  }

  dibujar() {
    this.actualizarProyecciones();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.ancho, this.alto);

    if (this.modoVista === "camara360") {
      this.dibujarModoCamara360(ctx);
    } else {
      this.dibujarModoPlano(ctx);
    }

    // Elementos HUD superpuestos
    if (this.mostrarHUD) {
      this.dibujarHUDSuperior(ctx);
      this.dibujarBrujulaMiniatura(ctx);
    }

    if (this.mostrarReticula && this.modoVista === "camara360") {
      this.dibujarReticula(ctx);
    }
  }

  /**
   * Renderizado en modo cámara 360° panorámico (estilo Stellarium / Star Walk).
   */
  dibujarModoCamara360(ctx) {
    const rojo = this.modoNoche;

    // 1. Fondo cielo nocturno realista / espacio profundo
    const gradCielo = ctx.createLinearGradient(0, 0, 0, this.alto);
    if (rojo) {
      gradCielo.addColorStop(0, "#160204");
      gradCielo.addColorStop(1, "#0a0102");
    } else {
      gradCielo.addColorStop(0, "#050813");
      gradCielo.addColorStop(0.5, "#070b1a");
      gradCielo.addColorStop(1, "#0a1124");
    }
    ctx.fillStyle = gradCielo;
    ctx.fillRect(0, 0, this.ancho, this.alto);

    // 2. Línea y terreno de horizonte
    if (this.mostrarHorizonte) {
      this.dibujarHorizonte360(ctx);
    }

    // 3. Líneas de constelaciones
    if (this.mostrarLineas) {
      for (const item of this.proyeccionesLineas) {
        if (item.segmentos.length === 0) continue;
        const esSeleccionada = this.constelacionSeleccionada && this.constelacionSeleccionada.id === item.constelacion.id;

        ctx.beginPath();
        for (const [p1, p2] of item.segmentos) {
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }

        if (esSeleccionada) {
          ctx.lineWidth = 2.8;
          ctx.strokeStyle = rojo ? "#ff3344" : "#4fd1c5";
          ctx.shadowColor = rojo ? "#ff3344" : "#4fd1c5";
          ctx.shadowBlur = 12;
        } else {
          ctx.lineWidth = 1.0;
          ctx.strokeStyle = rojo ? "rgba(255, 60, 80, 0.28)" : "rgba(100, 160, 240, 0.28)";
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Rótulos de constelación
        if (this.mostrarNombres && item.centroide) {
          ctx.font = esSeleccionada
            ? "bold 14px Inter, sans-serif"
            : "11px Inter, sans-serif";
          ctx.fillStyle = esSeleccionada
            ? (rojo ? "#ff8899" : "#63b3ed")
            : (rojo ? "rgba(255, 120, 130, 0.55)" : "rgba(180, 210, 255, 0.55)");
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(item.constelacion.nombre_es, item.centroide.x, item.centroide.y);
        }
      }
    }

    // 4. Estrellas con magnitud visual y color espectral
    for (const item of this.proyeccionesEstrellas) {
      const s = item.estrella;
      const esHover = this.estrellaHover && this.estrellaHover.id === s.id;
      const esSeleccionada = this.estrellaSeleccionada && this.estrellaSeleccionada.id === s.id;

      // Escala de tamaño por magnitud
      let radio = Math.max(0.8, (6.5 - s.mag) * 0.72);
      if (esHover || esSeleccionada) radio *= 2.0;

      ctx.beginPath();
      ctx.arc(item.x, item.y, radio, 0, Math.PI * 2);

      let color = rojo ? "#ff5566" : (s.color || "#ffffff");
      ctx.fillStyle = color;

      if (s.mag < 2.0 || esHover || esSeleccionada) {
        ctx.shadowColor = color;
        ctx.shadowBlur = esHover || esSeleccionada ? 14 : 7;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Nombres de estrellas principales
      if (this.mostrarEstrellasNombres && (s.mag <= 2.0 || s.name || esHover)) {
        if (s.name) {
          ctx.font = esHover ? "bold 12px Inter, sans-serif" : "10px Inter, sans-serif";
          ctx.fillStyle = esHover
            ? (rojo ? "#ffffff" : "#ffffff")
            : (rojo ? "rgba(255, 180, 180, 0.85)" : "rgba(220, 235, 255, 0.85)");
          ctx.textAlign = "left";
          ctx.fillText(s.name, item.x + 6, item.y - 4);
        }
      }
    }
  }

  /**
   * Dibuja el horizonte y la tierra en modo panorámico 360°.
   */
  dibujarHorizonte360(ctx) {
    const rojo = this.modoNoche;
    const puntosHorizonte = [];

    // Generar muestras a lo largo del círculo de horizonte (Alt = 0°)
    for (let az = 0; az <= 360; az += 5) {
      const pt = proyectarCamara360(0.0, az, this.camAlt, this.camAz, this.camRoll, this.fov, this.ancho, this.alto);
      if (pt) {
        puntosHorizonte.push({ az, x: pt.x, y: pt.y });
      }
    }

    if (puntosHorizonte.length > 1) {
      // Dibujar línea luminosa de horizonte
      ctx.beginPath();
      ctx.moveTo(puntosHorizonte[0].x, puntosHorizonte[0].y);
      for (let i = 1; i < puntosHorizonte.length; i++) {
        ctx.lineTo(puntosHorizonte[i].x, puntosHorizonte[i].y);
      }
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = rojo ? "rgba(255, 50, 60, 0.7)" : "rgba(79, 209, 197, 0.6)";
      ctx.shadowColor = rojo ? "#ff3344" : "#4fd1c5";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Puntos cardinales rotulados sobre el horizonte
      const cardinales = [
        { nombre: "NORTE (0°)", az: 0 },
        { nombre: "NE (45°)", az: 45 },
        { nombre: "ESTE (90°)", az: 90 },
        { nombre: "SE (135°)", az: 135 },
        { nombre: "SUR (180°)", az: 180 },
        { nombre: "SO (225°)", az: 225 },
        { nombre: "OESTE (270°)", az: 270 },
        { nombre: "NO (315°)", az: 315 },
      ];

      for (const card of cardinales) {
        const pt = proyectarCamara360(0.0, card.az, this.camAlt, this.camAz, this.camRoll, this.fov, this.ancho, this.alto);
        if (pt && pt.visible) {
          ctx.font = "bold 11px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = card.az === 0
            ? (rojo ? "#ff8899" : "#fc8181")
            : (rojo ? "rgba(255, 140, 150, 0.85)" : "rgba(180, 220, 255, 0.85)");

          // Marcador de poste cardinal
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillText(card.nombre, pt.x, pt.y + 14);
        }
      }
    }
  }

  /**
   * HUD de cinta azimutal (Compass Ribbon estilo Android / Aviación).
   */
  dibujarHUDSuperior(ctx) {
    if (this.modoVista !== "camara360") return;
    const rojo = this.modoNoche;

    const ribbonH = 34;
    const ribbonW = Math.min(this.ancho - 32, 600);
    const startX = this.cx - ribbonW / 2;
    const startY = 12;

    // Fondo translúcido con borde
    ctx.save();
    ctx.fillStyle = rojo ? "rgba(20, 4, 6, 0.88)" : "rgba(8, 14, 28, 0.85)";
    ctx.strokeStyle = rojo ? "rgba(255, 50, 60, 0.35)" : "rgba(79, 209, 197, 0.35)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.roundRect(startX, startY, ribbonW, ribbonH, 8);
    ctx.fill();
    ctx.stroke();

    // Graduaciones de la brújula
    ctx.beginPath();
    ctx.rect(startX, startY, ribbonW, ribbonH);
    ctx.clip();

    const pixelsPerDegree = ribbonW / this.fov;
    const minAz = this.camAz - this.fov / 2;
    const maxAz = this.camAz + this.fov / 2;

    for (let deg = Math.floor(minAz); deg <= Math.ceil(maxAz); deg++) {
      const azNorm = (deg % 360 + 360) % 360;
      const x = this.cx + (deg - this.camAz) * pixelsPerDegree;

      if (deg % 10 === 0) {
        ctx.strokeStyle = rojo ? "rgba(255, 100, 110, 0.8)" : "rgba(255, 255, 255, 0.7)";
        ctx.beginPath();
        ctx.moveTo(x, startY + ribbonH - 12);
        ctx.lineTo(x, startY + ribbonH - 2);
        ctx.stroke();

        let label = `${azNorm}°`;
        if (azNorm === 0) label = "N";
        else if (azNorm === 45) label = "NE";
        else if (azNorm === 90) label = "E";
        else if (azNorm === 135) label = "SE";
        else if (azNorm === 180) label = "S";
        else if (azNorm === 225) label = "SO";
        else if (azNorm === 270) label = "O";
        else if (azNorm === 315) label = "NO";

        ctx.font = (azNorm % 90 === 0) ? "bold 11px Inter, sans-serif" : "9px Inter, sans-serif";
        ctx.fillStyle = azNorm === 0
          ? "#fc8181"
          : (azNorm % 90 === 0
            ? (rojo ? "#ff8899" : "#4fd1c5")
            : (rojo ? "rgba(255, 150, 160, 0.7)" : "rgba(200, 220, 255, 0.7)"));
        ctx.textAlign = "center";
        ctx.fillText(label, x, startY + 12);
      } else if (deg % 5 === 0) {
        ctx.strokeStyle = rojo ? "rgba(255, 80, 90, 0.4)" : "rgba(255, 255, 255, 0.35)";
        ctx.beginPath();
        ctx.moveTo(x, startY + ribbonH - 8);
        ctx.lineTo(x, startY + ribbonH - 2);
        ctx.stroke();
      }
    }

    ctx.restore();

    // Indicador central rojo ▼
    ctx.fillStyle = rojo ? "#ff3344" : "#4fd1c5";
    ctx.beginPath();
    ctx.moveTo(this.cx, startY + ribbonH + 4);
    ctx.lineTo(this.cx - 6, startY + ribbonH - 4);
    ctx.lineTo(this.cx + 6, startY + ribbonH - 4);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Brújula circular en miniatura (Bottom-Left) que apunta al Norte en tiempo real.
   */
  dibujarBrujulaMiniatura(ctx) {
    const rojo = this.modoNoche;
    const radio = 30;
    const posX = 42;
    const posY = this.alto - 46;

    ctx.save();
    ctx.beginPath();
    ctx.arc(posX, posY, radio, 0, Math.PI * 2);
    ctx.fillStyle = rojo ? "rgba(18, 3, 5, 0.85)" : "rgba(10, 18, 34, 0.85)";
    ctx.strokeStyle = rojo ? "rgba(255, 60, 80, 0.4)" : "rgba(79, 209, 197, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    // Ángulo hacia el Norte respecto a la vista actual
    const anguloNorteRad = - (this.camAz * Math.PI) / 180.0;

    // Aguja Norte (Roja)
    ctx.beginPath();
    ctx.moveTo(posX, posY);
    ctx.lineTo(
      posX + (radio - 8) * Math.sin(anguloNorteRad),
      posY - (radio - 8) * Math.cos(anguloNorteRad)
    );
    ctx.strokeStyle = "#fc8181";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Aguja Sur (Blanca / Cian)
    ctx.beginPath();
    ctx.moveTo(posX, posY);
    ctx.lineTo(
      posX - (radio - 10) * Math.sin(anguloNorteRad),
      posY + (radio - 10) * Math.cos(anguloNorteRad)
    );
    ctx.strokeStyle = rojo ? "rgba(255, 120, 130, 0.6)" : "rgba(150, 200, 255, 0.6)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Marcador 'N'
    const nx = posX + (radio - 4) * Math.sin(anguloNorteRad);
    const ny = posY - (radio - 4) * Math.cos(anguloNorteRad);
    ctx.font = "bold 9px Inter, sans-serif";
    ctx.fillStyle = "#fc8181";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", nx, ny);

    // Texto con el Azimut y Altitud actual
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = rojo ? "#ff8899" : "#63b3ed";
    ctx.textAlign = "left";
    const strAlt = this.camAlt >= 0 ? `+${this.camAlt.toFixed(0)}°` : `${this.camAlt.toFixed(0)}°`;
    ctx.fillText(`Az: ${this.camAz.toFixed(0)}° | Alt: ${strAlt}`, posX + radio + 10, posY);

    ctx.restore();
  }

  /**
   * Retícula central de apuntado y mira estilo telescopio / HUD astronómico.
   */
  dibujarReticula(ctx) {
    const rojo = this.modoNoche;
    const r = 24;

    ctx.save();
    ctx.strokeStyle = rojo ? "rgba(255, 60, 80, 0.65)" : "rgba(79, 209, 197, 0.65)";
    ctx.lineWidth = 1.2;

    // Círculo central
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Cruz de puntería
    ctx.beginPath();
    ctx.moveTo(this.cx - r - 8, this.cy);
    ctx.lineTo(this.cx - r + 4, this.cy);
    ctx.moveTo(this.cx + r - 4, this.cy);
    ctx.lineTo(this.cx + r + 8, this.cy);

    ctx.moveTo(this.cx, this.cy - r - 8);
    ctx.lineTo(this.cx, this.cy - r + 4);
    ctx.moveTo(this.cx, this.cy + r - 4);
    ctx.lineTo(this.cx, this.cy + r + 8);
    ctx.stroke();

    // Punto central
    ctx.fillStyle = rojo ? "#ff3344" : "#4fd1c5";
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Modo bóveda cenital clásica (círculo 180° plano).
   */
  dibujarModoPlano(ctx) {
    const rojo = this.modoNoche;

    ctx.fillStyle = rojo ? "#120204" : "#070a12";
    ctx.fillRect(0, 0, this.ancho, this.alto);

    const gradCielo = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.radioCielo);
    if (rojo) {
      gradCielo.addColorStop(0, "#220508");
      gradCielo.addColorStop(1, "#0a0102");
    } else {
      gradCielo.addColorStop(0, "#0d1424");
      gradCielo.addColorStop(0.7, "#080d19");
      gradCielo.addColorStop(1, "#04070e");
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radioCielo, 0, Math.PI * 2);
    ctx.fillStyle = gradCielo;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = rojo ? "rgba(255, 60, 80, 0.4)" : "rgba(79, 134, 198, 0.4)";
    ctx.stroke();

    // Anillos altitud
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radioCielo * (30 / 90), 0, Math.PI * 2);
    ctx.arc(this.cx, this.cy, this.radioCielo * (60 / 90), 0, Math.PI * 2);
    ctx.stroke();

    // Constelaciones
    if (this.mostrarLineas) {
      for (const item of this.proyeccionesLineas) {
        const esSeleccionada = this.constelacionSeleccionada && this.constelacionSeleccionada.id === item.constelacion.id;
        ctx.beginPath();
        for (const [p1, p2] of item.segmentos) {
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
        ctx.lineWidth = esSeleccionada ? 2.5 : 0.9;
        ctx.strokeStyle = esSeleccionada ? (rojo ? "#ff3344" : "#4fd1c5") : (rojo ? "rgba(255, 60, 80, 0.25)" : "rgba(100, 150, 220, 0.22)");
        ctx.stroke();

        if (this.mostrarNombres && item.centroide) {
          ctx.font = esSeleccionada ? "bold 13px Inter, sans-serif" : "10px Inter, sans-serif";
          ctx.fillStyle = esSeleccionada ? (rojo ? "#ff8899" : "#63b3ed") : (rojo ? "rgba(255, 120, 130, 0.45)" : "rgba(180, 205, 240, 0.45)");
          ctx.textAlign = "center";
          ctx.fillText(item.constelacion.nombre_es, item.centroide.x, item.centroide.y);
        }
      }
    }

    // Estrellas
    for (const item of this.proyeccionesEstrellas) {
      const s = item.estrella;
      const radio = Math.max(0.6, (6.5 - s.mag) * 0.65);
      const esHover = this.estrellaHover && this.estrellaHover.id === s.id;
      const esSeleccionada = this.estrellaSeleccionada && this.estrellaSeleccionada.id === s.id;

      ctx.beginPath();
      ctx.arc(item.x, item.y, esHover || esSeleccionada ? radio * 1.8 : radio, 0, Math.PI * 2);
      ctx.fillStyle = rojo ? "#ff5566" : (s.color || "#ffffff");
      ctx.fill();

      if (this.mostrarEstrellasNombres && (s.mag <= 2.2 || s.name || esHover)) {
        if (s.name) {
          ctx.font = esHover ? "bold 11px Inter, sans-serif" : "9px Inter, sans-serif";
          ctx.fillStyle = esHover ? "#ffffff" : (rojo ? "rgba(255, 180, 180, 0.75)" : "rgba(220, 230, 255, 0.75)");
          ctx.textAlign = "left";
          ctx.fillText(s.name, item.x + 5, item.y - 4);
        }
      }
    }

    ctx.restore();

    // Puntos cardinales alrededor del círculo
    this.dibujarPuntosCardinalesPlano(ctx);
  }

  dibujarPuntosCardinalesPlano(ctx) {
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

  /**
   * Busca la estrella más cercana a las coordenadas (mouseX, mouseY) del canvas
   * y calcula las coordenadas celestes (RA/Dec y Alt/Az) en ese punto de la pantalla.
   */
  buscarObjetoEnPosicion(mouseX, mouseY) {
    let estrellaCercana = null;
    let minDistEstrella = 16; // Radio de captura táctil cómodo

    for (const item of this.proyeccionesEstrellas) {
      const dx = item.x - mouseX;
      const dy = item.y - mouseY;
      const d = Math.hypot(dx, dy);
      if (d < minDistEstrella) {
        minDistEstrella = d;
        estrellaCercana = item.estrella;
      }
    }

    if (this.modoVista === "camara360") {
      // Inversa estereográfica para cámara 360°
      const dxScreen = mouseX - this.cx;
      const dyScreen = -(mouseY - this.cy);
      const rScreen = Math.hypot(dxScreen, dyScreen);

      const fovRad = (this.fov * Math.PI) / 180.0;
      const focal = Math.min(this.ancho, this.alto) / (4.0 * Math.tan(fovRad / 4.0));
      const theta = 2.0 * Math.atan(rScreen / (2.0 * focal));

      const psi = Math.atan2(dyScreen, dxScreen);
      const dx = Math.sin(theta) * Math.cos(psi);
      const dy = Math.sin(theta) * Math.sin(psi);
      const dz = Math.cos(theta);

      // Reconstruir vector topocéntrico P
      const cAltRad = (this.camAlt * Math.PI) / 180.0;
      const cAzRad = (this.camAz * Math.PI) / 180.0;

      const fx = Math.cos(cAltRad) * Math.sin(cAzRad);
      const fy = Math.cos(cAltRad) * Math.cos(cAzRad);
      const fz = Math.sin(cAltRad);

      const rx = Math.cos(cAzRad);
      const ry = -Math.sin(cAzRad);
      const rz = 0.0;

      const ux = -Math.sin(cAzRad) * Math.sin(cAltRad);
      const uy = -Math.cos(cAzRad) * Math.sin(cAltRad);
      const uz = Math.cos(cAltRad);

      const px = dx * rx + dy * ux + dz * fx;
      const py = dx * ry + dy * uy + dz * fy;
      const pz = dx * rz + dy * uz + dz * fz;

      const altRad = Math.asin(Math.max(-1.0, Math.min(1.0, pz)));
      const altDeg = (altRad * 180.0) / Math.PI;

      let azRad = Math.atan2(px, py);
      let azDeg = (azRad * 180.0) / Math.PI;
      if (azDeg < 0) azDeg += 360.0;

      const eq = horizontalAEcuatorial(altDeg, azDeg, this.latDeg, this.lonDeg, this.fecha);

      return {
        estrella: estrellaCercana,
        raH: eq.ra,
        decDeg: eq.dec,
        altDeg,
        azDeg,
      };
    } else {
      // Inversa en modo plano
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

      const eq = horizontalAEcuatorial(altDeg, azDeg, this.latDeg, this.lonDeg, this.fecha);

      return {
        estrella: estrellaCercana,
        raH: eq.ra,
        decDeg: eq.dec,
        altDeg,
        azDeg,
      };
    }
  }
}
