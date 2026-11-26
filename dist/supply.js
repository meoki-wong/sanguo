// v18.0 — 粮道补给线 & 断粮围城战（兵马未动，粮草先行）
// 零外部依赖，所有状态挂在 state.saga.supply 下以兼容既有存档与非 century 模式。

function cloneState(state) {
  return structuredClone(state);
}

export function getSupplyState(state) {
  const s = state?.saga?.supply;
  return {
    cutUntil: s?.cutUntil && typeof s.cutUntil === "object" ? s.cutUntil : {},
    sieges: s?.sieges && typeof s.sieges === "object" ? s.sieges : {},
  };
}

function ensureSupplyState(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.supply || typeof state.saga.supply !== "object") {
    state.saga.supply = { cutUntil: {}, sieges: {} };
  }
  if (!state.saga.supply.cutUntil) state.saga.supply.cutUntil = {};
  if (!state.saga.supply.sieges) state.saga.supply.sieges = {};
  return state.saga.supply;
}

export function isSupplyCut(state, cityKey) {
  if (!state?.century || !cityKey) return false;
  const until = state?.saga?.supply?.cutUntil?.[cityKey] ?? 0;
  return until > (state.turn ?? 0);
}

export function activeSiegeOn(state, targetCityKey) {
  if (!state?.century || !targetCityKey) return null;
  const siege = state?.saga?.supply?.sieges?.[targetCityKey];
  if (!siege) return null;
  const target = state.cities?.[targetCityKey];
  const from = state.cities?.[siege.from];
  if (!target || !from || target.owner === siege.attacker || from.owner !== siege.attacker) return null;
  return siege;
}

/**
 * 构建城池邻接表
 */
function buildAdjacency(world) {
  const adj = new Map();
  for (const city of world?.cities || []) {
    adj.set(city.key, Array.isArray(city.links) ? [...city.links] : []);
  }
  for (const [a, b] of world?.roads || []) {
    if (adj.has(a) && !adj.get(a).includes(b)) adj.get(a).push(b);
    if (adj.has(b) && !adj.get(b).includes(a)) adj.get(b).push(a);
  }
  return adj;
}

/**
 * 找到某势力离某城最近的己方核心粮仓/都城补给跳数（BFS 沿己方控制道路）
 */
