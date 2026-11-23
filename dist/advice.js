import {
  appoint, availableAttackers, cityName, cityReserve, eraByYear, expeditionGrain, factionName, forecastAttack,
  forecastFinance, gameOutcome, minimumMarch, pendingExpedition, postingOf, previewOrders, replaceOrders,
  seasonOrderLimit, setGovernance,
} from "./engine.js";
import { incomingTreatyBlock, treatyTerms } from "./diplomacy.js";
import { frontierCities, frontierIntel } from "./frontier.js";
import { jointAttackLimit, jointOptions, planJointOrders } from "./joint-orders.js";

function canQueue(world, state, order) {
  try {
    replaceOrders(world, state, [...state.orders, order]);
    return true;
  } catch {
    return false;
  }
}

function budgetAdvice(world, state, fiscal) {
  for (const { city, result, needed } of fiscal.programs) {
    if (result !== "budget" || state.cities[city].owner !== state.player) continue;
    const adjusted = setGovernance(state, city, "delegated", state.cities[city].focus, needed);
    const revised = forecastFinance(world, adjusted).programs;
    if (revised.some((entry) => entry.city === city && entry.result === "completed")) {
      const stillFunded = new Set(revised.filter((entry) => entry.result === "completed").map((entry) => entry.city));
      const delayed = fiscal.programs.filter((entry) => entry.result === "completed" && !stillFunded.has(entry.city)).length;
      return {
        kind: "budget", city, needed, title: "调整" + cityName(world, city) + "的委任预算",
        detail: "把每季预算提高到 " + needed + " 钱，按当前队列预估可执行。"
          + (delayed ? "预计另有 " + delayed + " 座城的委任会延后。" : ""),
      };
    }
  }
  return null;
}

function commandAdvice(world, era, state, planned, fronts) {
  const exposed = new Set(fronts.map(({ key }) => key));
  const idle = era.officers.filter(({ key, faction }) => faction === state.player && !postingOf(state, key)
    && !pendingExpedition(state, key) && !exposed.has(state.stations[key])).sort((a, b) => b.command - a.command);
  for (const { key: city, commander } of fronts) {
    if (commander || state.cities[city].owner !== state.player
      || availableAttackers(era, planned, state.player, city).some(({ key }) => !pendingExpedition(state, key))) continue;
    for (const officer of idle) {
      try {
        previewOrders(world, appoint(world, state, city, "commander", officer.key));
        return {
          kind: "appointment", city, officer: officer.key, title: "为" + cityName(world, city) + "任命守将",
          detail: "此处缺少可领兵武将。待任武将" + officer.name + "可调来守城。",
        };
      } catch {
        // An assignment may be incompatible with a queued action.
      }
    }
  }
  return null;
}

function combatAdvice(world, era, state, planned, fronts) {
  const grain = planned.factions[state.player].grain;
  const single = [];
  for (const front of fronts) {
    const troops = Math.min(front.troops - cityReserve, grain * 100);
    if (troops < minimumMarch) continue;
    const officer = availableAttackers(era, planned, state.player, front.key)
      .filter(({ key }) => !pendingExpedition(state, key)).sort((a, b) => b.command - a.command)[0];
    if (!officer) continue;
    for (const target of front.opponents.filter(({ treaty }) => !treaty)) {
      const order = { type: "attack", from: front.key, to: target.key, officer: officer.key, troops };
      const odds = forecastAttack(era, planned, order);
      if (odds.wins) single.push({ order, odds, score: odds.offense / Math.max(1, odds.defense) });
    }
  }
  const attack = single.sort((a, b) => b.score - a.score).find(({ order }) => canQueue(world, state, order));
  if (attack) {
    const { order, odds } = attack;
    return {
      kind: "attack", order, title: "从" + cityName(world, order.from) + "出征" + cityName(world, order.to),
      detail: "预计战力 " + odds.offense + " 对 " + odds.defense + "，耗粮 " + expeditionGrain(order.troops)
        + "，出征城至少留守 " + (planned.cities[order.from].troops - order.troops) + "。",
    };
  }

  const grouped = [];
  for (const origin of jointOptions(world, state, planned)) {
    for (const donor of origin.donors) {
      const standard = Math.min(donor.maximum, Math.max(origin.supportMinimum, 600));
      for (const target of origin.targets) {
        for (const supportTroops of new Set([standard, donor.maximum])) {
          const draft = {
            from: origin.key, target: target.key, support: donor.key, officer: origin.officers[0].key,
            supportTroops, attackTroops: jointAttackLimit(origin, supportTroops, donor),
            ...(donor.hops > 1 ? { supportRoute: donor.route } : {}),
          };
          const odds = forecastAttack(era, planned, { from: draft.from, to: draft.target, troops: draft.attackTroops, officer: draft.officer });
          if (!odds.wins) continue;
          grouped.push({ draft, score: odds.offense / Math.max(1, odds.defense) });
          break;
        }
      }
    }
  }
  for (const { draft } of grouped.sort((a, b) => Number(Boolean(a.draft.supportRoute)) - Number(Boolean(b.draft.supportRoute))
    || b.score - a.score)) {
    try {
      const plan = planJointOrders(world, state, draft);
      return {
        kind: "joint", draft, title: "先援" + cityName(world, draft.from) + "，再攻" + cityName(world, draft.target),
        detail: plan.route.map((key) => cityName(world, key)).join(" → ") + "，预计占优，合计耗粮 " + plan.grain + "。",
      };
    } catch {
      // Only drafts which pass the real queue validation are shown.
    }
  }
  return null;
}

