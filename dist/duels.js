import { officerService, promotionCost } from "./campaign.js";
import { knownOfficer } from "./personnel.js";
import { isOfficerUnavailable } from "./saga.js";
import { techCombatModifiers } from "./tech.js";
import { activeBondsForOfficer, hasTrait, officerMeta } from "./traits.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function deterministicHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic 3-round Duel (阵前单挑) or Debate (阵前舌战) resolved inside battle.
 * Only activates in century mode when both attacker and defender are named officers.
 */
export function resolveBattleDuel(era, state, { attacker, defender, tacticId, cityKey, attFaction, defFaction }) {
  if (!state?.century || !attacker || !defender) return null;
  const attMeta = officerMeta(attacker);
  const defMeta = officerMeta(defender);
  const attMight = attMeta.might ?? 60;
  const defMight = defMeta.might ?? 60;
  const attInt = attMeta.intellect ?? 60;
  const defInt = defMeta.intellect ?? 60;

  let kind = null;
  if ((tacticId === "stratagem" || tacticId === "rally") && attInt >= 82 && defInt >= 80) {
    kind = "debate";
  } else if ((tacticId === "assault" && (attMight >= 76 || defMight >= 76)) || (attMight >= 82 && defMight >= 80)) {
    kind = "duel";
  }
  if (!kind) return null;

  const seed = deterministicHash(`${state.turn}:${cityKey}:${attacker.key}:${defender.key}:${tacticId}`);
  // Trigger roughly 65% of eligible clashes (100% when both are legendary >= 90)
  const legendary = kind === "duel" ? (attMight >= 90 && defMight >= 88) : (attInt >= 90 && defInt >= 88);
  if (!legendary && (seed % 100) >= 68) return null;

  const attTech = techCombatModifiers(state, attFaction, tacticId);
  const defTech = techCombatModifiers(state, defFaction, tacticId);
  const attBond = activeBondsForOfficer(era, state, attFaction, attacker);
  const defBond = activeBondsForOfficer(era, state, defFaction, defender);

  const attBase = kind === "duel"
    ? attMight + (hasTrait(attacker, "cavalry") ? 4 : 0) + (hasTrait(attacker, "ambush") ? 3 : 0) + attTech.duelMight + (attBond.bonds.length ? 3 : 0)
    : attInt + (hasTrait(attacker, "fire") ? 4 : 0) + (hasTrait(attacker, "charisma") ? 4 : 0) + (attBond.bonds.length ? 3 : 0);
  const defBase = kind === "duel"
    ? defMight + (hasTrait(defender, "fortress") ? 4 : 0) + (hasTrait(defender, "cavalry") ? 3 : 0) + defTech.duelMight + (defBond.bonds.length ? 3 : 0)
    : defInt + (hasTrait(defender, "charisma") ? 4 : 0) + (hasTrait(defender, "logistics") ? 3 : 0) + (defBond.bonds.length ? 3 : 0);

  let attHp = 100;
  let defHp = 100;
  const rounds = [];
  const duelVerbs = ["骤马突刺", "横槊力劈", "回马奇招"];
  const debateVerbs = ["引经据典", "攻心破辩", "大义折锋"];

  for (let r = 0; r < 3; r += 1) {
    const rSeed = (seed >> (r * 7)) & 0xff;
    const attSwing = ((rSeed % 15) - 6) + Math.round((attBase - defBase) * 0.72);
    const defSwing = (((rSeed >> 3) % 15) - 6) + Math.round((defBase - attBase) * 0.72);
    const dmgToDef = clamp(24 + attSwing, 10, 48);
    const dmgToAtt = clamp(24 + defSwing, 10, 48);
    defHp = Math.max(0, defHp - dmgToDef);
    attHp = Math.max(0, attHp - dmgToAtt);
    const verb = (kind === "duel" ? duelVerbs : debateVerbs)[r];
    rounds.push({
      round: r + 1,
      attHp,
      defHp,
      text: dmgToDef >= dmgToAtt
        ? `第${r + 1}合：${attacker.name}${verb}占得上风（${defender.name}气势 -${dmgToDef}）`
        : `第${r + 1}合：${defender.name}${verb}反制压迫（${attacker.name}气势 -${dmgToAtt}）`,
    });
    if (attHp === 0 || defHp === 0) break;
  }

  let winner = "draw";
  if (attHp > defHp + 4) winner = "attacker";
  else if (defHp > attHp + 4) winner = "defender";

  const decisive = Math.abs(attHp - defHp) >= 30 || attHp === 0 || defHp === 0;
  const label = kind === "duel" ? "阵前单挑" : "阵前舌战";
  const headline = winner === "attacker"
    ? `${label}：${attacker.name}${decisive ? "大破" : "力压"}${defender.name}，三军士气大振！`
    : winner === "defender"
      ? `${label}：${defender.name}${decisive ? "挫败" : "挡住"}${attacker.name}锋芒，守军齐声喝彩！`
      : `${label}：${attacker.name}与${defender.name}战成平手，不分轩轾。`;

  return {
    kind,
    label,
    attacker: attacker.key,
    attackerName: attacker.name,
    defender: defender.key,
    defenderName: defender.name,
    attStat: kind === "duel" ? attMight : attInt,
    defStat: kind === "duel" ? defMight : defInt,
    attHp,
    defHp,
    winner,
    decisive,
    rounds,
    headline,
    attackMult: winner === "attacker" ? (decisive ? 1.15 : 1.10) : (winner === "defender" ? 0.94 : 1),
    defenseMult: winner === "defender" ? (decisive ? 1.14 : 1.08) : (winner === "attacker" ? 0.94 : 1),
    attMoraleDelta: winner === "attacker" ? 4 : winner === "defender" ? -4 : 0,
    defMoraleDelta: winner === "attacker" ? -5 : winner === "defender" ? 4 : 0,
    captureBonus: winner === "attacker" ? (decisive ? 24 : 16) : 0,
  };
}

export function officerRankTitle(state, officer) {
  if (!officer) return "偏裨";
  const svc = officerService(state, officer.key);
  const totalRank = (svc.commandRank ?? 0) + (svc.governanceRank ?? 0);
  const military = (officer.command ?? 50) >= (officer.governance ?? 50);
  if (military) {
    return ["偏将军", "征讨将军", "镇国大将军", "大司马"][Math.min(3, totalRank)];
  }
  return ["功曹参军", "治中别驾", "尚书仆射", "丞相录尚书"][Math.min(3, totalRank)];
}

export function promotableOfficers(era, state) {
  if (!era?.officers || !state) return [];
  const rows = [];
  for (const person of era.officers) {
    if (person.faction !== state.player || !knownOfficer(state, person) || isOfficerUnavailable(state, person.key)) continue;
    if (!state.stations?.[person.key]) continue;
    const svc = officerService(state, person.key);
    for (const skill of ["command", "governance"]) {
      const req = promotionCost(state, person.key, skill);
      if (req !== null && svc[skill] >= req) {
        rows.push({
          officer: person,
          skill,
          skillLabel: skill === "command" ? "统率" : "政务",
          currentTitle: officerRankTitle(state, person),
          service: svc,
        });
      }
    }
  }
  return rows;
}
