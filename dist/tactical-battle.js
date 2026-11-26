// v18.0 — 互动式「三回合临阵微操」攻城战引擎
// 3 阶段：接战破阵 -> 中军决胜 -> 登城/追击
// 纯函数设计，既可供前端交互式弹窗逐回合下令，也可一键委任自动结案。

export const TACTICAL_PHASES = [
  { id: "vanguard", index: 0, title: "第一阵 · 接战破阵", subtitle: "两军初交，定先手气势与破障之策" },
  { id: "center", index: 1, title: "第二阵 · 中军决胜", subtitle: "主力鏖战，以奇谋兵种瓦解敌军中枢" },
  { id: "breach", index: 2, title: "第三阵 · 登城定鼎", subtitle: "乘胜攻心，破城夺关或全军保锐" },
];

export const TACTICAL_ORDERS = {
  vanguard: [
    {
      id: "cavalry_wedge",
      name: "铁骑凿阵",
      tag: "武勇突击",
      stat: "war",
      summary: "以精骑直插敌阵薄弱处，大幅提升攻势，略有战损。",
      atkDelta: 0.14,
      defDelta: 0,
      lossDelta: 0.06,
      moraleDelta: 8,
    },
    {
      id: "fire_camp",
      name: "火攻连营",
      tag: "智谋火计",
      stat: "intel",
      summary: "顺风纵火焚其鹿角营寨；旱晴天威力倍增，雨雪天受阻。",
      atkDelta: 0.16,
      defDelta: -0.08,
      lossDelta: -0.04,
      moraleDelta: 10,
      prefersDry: true,
    },
    {
      id: "shield_advance",
      name: "重盾稳进",
      tag: "统帅稳阵",
      stat: "command",
      summary: "结阵缓进、严防箭雨，显著降低我军伤亡并蓄积士气。",
      atkDelta: 0.05,
      defDelta: -0.03,
      lossDelta: -0.18,
      moraleDelta: 5,
    },
    {
      id: "ambush_grain",
      name: "奇兵截粮",
      tag: "断后奇袭",
      stat: "intel",
      summary: "分遣偏师袭扰敌后辎重，若敌城本已断粮/被围则效果大增。",
      atkDelta: 0.08,
      defDelta: -0.14,
      lossDelta: -0.06,
      moraleDelta: 9,
      synergySupply: true,
    },
  ],
  center: [
    {
      id: "flank_pincer",
      name: "两翼包抄",
      tag: "统帅合围",
      stat: "command",
      summary: "左右两翼齐出合围中军，稳定削弱敌军防线。",
      atkDelta: 0.12,
      defDelta: -0.08,
      lossDelta: -0.04,
      moraleDelta: 7,
    },
    {
      id: "water_flood",
      name: "决水灌营",
      tag: "借势破敌",
      stat: "intel",
      summary: "临水地形或雨季借水势冲毁敌垒，重创守军。",
      atkDelta: 0.14,
      defDelta: -0.12,
      lossDelta: -0.08,
      moraleDelta: 11,
      prefersWater: true,
    },
    {
      id: "feint_retreat",
      name: "诈败诱敌",
      tag: "智谋设伏",
      stat: "intel",
      summary: "示弱诱敌出垒，借伏兵反噬，极适合以少胜多。",
      atkDelta: 0.15,
      defDelta: -0.09,
      lossDelta: -0.1,
      moraleDelta: 9,
    },
    {
      id: "all_out_charge",
      name: "全军死战",
      tag: "破釜沉舟",
      stat: "war",
      summary: "擂鼓死战、不破不还，爆发极高攻击但战损偏高。",
      atkDelta: 0.22,
      defDelta: -0.04,
      lossDelta: 0.14,
      moraleDelta: 12,
    },
  ],
  breach: [
    {
      id: "siege_tower",
      name: "冲车登城",
      tag: "强攻坚城",
      stat: "command",
      summary: "集中器械猛轰城门，大幅削弱城防加成。",
      atkDelta: 0.12,
      defDelta: -0.15,
      lossDelta: 0.04,
      moraleDelta: 6,
    },
    {
      id: "persuade_surrender",
      name: "阵前劝降",
      tag: "攻心为上",
      stat: "intel",
      summary: "当敌军士气低落或被围断粮时，有奇效可极大减少伤亡甚至迫降。",
      atkDelta: 0.09,
      defDelta: -0.16,
      lossDelta: -0.22,
      moraleDelta: 12,
      persuade: true,
    },
    {
      id: "fire_gate",
      name: "火矢焚门",
      tag: "破防奇袭",
      stat: "war",
      summary: "以火箭引燃城楼木栅，兼顾破防与杀伤。",
      atkDelta: 0.14,
      defDelta: -0.1,
      lossDelta: -0.02,
      moraleDelta: 8,
      prefersDry: true,
    },
    {
      id: "preserve_force",
      name: "稳扎稳打",
      tag: "保全锐气",
      stat: "command",
      summary: "控兵稳攻，大幅降低己方最终折损。",
      atkDelta: 0.04,
      defDelta: -0.04,
      lossDelta: -0.24,
      moraleDelta: 4,
    },
  ],
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function statValue(officer, stat) {
  if (!officer) return 72;
  if (stat === "war") return officer.war ?? officer.command ?? 72;
  if (stat === "intel") return officer.intel ?? officer.politics ?? 72;
  return officer.command ?? 74;
}

/**
 * 创建三回合临阵微操会话
 */
export function createTacticalSession({
  fromName = "己城",
  toName = "敌城",
  attackerName = "主将",
  defenderName = "守将",
  attacker = null,
  defender = null,
  attackerTroops = 8000,
  defenderTroops = 6000,
  terrain = "land",
  season = "春",
  targetCut = false,
  siegeTurns = 0,
  insiderActive = false,
  baseOffense = 10000,
  baseDefense = 10000,
}) {
  return {
    fromName,
    toName,
    attackerName,
    defenderName,
    attacker: attacker ? { name: attacker.name, command: attacker.command ?? 75, war: attacker.war ?? 75, intel: attacker.intel ?? 75 } : { name: attackerName, command: 75, war: 75, intel: 75 },
    defender: defender ? { name: defender.name, command: defender.command ?? 72, war: defender.war ?? 72, intel: defender.intel ?? 72 } : { name: defenderName, command: 72, war: 72, intel: 72 },
    attackerTroops,
    defenderTroops,
    terrain,
    season,
    targetCut,
    siegeTurns,
    insiderActive,
    baseOffense: Math.max(1, baseOffense),
    baseDefense: Math.max(1, baseDefense),
    phaseIndex: 0,
    atkMult: 1,
    defMult: insiderActive ? 0.72 : 1,
    lossMult: 1,
    momentum: insiderActive ? 14 : 0,
    surrenderTriggered: false,
    log: insiderActive ? ["【内应接应】城内细作暗中焚毁敌军箭楼，守军防线大乱（敌防 -28%）。"] : [],
    done: false,
  };
}

/**
 * 评估某阶段某军令在当前战况下的预期收益标签
 */
export function evaluateTacticalOrder(session, order) {
  const attStat = statValue(session.attacker, order.stat);
  const defStat = statValue(session.defender, order.stat);
  const diff = attStat - defStat;
  let bonus = clamp(diff / 220, -0.07, 0.11);
  const hints = [];

  if (order.prefersDry) {
    if (session.season === "秋" || session.season === "夏") {
      bonus += 0.06;
      hints.push("天干物燥 · 火势大盛");
    } else if (session.season === "冬") {
      bonus -= 0.05;
      hints.push("寒冬雨雪 · 火计略减");
    }
  }
  if (order.prefersWater) {
    if (session.terrain === "river" || session.season === "夏") {
      bonus += 0.09;
      hints.push("临水汛期 · 威力倍增");
    } else {
      bonus -= 0.05;
      hints.push("旱地无水 · 效果受限");
    }
  }
  if (order.synergySupply && (session.targetCut || session.siegeTurns > 0)) {
    bonus += 0.09;
    hints.push("敌军缺粮 · 奇袭倍效");
  }
  if (order.persuade && (session.targetCut || session.siegeTurns >= 1 || session.momentum >= 18)) {
    bonus += 0.1;
    hints.push("敌心已涣 · 极易瓦解");
  }
  if (diff >= 12) hints.push(`将领${order.tag}压制`);
  else if (diff <= -12) hints.push("敌将反制需慎");

  const effectiveAtk = Number((order.atkDelta + Math.max(0, bonus)).toFixed(3));
  const effectiveDef = Number((order.defDelta - Math.max(0, bonus * 0.65)).toFixed(3));
  const rating = bonus >= 0.07 ? "上策" : bonus >= 0.01 ? "良策" : bonus >= -0.04 ? "中策" : "险策";

  return {
    ...order,
    effectiveAtk,
    effectiveDef,
    rating,
    hint: hints.join(" · ") || "势均力敌",
  };
}

/**
 * 列出当前阶段的可选军令（带实时策略评级）
 */
export function currentPhaseOrders(session) {
  const phase = TACTICAL_PHASES[session.phaseIndex];
  if (!phase) return [];
  return (TACTICAL_ORDERS[phase.id] || []).map((o) => evaluateTacticalOrder(session, o));
}

/**
 * 执行当前阶段军令并推进至下一阶段
 */
export function resolveTacticalPhase(session, orderId) {
  if (!session || session.done) return session;
  const phase = TACTICAL_PHASES[session.phaseIndex];
  const options = currentPhaseOrders(session);
  const chosen = options.find((o) => o.id === orderId) || options[0];
  if (!chosen) return { ...session, done: true };

  const next = structuredClone(session);
  next.atkMult = Number(clamp(next.atkMult * (1 + chosen.effectiveAtk), 0.72, 1.65).toFixed(3));
  next.defMult = Number(clamp(next.defMult * (1 + chosen.effectiveDef), 0.45, 1.25).toFixed(3));
  next.lossMult = Number(clamp(next.lossMult * (1 + chosen.lossDelta), 0.45, 1.45).toFixed(3));
  next.momentum = clamp(next.momentum + chosen.moraleDelta + (chosen.rating === "上策" ? 6 : chosen.rating === "险策" ? -3 : 0), -20, 60);

  // 第三阶段若施展劝降且敌军势穷，可直接触发阵前倒戈
  if (chosen.persuade && (next.targetCut || next.siegeTurns >= 2 || next.momentum >= 32)) {
    const projectedOff = next.baseOffense * next.atkMult;
    const projectedDef = next.baseDefense * next.defMult;
    if (projectedOff >= projectedDef * 0.92) {
      next.surrenderTriggered = true;
      next.defMult = Math.min(next.defMult, 0.55);
      next.lossMult = Math.min(next.lossMult, 0.55);
    }
  }

  const outcomeLine = next.surrenderTriggered
    ? `【${phase.title}】下令「${chosen.name}」（${chosen.rating}）：守军军心崩解，开城请降！`
    : `【${phase.title}】下令「${chosen.name}」（${chosen.rating}）：${chosen.hint}，我攻 ×${next.atkMult.toFixed(2)} / 敌防 ×${next.defMult.toFixed(2)}。`;
  next.log.push(outcomeLine);
  next.phaseIndex += 1;
  if (next.phaseIndex >= TACTICAL_PHASES.length || next.surrenderTriggered) {
    next.done = true;
  }
  return next;
}

/**
 * 一键委任自动打完剩余阶段（每阶段自动挑选最高评级军令）
 */
export function autoResolveTacticalSession(session) {
  let cur = session;
  while (cur && !cur.done) {
    const options = currentPhaseOrders(cur);
    const best = [...options].sort((a, b) => (b.effectiveAtk - b.effectiveDef) - (a.effectiveAtk - a.effectiveDef))[0];
    cur = resolveTacticalPhase(cur, best?.id);
  }
  return cur;
}

/**
 * 输出最终注入 engine.js 战斗结算的修正系数
 */
export function finalizeTacticalModifiers(session) {
  if (!session) {
    return { atkMult: 1, defMult: 1, lossMult: 1, surrender: false, summary: "", log: [] };
  }
  const doneSession = session.done ? session : autoResolveTacticalSession(session);
  return {
    atkMult: doneSession.atkMult,
    defMult: doneSession.defMult,
    lossMult: doneSession.lossMult,
    surrender: Boolean(doneSession.surrenderTriggered),
    momentum: doneSession.momentum,
    log: doneSession.log,
    summary: doneSession.surrenderTriggered
      ? `临阵指挥大胜：${doneSession.toName}守军闻风开城请降！`
      : `临阵指挥结案：我军攻势 ×${doneSession.atkMult.toFixed(2)}，敌防 ×${doneSession.defMult.toFixed(2)}，战损 ×${doneSession.lossMult.toFixed(2)}。`,
  };
}
