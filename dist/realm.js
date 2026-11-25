import { awardService, officerSkill } from "./campaign.js";
import { armyByOfficer } from "./armies.js";
import { cityName, eraByYear, gameOutcome, pendingExpedition, postingOf, previewOrders } from "./engine.js";
import { funds, validResourcePair } from "./finance.js";
import { isHostile } from "./diplomacy.js";
import { formerlyServed } from "./polities-data.js";
import { countLevy } from "./sandtable-economy.js";

export const realmOffices = { civil: "内政", envoy: "外交", marshal: "军务" };
export const realmBudgetNames = { development: "发展", military: "军备", relief: "救济" };
const defaultPolicy = { development: 80, military: 75, relief: 24, priority: "military" };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const record = (value) => value && typeof value === "object" && !Array.isArray(value);

export function startRealm(world, state) {
  if (state.realm) return state;
  const cities = Object.fromEntries(world.cities.map(({ key }, index) => {
    const baseline = 9000 + (index * 307) % 3600;
    return [key, { baseline, population: baseline, welfare: state.cities[key].occupation ? 46 : 68 }];
  }));
  return { ...state, realm: { since: state.turn, cities, policy: { ...defaultPolicy },
    offices: {}, service: [], accords: [], proposals: [], relations: {}, reports: [], coalition: { streak: 0, partners: [] } } };
}

function goodPolicy(value) {
  return record(value) && Object.keys(realmBudgetNames).every((key) => bounded(value[key], 0, 9999))
    && Object.hasOwn(realmBudgetNames, value.priority);
}

export function editRealmPolicy(state, policy, reserve) {
  if (!state.realm || gameOutcome(state) !== "ongoing" || !goodPolicy(policy) || !validResourcePair(reserve)
    || !Object.values(funds(reserve)).every((amount) => bounded(amount, 0, 9999))) throw new Error("请核对预算和钱粮预留。");
  return { ...state, delegationReserve: funds(reserve), realm: { ...state.realm, policy: {
    development: policy.development, military: policy.military, relief: policy.relief, priority: policy.priority,
  } } };
}

export function realmPolicy(state, faction) {
  if (!state.realm) return null;
  if (state.player === faction) return state.realm.policy;
  const held = Object.values(state.cities).filter(({ owner }) => owner === faction).length;
  const goal = state.strategies[faction]?.type;
  return { development: 20 + held * 9, military: 25 + held * 12, relief: 8 + held * 4,
    priority: goal === "defend" || goal === "expand" ? "military" : "relief" };
}

export function realmReserve(state, faction) {
  const ordinary = faction === state.player ? state.delegationReserve ?? { treasury: 0, grain: 0 } : { treasury: 20, grain: 12 };
  const policy = state.dynasty?.policies[faction];
  return policy ? { treasury: Math.max(ordinary.treasury, policy.moneyFloor), grain: Math.max(ordinary.grain, policy.grainFloor) } : ordinary;
}

export function nationalDuty(state, person) {
  return person && Object.entries(state.realm?.offices ?? {}).find(([, { holder }]) => holder === person)?.[0];
}

export function officeCandidates(era, state, role) {
  return era.officers.filter(({ key, faction }) => faction === state.player && state.stations[key]
    && !postingOf(state, key) && !pendingExpedition(state, key) && !armyByOfficer(state, key)
    && !state.theaters?.some(({ commander }) => commander === key)
    && (!nationalDuty(state, key) || nationalDuty(state, key) === role)
    && !Object.entries(state.realm.offices).some(([other, { deputy }]) => other !== role && key === deputy));
}

export function officeSkill(era, state, role) {
  const key = state.realm?.offices[role]?.holder;
  if (!key || !state.stations[key] || postingOf(state, key) || armyByOfficer(state, key)) return 0;
  const officer = era.officers.find((person) => person.key === key);
  return officerSkill(state, officer, role === "marshal" ? "command" : "governance");
}

