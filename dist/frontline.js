import { armyByOfficer, armyCapacity, marchRoute, mobilizationQuote, mobilizeArmy, redirectArmy, releaseLegacyArmyControl, supplyRoute,
  withdrawalRoute } from "./armies.js";
import { availableAttackers, cityName, eraByYear, expeditionGrain, firstCity, gameOutcome, previewOrders } from "./engine.js";
import { isHostile, treatyWith } from "./diplomacy.js";
import { hasPassage, openRoadEdge } from "./grand-logistics.js";
import { convoyRoute } from "./landscape-economy.js";
import { edgeKey, edgeWeather } from "./landscape-terrain.js";
import { strategicPost, postOwner, takePost } from "./sandtable-posts.js";
import { officerSkill } from "./campaign.js";
import { militaryView, refreshIntelligence, visibleArmy } from "./war-intel.js";
import { warBlockaded } from "./war-operations.js";
import { roadPath } from "./roads.js";
import { handoverCities } from "./polity-handover.js";
import { leagueDefenders } from "./reign-leagues.js";

export const battleRoles = { advance: "主攻", reserve: "预备", escort: "护运", retreat: "撤回" };
export const battleMissions = { offensive: "夺取", relief: "解围", defense: "固守" };
export const formationKinds = { infantry: "步军", cavalry: "骑军", navy: "水军" };
const open = (state) => state.frontline && gameOutcome(state) === "ongoing";
const allies = (state, a, b) => a !== b && treatyWith(state, a, b)?.kind === "alliance";
const count = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const recentBattles = 12;

export function enableFrontline(state) {
  if (state.frontline || !state.sandtable) return state;
  const next = structuredClone(state);
  next.frontline = { since: state.turn, sequence: 1, formations: [], plans: [], battles: [], requests: [] };
  reconcileFormations(next, []);
  return next;
}

export function deployOpeningFormations(world, state) {
  const era = eraByYear(world, state);
  const living = new Set(Object.values(state.cities).map(({ owner }) => owner));
  for (const faction of living) {
    if (state.armies?.some((army) => army.faction === faction)) continue;
    const capital = firstCity(world, state, faction);
    const key = [capital, ...world.cities.filter((city) => state.cities[city.key].owner === faction).map((city) => city.key)]
      .find((city) => state.cities[city].troops >= 1250 && availableAttackers(era, state, faction, city).some(({ command }) => command >= 55));
    if (!key) continue;
    const officer = [...availableAttackers(era, state, faction, key)].sort((a, b) => b.command - a.command)[0];
    const stock = state.factions[faction];
    const troops = Math.min(960, state.cities[key].troops - 600);
    const grain = 2 * expeditionGrain(troops);
    if (stock.grain < grain + 20) continue;
    const naval = world.cities.find((city) => city.key === key).links.some((to) => edgeWeather(state, key, to).terrain === "river");
    const equipment = Math.min(state.landscape.equipment[key] ?? 0, 2);
    state.cities[key].troops -= troops;
    stock.grain -= grain;
    if (equipment) state.landscape.equipment[key] -= equipment;
    if (state.cities[key].commander === officer.key) state.cities[key].commander = null;
    state.stations[officer.key] = null;
    state.armies ??= [];
    const army = { faction, officer: officer.key, troops, grain, equipment, travel: naval ? "water" : "land",
      location: key, depot: key, target: key, route: [key], phase: "hold", prepared: true, assembledAt: 0, opening: true };
    state.armies.push(army);
    const row = addFormation(state, army);
    row.kind = naval ? "navy" : ["ma", "gongsun", "yuan", "dong"].includes(faction) ? "cavalry" : "infantry";
    remember(state, row, "开局驻营");
  }
  refreshIntelligence(world, state, state.turn);
}

export function formationOf(state, officer) {
  return state.frontline?.formations.find((row) => row.officer === officer && row.ended === null);
}

function addFormation(state, army) {
  const { frontline: data } = state;
  const inactive = data.formations.findIndex((row) => row.ended !== null);
  if (data.formations.length >= 84 && inactive >= 0) data.formations.splice(inactive, 1);
  const row = { id: data.sequence++, faction: army.faction, officer: army.officer, started: state.turn,
    kind: army.travel === "water" ? "navy" : "infantry", fatigue: 10, experience: 0, losses: 0, establishment: Math.max(1500, army.troops),
    resting: false,
    ended: null, service: [] };
  data.formations.push(row);
  return row;
}

function remember(state, row, event) {
  row.service = [...row.service, { turn: state.turn, event }].slice(-6);
}

export function reconcileFormations(state, before, supplied = null, waitForPromises = false) {
  if (!state.frontline) return;
  for (const row of state.frontline.formations) {
    if (row.ended !== null) continue;
    const army = armyByOfficer(state, row.officer);
    if (!army || army.faction !== row.faction || !army.troops) {
      row.ended = state.turn;
      remember(state, row, "归建或解散");
      continue;
    }
    const previous = before.find(({ officer }) => officer === row.officer);
    if (!previous) continue;
    if (supplied && !supplied.has(row.officer) && previous.location === army.location) {
      row.fatigue = Math.min(100, row.fatigue + 13);
    } else if (previous.location !== army.location) {
      row.fatigue = Math.min(100, row.fatigue + 8);
      remember(state, row, "行军");
    } else if (["hold", "secured"].includes(army.phase) && state.cities[army.location]?.owner === army.faction) {
      row.fatigue = Math.max(0, row.fatigue - 12);
    }
  }
  for (const army of state.armies ?? []) if (!formationOf(state, army.officer)) addFormation(state, army);
  const data = state.frontline;
  for (const plan of data.plans) plan.units = plan.units.filter(({ id }) => data.formations.some((row) => row.id === id && row.ended === null));
  for (const request of data.requests) {
    if (request.status === "pending" || request.status === "accepted") {
      if (!allies(state, request.from, request.to) || state.turn >= request.until) request.status = "expired";
      if (!waitForPromises && request.status === "accepted"
        && !data.formations.some(({ id, ended }) => id === request.unit && ended === null)) request.status = "expired";
    }
  }
}

export function recordFormationLoss(state, officer, loss, reason) {
  const row = formationOf(state, officer);
  if (!row || !loss) return;
  row.losses += loss;
  remember(state, row, reason);
}

export function battleLocation(state, objective) {
  if (Object.hasOwn(state.cities, objective)) return objective;
  return strategicPost(objective)?.to ?? null;
}

