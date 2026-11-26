// v18.0 — 烽火迷雾 & 细作暗战（可选开关）
// 状态挂在 state.saga.espionage 与 state.saga.options.fogOfWar 下。

export const ESPIONAGE_ACTIONS = [
  {
    id: "scout_intel",
    name: "遣斥候侦察",
    costTreasury: 20,
    summary: "揭开目标城池及周边 1 程战争迷雾（持续 4 季），摸清兵力与驻将。",
  },
  {
    id: "spread_rumor",
    name: "散布流言",
    costTreasury: 35,
    summary: "动摇敌城民心与士气（敌方士气 -7），并使其未来 2 季产粮与守备下降。",
  },
  {
    id: "forge_letter",
    name: "伪造密信",
    costTreasury: 45,
    summary: "离间敌方调防，令目标城守军混乱 2 季（防战 -16%，兵力小幅折损）。",
  },
  {
    id: "plant_insider",
    name: "策反内应",
    costTreasury: 65,
    summary: "在敌城埋伏内应（持续 3 季），我军下次攻城时城防直降 35% 并触发内应接应！",
  },
];

export function isFogOfWarEnabled(state) {
  return Boolean(state?.century && state?.saga?.options?.fogOfWar);
}

export function setFogOfWar(state, enabled) {
  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  if (!next.saga.options) next.saga.options = {};
  next.saga.options.fogOfWar = Boolean(enabled);
  return next;
}

function ensureEspionage(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.espionage || typeof state.saga.espionage !== "object") {
    state.saga.espionage = { scoutedUntil: {}, confusedUntil: {}, insidersUntil: {} };
  }
  if (!state.saga.espionage.scoutedUntil) state.saga.espionage.scoutedUntil = {};
  if (!state.saga.espionage.confusedUntil) state.saga.espionage.confusedUntil = {};
  if (!state.saga.espionage.insidersUntil) state.saga.espionage.insidersUntil = {};
  return state.saga.espionage;
}

function buildAdjacency(world) {
  const adj = new Map();
  for (const c of world?.cities || []) {
    adj.set(c.key, Array.isArray(c.links) ? [...c.links] : []);
  }
  for (const [a, b] of world?.roads || []) {
    if (adj.has(a) && !adj.get(a).includes(b)) adj.get(a).push(b);
    if (adj.has(b) && !adj.get(b).includes(a)) adj.get(b).push(a);
  }
  return adj;
}

/**
 * 计算单城对玩家的视野级别：
 * - "visible"：己方城、直接相邻城、盟友城、或有内应城（全情报可见）
 * - "scouted"：2 程内或斥候侦察期内（可见兵力与主将）
 * - "fogged"：远方未侦察敌城（仅见模糊兵力区间，隐藏驻将）
 */
export function cityVisibility(world, state, cityKey) {
  if (!isFogOfWarEnabled(state)) return "visible";
  const city = state?.cities?.[cityKey];
  if (!city) return "fogged";
  const player = state.player;
  if (city.owner === player) return "visible";

  // 盟友城池视野共享
  const allied = (state.treaties || []).some(
    (t) => t.kind === "alliance" && (t.expires ?? 0) >= (state.turn ?? 0) && t.sides?.includes(player) && t.sides?.includes(city.owner),
  );
  if (allied) return "visible";

  const esp = state.saga?.espionage || {};
  if ((esp.insidersUntil?.[cityKey] ?? 0) > (state.turn ?? 0)) return "visible";
  if ((esp.scoutedUntil?.[cityKey] ?? 0) > (state.turn ?? 0)) return "scouted";

  const adj = buildAdjacency(world);
  const owned = new Set(Object.entries(state.cities || {}).filter(([, c]) => c.owner === player).map(([k]) => k));
  for (const n1 of adj.get(cityKey) || []) {
    if (owned.has(n1)) return "visible";
  }
  for (const n1 of adj.get(cityKey) || []) {
    for (const n2 of adj.get(n1) || []) {
      if (owned.has(n2)) return "scouted";
    }
  }
  return "fogged";
}

/**
 * 在迷雾下给出确定性的模糊兵力区间文案（避免每帧跳动）
 */
export function maskedTroopRange(cityKey, troops) {
  const base = Math.max(1000, Math.round(troops / 1000) * 1000);
  const lo = Math.max(500, Math.floor((base * 0.72) / 500) * 500);
  const hi = Math.ceil((base * 1.32) / 500) * 500;
  const fmt = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : `${(n / 1000).toFixed(1)}千`);
  return `约 ${fmt(lo)}–${fmt(hi)}`;
}

