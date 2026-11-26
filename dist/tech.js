import { eraByYear, forceTotals, gameOutcome } from "./engine.js";
import { ensureSaga, recordAnnal } from "./saga.js";
import { knownOfficer } from "./personnel.js";

export const TECH_BRANCHES = [
  { id: "military", name: "兵制军械", desc: "强化野战突击、攻城器械与本势力专属特种精锐。" },
  { id: "civic", name: "治政兴农", desc: "扩增全国屯田粮产、降低远征粮耗并加速技巧积累。" },
  { id: "scheme", name: "奇谋外交", desc: "强化反间流言、火攻奇袭与高阶密谋配额。" },
];

export const TECH_TREE = [
  // Branch 1: Military
  {
    id: "m1_crossbow",
    branch: "military",
    tier: 1,
    requires: null,
    name: "强弩劲骑",
    tp: 120,
    cost: 30,
    desc: "全军正面强攻与城防守御战力 +6%。",
  },
  {
    id: "m2_trebuchet",
    branch: "military",
    tier: 2,
    requires: "m1_crossbow",
    name: "霹雳车队",
    tp: 240,
    cost: 50,
    desc: "「围城破垒」额外削弱城防与关隘 15%，攻城战损 -10%。",
  },
  {
    id: "m3_elite",
    branch: "military",
    tier: 3,
    requires: "m2_trebuchet",
    name: "精锐禁军",
    tp: 400,
    cost: 80,
    desc: "解锁本势力专属历史特种兵，赋予强力专属战场加成。",
  },
  // Branch 2: Civic
  {
    id: "c1_irrigation",
    branch: "civic",
    tier: 1,
    requires: null,
    name: "屯田水利",
    tp: 120,
    cost: 30,
    desc: "全国季度粮产 +12%，增强持久战补给韧性。",
  },
  {
    id: "c2_oxcart",
    branch: "civic",
    tier: 2,
    requires: "c1_irrigation",
    name: "木牛流马",
    tp: 240,
    cost: 50,
    desc: "出征与跨险耗粮 -20%，大军长途奔袭更轻松。",
  },
  {
    id: "c3_academy",
    branch: "civic",
    tier: 3,
    requires: "c2_oxcart",
    name: "太学举贤",
    tp: 400,
    cost: 80,
    desc: "每季技巧点产出 +35%，礼聘在野名士礼金再减 25%。",
  },
  // Branch 3: Scheme
  {
    id: "s1_spies",
    branch: "scheme",
    tier: 1,
    requires: null,
    name: "细作密探",
    tp: 120,
    cost: 30,
    desc: "「反间流言」延长至 3 季且使敌城守防再降（总计 -18%）。",
  },
  {
    id: "s2_firechain",
    branch: "scheme",
    tier: 2,
    requires: "s1_spies",
    name: "火攻连环",
    tp: 240,
    cost: 50,
    desc: "「火攻奇袭」威力 +10%，遭敌智将识破时的反噬减半。",
  },
  {
    id: "s3_grandstrategist",
    branch: "scheme",
    tier: 3,
    requires: "s2_firechain",
    name: "纵横王佐",
    tp: 400,
    cost: 80,
    desc: "所有高阶谋略成功率 +15%，且每季可施密谋提升至 2 次。",
  },
];

