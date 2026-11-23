import { armyByOfficer, marchRoute, redirectArmy, shippingCost, supplyRoute, withdrawalRoute } from "./armies.js";
import { availableAttackers, availableForPosting, cityReserve, eraByYear, expeditionGrain, forecastAttack,
  gameOutcome, minimumMarch, recruitment, seasonOrderLimit, transferGrain, transferRoutesTo, validateOrder } from "./engine.js";
import { isHostile } from "./diplomacy.js";
import { officerSkill } from "./campaign.js";
import { markRealmService, nationalDuty, realmPolicy } from "./realm.js";
import { militaryView } from "./war-intel.js";
import { validOperation, warBlockaded, warReport } from "./war-operations.js";
import { alliedPlan, allyWindow } from "./accords.js";

export const theaterGoals = { advance: "攻取", defend: "固守", recover: "接管" };
export const theaterLimit = 3;
export const defaultWarBudget = { treasury: 60, grain: 70 };
const has = (state, city, faction = state.player) => state.cities[city]?.owner === faction;
const validLimit = (value, max = 9999) => Number.isInteger(value) && value >= 0 && value <= max;
const validBudget = (value) => value && validLimit(value.treasury) && validLimit(value.grain);

export function saveWarBudget(state, budget) {
  if (gameOutcome(state) !== "ongoing" || !validBudget(budget)) throw new Error("请填写有效的全国军费上限。");
  return { ...state, warBudget: { treasury: budget.treasury, grain: budget.grain } };
}

function theaterShape(state, plan, officers) {
  if (!plan || !Number.isInteger(plan.id) || plan.id < 1 || plan.id > theaterLimit
    || typeof plan.name !== "string" || !plan.name.trim() || plan.name.length > 12 || !Object.hasOwn(theaterGoals, plan.goal)
    || !Object.hasOwn(state.cities, plan.target) || !Array.isArray(plan.cities) || plan.cities.length < 1 || plan.cities.length > 5
    || new Set(plan.cities).size !== plan.cities.length || !plan.cities.every((key) => Object.hasOwn(state.cities, key))
    || !plan.cities.includes(plan.depot) || (plan.seat !== undefined && !plan.cities.includes(plan.seat))
    || (plan.backup != null && (plan.backup === plan.depot || !plan.cities.includes(plan.backup)))
    || officers.get(plan.commander)?.faction !== state.player
    || (plan.army !== null && officers.get(plan.army)?.faction !== state.player) || typeof plan.paused !== "boolean"
    || !validLimit(plan.reserve, 5000) || plan.reserve < cityReserve || !validBudget(plan.budget)
    || !Number.isInteger(plan.priority) || plan.priority < 1 || plan.priority > theaterLimit
    || (plan.operation !== undefined && (!state.war || !validOperation(state, plan, plan.operation)))) return false;
  if (!plan.report) return plan.report === undefined;
  const { status, turn, text, treasury, grain } = plan.report;
  return ["waiting", "executed", "blocked", "complete"].includes(status) && Number.isInteger(turn) && turn >= 1 && turn <= state.turn
    && typeof text === "string" && text.length <= 100 && validLimit(treasury) && validLimit(grain);
}

function conflict(theaters, candidate) {
  return theaters.some((plan) => plan.id !== candidate.id && (plan.commander === candidate.commander
    || (candidate.army && plan.army === candidate.army) || plan.army === candidate.commander || candidate.army === plan.commander
    || plan.cities.some((key) => candidate.cities.includes(key))));
}

