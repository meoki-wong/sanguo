import { availableAttackers, cityName, cityReserve, eraByYear, expeditionGrain, forecastAttack, gameOutcome, minimumMarch, previewOrders } from "./engine.js";
import { isHostile } from "./diplomacy.js";
import { roadPath as roadsBetween } from "./roads.js";
import { officeSkill } from "./realm.js";
import { militaryView, roadTerrain } from "./war-intel.js";
import { resolveInvestment, stances, validArmyOperation, warBlockaded, warReport } from "./war-operations.js";
import { dispatchRoute, hasPassage, openRoadEdge } from "./grand-logistics.js";
import { edgeWeather, routeWeather, travelModes } from "./landscape-terrain.js";
import { issueEquipment } from "./landscape-economy.js";
import { postTransit } from "./sandtable-posts.js";
import { attackOperationalPost, formationOf, interceptConvoys, operationalPassage, plannedPostAssault, reconcileFormations,
  recordFormationLoss, resolveContacts } from "./frontline.js";

export const armyLimit = 2;
export const armyCapacity = (state) => state.grand ? 4 : armyLimit;
export const armyGarrison = 400;
export const armyPhases = { muster: "集结中", march: "行军中", hold: "固守", retreat: "撤军中", secured: "战后驻扎" };

const marchHops = 4;
const owned = (state, faction, key) => state.cities[key]?.owner === faction;
const cityIndex = (world) => new Map(world.cities.map((city) => [city.key, city]));

export function armyByOfficer(state, officer) {
  return state.armies?.find((army) => army.officer === officer) ?? null;
}

export function holdingArmies(state, faction, city) {
  return state?.armies?.filter((army) => army.faction === faction && army.location === city && army.troops > 0
    && ["hold", "secured"].includes(army.phase)) ?? [];
}

export function marchRoute(world, state, faction, from, target, mode = "land") {
  if (!hasPassage(state, faction, from) || !state.cities[target] || owned(state, faction, target)
    || !isHostile(state, faction, state.cities[target].owner)) return null;
  return roadsBetween(cityIndex(world), from, target, (key) => key === target || hasPassage(state, faction, key), marchHops,
    (a, b) => openRoadEdge(state, faction, a, b, b === target, mode));
}

export function supplyRoute(world, state, army, depot = army.depot) {
  const { faction, location } = army;
  if (!owned(state, faction, depot) || state.cities[depot].occupation || !operationalPassage(state, army, location) || warBlockaded(state, depot)) return null;
  const graph = cityIndex(world);
  const usable = (key) => operationalPassage(state, army, key)
    && (!state.cities[key].occupation || key === location) && (key === location || !warBlockaded(state, key));
  const routes = (army.travel === "water" ? ["water", "land"] : ["land"]).map((mode) =>
    roadsBetween(graph, depot, location, usable, Infinity, (a, b) => openRoadEdge(state, faction, a, b, false, mode)));
  return routes.find(Boolean) ?? null;
}

export function shippingCost(world, state, army, route) {
  if (!state.realm || !route) return 0;
  const office = army.faction === state.player ? officeSkill(eraByYear(world, state), state, "marshal") : 0;
  const difficult = state.war ? route.slice(1).filter((key, index) => roadTerrain(route[index], key)).length : 0;
  const formation = state.grand?.campaigns.find(({ wings }) => Object.values(wings).some(({ officer }) => officer === army.officer));
  const escort = formation?.wings.escort && armyByOfficer(state, formation.wings.escort.officer);
  const protectedRoute = escort?.faction === army.faction && escort.troops >= 300 && escort.phase === "hold" && route.includes(escort.location);
  const byWater = army.travel === "water" && route.slice(1).every((key, index) => edgeWeather(state, route[index], key).terrain === "river");
  return Math.max(0, route.length - 2 + difficult + routeWeather(state, route, byWater ? "water" : "land")
    - Number(office >= 80) - (protectedRoute ? 2 : 0));
}

export function withdrawalRoute(world, state, army, to) {
  if (!owned(state, army.faction, to)) return null;
  return roadsBetween(cityIndex(world), army.location, to, (key) => operationalPassage(state, army, key)
    && (key === to || !warBlockaded(state, key)), Infinity, (a, b) => openRoadEdge(state, army.faction, a, b));
}

