import {
  appoint, availableAttackers, availableForPosting, cityName, cityReserve, delegationZones,
  eraByYear, expeditionGrain, factionName, forecastAttack, gameOutcome, minimumMarch,
  previewMilitaryOrders, previewOrders, queueOrder, seasonOrderLimit, setGovernance,
  setNationalPolicy, transferGrain, transferOfficer, validateOrder,
} from "./engine.js";
import { armyByOfficer, marchRoute, mobilizationQuote } from "./armies.js";
import { officerSkill } from "./campaign.js";
import { annualDraft15, openCases15, provinceAgreement15, publishYear15 } from "./century.js";
import { latestSeasonSummary } from "./chronicle.js";
import { isHostile, treatyTerms } from "./diplomacy.js";
import { dynastyProvinces } from "./dynasty.js";
import { getPendingHistoricalEvent } from "./historical-events.js";
import { factionCourtProfile } from "./imperial.js";
import { knownOfficer } from "./personnel.js";
import { regionCandidates10 } from "./reign.js";
import { effectiveWildFee, isOfficerUnavailable } from "./saga.js";
import { isCoalitionActive } from "./coalition.js";
import { promotableOfficers } from "./duels.js";
import { advisorStrategicBrief } from "./stratagems.js";
import { BATTLE_TACTICS, isOpeningPrepTurn, normalizeTactic } from "./tactics.js";
import { canResearchTech, TECH_TREE } from "./tech.js";
import { activeBondsForOfficer, hasTrait, officerMeta } from "./traits.js";

export const SOVEREIGN_DOCTRINES = [
  {
    id: "rest",
    name: "休养生息",
    short: "休养",
    tag: "固本培元",
    annualObjective: "recovery",
    provinceObjective: "relief",
    desc: "后方全力屯田开源，前线固防少耗钱粮，同步安定州郡。",
    policy: {
      front: { focus: "defense", budget: 18, garrison: 1200 },
      rear: { focus: "farming", budget: 24, garrison: 400 },
    },
  },
  {
    id: "prepare",
    name: "整军备战",
    short: "备战",
    tag: "厉兵秣马",
    annualObjective: "accord",
    provinceObjective: "defense",
    desc: "前线募兵充实至 2000，后方商贸供饷并保境兴盟。",
    policy: {
      front: { focus: "recruit", budget: 35, garrison: 2000 },
      rear: { focus: "commerce", budget: 20, garrison: 500 },
    },
  },
  {
    id: "expand",
    name: "倾国进取",
    short: "进取",
    tag: "经略四方",
    annualObjective: "expansion",
    provinceObjective: "defense",
    desc: "预算与兵员全面向前线倾斜，高额募兵备战，伺机大举开拓。",
    policy: {
      front: { focus: "recruit", budget: 50, garrison: 2600 },
      rear: { focus: "farming", budget: 18, garrison: 300 },
    },
  },
];

export const PROVINCE_DIRECTIVES = {
  growth: { id: "growth", label: "垦殖", focus: "farming", budget: 24 },
  defense: { id: "defense", label: "守边", focus: "recruit", budget: 35 },
  relief: { id: "relief", label: "安民", focus: "defense", budget: 20 },
};

function zoneMatch(left, right) {
  return Boolean(left && right)
    && left.focus === right.focus
    && left.budget === right.budget
    && left.garrison === right.garrison;
}

export function detectSovereignDoctrine(state) {
  const policy = state?.nationalPolicy;
  if (!policy) return null;
  const found = SOVEREIGN_DOCTRINES.find(({ policy: target }) => (
    zoneMatch(policy.front, target.front) && zoneMatch(policy.rear, target.rear)
  ));
  return found ? found.id : null;
}

function governorScore(state, officer) {
  return officerSkill(state, officer, "governance")
    + (hasTrait(officer, "farming") ? 18 : 0)
    + (hasTrait(officer, "logistics") ? 8 : 0);
}

function commanderScore(state, officer, isFront) {
  return officerSkill(state, officer, "command")
    + (isFront && hasTrait(officer, "fortress") ? 16 : 0)
    + (hasTrait(officer, "charisma") ? 10 : 0)
    + (hasTrait(officer, "cavalry") ? 8 : 0);
}

function attackerScore(state, officer, tacticId) {
  const meta = officerMeta(officer);
  const cmd = officerSkill(state, officer, "command");
  const gov = officerSkill(state, officer, "governance");
  if (tacticId === "stratagem") {
    return (meta.intellect ?? 50) * 1.45 + cmd * 0.55
      + (hasTrait(officer, "fire") ? 16 : 0)
      + (hasTrait(officer, "ambush") ? 16 : 0)
      + (hasTrait(officer, "logistics") ? 8 : 0);
  }
  if (tacticId === "rally") {
    return gov * 0.9 + (meta.intellect ?? 50) * 0.55 + cmd * 0.55
      + (hasTrait(officer, "charisma") ? 20 : 0);
  }
  if (tacticId === "siege") {
    return cmd * 1.15 + (hasTrait(officer, "logistics") ? 12 : 0) + (hasTrait(officer, "ambush") ? 10 : 0);
  }
  return cmd + (meta.might ?? 50) * 0.35
    + (hasTrait(officer, "cavalry") ? 12 : 0)
    + (hasTrait(officer, "fire") ? 10 : 0)
    + (hasTrait(officer, "ambush") ? 10 : 0)
    + (hasTrait(officer, "charisma") ? 6 : 0);
}

/**
 * Automatically fills vacant city governor & commander slots using idle faction officers,
 * prioritizing historical traits (屯田/筹策 for governors; 铁壁/威名/突骑 for commanders).
 */
