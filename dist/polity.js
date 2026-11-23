import { cityName, eraByYear, factionName, firstCity, gameOutcome } from "./engine.js";
import { startRealm, realmReserve } from "./realm.js";
import { encodeTerritory, archiveSymbols, bounded, livingSide, maximumPolities, plain, provinceKey, provincePolicies, settlementKinds } from "./polities-data.js";
import { reconcilePolities } from "./polity-handover.js";
import {
  courtCandidates, newCourt, politicalCandidatesForProvince, polityEntry, prepareGovernance, provinceRows, settleCourts, settleGovernance, successionCandidate,
} from "./polity-governance.js";
import { aiSettlements, settleNegotiations } from "./polity-settlements.js";

const events = new Set(["policy", "warning", "crisis", "recovered", "split", "critical", "court-warning", "succession", "regency",
  "court-crisis", "delivered", "union", "breach", "signed", "rejected", "petition", "protection-ended", "edict", "edict-approved", "edict-declined"]);
const edicts = {
  184: { title: "抚恤流离", focus: "relief", treasury: 12, grain: 26, text: "发放赈粮，安顿流离家庭。" },
  190: { title: "联军筹粮", focus: "relief", treasury: 15, grain: 20, text: "以巡仓和赈济稳住诸郡，保障联军后方。" },
  199: { title: "抚定州郡", focus: "relief", treasury: 16, grain: 16, text: "拨钱粮赈助压力最高的州郡，缓和民心与交接压力。" },
  208: { title: "重开江津", focus: "trade", treasury: 20, grain: 10, text: "修复商贸并扶持港埠，将商路收入转为长期恢复。" },
  219: { title: "清理江道", focus: "trade", treasury: 20, grain: 12, text: "组织郡县修整江边市集和渡口，恢复商贸与民生。" },
  234: { title: "督造屯堡", focus: "guard", treasury: 22, grain: 16, text: "增设前线屯堡，稳住边境驻防。" },
  262: { title: "安辑边屯", focus: "guard", treasury: 18, grain: 14, text: "拨钱粮安置边屯，稳定军心和地方驻防。" },
  265: { title: "安置新附", focus: "relief", treasury: 20, grain: 18, text: "优先赈济整顿中的州郡，并帮助恢复地方税粮。" },
};

export function enablePolity(world, state) {
  if (state.polity) return state;
  const next = startRealm(world, state);
  const era = eraByYear(world, state.year);
  const initialHeads = { wei: state.year === 234 ? "曹叡" : "曹奂", shu: "刘禅", jin: "司马炎", han: state.year === 184 ? "汉灵帝" : "韩玄",
    wu: [208, 219, 234].includes(state.year) ? "孙权" : state.year === 265 ? "孙皓" : "孙休" };
  const courts = Object.fromEntries(Object.keys(next.factions).filter((key) => livingSide(next, key))
    .map((key) => {
      const title = initialHeads[key] ?? factionName(era, key);
      const leader = courtCandidates(era, next, key).find(({ name }) => title.includes(name));
      return [key, newCourt(next, key, state.turn, leader?.key ?? null)];
    }));
  const formerOwners = Object.fromEntries(world.cities.map(({ key }) => [key, [...new Set([
    era.ownership[key], state.cities[key].owner, ...state.history.flatMap(({ entries }) => entries
      .filter((entry) => entry.type === "capture" && entry.city === key && entry.battle)
      .flatMap(({ battle }) => [battle.attacker.faction, battle.defender.faction])),
  ])]]));
  return { ...next, polity: { since: state.turn, courts, programs: {}, provinces: {},
    parties: [], allegiances: {}, offers: [], deals: [], protections: [], serial: 0, calm: 0,
    peaceDeals: 0, lastBreach: null, history: [], atlas: [{ turn: state.turn, map: encodeTerritory(world, state) }],
    formerOwners, edict: null } };
}

export function politicalChoices(world, era, state, faction) {
  if (!state.polity || !livingSide(state, faction)) return [];
  const succession = successionCandidate(era, state, faction);
  const domestic = politicalCandidatesForProvince(world, state, faction);
  const diplomacy = aiSettlements(world, state, faction);
  const urgent = new Set(provinceRows(world, state, faction).filter(({ pressure }) => pressure >= 55).map(({ region }) => region));
  return [succession, ...domestic.filter(({ region }) => urgent.has(region)), ...diplomacy,
    ...domestic.filter(({ region }) => !urgent.has(region))].filter(Boolean).slice(0, 6)
    .map((directive, index) => ({ id: "P" + index, directive }));
}

export function politicalDescription(era, directive) {
  if (directive.type === "succession") return "提名" + era.officers.find(({ key }) => key === directive.heir)?.name + "为继任者";
  if (directive.type === "province") return directive.region + "执行" + provincePolicies[directive.focus];
  const draft = directive.draft;
  return "与" + era.factions.find(({ key }) => key === draft.to)?.name + "谈判" + settlementKinds[draft.kind];
}

