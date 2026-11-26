import { cityName, eraByYear, factionName, forceTotals, gameOutcome, previewOrders } from "./engine.js";
import { isHostile, treatyWith } from "./diplomacy.js";
import { encodeTerritory, plain, protectionBetween } from "./polities-data.js";
import { handoverCities, reconcilePolities } from "./polity-handover.js";
import { ensureSaga, isOfficerUnavailable, MAX_RIVALS, recordAnnal } from "./saga.js";
import { knownOfficer } from "./personnel.js";
import { officerMeta } from "./traits.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export const FACTION_PERSONALITIES = {
  cao: { id: "cao", name: "雄略多谋", desc: "善用火攻奇袭与乘虚并吞，注重兵锋效率。", attackWeight: 1.12, aggression: 1.12, preferredTactics: ["stratagem", "assault"] },
  wei: { id: "wei", name: "雄略多谋", desc: "重兵破垒兼施奇谋，稳扎中原。", attackWeight: 1.1, aggression: 1.08, preferredTactics: ["siege", "stratagem"] },
  liu: { id: "liu", name: "仁德合纵", desc: "广结盟好、善用奇谋与攻心招抚。", attackWeight: 1.0, aggression: 0.96, preferredTactics: ["rally", "stratagem"] },
  shu: { id: "shu", name: "兴汉北伐", desc: "长于奇袭山地与攻心，坚守巴蜀。", attackWeight: 1.04, aggression: 1.02, preferredTactics: ["stratagem", "rally"] },
  ce: { id: "ce", name: "江东猛锐", desc: "水陆并进、锐气强攻与火计奇袭。", attackWeight: 1.12, aggression: 1.15, preferredTactics: ["assault", "stratagem"] },
  jian: { id: "jian", name: "江东猛锐", desc: "奋锐破敌，勇往无前。", attackWeight: 1.1, aggression: 1.12, preferredTactics: ["assault"] },
  wu: { id: "wu", name: "保境守江", desc: "扼守江防，喜借火攻水师破敌。", attackWeight: 0.98, aggression: 0.92, preferredTactics: ["stratagem", "siege"] },
  yuan: { id: "yuan", name: "四世重器", desc: "以雄兵厚甲大军压境、强攻破城。", attackWeight: 1.06, aggression: 1.04, preferredTactics: ["siege", "assault"] },
  dong: { id: "dong", name: "暴戾掠境", desc: "依恃西凉铁骑强横进攻。", attackWeight: 1.1, aggression: 1.14, preferredTactics: ["assault"] },
  lu: { id: "lu", name: "保境安民", desc: "谨守汉宁山险，不轻启大战。", attackWeight: 0.9, aggression: 0.85, preferredTactics: ["siege"] },
  ma: { id: "ma", name: "西凉铁骑", desc: "崇尚骑兵正面冲击。", attackWeight: 1.08, aggression: 1.08, preferredTactics: ["assault"] },
  biao: { id: "biao", name: "跨蹈安守", desc: "重文治农商、稳守荆襄。", attackWeight: 0.9, aggression: 0.84, preferredTactics: ["siege"] },
  zhang: { id: "zhang", name: "据蜀自守", desc: "固守天府关隘，少主动出击。", attackWeight: 0.88, aggression: 0.82, preferredTactics: ["siege"] },
  shi: { id: "shi", name: "岭南安土", desc: "保境息民、招贤纳士。", attackWeight: 0.88, aggression: 0.82, preferredTactics: ["rally"] },
  jin: { id: "jin", name: "一统定鼎", desc: "步步为营、破垒吞吴。", attackWeight: 1.12, aggression: 1.1, preferredTactics: ["siege", "assault"] },
  han: { id: "han", name: "大汉宗室", desc: "持重安集州郡。", attackWeight: 0.92, aggression: 0.86, preferredTactics: ["rally", "assault"] },
  yellow: { id: "yellow", name: "太平起义", desc: "蜂起席卷州郡、攻心煽动。", attackWeight: 1.08, aggression: 1.14, preferredTactics: ["rally", "assault"] },
};

export function factionPersonality(factionKey) {
  return FACTION_PERSONALITIES[factionKey] ?? {
    id: factionKey || "default",
    name: "割据一方",
    desc: "审时度势、相机开拓。",
    attackWeight: 1.0,
    aggression: 1.0,
    preferredTactics: ["assault"],
  };
}

