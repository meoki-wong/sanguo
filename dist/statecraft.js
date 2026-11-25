import { availableForPosting, cityName, delegationZones, eraByYear, firstCity, gameOutcome, setNationalPolicy } from "./engine.js";
import { officerSkill } from "./campaign.js";
import { provinceRows } from "./polity-governance.js";
import { bounded, plain } from "./polities-data.js";
import { editRealmPolicy } from "./realm.js";
import { personnelMandates, settleStability, settleTalent, validStatecraftPersonnel } from "./statecraft-personnel.js";
import { startOpeningFront, validFronts } from "./front-command.js";
import { treatyTerms } from "./diplomacy.js";

export const nationalPriorities = { growth: "安民发展", muster: "全国备战", recovery: "战后恢复" };
export const regionalMandates = { growth: "经营", guard: "守备", relief: "赈抚" };
const policyByProfile = {
  growth: { front: { focus: "defense", garrison: 1100 }, rear: { focus: "auto", garrison: 600 }, priority: "development" },
  muster: { front: { focus: "defense", garrison: 1650 }, rear: { focus: "farming", garrison: 850 }, priority: "military" },
  recovery: { front: { focus: "defense", garrison: 950 }, rear: { focus: "farming", garrison: 600 }, priority: "relief" },
};

export function enableStatecraft(state) {
  if (state.statecraft) return state;
  if (!state.landscape || gameOutcome(state) !== "ongoing") throw new Error("请选择进行中的山河变局战局。");
  return { ...state, statecraft: { since: state.turn, policy: null, regions: {}, loyalty: {}, fronts: [], responses: {}, invite: null } };
}

export function configureStatecraftOpening(world, state, draft) {
  if (draft == null) return state;
  if (!plain(draft)) throw new Error("自定义战区开局无效。");
  const next = structuredClone(state);
  if (draft.depot || draft.amount) {
    if (next.cities[draft.depot]?.owner !== next.player || !bounded(draft.amount, 1, 200)
      || next.factions[next.player].grain < draft.amount) throw new Error("请选择本方粮仓并留下足量储粮。");
    next.factions[next.player].grain -= draft.amount;
    next.grand.depots[draft.depot] = draft.amount;
  }
  if (draft.truce) {
    if (draft.truce === next.player || !Object.values(next.cities).some(({ owner }) => owner === draft.truce)) throw new Error("请选择开局停战方。");
    next.treaties.push({ sides: [next.player, draft.truce].sort(), kind: "truce", expires: treatyTerms.truce.seasons });
  }
  return draft.front ? startOpeningFront(world, next, draft.front) : next;
}

function policyShape(draft) {
  return plain(draft) && Object.hasOwn(nationalPriorities, draft.profile) && Object.hasOwn(personnelMandates, draft.personnel)
    && ["development", "military", "relief", "reserveMoney", "reserveGrain"].every((key) => bounded(draft[key], 0, 600));
}

export function saveStatecraftPolicy(state, draft) {
  if (!state.statecraft || gameOutcome(state) !== "ongoing" || !policyShape(draft)) throw new Error("请选择全国方针并核对 0 至 600 的预算。");
  const { profile, personnel, development, military, relief, reserveMoney, reserveGrain } = draft;
  const model = policyByProfile[profile];
  const policy = Object.fromEntries(["front", "rear"].map((zone) => [zone, { ...model[zone], budget: 100 }]));
  const allocated = editRealmPolicy(setNationalPolicy(state, policy), { development, military, relief, priority: model.priority },
    { treasury: reserveMoney, grain: reserveGrain });
  return { ...allocated, statecraft: { ...allocated.statecraft,
    policy: { profile, personnel, development, military, relief, reserveMoney, reserveGrain } } };
}

export function saveRegionalMandate(world, state, region, draft) {
  if (!state.statecraft || gameOutcome(state) !== "ongoing" || !Object.hasOwn(regionalMandates, draft?.focus)
    || !bounded(draft.budget, 0, 100) || !bounded(draft.floor, 0, 2800)) throw new Error("请输入州郡任务、预算和驻军底线。");
  const row = provinceRows(world, state).find((row) => row.region === region);
  const officer = draft.officer || null;
  if (!row || officer && !row.cities.includes(state.stations[officer])) throw new Error("州牧须驻在本方辖区。");
  return { ...state, statecraft: { ...state.statecraft, regions: { ...state.statecraft.regions,
    [region]: { focus: draft.focus, budget: draft.budget, floor: draft.floor, officer } } } };
}

export function regionalSteward(state, row) {
  const named = state.statecraft.regions[row.region]?.officer;
  if (named && row.cities.includes(state.stations[named])) return named;
  return row.cities.map((key) => state.cities[key].governor).find(Boolean) ?? null;
}

