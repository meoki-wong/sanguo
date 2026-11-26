import {
  availableAttackers, availableForPosting, cityIncome, cityName, cityReserve, describeOrder, expeditionGrain, firstCity,
  forceTotals, forecastAttack, minimumMarch, needsRecoveryGovernor, opponentDelegationQuote, previewOrders, projects, recruitment, suggestDeployment, validateOrder,
} from "./engine.js";
import { isHostile } from "./diplomacy.js";
import { armyCapacity, marchRoute, mobilizationQuote, supplyRoute } from "./armies.js";
import { opponentFrontOrder } from "./theaters.js";
import { militaryView } from "./war-intel.js";
import { alliedDuty, pactTarget } from "./accords.js";
import { weatherAllows } from "./landscape-terrain.js";
import { congressDuty, congressTarget } from "./landscape-treaty.js";
import { officerMeta } from "./traits.js";
import { BATTLE_TACTICS, isOpeningPrepTurn } from "./tactics.js";
import { factionPersonality, rivalFriction } from "./stratagems.js";
import { isCoalitionMember } from "./coalition.js";

function goalDuration(goal) {
  return goal.since < 4 ? 3 : goal.type === "defend" ? 5 : 4;
}
const statuses = ["active", "achieved", "lost", "expired"];
const number = new Intl.NumberFormat("zh-CN");
const strengthAt = (city) => city.troops + city.defense * 180;

function recoveredIncome(city) {
  const current = cityIncome(city);
  const full = cityIncome({ ...city, occupation: 0 });
  return { treasury: full.treasury - current.treasury, grain: full.grain - current.grain };
}

export function assessGoal(state, faction, goal, adaptive = true) {
  const city = state.cities[goal.city];
  let progress = 0;
  let lost = !Object.values(state.cities).some(({ owner }) => owner === faction);
  if (goal.type === "economy") {
    progress = state.factions[faction].grain;
  } else if (goal.type === "defend") {
    lost = city.owner !== faction || !isHostile(state, faction, state.cities[goal.target].owner);
    progress = lost ? 0 : strengthAt(city);
  } else {
    progress = Number(state.cities[goal.target].owner === faction);
    lost = !progress && (city.owner !== faction || !isHostile(state, faction, state.cities[goal.target].owner));
  }
  const age = state.turn - goal.since;
  const status = lost ? "lost" : progress >= goal.threshold ? "achieved" : age >= (adaptive ? goalDuration(goal) : 3) ? "expired" : "active";
  return { goal, progress, status };
}

function attackFrom(era, state, faction, from, to, { quick = false } = {}) {
  if (isOpeningPrepTurn(state) || !weatherAllows(state, from, to)) return null;
  const troops = Math.min(state.cities[from].troops - cityReserve, state.factions[faction].grain * 100);
  if (troops < minimumMarch) return null;
  const pool = availableAttackers(era, state, faction, from);
  if (!pool.length) {
    return state.observer && state.observer !== faction ? { type: "attack", from, to, troops, officer: null } : null;
  }
  const topCmd = [...pool].sort((a, b) => b.command - a.command)[0];
  if (!state.century || quick) {
    return { type: "attack", from, to, troops, officer: topCmd.key };
  }
  const topInt = [...pool].sort((a, b) => (officerMeta(b).intellect ?? 50) - (officerMeta(a).intellect ?? 50))[0];
  const treasury = state.factions[faction]?.treasury ?? 0;
  const grain = state.factions[faction]?.grain ?? 0;
  const baseGrain = Math.ceil(troops / 100);
  const targetCity = state.cities[to];
  const defender = era.officers.find(({ key }) => key === (targetCity.commander ?? targetCity.governor));
  const defInt = defender ? (officerMeta(defender).intellect ?? 50) : 50;

  const candidates = [{ tactic: "assault", officer: topCmd.key }];
  if (treasury >= BATTLE_TACTICS.siege.treasury && grain >= baseGrain + BATTLE_TACTICS.siege.grain
    && (targetCity.walls > 0 || state.landscape)) {
    candidates.push({ tactic: "siege", officer: topCmd.key });
  }
  if (treasury >= BATTLE_TACTICS.stratagem.treasury && grain >= baseGrain
    && (officerMeta(topInt).intellect ?? 50) > defInt) {
    candidates.push({ tactic: "stratagem", officer: topInt.key });
  }
  if (treasury >= BATTLE_TACTICS.rally.treasury && grain >= baseGrain
    && (targetCity.occupation > 0 || (state.realm?.cities?.[to]?.welfare ?? 60) < 58 || (targetCity.morale ?? 75) < 68)) {
    candidates.push({ tactic: "rally", officer: topCmd.key });
  }

  let bestOrder = { type: "attack", from, to, troops, officer: topCmd.key };
  let bestRatio = -1;
  const personality = faction !== state.player ? factionPersonality(faction) : null;
  for (const { tactic, officer } of candidates) {
    const tCost = BATTLE_TACTICS[tactic];
    const cand = tactic === "assault"
      ? { type: "attack", from, to, troops, officer }
      : { type: "attack", from, to, troops, officer, tactic };
    const fc = forecastAttack(era, state, cand, faction);
    const prefBonus = personality?.preferredTactics?.includes(tactic) ? 0.08 : 0;
    const ratio = fc.offense / Math.max(1, fc.defense) + (fc.wins ? 0.25 : 0) + prefBonus - (tCost.treasury * 0.004);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestOrder = cand;
    }
  }
  return bestOrder;
}

