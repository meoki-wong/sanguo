import { armyByOfficer, redirectArmy, withdrawalRoute } from "./armies.js";
import { cityName, eraByYear, factionName, firstCity, gameOutcome } from "./engine.js";
import { dynastyPolicy, orderJurisdiction, saveDynastyPolicy } from "./dynasty.js";
import { formationOf, maneuverChoices } from "./frontline.js";
import { authorizeCampaign, strategicTargets, staffChoices } from "./high-command.js";
import { isHostile } from "./diplomacy.js";
import { dynastyTreaty, offerDynastyFor } from "./dynasty-treaties.js";
import { openRoadEdge } from "./grand-logistics.js";
import { edgeKey, edgeWeather } from "./landscape-terrain.js";
import { bounded, livingSide, plain } from "./polities-data.js";
import { strategicPost, postOwner } from "./sandtable-posts.js";
import { markRealmService } from "./realm.js";

export const strategicAims = { corridor: "控制通道", stability: "安定疆域", concord: "稳固盟约" };
export const theaterRoles9 = { offensive: "主攻", diversion: "牵制", escort: "护运", defense: "驻防" };
export const stateMeasures9 = { ease: "减免征发", bargain: "协商事权", repair: "增拨战后恢复" };
export const counterLabels9 = { screen: "前线增援", raid: "侧翼牵制", treaty: "结盟制衡" };
const liveCampaign = (campaign) => campaign && campaign.stage !== "ended";
const activeFront = (row) => row.status === "active";
const at = (world, city) => world.cities.find(({ key }) => key === city);
const names = (world, key) => strategicPost(key)?.name ?? cityName(world, key);
const byId = (state, id) => state.highCommand.campaigns.find((row) => row.id === id);
const fieldPlan = (state, row) => state.frontline.plans.find(({ id }) => id === byId(state, row?.campaign)?.plan);
const owns = (state, side, key) => state.cities[key]?.owner === side;
const clamp = (value) => Math.max(0, Math.min(100, value));

export function enableStrategy9(state) {
  if (state.strategy9) return state;
  if (!state.dynasty) throw new Error("需要先启用天下秩序再升级。");
  return { ...state, strategy9: { since: state.turn, serial: 1, plans: {}, fronts: [], movements: [], responses: {}, support: {},
    measures: [], alerts: [], reports: [], service: {}, records: [] } };
}

export function objectives9(world, state, side = state.player) {
  const enemy = (key) => isHostile(state, side, state.cities[key].owner);
  return {
    corridor: [...strategicTargets(world, state, "corridor", side), ...world.cities.filter(({ key, links }) => enemy(key) && links.some((link) => owns(state, side, link)))],
    stability: world.cities.filter(({ key }) => owns(state, side, key)),
    concord: Object.keys(state.factions).filter((key) => key !== side && livingSide(state, key))
      .map((key) => ({ key, name: factionName(eraByYear(world, state), key) })),
  };
}

function validPolicy(row) {
  return plain(row) && bounded(row.money, 5, 999) && bounded(row.grain, 5, 999) && bounded(row.manpower, 0, 2400)
    && bounded(row.transport, 1, 8) && typeof row.negotiate === "boolean"
    && plain(row.primary) && plain(row.secondary) && row.primary.kind !== row.secondary.kind
    && [row.primary, row.secondary].every(({ kind, key }) => Object.hasOwn(strategicAims, kind) && typeof key === "string");
}

export function publishStrategy9(world, state, draft) {
  if (!state.strategy9 || gameOutcome(state) !== "ongoing" || !validPolicy(draft)) throw new Error("请选择不同的主次目标和有效的全国军政额度。");
  const side = state.player;
  const next = structuredClone(state);
  const options = objectives9(world, state);
  const before = state.strategy9.plans[side];
  for (const [label, objective] of [["primary", draft.primary], ["secondary", draft.secondary]]) {
    if (!options[objective.kind].some(({ key }) => key === objective.key)
      && !(before?.[label].key === objective.key && before[label].kind === objective.kind)) throw new Error("本方目前无法执行这个战略目标。");
  }
  const started = before && before.until > state.turn ? before.started : state.turn;
  const { money, grain, manpower, transport, negotiate, primary, secondary } = draft;
  next.strategy9.plans[side] = { money, grain, manpower, transport, negotiate, primary: { ...primary }, secondary: { ...secondary },
    started, until: started + 12, revised: state.turn, review: state.turn + (4 - state.turn % 4) };
  return next;
}

