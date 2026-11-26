import { advanceQuarter, cityName, firstCity, gameOutcome } from "./engine.js";
import { isHostile, treatyWith } from "./diplomacy.js";
import { dynastyProvinces, saveDynastyPolicy, dynastyPolicy } from "./dynasty.js";
import { openRoadEdge } from "./grand-logistics.js";
import { warBlockaded } from "./war-operations.js";
import { archiveSymbols, bounded, encodeTerritory, livingSide, plain, provinceKey } from "./polities-data.js";
import { courtFor } from "./polity-governance.js";
import { archiveEndingKind, beginStewardship, giveProvinceCharter, publishReign, recordReign, regionCandidates10, reignPolicy } from "./reign.js";
import { marketRoute, marketRow, orderMarketRelief } from "./reign-economy.js";
import { proposeDynastyTreaty } from "./dynasty-treaties.js";
import { assureHandover10, leagueMarket } from "./reign-leagues.js";
import { amendFront9, objectives9, publishStrategy9, strategicFronts9 } from "./strategy-nine.js";
import { saveRecovery } from "./war-recovery.js";
import { validFrontlineBattle } from "./frontline.js";

export const reignChapters15 = { contest: "争雄", foundation: "立制", succession: "交班", restoration: "重整" };
export const annualObjectives15 = { expansion: "开拓疆土", accord: "保境通商", recovery: "休养重建" };
const base = {
  expansion: { civil: 38, military: 100, relief: 28, grain: 72, reserve: 35, levy: 100, transport: 5 },
  accord: { civil: 52, military: 36, relief: 38, grain: 48, reserve: 30, levy: 24, transport: 5 },
  recovery: { civil: 62, military: 24, relief: 50, grain: 54, reserve: 28, levy: 0, transport: 6 },
};
const objectives = Object.keys(annualObjectives15);
const chapterOutcomes = ["unification", "coalition", "peace", "scenario", "stewardship", "expansion", "accord", "recovery"];
const frameLimit = 193;
const populationFloor = 800;
const own = (state, city) => state.cities[city]?.owner === state.player;
const owns = (state, side, key) => state.cities[key]?.owner === side;
const laborLimit = (value) => Math.max(0, Math.min(100, value));
const resourcePair = () => ({ treasury: 0, grain: 0 });
const has = (object, key) => typeof key === "string" && Object.hasOwn(object, key);
const held = (state, faction) => Object.keys(state.cities).filter((key) => owns(state, faction, key));
const troopCount = (state, side, city) => Math.min(9000, (state.armies ?? [])
  .filter(({ faction, depot, phase }) => faction === side && depot === city && phase !== "hold")
  .reduce((sum, { troops }) => sum + troops, 0));

export function annualDraft15(objective, other = objective === "recovery" ? "accord" : "recovery") {
  return { primary: objective, secondary: other, ...base[objective] };
}

export function enableCentury(state) {
  if (state.century) return state;
  if (!state.reign) throw new Error("请先启用王朝兴替。");
  const started = held(state, state.player).length;
  return { ...state, century: { since: state.turn, plan: null, chapter: "contest", chapterSince: state.turn,
    started, peak: started, stable: 0, trade: 0, generation: 0, restoration: null, concluded: null,
    epochs: [], frames: [], battles: [], charters: {}, transitions: {}, works: {}, rulers: {}, cases: [], serial: 1 } };
}

function validDraft(draft) {
  return plain(draft) && objectives.includes(draft.primary) && objectives.includes(draft.secondary) && draft.primary !== draft.secondary
    && ["civil", "military", "relief", "grain", "reserve", "levy"].every((key) => bounded(draft[key], 0, 160))
    && draft.grain > 0 && draft.reserve >= 5 && bounded(draft.transport, 1, 6);
}

