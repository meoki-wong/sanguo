import { armyByOfficer } from "./armies.js";
import { cityName, eraByYear, factionName, firstCity, gameOutcome, previewOrders } from "./engine.js";
import { evaluateHistoricalEvent } from "./historical-events.js";
import { factionCourtProfile } from "./imperial.js";
import { knownOfficer } from "./personnel.js";
import { cleanLosses, recordAllegiance, retreatCity } from "./polity-handover.js";
import { livingSide, plain } from "./polities-data.js";
import { officerMeta } from "./traits.js";
import { evaluateCoalition, settleSeasonalClimate } from "./coalition.js";
import { settleSupplyTurn } from "./supply.js";
import { settleBuildingsTurn } from "./buildings.js";
import { settleEspionageTurn } from "./espionage.js";
import { settleLifespanTurn } from "./ai-persona.js";
import { recordHistorySnapshot } from "./war-room.js";
import { settleCorpsTurn } from "./corps.js";
import { settleTribesTurn } from "./tribes.js";
import { settleReformsTurn } from "./reforms.js";
import { settleCommerceTurn } from "./commerce.js";
import { evaluateChallengeProgress } from "./challenges.js";
import { clearCoordinatedTargets } from "./multi-siege.js";
import { spawnAdventures } from "./adventures.js";
import { settleUpheavalTurn } from "./upheaval.js";
import { settleVassalsTurn } from "./vassals.js";
import { specialtyEconomyModifiers } from "./specialties.js";
import { quarterlyTechPoints, techEconomyModifiers, techStratagemModifiers } from "./tech.js";

export const MAX_CAPTIVES = 6;
export const MAX_WILD_PENDING = 3;
export const MAX_WILD_RECRUITS = 24;
export const MAX_EXECUTED = 48;
export const MAX_FIRED_EVENTS = 32;
export const MAX_BUFFS = 6;
export const MAX_RIVALS = 6;
export const MAX_ANNALS = 24;

export const WILD_TALENT_POOL = [
  { id: "zhuge_liang", name: "诸葛亮", title: "卧龙先生", governance: 98, command: 93, minTurn: 1, fee: 36, regions: ["荆州", "中原与淮北", "关陇"], eras: [199] },
  { id: "pang_tong", name: "庞统", title: "凤雏先生", governance: 90, command: 84, minTurn: 1, fee: 34, regions: ["荆州", "荆襄", "巴蜀与南中", "益州"], eras: [199, 208] },
  { id: "xu_shu", name: "徐庶", title: "元直先生", governance: 85, command: 82, minTurn: 1, fee: 28, regions: ["荆襄", "中原与淮北"], eras: [199, 208] },
  { id: "sima_yi", name: "司马懿", title: "洛阳大才", governance: 95, command: 94, minTurn: 2, fee: 40, regions: ["司隶", "中原与淮北"], eras: [199, 208] },
  { id: "lu_xun", name: "陆逊", title: "江东俊彦", governance: 89, command: 93, minTurn: 2, fee: 34, regions: ["扬州", "江东与江淮", "荆襄"], eras: [199, 208] },
  { id: "jiang_wei", name: "姜维", title: "天水麒麟儿", governance: 82, command: 90, minTurn: 2, fee: 32, regions: ["凉州", "关陇", "益州", "巴蜀与南中"], eras: [208, 219] },
  { id: "deng_ai", name: "邓艾", title: "屯田奇才", governance: 89, command: 89, minTurn: 1, fee: 32, regions: ["中原与淮北", "关陇"], eras: [219, 234] },
  { id: "zhong_hui", name: "钟会", title: "颍川名士", governance: 88, command: 83, minTurn: 2, fee: 30, regions: ["司隶", "中原与淮北"], eras: [234] },
  { id: "fa_zheng", name: "法正", title: "奇谋策士", governance: 86, command: 84, minTurn: 1, fee: 30, regions: ["巴蜀与南中", "益州", "关陇"], eras: [199, 208] },
  { id: "guo_huai", name: "郭淮", title: "雍凉名将", governance: 80, command: 85, minTurn: 1, fee: 26, regions: ["关陇", "凉州"], eras: [208, 219] },
  { id: "tian_yu", name: "田豫", title: "北疆干城", governance: 84, command: 83, minTurn: 1, fee: 24, regions: ["幽州", "河北与辽东"], eras: [190, 199, 208] },
  { id: "wang_ping", name: "王平", title: "无当宿将", governance: 76, command: 85, minTurn: 2, fee: 24, regions: ["巴蜀与南中", "关陇"], eras: [208, 219] },
  { id: "lu_kang", name: "陆抗", title: "江陵重镇", governance: 88, command: 92, minTurn: 1, fee: 34, regions: ["荆襄", "江东与江淮"], eras: [234, 262] },
  { id: "du_yu", name: "杜预", title: "杜武库", governance: 92, command: 89, minTurn: 1, fee: 36, regions: ["司隶", "荆襄", "中原与淮北"], eras: [234] },
  { id: "cai_wenji", name: "蔡文姬", title: "博学名媛", governance: 89, command: 42, minTurn: 2, fee: 22, regions: ["中原与淮北", "司隶"], eras: [190, 199, 208] },
  { id: "ma_liang", name: "马良", title: "白眉名士", governance: 88, command: 62, minTurn: 1, fee: 24, regions: ["荆襄", "巴蜀与南中"], eras: [199, 208, 219] },
];

