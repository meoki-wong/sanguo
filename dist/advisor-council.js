// v20.0 — 首席军师「三策献言」& 一键成套执行
// 结合实时国库、粮草、城建、兵技与边境敌情，由麾下首席智囊拟定上/中/下三策。

import { cityBuildings, citySlotLimit, constructBuilding } from "./buildings.js";
import { isSupplyCut, raidSupplyLine } from "./supply.js";
import { launchCaravan, tradeMarketGrain } from "./commerce.js";
import { getTechState, researchTech, TECH_TREE } from "./tech.js";

function findChiefAdvisor(era, state) {
  const player = state.player;
  const pool = [
    ...(era?.officers || []).filter((o) => o.faction === player),
    ...(state.recruitedOfficers || []).filter((o) => o.faction === player),
  ];
  if (!pool.length) return { name: "中枢幕僚", intel: 82 };
  const sorted = [...pool].sort((a, b) => (b.intel ?? b.governance ?? 70) - (a.intel ?? a.governance ?? 70));
  return { name: sorted[0].name, intel: sorted[0].intel ?? sorted[0].governance ?? 82 };
}

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
 * 实时生成首席军师「上 / 中 / 下」三策建议
 */
export function buildAdvisorPlans(world, era, state) {
  if (!state?.century) return { advisor: { name: "幕僚", intel: 80 }, plans: [] };
  const advisor = findChiefAdvisor(era, state);
  const player = state.player;
  const fac = state.factions?.[player] || { treasury: 0, grain: 0 };
  const cityNameOf = (k) => world?.cities?.find((c) => c.key === k)?.name || k;
  const adj = buildAdj(world);
  const owned = Object.keys(state.cities || {}).filter((k) => state.cities[k].owner === player);
  const ownedSet = new Set(owned);

  // 找一个最值得打击的相邻敌城
  const enemyFront = Object.entries(state.cities || {})
    .filter(([ck, c]) => c.owner !== player && (adj.get(ck) || []).some((n) => ownedSet.has(n)))
    .sort((a, b) => b[1].troops - a[1].troops)[0];

  // 找一个可兴建建筑的富城
  const buildCity = owned
    .filter((k) => cityBuildings(state, k).length < citySlotLimit(k))
    .sort((a, b) => (state.cities[b].farm + state.cities[b].commerce) - (state.cities[a].farm + state.cities[a].commerce))[0];

  // 找一项可研习的科技
  const tech = getTechState(state);
  const readyTech = TECH_TREE.find(
    (t) => !tech.unlocked.includes(t.id)
      && (!t.requires || tech.unlocked.includes(t.requires))
      && (tech.points ?? 0) >= t.costTp
      && fac.treasury >= t.costTreasury,
  );

  const plans = [
    {
      id: "upper_strike",
      rank: "上策 · 奇正破敌",
      title: enemyFront ? `断${cityNameOf(enemyFront[0])}粮道 · 研兵备战` : "整军经武 · 研习兵技",
      speech: enemyFront
        ? `「主公，敌军屯重兵于${cityNameOf(enemyFront[0])}。可遣轻骑夜袭其粮道，同时整军研技，不战而屈人之兵！」`
        : `「主公，当下正宜整饬军备、研习兵技，蓄锐待发！」`,
      steps: [
        enemyFront && !isSupplyCut(state, enemyFront[0]) ? `奇兵断${cityNameOf(enemyFront[0])}粮道（35金30粮）` : "前线主力城增补锐卒 450 人",
        readyTech ? `立即研习科技「${readyTech.name}」` : "全军士气振奋 +5",
      ],
      targetEnemyCity: enemyFront?.[0] || null,
      readyTechId: readyTech?.id || null,
    },
    {
      id: "middle_build",
      rank: "中策 · 富国兴邦",
      title: buildCity ? `${cityNameOf(buildCity)}兴屯田 · 开商路` : "通商籴粮 · 广积资财",
      speech: `「主公，兵马未动粮草先行。今宜在腹心重镇兴修农商设施，并遣商队通市，令国库充盈无虞！」`,
      steps: [
        buildCity ? `在${cityNameOf(buildCity)}修筑「屯田营 / 太学书院」` : "市集低价籴粮或调剂军资",
        "若资金充裕自动组建跨州商队，每季稳收商税",
      ],
      buildCityKey: buildCity || null,
    },
    {
      id: "lower_fortify",
      rank: "下策 · 固本休养",
      title: "深沟高垒 · 抚民安军",
      speech: `「主公，连年征战将士疲敝。今宜加固边境城防、轻徭抚民，待敌疲敝再图大举！」`,
      steps: [
        "边境重镇城防全面加固 +2，守军休整增补",
        "全军民心士气恢复 +6，国库稳健节流",
      ],
    },
  ];

  return { advisor, plans };
}