export function publishYear15(world, state, draft, { auto = true } = {}) {
  if (!state.century || gameOutcome(state) !== "ongoing" || !validDraft(draft)) throw new Error("请选择不同的主次目标，并核对年度额度。");
  const expansion = draft.primary === "expansion";
  const policy = {
    ...reignPolicy(state), stateForm: expansion ? "central" : draft.primary === "accord" ? "compact" : "balanced",
    objective: expansion ? "defense" : draft.primary === "accord" ? "concord" : "growth",
    annualLevy: draft.levy, grain: Math.min(90, draft.grain), relief: Math.min(120, draft.relief),
    freight: draft.transport, reserve: Math.min(150, draft.reserve),
  };
  let next = publishReign(world, state, policy, { batch: auto });
  next = saveDynastyPolicy(next, { ...dynastyPolicy(next), money: draft.civil, grain: draft.grain,
    moneyFloor: draft.reserve, grainFloor: draft.reserve });
  next.century.regions ??= Object.fromEntries(world.cities.map(({ key, region }) => [key, region]));
  const goals = objectives9(world, next);
  const stability = { kind: "stability", key: firstCity(world, next) };
  const corridor = goals.corridor[0] && { kind: "corridor", key: goals.corridor[0].key };
  const concord = goals.concord[0] && { kind: "concord", key: goals.concord[0].key };
  const aims = { expansion: corridor, accord: concord, recovery: stability };
  const primary = aims[draft.primary] ?? stability;
  const secondary = [aims[draft.secondary], stability, corridor, concord].find((aim) => aim && aim.kind !== primary.kind);
  if (secondary) {
    next = publishStrategy9(world, next, { primary, secondary, money: Math.max(5, draft.military), grain: Math.max(5, draft.grain),
      manpower: expansion ? 1800 : 650, transport: draft.transport, negotiate: draft.primary === "accord" });
  }
  next.century.plan = { ...Object.fromEntries(Object.keys(annualDraft15(draft.primary, draft.secondary)).map((key) => [key, draft[key]])),
    signed: state.turn, review: state.turn + 4, auto };
  if (auto && (!next.war.recovery || next.war.recovery.follow)) {
    next = saveRecovery(world, next, { follow: true, cities: [], treasury: Math.min(24, draft.civil), grain: Math.min(24, draft.grain) });
  }
  return next;
}

export function previewYear15(world, state, draft, options) {
  const project = (initial) => {
    let next = initial;
    const seasons = [];
    for (let season = 0; season < 4 && gameOutcome(next) === "ongoing"; season++) {
      next = advanceQuarter(world, next);
      const frame = next.century.frames.at(-1);
      seasons.push({ ...frame, stalled: next.century.cases.filter(({ turn, kind }) => turn === next.turn && kind === "resources").length });
    }
    return seasons;
  };
  return { current: project(state), proposed: project(publishYear15(world, state, draft, options)) };
}

export function provinceAgreement15(world, state, region, mode, options = {}) {
  const province = dynastyProvinces(world, state).find((row) => row.region === region);
  if (!state.century || !province || gameOutcome(state) !== "ongoing" || !["compact", "renew"].includes(mode)) {
    throw new Error("请先选定己方有效州郡。");
  }
  let baseState = state;
  if (!baseState.century.plan) {
    const inferredPrimary = baseState.nationalPolicy?.front?.garrison >= 2400 ? "expansion"
      : baseState.nationalPolicy?.front?.focus === "defense" ? "recovery" : "accord";
    baseState = publishYear15(world, baseState, annualDraft15(inferredPrimary), { auto: true });
  }
  const roster = regionCandidates10(world, baseState, region);
  const seat = baseState.reign.seats[region];
  const requested = options.leadKey ? roster.find(({ key }) => key === options.leadKey) : null;
  const lead = requested ?? roster.find(({ key }) => key === seat?.lead) ?? roster[0];
  if (!lead) throw new Error("本方暂无可任命州牧的人员。");
  const deputy = roster.find(({ key }) => key === seat?.deputy && key !== lead.key) ?? roster.find(({ key }) => key !== lead.key);
  const compact = mode === "compact";
  const objective = ["growth", "defense", "relief"].includes(options.objective)
    ? options.objective
    : (compact ? "relief" : seat?.objective ?? "growth");
  const next = giveProvinceCharter(world, baseState, region, { lead: lead.key, deputy: deputy?.key ?? null,
    objective, money: compact ? 24 : seat?.money ?? 18,
    grain: compact ? 18 : seat?.grain ?? 14, term: 12, people: true, dispatch: true });
  const prior = next.century.charters[region];
  next.century.charters[region] = { retain: compact ? 40 : 27, through: baseState.turn + 12, served: prior?.served ?? 0,
    arrears: 0, duty: objective === "relief" ? "relief" : "recovery" };
  return next;
}

