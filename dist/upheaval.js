// v22.0 — 乱世剧变：降将献城、地方自立与残部复国
// 状态挂在 state.saga.upheavals 下，兼容旧存档与非 century 模式。

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
 * 主动发动「仁威招降」：海内声望 >= 75 时，可对相邻低防/虚弱敌城策动降将献城或大幅倒戈
 */
export function inciteCityDefection(world, state, targetCityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用乱世招降献城。" };
  const target = state.cities?.[targetCityKey];
  if (!target || target.owner === actor) return { ok: false, reason: "请选择敌方城池。" };
  const rep = state.saga?.reputation ?? 50;
  if (rep < 72) return { ok: false, reason: `策动敌城降将献城需海内声望 ≥ 72（当前 ${rep}）。` };

  const adj = buildAdj(world);
  const adjacent = (adj.get(targetCityKey) || []).some((k) => state.cities?.[k]?.owner === actor);
  if (!adjacent) return { ok: false, reason: "须与目标敌城直接接壤方可秘密联络城内降将。" };

  const fac = state.factions?.[actor];
  const cost = 60;
  if (!fac || fac.treasury < cost) return { ok: false, reason: `厚赏内应降将需金 ${cost}。` };

  const next = structuredClone(state);
  next.factions[actor].treasury -= cost;
  if (!next.saga.upheavals) next.saga.upheavals = [];
  const cname = world?.cities?.find((c) => c.key === targetCityKey)?.name || targetCityKey;

  // 若敌城兵力 <= 3200 且敌方士气 < 65，直接举城来降！否则引发半数守军倒戈削弱
  const enemyMorale = next.factions?.[target.owner]?.morale ?? 75;
  if (next.cities[targetCityKey].troops <= 3200 && enemyMorale < 68) {
    next.cities[targetCityKey].owner = actor;
    next.cities[targetCityKey].troops = Math.max(1200, Math.floor(next.cities[targetCityKey].troops * 0.8));
    next.saga.upheavals.push({ turn: next.turn ?? 1, kind: "defection", text: `${cname}守将慕义献城归降！` });
    return {
      ok: true,
      captured: true,
      state: next,
      summary: `【乱世剧变 · 降将献城】${cname}守将感念主公威望，斩关献城归降！不费一兵一卒得此重镇！`,
    };
  }

  const defected = Math.min(Math.max(800, Math.floor(next.cities[targetCityKey].troops * 0.28)), 3500);
  next.cities[targetCityKey].troops = Math.max(600, next.cities[targetCityKey].troops - defected);
  next.cities[targetCityKey].defense = Math.max(8, (next.cities[targetCityKey].defense ?? 20) - 4);
  const home = (adj.get(targetCityKey) || []).find((k) => next.cities?.[k]?.owner === actor);
  if (home) next.cities[home].troops = Math.min(40000, next.cities[home].troops + Math.floor(defected * 0.6));
  next.saga.upheavals.push({ turn: next.turn ?? 1, kind: "mutiny", text: `${cname}内变，${defected} 守军倒戈来投！` });
  return {
    ok: true,
    captured: false,
    state: next,
    summary: `【乱世剧变 · 敌军倒戈】${cname}偏将率部哗变，敌军折损 ${defected}、城防 -4，大批降卒投奔我方前线！`,
  };
}

/**
 * 季度乱世剧变结算：低士气大势力边缘城池可能触发民变/旧部复国波澜（限频每 6 季最多 1 次）
 */
export function settleUpheavalTurn(world, era, state) {
  if (!state?.century || (state.turn ?? 0) < 6 || (state.turn ?? 0) % 6 !== 0) {
    return { state, notes: [] };
  }
  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  if (!Array.isArray(next.saga.upheavals)) next.saga.upheavals = [];
  const notes = [];
  const player = next.player;
  const cityNameOf = (k) => world?.cities?.find((c) => c.key === k)?.name || k;

  // 寻找被灭亡的势力（0城）与疆域膨胀且士气偏低的 AI 势力（>= 8城且 morale < 65）
  const cityCounts = {};
  for (const fid of Object.keys(next.factions || {})) cityCounts[fid] = 0;
  for (const c of Object.values(next.cities || {})) {
    cityCounts[c.owner] = (cityCounts[c.owner] ?? 0) + 1;
  }

  const fallen = Object.keys(cityCounts).find((fid) => fid !== player && cityCounts[fid] === 0);
  const overextendedAi = Object.keys(cityCounts).find(
    (fid) => fid !== player && cityCounts[fid] >= 8 && (next.factions[fid]?.morale ?? 75) < 65,
  );

  if (fallen && overextendedAi) {
    const weakCity = Object.entries(next.cities || {})
      .filter(([, c]) => c.owner === overextendedAi && c.troops < 3200)
      .sort((a, b) => a[1].troops - b[1].troops)[0];
    if (weakCity) {
      const [ck, city] = weakCity;
      city.owner = fallen;
      city.troops = Math.max(2600, city.troops + 1400);
      next.factions[fallen].treasury = Math.max(90, next.factions[fallen].treasury ?? 90);
      next.factions[fallen].grain = Math.max(90, next.factions[fallen].grain ?? 90);
      next.factions[fallen].morale = 80;
      const fName = (Array.isArray(era?.factions) ? era.factions.find((f) => f.key === fallen)?.name : era?.factions?.[fallen]?.name) || fallen;
      const msg = `【乱世复国】${fName}旧部趁虚起兵于${cityNameOf(ck)}，重举大旗！`;
      next.saga.upheavals.push({ turn: next.turn, kind: "restoration", text: msg });
      notes.push(msg);
    }
  }

  return { state: next, notes };
}
