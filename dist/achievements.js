import { eraByYear, factionName, forceTotals, gameOutcome } from "./engine.js";
import { hasTech } from "./tech.js";

const ACH_STORAGE_KEY = "jinglue-sanguo:achievements:v1";

export const ACHIEVEMENTS = [
  { id: "first_city", name: "初拓疆土", category: "军事", desc: "任意剧本攻克首座敌城。" },
  { id: "ten_cities", name: "雄踞一方", category: "军事", desc: "单局版图达到 15 座城池。" },
  { id: "half_empire", name: "半壁江山", category: "军事", desc: "单局版图达到 22 座城池。" },
  { id: "unifier", name: "海内一统", category: "大业", desc: "取得任意剧本的最终胜利。" },
  { id: "hell_victory", name: "乱世真龙", category: "挑战", desc: "在「乱世炼狱」难度下取得胜利。" },
  { id: "heroes_251", name: "群英之主", category: "剧本", desc: "在「251 英雄集结」剧本中称霸（≥ 20 城或胜利）。" },
  { id: "first_duel", name: "阵前扬威", category: "名将", desc: "在阵前单挑或舌战中斩获首胜。" },
  { id: "duel_master", name: "无双猛士", category: "名将", desc: "单局累计赢得 3 次阵前单挑或舌战。" },
  { id: "elite_unlocked", name: "虎豹禁军", category: "技巧", desc: "研习兵制终极技巧「精锐禁军」解锁专属特种兵。" },
  { id: "tech_scholar", name: "经国大才", category: "技巧", desc: "单局累计研习 5 项以上技巧。" },
  { id: "wild_patron", name: "三顾茅庐", category: "名将", desc: "礼聘至少 1 名在野传世名士入仕。" },
  { id: "three_wilds", name: "天下归心", category: "名将", desc: "单局礼聘 3 名以上在野名士。" },
  { id: "captive_recruit", name: "化敌为友", category: "名将", desc: "成功劝降 1 名敌方俘将归顺。" },
  { id: "benevolent_ruler", name: "仁德布四海", category: "声望", desc: "君主声望达到 80 以上。" },
  { id: "master_schemer", name: "连环奇谋", category: "谋略", desc: "成功施展「驱虎吞狼」或「传檄劝降」。" },
  { id: "bloodless_win", name: "不战而屈人", category: "谋略", desc: "通过「传檄劝降」和平收复敌方城池。" },
  { id: "coalition_breaker", name: "力破合纵", category: "外交", desc: "成功瓦解或击溃针对己方的反霸联合军。" },
  { id: "loyalist_han", name: "汉室柱石", category: "大业", desc: "面对禅代大议选择恪守臣节、兴复汉室。" },
  { id: "emperor_crown", name: "受禅登极", category: "大业", desc: "称帝建朝，升格为正统朝廷。" },
  { id: "custom_dynasty", name: "自立新朝", category: "沙盒", desc: "以「自创君主」身份在沙盒中扩张至 10 城以上。" },
];

export function loadUnlockedAchievements() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(ACH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveUnlockedAchievements(map) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ACH_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage failures
  }
}

export function evaluateAchievementsForState(world, state) {
  if (!state?.century) return [];
  const earned = [];
  const totals = forceTotals(state, state.player);
  const outcome = gameOutcome(state);
  const saga = state.saga ?? {};
  const wins = state.campaignRecord?.victories ?? 0;
  const annals = saga.annals ?? [];

  if (wins >= 1) earned.push("first_city");
  if (totals.cities >= 15) earned.push("ten_cities");
  if (totals.cities >= 22) earned.push("half_empire");
  if (outcome === "victory") {
    earned.push("unifier");
    if (state.difficulty === "hell") earned.push("hell_victory");
  }
  if (state.year === 251 && (totals.cities >= 20 || outcome === "victory")) earned.push("heroes_251");
  if ((saga.duelWins ?? 0) >= 1) earned.push("first_duel");
  if ((saga.duelWins ?? 0) >= 3) earned.push("duel_master");
  if (hasTech(state, "m3_elite")) earned.push("elite_unlocked");
  if ((saga.tech?.unlocked?.length ?? 0) >= 5) earned.push("tech_scholar");
  if ((saga.wildRecruits?.length ?? 0) >= 1) earned.push("wild_patron");
  if ((saga.wildRecruits?.length ?? 0) >= 3) earned.push("three_wilds");
  if (annals.some((a) => a.tag === "归降")) earned.push("captive_recruit");
  if ((saga.reputation ?? 50) >= 80) earned.push("benevolent_ruler");
  if (annals.some((a) => a.tag === "离间" || a.tag === "降附")) earned.push("master_schemer");
  if (annals.some((a) => a.tag === "降附")) earned.push("bloodless_win");
  if ((saga.coalitionBrokenCount ?? 0) >= 1) earned.push("coalition_breaker");
  if (state.imperialChoice === "loyalist") earned.push("loyalist_han");
  if (state.imperialChoice === "emperor") earned.push("emperor_crown");
  if (saga.custom?.rulerName && totals.cities >= 10) earned.push("custom_dynasty");

  return earned;
}

export function syncAchievements(world, state) {
  const existing = loadUnlockedAchievements();
  const hit = evaluateAchievementsForState(world, state);
  const newlyUnlocked = [];
  const now = new Date().toISOString().slice(0, 10);
  for (const id of hit) {
    if (!existing[id]) {
      existing[id] = now;
      const def = ACHIEVEMENTS.find((a) => a.id === id);
      if (def) newlyUnlocked.push(def);
    }
  }
  if (newlyUnlocked.length) saveUnlockedAchievements(existing);
  return { unlocked: existing, newlyUnlocked };
}

export function evaluateCampaignGrade(world, state) {
  const era = eraByYear(world, state);
  const totals = forceTotals(state, state.player);
  const outcome = gameOutcome(state);
  const wins = state.campaignRecord?.victories ?? 0;
  const defeats = state.campaignRecord?.defeats ?? 0;
  const rep = state.saga?.reputation ?? 50;
  const techCount = state.saga?.tech?.unlocked?.length ?? 0;
  const diffMult = state.difficulty === "hell" ? 1.25 : state.difficulty === "hard" ? 1.1 : 1.0;

  let score = totals.cities * 14 + wins * 8 - defeats * 5 + Math.round(rep * 0.8) + techCount * 15 + (state.saga?.duelWins ?? 0) * 12;
  if (outcome === "victory") {
    score += 180 + Math.max(0, 120 - state.turn * 3);
  }
  score = Math.round(score * diffMult);

  let grade = "C";
  let verdict = "初露锋芒，尚待积势图强";
  if (score >= 620 || (outcome === "victory" && state.turn <= 36)) {
    grade = "S";
    verdict = "经天纬地，千古一帝之气象";
  } else if (score >= 420 || outcome === "victory") {
    grade = "A";
    verdict = "雄才大略，威加海内四方";
  } else if (score >= 220) {
    grade = "B";
    verdict = "一方雄主，足以争衡中原";
  }

  const fName = state.saga?.custom?.stateName || factionName(era, state.player);
  const shareText = `【经略三国 · 史官总评 ${grade} 级】${state.year}年「${era.title}」· ${fName}：历 ${state.turn} 季，辖 ${totals.cities}/44 城，战绩 ${wins}胜${defeats}负，声望 ${rep}，技巧 ${techCount}/9（评分 ${score} · ${verdict}）。`;
  return { grade, score, verdict, shareText };
}
