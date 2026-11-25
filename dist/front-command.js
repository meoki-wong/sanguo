import { armyByOfficer, armyCapacity, marchRoute, mobilizeArmy, redirectArmy, supplyRoute, withdrawalRoute } from "./armies.js";
import { availableAttackers, availableForPosting, cityName, cityReserve, eraByYear, expeditionGrain, gameOutcome, minimumMarch,
  transferGrain, transferRoutesTo } from "./engine.js";
import { officerSkill } from "./campaign.js";
import { isHostile } from "./diplomacy.js";
import { bounded } from "./polities-data.js";
import { realmReserve } from "./realm.js";
import { edgeWeather, travelModes } from "./landscape-terrain.js";
import { warBlockaded } from "./war-operations.js";
import { intelSummary } from "./war-intel.js";

export const frontMissions = { siege: "攻坚围城", relief: "解围增援", crossing: "渡河争夺", field: "野战推进", guard: "固守战线" };
export const frontStatuses = { ready: "待发", active: "执行中", blocked: "待裁决", paused: "已暂停", completed: "已达标" };
const owned = (state, key) => state.cities[key]?.owner === state.player;
const defensive = (mission) => mission === "relief" || mission === "guard";
const transport = (mission) => mission === "crossing" ? "water" : "land";

export function frontTargets(world, state, mission) {
  const mode = transport(mission);
  return world.cities.filter(({ key, links }) => defensive(mission) ? owned(state, key) && (mission !== "relief"
    || warBlockaded(state, key) || links.some((site) => !owned(state, site))) : isHostile(state, state.player, state.cities[key].owner)
    && world.cities.some((site) => owned(state, site.key) && marchRoute(world, state, state.player, site.key, key, mode)));
}

function planShape(state, draft) {
  return draft && bounded(draft.id, 1, 3) && Object.hasOwn(frontMissions, draft.mission) && Object.hasOwn(state.cities, draft.target)
    && bounded(draft.troops, 200, 6000) && bounded(draft.grain, 10, 300) && bounded(draft.floor, 200, draft.troops)
    && typeof draft.auto === "boolean" && (draft.officer === null || typeof draft.officer === "string");
}

export function saveFront(world, state, draft) {
  if (!state.statecraft || gameOutcome(state) !== "ongoing" || !planShape(state, draft)
    || !frontTargets(world, state, draft.mission).some(({ key }) => key === draft.target)) throw new Error("请选择可执行的战区任务并填写调兵、军粮和撤回底线。");
  const next = structuredClone(state);
  const prior = next.statecraft.fronts.find(({ id }) => id === draft.id);
  if (prior?.officer && armyByOfficer(state, prior.officer) && (prior.target !== draft.target || prior.mission !== draft.mission)) {
    throw new Error("请先从军团指令撤回原任务部队。");
  }
  if (next.statecraft.fronts.some(({ id, target, status }) => id !== draft.id && target === draft.target && status !== "completed")) {
    throw new Error("目标已有战区行动。");
  }
  const { id, mission, target, troops, grain, floor, auto } = draft;
  const plan = { id, mission, target, troops, grain, floor, auto, status: "ready", officer: prior?.officer ?? null, report: null };
  next.statecraft.fronts = next.statecraft.fronts.filter((row) => row.id !== id).concat(plan).sort((a, b) => a.id - b.id);
  return next;
}

export function editFront(state, id, kind) {
  const next = structuredClone(state);
  const plan = next.statecraft?.fronts.find((row) => row.id === id);
  if (!plan || gameOutcome(state) !== "ongoing") throw new Error("战区指令已失效。");
  if (kind === "pause") plan.status = "paused";
  else if (kind === "resume") plan.status = "ready";
  else if (kind === "release") {
    if (armyByOfficer(next, plan.officer)) throw new Error("现役军团须先撤回或驻城。");
    next.statecraft.fronts = next.statecraft.fronts.filter((row) => row.id !== id);
  } else throw new Error("未知战区指令。");
  return next;
}