export function strategicFronts9(state, side = state.player) {
  return state.strategy9?.fronts.filter((row) => row.side === side && liveCampaign(byId(state, row.campaign))) ?? [];
}

export function theaterOptions9(world, state, role) {
  const goal = role === "offensive" ? "advance" : role === "diversion" ? "corridor" : "defense";
  return strategicTargets(world, state, goal).map((row) => ({ ...row, goal }));
}

function stagingPost(world, state, point, officer) {
  const unit = armyByOfficer(state, officer);
  const city = unit?.location ?? state.stations[officer];
  if (!unit) return city;
  return [point, ...at(world, point).links, city].find((key) => owns(state, state.player, key)
    && withdrawalRoute(world, state, unit, key));
}

export function charterFront9(world, state, draft) {
  const { role, target, commander, priority, retire, term } = draft;
  if (!state.strategy9?.plans[state.player] || gameOutcome(state) !== "ongoing"
    || !Object.hasOwn(theaterRoles9, role) || !bounded(priority, 1, 5) || !bounded(retire, 200, 2400) || !bounded(term, 2, 12)) {
    throw new Error("请先颁布全国方略，再指定统帅、战区、优先级和撤兵线。");
  }
  const objective = theaterOptions9(world, state, role).find(({ key }) => target === key);
  const existing = state.highCommand.campaigns.find((row) => row.side === state.player && row.target === target && liveCampaign(row));
  if (!objective && !existing) throw new Error("目前无法向该目标设立战区。");
  if (existing && (existing.commander !== commander || strategicFronts9(state).some(({ campaign }) => campaign === existing.id))) {
    throw new Error("目标已有统帅或战区，改派请在已有战区处理。");
  }
  const plan = state.strategy9.plans[state.player];
  const seat = stagingPost(world, state, existing?.point ?? (strategicPost(target)?.seat ?? target), commander);
  if (!seat) throw new Error("该统帅缺少可用集结地。");
  const next = existing ? structuredClone(state) : authorizeCampaign(world, state, {
    goal: objective.goal, target, commander, mode: "delegate", money: Math.min(9999, plan.money * term),
    grain: Math.min(9999, plan.grain * term), withdraw: retire, seasons: term, terms: "ceasefire", reinforce: true, rebase: true,
  });
  const records = next.strategy9;
  records.fronts = records.fronts.filter((row) => liveCampaign(byId(next, row.campaign)));
  const campaign = next.highCommand.campaigns.find((row) => row.target === target && row.side === next.player && liveCampaign(row));
  if (role === "escort") {
    const unit = fieldPlan(next, { campaign: campaign.id })?.units.find(({ role }) => role === "advance");
    if (unit) unit.role = "escort";
  }
  records.fronts.push({ id: records.serial++, side: next.player, campaign: campaign.id, role, priority, seat, status: "active" });
  return next;
}

export function amendFront9(world, state, id, draft) {
  const old = strategicFronts9(state).find((row) => row.id === id);
  if (!old || gameOutcome(state) !== "ongoing" || !bounded(draft.priority, 1, 5)
    || !["active", "paused"].includes(draft.status)) throw new Error("请选择仍在授权期内的战区。");
  const campaign = byId(state, old.campaign);
  const commander = draft.commander ?? campaign.commander;
  let next = structuredClone(state);
  if (commander !== campaign.commander) {
    if (state.strategy9.movements.some(({ officer, status }) => officer === commander && status === "travel")) {
      throw new Error("该军团正在改隶，请等它抵达后再任命。");
    }
    const previous = fieldPlan(next, old)?.units.map((unit) => ({ ...unit })) ?? [];
    next = authorizeCampaign(world, next, { ...campaign, id: campaign.id, commander });
    const plan = fieldPlan(next, old);
    const takeover = formationOf(next, commander);
    if (takeover) for (const other of next.frontline.plans) {
      if (other.id !== plan.id) other.units = other.units.filter(({ id }) => id !== takeover.id);
    }
    for (const unit of previous) if (!plan.units.some(({ id }) => id === unit.id) && plan.units.length < 4) {
      plan.units.push({ id: unit.id, role: unit.role === "advance" ? "reserve" : unit.role });
    }
    const incoming = armyByOfficer(next, commander);
    if (incoming && old.role === "escort" && plan.units[0]) plan.units[0].role = "escort";
    emit(next, null, state.player, "handover", old.seat, "新任统帅接管原战役编制、钱粮额度及未完调令。");
  }
  Object.assign(next.strategy9.fronts.find((row) => row.id === id), { priority: draft.priority, status: draft.status });
  return next;
}

