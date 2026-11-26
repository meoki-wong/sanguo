// v19.0 — 边疆五族博弈（乌桓 / 匈奴 / 羌胡 / 南蛮 / 山越）
// 状态挂在 state.saga.tribes 下，兼容旧存档与非 century 模式。

export const FRONTIER_TRIBES = [
  {
    id: "wuhuan",
    name: "辽东乌桓",
    icon: "🦅",
    region: "幽州北境",
    anchors: ["beiping", "ji", "xiangping"],
    unitName: "乌桓突骑",
    raidSummary: "擅长驰突幽冀，可借兵奇袭北方敌城。",
    pacifyBonus: "每季补充乌桓突骑 380 人，边疆马政税收 +15。",
  },
  {
    id: "xiongnu",
    name: "南匈奴",
    icon: "🐺",
    region: "并州塞外",
    anchors: ["jinyang", "shangdang", "luoyang"],
    unitName: "匈奴控弦",
    raidSummary: "铁骑南下河东并州，擅破敌后补给。",
    pacifyBonus: "每季补充匈奴控弦 400 人，并州商税 +16。",
  },
  {
    id: "qiang",
    name: "西凉羌胡",
    icon: "🐎",
    region: "雍凉西陲",
    anchors: ["wuwei", "tianshui", "anding", "changan"],
    unitName: "羌胡铁骑",
    raidSummary: "纵横关陇，借兵可重创雍凉关中守军。",
    pacifyBonus: "每季补充羌胡铁骑 420 人，攻战气势更盛。",
  },
  {
    id: "nanman",
    name: "南中蛮族",
    icon: "🐘",
    region: "益州南中",
    anchors: ["jianning", "yongchang", "chengdu", "jiangzhou"],
    unitName: "南蛮藤甲",
    raidSummary: "盘踞南中险壑，擅长奇袭巴蜀荆南。",
    pacifyBonus: "每季补充藤甲劲卒 380 人，南中产粮 +25。",
  },
  {
    id: "shanyue",
    name: "江东山越",
    icon: "🌿",
    region: "扬州山泽",
    anchors: ["wu", "kuaiji", "jianye", "chaisang"],
    unitName: "山越丹阳兵",
    raidSummary: "熟悉江南丘陵泽国，可袭扰江淮扬州。",
    pacifyBonus: "每季补充山越精卒 360 人，江东税收 +18。",
  },
];

function ensureTribes(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.tribes || typeof state.saga.tribes !== "object") {
    state.saga.tribes = {};
    for (const t of FRONTIER_TRIBES) {
      state.saga.tribes[t.id] = { relation: 45, pacifiedBy: null, lastActionTurn: -5 };
    }
  }
  for (const t of FRONTIER_TRIBES) {
    if (!state.saga.tribes[t.id]) {
      state.saga.tribes[t.id] = { relation: 45, pacifiedBy: null, lastActionTurn: -5 };
    }
  }
  return state.saga.tribes;
}

export function getTribesStatus(state) {
  const map = state?.saga?.tribes || {};
  return FRONTIER_TRIBES.map((t) => {
    const rec = map[t.id] || { relation: 45, pacifiedBy: null, lastActionTurn: -5 };
    return { ...t, ...rec };
  });
}

function playerAnchorForTribe(state, tribe, factionId = state.player) {
  return tribe.anchors.find((k) => state.cities?.[k]?.owner === factionId) || null;
}

/**
 * 遣使通好：提升异族好感，避免边疆寇边
 */
export function giftTribe(state, tribeId, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用边疆五族博弈。" };
  const tribe = FRONTIER_TRIBES.find((t) => t.id === tribeId);
  if (!tribe) return { ok: false, reason: "未知的边疆部族。" };
  const fac = state.factions?.[actor];
  const cost = 35;
  if (!fac || fac.treasury < cost) return { ok: false, reason: `遣使通好「${tribe.name}」需金 ${cost}。` };

  const next = structuredClone(state);
  next.factions[actor].treasury -= cost;
  const tribes = ensureTribes(next);
  tribes[tribeId].relation = Math.min(100, (tribes[tribeId].relation ?? 45) + 22);
  return {
    ok: true,
    state: next,
    summary: `已遣使携锦帛通好「${tribe.icon}${tribe.name}」，部族好感提升至 ${tribes[tribeId].relation}！`,
  };
}

/**
 * 联胡击敌：借边疆部族突袭指定敌城
 */
