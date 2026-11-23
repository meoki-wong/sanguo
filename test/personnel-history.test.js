import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, appoint, createGame, decodeSave, delegateCities, delegateZones, forecastDelegation,
  forecastDelegationZones, playableFactions, postingOf, queueOrder, reassignOfficer, setDelegationPriority, transferOfficer,
} from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { officerProfile, reassignmentOptions } from "../dist/roster.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const rest = Object.fromEntries(playableFactions(world.scenarios[0]).filter(({ key }) => key !== "cao")
  .map(({ key }) => [key, { source: "model", order: null }]));

test("the profile records actual same-quarter postings, replacements and later transfers alongside battles", () => {
  const initial = createGame(world, 199, "cao");
  let state = appoint(world, initial, "luoyang", "commander", "cao-1");
  assert.equal(initial.personnelHistory, undefined);
  assert.deepEqual(appoint(world, state, "luoyang", "commander", "cao-1"), state);
  assert.deepEqual(transferOfficer(world, initial, "cao-1", "luoyang"), initial);
  assert.throws(() => transferOfficer(world, state, "cao-1", "xu"), /解除/);
  const queued = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 200 });
  state = advanceQuarter(world, queued, rest);
  const replacement = "cao-roster-0";
  const before = state.stations[replacement];
  state = appoint(world, state, "luoyang", "commander", replacement);
  state = appoint(world, state, "luoyang", "commander", null);
  state = transferOfficer(world, state, "cao-1", "xu");
  assert.deepEqual(state.personnelHistory.slice(1, 4), [
    { officer: "cao-1", turn: 1, from: { city: "luoyang", role: "commander" }, to: { city: "luoyang", role: null } },
    { officer: replacement, turn: 1, from: { city: before, role: null }, to: { city: "luoyang", role: "commander" } },
    { officer: replacement, turn: 1, from: { city: "luoyang", role: "commander" }, to: { city: "luoyang", role: null } },
  ]);
  assert.deepEqual(officerProfile(world, state, "cao-1").timeline.map(({ type, season, change }) =>
    [type, season, change?.to.city, change?.to.role]), [
    ["personnel", 1, "xu", null], ["personnel", 1, "luoyang", null],
    ["battle", 0, undefined, undefined], ["personnel", 0, "luoyang", "commander"],
  ]);
  const saved = createSaveBackup({ state, selected: "xu" });
  assert.deepEqual(readGameRecord(world, saved).state, state);
  const bad = structuredClone(state);
  bad.personnelHistory[0].from.city = "missing";
  assert.throws(() => decodeSave(world, JSON.stringify(bad)), /人事履历/);
});

test("delegation only records confirmed new governors and shares the same retention as the archives", () => {
  const initial = createGame(world, 199, "cao");
  const policies = { front: { focus: "defense", budget: 25 }, rear: { focus: "commerce", budget: 30 } };
  forecastDelegation(world, initial, ["luoyang"], "farming", 22);
  forecastDelegationZones(world, initial, policies);
  assert.equal(initial.personnelHistory, undefined);
  const batch = delegateCities(world, initial, ["luoyang", "luoyang"], "farming", 22);
  assert.deepEqual(batch.personnelHistory.map(({ officer, to }) => [officer, to.city, to.role]),
    [[batch.cities.luoyang.governor, "luoyang", "governor"]]);
  const grouped = delegateZones(world, batch, policies);
  assert.deepEqual(grouped.personnelHistory[0], batch.personnelHistory[0]);
  assert.equal(new Set(grouped.personnelHistory.map(({ officer }) => officer)).size, grouped.personnelHistory.length);
  assert.ok(grouped.personnelHistory.every(({ officer, to }) => grouped.cities[to.city].governor === officer));
  assert.deepEqual(delegateZones(world, grouped, policies).personnelHistory, grouped.personnelHistory);

  let state = initial;
  for (let i = 0; i < 260; i += 1) state = transferOfficer(world, state, "cao-1", i % 2 ? "luoyang" : "xu");
  assert.equal(state.personnelHistory.length, 256);
  state = { ...state, turn: 11 };
  state = advanceQuarter(world, state, rest);
  assert.equal(state.personnelHistory.length, 256);
  state = advanceQuarter(world, state, rest);
  assert.equal(state.personnelHistory, undefined);
});

