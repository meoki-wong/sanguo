// v19.0 — 朝堂法度 & 变法流派（四大中枢国策组合）
// 状态挂在 state.saga.reforms 下，兼容旧存档与非 century 模式。

export const REFORM_SLOTS = [
  {
    slot: "talent",
    title: "选才之制",
    options: [
      {
        id: "meritocracy",
        name: "唯才是举",
        summary: "不拘门第拔擢寒士：每季 +15 TP 科技点，攻战气势 +4%。",
      },
      {
        id: "nine_ranks",
        name: "九品中正",
        summary: "笼络世家大族：全势力钱税 +14%，每季海内声望 +1。",
      },
    ],
  },
  {
    slot: "military",
    title: "兵役之制",
    options: [
      {
        id: "hereditary",
        name: "世兵府兵",
        summary: "常备精锐世袭从军：守城战力 +8%，大军出征耗粮 -15%。",
      },
      {
        id: "bounty",
        name: "募兵赏功",
        summary: "重赏之下必有勇夫：野战攻势 +9%，每季主力重镇额外增兵 350。",
      },
    ],
  },
  {
    slot: "economy",
    title: "农商之制",
    options: [
      {
        id: "tuntian_law",
        name: "曹魏屯田",
        summary: "兵农合一广辟官田：全势力产粮 +18%，粮道补给更稳。",
      },
      {
        id: "maritime_trade",
        name: "江东通商",
        summary: "大兴水陆商贾：全势力商税 +16%，跨州商队收益 +35%。",
      },
    ],
  },
  {
    slot: "justice",
    title: "刑赏之制",
    options: [
      {
        id: "strict_law",
        name: "严刑峻法",
        summary: "信赏必罚、肃清奸细：城防守御 +9%，敌方细作流言效用减半。",
      },
      {
        id: "benevolent",
        name: "宽仁休养",
        summary: "轻徭薄赋与民休息：每季民心士气 +3，攻城己方战损 -10%。",
      },
    ],
  },
];

export const DEFAULT_REFORMS = {
  talent: "meritocracy",
  military: "hereditary",
  economy: "tuntian_law",
  justice: "benevolent",
  lastChangedTurn: -4,
};

export function getReforms(state) {
  const r = state?.saga?.reforms;
  if (!r || typeof r !== "object") return { ...DEFAULT_REFORMS };
  return {
    talent: r.talent || DEFAULT_REFORMS.talent,
    military: r.military || DEFAULT_REFORMS.military,
    economy: r.economy || DEFAULT_REFORMS.economy,
    justice: r.justice || DEFAULT_REFORMS.justice,
    lastChangedTurn: r.lastChangedTurn ?? -4,
  };
}

/**
 * 推行变法：更新指定国策槽位（冷却 2 季，消耗金 40）
 */
export function enactReform(state, slot, optionId, actor = state.player) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可推行朝堂变法。" };
  const slotDef = REFORM_SLOTS.find((s) => s.slot === slot);
  const optDef = slotDef?.options.find((o) => o.id === optionId);
  if (!slotDef || !optDef) return { ok: false, reason: "未知的法度选项。" };

  const cur = getReforms(state);
  if (cur[slot] === optionId) return { ok: false, reason: `本朝当前已施行「${optDef.name}」。` };
  const cooldown = 2;
  const elapsed = (state.turn ?? 1) - (cur.lastChangedTurn ?? -4);
  if (elapsed < cooldown) {
    return { ok: false, reason: `朝堂变法尚在磨合期，需再待 ${cooldown - elapsed} 季。` };
  }

  const fac = state.factions?.[actor];
  const cost = 40;
  if (!fac || fac.treasury < cost) return { ok: false, reason: `颁行变法新制需国库金 ${cost}。` };

  const next = structuredClone(state);
  next.factions[actor].treasury -= cost;
  if (!next.saga) next.saga = {};
  next.saga.reforms = {
    ...cur,
    [slot]: optionId,
    lastChangedTurn: next.turn ?? 1,
  };

  return {
    ok: true,
    state: next,
    summary: `【朝堂变法】颁行「${slotDef.title} · ${optDef.name}」：${optDef.summary}`,
  };
}

/**
 * 法度经济修正（仅作用于玩家势力以保持旧 AI 平衡中性）
 */
export function reformEconomyModifiers(state, factionId) {
  if (!state?.century || factionId !== state.player) {
    return { treasuryMult: 1, grainMult: 1, marchGrainMult: 1, tradeMult: 1 };
  }
  const r = getReforms(state);
  let treasuryMult = 1;
  let grainMult = 1;
  let marchGrainMult = 1;
  let tradeMult = 1;

  if (r.talent === "nine_ranks") treasuryMult += 0.14;
  if (r.economy === "tuntian_law") grainMult += 0.18;
  if (r.economy === "maritime_trade") {
    treasuryMult += 0.16;
    tradeMult += 0.35;
  }
  if (r.military === "hereditary") marchGrainMult *= 0.85;

  return {
    treasuryMult: Number(treasuryMult.toFixed(3)),
    grainMult: Number(grainMult.toFixed(3)),
    marchGrainMult: Number(marchGrainMult.toFixed(3)),
    tradeMult: Number(tradeMult.toFixed(3)),
  };
}

/**
 * 法度战斗修正
 */
export function reformCombatModifiers(state, factionId) {
  if (!state?.century || factionId !== state.player) {
    return { attackMult: 1, defenseMult: 1, lossMult: 1 };
  }
  const r = getReforms(state);
  let attackMult = 1;
  let defenseMult = 1;
  let lossMult = 1;

  if (r.talent === "meritocracy") attackMult += 0.04;
  if (r.military === "bounty") attackMult += 0.09;
  if (r.military === "hereditary") defenseMult += 0.08;
  if (r.justice === "strict_law") defenseMult += 0.09;
  if (r.justice === "benevolent") lossMult *= 0.9;

  return {
    attackMult: Number(attackMult.toFixed(3)),
    defenseMult: Number(defenseMult.toFixed(3)),
    lossMult: Number(lossMult.toFixed(3)),
  };
}

/**
 * 季度结算法度持续收益
 */
export function settleReformsTurn(state) {
  if (!state?.century) return { state, notes: [] };
  const next = structuredClone(state);
  const r = getReforms(next);
  const player = next.player;
  const fac = next.factions?.[player];
  const notes = [];

  if (r.talent === "meritocracy" && next.saga?.tech) {
    next.saga.tech.points = (next.saga.tech.points ?? 0) + 15;
  }
  if (r.talent === "nine_ranks" && next.saga) {
    next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 1);
  }
  if (r.justice === "benevolent" && fac) {
    fac.morale = Math.min(100, (fac.morale ?? 75) + 3);
  }
  if (r.military === "bounty") {
    const owned = Object.entries(next.cities || {}).filter(([, c]) => c.owner === player);
    const hub = owned.sort((a, b) => b[1].troops - a[1].troops)[0];
    if (hub) hub[1].troops = Math.min(40000, hub[1].troops + 350);
  }

  return { state: next, notes };
}