export function autoStaffRealm(world, state) {
  if (gameOutcome(state) !== "ongoing") {
    return { state, appointed: 0, governors: 0, commanders: 0, remainingVacant: 0 };
  }
  let next = state;
  const era = eraByYear(world, next);
  const { front, rear } = delegationZones(world, next);
  const frontSet = new Set(front);

  const idlePool = () => era.officers.filter((o) => (
    o.faction === next.player && knownOfficer(next, o) && !isOfficerUnavailable(next, o.key) && availableForPosting(next, o.key)
  ));

  // Phase A: Vacant governors (occupation recovery first, then rear, then front)
  const vacantGovCities = [...front, ...rear]
    .filter((key) => !next.cities[key].governor)
    .sort((a, b) => {
      const occDiff = (next.cities[b].occupation > 0 ? 1 : 0) - (next.cities[a].occupation > 0 ? 1 : 0);
      if (occDiff) return occDiff;
      return (frontSet.has(a) ? 1 : 0) - (frontSet.has(b) ? 1 : 0);
    });

  let governors = 0;
  for (const cityKey of vacantGovCities) {
    const candidates = idlePool().sort((a, b) => governorScore(next, b) - governorScore(next, a));
    if (!candidates.length) break;
    next = appoint(world, next, cityKey, "governor", candidates[0].key);
    governors += 1;
  }

  // Phase B: Vacant commanders (front cities first, then rear)
  const vacantCmdCities = [...front, ...rear].filter((key) => !next.cities[key].commander);
  let commanders = 0;
  for (const cityKey of vacantCmdCities) {
    const candidates = idlePool().sort((a, b) => commanderScore(next, b, frontSet.has(cityKey)) - commanderScore(next, a, frontSet.has(cityKey)));
    if (!candidates.length) break;
    next = appoint(world, next, cityKey, "commander", candidates[0].key);
    commanders += 1;
  }

  const remainingVacant = [...front, ...rear].filter((key) => !next.cities[key].governor).length;
  return {
    state: next,
    appointed: governors + commanders,
    governors,
    commanders,
    remainingVacant,
  };
}

/**
 * Lists all player-held macro provinces along with current governor seat, eligible candidates,
 * troop strength, and current directive.
 */
export function listSovereignProvinces(world, state) {
  if (gameOutcome(state) === "defeat") return [];
  const era = eraByYear(world, state);
  const officerMap = new Map(era.officers.map((o) => [o.key, o]));

  const rows = state.dynasty
    ? dynastyProvinces(world, state)
    : (() => {
      const groups = new Map();
      for (const { key, region } of world.cities) {
        if (state.cities[key].owner !== state.player) continue;
        const list = groups.get(region) ?? [];
        list.push(key);
        groups.set(region, list);
      }
      return [...groups].map(([region, cities]) => ({
        region,
        cities,
        welfare: Math.round(cities.reduce((sum, key) => sum + (state.realm?.cities?.[key]?.welfare ?? 68), 0) / cities.length),
        pressure: 0,
        garrison: cities.reduce((sum, key) => sum + state.cities[key].troops, 0),
      }));
    })();

  return rows
    .map((prov) => {
      const seat = state.reign?.seats?.[prov.region] ?? null;
      const activeSeat = seat && seat.end > state.turn ? seat : null;
      const candidates = state.reign
        ? regionCandidates10(world, state, prov.region)
        : era.officers.filter((o) => o.faction === state.player && knownOfficer(state, o) && !isOfficerUnavailable(state, o.key))
          .sort((a, b) => governorScore(state, b) - governorScore(state, a));
      const leadOfficer = activeSeat?.lead ? officerMap.get(activeSeat.lead) ?? null : null;
      const directive = activeSeat?.objective ?? "growth";
      const vacantGovs = prov.cities.filter((k) => !state.cities[k].governor).length;
      return {
        region: prov.region,
        cities: prov.cities,
        troops: prov.garrison ?? prov.cities.reduce((sum, key) => sum + state.cities[key].troops, 0),
        welfare: prov.welfare ?? 68,
        pressure: prov.pressure ?? 0,
        vacantGovs,
        seat: activeSeat,
        leadOfficer,
        candidates,
        directive,
      };
    })
    .sort((a, b) => b.cities.length - a.cities.length || b.troops - a.troops);
}

/**
 * Appoints or updates a provincial governor (州牧) and aligns that province's city stance
 * without forcing manual forms or throwing when century.plan has not been signed yet.
 */
export function assignProvinceGovernor(world, state, region, { officerKey, directive = "growth", syncCities = true } = {}) {
  if (gameOutcome(state) !== "ongoing") throw new Error("战局已结束，无法任免州牧。");
  const validDir = Object.hasOwn(PROVINCE_DIRECTIVES, directive) ? directive : "growth";
  let next = state;

  if (next.century) {
    const mode = validDir === "relief" ? "compact" : "renew";
    next = provinceAgreement15(world, next, region, mode, {
      ...(officerKey ? { leadKey: officerKey } : {}),
      objective: validDir,
    });
  } else {
    throw new Error("当前模式尚未开启州郡官制。");
  }

  if (syncCities) {
    const era = eraByYear(world, next);
    const preset = PROVINCE_DIRECTIVES[validDir];
    const provCities = world.cities.filter((c) => c.region === region && next.cities[c.key]?.owner === next.player).map((c) => c.key);
    for (const cityKey of provCities) {
      if (!next.cities[cityKey].governor) {
        const best = era.officers
          .filter((o) => o.faction === next.player && knownOfficer(next, o) && availableForPosting(next, o.key))
          .sort((a, b) => governorScore(next, b) - governorScore(next, a))[0];
        if (best) next = appoint(world, next, cityKey, "governor", best.key);
      }
      if (next.cities[cityKey].governor) {
        next = setGovernance(next, cityKey, "delegated", preset.focus, preset.budget);
      }
    }
  }

  const appointedKey = next.reign?.seats?.[region]?.lead;
  const appointedOfficer = eraByYear(world, next).officers.find((o) => o.key === appointedKey) ?? null;
  return { state: next, region, officer: appointedOfficer, directive: validDir };
}