export function saveTheater(world, state, draft) {
  if (gameOutcome(state) !== "ongoing") throw new Error("战局已结束。");
  const era = eraByYear(world, state);
  const officers = new Map(era.officers.map((officer) => [officer.key, officer]));
  const plan = structuredClone({ seat: draft.depot, ...draft, name: draft.name?.trim(), paused: false });
  delete plan.report;
  if (!theaterShape(state, plan, officers) || !plan.cities.every((city) => has(state, city))) throw new Error("战区辖城须归本势力所有，治所和粮仓须设在战区内。");
  if (conflict(state.theaters ?? [], plan)) throw new Error("同一城、主将或军团只能分配给一个战区。");
  if (nationalDuty(state, plan.commander)) throw new Error("战区主将须先卸下国级职务。");
  if (!commanderOnDuty(state, plan, state.player)) throw new Error("主将须驻在战区内，或正率领所分配的军团。");
  if (plan.army && !armyByOfficer(state, plan.army)) throw new Error("所选军团已解散。");
  if (plan.goal !== "advance" && !plan.cities.includes(plan.target)) throw new Error("固守或接管目标须是战区辖城。");
  if (plan.operation && (state.theaters ?? []).some(({ id, operation, paused }) => id !== plan.id && !paused
    && operation?.mission === "main" && plan.operation.mission === "main")) throw new Error("已有主攻战役，请将本线设为牵制或暂停原主攻。");
  const next = (state.theaters ?? []).filter(({ id }) => id !== plan.id).concat(plan).sort((a, b) => a.id - b.id);
  return { ...state, theaters: next };
}

export function changeTheater(state, id, action) {
  if (gameOutcome(state) !== "ongoing" || !state.theaters?.some((plan) => plan.id === id)) throw new Error("这个战区不可用。");
  if (action === "resume" && state.theaters.find((plan) => plan.id === id).operation?.mission === "main"
    && state.theaters.some((plan) => plan.id !== id && !plan.paused && plan.operation?.mission === "main")) {
    throw new Error("已有主攻战役，请先暂停那条战线。");
  }
  const theaters = action === "remove" ? state.theaters.filter((plan) => plan.id !== id)
    : state.theaters.map((plan) => plan.id !== id ? plan : { ...plan, paused: action === "pause" });
  const next = { ...state, theaters };
  if (!theaters.length) delete next.theaters;
  return next;
}

function commanderOnDuty(state, plan, faction) {
  const army = armyByOfficer(state, plan.commander);
  if (army) return army.faction === faction && plan.army === army.officer;
  const station = state.stations[plan.commander];
  return plan.cities.includes(station) && has(state, station, faction);
}

export function theaterSupply(world, state, plan, location = armyByOfficer(state, plan.army)?.location ?? state.stations[plan.commander]) {
  for (const depot of [plan.depot, plan.backup].filter(Boolean)) {
    const army = { faction: state.player, location, depot };
    const route = supplyRoute(world, state, army);
    if (route) return { depot, route, freight: shippingCost(world, state, army, route) };
  }
  return null;
}

function reinforce(world, state, plan, faction) {
  const { target, reserve } = plan;
  const relief = plan.operation?.mission === "relief" && warBlockaded(state, target);
  const shortage = (relief ? Math.max(reserve, Math.min(3500, state.cities[target].troops + 720)) : reserve) - state.cities[target].troops;
  if (shortage <= 0) return null;
  const routes = transferRoutesTo(world, { ...state, player: faction }, target);
  const donations = routes.filter((route) => plan.cities.includes(route[0]) && !state.cities[route[0]].occupation)
    .map((route) => {
      const from = route[0];
      const troops = Math.min(state.cities[from].troops - reserve, Math.max(minimumMarch, shortage));
      return { type: "transfer", from, to: target, troops, ...(route.length > 2 ? { route } : {}) };
    }).filter(({ troops }) => troops >= minimumMarch)
    .sort((a, b) => b.troops - a.troops || transferGrain(a) - transferGrain(b));
  return donations[0] ?? { type: "recruit", city: target };
}

