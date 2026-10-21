/**
 * Orquestador principal de la aplicación web Celestial Constellation AI.
 * Controla el visor 360° táctil y giroscópico, HUD de brújula en tiempo real,
 * gestos multitáctiles, sintetizador de audio y clasificación de constelaciones.
 */

import { calcularLST, ecuatorialAHorizontal } from "./src/astrometry.js";
import { ConstellationMatcher } from "./src/constellation_matcher.js";
import { SkyRenderer } from "./src/renderer.js";

let renderer = null;
let matcher = null;
let estrellas = [];
let constelaciones = [];

// Tiempo y animación
let baseTime = new Date();
let offsetHours = 0;
let isAnimating = false;
let animReqId = null;

// Sonido sintético (Web Audio API)
let audioCtx = null;
let soundEnabled = true;

// Estado de interacción táctil / ratón
let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let lastTouchDist = 0;

// Estado del sensor giroscópico
let gyroActivo = false;
let filtroAlpha = 0;
let filtroBeta = 0;

async function inicializar() {
  try {
    // 1. Cargar datasets procesados
    const [resStars, resConst] = await Promise.all([
      fetch("data/processed/stars.json"),
      fetch("data/processed/constellations.json"),
    ]);

    estrellas = await resStars.json();
    constelaciones = await resConst.json();

    const canvas = document.getElementById("skyCanvas");
    renderer = new SkyRenderer(canvas, estrellas, constelaciones);
    matcher = new ConstellationMatcher(constelaciones);

    // 2. Observatorio inicial por defecto (Bilbao)
    renderer.setUbicacion(43.2627, -2.9348);
    renderer.setFecha(new Date());

    // 3. Poblar buscador de constelaciones
    poblarBuscador();

    // 4. Configurar eventos de navegación 360° y sensores
    configurarEventosNavegacion(canvas);
    configurarEventosUI();

    // 5. Inferencia inicial sobre la Osa Mayor
    ejecutarInferenciaInicial();

    // 6. Arrancar ciclo de renderizado continuo a 60 FPS
    bucleRenderPrincipal();
  } catch (err) {
    console.error("Error al inicializar Celestial Constellation AI:", err);
  }
}

/**
 * Bucle continuo a 60 FPS: gestiona inercia, giroscopio y telemetría HUD.
 */
function bucleRenderPrincipal() {
  // Aplicar inercia si el usuario soltó el arrastre con velocidad
  if (!isDragging && !gyroActivo) {
    renderer.aplicarInercia();
  }

  // Si la animación temporal está activa, avanzar minutos simulados
  if (isAnimating) {
    offsetHours += 0.033;
    document.getElementById("timeSlider").value = (offsetHours % 12).toFixed(1);
    actualizarTiempo(false);
  }

  // Renderizar la escena
  renderer.dibujar();

  // Actualizar telemetría HUD en tiempo real
  actualizarHUDTiempoReal();

  requestAnimationFrame(bucleRenderPrincipal);
}

function actualizarHUDTiempoReal() {
  // Badge de orientación azimutal / altitud
  const badgeCoords = document.getElementById("badgeAzAlt");
  if (badgeCoords) {
    const strAlt = renderer.camAlt >= 0 ? `+${renderer.camAlt.toFixed(0)}°` : `${renderer.camAlt.toFixed(0)}°`;
    badgeCoords.textContent = `Az: ${renderer.camAz.toFixed(0)}° | Alt: ${strAlt}`;
  }

  // Actualizar píldora central de la retícula si estamos en modo 360°
  if (renderer.modoVista === "camara360" && renderer.objetoEnReticula) {
    const obj = renderer.objetoEnReticula;
    const preds = matcher.clasificar(obj.ra, obj.dec, 1);
    if (preds && preds.length > 0) {
      const p = preds[0];
      document.getElementById("reticleConstellationName").textContent = `${p.nombre_es} (${p.id})`;
      document.getElementById("reticleTelemetry").textContent = `${p.confianza.toFixed(1)}% match · RA ${obj.ra.toFixed(1)}h Dec ${obj.dec >= 0 ? "+" : ""}${obj.dec.toFixed(0)}°`;
    }
  }
}

function poblarBuscador() {
  const datalist = document.getElementById("constelacionesList");
  for (const c of constelaciones) {
    const opt = document.createElement("option");
    opt.value = c.nombre_es;
    opt.label = `${c.nombre_latin} (${c.id})`;
    datalist.appendChild(opt);
  }
}