export function eligibleReserve9(state, frontId) {
  const destination = strategicFronts9(state).find(({ id }) => id === frontId);
  const plan = destination && fieldPlan(state, destination);
  const commanders = new Set(state.highCommand.campaigns.filter(liveCampaign).map(({ commander }) => commander));
  if (!plan || plan.units.length >= 4) return [];
  return (state.armies ?? []).filter((unit) => {
    const row = formationOf(state, unit.officer);
    return unit.faction === state.player && unit.prepared && unit.troops >= 450 && row && !unit.engagement && !commanders.has(unit.officer)
      && !plan.units.some(({ id }) => id === row.id)
      && !state.frontline.requests.some(({ status, unit }) => status === "accepted" && row.id === unit)
      && !state.strategy9.movements.some(({ officer, status }) => unit.officer === officer && status === "travel");
  });
}

export function sendReserve9(world, state, draft) {
  const front = strategicFronts9(state).find(({ id }) => id === draft.front);
  const army = front && eligibleReserve9(state, front.id).find(({ officer }) => officer === draft.officer);
  const route = army && withdrawalRoute(world, state, army, front.seat);
  if (!route || gameOutcome(state) !== "ongoing" || !["reserve", "escort"].includes(draft.role)) {
    throw new Error("需要可调动的预备军和通往战区集结地的己方道路。");
  }
  const next = structuredClone(state);
  const unit = formationOf(state, army.officer);
  const origin = strategicFronts9(state).find((row) => fieldPlan(state, row)?.units.some(({ id }) => id === unit.id));
  for (const plan of next.frontline.plans) plan.units = plan.units.filter(({ id }) => id !== unit.id);
  next.strategy9.movements = next.strategy9.movements.filter((row) => row.status === "travel" || row.officer !== army.officer)
    .filter((row, index, all) => row.status === "travel" || index >= all.length - 16);
  next.strategy9.movements.push({ id: next.strategy9.serial++, side: state.player, officer: army.officer, front: front.id, from: origin?.id ?? null,
    to: front.seat, started: state.turn, role: draft.role, status: "travel", eta: Math.max(0, route.length - 1) });
  emit(next, null, state.player, "reserve", army.location, "预备军调令已发，" + (origin ? "原战区已失去这支预备军。预计 " : "预计 ")
    + Math.max(0, route.length - 1) + " 季抵达新战区。");
  return next;
}

export function frontAllocations9(state, side = state.player) {
  const plan = state.strategy9?.plans[side];
  if (!plan) return [];
  const rows = strategicFronts9(state, side);
  const funds = state.factions[side];
  const reserve = dynastyPolicy(state, side);
  const spending = state.strategy9.support[side]?.court <= 38 ? Math.floor(plan.money * .75) : plan.money;
  const limits = { money: Math.min(spending, Math.max(0, funds.treasury - Math.max(reserve.moneyFloor, state.delegationReserve?.treasury ?? 0))),
    grain: Math.min(plan.grain, Math.max(0, funds.grain - Math.max(reserve.grainFloor, state.delegationReserve?.grain ?? 0))),
    manpower: plan.manpower };
  const weighting = (row) => row.priority + Number(row.role === "offensive");
  const total = rows.filter(activeFront).reduce((sum, row) => sum + weighting(row), 0);
  const results = rows.map((row) => ({ ...row, money: 0, grain: 0, manpower: 0 }));
  if (plan.until <= state.turn) return results.map((row) => ({ ...row, status: "paused" }));
  for (const [key, amount] of Object.entries(limits)) {
    const populated = results.filter(activeFront).sort((a, b) => weighting(b) - weighting(a) || a.id - b.id);
    let assigned = 0;
    for (const row of populated) {
      row[key] = Math.floor(amount * weighting(row) / total);
      assigned += row[key];
    }
    for (const row of populated.slice(0, amount - assigned)) row[key]++;
  }
  return results;
}

export function strategicAlerts9(state) {
  return state.strategy9?.alerts.filter((row) => !row.read && row.turn >= state.turn - 5) ?? [];
}

export function acknowledgeStrategy9(state, id) {
  const next = structuredClone(state);
  const row = next.strategy9?.alerts.find((note) => note.id === id);
  if (!row) throw new Error("这件急报已归档。");
  row.read = true;
  return next;
}