function operationalOrder(world, era, state, plan, faction) {
  if (plan.goal !== "advance") {
    if (!has(state, plan.target, faction)) return { block: "目标城已失守，请重新指定任务。" };
    const army = plan.army && armyByOfficer(state, plan.army);
    if (army && army.location !== plan.target) {
      return withdrawalRoute(world, state, army, plan.target) ? { relocate: army }
        : { block: "军团至目标城的增援道路中断。" };
    }
    const city = state.cities[plan.target];
    if (plan.goal === "recover" && !city.occupation) return { complete: "目标城已完成整顿。" };
    if (plan.goal === "recover" && !city.governor && city.troops >= cityReserve) {
      const candidates = era.officers.filter((person) => person.faction === faction && availableForPosting(state, person.key)
        && plan.cities.includes(state.stations[person.key]) && person.key !== plan.commander)
        .sort((a, b) => officerSkill(state, b, "governance") - officerSkill(state, a, "governance"));
      if (candidates.length) return { order: { type: "appoint-governor", city: plan.target, officer: candidates[0].key } };
      return { block: "整顿城太守空缺，请指定可用官员。" };
    }
    const order = reinforce(world, state, plan, faction);
    return order ? { order } : { waiting: "驻军已达留守线，继续驻防。" };
  }

  if (has(state, plan.target, faction)) return { complete: "目标已攻占，可改派战区接管。" };
  if (!isHostile(state, faction, state.cities[plan.target].owner)) return { block: "目标受协定保护，请重新指挥。" };
  const army = plan.army && armyByOfficer(state, plan.army);
  if (plan.army && !army) return { block: "所辖军团已解散，请重新分派。" };
  if (plan.operation?.sync && !army?.engagement) {
    const pact = alliedPlan(state, faction, plan.target);
    if (!pact) return { block: "找不到有效的合兵协议，请重新议定或取消等待盟军。" };
    const partner = pact.from === faction ? pact.to : pact.from;
    if (state.turn + 1 < allyWindow(pact).first || !pact.joined.includes(partner)) return { waiting: "等候合兵窗口及盟军实际到位。" };
  }
  const origin = army ? army.location : state.stations[plan.commander];
  const route = marchRoute(world, state, faction, origin, plan.target);
  const supply = theaterSupply(world, state, plan, origin);
  if (!route || !supply) return { block: "行军道路或供粮线中断，请改道或撤军。" };
  if (army?.phase === "retreat") return { waiting: "军团正在执行撤军令。" };
  const troops = army?.troops ?? Math.min(plan.operation?.troops ?? 3000, state.cities[origin].troops - plan.reserve);
  if (troops < minimumMarch) return { block: "留守之后兵力不足，请增援。" };
  const stance = plan.operation?.stance;
  const order = { type: "mobilize", from: origin, to: plan.target, officer: plan.commander, troops, ...(stance ? { stance } : {}) };
  const odds = forecastAttack(era, militaryView(state, faction), { ...order, from: route.at(-2), officer: army?.officer ?? plan.commander }, faction);
  if (!army?.engagement && odds.offense < odds.defense * (stance === "blockade" ? .62 : stance === "siege" ? .78 : 1.1)) {
    return { block: "按当前情报，预估战力不足，请确认增援、侦察或改换目标。" };
  }
  if (army) return { march: army, depot: supply.depot, freight: supply.freight };
  if (!availableAttackers(era, state, faction, origin).some(({ key }) => key === plan.commander)) return { block: "主将目前无法领兵。" };
  return { order, depot: supply.depot };
}

function costOf(order) {
  if (order.type === "mobilize") return { treasury: 0, grain: 2 * expeditionGrain(order.troops) };
  if (order.type === "transfer") return { treasury: 0, grain: transferGrain(order) };
  if (order.type === "recruit") return { treasury: recruitment.treasury, grain: recruitment.grain };
  return { treasury: 0, grain: 0 };
}