function threatenedCity(era, state, faction, owned, seat) {
  const threats = owned.flatMap(({ key, links }) => links.flatMap((target) => {
    const enemy = state.cities[target].owner;
    if (!isHostile(state, faction, enemy)) return [];
    const order = attackFrom(era, state, enemy, target, key, { quick: true });
    if (!order) return [];
    const { offense, defense } = forecastAttack(era, state, order, enemy);
    const margin = offense - defense;
    if (margin < (key === seat ? 280 : 500)) return [];
    const threshold = Math.min(3600, Math.max(1100, strengthAt(state.cities[key]) + Math.ceil(margin / 2)));
    if (threshold <= strengthAt(state.cities[key])) return [];
    return [{ city: key, target, threshold, urgency: margin + (key === seat ? 450 : 0) }];
  }));
  for (const army of state.armies ?? []) {
    const site = state.cities[army.target];
    const approach = army.route.at(-2);
    if (site.owner !== faction || !approach || !isHostile(state, faction, state.cities[approach].owner) || !isHostile(state, faction, army.faction)
      || !["march", "muster"].includes(army.phase)) continue;
    const { offense, defense } = forecastAttack(era, state, { to: army.target, officer: army.officer, troops: army.troops }, army.faction);
    const margin = offense - defense;
    const threshold = Math.min(3600, Math.max(1100, strengthAt(site) + Math.ceil(margin / 2)));
    if (margin >= 240 && threshold > strengthAt(site)) threats.push({ city: army.target, target: approach,
      threshold, urgency: margin + (army.target === seat ? 450 : 0) });
  }
  const mostUrgent = threats.sort((a, b) => b.urgency - a.urgency)[0];
  if (!mostUrgent) return null;
  const { city, target, threshold } = mostUrgent;
  return { type: "defend", since: state.turn, city, target, threshold };
}

function campaignAssembly(world, era, state, faction, owned, goal) {
  const field = (state.armies ?? []).filter((army) => army.faction === faction);
  if (state.turn < 4 || field.length >= armyCapacity(state) || field.some((army) => army.target === goal.target)) return null;
  const reserve = state.factions[faction].grain - 24;
  if (reserve < 28) return null;
  const options = owned.flatMap(({ key: from }) => {
    const route = marchRoute(world, state, faction, from, goal.target);
    if (!route || route.length < 3 || route.at(-2) !== goal.city || state.cities[from].occupation) return [];
    const troops = Math.min(3200, state.cities[from].troops - 1050, Math.floor(reserve / 2) * 100);
    if (troops < 1400) return [];
    const officer = availableAttackers(era, state, faction, from).sort((a, b) => b.command - a.command)[0];
    if (!officer) return [];
    const order = { type: "mobilize", from, to: goal.target, officer: officer.key, troops,
      ...(state.war ? { stance: "siege" } : {}) };
    const { offense, defense } = forecastAttack(era, state, order, faction);
    return offense >= defense * 1.35 ? [{ order, score: (offense - defense) / route.length }] : [];
  });
  return options.sort((a, b) => b.score - a.score)[0]?.order ?? null;
}

