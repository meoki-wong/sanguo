import { cityName, firstCity, gameOutcome } from "./engine.js";
import { crossesGate, crossings, dispatchRoute, gateOwner, hasPassage } from "./grand-logistics.js";
import { roadPath } from "./roads.js";
import { warBlockaded } from "./war-operations.js";
import { routeWeather, travelModes, weatherAllows } from "./landscape-terrain.js";
import { dynastyPass } from "./dynasty-treaties.js";

export const commodities = { grain: "军粮", equipment: "军械" };
export const regionalPolicies = { equipment: "军械工坊", market: "商埠互市", recovery: "赈济修复" };
const number = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const own = (state, faction, key) => state.cities[key]?.owner === faction;
const stable = (state, key) => state.cities[key] && !state.cities[key].occupation && !warBlockaded(state, key);

export function marketAccess(state, a, b) {
  return dynastyPass(state, a, b) || state.landscape?.congresses.some((record) => record.status === "active" && record.market
    && record.parties.includes(a) && record.parties.includes(b) && state.turn < record.until);
}

export function convoyRoute(world, state, faction, from, to, mode) {
  if (!state.landscape || !Object.hasOwn(travelModes, mode) || from === to || !own(state, faction, from)) return null;
  const usable = (key) => stable(state, key) && (hasPassage(state, faction, key) || marketAccess(state, faction, state.cities[key].owner));
  if (!usable(from) || !usable(to)) return null;
  return roadPath(new Map(world.cities.map((city) => [city.key, city])), from, to, usable, 12,
    (a, b) => crossesGate(state, faction, a, b) && weatherAllows(state, a, b, mode));
}

export function quoteConvoy(world, state, shipment) {
  const { faction, from, to, mode, cargo, amount } = shipment;
  const route = convoyRoute(world, state, faction, from, to, mode);
  if (!route || !Object.hasOwn(commodities, cargo) || !number(amount, 1, 200)) return null;
  const national = dispatchRoute(world, state, faction, from)
    ? Math.max(0, state.factions[faction].grain - (faction === state.player ? state.grand.national.reserve : 0)) : 0;
  const source = cargo === "equipment" ? state.landscape.equipment[from] ?? 0
    : (state.grand.depots[from] ?? 0) + national;
  const capacity = cargo === "equipment" ? 1000 - (state.landscape.equipment[to] ?? 0) : 300 - (state.grand.depots[to] ?? 0);
  const freight = 2 + (route.length - 1) * (mode === "water" ? 1 : 2) + routeWeather(state, route, mode);
  return { route, freight, source, capacity, affordable: source >= amount && capacity >= amount && state.factions[faction].treasury >= freight };
}

export function prepareConvoy(world, state, draft) {
  const { from, to, mode, cargo, amount } = draft;
  const shipment = { faction: state.player, from, to, mode, cargo, amount };
  const quote = quoteConvoy(world, state, shipment);
  if (gameOutcome(state) !== "ongoing" || !quote?.affordable) throw new Error("需要稳定可通行的粮道、足量物资和运费。");
  const next = structuredClone(state);
  const data = next.landscape;
  if (data.convoys.filter(({ status }) => status === "queued").length >= 6) throw new Error("最多可安排六支待发运输队。");
  if (data.convoys.some((row) => row.status === "queued" && row.from === from && row.to === to && row.cargo === cargo)) {
    throw new Error("该粮道已有同类物资待发。");
  }
  data.convoys.push({ ...shipment, id: data.sequence++, turn: next.turn, route: quote.route, status: "queued" });
  if (data.convoys.length > 30) data.convoys.splice(data.convoys.findIndex(({ status }) => status !== "queued"), 1);
  return next;
}

export function cancelConvoy(state, id) {
  if (gameOutcome(state) !== "ongoing") throw new Error("战局已结束。");
  const next = structuredClone(state);
  const row = next.landscape?.convoys.find((entry) => entry.id === id && entry.faction === state.player && entry.status === "queued");
  if (!row) throw new Error("只能取消本方待发的运输。");
  row.status = "cancelled";
  return next;
}

export function orderBridge(state, key) {
  const gate = crossings.find((item) => item.key === key);
  if (gameOutcome(state) !== "ongoing" || !state.landscape || !gate || gateOwner(state, gate) !== state.player) {
    throw new Error("只能整修本方控制的关隘。");
  }
  if (state.landscape.bridges[key] || state.landscape.repairs.includes(key)) throw new Error("这处工事已加固或已列入修复令。");
  return { ...state, landscape: { ...state.landscape, repairs: [...state.landscape.repairs, key] } };
}

export function setRegionalPolicy(world, state, region, policy) {
  if (gameOutcome(state) !== "ongoing" || !state.landscape || (policy && !Object.hasOwn(regionalPolicies, policy))
    || !world.cities.some((city) => city.region === region && own(state, state.player, city.key))) throw new Error("请选择本方州郡与有效方针。");
  const next = structuredClone(state);
  const policies = next.landscape.policies[next.player] ??= {};
  if (policy) policies[region] = policy;
  else delete policies[region];
  return next;
}

export function issueEquipment(state, from, troops) {
  if (!state.landscape) return 0;
  const depot = state.landscape.equipment;
  const issued = Math.min(depot[from] ?? 0, Math.ceil(troops / 250));
  depot[from] = (depot[from] ?? 0) - issued;
  return issued;
}

