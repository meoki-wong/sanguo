import { cityName, firstCity } from "./engine.js";
import { armyCapacity } from "./armies.js";
import { roadPath } from "./roads.js";
import { livingSide, maximumPolities } from "./polities-data.js";

export function recordAllegiance(state, key, from, to, turn) {
  const changes = state.polity.allegiances[key] ??= [];
  if (changes.at(-1)?.turn === turn) {
    changes.at(-1).to = to;
    if (changes.at(-1).from === to) changes.pop();
    if (!changes.length) delete state.polity.allegiances[key];
    return;
  }
  changes.push({ from, to, turn });
}

export function retreatCity(world, state, faction, origin) {
  const graph = new Map(world.cities.map((city) => [city.key, city]));
  const owned = world.cities.filter(({ key }) => state.cities[key].owner === faction);
  const routes = owned.map(({ key }) => roadPath(graph, origin, key, (city) => state.cities[city].owner === faction))
    .filter(Boolean).sort((a, b) => a.length - b.length);
  return routes[0]?.at(-1) ?? (owned.length ? firstCity(world, state, faction) : null);
}

function resetArmy(world, state, unit) {
  if (state.cities[unit.location]?.owner !== unit.faction) {
    const home = retreatCity(world, state, unit.faction, unit.location);
    if (!home) return false;
    unit.location = home;
  }
  unit.depot = unit.location;
  unit.target = unit.location;
  unit.route = [unit.location];
  unit.phase = "hold";
  delete unit.engagement;
  return true;
}

function absorbArmy(state, unit) {
  state.cities[unit.location].troops += unit.troops;
  state.factions[unit.faction].grain += unit.grain;
  state.stations[unit.officer] = unit.location;
}

export function cleanLosses(state, changing) {
  const owned = (key) => state.cities[key]?.owner === state.player;
  for (const key of ["delegationPriority", "policyOverrides"]) {
    if (!state[key]) continue;
    state[key] = state[key].filter(owned);
    if (!state[key].length) delete state[key];
  }
  if (state.war?.recovery) {
    state.war.recovery.cities = state.war.recovery.cities.filter(owned);
    state.war.recovery.aided = state.war.recovery.aided.filter(owned);
    if (!state.war.recovery.follow && !state.war.recovery.cities.length) state.war.recovery = null;
  }
  if (state.war) for (const views of Object.values(state.war.intel)) {
    for (const report of Object.values(views)) report.spotted = report.spotted.filter(({ officer }) => !changing.has(officer));
  }
  if (state.theaters) {
    state.theaters = state.theaters.filter(({ commander, army, cities }) => !changing.has(commander)
      && !changing.has(army) && cities.some(owned));
    for (const plan of state.theaters) {
      if (plan.cities.some((city) => !owned(city))) plan.paused = true;
      if (plan.army && !(state.armies ?? []).some(({ officer }) => officer === plan.army)) plan.army = null;
    }
    if (!state.theaters.length) delete state.theaters;
  }
  for (const seat of Object.values(state.realm?.offices ?? {})) {
    if (changing.has(seat.holder)) seat.holder = null;
    if (changing.has(seat.deputy)) seat.deputy = null;
  }
  for (const seat of Object.values(state.polity.courts)) {
    if (changing.has(seat.head)) seat.head = null;
    if (changing.has(seat.heir)) seat.heir = null;
    if (changing.has(seat.regent)) seat.regent = null;
  }
  if (state.campaignEvents?.pending?.officer && changing.has(state.campaignEvents.pending.officer)) state.campaignEvents.pending = null;
}

export function changeService(world, state, officer, to, turn) {
  const origin = state.stations[officer.key];
  if (!origin || !livingSide(state, to) || officer.faction === to) return null;
  const city = retreatCity(world, state, to, origin);
  for (const holding of Object.values(state.cities)) {
    if (holding.governor === officer.key) {
      holding.governor = null;
      holding.mode = "direct";
      holding.delegateBudget = null;
    }
    if (holding.commander === officer.key) holding.commander = null;
  }
  recordAllegiance(state, officer.key, officer.faction, to, turn);
  state.stations[officer.key] = city;
  cleanLosses(state, new Set([officer.key]));
  for (const plan of state.grand?.campaigns ?? []) {
    if (Object.values(plan.wings).some((wing) => wing.officer === officer.key) && plan.status !== "complete") plan.status = "paused";
  }
  return city;
}