export function prepareAdministration(world, era, state, entries) {
  const data = state.statecraft;
  if (!data?.policy) return;
  const manual = new Set(state.policyOverrides ?? []);
  const zones = delegationZones(world, state);
  const rows = provinceRows(world, state);
  const front = new Set(zones.front);
  const court = state.polity.courts[state.player];
  const leadership = [court?.head, court?.heir, court?.regent];
  const designated = new Set([...data.fronts.map(({ officer }) => officer),
    ...(state.sandtable?.wars ?? []).filter(({ status }) => status === "fighting").map(({ commander }) => commander)]);
  const unassigned = era.officers.filter(({ key, faction }) => faction === state.player && !leadership.includes(key)
    && !designated.has(key) && availableForPosting(state, key));
  const fieldReserve = new Set([...unassigned].filter(({ command, governance }) => command >= 72 && command > governance)
    .sort((a, b) => b.command - a.command).slice(0, unassigned.length >= 8 ? 3 : unassigned.length >= 4 ? 1 : 0).map(({ key }) => key));
  const candidates = unassigned.filter(({ key }) => !fieldReserve.has(key))
    .sort((a, b) => officerSkill(state, b, "governance") - officerSkill(state, a, "governance"));
  let appointments = 0;
  const headquarters = firstCity(world, state);
  const owned = rows.flatMap(({ cities }) => cities).sort((a, b) => Number(b === headquarters) - Number(a === headquarters)
    || Number(Boolean(state.cities[b].occupation)) - Number(Boolean(state.cities[a].occupation)) || Number(front.has(b)) - Number(front.has(a)));
  if (data.policy.personnel !== "manual") for (const key of owned) {
    if (manual.has(key) || state.cities[key].governor || !candidates.length) continue;
    const local = candidates.findIndex((candidate) => state.stations[candidate.key] === key);
    const [officer] = candidates.splice(local < 0 ? 0 : local, 1);
    state.cities[key].governor = officer.key;
    state.stations[officer.key] = key;
    appointments++;
  }
  if (appointments) entries.push({ type: "polity", event: "talent", faction: state.player, city: headquarters,
    text: "中枢按国策补任 " + appointments + " 位太守，优先都城、整顿区和前线。" });
}

export function applyRegionalMandates(world, state) {
  if (!state.statecraft) return;
  const manual = new Set(state.policyOverrides ?? []);
  for (const row of provinceRows(world, state)) {
    const order = state.statecraft.regions[row.region];
    const steward = regionalSteward(state, row);
    if (!order || !steward) continue;
    const focus = { growth: "auto", guard: "defense", relief: "farming" }[order.focus];
    const cities = row.cities.filter((key) => state.cities[key].governor && !manual.has(key))
      .sort((a, b) => state.cities[a].troops - state.cities[b].troops);
    for (const [index, key] of cities.entries()) {
      const city = state.cities[key];
      const works = order.focus === "relief" ? Math.ceil(order.budget / 2) : order.budget;
      const share = Math.floor(works / cities.length) + Number(index < works % cities.length);
      Object.assign(city, { mode: "delegated", focus: city.troops < order.floor ? "recruit" : focus, delegateBudget: share });
    }
  }
}

export function statecraftLedger() {
  return { budget: { treasury: 0, grain: 0 }, in: { treasury: 0, grain: 0 }, out: { treasury: 0, grain: 0 } };
}

export function settleStatecraft(world, state, entries, ledger, forecast = false) {
  if (!state.statecraft) return;
  if (gameOutcome(state) === "ongoing") settleTalent(world, state, entries, ledger, forecast);
  settleStability(world, state, entries, ledger, forecast);
}

export function statecraftBrief(world, state) {
  const data = state.statecraft;
  const rows = provinceRows(world, state);
  const era = eraByYear(world, state);
  const alerts = rows.flatMap((row) => row.pressure >= 55 ? [{ region: row.region, title: row.region + (row.crisis ? "危机" : "告急"),
    text: "压力 " + row.pressure + " · 民生 " + row.welfare, city: row.cities[0] }] : []);
  for (const person of era.officers.filter(({ faction, key }) => faction === state.player && data.loyalty[key]?.warning !== null
    && data.loyalty[key]?.warning !== undefined && state.stations[key])) {
    const city = state.stations[person.key];
    const region = world.cities.find(({ key }) => key === city).region;
    if (!alerts.some((row) => row.region === region)) alerts.push({ title: person.name + "离心", text: cityName(world, city) + " · 可安排巡抚安抚", region, city });
  }
  return { managed: Object.values(state.cities).filter((city) => city.owner === state.player && city.mode === "delegated").length,
    held: Object.values(state.cities).filter((city) => city.owner === state.player).length, alerts, rows };
}

export function validStatecraft(world, state, officers) {
  if (state.statecraft === undefined) return true;
  const data = state.statecraft;
  const regions = new Set(world.cities.map(({ region }) => region));
  return Boolean(state.landscape && plain(data) && bounded(data.since, state.landscape.since, state.turn)
    && (data.policy === null || policyShape(data.policy)) && plain(data.regions)
    && Object.entries(data.regions).every(([key, order]) => regions.has(key) && order && Object.hasOwn(regionalMandates, order.focus)
      && bounded(order.budget, 0, 100) && bounded(order.floor, 0, 2800) && (order.officer === null || officers.has(order.officer)))
    && validStatecraftPersonnel(world, state, officers, data) && validFronts(state, data, officers));
}