export function hasInsider(state, cityKey) {
  return Boolean(state?.century && (state?.saga?.espionage?.insidersUntil?.[cityKey] ?? 0) > (state.turn ?? 0));
}

export function isConfusedByEspionage(state, cityKey) {
  return Boolean(state?.century && (state?.saga?.espionage?.confusedUntil?.[cityKey] ?? 0) > (state.turn ?? 0));
}

/**
 * 细作暗战对战斗的修正（内应开城 / 密信混乱）
 */
export function espionageCombatModifiers(state, targetCityKey) {
  if (!state?.century || !targetCityKey) return { defenseMult: 1, wallFactor: 1, insider: false, confused: false, label: "" };
  const insider = hasInsider(state, targetCityKey);
  const confused = isConfusedByEspionage(state, targetCityKey);
  let defenseMult = 1;
  let wallFactor = 1;
  const tags = [];
  if (insider) {
    wallFactor *= 0.65;
    defenseMult *= 0.85;
    tags.push("内应开城");
  }
  if (confused) {
    defenseMult *= 0.84;
    tags.push("密信乱军");
  }
  return {
    defenseMult: Number(defenseMult.toFixed(3)),
    wallFactor: Number(wallFactor.toFixed(3)),
    insider,
    confused,
    label: tags.join(" · "),
  };
}

/**
 * 执行细作暗战指令
 */
export function executeEspionageAction(world, state, actionId, targetCityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用细作暗战。" };
  const def = ESPIONAGE_ACTIONS.find((a) => a.id === actionId);
  if (!def) return { ok: false, reason: "未知的细作行动。" };
  const target = state.cities?.[targetCityKey];
  if (!target || target.owner === actor) return { ok: false, reason: "请选择敌方城池执行细作行动。" };

  const faction = state.factions?.[actor];
  if (!faction || faction.treasury < def.costTreasury) {
    return { ok: false, reason: `「${def.name}」需军费金 ${def.costTreasury}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= def.costTreasury;
  const esp = ensureEspionage(next);
  const turn = next.turn ?? 1;
  const cname = world?.cities?.find((c) => c.key === targetCityKey)?.name || targetCityKey;

  if (actionId === "scout_intel") {
    esp.scoutedUntil[targetCityKey] = turn + 4;
    const adj = buildAdjacency(world);
    for (const nb of adj.get(targetCityKey) || []) {
      esp.scoutedUntil[nb] = Math.max(esp.scoutedUntil[nb] ?? 0, turn + 4);
    }
    return { ok: true, state: next, summary: `斥候已潜入${cname}及周边诸城，未来 4 季虚实尽在掌握。` };
  }

  if (actionId === "spread_rumor") {
    if (next.factions[target.owner]) {
      next.factions[target.owner].morale = Math.max(25, (next.factions[target.owner].morale ?? 75) - 7);
    }
    if (!next.saga.rumors) next.saga.rumors = {};
    next.saga.rumors[targetCityKey] = turn + 2;
    next.cities[targetCityKey].defense = Math.max(8, (next.cities[targetCityKey].defense ?? 20) - 2);
    return { ok: true, state: next, summary: `细作在${cname}遍布流言！敌军士气 -7、城防 -2，守心大乱。` };
  }

  if (actionId === "forge_letter") {
    esp.confusedUntil[targetCityKey] = turn + 2;
    const loss = Math.min(1200, Math.floor(next.cities[targetCityKey].troops * 0.06));
    next.cities[targetCityKey].troops = Math.max(800, next.cities[targetCityKey].troops - loss);
    return { ok: true, state: next, summary: `伪造密信离间${cname}守将成功！敌军混乱 2 季（防战 -16%），内耗折损 ${loss} 人。` };
  }

  if (actionId === "plant_insider") {
    esp.insidersUntil[targetCityKey] = turn + 3;
    esp.scoutedUntil[targetCityKey] = Math.max(esp.scoutedUntil[targetCityKey] ?? 0, turn + 3);
    return { ok: true, state: next, summary: `已在${cname}重金买通内应！3 季内攻城将直破城防 35% 并触发内应接应。` };
  }

  return { ok: false, reason: "未处理的细作指令。" };
}

/**
 * 季度清理过期细作状态
 */
export function settleEspionageTurn(state) {
  if (!state?.century || !state?.saga?.espionage) return state;
  const next = structuredClone(state);
  const esp = ensureEspionage(next);
  const turn = next.turn ?? 0;
  for (const map of [esp.scoutedUntil, esp.confusedUntil, esp.insidersUntil]) {
    for (const [k, until] of Object.entries(map)) {
      if (until <= turn || next.cities?.[k]?.owner === next.player) delete map[k];
    }
  }
  return next;
}
