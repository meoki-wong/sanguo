import { armyByOfficer } from "./armies.js";
import { cityName, eraByYear, factionName, firstCity, gameOutcome } from "./engine.js";
import { dynastyNotices, dynastyPolicy, dynastyProvinces, orderJurisdiction, saveDynastyPolicy } from "./dynasty.js";
import { formationOf, validFrontlineBattle } from "./frontline.js";
import { knownOfficer } from "./personnel.js";
import { isOfficerUnavailable } from "./saga.js";
import { courtCandidates, courtFor, saveSuccession } from "./polity-governance.js";
import { bounded, livingSide, plain, territoryAt } from "./polities-data.js";
import { assignRealmOffice, officeCandidates } from "./realm.js";
import { strategicFronts9 } from "./strategy-nine.js";
import { settleMarkets, validMarkets, marketHealth } from "./reign-economy.js";
import { settleLeagues, prepareLeagueArmies, validLeagues } from "./reign-leagues.js";

export const reignStages = { founded: "立足", rivalry: "争衡", settlement: "定制", succession: "交班", stewardship: "守成" };
export const constitutions = { central: "朝廷统筹", compact: "州郡共治", balanced: "分权统筹" };
export const reignTemplates = { growth: "整备民生", defense: "战时动员", concord: "结盟自保" };
export const administrativeDuties = { civil: "财赋与赈济", marshal: "军务与守备", envoy: "外交与盟约" };
const defaultBlueprint = { stateForm: "balanced", objective: "growth", stock: 12, annualLevy: 80, relief: 24, grain: 22, freight: 3, reserve: 25 };
const limit = (value) => Math.max(0, Math.min(100, value));
const controlling = (state, side, key) => state.cities[key]?.owner === side;
const living = (state, side) => Object.hasOwn(state.factions, side) && livingSide(state, side);
const forecastOnly = (state, forecast, side) => !forecast || side === state.player;

export function enableReign(state) {
  if (state.reign) return state;
  if (!state.strategy9) throw new Error("请先启用诸侯争衡。");
  return { ...state, reign: { since: state.turn, serial: 1, stage: "founded", stageSince: state.turn,
    seats: {}, deputies: {}, offices: {}, audits: {}, titles: {}, markets: {}, freights: [], relief: [], compacts: {},
    leagues: [], sanctions: [], recognitions: {}, guarantees: {}, reports: [], alerts: [], records: [], generations: [], stewardship: null } };
}

export function reignPolicy(state, side = state.player) {
  return state.reign?.blueprint && side === state.player ? state.reign.blueprint : defaultBlueprint;
}

export function validReignPolicy(value) {
  return plain(value) && Object.hasOwn(constitutions, value.stateForm) && Object.hasOwn(reignTemplates, value.objective)
    && bounded(value.stock, 5, 40) && bounded(value.annualLevy, 0, 160) && bounded(value.relief, 0, 120)
    && bounded(value.grain, 0, 90) && bounded(value.freight, 1, 6) && bounded(value.reserve, 5, 150);
}

export function regionCandidates10(world, state, region) {
  const towns = new Set(world.cities.filter((city) => city.region === region && controlling(state, state.player, city.key)).map(({ key }) => key));
  const eligible = eraByYear(world, state).officers.filter((person) => person.faction === state.player && knownOfficer(state, person)
    && !isOfficerUnavailable(state, person.key) && controlling(state, state.player, state.stations[person.key]));
  const local = eligible.filter((person) => towns.has(state.stations[person.key]));
  const rank = (person) => person.governance + (state.reign?.audits?.[person.key]?.merit ?? 0) / 5;
  if (local.length >= 2) {
    return local.sort((a, b) => rank(b) - rank(a));
  }
  const seatLeads = new Set(Object.entries(state.reign?.seats ?? {})
    .filter(([area, seat]) => area !== region && seat?.lead)
    .map(([, seat]) => seat.lead));
  const localKeys = new Set(local.map(({ key }) => key));
  const transferPool = eligible.filter((person) => !localKeys.has(person.key)
    && !armyByOfficer(state, person.key) && !seatLeads.has(person.key));
  const combined = [...local, ...transferPool];
  const fallbackPool = combined.length ? combined : eligible;
  return fallbackPool.sort((a, b) => Number(localKeys.has(b.key)) - Number(localKeys.has(a.key)) || rank(b) - rank(a));
}