function navalAssembly(world, era, state, faction, goal) {
  if (!state.landscape || state.armies?.some((army) => army.faction === faction && army.target === goal.target)
    || !marchRoute(world, state, faction, goal.city, goal.target, "water")) return null;
  const from = goal.city;
  const troops = Math.min(2600, state.cities[from].troops - 700, (state.factions[faction].grain - 20) * 50);
  const officer = availableAttackers(era, state, faction, from).sort((a, b) => b.command - a.command)[0];
  if (!officer || troops < 850) return null;
  const order = { type: "mobilize", from, to: goal.target, officer: officer.key, troops, stance: "assault", travel: "water" };
  const forecast = forecastAttack(era, state, order, faction, { travel: order.travel });
  if (!forecast.wins) return null;
  try { validateOrder(world, state, faction, order); return order; } catch { return null; }
}

function pactAssembly(world, era, state, faction, goal) {
  const { city, target } = goal;
  const water = state.landscape && marchRoute(world, state, faction, city, target, "water");
  const base = attackFrom(era, state, faction, city, target) ?? (water && {
    type: "attack", from: city, to: target, troops: Math.min(state.cities[city].troops - cityReserve, state.factions[faction].grain * 50),
    officer: availableAttackers(era, state, faction, city).sort((a, b) => b.command - a.command)[0]?.key, travel: "water",
  });
  if (!base || state.cities[city].occupation || state.armies?.some((army) => army.faction === faction && army.target === target)) return null;
  const troops = Math.min(2000, base.troops - 500);
  if (troops < 850 || state.factions[faction].grain < 24 + 2 * expeditionGrain(troops)) return null;
  const duty = alliedDuty(state, faction, target);
  const order = { ...base, type: "mobilize", troops, ...(state.war ? {
    stance: duty === "diversion" || congressDuty(state, faction, target) === "screen" ? "blockade" : duty === "relief" ? "assault" : "siege",
  } : {}) };
  const { offense, defense } = forecastAttack(era, state, order, faction);
  if (offense < defense * .6) return null;
  try { validateOrder(world, state, faction, order); return order; } catch { return null; }
}

function supplyStrike(world, era, state, faction, owned) {
  const targets = new Set((state.armies ?? []).filter((army) => state.cities[army.target].owner === faction
    && isHostile(state, faction, army.faction) && army.phase !== "retreat")
    .flatMap((army) => supplyRoute(world, state, army)?.slice(0, -1) ?? []));
  const attacks = owned.flatMap(({ key: city, links }) => links.flatMap((target) => {
    if (!targets.has(target) || !isHostile(state, faction, state.cities[target].owner)) return [];
    const order = attackFrom(era, state, faction, city, target);
    if (!order) return [];
    const battle = forecastAttack(era, state, order, faction);
    return battle.wins ? [{ city, target, margin: battle.offense - battle.defense }] : [];
  }));
  const best = attacks.sort((a, b) => b.margin - a.margin)[0];
  return best ? { type: "expand", city: best.city, target: best.target, threshold: 1, since: state.turn } : null;
}