/**
 * 一键成套执行军师献策
 */
export function executeAdvisorStrategy(world, era, state, planId) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可一键执行军师三策。" };
  const { advisor, plans } = buildAdvisorPlans(world, era, state);
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return { ok: false, reason: "未找到对应军师方略。" };

  let cur = structuredClone(state);
  const player = cur.player;
  const doneLogs = [];

  if (planId === "upper_strike") {
    if (plan.targetEnemyCity && !isSupplyCut(cur, plan.targetEnemyCity)) {
      const r = raidSupplyLine(world, cur, plan.targetEnemyCity, player);
      if (r.ok) { cur = r.state; doneLogs.push("已奇袭敌城粮道"); }
    }
    if (plan.readyTechId) {
      const t = researchTech(world, cur, plan.readyTechId);
      if (t?.state) { cur = t.state; doneLogs.push("已研习兵技"); }
    }
    const front = Object.keys(cur.cities).filter((k) => cur.cities[k].owner === player)
      .sort((a, b) => cur.cities[b].troops - cur.cities[a].troops)[0];
    if (front) {
      cur.cities[front].troops = Math.min(40000, cur.cities[front].troops + 450);
      doneLogs.push("主力整军 +450");
    }
    if (cur.factions[player]) cur.factions[player].morale = Math.min(100, (cur.factions[player].morale ?? 75) + 5);
  } else if (planId === "middle_build") {
    if (plan.buildCityKey) {
      const built = cityBuildings(cur, plan.buildCityKey);
      const pick = !built.includes("tuntian") ? "tuntian" : !built.includes("academy") ? "academy" : "granary";
      const b = constructBuilding(world, cur, plan.buildCityKey, pick, player);
      if (b.ok) { cur = b.state; doneLogs.push(b.summary); }
    }
    const car = launchCaravan(cur, "central_post", player);
    if (car.ok) {
      cur = car.state;
      doneLogs.push("已遣中原官道商队");
    } else if ((cur.factions[player]?.treasury ?? 0) >= 55 && (cur.factions[player]?.grain ?? 0) < 220) {
      const tr = tradeMarketGrain(cur, "buy_grain", 50, player);
      if (tr.ok) { cur = tr.state; doneLogs.push("已籴粮 50 充实军仓"); }
    }
  } else if (planId === "lower_fortify") {
    const owned = Object.keys(cur.cities).filter((k) => cur.cities[k].owner === player);
    let count = 0;
    for (const ck of owned.slice(0, 4)) {
      cur.cities[ck].defense = Math.min(45, (cur.cities[ck].defense ?? 20) + 2);
      cur.cities[ck].troops = Math.min(38000, cur.cities[ck].troops + 220);
      count += 1;
    }
    if (cur.factions[player]) cur.factions[player].morale = Math.min(100, (cur.factions[player].morale ?? 75) + 6);
    doneLogs.push(`加固 ${count} 座重镇城防并休整全军士气 +6`);
  }

  return {
    ok: true,
    state: cur,
    summary: `【${advisor.name}献策 · ${plan.rank}】已一键落实：${doneLogs.join("；") || "全军整备完成"}。`,
  };
}