export function setFrontPriority15(world, state, id) {
  const front = strategicFronts9(state).find((row) => row.id === id);
  if (!front || !state.century) throw new Error("战区已失效。");
  return amendFront9(world, state, id, { priority: front.priority === 5 ? 3 : 5, status: front.status });
}

export function reopenChapter15(world, state) {
  if (!state.century || gameOutcome(state) !== "victory") throw new Error("本章结局达成后可继续。");
  let next;
  if (!state.reign.stewardship && !state.century.concluded) {
    next = beginStewardship(world, state);
  } else {
    next = structuredClone(state);
    const previous = next.reign.stewardship ?? { kind: "scenario" };
    next.reign.stewardship = { ...previous, from: next.turn, finished: null, transferred: null, stable: 0,
      floor: Math.max(1, Math.ceil(held(next, next.player).length * .8)) };
  }
  next.century.concluded = null;
  next.century.restoration = null;
  next.century.stable = 0;
  next.century.generation++;
  next.century.chapter = "foundation";
  next.century.chapterSince = next.turn;
  return next;
}

export function concludeChapter15(state, kind) {
  const data = state.century;
  if (gameOutcome(state) !== "ongoing" || !objectives.includes(kind)
    || !data?.epochs.some((row) => row.kind === kind && row.generation === data.generation)) {
    throw new Error("本章尚未达成所选结局。");
  }
  return { ...state, century: { ...data, concluded: { kind, turn: state.turn } } };
}

export function labor15(state, key) {
  const town = state.cities[key];
  const home = state.realm.cities[key];
  const capacity = Math.max(60, Math.floor(home.population / 14));
  const market = state.reign.freights.filter(({ status, route, cursor }) =>
    ["travel", "blocked"].includes(status) && (route[cursor] === key || route[cursor + 1] === key)).length;
  const garrison = Math.ceil(troopCount(state, town.owner, key) / 12);
  const carriage = market * 35;
  const recovery = town.occupation ? 90 : state.century.works[key]?.used ?? 0;
  const cultivation = Math.max(0, capacity - garrison - carriage - recovery);
  return { capacity, garrison, carriage, recovery, cultivation, rate: Math.max(.45, Math.min(1, cultivation / (capacity * .67))) };
}

export function adjustedHarvest15(state, key, gross) {
  if (!state.century?.plan) return gross;
  const { rate } = labor15(state, key);
  return { treasury: Math.floor(gross.treasury * (.78 + .22 * rate)), grain: Math.floor(gross.grain * rate) };
}

export function retainedShare15(state, key) {
  if (!state.century?.plan || !own(state, key)) return undefined;
  const row = state.century.charters[state.century.regions?.[key]];
  if (row?.through > state.turn) return row.retain;
  if (state.century.plan.primary === "recovery") return 36;
  return undefined;
}

function note(state, entries, caseKey, kind, city, text, urgent = false) {
  const data = state.century;
  const turn = state.turn + 1;
  const existing = data.cases.findLast((row) => row.key === caseKey);
  if (existing && turn - existing.turn < 4) return;
  data.cases.push({ id: data.serial++, key: caseKey, kind, city, text, turn, urgent, done: false });
  data.cases = data.cases.slice(-48);
  recordReign(state, entries, "century-" + kind, city, text);
}

export function openCases15(state) {
  return state.century?.cases.filter(({ done, turn }) => !done && state.turn - turn < 12)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.turn - a.turn) ?? [];
}

export function answerCase15(world, state, id, answer) {
  const row = openCases15(state).find((item) => item.id === id);
  if (!row) throw new Error("这项待决已归档。");
  let next = structuredClone(state);
  if (answer === "grant") next = provinceAgreement15(world, next, next.century.regions[row.city], "compact");
  if (answer === "relief") {
    if (!own(next, row.city)) throw new Error("这座城已易主。");
    if (!next.reign.relief.includes(row.city)) next = orderMarketRelief(next, row.city);
  }
  next.century.cases.find((item) => item.id === id).done = true;
  return next;
}