export const STRATAGEMS = {
  sow_discord: { id: "sow_discord", name: "驱虎吞狼", cost: 24, desc: "离间两大外藩诸侯，绝其盟约并令其互相敌视 6 季。" },
  spread_rumor: { id: "spread_rumor", name: "反间流言", cost: 16, desc: "动摇敌城民心与守军士气，2 季内守防 -14% 且「攻心摇动」额外破敌 +12%。" },
  demand_surrender: { id: "demand_surrender", name: "传檄劝降", cost: 20, desc: "威慑孤立微弱之敌直接举城降附，省却逐城苦战。" },
};

export function rivalFriction(state, first, second) {
  if (!state?.century || !state?.saga?.rivals?.length || first === second) return false;
  return state.saga.rivals.some((r) => (
    r.expires > state.turn && ((r.a === first && r.b === second) || (r.a === second && r.b === first))
  ));
}

function topAdvisorIntellect(era, state) {
  const pool = era.officers.filter((o) => o.faction === state.player && knownOfficer(state, o) && !isOfficerUnavailable(state, o.key));
  const best = pool.sort((a, b) => (officerMeta(b).intellect ?? 50) - (officerMeta(a).intellect ?? 50))[0];
  return { officer: best ?? null, intellect: best ? (officerMeta(best).intellect ?? 50) : 55 };
}

function checkPlotWindow(state, cost) {
  if (!state?.century || gameOutcome(state) !== "ongoing") return { ok: false, reason: "仅限经略大势模式进行中之战局使用谋略。" };
  if (state.saga?.plotsUsedTurn === state.turn) return { ok: false, reason: "本季已行密谋一次，须待次季方可再谋。" };
  if (state.factions[state.player].treasury < cost) return { ok: false, reason: `国库不足，需 ${cost} 钱。` };
  return { ok: true, reason: "" };
}

export function evaluateSowDiscord(world, state, factionA, factionB) {
  const gate = checkPlotWindow(state, STRATAGEMS.sow_discord.cost);
  if (!gate.ok) return gate;
  if (!factionA || !factionB || factionA === factionB || factionA === state.player || factionB === state.player) {
    return { ok: false, reason: "请选择两个外藩势力。" };
  }
  const aliveA = Object.values(state.cities).some((c) => c.owner === factionA);
  const aliveB = Object.values(state.cities).some((c) => c.owner === factionB);
  if (!aliveA || !aliveB) return { ok: false, reason: "所选势力须仍有辖城。" };
  if (protectionBetween(state, factionA, factionB)) return { ok: false, reason: "双方正受强藩护持契约约束，一时难动。" };
  const era = eraByYear(world, state);
  const { officer, intellect } = topAdvisorIntellect(era, state);
  const rep = state.saga?.reputation ?? 50;
  const treaty = treatyWith(state, factionA, factionB);
  const chance = clamp(62 + Math.round((intellect - 70) * 0.65) + Math.round((rep - 50) * 0.25) - (treaty?.kind === "alliance" ? 8 : 0), 35, 96);
  return { ok: true, chance, officer, treaty: treaty?.kind ?? null, cost: STRATAGEMS.sow_discord.cost };
}

