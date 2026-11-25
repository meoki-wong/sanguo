import { cityName, cityRevenues, firstCity, gameOutcome } from "./engine.js";
import { dynastyPolicy } from "./dynasty.js";
import { hasPassage, openRoadEdge } from "./grand-logistics.js";
import { roadPath } from "./roads.js";
import { edgeWeather, edgeKey } from "./landscape-terrain.js";
import { warBlockaded } from "./war-operations.js";
import { bounded, plain } from "./polities-data.js";
import { reignPolicy, recordReign } from "./reign.js";
import { leagueMarket, marketEmbargo } from "./reign-leagues.js";
import { treatyWith } from "./diplomacy.js";
import { retainedShare15 } from "./century.js";

export const marketCauses = { normal: "供给正常", harvest: "本地产量不足", store: "地方库存见底", blocked: "粮路阻断", camp: "军粮征发" };
const active = (row) => row.status === "travel" || row.status === "blocked";
const isOwn = (state, side, city) => state.cities[city]?.owner === side;
const stockLimit = 150;
const priceLimit = 300;
const indexCities = (world) => new Map(world.cities.map((city) => [city.key, city]));

export function taxSplit10(state, key, gross) {
  if (!state.reign?.blueprint) return { treasury: gross.treasury, grain: gross.grain, local: 0 };
  const policy = reignPolicy(state, state.cities[key].owner);
  const share = retainedShare15(state, key) ?? { central: 13, compact: 30, balanced: 22 }[policy.stateForm];
  const local = Math.floor(gross.grain * (warBlockaded(state, key) ? 65 : share) / 100);
  return { treasury: warBlockaded(state, key) ? Math.floor(gross.treasury * .7) : gross.treasury, grain: gross.grain - local, local };
}

function createMarket(state, key) {
  return { bins: Math.min(stockLimit, 12 + state.cities[key].farming * 2), goods: state.cities[key].commerce,
    price: 100, cause: "normal", produced: 0, paid: 0, consumed: 0, missing: 0 };
}

export function marketRow(state, key) {
  return state.reign?.markets[key] ?? createMarket(state, key);
}

export function marketHealth(state, side) {
  const result = { stores: 0, shortage: 0, sustained: 0, output: 0, price: 100, places: 0 };
  let index = 0;
  for (const [key, city] of Object.entries(state.cities)) {
    if (city.owner !== side) continue;
    const row = marketRow(state, key);
    result.places++;
    result.stores += row.bins;
    result.shortage += Number(row.cause !== "normal");
    result.output += row.produced;
    index += row.price;
    if (!city.occupation && row.bins >= 3 && row.price <= 175 && state.realm.cities[key].welfare >= 49) result.sustained++;
  }
  if (result.places) result.price = Math.round(index / result.places);
  return result;
}

export function marketRoute(world, state, side, from, to) {
  if (from === to) return null;
  const graph = indexCities(world);
  const access = (key) => {
    const row = state.cities[key];
    if (!row || row.occupation || warBlockaded(state, key)) return false;
    const owner = row.owner;
    if (owner === side) return true;
    return !marketEmbargo(state, side, owner) && (hasPassage(state, side, key) || leagueMarket(state, side, owner));
  };
  if (!access(from) || !access(to)) return null;
  return ["land", "water"].flatMap((mode) => {
    const route = roadPath(graph, from, to, access, 10, (a, b) => openRoadEdge(state, side, a, b, false, mode));
    return route ? [{ route, mode }] : [];
  }).sort((a, b) => a.route.length - b.route.length)[0] ?? null;
}

export function marketLines(world, state, side = state.player) {
  return world.cities.filter(({ key }) => isOwn(state, side, key)).map((city) => ({ ...city, ...marketRow(state, city.key) }))
    .sort((a, b) => b.price - a.price || a.bins - b.bins || a.key.localeCompare(b.key));
}

