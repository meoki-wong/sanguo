import { accordCredit } from "./accords.js";
import { armyByOfficer } from "./armies.js";
import { availableForPosting, cityName, eraByYear, firstCity, gameOutcome, postingOf } from "./engine.js";
import { knownOfficer } from "./personnel.js";
import { formPolity, changeService } from "./polity-handover.js";
import { newCourt, polityEntry, provinceRows } from "./polity-governance.js";
import { bounded, livingSide, plain } from "./polities-data.js";
import { nationalDuty, realmReserve } from "./realm.js";
import { signOfficer } from "./recruitment.js";

export const personnelMandates = { manual: "保留任命", appoint: "补齐太守", search: "访才并补缺" };
export const crisisResponses = { relief: "开仓赈济", mediate: "巡抚安抚", guard: "增兵守备" };
const fee = 42;
const counter = (value) => Math.max(0, Math.min(100, value));
const postName = (world, city) => cityName(world, city);
const controls = (state, faction, key) => state.cities[key]?.owner === faction;
const lord = (state, key) => Object.values(state.polity.courts).some(({ head }) => head === key);

export function loyalty(state, officer) {
  return state.statecraft?.loyalty[officer.key]?.value ?? Math.max(46, state.factions[officer.faction].morale + 9);
}

export function eligibleApproaches(world, state) {
  const sides = new Set(world.cities.filter(({ key }) => controls(state, state.player, key))
    .flatMap(({ links }) => links.map((key) => state.cities[key].owner)));
  return eraByYear(world, state).officers.filter((person) => person.faction !== state.player && sides.has(person.faction)
    && knownOfficer(state, person) && availableForPosting(state, person.key) && !lord(state, person.key)
    && controls(state, person.faction, state.stations[person.key]))
    .sort((a, b) => accordCredit(state, state.player, b.faction) - accordCredit(state, state.player, a.faction)
      || Math.max(b.command, b.governance) - Math.max(a.command, a.governance)).slice(0, 18);
}

export function inviteOfficer(world, state, key) {
  if (gameOutcome(state) !== "ongoing" || !state.statecraft || !eligibleApproaches(world, state).some((person) => person.key === key)) {
    throw new Error("请选择有接触机会的邻境待任人才。");
  }
  if (state.statecraft.invite || state.factions[state.player].treasury < fee) throw new Error("每季可登庸一人，需备 42 钱。");
  return { ...state, statecraft: { ...state.statecraft, invite: { officer: key } } };
}

export function orderCrisisResponse(world, state, region, kind) {
  if (gameOutcome(state) !== "ongoing" || !state.statecraft || !Object.hasOwn(crisisResponses, kind)
    || !provinceRows(world, state).some((row) => row.region === region)) throw new Error("请选择可处置的辖区。");
  const next = structuredClone(state);
  next.statecraft.responses[region] = kind;
  return next;
}

export function settleTalent(world, state, entries, ledger, forecast) {
  const data = state.statecraft;
  const faction = state.player;
  const stock = state.factions[faction];
  const reserve = realmReserve(state, faction);
  const era = eraByYear(world, state);
  const seat = firstCity(world, state);
  const towns = world.cities.filter(({ key }) => controls(state, faction, key) && !state.cities[key].occupation);
  const home = towns.find(({ key }) => key === seat)?.key ?? towns[0]?.key;
  if (!home) return;
  const pay = (cash) => {
    if (stock.treasury - reserve.treasury < cash) return false;
    stock.treasury -= cash;
    ledger.budget.treasury += cash;
    return true;
  };
  const note = (text, officer) => entries.push(polityEntry("talent", faction, text, { city: home, officer }));
  if (data.invite && !forecast) {
    const candidate = eligibleApproaches(world, state).find(({ key }) => key === data.invite.officer);
    const person = era.officers.find(({ key }) => key === data.invite.officer);
    if (candidate && loyalty(state, candidate) <= 58 + Math.round(accordCredit(state, faction, candidate.faction) / 4) && pay(fee)) {
      const city = changeService(world, state, candidate, faction, state.turn + 1);
      data.loyalty[candidate.key] = { value: 65, warning: null };
      note(candidate.name + "接受登庸，入仕并驻" + postName(world, city) + "。", candidate.key);
    } else if (person) note(person.name + "本季未接受登庸。", person.key);
    data.invite = null;
  }
  if (data.policy?.personnel !== "search") return;
  const candidate = era.officers.filter((person) => person.faction === faction && !knownOfficer(state, person)
    && person.reserve.turn <= state.turn && stock.treasury - reserve.treasury >= person.reserve.fee)
    .sort((a, b) => b.governance - a.governance)[0];
  if (candidate && pay(candidate.reserve.fee)) {
    // The common recruitment path assigns the station and records the officer as recruited.
    stock.treasury += candidate.reserve.fee;
    signOfficer(state, candidate, home);
    note("访才令招揽" + candidate.name + "，已驻" + postName(world, home) + "。", candidate.key);
  }
}