const DIEHARD_NAMES = new Set(["关羽", "张飞", "赵云", "诸葛亮", "姜维", "典韦", "许褚", "周泰", "太史慈", "吕蒙", "陆逊", "审配", "颜良", "文丑", "高顺", "罗宪"]);

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export function createSagaState(world, era, state, { historicalEvents = true } = {}) {
  return {
    reputation: 50,
    historicalEvents: Boolean(historicalEvents),
    captives: [],
    executed: [],
    wildRecruits: [],
    wildPending: [],
    firedEvents: [],
    pendingEvent: null,
    buffs: [],
    rivals: [],
    rumors: {},
    plotsUsedTurn: -1,
    plotsUsedCount: 0,
    tech: { points: 40, unlocked: [] },
    coalition: null,
    coalitionCooldownUntil: 0,
    coalitionBrokenCount: 0,
    allyStrikes: [],
    climate: null,
    duelWins: 0,
    rules: {},
    custom: null,
    annals: [],
  };
}

export function ensureSaga(state) {
  if (!state?.century) return null;
  if (!state.saga) {
    state.saga = createSagaState(null, null, state, { historicalEvents: true });
  }
  return state.saga;
}

export function isOfficerUnavailable(state, key) {
  if (!key || !state?.saga) return false;
  if (state.saga.executed?.includes(key)) return true;
  return Boolean(state.saga.captives?.some((c) => c.officer === key));
}

export function sagaOfficers(state) {
  return state?.saga?.wildRecruits ?? [];
}

export function recordAnnal(state, tag, text) {
  const saga = ensureSaga(state);
  if (!saga) return;
  saga.annals = [...(saga.annals ?? []), { turn: state.turn, tag: String(tag).slice(0, 16), text: String(text).slice(0, 180) }].slice(-MAX_ANNALS);
}

export function addSagaBuff(state, { kind, faction, value, duration, label }) {
  const saga = ensureSaga(state);
  if (!saga) return;
  const expires = state.turn + Math.max(1, duration);
  const filtered = (saga.buffs ?? []).filter((b) => b.expires > state.turn && !(b.kind === kind && b.faction === faction));
  filtered.push({ kind, faction, value, expires, label: String(label || kind).slice(0, 32) });
  saga.buffs = filtered.slice(-MAX_BUFFS);
}