export function battleObjectives(world, state, faction = state.player, mission = "offensive") {
  const near = (key) => world.cities.find((city) => city.key === key)?.links.some((city) => state.cities[city].owner === faction);
  const suitable = (key) => mission === "offensive" ? isHostile(state, faction, state.cities[key].owner) && near(key)
    : state.cities[key].owner === faction && (mission === "defense" || warBlockaded(state, key)
      || (state.sandtable.wars ?? []).some((war) => battleLocation(state, war.target) === key));
  const towns = world.cities.filter(({ key }) => suitable(key)).map(({ key, name }) => ({ key, name }));
  const posts = world.cities.flatMap(({ key, links }) => links.filter((other) => key < other).map((other) => strategicPost(edgeKey(key, other))))
    .filter((post) => post && [post.seat, post.to].some((key) => state.cities[key].owner === faction)
      && (mission === "offensive" ? isHostile(state, faction, postOwner(state, post)) : postOwner(state, post) === faction))
    .map(({ key, name }) => ({ key, name }));
  return [...towns, ...posts];
}

export function saveBattlePlan(world, state, draft) {
  if (!open(state)) throw new Error("会战指挥当前不可用。");
  const next = structuredClone(state);
  const data = next.frontline;
  const { player } = next;
  const old = draft.id ? data.plans.find(({ id, faction }) => id === draft.id && faction === player) : null;
  const mandate = old && next.highCommand?.campaigns.find(({ plan, stage }) => plan === old.id && stage !== "ended");
  if (draft.id && !old) throw new Error("该会战已撤销。");
  if (draft.cancel && old) {
    if (mandate) throw new Error("全国军议授权的战役，请从全国军议结案。");
    data.plans = data.plans.filter(({ id }) => id !== old.id);
    for (const request of data.requests) if (request.plan === old.id && ["pending", "accepted"].includes(request.status)) request.status = "expired";
    return next;
  }
  const { objective, mission, mode, units, reserve } = draft;
  if (mandate && (old.objective !== objective || old.mission !== mission)) throw new Error("请从全国军议修改战役目标。");
  if (!Object.hasOwn(battleMissions, mission) || !["direct", "delegate"].includes(mode) || !count(reserve, 0, 9999)
    || !Array.isArray(units) || mode === "direct" && units.length < 1 || units.length > 4
    || new Set(units.map(({ id }) => id)).size !== units.length) throw new Error("请指定行动目标、参战军团和国粮底线。");
  if (old?.objective !== objective && !battleObjectives(world, next, player, mission).some(({ key }) => key === objective)
    || old?.mission !== mission && !battleObjectives(world, next, player, mission).some(({ key }) => key === objective)) {
    throw new Error("该目标当前无法授权。");
  }
  if (!units.every(({ id, role }) => Object.hasOwn(battleRoles, role)
    && data.formations.some((row) => row.id === id && row.faction === player && row.ended === null)
    && !data.plans.some((plan) => plan.id !== old?.id && plan.units.some((row) => row.id === id)))) {
    throw new Error("军团已归建或已编入另一场会战。");
  }
  if (!old && data.plans.filter(({ faction }) => faction === player).length >= 3) throw new Error("同时最多指挥三场会战。");
  const plan = { id: old?.id ?? data.sequence++, faction: player, objective, mission, mode, units, reserve, started: old?.started ?? state.turn };
  if (old?.objective && old.objective !== objective) for (const request of data.requests) {
    if (request.plan === old.id && ["pending", "accepted"].includes(request.status)) request.status = "expired";
  }
  if (old) Object.assign(old, plan);
  else data.plans.push(plan);
  if (mandate) mandate.mode = mode;
  for (const row of data.formations) if (units.some(({ id }) => id === row.id)) {
    row.resting = false;
    releaseLegacyArmyControl(next, row.officer);
  }
  return next;
}

export function serviceFormation(world, state, officer, action, target) {
  if (!open(state)) throw new Error("军团整补当前不可用。");
  const next = structuredClone(state);
  const army = armyByOfficer(next, officer);
  const row = formationOf(next, officer);
  if (!row || army?.faction !== next.player) throw new Error("只能管理本势力的军团。");
  const city = next.cities[army.location];
  if (city.owner !== army.faction || city.occupation || warBlockaded(next, army.location)) throw new Error("须回到稳定且未被围的己方城池。");
  if (action === "rest") {
    redirectArmy(world, next, army, { type: "hold" });
    next.frontline.plans.forEach((plan) => { plan.units = plan.units.filter(({ id }) => id !== row.id); });
    row.resting = true;
    releaseLegacyArmyControl(next, army.officer);
    remember(next, row, "轮换整补");
  } else if (action === "kind") {
    if (!Object.hasOwn(formationKinds, target) || target === row.kind) throw new Error("请选择不同兵种。");
    const shore = world.cities.find(({ key }) => key === army.location).links.some((key) => edgeWeather(next, army.location, key).terrain === "river");
    const armor = next.landscape.equipment[army.location] ?? 0;
    if (armor < 2 || (target === "navy" && !shore) || army.phase !== "hold") throw new Error("改编须在固守状态，消耗当地 2 军械，水军还须临江。");
    next.landscape.equipment[army.location] -= 2;
    row.kind = target;
    army.travel = target === "navy" ? "water" : "land";
    remember(next, row, "改编" + formationKinds[target]);
  } else if (action === "merge") {
    const other = armyByOfficer(next, target);
    const otherRow = formationOf(next, target);
    if (!otherRow || other === army || other.location !== army.location || other.faction !== army.faction
      || army.phase !== "hold" || other.phase !== "hold" || next.frontline.plans.some((plan) => plan.units.some(({ id }) => id === otherRow.id))) {
      throw new Error("须为同城固守的己方军团，被合编军团须先退出会战。");
    }
    army.grain += other.grain;
    const equipment = (army.equipment ?? 0) + (other.equipment ?? 0);
    army.equipment = Math.min(1000, equipment);
    if (equipment > 1000) next.landscape.equipment[army.location] = Math.min(1000, (next.landscape.equipment[army.location] ?? 0) + equipment - 1000);
    row.fatigue = Math.round((row.fatigue * army.troops + otherRow.fatigue * other.troops) / (army.troops + other.troops));
    row.experience = Math.round((row.experience * army.troops + otherRow.experience * other.troops) / (army.troops + other.troops));
    army.troops += other.troops;
    row.establishment = Math.max(army.troops, row.establishment + otherRow.establishment);
    next.stations[other.officer] = army.location;
    next.armies = next.armies.filter((entry) => entry !== other);
    otherRow.ended = next.turn;
    remember(next, row, "接收合编");
    remember(next, otherRow, "并入友军");
  } else if (action === "leader") {
    if (army.phase !== "hold" || army.engagement || !availableAttackers(eraByYear(world, next), next, army.faction, army.location).some(({ key }) => key === target)) {
      throw new Error("换将须在固守状态，并选用同城可领兵的武将。");
    }
    if (city.commander === target) city.commander = null;
    next.stations[officer] = army.location;
    next.stations[target] = null;
    for (const plan of next.theaters ?? []) if (plan.army === officer) plan.army = target;
    for (const plan of next.statecraft.fronts) {
      if (plan.officer === officer) plan.officer = target;
      if (plan.marshal === officer) plan.marshal = target;
    }
    army.officer = target;
    row.officer = target;
    remember(next, row, "主将交接");
  } else throw new Error("该整补指令不可用。");
  reconcileFormations(next, []);
  return next;
}

