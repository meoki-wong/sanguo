import { treatyWith } from "./diplomacy.js";
import { cityName, gameOutcome } from "./engine.js";

const terrain = {
  "chaisang:jiangxia": "river", "chaisang:linxiang": "river", "jiangling:jiangxia": "river",
  "jiangling:yufu": "pass", "jiangzhou:yufu": "pass", "changan:tianshui": "pass",
  "nanzheng:shangyong": "pass", "nanzheng:zitong": "pass", "changan:luoyang": "pass",
};

export const terrainLabels = { river: "渡口", pass: "险道" };
export const scoutCost = 6;
export const intelLabels = { border: "边报", scout: "侦察", ally: "盟友通报", own: "本方", unknown: "暂无军情" };

export const roadTerrain = (from, to) => terrain[[from, to].sort().join(":")];

const band = (number, unit) => {
  const low = Math.floor(number / unit) * unit;
  return [low, low + unit - 1];
};
const around = (state, faction, key, links) => state.cities[key]?.owner === faction
  || links.some((city) => state.cities[city].owner === faction);

function observe(state, key, source, seen) {
  const site = state.cities[key];
  const precision = source === "scout" ? 250 : source === "ally" ? 500 : 900;
  const spotted = (state.armies ?? []).filter((army) => army.location === key && army.troops > 0
    && (source !== "border" || army.target !== key)).map((army) => ({
    officer: army.officer, faction: army.faction, location: key, troops: band(army.troops, precision),
    phase: army.phase, ...(army.engagement ? { target: army.target } : {}),
  }));
  return { source, seen, owner: site.owner, troops: band(site.troops, precision),
    defense: source === "scout" ? [site.defense, site.defense] : [Math.max(0, site.defense - 1), Math.min(5, site.defense + 1)],
    spotted };
}

export function beginWar(world, state) {
  if (state.war) return state;
  const next = { ...state, war: { since: state.turn, intel: {}, scouts: [], recovery: null, timeline: [], milestones: [] } };
  refreshIntelligence(world, next, state.turn);
  return next;
}

function refreshIntelligence(world, state, turn, onlyPlayer = false) {
  const living = new Set(Object.values(state.cities).map(({ owner }) => owner));
  for (const faction of living) {
    if (onlyPlayer && faction !== state.player) continue;
    const records = state.war.intel[faction] ??= {};
    const allies = [...living].filter((key) => treatyWith(state, faction, key)?.kind === "alliance");
    for (const { key, links } of world.cities) {
      if (state.cities[key].owner === faction) {
        delete records[key];
        continue;
      }
      const prior = records[key];
      if (prior && turn - prior.seen > 6) delete records[key];
      if (prior?.source === "scout" && prior.owner === state.cities[key].owner && turn - prior.seen < 3) continue;
      const source = around(state, faction, key, links) ? "border"
        : allies.some((ally) => around(state, ally, key, links)) ? "ally" : null;
      if (source) records[key] = observe(state, key, source, turn);
    }
  }
}

export function townIntel(state, faction, key) {
  const city = state.cities[key];
  if (!state.war || city.owner === faction) return { source: "own", seen: state.turn, troops: [city.troops, city.troops],
    defense: [city.defense, city.defense], spotted: [] };
  const record = state.war.intel[faction]?.[key];
  if (record?.owner === city.owner && state.turn - record.seen <= 6) {
    const age = Math.max(0, state.turn - record.seen - 1);
    if (!age) return record;
    return { ...record, troops: [Math.max(0, record.troops[0] - age * 450), record.troops[1] + age * 600],
      defense: [Math.max(0, record.defense[0] - age), Math.min(5, record.defense[1] + age)], spotted: [] };
  }
  return { source: "unknown", troops: null, defense: null, spotted: [] };
}

export function intelSummary(state, faction, key, field = "troops") {
  const value = townIntel(state, faction, key)[field];
  if (!value) return "未知";
  const formatted = (count) => count.toLocaleString("en-US");
  return value[0] === value[1] ? formatted(value[0]) : value.map(formatted).join("–");
}

export function visibleArmy(state, faction, officer) {
  return observedArmies(state, faction).find((army) => army.officer === officer) ?? null;
}

function observedArmies(state, faction) {
  if (!state.war) return state.armies ?? [];
  const own = (state.armies ?? []).filter((army) => army.faction === faction);
  const foreign = new Map();
  for (const key of Object.keys(state.war.intel[faction] ?? {})) {
    const record = townIntel(state, faction, key);
    for (const army of record.spotted) {
      if (army.faction === faction || (foreign.get(army.officer)?.seen ?? -1) > record.seen) continue;
      foreign.set(army.officer, { ...army, seen: record.seen });
    }
  }
  // Contact on the viewer's side of a battle line is a current, approximate observation.
  for (const army of state.armies ?? []) {
    if (army.faction !== faction && state.cities[army.location]?.owner === faction) {
      foreign.set(army.officer, { officer: army.officer, faction: army.faction, location: army.location,
        troops: band(army.troops, 500), seen: state.turn, phase: "hold" });
    }
  }
  return [...own, ...[...foreign.values()].map((army) => ({
    ...army, troops: Math.round((army.troops[0] + army.troops[1]) / 2), troopRange: army.troops,
    target: army.target ?? army.location, route: [army.location], depot: null, grain: null, observed: true,
  }))];
}