export function sagaCombatModifiers(state, faction, targetCityKey, tacticId = "assault") {
  const saga = state?.saga;
  if (!state?.century || !saga) {
    return { attackMult: 1, defenseMult: 1, rumorDebuff: false, labels: [] };
  }
  let attackMult = 1;
  let defenseMult = 1;
  const labels = [];
  for (const buff of saga.buffs ?? []) {
    if (buff.expires <= state.turn || buff.faction !== faction) continue;
    if (buff.kind === "attack") {
      attackMult *= 1 + buff.value;
      labels.push(buff.label);
    } else if (buff.kind === "defense") {
      defenseMult *= 1 + buff.value;
      labels.push(buff.label);
    } else if (buff.kind === "fire" && tacticId === "stratagem") {
      attackMult *= 1 + buff.value;
      labels.push(buff.label);
    } else if (buff.kind === "siege" && tacticId === "siege") {
      attackMult *= 1 + buff.value;
      labels.push(buff.label);
    }
  }
  const rumorActive = Boolean(targetCityKey && (saga.rumors?.[targetCityKey] ?? 0) > state.turn);
  if (rumorActive) {
    const { rumorDefenseMult } = techStratagemModifiers(state, state.player);
    defenseMult *= rumorDefenseMult;
    if (tacticId === "rally") attackMult *= 1.12;
    labels.push("谣言动摇");
  }
  return {
    attackMult: Math.min(1.25, attackMult),
    defenseMult: Math.max(0.75, Math.min(1.22, defenseMult)),
    rumorDebuff: rumorActive,
    labels,
  };
}

export function effectiveWildFee(state, talent) {
  const loyalistDiscount = state?.imperialChoice === "loyalist" ? 0.5 : 1;
  const techDiscount = techEconomyModifiers(state, state?.player).wildFeeMult;
  return Math.max(8, Math.round(talent.fee * loyalistDiscount * techDiscount));
}

export function spawnWildTalents(world, era, state) {
  const saga = ensureSaga(state);
  if (!saga || state.turn < 1 || state.turn % 2 === 0) return null;
  if ((saga.wildPending?.length ?? 0) >= MAX_WILD_PENDING || (saga.wildRecruits?.length ?? 0) >= MAX_WILD_RECRUITS) return null;
  const existingNames = new Set([
    ...era.officers.map((o) => o.name),
    ...(saga.wildPending ?? []).map((t) => t.name),
    ...(saga.wildRecruits ?? []).map((t) => t.name),
  ]);
  const playerRegions = new Set(world.cities.filter(({ key }) => state.cities[key]?.owner === state.player).map(({ region }) => region));
  const pool = WILD_TALENT_POOL.filter((t) => (
    !existingNames.has(t.name)
    && state.turn >= t.minTurn
    && (!t.eras || t.eras.includes(state.year))
  ));
  if (!pool.length) return null;
  const localMatch = pool.filter((t) => t.regions.some((r) => playerRegions.has(r)));
  const candidates = localMatch.length ? localMatch : (saga.reputation >= 55 ? pool : []);
  if (!candidates.length) return null;
  const picked = candidates[(state.turn * 7 + Object.keys(saga.wildRecruits).length) % candidates.length];
  const entry = {
    id: picked.id,
    name: picked.name,
    title: picked.title,
    governance: picked.governance,
    command: picked.command,
    fee: picked.fee,
    turn: state.turn,
  };
  saga.wildPending = [...(saga.wildPending ?? []), entry].slice(-MAX_WILD_PENDING);
  return entry;
}

export function recruitWildTalent(world, state, talentId, cityKey = null) {
  if (!state?.century || gameOutcome(state) !== "ongoing") {
    throw new Error("当前无法礼聘在野贤才。");
  }
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const idx = (saga.wildPending ?? []).findIndex((t) => t.id === talentId);
  if (idx < 0) throw new Error("该在野贤才暂未出仕或已另投他主。");
  const talent = saga.wildPending[idx];
  const targetCity = cityKey && next.cities[cityKey]?.owner === next.player ? cityKey : firstCity(world, next);
  const fee = effectiveWildFee(next, talent);
  if (next.factions[next.player].treasury < fee) {
    throw new Error(`礼聘「${talent.name}」需礼金 ${fee} 钱，国库不足。`);
  }
  const key = "saga-wild-" + talent.id;
  if (eraByYear(world, next).officers.some((o) => o.key === key)) {
    throw new Error(`${talent.name} 已在幕府名册中。`);
  }
  next.factions[next.player].treasury -= fee;
  next.factions[next.player].morale = clamp(next.factions[next.player].morale + 2, 15, 100);
  saga.reputation = clamp((saga.reputation ?? 50) + 2, 0, 100);
  saga.wildPending.splice(idx, 1);
  saga.wildRecruits = [...(saga.wildRecruits ?? []), {
    key,
    faction: next.player,
    name: talent.name,
    governance: talent.governance,
    command: talent.command,
    turn: next.turn,
  }].slice(-MAX_WILD_RECRUITS);
  next.stations[key] = targetCity;
  recordAnnal(next, "礼贤", `以 ${fee} 钱礼聘「${talent.name}（${talent.title}）」出山，入仕驻${cityName(world, targetCity)}。`);
  return next;
}