export function requestReinforcement(state, { plan, faction, role, duration, handover }) {
  if (!open(state) || !["advance", "escort"].includes(role) || !count(duration, 2, 6)
    || !["retain", "handover"].includes(handover)) throw new Error("请选择合法的联军行动和期限。");
  const next = structuredClone(state);
  const data = next.frontline;
  const order = data.plans.find((row) => row.id === plan && row.faction === next.player);
  if (!order || !allies(next, next.player, faction)) throw new Error("请先授权会战，再向现有盟友发出请求。");
  if (data.requests.some((row) => row.plan === plan && row.to === faction && ["pending", "accepted"].includes(row.status))) {
    throw new Error("该盟友已有待办请求或正在履约。");
  }
  if (data.requests.length >= 30) {
    const index = data.requests.findIndex(({ status }) => !["pending", "accepted"].includes(status));
    if (index < 0) throw new Error("联军请求已满。");
    data.requests.splice(index, 1);
  }
  data.requests.push({ id: data.sequence++, plan, from: next.player, to: faction, objective: order.objective, role,
    until: next.turn + duration, status: "pending", unit: null, handover,
    previousOwner: strategicPost(order.objective) ? postOwner(next, strategicPost(order.objective)) : next.cities[order.objective].owner });
  return next;
}

function objectiveCity(state, objective, army) {
  const post = strategicPost(objective);
  if (!post) return battleLocation(state, objective);
  if (army.location === post.seat) return post.to;
  if (army.location === post.to) return post.seat;
  if (state.cities[post.to].owner === army.faction) return post.seat;
  return post.to;
}

export function reinforcementChoices(world, state, faction) {
  if (!state.frontline) return [];
  const invitations = state.frontline.requests.filter((row) => row.to === faction && row.status === "pending" && row.until > state.turn
    && allies(state, row.from, faction)).flatMap((request) => {
    const choices = state.frontline.formations.filter((row) => row.faction === faction && row.ended === null && row.fatigue < 65
      && !state.frontline.requests.some((pending) => pending.unit === row.id && pending.status === "accepted")
      && !state.frontline.plans.some((plan) => plan.units.some(({ id }) => id === row.id))).flatMap((row) => {
      const army = armyByOfficer(state, row.officer);
      if (!army || army.troops < 350 || army.grain < expeditionGrain(army.troops) || state.factions[faction].grain < 32
        || !supplyRoute(world, state, army)) return [];
      const target = objectiveCity(state, request.objective, army);
      if (!target) return [];
      const safe = state.cities[target].owner === request.from || hasPassage(state, faction, target);
      const support = request.role === "escort" || safe ? supportRoute(world, state, army, target, request.from)
        : tryOrder(world, state, army, { type: "march", target, depot: army.depot });
      return support ? [{ id: "B" + request.id + "-" + row.id, request: request.id, unit: row.id,
        officer: row.officer, target, role: request.role, until: request.until, handover: request.handover }] : [];
    });
    return [...choices, { id: "B" + request.id + "-no", request: request.id, unit: null }];
  });
  if (!state.highCommand) return invitations;
  const negotiations = state.frontline.requests.filter((row) => row.to === faction && row.status === "accepted" && row.until > state.turn
    && allies(state, row.from, row.to)).flatMap((request) => {
    const formation = state.frontline.formations.find(({ id, ended }) => id === request.unit && ended === null);
    const army = armyByOfficer(state, formation?.officer);
    if (!army) return [];
    const depleted = formation.fatigue >= 78 || army.troops < 350 || army.grain < expeditionGrain(army.troops);
    const target = objectiveCity(state, request.objective, army);
    const time = target && supportRoute(world, state, army, target, request.from);
    const late = target !== army.location && request.until - state.turn <= 2
      && (!time || time.length - 1 + Number(!army.prepared) > request.until - state.turn - 1);
    if (!depleted && !late) return [];
    const base = { request: request.id, unit: formation.id, officer: army.officer, target, role: request.role,
      until: request.until, handover: request.handover };
    const options = [{ ...base, id: "B" + request.id + "-continue", action: "continue", score: depleted ? 0 : 1 }];
    if (late && !request.revision && !request.revised && !depleted) options.push({ ...base, id: "B" + request.id + "-delay", action: "delay", score: 2 });
    if (depleted && closestHome(world, state, army)) options.push({ ...base, id: "B" + request.id + "-exit", action: "withdraw", score: 3 });
    return options;
  });
  return [...invitations, ...negotiations];
}

export function answerReinforcementRevision(state, id, accepted) {
  if (!open(state) || !state.highCommand || typeof accepted !== "boolean") throw new Error("联军改约当前不可处置。");
  const next = structuredClone(state);
  const row = next.frontline.requests.find((request) => request.id === id && request.from === next.player
    && request.status === "accepted" && request.revision && request.until > next.turn && allies(next, request.from, request.to));
  if (!row) throw new Error("没有有效的待答复改约。");
  if (accepted) row.until = row.revision.until;
  row.revised = true;
  delete row.revision;
  const mandate = next.highCommand.campaigns.find(({ plan, stage }) => plan === row.plan && stage !== "ended");
  if (mandate?.alert?.kind === "revision") mandate.alert = null;
  return next;
}

function tryOrder(world, state, army, draft) {
  try {
    const copy = { ...army };
    redirectArmy(world, state, copy, draft);
    return copy;
  } catch {
    return null;
  }
}

export function operationalPassage(state, army, city) {
  if (hasPassage(state, army.faction, city)) return true;
  const row = formationOf(state, army.officer);
  return Boolean(row && state.frontline.requests.some((request) => (request.status === "accepted" || state.highCommand
    && request.status === "withdrawn" && army.phase === "retreat") && request.unit === row.id
    && request.until > state.turn && state.cities[city]?.owner === request.from && allies(state, request.from, request.to)));
}

function supportRoute(world, state, army, target, partner) {
  if (army.location === target) return [target];
  const graph = new Map(world.cities.map((city) => [city.key, city]));
  const usable = (key) => (hasPassage(state, army.faction, key) || partner && state.cities[key].owner === partner)
    && (!warBlockaded(state, key) || key === target) && (!state.cities[key].occupation || key === target);
  return roadPath(graph, army.location, target, usable, 8,
    (a, b) => openRoadEdge(state, army.faction, a, b, false, army.travel));
}

export function fieldProjection(world, state, army, objective, mission) {
  const post = strategicPost(objective);
  const target = objectiveCity(state, objective, army);
  if (!target) return null;
  if (army.location === target || mission === "defense" && post && [post.seat, post.to].includes(army.location)) return 0;
  const route = mission === "offensive"
    ? marchRoute(world, state, army.faction, army.location, target, army.travel) : supportRoute(world, state, army, target);
  if (route) return route.length - 1 + Number(!army.prepared);
  return post && [post.seat, post.to].includes(army.location) && openRoadEdge(state, army.faction, army.location, target, true, army.travel)
    ? 1 + Number(!army.prepared) : null;
}