export function publishReign(world, state, draft, { batch = false } = {}) {
  if (!state.reign || gameOutcome(state) !== "ongoing" || !validReignPolicy(draft)) throw new Error("请核对国策、储备和每季拨款上限。");
  const previous = dynastyPolicy(state);
  const priority = { growth: "growth", defense: "defense", concord: "relief" }[draft.objective];
  const next = saveDynastyPolicy(state, { ...previous, priority, moneyFloor: Math.max(previous.moneyFloor, draft.reserve),
    grainFloor: draft.reserve, diplomacy: draft.objective === "concord" });
  next.reign.blueprint = Object.fromEntries(Object.keys(defaultBlueprint).map((key) => [key, draft[key]]));
  next.reign.emergency = draft.objective === "defense";
  if (batch) {
    const provinces = dynastyProvinces(world, next);
    const hasLocal = (region) => {
      const towns = new Set(world.cities.filter((c) => c.region === region && controlling(next, next.player, c.key)).map((c) => c.key));
      return eraByYear(world, next).officers.some((o) => o.faction === next.player && knownOfficer(next, o) && towns.has(next.stations[o.key]));
    };
    const ordered = [
      ...provinces.filter((p) => hasLocal(p.region)),
      ...provinces.filter((p) => !hasLocal(p.region)),
    ];
    for (const province of ordered) {
      if (next.reign.seats[province.region]) continue;
      const [lead, deputy] = regionCandidates10(world, next, province.region);
      if (!lead) continue;
      if (next.dynasty.mandates[next.player]?.[province.region]) continue;
      const objective = { growth: "growth", defense: "defense", concord: "relief" }[draft.objective];
      next.reign.seats[province.region] = { lead: lead.key, deputy: deputy?.key ?? null, objective,
        money: 14, grain: 10, people: draft.objective !== "defense", dispatch: true, end: next.turn + 12, acting: false };
    }
  }
  return next;
}

export function giveProvinceCharter(world, state, region, draft) {
  const eligible = regionCandidates10(world, state, region).map(({ key }) => key);
  if (!state.reign?.blueprint || gameOutcome(state) !== "ongoing" || !plain(draft)
    || !eligible.includes(draft.lead) || (draft.deputy !== null && !eligible.includes(draft.deputy)) || draft.lead === draft.deputy
    || !["growth", "relief", "defense"].includes(draft.objective) || !bounded(draft.money, 0, 70) || !bounded(draft.grain, 0, 70)
    || !bounded(draft.term, 4, 16) || typeof draft.people !== "boolean" || typeof draft.dispatch !== "boolean") {
    throw new Error("请设定本州主官、副手、任期和授权额度。");
  }
  const next = structuredClone(state);
  const { lead, deputy, objective, money, grain, people, dispatch } = draft;
  next.reign.seats[region] = { lead, deputy, objective, money, grain, people, dispatch, acting: false, end: state.turn + draft.term };
  return next;
}

export function giveCourtCharter(world, state, role, lead, deputy, cap) {
  if (!state.reign || !Object.hasOwn(administrativeDuties, role) || !bounded(cap, 0, 90)) throw new Error("请输入有效的职责与授权上限。");
  const next = assignRealmOffice(world, state, role, lead, deputy);
  next.reign = { ...state.reign, offices: { ...state.reign.offices, [role]: { cap, term: state.turn + 12, lead, deputy } } };
  return next;
}

export function reignOfficeOptions(world, state, role) {
  return officeCandidates(eraByYear(world, state), state, role);
}

export function confirmWarDeputy(world, state, frontId, person) {
  if (!state.reign || gameOutcome(state) !== "ongoing") throw new Error("当前无法指定战区副手。");
  const front = strategicFronts9(state).find(({ id }) => id === frontId);
  const campaign = front && state.highCommand.campaigns.find(({ id }) => id === front.campaign);
  const army = armyByOfficer(state, person);
  const chosen = eraByYear(world, state).officers.find(({ key }) => key === person);
  if (!campaign || person === campaign.commander || person !== null && (chosen?.faction !== state.player
    || !knownOfficer(state, chosen) || !army && !controlling(state, state.player, state.stations[person]))
    || state.highCommand.campaigns.some(({ commander, stage }) => commander === person && stage !== "ended")) {
    throw new Error("请选择可接手该战区、未担任其他统帅的本方副手。");
  }
  const next = structuredClone(state);
  if (person === null) delete next.reign.deputies[frontId];
  else next.reign.deputies[frontId] = person;
  return next;
}

