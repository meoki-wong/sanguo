// v19.0 — 「名战残局」6 大历史绝境挑战模式
// 一键开局进入高燃紧凑残局，限定回合达成目标赢取金/银/铜牌认证！

import { createGame } from "./engine.js";

const STORAGE_KEY = "jinglue_sanguo_v19_challenges";

export const CHALLENGE_SCENARIOS = [
  {
    id: "guandu",
    title: "官渡绝境 · 以寡敌众",
    year: 199,
    faction: "cao",
    turnLimit: 8,
    goalCities: 13,
    targetCity: "ye",
    targetCityName: "邺城",
    brief: "袁绍挟河北十万大军南下，许昌兵粮告急。限 8 季内稳守中原并夺取邺城或扩至 13 城！",
    setup: { treasuryDelta: -30, grainDelta: -25, morale: 78, extraTp: 100 },
  },
  {
    id: "chibi",
    title: "赤壁火风 · 借风破曹",
    year: 208,
    faction: "wu",
    turnLimit: 8,
    goalCities: 10,
    targetCity: "jiangling",
    targetCityName: "江陵",
    brief: "曹军八十万饮马长江，江东危在旦夕。限 8 季内依托水师火攻反克江陵或占领 10 城！",
    setup: { treasuryDelta: 40, grainDelta: 40, morale: 85, extraTp: 120 },
  },
  {
    id: "hefei",
    title: "合肥八百 · 威震逍遥津",
    year: 208,
    faction: "cao",
    turnLimit: 6,
    goalCities: 22,
    targetCity: "jianye",
    targetCityName: "建业",
    brief: "江东重兵压境淮南，限 6 季内以精骑奇袭威震东南，攻克建业或版图达 22 城！",
    setup: { treasuryDelta: 20, grainDelta: 30, morale: 88, extraTp: 120 },
  },
  {
    id: "yiling",
    title: "夷陵雪恨 · 连营反杀",
    year: 219,
    faction: "liu",
    turnLimit: 8,
    goalCities: 12,
    targetCity: "xiangyang",
    targetCityName: "襄阳",
    brief: "关羽北伐襄樊风起云涌，限 8 季内稳固益荆两线，夺取襄阳或版图扩至 12 城！",
    setup: { treasuryDelta: 50, grainDelta: 50, morale: 84, extraTp: 120 },
  },
  {
    id: "jieting",
    title: "街亭挽澜 · 祁山定陇",
    year: 234,
    faction: "shu",
    turnLimit: 8,
    goalCities: 10,
    targetCity: "tianshui",
    targetCityName: "天水",
    brief: "陇右咽喉危急，限 8 季内稳住汉中并克复天水或扩至 10 城，重燃北伐之火！",
    setup: { treasuryDelta: 60, grainDelta: 60, morale: 82, extraTp: 140 },
  },
  {
    id: "wuzhang",
    title: "五丈原续命 · 克复长安",
    year: 234,
    faction: "shu",
    turnLimit: 10,
    goalCities: 12,
    targetCity: "changan",
    targetCityName: "长安",
    brief: "武侯最后一次北伐！限 10 季内突破司马懿防线，克复故都长安或占领 12 城！",
    setup: { treasuryDelta: 80, grainDelta: 80, morale: 90, extraTp: 160 },
  },
];

export function loadChallengeMedals() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveChallengeMedal(challengeId, medal) {
  const rank = { gold: 3, silver: 2, bronze: 1 };
  const map = loadChallengeMedals();
  if (!map[challengeId] || (rank[medal] ?? 0) > (rank[map[challengeId]] ?? 0)) {
    map[challengeId] = medal;
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {}
  }
  return map;
}

/**
 * 启动指定的名战残局挑战
 */
export function startChallengeScenario(world, challengeId, difficulty = "hard") {
  const def = CHALLENGE_SCENARIOS.find((c) => c.id === challengeId);
  if (!def) throw new Error(`未知的名战残局：${challengeId}`);
  const state = createGame(world, def.year, def.faction, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true, difficulty,
  });
  const fac = state.factions?.[def.faction];
  if (fac) {
    fac.treasury = Math.max(40, (fac.treasury ?? 100) + (def.setup.treasuryDelta ?? 0));
    fac.grain = Math.max(40, (fac.grain ?? 100) + (def.setup.grainDelta ?? 0));
    fac.morale = def.setup.morale ?? 82;
  }
  if (!state.saga) state.saga = {};
  if (!state.saga.rules) state.saga.rules = {};
  // 残局允许首季直接出击，节奏更紧凑
  state.saga.rules.noPrepTurn = true;
  if (state.saga.tech) state.saga.tech.points = (state.saga.tech.points ?? 0) + (def.setup.extraTp ?? 100);
  const ownedCount = Object.values(state.cities || {}).filter((c) => c.owner === def.faction).length;
  const effectiveGoal = Math.max(def.goalCities, ownedCount + 3);
  const validTarget = def.targetCity && state.cities?.[def.targetCity]?.owner !== def.faction ? def.targetCity : "";
  state.saga.challenge = {
    id: def.id,
    title: def.title,
    turnLimit: def.turnLimit,
    goalCities: effectiveGoal,
    targetCity: validTarget,
    targetCityName: validTarget ? def.targetCityName : `${effectiveGoal} 城`,
    status: "active",
    medal: null,
  };
  return state;
}

/**
 * 评估当前局内残局挑战状态（胜/负/进行中 与 金银铜牌）
 */
export function evaluateChallengeProgress(state) {
  const ch = state?.saga?.challenge;
  if (!ch) return null;
  const player = state.player;
  const ownedCount = Object.values(state.cities || {}).filter((c) => c.owner === player).length;
  const holdsTarget = Boolean(ch.targetCity && state.cities?.[ch.targetCity]?.owner === player);
  const turnsUsed = state.turn ?? 0;
  const turnsLeft = Math.max(0, ch.turnLimit - turnsUsed);

  if (holdsTarget || ownedCount >= ch.goalCities) {
    const medal = turnsUsed <= Math.ceil(ch.turnLimit * 0.55) ? "gold" : turnsUsed <= Math.ceil(ch.turnLimit * 0.8) ? "silver" : "bronze";
    saveChallengeMedal(ch.id, medal);
    return {
      ...ch,
      status: "won",
      medal,
      ownedCount,
      holdsTarget,
      turnsLeft,
      headline: `残局大捷！以 ${turnsUsed} 季达成目标，获颁「${medal === "gold" ? "金牌" : medal === "silver" ? "银牌" : "铜牌"}」认证！`,
    };
  }
  if (turnsUsed >= ch.turnLimit) {
    return {
      ...ch,
      status: "failed",
      medal: null,
      ownedCount,
      holdsTarget,
      turnsLeft: 0,
      headline: `限期已至（${ch.turnLimit} 季），未能达成残局目标，可重整旗鼓再战。`,
    };
  }
  return {
    ...ch,
    status: "active",
    medal: null,
    ownedCount,
    holdsTarget,
    turnsLeft,
    headline: `剩余 ${turnsLeft} 季 · 目标：攻克${ch.targetCityName} 或 辖城达 ${ch.goalCities} 城（当前 ${ownedCount} 城）`,
  };
}
