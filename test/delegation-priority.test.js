import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, appoint, createGame, decodeSave, delegateCities, forecastDelegation, forecastFinance, playableFactions,
  queueOrder, setDelegationPriority, setGovernance,
} from "../dist/engine.js";
import { legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const opponentsRest = Object.fromEntries(playableFactions(era).filter(({ key }) => key !== "cao")
  .map(({ key }) => [key, { source: "model", order: null }]));

function programFor(ledger, city) {
  return ledger.programs.find((program) => program.city === city);
}

test("under the same treasury, priorities change funding and preserve the existing order inside each group", () => {
  const initial = createGame(world, 199, "cao");
  initial.factions.cao.treasury = 20;
  const cities = Object.keys(initial.cities).filter((city) => initial.cities[city].owner === "cao");
  let state = delegateCities(world, initial, cities, "defense", 30);
  state = queueOrder(world, state, { type: "recruit", city: "xu" });
  const baseline = forecastFinance(world, state);
  const first = baseline.programs.find(({ result }) => result === "completed").city;
  const affected = baseline.programs.filter(({ result }) => result === "treasury");
  assert.ok(affected.length >= 2);
  const chosen = affected.slice(-2).map(({ city }) => city);
  const before = structuredClone(state);
  const prioritized = setDelegationPriority(state, chosen.slice().reverse());
  assert.deepEqual(state, before);
  assert.deepEqual(prioritized.orders, before.orders);
  assert.deepEqual(prioritized.factions, before.factions);
  const forecast = forecastFinance(world, prioritized);
  assert.deepEqual(forecast.programs.slice(0, 2).map(({ city }) => city), chosen);
  assert.deepEqual(forecast.programs.slice(2).map(({ city }) => city), cities.filter((city) => !chosen.includes(city)));
  assert.ok(chosen.every((city) => programFor(forecast, city).result === "completed" && programFor(forecast, city).priority));
  assert.equal(programFor(forecast, first).result, "treasury");
  const settled = advanceQuarter(world, prioritized, opponentsRest);
  assert.deepEqual(settled.history.at(-1).finance, forecast);
  assert.deepEqual(forecastFinance(world, setDelegationPriority(prioritized, [])), baseline);
});

test("priority changes which recruitment receives grain and respects city budgets and backups", () => {
  const initial = createGame(world, 199, "cao");
  initial.factions.cao.treasury = 500;
  initial.factions.cao.grain = 0;
  const cities = Object.keys(initial.cities).filter((city) => initial.cities[city].owner === "cao");
  const state = delegateCities(world, initial, cities, "recruit", 25);
  const baseline = forecastFinance(world, state);
  const grainLimited = baseline.programs.find(({ result }) => result === "grain").city;
  const prioritized = setDelegationPriority(state, [grainLimited]);
  const blocked = setGovernance(prioritized, grainLimited, "delegated", "recruit", 0);
  assert.equal(programFor(forecastFinance(world, blocked), grainLimited).result, "budget");
  const preview = forecastDelegation(world, prioritized, [grainLimited], "recruit", 25);
  assert.equal(preview.programs[0].priority, true);
  assert.equal(preview.programs[0].result, "completed");
  const backup = createSaveBackup({ state: prioritized, selected: grainLimited });
  assert.deepEqual(readGameRecord(world, backup).state, prioritized);
  const oldRequest = legacySnapshot(world, prioritized, 11);
  assert.equal(oldRequest.delegationPriority, undefined);
  const compatible = structuredClone(state);
  delete compatible.personnelHistory;
  assert.deepEqual(decodeSave(world, JSON.stringify(oldRequest)), compatible);

  const invalid = { ...prioritized, delegationPriority: [...cities] };
  assert.throws(() => decodeSave(world, JSON.stringify(invalid)), /优先级/);
  assert.throws(() => setDelegationPriority(state, ["changan"]), /己方已委任/);
  assert.throws(() => setDelegationPriority(state, [grainLimited, grainLimited]), /己方已委任/);
});

test("a city loses priority on capture or when it becomes directly managed", () => {
  const initial = createGame(world, 199, "cao");
  initial.turn = era.factions.findIndex(({ key }) => key === "ma");
  initial.cities.luoyang.troops = 350;
  initial.cities.changan.troops = 3200;
  initial.cities.tianshui.commander = null;
  initial.stations["ma-1"] = "changan";
  initial.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: initial.turn, threshold: 1 };
  const delegated = delegateCities(world, initial, ["luoyang", "xu"], "farming", 22);
  const state = setDelegationPriority(delegated, ["luoyang", "xu"]);
  assert.deepEqual(setGovernance(state, "luoyang", "direct", "farming").delegationPriority, ["xu"]);
  assert.deepEqual(appoint(world, state, "luoyang", "governor", null).delegationPriority, ["xu"]);
  const settled = advanceQuarter(world, state);
  assert.equal(settled.cities.luoyang.owner, "ma");
  assert.deepEqual(settled.delegationPriority, ["xu"]);
  const row = programFor(settled.history.at(-1).finance, "luoyang");
  assert.equal(row.result, "lost");
  assert.equal(row.priority, true);
  assert.deepEqual(decodeSave(world, JSON.stringify(settled)), settled);
});
