import { cityIncome, cityName, eraByYear, firstCity, gameOutcome, postingOf } from "./engine.js";
import { hasPassage, openRoadEdge } from "./grand-logistics.js";
import { provinceRows } from "./polity-governance.js";
import { bounded, plain } from "./polities-data.js";
import { noteRecruitment } from "./realm.js";
import { roadPath } from "./roads.js";
import { warBlockaded } from "./war-operations.js";
import { workforceYield } from "./sandtable-economy.js";
import { dynastyLevyRefused, dynastyPolicy, dynastyReport, dynastyUrgent } from "./dynasty.js";

export const nationalProjects = {
  fields: "整复田亩", navigation: "开辟水陆转运", frontier: "整顿边防", capital: "迁置治所",
};
export const projectStages = ["勘定", "兴工", "试运", "验收"];
export const mandateGoals = { growth: "发展生产", defense: "地方守备", relief: "保粮赈济" };
export const restorationPolicies = { direct: "朝廷接管", retention: "留任地方官", phased: "分期整顿" };
export const calamities = { drought: "旱灾", flood: "水灾" };
export const supplyLabels = { productive: "本地供给", stores: "库藏可调", enroute: "在途补给",
  failed: "产出不足", blocked: "通路中断", empty: "库存不足" };
const own = (state, side, key) => state.cities[key]?.owner === side;
const active = (row) => ["march", "blocked"].includes(row.status);
const count = (value, max) => bounded(value, 0, max);
const reliefSeats = new Set(["jiangling", "jiangxia", "lujiang", "chaisang", "moling", "shanyin"]);
const specifications = {
  fields: { treasury: 10, grain: 5, tick: 2 },
  navigation: { treasury: 13, grain: 3, tick: 2 },
  frontier: { treasury: 10, grain: 7, tick: 2 },
  capital: { treasury: 17, grain: 7, tick: 2 },
};
const siteOf = (state, key) => state.dynasty.sites[key] ??= { fields: 0, routes: 0, watch: 0, calamity: null };

export function provinceCandidates(world, state, region) {
  const cities = new Set(provinceRows(world, state).find((row) => row.region === region)?.cities ?? []);
  return eraByYear(world, state).officers.filter((person) => person.faction === state.player && cities.has(state.stations[person.key]))
    .sort((a, b) => b.governance - a.governance);
}

export function authorizeProvince(world, state, draft) {
  const province = provinceRows(world, state).find((row) => row.region === draft?.region);
  if (!state.dynasty || gameOutcome(state) !== "ongoing" || !province || !validMandate(draft)
    || draft.steward && !provinceCandidates(world, state, draft.region).some(({ key }) => key === draft.steward)) {
    throw new Error("请选择本方州郡、可用州牧及授权额度。");
  }
  const next = structuredClone(state);
  const policy = Object.fromEntries(["region", "steward", "goal", "money", "grain", "dispatch", "appoint", "mode"].map((key) => [key, draft[key]]));
  const reports = next.dynasty.mandates[next.player] ??= {};
  reports[policy.region] = policy;
  return next;
}

export function delegateRealm(world, state) {
  if (!state.dynasty || gameOutcome(state) !== "ongoing") throw new Error("当前无法设定全国委任。");
  const next = structuredClone(state);
  const policy = dynastyPolicy(state);
  const mandates = next.dynasty.mandates[state.player] ??= {};
  for (const { region } of provinceRows(world, next)) {
    mandates[region] ??= { region, steward: null, goal: policy.priority, money: 10, grain: 7, dispatch: true,
      appoint: true, mode: "delegate" };
  }
  return next;
}

function validMandate(row) {
  return plain(row) && (row.steward === null || typeof row.steward === "string") && Object.hasOwn(mandateGoals, row.goal)
    && count(row.money, 70) && count(row.grain, 70) && typeof row.dispatch === "boolean"
    && typeof row.appoint === "boolean" && ["direct", "delegate"].includes(row.mode);
}

export function projectCost(kind) {
  return specifications[kind];
}