export function pauseMobilization10(state) {
  if (!state.reign?.blueprint || gameOutcome(state) !== "ongoing") throw new Error("当前没有可以裁撤的战时体制。");
  const next = structuredClone(state);
  next.reign.emergency = false;
  next.reign.blueprint.annualLevy = Math.min(45, next.reign.blueprint.annualLevy);
  if (next.reign.blueprint.objective === "defense") next.reign.blueprint.objective = "growth";
  const strategy = next.strategy9.plans[next.player];
  if (strategy) strategy.manpower = Math.min(strategy.manpower, 500);
  return next;
}

export function archiveEndingKind(state) {
  return state.scenarioEnding?.kind ?? (state.scenarioEnding ? "scenario" : "unification");
}

export function beginStewardship(world, state) {
  if (!state.reign || state.reign.stewardship || gameOutcome(state) !== "victory") throw new Error("先完成统一、共守或承平，才能进入守成篇。");
  const next = structuredClone(state);
  next.reign.blueprint ??= { ...defaultBlueprint };
  next.reign.stewardship = { from: state.turn, kind: archiveEndingKind(state), transferred: null, stable: 0,
    floor: Math.max(1, Math.ceil(Object.values(state.cities).filter(({ owner }) => owner === state.player).length * .8)), finished: null };
  next.reign.stage = "stewardship";
  next.reign.stageSince = state.turn;
  next.reign.emergency = Boolean(next.reign.emergency
    || state.strategy9.plans[state.player]?.manpower > 500 || state.highCommand.campaigns.some(({ stage }) => stage !== "ended"));
  delete next.scenarioEnding;
  return next;
}

export function reignSuccession(world, state, heir, deputy, now = false) {
  const next = saveSuccession(world, eraByYear(world, state), state, { heir, regent: deputy, abdicate: now });
  return next;
}

export function reignPeople(world, state) {
  return courtCandidates(eraByYear(world, state), state).filter(({ key }) => key !== courtFor(state, state.player)?.head);
}

export function recordReign(state, entries, kind, city, text, { side = state.player, critical = false, region = null } = {}) {
  const data = state.reign;
  const turn = state.turn + Number(Boolean(entries));
  if (data.reports.some((item) => item.turn === turn && item.kind === kind && item.city === city && item.text === text)) return;
  const note = { id: data.serial++, turn, kind, city, text, side, region };
  data.reports.push(note);
  data.reports = data.reports.slice(-72);
  if (critical && side === state.player && !data.alerts.some((item) => item.kind === kind && item.city === city && !item.read && turn - item.turn < 4)) {
    data.alerts.push({ ...note, read: false });
    data.alerts = data.alerts.slice(-24);
  }
  entries?.push({ type: "reign", faction: side, city, event: kind, text });
}

export function reignAlerts(state) {
  return state.reign?.alerts.filter(({ read, turn }) => !read && turn >= state.turn - 6) ?? [];
}

export function resolveReignAlert(world, state, id, answer) {
  const selected = state.reign?.alerts.find((note) => note.id === id && !note.read);
  if (!selected) throw new Error("这件奏报已阅或已经归档。");
  let next = structuredClone(state);
  if (answer === "relief") {
    const region = selected.region ?? world.cities.find(({ key }) => key === selected.city)?.region;
    next = orderJurisdiction(world, next, region, "relieve");
  }
  if (answer === "devolve") {
    const region = selected.region ?? world.cities.find(({ key }) => key === selected.city)?.region;
    next = orderJurisdiction(world, next, region, "charter");
    const seat = next.reign.seats[region];
    if (seat?.objective === "defense") seat.objective = "relief";
    const title = next.reign.titles[region];
    if (title) title.charter = Math.max(0, title.charter - 15);
  }
  next.reign.alerts.find((note) => note.id === id).read = true;
  return next;
}

function evaluateOfficer(state, key, result) {
  if (!key) return;
  const row = state.reign.audits[key] ??= { seasons: 0, merit: 0, burden: 0 };
  row.seasons = Math.min(state.turn + 1, row.seasons + 1);
  row.merit = limit(row.merit + (result > 0 ? 3 : 0));
  row.burden = limit(row.burden + (result < 0 ? 4 : -1));
}