export function mobilizationQuote(world, state, faction, order) {
  const { from, to, officer, troops } = order;
  const factionArmies = (state.armies ?? []).filter((army) => army.faction === faction);
  if (order.stance !== undefined && (!state.war || !Object.hasOwn(stances, order.stance))) throw new Error("请选择可用的军团战法。");
  if (factionArmies.length >= armyCapacity(state)) throw new Error("每个势力最多同时组建 " + armyCapacity(state) + " 支军团。");
  if (!owned(state, faction, from) || state.cities[from].occupation) throw new Error("集结城须为己方已完成整顿的城池。");
  if (order.travel !== undefined && (!state.landscape || !Object.hasOwn(travelModes, order.travel))) throw new Error("请选择可用的水陆行军方式。");
  const route = order.type === "garrison-muster" && state.highCommand
    ? withdrawalRoute(world, state, { faction, location: from }, to) : marchRoute(world, state, faction, from, to, order.travel);
  if (!route) throw new Error("目标须在四段可通行的水陆道路以内。");
  const era = eraByYear(world, state);
  if (!availableAttackers(era, state, faction, from).some(({ key }) => key === officer)) {
    throw new Error("请选择驻在集结城且可领兵的待任武将或守将。");
  }
  const leave = state.cities[from].troops - troops;
  if (!Number.isSafeInteger(troops) || troops < minimumMarch || leave < cityReserve) {
    throw new Error("请至少集结 200 人，并在出发城留守 250 人。");
  }
  const ration = expeditionGrain(troops);
  if (state.factions[faction].grain < 2 * ration) throw new Error("组建军团需要两季随军粮。");
  const equipment = Math.min(state.landscape?.equipment[from] ?? 0, Math.ceil(troops / 250));
  return { route, leave, ration, carried: 2 * ration, quarters: route.length + 1, equipment,
    battle: forecastAttack(era, state, order, faction, { travel: order.travel, equipment }) };
}

export function mobilizeArmy(world, state, faction, order) {
  const { route, carried } = mobilizationQuote(world, state, faction, order);
  const { officer, from, troops, to } = order;
  const city = state.cities[from];
  city.troops -= troops;
  if (city.commander === officer) city.commander = null;
  state.stations[officer] = null;
  state.factions[faction].grain -= carried;
  state.armies ??= [];
  state.armies.push({ faction, officer, troops, grain: carried, location: from, depot: from, target: to, route,
    phase: "muster", prepared: false, assembledAt: state.turn, ...(order.stance ? { stance: order.stance } : {}),
    ...(state.landscape ? { travel: order.travel ?? "land", equipment: issueEquipment(state, from, troops) } : {}) });
  return carried;
}

export function armyStatus(world, state, army) {
  const supply = supplyRoute(world, state, army);
  const ration = expeditionGrain(army.troops);
  const routeClosed = army.route.slice(1).some((key, index) =>
    !openRoadEdge(state, army.faction, army.route[index], key, key === army.target, army.phase === "retreat" ? "land" : army.travel)
      || key !== army.target && !hasPassage(state, army.faction, key));
  return { supply, ration, routeClosed, reserveSeasons: Math.floor(army.grain / ration) };
}

export function orderArmy(world, state, army, order) {
  if (order.type === "hold") return { phase: "hold" };
  if (order.type === "supply" && state.landscape) {
    if (!supplyRoute(world, state, army, order.depot)) throw new Error("新粮仓与军团之间须有可通行的粮道。");
    return { phase: army.phase, depot: order.depot };
  }
  if (order.type === "retreat") {
    const route = withdrawalRoute(world, state, army, order.target);
    if (!route) throw new Error("没有通往该己方城池的撤军道路。");
    return { phase: "retreat", route, target: order.target };
  }
  if (order.stance !== undefined && (!state.war || !Object.hasOwn(stances, order.stance))) throw new Error("请选择可用的军团战法。");
  const travel = order.travel ?? army.travel ?? "land";
  const route = marchRoute(world, state, army.faction, army.location, order.target, travel);
  if (order.type !== "march" || !route || !supplyRoute(world, state, { ...army, travel }, order.depot)) {
    throw new Error("继续出征需要可通行的目标和补给城。");
  }
  return { phase: army.prepared ? "march" : "muster", route, target: order.target, depot: order.depot,
    ...(state.landscape ? { travel } : {}),
    ...(order.stance !== undefined ? { stance: order.stance } : {}) };
}

