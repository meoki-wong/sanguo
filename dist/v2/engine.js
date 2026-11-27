// 经略三国 2.0 — 核心大战略仿真引擎
// 特性：旬制双轨节奏 / 地图在途军团行军与野战截击 / 跨回合多阶段围城战 / 补给线切断 / 5兵种地形天气相克 / 动态忠义与称号觉醒

import {
  AWAKENED_TITLES, CITY_POLICIES, CITY_SPECIALTIES, DEFENSE_TRAPS, DEKADS_PER_SEASON, DIFFICULTY_MODES,
  FACTION_PREFERRED_TROOP, REGIONAL_DEFAULT_TROOP, SEASON_KEYS, SIEGE_DEFENSE_MODES,
  SIEGE_STANCES, TROOP_TYPES, WEATHER_CATALOG, citySpecialtyV2, edgeKey, formatCalendar,
  roadTerrain, troopCounterEffect,
} from "./constants.js";
import { officerMeta } from "../traits.js";
import {
  ensurePhase2State, evaluateBondBonus, planAiPhase2Dekad, resolveFortsOnMove,
} from "./systems.js";
export {
  buildFort, canBuildFort, castStratagem, cityBonds, demolishFort, ensurePhase2State,
  evaluateDeal, fortOnEdge, bribeDefection, proposeDeal, repairFort, sowDiscord,
  stratagemCooldownLeft,
} from "./systems.js";

