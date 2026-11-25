import { armyByOfficer } from "./armies.js";
import { cityName, firstCity, gameOutcome, openingCapital } from "./engine.js";
import { knownOfficer } from "./personnel.js";
import { noteRecruitment, realmReserve } from "./realm.js";
import { warBlockaded } from "./war-operations.js";
import { formPolity } from "./polity-handover.js";
import { bounded, livingSide, provinceKey, provincePolicies } from "./polities-data.js";

const reliefCost = { treasury: 6, grain: 9 };
const guardCost = { treasury: 8, grain: 6 };
const tradeCost = { treasury: 12, grain: 2 };
const costs = { relief: reliefCost, guard: guardCost, trade: tradeCost };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const regionalWeight = { 199: 4, 208: 2, 262: 2, 265: 5 };
const count = (state, faction) => Object.values(state.cities).filter(({ owner }) => owner === faction).length;

export function polityEntry(event, faction, text, extra = {}) {
  return { type: "polity", event, faction, text, ...extra };
}

function cityPressure(state, key) {
  const city = state.cities[key];
  const welfare = state.realm?.cities[key]?.welfare ?? 68;
  return (city.occupation ? 22 : 0) + (city.governor ? 0 : 9)
    + Math.ceil(Math.max(0, 65 - welfare) * 1.25) + (city.troops < 450 ? 17 : city.troops < 850 ? 8 : 0)
    + (warBlockaded(state, key) ? 21 : 0);
}

export function provinceRows(world, state, faction = state.player) {
  const groups = new Map();
  for (const { key, region } of world.cities) {
    if (state.cities[key].owner !== faction) continue;
    const list = groups.get(region) ?? [];
    list.push(key);
    groups.set(region, list);
  }
  return [...groups].map(([region, cities]) => {
    const key = provinceKey(faction, region);
    const status = state.polity?.provinces[key];
    const policy = state.polity?.programs[key];
    const lowWelfare = cities.filter((city) => (state.realm?.cities[city]?.welfare ?? 68) < 58).length;
    const shortGarrison = cities.filter((city) => state.cities[city].troops < 850).length;
    const rebuilding = cities.filter((city) => state.cities[city].occupation > 0).length;
    const absent = cities.filter((city) => !state.cities[city].governor).length;
    const welfare = Math.round(cities.reduce((total, city) => total + (state.realm?.cities[city]?.welfare ?? 68), 0) / cities.length);
    const stock = state.factions[faction];
    const vulnerability = cities.reduce((total, city) => total + cityPressure(state, city), 0) / cities.length;
    const danger = Math.round(vulnerability + (stock.grain < 12 ? 22 : stock.grain < 35 ? 8 : 0)
      + (stock.morale < 48 ? 13 : 0) + (rebuilding ? regionalWeight[state.year] ?? 0 : 0));
    return { key, faction, region, cities, policy, pressure: status?.pressure ?? 0, warning: status?.warning ?? null,
      crisis: status?.crisis ?? null, danger, lowWelfare, shortGarrison, rebuilding, absent, welfare,
      garrison: cities.reduce((total, city) => total + state.cities[city].troops, 0) };
  }).sort((a, b) => b.pressure - a.pressure || b.danger - a.danger);
}

function setProgram(state, faction, row, terms) {
  const key = provinceKey(faction, row.region);
  const programs = state.polity.programs;
  if (!terms) { delete programs[key]; return; }
  if (!Object.hasOwn(provincePolicies, terms.focus) || !bounded(terms.treasury, 0, 999) || !bounded(terms.grain, 0, 999)) throw new Error("请填写州郡方针和有效预算。");
  if (!programs[key] && Object.values(programs).filter((program) => program.faction === faction).length >= 4) {
    throw new Error("每个势力可同时委任四个州郡。");
  }
  programs[key] = { faction, region: row.region, focus: terms.focus, treasury: terms.treasury, grain: terms.grain };
}