export const ELITE_UNITS = {
  cao: { name: "虎豹骑", attackBonus: 0.12, defenseBonus: 0.04, lossReduction: 0.06, captureBonus: 10, duelMight: 2, desc: "曹魏天下骁骑：攻 +12%、生擒率 +10%。" },
  wei: { name: "虎豹骑", attackBonus: 0.12, defenseBonus: 0.04, lossReduction: 0.06, captureBonus: 10, duelMight: 2, desc: "曹魏天下骁骑：攻 +12%、生擒率 +10%。" },
  liu: { name: "白毦无当", attackBonus: 0.10, defenseBonus: 0.08, lossReduction: 0.10, passBonus: 0.08, desc: "蜀汉精锐山地军：攻防兼备、战损 -10%、关隘 +8%。" },
  shu: { name: "白毦无当", attackBonus: 0.10, defenseBonus: 0.08, lossReduction: 0.10, passBonus: 0.08, desc: "蜀汉精锐山地军：攻防兼备、战损 -10%、关隘 +8%。" },
  ce: { name: "楼船丹阳", attackBonus: 0.10, defenseBonus: 0.06, lossReduction: 0.05, riverBonus: 0.12, fireBonus: 0.08, desc: "江东水陆精兵：渡江水战 +12%、火攻 +8%。" },
  wu: { name: "楼船丹阳", attackBonus: 0.10, defenseBonus: 0.06, lossReduction: 0.05, riverBonus: 0.12, fireBonus: 0.08, desc: "江东水陆精兵：渡江水战 +12%、火攻 +8%。" },
  jian: { name: "丹阳精兵", attackBonus: 0.11, defenseBonus: 0.06, lossReduction: 0.06, riverBonus: 0.08, desc: "吴越劲旅：攻 +11%、渡江 +8%。" },
  lvbu: { name: "陷阵并州", attackBonus: 0.15, defenseBonus: 0.04, lossReduction: 0.06, duelMight: 6, desc: "高顺陷阵配并州狼骑：攻 +15%、单挑武力 +6。" },
  yuan: { name: "先登大戟", attackBonus: 0.08, defenseBonus: 0.12, lossReduction: 0.07, siegeBonus: 0.08, desc: "河北重甲精卒：守防 +12%、围城破垒 +8%。" },
  sima: { name: "中军虎贲", attackBonus: 0.09, defenseBonus: 0.09, lossReduction: 0.08, siegeBonus: 0.08, desc: "司马氏禁旅：全面攻防 +9%、破垒 +8%。" },
  jin: { name: "中军虎贲", attackBonus: 0.09, defenseBonus: 0.09, lossReduction: 0.08, siegeBonus: 0.08, desc: "大晋禁军：全面攻防 +9%、破垒 +8%。" },
  ma: { name: "西凉铁骑", attackBonus: 0.14, defenseBonus: 0.03, lossReduction: 0.08, duelMight: 3, desc: "凉州重骑突阵：攻 +14%、战损 -8%。" },
  dong: { name: "西凉铁骑", attackBonus: 0.14, defenseBonus: 0.03, lossReduction: 0.08, duelMight: 3, desc: "西凉飞熊军：攻 +14%、战损 -8%。" },
};

const DEFAULT_ELITE = { name: "亲卫精锐", attackBonus: 0.09, defenseBonus: 0.07, lossReduction: 0.06, desc: "精训亲卫：攻 +9%、守 +7%、战损 -6%。" };

export function factionEliteUnit(factionKey) {
  return ELITE_UNITS[factionKey] ?? DEFAULT_ELITE;
}

export function getTechState(state) {
  return state?.saga?.tech ?? { points: 0, unlocked: [] };
}

export function hasTech(state, techId) {
  if (!state?.century) return false;
  return Boolean(state.saga?.tech?.unlocked?.includes(techId));
}

export function canResearchTech(state, techId) {
  if (!state?.century || gameOutcome(state) !== "ongoing") {
    return { ok: false, reason: "仅限山河大势模式进行中研习技巧。" };
  }
  const def = TECH_TREE.find((t) => t.id === techId);
  if (!def) return { ok: false, reason: "未知的技巧条目。" };
  const tech = getTechState(state);
  if (tech.unlocked.includes(techId)) return { ok: false, reason: "已研习此技巧。" };
  if (def.requires && !tech.unlocked.includes(def.requires)) {
    const req = TECH_TREE.find((t) => t.id === def.requires);
    return { ok: false, reason: `须先研习前置技巧「${req?.name ?? def.requires}」。` };
  }
  if ((tech.points ?? 0) < def.tp) {
    return { ok: false, reason: `技巧点不足（需 ${def.tp}，当前 ${tech.points ?? 0}）。` };
  }
  if ((state.factions[state.player]?.treasury ?? 0) < def.cost) {
    return { ok: false, reason: `国库不足（需 ${def.cost} 钱）。` };
  }
  return { ok: true, def };
}