function rulerDraft(world, state, side) {
  const cities = held(state, side);
  const neighbors = new Set(world.cities.filter(({ key }) => cities.includes(key)).flatMap(({ links }) => links)
    .map((key) => state.cities[key].owner).filter((faction) => faction !== side));
  const supply = state.factions[side].grain / Math.max(1, cities.length);
  const unrest = cities.filter((key) => state.realm.cities[key].welfare < 54).length;
  const rivals = [...neighbors].filter((target) => isHostile(state, side, target));
  const kind = unrest || supply < 8 ? "recovery" : cities.length < 5 || rivals.length > 2 ? "accord" : "expansion";
  const target = [...neighbors].sort((a, b) => held(state, b).length - held(state, a).length)[0] ?? null;
  return { kind, target };
}

export function centuryModelChoices(world, state, side) {
  if (!state.century?.plan || !livingSide(state, side)) return [];
  const current = state.century.rulers[side];
  if (current?.until > state.turn) return [{ id: current.kind, text: annualObjectives15[current.kind] + "，方略尚余 " + (current.until - state.turn) + " 季" }];
  return objectives.map((id) => ({ id, text: annualObjectives15[id] }));
}

function prepareRulers(world, state, proposals) {
  for (const side of Object.keys(state.factions)) {
    if (side === state.player || !livingSide(state, side)) continue;
    const old = state.century.rulers[side];
    if (old?.until > state.turn && (!old.target || livingSide(state, old.target))) continue;
    const proposal = proposals[side]?.century;
    const fallback = rulerDraft(world, state, side);
    const mode = objectives.includes(proposal) ? proposal : fallback.kind;
    state.century.rulers[side] = { ...fallback, kind: mode, until: state.turn + 4 };
  }
}

export function regime15(state, side) {
  return state.century?.rulers[side] ?? null;
}

function spend(state, side, ledger, money, grain, reserve) {
  const stock = state.factions[side];
  if (stock.treasury < money + reserve || stock.grain < grain + reserve) return false;
  stock.treasury -= money;
  stock.grain -= grain;
  if (side === state.player) {
    ledger.budget.treasury += money;
    ledger.budget.grain += grain;
  }
  return true;
}