export function handoverCities(world, era, state, from, to, cities, kind, turn) {
  const changing = new Set();
  const picked = new Set(cities);
  const absorbed = kind === "union";
  for (const { key, faction } of era.officers) {
    if (kind === "return" || faction !== from) continue;
    const army = state.armies?.find(({ officer }) => officer === key);
    if (!absorbed && !picked.has(army?.location ?? state.stations[key])) continue;
    recordAllegiance(state, key, from, to, turn);
    changing.add(key);
  }
  for (const key of cities) {
    const city = state.cities[key];
    city.owner = to;
    city.occupation = kind === "secede" ? 1 : 0;
    if (to !== state.player && city.focus === "auto") city.focus = "farming";
    if (kind === "return") {
      city.governor = null;
      city.commander = null;
      city.delegateBudget = null;
      city.mode = "direct";
      city.focus = "farming";
    }
  }
  if (kind === "return") for (const { key, faction } of era.officers) {
    const old = state.stations[key];
    if (faction === from && picked.has(old)) state.stations[key] = retreatCity(world, state, from, old);
  }
  const corps = [];
  for (const unit of state.armies ?? []) {
    const reassigned = changing.has(unit.officer);
    if (reassigned) unit.faction = to;
    if ((reassigned || picked.has(unit.location) || picked.has(unit.depot)) && !resetArmy(world, state, unit)) {
      const home = cities[0];
      if (!reassigned) recordAllegiance(state, unit.officer, unit.faction, to, turn);
      changing.add(unit.officer);
      unit.faction = to;
      unit.location = home;
      absorbArmy(state, unit);
      continue;
    }
    if (reassigned && ((state.armies ?? []).filter((army) => army.faction === to && !changing.has(army.officer)).length
      + corps.filter((army) => army.faction === to && changing.has(army.officer)).length >= armyCapacity(state))) {
      absorbArmy(state, unit);
    } else corps.push(unit);
  }
  if (corps.length) state.armies = corps;
  else delete state.armies;
  if (absorbed) {
    for (const resource of ["treasury", "grain"]) {
      state.factions[to][resource] += state.factions[from][resource];
      state.factions[from][resource] = 0;
    }
  }
  cleanLosses(state, changing);
}

export function formPolity(world, era, state, faction, region, cities, turn, cause) {
  if (Object.keys(state.factions).length >= maximumPolities) return null;
  const city = cities[0];
  const place = world.cities.find(({ key }) => key === city);
  const key = "spl-" + (state.polity.parties.length + 1);
  const leader = key + "-head";
  const name = cityName(world, city) + "军";
  const tally = Object.values(state.cities).filter(({ owner }) => owner === faction).length;
  const proportion = Math.min(.3, cities.length / tally);
  const source = state.factions[faction];
  const treasury = Math.floor(source.treasury * proportion);
  const grain = Math.floor(source.grain * proportion);
  state.polity.parties.push({ key, leader, name, city, region, origin: faction, turn, position: place.position, ...(cause ? { cause } : {}) });
  source.treasury -= treasury;
  source.grain -= grain;
  state.factions[key] = { treasury, grain, morale: 59 };
  handoverCities(world, era, state, faction, key, cities, "secede", turn);
  state.stations[leader] = city;
  if (!state.cities[city].commander) state.cities[city].commander = leader;
  return { key, city, treasury, grain, name, leader };
}

export function reconcilePolities(state, turn) {
  const active = (faction) => livingSide(state, faction);
  const data = state.polity;
  data.protections = data.protections.filter(({ ward, patron, expires }) => active(ward) && active(patron) && expires > turn);
  for (const [key, goal] of Object.entries(state.strategies)) if (!active(key) || state.cities[goal.city]?.owner !== key) delete state.strategies[key];
  if (state.incomingTreaty && !active(state.incomingTreaty.from)) state.incomingTreaty = null;
  if (state.realm) {
    for (const group of ["accords", "proposals"]) state.realm[group] = state.realm[group].filter(({ from, to }) => active(from) && active(to));
    if (state.realm.coalition.partners.some((key) => !active(key))) state.realm.coalition = { partners: [], streak: 0 };
  }
  for (const [key, seat] of Object.entries(data.courts)) {
    if (!active(key)) continue;
    const eligible = (person) => typeof person === "string" && (state.cities[state.stations[person]]?.owner === key
      || state.armies?.some(({ officer, faction }) => faction === key && officer === person));
    if (!eligible(seat.heir)) seat.heir = null;
    if (!eligible(seat.regent)) seat.regent = null;
  }
}