function closestHome(world, state, army) {
  return world.cities.map(({ key }) => withdrawalRoute(world, state, army, key)).filter(Boolean)
    .sort((a, b) => a.length - b.length || a.at(-1).localeCompare(b.at(-1)))[0];
}

function report(entries, faction, city, text, participants = [faction]) {
  entries.push({ type: "frontline", faction, city, text, participants });
}

function sustain(world, state, army, row, reserve, entries, command) {
  const city = state.cities[army.location];
  if (city.owner !== army.faction || city.occupation || warBlockaded(state, army.location) || !supplyRoute(world, state, army)) return;
  const stock = state.factions[army.faction];
  const budget = Math.min(Math.max(0, stock.grain - reserve), command?.centralGrain() ?? Infinity);
  const troops = Math.min(240, Math.max(0, row.establishment - army.troops), Math.max(0, city.troops - 750),
    Math.floor(budget / 6) * 100, command?.availableMen?.() ?? Infinity);
  if (!troops) return;
  const cost = Math.ceil(troops / 100) * 6;
  if (command) { command.charge(0, cost); command.enroll?.(troops); }
  else stock.grain -= cost;
  city.troops -= troops;
  army.troops += troops;
  remember(state, row, "补员 " + troops);
  report(entries, army.faction, army.location, cityName(world, army.location) + "调拨 " + troops + " 人补入军团。");
}

function enact(world, state, army, row, plan, role, entries, command) {
  const target = objectiveCity(state, plan.objective, army);
  const reserve = plan.reserve ?? 35;
  const thinned = army.troops < (command?.withdraw ?? 350) || row.fatigue >= 78 || army.grain < expeditionGrain(army.troops);
  if (role === "retreat" || (plan.mode === "delegate" && thinned)) {
    const trail = closestHome(world, state, army);
    if (trail) redirectArmy(world, state, army, { type: "retreat", target: trail.at(-1) });
    else redirectArmy(world, state, army, { type: "hold" });
    return;
  }
  if (role === "reserve" || command?.resting || command?.moneyRoom() === 0 || state.factions[army.faction].grain <= reserve) {
    redirectArmy(world, state, army, { type: "hold" });
    if (!command?.resting) sustain(world, state, army, row, reserve, entries, command);
    return;
  }
  const post = strategicPost(plan.objective);
  if (post && role === "advance" && postOwner(state, post) !== army.faction && army.prepared && army.troops >= 250
    && [post.seat, post.to].includes(army.location) && openRoadEdge(state, army.faction, army.location, target, true, army.travel)) {
    redirectArmy(world, state, army, { type: "hold" });
    Object.assign(army, { phase: "march", route: [army.location, target], target });
    return;
  }
  if (post && postOwner(state, post) === army.faction && (!command || [post.seat, post.to].includes(army.location))) {
    redirectArmy(world, state, army, { type: "hold" });
    return;
  }
  if (target && (plan.mission !== "offensive" || operationalPassage(state, army, target) || role === "escort")) {
    const friendlyPost = post && postOwner(state, post) === army.faction;
    const destination = friendlyPost ? [post.seat, post.to].find((key) => state.cities[key].owner === army.faction)
      : role === "escort" && !operationalPassage(state, army, target) ? army.depot : target;
    if (!destination) return;
    redirectArmy(world, state, army, { type: "hold" });
    const route = supportRoute(world, state, army, destination, plan.from);
    if (command && route && !army.prepared) {
      Object.assign(army, { phase: "muster", route: route.slice(0, 5), target: route[Math.min(route.length - 1, 4)] });
    } else if (route?.length > 1 && army.prepared) {
      // Support movement uses the same movement phase, but never disbands into the destination garrison.
      Object.assign(army, { phase: "march", route: route.slice(0, 5), target: route[Math.min(route.length - 1, 4)] });
    } else sustain(world, state, army, row, reserve, entries, command);
    return;
  }
  const draft = { type: "march", target, depot: army.depot };
  if (target && tryOrder(world, state, army, draft)) redirectArmy(world, state, army, draft);
  else redirectArmy(world, state, army, { type: "hold" });
}

export function musterBattlePlan(world, state, objective, queued = true, command) {
  const planned = queued ? previewOrders(world, state) : state;
  const post = strategicPost(objective);
  const target = battleLocation(planned, objective);
  if (!target || queued && state.orders.length >= 3) return null;
  const targets = post ? [post.seat, post.to] : [target];
  const era = eraByYear(world, planned);
  const options = [];
  for (const { key: from } of world.cities) {
    const city = planned.cities[from];
    if (city.owner !== state.player || city.occupation || city.troops < 650) continue;
    const people = availableAttackers(era, planned, state.player, from).filter(({ key }) => !command?.commander || key === command.commander)
      .sort((a, b) => b.command - a.command);
    if (!people.length) continue;
    for (const to of targets) for (const travel of ["water", "land"]) {
      const defensive = command?.defense;
      if (defensive ? travel !== "land" || planned.cities[to].owner !== planned.player : from === to || !isHostile(planned, planned.player, planned.cities[to].owner)) continue;
      const troops = Math.min(1800, city.troops - (defensive ? 650 : 450), command?.availableMen?.() ?? Infinity);
      const order = { type: defensive ? "garrison-muster" : "mobilize", officer: people[0].key, from, to, travel,
        stance: command && !defensive && !post ? "siege" : "assault", troops };
      try {
        const { route, carried } = mobilizationQuote(world, planned, state.player, order);
        if (command && carried > command.centralGrain()) continue;
        options.push({ order, length: route.length, command: people[0].command });
      } catch { continue; }
    }
  }
  return options.sort((a, b) => a.length - b.length || b.command - a.command)[0]?.order ?? null;
}

