/**
 * Orquestador principal de la aplicación web Celestial Constellation AI.
 * Coordina la carga de datos, interacción de usuario, renderizado a 60 FPS
 * y llamadas al motor de inferencia de constelaciones.
 */

import { calcularLST } from "./src/astrometry.js";
import { ConstellationMatcher } from "./src/constellation_matcher.js";
import { SkyRenderer } from "./src/renderer.js";

let renderer = null;
let matcher = null;
let estrellas = [];
let constelaciones = [];

let baseTime = new Date();
let offsetHours = 0;
let isAnimating = false;
let animReqId = null;

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

    // 2. Configurar observador por defecto (Bilbao)
    renderer.setUbicacion(43.2627, -2.9348);
    renderer.setFecha(new Date());

    // 3. Poblar buscador de constelaciones
    poblarBuscador();

    // 4. Configurar eventos de UI y Canvas
    configurarEventos();

    // 5. Inferencia inicial por defecto sobre la Osa Mayor
    ejecutarInferenciaInicial();

    // 6. Primer render
    actualizarVista();
  } catch (err) {
    console.error("Error al inicializar la aplicación:", err);
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

function configurarEventos() {
  const canvas = document.getElementById("skyCanvas");
  const tooltip = document.getElementById("skyTooltip");

  // Interacción en el Canvas: Hover
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const info = renderer.buscarObjetoEnPosicion(mouseX, mouseY);
    if (info && info.estrella) {
      renderer.estrellaHover = info.estrella;
      tooltip.style.display = "block";
      tooltip.style.left = `${e.clientX - rect.left + 15}px`;
      tooltip.style.top = `${e.clientY - rect.top - 20}px`;

      const s = info.estrella;
      const distInfo = s.dist_ly ? `· ${s.dist_ly} años luz` : "";
      tooltip.innerHTML = `
        <div style="font-weight:700; color: #fff;">${s.name || s.bayer || "Estrella HIP " + s.hip}</div>
        <div style="font-size: 11px; color: var(--accent-cyan);">Mag visual: ${s.mag} ${distInfo}</div>
        <div style="font-size: 10px; color: var(--text-muted);">Constelación: ${s.con || "N/A"}</div>
      `;
    } else {
      renderer.estrellaHover = null;
      tooltip.style.display = "none";
    }

    if (!isAnimating) {
      renderer.dibujar();
    }
  });

  canvas.addEventListener("mouseleave", () => {
    renderer.estrellaHover = null;
    tooltip.style.display = "none";
    if (!isAnimating) renderer.dibujar();
  });

  // Interacción en el Canvas: Click para Inferencia con IA
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const info = renderer.buscarObjetoEnPosicion(mouseX, mouseY);
    if (!info || info.raH === null) return;

    if (info.estrella) {
      renderer.estrellaSeleccionada = info.estrella;
    }

    // Ejecutar clasificación del Star Tracker
    const predicciones = matcher.clasificar(info.raH, info.decDeg, 3);
    if (predicciones.length > 0) {
      actualizarPanelIA(predicciones, info);

      // Resaltar constelación ganadora en el canvas
      const ganadora = constelaciones.find((c) => c.id === predicciones[0].id);
      renderer.constelacionSeleccionada = ganadora || null;
      if (!isAnimating) renderer.dibujar();
    }
  });

  // Selector de Ubicación
  const locSelect = document.getElementById("locationSelect");
  locSelect.addEventListener("change", (e) => {
    const [lat, lon] = e.target.value.split(",").map(Number);
    renderer.setUbicacion(lat, lon);
    const textoCiudad = e.target.options[e.target.selectedIndex].text.split(" (")[0];
    document.getElementById("badgeUbicacion").textContent = `${textoCiudad} (${lat.toFixed(1)}° N)`;
    actualizarVista();
  });

  // Buscador de constelaciones
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("change", (e) => {
    const query = e.target.value.trim().toLowerCase();
    const cFound = constelaciones.find(
      (c) =>
        c.nombre_es.toLowerCase() === query ||
        c.nombre_latin.toLowerCase() === query ||
        c.id.toLowerCase() === query
    );

    if (cFound) {
      renderer.constelacionSeleccionada = cFound;
      const predicciones = matcher.clasificar(cFound.centroide[0], cFound.centroide[1], 3);
      actualizarPanelIA(predicciones, {
        raH: cFound.centroide[0],
        decDeg: cFound.centroide[1],
        altDeg: 50.0,
      });
      if (!isAnimating) renderer.dibujar();
    }
  });

  // Controles de tiempo
  const timeSlider = document.getElementById("timeSlider");
  timeSlider.addEventListener("input", (e) => {
    offsetHours = parseFloat(e.target.value);
    actualizarTiempo();
  });

  document.getElementById("btnResetTime").addEventListener("click", () => {
    baseTime = new Date();
    offsetHours = 0;
    timeSlider.value = 0;
    actualizarTiempo();
  });

  const btnAnim = document.getElementById("btnToggleAnim");
  btnAnim.addEventListener("click", () => {
    isAnimating = !isAnimating;
    if (isAnimating) {
      btnAnim.textContent = "⏸ Pausar Giro";
      bucleAnimacion();
    } else {
      btnAnim.textContent = "▶ Animar Giro";
      if (animReqId) cancelAnimationFrame(animReqId);
    }
  });

  // Capas visuales
  document.getElementById("chkLineas").addEventListener("change", (e) => {
    renderer.mostrarLineas = e.target.checked;
    if (!isAnimating) renderer.dibujar();
  });

  document.getElementById("chkNombres").addEventListener("change", (e) => {
    renderer.mostrarNombres = e.target.checked;
    if (!isAnimating) renderer.dibujar();
  });

  document.getElementById("chkEstrellas").addEventListener("change", (e) => {
    renderer.mostrarEstrellasNombres = e.target.checked;
    if (!isAnimating) renderer.dibujar();
  });
}

