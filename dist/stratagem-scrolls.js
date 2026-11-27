// v23.0 — 「三十六计」战略锦囊妙计（借刀杀人 / 围魏救赵 / 空城计 / 连环火计）
// 状态挂在 state.saga.scrolls 下，兼容旧存档与非 century 模式。

export const STRATAGEM_SCROLLS = [
  {
    id: "borrow_knife",
    name: "借刀杀人",
    icon: "🗡️",
    costTp: 40,
    costTreasury: 40,
    targetKind: "two_enemies",
    summary: "暗中挑拨两大 AI 诸侯立刻交兵互耗，双方主力重镇各折损 20% 兵力与军粮！",
  },
  {
    id: "besiege_wei",
    name: "围魏救赵",
    icon: "🎯",
    costTp: 35,
    costTreasury: 35,
    targetKind: "enemy_city",
    summary: "奇兵直捣敌方腹心重镇（削兵 18%、毁防 4），同时震慑解除敌军对我方之围困！",
  },
  {
    id: "empty_fort",
    name: "空城计",
    icon: "🪕",
    costTp: 35,
    costTreasury: 25,
    targetKind: "own_city",
    summary: "高智名将抚琴退敌：令指定己城进入 2 季「空城疑阵」，守备战力暴涨 +45%！",
  },
  {
    id: "chain_fire",
    name: "连环火计",
    icon: "🔥",
    costTp: 45,
    costTreasury: 45,
    targetKind: "enemy_city",
    summary: "对目标敌城暗布连环火阵（持续 2 季），我军攻城时敌防 -24%、城墙 -30%！",
  },
];

function ensureScrolls(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.scrolls || typeof state.saga.scrolls !== "object") {
    state.saga.scrolls = { lastUsedTurn: -3, emptyFortUntil: {}, chainFireUntil: {} };
  }
  if (!state.saga.scrolls.emptyFortUntil) state.saga.scrolls.emptyFortUntil = {};
  if (!state.saga.scrolls.chainFireUntil) state.saga.scrolls.chainFireUntil = {};
  return state.saga.scrolls;
}

export function isEmptyFortActive(state, cityKey) {
  return Boolean(state?.century && (state?.saga?.scrolls?.emptyFortUntil?.[cityKey] ?? 0) > (state.turn ?? 0));
}

export function isChainFireActive(state, cityKey) {
  return Boolean(state?.century && (state?.saga?.scrolls?.chainFireUntil?.[cityKey] ?? 0) > (state.turn ?? 0));
}

/**
 * 战略锦囊战斗修正（接入 engine.js forecastAttack）
 */
export function scrollCombatModifiers(state, targetCityKey) {
  if (!state?.century || !targetCityKey) return { defenseMult: 1, wallFactor: 1, label: "" };
  let defenseMult = 1;
  let wallFactor = 1;
  const tags = [];
  if (isEmptyFortActive(state, targetCityKey)) {
    defenseMult *= 1.45;
    tags.push("空城疑阵");
  }
  if (isChainFireActive(state, targetCityKey)) {
    defenseMult *= 0.76;
    wallFactor *= 0.7;
    tags.push("连环火阵");
  }
  return {
    defenseMult: Number(defenseMult.toFixed(3)),
    wallFactor: Number(wallFactor.toFixed(3)),
    label: tags.join(" · "),
  };
}

/**
 * 施展三十六计战略锦囊
 */