function limitOf(state, plan) {
  return Math.max(0, Math.min(plan.grain, state.factions[state.player].grain - realmReserve(state, state.player).grain));
}

function report(state, plan, status, text, entries) {
  if ((status !== plan.status || text !== plan.report?.text) && ["active", "blocked", "completed"].includes(status)) {
    entries.push({ type: "war", event: status === "completed" ? "secured" : status === "blocked" ? "held" : "ordered",
      faction: state.player, city: plan.target, text });
  }
  plan.status = status;
  plan.report = { turn: state.turn + 1, text };
}

function reinforce(world, state, plan, runOrder) {
  const routes = transferRoutesTo(world, state, plan.target);
  const target = state.cities[plan.target];
  if (target.troops >= plan.troops && !warBlockaded(state, plan.target)) return null;
  for (const route of routes.sort((a, b) => a.length - b.length)) {
    const [from] = route;
    const troops = Math.min(plan.troops, Math.max(400, plan.troops - target.troops), state.cities[from].troops - Math.max(500, plan.floor));
    const order = { type: "transfer", from, to: plan.target, troops, ...(route.length > 2 ? { route } : {}) };
    if (troops < minimumMarch || state.cities[from].occupation || transferGrain(order) > limitOf(state, plan)) continue;
    const entry = runOrder(order);
    if (entry.type === "order") return entry;
  }
  return false;
}

function bestLaunch(world, era, state, plan, busy) {
  const options = [];
  const mode = transport(plan.mission);
  for (const { key } of world.cities) {
    const origin = state.cities[key];
    if (!owned(state, key) || origin.occupation) continue;
    const route = marchRoute(world, state, state.player, key, plan.target, mode);
    if (!route) continue;
    const commander = availableAttackers(era, state, state.player, key).filter(({ key }) => !busy.has(key) || key === plan.officer)
      .sort((a, b) => officerSkill(state, b, "command") - officerSkill(state, a, "command"))[0];
    if (!commander) continue;
    const troops = Math.min(plan.troops, origin.troops - Math.max(cityReserve, plan.floor));
    if (troops < Math.max(minimumMarch, plan.floor) || expeditionGrain(troops) * 2 > limitOf(state, plan)) continue;
    const stance = plan.mission === "siege" ? "siege" : "assault";
    options.push({ route, command: commander.command, order: { type: "mobilize", from: key, to: plan.target,
      troops, officer: commander.key, stance, travel: mode } });
  }
  return options.sort((a, b) => a.route.length - b.route.length || b.order.troops - a.order.troops || b.command - a.command)[0];
}

function staffFront(world, era, state, plan, busy) {
  const eligible = era.officers.filter(({ faction, key }) => faction === state.player && !busy.has(key) && availableForPosting(state, key))
    .sort((a, b) => officerSkill(state, b, "command") - officerSkill(state, a, "command"));
  const sites = world.cities.filter(({ key }) => owned(state, key) && !state.cities[key].occupation
    && state.cities[key].troops >= Math.max(plan.floor, cityReserve) + plan.floor)
    .map(({ key }) => ({ home: key, route: marchRoute(world, state, state.player, key, plan.target, transport(plan.mission)) }))
    .filter(({ route }) => route).sort((a, b) => a.route.length - b.route.length);
  for (const { home } of sites) {
    const officer = eligible.find(({ key }) => state.stations[key] !== home && supplyRoute(world, state, {
      faction: state.player, depot: state.stations[key], location: home,
    }));
    if (!officer) continue;
    state.stations[officer.key] = home;
    plan.officer = officer.key;
    busy.add(officer.key);
    return officer.name + "已调驻" + cityName(world, home) + "，下季准备集结。";
  }
  return null;
}