function actualizarTiempo() {
  const fechaSimulada = new Date(baseTime.getTime() + offsetHours * 3600 * 1000);
  renderer.setFecha(fechaSimulada);

  const strOffset = offsetHours === 0 ? "En Vivo" : (offsetHours > 0 ? `+${offsetHours.toFixed(1)} h` : `${offsetHours.toFixed(1)} h`);
  document.getElementById("currentTimeLabel").textContent = `${fechaSimulada.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${strOffset})`;

  const lst = calcularLST(fechaSimulada, renderer.lonDeg);
  document.getElementById("badgeLST").textContent = `${lst.toFixed(1)} h`;

  if (!isAnimating) renderer.dibujar();
}

function bucleAnimacion() {
  if (!isAnimating) return;
  // Avanzar 2 minutos simulados por frame
  offsetHours += 0.033;
  document.getElementById("timeSlider").value = offsetHours % 12;
  actualizarTiempo();
  renderer.dibujar();
  animReqId = requestAnimationFrame(bucleAnimacion);
}

function actualizarVista() {
  actualizarTiempo();
  renderer.dibujar();
}

function ejecutarInferenciaInicial() {
  // Osa Mayor por defecto
  const uma = constelaciones.find((c) => c.id === "UMa") || constelaciones[0];
  if (uma) {
    renderer.constelacionSeleccionada = uma;
    const predicciones = matcher.clasificar(uma.centroide[0], uma.centroide[1], 3);
    actualizarPanelIA(predicciones, {
      raH: uma.centroide[0],
      decDeg: uma.centroide[1],
      altDeg: 54.2,
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
  document.getElementById("aiAlt").textContent = info.altDeg !== undefined ? `${info.altDeg >= 0 ? "+" : ""}${info.altDeg.toFixed(1)}°` : "Visible";
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
}

// Iniciar app al cargar DOM
window.addEventListener("DOMContentLoaded", inicializar);
