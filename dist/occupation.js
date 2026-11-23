import { cityIncome, cityReserve, gameOutcome, minimumMarch, occupationProgress, previewOrders, queueOrder, replaceOrders,
  seasonOrderLimit, transferGrain } from "./engine.js";
import { frontierIntel } from "./frontier.js";
import { nationalRoster, usePersonnel } from "./roster.js";

export function occupiedHoldings(world, state, planned, sort) {
  return world.cities.flatMap((city) => {
    const holding = state.cities[city.key];
    const projection = planned.cities[city.key];
    if (projection.owner !== state.player || !projection.occupation) return [];
    const pending = holding.owner !== state.player;
    return [{
      city, holding, projection, pending, income: cityIncome(projection),
      progress: occupationProgress(projection, pending),
    }];
  }).sort((a, b) => sort === "troops" ? b.projection.troops - a.projection.troops : b.income[sort] - a.income[sort]);
}

export function occupationReinforcement(world, state, planned, key, shortage) {
  if (shortage <= 0 || gameOutcome(state) !== "ongoing") return null;
  if (state.orders.length >= seasonOrderLimit) return { blocker: "queue" };
  const required = Math.max(minimumMarch, shortage);
  const donors = frontierIntel(world, planned, key, { includeRemote: true })?.donors ?? [];
  const source = donors.find(({ available }) => available >= required) ?? donors.find(({ available }) => available > 0);
  if (!source) return { blocker: donors.some(({ troops }) => troops - cityReserve >= minimumMarch) ? "grain" : "donor" };
  return { from: source.key, troops: Math.min(required, source.available), ...(source.hops > 1 ? { route: source.route } : {}) };
}

export function planOccupationReinforcements(world, state) {
  const ended = gameOutcome(state) !== "ongoing";
  let queued = state;
  let projected = previewOrders(world, state);
  const openingGrain = projected.factions[state.player].grain;
  const candidates = occupiedHoldings(world, state, projected, "troops")
    .filter(({ progress }) => progress.shortage > 0)
    .sort((a, b) => Number(a.pending) - Number(b.pending) || b.progress.shortage - a.progress.shortage);
  const steps = [];
  while (!ended && queued.orders.length < seasonOrderLimit) {
    let order;
    for (const { city } of candidates) {
      const shortage = cityReserve - projected.cities[city.key].troops;
      const aid = occupationReinforcement(world, queued, projected, city.key, shortage);
      if (!aid?.from) continue;
      order = { type: "transfer", ...aid, to: city.key };
      break;
    }
    if (!order) break;
    const before = projected.cities[order.to].troops;
    queued = queueOrder(world, queued, order);
    projected = previewOrders(world, queued);
    const arrival = projected.cities[order.to].troops;
    steps.push({ order, number: queued.orders.length, before, arrival, shortage: Math.max(0, cityReserve - arrival),
      grain: transferGrain(order), retained: projected.cities[order.from].troops });
  }
  const targets = candidates.map(({ city, pending, projection }) => {
    const final = projected.cities[city.key];
    const progress = occupationProgress(final, pending);
    const aid = occupationReinforcement(world, queued, projected, city.key, progress.shortage);
    return { city: city.key, pending, before: projection.troops, arrival: final.troops,
      governor: final.governor, progress, blocker: aid?.blocker };
  });
  const closingGrain = projected.factions[state.player].grain;
  return { steps, targets, ended, grain: openingGrain - closingGrain, closingGrain };
}

export function appointOccupationGovernors(world, state, assignments) {
  let next = state;
  for (const { city, officer } of assignments) {
    if (!next.cities[city]?.occupation) throw new Error("请选择正在整顿的城池。");
    next = usePersonnel(world, next, officer, "governor", city);
  }
  return { state: next, projection: previewOrders(world, next) };
}

export function planOccupationGovernors(world, state) {
  const planned = previewOrders(world, state);
  const ended = gameOutcome(state) !== "ongoing";
  const vacancies = occupiedHoldings(world, state, planned, "troops")
    .filter(({ projection }) => !projection.governor)
    .sort((a, b) => Number(a.pending) - Number(b.pending)
      || Number(Boolean(a.progress.pause)) - Number(Boolean(b.progress.pause))
      || b.progress.remaining - a.progress.remaining);
  const deploying = new Set(state.orders.filter(({ type }) => type === "deploy").map(({ officer }) => officer));
  const available = ended ? [] : nationalRoster(world, state, { status: "available", sort: "governance", query: "" }).matching
    .filter(({ person }) => !deploying.has(person.key));
  const selected = vacancies.filter(({ pending }) => !pending).slice(0, available.length);
  const assigned = new Map();
  for (const { city } of selected) {
    const local = available.findIndex(({ station }) => station === city.key);
    if (local >= 0) assigned.set(city.key, available.splice(local, 1)[0]);
  }
  for (const { city } of selected) if (!assigned.has(city.key)) assigned.set(city.key, available.shift());
  const assignments = selected.map(({ city }) => ({ city: city.key, officer: assigned.get(city.key).person.key }));
  const forecast = assignments.length ? appointOccupationGovernors(world, state, assignments).projection : planned;
  const rows = vacancies.map(({ city, pending, projection, progress }) => {
    const candidate = assigned.get(city.key);
    return { city: city.key, pending, troops: projection.troops, before: progress,
      after: occupationProgress(forecast.cities[city.key], pending), candidate,
      blocker: candidate ? null : pending ? "capture" : ended ? "ended" : "staff" };
  });
  return { rows, assignments, ended };
}

export function planOccupationTakeover(world, state) {
  const aid = planOccupationReinforcements(world, state);
  const transfers = aid.steps.map(({ order }) => order);
  const queued = appendOccupationTransfers(world, state, transfers);
  const staffing = planOccupationGovernors(world, queued);
  const targets = new Map(aid.targets.map((target) => [target.city, target]));
  const vacancies = new Map(staffing.rows.map((row) => [row.city, row]));
  const cities = new Set([...vacancies.keys(), ...targets.keys()]);
  const planned = previewOrders(world, state);
  const rows = [...cities].map((city) => {
    const transfer = targets.get(city);
    const staff = vacancies.get(city);
    const holding = planned.cities[city];
    return {
      city, pending: state.cities[city].owner !== state.player,
      before: holding.troops, arrival: staff?.troops ?? transfer.arrival,
      governor: holding.governor, candidate: staff?.candidate, staffBlocker: staff?.blocker,
      aidBlocker: transfer?.blocker, progress: staff?.after ?? transfer.progress,
      steps: aid.steps.filter(({ order }) => order.to === city),
    };
  }).sort((a, b) => Number(a.pending) - Number(b.pending));
  return { rows, transfers, assignments: staffing.assignments, ended: aid.ended, grain: aid.grain, closingGrain: aid.closingGrain };
}

function appendOccupationTransfers(world, state, transfers) {
  return transfers.length ? replaceOrders(world, state, [...state.orders, ...transfers]) : state;
}

export function applyOccupationTakeover(world, state, { transfers, assignments }) {
  const queued = appendOccupationTransfers(world, state, transfers);
  return appointOccupationGovernors(world, queued, assignments).state;
}

export function canInspectOccupation(state, entry) {
  if (entry.type !== "capture" || entry.faction !== state.player) return false;
  const holding = state.cities[entry.city];
  if (holding?.owner !== state.player || !holding.occupation) return false;
  for (const report of [...state.history].reverse()) {
    const latest = report.entries.findLast(({ type, city }) => type === "capture" && city === entry.city);
    if (latest) return latest === entry;
  }
  return false;
}