export function currentEdict(world, state) {
  const order = state.polity?.edict;
  if (!order || order.status !== "pending") return null;
  const terms = edicts[state.year];
  const rows = provinceRows(world, state);
  const row = rows.find(({ region }) => region === order.region);
  const stock = state.factions[state.player];
  const reserve = realmReserve(state, state.player);
  return { ...order, ...terms, available: Boolean(row && stock.treasury - reserve.treasury >= terms.treasury
    && stock.grain - reserve.grain >= terms.grain) };
}

export function answerEdict(world, state, accept) {
  const edict = currentEdict(world, state);
  if (gameOutcome(state) !== "ongoing" || !edict || (accept && !edict.available)) throw new Error("该国政议案已结束或拨款不足。");
  return { ...state, polity: { ...state.polity, edict: { ...state.polity.edict, answer: Boolean(accept) } } };
}

function settleEdict(world, state, entries, turn, ledger, forecast) {
  const data = state.polity;
  if (!data.edict && turn - data.since >= 13 && !forecast) {
    const rows = provinceRows(world, state);
    const terms = edicts[state.year];
    const sorted = rows.sort((a, b) => terms.focus === "trade" ? b.cities.length - a.cities.length
      : state.year === 265 ? b.rebuilding - a.rebuilding : b.danger - a.danger);
    if (sorted.length) {
      data.edict = { status: "pending", turn, region: sorted[0].region };
      entries.push(polityEntry("edict", state.player, "收到「" + terms.title + "」国政议案。", { city: sorted[0].cities[0] }));
    }
  }
  const edict = currentEdict(world, state);
  if (!edict || edict.answer === undefined) return;
  const success = edict.answer && edict.available;
  const row = provinceRows(world, state).find(({ region }) => region === edict.region);
  if (success) {
    const stock = state.factions[state.player];
    stock.treasury -= edict.treasury;
    stock.grain -= edict.grain;
    ledger.budget.treasury += edict.treasury;
    ledger.budget.grain += edict.grain;
    const pressure = data.provinces[row.key];
    if (pressure) pressure.pressure = Math.max(0, pressure.pressure - 18);
    for (const city of row.cities) {
      const people = state.realm.cities[city];
      people.welfare = Math.min(100, people.welfare + 8);
      const holding = state.cities[city];
      if (edict.focus === "trade") holding.commerce = Math.min(5, holding.commerce + 1);
      if (edict.focus === "guard") stock.morale = Math.min(100, stock.morale + 2);
    }
  }
  data.edict.status = success ? "approved" : "declined";
  entries.push(polityEntry(success ? "edict-approved" : "edict-declined", state.player,
    edict.title + (success ? "已执行，地方局势得到缓解。" : "本季未获拨款。"), { city: row?.cities[0] ?? firstCity(world, state) }));
}

export function settlePolity(world, before, state, proposals, entries, forecast = false) {
  if (!state.polity) return null;
  const turn = state.turn + 1;
  const ledger = { budget: { treasury: 0, grain: 0 }, in: { treasury: 0, grain: 0 }, out: { treasury: 0, grain: 0 } };
  const era = eraByYear(world, state);
  const directives = {};
  if (!forecast) for (const { key } of era.factions) {
    if (key === state.player || !livingSide(state, key) || !livingSide(before, key)) continue;
    const options = politicalChoices(world, eraByYear(world, before), before, key);
    const source = proposals[key];
    const directive = source?.source === "model" && source.politics !== undefined
      ? options.find(({ id }) => id === source.politics)?.directive : options[0]?.directive;
    if (!directive) continue;
    directives[key] = directive;
    prepareGovernance(world, state, key, directive);
  }
  settleEdict(world, state, entries, turn, ledger, forecast);
  settleGovernance(world, era, state, entries, turn, ledger, forecast);
  settleNegotiations(world, state, directives, entries, ledger, turn, forecast);
  if (!forecast) {
    settleCourts(world, eraByYear(world, state, turn), state, entries, turn);
    const live = eraByYear(world, state, turn);
    for (const { ward, patron, expires } of state.polity.protections) {
      if (expires > turn && livingSide(state, ward) && livingSide(state, patron)) continue;
      entries.push(polityEntry("protection-ended", patron, factionName(live, patron) + "与" + factionName(live, ward)
        + "的保护协定" + (expires <= turn ? "期满。" : "因一方退出而终止。"), { participants: [patron, ward] }));
    }
    reconcilePolities(state, turn);
  }
  return ledger;
}