export function settleCrisisOrders(world, state, entries, ledger, ordinaryRelief) {
  if (!state.statecraft) return;
  const data = state.statecraft;
  const era = eraByYear(world, state);
  const player = state.player;
  const stock = state.factions[player];
  const reserve = realmReserve(state, player);
  let automaticBudget = Math.max(0, (data.policy?.relief ?? state.realm.policy.relief) - ordinaryRelief);
  for (const row of provinceRows(world, state)) {
    const regional = data.regions[row.region];
    const manual = data.responses[row.region];
    const steward = row.cities.includes(state.stations[regional?.officer]) || row.cities.some((city) => state.cities[city].governor);
    const automatic = regional?.focus === "relief" && regional.budget >= 24 && automaticBudget >= 12
      && steward && (row.pressure >= 42 || row.welfare < 59);
    const action = manual ?? (automatic ? "relief" : null);
    if (!action) continue;
    const cash = action === "guard" ? 18 : 12;
    const grain = action === "relief" ? 16 : 6;
    const seat = row.cities[0];
    if (stock.treasury - reserve.treasury < cash || stock.grain - reserve.grain < grain) {
      entries.push(polityEntry("crisis-response", player, row.region + "钱粮不足，处置保留待执行。", { city: seat }));
      continue;
    }
    stock.treasury -= cash;
    stock.grain -= grain;
    ledger.budget.treasury += cash;
    ledger.budget.grain += grain;
    if (!manual) automaticBudget -= cash;
    const pressure = state.polity.provinces[row.key] ??= { pressure: 0, warning: null, crisis: null };
    pressure.pressure = Math.max(0, pressure.pressure - (action === "mediate" ? 28 : 18));
    for (const city of row.cities) {
      const residents = state.realm.cities[city];
      residents.welfare = counter(residents.welfare + (action === "relief" ? 15 : 5));
      if (action === "guard" && city === seat) {
        const soldiers = Math.min(160, Math.max(0, residents.population - 800));
        state.cities[city].troops += soldiers;
        residents.population -= soldiers;
      }
    }
    if (action === "mediate") for (const person of era.officers.filter((person) => person.faction === player && row.cities.includes(state.stations[person.key]))) {
      data.loyalty[person.key] = { value: counter(loyalty(state, person) + 14), warning: null };
    }
    entries.push(polityEntry("crisis-response", player, row.region + "完成" + crisisResponses[action] + "。", { city: seat }));
    delete data.responses[row.region];
  }
  for (const region of Object.keys(data.responses)) if (!world.cities.some((city) => city.region === region && controls(state, player, city.key))) delete data.responses[region];
}