export const V2_VERSION = 2;
export const MIN_DISPATCH_TROOPS = 300;
export const MIN_GARRISON_LEAVE = 300;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function hashStr(str = "") {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function eraByYearV2(world, year) {
  return world.scenarios.find((s) => s.year === year) || world.scenarios[0];
}

export function cityByKey(world, key) {
  return world.cities.find((c) => c.key === key) || null;
}

export function cityNameV2(world, key) {
  return cityByKey(world, key)?.name || key;
}

export function factionNameV2(world, state, key) {
  return state.factions[key]?.name || eraByYearV2(world, state.year)?.factions.find((f) => f.key === key)?.name || key;
}

export function edgeDistance(world, aKey, bKey) {
  const a = cityByKey(world, aKey);
  const b = cityByKey(world, bKey);
  if (!a || !b) return 55;
  return Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
}

export function activeTreaty(state, f1, f2) {
  if (!f1 || !f2 || f1 === f2) return null;
  return (state.treaties || []).find(
    (t) => t.expires > state.turn && t.sides.includes(f1) && t.sides.includes(f2),
  ) || null;
}

export function isHostileV2(state, f1, f2) {
  return Boolean(f1 && f2 && f1 !== f2 && !activeTreaty(state, f1, f2));
}

export function canTransitCity(state, faction, cityKey) {
  const city = state.cities[cityKey];
  if (!city) return false;
  if (city.owner === faction) return true;
  const treaty = activeTreaty(state, faction, city.owner);
  return treaty?.kind === "alliance";
}

/**
 * 寻找城际道路路径（允许经己方/盟友城池通行；若 allowEnemyEnd=true，终点可为任意敌城）
 */
export function findRoadPath(world, state, faction, fromKey, toKey, { allowEnemyEnd = true, maxHops = 8 } = {}) {
  if (!fromKey || !toKey || fromKey === toKey) return null;
  const targetCity = state.cities[toKey];
  if (!targetCity) return null;
  if (!allowEnemyEnd && !canTransitCity(state, faction, toKey)) return null;
  if (!canTransitCity(state, faction, fromKey)) return null;

  const adj = new Map(world.cities.map((c) => [c.key, c.links]));
  const bestCost = new Map([[fromKey, 0]]);
  const prev = new Map();
  const queue = [{ key: fromKey, cost: 0, hops: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    if (cur.key === toKey) break;
    if (cur.hops >= maxHops) continue;
    for (const nb of adj.get(cur.key) || []) {
      const isDest = nb === toKey;
      if (!isDest && !canTransitCity(state, faction, nb)) continue;
      if (isDest && !allowEnemyEnd && !canTransitCity(state, faction, nb)) continue;
      // Avoid walking straight through a non-destination enemy city or neutral city without alliance
      if (isDest && state.cities[nb].owner !== faction) {
        const tr = activeTreaty(state, faction, state.cities[nb].owner);
        if (tr?.kind === "truce" && !allowEnemyEnd) continue;
      }
      const nextCost = cur.cost + edgeDistance(world, cur.key, nb);
      if (nextCost < (bestCost.get(nb) ?? Infinity)) {
        bestCost.set(nb, nextCost);
        prev.set(nb, cur.key);
        queue.push({ key: nb, cost: nextCost, hops: cur.hops + 1 });
      }
    }
  }

  if (!prev.has(toKey)) return null;
  const path = [toKey];
  let step = toKey;
  while (step !== fromKey) {
    step = prev.get(step);
    if (!step) return null;
    path.unshift(step);
  }
  return path;
}

export function edgeDekadsRequired(world, fromKey, toKey, troopType = "infantry", weather = null, officer = null) {
  const dist = edgeDistance(world, fromKey, toKey);
  const typeDef = TROOP_TYPES[troopType] || TROOP_TYPES.infantry;
  const terrain = roadTerrain(fromKey, toKey);
  let speed = typeDef.speed;
  if (troopType === "navy") speed = terrain === "river" ? typeDef.riverSpeed : 0.9;
  if (terrain === "river" && troopType !== "navy") speed *= 0.85;
  if (terrain === "pass" && troopType === "cavalry") speed *= 0.82;
  const hasLogistics = officer?.traits?.includes("logistics");
  const wMarch = weather?.marchMult ?? 1;
  if (hasLogistics && wMarch < 1) speed *= 1.05;
  else speed *= wMarch;
  const raw = Math.round(dist / 28 / Math.max(0.55, speed));
  return clamp(raw, 2, 5);
}

export function computeMarchDekads(world, route, troopType = "infantry", weather = null, officer = null) {
  if (!route || route.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    total += edgeDekadsRequired(world, route[i], route[i + 1], troopType, weather, officer);
  }
  return total;
}

export function armyWorldPosition(world, army) {
  if (army.stance === "besiege") {
    const pos = cityByKey(world, army.targetCity || army.to)?.position || [390, 250];
    // Deterministic slight siege offset outside wall ring so army & city stay distinct
    const seed = hashStr(army.id || army.officer || "");
    const ang = ((seed % 360) * Math.PI) / 180;
    return [pos[0] + Math.cos(ang) * 14, pos[1] + Math.sin(ang) * 14];
  }
  const a = cityByKey(world, army.from)?.position;
  const b = cityByKey(world, army.to)?.position;
  if (!a || !b) return a || b || [390, 250];
  const t = clamp(army.progress ?? 0, 0, 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function checkSupplyLine(world, state, army) {
  // Hostile army sitting on army's current road segment behind army cuts supply immediately
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

  // Forward depot fort on army's current edge sustains supply directly
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

  // Check if a besieged friendly city on the supply route breaks supply
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
    if (raw.reserve) continue; // Keep active starting roster clean
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

  // Assign initial governors & commanders cleanly across owned cities
  for (const [factionKey, cityKeys] of Object.entries(ownedByFaction)) {
    const pool = (officersByFaction[factionKey] || []).slice();
    // Appoint best commanders to frontline border cities first
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

  return {
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
    treaties: [],
    captives: [],
    events: [{ turn: 0, kind: "system", text: `建元伊始：${era.title}剧本开启，我方执掌「${factions[player].name}」。每回合以「一旬」推进战局，大军沿官道实景行军与跨旬围城。` }],
    lastTurnEvents: [],
    outcome: "ongoing",
  };
}

export function availableOfficersInCity(state, cityKey, faction = null) {
  const city = state.cities[cityKey];
  if (!city) return [];
  const f = faction || city.owner;
  return Object.values(state.officers).filter(
    (o) => o.faction === f && o.city === cityKey && !o.armyId && !o.capturedBy && o.injuredDekads <= 0,
  ).sort((a, b) => (b.command + b.might * 0.4) - (a.command + a.might * 0.4));
}

export function forecastDispatch(world, state, { from, to, troops, troopType, officer }) {
  const fromCity = state.cities[from];
  const toCity = state.cities[to];
  if (!fromCity || !toCity) return { ok: false, reason: "请选择有效的出发城池与目标城池。" };
  const faction = fromCity.owner;
  const route = findRoadPath(world, state, faction, from, to, { allowEnemyEnd: true });
  if (!route) return { ok: false, reason: "两城之间暂无我方/盟友可通行的道路。" };
  const isFriendlyDest = canTransitCity(state, faction, to);
  if (!isFriendlyDest && activeTreaty(state, faction, toCity.owner)) {
    return { ok: false, reason: "与目标势力尚在停战/同盟期内，不可进攻。" };
  }
  const type = troopType || fromCity.troopType || "infantry";
  const offObj = typeof officer === "string" ? state.officers[officer] : officer;
  const dekads = computeMarchDekads(world, route, type, state.weather, offObj);
  const grainCost = Math.max(4, Math.ceil((troops || MIN_DISPATCH_TROOPS) / 220) * 2);
  const terrain = roadTerrain(route[route.length - 2], to);
  const counter = isFriendlyDest
    ? { mult: 1, label: "增援己方", relation: "neutral" }
    : troopCounterEffect(type, toCity.troopType, terrain, state.weather);

  return {
    ok: true,
    route,
    dekads,
    grainCost,
    terrain,
    counter,
    isFriendlyDest,
    targetWall: toCity.wall,
    targetTroops: toCity.troops,
    targetTroopType: toCity.troopType,
  };
}

export function createArmyRecord(world, state, {
  faction, from, route, officerKey, troops, troopType, stance, siegeStance = "storm",
}) {
  const id = `army-${state.nextArmySeq++}`;
  const to = route[1];
  const reqDekads = edgeDekadsRequired(world, from, to, troopType, state.weather, state.officers[officerKey]);
  const army = {
    id,
    faction,
    officer: officerKey,
    troops,
    maxTroops: troops,
    troopType,
    morale: clamp(state.factions[faction]?.morale ?? 80, 50, 100),
    grain: Math.max(8, Math.ceil(troops / 180) * 3),
    route,
    step: 0,
    from,
    to,
    targetCity: route[route.length - 1],
    depot: from,
    progress: 0.08,
    edgeDekads: reqDekads,
    stance, // "attack" | "reinforce" | "besiege" | "retreat"
    siegeStance,
    supplyCut: false,
    reorgDekads: 0,
    fireRaidHit: false,
    lastPos: cityByKey(world, from)?.position || [390, 250],
  };
  return army;
}

export function dispatchArmy(world, state, { from, to, officer, troops, troopType, stance, siegeStance = "storm" }) {
  const next = structuredClone(state);
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
  const amount = Math.floor(Number(troops));
  if (!Number.isFinite(amount) || amount < MIN_DISPATCH_TROOPS) {
    throw new Error(`出征兵力至少需 ${MIN_DISPATCH_TROOPS} 人。`);
  }
  if (fromCity.troops - amount < MIN_GARRISON_LEAVE) {
    throw new Error(`出发城须至少留守 ${MIN_GARRISON_LEAVE} 名守军。`);
  }
  const resolvedType = TROOP_TYPES[troopType] ? troopType : fromCity.troopType;
  const fc = forecastDispatch(world, next, { from, to, troops: amount, troopType: resolvedType, officer: offObj });
  if (!fc.ok) throw new Error(fc.reason);
  if (next.factions[faction].grain < fc.grainCost) {
    throw new Error(`军粮不足，出征需准备 ${fc.grainCost} 石随军粮草。`);
  }

  const finalStance = stance || (fc.isFriendlyDest ? "reinforce" : "attack");
  fromCity.troops -= amount;
  if (fromCity.commander === offObj.key) fromCity.commander = null;
  if (fromCity.governor === offObj.key) fromCity.governor = null;
  offObj.city = null;
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
    troops: amount,
    troopType: resolvedType,
    stance: finalStance,
    siegeStance: SIEGE_STANCES[siegeStance] ? siegeStance : "storm",
  });
  army.specialtyTag = specTag;
  offObj.armyId = army.id;
  next.armies.push(army);

  const verb = finalStance === "reinforce" ? "星夜驰援" : "挥师出征";
  const text = `${offObj.name}率 ${amount.toLocaleString()} ${TROOP_TYPES[resolvedType].name}自${cityNameV2(world, from)}${verb}${cityNameV2(world, to)}（预计 ${fc.dekads} 旬抵达）。`;
  const ev = { turn: next.turn, kind: "dispatch", faction, city: to, pos: cityByKey(world, from).position, text };
  next.events = [...next.events, ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function redirectArmy(world, state, armyId, { targetCity, stance, siegeStance }) {
  const next = structuredClone(state);
  const army = next.armies.find((a) => a.id === armyId);
  if (!army) throw new Error("未找到对应在途军团。");
  if (army.faction !== next.player) throw new Error("不可干预敌国军团军令。");

  if (siegeStance && SIEGE_STANCES[siegeStance]) {
    army.siegeStance = siegeStance;
  }

  if (stance === "retreat") {
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
    army.route = newRoute;
    army.step = 0;
    army.from = newRoute[0];
    army.to = newRoute[1];
    army.targetCity = targetCity;
    army.stance = isFriendly ? "reinforce" : "attack";
    army.progress = 0.1;
    army.edgeDekads = edgeDekadsRequired(world, army.from, army.to, army.troopType, next.weather, next.officers[army.officer]);
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
  if (!off || off.faction !== next.player || off.armyId || off.capturedBy) {
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

export function returnOfficerHome(state, offKey, preferredCityKey) {
  const off = state.officers[offKey];
  if (!off) return;
  off.armyId = null;
  if (preferredCityKey && state.cities[preferredCityKey]?.owner === off.faction) {
    off.city = preferredCityKey;
    return;
  }
  const fallback = Object.values(state.cities).find((c) => c.owner === off.faction);
  off.city = fallback?.key || null;
}

function attemptCaptureOrReturn(state, offKey, victorFaction, cityKey, bonusProb = 0, events = []) {
  const off = state.officers[offKey];
  if (!off) return;
  const fallCities = Object.values(state.cities).filter((c) => c.owner === off.faction);
  const prob = clamp(0.14 + bonusProb + (fallCities.length === 0 ? 0.35 : 0), 0.1, 0.75);
  const roll = ((hashStr(`${state.turn}:${offKey}:${victorFaction}`) % 100) / 100);
  if (victorFaction === state.player && roll < prob && off.name !== state.factions[off.faction]?.name) {
    off.armyId = null;
    off.city = null;
    off.capturedBy = victorFaction;
    state.captives.push({ officer: offKey, origFaction: off.faction, turn: state.turn, city: cityKey });
    events.push({ turn: state.turn, kind: "officer", city: cityKey, text: `阵前生擒敌将「${off.name}」！可在「朝堂」处置劝降。` });
    return;
  }
  returnOfficerHome(state, offKey, fallCities[0]?.key || null);
}

function resolveFieldBattle(world, state, a, b, events) {
  const terrain = roadTerrain(a.from, a.to);
  const offA = state.officers[a.officer];
  const offB = state.officers[b.officer];
  const cAB = troopCounterEffect(a.troopType, b.troopType, terrain, state.weather);
  const cBA = troopCounterEffect(b.troopType, a.troopType, terrain, state.weather);

  const alliesA = state.armies.filter((x) => x.faction === a.faction && x.id !== a.id && x.troops > 0).map((x) => x.officer);
  const alliesB = state.armies.filter((x) => x.faction === b.faction && x.id !== b.id && x.troops > 0).map((x) => x.officer);
  const bondA = evaluateBondBonus(state, a.officer, alliesA, [b.officer]);
  const bondB = evaluateBondBonus(state, b.officer, alliesB, [a.officer]);
  const fort = state.forts?.[edgeKey(a.from, a.to)];
  const wfMultA = fort?.kind === "water_fort" && fort.faction === a.faction && a.troopType === "navy" ? 1.18 : 1;
  const wfMultB = fort?.kind === "water_fort" && fort.faction === b.faction && b.troopType === "navy" ? 1.18 : 1;
  const specMultA = (a.specialtyTag === "horse" && a.troopType === "cavalry") || (a.specialtyTag === "shipyard" && a.troopType === "navy") ? 1.12 : 1;
  const specMultB = (b.specialtyTag === "horse" && b.troopType === "cavalry") || (b.specialtyTag === "shipyard" && b.troopType === "navy") ? 1.12 : 1;

  const powA = a.troops * cAB.mult * officerPowerMult(state, offA, false, false, terrain)
    * bondA.atkMult * wfMultA * specMultA
    * (0.72 + a.morale * 0.004) * (a.supplyCut ? 0.72 : 1)
    * (a.troopType === "siege" ? 0.82 : 1)
    * (a.faction !== state.player ? DIFFICULTY_MODES[state.difficulty || "standard"].aiAtkMult : 1);
  const powB = b.troops * cBA.mult * officerPowerMult(state, offB, false, false, terrain)
    * bondB.atkMult * wfMultB * specMultB
    * (0.72 + b.morale * 0.004) * (b.supplyCut ? 0.72 : 1)
    * (b.troopType === "siege" ? 0.82 : 1)
    * (b.faction !== state.player ? DIFFICULTY_MODES[state.difficulty || "standard"].aiAtkMult : 1);

  const ratioAB = powA / Math.max(1, powB);
  const aWins = powA >= powB;
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;
  const winBond = aWins ? bondA : bondB;
  const loseBond = aWins ? bondB : bondA;
  const winPow = aWins ? powA : powB;
  const losePow = aWins ? powB : powA;
  const dom = clamp(winPow / Math.max(1, losePow), 1, 3.2);

  const rawWinLoss = Math.round(winner.troops * (0.12 + 0.14 / dom) * (TROOP_TYPES[winner.troopType]?.lossMult ?? 1) * winBond.lossMult);
  const rawLoseLoss = Math.round(loser.troops * clamp(0.24 * dom, 0.24, 0.65) * (TROOP_TYPES[loser.troopType]?.lossMult ?? 1) * loseBond.lossMult);

  const winLoss = clamp(rawWinLoss, 25, Math.max(25, winner.troops - 120));
  const loseLoss = clamp(rawLoseLoss, 40, loser.troops);

  winner.troops -= winLoss;
  loser.troops -= loseLoss;
  winner.morale = clamp(winner.morale + 7, 20, 100);
  loser.morale = clamp(loser.morale - 18, 10, 100);
  winner.reorgDekads = 1;
  loser.reorgDekads = 1;

  // Push loser back toward their starting city to prevent infinite same-edge loops
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

  const posA = armyWorldPosition(world, a);
  const posB = armyWorldPosition(world, b);
  const pos = [(posA[0] + posB[0]) / 2, (posA[1] + posB[1]) / 2];

  const winOff = state.officers[winner.officer];
  const loseOff = state.officers[loser.officer];
  awardMerit(state, winner.officer, { merit: 35, win: true }, events);

  const counterHint = cAB.relation === "counter" ? `（${cAB.label}）`
    : cBA.relation === "counter" ? `（${cBA.label}）` : "";

  events.push({
    turn: state.turn,
    kind: "field_battle",
    faction: winner.faction,
    participants: [a.faction, b.faction],
    pos,
    city: a.to,
    winnerLoss: winLoss,
    loserLoss: loseLoss,
    shattered: loser.troops < 180,
    text: `野战交锋！${winOff?.name || "胜军"}击败${loseOff?.name || "敌军"}${counterHint}，毙敌 ${loseLoss.toLocaleString()}、自损 ${winLoss.toLocaleString()}。`,
  });

  if (loser.troops < 180) {
    loser.troops = 0;
    attemptCaptureOrReturn(state, loser.officer, winner.faction, loser.to, 0.12, events);
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
  if (trap.id === "fire_pit") {
    const wFire = state.weather?.fireMult ?? 1;
    const dmg = Math.max(80, Math.round(army.troops * trap.troopDmgPct * wFire));
    army.troops = Math.max(0, army.troops - dmg);
    army.morale = clamp(army.morale - trap.moraleDmg, 10, 100);
    events.push({ turn: state.turn, kind: "trap", faction: city.owner, participants: [city.owner, army.faction], city: cityKey, pos, dmg, text: `🔥 ${cityNameV2(world, cityKey)}「火油陷坑」烈焰轰鸣！焚毁${state.officers[army.officer]?.name || "敌"}先头部队 ${dmg.toLocaleString()} 人！` });
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

  // Garrison remaining troops from lead victorious army
  const sorted = besiegerArmies.slice().sort((a, b) => b.troops - a.troops);
  const lead = sorted[0];
  let totalAdded = 0;
  for (const a of sorted) {
    if (a.faction !== winnerFaction || a.troops <= 0) continue;
    totalAdded += a.troops;
    const off = state.officers[a.officer];
    if (off) {
      off.armyId = null;
      off.city = cityKey;
      awardMerit(state, a.officer, { merit: 60, win: true, capture: a === lead }, events);
    }
    a.troops = 0;
  }
  if (lead && state.officers[lead.officer]?.faction === winnerFaction) {
    city.commander = lead.officer;
  }
  city.troops = Math.max(350, city.troops + totalAdded);
  delete state.sieges[cityKey];

  for (const defOff of [oldCmd, oldGov]) {
    if (defOff && state.officers[defOff]) {
      attemptCaptureOrReturn(state, defOff, winnerFaction, cityKey, lead?.ambushHitBonus ?? 0, events);
    }
  }
  // Relocate any remaining idle officers from prevOwner in that city
  for (const o of Object.values(state.officers)) {
    if (o.city === cityKey && o.faction === prevOwner && !o.armyId && !o.capturedBy) {
      returnOfficerHome(state, o.key, null);
    }
  }

  const pos = cityByKey(world, cityKey)?.position || [390, 250];
  events.push({
    turn: state.turn,
    kind: "capture",
    faction: winnerFaction,
    participants: [winnerFaction, prevOwner],
    city: cityKey,
    pos,
    text: `🚩 攻克名城！${factionNameV2(world, state, winnerFaction)}挥师夺取「${cityNameV2(world, cityKey)}」（原属${factionNameV2(world, state, prevOwner)}）！`,
  });
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
      const st = SIEGE_STANCES[a.siegeStance] || SIEGE_STANCES.storm;
      const share = a.troops / Math.max(1, totalAttTroops);
      const tSpec = TROOP_TYPES[a.troopType] || TROOP_TYPES.infantry;
      const offObj = state.officers[a.officer];
      const attBond = evaluateBondBonus(state, a.officer, attackers.map((x) => x.officer), [city.commander, city.governor].filter(Boolean));
      const counter = troopCounterEffect(a.troopType, city.troopType, "plain", state.weather);
      const arsenalBonus = a.specialtyTag === "arsenal" && a.troopType === "siege" ? 1.15 : 1;
      const pow = a.troops * counter.mult * officerPowerMult(state, offObj, true, false, "plain")
        * attBond.atkMult * (0.72 + a.morale * 0.0038) * (a.supplyCut ? 0.72 : 1) * encircleBonus
        * (a.faction !== state.player ? DIFFICULTY_MODES[state.difficulty || "standard"].aiAtkMult : 1);

      weightedAttPow += pow;
      avgWallDmgMult += st.wallDmgMult * share * tSpec.siegeMult * arsenalBonus;
      maxFoodDrain = Math.max(maxFoodDrain, st.foodDrain);
      avgAttLossMult += st.attLossMult * share * attBond.lossMult;
      avgDefLossMult += st.defLossMult * share;
      avgMoraleDrain += st.moraleDrain * share;
      if (a.troopType === "siege") siegeEngineFactor = Math.max(siegeEngineFactor, 1.35);
    }

    const defBond = city.commander
      ? evaluateBondBonus(state, city.commander, [city.governor].filter(Boolean), attackers.map((x) => x.officer))
      : { defMult: 1, lossMult: 1 };
    const wallRatioBonus = 1 + (city.wall / Math.max(1, city.wallMax)) * 0.45 + (TROOP_TYPES[city.troopType]?.wallDefBonus ?? 0);
    const defPow = Math.max(200, city.troops * wallRatioBonus * officerPowerMult(state, defCmd, false, true, "plain") * defBond.defMult * (0.72 + city.morale * 0.0035));

    // Calculate wall, food, morale, and troop attrition for ONE dekad
    const rawWallDmg = clamp(Math.round((42 + (weightedAttPow / Math.max(400, defPow)) * 46) * avgWallDmgMult * (defMode.wallMitigation ?? 1)), 12, 165);
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
        returnOfficerHome(state, a.officer, null);
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
  for (const city of Object.values(state.cities)) {
    const pol = CITY_POLICIES[city.policy || "balanced"] || CITY_POLICIES.balanced;
    const fac = state.factions[city.owner];
    if (!fac) continue;
    const gov = city.governor ? state.officers[city.governor] : null;
    const govBonus = 1 + ((gov?.governance ?? 55) - 55) * 0.004 + (gov?.traits?.includes("farming") ? 0.08 : 0);
    const ecoMult = city.owner === state.player ? DIFFICULTY_MODES[state.difficulty || "standard"].playerEconomy : 1.02;
    const underSiege = Boolean(state.sieges[city.key]);

    if (!underSiege) {
      const cSpec = CITY_SPECIALTIES[city.specialty];
      const specTreasuryMult = 1 + (cSpec?.treasuryBonus ?? 0);
      const specGrainMult = 1 + (cSpec?.grainBonus ?? 0);
      const tGain = Math.round((7 + city.level * 2.5) * pol.treasuryMult * govBonus * ecoMult * specTreasuryMult);
      const gGain = Math.round((9 + city.level * 3) * pol.grainMult * govBonus * ecoMult * specGrainMult);
      fac.treasury += tGain;
      fac.grain += gGain;

      const cap = 2600 + city.level * 550;
      if (city.troops < cap) {
        const rec = Math.round(95 * pol.recruitRate * govBonus);
        city.troops = Math.min(cap, city.troops + rec);
      }
      city.wall = Math.min(city.wallMax, city.wall + pol.wallRepair);
      city.foodReserve = Math.min(100, city.foodReserve + pol.foodRefill);
      city.morale = clamp(city.morale + 2, 40, 100);
    }
  }
  events.push({
    turn: state.turn,
    kind: "economy",
    text: `【月度税赋结算】未遭围困各城已依治城方针自动征粮聚财、休整守军并修缮城防。`,
  });
}

function planAiDekad(world, state) {
  const diff = DIFFICULTY_MODES[state.difficulty || "standard"];
  const factions = Object.keys(state.factions).filter((fk) => fk !== state.player);

  for (const fk of factions) {
    const ownedCities = Object.values(state.cities).filter((c) => c.owner === fk);
    if (!ownedCities.length) continue;

    // 1. Update besieging AI stances intelligently
    const myArmies = state.armies.filter((a) => a.faction === fk && a.troops > 0);
    for (const a of myArmies) {
      if (a.stance === "besiege") {
        const target = state.cities[a.targetCity];
        if (!target) continue;
        if (a.troops < 340 || a.morale < 25) {
          // Retreat battered army
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

    // Limit concurrent field armies per AI faction cleanly
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
        });
        helperOff.armyId = relief.id;
        state.armies.push(relief);
        dispatchedThisTurn = true;
        break;
      }
    }
    if (dispatchedThisTurn) continue;

    // 3. Opportunistic AI border offensive
    if (((state.turn + hashStr(fk)) % (diff.aiAggression > 1.1 ? 2 : 3)) !== 0) continue;
    if (state.factions[fk].grain < 18) continue;

    let bestAttack = null;
    for (const c of ownedCities) {
      if (state.sieges[c.key] || c.troops < 1750) continue;
      const off = availableOfficersInCity(state, c.key, fk)[0];
      if (!off) continue;
      for (const nbKey of cityByKey(world, c.key).links) {
        const target = state.cities[nbKey];
        if (!target || !isHostileV2(state, fk, target.owner)) continue;
        // Favor weaker targets and player borders moderately
        const powerGap = (c.troops - 450) * diff.aiAggression - target.troops * 0.92;
        if (powerGap < 250) continue;
        const score = powerGap + (target.owner === state.player ? 120 : 0);
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
      const army = createArmyRecord(world, state, {
        faction: fk,
        from: bestAttack.from.key,
        route: [bestAttack.from.key, bestAttack.to.key],
        officerKey: bestAttack.off.key,
        troops,
        troopType: bestAttack.from.troopType,
        stance: "attack",
        siegeStance: "storm",
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
export function advanceDekad(world, state, { skipAi = false } = {}) {
  if (state.outcome !== "ongoing") return state;
  const next = ensurePhase2State(structuredClone(state));
  next.turn += 1;
  const events = [];

  if (!skipAi) {
    planAiDekad(world, next);
    planAiPhase2Dekad(world, next);
  }

  // 1. Update positions, advance marching armies & check supply lines
  for (const a of next.armies) {
    a.lastPos = armyWorldPosition(world, a);
    if (a.reorgDekads > 0) a.reorgDekads -= 1;

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
          events.push({
            turn: next.turn,
            kind: "supply_cut",
            faction: a.faction,
            pos: armyWorldPosition(world, a),
            text: `⚡ 粮道断绝！${next.officers[a.officer]?.name || "孤军"}部缺粮逃散 ${starve.toLocaleString()} 人、士气骤跌！`,
          });
        }
      }
    }

    if (a.troops <= 0) {
      returnOfficerHome(next, a.officer, null);
      continue;
    }

    if (a.stance !== "besiege" && a.reorgDekads === 0) {
      const req = edgeDekadsRequired(world, a.from, a.to, a.troopType, next.weather, next.officers[a.officer]);
      a.edgeDekads = req;
      a.progress = Math.min(1, a.progress + 1 / req);
    }
    resolveFortsOnMove(world, next, a, events);
    if (a.troops <= 0) {
      returnOfficerHome(next, a.officer, null);
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
      const clash = opposing ? (a.progress + b.progress >= 0.9) : (Math.abs(a.progress - b.progress) <= 0.25);
      if (clash) {
        processedPairs.add(pairId);
        resolveFieldBattle(world, next, a, b, events);
      }
    }
  }

  // 3. Process road segment advances and city arrivals (siege/relief/trap/garrison)
  for (const a of next.armies) {
    if (a.troops <= 0 || a.stance === "besiege" || a.progress < 1) continue;

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
      returnOfficerHome(next, a.officer, null);
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
          events.push({
            turn: next.turn,
            kind: "relief",
            faction: a.faction,
            city: arrivedNode,
            pos: cityByKey(world, arrivedNode)?.position,
            text: `🎺 援军疾至！${next.officers[a.officer]?.name || "援军"}杀抵${cityNameV2(world, arrivedNode)}外围，直扑围城敌营！`,
          });
          resolveFieldBattle(world, next, a, besiegers[0], events);
        }
      }
      if (a.troops > 0 && dest.owner === a.faction) {
        dest.troops += a.troops;
        const off = next.officers[a.officer];
        if (off) {
          off.armyId = null;
          off.city = arrivedNode;
          if (!dest.commander) dest.commander = off.key;
        }
        if (a.faction === next.player) {
          events.push({
            turn: next.turn,
            kind: "reinforce",
            faction: a.faction,
            city: arrivedNode,
            pos: cityByKey(world, arrivedNode)?.position,
            text: `${next.officers[a.officer]?.name || "援师"}率 ${a.troops.toLocaleString()} 人顺利进驻「${cityNameV2(world, arrivedNode)}」。`,
          });
        }
        a.troops = 0;
      } else if (a.troops > 0 && dest.owner !== a.faction) {
        // Allied destination merge or redirect back
        returnOfficerHome(next, a.officer, null);
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
        const offAtt = next.officers[a.officer];
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
          returnOfficerHome(next, a.officer, null);
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
        events.push({
          turn: next.turn,
          kind: "siege_start",
          faction: a.faction,
          participants: [a.faction, dest.owner],
          city: arrivedNode,
          pos: cityByKey(world, arrivedNode)?.position,
          text: `🔥 兵临城下！${next.officers[a.officer]?.name || "大军"}率 ${a.troops.toLocaleString()} 人合围「${cityNameV2(world, arrivedNode)}」！`,
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

  // 5. Monthly governance & economy tick (every 3 dekads)
  if (next.turn % 3 === 0) {
    applyMonthlyGovernance(world, next, events);
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
  let rem = Math.max(1, Math.ceil((1 - (army.progress ?? 0)) * (army.edgeDekads || 2)));
  const off = state?.officers?.[army.officer];
  for (let i = (army.step ?? 0) + 1; i < (army.route?.length ?? 0) - 1; i += 1) {
    rem += edgeDekadsRequired(world, army.route[i], army.route[i + 1], army.troopType, state?.weather, off);
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
      officerName: state.officers[a.officer]?.name || "敌将",
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
  return ensurePhase2State(parsed);
}