export function programTargets(world, state, kind, side = state.player) {
  const capital = firstCity(world, state, side);
  return world.cities.filter(({ key }) => own(state, side, key)
    && (kind !== "capital" || key !== capital && !state.cities[key].occupation && state.cities[key].troops >= 500)
    && !state.dynasty.programs.some((row) => row.side === side && row.kind === kind && row.city === key && ["active", "paused"].includes(row.status)));
}

export function commissionProgram(world, state, draft) {
  const { kind, city, money, grain } = draft;
  if (!state.dynasty || gameOutcome(state) !== "ongoing" || !Object.hasOwn(nationalProjects, kind)
    || !programTargets(world, state, kind).some(({ key }) => key === city) || !count(money, 800) || !count(grain, 600)) {
    throw new Error("请选择可实施工程的本方城市及有效钱粮上限。");
  }
  const next = structuredClone(state);
  addProgram(world, next, state.player, { kind, city, money, grain });
  return next;
}

function addProgram(world, state, side, { kind, city, money, grain }) {
  const data = state.dynasty;
  if (data.programs.filter((row) => row.side === side && ["active", "paused"].includes(row.status)).length >= 3) throw new Error("每个势力可同时主持三项工程。");
  if (kind === "capital" && data.programs.some((row) => row.side === side && row.kind === "capital" && ["active", "paused"].includes(row.status))) {
    throw new Error("已有迁都工程在案。");
  }
  if (data.programs.length >= 36) {
    const oldest = data.programs.findIndex((row) => ["complete", "cancelled"].includes(row.status));
    if (oldest === -1) throw new Error("工程档案已满，待现有工程完成即可增设。");
    data.programs.splice(oldest, 1);
  }
  const region = world.cities.find(({ key }) => key === city).region;
  data.programs.push({ id: data.serial++, side, kind, city, region, money, grain, spentMoney: 0, spentGrain: 0,
    made: 0, started: state.turn, last: null, status: "active" });
}

export function reviseProgram(state, id, draft) {
  if (!state.dynasty || gameOutcome(state) !== "ongoing") throw new Error("当前无法调整工程。");
  const next = structuredClone(state);
  const row = next.dynasty.programs.find((entry) => entry.id === id && entry.side === state.player && ["active", "paused"].includes(entry.status));
  if (!row) throw new Error("没有可调整的工程。");
  if (draft.action === "cancel") row.status = "cancelled";
  else if (draft.action === "pause") row.status = "paused";
  else if (draft.action === "resume") row.status = "active";
  else if (count(draft.money, 800) && count(draft.grain, 600) && draft.money >= row.spentMoney && draft.grain >= row.spentGrain) {
    Object.assign(row, { money: draft.money, grain: draft.grain });
  } else throw new Error("新拨款不得低于已发生的支出。");
  return next;
}

export function dynastyYield(state, key) {
  const site = state.dynasty?.sites[key];
  if (!site) return { money: 1, grain: 1, extra: 0 };
  const calamity = site.calamity?.until > state.turn ? site.calamity : null;
  return { money: calamity?.kind === "flood" ? 1 - calamity.level / 160 : 1,
    grain: calamity ? Math.max(.38, 1 - calamity.level / 100) : 1, extra: site.fields };
}

function routeAllowed(state, side, key) {
  const place = state.cities[key];
  const damage = state.dynasty.sites[key]?.calamity;
  return hasPassage(state, side, key) && !place.occupation && !warBlockaded(state, key)
    && !(damage?.kind === "flood" && damage.level >= 65 && damage.until > state.turn);
}

export function civilRoute(world, state, side, from, to) {
  if (from === to || !routeAllowed(state, side, from) || !routeAllowed(state, side, to)) return null;
  const graph = new Map(world.cities.map((city) => [city.key, city]));
  const routes = ["water", "land"].flatMap((mode) => {
    const route = roadPath(graph, from, to, (key) => routeAllowed(state, side, key), 10, (a, b) => openRoadEdge(state, side, a, b, false, mode));
    return route ? [{ route, mode }] : [];
  });
  return routes.sort((a, b) => a.route.length - b.route.length)[0] ?? null;
}