export function captiveRecruitChance(world, state, officerKey, fromFaction) {
  const era = eraByYear(world, state);
  const officer = era.officers.find((o) => o.key === officerKey);
  if (!officer) return 45;
  const saga = state.saga ?? { reputation: 50 };
  const profile = factionCourtProfile(world, state, state.player);
  const fromAlive = Object.values(state.cities).some((c) => c.owner === fromFaction);
  const playerCities = Object.values(state.cities).filter((c) => c.owner === state.player).length;
  let chance = 48 + Math.round(((saga.reputation ?? 50) - 50) * 0.55);
  if (profile.tier === "imperial") chance += 14;
  else if (profile.tier === "royal" || profile.tier === "regent") chance += 8;
  if (!fromAlive) chance += 22;
  if (playerCities >= 14) chance += 8;
  if (DIEHARD_NAMES.has(officer.name) && fromAlive) chance -= 24;
  return clamp(chance, 15, 95);
}

export function maybeCaptureOfficer(world, era, state, { attackerFaction, defenderFaction, cityKey, defenderKey, tactic, ratio, wasLastCity, bonusProb = 0 }) {
  if (!state?.century || !state.saga || attackerFaction !== state.player || !defenderKey) return null;
  if ((state.saga.captives?.length ?? 0) >= MAX_CAPTIVES || isOfficerUnavailable(state, defenderKey)) return null;
  if (armyByOfficer(state, defenderKey)) return null;
  const officer = era.officers.find((o) => o.key === defenderKey && o.faction === defenderFaction);
  if (!officer) return null;
  const isFactionHead = state.polity?.courts?.[defenderFaction]?.head === defenderKey
    || era.factions.find((f) => f.key === defenderFaction)?.leader === defenderKey;
  if (isFactionHead && !wasLastCity) return null;

  let prob = 30 + (bonusProb ?? 0);
  if (wasLastCity) prob += 55;
  if (ratio >= 1.4) prob += 20;
  if (tactic === "stratagem" || tactic === "rally") prob += 18;
  const hash = [...(cityKey + defenderKey)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const roll = (state.turn * 37 + hash * 13 + Math.round(ratio * 100)) % 100;
  if (roll >= prob) return null;

  for (const holding of Object.values(state.cities)) {
    if (holding.governor === defenderKey) {
      holding.governor = null;
      holding.mode = "direct";
    }
    if (holding.commander === defenderKey) holding.commander = null;
  }
  state.stations[defenderKey] = null;
  state.saga.captives = [...(state.saga.captives ?? []), {
    officer: defenderKey,
    from: defenderFaction,
    city: cityKey,
    turn: state.turn,
    attempted: false,
  }].slice(-MAX_CAPTIVES);
  const meta = officerMeta(officer);
  return {
    officer: defenderKey,
    name: officer.name,
    from: defenderFaction,
    title: meta.title || "",
  };
}

export function resolveCaptive(world, state, officerKey, decision) {
  if (!state?.century || !state.saga || gameOutcome(state) !== "ongoing") {
    throw new Error("当前无法裁决俘将。");
  }
  if (!["recruit", "ransom", "release", "execute"].includes(decision)) {
    throw new Error("未知的俘将裁决方式。");
  }
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const idx = (saga.captives ?? []).findIndex((c) => c.officer === officerKey);
  if (idx < 0) throw new Error("该俘将不在羁押名录中。");
  const captive = saga.captives[idx];
  const era = eraByYear(world, next);
  const officer = era.officers.find((o) => o.key === officerKey);
  if (!officer) throw new Error("未查到此将档案。");
  const homeCity = firstCity(world, next);
  const enemyAlive = livingSide(next, captive.from);
  const enemyHome = enemyAlive ? retreatCity(world, next, captive.from, captive.city) : null;

  if (decision === "recruit") {
    if (captive.attempted) throw new Error(`${officer.name} 此前已坚辞不受，可选择赎放、礼释或斩首。`);
    const chance = captiveRecruitChance(world, next, officerKey, captive.from);
    const hash = [...officerKey].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const roll = (next.turn * 29 + hash * 17 + saga.reputation) % 100;
    if (chance < 80 && roll >= chance) {
      captive.attempted = true;
      return {
        state: next,
        outcome: "refused",
        chance,
        message: `「忠臣不事二主！」${officer.name} 宁死不降（本次劝降率 ${chance}%），请另作裁决。`,
      };
    }
    saga.captives.splice(idx, 1);
    if (next.polity && officer.faction !== next.player) {
      recordAllegiance(next, officer.key, officer.faction, next.player, next.turn);
      next.stations[officer.key] = homeCity;
      cleanLosses(next, new Set([officer.key]));
    } else {
      next.stations[officer.key] = homeCity;
    }
    saga.reputation = clamp((saga.reputation ?? 50) + 1, 0, 100);
    recordAnnal(next, "归降", `${officer.name}感念礼遇，正式归降入仕${cityName(world, homeCity)}。`);
    return {
      state: next,
      outcome: "recruited",
      chance,
      message: `${officer.name} 拜服归降！已入仕驻于 ${cityName(world, homeCity)}。`,
    };
  }

  if (decision === "ransom") {
    const score = (officer.command ?? 60) + (officer.governance ?? 60);
    const gold = clamp(Math.round(score / 6), 18, 36);
    const grain = clamp(Math.round(score / 10), 10, 20);
    next.factions[next.player].treasury += gold;
    next.factions[next.player].grain += grain;
    saga.captives.splice(idx, 1);
    if (enemyHome) next.stations[officer.key] = enemyHome;
    else {
      saga.executed = [...new Set([...(saga.executed ?? []), officer.key])].slice(-MAX_EXECUTED);
      next.stations[officer.key] = null;
    }
    recordAnnal(next, "赎归", `${factionName(era, captive.from)}献金 ${gold}、粮 ${grain} 赎回俘将「${officer.name}」。`);
    return {
      state: next,
      outcome: "ransomed",
      message: `已允赎放 ${officer.name}，实收国库 +${gold} 钱、储粮 +${grain} 石。`,
    };
  }

  if (decision === "release") {
    saga.captives.splice(idx, 1);
    saga.reputation = clamp((saga.reputation ?? 50) + 6, 0, 100);
    next.factions[next.player].morale = clamp(next.factions[next.player].morale + 3, 15, 100);
    if (enemyHome) next.stations[officer.key] = enemyHome;
    else {
      saga.executed = [...new Set([...(saga.executed ?? []), officer.key])].slice(-MAX_EXECUTED);
      next.stations[officer.key] = null;
    }
    recordAnnal(next, "义释", `礼送俘将「${officer.name}」归还本部，海内传颂，声望 +6、全军士气 +3。`);
    return {
      state: next,
      outcome: "released",
      message: `已礼释 ${officer.name}，海内敬仰大义！声望 +6，全军士气 +3。`,
    };
  }

  // execute
  saga.captives.splice(idx, 1);
  saga.reputation = clamp((saga.reputation ?? 50) - 8, 0, 100);
  if (next.factions[captive.from]) {
    next.factions[captive.from].morale = clamp(next.factions[captive.from].morale - 6, 15, 100);
  }
  saga.executed = [...new Set([...(saga.executed ?? []), officer.key])].slice(-MAX_EXECUTED);
  next.stations[officer.key] = null;
  if (next.polity && next.polity.courts?.[captive.from]) {
    const court = next.polity.courts[captive.from];
    if (court.heir === officer.key) court.heir = null;
    if (court.regent === officer.key) court.regent = null;
  }
  recordAnnal(next, "军法", `斩俘将「${officer.name}」以徇三军，敌胆震慑但声望 -8。`);
  return {
    state: next,
    outcome: "executed",
    message: `已按军法斩杀 ${officer.name}（敌士气 -6，声望 -8）。`,
  };
}

export function settleSagaQuarter(world, era, state) {
  const saga = ensureSaga(state);
  if (!saga) return;
  saga.buffs = (saga.buffs ?? []).filter((b) => b.expires > state.turn).slice(-MAX_BUFFS);
  saga.rivals = (saga.rivals ?? []).filter((r) => r.expires > state.turn && livingSide(state, r.a) && livingSide(state, r.b)).slice(-MAX_RIVALS);
  for (const [k, exp] of Object.entries(saga.rumors ?? {})) {
    if (exp <= state.turn) delete saga.rumors[k];
  }
  saga.wildPending = (saga.wildPending ?? []).filter((t) => state.turn - t.turn < 4).slice(-MAX_WILD_PENDING);

  const retainedCaptives = [];
  for (const cap of saga.captives ?? []) {
    if (state.turn - cap.turn >= 4) {
      const home = livingSide(state, cap.from) ? retreatCity(world, state, cap.from, cap.city) : null;
      if (home) {
        state.stations[cap.officer] = home;
      } else {
        saga.executed = [...new Set([...(saga.executed ?? []), cap.officer])].slice(-MAX_EXECUTED);
        state.stations[cap.officer] = null;
      }
      continue;
    }
    retainedCaptives.push(cap);
  }
  saga.captives = retainedCaptives.slice(-MAX_CAPTIVES);
  saga.allyStrikes = (saga.allyStrikes ?? []).filter((s) => s.expires > state.turn && livingSide(state, s.ally)).slice(-4);
  if (saga.climate?.pending && state.turn - saga.climate.turn >= 2) {
    saga.climate.pending = false;
  }

  if (gameOutcome(state) === "ongoing") {
    saga.tech ??= { points: 0, unlocked: [] };
    saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + quarterlyTechPoints(world, era, state));
    spawnWildTalents(world, era, state);
    evaluateHistoricalEvent(world, era, state);
    evaluateCoalition(world, era, state);
    settleSeasonalClimate(world, era, state);
    // v18.0 季度结算：粮道围城、城建产出、细作过期、世代传承与天下大势快照
    const supRes = settleSupplyTurn(world, state);
    const bldRes = settleBuildingsTurn(world, supRes.state);
    const espState = settleEspionageTurn(bldRes.state);
    const lifeRes = settleLifespanTurn(era, espState);
    // v19.0 季度结算：大军团自主作战、边疆五族、朝堂法度、动态黑市商队与名战残局进度
    const corpsRes = settleCorpsTurn(world, era, lifeRes.state);
    const tribeRes = settleTribesTurn(world, corpsRes.state);
    const reformRes = settleReformsTurn(tribeRes.state);
    const commRes = settleCommerceTurn(reformRes.state);
    const advState = spawnAdventures(world, commRes.state);
    const uphRes = settleUpheavalTurn(world, era, advState);
    const vasRes = settleVassalsTurn(uphRes.state);
    const spTp = specialtyEconomyModifiers(vasRes.state, vasRes.state.player).tpBonus;
    if (spTp > 0 && vasRes.state.saga?.tech) {
      vasRes.state.saga.tech.points = (vasRes.state.saga.tech.points ?? 0) + spTp;
    }
    clearCoordinatedTargets(vasRes.state);
    const snapState = recordHistorySnapshot(vasRes.state);
    state.cities = snapState.cities;
    state.factions = snapState.factions;
    if (snapState.recruitedOfficers) state.recruitedOfficers = snapState.recruitedOfficers;
    state.saga = snapState.saga;
    const chProg = evaluateChallengeProgress(state);
    if (chProg && state.saga?.challenge) {
      state.saga.challenge.status = chProg.status;
      state.saga.challenge.medal = chProg.medal;
    }
    const v18Notes = [...supRes.notes, ...bldRes.notes, ...lifeRes.notes, ...corpsRes.notes, ...tribeRes.notes, ...reformRes.notes, ...commRes.notes, ...uphRes.notes, ...vasRes.notes];
    for (const note of v18Notes.slice(0, 4)) {
      if (Array.isArray(state.saga?.annals)) {
        state.saga.annals.push({ turn: state.turn, year: state.year + Math.floor((state.turn - 1) / 4), title: "军略奏报", text: note, kind: "war" });
        if (state.saga.annals.length > MAX_ANNALS) state.saga.annals = state.saga.annals.slice(-MAX_ANNALS);
      }
    }
  }
}

