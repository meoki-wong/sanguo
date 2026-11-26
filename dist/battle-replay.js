import { renderBattleScene } from "./battle-scene.js";
import { cityName, eraByYear, factionName } from "./engine.js";
import { BATTLE_TACTICS } from "./tactics.js";
import { officerMeta } from "./traits.js";

const REPLAY_PREF_KEY = "jinglue-sanguo:battle-replay:v1";

function safeReadAutoPlay() {
  try {
    return localStorage.getItem(REPLAY_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

function safeWriteAutoPlay(on) {
  try {
    localStorage.setItem(REPLAY_PREF_KEY, on ? "on" : "off");
  } catch {
    // Ignore storage quota / privacy failures
  }
}

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

export function createBattleReplayController({ world, sound, forceColor, getState }) {
  const dialog = document.getElementById("battle-replay-dialog");
  let queue = [];
  let queueIdx = 0;
  let step = 0;
  let timer = null;
  let onComplete = null;
  let autoPlay = safeReadAutoPlay();

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function unitKindFor(officer, weatherTerrain) {
    const meta = officerMeta(officer);
    if (weatherTerrain === "river" || meta.traits.some((t) => t.id === "navy")) return "navy";
    if (meta.traits.some((t) => t.id === "cavalry")) return "cavalry";
    return "infantry";
  }

  function soundForTactic(tacticId, phase, captured) {
    if (!sound) return;
    if (phase === 0) sound.play("march");
    else if (phase === 1) {
      if (tacticId === "stratagem") sound.play("fire");
      else if (tacticId === "siege") sound.play("siege");
      else sound.play("order");
    } else if (captured) sound.play("victory");
  }

  function renderFrame() {
    if (!dialog || !queue.length) return;
    const item = queue[queueIdx];
    const state = getState();
    const era = eraByYear(world, state);
    const { entry, turn } = item;
    const { battle, city, type } = entry;
    const tacticId = battle.tactic || "assault";
    const tacticMeta = BATTLE_TACTICS[tacticId] || BATTLE_TACTICS.assault;
    const captured = type === "capture";
    const attFactionName = factionName(era, battle.attacker.faction);
    const defFactionName = factionName(era, battle.defender.faction);
    const attOfficer = era.officers.find((o) => o.key === battle.personnel?.attacker) || null;
    const defOfficer = era.officers.find((o) => o.key === battle.personnel?.defender) || null;
    const fromName = cityName(world, battle.from);
    const toName = cityName(world, city);
    const seasonNames = ["春", "夏", "秋", "冬"];
    const seasons = ["spring", "summer", "autumn", "winter"];
    const stepLabels = ["第一幕 · 陈兵出征", "第二幕 · 阵前交锋", "第三幕 · 胜负分晓"];

    document.getElementById("br-title").textContent = `${fromName} → ${toName}之战`;
    document.getElementById("br-subtitle").textContent = `第 ${Math.floor(Math.max(0, turn - 1) / 4) + 1} 年${seasonNames[Math.max(0, turn - 1) % 4]} · ${stepLabels[step]}${queue.length > 1 ? `（第 ${queueIdx + 1}/${queue.length} 战）` : ""}`;
    document.getElementById("br-tactic-badge").textContent = `军策：${tacticMeta.name}`;

    const stage = document.getElementById("br-stage");
    stage.dataset.vfx = step === 1 ? tacticId : (step === 2 && captured ? "victory" : "none");
    const attLossNow = step === 2 ? battle.attacker.casualties : step === 1 ? Math.round(battle.attacker.casualties * 0.45) : 0;
    const defLossNow = step === 2 ? battle.defender.casualties : step === 1 ? Math.round(battle.defender.casualties * 0.45) : 0;

    const { canvas } = renderBattleScene({
      terrain: battle.terrain || "land",
      site: toName,
      from: fromName,
      to: toName,
      siege: true,
      winner: captured ? battle.attacker.faction : battle.defender.faction,
      step,
      season: seasons[Math.max(0, turn - 1) % 4],
      century: Boolean(state?.century),
      sides: [
        {
          slot: 0,
          faction: battle.attacker.faction,
          color: forceColor(battle.attacker.faction),
          troops: battle.attacker.troops,
          loss: step === 2 ? battle.attacker.casualties : attLossNow,
          kind: unitKindFor(attOfficer, battle.terrain),
        },
        {
          slot: 1,
          faction: battle.defender.faction,
          color: forceColor(battle.defender.faction),
          troops: battle.defender.troops,
          loss: step === 2 ? battle.defender.casualties : defLossNow,
          kind: unitKindFor(defOfficer, battle.terrain),
        },
      ],
    });
    const canvasSlot = document.getElementById("br-canvas-slot");
    canvasSlot.replaceChildren(canvas);

    // Side cards
    const fillSide = (prefix, factionLabel, factionKey, off, stats, currentLoss, outcomeText) => {
      const meta = officerMeta(off);
      const sealEl = document.getElementById(`${prefix}-seal`);
      sealEl.textContent = meta.seal || (off?.name?.[0] ?? "军");
      sealEl.style.setProperty("--force", forceColor(factionKey));
      document.getElementById(`${prefix}-name`).textContent = `${factionLabel} · ${off?.name ?? "偏裨将"}`;
      document.getElementById(`${prefix}-troops`).textContent = step === 0
        ? `出阵 ${stats.troops.toLocaleString("zh-CN")} 兵 · 战力 ${stats.strength.toLocaleString("zh-CN")}`
        : `余兵 ${(stats.troops - currentLoss).toLocaleString("zh-CN")} / ${stats.troops.toLocaleString("zh-CN")}（折损 ${currentLoss.toLocaleString("zh-CN")}）`;
      const pct = Math.max(4, Math.round(((stats.troops - currentLoss) / Math.max(1, stats.troops)) * 100));
      const bar = document.getElementById(`${prefix}-bar`);
      bar.style.width = `${pct}%`;
      bar.style.setProperty("--force", forceColor(factionKey));
      document.getElementById(`${prefix}-tag`).textContent = outcomeText;
    };

    fillSide("br-att", attFactionName, battle.attacker.faction, attOfficer, battle.attacker, attLossNow,
      step < 2 ? tacticMeta.short : (captured ? "破城奏凯" : "攻城受挫"));
    fillSide("br-def", defFactionName, battle.defender.faction, defOfficer, battle.defender, defLossNow,
      step < 2 ? "据城守御" : (captured ? "城破退守" : "固守却敌"));

    const traitsWrap = document.getElementById("br-effects");
    const chips = [];
    for (const bName of battle.bonds?.attacker ?? []) chips.push(el("span", `攻方羁绊：${bName}`, "bond-badge"));
    for (const bName of battle.bonds?.defender ?? []) chips.push(el("span", `守方羁绊：${bName}`, "bond-badge"));
    for (const t of officerMeta(attOfficer).traits) chips.push(el("span", `攻将 · ${t.name}`, "trait-pill"));
    for (const t of officerMeta(defOfficer).traits) chips.push(el("span", `守将 · ${t.name}`, "trait-pill"));
    if (battle.captured) {
      const cap = el("span", `生擒敌将：${battle.captured.name}`, "bond-badge capture-badge");
      chips.unshift(cap);
    }
    traitsWrap.replaceChildren(...chips);

    document.getElementById("br-log").textContent = step === 0
      ? `${attFactionName}${attOfficer ? attOfficer.name : ""}自${fromName}起兵 ${battle.attacker.troops.toLocaleString("zh-CN")} 人，直指${toName}！`
      : step === 1
        ? `两军阵前展开「${tacticMeta.name}」：战力 ${battle.attacker.strength.toLocaleString("zh-CN")} 对 ${battle.defender.strength.toLocaleString("zh-CN")}！`
        : entry.text;

    const nextBtn = document.getElementById("br-next");
    nextBtn.textContent = step < 2 ? "下一幕 ›" : (queueIdx + 1 < queue.length ? "下一战 ›" : "阅毕收卷");

    soundForTactic(tacticId, step, captured);
  }

  function stepForward() {
    clearTimer();
    if (step < 2) {
      step += 1;
      renderFrame();
      scheduleAuto();
      return;
    }
    if (queueIdx + 1 < queue.length) {
      queueIdx += 1;
      step = 0;
      renderFrame();
      scheduleAuto();
      return;
    }
    close();
  }

  function scheduleAuto() {
    clearTimer();
    if (!dialog?.open) return;
    timer = setTimeout(() => {
      if (step < 2) stepForward();
    }, 1150);
  }

  function close() {
    clearTimer();
    if (dialog?.open) dialog.close();
    const cb = onComplete;
    onComplete = null;
    if (cb) cb();
  }

  function openEntries(items, done = null) {
    if (!dialog || !items?.length) {
      if (done) done();
      return false;
    }
    queue = items;
    queueIdx = 0;
    step = 0;
    onComplete = done;
    renderFrame();
    if (!dialog.open) dialog.showModal();
    scheduleAuto();
    return true;
  }

  function playTurnBattles(state, prevTurn, done = null) {
    if (!autoPlay) {
      if (done) done();
      return false;
    }
    const items = [];
    for (const report of state.history ?? []) {
      if (report.turn <= prevTurn) continue;
      for (const entry of report.entries ?? []) {
        if (!entry.battle) continue;
        if (entry.battle.attacker.faction !== state.player && entry.battle.defender.faction !== state.player) continue;
        items.push({ entry, turn: report.turn });
      }
    }
    if (!items.length) {
      if (done) done();
      return false;
    }
    return openEntries(items.slice(-4), done);
  }

  if (dialog) {
    document.getElementById("br-next")?.addEventListener("click", stepForward);
    document.getElementById("br-skip")?.addEventListener("click", close);
    dialog.addEventListener("cancel", () => {
      clearTimer();
      onComplete = null;
    });
  }

  const prefInput = document.getElementById("battle-replay-toggle");
  if (prefInput) {
    prefInput.checked = autoPlay;
    prefInput.addEventListener("change", () => {
      autoPlay = Boolean(prefInput.checked);
      safeWriteAutoPlay(autoPlay);
    });
  }

  return {
    openEntries,
    playTurnBattles,
    isAutoPlay: () => autoPlay,
    setAutoPlay(v) {
      autoPlay = Boolean(v);
      safeWriteAutoPlay(autoPlay);
      if (prefInput) prefInput.checked = autoPlay;
    },
  };
}