function newGoals(world, era, state, faction, owned, allowDeployment) {
  const since = state.turn;
  const grain = state.factions[faction].grain;
  const income = forceTotals(state, faction).grain;
  const economy = { type: "economy", since, threshold: Math.min(Number.MAX_SAFE_INTEGER, grain + Math.max(65, 2 * income + 8)) };
  const frontier = owned.flatMap(({ key, links }) => links.filter((to) => isHostile(state, faction, state.cities[to].owner))
    .map((target) => ({ city: key, target })));
  const vulnerable = frontier.map((pair) => {
    const hostile = state.cities[pair.target];
    const threshold = Math.max(1100, Math.min(3600, hostile.troops + 400));
    return { ...pair, threshold, gap: threshold - strengthAt(state.cities[pair.city]) };
  }).sort((a, b) => b.gap - a.gap)[0];
  const opportunities = frontier.flatMap(({ city, target }) => {
    let order = attackFrom(era, state, faction, city, target);
    let preparing = false;
    if (!order && allowDeployment) {
      const troops = Math.min(state.cities[city].troops - cityReserve, state.factions[faction].grain * 100);
      const assignment = troops >= minimumMarch && suggestDeployment(world, era, state, faction, city, target);
      if (assignment) {
        preparing = true;
        order = { type: "attack", from: city, to: target, troops, officer: assignment.officer };
      }
    }
    if (!order) return [];
    const battle = forecastAttack(era, state, order, faction);
    const enemyCity = state.cities[target];
    const opportunistic = state.century && (enemyCity.occupation > 0 || enemyCity.troops < 900) ? 1.15 : 1;
    const personality = state.century ? factionPersonality(faction) : null;
    const attackWeight = personality ? personality.attackWeight : 1;
    const grudge = rivalFriction(state, faction, enemyCity.owner) ? 1.28 : 1;
    const coalitionBias = isCoalitionMember(state, faction) && enemyCity.owner === state.player ? 1.32 : 1;
    const allyStrikeBias = (state.saga?.allyStrikes ?? []).some((s) => s.ally === faction && s.target === target && s.expires > state.turn) ? 1.65 : 1;
    return [{ city, target, ratio: (battle.offense / Math.max(1, battle.defense)) * opportunistic * attackWeight * grudge * coalitionBias * allyStrikeBias * (preparing ? .88 : 1) }];
  }).sort((a, b) => b.ratio - a.ratio);
  const chance = opportunities[0];
  const defense = vulnerable?.gap > 0
    ? { type: "defend", since, city: vulnerable.city, target: vulnerable.target, threshold: vulnerable.threshold } : null;
  const expansion = chance?.ratio >= .55 ? { type: "expand", since, city: chance.city, target: chance.target, threshold: 1 } : null;
  const aggression = state.century ? factionPersonality(faction).aggression : 1;

  if (defense && vulnerable.gap >= 420) return [defense, economy, expansion].filter(Boolean);
  if (expansion && since >= 2 && chance.ratio * aggression >= .82) return [expansion, economy, defense].filter(Boolean);
  return [economy, defense, expansion].filter(Boolean);
}

function reinforcement(world, state, faction, to) {
  const city = world.cities.find(({ key }) => key === to);
  let best = null;
  for (const from of city.links) {
    const origin = world.cities.find(({ key }) => key === from);
    if (state.cities[from].owner !== faction || state.cities[from].occupation) continue;
    const border = origin.links.some((key) => isHostile(state, faction, state.cities[key].owner));
    const leave = border ? 1300 : 650;
    const troops = Math.min(850, state.cities[from].troops - leave, state.factions[faction].grain * 100);
    if (troops >= minimumMarch && (!best || troops > best.troops)) best = { type: "transfer", from, to, troops };
  }
  return best;
}

function actionsFor(world, era, state, faction, owned, goal, allowDeployment, allowArmies) {
  const city = goal.city;
  if (goal.type === "economy") {
    const open = owned.filter(({ key }) => !state.cities[key].occupation);
    const farming = [...open].sort((a, b) => state.cities[a.key].farming - state.cities[b.key].farming)[0];
    const commerce = [...open].sort((a, b) => state.cities[a.key].commerce - state.cities[b.key].commerce)[0];
    return [
      farming && { type: "build", city: farming.key, project: "farming" },
      commerce && { type: "build", city: commerce.key, project: "commerce" },
    ].filter(Boolean);
  }

  const reinforcing = reinforcement(world, state, faction, city);
  const recruiting = state.cities[city].troops < 3300 ? { type: "recruit", city } : null;
  const deployment = allowDeployment && suggestDeployment(world, era, state, faction, city, goal.target);
  if (goal.type === "defend") {
    return [deployment, reinforcing, recruiting, { type: "build", city, project: "defense" }].filter(Boolean);
  }

  const attack = attackFrom(era, state, faction, city, goal.target);
  const canWin = attack && forecastAttack(era, state, attack, faction).wins;
  const campaign = allowArmies && (campaignAssembly(world, era, state, faction, owned, goal) ?? navalAssembly(world, era, state, faction, goal));
  return [canWin ? attack : null, campaign, deployment, reinforcing, recruiting].filter(Boolean);
}

