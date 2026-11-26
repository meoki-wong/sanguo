// v19.0 — 大军团合编 & 都督自主作战（彻底解放中后期微操）
// 状态挂在 state.saga.corps 下，兼容旧存档与非 century 模式。

export const CORPS_DIRECTIVES = [
  { id: "attack", name: "主动征伐", summary: "都督每季整编辖城主力，自动向目标敌势力的接壤城池发起攻势。" },
  { id: "defend", name: "固守关隘", summary: "都督每季加固辖城城防、自动征募守军，死守防线。" },
  { id: "supply", name: "屯田输粮", summary: "都督专注后方农商，每季向国库额外输送钱粮与兵源。" },
];

export const MAX_CORPS = 4;

function ensureCorps(state) {
  if (!state.saga) state.saga = {};
  if (!Array.isArray(state.saga.corps)) state.saga.corps = [];
  return state.saga.corps;
}

export function listCorps(state) {
  return Array.isArray(state?.saga?.corps) ? state.saga.corps : [];
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
 * 创建或更新一支大军团
 */
export function createCorps(world, era, state, { name, commanderKey, cityKeys = [], directive = "defend", targetFaction = "" }) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可合编大军团。" };
  const current = listCorps(state);
  if (current.length >= MAX_CORPS) return { ok: false, reason: `最多同时统辖 ${MAX_CORPS} 支大军团。` };

  const player = state.player;
  const validCities = [...new Set(cityKeys)].filter((k) => state.cities?.[k]?.owner === player);
  if (validCities.length === 0) return { ok: false, reason: "请至少为军团划拨 1 座己方城池。" };

  const allOfficers = [...(era?.officers || []), ...(state.recruitedOfficers || [])];
  const commander = allOfficers.find((o) => o.key === commanderKey && o.faction === player);
  if (!commander) return { ok: false, reason: "请任命一位己方名将担任军团都督。" };
  if (current.some((c) => c.commanderKey === commanderKey)) {
    return { ok: false, reason: `${commander.name}已兼任其他军团都督。` };
  }

  const cleanName = String(name || `${commander.name}军团`).trim().slice(0, 12) || `${commander.name}军团`;
  const next = structuredClone(state);
  const list = ensureCorps(next);
  // 从旧军团中移除重复划拨的城池
  for (const c of list) {
    c.cities = (c.cities || []).filter((ck) => !validCities.includes(ck));
  }
  const id = `corps_${Date.now().toString(36)}_${list.length + 1}`;
  list.push({
    id,
    name: cleanName,
    commanderKey,
    commanderName: commander.name,
    commanderCommand: commander.command ?? 80,
    cities: validCities,
    directive: CORPS_DIRECTIVES.some((d) => d.id === directive) ? directive : "defend",
    targetFaction: targetFaction || "",
    wins: 0,
    createdTurn: next.turn ?? 1,
  });

  return {
    ok: true,
    state: next,
    id,
    summary: `已设立「${cleanName}」，拜${commander.name}为大都督，节制 ${validCities.length} 城（军令：${CORPS_DIRECTIVES.find((d) => d.id === directive)?.name || "固守"}）。`,
  };
}

/**
 * 调整军团军令或解散军团
 */
export function updateCorpsDirective(state, corpsId, { directive, targetFaction } = {}) {
  const next = structuredClone(state);
  const list = ensureCorps(next);
  const target = list.find((c) => c.id === corpsId);
  if (!target) return { ok: false, reason: "未找到对应军团。" };
  if (directive && CORPS_DIRECTIVES.some((d) => d.id === directive)) target.directive = directive;
  if (targetFaction !== undefined) target.targetFaction = targetFaction;
  return {
    ok: true,
    state: next,
    summary: `已改命「${target.name}」执行「${CORPS_DIRECTIVES.find((d) => d.id === target.directive)?.name}」。`,
  };
}

export function disbandCorps(state, corpsId) {
  const next = structuredClone(state);
  const list = ensureCorps(next);
  const idx = list.findIndex((c) => c.id === corpsId);
  if (idx === -1) return { ok: false, reason: "未找到对应军团。" };
  const [removed] = list.splice(idx, 1);
  return { ok: true, state: next, summary: `已撤销「${removed.name}」建制，辖城收归中枢直辖。` };
}

/**
 * 季度结算：都督依军令自主施政/练兵/出征
 */