export function maneuverChoices(world, state, faction) {
  if (!state.frontline) return [];
  const view = militaryView(state, faction);
  const era = eraByYear(world, state);
  return (view.armies ?? []).filter((army) => army.faction === faction && !army.observed).flatMap((army) => {
    if (!army.prepared || army.phase === "retreat" || army.phase === "secured") return [];
    const row = formationOf(state, army.officer);
    if (state.frontline.plans.some(({ units }) => units.some(({ id }) => id === row?.id))
      || state.frontline.requests.some(({ status, unit }) => status === "accepted" && unit === row?.id)) return [];
    const own = era.officers.find(({ key }) => key === army.officer);
    const hold = { id: "M-" + army.officer + "-hold", officer: army.officer, type: "hold", score: 0, text: own.name + "原地整补" };
    const options = [hold];
    const home = closestHome(world, view, army);
    if (home?.length > 1) options.push({ id: "M-" + army.officer + "-retreat", officer: army.officer, type: "retreat",
      target: home.at(-1), score: army.grain < expeditionGrain(army.troops) ? 2 : -.5, text: own.name + "撤向" + cityName(world, home.at(-1)) });
    if (army.troops >= 500 && army.grain >= expeditionGrain(army.troops) && (row?.fatigue ?? 0) < 70
      && view.factions[faction].grain >= 20) {
      const near = world.cities.find(({ key }) => key === army.location).links;
      if (state.highCommand) for (const target of near.filter((key) => view.cities[key].owner === faction)) {
        const threatened = warBlockaded(view, target) || (view.armies ?? []).some((other) => other.observed
          && other.target === target && isHostile(view, faction, other.faction));
        const route = threatened && supportRoute(world, view, army, target);
        if (route?.length > 1) options.push({ id: "M-" + army.officer + "-relief-" + target, officer: army.officer,
          type: "relieve", route, target, score: 1.25, text: own.name + "增援" + cityName(world, target) });
      }
      for (const target of new Set([army.target, ...near])) {
        const draft = { type: "march", target, depot: army.depot, stance: army.stance ?? "assault" };
        if (!tryOrder(world, view, army, draft)) continue;
        const observed = view.cities[target];
        const score = army.troops * (1 + officerSkill(state, own, "command") / 140) / (observed.troops + 140 * observed.defense + 1);
        if (score < .65) continue;
        options.push({ ...draft, officer: army.officer, id: "M-" + army.officer + "-" + target, score: score - .92,
          text: own.name + "向" + cityName(world, target) + "推进" });
      }
    }
    return options;
  });
}

export function prepareFrontline(world, state, existing, entries, { playerOnly = false, proposals = {}, logistics, applyOrder, slots = 0,
  commands, precontrolled } = {}) {
  const controlled = new Set(precontrolled);
  if (!state.frontline) return controlled;
  reconcileFormations(state, []);
  const data = state.frontline;
  const reserveByFaction = new Map();
  for (const { faction, reserve } of data.plans) reserveByFaction.set(faction, Math.max(reserveByFaction.get(faction) ?? 0, reserve));
  for (const row of data.formations.filter(({ resting, ended }) => resting && ended === null)) {
    if (playerOnly && row.faction !== state.player) continue;
    const unit = armyByOfficer(state, row.officer);
    if (!unit || !existing.has(unit.officer) || precontrolled?.has(unit.officer) || unit.phase !== "hold") continue;
    controlled.add(unit.officer);
    const reserve = Math.max(reserveByFaction.get(row.faction) ?? 0,
      row.faction === state.player ? Math.max(state.grand.national.reserve, state.delegationReserve?.grain ?? 0) : 20);
    sustain(world, state, unit, row, reserve, entries);
    if (logistics) logistics.set(unit.officer, { ...logistics.get(unit.officer), reserve });
  }
  if (!playerOnly) {
    for (const request of data.requests.filter(({ status }) => status === "pending")) {
      const options = reinforcementChoices(world, state, request.to).filter(({ request: id }) => id === request.id);
      const choice = options.find(({ id }) => id === proposals[request.to]?.battle?.[request.id])
        ?? options.find(({ unit }) => unit !== null);
      request.unit = choice?.unit ?? null;
      request.status = request.unit ? "accepted" : "refused";
      report(entries, request.to, battleLocation(state, request.objective), request.unit
        ? "盟军接受会战请求，已指定主将与履约期限。" : "盟军拒绝会战请求，当前无适宜军团或需保留兵粮。", [request.from, request.to]);
    }
  }
  for (const plan of data.plans) {
    if (playerOnly && plan.faction !== state.player) continue;
    const command = commands?.get(plan.id);
    const reserve = Math.max(reserveByFaction.get(plan.faction), command?.reserve ?? 0);
    if (plan.faction === state.player && (plan.mode === "delegate" || command?.initial) && !plan.units.length && slots > 0 && applyOrder
      && (!command || command.reinforced && !command.resting && command.moneyRoom() >= 4)
      && (state.armies ?? []).filter(({ faction }) => faction === state.player).length < armyCapacity(state)) {
      const order = musterBattlePlan(world, state, plan.objective, false, command);
      if (order && state.factions[state.player].grain - reserve >= expeditionGrain(order.troops) * 2) {
        const entry = order.type === "garrison-muster"
          ? { type: "order", orderType: "mobilize", faction: state.player, city: order.from, operationTarget: order.to,
            text: cityName(world, order.from) + "集结守备军团，携粮 " + mobilizeArmy(world, state, state.player, order) + "。" }
          : applyOrder(order);
        if (entry.type === "order") {
          if (command) { command.charge(4, expeditionGrain(order.troops) * 2, false); command.enroll?.(order.troops); }
          reconcileFormations(state, []);
          plan.units.push({ id: formationOf(state, order.officer).id, role: command?.escort ? "escort" : "advance" });
          slots--;
        }
        entries.push(entry);
      }
    }
    const main = plan.units.find(({ role }) => role === "advance");
    const mainUnit = armyByOfficer(state, data.formations.find(({ id }) => id === main?.id)?.officer);
    for (const unit of plan.units) {
      const row = data.formations.find(({ id }) => id === unit.id);
      const army = armyByOfficer(state, row?.officer);
      if (!army || !existing.has(army.officer) || precontrolled?.has(army.officer)) continue;
      controlled.add(army.officer);
      if (logistics) logistics.set(army.officer, { ...logistics.get(army.officer), reserve });
      const reinforce = unit.role === "reserve" && plan.mode === "delegate" && (command?.reinforced ?? true)
        && (!mainUnit || mainUnit.troops < (command?.withdraw ?? 450));
      if (command && plan.mission === "offensive" && !strategicPost(plan.objective) && unit.role === "advance"
        && plan.mode === "delegate" && !army.engagement) army.stance = command.approach;
      enact(world, state, army, row, { ...plan, reserve }, reinforce ? "advance" : unit.role, entries, command);
    }
  }
  if (!playerOnly) for (const request of data.requests.filter(({ status }) => status === "accepted")) {
    const row = data.formations.find(({ id }) => id === request.unit);
    const army = armyByOfficer(state, row?.officer);
    if (!army || !existing.has(army.officer)) continue;
    controlled.add(army.officer);
    if (state.highCommand) {
      const options = reinforcementChoices(world, state, request.to).filter(({ request: id, action }) => id === request.id && action);
      const response = options.find(({ id }) => id === proposals[request.to]?.battle?.[request.id])
        ?? options.sort((a, b) => b.score - a.score)[0];
      if (response?.action === "withdraw") {
        const route = closestHome(world, state, army);
        if (route) {
          redirectArmy(world, state, army, { type: "retreat", target: route.at(-1) });
          request.status = "withdrawn";
          delete request.revision;
          report(entries, request.to, battleLocation(state, request.objective), "盟军触及本方兵粮底线，按撤军路线退出。", [request.from, request.to]);
          continue;
        }
      }
      if (response?.action === "delay") {
        request.revision = { turn: state.turn, until: Math.min(state.turn + 6, request.until + 2) };
        report(entries, request.to, battleLocation(state, request.objective), "盟军请求宽限两季，等待军议答复。", [request.from, request.to]);
      }
    }
    enact(world, state, army, row, { ...request, mission: request.role === "escort" ? "defense" : "offensive", mode: "delegate" }, request.role, entries);
  }
  if (!playerOnly) for (const faction of new Set((state.armies ?? []).map((army) => army.faction))) {
    if (faction === state.player) continue;
    const options = maneuverChoices(world, state, faction);
    for (const officer of new Set(options.map((option) => option.officer))) {
      if (controlled.has(officer) || !existing.has(officer)) continue;
      const available = options.filter((option) => option.officer === officer);
      const choice = available.find(({ id }) => proposals[faction]?.maneuver?.[officer] === id)
        ?? available.sort((a, b) => b.score - a.score)[0];
      const army = armyByOfficer(state, officer);
      if (choice.type === "relieve") {
        const route = supportRoute(world, state, army, choice.target);
        if (route?.length > 1) {
          redirectArmy(world, state, army, { type: "hold" });
          Object.assign(army, { phase: "march", route, target: choice.target });
          controlled.add(officer);
        }
        continue;
      }
      const draft = tryOrder(world, state, army, choice);
      if (draft) {
        redirectArmy(world, state, army, choice);
        controlled.add(officer);
      }
    }
  }
  return controlled;
}