export function supplyTrace(world, state, city) {
  const depot = state.grand.depots[city] ?? 0;
  const damage = state.dynasty.sites[city]?.calamity;
  const side = state.cities[city].owner;
  const factor = dynastyYield(state, city);
  const production = Math.floor((cityIncome(state.cities[city], state.realm.cities[city]).grain * factor.grain + factor.extra * 2) * workforceYield(state, city));
  const incoming = state.dynasty.convoys.find((row) => row.to === city && row.side === side && active(row));
  const donors = world.cities.filter(({ key }) => key !== city && own(state, side, key) && (state.grand.depots[key] ?? 0) >= 12);
  const royal = firstCity(world, state, side);
  if (royal !== city && state.factions[side].grain - dynastyPolicy(state, side).grainFloor >= 12 && !donors.some(({ key }) => key === royal)) {
    donors.push({ key: royal });
  }
  const warehouse = donors.map(({ key }) => ({ key, connection: civilRoute(world, state, side, key, city) }))
    .filter(({ connection }) => connection).sort((a, b) => a.connection.route.length - b.connection.route.length)[0];
  const status = incoming ? incoming.status === "blocked" ? "blocked" : "enroute" : depot >= 12 ? "stores"
    : warehouse ? "stores" : donors.length ? "blocked" : damage?.until > state.turn || production < 4 ? "failed"
      : production >= 7 ? "productive" : "empty";
  return { depot, production, damage, incoming, depotOrigin: warehouse?.key ?? null,
    route: incoming?.route ?? warehouse?.connection.route ?? null, status,
    weather: incoming?.status === "blocked" ? incoming.reason : null };
}

function bestSource(world, state, side, city, amount) {
  const seat = firstCity(world, state, side);
  return world.cities.filter(({ key }) => own(state, side, key) && key !== city)
    .map(({ key, name }) => ({ key, name, bins: state.grand.depots[key] ?? 0,
      connection: civilRoute(world, state, side, key, city) }))
    .filter((row) => row.connection && (row.bins >= amount || row.key === seat))
    .sort((a, b) => Number(b.bins >= amount) - Number(a.bins >= amount) || a.connection.route.length - b.connection.route.length)[0];
}

function startConvoy(world, state, side, to, quantity, budget, entries, traceOwner) {
  const data = state.dynasty;
  if (data.convoys.some((row) => row.side === side && row.to === to && active(row))
    || data.convoys.filter((row) => row.side === side && active(row)).length >= 3
    || data.convoys.length >= 30 && data.convoys.every(active)) return false;
  const source = bestSource(world, state, side, to, quantity);
  if (!source) {
    dynastyUrgent(world, state, entries, side, "supply", to, traceOwner + "找不到可通行的粮运线路，请开放关隘或改变转运目标。");
    return false;
  }
  const { route, mode } = source.connection;
  const local = Math.min(quantity, source.bins);
  const freight = Math.max(2, route.length + 2 - (data.sites[source.key]?.routes ?? 0));
  if (!budget(freight, quantity - local)) return false;
  if (local) state.grand.depots[source.key] -= local;
  if (data.convoys.length >= 30) {
    const finished = data.convoys.findIndex((row) => !active(row));
    if (finished >= 0) data.convoys.splice(finished, 1);
  }
  data.convoys.push({ id: data.serial++, side, from: source.key, to, amount: quantity, route, mode, cursor: 0,
    status: "march", started: state.turn, held: 0, reason: null });
  dynastyReport(world, state, entries, side, "freight", to, traceOwner + "从" + source.name + "发运 " + quantity + " 粮，运费 " + freight + " 钱。");
  return true;
}