/**
 * Appoints provincial governors for all player-held provinces lacking an active governor.
 */
export function appointAllProvinceGovernors(world, state, { objective = "growth", syncCities = false } = {}) {
  if (!state.century || gameOutcome(state) !== "ongoing") return { state, count: 0 };
  let next = state;
  let count = 0;
  const era = eraByYear(world, next);
  const hasLocal = (region) => {
    const towns = new Set(world.cities.filter((c) => c.region === region && next.cities[c.key]?.owner === next.player).map((c) => c.key));
    return era.officers.some((o) => o.faction === next.player && knownOfficer(next, o) && towns.has(next.stations[o.key]));
  };
  const rawProvs = listSovereignProvinces(world, next);
  const provs = [
    ...rawProvs.filter((p) => hasLocal(p.region)),
    ...rawProvs.filter((p) => !hasLocal(p.region)),
  ];
  for (const prov of provs) {
    const hasActiveLead = Boolean(prov.leadOfficer && regionCandidates10(world, next, prov.region).some((o) => o.key === prov.leadOfficer.key));
    if (hasActiveLead) continue;
    try {
      const res = assignProvinceGovernor(world, next, prov.region, { directive: objective, syncCities });
      next = res.state;
      count += 1;
    } catch {
      // Skip province if zero officers exist in the entire faction
    }
  }
  return { state: next, count };
}

/**
 * Applies a realm-wide Sovereign doctrine: auto-staffs vacant posts,
 * clears per-city manual overrides, delegates all governed cities to the doctrine,
 * saves `state.nationalPolicy`, and syncs unified `century.plan` + provincial governors.
 */
export function applySovereignDoctrine(world, state, doctrineId, { autoStaff = true, syncCentury = true } = {}) {
  const doctrine = SOVEREIGN_DOCTRINES.find(({ id }) => id === doctrineId);
  if (!doctrine) throw new Error("未知治国总纲。");

  let next = state;
  let appointed = 0;
  if (autoStaff) {
    const staffed = autoStaffRealm(world, next);
    next = staffed.state;
    appointed = staffed.appointed;
  }

  next = setNationalPolicy(next, null);
  const zones = delegationZones(world, next);
  let delegatedCount = 0;

  for (const [zone, keys] of Object.entries(zones)) {
    const setting = doctrine.policy[zone];
    for (const key of keys) {
      const city = next.cities[key];
      if (!city.governor) continue;
      const focus = city.troops < setting.garrison ? "recruit" : setting.focus;
      next = setGovernance(next, key, "delegated", focus, setting.budget);
      delegatedCount += 1;
    }
  }

  next = setNationalPolicy(next, null);
  next = setNationalPolicy(next, doctrine.policy);

  let provincesAppointed = 0;
  if (next.century && syncCentury && gameOutcome(next) === "ongoing") {
    next = publishYear15(world, next, annualDraft15(doctrine.annualObjective), { auto: true });
    const provRes = appointAllProvinceGovernors(world, next, {
      objective: doctrine.provinceObjective,
      syncCities: false,
    });
    next = provRes.state;
    provincesAppointed = provRes.count;
    next = setNationalPolicy(next, null);
    next = setNationalPolicy(next, doctrine.policy);
  }

  return { state: next, doctrine, appointed, delegatedCount, provincesAppointed };
}

/**
 * Sets a single friendly city's Sovereign posture ("front" | "rear" | "direct").
 * Automatically appoints the best idle governor if switching to delegation without one.
 */
export function applyCityDirective(world, state, cityKey, directive) {
  if (directive === "direct") {
    const current = state.cities[cityKey];
    if (!current) throw new Error("未找到指定城池。");
    return {
      state: setGovernance(state, cityKey, "direct", current.focus, current.delegateBudget ?? null),
      autoAppointed: null,
    };
  }

  const preset = directive === "front"
    ? { focus: "recruit", budget: 35 }
    : directive === "rear"
      ? { focus: "farming", budget: 24 }
      : null;
  if (!preset) throw new Error("未知城池处置方针。");

  let next = state;
  let autoAppointed = null;
  if (!next.cities[cityKey]?.governor) {
    const era = eraByYear(world, next);
    const best = era.officers
      .filter((o) => o.faction === next.player && knownOfficer(next, o) && availableForPosting(next, o.key))
      .sort((a, b) => governorScore(next, b) - governorScore(next, a))[0];
    if (!best) throw new Error(`暂无空闲文武可出任太守，无法转为${factionCourtProfile(world, next).lexicon.delegateVerb}。`);
    next = appoint(world, next, cityKey, "governor", best.key);
    autoAppointed = best;
  }

  next = setGovernance(next, cityKey, "delegated", preset.focus, preset.budget);
  return { state: next, autoAppointed };
}

/**
 * Finds the best adjacent friendly city to reinforce `targetCity` quickly.
 */