export function frontPreview(world, state, plan) {
  if (!planShape(state, plan)) return "填写目标和授权额度后可预演。";
  if (defensive(plan.mission)) {
    const shortage = Math.max(0, plan.troops - state.cities[plan.target].troops);
    return "目标驻军 " + state.cities[plan.target].troops + " · 待补 " + shortage + " 人 · 每季军粮 " + plan.grain;
  }
  const era = eraByYear(world, state);
  const active = state.statecraft.fronts.find(({ id, target }) => id === plan.id && target === plan.target);
  const assigned = active?.officer && armyByOfficer(state, active.officer);
  const route = assigned?.route ?? bestLaunch(world, era, state, plan, new Set())?.route;
  if (!route?.length) return "暂无可启动的军团，请核对兵力、主将或粮道。";
  const hazard = edgeWeather(state, route.at(-2) ?? route[0], route.at(-1));
  const distance = Math.max(1, route.length - 1);
  return "约 " + (assigned?.prepared ? distance : distance + 2) + " 季到阵 · " + hazard.label + " · 敌守军 " + intelSummary(state, state.player, plan.target);
}

export function startOpeningFront(world, state, draft) {
  const next = saveFront(world, state, { ...draft, officer: null });
  if (!draft.army) return next;
  const plan = next.statecraft.fronts.find(({ id }) => id === draft.id);
  const launch = !defensive(plan.mission) && bestLaunch(world, eraByYear(world, next), next, plan, new Set());
  if (!launch) throw new Error("这个开局缺少可在首季集结的军团，请核对可用将领、粮草和路线。");
  mobilizeArmy(world, next, next.player, launch.order);
  plan.officer = launch.order.officer;
  armyByOfficer(next, plan.officer).opening = true;
  return next;
}

function meetEnemy(world, era, state, plan, unit, entries) {
  if (plan.mission !== "field" || unit.phase !== "march") return;
  const enemy = state.armies.find((other) => other.troops >= minimumMarch && ["march", "hold"].includes(other.phase) && other.assembledAt < state.turn
    && isHostile(state, unit.faction, other.faction) && (unit.route[1] === other.location
      || unit.route[1] && unit.route[1] === other.route[1]));
  if (!enemy) return;
  const power = (army) => Math.round(army.troops * (1 + officerSkill(state, era.officers.find(({ key }) => key === army.officer), "command") / 140)
    * (army.grain ? 1 : .73));
  const first = power(unit);
  const second = power(enemy);
  const friendlyLoss = Math.min(unit.troops - 1, Math.round(unit.troops * (first > second ? .14 : .33)));
  const enemyLoss = Math.min(enemy.troops - 1, Math.round(enemy.troops * (second >= first ? .14 : .33)));
  unit.troops -= friendlyLoss;
  enemy.troops -= enemyLoss;
  const defeated = first > second ? enemy : unit;
  const retreat = [defeated.depot, defeated.location].find((key) => key
    && state.cities[key].owner === defeated.faction && withdrawalRoute(world, state, defeated, key));
  redirectArmy(world, state, defeated, retreat ? { type: "retreat", target: retreat } : { type: "hold" });
  entries.push({ type: "war", event: "field-clash", faction: unit.faction, participants: [unit.faction, enemy.faction], officer: unit.officer,
    city: plan.target, text: cityName(world, plan.target) + "外围发生野战，双方战力 " + first + " / " + second
      + "，折损 " + friendlyLoss + " / " + enemyLoss + " 人。" });
}