export function computeSupplyLine(world, state, factionId, fromCityKey, toCityKey = null) {
  if (!state?.century || !fromCityKey) {
    return {
      hops: 1,
      connected: true,
      cut: false,
      efficiency: 1,
      grainMult: 1,
      attackMult: 1,
      hubKey: fromCityKey || null,
      path: fromCityKey ? [fromCityKey] : [],
      label: "补给通畅",
    };
  }
  if (!world) {
    const cut = isSupplyCut(state, fromCityKey);
    return {
      hops: 1,
      connected: true,
      cut,
      efficiency: cut ? 0.62 : 1,
      grainMult: cut ? 1.65 : 1,
      attackMult: cut ? 0.78 : 1,
      hubKey: fromCityKey,
      path: toCityKey ? [fromCityKey, toCityKey] : [fromCityKey],
      label: cut ? "粮道被断" : "补给通畅",
    };
  }
  const adj = buildAdjacency(world);
  const owned = new Set(
    Object.entries(state.cities || {})
      .filter(([, c]) => c.owner === factionId)
      .map(([k]) => k),
  );
  if (!owned.has(fromCityKey)) {
    return {
      hops: 4,
      connected: false,
      efficiency: 0.68,
      grainMult: 1.55,
      attackMult: 0.84,
      hubKey: null,
      path: toCityKey ? [fromCityKey, toCityKey] : [fromCityKey],
      label: "孤军无援",
    };
  }

  // 补给枢纽：该势力人口/农业最高的重镇、建有粮仓转运站的城池、或首城
  const granaries = state.saga?.buildings?.cities || {};
  const hubs = [...owned].filter((k) => {
    const b = granaries[k];
    return Array.isArray(b?.slots) && b.slots.includes("granary");
  });
  let primaryHub = [...owned].sort((a, b) => (state.cities[b].farm + state.cities[b].troops / 2500) - (state.cities[a].farm + state.cities[a].troops / 2500))[0];
  if (primaryHub && !hubs.includes(primaryHub)) hubs.push(primaryHub);

  // BFS 从 hubs 出发寻找至 fromCityKey 的最短己方连通路径
  const dist = new Map();
  const prev = new Map();
  const queue = [];
  for (const h of hubs) {
    dist.set(h, 0);
    queue.push(h);
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === fromCityKey) break;
    for (const nxt of adj.get(cur) || []) {
      if (!owned.has(nxt) || dist.has(nxt)) continue;
      dist.set(nxt, dist.get(cur) + 1);
      prev.set(nxt, cur);
      queue.push(nxt);
    }
  }

  const connected = dist.has(fromCityKey);
  const rawHops = connected ? dist.get(fromCityKey) : 4;
  // 木牛流马工坊奇观减免远征粮耗
  const wonders = state.saga?.buildings?.wonders || {};
  const hasWoodenOx = Object.entries(wonders).some(([ck, wid]) => wid === "wooden_ox" && state.cities?.[ck]?.owner === factionId);
  const effectiveHops = Math.max(0, rawHops - (hasWoodenOx ? 1 : 0));

  const path = [];
  if (connected) {
    let cur = fromCityKey;
    while (cur !== undefined) {
      path.push(cur);
      cur = prev.get(cur);
    }
    path.reverse();
  } else {
    path.push(fromCityKey);
  }
  if (toCityKey && toCityKey !== fromCityKey) path.push(toCityKey);

  const cut = isSupplyCut(state, fromCityKey);
  let efficiency = 1;
  let grainMult = 1;
  let attackMult = 1;
  let label = "补给充沛";

  if (cut) {
    efficiency = 0.62;
    grainMult = 1.65;
    attackMult = 0.78;
    label = "粮道被断";
  } else if (!connected) {
    efficiency = 0.72;
    grainMult = 1.45;
    attackMult = 0.86;
    label = "孤城远征";
  } else if (effectiveHops <= 1) {
    efficiency = 1;
    grainMult = 1;
    attackMult = 1.03;
    label = "近畿畅通";
  } else if (effectiveHops === 2) {
    efficiency = 0.92;
    grainMult = 1.15;
    attackMult = 0.97;
    label = "二程转运";
  } else if (effectiveHops === 3) {
    efficiency = 0.82;
    grainMult = 1.32;
    attackMult = 0.92;
    label = "长途馈粮";
  } else {
    efficiency = 0.72;
    grainMult = 1.5;
    attackMult = 0.86;
    label = "千里转输";
  }

  if (hasWoodenOx && grainMult > 1) {
    grainMult = Number((1 + (grainMult - 1) * 0.65).toFixed(2));
  }

  return {
    hops: rawHops,
    connected,
    cut,
    efficiency,
    grainMult,
    attackMult,
    hubKey: path[0] || fromCityKey,
    path,
    label,
  };
}

/**
 * 战斗攻防补给/断粮/围城修正
 */
export function supplyCombatModifiers(world, state, { fromKey, toKey, attackerFaction, defenderFaction }) {
  if (!state?.century) {
    return {
      attackMult: 1,
      defenseMult: 1,
      grainMult: 1,
      wallFactor: 1,
      label: "",
      targetCut: false,
      siegeTurns: 0,
    };
  }
  const line = computeSupplyLine(world, state, attackerFaction, fromKey, toKey);
  const targetCut = isSupplyCut(state, toKey);
  const siege = activeSiegeOn(state, toKey);
  const siegeTurns = siege ? Math.max(1, (state.turn ?? 1) - (siege.sinceTurn ?? state.turn ?? 1) + 1) : 0;

  let defenseMult = 1;
  let wallFactor = 1;
  const tags = [];
  if (line.cut) tags.push("我军断粮");
  else if (line.hops >= 3) tags.push(line.label);

  if (targetCut) {
    defenseMult *= 0.78;
    tags.push("敌城断粮");
  }
  if (siege && siege.attacker === attackerFaction) {
    // 每围城 1 季削弱敌军 10% 守备并瓦解城防
    defenseMult *= Math.max(0.62, 1 - siegeTurns * 0.1);
    wallFactor *= Math.max(0.55, 1 - siegeTurns * 0.14);
    tags.push(`围城第${siegeTurns}季`);
  }

  return {
    attackMult: line.attackMult,
    defenseMult: Number(defenseMult.toFixed(3)),
    grainMult: line.grainMult,
    wallFactor: Number(wallFactor.toFixed(3)),
    label: tags.join(" · "),
    targetCut,
    siegeTurns,
    supplyLine: line,
  };
}

/**
 * 奇兵「劫粮乌巢 / 断其粮道」：切断目标敌城补给 2 季
 */
