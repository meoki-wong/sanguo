import { cityName, firstCity, gameOutcome } from "./engine.js";
import { quoteConvoy } from "./landscape-economy.js";
import { bounded, livingSide, plain } from "./polities-data.js";
import { realmReserve } from "./realm.js";
import { warBlockaded } from "./war-operations.js";

export const economicRoles = { farms: "供粮", industry: "制械", freight: "转运", recovery: "休养" };
export const mobilizationModes = { normal: "常态", urgent: "全国动员", recover: "战后休养" };

export function saveIndustry(world, state, draft) {
  if (!state.sandtable || gameOutcome(state) !== "ongoing" || !Object.hasOwn(mobilizationModes, draft.mode)
    || !bounded(draft.budget, 0, 120) || !bounded(draft.reserve, 0, 600)) throw new Error("请选择动员方针、用钱上限和最低储粮。");
  const next = structuredClone(state);
  const desk = next.sandtable.economy[next.player] ??= { mode: "normal", budget: 30, reserve: 25, regions: {} };
  Object.assign(desk, { mode: draft.mode, budget: draft.budget, reserve: draft.reserve });
  if (draft.region) {
    if (!world.cities.some(({ key, region }) => region === draft.region && state.cities[key].owner === state.player)
      || !Object.hasOwn(economicRoles, draft.role)) throw new Error("请选择己方州郡的生产职责。");
    desk.regions[draft.region] = draft.role;
  }
  return next;
}

export function workforceYield(state, city) {
  return Math.max(.55, 1 - (state.sandtable?.labor[city] ?? 0) / 5000);
}

export function countLevy(state, city, soldiers) {
  if (state.sandtable) state.sandtable.labor[city] = Math.min(2300, (state.sandtable.labor[city] ?? 0) + soldiers);
}

function trustedRoute(world, state, faction, from, to, cargo, wanted) {
  if (from === to) return null;
  for (const mode of ["land", "water"]) {
    const draft = { faction, from, to, mode, cargo, amount: 1 };
    const quote = quoteConvoy(world, state, draft);
    if (!quote) continue;
    const amount = Math.min(wanted, quote.capacity, quote.source);
    if (amount >= 4) return { ...draft, ...quote, amount };
  }
  return null;
}

function freightTarget(world, state, faction, hubs) {
  const frontline = [...(state.armies ?? [])].filter((unit) => unit.faction === faction && state.cities[unit.depot].owner === faction);
  const depot = frontline.sort((a, b) => a.grain - b.grain)[0]?.depot;
  return depot ?? hubs.find(({ role }) => role === "freight")?.city ?? firstCity(world, state, faction);
}

export function settleIndustry(world, state, account, entries, forecast = false) {
  const data = state.sandtable;
  for (const [key, value] of Object.entries(data.labor)) {
    const faction = state.cities[key].owner;
    const rate = data.economy[faction]?.mode === "recover" ? 320 : state.cities[key].occupation ? 65 : 140;
    if (value <= rate) delete data.labor[key];
    else data.labor[key] = value - rate;
  }
  for (const faction of Object.keys(state.factions)) {
    if (!livingSide(state, faction) || (forecast && faction !== state.player)) continue;
    const stock = state.factions[faction];
    const programs = data.economy[faction];
    if (!programs) continue;
    const treasuryFloor = realmReserve(state, faction).treasury;
    const grainFloor = Math.max(realmReserve(state, faction).grain, programs.reserve);
    let left = programs.budget;
    const pay = (cash, grain = 0) => {
      if (left < cash || stock.treasury - cash < treasuryFloor || stock.grain - grain < grainFloor) return false;
      if (!account(faction, "budget", { treasury: cash, grain })) return false;
      left -= cash;
      return true;
    };
    const notes = [];
    const hubs = [];
    for (const [region, role] of Object.entries(programs.regions)) {
      const cities = world.cities.filter(({ key, region: area }) => area === region && state.cities[key].owner === faction
        && !state.cities[key].occupation && !warBlockaded(state, key));
      if (!cities.length) continue;
      const ordinal = role === "farms" ? "farming" : "commerce";
      const hub = cities.sort((a, b) => state.cities[b.key][ordinal] - state.cities[a.key][ordinal])[0].key;
      const output = workforceYield(state, hub);
      if (role === "farms" && pay(5)) {
        const amount = Math.min(300 - (state.grand.depots[hub] ?? 0), Math.floor((12 + cities.length * 3) * output));
        state.grand.depots[hub] = (state.grand.depots[hub] ?? 0) + amount;
        if (amount) notes.push(cityName(world, hub) + "新粮入仓 " + amount);
      }
      if (role === "industry" && pay(8, 4)) {
        const amount = Math.floor((7 + cities.length + (programs.mode === "urgent" ? 5 : 0)) * output);
        state.landscape.equipment[hub] = Math.min(1000, (state.landscape.equipment[hub] ?? 0) + amount);
        notes.push(cityName(world, hub) + "制械 " + amount);
        if (programs.mode === "urgent") countLevy(state, hub, 90);
      }
      if (role === "recovery" && pay(6, 6)) {
        for (const { key } of cities) state.realm.cities[key].welfare = Math.min(100, state.realm.cities[key].welfare + 4);
        notes.push(region + "开仓休养");
      }
      hubs.push({ city: hub, role });
    }
    const to = freightTarget(world, state, faction, hubs);
    for (const { city: from, role } of hubs) {
      if (!["farms", "industry"].includes(role) || !to || to === from) continue;
      const cargo = role === "farms" ? "grain" : "equipment";
      const local = cargo === "grain" ? state.grand.depots[from] ?? 0 : state.landscape.equipment[from] ?? 0;
      const order = trustedRoute(world, state, faction, from, to, cargo, Math.min(local, programs.mode === "urgent" ? 24 : 14));
      if (!order || !pay(order.freight)) continue;
      const stores = cargo === "grain" ? state.grand.depots : state.landscape.equipment;
      stores[from] -= order.amount;
      stores[to] = (stores[to] ?? 0) + order.amount;
      notes.push(cityName(world, to) + (order.mode === "water" ? "水运" : "陆运") + " +" + order.amount + (cargo === "grain" ? " 粮" : " 军械"));
    }
    if (faction === state.player && notes.length) entries.push({ type: "notice", faction, city: to,
      text: "州郡调度 · " + notes.slice(0, 9).join(" · ") + " · 支出 " + (programs.budget - left) + " 钱。" });
  }
}

export function validIndustry(world, state, data) {
  const regions = new Set(world.cities.map(({ region }) => region));
  return plain(data.economy) && Object.entries(data.economy).every(([faction, profile]) => Object.hasOwn(state.factions, faction)
    && profile && Object.hasOwn(mobilizationModes, profile.mode) && bounded(profile.budget, 0, 120) && bounded(profile.reserve, 0, 600)
    && plain(profile.regions) && Object.entries(profile.regions).every(([region, role]) => regions.has(region) && Object.hasOwn(economicRoles, role)))
    && plain(data.labor) && Object.entries(data.labor).every(([key, value]) => Object.hasOwn(state.cities, key) && bounded(value, 1, 2300));
}