function settleResidents(world, before, state, entries, ledger, forecast) {
  const data = state.century;
  let funds = data.plan.civil;
  let grain = data.plan.grain;
  let relief = data.plan.relief;
  const moved = [];
  for (const { key, links } of world.cities) {
    const town = state.cities[key];
    const side = town.owner;
    if (forecast && side !== state.player) continue;
    const home = state.realm.cities[key];
    const conditions = marketRow(state, key);
    const occupation = before.cities[key].owner !== side;
    if (occupation) data.transitions[key] = { turn: state.turn + 1, from: before.cities[key].owner, to: side, progress: 0,
      garrison: town.troops, stores: conditions.bins };
    const transition = data.transitions[key];
    const receivingSide = occupation ? before.cities[key].owner : side;
    const evacuationRoutes = occupation ? before : state;
    const recipient = links.filter((target) => owns(state, receivingSide, target) && openRoadEdge(evacuationRoutes, receivingSide, key, target, false, "land")
      && state.realm.cities[target].welfare >= 60 && !state.cities[target].occupation && marketRow(state, target).bins >= 4)
      .sort((a, b) => state.realm.cities[b].welfare - state.realm.cities[a].welfare)[0];
    if (recipient && (occupation || home.welfare < 44 && (conditions.missing || warBlockaded(state, key)))) {
      const room = Math.floor(state.realm.cities[recipient].baseline * 1.28) - state.realm.cities[recipient].population;
      const count = Math.max(0, Math.min(room, Math.floor(home.population * .035), home.population - populationFloor));
      if (count) {
        home.population -= count;
        state.realm.cities[recipient].population += count;
        state.realm.cities[recipient].welfare = Math.max(10, state.realm.cities[recipient].welfare - 2);
        moved.push({ from: key, to: recipient, count, side: receivingSide });
        if (receivingSide === state.player && marketRow(state, recipient).bins >= 2 && grain >= 2 && relief >= 2
          && spend(state, receivingSide, ledger, 2, 2, data.plan.reserve)) {
          grain -= 2;
          relief -= 2;
          data.works[recipient] = { used: 70, turn: state.turn + 1 };
          state.realm.cities[recipient].welfare = Math.min(100, state.realm.cities[recipient].welfare + 4);
        }
      }
    }
    if (!transition || transition.progress >= 3 || town.occupation && warBlockaded(state, key)) continue;
    if (side !== state.player && regime15(state, side)?.kind !== "recovery") continue;
    const canSpend = side !== state.player || funds >= 5 && grain >= 3;
    if (canSpend && spend(state, side, ledger, 5, 3, side === state.player ? data.plan.reserve : 14)) {
      if (side === state.player) { funds -= 5; grain -= 3; }
      home.welfare = Math.min(100, home.welfare + 4);
      data.works[key] = { used: 90, turn: state.turn + 1 };
      if (++transition.progress === 3 && town.troops >= 450 && town.governor) town.occupation = 0;
    } else if (side === state.player && !forecast) {
      note(state, entries, "res:" + key, "resources", key, cityName(world, key) + "整顿缺预算，已延后本季恢复。", home.welfare < 48);
    }
    if (side === state.player && transition.progress === 3 && !forecast) {
      note(state, entries, "capture:" + key, "integrated", key, cityName(world, key) + "战后接管拨款已完成。");
    }
  }
  for (const [key, row] of Object.entries(data.works)) if (row.turn <= state.turn) delete data.works[key];
  if (moved.length && !forecast) {
    for (const { from, to, count, side } of moved) {
      if (side === state.player) note(state, entries, "evac:" + from, "migration", from,
        cityName(world, from) + "有 " + count + " 人迁入" + cityName(world, to) + "。");
    }
  }
  return moved.filter(({ side }) => side === state.player).reduce((sum, row) => sum + row.count, 0);
}

function settleCharters(world, state, entries, ledger, forecast) {
  const data = state.century;
  for (const [region, agreement] of Object.entries(data.charters)) {
    const province = dynastyProvinces(world, state).find((row) => row.region === region);
    if (!province || agreement.through <= state.turn) continue;
    const market = province.cities.filter((key) => marketRow(state, key).bins >= 5);
    const prosperity = market.length * 2 >= province.cities.length;
    const paid = prosperity && spend(state, state.player, ledger, 2, 0, data.plan.reserve);
    if (paid) {
      agreement.served++;
      agreement.arrears = 0;
    } else agreement.arrears++;
    const present = state.polity.provinces[provinceKey(state.player, region)];
    if (present) present.pressure = laborLimit(present.pressure + (paid ? -3 : agreement.arrears >= 2 ? 6 : 2));
    if (!forecast && agreement.arrears >= 2) note(state, entries, "c:" + region, "charter", province.cities[0],
      region + "地方协议已两季未能兑现，州郡压力上升。", agreement.arrears >= 3);
  }
}

function settleRulers(world, state, ledger, entries) {
  for (const [side, policy] of Object.entries(state.century.rulers)) {
    if (!livingSide(state, side)) continue;
    const city = firstCity(world, state, side);
    const market = marketRow(state, city);
    if (policy.kind === "recovery" && market.bins < 12 && spend(state, side, ledger, 2, 4, 15)) {
      state.reign.markets[city].bins += 4;
      state.realm.cities[city].welfare = Math.min(100, state.realm.cities[city].welfare + 2);
    } else if (policy.kind === "accord" && state.turn % 4 === 2) {
      const partners = Object.keys(state.factions).filter((other) => other !== side && livingSide(state, other) && leagueMarket(state, side, other));
      const partner = partners.find((other) => {
        const destination = firstCity(world, state, other);
        return state.factions[other].treasury >= 18 && state.factions[other].grain >= 15
          && marketRow(state, destination).bins < 10 && marketRoute(world, state, side, city, destination);
      });
      if (!partner || !spend(state, side, ledger, 0, 3, 18)) continue;
      const to = firstCity(world, state, partner);
      if (!spend(state, partner, ledger, 2, 0, 15)) continue;
      state.reign.markets[to].bins += 3;
      state.factions[side].treasury += 2;
      if (partner === state.player) {
        state.century.trade += 3;
        note(state, entries, "trade:" + side, "trade", to, cityName(world, to) + "按盟市议约从对方商船接收 3 粮。");
      }
    }
  }
}