export function compactOptions(state, city) {
  if (!isOwn(state, state.player, city)) return [];
  return (state.polity?.formerOwners[city] ?? []).filter((key) => key !== state.player
    && Object.values(state.cities).some(({ owner }) => owner === key) && treatyWith(state, state.player, key));
}

export function establishTownCompact(state, city, partner) {
  if (!state.reign?.blueprint || gameOutcome(state) !== "ongoing" || !compactOptions(state, city).includes(partner)) {
    throw new Error("共治须由本方现管城与拥有既有属权的和约伙伴建立。");
  }
  const next = structuredClone(state);
  next.reign.compacts[city] = { side: state.player, partner, since: state.turn, until: state.turn + 6, served: 0 };
  return next;
}

function eligibleDonors(world, state, side, key, amount) {
  return world.cities.filter(({ key: city }) => key !== city && isOwn(state, side, city) && marketRow(state, city).bins >= amount + 7)
    .sort((a, b) => marketRow(state, b.key).bins - marketRow(state, a.key).bins);
}

function routeReceipt(state, row, transport) {
  row.cursor = 0;
  row.route = transport.route;
  row.mode = transport.mode;
  row.status = "travel";
}

function startShipment(world, state, side, to, amount, kind, cap, entries, budget) {
  const freights = state.reign.freights;
  if (freights.some((row) => row.side === side && row.to === to && active(row))
    || freights.filter((row) => row.side === side && active(row)).length >= cap) return false;
  if (freights.length >= 42) {
    const evict = freights.findIndex((row) => !active(row));
    if (evict < 0) return false;
    freights.splice(evict, 1);
  }
  const donors = eligibleDonors(world, state, side, to, amount);
  let choice = null;
  for (const town of donors.slice(0, 10)) {
    const order = marketRoute(world, state, side, town.key, to);
    if (order && (!choice || order.route.length < choice.route.length)) choice = { ...order, from: town.key };
    if (order?.route.length === 2) break;
  }
  if (!choice) return false;
  const cost = Math.min(8, choice.route.length + 1);
  if (!budget(cost, 0)) return false;
  const row = { id: state.reign.serial++, side, from: choice.from, to, amount, kind, started: state.turn, held: 0 };
  routeReceipt(state, row, choice);
  (state.reign.markets[row.from] ??= createMarket(state, row.from)).bins -= amount;
  freights.push(row);
  recordReign(state, entries, "cargo", to, cityName(world, row.from) + "发出" + (kind === "trade" ? "互市" : "赈济") + "粮 " + amount + "，预计 " + (row.route.length - 1) + " 季。",
    { side });
  return true;
}

export function orderMarketRelief(state, city) {
  if (!state.reign?.blueprint || gameOutcome(state) !== "ongoing" || !isOwn(state, state.player, city)) throw new Error("请选择本方城市，先颁布国策。");
  const next = structuredClone(state);
  if (next.reign.relief.length >= 6 && !next.reign.relief.includes(city)) throw new Error("当前赈济命令已满，待转运开办后可追加。");
  if (!next.reign.relief.includes(city)) next.reign.relief.push(city);
  return next;
}