export function saveProvincePolicy(world, state, region, terms) {
  if (!state.polity || gameOutcome(state) !== "ongoing") throw new Error("当前无法调整州郡方针。");
  const row = provinceRows(world, state).find((item) => item.region === region);
  if (!row) throw new Error("只能调度本方仍有城池的州郡。");
  const next = structuredClone(state);
  setProgram(next, state.player, row, terms);
  return next;
}

function eligibleProgram(state, city, focus) {
  const holding = state.cities[city];
  if (warBlockaded(state, city)) return false;
  if (focus === "relief") return (state.realm?.cities[city]?.welfare ?? 68) < 70;
  if (focus === "guard") return holding.troops < 1300 && (state.realm?.cities[city]?.population ?? Infinity) > 1100;
  return (holding.occupation === 1 && holding.troops >= 450) || (!holding.occupation && holding.commerce < 3);
}

export function provincialBudget(state, row, program = row.policy) {
  if (!program) return { cities: [], treasury: 0, grain: 0 };
  const cost = costs[program.focus];
  if (!cost) return { cities: [], treasury: 0, grain: 0 };
  const funds = state.factions[row.faction];
  const reserve = realmReserve(state, row.faction);
  const max = Math.max(0, Math.min(Math.floor(Math.min(program.treasury, funds.treasury - reserve.treasury) / cost.treasury),
    Math.floor(Math.min(program.grain, funds.grain - reserve.grain) / cost.grain)));
  const cities = row.cities.filter((key) => eligibleProgram(state, key, program.focus))
    .sort((a, b) => cityPressure(state, b) - cityPressure(state, a)).slice(0, max);
  return { cities, treasury: cost.treasury * cities.length, grain: cost.grain * cities.length };
}

function performProgram(state, row, budget) {
  const stock = state.factions[row.faction];
  stock.treasury -= budget.treasury;
  stock.grain -= budget.grain;
  const pressure = state.polity.provinces[row.key];
  if (pressure) pressure.pressure = Math.max(0, pressure.pressure - Math.ceil(22 * budget.cities.length / row.cities.length));
  for (const key of budget.cities) {
    const city = state.cities[key];
    const population = state.realm?.cities[key];
    if (row.policy.focus === "relief" && population) population.welfare = Math.min(100, population.welfare + 14);
    if (row.policy.focus === "guard") {
      city.troops += 260;
      noteRecruitment(state, key, 260);
      if (population) population.welfare = Math.min(100, population.welfare + 4);
    }
    if (row.policy.focus === "trade") {
      if (city.occupation) city.occupation = 0;
      else city.commerce += 1;
      if (population) population.welfare = Math.min(100, population.welfare + 6);
    }
  }
}

export function politicalCandidatesForProvince(world, state, faction) {
  return provinceRows(world, state, faction).filter((row) => row.danger >= 27 || row.pressure >= 33).slice(0, 2)
    .map((row) => ({ type: "province", region: row.region, focus: row.lowWelfare ? "relief" : row.shortGarrison ? "guard" : "trade",
      treasury: 24, grain: 22 }));
}

export function courtFor(state, faction) {
  return state.polity?.courts[faction] ?? null;
}

function cycle(faction, year) {
  return 26 + ([...faction].reduce((a, letter) => a + letter.codePointAt(0), year) % 11);
}

export function newCourt(state, faction, from = state.turn, head = null) {
  return { head, heir: null, regent: null, due: from + cycle(faction, state.year), warned: false, count: 0, successions: 0, last: null };
}

export function courtCandidates(era, state, faction = state.player) {
  return era.officers.filter((person) => person.faction === faction && knownOfficer(state, person)
    && (state.cities[state.stations[person.key]]?.owner === faction || armyByOfficer(state, person.key)?.faction === faction))
    .sort((a, b) => b.governance - a.governance || b.command - a.command);
}