export function raidSupplyLine(world, state, targetCityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用粮道奇袭。" };
  const target = state.cities?.[targetCityKey];
  if (!target) return { ok: false, reason: "目标城池不存在。" };
  if (target.owner === actor) return { ok: false, reason: "不能切断己方城池粮道。" };
  if (isSupplyCut(state, targetCityKey)) return { ok: false, reason: "该城粮道已被切断，无需重复奇袭。" };

  const faction = state.factions?.[actor];
  const costTreasury = 35;
  const costGrain = 30;
  if (!faction || faction.treasury < costTreasury || faction.grain < costGrain) {
    return { ok: false, reason: `奇袭粮道需要金 ${costTreasury}、粮 ${costGrain}。` };
  }

  // 要求我方至少有一城与目标城距离 <= 2 跳（奇兵可渗透范围）
  const adj = buildAdjacency(world);
  const owned = new Set(Object.entries(state.cities).filter(([, c]) => c.owner === actor).map(([k]) => k));
  let reachable = false;
  for (const n1 of adj.get(targetCityKey) || []) {
    if (owned.has(n1)) { reachable = true; break; }
    for (const n2 of adj.get(n1) || []) {
      if (owned.has(n2)) { reachable = true; break; }
    }
    if (reachable) break;
  }
  if (!reachable) return { ok: false, reason: "目标过远，奇兵无法渗透至其粮道（需距己方城池 2 程以内）。" };

  // 如果目标城建有粮仓转运站，抵抗断粮效果减半（持续 1 季而非 2 季）
  const hasGranary = state.saga?.buildings?.cities?.[targetCityKey]?.slots?.includes("granary");
  const duration = hasGranary ? 1 : 2;

  const next = cloneState(state);
  next.factions[actor].treasury -= costTreasury;
  next.factions[actor].grain -= costGrain;
  const sup = ensureSupplyState(next);
  sup.cutUntil[targetCityKey] = (next.turn ?? 1) + duration;

  // 立即造成少量守军动摇与存粮损失
  const troopShock = Math.min(Math.floor(next.cities[targetCityKey].troops * 0.08), 1800);
  next.cities[targetCityKey].troops = Math.max(800, next.cities[targetCityKey].troops - troopShock);
  if (next.factions[target.owner]) {
    next.factions[target.owner].grain = Math.max(0, next.factions[target.owner].grain - 45);
    next.factions[target.owner].morale = Math.max(30, (next.factions[target.owner].morale ?? 75) - 5);
  }

  const cname = world.cities.find((c) => c.key === targetCityKey)?.name || targetCityKey;
  return {
    ok: true,
    state: next,
    duration,
    troopShock,
    summary: `奇兵夜袭${cname}粮道得手！敌军溃散 ${troopShock} 人、损粮 45，${cname}断粮 ${duration} 季（守战 -22%）。`,
  };
}

/**
 * 「围城断水 / 筑垒困敌」：从相邻己方城池分兵围困目标敌城
 */
export function establishSiegeBlockade(world, state, fromCityKey, targetCityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用围城断水。" };
  const from = state.cities?.[fromCityKey];
  const target = state.cities?.[targetCityKey];
  if (!from || !target) return { ok: false, reason: "出兵城或目标城无效。" };
  if (from.owner !== actor) return { ok: false, reason: "必须从己方城池发兵围城。" };
  if (target.owner === actor) return { ok: false, reason: "不能围困己方城池。" };

  const adj = buildAdjacency(world);
  if (!(adj.get(fromCityKey) || []).includes(targetCityKey)) {
    return { ok: false, reason: "围城断水必须从与目标城直接接壤的己方城池发起。" };
  }
  if (from.troops < 3500) {
    return { ok: false, reason: "出兵城兵力不足 3,500，难以合围筑垒。" };
  }
  const faction = state.factions?.[actor];
  const costGrain = 40;
  if (!faction || faction.grain < costGrain) {
    return { ok: false, reason: `筑垒围城需先筹备军粮 ${costGrain}。` };
  }

  const next = cloneState(state);
  next.factions[actor].grain -= costGrain;
  const sup = ensureSupplyState(next);
  sup.sieges[targetCityKey] = {
    attacker: actor,
    from: fromCityKey,
    sinceTurn: next.turn ?? 1,
    troops: Math.min(4500, Math.floor(from.troops * 0.35)),
  };

  const fname = world.cities.find((c) => c.key === fromCityKey)?.name || fromCityKey;
  const tname = world.cities.find((c) => c.key === targetCityKey)?.name || targetCityKey;
  return {
    ok: true,
    state: next,
    summary: `已令${fname}偏师合围${tname}，筑垒断水！每季将大幅削弱敌城城防与守军士气。`,
  };
}

/**
 * 解除围城
 */
export function liftSiegeBlockade(state, targetCityKey) {
  if (!state?.saga?.supply?.sieges?.[targetCityKey]) return state;
  const next = cloneState(state);
  delete next.saga.supply.sieges[targetCityKey];
  return next;
}

