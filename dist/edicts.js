// v24.0 — 传檄天下：舆论战与四大诏令（讨贼檄文 / 求贤令 / 安民告示 / 奉天子诏）
// 状态挂在 state.saga.edicts 下，兼容旧存档与非 century 模式。

export const PUBLIC_EDICTS = [
  {
    id: "denounce_rebel",
    name: "《讨贼檄文》",
    icon: "📣",
    costTreasury: 35,
    summary: "传檄天下斥敌国贼：目标强敌士气 -10、国库损 40，我方声望 +5！",
    needsEnemy: true,
  },
  {
    id: "seek_talents",
    name: "《求贤令》",
    icon: "📜",
    costTreasury: 40,
    summary: "广发求贤榜延揽英才：立刻获得兵技 +85 TP、全军士气 +5！",
    needsEnemy: false,
  },
  {
    id: "pacify_people",
    name: "《安民告示》",
    icon: "🏮",
    costTreasury: 30,
    summary: "秋毫无犯安抚百姓：立刻平定所有新占城动荡，民心 +8、储粮 +60！",
    needsEnemy: false,
  },
  {
    id: "imperial_decree",
    name: "《奉天子诏》",
    icon: "👑",
    costTreasury: 55,
    summary: "挟大义号令诸侯共讨逆臣：削弱目标敌势前线诸城兵力 10%、声望 +7！",
    needsEnemy: true,
  },
];

export function issuePublicEdict(world, era, state, edictId, { targetFaction = "" } = {}) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可传檄天下。" };
  const def = PUBLIC_EDICTS.find((e) => e.id === edictId);
  if (!def) return { ok: false, reason: "未知的诏令檄文。" };

  const player = state.player;
  const fac = state.factions?.[player];
  if (!fac || fac.treasury < def.costTreasury) {
    return { ok: false, reason: `颁行${def.name}需经费金 ${def.costTreasury}。` };
  }
  const lastTurn = state.saga?.edicts?.lastTurn ?? -3;
  const elapsed = (state.turn ?? 1) - lastTurn;
  if (elapsed < 2) {
    return { ok: false, reason: `舆论诏令冷却中，需再待 ${2 - elapsed} 季。` };
  }

  const next = structuredClone(state);
  next.factions[player].treasury -= def.costTreasury;
  if (!next.saga) next.saga = {};
  next.saga.edicts = { lastTurn: next.turn ?? 1, lastId: edictId };

  const fname = (fid) => (Array.isArray(era?.factions) ? era.factions.find((f) => f.key === fid)?.name : era?.factions?.[fid]?.name) || fid;
  const enemy = targetFaction && targetFaction !== player && next.factions?.[targetFaction]
    ? targetFaction
    : Object.keys(next.factions || {}).find((fid) => fid !== player && Object.values(next.cities).some((c) => c.owner === fid));

  if (edictId === "denounce_rebel") {
    if (!enemy) return { ok: false, reason: "暂无可声讨的敌对诸侯。" };
    next.factions[enemy].morale = Math.max(20, (next.factions[enemy].morale ?? 75) - 10);
    next.factions[enemy].treasury = Math.max(0, (next.factions[enemy].treasury ?? 0) - 40);
    next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 5);
    return {
      ok: true,
      state: next,
      summary: `【传檄天下 · 讨贼檄文】痛斥${fname(enemy)}逆行！敌士气 -10、损金 40，我方海内声望 +5！`,
    };
  }

  if (edictId === "seek_talents") {
    if (next.saga.tech) next.saga.tech.points = (next.saga.tech.points ?? 0) + 85;
    next.factions[player].morale = Math.min(100, (next.factions[player].morale ?? 75) + 5);
    return {
      ok: true,
      state: next,
      summary: "【传檄天下 · 求贤令】四方英才闻风来投！兵技 +85 TP、全军士气 +5！",
    };
  }

  if (edictId === "pacify_people") {
    let pacified = 0;
    for (const c of Object.values(next.cities || {})) {
      if (c.owner === player && (c.occupation ?? 0) > 0) {
        c.occupation = 0;
        pacified += 1;
      }
    }
    next.factions[player].morale = Math.min(100, (next.factions[player].morale ?? 75) + 8);
    next.factions[player].grain += 60;
    return {
      ok: true,
      state: next,
      summary: `【传檄天下 · 安民告示】已安抚 ${pacified} 座新占城池，全军民心 +8、储粮 +60！`,
    };
  }

  if (edictId === "imperial_decree") {
    if (!enemy) return { ok: false, reason: "暂无可号令讨伐的敌对诸侯。" };
    let affected = 0;
    for (const c of Object.values(next.cities || {})) {
      if (c.owner === enemy && affected < 4) {
        c.troops = Math.max(700, Math.floor(c.troops * 0.9));
        affected += 1;
      }
    }
    next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 7);
    return {
      ok: true,
      state: next,
      summary: `【传檄天下 · 奉天子诏】号令九州讨伐${fname(enemy)}！敌 ${affected} 座重镇守军动摇 -10%，我方声望 +7！`,
    };
  }

  return { ok: false, reason: "未处理的诏令。" };
}