export function quickReinforcePlan(world, state, plannedInput, targetCity) {
  if (gameOutcome(state) !== "ongoing") {
    return { ok: false, reason: "ended", message: "战局已结束。" };
  }
  if (state.orders.length >= seasonOrderLimit) {
    return { ok: false, reason: "queue-full", message: "本季政令已满。" };
  }
  const planned = plannedInput || previewOrders(world, state);
  const target = planned.cities[targetCity];
  if (!target || target.owner !== state.player) {
    return { ok: false, reason: "not-own", message: "只能增援己方城池。" };
  }
  const node = world.cities.find((c) => c.key === targetCity);
  const grain = planned.factions[state.player].grain;
  let best = null;
  for (const from of node?.links ?? []) {
    const origin = planned.cities[from];
    if (!origin || origin.owner !== state.player) continue;
    const maxByTroops = origin.troops - cityReserve;
    const maxByGrain = grain * 100;
    const maxSend = Math.min(maxByTroops, maxByGrain);
    if (maxSend < minimumMarch) continue;
    const isOriginExposed = world.cities.find((c) => c.key === from)?.links
      .some((n) => planned.cities[n]?.owner !== state.player && isHostile(planned, state.player, planned.cities[n].owner));
    const sendTroops = Math.max(minimumMarch, Math.min(maxSend, Math.round(((origin.troops - cityReserve) * (isOriginExposed ? 0.4 : 0.65)) / 50) * 50));
    const order = { type: "transfer", from, to: targetCity, troops: sendTroops };
    try {
      validateOrder(world, planned, state.player, order);
    } catch {
      continue;
    }
    const costGrain = transferGrain(order);
    const score = (isOriginExposed ? 0 : 1000) + sendTroops + origin.troops * 0.25;
    if (!best || score > best.score) {
      best = { ok: true, from, to: targetCity, troops: sendTroops, grain: costGrain, score };
    }
  }
  if (!best) return { ok: false, reason: "no-donor", message: "邻城暂无足够兵力或储粮可调援。" };
  return best;
}

export function executeSovereignReinforce(world, state, plan) {
  if (!plan?.ok) throw new Error(plan?.message || "无法拟定调援方案。");
  return queueOrder(world, state, { type: "transfer", from: plan.from, to: plan.to, troops: plan.troops });
}

/**
 * Evaluates the optimal 1-click expedition plan from adjacent player cities to `targetCity`,
 * optionally locked to a specific battle tactic (`assault` | `siege` | `stratagem` | `rally`).
 */
export function bestAttackPlan(world, state, plannedInput, targetCity, { tactic } = {}) {
  if (gameOutcome(state) !== "ongoing") {
    return { ok: false, reason: "ended", message: "战局已决，无法继续用兵。" };
  }
  if (isOpeningPrepTurn(state)) {
    return {
      ok: false,
      reason: "opening-prep",
      message: "开局首季为「整军备战期」，请先颁行国策、委任州牧并整顿边备，次季（夏）方可正式兴兵。",
    };
  }
  if (state.orders.length >= seasonOrderLimit) {
    return { ok: false, reason: "queue-full", message: `本季政令已满（${seasonOrderLimit}/${seasonOrderLimit}）。` };
  }
  const planned = plannedInput || previewOrders(world, state);
  const targetHolding = state.cities[targetCity];
  if (!targetHolding || targetHolding.owner === state.player) {
    return { ok: false, reason: "own-city", message: "此城已在治下。" };
  }
  if (!isHostile(state, state.player, targetHolding.owner)) {
    return { ok: false, reason: "treaty", message: "当前与该势力存在停战或同盟，不可交战。" };
  }

  const targetNode = world.cities.find(({ key }) => key === targetCity);
  const neighbors = (targetNode?.links || []).filter((key) => planned.cities[key]?.owner === state.player);
  if (!neighbors.length) {
    return {
      ok: false,
      reason: "unreachable",
      message: "未与己方城池直接接壤，需先推进前线或在「幕府详图」组建远征军团。",
    };
  }

  const era = eraByYear(world, state);
  const intelState = previewMilitaryOrders(world, state);
  const availableGrain = planned.factions[state.player].grain;
  const availableTreasury = planned.factions[state.player].treasury;
  const committedOfficers = new Set(state.orders.map((o) => o.officer).filter(Boolean));
  const resourceSafeState = {
    ...state,
    factions: {
      ...state.factions,
      [state.player]: { ...state.factions[state.player], grain: 9999, treasury: 9999 },
    },
  };

  const tacticChoices = tactic ? [normalizeTactic(tactic)] : (state.century ? Object.keys(BATTLE_TACTICS) : ["assault"]);

  const pickFallbackOfficers = (tId) => era.officers
    .filter((o) => (
      o.faction === state.player
      && knownOfficer(planned, o)
      && !isOfficerUnavailable(planned, o.key)
      && availableForPosting(planned, o.key)
      && !committedOfficers.has(o.key)
    ))
    .sort((a, b) => attackerScore(planned, b, tId) - attackerScore(planned, a, tId))
    .slice(0, 2);

  let best = null;
  let hadTroops = false;
  let hadOfficer = false;
  let blockReason = "直达军路被天气或敌方据点阻断。";

  for (const from of neighbors) {
    const maxSend = planned.cities[from].troops - cityReserve;
    if (maxSend < minimumMarch) continue;
    hadTroops = true;

    const rawStationed = availableAttackers(era, planned, state.player, from)
      .filter((officer) => !committedOfficers.has(officer.key));
    const canTransferHere = state.cities[from]?.owner === state.player;
    if (!rawStationed.length && (!canTransferHere || !pickFallbackOfficers("assault").length)) continue;
    hadOfficer = true;

    const ratios = [0.6, 0.8, 1.0];
    const troopOptions = [...new Set(ratios.map((r) => (
      r >= 1 ? maxSend : Math.max(minimumMarch, Math.min(maxSend, Math.round((maxSend * r) / 50) * 50))
    )))];

    for (const tId of tacticChoices) {
      const topStationed = [...rawStationed]
        .sort((a, b) => attackerScore(planned, b, tId) - attackerScore(planned, a, tId))
        .slice(0, 2)
        .map((officer) => ({ officer, needsTransfer: false }));
      const candidates = topStationed.length
        ? topStationed
        : pickFallbackOfficers(tId).map((officer) => ({ officer, needsTransfer: true }));

      for (const { officer, needsTransfer } of candidates) {
        const simIntel = needsTransfer
          ? { ...intelState, stations: { ...intelState.stations, [officer.key]: from } }
          : intelState;

        for (const troops of troopOptions) {
          const order = state.century
            ? { type: "attack", from, to: targetCity, officer: officer.key, troops, tactic: tId }
            : { type: "attack", from, to: targetCity, officer: officer.key, troops };
          try {
            executeSovereignAttack(world, resourceSafeState, {
              ok: true,
              from,
              to: targetCity,
              officer,
              needsTransfer,
              troops,
              tactic: tId,
            });
          } catch (err) {
            blockReason = err.message;
            continue;
          }
          const outcome = forecastAttack(era, simIntel, order, state.player);
          const affordable = availableGrain >= outcome.grain && availableTreasury >= (outcome.treasury ?? 0);
          const ratio = outcome.offense / Math.max(1, outcome.defense);
          const lossPenalty = (outcome.estimatedAttackerLoss ?? 0) / Math.max(1, troops) * 1.4;
          const costPenalty = ((outcome.treasury ?? 0) * 0.015);
          const score = (affordable ? 1000 : 0)
            + (outcome.wins ? 120 : 0)
            + ratio * 12
            - lossPenalty
            - costPenalty
            - (troops / maxSend) * 0.35
            - (needsTransfer ? 0.25 : 0);

          if (!best || score > best.score) {
            best = {
              ok: true,
              from,
              to: targetCity,
              officer,
              needsTransfer,
              troops,
              tactic: tId,
              grain: outcome.grain,
              treasury: outcome.treasury ?? 0,
              affordable,
              outcome,
              score,
            };
          }
        }
      }
    }
  }

  if (best) return best;
  if (!hadTroops) {
    return {
      ok: false,
      reason: "no-troops",
      message: "周边接壤城池可调兵力不足（每城须至少留守 250 人且可派 200 人以上）。",
    };
  }
  if (!hadOfficer) {
    return {
      ok: false,
      reason: "no-officer",
      message: "周边前线及待命池中暂无可用领兵武将。",
    };
  }
  return { ok: false, reason: "blocked", message: blockReason };
}