export function redirectArmy(world, state, army, order) {
  const next = orderArmy(world, state, army, order);
  if (order.type !== "supply" && (next.phase !== "march" || next.target !== army.target || (next.stance && next.stance !== army.stance))) delete army.engagement;
  Object.assign(army, next);
}

function releaseArmy(state, army) {
  state.cities[army.location].troops += army.troops;
  state.stations[army.officer] = army.location;
  state.factions[army.faction].grain += army.grain;
  army.troops = 0;
  return army.grain;
}

function removeInactive(state) {
  state.armies = state.armies.filter(({ troops }) => troops > 0);
  if (!state.armies.length) delete state.armies;
}

export function commandArmy(world, state, officer, order) {
  if (gameOutcome(state) !== "ongoing") throw new Error("战局已结束。");
  const original = armyByOfficer(state, officer);
  if (!original || original.faction !== state.player) throw new Error("只能指挥本势力的军团。");
  const next = structuredClone(state);
  const army = armyByOfficer(next, officer);
  if (order.type === "garrison") {
    if (!owned(next, army.faction, army.location)) throw new Error("只能驻入己方城池。");
    releaseArmy(next, army);
    removeInactive(next);
  } else {
    redirectArmy(world, next, army, order);
  }
  const formation = formationOf(next, officer);
  if (formation) formation.resting = false;
  for (const plan of next.frontline?.plans ?? []) plan.units = plan.units.filter(({ id }) => id !== formation?.id);
  reconcileFormations(next, []);
  releaseLegacyArmyControl(next, officer);
  if (next.war && order.type === "retreat") next.war.timeline = [...next.war.timeline,
    { turn: next.turn, event: "retreat", faction: next.player, city: order.target, officer, text: "接管军团并下令撤回。" }].slice(-120);
  previewOrders(world, next);
  return next;
}

export function releaseLegacyArmyControl(state, officer) {
  for (const plan of state.theaters ?? []) {
    if (plan.army !== officer) continue;
    plan.army = null;
    plan.paused = true;
    delete plan.report;
  }
  if (state.landscape) for (const plan of state.grand.campaigns) {
    if (Object.values(plan.wings).some((wing) => wing.officer === officer) && ["ready", "active", "blocked"].includes(plan.status)) {
      plan.status = "paused";
      plan.note = "地图已接管该军团。";
    }
  }
  for (const plan of state.statecraft?.fronts ?? []) {
    if (plan.officer === officer && plan.status !== "completed") {
      plan.status = "paused";
      plan.officer = null;
      plan.report = { turn: state.turn, text: "地图已接管军团。" };
    }
  }
  for (const war of state.sandtable?.wars ?? []) {
    if (war.from === state.player && war.status === "fighting" && war.commander === officer) war.auto = false;
  }
}

function armyEntry(world, era, army, text) {
  const leader = era.officers.find(({ key }) => key === army.officer);
  return { type: "army", faction: army.faction, city: army.location, armyOfficer: army.officer, assembledAt: army.assembledAt,
    text: leader.name + "军团" + text };
}

function supplySeason(world, state, army, ration, allocation) {
  const supply = supplyRoute(world, state, army);
  let spent = 0;
  if (supply) {
    const stock = state.factions[army.faction];
    const national = army.faction === state.player ? Math.max(state.delegationReserve?.grain ?? 0, state.grand?.national.reserve ?? 0) : 12;
    const reserve = Math.max(national, allocation?.reserve ?? 0, state.dynasty?.policies[army.faction]?.grainFloor ?? 0);
    const freight = shippingCost(world, state, army, supply);
    const store = state.grand?.depots[army.depot] ?? 0;
    const centralStock = !state.sandtable || dispatchRoute(world, state, army.faction, army.depot) ? Math.max(0, stock.grain - reserve) : 0;
    const shipment = Math.max(0, Math.min(centralStock + store,
      Math.max(0, 2 * ration - army.grain) + freight, allocation?.limit?.() ?? Infinity));
    if (shipment > freight) {
      const used = Math.min(store, shipment);
      if (used) state.grand.depots[army.depot] -= used;
      stock.grain -= shipment - used;
      army.grain += shipment - freight;
      allocation?.charge?.(shipment);
      spent = shipment;
    }
    if (state.sandtable) {
      const armory = state.landscape.equipment;
      const issue = Math.min(armory[army.depot] ?? 0, 3, Math.max(0, Math.ceil(army.troops / 400) - (army.equipment ?? 0)));
      if (issue) {
        armory[army.depot] -= issue;
        army.equipment = (army.equipment ?? 0) + issue;
      }
    }
  }
  const short = army.grain < ration;
  army.grain = Math.max(0, army.grain - ration);
  return { connected: Boolean(supply), short, spent };
}