export function researchTech(world, state, techId) {
  const check = canResearchTech(state, techId);
  if (!check.ok) throw new Error(check.reason);
  const { def } = check;
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  saga.tech ??= { points: 0, unlocked: [] };
  saga.tech.points = Math.max(0, saga.tech.points - def.tp);
  saga.tech.unlocked = [...saga.tech.unlocked, def.id];
  next.factions[next.player].treasury -= def.cost;
  const elite = def.id === "m3_elite" ? factionEliteUnit(next.player) : null;
  const msg = elite
    ? `技巧大成！已解锁本势力专属精锐「${elite.name}」（${elite.desc}）。`
    : `已研习「${def.name}」：${def.desc}`;
  recordAnnal(next, "技巧", msg);
  return { state: next, tech: def, elite, message: msg };
}

export function quarterlyTechPoints(world, era, state) {
  if (!state?.century) return 0;
  const totals = forceTotals(state, state.player);
  const officers = era.officers.filter((o) => o.faction === state.player && knownOfficer(state, o));
  const topGov = officers.reduce((best, o) => Math.max(best, o.governance ?? 50), 50);
  const base = 24 + totals.cities * 5 + Math.round((topGov - 50) * 0.45);
  const academyMult = hasTech(state, "c3_academy") ? 1.35 : 1;
  const sandboxMult = state.saga?.rules?.doubleTech ? 2 : 1;
  return Math.round(base * academyMult * sandboxMult);
}

export function techCombatModifiers(state, faction, tacticId = "assault", terrain = "land") {
  if (!state?.century || faction !== state.player) {
    return { attackMult: 1, defenseMult: 1, wallFactor: 1, lossMult: 1, captureBonus: 0, duelMight: 0, eliteName: null };
  }
  let attackMult = 1;
  let defenseMult = 1;
  let wallFactor = 1;
  let lossMult = 1;
  let captureBonus = 0;
  let duelMight = 0;
  let eliteName = null;

  if (hasTech(state, "m1_crossbow")) {
    if (tacticId === "assault") attackMult *= 1.06;
    defenseMult *= 1.06;
  }
  if (hasTech(state, "m2_trebuchet") && tacticId === "siege") {
    wallFactor *= 0.85;
    lossMult *= 0.90;
  }
  if (hasTech(state, "s2_firechain") && tacticId === "stratagem") {
    attackMult *= 1.10;
  }
  if (hasTech(state, "m3_elite")) {
    const elite = factionEliteUnit(faction);
    eliteName = elite.name;
    attackMult *= 1 + (elite.attackBonus ?? 0);
    defenseMult *= 1 + (elite.defenseBonus ?? 0);
    lossMult *= 1 - (elite.lossReduction ?? 0);
    captureBonus += elite.captureBonus ?? 0;
    duelMight += elite.duelMight ?? 0;
    if (terrain === "river" && elite.riverBonus) attackMult *= 1 + elite.riverBonus;
    if (terrain === "pass" && elite.passBonus) attackMult *= 1 + elite.passBonus;
    if (tacticId === "stratagem" && elite.fireBonus) attackMult *= 1 + elite.fireBonus;
    if (tacticId === "siege" && elite.siegeBonus) attackMult *= 1 + elite.siegeBonus;
  }
  return {
    attackMult: Math.min(1.30, attackMult),
    defenseMult: Math.min(1.25, defenseMult),
    wallFactor: Math.max(0.75, wallFactor),
    lossMult: Math.max(0.78, lossMult),
    captureBonus,
    duelMight,
    eliteName,
  };
}

export function techEconomyModifiers(state, faction) {
  if (!state?.century || faction !== state.player) {
    return { grainYieldMult: 1, marchGrainMult: 1, wildFeeMult: 1 };
  }
  return {
    grainYieldMult: hasTech(state, "c1_irrigation") ? 1.12 : 1,
    marchGrainMult: hasTech(state, "c2_oxcart") ? 0.80 : 1,
    wildFeeMult: hasTech(state, "c3_academy") ? 0.75 : 1,
  };
}

export function techStratagemModifiers(state, faction) {
  if (!state?.century || faction !== state.player) {
    return { rumorDuration: 2, rumorDefenseMult: 0.86, chanceBonus: 0, plotsPerTurn: 1 };
  }
  const hasSpies = hasTech(state, "s1_spies");
  const hasGrand = hasTech(state, "s3_grandstrategist");
  return {
    rumorDuration: hasSpies ? 3 : 2,
    rumorDefenseMult: hasSpies ? 0.82 : 0.86,
    chanceBonus: hasGrand ? 15 : 0,
    plotsPerTurn: hasGrand ? 2 : 1,
  };
}