/**
 * Eventos táctiles, ratón y rueda para navegación 360° inmersiva.
 */
function configurarEventosNavegacion(canvas) {
  const tooltip = document.getElementById("skyTooltip");

  // === RATÓN: Arrastre libre 360° ===
  canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    renderer.velAz = 0;
    renderer.velAlt = 0;
    // Si la brújula móvil estaba activa, pausarla al interactuar manualmente
    if (gyroActivo) desactivarGiroscopio();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) {
      // Hover sobre estrellas
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const info = renderer.buscarObjetoEnPosicion(mouseX, mouseY);

      if (info && info.estrella) {
        renderer.estrellaHover = info.estrella;
        tooltip.style.display = "block";
        tooltip.style.left = `${e.clientX - rect.left + 16}px`;
        tooltip.style.top = `${e.clientY - rect.top - 24}px`;

        const s = info.estrella;
        const distInfo = s.dist_ly ? `· ${s.dist_ly} ly` : "";
        tooltip.innerHTML = `
          <div style="font-weight:700; color: #fff;">${s.name || s.bayer || "HIP " + s.hip}</div>
          <div style="font-size: 11px; color: var(--accent-cyan);">Mag: ${s.mag} ${distInfo}</div>
          <div style="font-size: 10px; color: var(--text-muted);">Constelación: ${s.con || "N/A"}</div>
        `;
      } else {
        renderer.estrellaHover = null;
        tooltip.style.display = "none";
      }
      return;
    }

    const deltaX = e.clientX - lastPointerX;
    const deltaY = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    if (renderer.modoVista === "camara360") {
      const factorSensibilidad = renderer.fov / renderer.ancho;
      const dAz = -deltaX * factorSensibilidad;
      const dAlt = deltaY * factorSensibilidad;

      renderer.rotarCamara(dAz, dAlt);
      renderer.velAz = dAz * 0.4;
      renderer.velAlt = dAlt * 0.4;
    }
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Clic en el canvas para fijar objetivo con IA
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const info = renderer.buscarObjetoEnPosicion(mouseX, mouseY);
    if (!info || info.raH === null) return;

    if (info.estrella) {
      renderer.estrellaSeleccionada = info.estrella;
    }

    const predicciones = matcher.clasificar(info.raH, info.decDeg, 3);
    if (predicciones.length > 0) {
      actualizarPanelIA(predicciones, info);
      reproducirSonidoTarget();

      const ganadora = constelaciones.find((c) => c.id === predicciones[0].id);
      renderer.constelacionSeleccionada = ganadora || null;
    }
  });

  // Rueda del ratón: Zoom FOV
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const deltaZoom = e.deltaY > 0 ? 3.0 : -3.0;
    renderer.setFov(renderer.fov + deltaZoom);
  }, { passive: false });

  // === MÓVIL: Gestos Táctiles (Arrastre 1 dedo + Pellizco 2 dedos) ===
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      lastPointerX = e.touches[0].clientX;
      lastPointerY = e.touches[0].clientY;
      renderer.velAz = 0;
      renderer.velAlt = 0;
      if (gyroActivo) desactivarGiroscopio();
    } else if (e.touches.length === 2) {
      isDragging = false;
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1 && isDragging) {
      const deltaX = e.touches[0].clientX - lastPointerX;
      const deltaY = e.touches[0].clientY - lastPointerY;
      lastPointerX = e.touches[0].clientX;
      lastPointerY = e.touches[0].clientY;

      if (renderer.modoVista === "camara360") {
        const factor = renderer.fov / renderer.ancho;
        const dAz = -deltaX * factor;
        const dAlt = deltaY * factor;
        renderer.rotarCamara(dAz, dAlt);
        renderer.velAz = dAz * 0.3;
        renderer.velAlt = dAlt * 0.3;
      }
    } else if (e.touches.length === 2) {
      // Zoom por pellizco (Pinch to zoom)
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastTouchDist > 0) {
        const factor = (lastTouchDist - dist) * 0.15;
        renderer.setFov(renderer.fov + factor);
      }
      lastTouchDist = dist;
    }
  }, { passive: true });

  canvas.addEventListener("touchend", () => {
    isDragging = false;
    lastTouchDist = 0;
  });
}

/**
 * Configuración de controles de la UI: botones cardinales, brújula, GPS, modos y drawer.
 */