/**
 * Commits a plan returned by `bestAttackPlan`: transfers the commander first if idle in rear,
 * then queues the expedition order atomically.
 */
export function executeSovereignAttack(world, state, plan) {
  if (!plan?.ok) throw new Error(plan?.message || "无法拟定出征方案。");
  let next = state;
  if (plan.needsTransfer) {
    next = transferOfficer(world, next, plan.officer.key, plan.from);
  }
  return queueOrder(world, next, {
    type: "attack",
    from: plan.from,
    to: plan.to,
    officer: plan.officer.key,
    troops: plan.troops,
    ...(plan.tactic && state.century ? { tactic: plan.tactic } : {}),
  });
}

export function chiefAdvisor(era, state) {
  const advisors = era.officers
    .filter((o) => o.faction === state.player && knownOfficer(state, o) && !isOfficerUnavailable(state, o.key))
    .map((officer) => ({ officer, meta: officerMeta(officer) }))
    .sort((a, b) => b.meta.intellect - a.meta.intellect
      || officerSkill(state, b.officer, "governance") - officerSkill(state, a.officer, "governance"));
  return advisors[0] || null;
}

/**
 * Distills deep army logistics / naval crossing mechanics into a 1-click Sovereign maneuver proposal.
 */
export function findGrandManeuverPlan(world, state, plannedInput) {
  if (!state?.century || isOpeningPrepTurn(state) || state.orders.length >= seasonOrderLimit || gameOutcome(state) !== "ongoing") {
    return null;
  }
  const planned = plannedInput || previewOrders(world, state);
  const era = eraByYear(world, state);
  const committed = new Set(state.orders.map((o) => o.officer).filter(Boolean));

  // 1. Intercept hostile expedition depot (截粮奇袭)
  for (const army of planned.armies ?? []) {
    if (army.faction === state.player || !isHostile(planned, state.player, army.faction)) continue;
    if (!["march", "muster"].includes(army.phase)) continue;
    const depot = army.depot || army.route?.[0];
    const depotCity = planned.cities[depot];
    if (!depotCity || depotCity.owner === state.player) continue;
    const depotNode = world.cities.find((c) => c.key === depot);
    for (const from of depotNode?.links ?? []) {
      const origin = planned.cities[from];
      if (!origin || origin.owner !== state.player) continue;
      const troops = origin.troops - cityReserve;
      if (troops < 500) continue;
      const officers = availableAttackers(era, planned, state.player, from).filter((o) => !committed.has(o.key));
      const officer = officers.sort((a, b) => attackerScore(planned, b, "stratagem") - attackerScore(planned, a, "stratagem"))[0];
      if (!officer) continue;
      const order = { type: "attack", from, to: depot, officer: officer.key, troops, tactic: "stratagem" };
      try {
        validateOrder(world, state, state.player, order);
      } catch {
        continue;
      }
      const fc = forecastAttack(era, planned, order, state.player);
      if (fc.offense >= fc.defense * 0.92) {
        return {
          kind: "cut_supply",
          title: `轻骑断「${factionName(era, army.faction)}」粮道：奇袭${cityName(world, depot)}`,
          detail: `${factionName(era, army.faction)}远征军团正自${cityName(world, depot)}发兵${cityName(world, army.target)}。由${cityName(world, from)}遣「${officer.name}」直捣后勤据点，可一战断敌补给！`,
          order,
        };
      }
    }
  }

  // 2. Waterborne expedition via Yangtze / river routes (水师远征)
  if (state.landscape && (planned.armies?.filter((a) => a.faction === state.player).length ?? 0) < 2) {
    const ownedPorts = world.cities.filter(({ key }) => planned.cities[key].owner === state.player && !planned.cities[key].occupation);
    const hostileCities = world.cities.filter(({ key }) => planned.cities[key].owner !== state.player && isHostile(planned, state.player, planned.cities[key].owner));
    for (const fromNode of ownedPorts) {
      const from = fromNode.key;
      const troops = Math.min(2000, planned.cities[from].troops - 500);
      if (troops < 900) continue;
      const officer = availableAttackers(era, planned, state.player, from)
        .filter((o) => !committed.has(o.key))
        .sort((a, b) => (b.command + (hasTrait(b, "navy") ? 18 : 0)) - (a.command + (hasTrait(a, "navy") ? 18 : 0)))[0];
      if (!officer) continue;
      for (const toNode of hostileCities) {
        if (fromNode.links.includes(toNode.key)) continue;
        const route = marchRoute(world, state, state.player, from, toNode.key, "water");
        if (!route || route.length < 2) continue;
        const order = { type: "mobilize", from, to: toNode.key, officer: officer.key, troops, stance: "assault", travel: "water" };
        try {
          validateOrder(world, state, state.player, order);
          const quote = mobilizationQuote(world, state, state.player, order);
          const fc = forecastAttack(era, planned, order, state.player, { travel: "water" });
          if (fc.wins) {
            return {
              kind: "naval_expedition",
              title: `水陆并进：自${fromNode.name}发水师直取${toNode.name}`,
              detail: `乘舟师水路顺流奔袭（约 ${quote.quarters} 季抵敌城下，携粮 ${quote.carried} 石），遣「${officer.name}」率 ${troops.toLocaleString("zh-CN")} 兵跨越天堑！`,
              order,
            };
          }
        } catch {
          // Skip invalid route or budget
        }
      }
    }
  }

  return null;
}

