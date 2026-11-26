// v21.0 — 朝野三大派系 & 群臣廷议博弈（帝王心术）
// 状态挂在 state.saga.courtFactions 下，兼容旧存档与非 century 模式。

export const COURT_FACTIONS = [
  { id: "warriors", name: "寒门武勋", icon: "⚔️", summary: "前线宿将与军功新贵，重用兵伐敌与厚赏将士。" },
  { id: "gentry", name: "世家名士", icon: "📜", summary: "州郡大族与清流文臣，重休养生息、税收与礼制。" },
  { id: "kinsmen", name: "宗室近臣", icon: "👑", summary: "宗亲股肱与中枢心腹，重皇权稳固与疆域长治。" },
];

export const COURT_DEBATES = [
  {
    id: "north_or_rest",
    title: "廷议：大举北伐抑或休养生息",
    body: "朝会上寒门武将力主趁势出兵建功，世家文臣则谏言连年用兵民力疲敝，请主公圣裁：",
    choices: [
      { id: "war", label: "采纳武勋：增兵备战（全军士气+8，武勋+14 / 世家-6）", delta: { warriors: 14, gentry: -6, kinsmen: 4 }, effect: { morale: 8, tp: 30 } },
      { id: "rest", label: "采纳名士：减赋兴农（国库+55、储粮+65，世家+14 / 武勋-5）", delta: { warriors: -5, gentry: 14, kinsmen: 4 }, effect: { treasury: 55, grain: 65 } },
      { id: "balance", label: "折中制衡：军屯并行（储粮+40、声望+3，三派皆+5）", delta: { warriors: 5, gentry: 5, kinsmen: 6 }, effect: { grain: 40, reputation: 3 } },
    ],
  },
  {
    id: "gentry_tax",
    title: "廷议：清查世家隐户与田亩",
    body: "户曹奏报州郡豪强多有隐匿人口逃税，若行清查可得巨额军费，然恐激怒大族：",
    choices: [
      { id: "audit", label: "雷霆清查：充实国库（国库+95、储粮+50，武勋+8 / 宗室+8 / 世家-12）", delta: { warriors: 8, gentry: -12, kinsmen: 8 }, effect: { treasury: 95, grain: 50 } },
      { id: "concede", label: "恩抚大族：稳固地方（声望+5、兵技+45，世家+14 / 武勋-4）", delta: { warriors: -4, gentry: 14, kinsmen: 2 }, effect: { reputation: 5, tp: 45 } },
    ],
  },
  {
    id: "reward_army",
    title: "廷议：重赏前线抑或赈济州郡",
    body: "府库略有盈余，将士盼望犒赏，郡县亦请拨款修渠：",
    choices: [
      { id: "troops", label: "犒赏三军：激励锐气（士气+10、兵技+35，武勋+15 / 宗室+4 / 世家-5）", delta: { warriors: 15, gentry: -5, kinsmen: 4 }, effect: { morale: 10, tp: 35 } },
      { id: "relief", label: "赈济州郡：广收民心（储粮+80、声望+5，世家+12 / 宗室+6 / 武勋-4）", delta: { warriors: -4, gentry: 12, kinsmen: 6 }, effect: { grain: 80, reputation: 5 } },
    ],
  },
  {
    id: "select_talent",
    title: "廷议：拔擢寒门抑或重用宗亲",
    body: "中枢尚书台出缺，寒门才俊与宗室勋戚各有所长：",
    choices: [
      { id: "merit", label: "唯才是举：破格拔擢（兵技+60，武勋+10 / 世家+4 / 宗室-6）", delta: { warriors: 10, gentry: 4, kinsmen: -6 }, effect: { tp: 60 } },
      { id: "kin", label: "托付宗室：稳固中枢（国库+50、士气+5，宗室+16 / 武勋-4）", delta: { warriors: -4, gentry: 2, kinsmen: 16 }, effect: { treasury: 50, morale: 5 } },
    ],
  },
];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function getCourtFactionsState(state) {
  const cf = state?.saga?.courtFactions;
  const scores = {
    warriors: cf?.scores?.warriors ?? 62,
    gentry: cf?.scores?.gentry ?? 62,
    kinsmen: cf?.scores?.kinsmen ?? 66,
  };
  const harmony = scores.warriors >= 65 && scores.gentry >= 65 && scores.kinsmen >= 65;
  const unrest = scores.warriors < 35 || scores.gentry < 35 || scores.kinsmen < 35;
  return {
    scores,
    lastDebateTurn: cf?.lastDebateTurn ?? -2,
    harmony,
    unrest,
    statusLabel: harmony ? "上下同心（全势力钱粮+10% · 攻防+6%）" : unrest ? "朝野失和（亟需廷议安抚）" : "朝堂平衡",
  };
}

export function currentCourtDebate(state) {
  const idx = Math.abs((state?.turn ?? 1) + (state?.year ?? 208)) % COURT_DEBATES.length;
  return COURT_DEBATES[idx];
}

/**
 * 召开群臣廷议并作出裁断（冷却 2 季）
 */
export function resolveCourtDebate(state, debateId, choiceId) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可召开群臣廷议。" };
  const cf = getCourtFactionsState(state);
  const elapsed = (state.turn ?? 1) - cf.lastDebateTurn;
  if (elapsed < 2) {
    return { ok: false, reason: `群臣廷议刚闭幕，需隔 ${2 - elapsed} 季方可再召朝会。` };
  }
  const debate = COURT_DEBATES.find((d) => d.id === debateId) || currentCourtDebate(state);
  const choice = debate.choices.find((c) => c.id === choiceId) || debate.choices[0];

  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  const scores = {
    warriors: clamp(cf.scores.warriors + (choice.delta.warriors ?? 0), 0, 100),
    gentry: clamp(cf.scores.gentry + (choice.delta.gentry ?? 0), 0, 100),
    kinsmen: clamp(cf.scores.kinsmen + (choice.delta.kinsmen ?? 0), 0, 100),
  };
  next.saga.courtFactions = { scores, lastDebateTurn: next.turn ?? 1 };

  const fac = next.factions?.[next.player];
  if (fac) {
    if (choice.effect.treasury) fac.treasury += choice.effect.treasury;
    if (choice.effect.grain) fac.grain += choice.effect.grain;
    if (choice.effect.morale) fac.morale = clamp((fac.morale ?? 75) + choice.effect.morale, 15, 100);
  }
  if (choice.effect.reputation) next.saga.reputation = clamp((next.saga.reputation ?? 50) + choice.effect.reputation, 0, 100);
  if (choice.effect.tp && next.saga.tech) next.saga.tech.points = (next.saga.tech.points ?? 0) + choice.effect.tp;

  return {
    ok: true,
    state: next,
    summary: `【群臣廷议】已圣裁「${choice.label.split("：")[0]}」！当前三派：武勋${scores.warriors} / 世家${scores.gentry} / 宗室${scores.kinsmen}。`,
  };
}

export function courtFactionModifiers(state, factionId) {
  if (!state?.century || factionId !== state.player) return { ecoMult: 1, combatMult: 1 };
  const cf = getCourtFactionsState(state);
  if (cf.harmony) return { ecoMult: 1.1, combatMult: 1.06 };
  if (cf.unrest) return { ecoMult: 0.94, combatMult: 0.96 };
  return { ecoMult: 1, combatMult: 1 };
}
