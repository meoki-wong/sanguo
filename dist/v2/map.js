// 经略三国 2.0 — 九州实时战略沙盘舆图与动态战局演播引擎

import {
  DEFENSE_TRAPS, SIEGE_STANCES, TERRAIN_LABELS, TROOP_TYPES, factionColor, roadTerrain,
} from "./constants.js";
import {
  armyEtaDekads, armyWorldPosition, checkSupplyLine, computeThreats, eraByYearV2,
} from "./engine.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const SEASON_BG = {
  spring: ["#b8c4ae", "#9dbbb0", "#82a3a1", "#e6d6b1"],
  summer: ["#b5bf9f", "#8eb3ad", "#67969e", "#dad1a6"],
  autumn: ["#cebe99", "#b2ba9a", "#859f9b", "#e6cfa0"],
  winter: ["#cfd5ce", "#abbec4", "#8aa2b1", "#dedcce"],
};

export function createMapV2(world, stage, callbacks = {}) {
  const {
    onSelectCity,
    onSelectArmy,
    onDragDispatch,
    onPreviewDispatch,
    onHover,
  } = callbacks;

  const canvas = stage.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const markerLayer = stage.querySelector(".v2-marker-layer");
  const [width, height] = world.view;
  const center = [width / 2, height / 2];

  const cityPositions = new Map(world.cities.map((c) => [c.key, c.position]));
  const cityByKey = new Map(world.cities.map((c) => [c.key, c]));

  // Compute tight map bounding span for auto framing
  const field = [0, 1].map((axis) => {
    const coords = world.cities.map((c) => c.position[axis]);
    const min = Math.min(...coords);
    const max = Math.max(...coords);
    return { center: (min + max) / 2, span: max - min + (axis === 0 ? 116 : 86) };
  });

  // Static terrain geometry
  const landPath = new Path2D(world.land);
  const coastPath = new Path2D(world.coast);
  const gridPath = new Path2D(world.graticule);
  const majorRivers = new Path2D(world.rivers.major);
  const minorRivers = new Path2D(world.rivers.minor);

  // Per-scenario city territory polygons
  const sceneZones = new Map(
    world.scenarios.map((era) => [
      era.year,
      Object.fromEntries(Object.entries(era.zones || {}).map(([k, d]) => [k, new Path2D(d)])),
    ]),
  );

  // Deduplicated undirected road edges
  const roadEdges = [];
  for (const c of world.cities) {
    for (const nb of c.links) {
      if (c.key < nb) roadEdges.push([c.key, nb, roadTerrain(c.key, nb)]);
    }
  }

  // Load relief map texture
  const relief = new Image();
  relief.addEventListener("load", () => draw());
  relief.src = "./assets/relief.webp";

  const camera = { zoom: 1, x: field[0].center, y: field[1].center };
  let cameraFrame = 0;
  let state = null;
  let selectedCity = null;
  let selectedArmyId = null;
  let overlayMode = "standard"; // "standard" | "supply" | "troops"

  // Live animations during/after advanceDekad
  let armyAnim = null; // { start, duration, fromMap: Map<id,[x,y]> }
  let fxList = []; // { kind, pos, color, text, start, duration }
  let fxFrame = 0;
  let pulseFrame = 0;

  // Pointer drag / pan / pinch / direct dispatch arrow
  const pointers = new Map();
  let panState = null;
  let dragOrder = null; // { pointerId, fromKey, startX, startY, active, snapKey, worldPt, preview }
  let suppressClickUntil = 0;

  // Reusable DOM pins inside markerLayer
  const cityPins = new Map();
  const armyPins = new Map();

  for (const c of world.cities) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "v2-city-pin";
    btn.dataset.city = c.key;
    btn.setAttribute("aria-label", c.name);
    btn.innerHTML = `<span class="v2-city-badge"><i class="v2-city-dot"></i><em class="v2-city-siege" hidden>围</em></span><span class="v2-city-label"><b>${c.name}</b><small class="v2-city-meta"></small></span><span class="v2-city-wall" hidden><i></i></span>`;

    btn.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || !state) return;
      if (state.cities[c.key]?.owner === state.player) {
        dragOrder = {
          pointerId: ev.pointerId,
          fromKey: c.key,
          startX: ev.clientX,
          startY: ev.clientY,
          active: false,
          snapKey: null,
          worldPt: c.position,
          preview: null,
        };
      }
    });

    btn.addEventListener("pointerenter", (ev) => {
      if (ev.pointerType === "mouse" && !dragOrder?.active && state) {
        onHover?.({ type: "city", key: c.key, x: ev.clientX, y: ev.clientY });
      }
    });
    btn.addEventListener("pointerleave", () => onHover?.(null));

    btn.addEventListener("click", (ev) => {
      if (performance.now() < suppressClickUntil) {
        ev.preventDefault();
        return;
      }
      onHover?.(null);
      onSelectCity?.(c.key);
    });

    markerLayer.append(btn);
    cityPins.set(c.key, {
      btn,
      dot: btn.querySelector(".v2-city-dot"),
      siegeTag: btn.querySelector(".v2-city-siege"),
      meta: btn.querySelector(".v2-city-meta"),
      wallWrap: btn.querySelector(".v2-city-wall"),
      wallBar: btn.querySelector(".v2-city-wall i"),
      label: btn.querySelector(".v2-city-label"),
    });
  }

  function fittedMap(rect) {
    let topInset = 0;
    let bottomInset = 0;
    if (typeof document !== "undefined" && rect.width <= 900) {
      const topbar = document.querySelector(".v2-topbar");
      if (topbar) {
        const tb = topbar.getBoundingClientRect();
        if (tb.height > 0 && tb.bottom > rect.top) {
          topInset = Math.min(rect.height * 0.28, Math.max(0, tb.bottom - rect.top) + 8);
        }
      }
      const insp = document.querySelector(".v2-inspector");
      if (insp) {
        const ib = insp.getBoundingClientRect();
        const visibleBottomCover = Math.max(0, rect.bottom - ib.top);
        bottomInset = clamp(visibleBottomCover + 10, 48, rect.height * 0.44);
      } else {
        bottomInset = 64;
      }
    }
    const availH = Math.max(180, rect.height - topInset - bottomInset);
    const scale = Math.min(rect.width / field[0].span, availH / field[1].span);
    if (rect.width <= 900) {
      const safeCenterY = topInset + availH * 0.49;
      return { scale, left: (rect.width - width * scale) / 2, top: safeCenterY - (height / 2) * scale };
    }
    const spaceBelow = Math.max(0, rect.height - field[1].span * scale) * 0.22;
    return { scale, left: (rect.width - width * scale) / 2, top: (rect.height - height * scale) / 2 - spaceBelow };
  }

  function toView([x, y]) {
    return [(x - camera.x) * camera.zoom + center[0], (y - camera.y) * camera.zoom + center[1]];
  }

  function viewToWorld([vx, vy]) {
    return [(vx - center[0]) / camera.zoom + camera.x, (vy - center[1]) / camera.zoom + camera.y];
  }

  function clientToView(clientX, clientY, rect, fit) {
    return [(clientX - rect.left - fit.left) / fit.scale, (clientY - rect.top - fit.top) / fit.scale];
  }

  function restrictCamera() {
    const xMargin = field[0].span / (2 * camera.zoom);
    const yMargin = field[1].span / (2 * camera.zoom);
    camera.x = clamp(camera.x, xMargin, width - xMargin);
    camera.y = clamp(camera.y, yMargin, height - yMargin);
  }

  function cancelCameraAnim() {
    if (cameraFrame) {
      cancelAnimationFrame(cameraFrame);
      cameraFrame = 0;
    }
  }

  function animateCamera(toZoom, toX, toY, duration = 260) {
    cancelCameraAnim();
    const z = clamp(toZoom, 1, 4.5);
    const xm = field[0].span / (2 * z);
    const ym = field[1].span / (2 * z);
    const tx = clamp(toX, xm, width - xm);
    const ty = clamp(toY, ym, height - ym);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || duration <= 0) {
      camera.zoom = z;
      camera.x = tx;
      camera.y = ty;
      draw();
      return;
    }
    const fz = camera.zoom;
    const fx = camera.x;
    const fy = camera.y;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      camera.zoom = fz + (z - fz) * e;
      camera.x = fx + (tx - fx) * e;
      camera.y = fy + (ty - fy) * e;
      restrictCamera();
      draw();
      if (p < 1) cameraFrame = requestAnimationFrame(step);
      else cameraFrame = 0;
    };
    cameraFrame = requestAnimationFrame(step);
  }

  function drawCurvedArrow(fromPos, toPos, color, { dashed = false, lineWidth = 2.4, alpha = 0.9 } = {}) {
    if (!fromPos || !toPos) return;
    const z = camera.zoom;
    const mx = (fromPos[0] + toPos[0]) * 0.5;
    const my = (fromPos[1] + toPos[1]) * 0.5 - 12 / z;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (dashed) ctx.setLineDash([4.5 / z, 3.5 / z]);
    ctx.beginPath();
    ctx.moveTo(fromPos[0], fromPos[1]);
    ctx.quadraticCurveTo(mx, my, toPos[0], toPos[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth / z;
    ctx.stroke();

    ctx.setLineDash([]);
    const ang = Math.atan2(toPos[1] - my, toPos[0] - mx);
    const head = 6 / z;
    ctx.beginPath();
    ctx.moveTo(toPos[0], toPos[1]);
    ctx.lineTo(toPos[0] - head * Math.cos(ang - 0.45), toPos[1] - head * Math.sin(ang - 0.45));
    ctx.lineTo(toPos[0] - head * Math.cos(ang + 0.45), toPos[1] - head * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function interpolatedArmyPos(army) {
    const targetPos = armyWorldPosition(world, army);
    if (!armyAnim) return targetPos;
    const t = clamp((performance.now() - armyAnim.start) / armyAnim.duration, 0, 1);
    const e = 1 - Math.pow(1 - t, 2.2);
    const prev = armyAnim.fromMap.get(army.id) || army.lastPos || targetPos;
    return [prev[0] + (targetPos[0] - prev[0]) * e, prev[1] + (targetPos[1] - prev[1]) * e];
  }

  function syncArmyPins(rect, fit) {
    if (!state) return;
    const activeIds = new Set();
    const placedBoxes = [];
    for (const army of state.armies || []) {
      if (army.troops <= 0) continue;
      activeIds.add(army.id);
      let pin = armyPins.get(army.id);
      if (!pin) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "v2-army-pin";
        btn.dataset.armyId = army.id;
        btn.innerHTML = `<span class="v2-army-icon"></span><span class="v2-army-text"></span><em class="v2-army-supply" hidden title="粮道中断">⚡</em>`;
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onHover?.(null);
          onSelectArmy?.(army.id);
        });
        btn.addEventListener("pointerenter", (ev) => {
          if (ev.pointerType === "mouse") onHover?.({ type: "army", armyId: army.id, x: ev.clientX, y: ev.clientY });
        });
        btn.addEventListener("pointerleave", () => onHover?.(null));
        markerLayer.append(btn);
        pin = {
          btn,
          icon: btn.querySelector(".v2-army-icon"),
          text: btn.querySelector(".v2-army-text"),
          supply: btn.querySelector(".v2-army-supply"),
        };
        armyPins.set(army.id, pin);
      }

      const off = state.officers[army.officer];
      const spec = TROOP_TYPES[army.troopType] || TROOP_TYPES.infantry;
      const surname = off?.name ? [...off.name][0] : "军";
      pin.icon.textContent = spec.icon;
      const troopsK = army.troops >= 1000 ? `${(army.troops / 1000).toFixed(1)}k` : String(army.troops);
      pin.text.textContent = `${surname} ${troopsK}`;
      pin.supply.hidden = !army.supplyCut;
      pin.btn.style.setProperty("--force", factionColor(army.faction));
      pin.btn.dataset.stance = army.stance;
      pin.btn.dataset.selected = String(selectedArmyId === army.id);
      pin.btn.setAttribute("aria-label", `${off?.name || "军团"} ${spec.name} ${army.troops}人`);

      const [wx, wy] = interpolatedArmyPos(army);
      const [vx, vy] = toView([wx, wy]);
      let px = fit.left + vx * fit.scale;
      let py = fit.top + vy * fit.scale;
      // Nudge vertically if overlapping an already-placed army pin
      for (const [ox, oy] of placedBoxes) {
        if (Math.abs(px - ox) < 46 && Math.abs(py - oy) < 20) {
          py = oy + (py >= oy ? 21 : -21);
        }
      }
      const hidden = px < -20 || px > rect.width + 20 || py < -20 || py > rect.height + 20;
      pin.btn.hidden = hidden;
      if (!hidden) {
        placedBoxes.push([px, py]);
        pin.btn.style.left = `${px}px`;
        pin.btn.style.top = `${py}px`;
      }
    }

    for (const [id, pin] of armyPins.entries()) {
      if (!activeIds.has(id)) {
        pin.btn.remove();
        armyPins.delete(id);
      }
    }
  }

  function syncCityPins(rect, fit) {
    if (!state) return;
    const isH5 = rect.width <= 900;
    const placedLabels = [];
    const occupied = [];

    // First pass: position dots
    const entries = [];
    for (const c of world.cities) {
      const city = state.cities[c.key];
      const pin = cityPins.get(c.key);
      if (!city || !pin) continue;

      const [vx, vy] = toView(c.position);
      const px = fit.left + vx * fit.scale;
      const py = fit.top + vy * fit.scale;
      const outOfView = px < 6 || px > rect.width - 6 || py < 6 || py > rect.height - 6;
      pin.btn.hidden = outOfView;
      if (outOfView) continue;

      pin.btn.style.left = `${px}px`;
      pin.btn.style.top = `${py}px`;
      pin.dot.style.background = factionColor(city.owner);
      pin.btn.dataset.own = String(city.owner === state.player);
      pin.btn.dataset.active = String(selectedCity === c.key);

      const besieged = Boolean(state.sieges?.[c.key]);
      pin.siegeTag.hidden = !besieged;
      pin.btn.dataset.besieged = String(besieged);

      if (besieged) {
        pin.wallWrap.hidden = false;
        const pct = Math.max(4, Math.round((city.wall / Math.max(1, city.wallMax)) * 100));
        pin.wallBar.style.width = `${pct}%`;
      } else {
        pin.wallWrap.hidden = true;
      }

      // Meta pill: troop type + troop number + trap badge
      const tSpec = TROOP_TYPES[city.troopType] || TROOP_TYPES.infantry;
      const trapIcon = city.trap && DEFENSE_TRAPS[city.trap.id] ? DEFENSE_TRAPS[city.trap.id].icon : "";
      const kText = city.troops >= 1000 ? `${(city.troops / 1000).toFixed(1)}k` : String(city.troops);
      if (overlayMode === "troops" || selectedCity === c.key || besieged || camera.zoom >= 1.38) {
        pin.meta.textContent = `${trapIcon}${tSpec.icon}${kText}`;
      } else {
        pin.meta.textContent = trapIcon || "";
      }

      occupied.push([px - 6, py - 6, px + 6, py + 6]);
      entries.push({ c, city, pin, px, py, besieged });
    }

    // Label placement priority: selected > besieged > player border > player > rival
    entries.sort((a, b) => {
      const p = (it) => (it.c.key === selectedCity ? 10 : it.besieged ? 8 : it.city.owner === state.player ? 5 : 1);
      return p(b) - p(a);
    });

    const boxOverlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    for (const item of entries) {
      const { c, pin, px, py } = item;
      const w = c.name.length * (isH5 ? 10.5 : 11.5) + (pin.meta.textContent ? 28 : 8);
      const candidates = [
        ["right", [px + 9, py - 9, px + 9 + w, py + 9]],
        ["left", [px - 9 - w, py - 9, px - 9, py + 9]],
        ["bottom", [px - w / 2, py + 9, px + w / 2, py + 26]],
        ["top", [px - w / 2, py - 26, px + w / 2, py - 9]],
      ];
      const chosen = candidates.find(([, box]) => (
        box[0] >= 2 && box[2] <= rect.width - 2 && box[1] >= 4 && box[3] <= rect.height - 4
        && !occupied.some((ob) => boxOverlap(ob, box))
        && !placedLabels.some((ob) => boxOverlap(ob, box))
      ));
      if (chosen) {
        pin.label.hidden = false;
        pin.btn.dataset.side = chosen[0];
        placedLabels.push(chosen[1]);
      } else {
        // Always keep selected or besieged city label visible
        pin.label.hidden = !(c.key === selectedCity || item.besieged);
        pin.btn.dataset.side = "right";
      }
    }
  }

  function draw() {
    if (!state) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(rect.width * ratio);
    const ph = Math.round(rect.height * ratio);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;

    const fit = fittedMap(rect);
    const seasonKey = state.weather?.key === "snow" ? "winter"
      : ["rain", "flood", "wind"].includes(state.weather?.key)
        ? (Math.floor((state.turn % 36) / 9) === 1 ? "summer" : Math.floor((state.turn % 36) / 9) === 2 ? "autumn" : "spring")
        : ["spring", "summer", "autumn", "winter"][Math.floor((state.turn % 36) / 9)];
    const pal = SEASON_BG[seasonKey] || SEASON_BG.spring;

    ctx.resetTransform();
    const bgGrad = ctx.createLinearGradient(0, 0, pw, ph);
    bgGrad.addColorStop(0, pal[0]);
    bgGrad.addColorStop(0.55, pal[1]);
    bgGrad.addColorStop(1, pal[2]);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, pw, ph);

    ctx.save();
    ctx.setTransform(fit.scale * ratio, 0, 0, fit.scale * ratio, fit.left * ratio, fit.top * ratio);
    ctx.translate(...center);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Land & Graticule
    ctx.fillStyle = pal[3];
    ctx.fill(landPath, "evenodd");
    ctx.strokeStyle = "rgba(110, 128, 112, 0.28)";
    ctx.lineWidth = 0.65;
    ctx.stroke(gridPath);

    // Live per-city territory ownership shading
    const zones = sceneZones.get(state.year) || {};
    for (const c of world.cities) {
      const zPath = zones[c.key];
      const owner = state.cities[c.key]?.owner;
      if (!zPath || !owner) continue;
      ctx.save();
      ctx.globalAlpha = owner === state.player ? 0.56 : 0.39;
      ctx.fillStyle = factionColor(owner);
      ctx.fill(zPath, "evenodd");
      ctx.globalAlpha = owner === state.player ? 0.72 : 0.42;
      ctx.strokeStyle = factionColor(owner);
      ctx.lineWidth = owner === state.player ? 1.15 : 0.65;
      ctx.stroke(zPath);
      ctx.restore();
    }

    // Terrain relief overlay
    if (relief.naturalWidth) {
      ctx.save();
      ctx.clip(landPath, "evenodd");
      ctx.globalAlpha = 0.76;
      ctx.drawImage(relief, 0, 0, width, height);
      ctx.restore();
    }

    // Coastline & rivers
    ctx.strokeStyle = "rgba(92, 102, 82, 0.85)";
    ctx.lineWidth = 0.9;
    ctx.stroke(coastPath);
    ctx.strokeStyle = "rgba(74, 116, 114, 0.55)";
    ctx.lineWidth = 0.75;
    ctx.stroke(minorRivers);
    ctx.strokeStyle = state.weather?.key === "flood" ? "rgba(56, 120, 146, 0.88)" : "rgba(70, 114, 112, 0.78)";
    ctx.lineWidth = state.weather?.key === "flood" ? 1.65 : 1.2;
    ctx.stroke(majorRivers);

    // Road network with terrain coloring
    const z = camera.zoom;
    for (const [a, b, ter] of roadEdges) {
      const pa = cityPositions.get(a);
      const pb = cityPositions.get(b);
      if (!pa || !pb) continue;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      if (ter === "river") {
        ctx.setLineDash([3.2 / z, 2.5 / z]);
        ctx.strokeStyle = state.weather?.key === "flood" ? "rgba(62, 145, 198, 0.85)" : "rgba(62, 126, 152, 0.62)";
        ctx.lineWidth = 1.4 / z;
      } else if (ter === "pass") {
        ctx.strokeStyle = "rgba(154, 96, 44, 0.65)";
        ctx.lineWidth = 1.55 / z;
      } else {
        ctx.strokeStyle = "rgba(112, 92, 62, 0.34)";
        ctx.lineWidth = 0.9 / z;
      }
      ctx.stroke();
      ctx.restore();
    }

    // Selected city neighbor links highlight
    if (selectedCity && cityByKey.has(selectedCity)) {
      const sc = cityByKey.get(selectedCity);
      const sp = cityPositions.get(selectedCity);
      for (const nb of sc.links) {
        const np = cityPositions.get(nb);
        if (!np) continue;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sp[0], sp[1]);
        ctx.lineTo(np[0], np[1]);
        ctx.strokeStyle = "rgba(232, 192, 94, 0.72)";
        ctx.lineWidth = 2.0 / z;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Supply lines overlay (when supply mode is active OR selected army)
    for (const army of state.armies || []) {
      if (army.troops <= 0) continue;
      const showSupply = overlayMode === "supply" || selectedArmyId === army.id;
      if (showSupply && (army.faction === state.player || selectedArmyId === army.id)) {
        const depotPos = cityPositions.get(army.depot);
        const armyPos = interpolatedArmyPos(army);
        if (depotPos && armyPos) {
          ctx.save();
          ctx.setLineDash([4 / z, 3 / z]);
          ctx.beginPath();
          ctx.moveTo(depotPos[0], depotPos[1]);
          ctx.lineTo(armyPos[0], armyPos[1]);
          ctx.strokeStyle = army.supplyCut ? "rgba(220, 62, 54, 0.9)" : "rgba(224, 186, 86, 0.82)";
          ctx.lineWidth = 1.8 / z;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw army route arrow to targetCity
      if (army.stance !== "besiege") {
        const curPos = interpolatedArmyPos(army);
        const toPos = cityPositions.get(army.to);
        const col = army.stance === "reinforce" ? "#4ea8de"
          : army.stance === "retreat" ? "#a69c88"
            : army.faction === state.player ? "#f0a942" : "#e35b49";
        drawCurvedArrow(curPos, toPos, col, { dashed: army.stance === "retreat", lineWidth: 2.0, alpha: 0.84 });
      }
    }

    // Threat radar arrows (marching incoming enemies & exposed border imbalances)
    const threats = computeThreats(world, state);
    const tPulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.005);
    for (const th of threats.slice(0, 6)) {
      if (th.kind === "marching") continue; // marching army already draws curved arrow
      const pa = cityPositions.get(th.from);
      const pb = cityPositions.get(th.to);
      if (pa && pb) {
        drawCurvedArrow(pa, pb, th.kind === "siege" ? "#ff5240" : "#e05344", {
          dashed: true,
          lineWidth: th.kind === "siege" ? 2.5 : 1.7,
          alpha: 0.38 + tPulse * 0.34,
        });
      }
    }

    // Siege rings around actively besieged cities
    const now = performance.now();
    for (const [ck] of Object.entries(state.sieges || {})) {
      const p = cityPositions.get(ck);
      if (!p) continue;
      const rPulse = 11 / z + ((now % 1400) / 1400) * (7 / z);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p[0], p[1], rPulse, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(226, 76, 52, 0.78)";
      ctx.lineWidth = 2.0 / z;
      ctx.stroke();
      ctx.restore();
    }

    // Combat floating particles & battle popups
    fxList = fxList.filter((fx) => now - fx.start < fx.duration);
    for (const fx of fxList) {
      if (!fx.pos) continue;
      const p = clamp((now - fx.start) / fx.duration, 0, 1);
      const [fxX, fxY] = fx.pos;
      ctx.save();
      const ringR = (5 + p * 22) / z;
      ctx.beginPath();
      ctx.arc(fxX, fxY, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = fx.color;
      ctx.globalAlpha = (1 - p) * 0.85;
      ctx.lineWidth = 2.4 / z;
      ctx.stroke();
      if (fx.text) {
        ctx.font = `700 ${Math.max(7.5, 9.5 / z)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#16120d";
        ctx.fillText(fx.text, fxX + 0.6 / z, fxY - (10 + p * 18) / z + 0.6 / z);
        ctx.fillStyle = fx.color;
        ctx.fillText(fx.text, fxX, fxY - (10 + p * 18) / z);
      }
      ctx.restore();
    }

    // Interactive Drag-to-March preview arrow
    if (dragOrder?.active && dragOrder.worldPt) {
      const fp = cityPositions.get(dragOrder.fromKey);
      const col = dragOrder.preview?.ok ? (dragOrder.preview.isFriendlyDest ? "#4ea8de" : "#f2af48") : "#9f9585";
      drawCurvedArrow(fp, dragOrder.worldPt, col, { dashed: !dragOrder.snapKey, lineWidth: 2.8, alpha: 0.95 });

      const label = dragOrder.preview?.label || `从「${cityByKey.get(dragOrder.fromKey)?.name}」拖往目标城池发兵`;
      ctx.save();
      ctx.font = `700 ${Math.max(7.5, 9.2 / z)}px sans-serif`;
      const tw = ctx.measureText(label).width + 12 / z;
      const th = 16 / z;
      const bx = clamp(dragOrder.worldPt[0], 45, width - 45);
      const by = clamp(dragOrder.worldPt[1] - 16 / z, 18, height - 18);
      ctx.fillStyle = "rgba(18, 15, 11, 0.92)";
      ctx.fillRect(bx - tw / 2, by - th / 2, tw, th);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.1 / z;
      ctx.strokeRect(bx - tw / 2, by - th / 2, tw, th);
      ctx.fillStyle = "#fbf2dc";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, bx, by);
      ctx.restore();
    }

    ctx.restore();

    syncCityPins(rect, fit);
    syncArmyPins(rect, fit);
  }

  function ensurePulseLoop() {
    if (pulseFrame) return;
    const loop = () => {
      if (!state) {
        pulseFrame = 0;
        return;
      }
      const hasSieges = Object.keys(state.sieges || {}).length > 0;
      const hasThreats = computeThreats(world, state).length > 0;
      const hasAnim = Boolean(armyAnim) || fxList.length > 0;
      if (armyAnim && performance.now() - armyAnim.start >= armyAnim.duration) {
        armyAnim = null;
      }
      draw();
      if (hasSieges || hasThreats || hasAnim) {
        pulseFrame = requestAnimationFrame(loop);
      } else {
        pulseFrame = 0;
      }
    };
    pulseFrame = requestAnimationFrame(loop);
  }

  // Stage pointer interactions (pan & zoom)
  stage.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    cancelCameraAnim();
    onHover?.(null);
    const rect = stage.getBoundingClientRect();
    const fit = fittedMap(rect);
    const anchorView = clientToView(ev.clientX, ev.clientY, rect, fit);
    const anchorWorld = viewToWorld(anchorView);
    const nextZoom = clamp(camera.zoom * Math.exp(-ev.deltaY * (ev.deltaMode === 0 ? 0.0015 : 0.022)), 1, 4.5);
    camera.zoom = nextZoom;
    camera.x = anchorWorld[0] - (anchorView[0] - center[0]) / nextZoom;
    camera.y = anchorWorld[1] - (anchorView[1] - center[1]) / nextZoom;
    restrictCamera();
    draw();
  }, { passive: false });

  stage.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".v2-city-pin, .v2-army-pin, button")) return;
    pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pointers.size === 1) {
      cancelCameraAnim();
      panState = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, cx: camera.x, cy: camera.y, moved: false };
    } else if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      panState = {
        pinch: true,
        dist: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]),
        zoom: camera.zoom,
      };
    }
  });

  window.addEventListener("pointermove", (ev) => {
    // Direct drag-to-march from player city
    if (dragOrder && ev.pointerId === dragOrder.pointerId) {
      const dPx = Math.hypot(ev.clientX - dragOrder.startX, ev.clientY - dragOrder.startY);
      if (!dragOrder.active) {
        if (dPx < 14) return;
        dragOrder.active = true;
        onHover?.(null);
      }
      if (ev.cancelable) ev.preventDefault();
      const rect = stage.getBoundingClientRect();
      const fit = fittedMap(rect);
      const vp = clientToView(ev.clientX, ev.clientY, rect, fit);
      const wp = viewToWorld(vp);

      let bestKey = null;
      let bestPx = 40;
      for (const c of world.cities) {
        if (c.key === dragOrder.fromKey) continue;
        const cv = toView(c.position);
        const dist = Math.hypot((cv[0] - vp[0]) * fit.scale, (cv[1] - vp[1]) * fit.scale);
        if (dist <= bestPx) {
          bestPx = dist;
          bestKey = c.key;
        }
      }
      if (bestKey !== dragOrder.snapKey) {
        dragOrder.snapKey = bestKey;
        dragOrder.preview = bestKey ? onPreviewDispatch?.(dragOrder.fromKey, bestKey) || null : null;
      }
      dragOrder.worldPt = bestKey ? cityPositions.get(bestKey) : wp;
      draw();
      return;
    }

    if (pointers.has(ev.pointerId)) {
      pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      const rect = stage.getBoundingClientRect();
      const fit = fittedMap(rect);
      if (pointers.size === 2 && panState?.pinch) {
        const [p1, p2] = [...pointers.values()];
        const dist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
        if (panState.dist > 5) {
          camera.zoom = clamp(panState.zoom * (dist / panState.dist), 1, 4.5);
          restrictCamera();
          draw();
        }
      } else if (panState && !panState.pinch && ev.pointerId === panState.id) {
        const dx = ev.clientX - panState.x;
        const dy = ev.clientY - panState.y;
        if (Math.hypot(dx, dy) > 4) panState.moved = true;
        const scalePx = fit.scale * camera.zoom;
        camera.x = panState.cx - dx / scalePx;
        camera.y = panState.cy - dy / scalePx;
        restrictCamera();
        draw();
      }
    }
  }, { passive: false });

  const endPointer = (ev) => {
    if (dragOrder && ev.pointerId === dragOrder.pointerId) {
      const fin = dragOrder;
      dragOrder = null;
      if (fin.active) {
        suppressClickUntil = performance.now() + 260;
        if (fin.snapKey && fin.preview?.ok) {
          onDragDispatch?.(fin.fromKey, fin.snapKey);
        }
        draw();
      }
    }
    pointers.delete(ev.pointerId);
    if (pointers.size === 0) panState = null;
  };
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  window.addEventListener("resize", () => draw());

  return {
    render(nextState, { city, armyId, overlay } = {}) {
      state = nextState;
      if (city !== undefined) selectedCity = city;
      if (armyId !== undefined) selectedArmyId = armyId;
      if (overlay !== undefined) overlayMode = overlay;
      ensurePulseLoop();
      draw();
    },
    playTurnAnimation(prevState, nextState, events = []) {
      state = nextState;
      const fromMap = new Map();
      for (const a of prevState?.armies || []) {
        fromMap.set(a.id, armyWorldPosition(world, a));
      }
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches && nextState.armies.length) {
        armyAnim = { start: performance.now(), duration: 680, fromMap };
      }

      const now = performance.now();
      for (const ev of events) {
        if (!ev.pos) continue;
        if (ev.kind === "field_battle") {
          fxList.push({ pos: ev.pos, color: "#ffd166", text: `野战 -${ev.loserLoss}`, start: now, duration: 1550 });
        } else if (ev.kind === "capture") {
          fxList.push({ pos: ev.pos, color: "#76f2a2", text: "🚩 破城易帜!", start: now, duration: 1900 });
        } else if (ev.kind === "trap") {
          fxList.push({ pos: ev.pos, color: "#ff7847", text: "🔥 伏兵陷阱!", start: now, duration: 1650 });
        } else if (ev.kind === "siege_tick") {
          fxList.push({ pos: ev.pos, color: "#ff9b54", text: `城防 -${ev.wallDmg}`, start: now, duration: 1350 });
        } else if (ev.kind === "supply_cut") {
          fxList.push({ pos: ev.pos, color: "#ff5c5c", text: "⚡ 断粮危机!", start: now, duration: 1600 });
        }
      }

      // Gently pan toward highest-priority player event if zoomed in
      const focusEv = events.find((e) => e.pos && ["capture", "field_battle", "trap", "siege_start"].includes(e.kind)
        && (e.faction === nextState.player || e.participants?.includes(nextState.player)));
      if (focusEv && camera.zoom > 1.35) {
        animateCamera(camera.zoom, focusEv.pos[0], focusEv.pos[1], 320);
      }
      ensurePulseLoop();
      draw();
    },
    fitAll() {
      animateCamera(1, field[0].center, field[1].center, 260);
    },
    zoomBy(factor) {
      animateCamera(camera.zoom * factor, camera.x, camera.y, 180);
    },
    focusCity(cityKey, zoom = 1.95) {
      const p = cityPositions.get(cityKey);
      if (p) animateCamera(Math.max(zoom, camera.zoom), p[0], p[1], 280);
    },
    setOverlay(mode) {
      overlayMode = mode;
      draw();
    },
    destroy() {
      cancelCameraAnim();
      if (pulseFrame) cancelAnimationFrame(pulseFrame);
      if (fxFrame) cancelAnimationFrame(fxFrame);
    },
  };
}
