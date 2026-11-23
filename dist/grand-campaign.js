import { armyByOfficer, marchRoute, mobilizationQuote, redirectArmy, supplyRoute, withdrawalRoute } from "./armies.js";
import { availableAttackers, cityName, cityReserve, eraByYear, expeditionGrain, gameOutcome } from "./engine.js";
import { isHostile } from "./diplomacy.js";
import { realmReserve } from "./realm.js";
import { bounded } from "./polities-data.js";

export const wingNames = { main: "主攻", support: "策应", escort: "护粮" };
export const campaignStatuses = { ready: "待出发", active: "执行中", blocked: "需要指挥", recovering: "接管中", complete: "已完成", paused: "已暂停" };

const active = (plan) => !["complete", "recovering", "paused"].includes(plan.status);
const stance = { main: "siege", support: "blockade", escort: "assault" };

export function campaignCandidates(world, state, target) {
  const era = eraByYear(world, state);
  const faction = state.player;
  const reserved = new Set((state.theaters ?? []).flatMap(({ commander, army }) => [commander, army]));
  return world.cities.flatMap(({ key, name }) => {
    if (state.cities[key].owner !== faction || state.cities[key].occupation || state.cities[key].troops - cityReserve < 200
      || !marchRoute(world, state, faction, key, target)) return [];
    return availableAttackers(era, state, faction, key).filter(({ key }) => !reserved.has(key))
      .map((person) => ({ officer: person.key, name: person.name, from: key, city: name, max: state.cities[key].troops - cityReserve }));
  });
}

function orderFor(plan, role, unit) {
  return { type: "mobilize", from: unit.from, to: plan.target, officer: unit.officer, troops: unit.troops, stance: stance[role] };
}

export function validCampaignShape(state, plan, officers) {
  return plan && bounded(plan.id, 1, 2) && typeof plan.name === "string" && plan.name.trim() && plan.name.length <= 20
    && [plan.target, plan.depot, plan.retreat].every((city) => Object.hasOwn(state.cities, city))
    && (plan.backup === null || Object.hasOwn(state.cities, plan.backup)) && bounded(plan.grain, 12, 150)
    && bounded(plan.floor, 200, 6000) && typeof plan.recover === "boolean" && Object.hasOwn(campaignStatuses, plan.status)
    && plan.wings && plan.wings.main && Object.entries(plan.wings).every(([role, unit]) => Object.hasOwn(wingNames, role)
      && unit && officers.has(unit.officer) && Object.hasOwn(state.cities, unit.from) && bounded(unit.troops, 200, 30000))
    && new Set(Object.values(plan.wings).map(({ officer }) => officer)).size === Object.keys(plan.wings).length
    && (plan.aid === undefined || plan.aid && Object.hasOwn(plan.wings, plan.aid.role) && bounded(plan.aid.troops, 200, 2000))
    && bounded(plan.lost, 0, 3) && (plan.note === null || typeof plan.note === "string" && plan.note.length <= 180);
}