export function courtBacking(world, state, faction, person) {
  const rows = provinceRows(world, state, faction);
  const burden = rows.length ? Math.max(...rows.map(({ pressure }) => pressure)) : 0;
  const morale = state.factions[faction].morale;
  return clamp(Math.round(30 + Math.min(90, morale) / 2 + (person?.governance ?? 45) / 4 - burden * .45), 0, 100);
}

export function saveSuccession(world, era, state, { heir, regent, abdicate = false }) {
  if (!state.polity || gameOutcome(state) !== "ongoing") throw new Error("当前无法更改继任安排。");
  const seat = courtFor(state, state.player);
  const candidates = new Set(courtCandidates(era, state).map(({ key }) => key));
  if ([heir, regent].some((key) => key !== null && (!candidates.has(key) || key === seat.head)) || (heir && heir === regent)
    || (abdicate && !heir)) throw new Error("请选择可任职且不同的继任人和代理人。主动交接须指定继任者。");
  return { ...state, polity: { ...state.polity, courts: { ...state.polity.courts,
    [state.player]: { ...seat, heir, regent, due: abdicate ? state.turn + 1 : seat.due } } } };
}

export function successionCandidate(era, state, faction) {
  const seat = courtFor(state, faction);
  if (!seat || seat.heir || seat.due - state.turn > 4) return null;
  const [heir, regent] = courtCandidates(era, state, faction).filter(({ key }) => key !== seat.head);
  return heir ? { type: "succession", heir: heir.key, regent: regent?.key ?? null } : null;
}

export function prepareGovernance(world, state, faction, directive) {
  if (directive?.type === "succession") Object.assign(state.polity.courts[faction], { heir: directive.heir, regent: directive.regent });
  if (directive?.type === "province") {
    const row = provinceRows(world, state, faction).find(({ region }) => region === directive.region);
    if (row && (row.policy || Object.values(state.polity.programs).filter((program) => program.faction === faction).length < 4)) {
      setProgram(state, faction, row, directive);
    }
  }
}

export function settleGovernance(world, era, state, entries, turn, ledger, forecast = false) {
  const sides = Object.keys(state.factions).filter((key) => livingSide(state, key) && (!forecast || key === state.player));
  for (const faction of sides) {
    for (const row of provinceRows(world, state, faction)) {
      const budget = provincialBudget(state, row);
      if (budget.cities.length) {
        performProgram(state, row, budget);
        if (faction === state.player) {
          ledger.budget.treasury += budget.treasury;
          ledger.budget.grain += budget.grain;
          entries.push(polityEntry("policy", faction, row.region + "执行" + provincePolicies[row.policy.focus] + "，共 "
            + budget.cities.length + " 城，支出 " + budget.treasury + " 钱、" + budget.grain + " 粮。", { city: budget.cities[0] }));
        }
      }
    }
  }
  if (forecast) return;
  const liveRegions = new Set();
  for (const faction of sides) {
    for (const row of provinceRows(world, state, faction)) {
      liveRegions.add(row.key);
      const status = state.polity.provinces[row.key] ??= { pressure: 0, warning: null, crisis: null };
      const old = status.pressure;
      const drift = row.danger >= 53 ? 14 : row.danger >= 43 ? 8 : row.danger >= 33 ? 3 : row.danger >= 23 ? -5 : -11;
      status.pressure = clamp(status.pressure + drift - (row.policy && row.danger < 33 ? 3 : 0), 0, 100);
      if (status.pressure >= 55 && status.warning === null) {
        status.warning = turn;
        entries.push(polityEntry("warning", faction, row.region + "州郡告急，尚可拨款干预。", { city: row.cities[0] }));
      }
      if (status.warning !== null && turn - status.warning >= 2 && status.pressure >= 75 && status.crisis === null) {
        status.crisis = turn;
        entries.push(polityEntry("crisis", faction, row.region + "进入地方危机，守备与民心须尽快恢复。", { city: row.cities[0] }));
      }
      if (status.pressure < 36 && status.warning !== null) {
        status.warning = status.crisis = null;
        entries.push(polityEntry("recovered", faction, row.region + "局势平稳，地方警报解除。", { city: row.cities[0] }));
      }
      if (!state.statecraft && status.crisis !== null && turn - status.crisis >= 2 && status.pressure >= 92 && count(state, faction) >= 3) {
        const capital = openingCapital(era, faction);
        const selected = row.cities.filter((key) => key !== capital && cityPressure(state, key) >= 43)
          .sort((a, b) => cityPressure(state, b) - cityPressure(state, a)).slice(0, Math.min(2, count(state, faction) - 1));
        if (selected.length) {
          const formed = formPolity(world, era, state, faction, row.region, selected, turn);
          if (formed) {
            state.polity.courts[formed.key] = newCourt(state, formed.key, turn, formed.leader);
            status.pressure = 45;
            status.warning = status.crisis = null;
            if (faction === state.player) { ledger.out.treasury += formed.treasury; ledger.out.grain += formed.grain; }
            entries.push(polityEntry("split", faction, formed.name + "脱离原势力，独立执政。移交 " + selected.length + " 城、"
              + formed.treasury + " 钱及 " + formed.grain + " 粮。", { city: formed.city, participants: [faction, formed.key] }));
            continue;
          }
        }
      }
      if (old < 90 && status.pressure >= 90 && faction === state.player) {
        entries.push(polityEntry("critical", faction, row.region + "民政已至紧急状态，需增援或赈济。", { city: row.cities[0] }));
      }
    }
  }
  for (const key of Object.keys(state.polity.provinces)) if (!liveRegions.has(key)) delete state.polity.provinces[key];
  for (const key of Object.keys(state.polity.programs)) if (!liveRegions.has(key)) delete state.polity.programs[key];
}