function configurarEventosUI() {
  // 1. Botón Brújula / Giroscopio Móvil
  const btnGyro = document.getElementById("btnGyro");
  btnGyro.addEventListener("click", () => {
    if (gyroActivo) {
      desactivarGiroscopio();
    } else {
      activarGiroscopio();
    }
  });

  document.getElementById("btnDisableGyro").addEventListener("click", desactivarGiroscopio);

  // 2. Fijar objetivo desde la píldora central de la retícula
  document.getElementById("btnLockTarget").addEventListener("click", () => {
    if (renderer.objetoEnReticula) {
      const obj = renderer.objetoEnReticula;
      const predicciones = matcher.clasificar(obj.ra, obj.dec, 3);
      if (predicciones.length > 0) {
        actualizarPanelIA(predicciones, {
          raH: obj.ra,
          decDeg: obj.dec,
          altDeg: obj.alt,
          azDeg: obj.az,
        });
        reproducirSonidoTarget();

        const ganadora = constelaciones.find((c) => c.id === predicciones[0].id);
        renderer.constelacionSeleccionada = ganadora || null;
      }
    }
  });

  // 3. Botones cardinales rápidos
  document.querySelectorAll(".btn-cardinal").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const az = parseFloat(e.currentTarget.getAttribute("data-az"));
      const alt = parseFloat(e.currentTarget.getAttribute("data-alt"));
      renderer.mirarHacia(az, alt);
      reproducirSonidoClick();
    });
  });

  // 4. GPS Geolocation
  const btnGps = document.getElementById("btnGps");
  btnGps.addEventListener("click", () => {
    if ("geolocation" in navigator) {
      btnGps.style.opacity = "0.5";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btnGps.style.opacity = "1";
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          renderer.setUbicacion(lat, lon, "Mi Posición GPS");
          document.getElementById("badgeUbicacion").textContent = `GPS (${lat.toFixed(1)}°, ${lon.toFixed(1)}°)`;
          reproducirSonidoTarget();
        },
        (err) => {
          btnGps.style.opacity = "1";
          alert("No se pudo obtener la ubicación GPS: " + err.message);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      alert("La geolocalización no está soportada en este navegador.");
    }
  });

  // 5. Alternar Vista (360° vs Bóveda Plana)
  const btnToggleView = document.getElementById("btnToggleViewMode");
  btnToggleView.addEventListener("click", () => {
    if (renderer.modoVista === "camara360") {
      renderer.modoVista = "plano";
      document.getElementById("viewModeIcon").textContent = "⚪";
      document.getElementById("viewModeLabel").textContent = "Plano";
    } else {
      renderer.modoVista = "camara360";
      document.getElementById("viewModeIcon").textContent = "🌐";
      document.getElementById("viewModeLabel").textContent = "360°";
    }
    reproducirSonidoClick();
  });

  // 6. Botones de Zoom
  document.getElementById("btnZoomIn").addEventListener("click", () => {
    renderer.setFov(renderer.fov - 8.0);
    reproducirSonidoClick();
  });
  document.getElementById("btnZoomOut").addEventListener("click", () => {
    renderer.setFov(renderer.fov + 8.0);
    reproducirSonidoClick();
  });

  // 7. Modo Nocturno Rojo
  const btnNight = document.getElementById("btnNightMode");
  btnNight.addEventListener("click", () => {
    document.body.classList.toggle("night-mode");
    renderer.modoNoche = document.body.classList.contains("night-mode");
    reproducirSonidoClick();
  });

  // 8. Audio Toggle
  const btnAudio = document.getElementById("btnToggleAudio");
  btnAudio.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    document.getElementById("audioIcon").textContent = soundEnabled ? "🔊" : "🔇";
  });

  // 9. Drawer en Móviles
  const sidebar = document.getElementById("sidebar");
  const btnOpenDrawer = document.getElementById("btnMobileDrawer");
  const btnCloseDrawer = document.getElementById("btnCloseDrawer");

  btnOpenDrawer.addEventListener("click", () => {
    sidebar.classList.add("drawer-open");
  });
  btnCloseDrawer.addEventListener("click", () => {
    sidebar.classList.remove("drawer-open");
  });

  // 10. Selector de Ubicación
  const locSelect = document.getElementById("locationSelect");
  locSelect.addEventListener("change", (e) => {
    const [lat, lon] = e.target.value.split(",").map(Number);
    const ciudad = e.target.options[e.target.selectedIndex].text.split(" (")[0];
    renderer.setUbicacion(lat, lon, ciudad);
    document.getElementById("badgeUbicacion").textContent = `${ciudad} (${lat.toFixed(1)}° N)`;
  });

  // 11. Buscador y Guía Automática
  const searchInput = document.getElementById("searchInput");
  const ejecutarBusqueda = () => {
    const query = searchInput.value.trim().toLowerCase();
    const cFound = constelaciones.find(
      (c) =>
        c.nombre_es.toLowerCase() === query ||
        c.nombre_latin.toLowerCase() === query ||
        c.id.toLowerCase() === query
    );

    if (cFound) {
      renderer.constelacionSeleccionada = cFound;
      // Calcular azimut y altitud local del centroide para orientar la cámara hacia él
      const coordLocal = ecuatorialAHorizontal(
        cFound.centroide[0],
        cFound.centroide[1],
        renderer.latDeg,
        renderer.lonDeg,
        renderer.fecha
      );

      renderer.mirarHacia(coordLocal.az, Math.max(5.0, coordLocal.alt));
      reproducirSonidoTarget();

      const predicciones = matcher.clasificar(cFound.centroide[0], cFound.centroide[1], 3);
      actualizarPanelIA(predicciones, {
        raH: cFound.centroide[0],
        decDeg: cFound.centroide[1],
        altDeg: coordLocal.alt,
        azDeg: coordLocal.az,
      });
    }
  };

  searchInput.addEventListener("change", ejecutarBusqueda);
  document.getElementById("btnSearchGo").addEventListener("click", ejecutarBusqueda);

  // 12. Controles de tiempo
  const timeSlider = document.getElementById("timeSlider");
  timeSlider.addEventListener("input", (e) => {
    offsetHours = parseFloat(e.target.value);
    actualizarTiempo(true);
  });

  document.getElementById("btnResetTime").addEventListener("click", () => {
    baseTime = new Date();
    offsetHours = 0;
    timeSlider.value = 0;
    actualizarTiempo(true);
    reproducirSonidoClick();
  });

  const btnAnim = document.getElementById("btnToggleAnim");
  btnAnim.addEventListener("click", () => {
    isAnimating = !isAnimating;
    btnAnim.textContent = isAnimating ? "⏸ Pausar Giro" : "▶ Animar Giro";
    reproducirSonidoClick();
  });

  // 13. Capas visuales
  const chkTerreno = document.getElementById("chkTerreno");
  if (chkTerreno) {
    chkTerreno.addEventListener("change", (e) => {
      renderer.mostrarTerreno = e.target.checked;
    });
  }
  document.getElementById("chkLineas").addEventListener("change", (e) => {
    renderer.mostrarLineas = e.target.checked;
  });
  document.getElementById("chkNombres").addEventListener("change", (e) => {
    renderer.mostrarNombres = e.target.checked;
  });
  document.getElementById("chkEstrellas").addEventListener("change", (e) => {
    renderer.mostrarEstrellasNombres = e.target.checked;
  });
  document.getElementById("chkHorizonte").addEventListener("change", (e) => {
    renderer.mostrarHorizonte = e.target.checked;
  });
  document.getElementById("chkHUD").addEventListener("change", (e) => {
    renderer.mostrarHUD = e.target.checked;
  });
}