export function campaignQuote(world, state, plan) {
  const era = eraByYear(world, state);
  const known = new Map(era.officers.map((person) => [person.key, person]));
  if (!state.grand || !validCampaignShape(state, plan, known) || plan.floor > plan.wings.main.troops) {
    return { ready: false, reason: "请填写目标、粮仓、主攻编组和有效的撤军底线。", wings: [] };
  }
  const owner = (key) => state.cities[key]?.owner;
  if ([plan.depot, plan.retreat, ...(plan.backup ? [plan.backup] : [])].some((key) => owner(key) !== state.player)
    || !isHostile(state, state.player, owner(plan.target))) {
    return { ready: false, reason: "目标须属于敌方，粮仓和撤退点须由本方控制。", wings: [] };
  }
  const others = state.grand.campaigns.filter(({ id, status }) => id !== plan.id && status !== "complete").flatMap(({ wings }) => Object.values(wings));
  const booked = new Set([...others.map(({ officer }) => officer), ...(state.theaters ?? []).flatMap(({ commander, army }) => [commander, army])]);
  const draft = structuredClone(state);
  const wings = [];
  for (const [role, unit] of Object.entries(plan.wings)) {
    if (booked.has(unit.officer)) return { ready: false, reason: "名单中有武将已编入其他战役或战区。", wings };
    try {
      const order = orderFor(plan, role, unit);
      const quote = mobilizationQuote(world, draft, state.player, order);
      const route = role === "escort" ? [unit.from] : quote.route;
      if (!supplyRoute(world, draft, { faction: state.player, location: unit.from, depot: plan.depot })
        && !supplyRoute(world, draft, { faction: state.player, location: unit.from, depot: plan.backup })) {
        return { ready: false, reason: "至少一个编组无法接入指定粮仓。", wings };
      }
      wings.push({ role, ...unit, route, grain: quote.carried, quarters: role === "escort" ? 1 : quote.quarters });
      draft.cities[unit.from].troops -= unit.troops;
      draft.factions[state.player].grain -= quote.carried;
      draft.armies = [...(draft.armies ?? []), { faction: state.player, officer: unit.officer }];
      draft.stations[unit.officer] = null;
    } catch (error) {
      return { ready: false, reason: error.message, wings };
    }
  }
  const grain = wings.reduce((sum, unit) => sum + unit.grain, 0);
  const floor = Math.max(state.grand.national.reserve, realmReserve(state, state.player).grain);
  const ready = draft.factions[state.player].grain >= floor && grain <= plan.grain;
  return { ready, reason: ready ? "集结 " + grain + " 粮，此后每季最多调拨 " + plan.grain + " 粮。"
    : "集结款超过军粮额度，或将挤占本方储粮预留。", wings };
}

export function saveGrandCampaign(world, state, draft) {
  if (!state.grand || gameOutcome(state) !== "ongoing") throw new Error("当前战局无法发起战役。");
  const plan = { ...draft, status: "ready", lost: 0, note: null };
  const quote = campaignQuote(world, state, plan);
  if (!quote.ready || state.grand.campaigns.some(({ id, status }) => id === plan.id && status !== "complete")) {
    throw new Error(quote.ready ? "请先结束该席位的现有战役。" : quote.reason);
  }
  return { ...state, grand: { ...state.grand, campaigns: [...state.grand.campaigns.filter(({ id }) => id !== plan.id), structuredClone(plan)] } };
}

export function manageGrandCampaign(state, id, action) {
  const plan = state.grand?.campaigns.find((item) => item.id === id);
  if (!plan || gameOutcome(state) !== "ongoing" || !["pause", "resume", "cancel", "withdraw"].includes(action)) {
    throw new Error("当前无法调整该战役。");
  }
  const next = structuredClone(state);
  if (action === "cancel") {
    if (Object.values(plan.wings).some(({ officer }) => armyByOfficer(state, officer))) throw new Error("仍有军团在外，请先撤军。");
    next.grand.campaigns = next.grand.campaigns.filter((item) => item.id !== id);
    return next;
  }
  const active = next.grand.campaigns.find((item) => item.id === id);
  if (["recovering", "complete"].includes(active.status) && action !== "withdraw") throw new Error("该战役已结束进攻阶段。");
  active.status = action === "resume" ? "blocked" : "paused";
  if (action === "withdraw") delete active.aid;
  active.note = action === "withdraw" ? "已请求各军撤回。" : action === "pause" ? "已暂停，待下达新指示。" : null;
  return next;
}

export function reviseGrandSupply(state, id, draft) {
  const existing = state.grand?.campaigns.find((item) => item.id === id);
  const owned = (key) => state.cities[key]?.owner === state.player;
  if (!existing || ["complete", "recovering"].includes(existing.status) || gameOutcome(state) !== "ongoing"
    || !owned(draft.depot) || !owned(draft.retreat) || draft.backup && !owned(draft.backup)
    || !bounded(draft.grain, 12, 150) || !bounded(draft.floor, 200, existing.wings.main.troops)) {
    throw new Error("请选择本方仍控制的粮仓和退路，填写有效的军粮与撤军底线。");
  }
  const { depot, backup, retreat, grain, floor } = draft;
  const campaigns = state.grand.campaigns.map((plan) => plan.id === id
    ? { ...plan, depot, backup, retreat, grain, floor, note: "已调整粮路和撤军预案。" } : plan);
  return { ...state, grand: { ...state.grand, campaigns } };
}

