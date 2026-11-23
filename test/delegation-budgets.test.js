import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advanceQuarter, applyDelegationBudgetAdjustments, createGame, delegateCities, delegationBudgetAdjustments,
  forecastDelegationBudgets, playableFactions, queueOrder, setDelegationPriority, setDelegationReserve, setGovernance } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function budgetFixture() {
  let state = createGame(world, 199, "cao");
  state.factions.cao.treasury = 0;
  Object.assign(state.cities.puyang, { farming: 4, commerce: 0, defense: 4 });
  Object.assign(state.cities.luoyang, { occupation: 2, troops: 200 });
  state = delegateCities(world, state, ["wan"], "defense", 0);
  state = delegateCities(world, state, ["puyang"], "auto", 0);
  state = delegateCities(world, state, ["xu"], "farming", 18);
  state = delegateCities(world, state, ["luoyang"], "defense", 0);
  state = setDelegationPriority(state, ["wan", "puyang"]);
  return queueOrder(world, state, { type: "transfer", from: "xu", to: "chenliu", troops: 200 });
}

test("budget previews raise actual caps and reforecast other programs competing for the same treasury", () => {
  const state = budgetFixture();
  const before = structuredClone(state);
  const plan = forecastDelegationBudgets(world, state);
  assert.deepEqual(state, before);
  assert.deepEqual(plan.adjustments.map(({ city, previous, budget, program }) => [city, previous, budget, program.result]), [
    ["puyang", 0, 15, "completed"], ["wan", 0, 19, "completed"],
  ]);
  assert.equal(plan.adjustments[0].program.project, "commerce");
  assert.equal(plan.adjustments[0].program.action, "商贸升至 1 级");
  assert.deepEqual(plan.effects.map(({ previous, program }) => [program.city, previous.result, program.result]), [["xu", "completed", "treasury"]]);
  assert.equal(plan.previousClosing.treasury, 26);
  assert.equal(plan.closing.treasury, 7);

  const staged = applyDelegationBudgetAdjustments(state, plan.adjustments);
  const loaded = readGameRecord(world, createSaveBackup({ state: staged, selected: "puyang" })).state;
  assert.deepEqual(loaded.orders, before.orders);
  assert.deepEqual(loaded.factions, before.factions);
  assert.deepEqual(loaded.personnelHistory, before.personnelHistory);
  assert.deepEqual(loaded.delegationPriority, before.delegationPriority);
  assert.equal(loaded.cities.puyang.focus, "auto");
  assert.equal(loaded.cities.luoyang.delegateBudget, 0);
  const rest = Object.fromEntries(playableFactions(world.scenarios[0]).filter(({ key }) => key !== "cao")
    .map(({ key }) => [key, { source: "model", order: null }]));
  const settled = advanceQuarter(world, loaded, rest);
  assert.deepEqual(settled.history.at(-1).finance.closing, plan.closing);
  assert.equal(settled.cities.puyang.commerce, 1);
});

test("budget previews preserve reserves and reject stale, foreign and direct holdings", () => {
  const state = setDelegationReserve(budgetFixture(), { treasury: 17, grain: 0 });
  const plan = forecastDelegationBudgets(world, state);
  assert.equal(plan.adjustments[1].program.result, "reserve-treasury");
  assert.equal(plan.effects[0].program.result, "reserve-treasury");
  assert.equal(plan.closing.treasury, 26);
  const snapshot = structuredClone(state);
  assert.throws(() => applyDelegationBudgetAdjustments(state, [
    plan.adjustments[0], { ...plan.adjustments[1], previous: 1 },
  ]), /预算或委任状态已变化/);
  assert.deepEqual(state, snapshot);
  const direct = setGovernance(state, "wan", "direct", "defense", 0);
  assert.deepEqual(delegationBudgetAdjustments(direct, [
    { city: "changan", result: "budget", available: 0, needed: 22 },
    { city: "wan", result: "budget", available: 0, needed: 22 },
    { city: "puyang", result: "budget", available: 1, needed: 22 },
  ]), []);
  const fresh = createGame(world, 199, "cao");
  assert.deepEqual(forecastDelegationBudgets(world, fresh).adjustments, []);
  for (const city of Object.values(fresh.cities)) city.owner = "cao";
  assert.throws(() => forecastDelegationBudgets(world, fresh), /战局已结束/);
});