export function executeSowDiscord(world, state, factionA, factionB) {
  const check = evaluateSowDiscord(world, state, factionA, factionB);
  if (!check.ok) throw new Error(check.reason);
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const era = eraByYear(world, next);
  next.factions[next.player].treasury -= check.cost;
  saga.plotsUsedTurn = next.turn;
  const hash = [...(factionA + factionB)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const roll = (next.turn * 31 + hash * 7 + (saga.reputation ?? 50)) % 100;
  const succeeded = check.chance >= 80 || roll < check.chance;
  const nameA = factionName(era, factionA);
  const nameB = factionName(era, factionB);
  if (!succeeded) {
    recordAnnal(next, "离间", `遣谋士离间${nameA}与${nameB}，惜未获轻信（成率 ${check.chance}%）。`);
    return { state: next, succeeded: false, chance: check.chance, message: `${nameA}与${nameB}未为流言所动（本次成率 ${check.chance}%），耗费 ${check.cost} 钱。` };
  }
  next.treaties = (next.treaties ?? []).filter((t) => !(t.sides.includes(factionA) && t.sides.includes(factionB)));
  for (const k of [factionA, factionB]) {
    if (next.strategies?.[k]?.target && next.cities[next.strategies[k].target]?.owner === (k === factionA ? factionB : factionA)) {
      if (next.strategies[k].type === "defend") delete next.strategies[k];
    }
  }
  saga.rivals = [...(saga.rivals ?? []).filter((r) => !(r.a === factionA && r.b === factionB || r.a === factionB && r.b === factionA)),
    { a: factionA, b: factionB, expires: next.turn + 6 }].slice(-MAX_RIVALS);
  recordAnnal(next, "驱虎", `密行「驱虎吞狼」，令${nameA}与${nameB}反目相疑，旧约尽毁！`);
  return { state: next, succeeded: true, chance: check.chance, message: `计成！${nameA}与${nameB}反目成仇，旧约废除且 6 季内难再修好！` };
}

export function evaluateSpreadRumor(world, state, cityKey) {
  const gate = checkPlotWindow(state, STRATAGEMS.spread_rumor.cost);
  if (!gate.ok) return gate;
  const city = state.cities?.[cityKey];
  if (!city || city.owner === state.player) return { ok: false, reason: "请选择敌对或外藩城池散布流言。" };
  if ((state.saga?.rumors?.[cityKey] ?? 0) > state.turn) return { ok: false, reason: `${cityName(world, cityKey)}已在流言动摇之中。` };
  return { ok: true, cost: STRATAGEMS.spread_rumor.cost, cityKey };
}

export function executeSpreadRumor(world, state, cityKey) {
  const check = evaluateSpreadRumor(world, state, cityKey);
  if (!check.ok) throw new Error(check.reason);
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const target = next.cities[cityKey];
  const owner = target.owner;
  next.factions[next.player].treasury -= check.cost;
  saga.plotsUsedTurn = next.turn;
  if (next.realm?.cities?.[cityKey]) {
    next.realm.cities[cityKey].welfare = Math.max(20, (next.realm.cities[cityKey].welfare ?? 68) - 12);
  }
  if (next.factions[owner]) {
    next.factions[owner].morale = clamp((next.factions[owner].morale ?? 75) - 5, 15, 100);
  }
  saga.rumors = { ...(saga.rumors ?? {}), [cityKey]: next.turn + 2 };
  recordAnnal(next, "反间", `散流言于${cityName(world, cityKey)}，民心顿减、敌军士气 -5（守防 -14% 持续 2 季）。`);
  return { state: next, message: `反间流言得逞！${cityName(world, cityKey)}守防 -14%、敌军士气 -5，极宜下令「攻心摇动」低损破城！` };
}

export function evaluateDemandSurrender(world, state, targetFaction) {
  const gate = checkPlotWindow(state, STRATAGEMS.demand_surrender.cost);
  if (!gate.ok) return gate;
  if (!targetFaction || targetFaction === state.player) return { ok: false, reason: "请选择外藩势力。" };
  const targetCities = world.cities.filter(({ key }) => state.cities[key]?.owner === targetFaction).map(({ key }) => key);
  if (!targetCities.length) return { ok: false, reason: "该势力已无辖城。" };
  const pStats = forceTotals(state, state.player);
  const tStats = forceTotals(state, targetFaction);
  const maxTargetCities = pStats.cities >= 28 ? 4 : 3;
  if (targetCities.length > maxTargetCities) {
    return { ok: false, reason: `对方尚拥 ${targetCities.length} 城（需先削弱至 ${maxTargetCities} 城以下方能传檄劝降）。` };
  }
  const bordersPlayer = world.cities.some(({ key, links }) => (
    state.cities[key].owner === targetFaction && links.some((n) => state.cities[n]?.owner === state.player)
  ));
  if (!bordersPlayer) return { ok: false, reason: "须先与该势力接壤形成威慑，方可传檄劝降。" };
  const powerOk = pStats.cities >= Math.max(6, targetCities.length * 3) && pStats.troops >= Math.max(3000, tStats.troops * 1.85);
  if (!powerOk) return { ok: false, reason: "尚须积蓄更高兵力与疆域威势，方足以压服对方。" };
  const era = eraByYear(world, state);
  const rep = state.saga?.reputation ?? 50;
  const ratio = pStats.troops / Math.max(1, tStats.troops);
  const { intellect } = topAdvisorIntellect(era, state);
  const chance = clamp(Math.round(45 + ratio * 10 + (rep - 50) * 0.45 + (intellect - 75) * 0.35 + (targetCities.length === 1 ? 15 : 0)), 30, 96);
  return { ok: true, chance, targetCities, cost: STRATAGEMS.demand_surrender.cost };
}

export function executeDemandSurrender(world, state, targetFaction) {
  const check = evaluateDemandSurrender(world, state, targetFaction);
  if (!check.ok) throw new Error(check.reason);
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const era = eraByYear(world, next);
  const targetName = factionName(era, targetFaction);
  next.factions[next.player].treasury -= check.cost;
  saga.plotsUsedTurn = next.turn;
  const hash = [...targetFaction].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const roll = (next.turn * 23 + hash * 19 + (saga.reputation ?? 50)) % 100;
  const succeeded = check.chance >= 75 || roll < check.chance;
  if (!succeeded) {
    recordAnnal(next, "劝降", `遣使传檄${targetName}归顺，惜对方仍图侥幸拒降（成率 ${check.chance}%）。`);
    return { state: next, succeeded: false, chance: check.chance, message: `${targetName}犹豫未决、拒不受降（本次成率 ${check.chance}%），耗费 ${check.cost} 钱。` };
  }
  const targetCities = check.targetCities;
  if (next.polity) {
    handoverCities(world, era, next, targetFaction, next.player, targetCities, "union", next.turn);
    for (const cKey of targetCities) {
      const claim = next.polity.formerOwners?.[cKey];
      if (Array.isArray(claim) && !claim.includes(next.player)) claim.push(next.player);
    }
    reconcilePolities(next, next.turn);
    if (next.polity.atlas?.length) {
      next.polity.atlas[next.polity.atlas.length - 1].map = encodeTerritory(world, next);
    }
  } else {
    for (const cKey of targetCities) next.cities[cKey].owner = next.player;
  }
  next.treaties = (next.treaties ?? []).filter((t) => !t.sides.includes(targetFaction));
  next.treatyOffers = (next.treatyOffers ?? []).filter((o) => o.target !== targetFaction);
  if (next.incomingTreaty?.from === targetFaction) next.incomingTreaty = null;
  saga.rivals = (saga.rivals ?? []).filter((r) => r.a !== targetFaction && r.b !== targetFaction);
  const citySet = new Set(targetCities);
  next.orders = (next.orders ?? []).filter((order) => (
    !citySet.has(order.to) && !citySet.has(order.from) && !citySet.has(order.city)
  ));
  saga.reputation = clamp((saga.reputation ?? 50) + 4, 0, 100);
  next.factions[next.player].morale = clamp(next.factions[next.player].morale + 4, 15, 100);
  recordAnnal(next, "降附", `传檄平定${targetName}，${targetCities.map((k) => cityName(world, k)).join("、")}等 ${targetCities.length} 城及将吏举众归顺！`);
  previewOrders(world, next);
  return { state: next, succeeded: true, chance: check.chance, annexedCities: targetCities, message: `传檄平定！${targetName}举其 ${targetCities.length} 城与诸将尽数归降！` };
}

export function listStratagemTargets(world, state) {
  if (!state?.century || gameOutcome(state) !== "ongoing") return { discordPairs: [], surrenderTargets: [] };
  const era = eraByYear(world, state);
  const living = era.factions
    .filter((f) => f.key !== state.player && Object.values(state.cities).some((c) => c.owner === f.key))
    .map((f) => ({ key: f.key, name: f.name, cities: forceTotals(state, f.key).cities }));
  const discordPairs = [];
  for (let i = 0; i < living.length; i += 1) {
    for (let j = i + 1; j < living.length; j += 1) {
      const check = evaluateSowDiscord(world, state, living[i].key, living[j].key);
      discordPairs.push({
        a: living[i],
        b: living[j],
        hasTreaty: Boolean(treatyWith(state, living[i].key, living[j].key)),
        ...check,
      });
    }
  }
  discordPairs.sort((x, y) => Number(Boolean(y.hasTreaty)) - Number(Boolean(x.hasTreaty)) || (y.cities + (y.chance ?? 0)) - (x.cities + (x.chance ?? 0)));
  const surrenderTargets = living.map((f) => ({ ...f, ...evaluateDemandSurrender(world, state, f.key) }));
  return { discordPairs: discordPairs.slice(0, 8), surrenderTargets };
}

export function advisorStrategicBrief(world, era, state) {
  const playerTotal = forceTotals(state, state.player);
  const rivals = era.factions
    .filter((f) => f.key !== state.player)
    .map((f) => ({ ...f, ...forceTotals(state, f.key) }))
    .filter((f) => f.cities > 0)
    .sort((a, b) => b.troops - a.troops);
  const topRival = rivals[0];
  const rep = state.saga?.reputation ?? 50;
  const repTag = rep >= 70 ? "海内归心" : rep >= 45 ? "威望平稳" : "苛政微损";
  if (!topRival) return `群雄已平，今唯余内政安集与收复之功（声望 ${rep} · ${repTag}）。`;
  const threat = topRival.troops > playerTotal.troops * 1.15
    ? `${topRival.name}拥兵 ${topRival.troops.toLocaleString("zh-CN")} 颇为强盛，宜善用奇袭、围垒与驱虎吞狼之策`
    : `${topRival.name}（${topRival.cities} 城）为眼下首敌，我军拥兵 ${playerTotal.troops.toLocaleString("zh-CN")} 正可趁势进取`;
  return `${threat}；当前声望 ${rep}（${repTag}），士气 ${state.factions[state.player]?.morale ?? 75}。`;
}
