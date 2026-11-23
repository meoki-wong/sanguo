import { officerSkill } from "./campaign.js";
import { availableForPosting, cityName, cityReserve, gameOutcome, minimumMarch, needsRecoveryGovernor, transferGrain, transferRoutesTo } from "./engine.js";
import { realmReserve } from "./realm.js";
import { warReport } from "./war-operations.js";

const limit = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 999;

export function recoveryRows(world, state) {
  return world.cities.filter(({ key }) => state.cities[key].owner === state.player && state.cities[key].occupation)
    .map(({ key, name }) => {
      const site = state.cities[key];
      return { key, name, troops: site.troops, shortage: Math.max(0, cityReserve - site.troops), governor: site.governor,
        population: state.realm?.cities[key], occupation: site.occupation, queued: state.war?.recovery?.follow || state.war?.recovery?.cities.includes(key) };
    }).sort((a, b) => b.shortage - a.shortage);
}

export function saveRecovery(world, state, options) {
  if (!state.war || gameOutcome(state) !== "ongoing") throw new Error("当前无法发出接管委任。");
  if (options === null) return { ...state, war: { ...state.war, recovery: null } };
  const { treasury, grain, follow, cities } = options;
  const eligible = new Set(recoveryRows(world, state).map(({ key }) => key));
  if (!limit(treasury) || !limit(grain) || typeof follow !== "boolean" || !Array.isArray(cities)
    || cities.some((key) => !eligible.has(key)) || (!follow && !cities.length)) throw new Error("请选择待整顿城池，或勾选自动接管后续新城。");
  return { ...state, war: { ...state.war, recovery: { treasury, grain, follow, cities: [...new Set(cities)],
    aided: (state.war.recovery?.aided ?? []).filter((key) => eligible.has(key)) } } };
}

export function validRecovery(state) {
  const item = state.war.recovery;
  const cities = (keys) => Array.isArray(keys) && keys.length <= Object.keys(state.cities).length
    && new Set(keys).size === keys.length && keys.every((key) => Object.hasOwn(state.cities, key));
  return item === null || Boolean(item && limit(item.treasury) && limit(item.grain) && typeof item.follow === "boolean"
    && cities(item.cities) && cities(item.aided));
}

export function settleWarRecovery(world, era, state, entries, slots, order) {
  const plan = state.war?.recovery;
  if (!plan) return;
  const stock = state.factions[state.player];
  const reserve = realmReserve(state, state.player);
  let grain = plan.grain;
  let treasury = plan.treasury;
  const candidates = era.officers.filter(({ key, faction }) => faction === state.player && availableForPosting(state, key)
    && !(state.theaters ?? []).some((theater) => theater.commander === key))
    .sort((a, b) => officerSkill(state, b, "governance") - officerSkill(state, a, "governance"));
  for (const { key, name, shortage } of recoveryRows(world, state).filter(({ queued }) => queued)) {
    const site = state.cities[key];
    const donors = shortage && slots > 0 ? transferRoutesTo(world, state, key).map((route) => {
      const from = route[0];
      const troops = Math.min(Math.max(minimumMarch, shortage), state.cities[from].troops - 900);
      return { type: "transfer", from, to: key, troops, ...(route.length > 2 ? { route } : {}) };
    }).filter((draft) => draft.troops >= minimumMarch && !state.cities[draft.from].occupation
      && transferGrain(draft) <= Math.min(grain, stock.grain - reserve.grain)) : [];
    if (donors.length) {
      const draft = donors.sort((a, b) => transferGrain(a) - transferGrain(b))[0];
      const entry = order(draft);
      if (entry.type !== "notice") {
        slots -= 1;
        grain -= transferGrain(draft);
        entries.push(entry, warReport("secured", state.player, key, name + "增拨驻军，接管开始。", { cost: transferGrain(draft) }));
      }
    }
    if (slots > 0 && candidates.length && needsRecoveryGovernor(site)) {
      const person = candidates.shift();
      const entry = order({ type: "appoint-governor", city: key, officer: person.key });
      if (entry.type !== "notice") {
        slots -= 1;
        entries.push(entry, warReport("secured", state.player, key, person.name + "接任" + name + "太守，主持整顿。", { officer: person.key }));
      }
    }
    const population = state.realm?.cities[key];
    if (population && population.welfare < 62 && !plan.aided.includes(key)
      && Math.min(grain, stock.grain - reserve.grain) >= 8 && Math.min(treasury, stock.treasury - reserve.treasury) >= 8) {
      stock.grain -= 8;
      grain -= 8;
      stock.treasury -= 8;
      treasury -= 8;
      population.welfare = Math.min(100, population.welfare + 12);
      plan.aided.push(key);
      entries.push(warReport("aid", state.player, key, name + "按接管方案拨赈济 8 钱、8 粮。", { cost: 8 }));
    }
  }
}

export function finishWarRecovery(world, before, state, entries) {
  if (!state.war) return;
  const plan = state.war.recovery;
  for (const { key, name } of world.cities) {
    if (state.cities[key].owner !== state.player || state.cities[key].occupation || !before.cities[key].occupation) continue;
    entries.push(warReport("restored", state.player, key, name + "完成整顿，恢复全额税粮。"),
      warReport("road", state.player, key, name + "解除整顿通行限制，可重新核定粮道与商路。"));
  }
  if (!plan) return;
  const pending = (key) => state.cities[key].owner === state.player && state.cities[key].occupation > 0;
  plan.cities = plan.cities.filter(pending);
  plan.aided = plan.aided.filter(pending);
  if (!plan.follow && !plan.cities.length) state.war.recovery = null;
}
