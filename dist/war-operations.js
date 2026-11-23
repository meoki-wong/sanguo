import { armyByOfficer, marchRoute, supplyRoute, withdrawalRoute } from "./armies.js";
import { isHostile } from "./diplomacy.js";
import { cityName, eraByYear, expeditionGrain, forecastAttack, gameOutcome, minimumMarch, openingCapital } from "./engine.js";
import { militaryView, roadTerrain, terrainLabels, townIntel } from "./war-intel.js";
import { combinedSiegeSupport } from "./grand-campaign.js";

export const missions = { main: "主攻", diversion: "牵制", relief: "解围" };
export const stances = { siege: "围困", assault: "强攻", blockade: "封锁" };
const int = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

export const warEvents = new Set(["ordered", "prepared", "moving", "encircled", "pressure", "breach", "relieved", "surrender",
  "blockaded", "diverted", "assault", "captured", "secured", "retreat", "returned", "isolated", "withdraw-blocked", "resupplied",
  "scouted", "scout-blocked", "support", "allied", "strained", "restored", "aid", "road", "milestone", "held"]);

export function warReport(event, faction, city, text, detail = {}) {
  return { type: "war", event, faction, city, text, ...detail };
}

export function warBlockaded(state, key) {
  if (!state.war || !state.cities[key]) return false;
  return (state.armies ?? []).some((army) => army.target === key && army.engagement?.owner === state.cities[key].owner
    && army.phase === "march" && army.troops >= minimumMarch && state.cities[army.location].owner === army.faction
    && isHostile(state, army.faction, army.engagement.owner));
}

export function domainRoads(route) {
  return (route ?? []).slice(1).flatMap((to, index) => {
    const from = route[index];
    const type = roadTerrain(from, to);
    return type ? [{ from, to, label: terrainLabels[type] }] : [];
  });
}

export function validOperation(state, plan, operation) {
  return operation && Object.hasOwn(missions, operation.mission) && Object.hasOwn(stances, operation.stance)
    && (operation.mission !== "relief" || plan.goal === "defend")
    && (operation.mission === "relief" || plan.goal === "advance")
    && (operation.stance !== "blockade" || operation.mission === "diversion")
    && int(operation.troops, minimumMarch, 12000) && int(operation.floor, minimumMarch, operation.troops)
    && (operation.retreat === null || plan.cities.includes(operation.retreat)) && int(operation.started, 0, state.turn)
    && (operation.sync === undefined || typeof operation.sync === "boolean");
}

export function operationPreview(world, state, plan) {
  const operation = plan.operation;
  const army = armyByOfficer(state, plan.army);
  const origin = army?.location ?? state.stations[plan.commander];
  const route = !origin ? null : operation?.mission === "relief"
    ? withdrawalRoute(world, state, { location: origin, faction: state.player }, plan.target)
    : marchRoute(world, state, state.player, origin, plan.target);
  const troops = army?.troops ?? Math.max(0, Math.min(operation?.troops ?? 3000, (state.cities[origin]?.troops ?? 0) - plan.reserve));
  const supply = origin && [plan.depot, plan.backup].filter(Boolean)
    .map((depot) => supplyRoute(world, state, { faction: state.player, location: origin, depot })).find(Boolean);
  const quarters = !route ? null : Math.max(1, route.length - 1) + (army ? Number(!army.prepared) : 2);
  const odds = route && plan.goal === "advance" && forecastAttack(eraByYear(world, state), militaryView(state), {
    from: route.at(-2), to: plan.target, officer: army?.officer ?? plan.commander, troops,
  });
  const rally = world.cities.find(({ key }) => key === plan.target).links.filter((key) => {
    const city = state.cities[key];
    const intel = townIntel(state, state.player, key);
    return city.owner === state.cities[plan.target].owner && intel.troops && intel.troops[1] >= 850;
  });
  return { origin, route, quarters, odds, troops, supply, rally, terrain: domainRoads(route),
    ration: expeditionGrain(troops), funding: Math.min(plan.budget.grain, state.warBudget?.grain ?? 70,
      state.realm?.policy.military ?? Infinity, Math.max(0, state.factions[state.player].grain - (state.delegationReserve?.grain ?? 0))),
    extra: operation?.stance === "siege" ? 2 : operation?.stance === "blockade" ? 1 : 0 };
}