function traceTraffics(world, state, entries, ledger, forecast) {
  const edges = new Map();
  const armyRoutes = new Map();
  for (const army of state.armies ?? []) {
    if (!army.route[1] || !["march", "retreat"].includes(army.phase)) continue;
    const edge = edgeKey(army.route[0], army.route[1]);
    armyRoutes.set(edge, 1 + (armyRoutes.get(edge) ?? 0));
  }
  const movers = state.reign.freights.filter((row) => active(row) && (!forecast || row.side === state.player));
  for (const row of movers) {
    const current = row.route[row.cursor];
    const next = row.route[row.cursor + 1];
    const market = state.reign.markets[row.to] ??= createMarket(state, row.to);
    const owner = state.cities[row.to].owner;
    if (row.kind === "relief" && owner !== row.side || row.kind === "trade" && !leagueMarket(state, row.side, owner)
      || !hasPassage(state, row.side, current)) {
      row.status = "lost";
      const fallback = state.reign.markets[current];
      if (isOwn(state, row.side, current) && fallback) fallback.bins = Math.min(stockLimit, fallback.bins + row.amount);
      recordReign(state, entries, "cargo-lost", row.to, "通行权或目的地易手，粮队已停运。", { side: row.side });
      continue;
    }
    const leg = edgeKey(current, next);
    const narrow = edgeWeather(state, current, next).terrain;
    const allowance = narrow ? 2 : 3;
    const canPass = !marketEmbargo(state, row.side, state.cities[next].owner) && hasPassage(state, row.side, next)
      && !state.cities[next].occupation && !warBlockaded(state, next) && openRoadEdge(state, row.side, current, next, false, row.mode);
    if (!canPass || (edges.get(leg) ?? 0) + (armyRoutes.get(leg) ?? 0) >= allowance) {
      const alternative = !canPass && marketRoute(world, state, row.side, current, row.to);
      if (alternative && alternative.route[1] !== next) {
        routeReceipt(state, row, alternative);
        recordReign(state, entries, "cargo-reroute", row.to, cityName(world, current) + "前方不通，粮队已改道。", { side: row.side });
      } else {
        row.status = "blocked";
        row.held++;
        if (row.kind === "relief" && owner === row.side) market.cause = "blocked";
        if (row.held === 1) recordReign(state, entries, "market", row.to, cityName(world, row.to) + "粮队受战事、封关或军道拥堵所阻。",
          { side: row.side, critical: market.bins <= 4 });
        if (row.held >= 4) {
          row.status = "stored";
          if (isOwn(state, row.side, current)) {
            const store = state.reign.markets[current] ??= createMarket(state, current);
            store.bins = Math.min(stockLimit, store.bins + row.amount);
          }
        }
      }
      continue;
    }
    edges.set(leg, 1 + (edges.get(leg) ?? 0));
    if (row.kind === "trade" && row.cursor === row.route.length - 2
      && state.factions[owner].treasury - reignPolicy(state, owner).reserve < Math.floor(row.amount * market.price / 190)) {
      row.status = "blocked";
      row.held++;
      if (row.held >= 4) {
        row.status = "stored";
        const depot = state.reign.markets[current] ??= createMarket(state, current);
        if (isOwn(state, row.side, current)) depot.bins = Math.min(stockLimit, depot.bins + row.amount);
      }
      continue;
    }
    row.cursor++;
    row.held = 0;
    row.status = "travel";
    if (row.cursor !== row.route.length - 1) continue;
    row.status = "delivered";
    if (row.kind === "trade") {
      const buyer = state.factions[owner];
      const value = Math.floor(row.amount * market.price / 190);
      if (value > 0) {
        buyer.treasury -= value;
        state.factions[row.side].treasury += value;
        if (owner === state.player) ledger.out.treasury += value;
        if (row.side === state.player) ledger.in.treasury += value;
      }
    }
    market.bins = Math.min(stockLimit, market.bins + row.amount);
    if (market.bins >= 5) market.cause = "normal";
    recordReign(state, entries, "cargo-arrive", row.to, cityName(world, row.to) + "接收入仓粮 " + row.amount + "。", { side: row.side });
  }
}