function recoveryAppointments(era, state, faction, owned) {
  if (faction === state.player) return [];
  const recoveryValue = (city) => {
    const { treasury, grain } = recoveredIncome(city);
    return treasury + grain;
  };
  const targets = owned.filter(({ key }) => needsRecoveryGovernor(state.cities[key]))
    .sort((a, b) => recoveryValue(state.cities[b.key]) - recoveryValue(state.cities[a.key]));
  if (!targets.length) return [];
  const candidates = era.officers.filter(({ key, faction: allegiance }) => allegiance === faction && availableForPosting(state, key));
  if (!candidates.length) return [];
  return targets.slice(0, 2).map(({ key: city }) => {
    const local = ({ key }) => Number(state.stations[key] === city);
    const officer = [...candidates].sort((a, b) => b.governance - a.governance || local(b) - local(a))[0];
    return { type: "appoint-governor", city, officer: officer.key };
  });
}

function needsImmediateMilitaryAction(world, era, state, faction, { goal, order }, alternativeCity) {
  if (!order) return false;
  if (["attack", "mobilize", "deploy"].includes(order.type)) return true;
  if (goal.type !== "defend") return false;
  const rival = state.cities[goal.target].owner;
  const threat = attackFrom(era, state, rival, goal.target, goal.city, { quick: true });
  if (!threat || !forecastAttack(era, state, threat, rival).wins) return false;
  if (goal.city === alternativeCity) return true;
  const afterDefense = previewOrders(world, { ...state, player: faction, orders: [order] });
  return !forecastAttack(era, afterDefense, threat, rival).wins;
}

function domesticDelegations(world, state, faction, owned) {
  if (faction === state.player) return [];
  const stock = state.factions[faction];
  const preferFarming = stock.grain < stock.treasury;
  const candidates = owned.flatMap(({ key, links }) => {
    const city = state.cities[key];
    if (!city.governor || city.occupation) return [];
    const exposed = links.some((neighbor) => isHostile(state, faction, state.cities[neighbor].owner));
    const economy = preferFarming ? ["farming", "commerce"] : ["commerce", "farming"];
    const choices = exposed ? ["defense", ...economy] : economy;
    for (const focus of choices) {
      const required = opponentDelegationQuote(world, state, faction, key, focus);
      if (required) return [{
        type: "delegate-city", city: key, focus, budget: required.treasury,
        ...(city.mode === "delegated" ? { previousFocus: city.focus } : {}),
      }];
    }
    return [];
  });
  return candidates.sort((a, b) => Number(Boolean(b.previousFocus)) - Number(Boolean(a.previousFocus))
    || state.cities[a.city][a.focus] - state.cities[b.city][b.focus]
    || a.budget - b.budget).slice(0, 2);
}

