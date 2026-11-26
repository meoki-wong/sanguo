// v19.0 — 动态粮价黑市 & 跨州丝路商队
// 状态挂在 state.saga.commerce 下，兼容旧存档与非 century 模式。

import { reformEconomyModifiers } from "./reforms.js";

export const TRADE_ROUTES = [
  {
    id: "silk_road",
    name: "河西丝路驼队",
    icon: "🐫",
    costTreasury: 60,
    baseProfit: 34,
    summary: "通商西域河西，每季赚取丰厚丝绸钱税并增海内声望。",
  },
  {
    id: "yangtze_fleet",
    name: "长江楼船商帮",
    icon: "⛵",
    costTreasury: 55,
    baseProfit: 30,
    summary: "往返荆扬水道，每季稳定产出钱粮双收。",
  },
  {
    id: "central_post",
    name: "中原官道商队",
    icon: "🛞",
    costTreasury: 50,
    baseProfit: 26,
    summary: "贯通洛阳许昌邺城，风险低、回本极快。",
  },
];

export const MAX_CARAVANS = 3;

function ensureCommerce(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.commerce || typeof state.saga.commerce !== "object") {
    state.saga.commerce = { grainPrice: 1.0, caravans: [], lastRaidTurn: -3 };
  }
  if (!Array.isArray(state.saga.commerce.caravans)) state.saga.commerce.caravans = [];
  if (typeof state.saga.commerce.grainPrice !== "number") state.saga.commerce.grainPrice = 1.0;
  return state.saga.commerce;
}

export function getMarketSnapshot(state) {
  const c = state?.saga?.commerce || {};
  const price = typeof c.grainPrice === "number" ? c.grainPrice : 1.0;
  const tag = price <= 0.8 ? "谷贱伤农 · 宜囤粮" : price >= 1.35 ? "米珠薪桂 · 宜粜粮" : "市价平稳";
  return {
    grainPrice: Number(price.toFixed(2)),
    tag,
    caravans: Array.isArray(c.caravans) ? c.caravans : [],
    lastRaidTurn: c.lastRaidTurn ?? -3,
  };
}

/**
 * 市场交易：action = "buy_grain" (籴粮) | "sell_grain" (粜粮)
 */
export function tradeMarketGrain(state, action, amount = 50, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用动态黑市粮价。" };
  const qty = Math.max(10, Math.min(200, Math.round(amount)));
  const fac = state.factions?.[actor];
  if (!fac) return { ok: false, reason: "势力不存在。" };
  const snap = getMarketSnapshot(state);
  const goldVal = Math.max(5, Math.round(qty * snap.grainPrice));

  const next = structuredClone(state);
  ensureCommerce(next);
  if (action === "buy_grain") {
    if (fac.treasury < goldVal) return { ok: false, reason: `籴粮 ${qty} 需金 ${goldVal}（当前市价 ${snap.grainPrice}）。` };
    next.factions[actor].treasury -= goldVal;
    next.factions[actor].grain += qty;
    return { ok: true, state: next, summary: `【市集籴粮】以金 ${goldVal} 购入军粮 ${qty}（米价 ${snap.grainPrice}）。` };
  }
  if (action === "sell_grain") {
    if (fac.grain < qty) return { ok: false, reason: `储粮不足 ${qty}，难以粜粮筹饷。` };
    next.factions[actor].grain -= qty;
    next.factions[actor].treasury += goldVal;
    return { ok: true, state: next, summary: `【市集粜粮】售出余粮 ${qty}，筹得军费金 ${goldVal}（米价 ${snap.grainPrice}）。` };
  }
  return { ok: false, reason: "未知的交易类型。" };
}

/**
 * 组建跨州商队
 */