export function validSaga(world, state, officers) {
  const s = state.saga;
  if (s === undefined) return true;
  if (!state.century || !plain(s)) return false;
  const nonneg = (n) => Number.isSafeInteger(n) && n >= 0;
  if (!Number.isSafeInteger(s.reputation) || s.reputation < 0 || s.reputation > 100) return false;
  if (typeof s.historicalEvents !== "boolean") return false;
  if (!Array.isArray(s.captives) || s.captives.length > MAX_CAPTIVES) return false;
  for (const c of s.captives) {
    if (!c || !officers.has(c.officer) || !Object.hasOwn(state.factions, c.from)
      || !Object.hasOwn(state.cities, c.city) || !nonneg(c.turn) || c.turn > state.turn || typeof c.attempted !== "boolean") {
      return false;
    }
  }
  if (!Array.isArray(s.executed) || s.executed.length > MAX_EXECUTED || !s.executed.every((k) => officers.has(k))) return false;
  if (!Array.isArray(s.wildRecruits) || s.wildRecruits.length > MAX_WILD_RECRUITS) return false;
  for (const w of s.wildRecruits) {
    if (!w || typeof w.key !== "string" || !Object.hasOwn(state.factions, w.faction)
      || typeof w.name !== "string" || !nonneg(w.governance) || !nonneg(w.command) || !nonneg(w.turn) || w.turn > state.turn) {
      return false;
    }
  }
  if (!Array.isArray(s.wildPending) || s.wildPending.length > MAX_WILD_PENDING) return false;
  if (!Array.isArray(s.firedEvents) || s.firedEvents.length > MAX_FIRED_EVENTS) return false;
  if (s.pendingEvent !== null && (!plain(s.pendingEvent) || typeof s.pendingEvent.id !== "string")) return false;
  if (!Array.isArray(s.buffs) || s.buffs.length > MAX_BUFFS) return false;
  if (!Array.isArray(s.rivals) || s.rivals.length > MAX_RIVALS) return false;
  if (!plain(s.rumors)) return false;
  if (!Number.isSafeInteger(s.plotsUsedTurn) || s.plotsUsedTurn < -1 || s.plotsUsedTurn > state.turn) return false;
  if (s.plotsUsedCount !== undefined && (!nonneg(s.plotsUsedCount) || s.plotsUsedCount > 4)) return false;
  if (s.tech !== undefined && (!plain(s.tech) || !nonneg(s.tech.points) || !Array.isArray(s.tech.unlocked) || s.tech.unlocked.length > 16)) return false;
  if (s.coalition !== undefined && s.coalition !== null && (!plain(s.coalition) || !Array.isArray(s.coalition.members) || !nonneg(s.coalition.ends))) return false;
  if (s.allyStrikes !== undefined && (!Array.isArray(s.allyStrikes) || s.allyStrikes.length > 6)) return false;
  if (s.climate !== undefined && s.climate !== null && (!plain(s.climate) || typeof s.climate.id !== "string")) return false;
  if (s.duelWins !== undefined && !nonneg(s.duelWins)) return false;
  if (s.rules !== undefined && !plain(s.rules)) return false;
  if (s.custom !== undefined && s.custom !== null && (!plain(s.custom) || typeof s.custom.rulerName !== "string")) return false;
  if (!Array.isArray(s.annals) || s.annals.length > MAX_ANNALS) return false;
  return true;
}
