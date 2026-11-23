import { legalChoices } from "./decisions.js";
import { describeOrder, eraByYear } from "./engine.js";
import { factionPlans, sameGoal } from "./strategy.js";

// Replay decisions locally when the running service predates the current settlement format.
export function legacySnapshot(world, state, turnVersion) {
  const snapshot = structuredClone(state);
  if (!(turnVersion >= 24)) {
    delete snapshot.war;
    for (const unit of snapshot.armies ?? []) {
      delete unit.engagement;
      delete unit.stance;
    }
    for (const plan of snapshot.theaters ?? []) delete plan.operation;
    for (const order of snapshot.orders ?? []) delete order.stance;
    for (const item of [...(snapshot.realm?.proposals ?? []), ...(snapshot.realm?.accords ?? [])]) delete item.coordination;
  }
  if (!(turnVersion >= 23)) {
    delete snapshot.realm;
    for (const plan of snapshot.theaters ?? []) delete plan.backup;
    for (const report of snapshot.history) {
      const ledger = report.finance;
      if (!ledger?.realm) continue;
      const { commerce, aidIn, aidOut, relief } = ledger.realm;
      ledger.trade += commerce;
      ledger.tax.grain += aidIn;
      ledger.orders.grain += aidOut + relief.grain;
      ledger.orders.treasury += relief.treasury;
      for (const program of ledger.programs) {
        if (program.result === "national-budget") program.result = "budget";
        if (program.result === "population") program.result = "garrison";
      }
      delete ledger.realm;
    }
  }
  if (!(turnVersion >= 22)) {
    delete snapshot.theaters;
    delete snapshot.warBudget;
    delete snapshot.campaignRecord;
    delete snapshot.scenarioEnding;
    delete snapshot.recruitedOfficers;
    const reserve = (key) => typeof key === "string" && key.includes("-talent-");
    if (snapshot.orders) snapshot.orders = snapshot.orders.filter((order) => order.type !== "appoint-governor" && !reserve(order.officer));
    if (snapshot.armies) snapshot.armies = snapshot.armies.filter(({ officer }) => !reserve(officer));
    for (const key of Object.keys(snapshot.stations ?? {})) if (reserve(key)) delete snapshot.stations[key];
    for (const key of Object.keys(snapshot.officerService ?? {})) if (reserve(key)) delete snapshot.officerService[key];
    for (const city of Object.values(snapshot.cities)) {
      if (reserve(city.governor)) { city.governor = null; city.mode = "direct"; }
      if (reserve(city.commander)) city.commander = null;
    }
    if (snapshot.delegationPriority) snapshot.delegationPriority = snapshot.delegationPriority.filter((key) => snapshot.cities[key].mode === "delegated");
    if (snapshot.personnelHistory) snapshot.personnelHistory = snapshot.personnelHistory.filter(({ officer }) => !reserve(officer));
    if (snapshot.campaignEvents) {
      snapshot.campaignEvents.records = snapshot.campaignEvents.records.filter(({ kind }) => kind !== "historical");
      const proposal = snapshot.campaignEvents.pending;
      if (proposal?.kind === "historical" || reserve(proposal?.officer)) snapshot.campaignEvents.pending = null;
    }
    for (const report of snapshot.history) for (const entry of report.entries) {
      const people = entry.battle?.personnel;
      if (people && (reserve(people.attacker) || reserve(people.defender) || people.relocated?.some(({ officer }) => reserve(officer)))) {
        delete entry.battle.personnel;
      }
      if (reserve(entry.personnelChange?.officer)) delete entry.personnelChange;
    }
  }
  if (!(turnVersion >= 21)) {
    delete snapshot.armies;
    if (snapshot.orders) snapshot.orders = snapshot.orders.filter(({ type }) => type !== "mobilize");
    for (const report of snapshot.history) {
      if (report.decisions) report.decisions = report.decisions.filter(({ orderType }) => orderType !== "mobilize");
      if (report.finance?.armyReturns !== undefined) {
        report.finance.tax.grain += report.finance.armyReturns;
        delete report.finance.armyReturns;
      }
      for (const entry of report.entries) {
        const occupation = entry.battle?.occupation;
        if (occupation?.inArmy !== undefined) {
          occupation.garrison += occupation.inArmy;
          delete occupation.inArmy;
        }
      }
    }
  }
  if (!(turnVersion >= 20)) for (const key of ["campaignMilestones", "campaignEvents", "officerService", "nationalPolicy", "policyOverrides"]) {
    delete snapshot[key];
  }
  if (!(turnVersion >= 18)) delete snapshot.delegationReserve;
  if (!(turnVersion >= 12)) delete snapshot.delegationPriority;
  if (!(turnVersion >= 13) && snapshot.orders?.some(({ type, route }) => type === "transfer" && route !== undefined)) snapshot.orders = [];
  if (!(turnVersion >= 16)) delete snapshot.personnelHistory;
  if (!(turnVersion >= 17)) for (const city of Object.values(snapshot.cities)) {
    if (city.focus === "auto") city.focus = "farming";
  }
  for (const report of snapshot.history) {
    if (!(turnVersion >= 19)) for (const decision of report.decisions ?? []) delete decision.entryIndex;
    if (!(turnVersion >= 18) && report.finance) {
      delete report.finance.reserve;
      for (const program of report.finance.programs) {
        if (program.result.startsWith("reserve-")) program.result = program.result.slice("reserve-".length);
        delete program.adjustedForReserve;
      }
    }
    if (!(turnVersion >= 17)) for (const program of report.finance?.programs ?? []) {
      if (program.focus !== "auto") continue;
      program.focus = program.project ?? "farming";
      delete program.project;
    }
    if (!(turnVersion >= 16)) for (const entry of report.entries) delete entry.personnelChange;
    if (!(turnVersion >= 10)) for (const entry of report.entries) delete entry.battle;
    else if (!(turnVersion >= 15)) for (const entry of report.entries) {
      if (entry.battle) delete entry.battle.personnel;
    }
    if (!(turnVersion >= 11) && report.decisions) report.decisions = report.decisions.filter(({ orderType }) => orderType !== "appoint-governor");
    if (!(turnVersion >= 14) && report.decisions) report.decisions = report.decisions.filter(({ orderType }) => orderType !== "delegate-city");
  }
  if (turnVersion >= 9) return snapshot;
  delete snapshot.treatyOffers;
  delete snapshot.incomingTreaty;
  delete snapshot.stageCompletedAt;
  for (const report of snapshot.history) {
    delete report.finance;
    if (report.decisions) report.decisions = report.decisions.filter(({ orderType }) => orderType !== "deploy");
  }
  if (turnVersion >= 5) {
    snapshot.orders = [];
    return snapshot;
  }
  delete snapshot.treaties;
  if (turnVersion === 4) {
    snapshot.orders = [];
    return snapshot;
  }
  delete snapshot.strategies;
  if (turnVersion === 3) {
    snapshot.orders = [];
    return snapshot;
  }
  delete snapshot.orders;
  snapshot.order = null;
  for (const report of snapshot.history) {
    if (report.decisions) report.decisions = report.decisions.filter(({ orderType }) => orderType !== "transfer");
  }
  if (turnVersion === 2) return snapshot;
  delete snapshot.stations;
  const roster = new Set(eraByYear(world, state).officers.map(({ key }) => key));
  for (const city of Object.values(snapshot.cities)) {
    if (!roster.has(city.governor)) city.governor = null;
    if (!roster.has(city.commander)) city.commander = null;
    if (!city.governor) city.mode = "direct";
    if (city.focus === "recruit") city.focus = "farming";
    delete city.delegateBudget;
  }
  return snapshot;
}