export function recordPolity(world, state, entries) {
  if (!state.polity) return;
  const data = state.polity;
  const unsettled = Object.values(state.cities).filter(({ owner, occupation }) => owner === state.player && occupation > 0).length;
  const warnings = provinceRows(world, state).some(({ crisis, pressure }) => crisis !== null || pressure >= 55);
  const latestBreach = data.lastBreach !== null && state.turn - data.lastBreach <= 6;
  data.calm = !warnings && !latestBreach && unsettled <= Math.floor(Object.values(state.cities)
    .filter(({ owner }) => owner === state.player).length / 5) ? data.calm + 1 : 0;
  for (const [key, { owner }] of Object.entries(state.cities)) {
    const claim = data.formerOwners[key];
    if (!claim.includes(owner)) claim.push(owner);
  }
  for (const report of entries.filter(({ type, battle }) => type === "capture" && battle)) {
    const claim = data.formerOwners[report.city];
    const owner = report.battle.attacker.faction;
    if (!claim.includes(owner)) claim.push(owner);
  }
  data.atlas = [...data.atlas, { turn: state.turn, map: encodeTerritory(world, state) }].slice(-180);
  const digest = entries.flatMap(({ type, event, faction, text, city, participants, officer }) => {
    if (type === "capture") return [{ turn: state.turn, event: "territory", faction, city,
      text: cityName(world, city) + "易主。", ...(participants ? { participants } : {}) }];
    const detail = type === "polity" || type === "grand" && (faction === state.player || participants?.includes(state.player))
      || type === "diplomacy" && participants?.includes(state.player);
    return detail ? [{ turn: state.turn, event: type === "polity" ? event : type === "grand" ? "grand" : "treaty", faction,
      text: type === "grand" ? text.slice(0, 260) : text,
      ...(city ? { city } : {}), ...(participants ? { participants } : {}), ...(officer ? { officer } : {}) }] : [];
  });
  data.history = [...data.history, ...digest].slice(-260);
}

export function peaceCriteria(world, state) {
  const houses = Object.values(state.cities).filter(({ owner }) => owner === state.player);
  const core = state.cities[firstCity(world, state)];
  const data = state.polity;
  const tests = [
    { name: "已结算季度", value: state.turn, target: 32 },
    { name: "连续承平季度", value: data?.calm ?? 0, target: 8 },
    { name: "已完成和平交割", value: data?.peaceDeals ?? 0, target: 2 },
    { name: "顺利完成交接", value: Number((data?.courts[state.player]?.successions ?? 0) > 0), target: 1 },
    { name: "稳定辖城", value: houses.filter(({ occupation }) => !occupation).length, target: Math.max(1, Math.ceil(houses.length * .8)) },
    { name: "治所已安定", value: Number(core?.owner === state.player && !core?.occupation), target: 1 },
  ];
  return { title: "天下承平", tests, ready: Boolean(data && !state.orders.length && tests.every(({ value, target }) => value >= target)
    && ![...data.offers, ...data.deals].some(({ from, to }) => [from, to].includes(state.player))) };
}

export function concludePeace(world, state) {
  if (gameOutcome(state) !== "ongoing" || !peaceCriteria(world, state).ready) throw new Error("请完成承平条件并结清待决议案。");
  return { ...state, scenarioEnding: { turn: state.turn, kind: "peace" }, incomingTreaty: null };
}

