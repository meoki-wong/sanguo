// 经略三国 2.0 — 入口与旬制主循环编排

import { CITY_SPECIALTIES, TROOP_TYPES } from "./constants.js";
import {
  advanceDekad, armyEtaDekads, cityNameV2, computeThreats, createGameV2,
  deserializeStateV2, factionNameV2, forecastDispatch, serializeStateV2,
} from "./engine.js";
import { createMapV2 } from "./map.js";
import { createUiV2 } from "./ui.js";
import { enrichWorld } from "../personnel.js";
import { createSoundController } from "../sound.js";

const AUTOSAVE_KEY = "jinglue-sanguo:v2:autosave";

function loadAutosave(world) {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return deserializeStateV2(world, raw);
  } catch {
    // Fallback to clean start
  }
  return createGameV2(world, 199, "cao", { difficulty: "standard" });
}

let autosaveTimer = null;
function saveAutosave(state, immediate = false) {
  clearTimeout(autosaveTimer);
  const flush = () => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeStateV2(state));
    } catch {
      // Ignore storage limits
    }
  };
  if (immediate) {
    flush();
  } else {
    autosaveTimer = setTimeout(flush, 380);
  }
}

async function boot() {
  const response = await fetch("./assets/world.json");
  const rawWorld = await response.json();
  const world = enrichWorld(rawWorld);
  const sound = createSoundController();

  let state = loadAutosave(world);
  const SPEED_MODES = [
    { label: "1×", ms: 1100 },
    { label: "2×", ms: 550 },
    { label: "4×", ms: 280 },
  ];
  let speedIndex = 0;
  let flowing = false;
  let flowTimer = null;
  const $ = (id) => document.getElementById(id);

  window.addEventListener("beforeunload", () => saveAutosave(state, true));

  function setState(next) {
    state = next;
    saveAutosave(state);
    sound?.setBgmMood?.(computeThreats(world, state).some((t) => t.kind === "siege" || t.kind === "marching") ? "war" : "peace");
  }

  const tooltip = $("v2-tooltip");
  let ui = null;

  const mapApi = createMapV2(world, $("v2-stage"), {
    onSelectCity(key) {
      sound?.play?.("click");
      ui?.selectCity(key, { expandMobile: true, focusMap: false });
    },
    onSelectArmy(armyId) {
      sound?.play?.("click");
      ui?.selectArmy(armyId, false);
    },
    onSelectEdge(edgeKey, aKey, bKey) {
      sound?.play?.("click");
      ui?.selectEdge(edgeKey, aKey, bKey);
    },
    onPreviewDispatch(fromKey, toKey) {
      const city = state.cities[fromKey];
      if (!city) return null;
      const fc = forecastDispatch(world, state, {
        from: fromKey,
        to: toKey,
        troops: Math.max(300, Math.round((city.troops - 300) * 0.65)),
        troopType: city.troopType,
      });
      if (!fc.ok) return { ok: false, label: fc.reason };
      const counterTxt = fc.counter.label ? ` · ${fc.counter.label}` : "";
      return {
        ok: true,
        isFriendlyDest: fc.isFriendlyDest,
        label: `${cityNameV2(world, toKey)} · ${fc.dekads}旬抵达${counterTxt}`,
      };
    },
    onDragDispatch(fromKey, toKey) {
      ui?.handleDragDispatch(fromKey, toKey);
    },
    onHover(info) {
      if (!tooltip) return;
      if (!info) {
        tooltip.hidden = true;
        return;
      }
      if (info.type === "city") {
        const c = state.cities[info.key];
        const sp = TROOP_TYPES[c.troopType] || TROOP_TYPES.infantry;
        const spec = CITY_SPECIALTIES[c.specialty];
        tooltip.innerHTML = `<strong>${cityNameV2(world, info.key)}</strong>（${factionNameV2(world, state, c.owner)}）${spec ? `<br>${spec.icon} ${spec.name}` : ""}<br>${sp.icon} ${sp.name} ${c.troops.toLocaleString()} · 城防 ${c.wall}/${c.wallMax}`;
      } else if (info.type === "army") {
        const a = state.armies.find((x) => x.id === info.armyId);
        if (!a) {
          tooltip.hidden = true;
          return;
        }
        const o = state.officers[a.officer];
        const sp = TROOP_TYPES[a.troopType] || TROOP_TYPES.infantry;
        const eta = armyEtaDekads(world, state, a);
        const stTxt = a.stance === "besiege" ? `围攻${cityNameV2(world, a.targetCity)}`
          : a.stance === "engaged" ? `⚔️ 阵前绞杀(第${a.engageRounds || 1}合)`
            : `趋向${cityNameV2(world, a.targetCity)}(${eta}旬)`;
        tooltip.innerHTML = `<strong>${o?.name || "军团"}所部</strong>（${factionNameV2(world, state, a.faction)}）<br>${sp.icon} ${a.troops.toLocaleString()} · ${stTxt}`;
      }
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(window.innerWidth - 220, info.x + 14)}px`;
      tooltip.style.top = `${Math.min(window.innerHeight - 90, info.y + 14)}px`;
    },
  });

  ui = createUiV2({
    world,
    sound,
    getState: () => state,
    setState,
    mapApi,
    onNewGame(fresh) {
      stopFlow();
      setState(fresh);
      ui.renderAll();
    },
  });

  function syncFlowUi() {
    const flowBtn = $("toggle-flow");
    const spdBtn = $("cycle-speed");
    if (flowBtn) {
      flowBtn.textContent = flowing ? "⏸ 暂停" : "▶ 推演";
      flowBtn.dataset.flowing = String(flowing);
      flowBtn.setAttribute("aria-pressed", String(flowing));
    }
    if (spdBtn) {
      spdBtn.textContent = SPEED_MODES[speedIndex].label;
    }
  }

  function stopFlow(reasonText = "") {
    flowing = false;
    clearTimeout(flowTimer);
    flowTimer = null;
    syncFlowUi();
    if (reasonText) ui?.showTicker(reasonText);
  }

  function scheduleNextFlowTick(delayMs = SPEED_MODES[speedIndex].ms) {
    clearTimeout(flowTimer);
    if (!flowing || state.outcome !== "ongoing") return;
    flowTimer = setTimeout(() => {
      if (!flowing || state.outcome !== "ongoing") return;
      if (document.querySelector("dialog[open]")) {
        stopFlow();
        return;
      }
      const evs = stepOneDekad();
      const playerHot = evs.some((e) => (
        ["capture", "field_battle", "trap", "siege_start", "supply_cut"].includes(e.kind)
        && (e.faction === state.player || e.participants?.includes(state.player))
      ));
      if (state.outcome !== "ongoing") {
        stopFlow();
        return;
      }
      if (playerHot) {
        stopFlow(`⚠️ 军情紧急自动暂停：${evs[0]?.text || "请主公定夺"}`);
        return;
      }
      scheduleNextFlowTick();
    }, delayMs);
  }

  function setFlowing(on) {
    if (!on) {
      stopFlow();
      return;
    }
    if (state.outcome !== "ongoing" || document.querySelector("dialog[open]")) return;
    flowing = true;
    syncFlowUi();
    scheduleNextFlowTick(160);
  }

  function stepOneDekad() {
    if (state.outcome !== "ongoing") return [];
    const prev = state;
    const next = advanceDekad(world, state);
    setState(next);

    const evs = next.lastTurnEvents || [];
    const hasCapture = evs.some((e) => e.kind === "capture");
    const hasTrap = evs.some((e) => e.kind === "trap");
    const hasBattle = evs.some((e) => e.kind === "field_battle" || e.kind === "siege_tick" || e.kind === "siege_start");
    sound?.play?.(hasCapture ? "capture" : hasTrap ? "fire" : hasBattle ? "siege" : "turn");

    const topEv = evs.find((e) => e.kind === "capture")
      || evs.find((e) => e.kind === "trap" || e.kind === "field_battle")
      || evs.find((e) => e.kind === "siege_start" || e.kind === "supply_cut")
      || evs[0];
    if (topEv) ui.showTicker(topEv.text);

    ui.renderAll();
    mapApi.playTurnAnimation(prev, next, evs);
    return evs;
  }

  $("advance-dekad")?.addEventListener("click", () => {
    if (flowing) stopFlow();
    stepOneDekad();
  });

  $("toggle-flow")?.addEventListener("click", () => {
    setFlowing(!flowing);
  });

  $("cycle-speed")?.addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % SPEED_MODES.length;
    syncFlowUi();
    if (flowing) scheduleNextFlowTick();
  });

  for (const id of ["open-court", "open-log", "open-menu", "seal-btn"]) {
    $(id)?.addEventListener("click", () => {
      if (flowing) stopFlow();
    }, { capture: true });
  }

  function setImmersive(on) {
    document.body.dataset.immersive = String(Boolean(on));
    $("toggle-immersive")?.setAttribute("aria-pressed", String(Boolean(on)));
    $("exit-immersive").hidden = !on;
    requestAnimationFrame(() => mapApi.render(state));
  }

  $("toggle-immersive")?.addEventListener("click", () => setImmersive(document.body.dataset.immersive !== "true"));
  $("exit-immersive")?.addEventListener("click", () => setImmersive(false));

  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = (ev.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    if (ev.key === "Escape" && document.body.dataset.immersive === "true") {
      setImmersive(false);
      return;
    }
    const k = ev.key.toLowerCase();
    if (ev.key === " ") {
      if (!document.querySelector("dialog[open]")) {
        ev.preventDefault();
        setFlowing(!flowing);
      }
    } else if (k === "n") {
      if (!document.querySelector("dialog[open]")) {
        ev.preventDefault();
        if (flowing) stopFlow();
        stepOneDekad();
      }
    } else if (k === "g") {
      ev.preventDefault();
      speedIndex = (speedIndex + 1) % SPEED_MODES.length;
      syncFlowUi();
      if (flowing) scheduleNextFlowTick();
    } else if (k === "c") {
      ev.preventDefault();
      if (flowing) stopFlow();
      ui.openCourtDialog("officers");
    } else if (k === "d") {
      ev.preventDefault();
      if (flowing) stopFlow();
      ui.openCourtDialog("diplomacy");
    } else if (k === "l") {
      ev.preventDefault();
      if (flowing) stopFlow();
      ui.openCourtDialog("chronicle");
    } else if (k === "h") {
      ev.preventDefault();
      setImmersive(document.body.dataset.immersive !== "true");
    }
  });

  syncFlowUi();

  // Initial selection on player's capital / first city
  const firstPlayerCity = Object.values(state.cities).find((c) => c.owner === state.player)?.key || world.cities[0].key;
  ui.selectCity(firstPlayerCity, { expandMobile: false, focusMap: false });
}

boot();