function emit(state, entries, side, kind, city, text, urgent = false, front = null) {
  const data = state.strategy9;
  const turn = state.turn + Number(Boolean(entries));
  const row = { side, kind, city, text, turn, front };
  if (data.reports.some((note) => note.turn === turn && note.city === city && note.kind === kind && note.text === text)) return;
  data.reports.push(row);
  data.reports = data.reports.slice(-48);
  if (urgent && side === state.player && !data.alerts.some((note) => note.city === city && note.kind === kind && !note.read && turn - note.turn < 3)) {
    data.alerts.push({ ...row, id: data.serial++, read: false });
    data.alerts = data.alerts.slice(-20);
  }
  entries?.push({ type: "strategy-nine", faction: side, event: kind, city, text });
}

export function strategicProgress9(world, state, objective, side = state.player) {
  if (!objective) return { value: 0, target: 1, label: "" };
  const { key, kind } = objective;
  let value;
  let target = 1;
  if (kind === "corridor") value = Number(strategicPost(key) ? postOwner(state, strategicPost(key)) === side : owns(state, side, key));
  if (kind === "stability") {
    const region = at(world, key)?.region;
    const holdings = world.cities.filter((city) => city.region === region && owns(state, side, city.key));
    target = Math.max(1, Math.ceil(holdings.length * .8));
    value = owns(state, side, key) ? holdings.filter((city) => !state.cities[city.key].occupation && state.realm.cities[city.key].welfare >= 57).length : 0;
  }
  if (kind === "concord") {
    target = 3;
    const pact = dynastyTreaty(state, side, key);
    value = pact && !pact.missed ? Math.min(3, state.turn - pact.signed + 1)
      : Math.min(3, state.strategy9?.records.slice(-3).filter((row) => row.allies.includes(key)).length ?? 0);
  }
  return { value, target, label: strategicAims[kind] + " · " + (kind === "concord"
    ? factionName(eraByYear(world, state), key) : kind === "stability" ? at(world, key).region : names(world, key)) };
}

export function strategicCoalition9(world, state, side) {
  if (!state.strategy9 || !livingSide(state, side)) return [];
  const player = state.player;
  if (side === player || !isHostile(state, side, player)) return [];
  const started = strategicFronts9(state).some((row) => {
    const action = byId(state, row.campaign);
    const post = strategicPost(action.target);
    return activeFront(row) && (state.cities[action.point]?.owner === side || post && postOwner(state, post) === side);
  });
  if (!started) return [];
  const adjacency = new Set(world.cities.filter(({ key }) => owns(state, side, key)).flatMap(({ links }) => links.map((city) => state.cities[city].owner)));
  const friends = [...adjacency].filter((key) => key !== side && key !== player && isHostile(state, key, player)
    && livingSide(state, key) && !dynastyTreaty(state, side, key) && !state.dynasty.treaties.some((row) => row.status === "offered"
      && [row.from, row.to].includes(side) && [row.from, row.to].includes(key)));
  return friends.sort((a, b) => Number(isHostile(state, side, a)) - Number(isHostile(state, side, b))
    || state.factions[b].grain - state.factions[a].grain);
}

export function warResponseChoices9(world, state, side) {
  if (!state.strategy9 || state.strategy9.responses[side]?.until > state.turn || side === state.player) return [];
  const fronts = strategicFronts9(state).filter((row) => activeFront(row) && ["offensive", "diversion"].includes(row.role));
  if (!fronts.length || !isHostile(state, side, state.player)) return [];
  const threats = fronts.filter((row) => {
    const action = byId(state, row.campaign);
    const post = strategicPost(action.target);
    return owns(state, side, action.point) || post && postOwner(state, post) === side;
  });
  const option = maneuverChoices(world, state, side).filter(({ type, target }) => type === "march" && owns(state, state.player, target))
    .sort((a, b) => state.cities[a.target].troops - state.cities[b.target].troops)[0];
  const ports = strategicCoalition9(world, state, side);
  const choices = [];
  if (threats.length) {
    const operation = byId(state, threats[0].campaign);
    const post = strategicPost(operation.target);
    const target = [operation.point, post?.seat, post?.to].find((key) => owns(state, side, key));
    if (target) choices.push({ id: "S9-screen", kind: "screen", target, text: "增援承压据点" + names(world, target) });
  }
  if (option) {
    choices.push({ id: "S9-raid", kind: "raid", target: option.target, officer: option.officer, text: "以野战军团牵制" + cityName(world, option.target) });
  }
  if (ports.length && state.turn >= state.strategy9.since + 1) choices.push({
    id: "S9-treaty", kind: "treaty", target: ports[0], text: "与" + factionName(eraByYear(world, state), ports[0]) + "议定共守和通行",
  });
  return choices;
}