export function settleStability(world, state, entries, ledger, forecast) {
  if (forecast) return;
  const data = state.statecraft;
  const turn = state.turn + 1;
  const era = eraByYear(world, state);
  const player = state.player;
  const borders = new Map(world.cities.map(({ key, links }) => [key, links]));
  const warning = (event, faction, text, city, officer) => entries.push(polityEntry(event, faction, text, { city, ...(officer ? { officer } : {}) }));
  for (const person of era.officers) {
    const { key, faction, name } = person;
    const city = state.stations[key];
    if (!city || !controls(state, faction, city) || !knownOfficer(state, person) || lord(state, key)) continue;
    const office = postingOf(state, key);
    const people = state.realm.cities[city];
    const row = data.loyalty[key] ??= { value: loyalty(state, person), warning: null };
    const morale = state.factions[faction].morale;
    const drift = morale < 40 ? -8 : morale < 54 ? -3 : morale >= 65 && people.welfare >= 55 ? 3 : 0;
    row.value = counter(row.value + drift + (office || nationalDuty(state, key) ? 2 : 0) - (people.welfare < 38 ? 7 : 0)
      - (state.cities[city].occupation ? 3 : 0));
    if (row.value >= 52) row.warning = null;
    if (row.value <= 40 && row.warning === null) {
      row.warning = turn;
      warning("loyalty-warning", faction, name + "对地方局势失去信心，可能离任。", city, key);
    }
    if (row.value > 23 || row.warning === null || turn - row.warning < 2 || armyByOfficer(state, key)) continue;
    const destination = borders.get(city).map((neighbor) => state.cities[neighbor].owner)
      .find((owner) => owner !== faction && livingSide(state, owner));
    if (!destination) continue;
    const target = changeService(world, state, person, destination, turn);
    if (!target) continue;
    row.value = 63;
    row.warning = null;
    warning("defection", faction, name + "离任叛投，改驻" + postName(world, target) + "。", city, key);
  }
  for (const faction of Object.keys(state.factions)) {
    if (!livingSide(state, faction)) continue;
    for (const row of provinceRows(world, state, faction)) {
      const pressure = state.polity.provinces[row.key];
      if (pressure?.crisis == null || turn - pressure.crisis < 2 || pressure.pressure < 87) continue;
      const domain = Object.values(state.cities).filter(({ owner }) => owner === faction).length;
      if (domain < 2) continue;
      const capital = firstCity(world, state, faction);
      const hot = row.cities.filter((key) => key !== capital && state.realm.cities[key].welfare <= 37)
        .sort((a, b) => state.realm.cities[a].welfare - state.realm.cities[b].welfare);
      if (!hot.length) continue;
      const leader = state.cities[hot[0]].governor;
      const separatist = leader && (data.loyalty[leader]?.value ?? 75) <= 43 && domain >= 3;
      const cities = hot.slice(0, separatist ? Math.min(2, domain - 1) : 1);
      const cause = separatist ? "independence" : "uprising";
      const formed = formPolity(world, eraByYear(world, state, turn), state, faction, row.region, cities, turn, cause);
      if (!formed) continue;
      for (const city of cities) if (!separatist) {
        const old = state.cities[city].troops;
        state.cities[city].troops = Math.max(250, Math.floor(old * .55));
      }
      state.polity.courts[formed.key] = newCourt(state, formed.key, turn, formed.leader);
      pressure.pressure = 46;
      pressure.warning = pressure.crisis = null;
      if (faction === player) {
        ledger.out.treasury += formed.treasury;
        ledger.out.grain += formed.grain;
      }
      entries.push(polityEntry(cause, faction,
        separatist ? row.region + "地方官率 " + cities.length + " 城独立。" : postName(world, cities[0]) + "爆发起义，当地军政脱离原势力。",
        { city: cities[0], participants: [faction, formed.key], ...(separatist ? { officer: leader } : {}) }));
      break;
    }
  }
}

export function validStatecraftPersonnel(world, state, officers, data) {
  const regions = new Set(world.cities.map(({ region }) => region));
  return plain(data.loyalty) && Object.entries(data.loyalty).every(([key, row]) => officers.has(key) && row && bounded(row.value, 0, 100)
    && (row.warning === null || bounded(row.warning, data.since, state.turn)))
    && plain(data.responses) && Object.entries(data.responses).every(([key, mode]) => regions.has(key) && Object.hasOwn(crisisResponses, mode))
    && (data.invite === null || data.invite && officers.has(data.invite.officer));
}