export function directTheaters(world, era, state, manualOrders, runOrder, forecast = false) {
  const reports = [];
  const national = { ...(state.warBudget ?? defaultWarBudget) };
  const policy = realmPolicy(state, state.player);
  if (policy) {
    national.treasury = Math.min(national.treasury, policy.military);
    national.grain = Math.min(national.grain, policy.military);
  }
  const logistics = new Map();
  let reservedFromStock = 0;
  let slots = seasonOrderLimit - manualOrders;
  const plans = [...(state.theaters ?? [])].sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const plan of plans) {
    const report = (status, text, cost = { treasury: 0, grain: 0 }) => {
      const changed = plan.report?.status !== status || plan.report?.text !== text;
      plan.report = { status, text, turn: state.turn + 1, treasury: cost.treasury, grain: cost.grain };
      if (changed || status === "executed") reports.push({ type: "theater", faction: state.player, city: plan.target,
        text: plan.name + " · " + text, theater: plan.id, ...(status === "blocked" ? { reason: "theater-blocked" } : {}) });
    };
    const block = (text) => { plan.paused = true; report("blocked", text); };
    const guarded = state.factions[state.player];
    const budget = { treasury: plan.budget.treasury, grain: plan.budget.grain };
    const debit = (cost) => {
      for (const resource of ["treasury", "grain"]) {
        national[resource] -= cost[resource];
        budget[resource] -= cost[resource];
      }
    };
    const attached = plan.army && armyByOfficer(state, plan.army);
    const operation = plan.operation;
    const log = (event, text, cost = 0) => reports.push(warReport(event, state.player, plan.target, text,
      { officer: attached?.officer ?? plan.commander, cost, theater: plan.id }));
    const availableGrain = () => guarded.grain - (state.delegationReserve?.grain ?? 0) - reservedFromStock;
    let plannedShipment = 0;
    const supply = attached && theaterSupply(world, state, plan);
    if (attached && supply) {
      if (!plan.paused && attached.depot !== supply.depot) {
        const recovered = supply.depot === plan.depot;
        attached.depot = supply.depot;
        reports.push({ type: "theater", faction: state.player, city: supply.depot, theater: plan.id,
          text: plan.name + (recovered ? "已恢复原粮道。" : "启用备用粮仓，每批运粮额外消耗 " + supply.freight + " 粮。") });
        if (!forecast) markRealmService(state, "marshal", recovered ? "恢复本线粮道" : "启用备用粮仓");
        if (operation) log("resupplied", recovered ? "军团恢复原粮道。" : "军团切换备用粮仓。");
      }
      const need = Math.max(0, expeditionGrain(attached.troops) * 2 - attached.grain);
      plannedShipment = Math.max(0, Math.min(national.grain, budget.grain, availableGrain(), need ? need + supply.freight : 0));
      debit({ treasury: 0, grain: plannedShipment });
      reservedFromStock += plannedShipment;
    }
    if (attached) logistics.set(attached.officer, { limit: () => plannedShipment, charge: (grain) => { plan.report.grain += grain; } });
    if (operation && attached && !plan.paused && (attached.troops < operation.floor || (!supply && operation.retreat))) {
      const retreat = operation.retreat;
      if (retreat && withdrawalRoute(world, state, attached, retreat)) {
        redirectArmy(world, state, attached, { type: "retreat", target: retreat });
        block("触发预案，军团正在撤回。");
        log("retreat", "兵力跌破底线或粮道中断，按预案撤军。");
      } else {
        redirectArmy(world, state, attached, { type: "hold" });
        block("触发撤退条件，预设退路不可用，请接管军团。");
        log("withdraw-blocked", "兵力低于撤退底线，等待安全退路。");
      }
      continue;
    }
    if (plan.paused) {
      if (attached && ["march", "muster"].includes(attached.phase)) redirectArmy(world, state, attached, { type: "hold" });
      report(plan.report?.status === "blocked" ? "blocked" : "waiting", plan.report?.status === "blocked" ? plan.report.text : "已暂停，等待指挥。");
      continue;
    }
    const interruption = !has(state, plan.depot) && !has(state, plan.backup) ? "粮仓失守，请重新部署。"
      : !has(state, plan.seat ?? plan.depot) ? "战区治所失守，请重新部署。"
      : !commanderOnDuty(state, plan, state.player) ? "主将离开战区，请重新部署。" : "";
    if (interruption) {
      if (attached && ["march", "muster"].includes(attached.phase)) redirectArmy(world, state, attached, { type: "hold" });
      block(interruption);
      continue;
    }
    if (attached && plan.goal !== "advance" && attached.location === plan.target) redirectArmy(world, state, attached, { type: "hold" });
    const action = operationalOrder(world, era, state, plan, state.player);
    if (action.block) {
      if (attached && ["march", "muster"].includes(attached.phase)) redirectArmy(world, state, attached, { type: "hold" });
      block(action.block);
    } else if (action.complete) {
      if (attached && ["march", "muster"].includes(attached.phase)) redirectArmy(world, state, attached, { type: "hold" });
      report("complete", action.complete);
    } else if (action.relocate) {
      redirectArmy(world, state, action.relocate, { type: "retreat", target: plan.target });
      report("executed", "军团转往目标城驻防。");
    } else if (action.march) {
      const ration = expeditionGrain(action.march.troops);
      if (action.march.grain + Math.max(0, plannedShipment - action.freight) < ration) {
        if (["march", "muster"].includes(action.march.phase)) redirectArmy(world, state, action.march, { type: "hold" });
        block("军费或预留后粮食不足，军团已固守。");
      } else {
        redirectArmy(world, state, action.march, { type: "march", depot: action.depot, target: plan.target,
          ...(operation ? { stance: operation.stance } : {}) });
        report("executed", action.march.engagement ? "军团继续围城或封锁。" : "军团按战区目标推进。");
      }
    } else if (!action.order || slots <= 0) {
      report("waiting", action.waiting ?? "本季政令已用完，留待下季。");
    } else {
      const cost = costOf(action.order);
      const affordable = ["treasury", "grain"].every((resource) => cost[resource] === 0 || cost[resource] <= Math.min(
        budget[resource], national[resource], resource === "grain" ? availableGrain() : guarded.treasury - (state.delegationReserve?.treasury ?? 0)));
      if (!affordable) {
        block("战区或全国军费不足，请调整预算。");
        continue;
      }
      const receipt = runOrder(action.order);
      reports.push(receipt);
      if (receipt.type === "notice") {
        block("拟令未能执行，请查看本季奏报。");
        continue;
      }
      slots -= 1;
      debit(cost);
      if (action.order.type === "mobilize") {
        plan.army = action.order.officer;
        armyByOfficer(state, plan.army).depot = action.depot;
        if (operation) log("ordered", "战区已组建军团，预拨两季行粮。", cost.grain);
      }
      if (operation?.mission === "relief" && action.order.type === "transfer") log("secured", "援兵已抵达目标城。", cost.grain);
      report("executed", "已下达" + ({ recruit: "征兵", transfer: "增援", mobilize: "集结", "appoint-governor": "补任太守" })[action.order.type] + "令。", cost);
    }
  }
  return { reports, logistics, slots };
}

export function opponentFrontOrder(world, era, state, faction, goal) {
  if (state.turn < 12 || !goal.city || !has(state, goal.city, faction) || goal.type !== "defend") return null;
  const cities = [goal.city, ...world.cities.find(({ key }) => key === goal.city).links.filter((key) => has(state, key, faction))];
  const plan = { cities, target: goal.city, goal: "defend", reserve: Math.min(2600, goal.threshold) };
  const { order } = operationalOrder(world, era, state, plan, faction);
  if (!order) return null;
  const cost = costOf(order);
  if (state.factions[faction].grain < cost.grain + 12 || state.factions[faction].treasury < cost.treasury) return null;
  try { validateOrder(world, state, faction, order); return order; } catch { return null; }
}

export function validTheaters(state, officers) {
  if (state.warBudget !== undefined && !validBudget(state.warBudget)) return false;
  if (state.theaters === undefined) return true;
  const plans = state.theaters;
  return Array.isArray(plans) && plans.length <= theaterLimit && new Set(plans.map((plan) => plan?.id)).size === plans.length
    && plans.every((plan) => theaterShape(state, plan, officers)) && plans.every((plan) => !conflict(plans, plan));
}