export function executeGrandManeuver(world, state, plan) {
  if (!plan?.order) throw new Error("暂无可执行的高阶奇谋。");
  return queueOrder(world, state, plan.order);
}

/**
 * Generates up to 4 high-priority Sovereign memorials with 1-click resolutions.
 */
export function buildImperialMemorials(world, state, plannedInput, options = {}) {
  const era = eraByYear(world, state);
  const planned = plannedInput || previewOrders(world, state);
  const profile = factionCourtProfile(world, state, state.player, options);
  const lex = profile.lexicon;
  const advisor = chiefAdvisor(era, state);
  const recap = latestSeasonSummary(state);
  const strategicBrief = state.century ? advisorStrategicBrief(world, era, state) : "";
  const pendingEvent = state.century ? getPendingHistoricalEvent(world, state) : null;
  const captives = (state.saga?.captives ?? []).map((c) => {
    const officer = era.officers.find((o) => o.key === c.officer) || null;
    return { ...c, officerObj: officer, fromName: factionName(era, c.from), cityName: cityName(world, c.city) };
  });
  const wildPending = state.saga?.wildPending ?? [];
  const memorials = [];

  if (gameOutcome(state) !== "ongoing") {
    return { advisor, recap, strategicBrief, pendingEvent, captives, wildPending, memorials, profile };
  }

  // 0a. Pending historical event decision
  if (pendingEvent) {
    memorials.push({
      id: `event-${pendingEvent.id}`,
      kind: "historical-event",
      tag: pendingEvent.tag || "史实奇局",
      tone: "good",
      title: pendingEvent.title,
      detail: pendingEvent.body,
      actions: [
        { label: "御览裁定", kind: "primary", op: "open-historical-event", eventId: pendingEvent.id },
      ],
    });
  }

  // 0a2. Pending seasonal climate/harvest decision
  const climate = state.century && state.saga?.climate?.pending ? state.saga.climate : null;
  if (climate && memorials.length < 4) {
    const isHarvest = climate.id === "harvest";
    memorials.push({
      id: `climate-${climate.turn}`,
      kind: "climate",
      tag: isHarvest ? "天时岁稔" : "灾异急报",
      tone: climate.tone || "info",
      title: `${climate.region} · ${climate.name}`,
      detail: climate.desc,
      actions: isHarvest
        ? [
          { label: "与民同乐（声望+5·士气+4）", kind: "primary", op: "climate-relief" },
          { label: "征储实边（国库丰增）", kind: "quiet", op: "climate-hold" },
        ]
        : [
          { label: "开仓赈济（18钱·声望+6）", kind: "primary", op: "climate-relief" },
          { label: "暂缓赈抚（保国库）", kind: "quiet", op: "climate-hold" },
        ],
    });
  }

  // 0a3. Active anti-hegemon coalition alert
  if (isCoalitionActive(state) && memorials.length < 4) {
    const co = state.saga.coalition;
    const leaderName = factionName(era, co.leader);
    const memberNames = co.members.map((k) => factionName(era, k)).join("、");
    memorials.push({
      id: `coalition-${co.since}`,
      kind: "coalition",
      tag: "反霸合纵",
      tone: "warn",
      title: `${leaderName}纠合反霸联合军（尚余 ${Math.max(1, co.ends - state.turn)} 季）`,
      detail: `盟员：${memberNames}。联军互不攻伐且合力压境；可施「驱虎吞狼」瓦解退盟，或直捣${leaderName}主城击溃合纵！`,
      actions: [
        { label: "谋略离间", kind: "primary", op: "open-stratagem" },
      ],
    });
  }

  // 0b. Captive officers awaiting Sovereign judgement
  if (captives.length && memorials.length < 4) {
    const first = captives[0];
    const oName = first.officerObj?.name || "敌将";
    memorials.push({
      id: `captive-${first.officer}`,
      kind: "captive",
      tag: captives.length > 1 ? `俘将待决 (${captives.length})` : "生擒敌将",
      tone: "good",
      title: `擒获「${oName}」（${first.fromName} · ${first.cityName}之战）`,
      detail: `可降服招揽为己用、索赎钱粮，亦或义释涨海内声望、斩杀震慑敌胆。`,
      actions: [
        { label: "升帐发落", kind: "primary", op: "open-captive", target: first.officer },
      ],
    });
  }

  // 0c. Wild famous talent emergence
  if (wildPending.length && memorials.length < 4) {
    const talent = wildPending[0];
    const fee = effectiveWildFee(state, talent);
    const affordable = state.factions[state.player].treasury >= fee;
    memorials.push({
      id: `wild-${talent.id}`,
      kind: "wild-talent",
      tag: "在野大才",
      tone: affordable ? "good" : "info",
      title: `贤士「${talent.name}（${talent.title}）」现身民间`,
      detail: `政务 ${talent.governance} · 统率 ${talent.command}。备礼金 ${fee} 钱即可一键礼聘入幕${state.imperialChoice === "loyalist" ? "（汉室辅臣礼金已减半）" : ""}。`,
      actions: [
        { label: affordable ? `礼聘入仕（${fee}钱）` : `国库不足（需${fee}钱）`, kind: "primary", op: "recruit-wild", target: talent.id, disabled: !affordable },
      ],
    });
  }

  // 0. Historical Emperor proclamation choice when warlord/prince holds >= 18 cities (<= 219 AD)
  if (profile.canClaimEmperor && memorials.length < 4 && pendingEvent?.id !== "imperial_emperor_petition") {
    memorials.push({
      id: "claim-emperor",
      kind: "claim-emperor",
      tag: "劝进大典",
      tone: "good",
      title: "四海归心，文武表请正位称帝",
      detail: `今已坐拥半壁河山（${profile.badge}），众将劝请建朝称尊；亦可恪守汉臣之节，以「${lex.org}」之名兴复天下。`,
      actions: [
        { label: "受禅称帝 · 建朝立元", kind: "primary", op: "claim-emperor" },
        { label: "恪守臣节 · 兴复汉室", kind: "quiet", op: "stay-loyalist" },
      ],
    });
  }

  // 1. Incoming diplomatic treaty awaiting decision
  if (state.incomingTreaty?.answer === null && memorials.length < 4) {
    const offer = state.incomingTreaty;
    const sender = factionName(era, offer.from);
    const kindName = treatyTerms[offer.kind]?.name || "外交议约";
    memorials.push({
      id: "envoy",
      kind: "envoy",
      tag: "邦交急递",
      tone: "warn",
      title: `${sender}遣使请订「${kindName}」`,
      detail: `${offer.terms || `${kindName}互不侵犯`}。${lex.ruler}若拟集中兵力他向，可从其所请。`,
      actions: [
        { label: lex.approveTreaty, kind: "primary", op: "accept-treaty" },
        { label: lex.rejectTreaty, kind: "quiet", op: "reject-treaty" },
      ],
    });
  }

  // 2. Century-mode urgent case
  const urgentCase = state.century && openCases15(state).find((c) => c.turn === state.turn && c.urgent);
  if (urgentCase && memorials.length < 4) {
    memorials.push({
      id: `century-${urgentCase.id}`,
      kind: "century-urgent",
      tag: lex.urgentTag,
      tone: "warn",
      title: urgentCase.city ? `${cityName(world, urgentCase.city)}急报` : "军国要务",
      detail: urgentCase.text,
      actions: [{ label: profile.isImperial ? "御览裁决" : "军府裁决", kind: "primary", op: "open-century", item: urgentCase }],
    });
  }

  // 2.5 Opening preparation turn guidance
  if (isOpeningPrepTurn(state) && !state.nationalPolicy && memorials.length < 4) {
    memorials.push({
      id: "opening-prep",
      kind: "doctrine",
      tag: "开局整备",
      tone: "info",
      title: "首季止戈整备：先定方略、拜州牧、安四境",
      detail: "战端初启不宜轻动。可一键施行「整军备战」并遍任各州州牧；次季即可因地制宜择军策用兵。",
      actions: [
        { label: "施行方略并任州牧", kind: "primary", op: "apply-doctrine", target: "prepare" },
        { label: "外交合纵", kind: "quiet", op: "open-diplomacy" },
      ],
    });
  }

  // 3a. High-level Grand Maneuver (cut supply depot or waterborne crossing)
  const maneuver = memorials.length < 4 ? findGrandManeuverPlan(world, state, planned) : null;
  if (maneuver && memorials.length < 4) {
    memorials.push({
      id: `maneuver-${maneuver.order.from}-${maneuver.order.to}`,
      kind: "maneuver",
      tag: "军师奇谋",
      tone: "good",
      title: maneuver.title,
      detail: maneuver.detail,
      actions: [
        { label: "钦点施行", kind: "primary", op: "execute-maneuver", plan: maneuver },
        { label: "指图查看", kind: "quiet", op: "locate", target: maneuver.order.to },
      ],
    });
  }

  // 3b. Best front attack opportunity (if NOT prep turn & slots remain)
  if (!isOpeningPrepTurn(state) && state.orders.length < seasonOrderLimit && memorials.length < 4) {
    const enemyTargets = world.cities
      .map(({ key }) => key)
      .filter((key) => state.cities[key].owner !== state.player && isHostile(state, state.player, state.cities[key].owner));

    let topAttack = null;
    for (const target of enemyTargets) {
      const plan = bestAttackPlan(world, state, planned, target);
      if (plan.ok && plan.affordable && plan.outcome.wins) {
        const edge = plan.outcome.offense / Math.max(1, plan.outcome.defense);
        if (edge >= 1.04 && (!topAttack || edge > topAttack.edge)) topAttack = { plan, edge };
      }
    }

    if (topAttack) {
      const { plan } = topAttack;
      const fromName = cityName(world, plan.from);
      const toName = cityName(world, plan.to);
      const toOwner = factionName(era, state.cities[plan.to].owner);
      const tacticText = plan.outcome.tacticName ? `，拟用「${plan.outcome.tacticName}」` : "";
      memorials.push({
        id: `opp-${plan.to}`,
        kind: "opportunity",
        tag: "战机可乘",
        tone: "good",
        title: `兵发${toName}（${toOwner}）胜算大`,
        detail: `可由${fromName}遣「${plan.officer.name}」领 ${plan.troops.toLocaleString("zh-CN")} 兵${tacticText}，战力 ${plan.outcome.offense} 对 ${plan.outcome.defense}。`,
        actions: [
          { label: lex.attackVerb, kind: "primary", op: "execute-attack", plan },
          { label: "指图布策", kind: "quiet", op: "locate", target: plan.to },
        ],
      });
    }
  }

  // 4. Realm doctrine / vacant provincial governors / vacant posts reminder
  const { front, rear } = delegationZones(world, state);
  const vacantGovs = [...front, ...rear].filter((key) => !state.cities[key].governor).length;
  const hasIdle = era.officers.some((o) => o.faction === state.player && knownOfficer(state, o) && !isOfficerUnavailable(state, o.key) && availableForPosting(state, o.key));
  const provList = state.century ? listSovereignProvinces(world, state) : [];
  const vacantProvs = provList.filter((p) => !p.leadOfficer && p.candidates.length > 0).length;

  if (memorials.length < 4 && (!state.nationalPolicy || vacantProvs > 0 || (vacantGovs >= 2 && hasIdle))) {
    if (!state.nationalPolicy) {
      memorials.push({
        id: "doctrine-none",
        kind: "doctrine",
        tag: lex.doctrineTag,
        tone: "info",
        title: lex.doctrineEmptyTitle,
        detail: "颁行一方总纲即可自动同步年度国策、委任州牧并分派城池内政，免去逐城微操。",
        actions: [
          { label: "施行「整军备战」", kind: "primary", op: "apply-doctrine", target: "prepare" },
          { label: "选定方略", kind: "quiet", op: "open-doctrine" },
        ],
      });
    } else if (vacantProvs > 0) {
      memorials.push({
        id: "province-vacant",
        kind: "doctrine",
        tag: "州牧缺位",
        tone: "info",
        title: `尚有 ${vacantProvs} 州未置州牧统筹`,
        detail: "委任州牧后可代君主统管本州垦殖、守边与安民事务。",
        actions: [
          { label: "一键遍任州牧", kind: "primary", op: "appoint-all-provinces" },
          { label: "细选州牧", kind: "quiet", op: "open-doctrine" },
        ],
      });
    } else if (vacantGovs >= 2 && hasIdle) {
      memorials.push({
        id: "staff-vacant",
        kind: "doctrine",
        tag: "官员缺额",
        tone: "info",
        title: `治下尚有 ${vacantGovs} 座城池缺任太守`,
        detail: `${lex.org}尚有待任文武，按材授官可加速整顿并触发名将特技减耗。`,
        actions: [{ label: lex.autoStaffBtn, kind: "primary", op: "auto-staff" }],
      });
    }
  }

  // 4b. Ready tech research or promotable officer
  if (state.century && memorials.length < 4) {
    const readyTech = TECH_TREE.find((t) => canResearchTech(state, t.id).ok);
    const promos = promotableOfficers(era, state);
    if (promos.length) {
      const p = promos[0];
      memorials.push({
        id: `promote-${p.officer.key}-${p.skill}`,
        kind: "promotion",
        tag: "战功晋爵",
        tone: "good",
        title: `「${p.officer.name}」功勋已满，可提拔${p.skillLabel} +5`,
        detail: `现阶「${p.currentTitle}」，一键晋爵即永久提升${p.skillLabel}并进阶军号。`,
        actions: [
          { label: `晋爵${p.skillLabel}+5`, kind: "primary", op: "promote-officer", target: p.officer.key, skill: p.skill },
          { label: "兵技殿堂", kind: "quiet", op: "open-tech" },
        ],
      });
    } else if (readyTech) {
      memorials.push({
        id: `tech-${readyTech.id}`,
        kind: "tech",
        tag: "技巧可研",
        tone: "info",
        title: `可研习技巧「${readyTech.name}」（${readyTech.tp}点·${readyTech.cost}钱）`,
        detail: readyTech.desc,
        actions: [
          { label: "一键研习", kind: "primary", op: "research-tech", target: readyTech.id },
          { label: "查看三系技巧", kind: "quiet", op: "open-tech" },
        ],
      });
    }
  }

  // 5. Thinly defended frontline alert
  if (memorials.length < 4) {
    const weakFront = front
      .filter((key) => state.cities[key].troops < 900 && !(state.cities[key].mode === "delegated" && state.cities[key].focus === "recruit"))
      .sort((a, b) => state.cities[a].troops - state.cities[b].troops)[0];
    if (weakFront) {
      memorials.push({
        id: `front-${weakFront}`,
        kind: "front-alert",
        tag: "边防告急",
        tone: "warn",
        title: `${cityName(world, weakFront)}临敌仅余 ${state.cities[weakFront].troops} 兵`,
        detail: "接壤敌境而守备单薄，宜即刻令该城转入「前线战备」增募兵马。",
        actions: [
          { label: "转入前线战备", kind: "primary", op: "city-front", target: weakFront },
          { label: "定位", kind: "quiet", op: "locate", target: weakFront },
        ],
      });
    }
  }

  return { advisor, recap, strategicBrief, pendingEvent, captives, wildPending, memorials: memorials.slice(0, 4), profile };
}