function collectMarkets(world, previous, state, forecast) {
  const data = state.reign;
  for (const { key } of world.cities) {
    const town = state.cities[key];
    if (forecast && town.owner !== state.player) continue;
    const row = data.markets[key] ??= createMarket(previous, key);
    const tax = cityRevenues(previous, key);
    const changedHands = town.owner !== previous.cities[key].owner;
    row.produced = tax.local;
    row.paid = tax.grain;
    row.bins = Math.min(stockLimit, row.bins + tax.local);
    if (changedHands) row.bins = Math.floor(row.bins * .75);
    row.goods = Math.min(stockLimit, row.goods + (town.occupation ? 0 : Math.floor(town.commerce / 2)));
    const needs = 2 + Number(state.realm.cities[key].population >= 11000) + Number(town.occupation > 0) + Number(warBlockaded(state, key));
    const used = Math.min(needs, row.bins);
    row.consumed = used;
    row.bins -= used;
    row.missing = needs - used;
    row.cause = row.bins >= 4 ? "normal" : warBlockaded(state, key) ? "blocked"
      : tax.local < 2 ? "harvest" : "store";
    row.price = Math.min(priceLimit, Math.max(70, Math.round((row.price + (row.missing ? 180 : row.bins < 4 ? 145 : row.bins < 9 ? 112 : 91)) / 2)));
    if (row.missing && !town.occupation) state.realm.cities[key].welfare = Math.max(10, state.realm.cities[key].welfare - Math.min(3, row.missing));
    if (row.goods >= 10 && town.troops >= 800 && !town.occupation && row.bins >= 8) {
      row.goods -= 4;
      state.landscape.equipment[key] = Math.min(240, (state.landscape.equipment[key] ?? 0) + 2);
    }
  }
}

function requisition(world, state, side, ledger, entries, budget) {
  if (side !== state.player || !state.reign.emergency) return;
  const quota = Math.floor(reignPolicy(state, side).annualLevy / 4);
  let room = quota;
  const supply = new Set((state.armies ?? []).filter((army) => army.faction === side && ["march", "muster"].includes(army.phase))
    .map(({ depot }) => depot));
  for (const key of supply) {
    const market = state.reign.markets[key];
    if (!market || !isOwn(state, side, key)) continue;
    const stocks = state.grand.depots[key] ?? 0;
    const retained = reignPolicy(state, side).stateForm === "central" ? 5 : 9;
    const amount = Math.max(0, Math.min(8, room, market.bins - retained, 300 - stocks));
    if (!amount || !budget(2, 0)) continue;
    state.grand.depots[key] = stocks + amount;
    market.bins -= amount;
    room -= amount;
    if (market.bins < 9) {
      market.cause = "camp";
      state.realm.cities[key].welfare = Math.max(10, state.realm.cities[key].welfare - 2);
      recordReign(state, entries, "levy", key, cityName(world, key) + "补军仓 " + amount + " 粮，民仓已逼近储粮线。", { side, critical: market.bins <= 5 });
    }
  }
}