function steerOpponent(world, era, state, army) {
  if (["muster", "retreat"].includes(army.phase)) return;
  if (army.phase === "secured" && owned(state, army.faction, army.location)) {
    releaseArmy(state, army);
    return;
  }
  const route = marchRoute(world, state, army.faction, army.location, army.target, army.travel);
  const ownedCities = world.cities.filter(({ key }) => owned(state, army.faction, key));
  const depot = supplyRoute(world, state, army) ? army.depot : ownedCities
    .map(({ key }) => ({ key, road: supplyRoute(world, state, army, key) })).filter(({ road }) => road)
    .sort((a, b) => a.road.length - b.road.length)[0]?.key;
  if (route && depot && army.troops >= minimumMarch) {
    const odds = route.length === 2 && forecastAttack(era, militaryView(state, army.faction), {
      from: army.location, to: army.target, officer: army.officer, troops: army.troops,
    }, army.faction);
    if (army.stance && army.stance !== "assault" && state.war && (!odds || odds.offense >= odds.defense * .68)) {
      redirectArmy(world, state, army, { type: "march", target: army.target, depot });
      return;
    }
    if (!odds || odds.offense >= odds.defense * .8) {
      const phase = odds && !odds.wins ? "hold" : army.prepared ? "march" : "muster";
      if (phase === "hold") delete army.engagement;
      Object.assign(army, { phase, route, depot });
      return;
    }
  }
  const retreat = ownedCities.map(({ key }) => withdrawalRoute(world, state, army, key)).filter(Boolean)
    .sort((a, b) => a.length - b.length)[0];
  if (retreat) redirectArmy(world, state, army, { type: "retreat", target: retreat.at(-1) });
}

