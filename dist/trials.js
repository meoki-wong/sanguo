// v23.0 — 「天命试炼」随机词条种子局（每日/自定义种子，无限重玩）
// 词条挂在 state.saga.trial 下，兼容旧存档与非 century 模式。

import { createGame, eraByYear, playableFactions } from "./engine.js";

export const TRIAL_MODIFIERS = [
  { id: "red_drought", name: "赤地千里", icon: "☀️", summary: "全图产粮 -15%，但粮商奇货可居，考验屯田与粮道！", grainMult: 0.85 },
  { id: "tiger_wolf", name: "虎狼之师", icon: "🐅", summary: "全军野战攻势 +14%，节奏极快、以攻代守！", atkMult: 1.14 },
  { id: "iron_bastion", name: "铜墙铁壁", icon: "🏯", summary: "天下城防坚固 +15%，更考验围城断水与多城合围！", defMult: 1.15 },
  { id: "scholar_age", name: "百家争鸣", icon: "📚", summary: "开局获赠兵技 +150 TP，快速步入三阶精锐决战！", startTp: 150 },
  { id: "golden_era", name: "黄金盛世", icon: "🪙", summary: "全图商税 +20%，开局国库 +100 金！", goldMult: 1.2, startGold: 100 },
  { id: "swift_march", name: "兵贵神速", icon: "⚡", summary: "取消开局整军期，第 0 季即可直接发兵逐鹿！", noPrepTurn: true },
  { id: "fog_chaos", name: "烽火迷局", icon: "🌫️", summary: "强制开启烽火迷雾，胜负系于细作与斥候情报！", fogOfWar: true },
  { id: "fierce_league", name: "天下合纵", icon: "🔥", summary: "强硬反霸联军（14 城即触发合纵讨伐），挑战极限霸业！", fierceCoalition: true },
];

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str || "SANGUO");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export function dailyTrialSeed() {
  const d = new Date();
  return `TRIAL-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function previewTrialBySeed(world, seedText) {
  const cleanSeed = String(seedText || dailyTrialSeed()).trim().toUpperCase().slice(0, 20) || dailyTrialSeed();
  const h = hashSeed(cleanSeed);
  const years = [...(world?.scenarios || [])].map((s) => s.year).sort((a, b) => a - b);
  const year = years[h % years.length] || 208;
  const era = eraByYear(world, year);
  const facs = playableFactions(era);
  const faction = facs[(h >>> 4) % facs.length] || facs[0];

  // 确定性挑选 3 条互不重复的天地词条
  const pool = [...TRIAL_MODIFIERS];
  const picked = [];
  let cur = h >>> 2;
  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = cur % pool.length;
    picked.push(pool.splice(idx, 1)[0]);
    cur = Math.imul(cur ^ 0x9e3779b9, 2654435761) >>> 0;
  }

  return {
    seed: cleanSeed,
    year,
    eraTitle: era?.title || `${year}年`,
    factionKey: faction.key,
    factionName: faction.name,
    modifiers: picked,
  };
}

export function startTrialGame(world, seedText, difficulty = "hard") {
  const spec = previewTrialBySeed(world, seedText);
  const state = createGame(world, spec.year, spec.factionKey, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true, difficulty,
  });

  if (!state.saga) state.saga = {};
  if (!state.saga.rules) state.saga.rules = {};
  if (!state.saga.options) state.saga.options = {};

  for (const m of spec.modifiers) {
    if (m.noPrepTurn) state.saga.rules.noPrepTurn = true;
    if (m.fierceCoalition) state.saga.rules.fierceCoalition = true;
    if (m.fogOfWar) state.saga.options.fogOfWar = true;
    if (m.startTp && state.saga.tech) state.saga.tech.points = (state.saga.tech.points ?? 0) + m.startTp;
    if (m.startGold && state.factions?.[spec.factionKey]) state.factions[spec.factionKey].treasury += m.startGold;
  }

  state.saga.trial = {
    seed: spec.seed,
    modifiers: spec.modifiers.map((m) => m.id),
  };
  return { state, spec };
}

export function trialCombatModifiers(state) {
  const ids = state?.saga?.trial?.modifiers;
  if (!state?.century || !Array.isArray(ids) || !ids.length) return { attackMult: 1, defenseMult: 1 };
  let attackMult = 1;
  let defenseMult = 1;
  for (const id of ids) {
    const def = TRIAL_MODIFIERS.find((m) => m.id === id);
    if (def?.atkMult) attackMult *= def.atkMult;
    if (def?.defMult) defenseMult *= def.defMult;
  }
  return { attackMult: Number(attackMult.toFixed(3)), defenseMult: Number(defenseMult.toFixed(3)) };
}

export function trialEconomyModifiers(state) {
  const ids = state?.saga?.trial?.modifiers;
  if (!state?.century || !Array.isArray(ids) || !ids.length) return { treasuryMult: 1, grainMult: 1 };
  let treasuryMult = 1;
  let grainMult = 1;
  for (const id of ids) {
    const def = TRIAL_MODIFIERS.find((m) => m.id === id);
    if (def?.goldMult) treasuryMult *= def.goldMult;
    if (def?.grainMult) grainMult *= def.grainMult;
  }
  return { treasuryMult: Number(treasuryMult.toFixed(3)), grainMult: Number(grainMult.toFixed(3)) };
}