function serviceEntry(state, role, person, kind, detail) {
  state.realm.service = [...state.realm.service, { turn: state.turn + (kind === "appointed" || kind === "dismissed" ? 0 : 1),
    role, person, kind, detail }].slice(-60);
}

export function assignRealmOffice(world, state, role, holder, deputy) {
  if (!state.realm || gameOutcome(state) !== "ongoing" || !Object.hasOwn(realmOffices, role)) throw new Error("这个国级职务不可用。");
  const era = eraByYear(world, state);
  const candidates = new Set(officeCandidates(era, state, role).map(({ key }) => key));
  if ([holder, deputy].some((key) => key !== null && !candidates.has(key)) || (holder && holder === deputy)) throw new Error("请选择无冲突的待任官员和代理人。");
  const next = structuredClone(state);
  const old = state.realm.offices[role]?.holder;
  next.realm.offices[role] = { holder, deputy };
  if (old && old !== holder) serviceEntry(next, role, old, "dismissed", "离任");
  if (holder && old !== holder) serviceEntry(next, role, holder, "appointed", "任职");
  previewOrders(world, next);
  return next;
}

export function settleRealmOffices(era, previous, state, captured, entries) {
  if (!state.realm) return;
  for (const [role, seat] of Object.entries(state.realm.offices)) {
    if (seat.holder && (!state.stations[seat.holder] || captured.has(previous.stations[seat.holder]))) {
      serviceEntry(state, role, seat.holder, "vacant", "驻地失守或离开任用范围");
      seat.holder = null;
      entries.push({ type: "realm", faction: state.player, text: realmOffices[role] + "官去职，职位待补。" });
    }
    if (!seat.holder && seat.deputy && officeCandidates(era, state, role).some(({ key }) => key === seat.deputy)) {
      seat.holder = seat.deputy;
      seat.deputy = null;
      serviceEntry(state, role, seat.holder, "succeeded", "代理接任");
      const person = era.officers.find(({ key }) => key === seat.holder);
      entries.push({ type: "realm", faction: state.player, text: person.name + "接任" + realmOffices[role] + "。" });
    }
  }
}

export function markRealmService(state, role, detail, good = true) {
  const person = state.realm?.offices[role]?.holder;
  if (!person) return;
  serviceEntry(state, role, person, good ? "merit" : "fault", detail);
  if (good) awardService(state, person, role === "marshal" ? "command" : "governance");
}

export function incomeFactor(demographics) {
  if (!demographics) return 100;
  const { population, baseline, welfare } = demographics;
  return clamp(Math.round(100 * population / baseline) + Math.floor((welfare - 68) / 10) * 3, 45, 125);
}

export function noteRecruitment(state, key, count) {
  const city = state.realm?.cities[key];
  if (!city) return;
  countLevy(state, key, count);
  city.population = Math.max(800, city.population - count);
  city.welfare = Math.max(10, city.welfare - Math.ceil(count / 220));
}

export function disasterCity(world, state, faction) {
  if (state.turn % 4 !== 2) return null;
  const regions = [...new Set(world.cities.map(({ region }) => region))];
  const region = regions[(state.year + Math.floor(state.turn / 4)) % regions.length];
  const ordered = world.cities.filter(({ key, region: name }) => name === region && state.cities[key].owner === faction);
  return ordered[0]?.key ?? null;
}

