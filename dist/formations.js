// v21.0 — 古战五大阵法相克 & 演武场名将特训
// 状态挂在 state.saga.formations 与 state.saga.specialties 下，兼容旧存档与非 century 模式。

export const FORMATION_CATALOG = [
  {
    id: "yulin",
    name: "鱼鳞阵",
    icon: "🛡️",
    counters: "fengshi",
    atkBonus: 0.08,
    defBonus: 0.06,
    lossMult: 0.94,
    summary: "层层叠进、攻守均衡，破坚攻城俱佳，克制「锋矢阵」。",
  },
  {
    id: "heyi",
    name: "鹤翼阵",
    icon: "🦅",
    counters: "yulin",
    atkBonus: 0.07,
    defBonus: 0.04,
    lossMult: 0.9,
    summary: "两翼张开合围敌军，显著降低战损，克制「鱼鳞阵」。",
  },
  {
    id: "fengshi",
    name: "锋矢阵",
    icon: "⚡",
    counters: "heyi",
    atkBonus: 0.14,
    defBonus: -0.04,
    lossMult: 1.04,
    summary: "尖锋直插敌阵中枢，爆发极高突击力，克制「鹤翼阵」。",
  },
  {
    id: "yanyue",
    name: "偃月阵",
    icon: "🌙",
    counters: "bagua",
    atkBonus: 0.11,
    defBonus: 0.02,
    lossMult: 0.96,
    summary: "如新月半抱，水战与奇袭威力倍增，克制「八卦阵」。",
  },
  {
    id: "bagua",
    name: "八卦阵",
    icon: "☯️",
    counters: "yanyue",
    atkBonus: 0.03,
    defBonus: 0.14,
    lossMult: 0.88,
    summary: "奇门遁甲、以静制动，守城御敌极强，克制「偃月阵」。",
  },
];

export const SPECIALTY_BRANCHES = [
  { id: "infantry", name: "步兵", icon: "🗡️" },
  { id: "cavalry", name: "骑兵", icon: "🐎" },
  { id: "archer", name: "弓弩", icon: "🏹" },
  { id: "navy", name: "水师", icon: "⛵" },
];

export const GRADE_LABELS = ["C", "B", "A", "S"];

export function getActiveFormation(state, factionId = state?.player) {
  const id = state?.saga?.formations?.[factionId];
  if (id && FORMATION_CATALOG.some((f) => f.id === id)) return id;
  // 不同 AI 势力默认有各自偏好阵法
  if (factionId === "cao" || factionId === "lvbu" || factionId === "ma") return "fengshi";
  if (factionId === "wu") return "yanyue";
  if (factionId === "liu" || factionId === "shu" || factionId === "sima") return "bagua";
  return "yulin";
}

export function setActiveFormation(state, formationId, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可演练切换古战阵法。" };
  const def = FORMATION_CATALOG.find((f) => f.id === formationId);
  if (!def) return { ok: false, reason: "未知的阵法类型。" };
  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  if (!next.saga.formations) next.saga.formations = {};
  next.saga.formations[actor] = formationId;
  return {
    ok: true,
    state: next,
    summary: `全军已变阵为「${def.icon}${def.name}」：${def.summary}`,
  };
}

export function getOfficerSpecialties(state, officerKey) {
  const rec = state?.saga?.specialties?.[officerKey] || {};
  return {
    infantry: rec.infantry ?? 1,
    cavalry: rec.cavalry ?? 1,
    archer: rec.archer ?? 1,
    navy: rec.navy ?? 0,
  };
}

/**
 * 演武场名将兵种特训：提升某兵种适性（C->B->A->S）并赠与军功
 */
export function trainOfficerSpecialty(era, state, officerKey, branchId) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可开启演武场特训。" };
  const branch = SPECIALTY_BRANCHES.find((b) => b.id === branchId);
  if (!branch) return { ok: false, reason: "未知的兵种方向。" };
  const all = [...(era?.officers || []), ...(state.recruitedOfficers || [])];
  const officer = all.find((o) => o.key === officerKey && o.faction === state.player);
  if (!officer) return { ok: false, reason: "请选择己方现役将领参加演武特训。" };

  const cur = getOfficerSpecialties(state, officerKey);
  const level = cur[branchId] ?? 0;
  if (level >= 3) return { ok: false, reason: `${officer.name}的「${branch.name}」适性已臻化境（S 级）。` };

  const costGold = 30 + level * 15;
  const costGrain = 20;
  const fac = state.factions?.[state.player];
  if (!fac || fac.treasury < costGold || fac.grain < costGrain) {
    return { ok: false, reason: `演武特训需金 ${costGold}、粮 ${costGrain}。` };
  }

  const next = structuredClone(state);
  next.factions[state.player].treasury -= costGold;
  next.factions[state.player].grain -= costGrain;
  if (!next.saga) next.saga = {};
  if (!next.saga.specialties) next.saga.specialties = {};
  next.saga.specialties[officerKey] = { ...cur, [branchId]: level + 1 };
  if (!next.saga.merits) next.saga.merits = {};
  const m = next.saga.merits[officerKey] || { wins: 0, duels: 0, xp: 0, rank: 0 };
  m.xp = (m.xp ?? 0) + 30;
  next.saga.merits[officerKey] = m;

  return {
    ok: true,
    state: next,
    newGrade: GRADE_LABELS[level + 1],
    summary: `【演武特训】${officer.name}苦练${branch.icon}${branch.name}，适性晋升至「${GRADE_LABELS[level + 1]} 级」，军功 +30！`,
  };
}

/**
 * 阵法相克与武将兵种适性战斗修正（接入 engine.js forecastAttack）
 */
export function formationCombatModifiers(state, { attackerFaction, defenderFaction, attackerKey, terrain = "land" }) {
  if (!state?.century) return { attackMult: 1, defenseMult: 1, lossMult: 1, label: "" };
  const attForm = FORMATION_CATALOG.find((f) => f.id === getActiveFormation(state, attackerFaction));
  const defForm = FORMATION_CATALOG.find((f) => f.id === getActiveFormation(state, defenderFaction));

  let attackMult = 1 + (attForm?.atkBonus ?? 0);
  let defenseMult = 1 + (defForm?.defBonus ?? 0);
  let lossMult = attForm?.lossMult ?? 1;
  const notes = [];

  if (attForm && defForm) {
    if (attForm.counters === defForm.id) {
      attackMult += 0.12;
      notes.push(`${attForm.name}克制${defForm.name}`);
    } else if (defForm.counters === attForm.id) {
      defenseMult += 0.1;
      notes.push(`遭${defForm.name}反制`);
    } else {
      notes.push(attForm.name);
    }
  }

  if (attackerKey && state.saga?.specialties?.[attackerKey]) {
    const spec = getOfficerSpecialties(state, attackerKey);
    const best = terrain === "river" ? spec.navy : Math.max(spec.infantry, spec.cavalry, spec.archer);
    if (best >= 2) {
      attackMult += best === 3 ? 0.1 : 0.05;
      notes.push(`兵种适性${GRADE_LABELS[best]}`);
    }
  }

  return {
    attackMult: Number(attackMult.toFixed(3)),
    defenseMult: Number(defenseMult.toFixed(3)),
    lossMult: Number(lossMult.toFixed(3)),
    label: notes.join(" · "),
  };
}