export function militaryView(state, faction = state.player) {
  if (!state.war || state.observer === faction) return state;
  const units = observedArmies(state, faction);
  const cities = Object.fromEntries(Object.entries(state.cities).map(([key, site]) => {
    if (site.owner === faction) return [key, site];
    const record = townIntel(state, faction, key);
    return [key, { ...site, troops: record.troops ? Math.round((record.troops[0] + record.troops[1]) / 2) : 2500,
      defense: record.defense ? Math.round((record.defense[0] + record.defense[1]) / 2) : 3,
      governor: null, commander: null }];
  }));
  const stocks = Object.fromEntries(Object.entries(state.factions).map(([key, stock]) =>
    [key, key === faction ? stock : { treasury: 70, grain: 45, morale: 65 }]));
  return { ...state, observer: faction, cities, factions: stocks, armies: units,
    stations: Object.fromEntries(Object.entries(state.stations).map(([key, city]) => [key, cities[city]?.owner === faction ? city : null])) };
}

export function scoutReachable(world, state, faction, target) {
  const site = world.cities.find(({ key }) => key === target);
  if (!site || state.cities[target].owner === faction) return false;
  const near = (city) => state.cities[city]?.owner === faction || treatyWith(state, faction, state.cities[city]?.owner)?.kind === "alliance";
  return site.links.some((key) => near(key) || world.cities.find((candidate) => candidate.key === key).links.some(near));
}

export function queueScout(world, state, city) {
  if (!state.war || gameOutcome(state) !== "ongoing" || !scoutReachable(world, state, state.player, city)) throw new Error("只能侦察两段道路以内的外部城池。");
  if (state.war.scouts.includes(city)) throw new Error("这座城已派出斥候。");
  if (state.war.scouts.length >= 2) throw new Error("每季可派两支斥候。");
  const reserve = state.delegationReserve?.grain ?? 0;
  if (state.factions[state.player].grain - reserve < scoutCost * (state.war.scouts.length + 1)) throw new Error("预留后的可用储粮不足。");
  return { ...state, war: { ...state.war, scouts: [...state.war.scouts, city] } };
}

export function settleIntelligence(world, state, entries, forecast) {
  if (!state.war) return;
  const turn = state.turn + 1;
  const frontTargets = (state.theaters ?? []).filter(({ operation, paused }) => operation && !paused)
    .map(({ target }) => target).filter((key) => {
      const intel = townIntel(state, state.player, key);
      return scoutReachable(world, state, state.player, key) && (intel.source !== "scout" || state.turn - intel.seen >= 2);
    });
  const assigned = [...new Set([...state.war.scouts, ...frontTargets])].slice(0, 2);
  const factions = forecast ? [state.player] : Object.keys(state.factions);
  for (const faction of factions) {
    const player = faction === state.player;
    const strategic = state.strategies[faction]?.target;
    const target = strategic && townIntel(state, faction, strategic).source !== "scout" ? strategic : null;
    const sites = player ? assigned : target ? [target] : [];
    const stock = state.factions[faction];
    const reserve = player ? state.delegationReserve?.grain ?? 0 : 25;
    for (const key of sites) {
      const reached = scoutReachable(world, state, faction, key) && stock.grain - reserve >= scoutCost;
      if (reached) {
        stock.grain -= scoutCost;
        (state.war.intel[faction] ??= {})[key] = observe(state, key, "scout", turn);
      }
      if (player) entries.push({ type: "war", event: reached ? "scouted" : "scout-blocked", faction, city: key,
        cost: reached ? scoutCost : 0, text: reached ? "斥候已回报" + cityName(world, key) + "军情。"
          : cityName(world, key) + "侦察因道路或军粮受阻。" });
    }
  }
  state.war.scouts = [];
  refreshIntelligence(world, state, turn, forecast);
}

export function validIntelligence(state, officers) {
  const { since, intel, scouts } = state.war;
  const range = (pair) => Array.isArray(pair) && pair.length === 2 && pair.every((value) => Number.isSafeInteger(value) && value >= 0) && pair[0] <= pair[1];
  return Number.isSafeInteger(since) && since >= 0 && since <= state.turn
    && Array.isArray(scouts) && scouts.length <= 2 && new Set(scouts).size === scouts.length && scouts.every((key) => Object.hasOwn(state.cities, key))
    && intel && typeof intel === "object" && !Array.isArray(intel) && Object.entries(intel).every(([faction, cities]) =>
      Object.hasOwn(state.factions, faction) && cities && typeof cities === "object" && !Array.isArray(cities)
      && Object.entries(cities).every(([key, row]) => Object.hasOwn(state.cities, key) && row
        && ["border", "ally", "scout"].includes(row.source) && Number.isSafeInteger(row.seen) && row.seen >= since && row.seen <= state.turn
        && Object.hasOwn(state.factions, row.owner) && range(row.troops) && range(row.defense) && row.defense[1] <= 5
        && Array.isArray(row.spotted) && row.spotted.length <= Object.keys(state.factions).length * 2
        && row.spotted.every((unit) => unit && officers.get(unit.officer)?.faction === unit.faction && unit.location === key
          && range(unit.troops) && ["muster", "march", "hold", "retreat", "secured"].includes(unit.phase)
          && (unit.target === undefined || Object.hasOwn(state.cities, unit.target)))));
}