test("an opponent's settled appointment appears once in the officer's timeline", () => {
  const state = createGame(world, 199, "cao");
  Object.assign(state.cities.changan, { occupation: 2, troops: 500, farming: 4, commerce: 3 });
  state.strategies.ma = { type: "economy", since: 0, threshold: state.factions.ma.grain + 1000 };
  const next = advanceQuarter(world, state);
  const appointment = next.history.at(-1).entries.find(({ orderType, city }) => orderType === "appoint-governor" && city === "changan");
  const { officer } = appointment.personnelChange;
  assert.deepEqual(officerProfile(world, next, officer).timeline, [{
    type: "personnel", season: 0, settled: true, change: appointment.personnelChange,
  }]);
  assert.equal(next.personnelHistory, undefined);
  appointment.personnelChange.to.role = "commander";
  assert.throws(() => decodeSave(world, JSON.stringify(next)), /奏报/);
});

test("cross-city reassignment and same-city role changes keep a single record each and retain the original orders", () => {
  const officer = "cao-0";
  const source = { city: "luoyang", role: "governor" };
  const target = { city: "xu", role: "commander" };
  let state = appoint(world, createGame(world, 199, "cao"), source.city, source.role, officer);
  state = delegateCities(world, state, ["luoyang", "chenliu"], "commerce", 22);
  state = setDelegationPriority(state, ["luoyang", "chenliu"]);
  state = queueOrder(world, state, { type: "recruit", city: "xu" });
  const before = structuredClone(state);
  const options = reassignmentOptions(world, state, officer);
  assert.deepEqual(options.posting, source);
  assert.ok(options.endsDelegation && options.removesPriority);
  assert.ok(options.commanders.some(({ key }) => key === "xu"));
  assert.ok(!options.governors.some(({ key }) => key === "luoyang" || key === "changan"));

  const moved = reassignOfficer(world, state, officer, source, target);
  assert.deepEqual(state, before);
  assert.deepEqual(postingOf(moved, officer), target);
  assert.equal(moved.stations[officer], "xu");
  assert.equal(moved.cities.luoyang.governor, null);
  assert.equal(moved.cities.luoyang.mode, "direct");
  assert.deepEqual(moved.delegationPriority, ["chenliu"]);
  assert.deepEqual(moved.orders, state.orders);
  assert.deepEqual(moved.personnelHistory.slice(before.personnelHistory.length), [{ officer, turn: 0, from: source, to: target }]);

  const settled = advanceQuarter(world, moved, rest);
  const governor = { city: "xu", role: "governor" };
  const changed = reassignOfficer(world, settled, officer, target, governor);
  const relieved = reassignOfficer(world, changed, officer, governor, null);
  assert.equal(relieved.stations[officer], "xu");
  assert.equal(postingOf(relieved, officer), null);
  assert.deepEqual(relieved.personnelHistory.slice(moved.personnelHistory.length), [
    { officer, turn: 1, from: target, to: governor },
    { officer, turn: 1, from: governor, to: { city: "xu", role: null } },
  ]);
  const restored = readGameRecord(world, createSaveBackup({ state: relieved, selected: "xu" })).state;
  assert.deepEqual(restored, relieved);
  assert.deepEqual(officerProfile(world, restored, officer).timeline.slice(0, 3).map(({ change }) => change.to.role),
    [null, "governor", "commander"]);
});

test("reassignment rejects a stale posting, occupied or enemy posts and pending expeditions without touching the original state", () => {
  const officer = "cao-1";
  const from = { city: "luoyang", role: "commander" };
  const state = appoint(world, createGame(world, 199, "cao"), from.city, from.role, officer);
  const staffed = appoint(world, state, "xu", "governor", "cao-0");
  const before = structuredClone(staffed);
  assert.throws(() => reassignOfficer(world, staffed, officer, from, { city: "xu", role: "governor" }), /有人担任/);
  assert.throws(() => reassignOfficer(world, staffed, officer, from, { city: "changan", role: "commander" }), /己方城池/);
  assert.throws(() => reassignOfficer(world, staffed, officer, from, from), /有人担任/);
  assert.throws(() => reassignOfficer(world, staffed, officer, { city: "xu", role: "commander" }, null), /原职务已变化/);
  assert.deepEqual(staffed, before);

  const queued = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", troops: 200, officer });
  assert.equal(reassignmentOptions(world, queued, officer), null);
  assert.throws(() => reassignOfficer(world, queued, officer, from, null), /出征令/);
  assert.throws(() => reassignOfficer(world, queued, officer, from, { city: "xu", role: "commander" }), /出征令/);
  assert.deepEqual(queued.personnelHistory, state.personnelHistory);

  const terminal = structuredClone(state);
  for (const city of Object.values(terminal.cities)) city.owner = "cao";
  assert.equal(reassignmentOptions(world, terminal, officer), null);
  assert.throws(() => reassignOfficer(world, terminal, officer, from, null), /战局已结束/);
});