export function validArmyOperation(state, army) {
  if (army.stance === undefined && army.engagement === undefined) return true;
  if (!state.war || !Object.hasOwn(stances, army.stance)) return false;
  const hold = army.engagement;
  if (hold === undefined) return true;
  return army.stance !== "assault" && Object.hasOwn(state.factions, hold.owner) && hold.owner !== army.faction
    && int(hold.quarters, 1, 6) && int(hold.progress, 0, 100) && int(hold.defenders, 0, Number.MAX_SAFE_INTEGER)
    && (army.phase === "march" || army.phase === "hold") && army.route.length === 2;
}

function blockadeRelief(state, army) {
  return (state.armies ?? []).filter((unit) => unit.faction === state.cities[army.target].owner && unit.location === army.target
    && ["hold", "secured", "retreat"].includes(unit.phase)).reduce((total, unit) => total + unit.troops, 0);
}

export function resolveInvestment(world, state, army, fight, reports, spent = 0) {
  const city = state.cities[army.target];
  const first = !army.engagement || army.engagement.owner !== city.owner;
  const defenders = city.troops + blockadeRelief(state, army);
  const investment = army.engagement = first ? { owner: city.owner, quarters: 1, progress: 0, defenders } : army.engagement;
  const note = (event, text, detail = {}) => reports.push(warReport(event, army.faction, army.target, text, {
    officer: army.officer, participants: [army.faction, city.owner], ...detail,
  }));
  const name = cityName(world, army.target);
  if (first) note(army.stance === "blockade" ? "blockaded" : "encircled", "军团抵达" + name + "，" + stances[army.stance] + "道路。", { cost: spent });
  else investment.quarters += 1;

  const reinforcements = defenders - investment.defenders;
  if (!first && ((reinforcements >= 350 && defenders >= army.troops * 1.02) || defenders >= army.troops * 1.55)) {
    const losses = Math.min(army.troops - 1, Math.max(1, Math.floor(army.troops * .18)));
    army.troops -= losses;
    city.troops -= Math.min(city.troops, Math.max(1, Math.floor(losses / 3)));
    army.phase = "hold";
    delete army.engagement;
    note("relieved", name + "守军会合援兵冲破封锁，围城军折损 " + losses + " 人并就地重整。", { cost: spent });
    return;
  }

  if (army.stance === "blockade") {
    if (investment.quarters >= 2) {
      army.phase = "hold";
      delete army.engagement;
      note("diverted", name + "道路已封锁一整季，牵制任务达成。", { cost: spent });
    }
    return;
  }

  const terrain = roadTerrain(army.location, army.target);
  const increment = Math.max(9, Math.min(45, Math.round(29 * army.troops / Math.max(650, defenders + city.defense * 180))
    - (terrain === "pass" ? 6 : terrain === "river" ? 3 : 0) + combinedSiegeSupport(state, army)));
  investment.progress = Math.min(100, investment.progress + increment);
  investment.defenders = defenders;
  if (investment.quarters >= 3 && investment.progress >= 85 && army.troops >= defenders * 1.15) {
    note("surrender", name + "已被围困 " + investment.quarters + " 季，守军请降。", { cost: spent });
    reports.push(fight(army, { surrender: true, breach: investment.progress }));
    delete army.engagement;
    return;
  }
  if (investment.quarters >= 2 && investment.progress >= 55 && (investment.progress < 80 || investment.quarters >= 3)) {
    const era = eraByYear(world, state);
    const odds = forecastAttack(era, state, { from: army.location, to: army.target, officer: army.officer, troops: army.troops }, army.faction);
    if (odds.offense > odds.defense * .78) {
      note("breach", name + "城防动摇，围城军发动攻坚。", { cost: spent });
      reports.push(fight(army, { breach: investment.progress }));
      delete army.engagement;
      return;
    }
  }
  if (investment.quarters >= 4) {
    army.phase = "hold";
    delete army.engagement;
    note("held", name + "围城已达四季，战果未定，请补兵或撤回。", { cost: spent });
    return;
  }
  if (!first) note("pressure", name + "继续围困，城防动摇 " + investment.progress + " / 100。", { cost: spent });
}

