import { armyByOfficer } from "./armies.js";
import { cityName, eraByYear, gameOutcome } from "./engine.js";
import { formPolity } from "./polity-handover.js";
import { newCourt, polityEntry } from "./polity-governance.js";
import { bounded, livingSide, plain } from "./polities-data.js";

export const regimeTerms = { pay: "补发军饷", pardon: "招抚议任", replace: "撤换兵权" };

export function branchChoices(state) {
  if (!state.sandtable) return [];
  return state.polity.parties.filter(({ key, origin }) => origin === state.player && livingSide(state, key));
}

export function continueAs(world, state, faction) {
  if (!branchChoices(state).some(({ key }) => key === faction)) throw new Error("只能接手从本方分出的现存势力。");
  const next = structuredClone(state);
  const previous = next.player;
  const seat = next.polity.parties.find(({ key }) => key === faction).city;
  next.sandtable.branches = [...next.sandtable.branches, { previous, faction, turn: state.turn, city: seat }].slice(-16);
  next.history = next.history.map((report) => ({ ...report, viewer: report.viewer ?? previous }));
  next.player = faction;
  next.orders = [];
  delete next.strategies[faction];
  next.treatyOffers = [];
  next.incomingTreaty = null;
  next.stageCompletedAt = null;
  for (const key of ["theaters", "warBudget", "delegationReserve", "delegationPriority", "nationalPolicy", "policyOverrides",
    "campaignMilestones", "campaignEvents", "campaignRecord", "scenarioEnding", "personnelHistory", "officerService"]) delete next[key];
  for (const city of Object.values(next.cities)) if (city.owner === previous && city.focus === "auto") city.focus = "farming";
  Object.assign(next.realm, { offices: {}, service: [], coalition: { partners: [], streak: 0 } });
  next.realm.proposals = next.realm.proposals.filter(({ answer }) => answer === undefined);
  Object.assign(next.war, { scouts: [], recovery: null, milestones: [] });
  Object.assign(next.polity, { calm: 0, lastBreach: null, peaceDeals: 0, edict: null });
  Object.assign(next.grand, { campaigns: [], national: { treasury: 0, grain: 0, reserve: 0 } });
  next.grand.offers = next.grand.offers.filter(({ answer }) => answer === undefined);
  Object.assign(next.statecraft, { policy: null, regions: {}, fronts: [], responses: {}, invite: null });
  next.sandtable.postOrders = [];
  return next;
}

export function orderRegimeResponse(state, officer, kind) {
  const row = state.sandtable?.unrest[officer];
  if (!row || row.faction !== state.player || gameOutcome(state) !== "ongoing" || !Object.hasOwn(regimeTerms, kind)) {
    throw new Error("请选择本方已出现的军政争议。");
  }
  const next = structuredClone(state);
  next.sandtable.unrest[officer].response = kind;
  return next;
}

function supplyCrisis(state, unit) {
  const loyalty = state.statecraft.loyalty[unit.officer]?.value ?? 55;
  const stock = state.factions[unit.faction];
  return (loyalty < 35 || stock.morale < 38) && unit.grain <= 3 && unit.troops >= 500;
}

export function settleRegimes(world, state, entries, account) {
  const data = state.sandtable;
  const era = eraByYear(world, state);
  const date = state.turn + 1;
  for (const [officer, row] of Object.entries(data.unrest)) {
    const army = armyByOfficer(state, officer);
    if (!army || army.faction !== row.faction || (!supplyCrisis(state, army) && !row.response)) delete data.unrest[officer];
  }
  for (const unit of [...(state.armies ?? [])]) {
    const { faction, officer, location } = unit;
    const leader = era.officers.find(({ key }) => key === officer);
    if (state.cities[location].owner !== faction) continue;
    const tracked = data.unrest[officer];
    if (!tracked && !supplyCrisis(state, unit)) continue;
    const report = (event, text, other) => entries.push(polityEntry(event, faction, text, {
      city: location, officer, ...(other ? { participants: [faction, other] } : {}),
    }));
    const risk = data.unrest[officer] ??= { faction, city: location, since: date, response: null };
    risk.city = location;
    if (!tracked) report("military-warning", leader.name + "军团缺粮离心，要求朝廷处置。");
    if (risk.response) {
      const fee = risk.response === "pay" ? { treasury: 26, grain: 12 } : { treasury: 14, grain: 6 };
      if (account(faction, "budget", fee)) {
        if (risk.response === "replace") {
          state.cities[location].troops += unit.troops;
          state.stations[officer] = location;
          state.armies = state.armies.filter((row) => row.officer !== officer);
          const plans = (state.theaters ?? []).filter(({ commander, army }) => commander !== officer && army !== officer);
          if (plans.length) state.theaters = plans;
          else delete state.theaters;
        } else unit.grain += fee.grain;
        state.statecraft.loyalty[officer] = { value: risk.response === "pardon" ? 65 : 52, warning: null };
        state.factions[faction].morale = Math.min(100, state.factions[faction].morale + 8);
        report("military-settled", leader.name + "军团按" + regimeTerms[risk.response] + "方案处置。");
        delete data.unrest[officer];
        continue;
      }
    }
    if (date - risk.since < 2 || !supplyCrisis(state, unit)) continue;
    if (Object.values(state.cities).filter(({ owner }) => owner === faction).length < 2) continue;
    const founded = formPolity(world, eraByYear(world, state, date), state, faction,
      world.cities.find(({ key }) => key === location).region, [location], date, "mutiny");
    if (!founded) continue;
    state.polity.courts[founded.key] = newCourt(state, founded.key, date, founded.leader);
    if (faction === state.player) {
      // The existing handover spends the originating treasury and transfers title, people and forces.
      state.factions[faction].treasury += founded.treasury;
      state.factions[faction].grain += founded.grain;
      account(faction, "out", { treasury: founded.treasury, grain: founded.grain });
    }
    report("military-mutiny", leader.name + "部兵变，" + cityName(world, location) + "脱离原势力。", founded.key);
    delete data.unrest[officer];
  }
  if (state.armies?.length === 0) delete state.armies;
}

export function validRegimes(state, data, officers) {
  const side = (key) => Object.hasOwn(state.factions, key);
  const city = (key) => Object.hasOwn(state.cities, key);
  const date = (value) => bounded(value, data.since, state.turn);
  return plain(data.unrest) && Object.entries(data.unrest).every(([key, row]) => officers.has(key) && row && side(row.faction)
    && city(row.city) && date(row.since) && (row.response === null || Object.hasOwn(regimeTerms, row.response)))
    && Array.isArray(data.branches) && data.branches.length <= 16 && data.branches.every((row) => row && side(row.previous)
      && side(row.faction) && row.previous !== row.faction && date(row.turn) && city(row.city));
}