export function settleArmies(world, era, state, existing, fight, { playerOnly = false, logistics, captured = new Set(), controlled = new Set(), passageWait } = {}) {
  const reports = [];
  const assaults = [];
  const before = state.frontline && (state.armies ?? []).map((army) => ({ ...army }));
  const supplied = state.frontline ? new Set() : null;
  let engaged;
  if (state.frontline) {
    const actors = (state.armies ?? []).filter((army) => existing.has(army.officer) && (!playerOnly || army.faction === state.player));
    const returned = new Map();
    for (const army of actors) {
      if (army.faction !== state.player && !controlled.has(army.officer)) {
        steerOpponent(world, era, state, army);
        if (!army.troops) returned.set(army.officer, army.grain);
      }
    }
    for (const [officer, grainReturned] of returned) {
      const unit = actors.find((army) => army.officer === officer);
      reports.push({ ...armyEntry(world, era, unit, "驻入" + cityName(world, unit.location) + "整顿。"), grainReturned });
    }
    const living = actors.filter(({ troops }) => troops > 0);
    engaged = resolveContacts(world, era, state, living, reports, { playerOnly, passageWait });
    if (!playerOnly) interceptConvoys(world, state, living, engaged, reports);
  }
  for (const army of state.armies ?? []) {
    if (!army.troops || (playerOnly && army.faction !== state.player)) continue;
    const note = (text, returned = 0, reason) => {
      const entry = armyEntry(world, era, army, text);
      if (returned) entry.grainReturned = returned;
      if (reason) entry.reason = reason;
      reports.push(entry);
    };
    const report = (event, text, cost = 0) => {
      if (state.war && army.stance) reports.push(warReport(event, army.faction, army.target, text, { officer: army.officer, cost }));
    };
    if (!Object.values(state.cities).some(({ owner }) => owner === army.faction)) {
      note("因势力覆灭而解散。");
      army.troops = 0;
      continue;
    }
    if (!existing.has(army.officer)) continue;
    if (!state.frontline && army.faction !== state.player) steerOpponent(world, era, state, army);
    if (!army.troops) {
      note("驻入" + cityName(world, army.location) + "整顿。", army.grain);
      continue;
    }
    if (army.phase === "retreat" && army.location === army.target && owned(state, army.faction, army.location)) {
      note("已撤回" + cityName(world, army.location) + "。", releaseArmy(state, army));
      report("returned", "军团回营，余粮归仓。");
      continue;
    }
    const advancing = ["muster", "march"].includes(army.phase);
    const { connected, short, spent } = supplySeason(world, state, army, expeditionGrain(army.troops), logistics?.get(army.officer));
    if (connected && !short) supplied?.add(army.officer);
    if (short) {
      const losses = Math.min(army.troops, Math.max(1, Math.ceil(army.troops * .12)));
      army.troops -= losses;
      recordFormationLoss(state, army.officer, losses, "断粮损失");
      note("随军粮不足，折损 " + losses + " 人。");
      if (army.phase !== "retreat") army.phase = "hold";
      delete army.engagement;
    }
    if (!army.troops) continue;
    if (!connected && army.phase === "retreat") report("isolated", "撤军途中粮道中断，军团沿退路消耗随行粮。");
    if (!connected && advancing) {
      army.phase = "hold";
      delete army.engagement;
      note("补给中断，就地固守。", 0, "supply-cut");
      report("isolated", "军团补给路已断，须改道、补粮或撤军。", spent);
    }
    if (army.phase === "muster") {
      army.phase = "march";
      army.prepared = true;
      note("集结完毕，下季开拔。");
      report("prepared", "军团集结完成，下季开拔。", spent);
      continue;
    }
    if (engaged?.has(army.officer) || passageWait?.has(army.officer)) continue;
    if (army.phase !== "march" && army.phase !== "retreat") continue;
    const mode = army.phase === "retreat" ? "land" : army.travel ?? "land";
    let destination = army.route[1];
    if (state.landscape && destination && !openRoadEdge(state, army.faction, army.location, destination, destination === army.target, mode)) {
      const diversion = army.phase === "retreat" ? withdrawalRoute(world, state, army, army.target)
        : marchRoute(world, state, army.faction, army.location, army.target, mode);
      const hazard = edgeWeather(state, army.location, destination);
      if (diversion) {
        army.route = diversion;
        destination = diversion[1];
        note(hazard.label + "影响行程，军团改道经" + cityName(world, destination) + "。");
      } else {
        army.phase = "hold";
        delete army.engagement;
        note(hazard.label + "阻断行程，军团就地固守。");
        continue;
      }
    }
    if (army.phase === "retreat" && destination !== army.target && warBlockaded(state, destination)) {
      army.phase = "hold";
      report("withdraw-blocked", "撤回途中有城被围，军团停步并请求改道。", spent);
      continue;
    }
    if (state.frontline && controlled.has(army.officer) && army.phase === "march" && plannedPostAssault(state, army, destination)) {
      assaults.push(() => attackOperationalPost(world, state, army, destination, reports));
      continue;
    }
    if (operationalPassage(state, army, destination) && openRoadEdge(state, army.faction, army.location, destination, false, mode)) {
      army.location = destination;
      army.route = army.route.slice(1);
      const arrived = destination === army.target;
      const staying = arrived && army.phase !== "retreat" && controlled.has(army.officer);
      if (staying) army.phase = "hold";
      note(arrived && army.phase === "retreat" ? "已撤回" + cityName(world, destination) + "。"
        : "已抵达" + cityName(world, destination) + "。", arrived && !staying ? releaseArmy(state, army) : 0);
      delete army.engagement;
      report(arrived && !staying ? "returned" : "moving", "军团已抵达" + cityName(world, destination) + "。", spent);
      continue;
    }
    if (army.phase === "retreat" || destination !== army.target || !state.cities[destination]
      || !isHostile(state, army.faction, state.cities[destination].owner) || army.troops < minimumMarch || (state.war && captured.has(destination))) {
      const wasRetreating = army.phase === "retreat";
      army.phase = "hold";
      delete army.engagement;
      note("道路易主、协定生效或兵力不足，就地固守。");
      report(wasRetreating ? "withdraw-blocked" : "held", wasRetreating ? "撤军道路易主，军团停步并请求改道。"
        : "目标已易主或受协定保护，军团等待新指令。", spent);
      continue;
    }
    if (!postTransit(state, army.faction, army.location, destination)) {
      const assaultPost = () => attackOperationalPost(world, state, army, destination, reports);
      if (state.frontline) assaults.push(assaultPost);
      else assaultPost();
      continue;
    }
    const order = { type: "attack", from: army.location, to: destination, officer: army.officer, troops: army.troops };
    const attack = (unit, conditions) => {
      const detail = state.landscape ? { ...conditions, travel: mode, equipment: unit.equipment ?? 0 } : conditions;
      const ration = unit.grain;
      const entry = fight(unit, order, detail);
      if (state.landscape) {
        unit.equipment = Math.floor((unit.equipment ?? 0) * .7);
        const hazard = edgeWeather(state, order.from, order.to);
        entry.text += travelModes[mode] + " · " + hazard.label + " · 军械 " + detail.equipment + " · 随军粮 " + ration + "。";
      }
      if (entry.type === "capture") {
        captured.add(destination);
        report("captured", "战役攻占" + cityName(world, destination) + "，已开始接管。");
      } else if (army.stance) report("held", "攻坚失利，军团就地重整。");
      return entry;
    };
    const attackTown = () => {
      if (state.frontline && (!army.troops || captured.has(destination) || !isHostile(state, army.faction, state.cities[destination].owner))) {
        if (army.troops) redirectArmy(world, state, army, { type: "hold" });
        return;
      }
      if (army.stance && army.stance !== "assault") resolveInvestment(world, state, army, attack, reports, spent);
      else {
        report("assault", "军团向" + cityName(world, destination) + "发起强攻。", spent);
        reports.push(attack(army));
      }
    };
    if (state.frontline) assaults.push(attackTown);
    else attackTown();
  }
  for (const assault of assaults) assault();
  if (state.armies) removeInactive(state);
  if (before) reconcileFormations(state, before, supplied, true);
  return reports;
}