export function legacyProposals(world, snapshot, report, opponents, turnVersion) {
  const era = eraByYear(world, snapshot);
  const decisions = report?.decisions;
  if (!Array.isArray(decisions)) throw new Error("模型返回的回合记录无效");
  return Object.fromEntries(opponents.map(({ key }) => {
    const decision = decisions.find((item) => item.faction === key);
    if (decision?.source === "model") {
      const strategic = turnVersion >= 4;
      const legacy = !(turnVersion >= 9);
      const choices = strategic
        ? factionPlans(world, era, snapshot, key, {
          allowDeployment: !legacy, allowRecoveryAppointments: turnVersion >= 11, allowDomesticDelegation: turnVersion >= 14,
          adaptive: turnVersion >= 20, allowArmies: turnVersion >= 21, allowTheaters: turnVersion >= 22,
        }).choices
        : legalChoices(world, era, snapshot, key);
      const choice = choices.find(({ order, goal }) => describeOrder(world, era, order) === decision.action
        && (!strategic || sameGoal(goal, decision.strategy?.goal)));
      if (choice) return [key, { source: "model", legacy, reason: decision.reason, order: choice.order, ...(choice.goal ? { goal: choice.goal } : {}) }];
    }
    if (turnVersion >= 9 && decision?.source === "rules") return [key, { source: "rules" }];
    return [key, { source: "fallback", reason: decision?.source === "fallback" ? decision.reason : "模型政令未能识别" }];
  }));
}