export function launchCaravan(state, routeId, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可组建跨州商队。" };
  const def = TRADE_ROUTES.find((r) => r.id === routeId);
  if (!def) return { ok: false, reason: "未知的商路。" };
  const cur = getMarketSnapshot(state);
  if (cur.caravans.length >= MAX_CARAVANS) return { ok: false, reason: `最多同时经营 ${MAX_CARAVANS} 支跨州商队。` };
  if (cur.caravans.some((c) => c.routeId === routeId)) return { ok: false, reason: `「${def.name}」已在往返通商中。` };

  const fac = state.factions?.[actor];
  if (!fac || fac.treasury < def.costTreasury) {
    return { ok: false, reason: `组建「${def.name}」需本金 ${def.costTreasury}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= def.costTreasury;
  const com = ensureCommerce(next);
  com.caravans.push({ routeId, name: def.name, icon: def.icon, baseProfit: def.baseProfit, launchedTurn: next.turn ?? 1 });
  return {
    ok: true,
    state: next,
    summary: `已组建「${def.icon}${def.name}」，自下季起每季将自动带回丰厚商税！`,
  };
}

/**
 * 战时劫掠敌商：从敌方势力掠夺军费与军粮（冷却 2 季）
 */
export function raidEnemyTrade(state, targetFaction, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式启用劫掠敌商。" };
  if (!targetFaction || targetFaction === actor || !state.factions?.[targetFaction]) {
    return { ok: false, reason: "请选择有效的敌对势力。" };
  }
  const snap = getMarketSnapshot(state);
  if ((state.turn ?? 1) - (snap.lastRaidTurn ?? -3) < 2) {
    return { ok: false, reason: "轻骑游击刚归，需休整 2 季方可再劫敌商。" };
  }
  const next = structuredClone(state);
  const com = ensureCommerce(next);
  com.lastRaidTurn = next.turn ?? 1;

  const enemy = next.factions[targetFaction];
  const stolenGold = Math.min(Math.max(25, Math.floor((enemy.treasury ?? 60) * 0.16)), 65);
  const stolenGrain = Math.min(Math.max(20, Math.floor((enemy.grain ?? 60) * 0.14)), 55);
  enemy.treasury = Math.max(0, (enemy.treasury ?? 0) - stolenGold);
  enemy.grain = Math.max(0, (enemy.grain ?? 0) - stolenGrain);
  next.factions[actor].treasury += stolenGold;
  next.factions[actor].grain += stolenGrain;
  return {
    ok: true,
    state: next,
    stolenGold,
    stolenGrain,
    summary: `【劫掠敌商】游骑截获敌方辎重商队，缴获金 +${stolenGold}、粮 +${stolenGrain}！`,
  };
}

/**
 * 季度结算：刷新黑市动态粮价，结算所有商队利润
 */
export function settleCommerceTurn(state) {
  if (!state?.century) return { state, notes: [] };
  const next = structuredClone(state);
  const com = ensureCommerce(next);
  const notes = [];
  const turn = next.turn ?? 1;

  // 确定性动态波动（结合季节、灾异气候与战火）
  const season = turn % 4; // 0春 1夏 2秋(丰收偏低) 3冬(偏高)
  const seasonOffset = season === 2 ? -0.18 : season === 3 ? 0.2 : season === 0 ? 0.08 : 0.02;
  const climateId = next.saga?.climate?.id || "";
  const climateOffset = climateId === "harvest" ? -0.22 : (climateId === "drought" || climateId === "flood") ? 0.34 : 0;
  const wave = Math.sin(turn * 1.15) * 0.18;
  const rawPrice = 1.0 + seasonOffset + climateOffset + wave;
  com.grainPrice = Number(Math.max(0.65, Math.min(1.85, rawPrice)).toFixed(2));

  // 结算跨州商队
  const player = next.player;
  const fac = next.factions?.[player];
  if (fac && com.caravans.length > 0) {
    const tradeMult = reformEconomyModifiers(next, player).tradeMult;
    let totalGold = 0;
    let totalGrain = 0;
    for (const c of com.caravans) {
      totalGold += Math.round((c.baseProfit ?? 28) * tradeMult);
      if (c.routeId === "yangtze_fleet") totalGrain += 18;
      if (c.routeId === "silk_road" && next.saga) {
        next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 1);
      }
    }
    fac.treasury += totalGold;
    fac.grain += totalGrain;
    notes.push(`【丝路商队】${com.caravans.length} 支商队归来，进献商税金 +${totalGold}${totalGrain ? `、粮 +${totalGrain}` : ""}（本季米价 ${com.grainPrice}）。`);
  }

  return { state: next, notes };
}