export function settleFrontCommands(world, era, state, runOrder, logistics, entries, available) {
  if (!state.statecraft) return;
  const plans = state.statecraft.fronts;
  const busy = new Set([...plans.map(({ officer }) => officer), ...(state.theaters ?? []).flatMap(({ commander, army }) => [commander, army]),
    ...state.grand.campaigns.flatMap(({ wings }) => Object.values(wings).map(({ officer }) => officer))]);
  for (const plan of plans) {
    let army = armyByOfficer(state, plan.officer);
    if (army && army.faction !== state.player) army = null;
    if (plan.status === "paused") {
      if (army && army.phase !== "retreat" && army.phase !== "hold") redirectArmy(world, state, army, { type: "hold" });
      continue;
    }
    if (plan.status === "completed") continue;
    if (defensive(plan.mission)) {
      if (!owned(state, plan.target)) { report(state, plan, "blocked", "目标已失守，请调整战区目标。", entries); continue; }
      if (!plan.auto || available < 1) continue;
      const aid = reinforce(world, state, plan, runOrder);
      if (aid) { entries.push(aid); available--; }
      report(state, plan, aid === null && plan.mission === "relief" ? "completed" : aid === false ? "blocked" : "active",
        aid ? cityName(world, plan.target) + "已接到增援。" : aid === null ? "守军已达到授权兵力。" : "预备队或可达军路不足。", entries);
      continue;
    }
    if (owned(state, plan.target)) { report(state, plan, "completed", cityName(world, plan.target) + "已纳入本方战线。", entries); continue; }
    if (army?.phase === "retreat") continue;
    if (army && (army.troops < plan.floor || !isHostile(state, state.player, state.cities[plan.target].owner))) {
      const fallback = [army.depot, army.location].find((key) => withdrawalRoute(world, state, army, key));
      redirectArmy(world, state, army, fallback ? { type: "retreat", target: fallback } : { type: "hold" });
      plan.auto = false;
      report(state, plan, "blocked", "触及授权底线或接到停战令，已请求撤离。", entries);
      continue;
    }
    if (!plan.auto) continue;
    if (!army && available > 0 && (state.armies ?? []).filter(({ faction }) => faction === state.player).length < armyCapacity(state)) {
      const launch = bestLaunch(world, era, state, plan, busy);
      if (launch) {
        const entry = runOrder(launch.order);
        army = armyByOfficer(state, launch.order.officer);
        if (army) {
          plan.officer = army.officer;
          busy.add(army.officer);
          entries.push(entry);
          available--;
        }
      }
      if (!army && !launch) {
        const posting = staffFront(world, era, state, plan, busy);
        if (posting) {
          report(state, plan, "active", posting, entries);
          available--;
          continue;
        }
      }
    }
    if (!army) { report(state, plan, "blocked", "缺少可用的军团、主将或军粮，等待授权条件满足。", entries); continue; }
    const depots = [army.depot, army.location, ...world.cities.filter(({ key }) => owned(state, key) && state.grand.depots[key]).map(({ key }) => key)];
    const depot = depots.find((key) => supplyRoute(world, state, army, key));
    if (!depot || !marchRoute(world, state, state.player, army.location, plan.target, army.travel ?? "land")) {
      if (army.phase !== "hold") redirectArmy(world, state, army, { type: "hold" });
      report(state, plan, "blocked", "粮道或进军路线受阻，军团固守待令。", entries);
      continue;
    }
    if (army.phase === "hold") redirectArmy(world, state, army, { type: "march", target: plan.target, depot, travel: army.travel });
    if (army.depot !== depot) redirectArmy(world, state, army, { type: "supply", depot });
    let remaining = Math.max(0, limitOf(state, plan) - (army.assembledAt === state.turn ? army.grain : 0));
    logistics.set(army.officer, { limit: () => remaining, charge: (grain) => { remaining -= grain; } });
    const hazard = edgeWeather(state, army.location, army.route[1] ?? plan.target);
    report(state, plan, "active", travelModes[army.travel ?? "land"] + " · " + hazard.label + " · 由" + cityName(world, depot) + "供粮。", entries);
    if (!state.frontline) meetEnemy(world, era, state, plan, army, entries);
  }
}

export function validFronts(state, data, officers) {
  return Array.isArray(data.fronts) && data.fronts.length <= 3 && new Set(data.fronts.map((plan) => plan?.id)).size === data.fronts.length
    && data.fronts.every((plan) => planShape(state, plan) && Object.hasOwn(frontStatuses, plan.status)
      && (plan.officer === null || officers.has(plan.officer)) && (plan.report === null || plan.report
        && bounded(plan.report.turn, data.since, state.turn) && typeof plan.report.text === "string" && plan.report.text.length <= 160));
}