export function settleReinforcementPromises(world, state, entries) {
  if (!state.frontline) return;
  const data = state.frontline;
  for (const request of data.requests.filter(({ status, role }) => status === "accepted" && role === "advance")) {
    const row = data.formations.find(({ id }) => id === request.unit);
    const site = request.objective;
    const post = strategicPost(site);
    const owner = post ? postOwner(state, post) : state.cities[site].owner;
    if (owner !== request.to || request.previousOwner === owner || !allies(state, request.from, request.to)) continue;
    const won = data.battles.find((battle) => battle.turn === state.turn && battle.site === site && battle.winner === request.to
      && ["post", "siege", "relief"].includes(battle.kind) && battle.sides[0].officer === row?.officer);
    if (!won) continue;
    if (request.handover === "handover") {
      if (post) state.sandtable.posts[site] = { ...state.sandtable.posts[site], owner: request.from, closed: false };
      else handoverCities(world, eraByYear(world, state), state, request.to, request.from, [site], "return", state.turn + 1);
    }
    request.status = "fulfilled";
    report(entries, request.from, battleLocation(state, site), request.handover === "handover"
      ? "盟军履约，已将攻取的据点交给会战发起方。" : "盟军履约攻取目标，按约保有占领成果。", [request.from, request.to]);
  }
}

function recordBattle(state, episode) {
  const data = state.frontline;
  data.battles.push({ ...episode, terrain: episode.terrain ?? null, id: data.sequence++, turn: state.turn });
  if (data.battles.length > recentBattles) data.battles.shift();
  return data.battles.at(-1).id;
}

export function plannedPostAssault(state, army, destination) {
  const key = edgeKey(army.location, destination);
  const post = strategicPost(key);
  const row = formationOf(state, army.officer);
  return post && row && army.troops >= 250 && isHostile(state, army.faction, postOwner(state, post))
    && (state.frontline.plans.some((plan) => plan.objective === key
      && plan.units.some(({ id, role }) => id === row.id && (role === "advance" || role === "reserve" && plan.mode === "delegate")))
      || state.frontline.requests.some((request) => request.objective === key
        && request.unit === row.id && request.role === "advance" && request.status === "accepted"));
}

export function attackOperationalPost(world, state, army, destination, entries) {
  const key = edgeKey(army.location, destination);
  const post = strategicPost(key);
  const owner = post && postOwner(state, post);
  const before = army.troops;
  const defenders = state.sandtable.posts[key]?.troops ?? 180;
  const start = entries.length;
  const taken = takePost(world, state, army.faction, key, army.officer, entries);
  if (entries.length === start) return false;
  if (state.frontline) {
    const moved = taken ? state.sandtable.posts[key].troops : 0;
    const loss = Math.max(0, before - army.troops - moved);
    recordFormationLoss(state, army.officer, loss, "据点战损");
    const row = formationOf(state, army.officer);
    if (row) {
      row.fatigue = Math.min(100, row.fatigue + 12);
      row.experience = Math.min(100, row.experience + 6);
    }
    entries.at(-1).battleId = recordBattle(state, { kind: "post", terrain: edgeWeather(state, army.location, destination).terrain,
      site: key, sides: [
        { ...battleSide(state, army, loss, before), troops: before },
        { faction: owner, kind: "infantry", officer: null, from: destination, troops: defenders, loss: taken ? defenders : 0, strength: defenders },
      ], winner: taken ? army.faction : owner });
  }
  return true;
}

function battleSide(state, army, loss, strength) {
  const row = formationOf(state, army.officer);
  return { faction: army.faction, officer: army.officer, kind: row?.kind ?? (army.travel === "water" ? "navy" : "infantry"),
    from: army.location, troops: army.troops + loss, loss, strength };
}