export function factionPlans(world, era, state, faction, {
  allowDeployment = true, allowRecoveryAppointments = true, allowDomesticDelegation = true, adaptive = true, allowArmies = true, allowTheaters = true,
} = {}) {
  state = militaryView(state, faction);
  const existing = state.strategies?.[faction];
  const { treasury, grain } = state.factions[faction];
  const recovering = adaptive && state.turn >= 4 && (grain < 24 || (treasury < 18 && grain < 55));
  const owned = world.cities.filter(({ key }) => state.cities[key].owner === faction);
  const seat = firstCity(world, state, faction);
  owned.sort((a, b) => Number(b.key === seat) - Number(a.key === seat));
  const active = existing && assessGoal(state, faction, existing, adaptive).status === "active";
  const march = active && existing.type === "expand" && attackFrom(era, state, faction, existing.city, existing.target);
  const readyAttack = march && forecastAttack(era, state, march, faction).wins;
  const dangerTurn = state.century ? 1 : 4;
  const danger = adaptive && state.turn >= dangerTurn && !recovering && !readyAttack && threatenedCity(era, state, faction, owned, seat);
  const cut = allowArmies && !recovering && supplyStrike(world, era, state, faction, owned);
  const keep = active && !cut && (!recovering || existing.type === "economy") && (!danger || existing.type === "defend" && existing.city === danger.city);
  let goals = keep ? [existing] : newGoals(world, era, state, faction, owned, allowDeployment);
  if (recovering) goals = goals.filter(({ type }) => type === "economy");
  if (danger && !keep) {
    if (active && !goals.some((goal) => sameGoal(goal, existing))) goals.push(existing);
    goals = [danger, ...goals.filter((goal) => !sameGoal(goal, danger))];
  }
  if (cut) goals = [cut, ...goals.filter((goal) => !sameGoal(goal, cut))];
  const alliedTarget = !recovering && !danger && (congressTarget(state, faction) ?? pactTarget(state, faction));
  const alliedCity = alliedTarget && owned.find(({ links }) => links.includes(alliedTarget));
  const pactGoal = alliedCity && { type: "expand", city: alliedCity.key, target: alliedTarget, threshold: 1, since: state.turn };
  const agenda = state.grand?.agendas[faction];
  if (agenda && !keep && !danger && !recovering && !cut && !pactGoal) {
    const preferred = { guard: "defend", expand: "expand", restore: "economy", trade: "economy" }[agenda.kind];
    goals.sort((a, b) => Number(b.type === preferred) - Number(a.type === preferred));
  }
  if (pactGoal) goals = [pactGoal, ...goals.filter((goal) => !sameGoal(goal, pactGoal))];
  const choices = [];
  const regionalOrders = new Set();
  for (const goal of goals) {
    choices.push({ goal, order: null });
    const alliedAssembly = goal === pactGoal && allowArmies && pactAssembly(world, era, state, faction, goal);
    if (alliedAssembly) choices.push({ goal, order: alliedAssembly });
    const front = allowTheaters && opponentFrontOrder(world, era, state, faction, goal);
    if (front) {
      choices.push({ goal, order: front });
      regionalOrders.add(front);
    }
    for (const order of actionsFor(world, era, state, faction, owned, goal, allowDeployment, allowArmies)) {
      if (front && order.type === front.type && order.from === front.from && order.city === front.city) continue;
      try {
        validateOrder(world, state, faction, order);
        choices.push({ goal, order });
        if (state.war && order.type === "mobilize" && order.stance === "siege") choices.push({ goal, order: { ...order, stance: "assault" } });
      } catch {
        // Unaffordable or already completed actions are omitted from the list.
      }
    }
  }
  const ordinary = choices.find(({ goal, order }) => goal === goals[0] && order) ?? choices[0];
  const appointments = allowRecoveryAppointments
    ? recoveryAppointments(era, state, faction, owned).map((order) => ({ goal: goals[0], order })) : [];
  const delegations = allowDomesticDelegation
    ? domesticDelegations(world, state, faction, owned).map((order) => ({ goal: goals[0], order })) : [];
  const suggested = regionalOrders.has(ordinary.order) || (pactGoal && ["attack", "mobilize"].includes(ordinary.order?.type)) ? ordinary
    : appointments.find(({ order }) => !needsImmediateMilitaryAction(world, era, state, faction, ordinary, order.city))
    ?? delegations.find(({ order }) => !needsImmediateMilitaryAction(world, era, state, faction, ordinary, order.city))
    ?? ordinary;
  choices.push(...appointments, ...delegations);
  return { choices: choices.map((choice, id) => ({ ...choice, id: String(id) })), goals, suggested,
    keep: Boolean(keep), recovering, urgent: Boolean(danger), supplyCut: cut || undefined };
}

export function sameGoal(first, second) {
  return Boolean(first && second && ["type", "city", "target", "since", "threshold"].every((key) => first[key] === second[key]));
}