export function castStratagemScroll(world, era, state, scrollId, { targetCityKey = "" } = {}) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可施展三十六计锦囊。" };
  const def = STRATAGEM_SCROLLS.find((s) => s.id === scrollId);
  if (!def) return { ok: false, reason: "未知的锦囊妙计。" };

  const player = state.player;
  const fac = state.factions?.[player];
  const tp = state.saga?.tech?.points ?? 0;
  if (tp < def.costTp) return { ok: false, reason: `施展「${def.name}」需兵技点 ${def.costTp} TP（当前 ${tp}）。` };
  if (!fac || fac.treasury < def.costTreasury) return { ok: false, reason: `施展「${def.name}」需军费金 ${def.costTreasury}。` };

  const curScrolls = state.saga?.scrolls || { lastUsedTurn: -3 };
  const elapsed = (state.turn ?? 1) - (curScrolls.lastUsedTurn ?? -3);
  if (elapsed < 2) return { ok: false, reason: `锦囊妙计冷却中，需再待 ${2 - elapsed} 季。` };

  const next = structuredClone(state);
  next.factions[player].treasury -= def.costTreasury;
  if (next.saga?.tech) next.saga.tech.points = Math.max(0, (next.saga.tech.points ?? 0) - def.costTp);
  const sc = ensureScrolls(next);
  const turn = next.turn ?? 1;
  const cityNameOf = (k) => world?.cities?.find((c) => c.key === k)?.name || k;

  if (scrollId === "borrow_knife") {
    const aiFactions = Object.keys(next.factions || {}).filter(
      (fid) => fid !== player && Object.values(next.cities).some((c) => c.owner === fid),
    );
    if (aiFactions.length < 2) return { ok: false, reason: "天下敌对诸侯不足两家，无法借刀杀人。" };
    const [f1, f2] = aiFactions.slice(0, 2);
    const c1 = Object.entries(next.cities).filter(([, c]) => c.owner === f1).sort((a, b) => b[1].troops - a[1].troops)[0];
    const c2 = Object.entries(next.cities).filter(([, c]) => c.owner === f2).sort((a, b) => b[1].troops - a[1].troops)[0];
    const l1 = c1 ? Math.min(3500, Math.floor(c1[1].troops * 0.2)) : 0;
    const l2 = c2 ? Math.min(3500, Math.floor(c2[1].troops * 0.2)) : 0;
    if (c1) c1[1].troops = Math.max(800, c1[1].troops - l1);
    if (c2) c2[1].troops = Math.max(800, c2[1].troops - l2);
    next.factions[f1].grain = Math.max(0, (next.factions[f1].grain ?? 0) - 45);
    next.factions[f2].grain = Math.max(0, (next.factions[f2].grain ?? 0) - 45);
    sc.lastUsedTurn = turn;
    return {
      ok: true,
      state: next,
      summary: `【三十六计 · 借刀杀人】离间计成！${cityNameOf(c1?.[0])}与${cityNameOf(c2?.[0])}两强爆发大战，各自损兵 ${l1} / ${l2} 并耗粮 45！`,
    };
  }

  if (scrollId === "empty_fort") {
    const cityKey = targetCityKey && next.cities?.[targetCityKey]?.owner === player
      ? targetCityKey
      : Object.keys(next.cities).find((k) => next.cities[k].owner === player);
    if (!cityKey) return { ok: false, reason: "未找到己方城池。" };
    sc.emptyFortUntil[cityKey] = turn + 2;
    sc.lastUsedTurn = turn;
    return {
      ok: true,
      state: next,
      summary: `【三十六计 · 空城计】${cityNameOf(cityKey)}大开城门抚琴退敌！未来 2 季守备战力暴涨 +45%！`,
    };
  }

  const enemyKey = targetCityKey && next.cities?.[targetCityKey]?.owner !== player
    ? targetCityKey
    : Object.keys(next.cities).find((k) => next.cities[k].owner !== player);
  if (!enemyKey) return { ok: false, reason: "请选择有效的敌方城池。" };

  if (scrollId === "besiege_wei") {
    const dmg = Math.min(3200, Math.max(600, Math.floor(next.cities[enemyKey].troops * 0.18)));
    next.cities[enemyKey].troops = Math.max(600, next.cities[enemyKey].troops - dmg);
    next.cities[enemyKey].defense = Math.max(8, (next.cities[enemyKey].defense ?? 20) - 4);
    // 自动解除针对玩家的所有活跃围城
    if (next.saga?.supply?.sieges) {
      for (const [tk, s] of Object.entries(next.saga.supply.sieges)) {
        if (next.cities?.[tk]?.owner === player) delete next.saga.supply.sieges[tk];
      }
    }
    sc.lastUsedTurn = turn;
    return {
      ok: true,
      state: next,
      summary: `【三十六计 · 围魏救赵】轻骑直捣${cityNameOf(enemyKey)}，歼敌 ${dmg}、毁城防 4，敌军惊慌撤围回救！`,
    };
  }

  if (scrollId === "chain_fire") {
    sc.chainFireUntil[enemyKey] = turn + 2;
    sc.lastUsedTurn = turn;
    return {
      ok: true,
      state: next,
      summary: `【三十六计 · 连环火计】已在${cityNameOf(enemyKey)}暗布火阵！2 季内我军攻城敌防 -24%、城墙 -30%！`,
    };
  }

  return { ok: false, reason: "未处理的锦囊类型。" };
}