function establishAuthorities(world, state, entries) {
  const side = state.player;
  const constMode = state.reign.blueprint.stateForm;
  for (const province of dynastyProvinces(world, state)) {
    const bill = state.reign.seats[province.region];
    if (!bill) continue;
    if (bill.end <= state.turn) {
      if (bill.end === state.turn) recordReign(state, entries, "term", province.cities[0], province.region + "州牧任期已满，须核定续任。", { critical: true, region: province.region });
      const old = state.dynasty.mandates[side]?.[province.region];
      if (old) old.mode = "direct";
      continue;
    }
    const roster = new Set(regionCandidates10(world, state, province.region).map(({ key }) => key));
    if (!roster.has(bill.lead)) {
      if (roster.has(bill.deputy)) {
        bill.lead = bill.deputy;
        bill.deputy = null;
        bill.acting = true;
        recordReign(state, entries, "deputy", province.cities[0], province.region + "副手已接管库存和未完调令。", { region: province.region });
      } else {
        const mandate = state.dynasty.mandates[side]?.[province.region];
        if (mandate) mandate.mode = "direct";
        recordReign(state, entries, "vacancy", province.cities[0], province.region + "主官与副手均无法履职，请补任。", { critical: true, region: province.region });
        continue;
      }
    }
    const budgetFactor = constMode === "compact" ? 1 : constMode === "central" ? .72 : .85;
    const mandates = state.dynasty.mandates[side] ??= {};
    mandates[province.region] = { region: province.region, steward: bill.lead, goal: bill.objective, money: Math.floor(bill.money * budgetFactor),
      grain: Math.floor(bill.grain * budgetFactor), dispatch: bill.dispatch, appoint: bill.people, mode: "delegate" };
    const register = state.reign.titles[province.region] ??= { charter: 5, term: state.turn };
    if (bill.objective === "defense" && state.reign.emergency) register.charter = limit(register.charter + (constMode === "compact" ? 5 : 2));
    else if (constMode === "central") register.charter = limit(register.charter - 3);
  }
}

function replaceCommanders(world, state, entries) {
  const era = eraByYear(world, state);
  const roster = new Map(era.officers.map((row) => [row.key, row]));
  const side = state.player;
  for (const front of strategicFronts9(state)) {
    const row = state.highCommand.campaigns.find(({ id }) => id === front.campaign);
    const canServe = (key) => roster.get(key)?.faction === side && Boolean(armyByOfficer(state, key) || controlling(state, side, state.stations[key]));
    if (canServe(row.commander)) continue;
    const deputy = state.reign.deputies[front.id];
    const unit = formationOf(state, deputy);
    const plan = state.frontline.plans.find(({ id }) => id === row.plan);
    if (!deputy || !canServe(deputy) || !plan) {
      recordReign(state, entries, "command", front.seat, "战区主帅失去指挥资格，须裁定换帅。", { critical: true });
      continue;
    }
    if (unit) {
      for (const other of state.frontline.plans) other.units = other.units.filter(({ id }) => id !== unit.id);
      plan.units = [{ id: unit.id, role: "advance" }, ...plan.units.filter(({ role }) => role !== "advance")].slice(0, 4);
    }
    row.commander = deputy;
    row.alert = null;
    row.acknowledged = null;
    delete state.reign.deputies[front.id];
    recordReign(state, entries, "deputy", front.seat, "战区副手接管原战役、剩余补给及调令。");
  }
}

export function prepareReign(world, state, proposals, entries, controlled, { playerOnly = false } = {}) {
  if (!state.reign?.blueprint) return;
  establishAuthorities(world, state, entries);
  replaceCommanders(world, state, entries);
  if (!playerOnly) prepareLeagueArmies(world, state, entries, controlled, proposals);
}

function stewardshipReady(world, state) {
  const crown = state.reign.stewardship;
  if (!crown || crown.finished !== null) return false;
  const own = world.cities.filter(({ key }) => controlling(state, state.player, key));
  return !state.reign.emergency && own.length >= crown.floor && marketHealth(state, state.player).sustained >= Math.ceil(own.length * .65)
    && state.factions[state.player].grain >= reignPolicy(state).reserve && state.factions[state.player].treasury >= reignPolicy(state).reserve
    && dynastyProvinces(world, state).every(({ stage }) => !["refusal", "revolt"].includes(stage));
}

export function stewardshipProgress(world, state) {
  const crown = state.reign?.stewardship;
  return crown && { ...crown, ready: stewardshipReady(world, state), seasons: state.turn - crown.from, required: 6 };
}