function reactToPlayer(world, state, proposals, entries, controlled) {
  const era = eraByYear(world, state);
  for (const { key: side } of era.factions) {
    const choices = warResponseChoices9(world, state, side);
    if (!choices.length || state.factions[side].grain < 30 || state.factions[side].treasury < 32) continue;
    const preference = state.strategy9.responses[side]?.kind === "treaty" ? ["raid", "screen", "treaty"] : ["treaty", "raid", "screen"];
    const choice = choices.find(({ id }) => id === proposals[side]?.warResponse9)
      ?? preference.map((kind) => choices.find((option) => option.kind === kind)).find(Boolean);
    const { target, kind } = choice;
    let city = target;
    if (kind === "treaty") {
      city = firstCity(world, state, side);
      if (!offerDynastyFor(world, state, side, { to: target, seasons: 6, payment: 6, passage: true, defense: true, cede: null, post: null })) continue;
    } else if (kind === "raid") {
      const army = armyByOfficer(state, choice.officer);
      if (!army || army.engagement || controlled.has(army.officer)) continue;
      try {
        redirectArmy(world, state, army, { type: "march", target, depot: army.depot });
      } catch { continue; }
      controlled.add(army.officer);
    } else {
      const holding = state.cities[target];
      const donor = at(world, target).links.map((key) => ({ key, holding: state.cities[key] }))
        .find(({ key, holding }) => holding.owner === side && holding.troops > 950 && openRoadEdge(state, side, key, target));
      if (!donor) continue;
      const troops = Math.min(360, donor.holding.troops - 800);
      donor.holding.troops -= troops;
      holding.troops += troops;
      state.factions[side].grain -= 7;
      state.factions[side].treasury -= 5;
    }
    state.strategy9.responses[side] = { kind, target, until: state.turn + 3 };
    const detail = kind === "treaty" ? "拟与" + factionName(era, target) + "建立共同守备和通行。"
      : "向" + cityName(world, city) + "实施" + counterLabels9[kind] + "。";
    emit(state, entries, state.player, "counter", city, factionName(era, side) + detail, true);
  }
}

function moveReserves(world, state, entries, controlled) {
  for (const row of state.strategy9.movements.filter((item) => item.status === "travel")) {
    const unit = armyByOfficer(state, row.officer);
    const front = strategicFronts9(state, row.side).find(({ id }) => id === row.front);
    const plan = front && fieldPlan(state, front);
    if (!unit || unit.faction !== row.side || !plan) { row.status = "cancelled"; continue; }
    if (receiveReserve(world, state, entries, row, unit, plan, front)) continue;
    const route = withdrawalRoute(world, state, unit, row.to);
    if (!route || route.length < 2) {
      emit(state, entries, row.side, "transport", unit.location, "预备军调动受阻，等待通路或新集结令。", true, front.id);
      if (!unit.engagement) redirectArmy(world, state, unit, { type: "hold" });
      continue;
    }
    if (unit.engagement) continue;
    const portion = route.slice(0, 5);
    redirectArmy(world, state, unit, { type: "hold" });
    Object.assign(unit, { target: portion.at(-1), phase: "march", route: portion });
    controlled.add(unit.officer);
    row.eta = route.length - 1;
  }
}

function receiveReserve(world, state, entries, row, unit, plan, front) {
  if (unit.location !== row.to || !owns(state, row.side, row.to) || plan.units.length >= 4) return false;
  const formation = formationOf(state, row.officer);
  if (!formation) return false;
  if (!plan.units.some(({ id }) => id === formation.id)) plan.units.push({ id: formation.id, role: row.role });
  row.status = "arrived";
  row.eta = 0;
  emit(state, entries, row.side, "arrival", row.to, "预备军抵达" + cityName(world, row.to) + "，编入新战区。", false, front.id);
  return true;
}

export function prepareStrategy9(world, state, proposals, entries, { playerOnly = false } = {}) {
  if (!state.strategy9) return null;
  const controlled = new Set();
  moveReserves(world, state, entries, controlled);
  if (!playerOnly) reactToPlayer(world, state, proposals, entries, controlled);
  const allocations = frontAllocations9(state);
  return { controlled, allocations, blocked: new Set() };
}