export function reinforceGrandWing(state, id, role, troops) {
  const plan = state.grand?.campaigns.find((item) => item.id === id);
  const unit = armyByOfficer(state, plan?.wings[role]?.officer);
  if (!plan || ["complete", "recovering"].includes(plan.status) || plan.note === "已请求各军撤回。"
    || gameOutcome(state) !== "ongoing" || unit?.faction !== state.player || unit.phase === "retreat"
    || state.cities[unit.location].owner !== state.player || !bounded(troops, 200, Math.min(2000, state.cities[unit.location].troops - cityReserve))) {
    throw new Error("军团须在本方城池，派出 200 至 2,000 预备兵并保留驻军。");
  }
  const campaigns = state.grand.campaigns.map((item) => item.id === id ? { ...item, aid: { role, troops } } : item);
  return { ...state, grand: { ...state.grand, campaigns } };
}

function campaignReport(state, plan, status, text, entries) {
  if (plan.status !== status || plan.note !== text) entries.push({ type: "grand", faction: state.player, city: plan.target,
    text: plan.name + " · " + text });
  plan.status = status;
  plan.note = text;
}

function secureWithdrawal(world, state, unit, plan) {
  const way = [plan.retreat, plan.backup, plan.depot].find((key) => key && withdrawalRoute(world, state, unit, key));
  if (way) redirectArmy(world, state, unit, { type: "retreat", target: way });
  else redirectArmy(world, state, unit, { type: "hold" });
  return Boolean(way);
}

export function directGrandCampaigns(world, state, runOrder, logistics, entries) {
  if (!state.grand) return;
  for (const plan of state.grand.campaigns) {
    const army = (role) => armyByOfficer(state, plan.wings[role]?.officer);
    if (!active(plan)) {
      if (plan.status === "paused") {
        for (const role of Object.keys(plan.wings)) {
          const unit = army(role);
          if (!unit || unit.phase === "retreat") continue;
          if (plan.note === "已请求各军撤回。") secureWithdrawal(world, state, unit, plan);
          else redirectArmy(world, state, unit, { type: "hold" });
        }
      }
      continue;
    }
    if (state.cities[plan.target].owner === state.player) continue;
    const faction = state.player;
    if (!isHostile(state, faction, state.cities[plan.target].owner)) {
      for (const role of Object.keys(plan.wings)) if (army(role)) secureWithdrawal(world, state, army(role), plan);
      campaignReport(state, plan, "blocked", "目标受到外交协定保护，军团撤向本方。", entries);
      continue;
    }
    const stock = state.factions[faction];
    const reserve = Math.max(state.grand.national.reserve, realmReserve(state, faction).grain);
    let remaining = plan.grain;
    let joined = 0;
    let blocked = false;
    let alternate = false;
    const main = army("main");
    if (plan.aid) {
      const { role, troops } = plan.aid;
      const unit = army(role);
      const site = state.cities[unit?.location];
      const cost = expeditionGrain(troops);
      const possible = unit?.faction === faction && unit.phase !== "retreat" && site?.owner === faction
        && site.troops - troops >= cityReserve && cost <= Math.min(remaining, stock.grain - reserve);
      if (possible) {
        site.troops -= troops;
        unit.troops += troops;
        unit.grain += cost;
        stock.grain -= cost;
        remaining -= cost;
      }
      entries.push({ type: "grand", faction, city: unit?.location ?? plan.target,
        text: plan.name + " · " + wingNames[role] + (possible ? "获预备队 " + troops + " 人、" + cost + " 粮。" : "未获增援，驻地或预留条件已变。") });
      delete plan.aid;
    }
    if (main && main.troops < plan.floor && main.phase !== "retreat") {
      for (const role of Object.keys(plan.wings)) if (army(role)) secureWithdrawal(world, state, army(role), plan);
      campaignReport(state, plan, "paused", "主攻兵力跌破底线，按预案撤军。", entries);
      continue;
    }
    if (main?.phase === "hold" && plan.status === "active") {
      campaignReport(state, plan, "paused", "主攻就地固守，可补充预备队、调整粮路或恢复攻势。", entries);
      continue;
    }
    if (plan.status === "ready" && Object.values(plan.wings).reduce((sum, unit) => sum + expeditionGrain(unit.troops) * 2, 0)
      > stock.grain - reserve) {
      campaignReport(state, plan, "ready", "储粮预留以内可拨军粮不足，等待入库。", entries);
      continue;
    }
    for (const [role, detail] of Object.entries(plan.wings)) {
      let unit = army(role);
      if (unit && unit.faction !== faction) { blocked = true; continue; }
      if (!unit && ["ready", "blocked"].includes(plan.status)) {
        const cost = expeditionGrain(detail.troops) * 2;
        if (cost > remaining || cost > stock.grain - reserve || state.stations[detail.officer] !== detail.from) {
          blocked = true;
          continue;
        }
        const entry = runOrder(orderFor(plan, role, detail));
        unit = army(role);
        if (!unit) { blocked = true; continue; }
        entries.push(entry);
        remaining -= cost;
      }
      if (!unit) continue;
      joined += 1;
      if (role === "escort" && unit.phase !== "retreat") redirectArmy(world, state, unit, { type: "hold" });
      const depot = [plan.depot, plan.backup, ...(role === "escort" ? [unit.location] : [])]
        .find((key) => key && supplyRoute(world, state, unit, key));
      if (!depot) {
        blocked = true;
        if (unit.phase !== "retreat") {
          if (plan.lost >= 1) secureWithdrawal(world, state, unit, plan);
          else redirectArmy(world, state, unit, { type: "hold" });
        }
        continue;
      }
      if (depot !== plan.depot) alternate = true;
      unit.depot = depot;
      if (role !== "escort" && unit.phase === "hold" && !unit.engagement && plan.status === "blocked"
        && marchRoute(world, state, faction, unit.location, plan.target)) {
        redirectArmy(world, state, unit, { type: "march", target: plan.target, depot, stance: stance[role] });
      }
      logistics.set(unit.officer, { limit: () => remaining, charge: (grain) => { remaining -= grain; } });
    }
    plan.lost = blocked ? Math.min(3, plan.lost + 1) : 0;
    if (blocked || !joined) campaignReport(state, plan, "blocked", "有编组未就位或粮道中断。持续中断时各军按计划撤回。", entries);
    else campaignReport(state, plan, "active", joined + " 支军团执行中。" + (alternate ? "正在使用备用粮仓。" : ""), entries);
  }
}

