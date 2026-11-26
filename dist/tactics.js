import { hasTrait, officerMeta } from "./traits.js";

export const DIFFICULTY_LEVELS = {
  standard: {
    id: "standard",
    name: "经略常势",
    short: "常势",
    tag: "均衡对局",
    desc: "列强依史实兵力与常额双令运转，适合体验谋略与州郡治理。",
    aiOrders: 2,
    aiIncomeMult: 1.0,
    aiCombatMult: 1.0,
    aiStartBonus: 0,
    aiStartTroops: 0,
  },
  hard: {
    id: "hard",
    name: "史实激战",
    short: "激战",
    tag: "默认推荐",
    desc: "群雄备边严整，战力小幅加护并积极协防反击，硬仗须善用军策。",
    aiOrders: 2,
    aiIncomeMult: 1.15,
    aiCombatMult: 1.06,
    aiStartBonus: 0.15,
    aiStartTroops: 180,
  },
  hell: {
    id: "hell",
    name: "乱世炼狱",
    short: "炼狱",
    tag: "极限挑战",
    desc: "诸侯精兵云集且每季多令并发、纵横合围，唯善谋全局者方克大业。",
    aiOrders: 3,
    aiIncomeMult: 1.30,
    aiCombatMult: 1.12,
    aiStartBonus: 0.30,
    aiStartTroops: 380,
  },
};

export const DEFAULT_TACTIC = "assault";

export const BATTLE_TACTICS = {
  assault: {
    id: "assault",
    name: "正面强攻",
    short: "强攻",
    treasury: 0,
    grain: 0,
    desc: "依统率武勇堂堂正正冲阵，猛将先登占优，直面坚城战损较高。",
  },
  siege: {
    id: "siege",
    name: "围城破垒",
    short: "破垒",
    treasury: 12,
    grain: 8,
    desc: "造冲车云梯掘壕断围：削弱敌城防 65% 与地利，大幅降低攻方伤亡。",
  },
  stratagem: {
    id: "stratagem",
    name: "火攻奇袭",
    short: "奇袭",
    treasury: 8,
    grain: 0,
    desc: "以智谋较量破敌：主将智高一筹则以弱胜强，若敌智更高反遭识破。",
  },
  rally: {
    id: "rally",
    name: "攻心摇动",
    short: "攻心",
    treasury: 6,
    grain: 0,
    desc: "趁敌新占整顿、民心不稳或士气低落时招降瓦解，战损极低并加速平定。",
  },
};

export function validDifficulty(id) {
  return typeof id === "string" && Object.hasOwn(DIFFICULTY_LEVELS, id);
}

export function difficultyConfig(state) {
  return DIFFICULTY_LEVELS[state?.difficulty] ?? DIFFICULTY_LEVELS.standard;
}

export function validTactic(id) {
  return typeof id === "string" && Object.hasOwn(BATTLE_TACTICS, id);
}

export function normalizeTactic(id) {
  return validTactic(id) ? id : DEFAULT_TACTIC;
}

export function tacticCost(tacticId, state) {
  if (!state?.century) return { treasury: 0, grain: 0 };
  const row = BATTLE_TACTICS[normalizeTactic(tacticId)];
  return { treasury: row.treasury, grain: row.grain };
}