export function settleMarkets(world, previous, state, entries, ledger, forecast) {
  collectMarkets(world, previous, state, forecast);
  traceTraffics(world, state, entries, ledger, forecast);
  const data = state.reign;
  for (const [key, compact] of Object.entries(data.compacts)) {
    const partner = state.factions[compact.partner];
    const market = data.markets[key];
    if (compact.until <= state.turn || !isOwn(state, compact.side, key) || !treatyWith(state, compact.side, compact.partner)) {
      delete data.compacts[key];
      continue;
    }
    if (!market || market.bins < 6 || partner.treasury < 10 || warBlockaded(state, key)) continue;
    market.bins -= 2;
    partner.treasury -= 2;
    partner.grain += 2;
    state.factions[compact.side].treasury += 2;
    if (compact.side === state.player) ledger.in.treasury += 2;
    state.realm.cities[key].welfare = Math.min(100, state.realm.cities[key].welfare + 4);
    compact.served++;
    recordReign(state, entries, "compact", key, cityName(world, key) + "完成本季共治，互拨两份修缮资金和口粮。");
  }
  const side = state.player;
  const main = reignPolicy(state, side);
  const staff = state.realm.offices.civil?.holder && data.offices.civil;
  let coins = Math.min(main.relief, staff ? (staff.term > state.turn ? staff.cap : 0) : main.relief);
  let grain = main.grain;
  const pay = (money, food) => {
    const resources = state.factions[side];
    if (money > coins || food > grain || resources.treasury - money < Math.max(main.reserve, dynastyPolicy(state).moneyFloor)
      || resources.grain - food < main.reserve) return false;
    coins -= money;
    grain -= food;
    resources.treasury -= money;
    resources.grain -= food;
    ledger.budget.treasury += money;
    ledger.budget.grain += food;
    return true;
  };
  requisition(world, state, side, ledger, entries, pay);
  const shortage = marketLines(world, state).filter(({ bins }) => bins < main.stock);
  const targets = [...new Set([...data.relief, ...shortage.filter(({ region }) => data.seats[region]?.dispatch && data.seats[region].end > state.turn)
    .slice(0, 3).map(({ key }) => key)])];
  const sent = new Set();
  for (const key of targets) {
    if (!isOwn(state, side, key)) { sent.add(key); continue; }
    const row = data.markets[key];
    const province = world.cities.find((city) => city.key === key).region;
    if (row.bins >= main.stock + 8) { sent.add(key); continue; }
    if (startShipment(world, state, side, key, 10, "relief", main.freight, entries, pay)) { sent.add(key); continue; }
    if (data.freights.some((entry) => entry.to === key && active(entry))) { sent.add(key); continue; }
    const depot = state.grand.depots[key] ?? 0;
    if (depot >= 6 && pay(2, 0)) {
      state.grand.depots[key] -= 6;
      row.bins = Math.min(stockLimit, row.bins + 6);
      row.cause = "normal";
      sent.add(key);
      recordReign(state, entries, "relief", key, cityName(world, key) + "依委任将本地军仓 6 粮转入民仓。", { side });
    } else if (key === firstCity(world, state) && pay(2, 6)) {
      row.bins = Math.min(stockLimit, row.bins + 6);
      row.cause = "normal";
      sent.add(key);
    } else if (row.bins <= 2) recordReign(state, entries, "market", key, cityName(world, key) + "缺粮。"
      + (row.cause === "blocked" ? "补给通路受阻。" : "可用仓粮或赈济额度不足。"), { side, critical: true, region: province });
  }
  data.relief = data.relief.filter((key) => !sent.has(key));
  if (state.turn % 3 === 2 && main.objective === "concord") {
    const partner = world.cities.find(({ key }) => !isOwn(state, side, key) && marketRow(state, key).bins <= 9 && leagueMarket(state, side, state.cities[key].owner));
    if (partner) startShipment(world, state, side, partner.key, 8, "trade", main.freight, entries, pay);
  }
}

export function validMarkets(world, state, data) {
  const graph = indexCities(world);
  const city = (key) => graph.has(key);
  return plain(data.compacts) && Object.entries(data.compacts).every(([key, row]) => city(key) && plain(row)
    && row.side === state.player && row.partner !== row.side && Object.hasOwn(state.factions, row.partner)
    && bounded(row.since, data.since, state.turn) && row.until === row.since + 6 && bounded(row.served, 0, 6))
    && plain(data.markets) && Object.entries(data.markets).every(([key, row]) => city(key) && plain(row)
    && ["bins", "goods", "produced", "paid", "consumed", "missing"].every((field) => bounded(row[field], 0, stockLimit))
    && bounded(row.price, 70, priceLimit) && Object.hasOwn(marketCauses, row.cause))
    && Array.isArray(data.relief) && data.relief.length <= 6 && new Set(data.relief).size === data.relief.length && data.relief.every(city)
    && Array.isArray(data.freights) && data.freights.length <= 42 && data.freights.every((row) => plain(row)
      && bounded(row.id, 1, data.serial - 1) && Object.hasOwn(state.factions, row.side) && city(row.from) && city(row.to)
      && bounded(row.amount, 1, 45) && bounded(row.started, data.since, state.turn) && bounded(row.held, 0, 4)
      && ["relief", "trade"].includes(row.kind) && ["travel", "blocked", "delivered", "lost", "stored"].includes(row.status)
      && ["land", "water"].includes(row.mode) && Array.isArray(row.route) && bounded(row.route.length, 2, 11)
      && row.route.at(-1) === row.to && row.route.every((key, index) => city(key) && (!index || graph.get(row.route[index - 1]).links.includes(key)))
      && bounded(row.cursor, 0, row.route.length - 1 - Number(active(row))));
}