export function settleCentury(world, previous, state, proposals, entries, forecast = false) {
  if (!state.century?.plan) return null;
  const data = state.century;
  data.regions ??= Object.fromEntries(world.cities.map(({ key, region }) => [key, region]));
  const ledger = { budget: resourcePair(), in: resourcePair(), out: resourcePair() };
  if (!forecast) prepareRulers(world, state, proposals);
  const migrated = settleResidents(world, previous, state, entries, ledger, forecast);
  settleCharters(world, state, entries, ledger, forecast);
  if (!forecast) {
    settleRulers(world, state, ledger, entries);
    data.lastMigration = migrated;
  }
  return ledger;
}

export function renewAccord15(world, state) {
  if (!state.century?.plan) throw new Error("请先制定全国方略。");
  const partner = Object.keys(state.factions).find((key) => key !== state.player && livingSide(state, key)
    && (treatyWith(state, state.player, key) || !isHostile(state, state.player, key)));
  if (gameOutcome(state) === "victory") return reopenChapter15(world, state);
  if (state.reign.stewardship?.finished === null) return assureHandover10(world, state);
  if (!partner) throw new Error("暂无可续约的势力。");
  return proposeDynastyTreaty(world, state, { to: partner, seasons: 6, passage: true, defense: false, payment: 0, cede: null, post: null });
}

function addEpoch(data, kind, turn) {
  if (data.epochs.some((row) => row.generation === data.generation && row.kind === kind)) return;
  data.epochs = [...data.epochs, { kind, turn, generation: data.generation }].slice(-24);
}

export function prepareCenturyYear(world, state) {
  const data = state.century;
  if (!data?.plan?.auto || data.plan.review > state.turn) return;
  data.plan.review = state.turn + 4;
  for (const [region, seat] of Object.entries(state.reign.seats)) {
    if (seat.end > state.turn || !regionCandidates10(world, state, region).some(({ key }) => key === seat.lead)) continue;
    if ((data.charters[region]?.arrears ?? 0) >= 2) continue;
    seat.end = state.turn + 8;
  }
  if (data.plan.secondary === "recovery") {
    const exposed = held(state, state.player).find((key) => marketRow(state, key).bins < 3
      && state.realm.cities[key].welfare < 60 && state.reign.seats[data.regions?.[key]]?.dispatch);
    if (exposed && !state.reign.relief.includes(exposed) && state.reign.relief.length < 6) state.reign.relief.push(exposed);
  }
}