function domesticAdvice(world, state, planned, fronts) {
  const used = (order) => state.orders.some((queued) => queued.type === order.type && queued.city === order.city && queued.project === order.project);
  const front = fronts.find(({ key }) => state.cities[key].owner === state.player);
  const orderAt = ({ key }) => ({ type: "build", city: key, project: planned.factions[state.player].grain < 140 ? "farming" : "commerce" });
  const orders = [
    ...(front && front.troops < 1800 ? [{ type: "recruit", city: front.key }] : []),
    ...(front && front.defense < 3 ? [{ type: "build", city: front.key, project: "defense" }] : []),
    ...world.cities.filter(({ key }) => state.cities[key].owner === state.player && planned.cities[key].owner === state.player).map(orderAt),
  ];
  const order = orders.find((entry) => !used(entry) && canQueue(world, state, entry));
  if (!order) return null;
  const label = order.type === "recruit" ? "征募守军" : { defense: "加固城防", farming: "扩建屯田", commerce: "发展商贸" }[order.project];
  const reason = order.type === "recruit" || order.project === "defense" ? "可增强边城守备。" : "可提高后续季度产出。";
  return { kind: "domestic", order, title: "在" + cityName(world, order.city) + label, detail: "当前钱粮足够下令。" + reason };
}

export function seasonAdvice(world, state, planned = previewOrders(world, state)) {
  if (gameOutcome(state) !== "ongoing") return [];
  const era = eraByYear(world, state);
  const fiscal = forecastFinance(world, state);
  const advice = [];
  const offer = state.incomingTreaty;
  if (offer?.answer === null) {
    advice.push({
      kind: "diplomacy", title: "答复" + factionName(era, offer.from) + "来使",
      detail: "对方提议" + treatyTerms[offer.kind].name + "，可在推进下一季前答复。" + incomingTreatyBlock(state),
    });
  }
  const budget = budgetAdvice(world, state, fiscal);
  if (budget) advice.push(budget);
  const pressure = (front) => Math.max(0, ...front.opponents.filter(({ treaty }) => !treaty).map(({ difference }) => difference));
  const fronts = frontierCities(world, planned).filter(({ exposed }) => exposed)
    .map(({ key }) => frontierIntel(world, planned, key)).sort((a, b) => pressure(b) - pressure(a));
  const staffing = commandAdvice(world, era, state, planned, fronts);
  if (staffing) advice.push(staffing);
  if (advice.length < 3 && state.orders.length < seasonOrderLimit) {
    const action = combatAdvice(world, era, state, planned, fronts) ?? domesticAdvice(world, state, planned, fronts);
    if (action) advice.push(action);
  }
  if (!advice.length) {
    if (state.orders.length === seasonOrderLimit) {
      advice.push({ kind: "orders", title: "检查本季政令", detail: "三个队列位置均已使用，可核对顺序或撤销。" });
    } else {
      advice.push({
        kind: "finance", title: "查看本季收入", detail: "预计入账 " + (fiscal.tax.treasury + fiscal.trade) + " 钱、" + fiscal.tax.grain + " 粮。",
      });
    }
  }
  return advice;
}