export function settleReign(world, previous, state, proposals, entries, forecast = false) {
  if (!state.reign?.blueprint) return null;
  const ledger = { budget: { treasury: 0, grain: 0 }, in: { treasury: 0, grain: 0 }, out: { treasury: 0, grain: 0 } };
  settleMarkets(world, previous, state, entries, ledger, forecast);
  settleLeagues(world, previous, state, proposals, entries, ledger, forecast);
  if (forecast) return ledger;
  const data = state.reign;
  const turn = state.turn + 1;
  const player = state.player;
  const capital = firstCity(world, state);
  const court = courtFor(state, player);
  for (const [duty, bill] of Object.entries(data.offices)) {
    const appointed = state.realm.offices[duty];
    if (appointed?.holder && appointed.holder !== bill.lead) {
      bill.lead = appointed.holder;
      bill.deputy = appointed.deputy ?? null;
      recordReign(state, entries, "deputy", capital, administrativeDuties[duty] + "副手接手原授权。");
    }
    if (bill.term === turn) recordReign(state, entries, "term", capital, administrativeDuties[duty] + "授权届期，请册任续签。", { critical: true });
  }
  for (const province of dynastyProvinces(world, state)) {
    const order = data.seats[province.region];
    if (!order || order.end < turn) continue;
    evaluateOfficer(state, order.lead, province.welfare >= 61 ? 1 : province.welfare < 49 ? -1 : 0);
    const influence = data.titles[province.region]?.charter ?? 0;
    if (influence >= 45 && province.stage !== "stable") {
      const local = state.polity.provinces[province.key];
      if (local) local.pressure = limit(local.pressure + 5);
      recordReign(state, entries, "autonomy", province.cities[0], province.region + "军政事权过重，需协商续约或让权。", { critical: true, region: province.region });
    }
  }
  for (const { type, event, city, faction, text } of entries.slice()) {
    if (faction === player && type === "polity" && ["defection", "uprising", "independence", "court-warning"].includes(event) && city) {
      recordReign(state, entries, event, city, text, { critical: true });
    }
  }
  if (court?.last?.turn === turn) {
    const { support, result } = court.last;
    data.generations.push({ at: turn, head: court.head, support, result, offices: Object.keys(state.realm.offices).length });
    data.generations = data.generations.slice(-16);
    if (data.stewardship && result === "succession") data.stewardship.transferred = turn;
    recordReign(state, entries, "succession", capital, result === "succession" ? "新任君主已接收国库、军令和条约档案。" : "交班未获充分支持，摄政或临时班底接手。", { critical: result !== "succession" });
  }
  const crown = data.stewardship;
  if (crown && crown.finished === null) {
    crown.stable = stewardshipReady(world, state) ? Math.min(6, crown.stable + 1) : 0;
    if (crown.transferred !== null && turn - crown.from >= 8 && crown.stable >= 6) {
      crown.finished = turn;
      recordReign(state, entries, "ending", capital, "新政权完成交班和秩序恢复，守成篇结卷。");
    }
  } else if (!crown) {
    const livingRivals = Object.keys(state.factions).filter((key) => key !== player && living(state, key)).length;
    const authority = Object.keys(data.seats).length || Object.keys(state.dynasty.mandates[player] ?? {}).length;
    const campaign = state.highCommand.campaigns.some(({ side, stage }) => side === player && stage !== "ended");
    const stage = data.generations.length ? "succession" : authority >= 2 && turn - data.since >= 6 && (livingRivals > 0 || campaign) ? "settlement"
      : campaign || authority || turn - data.since >= 4 ? "rivalry" : "founded";
    if (data.stage !== stage) { data.stage = stage; data.stageSince = turn; }
  }
  return ledger;
}

export function archiveReign(world, previous, state) {
  const data = state.reign;
  if (!data?.blueprint) return;
  const moves = (state.armies ?? []).filter(({ faction }) => faction === state.player).slice(0, 12)
    .map(({ location, target, phase, route }) => ({ city: location, to: target, phase, route: route.slice() }));
  const cargos = data.freights.filter(({ side, status }) => side === state.player && ["travel", "blocked"].includes(status))
    .map(({ route, cursor, to, status }) => ({ city: route[cursor], to, route: route.slice(cursor), status: status === "blocked" ? status : "march" }));
  const battles = state.frontline.battles.filter(({ sides, turn }) => turn === state.turn - 1 && sides.some(({ faction }) => faction === state.player))
    .slice(-5).map((battle) => structuredClone(battle));
  data.records.push({ at: state.turn, stage: data.stage, moves, cargos, battles,
    losses: world.cities.filter(({ key }) => state.cities[key].owner !== previous.cities[key].owner).map(({ key }) => key),
    distress: world.cities.filter(({ key }) => state.cities[key].owner === state.player && (data.markets[key]?.cause !== "normal" || state.cities[key].occupation)).map(({ key }) => key),
    cash: state.factions[state.player].treasury, grain: state.factions[state.player].grain, decision: reignAlerts(state).filter(({ turn }) => turn === state.turn).length });
  data.records = data.records.slice(-24);
}

