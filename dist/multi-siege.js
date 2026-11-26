// v21.0 — 多城合围总攻（两翼夹击 / 四面楚歌破坚城）
// 状态挂在 state.saga.coordinatedTargets 下，兼容旧存档与非 century 模式。

import { queueOrder } from "./engine.js";

function buildAdj(world) {
  const adj = new Map();
  for (const c of world?.cities || []) adj.set(c.key, Array.isArray(c.links) ? [...c.links] : []);
  for (const [a, b] of world?.roads || []) {
    if (adj.has(a) && !adj.get(a).includes(b)) adj.get(a).push(b);
    if (adj.has(b) && !adj.get(b).includes(a)) adj.get(b).push(a);
  }
  return adj;
}

/**
 * 扫描所有与目标敌城接壤、可协同出击的己方主力城池（最多 3 路）
 */
export function findCoordinatedAttackPlan(world, era, state, targetCityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用多城合围总攻。" };
  const target = state.cities?.[targetCityKey];
  if (!target || target.owner === actor) return { ok: false, reason: "请选择敌方城池作为合围目标。" };

  const adj = buildAdj(world);
  const neighbors = (adj.get(targetCityKey) || []).filter((k) => {
    const c = state.cities?.[k];
    return c && c.owner === actor && c.troops >= 2600;
  });
  if (neighbors.length < 2) {
    return { ok: false, reason: "至少需要 2 座与目标城直接接壤且兵力 ≥ 2,600 的己方城池，方可发动多城合围。" };
  }

  // 选出可用己方将领（避免同一将领重复出战）
  const usedOfficers = new Set((state.orders || []).map((o) => o.officer).filter(Boolean));
  const officerPool = [
    ...(era?.officers || []).filter((o) => o.faction === actor && !usedOfficers.has(o.key)),
    ...(state.recruitedOfficers || []).filter((o) => o.faction === actor && !usedOfficers.has(o.key)),
  ].sort((a, b) => (b.command ?? 72) - (a.command ?? 72));

  const legs = [];
  for (const fromKey of neighbors.slice(0, 3)) {
    const city = state.cities[fromKey];
    const preferred = city.commander ? officerPool.find((o) => o.key === city.commander) : null;
    const picked = preferred || officerPool.find((o) => !legs.some((l) => l.officer.key === o.key));
    if (!picked) continue;
    const troops = Math.min(Math.floor(city.troops * 0.62), 12000);
    if (troops < 1500) continue;
    legs.push({
      from: fromKey,
      fromName: world.cities.find((c) => c.key === fromKey)?.name || fromKey,
      officer: picked,
      troops,
      grain: Math.max(12, Math.round(troops / 260)),
    });
  }

  if (legs.length < 2) {
    return { ok: false, reason: "可用统兵将领不足 2 位，难以组织多路协同合围。" };
  }

  const totalTroops = legs.reduce((s, l) => s + l.troops, 0);
  const totalGrain = legs.reduce((s, l) => s + l.grain, 0);
  const fac = state.factions?.[actor] || { grain: 0 };
  const label = legs.length >= 3 ? "四面楚歌（三路合围）" : "两翼夹击（双路合围）";
  const bonusSummary = legs.length >= 3 ? "我攻 +22% · 敌防 -30% · 战损 -15%" : "我攻 +12% · 敌防 -18%";

  return {
    ok: true,
    target: targetCityKey,
    targetName: world.cities.find((c) => c.key === targetCityKey)?.name || targetCityKey,
    legs,
    ways: legs.length,
    totalTroops,
    totalGrain,
    affordable: fac.grain >= totalGrain,
    label,
    bonusSummary,
  };
}

/**
 * 获取目标城当前的合围破防修正（接入 engine.js forecastAttack）
 */
export function coordinatedCombatModifiers(state, targetCityKey) {
  if (!state?.century || !targetCityKey) return { attackMult: 1, defenseMult: 1, lossMult: 1, label: "" };
  const ways = state.saga?.coordinatedTargets?.[targetCityKey] ?? 0;
  if (ways >= 3) {
    return { attackMult: 1.22, defenseMult: 0.7, lossMult: 0.85, label: "四面楚歌·三路合围" };
  }
  if (ways === 2) {
    return { attackMult: 1.12, defenseMult: 0.82, lossMult: 0.94, label: "两翼夹击·双路合围" };
  }
  return { attackMult: 1, defenseMult: 1, lossMult: 1, label: "" };
}

/**
 * 下达多城合围总攻令：标记合围路数并将主攻与侧翼部队排入本季政令
 */
export function executeCoordinatedAttack(world, era, state, plan) {
  if (!plan?.ok) return { ok: false, reason: plan?.reason || "无法下达合围总攻令。" };
  if (!plan.affordable) return { ok: false, reason: `多城合围共需军粮 ${plan.totalGrain}，当前储粮不足。` };

  let next = structuredClone(state);
  if (!next.saga) next.saga = {};
  if (!next.saga.coordinatedTargets) next.saga.coordinatedTargets = {};
  next.saga.coordinatedTargets[plan.target] = plan.ways;

  // 逐路尝试入队（受限于赛季政令上限时至少保证主力两路或主攻入队，其余转为合围助战削防）
  let queued = 0;
  for (const leg of plan.legs) {
    try {
      next = queueOrder(world, next, {
        type: "attack",
        from: leg.from,
        to: plan.target,
        officer: leg.officer.key,
        troops: leg.troops,
        tactic: "assault",
      });
      queued += 1;
    } catch {
      // 若政令队列已满，该路作为侧翼佯攻牵制，削弱敌城城防
      if (next.cities?.[plan.target]) {
        next.cities[plan.target].defense = Math.max(8, (next.cities[plan.target].defense ?? 20) - 2);
      }
    }
  }
  if (queued === 0) {
    return { ok: false, reason: "本季政令队列已满，请先清空部分政令后再下达多城合围总攻。" };
  }

  return {
    ok: true,
    state: next,
    queued,
    summary: `【${plan.label}】已令${plan.legs.map((l) => `${l.fromName}(${l.officer.name})`).join("、")}共 ${plan.totalTroops.toLocaleString()} 精兵合围${plan.targetName}（${plan.bonusSummary}）！`,
  };
}

/**
 * 季度清理过期合围标记
 */
export function clearCoordinatedTargets(state) {
  if (state?.saga?.coordinatedTargets) {
    state.saga.coordinatedTargets = {};
  }
}