/**
 * 季度结算：处理断粮溃散、围城耗损与孤城逼降
 */
export function settleSupplyTurn(world, state) {
  if (!state?.century || !state?.saga?.supply) return { state, notes: [] };
  const next = cloneState(state);
  const sup = ensureSupplyState(next);
  const notes = [];
  const cityNameOf = (k) => world?.cities?.find((c) => c.key === k)?.name || k;

  // 1. 清理过期断粮并结算本季断粮溃散
  for (const [cityKey, until] of Object.entries(sup.cutUntil)) {
    if (until <= (next.turn ?? 0)) {
      delete sup.cutUntil[cityKey];
      continue;
    }
    const city = next.cities?.[cityKey];
    if (!city) {
      delete sup.cutUntil[cityKey];
      continue;
    }
    const desertion = Math.min(Math.floor(city.troops * 0.11), 2400);
    if (desertion > 0) {
      city.troops = Math.max(600, city.troops - desertion);
      notes.push(`${cityNameOf(cityKey)}粮道断绝，守军溃散 ${desertion} 人。`);
    }
  }

  // 2. 结算活跃围城
  const wonders = next.saga?.buildings?.wonders || {};
  for (const [targetKey, siege] of Object.entries(sup.sieges)) {
    const target = next.cities?.[targetKey];
    const from = next.cities?.[siege.from];
    if (!target || !from || target.owner === siege.attacker || from.owner !== siege.attacker || from.troops < 1800) {
      delete sup.sieges[targetKey];
      continue;
    }
    const hasWoodenOx = Object.entries(wonders).some(([ck, wid]) => wid === "wooden_ox" && next.cities?.[ck]?.owner === siege.attacker);
    const targetHasFort = wonders[targetKey] === "jingzhou_fort" || next.saga?.buildings?.cities?.[targetKey]?.slots?.includes("watchtower");

    const attritionRate = (hasWoodenOx ? 0.2 : 0.15) * (targetHasFort ? 0.65 : 1);
    const enemyLoss = Math.max(400, Math.min(Math.floor(target.troops * attritionRate), 3200));
    const wallDrop = targetHasFort ? 1 : 2;
    target.troops = Math.max(500, target.troops - enemyLoss);
    target.defense = Math.max(8, (target.defense ?? 20) - wallDrop);
    // 围城军每季消耗少量粮草
    const attFaction = next.factions?.[siege.attacker];
    if (attFaction) attFaction.grain = Math.max(0, attFaction.grain - 18);

    const turns = Math.max(1, (next.turn ?? 1) - (siege.sinceTurn ?? next.turn ?? 1) + 1);
    notes.push(`围困${cityNameOf(targetKey)}（第${turns}季）：敌军饿损 ${enemyLoss}、城防 -${wallDrop}。`);
  }

  return { state: next, notes };
}

/**
 * 为沙盘地图提供粮道连线与断粮/围城标记
 */
export function supplyLinesForMap(world, state) {
  if (!state?.century || !world) return { lines: [], cutCities: [], sieges: [] };
  const player = state.player;
  const adj = buildAdjacency(world);
  const owned = Object.entries(state.cities || {}).filter(([, c]) => c.owner === player).map(([k]) => k);
  // 找出与敌城接壤的前线城池，绘制其至核心粮仓的补给线
  const frontlines = owned.filter((k) => (adj.get(k) || []).some((n) => state.cities?.[n] && state.cities[n].owner !== player));
  const lines = [];
  const seenEdges = new Set();
  for (const fk of frontlines.slice(0, 6)) {
    const line = computeSupplyLine(world, state, player, fk);
    for (let i = 0; i < line.path.length - 1; i++) {
      const a = line.path[i];
      const b = line.path[i + 1];
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seenEdges.has(id)) continue;
      seenEdges.add(id);
      lines.push({
        from: a,
        to: b,
        strained: line.hops >= 3 || !line.connected,
        cut: Boolean(line.cut),
      });
    }
  }
  const sup = getSupplyState(state);
  const cutCities = Object.entries(sup.cutUntil)
    .filter(([, until]) => until > (state.turn ?? 0))
    .map(([k]) => k);
  const sieges = Object.entries(sup.sieges)
    .filter(([tk, s]) => state.cities?.[tk] && state.cities?.[s.from] && state.cities[tk].owner !== s.attacker && state.cities[s.from].owner === s.attacker)
    .map(([target, s]) => ({ target, from: s.from, attacker: s.attacker, turns: Math.max(1, (state.turn ?? 1) - (s.sinceTurn ?? state.turn ?? 1) + 1) }));

  return { lines, cutCities, sieges };
}
