// v23.0 — 册封附庸 & 纳贡称臣体系（不战而屈人之兵 · 和平削藩）
// 状态挂在 state.saga.vassals 下，兼容旧存档与非 century 模式。

function ensureVassals(state) {
  if (!state.saga) state.saga = {};
  if (!Array.isArray(state.saga.vassals)) state.saga.vassals = [];
  return state.saga.vassals;
}

export function listVassals(state) {
  return Array.isArray(state?.saga?.vassals) ? state.saga.vassals : [];
}

function factionCities(state, fid) {
  return Object.entries(state.cities || {}).filter(([, c]) => c.owner === fid).map(([k]) => k);
}

function factionTitle(era, fid) {
  if (Array.isArray(era?.factions)) return era.factions.find((f) => f.key === fid)?.name || fid;
  return era?.factions?.[fid]?.name || fid;
}

/**
 * 遣使逼其称臣纳贡，纳为附庸国
 */
export function demandVassalage(world, era, state, targetFaction) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用册封附庸。" };
  const player = state.player;
  if (!targetFaction || targetFaction === player || !state.factions?.[targetFaction]) {
    return { ok: false, reason: "请选择有效的诸侯势力。" };
  }
  if (listVassals(state).some((v) => v.faction === targetFaction)) {
    return { ok: false, reason: `${factionTitle(era, targetFaction)}早已称臣纳贡。` };
  }

  const myCities = factionCities(state, player);
  const tgtCities = factionCities(state, targetFaction);
  if (tgtCities.length === 0) return { ok: false, reason: "该势力已覆灭，无法册封。" };
  if (tgtCities.length > 5) return { ok: false, reason: `对方尚拥 ${tgtCities.length} 城，不肯轻易称臣（需削弱至 5 城以内）。` };

  const rep = state.saga?.reputation ?? 50;
  if (myCities.length < tgtCities.length * 2 && rep < 75) {
    return { ok: false, reason: `需我方辖城至少为对方 2 倍（当前 ${myCities.length} 对 ${tgtCities.length}）或海内声望 ≥ 75。` };
  }

  const fac = state.factions?.[player];
  const cost = 50;
  if (!fac || fac.treasury < cost) return { ok: false, reason: `册封附庸赐予印绶需金 ${cost}。` };

  const next = structuredClone(state);
  next.factions[player].treasury -= cost;
  const list = ensureVassals(next);
  const name = factionTitle(era, targetFaction);
  list.push({ faction: targetFaction, name, sinceTurn: next.turn ?? 1 });

  // 写入 4 季同盟条约保护附庸（sides 排序满足 validDiplomacy）
  const sides = [player, targetFaction].sort();
  next.treaties = (next.treaties || []).filter((t) => !(t.sides?.[0] === sides[0] && t.sides?.[1] === sides[1]));
  next.treaties.push({ sides, kind: "alliance", expires: (next.turn ?? 1) + 4 });
  next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 5);

  return {
    ok: true,
    state: next,
    summary: `【册封附庸】${name}遣使奉表称臣！每季将进献钱粮兵源，海内声望 +5！`,
  };
}

/**
 * 削藩归附：和平吞并已称臣的附庸国全部城池与兵力
 */
export function annexVassal(world, era, state, vassalFaction) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可和平削藩。" };
  const player = state.player;
  const list = listVassals(state);
  const entry = list.find((v) => v.faction === vassalFaction);
  if (!entry) return { ok: false, reason: "该势力并非我朝附庸。" };

  const elapsed = (state.turn ?? 1) - (entry.sinceTurn ?? 1);
  const rep = state.saga?.reputation ?? 50;
  if (elapsed < 2 && rep < 82) {
    return { ok: false, reason: `削藩归附需称臣满 2 季（当前 ${elapsed} 季）或声望 ≥ 82。` };
  }

  const fac = state.factions?.[player];
  const cost = 70;
  if (!fac || fac.treasury < cost) return { ok: false, reason: `安抚削藩郡县需金 ${cost}。` };

  const next = structuredClone(state);
  next.factions[player].treasury -= cost;
  let gained = 0;
  for (const city of Object.values(next.cities || {})) {
    if (city.owner === vassalFaction) {
      city.owner = player;
      gained += 1;
    }
  }
  const vFac = next.factions?.[vassalFaction];
  if (vFac) {
    next.factions[player].treasury += Math.floor((vFac.treasury ?? 0) * 0.6);
    next.factions[player].grain += Math.floor((vFac.grain ?? 0) * 0.6);
  }
  next.saga.vassals = list.filter((v) => v.faction !== vassalFaction);
  return {
    ok: true,
    gained,
    state: next,
    summary: `【和平削藩】${entry.name}举国归附！和平收编 ${gained} 座城池及六成府库，不折一兵一卒！`,
  };
}

/**
 * 季度结算：附庸国每季纳贡钱粮与兵源
 */
export function settleVassalsTurn(state) {
  if (!state?.century || !Array.isArray(state?.saga?.vassals) || state.saga.vassals.length === 0) {
    return { state, notes: [] };
  }
  const next = structuredClone(state);
  const player = next.player;
  const fac = next.factions?.[player];
  const notes = [];
  const alive = [];

  for (const v of next.saga.vassals) {
    const cities = factionCities(next, v.faction);
    if (!cities.length) continue;
    alive.push(v);
    if (fac) {
      const gold = cities.length * 14;
      const grain = cities.length * 18;
      fac.treasury += gold;
      fac.grain += grain;
      notes.push(`【附庸纳贡】${v.name}进献岁贡金 +${gold}、粮 +${grain}。`);
    }
  }
  next.saga.vassals = alive;
  return { state: next, notes };
}