export function isOpeningPrepTurn(state) {
  return Boolean(state?.century && state.turn === 0);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function moraleModifier(morale = 75) {
  return 0.88 + clamp(morale, 15, 100) * 0.0022;
}

export function evaluateTactic({ tacticId, attacker, defender, targetHolding, defenderMorale, state }) {
  const id = normalizeTactic(tacticId);
  const tactic = BATTLE_TACTICS[id];
  if (!state?.century) {
    return {
      id,
      name: tactic.name,
      attackMult: 1,
      defenseMult: 1,
      wallFactor: 1,
      terrainReduction: 0,
      attackerLossMult: 1,
      defenderLossMult: 1,
      postCaptureOccupationDelta: 0,
      extraTreasury: 0,
      extraGrain: 0,
      tag: "",
      summary: "",
    };
  }

  const attMeta = officerMeta(attacker);
  const defMeta = officerMeta(defender);
  const attMight = attMeta.might ?? 50;
  const attInt = attMeta.intellect ?? 50;
  const attGov = attacker?.governance ?? 50;
  const defInt = defender ? (defMeta.intellect ?? 50) : 50;

  let attackMult = 1;
  let defenseMult = 1;
  let wallFactor = 1;
  let terrainReduction = 0;
  let attackerLossMult = 1;
  let defenderLossMult = 1;
  let postCaptureOccupationDelta = 0;
  let tag = tactic.short;
  let summary = "";

  if (id === "assault") {
    const eliteMightBonus = attMight >= 80 ? Math.min(0.14, (attMight - 76) * 0.0055) : 0;
    attackMult = 1 + eliteMightBonus;
    attackerLossMult = 1.06;
    if (eliteMightBonus > 0) {
      tag = "猛将先登";
      summary = `武力先登 +${Math.round(eliteMightBonus * 100)}%`;
    } else {
      tag = "强攻";
      summary = "正面冲阵";
    }
  } else if (id === "siege") {
    attackMult = 0.96;
    wallFactor = 0.35;
    terrainReduction = 0.55;
    attackerLossMult = 0.72;
    defenderLossMult = 1.05;
    tag = "克城破垒";
    summary = "削弱城防 65% · 减损 28%";
  } else if (id === "stratagem") {
    const gap = attInt - defInt;
    const intelBonusTraits = (hasTrait(attacker, "fire") ? 0.05 : 0) + (hasTrait(attacker, "ambush") ? 0.05 : 0);
    if (gap >= 12) {
      const surge = Math.min(0.42, 0.14 + (gap - 12) * 0.008) + intelBonusTraits;
      attackMult = 1 + surge;
      wallFactor = 0.65;
      terrainReduction = 0.3;
      attackerLossMult = 0.76;
      defenderLossMult = 1.18;
      tag = "奇谋破敌";
      summary = `智差 +${gap} · 攻势 +${Math.round(surge * 100)}%`;
    } else if (gap >= 0) {
      const mild = 0.04 + gap * 0.006 + intelBonusTraits * 0.5;
      attackMult = 1 + mild;
      wallFactor = 0.85;
      attackerLossMult = 0.94;
      tag = "奇正相合";
      summary = `智略小胜 +${Math.round(mild * 100)}%`;
    } else {
      const penalty = Math.max(-0.24, gap * 0.009);
      attackMult = 1 + penalty;
      attackerLossMult = 1.22;
      defenderLossMult = 0.9;
      tag = "计略识破";
      summary = `敌智更高 ${Math.round(penalty * 100)}%`;
    }
  } else if (id === "rally") {
    const welfare = targetHolding ? (state.realm?.cities?.[targetHolding.key]?.welfare ?? 68) : 68;
    const occupationVuln = (targetHolding?.occupation ?? 0) * 14;
    const moraleVuln = Math.max(0, 74 - (defenderMorale ?? 75));
    const welfareVuln = Math.max(0, 68 - welfare) * 0.75;
    const polBonus = Math.max(0, attGov - 70) * 0.45 + (hasTrait(attacker, "charisma") ? 10 : 0);
    const vulnerability = occupationVuln + moraleVuln + welfareVuln + polBonus;
    if (vulnerability >= 14) {
      const shake = Math.min(0.36, 0.12 + (vulnerability - 14) * 0.0065);
      defenseMult = 1 - shake;
      attackerLossMult = 0.68;
      defenderLossMult = 0.78;
      postCaptureOccupationDelta = -1;
      tag = "军心摇动";
      summary = `敌防 -${Math.round(shake * 100)}% · 降损加速`;
    } else {
      attackMult = 0.88;
      attackerLossMult = 0.95;
      tag = "敌心稳固";
      summary = "目标民心稳固，攻势略缓";
    }
  }

  return {
    id,
    name: tactic.name,
    attackMult,
    defenseMult,
    wallFactor,
    terrainReduction,
    attackerLossMult,
    defenderLossMult,
    postCaptureOccupationDelta,
    extraTreasury: tactic.treasury,
    extraGrain: tactic.grain,
    tag,
    summary,
  };
}

export function estimateCasualties({ troops, defenders, offense, defense, wins, tacticFx, surrender, century }) {
  if (surrender) {
    return {
      attackerLoss: Math.min(troops - 1, Math.max(1, Math.round(troops * 0.02))),
      defenderLoss: Math.round(defenders * 0.05),
    };
  }
  if (!century) {
    return {
      attackerLoss: Math.min(troops - 1, Math.max(1, Math.round(troops * (wins ? 0.25 : 0.39)))),
      defenderLoss: Math.round(defenders * (wins ? 0.62 : 0.22)),
    };
  }
  const ratio = offense / Math.max(1, defense);
  const attMult = tacticFx?.attackerLossMult ?? 1;
  const defMult = tacticFx?.defenderLossMult ?? 1;

  let baseAttackerRate;
  let baseDefenderRate;
  if (wins) {
    // 惨胜 (ratio ~ 1.0) -> 0.41; 碾压大胜 (ratio >= 1.7) -> 0.16
    baseAttackerRate = clamp(0.42 - Math.max(0, ratio - 1.0) * 0.37, 0.15, 0.44);
    baseDefenderRate = clamp(0.56 + Math.max(0, ratio - 1.0) * 0.16, 0.56, 0.72);
  } else {
    // 冒进惨败 (ratio < 0.7) -> 0.50; 势均力敌惜败 (ratio ~ 0.98) -> 0.33
    baseAttackerRate = clamp(0.32 + Math.max(0, 1.0 - ratio) * 0.42, 0.32, 0.54);
    baseDefenderRate = clamp(0.30 - Math.max(0, 1.0 - ratio) * 0.36, 0.12, 0.32);
  }

  const attackerLoss = Math.min(troops - 1, Math.max(1, Math.round(troops * baseAttackerRate * attMult)));
  const defenderLoss = Math.min(defenders, Math.max(0, Math.round(defenders * baseDefenderRate * defMult)));
  return { attackerLoss, defenderLoss };
}
