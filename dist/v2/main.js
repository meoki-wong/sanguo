// 经略三国 2.0 — 入口与旬制主循环编排

import { TROOP_TYPES } from "./constants.js";
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

function saveAutosave(state) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeStateV2(state));
  } catch {
    // Ignore storage limits
  }
}

async function boot() {
  const response = await fetch("./assets/world.json");
  const rawWorld = await response.json();
  const world = enrichWorld(rawWorld);
  const sound = createSoundController();

  let state = loadAutosave(world);
  let advancingBatch = false;
  const $ = (id) => document.getElementById(id);

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
        tooltip.innerHTML = `<strong>${cityNameV2(world, info.key)}</strong>（${factionNameV2(world, state, c.owner)}）<br>${sp.icon} ${sp.name} ${c.troops.toLocaleString()} · 城防 ${c.wall}/${c.wallMax}`;
      } else if (info.type === "army") {
        const a = state.armies.find((x) => x.id === info.armyId);
        if (!a) {
          tooltip.hidden = true;
          return;
        }
        const o = state.officers[a.officer];
        const sp = TROOP_TYPES[a.troopType] || TROOP_TYPES.infantry;
        const eta = armyEtaDekads(world, state, a);
        tooltip.innerHTML = `<strong>${o?.name || "军团"}所部</strong>（${factionNameV2(world, state, a.faction)}）<br>${sp.icon} ${a.troops.toLocaleString()} · ${a.stance === "besiege" ? `围攻${cityNameV2(world, a.targetCity)}` : `趋向${cityNameV2(world, a.targetCity)}(${eta}旬)`}`;
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
      setState(fresh);
      ui.renderAll();
    },
  });

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
    if (advancingBatch) return;
    stepOneDekad();
  });

  async function stepMonthBatch() {
    if (advancingBatch || state.outcome !== "ongoing") return;
    advancingBatch = true;
    $("advance-dekad").disabled = true;
    $("advance-month").disabled = true;
    try {
      for (let i = 0; i < 3; i += 1) {
        if (state.outcome !== "ongoing") break;
        const evs = stepOneDekad();
        const playerHot = evs.some((e) => (
          ["capture", "field_battle", "trap", "siege_start", "supply_cut"].includes(e.kind)
          && (e.faction === state.player || e.participants?.includes(state.player))
        ));
        if (playerHot || state.outcome !== "ongoing") {
          ui.showTicker(`⚠️ 遇重大军情自动暂停：${evs[0]?.text || "请主公定夺"}`);
          break;
        }
        if (i < 2) await new Promise((r) => setTimeout(r, 420));
      }
    } finally {
      advancingBatch = false;
      $("advance-dekad").disabled = false;
      $("advance-month").disabled = false;
    }
  }

  $("advance-month")?.addEventListener("click", stepMonthBatch);

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
        if (!advancingBatch) stepOneDekad();
      }
    } else if (k === "g") {
      ev.preventDefault();
      stepMonthBatch();
    } else if (k === "c") {
      ev.preventDefault();
      ui.openCourtDialog("officers");
    } else if (k === "d") {
      ev.preventDefault();
      ui.openCourtDialog("diplomacy");
    } else if (k === "l") {
      ev.preventDefault();
      ui.openCourtDialog("chronicle");
    } else if (k === "h") {
      ev.preventDefault();
      setImmersive(document.body.dataset.immersive !== "true");
    }
  });

  // Initial selection on player's capital / first city
  const firstPlayerCity = Object.values(state.cities).find((c) => c.owner === state.player)?.key || world.cities[0].key;
  ui.selectCity(firstPlayerCity, { expandMobile: false, focusMap: false });
}

boot();