export function archiveCentury(world, state, entries) {
  const data = state.century;
  if (!data) return;
  const cities = held(state, state.player);
  data.peak = Math.max(data.peak, cities.length);
  const ruler = courtFor(state, state.player);
  const fragile = entries.some(({ type, event, faction }) => type === "polity" && faction === state.player && ["independence", "uprising", "court-crisis"].includes(event))
    || data.peak - cities.length >= Math.max(2, Math.ceil(data.peak * .19));
  if (fragile && data.restoration === null) data.restoration = { turn: state.turn, floor: cities.length, restored: null };
  const reliable = cities.filter((key) => {
    const market = state.reign.markets[key];
    return market && state.realm.cities[key].welfare >= 59 && (market.bins >= 4 || market.missing === 0);
  }).length;
  const stock = state.factions[state.player];
  const policy = data.plan;
  if (policy) {
    data.stable = reliable >= Math.ceil(cities.length * .55) && stock.treasury >= policy.reserve && stock.grain >= policy.reserve
      && cities.length ? Math.min(12, data.stable + 1) : 0;
    const aids = state.reign.leagues.filter(({ status, members }) => status === "active" && Object.hasOwn(members, state.player));
    const peaceful = Object.keys(state.factions).filter((key) => key !== state.player && livingSide(state, key) && leagueMarket(state, state.player, key)).length;
    if (aids.length || peaceful >= 2) data.trade++;
    else data.trade = 0;
    const completed = Object.values(data.transitions).filter(({ to, progress }) => to === state.player && progress === 3).length;
    if (data.stable >= 4 && cities.length >= data.started + 3 && completed >= 2) addEpoch(data, "expansion", state.turn);
    if (data.trade >= 5 && cities.length >= data.started && data.stable >= 3) addEpoch(data, "accord", state.turn);
    if (data.restoration && data.restoration.restored === null && cities.length > data.restoration.floor && data.stable >= 4
      && state.turn - data.restoration.turn >= 4) {
      data.restoration.restored = state.turn;
      addEpoch(data, "recovery", state.turn);
    }
  }
  const result = gameOutcome(state);
  if (result === "victory") addEpoch(data, state.reign.stewardship?.finished ? "stewardship" : archiveEndingKind(state), state.turn);
  const chapter = data.restoration?.restored === null && data.restoration ? "restoration"
    : ruler?.warned || ruler?.last?.turn >= state.turn - 3 ? "succession"
      : state.reign.stewardship || cities.length >= data.started + 2 || data.stable >= 4 ? "foundation" : "contest";
  if (chapter !== data.chapter) {
    data.chapter = chapter;
    data.chapterSince = state.turn;
  }
  const symbols = Object.fromEntries(world.cities.map(({ key }, index) => [key, archiveSymbols[index]]));
  const pack = (city, target, route, blocked) => [blocked ? "!" : ".", city, target, ...route]
    .map((key) => symbols[key] ?? key).join("");
  const moves = (state.armies ?? []).filter(({ faction }) => faction === state.player).slice(0, 9)
    .map(({ location, target, route }) => pack(location, target, route, false));
  const cargos = state.reign.freights.filter(({ side, status }) => side === state.player && ["travel", "blocked"].includes(status))
    .map(({ route, cursor, to, status }) => pack(route[cursor], to, route.slice(cursor), status === "blocked"));
  const flags = state.reign.records.at(-1)?.at === state.turn ? state.reign.records.at(-1).distress.map((key) => symbols[key]).join("") : "";
  const battles = state.frontline.battles.filter(({ turn, sides }) => turn === state.turn - 1 && sides.some(({ faction }) => faction === state.player));
  data.battles = [...data.battles, ...battles.map((battle) => structuredClone(battle))].slice(-58);
  data.frames = [...data.frames, { turn: state.turn, map: encodeTerritory(world, state), chapter, cities: cities.length, cash: stock.treasury,
    grain: stock.grain, stable: data.stable, population: cities.reduce((sum, key) => sum + state.realm.cities[key].population, 0),
    migrated: data.lastMigration ?? 0, agreements: state.reign.leagues.filter(({ status }) => status === "active").length,
    authority: cities.filter((key) => {
      const charter = data.charters[data.regions?.[key]];
      return charter?.through > state.turn && charter.arrears < 2;
    }).length, moves, cargos, flags }].slice(-frameLimit);
}

export function frame15(world, state, turn) {
  const row = state.century?.frames.find((item) => item.turn === turn);
  if (!row) return null;
  const factions = Object.keys(state.factions);
  const key = (symbol) => world.cities[archiveSymbols.indexOf(symbol)].key;
  const unpack = ([flag, city, to, ...route]) => ({ city: key(city), to: key(to), route: route.map(key), status: flag === "!" ? "blocked" : "march" });
  return { turn, ownership: Object.fromEntries(world.cities.map(({ key }, index) => [key, factions[archiveSymbols.indexOf(row.map[index])]])),
    front: row.moves.map(unpack), freights: row.cargos.map(unpack), distress: [...row.flags].map(key) };
}