export function reignFrame(world, state, turn) {
  const order = state.reign?.records.find(({ at }) => at === turn);
  const ownership = territoryAt(world, state, turn);
  if (!order || !ownership) return null;
  return { turn, ownership, freights: order.cargos, front: order.moves, distress: order.distress };
}

export function validReign(world, state, officers) {
  const d = state.reign;
  if (d === undefined) return true;
  if (!state.strategy9 || !plain(d) || !bounded(d.since, 0, state.turn) || !bounded(d.serial, 1, 100000000)) return false;
  const city = (key) => Object.hasOwn(state.cities, key);
  const side = (key) => Object.hasOwn(state.factions, key);
  const region = (key) => world.cities.some((item) => item.region === key);
  const officer = (key) => key === null || officers.has(key);
  const date = (turn) => bounded(turn, d.since, state.turn);
  const due = (turn, max = 20) => bounded(turn, d.since, state.turn + max);
  const id = (value) => bounded(value, 1, d.serial - 1);
  const list = (value, maximum, check) => Array.isArray(value) && value.length <= maximum && value.every(check);
  const map = (value, keys, check) => plain(value) && Object.entries(value).every(([key, entry]) => keys(key) && check(entry));
  const note = (row) => plain(row) && id(row.id) && date(row.turn) && side(row.side) && city(row.city) && (row.region === null || region(row.region))
    && typeof row.kind === "string" && row.kind.length <= 40 && typeof row.text === "string" && row.text.length <= 220;
  const cityCount = Math.max(44, world.cities.length);
  const movement = (row) => plain(row) && city(row.city) && city(row.to) && list(row.route, cityCount, city);
  return Object.hasOwn(reignStages, d.stage) && date(d.stageSince) && (d.blueprint === undefined || validReignPolicy(d.blueprint))
    && (d.emergency === undefined || typeof d.emergency === "boolean")
    && map(d.seats, region, (row) => plain(row) && officer(row.lead) && officer(row.deputy) && ["growth", "defense", "relief"].includes(row.objective)
      && bounded(row.money, 0, 70) && bounded(row.grain, 0, 70) && due(row.end) && typeof row.people === "boolean" && typeof row.dispatch === "boolean" && typeof row.acting === "boolean")
    && map(d.deputies, (key) => bounded(Number(key), 1, state.strategy9.serial - 1), officer)
    && map(d.offices, (key) => Object.hasOwn(administrativeDuties, key), (row) => plain(row) && bounded(row.cap, 0, 90)
      && due(row.term) && officer(row.lead) && officer(row.deputy))
    && map(d.audits, officer, (row) => plain(row) && bounded(row.seasons, 0, state.turn) && bounded(row.merit, 0, 100) && bounded(row.burden, 0, 100))
    && map(d.titles, region, (row) => plain(row) && bounded(row.charter, 0, 100) && date(row.term))
    && list(d.reports, 72, note) && list(d.alerts, 24, (row) => note(row) && typeof row.read === "boolean")
    && list(d.generations, 16, (row) => plain(row) && date(row.at) && officer(row.head) && bounded(row.support, 0, 100) && bounded(row.offices, 0, 3)
      && ["succession", "regency", "court-crisis"].includes(row.result))
    && list(d.records, 24, (row) => plain(row) && date(row.at) && Object.hasOwn(reignStages, row.stage)
      && list(row.moves, 12, movement) && list(row.cargos, 6, movement) && list(row.losses, cityCount, city) && list(row.distress, cityCount, city)
      && list(row.battles, 5, (item) => plain(item) && bounded(item.id, 1, state.frontline.sequence - 1)
        && item.turn === row.at - 1 && validFrontlineBattle(state, officers, item))
      && ["cash", "grain", "decision"].every((key) => bounded(row[key], 0, Number.MAX_SAFE_INTEGER)))
    && (d.stewardship === null || plain(d.stewardship) && date(d.stewardship.from)
      && ["unification", "coalition", "peace", "scenario"].includes(d.stewardship.kind) && bounded(d.stewardship.floor, 1, cityCount)
      && bounded(d.stewardship.stable, 0, 6) && [d.stewardship.transferred, d.stewardship.finished].every((turn) => turn === null || date(turn)))
    && validMarkets(world, state, d) && validLeagues(state, d);
}