export function enlistTribeRaid(world, state, tribeId, targetCityKey, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用联胡击敌。" };
  const tribe = FRONTIER_TRIBES.find((t) => t.id === tribeId);
  if (!tribe) return { ok: false, reason: "未知的边疆部族。" };
  const target = state.cities?.[targetCityKey];
  if (!target || target.owner === actor) return { ok: false, reason: "请选择敌方城池作为借兵突袭目标。" };

  const fac = state.factions?.[actor];
  const costTreasury = 55;
  const costGrain = 35;
  if (!fac || fac.treasury < costTreasury || fac.grain < costGrain) {
    return { ok: false, reason: `向「${tribe.name}」借兵突袭需金 ${costTreasury}、粮 ${costGrain}。` };
  }
  const curRec = state.saga?.tribes?.[tribeId] || { relation: 45, lastActionTurn: -5 };
  if ((curRec.relation ?? 45) < 40 && curRec.pacifiedBy !== actor) {
    return { ok: false, reason: `「${tribe.name}」好感不足 40，暂不愿出兵相助（可先遣使通好）。` };
  }
  if ((state.turn ?? 1) - (curRec.lastActionTurn ?? -5) < 2) {
    return { ok: false, reason: `「${tribe.name}」刚出征归来，需休整 2 季。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= costTreasury;
  next.factions[actor].grain -= costGrain;
  const tribes = ensureTribes(next);
  tribes[tribeId].lastActionTurn = next.turn ?? 1;

  const loss = Math.min(Math.max(700, Math.floor(next.cities[targetCityKey].troops * 0.2)), 3200);
  next.cities[targetCityKey].troops = Math.max(600, next.cities[targetCityKey].troops - loss);
  next.cities[targetCityKey].defense = Math.max(8, (next.cities[targetCityKey].defense ?? 20) - 3);
  if (next.factions[target.owner]) {
    next.factions[target.owner].morale = Math.max(25, (next.factions[target.owner].morale ?? 75) - 6);
  }
  const cname = world?.cities?.find((c) => c.key === targetCityKey)?.name || targetCityKey;
  return {
    ok: true,
    state: next,
    loss,
    summary: `【联胡击敌】「${tribe.icon}${tribe.name}」派出${tribe.unitName}奇袭${cname}，歼敌 ${loss}、毁城防 3、挫敌士气 -6！`,
  };
}

/**
 * 抚蛮平越：收编归化边疆部族（需掌控对应边疆重镇或高好感）
 */
export function pacifyTribe(state, tribeId, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用抚蛮平越。" };
  const tribe = FRONTIER_TRIBES.find((t) => t.id === tribeId);
  if (!tribe) return { ok: false, reason: "未知的边疆部族。" };
  const curRec = state.saga?.tribes?.[tribeId];
  if (curRec?.pacifiedBy === actor) return { ok: false, reason: `「${tribe.name}」已归化我朝。` };

  const anchor = playerAnchorForTribe(state, tribe, actor);
  if (!anchor && (curRec?.relation ?? 45) < 75) {
    return { ok: false, reason: `抚平「${tribe.name}」需先占据其毗邻边城（如 ${tribe.region}）或将好感提升至 75 以上。` };
  }

  const fac = state.factions?.[actor];
  const costTreasury = 80;
  const costGrain = 50;
  if (!fac || fac.treasury < costTreasury || fac.grain < costGrain) {
    return { ok: false, reason: `抚蛮平越需金 ${costTreasury}、粮 ${costGrain}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= costTreasury;
  next.factions[actor].grain -= costGrain;
  const tribes = ensureTribes(next);
  tribes[tribeId].pacifiedBy = actor;
  tribes[tribeId].relation = 100;
  if (next.saga) next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 5);

  const bonusCity = anchor || Object.keys(next.cities).find((k) => next.cities[k].owner === actor);
  if (bonusCity) {
    next.cities[bonusCity].troops = Math.min(40000, next.cities[bonusCity].troops + 1500);
  }
  return {
    ok: true,
    state: next,
    summary: `【抚蛮平越】「${tribe.icon}${tribe.name}」正式归化！获编${tribe.unitName} 1,500 人、海内声望 +5，此后每季纳贡增兵。`,
  };
}

/**
 * 季度结算：已归化部族纳贡增兵；未归化且好感过低时若边城空虚可能寇边
 */
export function settleTribesTurn(world, state) {
  if (!state?.century) return { state, notes: [] };
  const next = structuredClone(state);
  const tribes = ensureTribes(next);
  const player = next.player;
  const fac = next.factions?.[player];
  const notes = [];
  const cityNameOf = (k) => world?.cities?.find((c) => c.key === k)?.name || k;

  for (const t of FRONTIER_TRIBES) {
    const rec = tribes[t.id];
    if (rec.pacifiedBy === player && fac) {
      const anchor = playerAnchorForTribe(next, t, player) || Object.keys(next.cities).find((k) => next.cities[k].owner === player);
      if (anchor) {
        next.cities[anchor].troops = Math.min(40000, next.cities[anchor].troops + 380);
      }
      if (t.id === "nanman") fac.grain += 25;
      else fac.treasury += 16;
      continue;
    }
    // 未归化且好感 < 35 时，若玩家边城守军 < 2200，每 4 季可能触发一次边警
    if (!rec.pacifiedBy && (rec.relation ?? 45) < 35 && (next.turn ?? 1) % 4 === 0) {
      const weakAnchor = t.anchors.find((k) => next.cities?.[k]?.owner === player && next.cities[k].troops < 2200);
      if (weakAnchor) {
        const dmg = Math.min(450, Math.floor(next.cities[weakAnchor].troops * 0.2));
        next.cities[weakAnchor].troops = Math.max(500, next.cities[weakAnchor].troops - dmg);
        notes.push(`【边疆警报】${t.name}趁${cityNameOf(weakAnchor)}防备空虚南下劫掠，守军折损 ${dmg} 人！`);
      }
    }
  }
  return { state: next, notes };
}