export function resolveContacts(world, era, state, actors, entries, { playerOnly = false, passageWait } = {}) {
  const engaged = new Set();
  const fought = new Set();
  if (!state.frontline || playerOnly) return engaged;
  const intents = actors.filter((army) => !state.highCommand || army.troops >= 200 || army.phase === "retreat").map((army) => {
    const mode = army.phase === "retreat" ? "land" : army.travel ?? "land";
    const to = !passageWait?.has(army.officer) && ["march", "retreat"].includes(army.phase) && army.route[1];
    const moves = to && openRoadEdge(state, army.faction, army.location, to, to === army.target, mode)
      && (army.phase === "retreat" || supplyRoute(world, state, army)) && army.grain >= expeditionGrain(army.troops);
    return { army, from: army.location, to: moves ? to : null, mode };
  }).sort((a, b) => a.army.officer.localeCompare(b.army.officer));
  for (const [index, left] of intents.entries()) {
    const { army: a } = left;
    if (fought.has(a.officer)) continue;
    const right = intents.slice(index + 1).find(({ army: b, from, to }) => !fought.has(b.officer) && isHostile(state, a.faction, b.faction)
      && (left.to && (left.to === to || left.to === from && (!to || to === left.from || b.phase === "retreat"))
        || to && to === left.from && (!left.to || a.phase === "retreat")));
    if (!right) continue;
    const { army: b } = right;
    const pursuer = a.phase === "retreat" && right.to === left.from ? right
      : b.phase === "retreat" && left.to === right.from ? left : null;
    const approachOfBattle = pursuer ?? (left.to ? left : right);
    const focus = approachOfBattle.to;
    const approach = approachOfBattle.from;
    const post = strategicPost(edgeKey(approach, focus));
    const terrain = edgeWeather(state, approach, focus).terrain;
    const strength = ({ army, mode, to }) => {
      const row = formationOf(state, army.officer);
      const officer = era.officers.find(({ key }) => key === army.officer);
      const reserve = state.frontline.plans.find((plan) => plan.units.some(({ id }) => id === row?.id))?.units
        .filter(({ role }) => role === "reserve" || role === "escort").reduce((sum, { id, role }) => {
          const wing = state.frontline.formations.find((entry) => entry.id === id);
          const guard = armyByOfficer(state, wing?.officer);
          return sum + (guard !== army && guard?.location === army.location && guard.phase === "hold" ? guard.troops * (role === "reserve" ? .13 : .06) : 0);
        }, 0) ?? 0;
      const ground = terrain === "river" && mode === "water" ? 1.22 : terrain === "pass" && to ? .88
        : row?.kind === "cavalry" && terrain !== "river" ? 1.13 : 1;
      return Math.round((army.troops * (1 + officerSkill(state, officer, "command") / 150 + (row?.experience ?? 0) / 520
        - (row?.fatigue ?? 0) / 250 + Math.min(.14, (army.equipment ?? 0) * .025)) * ground + reserve) * (army.phase === "retreat" ? .76 : 1));
    };
    const powerA = strength(left);
    const powerB = strength(right);
    const winner = powerA > powerB ? a : powerB > powerA ? b : null;
    for (const army of [a, b]) {
      fought.add(army.officer);
      engaged.add(army.officer);
    }
    const withdraw = [a, b].find(({ phase }) => phase === "retreat");
    const leaving = withdraw === a ? left : right;
    if (pursuer && leaving.to && leaving.to !== pursuer.from && leaving.to !== pursuer.to) engaged.delete(withdraw.officer);
    const casualties = (army) => Math.min(army.troops - 1, Math.ceil(army.troops * (army === withdraw ? .12 : winner === army ? .16 : .31)));
    const lossA = casualties(a);
    const lossB = casualties(b);
    a.troops -= lossA;
    b.troops -= lossB;
    recordFormationLoss(state, a.officer, lossA, "野战战损");
    recordFormationLoss(state, b.officer, lossB, "野战战损");
    for (const army of [a, b]) {
      const row = formationOf(state, army.officer);
      if (row) {
        row.experience = Math.min(100, row.experience + 8);
        row.fatigue = Math.min(100, row.fatigue + 16);
        remember(state, row, withdraw ? "撤退遭遇" : "野战接敌");
      }
      delete army.engagement;
      if (army === winner || army === withdraw) continue;
      const route = closestHome(world, state, army);
      if (route?.length > 1) redirectArmy(world, state, army, { type: "retreat", target: route.at(-1) });
      else redirectArmy(world, state, army, { type: "hold" });
    }
    const battleId = recordBattle(state, { site: post?.key ?? focus, terrain, kind: withdraw ? "withdrawal" : "contact",
      ...(state.century ? { events: { support: [], withdrawing: [a, b].filter(({ phase }) => phase === "retreat").map(({ faction }) => faction),
        blocked: [a, b].filter((unit) => !supplyRoute(world, state, unit)).map(({ faction }) => faction), occupied: null } } : {}),
      sides: [battleSide(state, a, lossA, powerA), battleSide(state, b, lossB, powerB)], winner: winner?.faction ?? null });
    report(entries, a.faction, focus, (post?.name ?? cityName(world, focus) + "外") + "爆发" + (withdraw ? "追撤战" : "遭遇战")
      + "，两军分别损失 " + lossA + "、" + lossB + " 人。", [a.faction, b.faction]);
    entries.at(-1).battleId = battleId;
  }
  return engaged;
}

export function interceptConvoys(world, state, actors, engaged, entries) {
  for (const convoy of state.landscape.convoys.filter(({ status }) => status === "queued")) {
    const route = convoyRoute(world, state, convoy.faction, convoy.from, convoy.to, convoy.mode);
    if (!route) continue;
    const guards = actors.filter((unit) => unit.faction === convoy.faction || allies(state, convoy.faction, unit.faction))
      .filter((unit) => {
        const row = formationOf(state, unit.officer);
        return unit.phase === "hold" && unit.troops >= 300 && unit.grain > 0 && route.includes(unit.location)
          && (state.frontline.plans.some((plan) => plan.units.some(({ id, role }) => id === row?.id && role === "escort"))
            || state.frontline.requests.some(({ status, role, unit }) => status === "accepted" && role === "escort" && unit === row?.id));
      });
    const raider = actors.find((unit) => unit.troops >= 300 && unit.grain >= expeditionGrain(unit.troops) && !engaged.has(unit.officer)
      && isHostile(state, unit.faction, convoy.faction) && (route.includes(unit.location) && unit.phase === "hold"
        || unit.phase === "march" && route.includes(unit.route[1])
          && openRoadEdge(state, unit.faction, unit.location, unit.route[1], true, unit.travel)));
    if (!raider) continue;
    const guard = guards.sort((a, b) => b.troops - a.troops)[0];
    if (guard && guard.troops >= raider.troops * .65) {
      report(entries, convoy.faction, guard.location, "护运军团击退粮道威胁，运输照常。", [convoy.faction, raider.faction]);
      engaged.add(raider.officer);
      continue;
    }
    convoy.status = state.turn - convoy.turn >= 2 ? "blocked" : "queued";
    convoy.heldAt = state.turn;
    engaged.add(raider.officer);
    report(entries, convoy.faction, convoy.from, "运输线发现敌军，车队停发，货物留仓。可改线或增派护卫。", [convoy.faction, raider.faction]);
  }
}

export function recordTownBattle(world, state, order, army, entry, assistance) {
  if (!state.frontline || !entry.battle || !army) return;
  const level = assistance.reduce((sum, { contribution }) => sum + contribution, 0);
  const { attacker, defender, personnel } = entry.battle;
  recordFormationLoss(state, army.officer, attacker.casualties, "城下战损");
  const terrain = edgeWeather(state, order.from, order.to).terrain;
  const row = formationOf(state, army.officer);
  if (row) {
    row.experience = Math.min(100, row.experience + 7);
    row.fatigue = Math.min(100, row.fatigue + 15);
    remember(state, row, level ? "援军策应攻守" : "城下攻守");
  }
  entry.battleId = recordBattle(state, { kind: level ? "relief" : "siege", terrain, site: order.to,
    ...(state.century ? { events: { support: assistance.map(({ unit }) => ({
      faction: unit.faction, officer: unit.officer, kind: formationOf(state, unit.officer)?.kind ?? "infantry",
      from: unit.location, troops: unit.troops,
    })).slice(0, 6), withdrawing: army.phase === "retreat" ? [army.faction] : [],
    blocked: !supplyRoute(world, state, army) ? [army.faction] : [],
    occupied: entry.type === "capture" ? attacker.faction : null } } : {}),
    sides: [
      { faction: attacker.faction, officer: army.officer, kind: row?.kind ?? "infantry", from: order.from,
        troops: attacker.troops, loss: attacker.casualties, strength: attacker.strength },
      { faction: defender.faction, officer: personnel.defender, kind: "infantry", from: order.to,
        troops: defender.troops, loss: defender.casualties, strength: defender.strength },
    ], winner: entry.type === "capture" ? attacker.faction : defender.faction });
}

