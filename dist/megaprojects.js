// v24.0 — 跨州超级工程（水利与驰道基建，分 3 期施工永久改写地缘）
// 状态挂在 state.saga.megaprojects 下，兼容旧存档与非 century 模式。

export const MEGAPROJECTS = [
  {
    id: "dujiangyan",
    name: "都江堰修浚",
    icon: "🌊",
    costPerStage: { treasury: 60, grain: 35 },
    stages: 3,
    summary: "竣工后全势力产粮 +16%，西南永免水患之忧。",
    bonus: { grainMult: 0.16 },
  },
  {
    id: "zhengguo",
    name: "郑国渠复通",
    icon: "🌾",
    costPerStage: { treasury: 65, grain: 30 },
    stages: 3,
    summary: "竣工后全势力钱粮双收 +12%，关中沃野千里。",
    bonus: { treasuryMult: 0.12, grainMult: 0.12 },
  },
  {
    id: "hangou",
    name: "邗沟大运河",
    icon: "⛵",
    costPerStage: { treasury: 70, grain: 35 },
    stages: 3,
    summary: "竣工后全势力商税 +14%，临江水战攻势 +15%。",
    bonus: { treasuryMult: 0.14, riverAtk: 0.15 },
  },
  {
    id: "hanshui_dam",
    name: "汉水铁坝防线",
    icon: "🛡️",
    costPerStage: { treasury: 65, grain: 30 },
    stages: 3,
    summary: "竣工后全军守御 +12%，边境固若金汤。",
    bonus: { defenseMult: 0.12 },
  },
  {
    id: "imperial_roads",
    name: "九州驰道驿网",
    icon: "🛣️",
    costPerStage: { treasury: 75, grain: 35 },
    stages: 3,
    summary: "竣工后全军远征粮耗 -25%、野战攻势 +8%。",
    bonus: { marchGrainMult: 0.75, attackMult: 0.08 },
  },
];

function ensureMega(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.megaprojects || typeof state.saga.megaprojects !== "object") {
    state.saga.megaprojects = {};
  }
  return state.saga.megaprojects;
}

export function listMegaprojectsStatus(state) {
  const map = state?.saga?.megaprojects || {};
  return MEGAPROJECTS.map((p) => {
    const progress = Math.min(p.stages, map[p.id] ?? 0);
    return { ...p, progress, completed: progress >= p.stages };
  });
}

/**
 * 拨款推进超级工程一期施工（共 3 期竣工）
 */
export function fundMegaprojectStage(state, projectId, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可兴修跨州超级工程。" };
  const def = MEGAPROJECTS.find((p) => p.id === projectId);
  if (!def) return { ok: false, reason: "未知的工程项目。" };
  const curProg = state.saga?.megaprojects?.[projectId] ?? 0;
  if (curProg >= def.stages) return { ok: false, reason: `「${def.name}」早已竣工并惠泽九州。` };

  const fac = state.factions?.[actor];
  if (!fac || fac.treasury < def.costPerStage.treasury || fac.grain < def.costPerStage.grain) {
    return { ok: false, reason: `推进「${def.name}」第 ${curProg + 1} 期需金 ${def.costPerStage.treasury}、粮 ${def.costPerStage.grain}。` };
  }

  const next = structuredClone(state);
  next.factions[actor].treasury -= def.costPerStage.treasury;
  next.factions[actor].grain -= def.costPerStage.grain;
  const mega = ensureMega(next);
  mega[projectId] = curProg + 1;
  const done = mega[projectId] >= def.stages;
  if (done && next.saga) {
    next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 6);
  }
  return {
    ok: true,
    completed: done,
    state: next,
    summary: done
      ? `【千秋功业 · ${def.icon}${def.name}竣工！】${def.summary}（海内声望 +6）`
      : `已拨款推进「${def.icon}${def.name}」至第 ${mega[projectId]}/${def.stages} 期施工。`,
  };
}

export function megaprojectEconomyModifiers(state, factionId) {
  if (!state?.century || factionId !== state.player) return { treasuryMult: 1, grainMult: 1, marchGrainMult: 1 };
  let treasuryMult = 1;
  let grainMult = 1;
  let marchGrainMult = 1;
  for (const p of listMegaprojectsStatus(state)) {
    if (!p.completed) continue;
    treasuryMult += p.bonus.treasuryMult ?? 0;
    grainMult += p.bonus.grainMult ?? 0;
    if (p.bonus.marchGrainMult) marchGrainMult *= p.bonus.marchGrainMult;
  }
  return {
    treasuryMult: Number(treasuryMult.toFixed(3)),
    grainMult: Number(grainMult.toFixed(3)),
    marchGrainMult: Number(marchGrainMult.toFixed(3)),
  };
}

export function megaprojectCombatModifiers(state, factionId, terrain = "land") {
  if (!state?.century || factionId !== state.player) return { attackMult: 1, defenseMult: 1 };
  let attackMult = 1;
  let defenseMult = 1;
  for (const p of listMegaprojectsStatus(state)) {
    if (!p.completed) continue;
    attackMult += p.bonus.attackMult ?? 0;
    defenseMult += p.bonus.defenseMult ?? 0;
    if (terrain === "river" && p.bonus.riverAtk) attackMult += p.bonus.riverAtk;
  }
  return {
    attackMult: Number(attackMult.toFixed(3)),
    defenseMult: Number(defenseMult.toFixed(3)),
  };
}