export function validArmies(world, state, officers) {
  if (state.armies === undefined) return true;
  if (!Array.isArray(state.armies) || state.armies.length > Object.keys(state.factions).length * armyCapacity(state)) return false;
  const cities = cityIndex(world);
  const seen = new Set();
  const amounts = new Map();
  return state.armies.every((army) => {
    if (!army || !officers.has(army.officer) || officers.get(army.officer).faction !== army.faction || seen.has(army.officer)
      || state.stations[army.officer] !== null || !Object.hasOwn(armyPhases, army.phase) || typeof army.prepared !== "boolean"
      || (army.phase === "muster" && army.prepared) || (["march", "secured"].includes(army.phase) && !army.prepared)
      || !Number.isSafeInteger(army.assembledAt) || army.assembledAt < 0
      || (army.opening && (!state.statecraft || army.assembledAt !== 0 || army.opening !== true))
      || (army.assembledAt >= state.turn && !(army.opening && state.turn === 0))
      || ![army.depot, army.location, army.target].every((key) => cities.has(key))
      || !Number.isSafeInteger(army.troops) || army.troops < 1 || !Number.isSafeInteger(army.grain) || army.grain < 0
      || (army.travel !== undefined && (!state.landscape || !Object.hasOwn(travelModes, army.travel)))
      || (army.equipment !== undefined && (!state.landscape || !Number.isSafeInteger(army.equipment) || army.equipment < 0 || army.equipment > 1000))
      || !Array.isArray(army.route) || army.route[0] !== army.location || army.route.at(-1) !== army.target
      || new Set(army.route).size !== army.route.length || !army.route.every((key, index) => cities.has(key)
        && (!index || cities.get(army.route[index - 1]).links.includes(key))) || !validArmyOperation(state, army)) return false;
    seen.add(army.officer);
    const count = (amounts.get(army.faction) ?? 0) + 1;
    amounts.set(army.faction, count);
    return count <= armyCapacity(state);
  });
}