export function defenseUnits(state, target) {
  if (!state.frontline) return [];
  const owner = state.cities[target].owner;
  const league = leagueDefenders(state, target).map((unit) => ({ unit, contribution: Math.floor(unit.troops * .23) }));
  return state.frontline.requests.filter((row) => row.status === "accepted" && row.from === owner)
    .flatMap((request) => {
      const row = state.frontline.formations.find(({ id }) => id === request.unit);
      const army = armyByOfficer(state, row?.officer);
      return army?.location === target && army.phase === "hold" && allies(state, owner, army.faction) && army.grain > 0
        ? [{ unit: army, contribution: Math.round(army.troops * .45) }] : [];
    }).concat(league);
}

export function auxiliaryDefense(state, target) {
  return defenseUnits(state, target).reduce((sum, { contribution }) => sum + contribution, 0);
}

export function visibleBattles(state) {
  const live = (state.frontline?.battles ?? []).filter(({ sides }) => sides.some(({ faction }) => faction === state.player));
  if (!state.reign?.records.length && !state.century?.battles.length) return live.slice().reverse();
  const archives = [...(state.century?.battles ?? []), ...(state.reign?.records.flatMap(({ battles }) => battles) ?? [])];
  const games = new Map(archives.map((battle) => [battle.id, battle]));
  for (const battle of live) games.set(battle.id, battle);
  return [...games.values()].sort((a, b) => b.id - a.id);
}

export function armyObservation(state, faction, officer) {
  const army = visibleArmy(state, faction, officer);
  return army && (!army.observed || state.turn - army.seen <= 2) ? army : null;
}

export function validFrontlineBattle(state, officers, battle) {
  const faction = (key) => typeof key === "string" && Object.hasOwn(state.factions, key);
  const town = (key) => typeof key === "string" && Object.hasOwn(state.cities, key);
  return Boolean(battle && (town(battle.site) || strategicPost(battle.site))
    && ["river", "pass", null].includes(battle.terrain ?? null) && ["contact", "withdrawal", "siege", "relief", "post"].includes(battle.kind)
    && (battle.winner === null || faction(battle.winner))
    && Array.isArray(battle.sides) && battle.sides.length === 2 && battle.sides.every((side) => side && town(side.from)
      && faction(side.faction) && (side.officer === null || officers.has(side.officer)) && Object.hasOwn(formationKinds, side.kind)
      && count(side.troops, 0, Number.MAX_SAFE_INTEGER) && count(side.loss, 0, side.troops) && count(side.strength, 0, Number.MAX_SAFE_INTEGER))
    && (battle.events === undefined || battle.events && [battle.events.blocked, battle.events.withdrawing]
      .every((list) => Array.isArray(list) && list.length <= 2 && list.every(faction))
      && (battle.events.occupied === null || faction(battle.events.occupied))
      && Array.isArray(battle.events.support) && battle.events.support.length <= 6 && battle.events.support.every((unit) => unit && town(unit.from)
        && faction(unit.faction) && officers.has(unit.officer) && Object.hasOwn(formationKinds, unit.kind) && count(unit.troops, 1, Number.MAX_SAFE_INTEGER))));
}

export function validFrontline(state, officers) {
  const data = state.frontline;
  if (data === undefined) return true;
  const faction = (key) => typeof key === "string" && Object.hasOwn(state.factions, key);
  const town = (key) => typeof key === "string" && Object.hasOwn(state.cities, key);
  const objective = (key) => town(key) || Boolean(strategicPost(key));
  const id = (value) => count(value, 1, data.sequence - 1);
  const boundedList = (list, max) => Array.isArray(list) && list.length <= max;
  const turn = (value) => count(value, data.since, state.turn);
  if (!data || !state.sandtable || !count(data.since, 0, state.turn) || !count(data.sequence, 1, 10_000_000)
    || !boundedList(data.formations, 84) || !boundedList(data.plans, 84) || !boundedList(data.battles, recentBattles)
    || !boundedList(data.requests, 30)) return false;
  const rows = [...data.formations, ...data.plans, ...data.battles, ...data.requests];
  if (!rows.every((row) => row && id(row.id)) || new Set(rows.map((row) => row.id)).size !== rows.length) return false;
  const active = data.formations.filter(({ ended }) => ended === null);
  return new Set(active.map(({ officer }) => officer)).size === active.length
    && data.formations.every((row) => faction(row.faction) && officers.has(row.officer) && turn(row.started)
      && (row.ended === null || count(row.ended, row.started, state.turn))
      && Object.hasOwn(formationKinds, row.kind) && count(row.fatigue, 0, 100) && count(row.experience, 0, 100)
      && count(row.losses, 0, Number.MAX_SAFE_INTEGER) && count(row.establishment, 1, Number.MAX_SAFE_INTEGER)
      && typeof row.resting === "boolean" && boundedList(row.service, 6)
      && row.service.every((note) => note && turn(note.turn) && typeof note.event === "string" && note.event.length <= 30))
    && new Set(data.plans.flatMap((plan) => Array.isArray(plan.units) ? plan.units.map((unit) => unit?.id) : [])).size
      === data.plans.reduce((total, plan) => total + (Array.isArray(plan.units) ? plan.units.length : 0), 0)
    && data.plans.every((plan) => faction(plan.faction) && objective(plan.objective) && turn(plan.started)
      && data.plans.filter((row) => row.faction === plan.faction).length <= 3 && Object.hasOwn(battleMissions, plan.mission)
      && ["direct", "delegate"].includes(plan.mode) && count(plan.reserve, 0, 9999) && boundedList(plan.units, 4)
      && plan.units.every((unit) => unit && active.some((row) => row.id === unit.id && row.faction === plan.faction) && Object.hasOwn(battleRoles, unit.role)))
    && data.battles.every((battle) => turn(battle.turn) && validFrontlineBattle(state, officers, battle))
    && data.requests.every((row) => faction(row.from) && faction(row.to) && faction(row.previousOwner) && row.from !== row.to && objective(row.objective)
      && id(row.plan) && (row.unit === null || id(row.unit)) && count(row.until, data.since, state.turn + 6)
      && ["advance", "escort"].includes(row.role) && ["retain", "handover"].includes(row.handover)
      && (["pending", "accepted", "refused", "expired", "fulfilled"].includes(row.status) || state.highCommand && row.status === "withdrawn")
      && (row.revised === undefined || state.highCommand && typeof row.revised === "boolean")
      && (row.revision === undefined || state.highCommand && row.revision && count(row.revision.turn, data.since, state.turn)
        && count(row.revision.until, row.until + 1, row.revision.turn + 6)));
}
