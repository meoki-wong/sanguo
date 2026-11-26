// v19.0 — 名将关系网：桃园结义、政治联姻 & 宿敌复仇
// 状态挂在 state.saga.relationships 下，兼容旧存档与非 century 模式。

function ensureRelationships(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.relationships || typeof state.saga.relationships !== "object") {
    state.saga.relationships = { sworn: [], marriages: [], nemeses: [] };
  }
  if (!Array.isArray(state.saga.relationships.sworn)) state.saga.relationships.sworn = [];
  if (!Array.isArray(state.saga.relationships.marriages)) state.saga.relationships.marriages = [];
  if (!Array.isArray(state.saga.relationships.nemeses)) state.saga.relationships.nemeses = [];
  return state.saga.relationships;
}

export function getRelationships(state) {
  const r = state?.saga?.relationships || {};
  return {
    sworn: Array.isArray(r.sworn) ? r.sworn : [],
    marriages: Array.isArray(r.marriages) ? r.marriages : [],
    nemeses: Array.isArray(r.nemeses) ? r.nemeses : [],
  };
}

/**
 * 撮合两位己方名将桃园结义（触发义兄弟合击：攻战 +10%、战损 -12%）
 */
export function swearBrotherhood(era, state, officerAKey, officerBKey) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可撮合名将结义。" };
  if (!officerAKey || !officerBKey || officerAKey === officerBKey) {
    return { ok: false, reason: "请选择两位不同的己方名将。" };
  }
  const all = [...(era?.officers || []), ...(state.recruitedOfficers || [])];
  const a = all.find((o) => o.key === officerAKey && o.faction === state.player);
  const b = all.find((o) => o.key === officerBKey && o.faction === state.player);
  if (!a || !b) return { ok: false, reason: "结义双方均须为我军现役名将。" };

  const pair = [officerAKey, officerBKey].sort();
  const cur = getRelationships(state);
  if (cur.sworn.some((s) => s.pair[0] === pair[0] && s.pair[1] === pair[1])) {
    return { ok: false, reason: `${a.name}与${b.name}早已义结金兰。` };
  }
  const fac = state.factions?.[state.player];
  const cost = 35;
  if (!fac || fac.treasury < cost) return { ok: false, reason: `设坛结义需礼金 ${cost}。` };

  const next = structuredClone(state);
  next.factions[state.player].treasury -= cost;
  const rel = ensureRelationships(next);
  rel.sworn.push({
    pair,
    names: [a.name, b.name],
    turn: next.turn ?? 1,
  });
  if (next.factions[state.player]) {
    next.factions[state.player].morale = Math.min(100, (next.factions[state.player].morale ?? 75) + 4);
  }
  return {
    ok: true,
    state: next,
    summary: `【桃园结义】${a.name}与${b.name}焚香结为生死之交！出战触发「义兄弟合击」（攻 +10% · 战损 -12%），全军士气 +4！`,
  };
}

/**
 * 政治联姻：与指定势力缔结秦晋之好（签下 4 季同盟/停战并获礼金声望）
 */
export function arrangeMarriage(era, state, targetFaction) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可缔结政治联姻。" };
  const player = state.player;
  if (!targetFaction || targetFaction === player || !state.factions?.[targetFaction]) {
    return { ok: false, reason: "请选择有效的联姻对象势力。" };
  }
  const cur = getRelationships(state);
  if (cur.marriages.some((m) => m.faction === targetFaction)) {
    return { ok: false, reason: "双方早已缔结秦晋之好。" };
  }
  const fac = state.factions?.[player];
  const cost = 55;
  if (!fac || fac.treasury < cost) return { ok: false, reason: `政治联姻置办聘礼需金 ${cost}。` };

  const next = structuredClone(state);
  next.factions[player].treasury -= cost;
  const rel = ensureRelationships(next);
  const fname = (Array.isArray(era?.factions) ? era.factions.find((f) => f.key === targetFaction)?.name : era?.factions?.[targetFaction]?.name) || targetFaction;
  rel.marriages.push({ faction: targetFaction, factionName: fname, turn: next.turn ?? 1 });

  // 写入 4 季同盟条约（sides 排序满足 validDiplomacy）
  const sides = [player, targetFaction].sort();
  next.treaties = (next.treaties || []).filter((t) => !(t.sides?.[0] === sides[0] && t.sides?.[1] === sides[1]));
  next.treaties.push({
    sides,
    kind: "alliance",
    expires: (next.turn ?? 1) + 4,
  });
  if (next.saga) next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 4);

  return {
    ok: true,
    state: next,
    summary: `【秦晋之好】我朝与${fname}缔结政治联姻！达成 4 季稳固同盟，海内声望 +4。`,
  };
}

/**
 * 登记不共戴天宿敌（例如斩杀敌将或失陷重镇后触发）
 */
export function registerNemesis(state, officerKey, officerName, enemyFaction, reason = "血海深仇") {
  if (!state?.century || !officerKey || !enemyFaction) return state;
  const next = structuredClone(state);
  const rel = ensureRelationships(next);
  if (!rel.nemeses.some((n) => n.officerKey === officerKey && n.enemyFaction === enemyFaction)) {
    rel.nemeses.push({ officerKey, officerName: officerName || officerKey, enemyFaction, reason, turn: next.turn ?? 1 });
  }
  return next;
}

/**
 * 关系网战斗修正：检查义兄弟合击与宿敌复仇爆发
 */
export function relationshipCombatModifiers(state, { attackerKey, attackerFaction, defenderFaction }) {
  if (!state?.century || !attackerKey) return { attackMult: 1, lossMult: 1, notes: [] };
  const rel = getRelationships(state);
  let attackMult = 1;
  let lossMult = 1;
  const notes = [];

  const swornEntry = rel.sworn.find((s) => s.pair.includes(attackerKey));
  if (swornEntry && attackerFaction === state.player) {
    attackMult += 0.1;
    lossMult *= 0.88;
    notes.push(`义兄弟合击(${swornEntry.names.join("·")})`);
  }

  const nemesisEntry = rel.nemeses.find((n) => n.officerKey === attackerKey && n.enemyFaction === defenderFaction);
  if (nemesisEntry) {
    attackMult += 0.15;
    notes.push(`宿敌复仇(${nemesisEntry.reason})`);
  }

  return {
    attackMult: Number(attackMult.toFixed(3)),
    lossMult: Number(lossMult.toFixed(3)),
    notes,
  };
}