function advanceConvoys(world, state, entries, onlyPlayer) {
  for (const row of state.dynasty.convoys.filter((convoy) => active(convoy) && (!onlyPlayer || convoy.side === state.player))) {
    const wait = state.strategy9?.freightWait;
    if (row.started === state.turn || wait?.turn === state.turn && wait.ids.includes(row.id)) continue;
    const location = row.route[row.cursor];
    if (!own(state, row.side, row.to) || !hasPassage(state, row.side, location)) {
      if (own(state, row.side, location)) state.grand.depots[location] = Math.min(300, (state.grand.depots[location] ?? 0) + row.amount);
      row.status = "lost";
      row.reason = "线路控制权变化";
      dynastyReport(world, state, entries, row.side, "freight", location, "粮运中止，仍控制的驻点接管车队余粮。");
      continue;
    }
    const to = row.route[row.cursor + 1];
    if (!routeAllowed(state, row.side, to) || !openRoadEdge(state, row.side, location, to, false, row.mode)) {
      const alternative = civilRoute(world, state, row.side, location, row.to);
      if (!alternative) {
        row.status = "blocked";
        row.reason = cityName(world, location) + "往" + cityName(world, to) + "暂不能通行";
        row.held += 1;
        if (row.held === 1) dynastyUrgent(world, state, entries, row.side, "supply", row.to,
          "粮队停在" + cityName(world, location) + "，去往" + cityName(world, row.to) + "的通路中断。");
        if (row.held >= 4) {
          row.status = "stored";
          if (own(state, row.side, location)) state.grand.depots[location] = Math.min(300, (state.grand.depots[location] ?? 0) + row.amount);
        }
        continue;
      }
      Object.assign(row, { ...alternative, cursor: 0 });
      dynastyReport(world, state, entries, row.side, "freight", location, "粮队按可通航路网改道。");
    }
    row.cursor++;
    row.held = 0;
    row.status = "march";
    row.reason = null;
    if (row.cursor < row.route.length - 1) continue;
    row.status = "delivered";
    const reserve = state.grand.depots[row.to] ?? 0;
    const unload = Math.min(row.amount, 300 - reserve);
    state.grand.depots[row.to] = reserve + unload;
    // Overflow is used at the destination rather than teleporting back into the central treasury.
    if (unload < row.amount) state.realm.cities[row.to].welfare = Math.min(100, state.realm.cities[row.to].welfare + Math.ceil((row.amount - unload) / 8));
    dynastyReport(world, state, entries, row.side, "freight", row.to, cityName(world, row.to) + "收到 " + row.amount + " 粮" + (unload < row.amount ? "，余粮就地赈济。" : "，已入仓。"));
  }
}

export function dispatchCivilSupply(world, state, city) {
  if (!state.dynasty || gameOutcome(state) !== "ongoing" || !own(state, state.player, city)) throw new Error("粮运目的地须由本方控制。");
  const next = structuredClone(state);
  const side = next.player;
  const policy = dynastyPolicy(next);
  const stock = next.factions[side];
  const pay = (money, grain) => {
    if (stock.treasury - money < policy.moneyFloor || stock.grain - grain < policy.grainFloor) return false;
    stock.treasury -= money;
    stock.grain -= grain;
    return true;
  };
  if (!startConvoy(world, next, side, city, 18, pay, null, "朝廷")) throw new Error("暂无可用粮仓、线路或调度额度。");
  return next;
}

function updateCalamities(world, state, entries, onlyPlayer) {
  if (state.turn > 0 && (state.turn + state.year) % 11 === 0) {
    const candidates = world.cities.filter(({ key }) => !state.dynasty.sites[key]?.calamity && !state.cities[key].occupation);
    const point = candidates.length ? candidates[(state.turn * 5 + state.year) % candidates.length] : null;
    if (point && (!onlyPlayer || own(state, state.player, point.key))) {
      const side = state.cities[point.key].owner;
      const kind = reliefSeats.has(point.key) ? "flood" : "drought";
      const level = 36 + (state.turn + point.key.length * 5) % 34;
      siteOf(state, point.key).calamity = { kind, level, until: state.turn + 4 };
      dynastyUrgent(world, state, entries, side, "calamity", point.key, point.name + "出现" + calamities[kind] + "，粮税将受影响四季。");
    }
  }
  for (const [key, site] of Object.entries(state.dynasty.sites)) {
    const side = state.cities[key].owner;
    if (!site.calamity || onlyPlayer && side !== state.player) continue;
    if (site.calamity.until <= state.turn) { site.calamity = null; continue; }
    const town = state.realm.cities[key];
    const local = Math.min(6, state.grand.depots[key] ?? 0);
    if (local) state.grand.depots[key] -= local;
    town.welfare = Math.max(0, Math.min(100, town.welfare + (local >= 6 ? 2 : -5)));
  }
}