export function schedulePassage9(world, state, work, entries) {
  if (!work) return;
  const plan = state.strategy9.plans[state.player];
  if (!plan) return;
  const memberships = new Map();
  for (const front of work.allocations) for (const { id } of fieldPlan(state, front)?.units ?? []) {
    const row = state.frontline.formations.find((item) => item.id === id);
    if (row) memberships.set(row.officer, front);
  }
  for (const row of state.strategy9.movements.filter((item) => item.status === "travel")) {
    memberships.set(row.officer, work.allocations.find(({ id }) => id === row.front));
  }
  const armies = (state.armies ?? []).filter((unit) => unit.faction === state.player && memberships.has(unit.officer)
    && unit.phase === "march" && unit.route[1] && !unit.engagement)
    .sort((a, b) => (memberships.get(b.officer)?.priority ?? 0) - (memberships.get(a.officer)?.priority ?? 0));
  const lanes = new Map();
  let transport = plan.transport;
  const allocate = (from, to) => {
    const key = edgeKey(from, to);
    const post = strategicPost(key);
    const terrain = edgeWeather(state, from, to);
    const room = ["pass", "ferry", "port"].includes(post?.kind) || terrain.terrain === "river" ? 1 : 2;
    if (transport <= 0 || (lanes.get(key) ?? 0) >= room) return false;
    transport--;
    lanes.set(key, (lanes.get(key) ?? 0) + 1);
    return true;
  };
  for (const unit of armies) {
    const to = unit.route[1];
    if (allocate(unit.location, to)) continue;
    work.blocked.add(unit.officer);
    const front = memberships.get(unit.officer);
    emit(state, entries, unit.faction, "transport", unit.location,
      cityName(world, unit.location) + "至" + cityName(world, to) + "本季运力已用完，次序靠后的军团等候一季。", true, front?.id ?? null);
  }
  const waiting = [];
  for (const freight of state.dynasty.convoys.filter((convoy) => convoy.side === state.player && convoy.started < state.turn
    && ["march", "blocked"].includes(convoy.status))) {
    const from = freight.route[freight.cursor];
    const to = freight.route[freight.cursor + 1];
    if (!allocate(from, to)) waiting.push(freight.id);
  }
  if (waiting.length) {
    state.strategy9.freightWait = { turn: state.turn, ids: waiting };
    const freight = state.dynasty.convoys.find(({ id }) => id === waiting[0]);
    emit(state, entries, state.player, "freight", freight.to, "前线用完本季运力，" + waiting.length + " 支地方粮队延后一季。", true);
  } else delete state.strategy9.freightWait;
}

export function petitionMeasure9(world, state, action, region) {
  if (!state.strategy9 || gameOutcome(state) !== "ongoing" || !Object.hasOwn(stateMeasures9, action)
    || !world.cities.some((city) => city.region === region && owns(state, state.player, city.key))) throw new Error("请选择本方州郡。");
  let next = structuredClone(state);
  if (action === "bargain") next = orderJurisdiction(world, next, region, "charter");
  if (action === "repair") next = saveDynastyPolicy(next, { ...dynastyPolicy(state), priority: "relief" });
  if (action === "ease") next.strategy9.measures = next.strategy9.measures.filter((row) => row.region !== region);
  if (action === "ease") next.strategy9.measures.push({ region, until: state.turn + 3, cities: world.cities.filter((city) => city.region === region).map(({ key }) => key) });
  return next;
}

export function levyRate9(state, city) {
  const found = state.strategy9?.measures.some((row) => row.until > state.turn && row.cities.includes(city)
    && owns(state, state.player, city));
  return found ? .8 : 1;
}

