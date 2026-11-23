import { isHostile, treatyWith } from "./diplomacy.js";
import { officerSkill } from "./campaign.js";
import { availableAttackers, cityReserve, defensiveStrength, eraByYear, expeditionGrain, forecastAttack, gameOutcome, minimumMarch,
  pendingExpedition, previewOrders, queueOrder, seasonOrderLimit, transferGrain, transferRoutes, transferRoutesTo, validateOrder } from "./engine.js";

export function frontierCities(world, state) {
  return world.cities
    .filter(({ key, links }) => state.cities[key].owner === state.player && links.some((link) => state.cities[link].owner !== state.player))
    .map(({ key, links }) => ({ key, exposed: links.some((link) => isHostile(state, state.player, state.cities[link].owner)) }))
    .sort((a, b) => Number(b.exposed) - Number(a.exposed));
}

export function frontierIntel(world, state, key, { includeRemote = false } = {}) {
  const city = world.cities.find((entry) => entry.key === key);
  const holding = state.cities[key];
  if (!city || holding.owner !== state.player) return null;
  const player = state.player;
  const opponents = city.links.flatMap((link) => {
    const neighbor = state.cities[link];
    if (neighbor.owner === player) return [];
    return [{
      key: link, owner: neighbor.owner, troops: neighbor.troops, defense: neighbor.defense,
      commander: neighbor.commander, difference: neighbor.troops - holding.troops,
      treaty: treatyWith(state, player, neighbor.owner),
    }];
  }).sort((a, b) => Number(Boolean(a.treaty)) - Number(Boolean(b.treaty)) || b.troops - a.troops);
  const routes = includeRemote ? transferRoutesTo(world, state, key) : world.cities
    .filter((candidate) => candidate.links.includes(key) && state.cities[candidate.key].owner === player)
    .map(({ key: from }) => [from, key]);
  const donors = routes.map((route) => {
    const from = route[0];
    const hops = route.length - 1;
    const { links } = world.cities.find(({ key }) => key === from);
    const neighbor = state.cities[from];
    const supply = Math.floor(state.factions[player].grain / hops) * 100;
    const available = Math.max(0, Math.min(neighbor.troops - cityReserve, supply));
    return {
      key: from, hops, route, troops: neighbor.troops, available: available >= minimumMarch ? available : 0,
      exposed: links.some((link) => isHostile(state, player, state.cities[link].owner)),
    };
  }).sort((a, b) => (includeRemote ? Number(a.available === 0) - Number(b.available === 0) : 0)
    || Number(a.hops > 1) - Number(b.hops > 1) || Number(a.exposed) - Number(b.exposed)
    || a.hops - b.hops || b.available - a.available);
  return { key, troops: holding.troops, defense: holding.defense, commander: holding.commander, opponents, donors };
}

function minimumWinningExpedition(era, planned, draft, limit) {
  if (!forecastAttack(era, planned, { ...draft, troops: limit }).wins) return null;
  let lower = minimumMarch;
  let upper = limit;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (forecastAttack(era, planned, { ...draft, troops: middle }).wins) upper = middle;
    else lower = middle + 1;
  }
  return { ...draft, troops: lower };
}

function compareExpeditions(a, b) {
  return a.order.troops - b.order.troops || b.retained - a.retained;
}

export function frontierAttackOpportunities(world, state, planned, { faction } = {}) {
  if (gameOutcome(state) !== "ongoing") return { entries: [], blocker: "ended" };
  if (faction) {
    if (!Object.values(state.cities).some(({ owner }) => owner === faction)) return { entries: [], blocker: "eliminated" };
    if (treatyWith(planned, state.player, faction)) return { entries: [], blocker: "treaty" };
    if (!Object.values(planned.cities).some(({ owner }) => owner === faction)) return { entries: [], blocker: "projected-loss" };
  }
  if (state.orders.length >= seasonOrderLimit) return { entries: [], blocker: "queue" };
  const grain = planned.factions[state.player].grain;
  if (grain < expeditionGrain(minimumMarch)) return { entries: [], blocker: "grain" };
  const era = eraByYear(world, state);
  const opportunities = new Map();
  for (const { key: from, exposed } of frontierCities(world, planned)) {
    if (!exposed) continue;
    const troops = planned.cities[from].troops;
    const capacity = Math.min(troops - cityReserve, grain * 100);
    if (capacity < minimumMarch) continue;
    const officer = availableAttackers(era, planned, state.player, from).filter(({ key }) => !pendingExpedition(state, key))
      .sort((a, b) => officerSkill(state, b, "command") - officerSkill(state, a, "command"))[0];
    if (!officer) continue;
    const { links } = world.cities.find(({ key }) => key === from);
    for (const to of links) {
      const owner = planned.cities[to].owner;
      if (faction && owner !== faction) continue;
      if (!isHostile(planned, state.player, owner)) continue;
      const order = minimumWinningExpedition(era, planned, { type: "attack", from, to, officer: officer.key }, capacity);
      if (!order) continue;
      const entry = { order, officer, owner, forecast: forecastAttack(era, planned, order), retained: troops - order.troops };
      const previous = opportunities.get(to);
      if (previous && compareExpeditions(entry, previous) >= 0) continue;
      try {
        queueOrder(world, state, order);
      } catch {
        continue;
      }
      opportunities.set(to, entry);
    }
  }
  const entries = [...opportunities.values()].sort(compareExpeditions);
  return { entries, blocker: entries.length ? null : "none" };
}