function workProgram(world, state, row, budget, entries, paused) {
  if (!own(state, row.side, row.city)) {
    row.status = "cancelled";
    row.last = "工程地点易主，停止追加投入。";
    dynastyReport(world, state, entries, row.side, "program", row.city, row.last);
    return;
  }
  const quote = specifications[row.kind];
  if (state.cities[row.city].occupation || warBlockaded(state, row.city)) {
    row.last = "城市受战事影响，施工停滞。";
    return;
  }
  if (row.spentMoney + quote.treasury > row.money || row.spentGrain + quote.grain > row.grain) {
    row.last = "项目总预算已到上限。";
    return;
  }
  if (!budget(quote.treasury, quote.grain)) {
    row.last = paused ? "紧急调拨压缩了本季工程拨款。" : "钱粮触及授权额度或全国底线。";
    return;
  }
  row.spentMoney += quote.treasury;
  row.spentGrain += quote.grain;
  row.made++;
  const stage = Math.floor(row.made / quote.tick);
  row.last = "已拨 " + quote.treasury + " 钱、" + quote.grain + " 粮。";
  if (row.made % quote.tick) return;
  const city = state.cities[row.city];
  const town = state.realm.cities[row.city];
  const site = siteOf(state, row.city);
  if (stage >= 2 && row.kind === "fields") {
    site.fields = Math.min(5, site.fields + 1);
    town.welfare = Math.min(100, town.welfare + 4);
    if (state.sandtable.labor[row.city]) state.sandtable.labor[row.city] = Math.max(0, state.sandtable.labor[row.city] - 180);
  }
  if (stage >= 2 && row.kind === "navigation") {
    site.routes = Math.min(5, site.routes + 1);
    if (stage === 4) city.commerce = Math.min(5, city.commerce + 1);
  }
  if (stage >= 2 && row.kind === "frontier") {
    site.watch = Math.min(5, site.watch + 1);
    if (stage === 4) city.defense = Math.min(5, city.defense + 1);
  }
  if (stage >= 2 && row.kind === "capital") town.welfare = Math.min(100, town.welfare + 2);
  if (stage >= 4) {
    row.status = "complete";
    if (row.kind === "capital") state.dynasty.capitals[row.side] = row.city;
  }
  const detail = cityName(world, row.city) + "「" + nationalProjects[row.kind] + "」完成" + projectStages[stage - 1] + "。";
  dynastyReport(world, state, entries, row.side, "program", row.city, detail);
}

function stewardFor(world, state, province, order) {
  const named = order.steward;
  return named && province.cities.includes(state.stations[named]) && eraByYear(world, state, state.turn + 1).officers
    .some(({ key, faction }) => key === named && faction === province.faction) ? named
    : province.cities.map((key) => state.cities[key].governor).find(Boolean) ?? null;
}

function employSteward(world, state, side, province, entries, budget) {
  const city = province.cities.find((key) => !state.cities[key].governor && !state.cities[key].occupation);
  if (!city) return null;
  const candidate = eraByYear(world, state).officers.find((person) => person.faction === side && state.stations[person.key] === city
    && person.governance >= 50 && !postingOf(state, person.key) && !Object.values(state.realm.offices).some(({ holder }) => holder === person.key)
    && ![state.polity.courts[side]?.head, state.polity.courts[side]?.heir, state.polity.courts[side]?.regent].includes(person.key));
  if (!candidate || !budget(4, 0)) return null;
  state.cities[city].governor = candidate.key;
  dynastyReport(world, state, entries, side, "governor", city, province.region + "按委任补任太守" + candidate.name + "，支出 4 钱。");
  return candidate.key;
}