export function finishGrandCampaigns(world, state, entries) {
  for (const plan of state.grand.campaigns) {
    if (plan.status === "complete" || state.cities[plan.target].owner !== state.player) continue;
    const city = state.cities[plan.target];
    if (plan.recover && city.occupation > 0) campaignReport(state, plan, "recovering", cityName(world, plan.target) + "已接管，州郡正在整顿。", entries);
    else campaignReport(state, plan, "complete", cityName(world, plan.target) + "已纳入本方防务。", entries);
  }
}

export function recoverGrandCampaigns(world, state, entries) {
  const faction = state.player;
  const stock = state.factions[faction];
  const reserve = realmReserve(state, faction);
  for (const plan of state.grand.campaigns) {
    const site = state.cities[plan.target];
    if (!plan.recover || plan.status === "complete" || site.owner !== faction || !site.occupation || site.troops < cityReserve
      || stock.treasury - reserve.treasury < 6 || stock.grain - Math.max(reserve.grain, state.grand.national.reserve) < 8) continue;
    stock.treasury -= 6;
    stock.grain -= 8;
    site.occupation -= 1;
    const civil = state.realm.cities[plan.target];
    civil.welfare = Math.min(100, civil.welfare + 8);
    entries.push({ type: "grand", faction, city: plan.target, text: plan.name + "拨付 6 钱、8 粮，在" + cityName(world, plan.target) + "安置驻军及百姓。" });
  }
}

export function combinedSiegeSupport(state, main) {
  const plan = state.grand?.campaigns.find(({ wings, status }) => active({ status }) && wings.main.officer === main.officer);
  const force = plan?.wings.support && armyByOfficer(state, plan.wings.support.officer);
  return force && force.faction === main.faction && force.target === main.target && force.engagement ? Math.min(10, Math.ceil(force.troops / 220)) : 0;
}