export function planFrontierExpeditions(world, state, { faction, limit = seasonOrderLimit } = {}) {
  let queued = state;
  let projected = previewOrders(world, queued);
  const openingGrain = projected.factions[state.player].grain;
  const steps = [];
  let blocker = null;
  for (let index = 0; index < limit; index += 1) {
    const available = frontierAttackOpportunities(world, queued, projected, { faction });
    const [entry] = available.entries;
    if (!entry) {
      blocker = available.blocker;
      break;
    }
    queued = queueOrder(world, queued, entry.order);
    projected = previewOrders(world, queued);
    steps.push({ ...entry, number: queued.orders.length });
  }
  const closingGrain = projected.factions[state.player].grain;
  return { steps, blocker, grain: openingGrain - closingGrain, closingGrain };
}

function reinforcementDraft(world, state, planned, to, shortage, target, exposed) {
  if (state.orders.length >= seasonOrderLimit) return { blocker: "queue" };
  const { donors } = frontierIntel(world, planned, to, { includeRemote: true });
  const wanted = Math.max(minimumMarch, shortage);
  let hasSurplus = false;
  const offers = [];
  for (const donor of donors) {
    if (state.cities[donor.key].owner !== state.player) continue;
    const onFront = exposed.has(donor.key);
    const retained = onFront ? Math.max(target, cityReserve) : cityReserve;
    const surplus = donor.troops - retained;
    if (surplus < minimumMarch) continue;
    hasSurplus = true;
    const troops = Math.min(wanted, surplus, donor.available);
    if (troops >= minimumMarch) offers.push({ donor, troops, onFront });
  }
  offers.sort((a, b) => Number(a.onFront) - Number(b.onFront) || b.troops - a.troops || a.donor.hops - b.donor.hops);
  for (const { donor, troops, onFront } of offers) {
    const from = donor.key;
    // The transfer form uses the shortest route traced from the donor.
    const route = transferRoutes(world, planned, from).find((path) => path.at(-1) === to);
    if (!route) continue;
    const order = { type: "transfer", from, to, troops, ...(route.length > 2 ? { route } : {}) };
    try {
      validateOrder(world, planned, state.player, order);
    } catch {
      continue;
    }
    return { order, grain: transferGrain(order), retained: donor.troops - troops, onFront, hops: route.length - 1 };
  }
  return { blocker: hasSurplus && !offers.length ? "grain" : "donor" };
}

function exposureAcrossQueues(borders, projectedBorders) {
  return new Set([...borders, ...projectedBorders].filter((city) => city.exposed).map(({ key }) => key));
}

function strongestNeighborAttack(world, era, snapshot, city) {
  let threat;
  let external = 0;
  let hostile = 0;
  for (const from of city.links) {
    const { owner, troops } = snapshot.cities[from];
    if (owner === snapshot.player) continue;
    external += 1;
    if (!isHostile(snapshot, snapshot.player, owner)) continue;
    hostile += 1;
    const capacity = Math.min(troops - cityReserve, snapshot.factions[owner].grain * 100);
    if (capacity < minimumMarch) continue;
    const leader = availableAttackers(era, snapshot, owner, from)
      .sort((a, b) => officerSkill(snapshot, b, "command") - officerSkill(snapshot, a, "command"))[0];
    if (!leader && !snapshot.observer) continue;
    const order = { type: "attack", from, to: city.key, officer: leader?.key, troops: capacity };
    if (!snapshot.observer) try { validateOrder(world, snapshot, owner, order); } catch { continue; }
    const estimate = forecastAttack(era, snapshot, order, owner);
    if (!threat || estimate.offense > threat.offense) threat = { ...estimate, from, officer: leader?.name ?? "估计" };
  }
  const status = threat ? "attack" : hostile ? "unavailable" : external ? "treaty" : "interior";
  return { defense: defensiveStrength(era, snapshot.cities[city.key], snapshot, city.key), threat, status };
}