function runProvince(world, state, side, province, order, ledger, entries, priority) {
  if (order.mode !== "delegate") return;
  let money = order.money;
  let grain = order.grain;
  const pay = (t, g) => {
    if (t > money || g > grain || !ledger(t, g)) return false;
    money -= t;
    grain -= g;
    return true;
  };
  const steward = stewardFor(world, state, province, order)
    ?? (order.appoint ? employSteward(world, state, side, province, entries, pay) : null);
  if (!steward) return;
  const seats = province.cities.filter((key) => !warBlockaded(state, key))
    .sort((a, b) => state.realm.cities[a].welfare - state.realm.cities[b].welfare);
  const city = seats[0];
  if (!city) return;
  const needs = seats.find((key) => state.dynasty.sites[key]?.calamity || state.realm.cities[key].welfare < 59);
  if (needs && (order.goal === "relief" || priority === "relief")) {
    const bins = state.grand.depots[needs] ?? 0;
    if (bins >= 7 && pay(3, 0)) {
      state.grand.depots[needs] -= 7;
      state.realm.cities[needs].welfare = Math.min(100, state.realm.cities[needs].welfare + 6);
      dynastyReport(world, state, entries, side, "relief", needs, province.region + "州牧开仓赈济，耗仓粮 7、钱 3。");
    } else if (order.dispatch) startConvoy(world, state, side, needs, 18, pay, entries, province.region + "州牧");
    return;
  }
  if (order.goal === "defense" || priority === "defense") {
    const border = seats.find((key) => state.cities[key].troops < 1300 && state.realm.cities[key].population >= 1400 && !dynastyLevyRefused(state, key));
    if (border && pay(7, 5)) {
      state.cities[border].troops += 180;
      noteRecruitment(state, border, 180);
      dynastyReport(world, state, entries, side, "levy", border, province.region + "州牧按授权征补 180 人，支出 7 钱、5 粮。");
    }
  } else if (state.realm.cities[city].welfare < 73 && pay(5, 2)) {
    state.realm.cities[city].welfare += 3;
    dynastyReport(world, state, entries, side, "relief", city, province.region + "州牧整复市镇，支出 5 钱、2 粮。");
  }
}

export function saveRestoration(state, city, mode) {
  if (!state.dynasty || gameOutcome(state) !== "ongoing" || !own(state, state.player, city) || !Object.hasOwn(restorationPolicies, mode)
    || !state.dynasty.restorations[city] && !state.cities[city].occupation) throw new Error("请选择本方新接管的城市及恢复方案。");
  const next = structuredClone(state);
  const row = next.dynasty.restorations[city] ??= { side: state.player, mode, since: state.turn, worked: 0 };
  row.mode = mode;
  return next;
}

function recoverCities(world, previous, state, entries, pay, onlyPlayer) {
  for (const { key } of world.cities) {
    const city = state.cities[key];
    if (onlyPlayer && city.owner !== state.player) continue;
    let row = state.dynasty.restorations[key];
    if (row && row.side !== city.owner) { delete state.dynasty.restorations[key]; row = null; }
    if (!row && city.occupation && previous.cities[key].owner !== city.owner) {
      row = state.dynasty.restorations[key] = { since: state.turn, side: city.owner, mode: "phased", worked: 0 };
    }
    if (!row || row.since === state.turn || warBlockaded(state, key)) continue;
    const cost = { direct: [12, 7, 12], retention: [5, 6, 8], phased: [3, 4, 5] }[row.mode];
    if (pay(row.side)(cost[0], cost[1])) {
      const town = state.realm.cities[key];
      town.welfare = Math.min(100, town.welfare + cost[2]);
      if (row.mode === "direct" && city.occupation && city.troops >= 500) city.occupation--;
      if (row.mode === "retention" && !city.governor) {
        const candidate = eraByYear(world, state).officers.find((person) => person.faction === row.side && state.stations[person.key] === key
          && person.governance >= 45 && !postingOf(state, person.key) && !Object.values(state.realm.offices).some(({ holder }) => holder === person.key)
          && ![state.polity.courts[row.side]?.head, state.polity.courts[row.side]?.heir, state.polity.courts[row.side]?.regent].includes(person.key));
        if (candidate) city.governor = candidate.key;
      }
      row.worked++;
      dynastyReport(world, state, entries, row.side, "rebuild", key, cityName(world, key) + "按「" + restorationPolicies[row.mode]
        + "」恢复，支出 " + cost[0] + " 钱、" + cost[1] + " 粮。");
      if (row.worked >= 3 && !city.occupation) delete state.dynasty.restorations[key];
    }
  }
}