export function settleCorpsTurn(world, era, state) {
  if (!state?.century || !Array.isArray(state?.saga?.corps) || state.saga.corps.length === 0) {
    return { state, notes: [] };
  }
  const next = structuredClone(state);
  const player = next.player;
  const fac = next.factions?.[player];
  if (!fac) return { state: next, notes: [] };

  const adj = buildAdjacency(world);
  const cityNameOf = (k) => world?.cities?.find((c) => c.key === k)?.name || k;
  const notes = [];

  for (const corps of ensureCorps(next)) {
    corps.cities = (corps.cities || []).filter((ck) => next.cities?.[ck]?.owner === player);
    if (corps.cities.length === 0) continue;
    const cmdFactor = 0.85 + Math.min(0.45, ((corps.commanderCommand ?? 80) - 65) / 80);

    if (corps.directive === "supply") {
      const addTreasury = Math.round(corps.cities.length * 14 * cmdFactor);
      const addGrain = Math.round(corps.cities.length * 20 * cmdFactor);
      fac.treasury += addTreasury;
      fac.grain += addGrain;
      for (const ck of corps.cities) {
        next.cities[ck].troops = Math.min(35000, next.cities[ck].troops + Math.round(180 * cmdFactor));
      }
      notes.push(`【${corps.name}】${corps.commanderName}督办后勤，输纳金 +${addTreasury}、粮 +${addGrain}。`);
      continue;
    }

    if (corps.directive === "defend") {
      let fortified = 0;
      for (const ck of corps.cities) {
        const c = next.cities[ck];
        if ((c.defense ?? 20) < 42) {
          c.defense = Math.min(45, (c.defense ?? 20) + 2);
          fortified += 1;
        }
        c.troops = Math.min(38000, c.troops + Math.round(320 * cmdFactor));
      }
      notes.push(`【${corps.name}】${corps.commanderName}固守防线，整军增兵并加固 ${fortified} 城城防。`);
      continue;
    }

    if (corps.directive === "attack") {
      // 寻找辖城中兵力最充沛、且与敌城接壤的前锋城
      let bestPair = null;
      for (const fk of corps.cities) {
        const fc = next.cities[fk];
        if (!fc || fc.troops < 4200) continue;
        for (const nb of adj.get(fk) || []) {
          const tc = next.cities[nb];
          if (!tc || tc.owner === player) continue;
          if (corps.targetFaction && tc.owner !== corps.targetFaction) continue;
          const score = fc.troops * cmdFactor - tc.troops * (1 + (tc.defense ?? 20) * 0.02);
          if (!bestPair || score > bestPair.score) {
            bestPair = { from: fk, to: nb, score };
          }
        }
      }
      if (!bestPair) {
        // 无合适目标则先在辖城积蓄兵力
        const leadCity = corps.cities[0];
        next.cities[leadCity].troops = Math.min(38000, next.cities[leadCity].troops + Math.round(360 * cmdFactor));
        notes.push(`【${corps.name}】${corps.commanderName}在${cityNameOf(leadCity)}整训聚兵，待机北伐。`);
        continue;
      }

      const fromCity = next.cities[bestPair.from];
      const toCity = next.cities[bestPair.to];
      const marchTroops = Math.min(Math.floor(fromCity.troops * 0.55), 11000);
      const grainCost = Math.max(15, Math.round(marchTroops / 260));
      if (fac.grain < grainCost) {
        notes.push(`【${corps.name}】军粮暂紧，${corps.commanderName}暂缓攻打${cityNameOf(bestPair.to)}。`);
        continue;
      }
      fac.grain -= grainCost;
      const offPower = marchTroops * (1 + (corps.commanderCommand ?? 80) / 130);
      const defPower = toCity.troops * 1.05 + (toCity.defense ?? 20) * 240;

      if (offPower > defPower * 1.08) {
        const attLoss = Math.max(300, Math.round(marchTroops * 0.22));
        fromCity.troops = Math.max(1200, fromCity.troops - marchTroops);
        toCity.owner = player;
        toCity.troops = Math.max(1500, marchTroops - attLoss);
        toCity.defense = Math.max(10, Math.floor((toCity.defense ?? 20) * 0.7));
        corps.cities.push(bestPair.to);
        corps.wins = (corps.wins ?? 0) + 1;
        notes.push(`【${corps.name}捷报】${corps.commanderName}率师自${cityNameOf(bestPair.from)}一举攻克${cityNameOf(bestPair.to)}！`);
      } else {
        // 袭扰削敌
        const enemyLoss = Math.min(toCity.troops - 600, Math.max(350, Math.round(marchTroops * 0.24)));
        const ownLoss = Math.max(250, Math.round(marchTroops * 0.16));
        if (enemyLoss > 0) toCity.troops -= enemyLoss;
        fromCity.troops = Math.max(1200, fromCity.troops - ownLoss);
        toCity.defense = Math.max(8, (toCity.defense ?? 20) - 2);
        notes.push(`【${corps.name}战报】${corps.commanderName}率部袭扰${cityNameOf(bestPair.to)}，歼敌 ${Math.max(0, enemyLoss)}、损城防 2。`);
      }
    }
  }

  return { state: next, notes };
}