/**
 * Activa los sensores de orientación del dispositivo (Android e iOS).
 */
async function activarGiroscopio() {
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      if (permissionState !== "granted") {
        alert("Permiso de orientación denegado.");
        return;
      }
    } catch (e) {
      console.warn("Fallo al solicitar permisos de orientación:", e);
    }
  }

  gyroActivo = true;
  renderer.gyroActivo = true;
  document.getElementById("btnGyro").classList.add("active");
  document.getElementById("gyroBanner").style.display = "flex";
  reproducirSonidoTarget();

  window.addEventListener("deviceorientation", manejadorOrientacionDispositivo, true);
}

function desactivarGiroscopio() {
  gyroActivo = false;
  renderer.gyroActivo = false;
  document.getElementById("btnGyro").classList.remove("active");
  document.getElementById("gyroBanner").style.display = "none";
  window.removeEventListener("deviceorientation", manejadorOrientacionDispositivo, true);
}

function manejadorOrientacionDispositivo(e) {
  if (!gyroActivo) return;

  let rumboBruto = 0;
  // En iOS, webkitCompassHeading entrega el Norte magnético real directamente
  if (e.webkitCompassHeading !== undefined) {
    rumboBruto = e.webkitCompassHeading;
  } else if (e.alpha !== null) {
    rumboBruto = (360 - e.alpha) % 360;
  }

  // Beta: inclinación adelante-atrás (-180..180). Cuando se sostiene vertical mirando al cielo:
  let inclinacion = 30;
  if (e.beta !== null) {
    inclinacion = Math.max(-85, Math.min(88, e.beta - 50));
  }

  // Filtro exponencial para evitar temblores del sensor (EMA)
  let diffAz = ((rumboBruto - filtroAlpha + 540) % 360) - 180;
  filtroAlpha = (filtroAlpha + diffAz * 0.25 + 360) % 360;
  filtroBeta = filtroBeta + (inclinacion - filtroBeta) * 0.25;

  renderer.camAz = filtroAlpha;
  renderer.camAlt = filtroBeta;
  if (e.gamma !== null) {
    renderer.camRoll = -e.gamma * 0.5;
  }
}