export function settleEconomy8(world, previous, state, entries, pay, { onlyPlayer = false } = {}) {
  advanceConvoys(world, state, entries, onlyPlayer);
  updateCalamities(world, state, entries, onlyPlayer);
  const sides = Object.keys(state.factions).filter((side) => !onlyPlayer || side === state.player);
  for (const side of sides) {
    const provinces = provinceRows(world, state, side);
    if (!provinces.length) continue;
    const policy = dynastyPolicy(state, side);
    const work = () => {
      for (const row of state.dynasty.programs.filter((row) => row.side === side && row.status === "active")) {
        workProgram(world, state, row, pay(side), entries, policy.priority !== "growth");
      }
    };
    if (policy.priority === "growth") work();
    for (const province of provinces) {
      const order = state.dynasty.mandates[side]?.[province.region];
      if (order) runProvince(world, state, side, province, order, pay(side), entries, policy.priority);
    }
    if (policy.priority !== "growth") work();
  }
  recoverCities(world, previous, state, entries, pay, onlyPlayer);
}

export function validEconomy8(world, state, officers, data) {
  const city = (key) => Object.hasOwn(state.cities, key);
  const faction = (key) => Object.hasOwn(state.factions, key);
  const date = (value) => bounded(value, data.since, state.turn);
  const id = (value) => bounded(value, 1, data.serial - 1);
  const regions = new Set(world.cities.map(({ region }) => region));
  const graph = new Map(world.cities.map(({ key, links }) => [key, links]));
  return plain(data.sites) && Object.entries(data.sites).every(([key, row]) => city(key) && plain(row)
      && ["fields", "routes", "watch"].every((name) => count(row[name], 5))
      && (row.calamity === null || plain(row.calamity) && Object.hasOwn(calamities, row.calamity.kind) && count(row.calamity.level, 85)
        && bounded(row.calamity.until, data.since, state.turn + 4)))
    && plain(data.capitals) && Object.entries(data.capitals).every(([key, value]) => faction(key) && city(value))
    && plain(data.mandates) && Object.entries(data.mandates).every(([side, mandates]) => faction(side) && plain(mandates)
      && Object.entries(mandates).every(([key, row]) => regions.has(key) && validMandate(row) && row.region === key
        && (row.steward === null || officers.has(row.steward))))
    && plain(data.restorations) && Object.entries(data.restorations).every(([key, row]) => city(key) && plain(row) && faction(row.side)
      && date(row.since) && count(row.worked, 9999) && Object.hasOwn(restorationPolicies, row.mode))
    && Array.isArray(data.programs) && data.programs.length <= 36 && data.programs.every((row) => plain(row) && id(row.id)
      && faction(row.side) && city(row.city) && regions.has(row.region) && Object.hasOwn(nationalProjects, row.kind)
      && ["active", "paused", "complete", "cancelled"].includes(row.status) && date(row.started) && count(row.made, 8)
      && count(row.money, 800) && count(row.grain, 600) && count(row.spentMoney, row.money) && count(row.spentGrain, row.grain)
      && (row.last === null || typeof row.last === "string" && row.last.length <= 50))
    && Array.isArray(data.convoys) && data.convoys.length <= 30 && data.convoys.every((row) => plain(row) && id(row.id)
      && faction(row.side) && city(row.from) && city(row.to) && date(row.started) && bounded(row.amount, 1, 250)
      && ["march", "blocked", "lost", "stored", "delivered"].includes(row.status) && ["land", "water"].includes(row.mode)
      && Array.isArray(row.route) && row.route.length >= 2 && row.route.length <= 11 && row.route.at(-1) === row.to
      && row.route.every((key, index) => city(key) && (!index || graph.get(row.route[index - 1]).includes(key)))
      && count(row.cursor, row.route.length - 1 - Number(active(row))) && count(row.held, 4)
      && (row.reason === null || typeof row.reason === "string" && row.reason.length <= 80));
}