export function settleStrategy9(world, previous, state, entries) {
  if (!state.strategy9) return;
  const side = state.player;
  const data = state.strategy9;
  const plan = data.plans[side];
  if (!plan) return;
  const turn = state.turn + 1;
  for (const transfer of data.movements.filter(({ status }) => status === "travel")) {
    const unit = armyByOfficer(state, transfer.officer);
    const front = strategicFronts9(state, transfer.side).find(({ id }) => id === transfer.front);
    const field = front && fieldPlan(state, front);
    if (!unit || unit.faction !== transfer.side || !field) {
      transfer.status = "cancelled";
    } else if (!receiveReserve(world, state, entries, transfer, unit, field, front)) {
      transfer.eta = Math.max(1, (withdrawalRoute(world, state, unit, transfer.to)?.length ?? transfer.eta + 1) - 1);
    }
  }
  const totals = { losses: 0, money: 0, grain: 0 };
  const operations = [];
  for (const front of strategicFronts9(state)) {
    const campaign = byId(state, front.campaign);
    const old = byId(previous, front.campaign);
    const unit = armyByOfficer(state, campaign.commander);
    const preceding = armyByOfficer(previous, campaign.commander);
    const losses = state.frontline.battles.filter(({ turn }) => turn === state.turn)
      .reduce((sum, battle) => sum + battle.sides.filter(({ officer }) => officer === campaign.commander).reduce((total, item) => total + item.loss, 0), 0);
    const money = Math.max(0, campaign.spentMoney - (old?.spentMoney ?? 0));
    const grain = Math.max(0, campaign.spentGrain - (old?.spentGrain ?? 0));
    totals.losses += losses;
    totals.money += money;
    totals.grain += grain;
    const item = data.service[campaign.commander] ??= { terms: 0, advances: 0, losses: 0, held: 0 };
    item.terms++;
    if (unit && preceding && unit.location !== preceding.location) item.advances++;
    item.losses += losses;
    item.held += Number(campaign.stage === "secure");
    const state9 = campaign.alert?.kind;
    if (state9) emit(state, entries, side, state9, campaign.point, names(world, campaign.target) + " · " + campaign.alert.text, true, front.id);
    // Bounded ceasefire authority only activates once the objective is secure.
    if (plan.negotiate && campaign.war && campaign.stage === "settlement" && !campaign.negotiating) {
      const war = state.sandtable.wars.find(({ id }) => id === campaign.war);
      if (war?.status === "fighting" && !war.offer) {
        war.offer = { by: side, kind: "ceasefire", payment: 0, turn: state.turn, answer: null };
        campaign.negotiating = true;
        emit(state, entries, side, "terms", campaign.point, "主帅按授权递交无割地、无赔款的停战照会。", false, front.id);
      }
    }
    operations.push({ id: front.id, city: unit?.location ?? front.seat, point: campaign.point, stage: campaign.stage, money, grain, losses });
  }
  const stock = state.factions[side];
  const domestic = data.support[side] ??= { court: 70, officers: 70, districts: 70 };
  const easing = data.measures.filter(({ until }) => until >= turn).length;
  for (const city of world.cities.filter(({ key, region }) => owns(state, side, key) && data.measures.some((row) => row.region === region && row.until >= turn))) {
    state.realm.cities[city.key].welfare = clamp(state.realm.cities[city.key].welfare + 2);
  }
  const expensive = totals.money >= Math.max(8, plan.money * .7);
  domestic.court = clamp(domestic.court + (expensive ? -4 : 2));
  domestic.officers = clamp(domestic.officers + (totals.losses >= 500 ? -8 : 2));
  domestic.districts = clamp(domestic.districts + (easing ? 5 : totals.grain >= 24 ? -4 : 1));
  if (domestic.court <= 38) emit(state, entries, side, "appropriation", firstCity(world, state), "群臣要求核减军费，下季可用战费额度减少四分之一。", true);
  if (data.measures.some(({ until }) => until >= turn)
    && world.cities.some(({ key }) => owns(state, side, key) && state.realm.cities[key].welfare >= previous.realm.cities[key].welfare + 2)) {
    markRealmService(state, "civil", "州郡减赋见效");
  }
  if (state.dynasty.treaties.some((pact) => [pact.from, pact.to].includes(side) && pact.status === "active"
    && pact.paid > (previous.dynasty.treaties.find(({ id }) => id === pact.id)?.paid ?? 0))) {
    markRealmService(state, "envoy", "按季交收和约赔款");
  }
  if (domestic.districts < 52) {
    const local = world.cities.filter(({ key }) => owns(state, side, key) && key !== firstCity(world, state))
      .sort((a, b) => state.realm.cities[a.key].welfare - state.realm.cities[b.key].welfare)[0];
    if (local) {
      state.realm.cities[local.key].welfare = clamp(state.realm.cities[local.key].welfare - 3);
      emit(state, entries, side, "dissent", local.key, local.region + "要求降低征发，地方民生已受压。", true);
    }
  }
  if (domestic.officers < 40) stock.morale = clamp(stock.morale - 2);
  if (turn >= plan.review && turn < plan.until && turn % 4 === 0) {
    emit(state, entries, side, "review", firstCity(world, state), "本年度方略已结算，请审定续任和下年军政额度。", true);
  }
  if (turn === plan.until) emit(state, entries, side, "term", firstCity(world, state), "三年方略届期，请核对目标完成情况。", true);
  data.measures = data.measures.filter(({ until }) => until >= turn);
  data.records.push({ turn, ...totals, operations, allies: state.treaties.filter(({ sides, kind, expires }) =>
    sides.includes(side) && kind === "alliance" && expires > turn).map(({ sides }) => sides.find((key) => key !== side)) });
  data.records = data.records.slice(-12);
}