export function validCentury(world, state, officers) {
  const data = state.century;
  if (data === undefined) return true;
  const c = (key) => has(state.cities, key);
  const f = (key) => has(state.factions, key);
  const region = (key) => world.cities.some((city) => city.region === key);
  const time = (turn) => bounded(turn, data.since, state.turn);
  const list = (items, cap, check) => Array.isArray(items) && items.length <= cap && items.every(check);
  const map = (items, keyTest, check) => plain(items) && Object.entries(items).every(([key, row]) => keyTest(key) && plain(row) && check(row));
  const count = (n) => bounded(n, 0, Number.MAX_SAFE_INTEGER);
  const citySymbols = (item, min, max) => typeof item === "string" && bounded(item.length, min, max)
    && [...item].every((symbol) => bounded(archiveSymbols.indexOf(symbol), 0, world.cities.length - 1));
  const track = (item) => typeof item === "string" && [".", "!"].includes(item[0]) && citySymbols(item.slice(1), 3, 44);
  const cityCount = Math.max(44, world.cities.length);
  return state.reign && plain(data) && time(data.since) && time(data.chapterSince) && has(reignChapters15, data.chapter)
    && bounded(data.started, 0, cityCount) && bounded(data.peak, data.started, cityCount) && bounded(data.stable, 0, 12)
    && [data.trade, data.generation, data.serial].every(count) && (data.lastMigration === undefined || count(data.lastMigration))
    && (data.plan === null || validDraft(data.plan) && time(data.plan.signed) && bounded(data.plan.review, data.plan.signed + 4, state.turn + 4)
      && typeof data.plan.auto === "boolean")
    && (data.concluded === null || plain(data.concluded) && time(data.concluded.turn) && objectives.includes(data.concluded.kind))
    && (data.restoration === null || plain(data.restoration) && time(data.restoration.turn) && bounded(data.restoration.floor, 0, cityCount)
      && (data.restoration.restored === null || time(data.restoration.restored)))
    && (data.regions === undefined || plain(data.regions) && Object.keys(data.regions).length === world.cities.length
      && world.cities.every(({ key, region: area }) => data.regions[key] === area))
    && map(data.charters, region, (row) => bounded(row.retain, 10, 60) && bounded(row.through, data.since, state.turn + 16)
      && objectives.concat("relief").includes(row.duty) && count(row.served) && count(row.arrears))
    && map(data.works, c, (row) => bounded(row.used, 1, 100) && time(row.turn))
    && map(data.transitions, c, (row) => time(row.turn) && f(row.from) && f(row.to) && row.from !== row.to
      && bounded(row.progress, 0, 3) && count(row.garrison) && count(row.stores))
    && map(data.rulers, f, (row) => objectives.includes(row.kind) && (row.target === null || f(row.target))
      && bounded(row.until, data.since, state.turn + 4))
    && list(data.epochs, 24, (row) => plain(row) && chapterOutcomes.includes(row.kind) && time(row.turn) && bounded(row.generation, 0, data.generation))
    && list(data.battles, 58, (battle) => plain(battle) && bounded(battle.id, 1, state.frontline.sequence - 1)
      && bounded(battle.turn, data.since, state.turn - 1) && validFrontlineBattle(state, officers, battle))
    && list(data.cases, 48, (row) => plain(row) && bounded(row.id, 1, data.serial) && time(row.turn) && c(row.city)
      && ["resources", "integrated", "migration", "charter", "trade"].includes(row.kind) && typeof row.key === "string" && row.key.length <= 120
      && typeof row.text === "string" && row.text.length <= 220 && typeof row.urgent === "boolean" && typeof row.done === "boolean")
    && list(data.frames, frameLimit, (row) => plain(row) && time(row.turn) && typeof row.map === "string" && row.map.length === world.cities.length
      && [...row.map].every((symbol) => bounded(archiveSymbols.indexOf(symbol), 0, Object.keys(state.factions).length - 1))
      && has(reignChapters15, row.chapter) && bounded(row.cities, 0, cityCount)
      && ["cash", "grain", "stable", "population", "migrated", "agreements", "authority"].every((field) => count(row[field]))
      && list(row.moves, 9, track) && list(row.cargos, 6, track) && citySymbols(row.flags, 0, cityCount));
}