function actualizarTiempo(forzarRedibujado = true) {
  const fechaSimulada = new Date(baseTime.getTime() + offsetHours * 3600 * 1000);
  renderer.setFecha(fechaSimulada);

  const strOffset = offsetHours === 0
    ? "En Vivo"
    : (offsetHours > 0 ? `+${offsetHours.toFixed(1)} h` : `${offsetHours.toFixed(1)} h`);

  document.getElementById("currentTimeLabel").textContent = `${fechaSimulada.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${strOffset})`;

  const lst = calcularLST(fechaSimulada, renderer.lonDeg);
  document.getElementById("badgeLST").textContent = `${lst.toFixed(1)} h`;

  if (forzarRedibujado) {
    renderer.dibujar();
  }
}

function ejecutarInferenciaInicial() {
  const uma = constelaciones.find((c) => c.id === "UMa") || constelaciones[0];
  if (uma) {
    renderer.constelacionSeleccionada = uma;
    const preds = matcher.clasificar(uma.centroide[0], uma.centroide[1], 3);
    actualizarPanelIA(preds, {
      raH: uma.centroide[0],
      decDeg: uma.centroide[1],
      altDeg: 54.2,
      azDeg: 15.0,
    });
  }
}

function actualizarPanelIA(predicciones, info) {
  const top1 = predicciones[0];
  document.getElementById("aiTargetName").textContent = top1.nombre_es;
  document.getElementById("aiLatinName").textContent = `${top1.nombre_latin} (${top1.id})`;
  document.getElementById("aiConfidencePill").textContent = `${top1.confianza.toFixed(1)}% Confianza`;

  const bar = document.getElementById("aiConfidenceBar");
  bar.style.width = `${top1.confianza}%`;

  document.getElementById("aiDist").textContent = `${top1.distancia_deg.toFixed(1)}°`;
  document.getElementById("aiAlt").textContent = info.altDeg !== undefined
    ? `${info.altDeg >= 0 ? "+" : ""}${info.altDeg.toFixed(1)}°`
    : "Visible";
  document.getElementById("aiRA").textContent = `${info.raH.toFixed(2)} h`;
  document.getElementById("aiDec").textContent = `${info.decDeg >= 0 ? "+" : ""}${info.decDeg.toFixed(1)}°`;

  const containerAlt = document.getElementById("aiAltContainer");
  containerAlt.innerHTML = "";
  predicciones.forEach((p, idx) => {
    const row = document.createElement("div");
    row.className = "ai-alt-row";
    row.innerHTML = `<span>${idx + 1}. ${p.nombre_es} (${p.id})</span> <b>${p.confianza.toFixed(1)}%</b>`;
    containerAlt.appendChild(row);
  });

  // Actualizar peek del drawer móvil
  const peekTitle = document.getElementById("drawerPeekTitle");
  if (peekTitle) {
    peekTitle.textContent = `🧠 ${top1.nombre_es} (${top1.id})`;
    document.getElementById("drawerPeekConfidence").textContent = `${top1.confianza.toFixed(1)}%`;
  }
}

/**
 * Sintetizador de audio Web Audio API (cero dependencias externas).
 */
function obtenerAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function reproducirSonidoTarget() {
  if (!soundEnabled) return;
  try {
    const ctx = obtenerAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880.0, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch (e) {
    console.debug("Audio no disponible:", e);
  }
}

function reproducirSonidoClick() {
  if (!soundEnabled) return;
  try {
    const ctx = obtenerAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch (e) {
    console.debug("Audio no disponible:", e);
  }
}

// Iniciar app al cargar DOM
window.addEventListener("DOMContentLoaded", inicializar);