export function settlePopulation(world, era, state, captured, entries, playerOnly = false) {
  if (!state.realm) return { treasury: 0, grain: 0 };
  const spent = { treasury: 0, grain: 0 };
  const affected = new Map(era.factions.map(({ key }) => [key, disasterCity(world, state, key)]));
  const protectedCities = new Set();
  const priority = new Set(state.delegationPriority);
  const ranked = [...world.cities].sort(({ key: a }, { key: b }) => Number(priority.has(b)) - Number(priority.has(a))
    || state.realm.cities[a].welfare - state.realm.cities[b].welfare);
  const caps = new Map(era.factions.map(({ key }) => [key, realmPolicy(state, key).relief]));
  for (const { key, links } of ranked) {
    const city = state.cities[key];
    const { owner } = city;
    if (playerOnly && owner !== state.player) continue;
    const population = state.realm.cities[key];
    const disaster = affected.get(owner) === key;
    const battle = captured.has(key);
    const danger = links.some((link) => isHostile(state, owner, state.cities[link].owner));
    const loss = battle ? 600 : disaster ? 320 : city.occupation ? 100 : 0;
    population.population = clamp(population.population - loss + (!loss ? (danger ? 40 : 115) + 12 * city.farming : 0),
      800, Math.floor(population.baseline * 1.28));
    population.welfare = clamp(population.welfare + (battle ? -16 : disaster ? -11 : city.occupation ? -4 : danger ? 0 : 2), 10, 100);
    if ((population.welfare > 57 && !disaster) || (city.mode === "direct" && state.policyOverrides?.includes(key))) continue;
    const stock = state.factions[owner];
    const reserve = realmReserve(state, owner);
    const treasury = owner === state.player && officeSkill(era, state, "civil") >= 82 ? 5 : 7;
    const grain = 9;
    if (caps.get(owner) >= treasury && stock.treasury - reserve.treasury >= treasury && stock.grain - reserve.grain >= grain) {
      caps.set(owner, caps.get(owner) - treasury);
      stock.treasury -= treasury;
      stock.grain -= grain;
      population.welfare = Math.min(100, population.welfare + 9);
      protectedCities.add(key);
      if (owner === state.player) {
        spent.treasury += treasury;
        spent.grain += grain;
        entries.push({ type: "realm", faction: owner, city: key, text: cityName(world, key) + "赈济完成，民心回升。" });
      }
    }
    if (disaster && !protectedCities.has(key)) entries.push({ type: "realm", faction: owner, city: key,
      text: cityName(world, key) + "歉收，人口和民心下降，赈济待拨款。" });
  }
  if (!playerOnly && spent.treasury) markRealmService(state, "civil", "主持赈济");
  if (!playerOnly && affected.get(state.player) && !protectedCities.has(affected.get(state.player))) {
    markRealmService(state, "civil", "受灾城赈济未拨", false);
  }
  return spent;
}

export function validRealm(world, state, officers) {
  const data = state.realm;
  if (data === undefined) return true;
  if (!record(data) || !bounded(data.since, 0, state.turn) || !goodPolicy(data.policy) || !record(data.cities)
    || Object.keys(data.cities).length !== world.cities.length || !record(data.offices)) return false;
  if (!world.cities.every(({ key }) => {
    const city = data.cities[key];
    return city && bounded(city.baseline, 9000, 12600)
      && bounded(city.population, 800, Math.floor(city.baseline * 1.28)) && bounded(city.welfare, 10, 100);
  })) return false;
  const staff = new Set();
  for (const [role, appointment] of Object.entries(data.offices)) {
    if (!Object.hasOwn(realmOffices, role) || !record(appointment)) return false;
    for (const key of [appointment.holder, appointment.deputy]) {
      if (key === null) continue;
      if (officers.get(key)?.faction !== state.player || staff.has(key)) return false;
      staff.add(key);
    }
  }
  return Array.isArray(data.service) && data.service.length <= 60 && data.service.every((entry) =>
    entry && bounded(entry.turn, data.since, state.turn) && Object.hasOwn(realmOffices, entry.role)
    && (officers.get(entry.person)?.faction === state.player || formerlyServed(state, entry.person, state.player))
    && ["appointed", "dismissed", "vacant", "succeeded", "merit", "fault"].includes(entry.kind)
    && typeof entry.detail === "string" && entry.detail.length <= 40);
}
