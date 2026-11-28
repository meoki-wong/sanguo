// 经略三国 3.0 — 核心大战略仿真引擎
// 特性：旬制双轨节奏 / 地图在途军团行军与阵前绞杀 / 跨回合围城 / 历史事件天子玉玺 / 名将战法与贤才寻访 / 后勤协同合围

import {
  AWAKENED_TITLES, CITY_POLICIES, CITY_SPECIALTIES, DEFENSE_TRAPS, DEKADS_PER_SEASON, DIFFICULTY_MODES,
  FACTION_PREFERRED_TROOP, FORMATIONS_V2, MIN_DISPATCH_TROOPS, MIN_GARRISON_LEAVE, NATIONAL_DECREES_V2,
  REGIONAL_DEFAULT_TROOP, SIEGE_DEFENSE_MODES, SIEGE_STANCES, TROOP_TYPES, WEATHER_CATALOG,
  activeTreaty, armyWorldPosition, availableOfficersInCity, canTransitCity, cityByKey, cityNameV2,
  citySpecialtyV2, clamp, computeMarchDekads, createArmyRecord, edgeDekadsRequired, edgeDistance,
  edgeKey, eraByYearV2, factionNameV2, findRoadPath, forecastDispatch, formatCalendar, hashStr,
  imperialRankForCities, initialEmperorCity, isHostileV2, returnOfficerHome, roadTerrain,
  troopCounterEffect,
} from "./constants.js";
import { officerMeta } from "../traits.js";
import {
  ensurePhase2State, evaluateBondBonus, hasDecree, planAiPhase2Dekad, resolveFortsOnMove,
} from "./systems.js";
import {
  spawnWanderingHeroes, tickOfficerTransfers, triggerArmyArt,
} from "./arts.js";
import {
  initialSealFaction, maybeTriggerEvent,
} from "./events.js";
import {
  recordBattleReport, recordHistorySnapshot,
} from "./chronicle.js";
import {
  aiPersonalityFor, processSupplyLinksMonthly, updateAntiHegemonCoalition,
} from "./theater.js";
import {
  CITY_BUILDINGS_V4, CITY_TIERS_V4, COURT_OFFICES_V4, PRESTIGE_RANKS_V4, TAX_LEVELS_V4,
  appointCourtOffice, buildingBuildDekads, buildingUpgradeCost, checkThreeKingdomsClimax,
  cityTierInfo, computeCourtBonuses, computeFactionPrestige, computeRegionalGovernorBonus,
  ensureV4State, estimateFactionEconomy, prestigeRankForFaction, setTaxLevel,
  tickCityConstructions, upgradeCityBuilding,
} from "./court.js";
import {
  OPENING_DEV_DEKADS, approveAllRecommended, buildCabinetBriefings,
  dismissCabinetProposal, executeCabinetProposal, refreshCabinetInbox, runAutoGovernanceMonthly,
  setAutoGovernance,
} from "./cabinet.js";
import {
  AUTO_PAUSE_MODES, CORPS_MISSIONS, GOVERNOR_DIRECTIVES, appointRegionalGovernor,
  assignCityToCorps, createCorps, disbandCorps, getCorpsForCity, getOfficersInCorps,
  getPlayerRegions, previewCityRecruit, previewSmartDispatch, recallOfficerFromCorps,
  recruitCityTroops, runPlayerCorpsDekad, runRegionalGovernorsMonthly, sendOfficerToCorps,
  setAutoPauseMode, smartAutoDispatch as smartAutoDispatchCore, updateCorps,
} from "./delegation.js";

export {
  MIN_DISPATCH_TROOPS, MIN_GARRISON_LEAVE, activeTreaty, armyWorldPosition,
  availableOfficersInCity, canTransitCity, cityByKey, cityNameV2, computeMarchDekads,
  createArmyRecord, edgeDekadsRequired, edgeDistance, eraByYearV2, factionNameV2,
  findRoadPath, forecastDispatch, initialEmperorCity, isHostileV2, returnOfficerHome,
} from "./constants.js";
export {
  buildFort, canBuildFort, castStratagem, cityBonds, demolishFort, enactDecree, ensurePhase2State,
  evaluateDeal, fortOnEdge, bribeDefection, hasDecree, proposeDeal, repairFort, sowDiscord,
  stratagemCooldownLeft,
} from "./systems.js";
export {
  BATTLE_ARTS_V3, WANDERING_HEROES_V3, officerBattleArt, recruitWanderingOfficer, transferOfficer,
  triggerArmyArt,
} from "./arts.js";
export {
  EMPEROR_EDICTS_V3, HISTORICAL_EVENTS_V3, issueImperialEdict, resolveEventChoice,
} from "./events.js";
export {
  AI_PERSONALITIES_V3, aiPersonalityFor, batchSetCityPolicy, clearSupplyLink,
  launchCoordinatedAttack, planCoordinatedAttack, setSupplyLink,
} from "./theater.js";
export {
  renderDiploMatrixHtml, renderPowerChartSvg, renderReplayMapSvg,
} from "./chronicle.js";
export {
  CITY_BUILDINGS_V4, CITY_TIERS_V4, COURT_OFFICES_V4, PRESTIGE_RANKS_V4, TAX_LEVELS_V4,
  appointCourtOffice, buildingBuildDekads, buildingUpgradeCost, cityTierInfo, computeCourtBonuses,
  computeFactionPrestige, computeRegionalGovernorBonus, estimateFactionEconomy,
  prestigeRankForFaction, setTaxLevel, upgradeCityBuilding,
} from "./court.js";
export {
  OPENING_DEV_DEKADS, buildCabinetBriefings, dismissCabinetProposal, refreshCabinetInbox,
  setAutoGovernance,
} from "./cabinet.js";
export {
  AUTO_PAUSE_MODES, CORPS_MISSIONS, GOVERNOR_DIRECTIVES, appointRegionalGovernor,
  assignCityToCorps, createCorps, disbandCorps, getCorpsForCity, getOfficersInCorps,
  getPlayerRegions, previewCityRecruit, previewSmartDispatch, recallOfficerFromCorps,
  recruitCityTroops, sendOfficerToCorps, setAutoPauseMode, updateCorps,
} from "./delegation.js";

export const V2_VERSION = 2;

export function checkSupplyLine(world, state, army) {
  const curPair = [army.from, army.to].sort().join(":");
  const interceptedBehind = (state.armies || []).some((other) => {
    if (other.id === army.id || other.troops <= 0 || !isHostileV2(state, army.faction, other.faction)) return false;
    if (other.stance === "besiege") return other.targetCity === army.from;
    const otherPair = [other.from, other.to].sort().join(":");
    return otherPair === curPair && (
      (other.from === army.from && other.progress < army.progress)
      || (other.from === army.to && 1 - other.progress < army.progress)
    );
  });
  if (interceptedBehind) return false;

  const curFort = state.forts?.[edgeKey(army.from, army.to)];
  if (curFort?.kind === "depot" && (curFort.faction === army.faction || activeTreaty(state, curFort.faction, army.faction)?.kind === "alliance")) {
    return true;
  }

  const depot = army.depot || army.route?.[0];
  if (!depot || !canTransitCity(state, army.faction, depot)) return false;
  if (!canTransitCity(state, army.faction, army.from)) return false;

  if (depot === army.from) return true;
  const path = findRoadPath(world, state, army.faction, depot, army.from, { allowEnemyEnd: false, maxHops: 10 });
  if (!path) return false;

  for (let i = 1; i < path.length - 1; i += 1) {
    if (state.sieges?.[path[i]]) return false;
  }
  return true;
}

function chooseSeasonalWeather(seasonKey, turn) {
  const pool = WEATHER_CATALOG[seasonKey] || WEATHER_CATALOG.spring;
  const idx = (Math.floor(turn / DEKADS_PER_SEASON) + (seasonKey === "summer" ? 1 : 0)) % pool.length;
  return pool[idx % pool.length];
}

function assignInitialCityStats(world, era, cityKey, owner) {
  const cityMeta = cityByKey(world, cityKey);
  const isCapital = owner && Object.values(era.ownership).filter((f) => f === owner).length >= 1
    && era.factions.some((f) => f.key === owner)
    && world.cities.find((c) => c.key === cityKey && era.ownership[c.key] === owner);
  const regional = REGIONAL_DEFAULT_TROOP[cityMeta?.region] || "infantry";
  const pref = FACTION_PREFERRED_TROOP[owner];
  const h = hashStr(`${era.year}:${cityKey}`);
  const ownedCount = Object.values(era.ownership).filter((f) => f === owner).length;
  const baseTroops = clamp(Math.round(1450 + (h % 950) + (ownedCount <= 2 ? 750 : 0)), 1350, 3200);
  const wallMax = clamp(420 + (cityMeta?.links?.length >= 5 ? 110 : 0) + (h % 140), 400, 680);
  const troopType = pref && (h % 3 !== 0) ? pref : regional;
  return {
    key: cityKey,
    region: cityMeta?.region || "中原与淮北",
    owner,
    troops: isCapital ? baseTroops + 150 : baseTroops,
    troopType,
    wall: wallMax,
    wallMax,
    foodReserve: 100,
    morale: 82,
    policy: "balanced",
    governor: null,
    commander: null,
    trap: null,
    siegeDefense: "hold",
    specialty: citySpecialtyV2(cityKey),
    level: clamp(1 + (h % 2), 1, 3),
    buildings: {
      farm: 1,
      market: 1,
      workshop: (h % 3 === 0) ? 1 : 0,
      academy: (h % 4 === 0) ? 1 : 0,
    },
    publicOrder: 78,
  };
}

export function createGameV2(world, year, playerFaction, { difficulty = "standard" } = {}) {
  const era = eraByYearV2(world, year);
  const player = era.factions.some((f) => f.key === playerFaction) ? playerFaction : era.factions[0].key;
  const diff = DIFFICULTY_MODES[difficulty] ? difficulty : "standard";

  const factions = {};
  for (const f of era.factions) {
    const baseT = f.stats?.[0] ?? 100;
    const baseG = f.stats?.[1] ?? 90;
    const isPlayer = f.key === player;
    const eco = isPlayer ? DIFFICULTY_MODES[diff].playerEconomy : 1;
    factions[f.key] = {
      key: f.key,
      name: f.name,
      trait: f.trait || "雄踞一方",
      treasury: Math.round(baseT * 1.45 * eco),
      grain: Math.round(baseG * 2.1 * eco),
      morale: f.stats?.[2] ?? 72,
    };
  }

  const cities = {};
  for (const c of world.cities) {
    const owner = era.ownership[c.key];
    cities[c.key] = assignInitialCityStats(world, era, c.key, owner);
  }

  const ownedByFaction = {};
  for (const c of world.cities) {
    const ow = cities[c.key].owner;
    if (!ownedByFaction[ow]) ownedByFaction[ow] = [];
    ownedByFaction[ow].push(c.key);
  }

  const officers = {};
  const officersByFaction = {};
  for (const raw of era.officers) {
    if (raw.reserve) continue;
    const meta = officerMeta(raw);
    const cityPool = ownedByFaction[raw.faction] || [];
    const list = (officersByFaction[raw.faction] ??= []);
    const assignedCity = cityPool.length ? cityPool[list.length % cityPool.length] : null;
    const loyaltyBase = raw.name === factions[raw.faction]?.name ? 100 : clamp(80 + (hashStr(raw.key) % 16), 78, 96);
    const obj = {
      key: raw.key,
      faction: raw.faction,
      name: raw.name,
      governance: raw.governance,
      command: raw.command,
      might: meta.might,
      intellect: meta.intellect,
      traits: meta.traits.map((t) => t.id),
      title: meta.title || "",
      seal: meta.seal,
      city: assignedCity,
      armyId: null,
      transferringTo: null,
      loyalty: loyaltyBase,
      merit: 0,
      wins: 0,
      defenses: 0,
      captures: 0,
      awakenedTitle: null,
      injuredDekads: 0,
      capturedBy: null,
    };
    officers[raw.key] = obj;
    list.push(obj);
  }

  for (const [factionKey, cityKeys] of Object.entries(ownedByFaction)) {
    const pool = (officersByFaction[factionKey] || []).slice();
    const borderCities = cityKeys.filter((ck) => cityByKey(world, ck).links.some((nb) => cities[nb].owner !== factionKey));
    const orderedCities = [...borderCities, ...cityKeys.filter((ck) => !borderCities.includes(ck))];
    const byCmd = pool.slice().sort((a, b) => b.command - a.command);
    const byGov = pool.slice().sort((a, b) => b.governance - a.governance);
    const used = new Set();

    for (const ck of orderedCities) {
      const cmd = byCmd.find((o) => !used.has(o.key));
      if (cmd) {
        cities[ck].commander = cmd.key;
        cmd.city = ck;
        used.add(cmd.key);
      }
    }
    for (const ck of orderedCities) {
      const gov = byGov.find((o) => !used.has(o.key));
      if (gov) {
        cities[ck].governor = gov.key;
        gov.city = ck;
        used.add(gov.key);
      }
    }
  }

  const cal = formatCalendar(year, 0);
  const weather = chooseSeasonalWeather(cal.seasonKey, 0);
  const emperorCity = initialEmperorCity(year);

  const state = {
    version: V2_VERSION,
    year,
    turn: 0,
    player,
    difficulty: diff,
    weather,
    nextArmySeq: 1,
    factions,
    cities,
    officers,
    armies: [],
    sieges: {},
    forts: {},
    stratagemCooldowns: {},
    decrees: {},
    emperorCity,
    sealFaction: null,
    pendingEvent: null,
    triggeredEvents: [],
    eventCooldowns: {},
    nextEventAllowedTurn: 0,
    cabinetInbox: [],
    wanderingOfficers: [],
    triggeredWanderingIds: [],
    officerTransfers: [],
    supplyLinks: {},
    battleReports: [],
    historySnapshots: [],
    coalitionAlertLevel: 0,
    edictCooldown: 0,
    treaties: [],
    captives: [],
    events: [{ turn: 0, kind: "system", text: `建元伊始：${era.title}剧本开启，我方执掌「${factions[player].name}」。每回合以「一旬」推进战局，大军沿官道实景行军与跨旬围城。` }],
    lastTurnEvents: [],
    outcome: "ongoing",
  };
  state.sealFaction = initialSealFaction(state, year);
  ensureV4State(state);
  spawnWanderingHeroes(world, state, []);
  refreshCabinetInbox(world, state);
  recordHistorySnapshot(world, state);
  return state;
}