export function settleCourts(world, era, state, entries, turn) {
  for (const faction of Object.keys(state.factions).filter((key) => livingSide(state, key))) {
    const seat = state.polity.courts[faction] ??= newCourt(state, faction, turn);
    if (!seat.warned && seat.due - turn <= 3 && turn < seat.due) {
      seat.warned = true;
      entries.push(polityEntry("court-warning", faction, "君主任期将满，须安排继任与代理。", { city: firstCity(world, state, faction) }));
    }
    if (turn < seat.due) continue;
    const candidates = courtCandidates(era, state, faction);
    const person = candidates.find(({ key }) => key === seat.heir && key !== seat.head);
    const deputy = candidates.find(({ key }) => key === seat.regent && key !== seat.head);
    const support = courtBacking(world, state, faction, person);
    const legitimate = person && support >= 60;
    const successor = legitimate ? person : deputy ?? person ?? candidates.find(({ key }) => key !== seat.head);
    const name = successor?.name ?? "临时议事班底";
    const result = legitimate ? "succession" : deputy ? "regency" : "court-crisis";
    const stock = state.factions[faction];
    stock.morale = clamp(stock.morale + (legitimate ? 5 : deputy ? -3 : -11), 0, 100);
    for (const row of provinceRows(world, state, faction)) {
      const current = state.polity.provinces[row.key];
      if (current && !legitimate) current.pressure = Math.min(100, current.pressure + (deputy ? 4 : 12));
    }
    Object.assign(seat, { head: successor?.key ?? null, heir: result === "regency" ? person?.key ?? null : null,
      regent: null, due: turn + (result === "regency" ? 4 : cycle(faction, state.year)),
      warned: false, count: seat.count + 1, successions: seat.successions + Number(Boolean(legitimate)), last: { turn, support, result } });
    entries.push(polityEntry(result, faction, name + (legitimate ? "顺利接班，群臣支持 " + support + "。"
      : deputy ? "代理政务，交接压力已上报。" : "主持临时交接，地方稳定度下降。"),
    { city: firstCity(world, state, faction), ...(successor ? { officer: successor.key } : {}) }));
  }
}