export function compatibleGoal(plan, proposal) {
  return plan.goals.find((goal) => {
    if (proposal.goal && !sameGoal(proposal.goal, goal)) return false;
    const order = proposal.order;
    if (!order) return order === null;
    if (order.type === "appoint-governor") return plan.choices.some(({ goal: offered, order: candidate }) => offered === goal
      && candidate?.type === order.type && candidate.city === order.city && candidate.officer === order.officer);
    if (order.type === "delegate-city") return plan.choices.some(({ goal: offered, order: candidate }) => offered === goal
      && candidate?.type === order.type && candidate.city === order.city && candidate.focus === order.focus
      && candidate.budget === order.budget && candidate.previousFocus === order.previousFocus);
    if (order.type === "mobilize") return plan.choices.some(({ goal: offered, order: candidate }) => offered === goal
      && candidate?.type === order.type && candidate.from === order.from && candidate.to === order.to
      && candidate.officer === order.officer && candidate.troops === order.troops && candidate.stance === order.stance);
    if (goal.type === "economy") return order.type === "build" && ["farming", "commerce"].includes(order.project);
    if (order.type === "deploy") return order.to === goal.city && order.target === goal.target;
    if (order.type === "transfer") return order.to === goal.city;
    if (order.type === "recruit") return order.city === goal.city;
    if (goal.type === "defend") return order.type === "build" && order.city === goal.city && order.project === "defense";
    return order.type === "attack" && order.from === goal.city && order.to === goal.target;
  });
}

export function describeGoal(world, goal) {
  if (goal.type === "economy") return "积蓄粮草";
  if (goal.type === "defend") return "稳住" + cityName(world, goal.city);
  return "争夺" + cityName(world, goal.target);
}

export function describeGoalProgress(world, result, turn) {
  const { goal, progress, status } = result;
  const assessment = { active: "推进第 " + (turn - goal.since) + " 季", achieved: "已达成", lost: "形势变化", expired: "期限已到" };
  const gauge = goal.type === "expand" ? "" : " · " + number.format(progress) + " / " + number.format(goal.threshold)
    + (goal.type === "economy" ? " 粮" : " 守备");
  return describeGoal(world, goal) + " · " + assessment[status] + gauge;
}

export function describeChoice(world, era, state, faction, order) {
  const name = describeOrder(world, era, order);
  if (!order) return name + "，保留钱粮";
  if (order.type === "delegate-city") return name + (order.previousFocus ? "，原项目已达上限" : "")
    + "，结算时按实际进度支出，先预留征兵储备";
  if (order.type === "appoint-governor") {
    const { treasury, grain } = recoveredIncome(state.cities[order.city]);
    return name + "，加快本城整顿，恢复后每季多收" + treasury + "钱、" + grain + "粮";
  }
  if (order.type === "deploy") return name + "，可守城并在之后季度领兵出征";
  if (order.type === "attack") {
    const odds = forecastAttack(era, state, order, faction);
    return name + "，战力" + odds.offense + "/" + odds.defense + "，耗粮" + odds.grain;
  }
  if (order.type === "mobilize") {
    const { carried, quarters } = mobilizationQuote(world, state, faction, order);
    return name + "，预计 " + quarters + " 季抵达，携粮 " + carried;
  }
  if (order.type === "transfer") return name + "，耗粮" + expeditionGrain(order.troops);
  if (order.type === "recruit") return name + "，增兵" + recruitment.troops + "，耗钱" + recruitment.treasury + "、粮" + recruitment.grain;
  return name + "，耗钱" + projects[order.project].cost;
}

export function validGoal(world, goal, turn) {
  if (!goal || !Number.isSafeInteger(goal.since) || goal.since < 0 || goal.since > turn
    || !Number.isSafeInteger(goal.threshold) || goal.threshold < 1) return false;
  if (goal.type === "economy") return goal.city === undefined && goal.target === undefined;
  const city = world.cities.find(({ key }) => key === goal.city);
  if (!city?.links.includes(goal.target)) return false;
  return (goal.type === "expand" && goal.threshold === 1) || (goal.type === "defend" && goal.threshold <= 3600);
}

export function validGoalResult(world, result, turn) {
  return Boolean(result && validGoal(world, result.goal, turn) && statuses.includes(result.status)
    && Number.isSafeInteger(result.progress) && result.progress >= 0);
}