export function smartAutoDispatch(world, state, opts) {
  return smartAutoDispatchCore(world, state, opts, dispatchArmy);
}

export function dispatchArmy(world, state, { from, to, officer, deputy = null, formation = "heyi", troops, troopType, stance, siegeStance = "storm" }) {
  const next = ensurePhase2State(structuredClone(state));
  if (next.outcome !== "ongoing") throw new Error("战局已终结。");
  const fromCity = next.cities[from];
  const toCity = next.cities[to];
  if (!fromCity || !toCity) throw new Error("请选择有效城池。");
  const faction = fromCity.owner;
  if (faction !== next.player) throw new Error("仅可调度己方城池兵马。");

  const offObj = next.officers[officer];
  if (!offObj || offObj.faction !== faction || offObj.city !== from || offObj.armyId || offObj.injuredDekads > 0 || offObj.capturedBy) {
    throw new Error("所选将领当前无法自该城出征。");
  }
  let depObj = null;
  if (deputy) {
    if (deputy === officer) throw new Error("副将不可与主将同为一人。");
    depObj = next.officers[deputy];
    if (!depObj || depObj.faction !== faction || depObj.city !== from || depObj.armyId || depObj.injuredDekads > 0 || depObj.capturedBy) {
      throw new Error("所选副将当前无法自该城随军出征。");
    }
  }
  const amount = Math.floor(Number(troops));
  if (!Number.isFinite(amount) || amount < MIN_DISPATCH_TROOPS) {
    throw new Error(`出征兵力至少需 ${MIN_DISPATCH_TROOPS} 人。`);
  }
  if (fromCity.troops - amount < MIN_GARRISON_LEAVE) {
    throw new Error(`出发城须至少留守 ${MIN_GARRISON_LEAVE} 名守军。`);
  }
  const resolvedType = TROOP_TYPES[troopType] ? troopType : fromCity.troopType;
  const resolvedForm = FORMATIONS_V2[formation] ? formation : "heyi";
  const fc = forecastDispatch(world, next, { from, to, troops: amount, troopType: resolvedType, officer: offObj, formation: resolvedForm });
  if (!fc.ok) throw new Error(fc.reason);
  if (next.factions[faction].grain < fc.grainCost) {
    throw new Error(`军粮不足，出征需准备 ${fc.grainCost} 石随军粮草。`);
  }

  const finalStance = stance || (fc.isFriendlyDest ? "reinforce" : "attack");
  fromCity.troops -= amount;
  if (fromCity.commander === offObj.key || fromCity.commander === depObj?.key) {
    if (fromCity.commander === offObj.key) fromCity.commander = null;
    if (depObj && fromCity.commander === depObj.key) fromCity.commander = null;
  }
  if (fromCity.governor === offObj.key) fromCity.governor = null;
  if (depObj && fromCity.governor === depObj.key) fromCity.governor = null;
  offObj.city = null;
  if (depObj) depObj.city = null;
  next.factions[faction].grain -= fc.grainCost;

  const citySpecId = fromCity.specialty || citySpecialtyV2(from);
  const specTag = (citySpecId === "horse" && resolvedType === "cavalry")
    || (citySpecId === "shipyard" && resolvedType === "navy")
    || (citySpecId === "arsenal" && resolvedType === "siege")
    ? citySpecId : null;

  const army = createArmyRecord(world, next, {
    faction,
    from,
    route: fc.route,
    officerKey: offObj.key,
    deputyKey: depObj?.key || null,
    troops: amount,
    troopType: resolvedType,
    stance: finalStance,
    siegeStance: SIEGE_STANCES[siegeStance] ? siegeStance : "storm",
    formation: resolvedForm,
  });
  army.specialtyTag = specTag;
  offObj.armyId = army.id;
  if (depObj) depObj.armyId = army.id;
  next.armies.push(army);

  const verb = finalStance === "reinforce" ? "星夜驰援" : "挥师出征";
  const depTxt = depObj ? `（副将${depObj.name} · ${FORMATIONS_V2[resolvedForm].name}）` : `（${FORMATIONS_V2[resolvedForm].name}）`;
  const text = `${offObj.name}${depTxt}率 ${amount.toLocaleString()} ${TROOP_TYPES[resolvedType].name}自${cityNameV2(world, from)}${verb}${cityNameV2(world, to)}（预计 ${fc.dekads} 旬抵达）。`;
  const ev = { turn: next.turn, kind: "dispatch", faction, city: to, pos: cityByKey(world, from).position, text };
  next.events = [...next.events, ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function rankProgressForFaction(state, faction = state.player) {
  const cityCount = Object.values(state.cities || {}).filter((c) => c.owner === faction).length;
  const pRank = prestigeRankForFaction(state, faction);
  return {
    cityCount,
    ...imperialRankForCities(cityCount),
    prestige: pRank.prestige,
    prestigeRank: pRank.current,
    nextPrestigeRank: pRank.nextRank,
    rankIndex: pRank.rankIndex,
  };
}

export function approveCabinetProposal(world, state, proposalId) {
  return executeCabinetProposal(world, state, proposalId, {
    dispatchEmergencyReinforce,
    resolveCaptive,
  });
}

export function approveAllCabinet(world, state) {
  return approveAllRecommended(world, state, {
    dispatchEmergencyReinforce,
    resolveCaptive,
  });
}

export function redirectArmy(world, state, armyId, { targetCity, stance, siegeStance }) {
  const next = ensurePhase2State(structuredClone(state));
  const army = next.armies.find((a) => a.id === armyId);
  if (!army) throw new Error("未找到对应在途军团。");
  if (army.faction !== next.player) throw new Error("不可干预敌国军团军令。");

  if (siegeStance && SIEGE_STANCES[siegeStance]) {
    army.siegeStance = siegeStance;
  }

  if (stance === "retreat") {
    army.engagedWith = null;
    army.engageRounds = 0;
    const ownedCities = Object.values(next.cities).filter((c) => c.owner === army.faction);
    if (!ownedCities.length) throw new Error("我方已无撤军去处。");
    // Nearest friendly city from army.from or army.to
    let bestPath = null;
    for (const c of ownedCities) {
      if (c.key === army.from) {
        bestPath = [army.to, army.from];
        break;
      }
      const p = findRoadPath(world, next, army.faction, army.from, c.key, { allowEnemyEnd: false });
      if (p && (!bestPath || p.length < bestPath.length)) bestPath = p;
    }
    if (!bestPath) {
      // Fallback to direct hop toward army.depot or army.from
      army.stance = "retreat";
      const prevFrom = army.from;
      army.from = army.to;
      army.to = prevFrom;
      army.targetCity = prevFrom;
      army.route = [army.from, prevFrom];
      army.step = 0;
      army.progress = Math.max(0.05, 1 - army.progress);
    } else {
      // Remove from active siege if it was besieging
      if (army.stance === "besiege") {
        const s = next.sieges[army.targetCity];
        if (s) s.attackerArmyIds = s.attackerArmyIds.filter((id) => id !== army.id);
        army.from = army.targetCity;
        army.to = bestPath[0] === army.targetCity ? bestPath[1] : bestPath[0];
        army.progress = 0.08;
      } else {
        const curFrom = army.from;
        army.from = army.to;
        army.to = curFrom;
        army.progress = Math.max(0.06, 1 - army.progress);
      }
      army.stance = "retreat";
      army.route = bestPath[0] === army.from ? bestPath : [army.from, ...bestPath.filter((x) => x !== army.from)];
      army.step = 0;
      army.targetCity = army.route[army.route.length - 1];
      if (army.route.length >= 2) army.to = army.route[1];
    }
    army.edgeDekads = edgeDekadsRequired(world, army.from, army.to, army.troopType, next.weather, next.officers[army.officer], army.formation || "heyi");
    const offName = next.officers[army.officer]?.name || "大军";
    const ev = { turn: next.turn, kind: "order", faction: army.faction, text: `${offName}部受命班师回撤 ${cityNameV2(world, army.targetCity)}。` };
    next.events = [...next.events, ev].slice(-80);
    return next;
  }

  if (targetCity && targetCity !== army.targetCity) {
    const startNode = army.progress >= 0.5 ? army.to : army.from;
    const baseNode = canTransitCity(next, army.faction, startNode) ? startNode : army.from;
    const newRoute = findRoadPath(world, next, army.faction, baseNode, targetCity, { allowEnemyEnd: true });
    if (!newRoute) throw new Error("所选改道目标当前无道路可通。");
    const toCity = next.cities[targetCity];
    const isFriendly = canTransitCity(next, army.faction, targetCity);
    if (!isFriendly && activeTreaty(next, army.faction, toCity.owner)) {
      throw new Error("停战或盟约期内不可改道进攻该城。");
    }
    if (army.stance === "besiege" && next.sieges[army.targetCity]) {
      next.sieges[army.targetCity].attackerArmyIds = next.sieges[army.targetCity].attackerArmyIds.filter((id) => id !== army.id);
    }
    army.engagedWith = null;
    army.engageRounds = 0;
    army.route = newRoute;
    army.step = 0;
    army.from = newRoute[0];
    army.to = newRoute[1];
    army.targetCity = targetCity;
    army.stance = isFriendly ? "reinforce" : "attack";
    army.progress = 0.1;
    army.edgeDekads = edgeDekadsRequired(world, army.from, army.to, army.troopType, next.weather, next.officers[army.officer], army.formation || "heyi");
    const offName = next.officers[army.officer]?.name || "大军";
    const ev = { turn: next.turn, kind: "order", faction: army.faction, text: `${offName}部奉命就地改道，直趋${cityNameV2(world, targetCity)}！` };
    next.events = [...next.events, ev].slice(-80);
  }
  return next;
}

export function setCityPolicy(state, cityKey, policyId) {
  if (!CITY_POLICIES[policyId]) throw new Error("未知治城方针。");
  const next = structuredClone(state);
  const city = next.cities[cityKey];
  if (!city || city.owner !== next.player) throw new Error("仅可调整己方城池方针。");
  city.policy = policyId;
  return next;
}

export function setCityTroopType(state, cityKey, troopType) {
  const spec = TROOP_TYPES[troopType];
  if (!spec) throw new Error("未知兵种。");
  const next = ensurePhase2State(structuredClone(state));
  const city = next.cities[cityKey];
  if (!city || city.owner !== next.player) throw new Error("仅可整编己方城池驻军。");
  if (city.troopType === troopType) return next;
  const citySpec = CITY_SPECIALTIES[city.specialty];
  const cost = citySpec?.troopBoost === troopType ? Math.max(4, Math.round(spec.reequipCost * (citySpec.costMult ?? 1))) : spec.reequipCost;
  if (next.factions[next.player].treasury < cost) {
    throw new Error(`换装「${spec.name}」需国库 ${cost} 钱。`);
  }
  next.factions[next.player].treasury -= cost;
  city.troopType = troopType;
  return next;
}

export function layCityTrap(state, cityKey, trapId) {
  const trap = DEFENSE_TRAPS[trapId];
  if (!trap) throw new Error("未知城外伏兵/工事。");
  const next = structuredClone(state);
  const city = next.cities[cityKey];
  if (!city || city.owner !== next.player) throw new Error("仅可在己方城池外设伏。");
  if (next.sieges[cityKey]) throw new Error("城池已被围困，难以出城铺设工事。");
  if (next.factions[next.player].treasury < trap.cost) {
    throw new Error(`布设「${trap.name}」需 ${trap.cost} 钱。`);
  }
  next.factions[next.player].treasury -= trap.cost;
  city.trap = { id: trap.id, expiresTurn: next.turn + 12 };
  return next;
}

export function setCitySiegeDefense(state, cityKey, modeId) {
  if (!SIEGE_DEFENSE_MODES[modeId]) throw new Error("未知守城战法。");
  const next = structuredClone(state);
  const city = next.cities[cityKey];
  if (!city || city.owner !== next.player) throw new Error("仅可下令己方守军。");
  city.siegeDefense = modeId;
  return next;
}

export function appointOfficer(state, cityKey, role, officerKey) {
  if (!["governor", "commander"].includes(role)) throw new Error("未知官职。");
  const next = structuredClone(state);
  const city = next.cities[cityKey];
  if (!city || city.owner !== next.player) throw new Error("仅可任免己方城池官员。");
  if (!officerKey) {
    city[role] = null;
    return next;
  }
  const off = next.officers[officerKey];
  if (!off || off.faction !== next.player || off.armyId || off.capturedBy || off.transferringTo) {
    throw new Error("所选将领当前不在空闲可任状态。");
  }
  // Remove officer from old post
  for (const c of Object.values(next.cities)) {
    if (c.governor === officerKey) c.governor = null;
    if (c.commander === officerKey) c.commander = null;
  }
  off.city = cityKey;
  city[role] = officerKey;
  return next;
}

export function rewardOfficer(state, officerKey) {
  const next = structuredClone(state);
  const off = next.officers[officerKey];
  if (!off || off.faction !== next.player) throw new Error("仅可赏赐己方将领。");
  if (next.factions[next.player].treasury < 10) throw new Error("赏赐重臣需 10 钱。");
  next.factions[next.player].treasury -= 10;
  off.loyalty = clamp(off.loyalty + 14, 0, 100);
  if (off.armyId) {
    const army = next.armies.find((a) => a.id === off.armyId);
    if (army) army.morale = clamp(army.morale + 8, 20, 100);
  }
  return next;
}

export function dispatchEmergencyReinforce(world, state, targetCityKey) {
  const target = state.cities[targetCityKey];
  if (!target || target.owner !== state.player) throw new Error("仅可对己方城池调拨紧急援军。");

  const candidates = [];
  for (const c of Object.values(state.cities)) {
    if (c.key === targetCityKey || c.owner !== state.player || state.sieges[c.key]) continue;
    if (c.troops < 1300) continue;
    const availOff = availableOfficersInCity(state, c.key, state.player)[0];
    if (!availOff) continue;
    const route = findRoadPath(world, state, state.player, c.key, targetCityKey, { allowEnemyEnd: false, maxHops: 4 });
    if (!route) continue;
    candidates.push({ city: c, officer: availOff, route, surplus: c.troops - 500 });
  }
  candidates.sort((a, b) => a.route.length - b.route.length || b.surplus - a.surplus);
  const pick = candidates[0];
  if (!pick) throw new Error("邻近 4 城内暂无富余兵马及空闲将领可派援。");

  const sendTroops = clamp(Math.round(pick.surplus * 0.65), 400, 1800);
  return dispatchArmy(world, state, {
    from: pick.city.key,
    to: targetCityKey,
    officer: pick.officer.key,
    troops: sendTroops,
    troopType: pick.city.troopType,
    stance: "reinforce",
  });
}

export function executeDiplomacy(world, state, targetFaction, kind, extra = {}) {
  const next = structuredClone(state);
  const f = next.factions[next.player];
  const rival = next.factions[targetFaction];
  if (!rival || targetFaction === next.player) throw new Error("目标势力无效。");

  if (kind === "truce") {
    if (activeTreaty(next, next.player, targetFaction)) throw new Error("双方已有有效盟约或停战条约。");
    if (f.treasury < 15) throw new Error("遣使停战需礼金 15 钱。");
    f.treasury -= 15;
    next.treaties.push({ kind: "truce", sides: [next.player, targetFaction].sort(), expires: next.turn + 18 });
    const ev = { turn: next.turn, kind: "diplomacy", text: `与「${rival.name}」缔结两年期（18 旬）停战和约，暂稳边防。` };
    next.events = [...next.events, ev].slice(-80);
    return next;
  }

  if (kind === "alliance") {
    if (activeTreaty(next, next.player, targetFaction)?.kind === "alliance") throw new Error("双方已结同盟。");
    if (f.treasury < 28) throw new Error("缔结同盟需奉玉帛 28 钱。");
    f.treasury -= 28;
    next.treaties = next.treaties.filter((t) => !(t.sides.includes(next.player) && t.sides.includes(targetFaction)));
    next.treaties.push({ kind: "alliance", sides: [next.player, targetFaction].sort(), expires: next.turn + 36 });
    const ev = { turn: next.turn, kind: "diplomacy", text: `与「${rival.name}」会盟誓师（借道通行，36 旬有效）！` };
    next.events = [...next.events, ev].slice(-80);
    return next;
  }

  if (kind === "joint_attack") {
    const tr = activeTreaty(next, next.player, targetFaction);
    if (!tr || tr.kind !== "alliance") throw new Error("需先缔结「同盟」方可请求合击。");
    if (f.treasury < 20) throw new Error("催动盟友合兵进剿需馈军资 20 钱。");
    const targetCityKey = extra.targetCityKey;
    const tCity = next.cities[targetCityKey];
    if (!tCity || !isHostileV2(next, targetFaction, tCity.owner)) {
      throw new Error("请选择与盟友敌对的前线目标城池。");
    }
    // Find ally border city capable of attacking targetCityKey
    const allyCandidates = Object.values(next.cities)
      .filter((c) => c.owner === targetFaction && !next.sieges[c.key] && c.troops >= 1000 && cityByKey(world, c.key).links.includes(targetCityKey));
    const allyCity = allyCandidates.sort((a, b) => b.troops - a.troops)[0];
    if (!allyCity) throw new Error("盟友接壤该城兵力不足，尚难发兵响应。");
    const allyOff = availableOfficersInCity(next, allyCity.key, targetFaction)[0];
    if (!allyOff) throw new Error("盟友该城眼下无空闲将领可领军。");
    f.treasury -= 20;
    const troops = clamp(Math.round(allyCity.troops * 0.55), 400, 1800);
    allyCity.troops -= troops;
    if (allyCity.commander === allyOff.key) allyCity.commander = null;
    if (allyCity.governor === allyOff.key) allyCity.governor = null;
    allyOff.city = null;
    const allyArmy = createArmyRecord(world, next, {
      faction: targetFaction,
      from: allyCity.key,
      route: [allyCity.key, targetCityKey],
      officerKey: allyOff.key,
      troops,
      troopType: allyCity.troopType,
      stance: "attack",
      siegeStance: "storm",
    });
    allyOff.armyId = allyArmy.id;
    next.armies.push(allyArmy);
    const ev = { turn: next.turn, kind: "diplomacy", text: `盟友${rival.name}响应合击！${allyOff.name}正率 ${troops.toLocaleString()} 人自${cityNameV2(world, allyCity.key)}杀向${cityNameV2(world, targetCityKey)}！` };
    next.events = [...next.events, ev].slice(-80);
    next.lastTurnEvents = [ev];
    return next;
  }

  if (kind === "break") {
    next.treaties = next.treaties.filter((t) => !(t.sides.includes(next.player) && t.sides.includes(targetFaction)));
    f.morale = clamp(f.morale - 8, 25, 100);
    const ev = { turn: next.turn, kind: "diplomacy", text: `废止与「${rival.name}」的盟约（全国民心 -8）。` };
    next.events = [...next.events, ev].slice(-80);
    return next;
  }

  if (kind === "persuade_surrender") {
    const myCities = Object.values(next.cities).filter((c) => c.owner === next.player);
    const theirCities = Object.values(next.cities).filter((c) => c.owner === targetFaction);
    const myTroops = myCities.reduce((s, c) => s + c.troops, 0);
    const theirTroops = theirCities.reduce((s, c) => s + c.troops, 0);
    if (theirCities.length > 2 || myCities.length < theirCities.length * 3 || myTroops < Math.max(2000, theirTroops * 2.5)) {
      throw new Error("敌方尚存实力，须压倒至其仅余 1~2 城且我方城池与兵力占绝对优势（3倍/2.5倍）方可传檄劝降。");
    }
    for (const c of theirCities) {
      c.owner = next.player;
      c.governor = null;
      c.commander = null;
      delete next.sieges[c.key];
    }
    for (const o of Object.values(next.officers)) {
      if (o.faction === targetFaction && !o.armyId) {
        o.faction = next.player;
        o.loyalty = 76;
      }
    }
    next.armies = next.armies.filter((a) => a.faction !== targetFaction);
    const ev = { turn: next.turn, kind: "capture", text: `大势归心！「${rival.name}」举族归降，所余 ${theirCities.map((c) => cityNameV2(world, c.key)).join("、")} 尽入我朝版图！` };
    next.events = [...next.events, ev].slice(-80);
    next.lastTurnEvents = [ev];
    checkOutcome(next);
    return next;
  }

  throw new Error("未知外交指令。");
}

export function resolveCaptive(state, officerKey, action) {
  const next = structuredClone(state);
  const capIdx = next.captives.findIndex((c) => c.officer === officerKey);
  if (capIdx < 0) throw new Error("牢中暂无此降将记录。");
  const cap = next.captives[capIdx];
  const off = next.officers[officerKey];
  if (!off) throw new Error("武将不存在。");

  if (action === "recruit") {
    const cost = off.loyalty > 85 ? 24 : 14;
    if (next.factions[next.player].treasury < cost) throw new Error(`劝降重礼需国库 ${cost} 钱。`);
    const playerCities = Object.values(next.cities).filter((c) => c.owner === next.player);
    if (!playerCities.length) throw new Error("我方暂无安身城池。");
    next.factions[next.player].treasury -= cost;
    off.faction = next.player;
    off.capturedBy = null;
    off.loyalty = 78;
    off.city = playerCities[0].key;
    next.captives.splice(capIdx, 1);
    const ev = { turn: next.turn, kind: "officer", text: `俘将「${off.name}」感怀恩遇，正式归顺我朝！` };
    next.events = [...next.events, ev].slice(-80);
    return next;
  }

  if (action === "ransom") {
    const gold = Math.round(14 + (off.command + off.governance) * 0.14);
    next.factions[next.player].treasury += gold;
    const origCities = Object.values(next.cities).filter((c) => c.owner === cap.origFaction);
    if (origCities.length) {
      off.faction = cap.origFaction;
      off.city = origCities[0].key;
      off.capturedBy = null;
    } else {
      delete next.officers[officerKey];
    }
    next.captives.splice(capIdx, 1);
    const ev = { turn: next.turn, kind: "diplomacy", text: `放还俘将「${off.name}」，换回赎金 ${gold} 钱。` };
    next.events = [...next.events, ev].slice(-80);
    return next;
  }

  if (action === "release") {
    const origCities = Object.values(next.cities).filter((c) => c.owner === cap.origFaction);
    next.factions[next.player].morale = clamp(next.factions[next.player].morale + 4, 0, 100);
    if (origCities.length) {
      off.city = origCities[0].key;
      off.capturedBy = null;
    } else {
      off.faction = next.player;
      off.capturedBy = null;
      off.loyalty = 84;
      const pc = Object.values(next.cities).find((c) => c.owner === next.player);
      off.city = pc?.key || null;
    }
    next.captives.splice(capIdx, 1);
    const ev = { turn: next.turn, kind: "diplomacy", text: `义释「${off.name}」，天下士林归心，民心 +4。` };
    next.events = [...next.events, ev].slice(-80);
    return next;
  }
  throw new Error("未知处置。");
}

function awardMerit(state, officerKey, { merit = 0, win = false, defense = false, capture = false }, events) {
  const off = state.officers[officerKey];
  if (!off) return;
  off.merit += merit;
  if (win) {
    off.wins += 1;
    off.loyalty = clamp(off.loyalty + 2, 0, 100);
  }
  if (defense) {
    off.defenses += 1;
    off.loyalty = clamp(off.loyalty + 3, 0, 100);
  }
  if (capture) off.captures += 1;

  for (const t of AWAKENED_TITLES) {
    if (off.awakenedTitle === t.id) continue;
    const qualified = (t.minWins && off.wins >= t.minWins)
      || (t.minDefenses && off.defenses >= t.minDefenses)
      || (t.minCaptures && off.captures >= t.minCaptures)
      || (t.minMerit && off.merit >= t.minMerit);
    if (qualified) {
      off.awakenedTitle = t.id;
      if (off.faction === state.player) {
        events.push({ turn: state.turn, kind: "officer", text: `战功觉醒！「${off.name}」获封「${t.name}」— ${t.desc}。` });
      }
      break;
    }
  }
}

function officerPowerMult(state, off, isSiege = false, isDef = false, terrain = "plain") {
  if (!off) return 1;
  let m = 1 + (off.command - 65) * 0.0045 + (off.might - 65) * 0.0022;
  if (off.traits.includes("charisma")) m *= 1.07;
  if (off.traits.includes("fire") && (state.weather?.fireMult ?? 1) >= 1) m *= 1.1;
  if (off.traits.includes("cavalry") && terrain === "plain") m *= 1.08;
  if (off.traits.includes("navy") && terrain === "river") m *= 1.16;
  if (isDef && off.traits.includes("fortress")) m *= 1.14;
  if (off.awakenedTitle === "vanguard" && !isDef) m *= 1.1;
  if (off.awakenedTitle === "bulwark" && isDef) m *= 1.12;
  if (off.awakenedTitle === "grand_marshal") m *= 1.14;
  if (isSiege && off.awakenedTitle === "conqueror") m *= 1.12;
  return clamp(m, 0.72, 1.65);
}

function releaseArmyOfficers(state, army, preferredCityKey = null) {
  if (!army) return;
  if (army.officer) returnOfficerHome(state, army.officer, preferredCityKey);
  if (army.deputy) returnOfficerHome(state, army.deputy, preferredCityKey);
}

function attemptCaptureOrReturn(state, offKey, victorFaction, cityKey, bonusProb = 0, events = []) {
  if (!offKey) return;
  const off = state.officers[offKey];
  if (!off) return;
  const fallCities = Object.values(state.cities).filter((c) => c.owner === off.faction);
  const prob = clamp(0.14 + bonusProb + (fallCities.length === 0 ? 0.35 : 0), 0.1, 0.75);
  const roll = ((hashStr(`${state.turn}:${offKey}:${victorFaction}`) % 100) / 100);
  if (victorFaction === state.player && roll < prob && off.name !== state.factions[off.faction]?.name) {
    off.armyId = null;
    off.city = null;
    off.transferringTo = null;
    off.capturedBy = victorFaction;
    state.captives.push({ officer: offKey, origFaction: off.faction, turn: state.turn, city: cityKey });
    events.push({ turn: state.turn, kind: "officer", city: cityKey, text: `阵前生擒敌将「${off.name}」！可在「朝堂」处置劝降。` });
    return;
  }
  returnOfficerHome(state, offKey, fallCities[0]?.key || null);
}

function resolveFieldBattle(world, state, a, b, events, { allowEngage = true } = {}) {
  const terrain = roadTerrain(a.from, a.to);
  const offA = a.officer ? state.officers[a.officer] : null;
  const offB = b.officer ? state.officers[b.officer] : null;
  const nameA = offA?.name || a.escortName || "我军";
  const nameB = offB?.name || b.escortName || "敌军";
  const depA = a.deputy ? state.officers[a.deputy] : null;
  const depB = b.deputy ? state.officers[b.deputy] : null;
  const formA = FORMATIONS_V2[a.formation || "heyi"] || FORMATIONS_V2.heyi;
  const formB = FORMATIONS_V2[b.formation || "heyi"] || FORMATIONS_V2.heyi;
  const cAB = troopCounterEffect(a.troopType, b.troopType, terrain, state.weather);
  const cBA = troopCounterEffect(b.troopType, a.troopType, terrain, state.weather);

  if (a.officer) a.rage = clamp((a.rage || 0) + 36, 0, 100);
  if (b.officer) b.rage = clamp((b.rage || 0) + 36, 0, 100);

  const artTriggered = [];
  if (a.officer && a.rage >= 100 && a.troops >= 240 && b.troops >= 180) {
    const firedA = triggerArmyArt(world, state, a.id, events, { manual: false });
    if (firedA) artTriggered.push(`${firedA.offName} · ${firedA.artName}`);
  }
  if (b.officer && b.rage >= 100 && b.troops >= 240 && a.troops >= 180) {
    const firedB = triggerArmyArt(world, state, b.id, events, { manual: false });
    if (firedB) artTriggered.push(`${firedB.offName} · ${firedB.artName}`);
  }

  const alliesA = [
    ...state.armies.filter((x) => x.faction === a.faction && x.id !== a.id && x.troops > 0).flatMap((x) => [x.officer, x.deputy]),
    a.deputy,
  ].filter(Boolean);
  const alliesB = [
    ...state.armies.filter((x) => x.faction === b.faction && x.id !== b.id && x.troops > 0).flatMap((x) => [x.officer, x.deputy]),
    b.deputy,
  ].filter(Boolean);
  const bondA = a.officer ? evaluateBondBonus(state, a.officer, alliesA, [b.officer, b.deputy].filter(Boolean)) : { atkMult: 1, defMult: 1, lossMult: 1, labels: [] };
  const bondB = b.officer ? evaluateBondBonus(state, b.officer, alliesB, [a.officer, a.deputy].filter(Boolean)) : { atkMult: 1, defMult: 1, lossMult: 1, labels: [] };
  const depMultA = depA ? clamp(1 + ((depA.might - 60) + (depA.command - 60)) * 0.0018, 0.96, 1.14) : 1;
  const depMultB = depB ? clamp(1 + ((depB.might - 60) + (depB.command - 60)) * 0.0018, 0.96, 1.14) : 1;
  const decMultA = (hasDecree(state, a.faction, "repeating_crossbow") && a.troopType === "archer" ? 1.18 : 1)
    * (hasDecree(state, a.faction, "grand_fleet") && a.troopType === "navy" ? 1.2 : 1);
  const decMultB = (hasDecree(state, b.faction, "repeating_crossbow") && b.troopType === "archer" ? 1.18 : 1)
    * (hasDecree(state, b.faction, "grand_fleet") && b.troopType === "navy" ? 1.2 : 1);

  const edgeCur = [a.from, a.to].sort().join(":");
  const hasFlankA = state.armies.some((x) => x.faction === a.faction && x.id !== a.id && x.troops > 0 && [x.from, x.to].sort().join(":") === edgeCur);
  const hasFlankB = state.armies.some((x) => x.faction === b.faction && x.id !== b.id && x.troops > 0 && [x.from, x.to].sort().join(":") === edgeCur);
  const flankMultA = hasFlankA ? 1.18 : 1;
  const flankMultB = hasFlankB ? 1.18 : 1;

  const fort = state.forts?.[edgeKey(a.from, a.to)];
  const wfMultA = fort?.kind === "water_fort" && fort.faction === a.faction && a.troopType === "navy" ? 1.18 : 1;
  const wfMultB = fort?.kind === "water_fort" && fort.faction === b.faction && b.troopType === "navy" ? 1.18 : 1;
  const specMultA = (a.specialtyTag === "horse" && a.troopType === "cavalry") || (a.specialtyTag === "shipyard" && a.troopType === "navy") ? 1.12 : 1;
  const specMultB = (b.specialtyTag === "horse" && b.troopType === "cavalry") || (b.specialtyTag === "shipyard" && b.troopType === "navy") ? 1.12 : 1;
  const courtMultA = computeCourtBonuses(state, a.faction).combatMult
    * (1 + Math.min(0.25, (state.cities[a.depot || a.from]?.buildings?.workshop || 0) * 0.05));
  const courtMultB = computeCourtBonuses(state, b.faction).combatMult
    * (1 + Math.min(0.25, (state.cities[b.depot || b.from]?.buildings?.workshop || 0) * 0.05));

  const powA = Math.max(1, a.troops) * cAB.mult * officerPowerMult(state, offA, false, false, terrain)
    * depMultA * formA.atkMult * bondA.atkMult * wfMultA * specMultA * decMultA * flankMultA * courtMultA
    * (0.72 + a.morale * 0.004) * (a.supplyCut ? 0.72 : 1)
    * (a.troopType === "siege" ? 0.82 : 1)
    * (a.faction !== state.player ? DIFFICULTY_MODES[state.difficulty || "standard"].aiAtkMult : 1);
  const powB = Math.max(1, b.troops) * cBA.mult * officerPowerMult(state, offB, false, false, terrain)
    * depMultB * formB.atkMult * bondB.atkMult * wfMultB * specMultB * decMultB * flankMultB * courtMultB
    * (0.72 + b.morale * 0.004) * (b.supplyCut ? 0.72 : 1)
    * (b.troopType === "siege" ? 0.82 : 1)
    * (b.faction !== state.player ? DIFFICULTY_MODES[state.difficulty || "standard"].aiAtkMult : 1);

  const ratioAB = powA / Math.max(1, powB);
  const aWins = powA >= powB;
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;
  const winBond = aWins ? bondA : bondB;
  const loseBond = aWins ? bondB : bondA;
  const winForm = aWins ? formA : formB;
  const loseForm = aWins ? formB : formA;
  const winPow = aWins ? powA : powB;
  const losePow = aWins ? powB : powA;
  const dom = clamp(winPow / Math.max(1, losePow), 1, 3.2);

  const nextRound = Math.max(a.engageRounds || 0, b.engageRounds || 0) + 1;
  const roundPreScale = allowEngage && dom < 2.2 && nextRound <= 2 && a.stance !== "retreat" && b.stance !== "retreat" ? 0.64 : 1;

  const rawWinLoss = Math.round(winner.troops * (0.12 + 0.14 / dom) * roundPreScale * (TROOP_TYPES[winner.troopType]?.lossMult ?? 1) * winBond.lossMult * (winForm.lossMult / Math.sqrt(winForm.defMult)));
  const rawLoseLoss = Math.round(loser.troops * clamp(0.24 * dom, 0.24, 0.65) * roundPreScale * (TROOP_TYPES[loser.troopType]?.lossMult ?? 1) * loseBond.lossMult * (loseForm.lossMult / Math.sqrt(loseForm.defMult)));

  const winLoss = Math.min(winner.troops, clamp(rawWinLoss, 25, Math.max(25, winner.troops - 120)));
  const loseLoss = Math.min(loser.troops, clamp(rawLoseLoss, 40, loser.troops));

  winner.troops -= winLoss;
  loser.troops -= loseLoss;
  winner.morale = clamp(winner.morale + (roundPreScale < 1 ? 3 : 7), 20, 100);
  loser.morale = clamp(loser.morale - (roundPreScale < 1 ? 10 : 18), 10, 100);

  const canLockOngoing = allowEngage
    && a.stance !== "retreat"
    && b.stance !== "retreat"
    && winner.troops >= 220
    && loser.troops >= 220
    && loser.morale > 24
    && dom < 2.2
    && nextRound <= 2;

  const posA = armyWorldPosition(world, a);
  const posB = armyWorldPosition(world, b);
  const pos = [(posA[0] + posB[0]) / 2, (posA[1] + posB[1]) / 2];
  const winName = aWins ? nameA : nameB;
  const loseName = aWins ? nameB : nameA;
  if (winner.officer) awardMerit(state, winner.officer, { merit: canLockOngoing ? 18 : 35, win: !canLockOngoing }, events);
  if (winner.deputy) awardMerit(state, winner.deputy, { merit: canLockOngoing ? 10 : 18, win: !canLockOngoing }, events);

  const counterHint = cAB.relation === "counter" ? `（${cAB.label}）`
    : cBA.relation === "counter" ? `（${cBA.label}）` : "";
  const flankNote = (aWins ? hasFlankA : hasFlankB) ? " · 友军夹击" : "";
  const locStr = `${cityNameV2(world, a.from)}—${cityNameV2(world, a.to)}`;

  const reportPayload = {
    kind: canLockOngoing ? "engaged" : "field",
    title: `${winName} ${canLockOngoing ? `阵前绞杀(第${nextRound}合)` : "野战击溃"} ${loseName}`,
    location: locStr,
    locationKey: a.to,
    winnerFaction: winner.faction,
    attacker: { faction: a.faction, officer: nameA, troops: a.troops + (a === winner ? winLoss : loseLoss), form: formA.name },
    defender: { faction: b.faction, officer: nameB, troops: b.troops + (b === winner ? winLoss : loseLoss), form: formB.name },
    factors: [
      cAB.label || cBA.label || null,
      `${winForm.name}克制${loseForm.name}`,
      winBond.labels?.length ? `羁绊：${winBond.labels.join("、")}` : null,
      (aWins ? hasFlankA : hasFlankB) ? "友军同道夹击 +18%" : null,
      (aWins ? decMultA : decMultB) > 1 ? "国策军械增益" : null,
      loser.supplyCut ? "敌军粮道断绝 -28%" : null,
    ].filter(Boolean),
    losses: { winner: winLoss, loser: loseLoss },
    artTriggered,
    shattered: !canLockOngoing && loser.troops < 180,
  };
  const br = recordBattleReport(state, reportPayload);

  if (canLockOngoing) {
    a.stance = "engaged";
    b.stance = "engaged";
    a.engagedWith = b.id;
    b.engagedWith = a.id;
    a.engageRounds = nextRound;
    b.engageRounds = nextRound;
    a.reorgDekads = 0;
    b.reorgDekads = 0;

    events.push({
      turn: state.turn,
      kind: "field_battle",
      engaged: true,
      reportId: br?.id,
      faction: winner.faction,
      participants: [a.faction, b.faction],
      pos,
      city: a.to,
      winnerLoss: winLoss,
      loserLoss: loseLoss,
      shattered: false,
      text: `⚔️ 阵前绞杀(第${nextRound}合)${flankNote}！${winName}与${loseName}杀作一团${counterHint}，毙敌 ${loseLoss.toLocaleString()}、自损 ${winLoss.toLocaleString()}，两军继续对峙（下旬续战）。`,
    });
    return ratioAB;
  }

  winner.engagedWith = null;
  winner.engageRounds = 0;
  loser.engagedWith = null;
  loser.engageRounds = 0;
  if (winner.stance === "engaged") {
    winner.stance = canTransitCity(state, winner.faction, winner.targetCity) ? "reinforce" : "attack";
  }
  winner.reorgDekads = 1;
  loser.reorgDekads = 1;

  if (loser.troops >= 180) {
    loser.stance = "retreat";
    const tmp = loser.from;
    loser.from = loser.to;
    loser.to = tmp;
    loser.route = [loser.from, tmp];
    loser.step = 0;
    loser.targetCity = tmp;
    loser.progress = clamp(1 - loser.progress + 0.18, 0.15, 0.85);
  }

  events.push({
    turn: state.turn,
    kind: "field_battle",
    reportId: br?.id,
    faction: winner.faction,
    participants: [a.faction, b.faction],
    pos,
    city: a.to,
    winnerLoss: winLoss,
    loserLoss: loseLoss,
    shattered: loser.troops < 180,
    text: `野战交锋！${winName}击溃${loseName}${counterHint}${flankNote}，毙敌 ${loseLoss.toLocaleString()}、自损 ${winLoss.toLocaleString()}。`,
  });

  if (loser.troops < 180) {
    loser.troops = 0;
    attemptCaptureOrReturn(state, loser.officer, winner.faction, loser.to, 0.12, events);
    if (loser.deputy) {
      attemptCaptureOrReturn(state, loser.deputy, winner.faction, loser.to, 0.1, events);
    }
  }
  return ratioAB;
}

function handleTrapOnArrival(world, state, cityKey, army, events) {
  const city = state.cities[cityKey];
  if (!city?.trap || city.trap.expiresTurn < state.turn) {
    if (city) city.trap = null;
    return;
  }
  const trap = DEFENSE_TRAPS[city.trap.id];
  city.trap = null;
  if (!trap) return;

  const pos = cityByKey(world, cityKey)?.position || [390, 250];
  const offName = (army.officer && state.officers[army.officer]?.name) || army.escortName || "敌";
  if (trap.id === "fire_pit") {
    const wFire = state.weather?.fireMult ?? 1;
    const dmg = Math.max(80, Math.round(army.troops * trap.troopDmgPct * wFire));
    army.troops = Math.max(0, army.troops - dmg);
    army.morale = clamp(army.morale - trap.moraleDmg, 10, 100);
    events.push({ turn: state.turn, kind: "trap", faction: city.owner, participants: [city.owner, army.faction], city: cityKey, pos, dmg, text: `🔥 ${cityNameV2(world, cityKey)}「火油陷坑」烈焰轰鸣！焚毁${offName}先头部队 ${dmg.toLocaleString()} 人！` });
  } else if (trap.id === "abatis") {
    city.wall = Math.min(city.wallMax + 120, city.wall + trap.extraWall);
    army.reorgDekads = 1;
    events.push({ turn: state.turn, kind: "trap", faction: city.owner, participants: [city.owner, army.faction], city: cityKey, pos, text: `🪵 ${cityNameV2(world, cityKey)}「鹿角拒马」阻滞敌锋，城防临时加固 +${trap.extraWall}！` });
  } else if (trap.id === "ambush") {
    const dmg = Math.max(70, Math.round(army.troops * trap.troopDmgPct));
    army.troops = Math.max(0, army.troops - dmg);
    army.ambushHitBonus = trap.captureBonus;
    events.push({ turn: state.turn, kind: "trap", faction: city.owner, participants: [city.owner, army.faction], city: cityKey, pos, dmg, text: `🌿 ${cityNameV2(world, cityKey)}「城外伏兵」四起夹杀！歼敌 ${dmg.toLocaleString()} 人。` });
  }
}

function transferCityOwnership(world, state, cityKey, winnerFaction, besiegerArmies, events) {
  const city = state.cities[cityKey];
  const prevOwner = city.owner;
  const oldGov = city.governor;
  const oldCmd = city.commander;

  city.owner = winnerFaction;
  city.governor = null;
  city.commander = null;
  city.trap = null;
  city.siegeDefense = "hold";
  city.wall = Math.max(160, Math.round(city.wallMax * 0.42));
  city.foodReserve = 68;
  city.morale = 64;
  city.publicOrder = 62;

  const sorted = besiegerArmies.slice().sort((a, b) => b.troops - a.troops);
  const lead = sorted[0];
  let totalAdded = 0;
  for (const a of sorted) {
    if (a.faction !== winnerFaction || a.troops <= 0) continue;
    totalAdded += a.troops;
    const off = a.officer ? state.officers[a.officer] : null;
    if (off) {
      off.armyId = null;
      off.city = cityKey;
      awardMerit(state, a.officer, { merit: 60, win: true, capture: a === lead }, events);
    }
    if (a.deputy && state.officers[a.deputy]) {
      const dep = state.officers[a.deputy];
      dep.armyId = null;
      dep.city = cityKey;
      awardMerit(state, a.deputy, { merit: 32, win: true }, events);
    }
    a.troops = 0;
  }
  if (lead?.officer && state.officers[lead.officer]?.faction === winnerFaction) {
    city.commander = lead.officer;
  }
  city.troops = Math.max(350, city.troops + totalAdded);
  delete state.sieges[cityKey];

  if (Array.isArray(state.corps)) {
    if (prevOwner === state.player) {
      for (const co of state.corps) {
        co.cities = (co.cities || []).filter((ck) => ck !== cityKey);
      }
    }
    if (winnerFaction === state.player && lead?.corpsId) {
      for (const co of state.corps) {
        if (co.id === lead.corpsId) {
          if (!co.cities.includes(cityKey)) co.cities.push(cityKey);
        } else {
          co.cities = (co.cities || []).filter((ck) => ck !== cityKey);
        }
      }
    }
  }

  for (const defOff of [oldCmd, oldGov]) {
    if (defOff && state.officers[defOff]) {
      attemptCaptureOrReturn(state, defOff, winnerFaction, cityKey, lead?.ambushHitBonus ?? 0, events);
    }
  }
  for (const o of Object.values(state.officers)) {
    if (o.city === cityKey && o.faction === prevOwner && !o.armyId && !o.capturedBy) {
      returnOfficerHome(state, o.key, null);
    }
  }

  const pos = cityByKey(world, cityKey)?.position || [390, 250];
  const br = recordBattleReport(state, {
    kind: "capture",
    title: `攻克「${cityNameV2(world, cityKey)}」`,
    location: cityNameV2(world, cityKey),
    locationKey: cityKey,
    winnerFaction,
    attacker: { faction: winnerFaction, officer: lead?.officer ? state.officers[lead.officer]?.name : "诸路围师", troops: totalAdded },
    defender: { faction: prevOwner, officer: oldCmd ? state.officers[oldCmd]?.name : "城防守军", troops: 0 },
    factors: [sorted.length >= 2 ? "多路合围攻破" : "主力克城", `留驻守军 ${city.troops.toLocaleString()} 人`],
    losses: { winner: 0, loser: 0 },
  });

  events.push({
    turn: state.turn,
    kind: "capture",
    reportId: br?.id,
    faction: winnerFaction,
    participants: [winnerFaction, prevOwner],
    city: cityKey,
    pos,
    text: `🚩 攻克名城！${factionNameV2(world, state, winnerFaction)}挥师夺取「${cityNameV2(world, cityKey)}」（原属${factionNameV2(world, state, prevOwner)}）！`,
  });

  if (state.emperorCity === cityKey) {
    events.push({
      turn: state.turn,
      kind: "system",
      faction: winnerFaction,
      city: cityKey,
      pos,
      text: `👑 奉迎汉帝！「${factionNameV2(world, state, winnerFaction)}」克复帝都「${cityNameV2(world, cityKey)}」，天子龙辇已入其掌握，可于朝堂颁发天子诏书！`,
    });
  }
  if (state.sealFaction === prevOwner) {
    const prevRemains = Object.values(state.cities).some((c) => c.owner === prevOwner);
    if (!prevRemains) {
      state.sealFaction = winnerFaction;
      events.push({
        turn: state.turn,
        kind: "system",
        faction: winnerFaction,
        city: cityKey,
        pos,
        text: `💎 传国玉玺易主！「${factionNameV2(world, state, winnerFaction)}」覆灭旧主并获献受命传国玉玺！`,
      });
    }
  }
}

function resolveSieges(world, state, events) {
  for (const [cityKey, siege] of Object.entries(state.sieges)) {
    const city = state.cities[cityKey];
    if (!city) {
      delete state.sieges[cityKey];
      continue;
    }
    const attackers = (siege.attackerArmyIds || [])
      .map((id) => state.armies.find((a) => a.id === id))
      .filter((a) => a && a.troops > 0 && a.stance === "besiege" && a.targetCity === cityKey);

    if (!attackers.length) {
      // Defenders successfully held off / outlasted siege
      if (city.commander) awardMerit(state, city.commander, { merit: 45, defense: true }, events);
      events.push({
        turn: state.turn,
        kind: "siege_lifted",
        faction: city.owner,
        city: cityKey,
        pos: cityByKey(world, cityKey)?.position,
        text: `🛡️ ${cityNameV2(world, cityKey)}解围！守军力保城池未失。`,
      });
      delete state.sieges[cityKey];
      continue;
    }

    const totalAttTroops = attackers.reduce((s, a) => s + a.troops, 0);
    const encircleBonus = attackers.length >= 2 ? 1.15 : 1.0;
    const defCmd = city.commander ? state.officers[city.commander] : null;
    const defMode = SIEGE_DEFENSE_MODES[city.siegeDefense || "hold"] || SIEGE_DEFENSE_MODES.hold;

    // Special defender night fire raid
    if (city.siegeDefense === "fire_raid" && !siege.fireRaidUsed && city.troops >= 400) {
      siege.fireRaidUsed = true;
      city.siegeDefense = "hold";
      let burned = 0;
      for (const a of attackers) {
        const l = Math.max(40, Math.round(a.troops * 0.16 * (state.weather?.fireMult ?? 1)));
        a.troops = Math.max(0, a.troops - l);
        a.grain = Math.max(0, a.grain - 6);
        a.morale = clamp(a.morale - 14, 10, 100);
        burned += l;
      }
      events.push({
        turn: state.turn,
        kind: "trap",
        faction: city.owner,
        participants: [city.owner, attackers[0].faction],
        city: cityKey,
        pos: cityByKey(world, cityKey)?.position,
        text: `🔥 ${cityNameV2(world, cityKey)}守军「夜袭烧营」！劫毁围军兵粮并斩伤 ${burned.toLocaleString()} 人！`,
      });
    }

    // Resolve each besieger army's contribution & stance
    let avgWallDmgMult = 0;
    let maxFoodDrain = 0;
    let avgAttLossMult = 0;
    let avgDefLossMult = 0;
    let avgMoraleDrain = 0;
    let weightedAttPow = 0;
    let siegeEngineFactor = 1;

    for (const a of attackers) {
      const stance = SIEGE_STANCES[a.siegeStance] || SIEGE_STANCES.storm;
      const fac = state.factions[a.faction];
      if (stance.cost && fac && fac.treasury >= stance.cost) {
        fac.treasury -= stance.cost;
      } else if (stance.cost) {
        a.siegeStance = "storm";
      }
      if (a.officer) {
        a.rage = clamp((a.rage || 0) + 28, 0, 100);
        if (a.rage >= 100 && a.troops >= 240) {
          triggerArmyArt(world, state, a.id, events, { manual: false });
        }
      }
      const st = SIEGE_STANCES[a.siegeStance] || SIEGE_STANCES.storm;
      const form = FORMATIONS_V2[a.formation || "heyi"] || FORMATIONS_V2.heyi;
      const share = a.troops / Math.max(1, totalAttTroops);
      const tSpec = TROOP_TYPES[a.troopType] || TROOP_TYPES.infantry;
      const offObj = a.officer ? state.officers[a.officer] : null;
      const depObj = a.deputy ? state.officers[a.deputy] : null;
      const attAllies = [...attackers.flatMap((x) => [x.officer, x.deputy]), a.deputy].filter(Boolean);
      const attBond = a.officer ? evaluateBondBonus(state, a.officer, attAllies, [city.commander, city.governor].filter(Boolean)) : { atkMult: 1, defMult: 1, lossMult: 1 };
      const depMult = depObj ? clamp(1 + ((depObj.might - 60) + (depObj.command - 60)) * 0.0018, 0.96, 1.14) : 1;
      const counter = troopCounterEffect(a.troopType, city.troopType, "plain", state.weather);
      const arsenalBonus = a.specialtyTag === "arsenal" && a.troopType === "siege" ? 1.15 : 1;
      const thunderMult = hasDecree(state, a.faction, "thunder_siege") ? 1 + (NATIONAL_DECREES_V2.thunder_siege.siegeMult ?? 0.22) : 1;
      const pow = a.troops * counter.mult * officerPowerMult(state, offObj, true, false, "plain")
        * depMult * attBond.atkMult * (0.72 + a.morale * 0.0038) * (a.supplyCut ? 0.72 : 1) * encircleBonus
        * computeCourtBonuses(state, a.faction).combatMult
        * (a.faction !== state.player ? DIFFICULTY_MODES[state.difficulty || "standard"].aiAtkMult : 1);

      weightedAttPow += pow;
      avgWallDmgMult += st.wallDmgMult * share * tSpec.siegeMult * form.siegeMult * arsenalBonus * thunderMult;
      maxFoodDrain = Math.max(maxFoodDrain, st.foodDrain);
      avgAttLossMult += st.attLossMult * share * attBond.lossMult * form.lossMult;
      avgDefLossMult += st.defLossMult * share;
      avgMoraleDrain += st.moraleDrain * share;
      if (a.troopType === "siege") siegeEngineFactor = Math.max(siegeEngineFactor, 1.35);
    }

    const defBond = city.commander
      ? evaluateBondBonus(state, city.commander, [city.governor].filter(Boolean), attackers.flatMap((x) => [x.officer, x.deputy]).filter(Boolean))
      : { defMult: 1, lossMult: 1 };
    const wallRatioBonus = 1 + (city.wall / Math.max(1, city.wallMax)) * 0.45 + (TROOP_TYPES[city.troopType]?.wallDefBonus ?? 0);
    const workshopDefMult = 1 + (city.buildings?.workshop || 0) * CITY_BUILDINGS_V4.workshop.combatBonusPerLv;
    const courtDefMult = computeCourtBonuses(state, city.owner).combatMult;
    const defPow = Math.max(200, city.troops * wallRatioBonus * workshopDefMult * courtDefMult * officerPowerMult(state, defCmd, false, true, "plain") * defBond.defMult * (0.72 + city.morale * 0.0035));

    // Calculate wall, food, morale, and troop attrition for ONE dekad
    const ironWallMitigation = hasDecree(state, city.owner, "iron_walls") ? (NATIONAL_DECREES_V2.iron_walls.wallMitigation ?? 0.88) : 1;
    const rawWallDmg = clamp(Math.round((42 + (weightedAttPow / Math.max(400, defPow)) * 46) * avgWallDmgMult * (defMode.wallMitigation ?? 1) * ironWallMitigation), 12, 185);
    const attLossesTotal = clamp(Math.round(totalAttTroops * 0.055 * (defPow / Math.max(300, weightedAttPow)) * avgAttLossMult * (defMode.sallyMult ?? 1)), 25, Math.round(totalAttTroops * 0.35));
    const defLosses = clamp(Math.round(city.troops * 0.068 * (weightedAttPow / Math.max(350, defPow)) * avgDefLossMult * defBond.lossMult * (defMode.lossMitigation ?? 1)), 30, city.troops);

    const citySpec = CITY_SPECIALTIES[city.specialty];
    const foodDrainMult = citySpec?.foodLossMult ?? 1;
    city.wall = Math.max(0, city.wall - rawWallDmg);
    city.foodReserve = Math.max(0, city.foodReserve - Math.round(maxFoodDrain * foodDrainMult * (siegeEngineFactor > 1 ? 1.05 : 1)));
    const starvationMorale = city.foodReserve === 0 ? 18 : 0;
    city.morale = clamp(city.morale - Math.round(avgMoraleDrain + starvationMorale), 5, 100);
    city.troops = Math.max(0, city.troops - defLosses);

    // Distribute attacker casualties proportionally across besieging armies
    for (const a of attackers) {
      const share = a.troops / Math.max(1, totalAttTroops);
      const loss = Math.min(a.troops, Math.round(attLossesTotal * share));
      a.troops = Math.max(0, a.troops - loss);
      if (a.troops < 140) {
        a.troops = 0;
        releaseArmyOfficers(state, a, null);
      }
    }

    const survivingAttackers = attackers.filter((a) => a.troops > 0);
    siege.attackerArmyIds = survivingAttackers.map((a) => a.id);

    const breachReady = city.wall <= 0 && weightedAttPow >= defPow * 0.72;
    const garrisonCrushed = city.troops <= 120;
    const moraleCollapsed = city.morale <= 16 && (city.foodReserve <= 10 || siege.attackerArmyIds.some((id) => state.armies.find((a) => a.id === id)?.siegeStance === "persuade"));

    if (survivingAttackers.length && (garrisonCrushed || breachReady || moraleCollapsed)) {
      const winnerFaction = survivingAttackers[0].faction;
      transferCityOwnership(world, state, cityKey, winnerFaction, survivingAttackers, events);
    } else if (!survivingAttackers.length) {
      if (city.commander) awardMerit(state, city.commander, { merit: 45, defense: true }, events);
      delete state.sieges[cityKey];
    } else {
      events.push({
        turn: state.turn,
        kind: "siege_tick",
        faction: survivingAttackers[0].faction,
        participants: [survivingAttackers[0].faction, city.owner],
        city: cityKey,
        pos: cityByKey(world, cityKey)?.position,
        wallDmg: rawWallDmg,
        defLoss: defLosses,
        attLoss: attLossesTotal,
        text: `⚔️ ${cityNameV2(world, cityKey)}围城拉锯：城防 -${rawWallDmg}（余 ${city.wall}），守军折 ${defLosses.toLocaleString()}，围军损 ${attLossesTotal.toLocaleString()}。`,
      });
    }
  }
}

function applyMonthlyGovernance(world, state, events) {
  // 1. Update each city's recruitment, wall repair, reserve food & public order
  for (const city of Object.values(state.cities)) {
    const pol = CITY_POLICIES[city.policy || "balanced"] || CITY_POLICIES.balanced;
    const fac = state.factions[city.owner];
    if (!fac) continue;
    const b = city.buildings || { farm: 1, market: 1, workshop: 0, academy: 0 };
    const tier = cityTierInfo(city);
    city.level = tier.level;

    const tax = TAX_LEVELS_V4[fac.taxLevel || "normal"] || TAX_LEVELS_V4.normal;
    const court = computeCourtBonuses(state, city.owner);
    const regGov = computeRegionalGovernorBonus(state, city);
    const gov = city.governor ? state.officers[city.governor] : null;
    const govBonus = 1 + ((gov?.governance ?? 55) - 55) * 0.004 + (gov?.traits?.includes("farming") ? 0.08 : 0);
    const underSiege = Boolean(state.sieges[city.key]);

    const orderShift = tax.orderDelta + (b.academy || 0) * CITY_BUILDINGS_V4.academy.orderPerLv + court.orderBonus + regGov.orderBonus + (underSiege ? -8 : 0);
    city.publicOrder = clamp((Number.isFinite(city.publicOrder) ? city.publicOrder : 78) + orderShift, 0, 100);

    if (!underSiege) {
      const standingMult = hasDecree(state, city.owner, "standing_army") ? (1 + (NATIONAL_DECREES_V2.standing_army.recruitMult ?? 0.3)) : 1;
      const ironWallRepairMult = hasDecree(state, city.owner, "iron_walls") ? (1 + (NATIONAL_DECREES_V2.iron_walls.wallRepairMult ?? 0.35)) : 1;
      const moraleFloor = hasDecree(state, city.owner, "imperial_edict") ? (NATIONAL_DECREES_V2.imperial_edict.moraleFloor ?? 75) : 40;

      const cap = 2400 + tier.level * 480 + (b.farm || 0) * CITY_BUILDINGS_V4.farm.troopCapPerLv;
      const workshopRecMult = 1 + (b.workshop || 0) * CITY_BUILDINGS_V4.workshop.recruitPerLv;
      if (city.troops < cap) {
        const rec = Math.round(92 * pol.recruitRate * govBonus * workshopRecMult * court.recruitMult * regGov.recruitMult * standingMult);
        city.troops = Math.min(cap, city.troops + rec);
      }
      city.wall = Math.min(city.wallMax, city.wall + Math.round(pol.wallRepair * ironWallRepairMult));
      city.foodReserve = Math.min(100, city.foodReserve + pol.foodRefill + (b.farm || 0) * CITY_BUILDINGS_V4.farm.foodRefillPerLv);
      city.morale = Math.max(moraleFloor, clamp(city.morale + 2, 40, 100));

      if (city.publicOrder < 25 && city.troops > 450) {
        const loss = Math.max(60, Math.round(city.troops * 0.12));
        city.troops = Math.max(300, city.troops - loss);
        city.publicOrder = 45;
        if (city.owner === state.player) {
          events.push({
            turn: state.turn,
            kind: "trap",
            faction: city.owner,
            city: city.key,
            pos: cityByKey(world, city.key)?.position,
            text: `🔥 治安告急！「${cityNameV2(world, city.key)}」怨声载道爆发流民骚乱，折损守军 ${loss.toLocaleString()} 人（建议下调税率或兴建郡学）！`,
          });
        }
      }
    }
  }

  // 2. Apply tax yield minus troop upkeep & corruption per faction
  for (const fk of Object.keys(state.factions)) {
    const fac = state.factions[fk];
    if (!fac) continue;
    const econ = estimateFactionEconomy(state, fk);
    if (!econ.cityCount) continue;

    fac.treasury = Math.max(0, fac.treasury + econ.netTreasury);
    fac.grain = Math.max(0, fac.grain + econ.netGrain);
    if (fac.key === state.player && ((fac.treasury === 0 && econ.netTreasury < 0) || (fac.grain === 0 && econ.netGrain < 0))) {
      fac.morale = clamp(fac.morale - 4, 20, 100);
      events.push({
        turn: state.turn,
        kind: "economy",
        faction: fk,
        text: `⚠️ 【府库/军粮入不敷出】大军维持耗费过重，建议调整税率、兴建农商或适度裁兵！`,
      });
    }
    if (hasDecree(state, fk, "imperial_edict")) {
      fac.morale = Math.max(fac.morale, NATIONAL_DECREES_V2.imperial_edict.moraleFloor ?? 75);
    }
  }

  // 3. Apply monthly officer loyalty adjustments (Heir + Nine Ranks + Tax)
  for (const off of Object.values(state.officers)) {
    if (off.capturedBy) continue;
    const fac = state.factions[off.faction];
    if (!fac) continue;
    const court = computeCourtBonuses(state, off.faction);
    const tax = TAX_LEVELS_V4[fac.taxLevel || "normal"] || TAX_LEVELS_V4.normal;
    const nineRanksDelta = hasDecree(state, off.faction, "nine_ranks") ? (NATIONAL_DECREES_V2.nine_ranks.monthlyLoyalty ?? 2) : 0;
    const totalLoyaltyDelta = nineRanksDelta + court.heirLoyaltyMonthly + tax.loyaltyDelta;
    if (totalLoyaltyDelta !== 0) {
      off.loyalty = clamp(off.loyalty + totalLoyaltyDelta, 0, 100);
    }
  }

  const pEcon = estimateFactionEconomy(state, state.player);
  const signT = pEcon.netTreasury >= 0 ? `+${pEcon.netTreasury}` : `${pEcon.netTreasury}`;
  const signG = pEcon.netGrain >= 0 ? `+${pEcon.netGrain}` : `${pEcon.netGrain}`;
  events.push({
    turn: state.turn,
    kind: "economy",
    text: `【月度税赋与军饷结算】国库净 ${signT} 钱（扣军饷 ${pEcon.upkeepTreasury}/腐败 ${pEcon.corruptionLoss}），军粮净 ${signG} 石，平均治安 ${pEcon.avgOrder}。`,
  });
}

function planAiDekad(world, state) {
  const diff = DIFFICULTY_MODES[state.difficulty || "standard"];
  const factions = Object.keys(state.factions).filter((fk) => fk !== state.player);

  for (const fk of factions) {
    const ownedCities = Object.values(state.cities).filter((c) => c.owner === fk);
    if (!ownedCities.length) continue;
    const pers = aiPersonalityFor(fk);
    const aggMult = diff.aiAggression * (pers.aggression ?? 1) * (state.coalitionAlertLevel > 0 ? 1.14 : 1);

    // 0. AI infrastructure development (farm/market/academy/workshop)
    const devCadence = state.turn <= OPENING_DEV_DEKADS ? 2 : 3;
    if ((state.turn + hashStr(fk)) % devCadence === 0 && (state.factions[fk]?.treasury ?? 0) >= 48) {
      const econ = estimateFactionEconomy(state, fk);
      const track = econ.netGrain < 45 || state.factions[fk].grain < 120 ? "farm"
        : econ.avgOrder < 62 ? "academy"
          : (state.factions[fk].treasury < 110 || econ.netTreasury < 30 ? "market"
            : ((state.turn % 2 === 0) ? "farm" : "workshop"));
      const buildCity = ownedCities
        .filter((c) => !state.sieges?.[c.key] && !c.construction && (c.buildings?.[track] ?? 0) < 5)
        .sort((a, b) => (a.buildings?.[track] ?? 0) - (b.buildings?.[track] ?? 0) || b.troops - a.troops)[0];
      if (buildCity) {
        const nextLv = (buildCity.buildings?.[track] ?? 0) + 1;
        const cost = buildingUpgradeCost(state, fk, track, nextLv);
        if (state.factions[fk].treasury >= cost) {
          try {
            const built = upgradeCityBuilding(world, state, buildCity.key, track, { actorFaction: fk, silent: true });
            state.cities[buildCity.key] = built.cities[buildCity.key];
            state.factions[fk].treasury = built.factions[fk].treasury;
          } catch {
            // Skip invalid build state
          }
        }
      }
    }

    // 1. Update besieging AI stances intelligently
    const myArmies = state.armies.filter((a) => a.faction === fk && a.troops > 0);
    for (const a of myArmies) {
      if (a.stance === "besiege") {
        const target = state.cities[a.targetCity];
        if (!target) continue;
        if (a.troops < 340 || a.morale < 25) {
          const safe = findRoadPath(world, state, fk, a.targetCity, ownedCities[0].key, { allowEnemyEnd: false });
          if (safe && safe.length >= 2) {
            if (state.sieges[a.targetCity]) {
              state.sieges[a.targetCity].attackerArmyIds = state.sieges[a.targetCity].attackerArmyIds.filter((id) => id !== a.id);
            }
            a.stance = "retreat";
            a.route = safe;
            a.step = 0;
            a.from = safe[0];
            a.to = safe[1];
            a.targetCity = safe[safe.length - 1];
            a.progress = 0.08;
          }
        } else if (target.wall > target.wallMax * 0.55 && a.troopType !== "siege") {
          a.siegeStance = target.foodReserve > 45 ? "surround" : "storm";
        } else {
          a.siegeStance = "storm";
        }
      }
    }

    const maxAiArmies = clamp(Math.ceil(ownedCities.length / 2) + 1, 2, 4);
    if (myArmies.length >= maxAiArmies) continue;

    // 2. Priority defense: rescue own besieged cities!
    const besiegedMine = ownedCities.filter((c) => state.sieges[c.key]);
    let dispatchedThisTurn = false;
    for (const cryCity of besiegedMine) {
      if (state.armies.some((a) => a.faction === fk && a.targetCity === cryCity.key && a.stance === "reinforce")) continue;
      const helper = ownedCities
        .filter((c) => c.key !== cryCity.key && !state.sieges[c.key] && c.troops >= 1350 && cityByKey(world, c.key).links.includes(cryCity.key))
        .sort((a, b) => b.troops - a.troops)[0];
      const helperOff = helper && availableOfficersInCity(state, helper.key, fk)[0];
      if (helper && helperOff && state.factions[fk].grain >= 14) {
        const troops = clamp(Math.round((helper.troops - 450) * 0.65), 400, 1600);
        helper.troops -= troops;
        if (helper.commander === helperOff.key) helper.commander = null;
        if (helper.governor === helperOff.key) helper.governor = null;
        helperOff.city = null;
        state.factions[fk].grain -= 10;
        const relief = createArmyRecord(world, state, {
          faction: fk,
          from: helper.key,
          route: [helper.key, cryCity.key],
          officerKey: helperOff.key,
          troops,
          troopType: helper.troopType,
          stance: "reinforce",
          formation: "changshe",
        });
        helperOff.armyId = relief.id;
        state.armies.push(relief);
        dispatchedThisTurn = true;
        break;
      }
    }
    if (dispatchedThisTurn) continue;

    // 3. Opportunistic AI border offensive shaped by ruler personality (wait out opening dev phase)
    if (state.turn <= OPENING_DEV_DEKADS) continue;
    if (((state.turn + hashStr(fk)) % (aggMult > 1.1 ? 2 : 3)) !== 0) continue;
    if (state.factions[fk].grain < 28) continue;

    let bestAttack = null;
    for (const c of ownedCities) {
      if (state.sieges[c.key] || c.troops < 1750) continue;
      const off = availableOfficersInCity(state, c.key, fk)[0];
      if (!off) continue;
      for (const nbKey of cityByKey(world, c.key).links) {
        const target = state.cities[nbKey];
        if (!target || !isHostileV2(state, fk, target.owner)) continue;
        const powerGap = (c.troops - 450) * aggMult - target.troops * 0.92;
        if (powerGap < 250) continue;
        const score = powerGap + (target.owner === state.player ? (state.coalitionAlertLevel > 0 ? 280 : 120) : 0);
        if (!bestAttack || score > bestAttack.score) {
          bestAttack = { from: c, to: target, off, score };
        }
      }
    }

    if (bestAttack) {
      const troops = clamp(Math.round((bestAttack.from.troops - 450) * 0.65), 500, 1900);
      bestAttack.from.troops -= troops;
      if (bestAttack.from.commander === bestAttack.off.key) bestAttack.from.commander = null;
      if (bestAttack.from.governor === bestAttack.off.key) bestAttack.from.governor = null;
      bestAttack.off.city = null;
      state.factions[fk].grain -= Math.max(6, Math.ceil(troops / 240));
      const useType = pers.preferTroop && (hashStr(`${fk}:${state.turn}`) % 3 === 0) ? pers.preferTroop : bestAttack.from.troopType;
      const army = createArmyRecord(world, state, {
        faction: fk,
        from: bestAttack.from.key,
        route: [bestAttack.from.key, bestAttack.to.key],
        officerKey: bestAttack.off.key,
        troops,
        troopType: useType,
        stance: "attack",
        siegeStance: bestAttack.to.wall > 320 ? "storm" : "surround",
        formation: pers.formation || "heyi",
      });
      bestAttack.off.armyId = army.id;
      state.armies.push(army);
    }
  }
}

export function checkOutcome(state) {
  let playerCities = 0;
  let totalCities = 0;
  for (const c of Object.values(state.cities)) {
    totalCities += 1;
    if (c.owner === state.player) playerCities += 1;
  }
  if (playerCities === 0) state.outcome = "defeat";
  else if (playerCities === totalCities) state.outcome = "victory";
  else state.outcome = "ongoing";
  return state.outcome;
}

/**
 * 核心推进函数：推进一旬
 */
export function advanceDekad(world, state, { skipAi = false, skipCorps = false } = {}) {
  if (state.outcome !== "ongoing") return state;
  let next = ensurePhase2State(structuredClone(state));
  for (const ck of Object.keys(next.cities || {})) {
    if (!next.cities[ck].region) {
      next.cities[ck].region = cityByKey(world, ck)?.region || "中原与淮北";
    }
  }
  next.turn += 1;
  next.edictCooldown = Math.max(0, (next.edictCooldown || 0) - 1);
  const events = [];

  tickOfficerTransfers(world, next, events);
  tickCityConstructions(world, next, events);

  if (!skipAi) {
    planAiDekad(world, next);
    planAiPhase2Dekad(world, next);
  }
  if (!skipCorps) {
    runPlayerCorpsDekad(world, next, events);
  }

  // 1. Update positions, advance marching armies & check supply lines
  for (const a of next.armies) {
    a.lastPos = armyWorldPosition(world, a);
    if (a.reorgDekads > 0) a.reorgDekads -= 1;

    if (a.stance === "engaged") {
      const partner = next.armies.find((x) => x.id === a.engagedWith && x.troops > 0 && x.stance === "engaged");
      if (!partner) {
        a.stance = canTransitCity(next, a.faction, a.targetCity) ? "reinforce" : "attack";
        a.engagedWith = null;
        a.engageRounds = 0;
      }
    }

    // Supply drain & check
    a.supplyCut = !checkSupplyLine(world, next, a);
    const grainUse = Math.max(1, Math.round(a.troops / 550) * (next.weather?.grainMult ?? 1));
    if (!a.supplyCut) {
      if ((next.factions[a.faction]?.grain ?? 0) >= grainUse) {
        next.factions[a.faction].grain -= grainUse;
        a.grain = Math.min(20, a.grain + 1);
      } else {
        a.grain = Math.max(0, a.grain - grainUse);
      }
    } else {
      a.grain = Math.max(0, a.grain - grainUse);
      if (a.grain === 0 && a.troops > 0) {
        const starve = Math.max(40, Math.round(a.troops * 0.14));
        a.troops = Math.max(0, a.troops - starve);
        a.morale = clamp(a.morale - 14, 10, 100);
        if (a.faction === next.player || a.targetCity && next.cities[a.targetCity]?.owner === next.player) {
          const offName = (a.officer && next.officers[a.officer]?.name) || a.escortName || "孤军";
          events.push({
            turn: next.turn,
            kind: "supply_cut",
            faction: a.faction,
            pos: armyWorldPosition(world, a),
            text: `⚡ 粮道断绝！${offName}部缺粮逃散 ${starve.toLocaleString()} 人、士气骤跌！`,
          });
        }
      }
    }

    if (a.troops <= 0) {
      releaseArmyOfficers(next, a, null);
      continue;
    }

    if ((a.delayDekads || 0) > 0) {
      a.delayDekads -= 1;
      continue;
    }

    if (a.stance !== "besiege" && a.stance !== "engaged" && a.reorgDekads === 0) {
      const req = edgeDekadsRequired(world, a.from, a.to, a.troopType, next.weather, a.officer ? next.officers[a.officer] : null, a.formation || "heyi");
      a.edgeDekads = req;
      a.progress = Math.min(1, a.progress + 1 / req);
    }
    resolveFortsOnMove(world, next, a, events);
    if (a.troops <= 0) {
      releaseArmyOfficers(next, a, null);
    }
  }

  // 2. Open-road opposing army field encounters
  const processedPairs = new Set();
  const activeField = next.armies.filter((a) => a.troops > 0 && a.stance !== "besiege" && a.reorgDekads === 0);
  for (let i = 0; i < activeField.length; i += 1) {
    const a = activeField[i];
    if (a.troops <= 0) continue;
    const edgeA = [a.from, a.to].sort().join(":");
    for (let j = i + 1; j < activeField.length; j += 1) {
      const b = activeField[j];
      if (b.troops <= 0 || !isHostileV2(next, a.faction, b.faction)) continue;
      const edgeB = [b.from, b.to].sort().join(":");
      if (edgeA !== edgeB) continue;
      const pairId = [a.id, b.id].sort().join("|");
      if (processedPairs.has(pairId)) continue;

      const opposing = a.from === b.to && a.to === b.from;
      const directlyLocked = a.engagedWith === b.id || b.engagedWith === a.id;
      const clash = directlyLocked || (opposing ? (a.progress + b.progress >= 0.9) : (Math.abs(a.progress - b.progress) <= 0.25));
      if (clash) {
        processedPairs.add(pairId);
        resolveFieldBattle(world, next, a, b, events);
      }
    }
  }
  for (const a of next.armies) {
    if (a.stance === "engaged") {
      const partner = next.armies.find((x) => x.id === a.engagedWith && x.troops > 0 && x.stance === "engaged");
      if (!partner || a.troops <= 0) {
        a.stance = canTransitCity(next, a.faction, a.targetCity) ? "reinforce" : "attack";
        a.engagedWith = null;
        a.engageRounds = 0;
      }
    }
  }

  // 3. Process road segment advances and city arrivals (siege/relief/trap/garrison)
  for (const a of next.armies) {
    if (a.troops <= 0 || a.stance === "besiege" || a.stance === "engaged" || a.progress < 1) continue;

    // Reached `a.to` node
    const arrivedNode = a.to;
    if (a.step < a.route.length - 2) {
      // Check if an unallied hostile city unexpectedly blocks multi-hop transit mid-way
      if (!canTransitCity(next, a.faction, arrivedNode)) {
        a.targetCity = arrivedNode;
      } else {
        a.step += 1;
        a.from = a.route[a.step];
        a.to = a.route[a.step + 1];
        a.progress = 0.05;
        continue;
      }
    }

    // Final destination reached!
    const dest = next.cities[arrivedNode];
    if (!dest) continue;

    if (a.stance === "retreat" && !canTransitCity(next, a.faction, arrivedNode)) {
      releaseArmyOfficers(next, a, null);
      a.troops = 0;
      continue;
    }

    if (canTransitCity(next, a.faction, arrivedNode) && (a.stance === "reinforce" || a.stance === "retreat")) {
      // If city is under siege by an enemy -> immediate Relief Field Battle outside the gate!
      const siege = next.sieges[arrivedNode];
      if (siege && dest.owner === a.faction) {
        const besiegers = siege.attackerArmyIds
          .map((id) => next.armies.find((x) => x.id === id))
          .filter((x) => x && x.troops > 0);
        if (besiegers.length) {
          const aidName = (a.officer && next.officers[a.officer]?.name) || a.escortName || "援军";
          events.push({
            turn: next.turn,
            kind: "relief",
            faction: a.faction,
            city: arrivedNode,
            pos: cityByKey(world, arrivedNode)?.position,
            text: `🎺 援军疾至！${aidName}杀抵${cityNameV2(world, arrivedNode)}外围，直扑围城敌营！`,
          });
          resolveFieldBattle(world, next, a, besiegers[0], events, { allowEngage: false });
        }
      }
      if (a.troops > 0 && dest.owner === a.faction) {
        dest.troops += a.troops;
        const off = a.officer ? next.officers[a.officer] : null;
        releaseArmyOfficers(next, a, arrivedNode);
        if (off && !dest.commander) dest.commander = off.key;
        if (a.faction === next.player) {
          const aidName = off?.name || a.escortName || "援师";
          events.push({
            turn: next.turn,
            kind: "reinforce",
            faction: a.faction,
            city: arrivedNode,
            pos: cityByKey(world, arrivedNode)?.position,
            text: `${aidName}率 ${a.troops.toLocaleString()} 人顺利进驻「${cityNameV2(world, arrivedNode)}」。`,
          });
        }
        a.troops = 0;
      } else if (a.troops > 0 && dest.owner !== a.faction) {
        // Allied destination merge or redirect back
        releaseArmyOfficers(next, a, null);
        a.troops = 0;
      }
      continue;
    }

    // Hostile arrival at target city!
    if (isHostileV2(next, a.faction, dest.owner)) {
      handleTrapOnArrival(world, next, arrivedNode, a, events);
      if (a.troops < 140) {
        a.troops = 0;
        attemptCaptureOrReturn(next, a.officer, dest.owner, arrivedNode, 0.15, events);
        if (a.deputy) attemptCaptureOrReturn(next, a.deputy, dest.owner, arrivedNode, 0.12, events);
        continue;
      }

      // Immediate sally clash if defender opted for出城突击 and has troops
      if (dest.siegeDefense === "sally" && dest.troops >= 600) {
        const sallyDummy = {
          id: "garrison-sally",
          faction: dest.owner,
          officer: dest.commander,
          troops: Math.round(dest.troops * 0.6),
          troopType: dest.troopType,
          morale: dest.morale,
          from: a.from,
          to: arrivedNode,
          progress: 1,
          supplyCut: false,
          stance: "hold",
        };
        const offAtt = a.officer ? next.officers[a.officer] : null;
        const offDef = dest.commander ? next.officers[dest.commander] : null;
        const counter = troopCounterEffect(a.troopType, dest.troopType, "plain", next.weather);
        const attP = a.troops * counter.mult * officerPowerMult(next, offAtt, false, false, "plain");
        const defP = sallyDummy.troops * officerPowerMult(next, offDef, false, true, "plain") * 1.18;
        const attLoss = clamp(Math.round(a.troops * 0.16 * (defP / Math.max(200, attP))), 35, Math.round(a.troops * 0.45));
        const defLoss = clamp(Math.round(sallyDummy.troops * 0.18 * (attP / Math.max(200, defP))), 30, Math.round(dest.troops * 0.4));
        a.troops = Math.max(0, a.troops - attLoss);
        dest.troops = Math.max(0, dest.troops - defLoss);
        events.push({
          turn: next.turn,
          kind: "field_battle",
          faction: a.faction,
          participants: [a.faction, dest.owner],
          city: arrivedNode,
          pos: cityByKey(world, arrivedNode)?.position,
          text: `⚔️ ${cityNameV2(world, arrivedNode)}守军「出城迎击」！城外野战双方各折 ${attLoss.toLocaleString()} / ${defLoss.toLocaleString()}。`,
        });
        if (a.troops < 140) {
          a.troops = 0;
          releaseArmyOfficers(next, a, null);
          continue;
        }
      }

      // Empty/undefended city with low wall falls immediately; fortified cities ALWAYS enter multi-turn siege!
      if (dest.troops <= 120 && dest.wall <= 80) {
        transferCityOwnership(world, next, arrivedNode, a.faction, [a], events);
      } else {
        a.stance = "besiege";
        a.from = a.route[Math.max(0, a.route.length - 2)] || a.from;
        a.to = arrivedNode;
        a.targetCity = arrivedNode;
        a.progress = 1;
        const siege = next.sieges[arrivedNode] ??= {
          city: arrivedNode,
          attackerFaction: a.faction,
          startedTurn: next.turn,
          attackerArmyIds: [],
          fireRaidUsed: false,
        };
        if (!siege.attackerArmyIds.includes(a.id)) siege.attackerArmyIds.push(a.id);
        const leadName = (a.officer && next.officers[a.officer]?.name) || a.escortName || "大军";
        events.push({
          turn: next.turn,
          kind: "siege_start",
          faction: a.faction,
          participants: [a.faction, dest.owner],
          city: arrivedNode,
          pos: cityByKey(world, arrivedNode)?.position,
          text: `🔥 兵临城下！${leadName}率 ${a.troops.toLocaleString()} 人合围「${cityNameV2(world, arrivedNode)}」！`,
        });
      }
    }
  }

  // 4. Resolve ongoing multi-turn sieges
  resolveSieges(world, next, events);

  // Clean up disbanded/zero-troop armies
  next.armies = next.armies.filter((a) => a.troops > 0);
  for (const off of Object.values(next.officers)) {
    if (off.armyId && !next.armies.some((a) => a.id === off.armyId)) {
      returnOfficerHome(next, off.key, null);
    }
    if (off.injuredDekads > 0) off.injuredDekads -= 1;
  }

  if (events.some((e) => e.kind === "capture")) {
    recordHistorySnapshot(world, next);
  }

  // 5. Monthly governance, auto-governance, logistics links, hero spawns, coalition & Three Kingdoms climax (every 3 dekads)
  if (next.turn % 3 === 0) {
    next.dismissedCabinetIds = [];
    applyMonthlyGovernance(world, next, events);
    next = runAutoGovernanceMonthly(world, next, events, { dispatchEmergencyReinforce, resolveCaptive });
    runRegionalGovernorsMonthly(world, next, events);
    processSupplyLinksMonthly(world, next, events);
    spawnWanderingHeroes(world, next, events);
    updateAntiHegemonCoalition(world, next, events);
    checkThreeKingdomsClimax(world, next, events);
    refreshCabinetInbox(world, next);
    recordHistorySnapshot(world, next);
    if (!skipAi) {
      maybeTriggerEvent(world, next, events);
    }
  }

  // 6. Quarterly season/weather & treaty expiration tick (every 9 dekads)
  if (next.turn % DEKADS_PER_SEASON === 0) {
    const cal = formatCalendar(next.year, next.turn);
    next.weather = chooseSeasonalWeather(cal.seasonKey, next.turn);
    next.treaties = next.treaties.filter((t) => t.expires > next.turn);
    for (const c of Object.values(next.cities)) {
      if (c.trap && c.trap.expiresTurn <= next.turn) c.trap = null;
    }
    events.push({
      turn: next.turn,
      kind: "weather",
      text: `${cal.seasonName}季来临，天时转为「${next.weather.icon} ${next.weather.name}」— ${next.weather.summary}`,
    });
  }

  checkOutcome(next);
  next.lastTurnEvents = events;
  next.events = [...next.events, ...events].slice(-80);
  return next;
}

export function armyEtaDekads(world, state, army) {
  if (!army || army.stance === "besiege") return 0;
  let rem = (army.delayDekads || 0) + Math.max(1, Math.ceil((1 - (army.progress ?? 0)) * (army.edgeDekads || 2)));
  const off = army.officer ? state?.officers?.[army.officer] : null;
  for (let i = (army.step ?? 0) + 1; i < (army.route?.length ?? 0) - 1; i += 1) {
    rem += edgeDekadsRequired(world, army.route[i], army.route[i + 1], army.troopType, state?.weather, off, army.formation || "heyi");
  }
  return rem;
}

export function computeThreats(world, state) {
  const threats = [];
  // Active incoming hostile armies targeting player cities
  for (const a of state.armies || []) {
    if (a.troops <= 0 || !isHostileV2(state, state.player, a.faction)) continue;
    if (a.stance !== "attack" && a.stance !== "besiege") continue;
    const tCity = state.cities[a.targetCity];
    if (!tCity || tCity.owner !== state.player) continue;
    threats.push({
      kind: a.stance === "besiege" ? "siege" : "marching",
      armyId: a.id,
      from: a.from,
      to: a.targetCity,
      enemyFaction: a.faction,
      officerName: (a.officer && state.officers[a.officer]?.name) || a.escortName || "敌将",
      troops: a.troops,
      troopType: a.troopType,
      etaDekads: a.stance === "besiege" ? 0 : Math.max(1, Math.round((1 - a.progress) * (a.edgeDekads || 2)) + Math.max(0, (a.route.length - 2 - a.step) * 2)),
    });
  }
  // Border disparities
  for (const c of Object.values(state.cities)) {
    if (c.owner !== state.player) continue;
    const links = cityByKey(world, c.key)?.links || [];
    for (const nb of links) {
      const enemy = state.cities[nb];
      if (!enemy || !isHostileV2(state, state.player, enemy.owner)) continue;
      if (enemy.troops >= Math.max(1850, c.troops * 1.45)) {
        threats.push({
          kind: "border",
          from: nb,
          to: c.key,
          enemyFaction: enemy.owner,
          troops: enemy.troops,
          troopType: enemy.troopType,
          etaDekads: 3,
        });
      }
    }
  }
  return threats.sort((a, b) => {
    const rank = { siege: 0, marching: 1, border: 2 };
    return (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3) || b.troops - a.troops;
  });
}

export function factionSummary(state, factionKey = state.player) {
  let cityCount = 0;
  let garrisonTroops = 0;
  for (const c of Object.values(state.cities)) {
    if (c.owner === factionKey) {
      cityCount += 1;
      garrisonTroops += c.troops;
    }
  }
  let fieldTroops = 0;
  let armyCount = 0;
  for (const a of state.armies || []) {
    if (a.faction === factionKey && a.troops > 0) {
      fieldTroops += a.troops;
      armyCount += 1;
    }
  }
  const fac = state.factions[factionKey] || { treasury: 0, grain: 0, morale: 0 };
  return {
    cityCount,
    garrisonTroops,
    fieldTroops,
    totalTroops: garrisonTroops + fieldTroops,
    armyCount,
    treasury: fac.treasury,
    grain: fac.grain,
    morale: fac.morale,
  };
}

export function serializeStateV2(state) {
  return JSON.stringify(state);
}

export function deserializeStateV2(world, raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || parsed.version !== V2_VERSION || !parsed.cities || !parsed.factions || !parsed.officers) {
    throw new Error("存档不是有效的经略三国 2.0 战局文件。");
  }
  if (Object.keys(parsed.cities).length !== world.cities.length) {
    throw new Error("存档城池数目与舆图不一致。");
  }
  if (!parsed.factions[parsed.player]) {
    throw new Error("存档玩家势力无效。");
  }
  const restored = ensurePhase2State(parsed);
  for (const ck of Object.keys(restored.cities || {})) {
    if (!restored.cities[ck].region) {
      restored.cities[ck].region = cityByKey(world, ck)?.region || "中原与淮北";
    }
  }
  return restored;
}