export function validPolity(world, state, era, base) {
  if (state.polity === undefined) return true;
  const data = state.polity;
  if (!plain(data) || !state.realm || !bounded(data.since, 0, state.turn) || !bounded(data.serial, 0, 1000000)
    || !bounded(data.calm, 0, state.turn) || !bounded(data.peaceDeals, 0, data.serial + (state.grand?.serial ?? 0) + (state.landscape?.sequence ?? 0))
    || (data.lastBreach !== null && !bounded(data.lastBreach, data.since, state.turn))) return false;
  const factions = Object.keys(state.factions);
  const side = (key) => factions.includes(key);
  const city = (key) => Object.hasOwn(state.cities, key);
  const date = (turn) => bounded(turn, data.since, state.turn);
  const officers = new Map(era.officers.map((person) => [person.key, person]));
  const baseOfficers = new Map(base.officers.map((person) => [person.key, person.faction]));
  if (!Array.isArray(data.parties) || factions.length > maximumPolities
    || !data.parties.every((item, index) => item && item.key === "spl-" + (index + 1) && item.leader === item.key + "-head"
      && side(item.key) && side(item.origin) && item.key !== item.origin && date(item.turn) && city(item.city)
      && world.cities.some((site) => site.key === item.city && site.region === item.region && site.name + "军" === item.name
        && Array.isArray(item.position) && item.position.length === 2 && item.position.every((coordinate, i) => coordinate === site.position[i])))) return false;
  for (const item of data.parties) baseOfficers.set(item.leader, item.key);
  if (!plain(data.allegiances) || !Object.entries(data.allegiances).every(([key, changes]) =>
    baseOfficers.has(key) && Array.isArray(changes) && changes.length > 0 && changes.length <= state.turn + 1
    && changes.every((item, index) => item && date(item.turn) && item.from === (index ? changes[index - 1].to : baseOfficers.get(key))
      && item.from !== item.to && side(item.to) && (!index || changes[index - 1].turn < item.turn)))) return false;
  const regions = new Set(world.cities.map(({ region }) => region));
  if (!plain(data.formerOwners) || Object.keys(data.formerOwners).length !== world.cities.length
    || !Object.entries(data.formerOwners).every(([key, claim]) => city(key) && Array.isArray(claim) && claim.every(side)
      && claim.includes(state.cities[key].owner) && new Set(claim).size === claim.length)) return false;
  const province = (key) => factions.some((faction) => [...regions].some((region) => key === provinceKey(faction, region)));
  if (!plain(data.provinces) || !Object.entries(data.provinces).every(([key, row]) => province(key) && row
    && bounded(row.pressure, 0, 100) && (row.warning === null || date(row.warning)) && (row.crisis === null || (date(row.crisis) && row.warning !== null)))) return false;
  if (!plain(data.programs) || !Object.entries(data.programs).every(([key, row]) => row && province(key)
    && key === provinceKey(row.faction, row.region) && Object.hasOwn(provincePolicies, row.focus)
    && bounded(row.treasury, 0, 999) && bounded(row.grain, 0, 999))) return false;
  if (!plain(data.courts) || factions.some((key) => livingSide(state, key) && !data.courts[key])
    || !Object.entries(data.courts).every(([key, seat]) => side(key) && seat && bounded(seat.count, 0, state.turn)
    && bounded(seat.successions, 0, seat.count)
    && bounded(seat.due, livingSide(state, key) ? state.turn + 1 : data.since + 1, state.turn + 50)
    && typeof seat.warned === "boolean" && [seat.head, seat.heir, seat.regent].every((person) => person === null || officers.get(person)?.faction === key)
    && (seat.last === null || (date(seat.last.turn) && bounded(seat.last.support, 0, 100)
      && ["succession", "regency", "court-crisis"].includes(seat.last.result))))) return false;
  const draft = (item) => item && side(item.from) && side(item.to) && item.from !== item.to && Object.hasOwn(settlementKinds, item.kind)
    && bounded(item.id, 1, data.serial) && bounded(item.payment, 0, 200) && (item.city === null || city(item.city))
    && (item.kind === "peace" ? item.ward === null : [item.from, item.to].includes(item.ward) && !item.payment && item.city === null);
  if (!Array.isArray(data.offers) || !Array.isArray(data.deals) || data.offers.length > 30 || data.deals.length > 25
    || !data.offers.every((item) => draft(item) && date(item.submitted) && (item.accept === undefined || typeof item.accept === "boolean"))
    || !data.deals.every((item) => draft(item) && item.due === state.turn + 1)
    || new Set([...data.offers, ...data.deals].map(({ id }) => id)).size !== data.offers.length + data.deals.length) return false;
  if (!Array.isArray(data.protections) || data.protections.length > factions.length
    || !data.protections.every((item) => item && side(item.ward) && side(item.patron) && item.ward !== item.patron
      && date(item.since) && item.expires === item.since + 12 && item.expires > state.turn && bounded(item.good, 0, 12))) return false;
  if (!Array.isArray(data.atlas) || data.atlas.length < 1 || data.atlas.length > 180 || data.atlas.at(-1).turn !== state.turn
    || data.atlas.at(-1).map !== encodeTerritory(world, state)
    || !data.atlas.every((frame, index) => frame && date(frame.turn) && (!index || frame.turn === data.atlas[index - 1].turn + 1)
      && typeof frame.map === "string" && frame.map.length === world.cities.length
      && [...frame.map].every((symbol) => factions[archiveSymbols.indexOf(symbol)]))) return false;
  if (!Array.isArray(data.history) || data.history.length > 260 || !data.history.every((item) => item && date(item.turn) && side(item.faction)
    && (events.has(item.event) || ["territory", "treaty", "grand"].includes(item.event))
    && typeof item.text === "string" && item.text.length <= 260
    && (item.city === undefined || city(item.city)) && (item.officer === undefined || officers.has(item.officer))
    && (item.participants === undefined || (Array.isArray(item.participants) && item.participants.every(side))))) return false;
  return data.edict === null || (data.edict && date(data.edict.turn) && regions.has(data.edict.region)
    && ["pending", "approved", "declined"].includes(data.edict.status)
    && (data.edict.answer === undefined || typeof data.edict.answer === "boolean"));
}
