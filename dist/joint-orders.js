import {
  availableAttackers, cityReserve, eraByYear, expeditionGrain, forecastAttack, gameOutcome,
  minimumMarch, pendingExpedition, previewOrders, replaceOrders, seasonOrderLimit, transferGrain, transferRoutes,
} from "./engine.js";
import { frontierCities, frontierIntel } from "./frontier.js";

export function jointOptions(world, state, planned = previewOrders(world, state)) {
  return jointSituation(world, state, planned).origins;
}

export function jointSituation(world, state, planned = previewOrders(world, state)) {
  if (gameOutcome(state) !== "ongoing") return { origins: [], reason: "战局已结束。" };
  if (state.orders.length > seasonOrderLimit - 2) return { origins: [], reason: "联合拟令需要两个队列空位。" };
  const era = eraByYear(world, state);
  const grain = planned.factions[state.player].grain;
  const supportGrain = Math.max(0, grain - expeditionGrain(minimumMarch));
  let enemy = false;
  let leader = false;
  let connected = false;
  let enoughTroops = false;
  const origins = frontierCities(world, planned).flatMap(({ key, exposed }) => {
    if (!exposed) return [];
    enemy = true;
    const intel = frontierIntel(world, planned, key, { includeRemote: true });
    const officers = availableAttackers(era, planned, state.player, key)
      .filter((officer) => !pendingExpedition(state, officer.key))
      .sort((a, b) => b.command - a.command);
    if (!officers.length) return [];
    leader = true;
    const supportMinimum = Math.max(minimumMarch, cityReserve + minimumMarch - intel.troops);
    connected ||= intel.donors.length > 0;
    enoughTroops ||= intel.donors.some(({ troops }) => troops - cityReserve >= supportMinimum);
    const donors = intel.donors
      .map((donor) => ({ ...donor, maximum: Math.min(donor.available, Math.floor(supportGrain / donor.hops) * 100) }))
      .filter(({ maximum }) => maximum >= supportMinimum);
    if (!donors.length) return [];
    return [{ key, troops: intel.troops, grain, supportMinimum, targets: intel.opponents.filter(({ treaty }) => !treaty), donors, officers }];
  });
  if (origins.length) return { origins, reason: "" };
  if (!enemy) return { origins, reason: "当前没有可出征的相邻敌城。" };
  if (!leader) return { origins, reason: "可出征的边城缺少待命武将。" };
  if (!connected) return { origins, reason: "进攻城三段己方道路内没有援军城。" };
  if (!enoughTroops) return { origins, reason: "援军城留守后兵力不足，无法支撑出征。" };
  return { origins, reason: "储粮不足，须同时预留援军各段与最低出征耗粮。" };
}

export function jointAttackLimit(origin, support, donor) {
  return Math.max(0, Math.min(
    origin.troops + support - cityReserve,
    (origin.grain - transferGrain({ troops: support, route: donor?.route })) * 100,
  ));
}

export function planJointOrders(world, state, draft) {
  const planned = previewOrders(world, state);
  const route = draft.supportRoute === undefined
    ? transferRoutes(world, planned, draft.support).find((path) => path.at(-1) === draft.from)
    : draft.supportRoute;
  const transfer = { type: "transfer", from: draft.support, to: draft.from, troops: draft.supportTroops,
    ...(draft.supportRoute !== undefined || route?.length > 2 ? { route } : {}) };
  const attack = { type: "attack", from: draft.from, to: draft.target, officer: draft.officer, troops: draft.attackTroops };
  const queued = replaceOrders(world, state, [...state.orders, transfer, attack]);
  const staged = previewOrders(world, { ...state, orders: queued.orders.slice(0, -1) });
  const outcome = forecastAttack(eraByYear(world, state), staged, attack);
  return {
    queued,
    positions: [state.orders.length + 1, state.orders.length + 2],
    route: route ?? [transfer.from, transfer.to],
    grain: transferGrain(transfer) + outcome.grain,
    supportGarrison: planned.cities[transfer.from].troops,
    attackGarrison: planned.cities[attack.from].troops,
    supportReserve: staged.cities[transfer.from].troops,
    attackReserve: staged.cities[attack.from].troops - attack.troops,
    outcome,
  };
}