function troopsNeededToHold(era, city, threat, snapshot, key) {
  let lower = 1;
  let upper = threat.offense - threat.defense;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const defense = defensiveStrength(era, { ...city, troops: city.troops + middle }, snapshot, key);
    if (defense >= threat.offense) upper = middle;
    else lower = middle + 1;
  }
  return lower;
}

export function frontierDefensePressure(world, state, planned, target) {
  if (gameOutcome(state) !== "ongoing") return [];
  const era = eraByYear(world, state);
  const borders = frontierCities(world, state);
  const exposed = exposureAcrossQueues(borders, frontierCities(world, planned));
  const borderKeys = new Set(borders.map(({ key }) => key));
  const rows = [];
  for (const city of world.cities) {
    const holding = planned.cities[city.key];
    if (!borderKeys.has(city.key) || holding.owner !== state.player) continue;
    const current = strongestNeighborAttack(world, era, state, city);
    const projected = planned === state ? current : strongestNeighborAttack(world, era, planned, city);
    const margin = projected.threat ? projected.threat.offense - projected.defense : null;
    const exposedAfter = projected.status === "attack" || projected.status === "unavailable";
    const weakened = exposedAfter && projected.defense < current.defense;
    let aid;
    if (projected.threat?.wins) {
      const shortage = troopsNeededToHold(era, holding, projected.threat, planned, city.key);
      aid = reinforcementDraft(world, state, planned, city.key, shortage, target, exposed);
      if (aid.order) aid.defense = defensiveStrength(era, { ...holding, troops: holding.troops + aid.order.troops }, planned, city.key);
    }
    rows.push({ key: city.key, current, projected, margin, weakened, aid });
  }
  return rows.sort((a, b) => Number(b.margin > 0) - Number(a.margin > 0) || Number(b.weakened) - Number(a.weakened)
    || Number(b.margin !== null) - Number(a.margin !== null) || (b.margin ?? 0) - (a.margin ?? 0));
}

export function frontierGarrisons(world, state, planned, target) {
  const borders = frontierCities(world, state);
  const exposed = exposureAcrossQueues(borders, frontierCities(world, planned));
  const ongoing = gameOutcome(state) === "ongoing";
  return borders.flatMap(({ key, exposed: hostile }) => {
    const projection = planned.cities[key];
    if (projection.owner !== state.player) return [];
    const current = state.cities[key].troops;
    const projected = projection.troops;
    const shortage = hostile ? Math.max(0, target - projected) : 0;
    const aid = shortage > 0 && ongoing ? reinforcementDraft(world, state, planned, key, shortage, target, exposed) : null;
    return [{ key, hostile, current, projected, shortage, aid }];
  }).sort((a, b) => b.shortage - a.shortage || Number(b.hostile) - Number(a.hostile) || a.projected - b.projected);
}

export function planFrontierReinforcements(world, state, target) {
  let queued = state;
  let projected = previewOrders(world, state);
  const openingGrain = projected.factions[state.player].grain;
  let garrisons = frontierGarrisons(world, queued, projected, target);
  const steps = [];
  const recipients = new Set();
  while (queued.orders.length < seasonOrderLimit) {
    const city = garrisons.find(({ key, aid }) => aid?.order && !recipients.has(key));
    if (!city) break;
    const { order, grain } = city.aid;
    queued = queueOrder(world, queued, order);
    projected = previewOrders(world, queued);
    const arrival = projected.cities[city.key].troops;
    steps.push({ order, grain, number: queued.orders.length, before: city.projected, arrival,
      retained: projected.cities[order.from].troops, shortage: Math.max(0, target - arrival) });
    recipients.add(city.key);
    garrisons = frontierGarrisons(world, queued, projected, target);
  }
  const remaining = garrisons.filter(({ shortage }) => shortage > 0).map(({ key, shortage, aid }) => ({
    key, shortage, blocker: recipients.has(key) ? "planned" : aid?.blocker,
  }));
  const closingGrain = projected.factions[state.player].grain;
  return { steps, remaining, grain: openingGrain - closingGrain, closingGrain };
}