export function settleEconomy(world, state, account, entries) {
  const data = state.landscape;
  const note = (faction, city, text) => entries.push({ type: "notice", faction, city, text });
  for (const key of data.repairs) {
    const gate = crossings.find((entry) => entry.key === key);
    if (gateOwner(state, gate) !== state.player || !stable(state, gate.seat)
      || !account(state.player, "budget", { treasury: 24, grain: 8 })) {
      note(state.player, gate.seat, gate.name + "修复未开工，需控制关隘并备足 24 钱、8 粮。");
      continue;
    }
    data.bridges[key] = 1;
    note(state.player, gate.seat, gate.name + "完成加固，汛期和雪季通行改善。");
  }
  data.repairs = [];
  for (const shipment of data.convoys.filter(({ status }) => status === "queued")) {
    if (state.frontline && shipment.heldAt === state.turn) continue;
    const { faction, from, to, amount, cargo } = shipment;
    const quote = quoteConvoy(world, state, shipment);
    if (!quote?.affordable) {
      if (state.turn - shipment.turn >= 2 || !own(state, faction, from)) shipment.status = "blocked";
      note(faction, from, cityName(world, to) + "运输" + (shipment.status === "blocked" ? "取消" : "待发")
        + "，" + (quote && quote.capacity < amount ? "目的地库容不足。" : "道路或库藏不足。"));
      continue;
    }
    const receiver = state.cities[to].owner;
    const commerce = receiver !== faction;
    const local = cargo === "grain" ? Math.min(amount, state.grand.depots[from] ?? 0) : 0;
    account(faction, "budget", { treasury: quote.freight, grain: cargo === "grain" ? amount - local : 0 });
    if (cargo === "equipment") {
      data.equipment[from] -= amount;
      data.equipment[to] = (data.equipment[to] ?? 0) + amount;
    } else {
      if (local) state.grand.depots[from] -= local;
      state.grand.depots[to] = (state.grand.depots[to] ?? 0) + amount;
    }
    if (commerce) account(faction, "in", { treasury: Math.ceil(amount / 4), grain: 0 });
    Object.assign(shipment, { status: "delivered", route: quote.route, settled: state.turn, freight: quote.freight });
    note(faction, to, cityName(world, to) + "入库 " + amount + " " + commodities[cargo] + "，" + travelModes[shipment.mode] + "运费 " + quote.freight + " 钱。");
  }
  for (const [faction, stock] of Object.entries(state.factions)) {
    const owned = world.cities.filter(({ key }) => own(state, faction, key) && stable(state, key));
    if (!owned.length) continue;
    const policies = data.policies[faction] ?? {};
    for (const region of new Set(owned.map((city) => city.region))) {
      const sites = owned.filter((city) => city.region === region).sort((a, b) =>
        state.cities[b.key].commerce - state.cities[a.key].commerce);
      const hub = sites[0].key;
      const city = state.cities[hub];
      const policy = policies[region] ?? (faction === state.player ? null : stock.grain < 40 ? "recovery" : "equipment");
      if (policy === "equipment" && account(faction, "budget", { treasury: 5, grain: 0 })) {
        data.equipment[hub] = Math.min(1000, (data.equipment[hub] ?? 0) + 3 + city.commerce);
      }
      if (policy === "market") {
        const linked = world.cities.some(({ key }) => key !== hub && (own(state, faction, key) || marketAccess(state, faction, state.cities[key].owner))
          && (convoyRoute(world, state, faction, hub, key, "land")
          || convoyRoute(world, state, faction, hub, key, "water")));
        if (linked) account(faction, "in", { treasury: 3 + city.commerce * 2, grain: 0 });
      }
      if (policy === "recovery" && account(faction, "budget", { treasury: 4, grain: 5 })) {
        const residents = state.realm.cities[hub];
        residents.welfare = Math.min(100, residents.welfare + 3);
        if (faction === state.player) note(faction, hub, cityName(world, hub) + "开仓赈济，民生改善。");
      }
    }
  }
}

export function initialEquipment(world, state) {
  return Object.fromEntries(Object.keys(state.factions).filter((faction) =>
    world.cities.some(({ key }) => own(state, faction, key))).map((faction) => [firstCity(world, state, faction), 14]));
}

export function validEconomy(world, state, data) {
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const gateKeys = new Set(crossings.map(({ key }) => key));
  const graph = new Map(world.cities.map(({ key, links }) => [key, links]));
  const city = (key) => graph.has(key);
  const regions = new Set(world.cities.map(({ region }) => region));
  const faction = (key) => Object.hasOwn(state.factions, key);
  return object(data.bridges) && Object.entries(data.bridges).every(([key, value]) => gateKeys.has(key) && number(value, 1, 2))
    && Array.isArray(data.repairs) && new Set(data.repairs).size === data.repairs.length && data.repairs.every((key) => gateKeys.has(key))
    && object(data.equipment) && Object.entries(data.equipment).every(([key, value]) => city(key) && number(value, 0, 1000))
    && object(data.policies) && Object.entries(data.policies).every(([key, rules]) => faction(key) && object(rules)
      && Object.entries(rules).every(([region, policy]) => regions.has(region) && Object.hasOwn(regionalPolicies, policy)))
    && Array.isArray(data.convoys) && data.convoys.length <= 30 && new Set(data.convoys.map((row) => row?.id)).size === data.convoys.length
    && data.convoys.every((row) => row && number(row.id, 1, data.sequence - 1) && number(row.turn, data.since, state.turn)
      && faction(row.faction) && city(row.from) && city(row.to) && Object.hasOwn(travelModes, row.mode) && Object.hasOwn(commodities, row.cargo)
      && number(row.amount, 1, 200) && ["queued", "delivered", "blocked", "cancelled"].includes(row.status)
      && Array.isArray(row.route) && row.route.length >= 2 && row.route.length <= 13 && row.route[0] === row.from && row.route.at(-1) === row.to
      && row.route.every((key, index) => city(key) && (!index || graph.get(row.route[index - 1]).includes(key)))
      && (row.status !== "delivered" || (number(row.settled, row.turn, state.turn) && number(row.freight, 1, 100))));
}