export function validStrategy9(world, state, officers) {
  const data = state.strategy9;
  if (data === undefined) return true;
  if (!state.dynasty || !plain(data) || !bounded(data.since, 0, state.turn) || !bounded(data.serial, 1, 100000000)) return false;
  const city = (key) => Object.hasOwn(state.cities, key);
  const side = (key) => Object.hasOwn(state.factions, key);
  const date = (turn) => bounded(turn, data.since, state.turn);
  const id = (value) => bounded(value, 1, data.serial - 1);
  const note = (row) => plain(row) && side(row.side) && city(row.city) && date(row.turn) && typeof row.kind === "string"
    && typeof row.text === "string" && row.text.length <= 200 && (row.front === null || id(row.front));
  const count = (value) => bounded(value, 0, 100000000);
  const list = (value, max, test) => Array.isArray(value) && value.length <= max && value.every((row) => plain(row) && test(row));
  const dictionary = (value, key, check) => plain(value) && Object.entries(value).every(([name, row]) => key(name) && plain(row) && check(row));
  const objective = ({ kind, key }) => kind === "concord" ? side(key) : city(key) || kind === "corridor" && Boolean(strategicPost(key));
  return dictionary(data.plans, side, (row) => validPolicy(row) && date(row.started) && date(row.revised) && row.until === row.started + 12
      && bounded(row.review, row.started + 1, state.turn + 4) && [row.primary, row.secondary].every(objective))
    && list(data.fronts, 3, (row) => id(row.id) && side(row.side) && city(row.seat) && Object.hasOwn(theaterRoles9, row.role)
      && bounded(row.campaign, 1, state.highCommand.nextId - 1) && bounded(row.priority, 1, 5) && ["active", "paused"].includes(row.status))
    && new Set(data.fronts.map(({ campaign }) => campaign)).size === data.fronts.length
    && list(data.movements, 24, (row) => id(row.id) && id(row.front) && (row.from === null || id(row.from)) && side(row.side) && date(row.started)
      && officers.has(row.officer) && city(row.to) && bounded(row.eta, 0, 42) && ["travel", "arrived", "cancelled"].includes(row.status)
      && ["reserve", "escort"].includes(row.role))
    && dictionary(data.responses, side, (row) => Object.hasOwn(counterLabels9, row.kind) && bounded(row.until, data.since, state.turn + 3)
      && (row.kind === "treaty" ? side(row.target) : city(row.target)))
    && dictionary(data.support, side, (row) => ["court", "officers", "districts"].every((key) => bounded(row[key], 0, 100)))
    && list(data.measures, 24, (row) => world.cities.some(({ region }) => region === row.region) && bounded(row.until, data.since, state.turn + 3)
      && Array.isArray(row.cities) && row.cities.length <= 42 && row.cities.every((key) => city(key) && at(world, key).region === row.region))
    && list(data.reports, 48, note) && list(data.alerts, 20, (row) => note(row) && id(row.id) && typeof row.read === "boolean")
    && (data.freightWait === undefined || plain(data.freightWait) && date(data.freightWait.turn) && Array.isArray(data.freightWait.ids)
      && data.freightWait.ids.length <= 3 && data.freightWait.ids.every((key) => bounded(key, 1, state.dynasty.serial - 1)))
    && dictionary(data.service, (key) => officers.has(key), (row) => ["terms", "advances", "losses", "held"].every((key) => count(row[key])))
    && list(data.records, 12, (row) => date(row.turn) && ["money", "grain", "losses"].every((key) => count(row[key]))
      && Array.isArray(row.allies) && row.allies.every(side)
      && list(row.operations, 3, (item) => id(item.id) && city(item.city) && city(item.point) && typeof item.stage === "string"
        && ["money", "grain", "losses"].every((key) => count(item[key]))));
}