export function appendWarReports(state, entries) {
  if (!state.war) return;
  const recent = [];
  for (const entry of entries) {
    if (entry.type !== "war" || !warEvents.has(entry.event)) continue;
    if (entry.faction !== state.player && !entry.participants?.includes(state.player)) continue;
    const { event, faction, city, text, officer, cost } = entry;
    recent.push({ turn: state.turn, event, faction, city, text, ...(officer ? { officer } : {}), ...(cost ? { cost } : {}) });
  }
  state.war.timeline = [...state.war.timeline, ...recent].slice(-120);
}

const routesByEra = {
  184: ["查访乡里", "平定郡道", "安置流民"],
  190: ["勘察关中", "进取关东", "安顿联军后方"],
  199: ["勘察多线", "打通主攻", "收拢新占城"],
  208: ["查明江面", "争夺渡口", "安顿沿江驻地"],
  219: ["勘察荆汉", "争取要城", "维持水陆补给"],
  234: ["勘察渭水", "争夺北线", "保住军粮走廊"],
  262: ["勘察险道", "稳关或远征", "恢复前线供给"],
  265: ["预置接管", "推进州郡", "安定新占城"],
};

export function campaignTasks(world, state) {
  const era = eraByYear(world, state);
  const records = state.war?.timeline ?? [];
  const initial = Object.entries(era.ownership).filter(([, faction]) => faction === state.player).map(([key]) => key);
  const stable = world.cities.filter(({ key }) => !initial.includes(key) && state.cities[key].owner === state.player && !state.cities[key].occupation);
  const territorialRoad = world.cities.filter(({ key, links }) => state.cities[key].owner === state.player
    && links.some((link) => roadTerrain(key, link) === (state.year === 208 ? "river" : "pass")));
  const has = (...events) => records.some(({ event }) => events.includes(event));
  const home = openingCapital(era, state.player);
  const core = state.cities[home]?.owner === state.player && !state.cities[home].occupation;
  const commands = (state.theaters ?? []).some(({ operation }) => operation) || Boolean(state.grand?.campaigns.length);
  const goals = [
    { ready: has("scouted") || (state.year === 265 && Boolean(state.war?.recovery)), detail: "完成一项前线侦察。265 年也可先委任接管。" },
    { ready: state.year === 208 ? (has("diverted", "allied", "captured") && (territorialRoad.length > 0 || stable.length > 0))
      : state.year === 262 ? has("relieved", "secured", "captured") : has("captured", "surrender") || (commands && stable.length > 0),
      detail: state.year === 208 ? "完成牵制、合兵或攻坚，并守住相关据点。" : state.year === 262 ? "完成解围、增援或战役攻城。"
        : "按战役攻下一城，或把一座新城纳入稳定统治。" },
    { ready: core && (stable.length > 0 || has("restored", "road") || (state.turn >= 10 && records.some(({ event }) => event === "secured"))),
      detail: "保住开局治所，安定一座新城、恢复路网或维持战线。" },
  ];
  return goals.map((goal, index) => ({ ...goal, title: routesByEra[state.year][index], done: state.war?.milestones[index] ?? null }));
}

export function settleCampaignTasks(world, state, entries) {
  if (!state.war) return;
  const stage = campaignTasks(world, state)[state.war.milestones.length];
  if (!stage?.ready) return;
  state.war.milestones.push(state.turn);
  entries.push(warReport("milestone", state.player, openingCapital(eraByYear(world, state), state.player)
    ?? Object.keys(state.cities).find((key) => state.cities[key].owner === state.player), "战役路线达成「" + stage.title + "」。"));
}

export function validWarRecords(state, officers) {
  const { timeline, milestones } = state.war;
  return Array.isArray(timeline) && timeline.length <= 120 && timeline.every((entry) => entry && warEvents.has(entry.event)
    && int(entry.turn, state.war.since, state.turn) && Object.hasOwn(state.factions, entry.faction) && Object.hasOwn(state.cities, entry.city)
    && typeof entry.text === "string" && entry.text.length <= 130 && (entry.officer === undefined || officers.has(entry.officer))
    && (entry.cost === undefined || int(entry.cost, 0, 99999)))
    && Array.isArray(milestones) && milestones.length <= 3 && milestones.every((turn, index) =>
      int(turn, index ? milestones[index - 1] + 1 : state.war.since + 1, state.turn));
}
