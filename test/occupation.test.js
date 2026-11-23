import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advanceQuarter, appoint, cityReserve, createGame, decodeSave, playableFactions, previewOrders, queueOrder, replaceOrders } from "../dist/engine.js";
import { applyOccupationTakeover, appointOccupationGovernors, canInspectOccupation, occupiedHoldings, occupationReinforcement,
  planOccupationGovernors, planOccupationReinforcements, planOccupationTakeover } from "../dist/occupation.js";
import { enrichWorld } from "../dist/personnel.js";
import { nationalRoster } from "../dist/roster.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const rest = Object.fromEntries(playableFactions(world.scenarios[0]).filter(({ key }) => key !== "cao")
  .map(({ key }) => [key, { source: "model", order: null }]));

function invasion() {
  const initial = createGame(world, 199, "cao");
  Object.assign(initial.cities.changan, { troops: 0, defense: 0 });
  return queueOrder(world, initial, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 200 });
}

function firstOccupation(state) {
  const planned = previewOrders(world, state);
  return occupiedHoldings(world, state, planned, "troops")[0];
}

test("a capture pauses that season and the forecast reuses the actual recovery rules", () => {
  const order = invasion();
  const projected = firstOccupation(order);
  assert.equal(projected.city.key, "changan");
  assert.equal(projected.pending, true);
  assert.equal(projected.projection.troops, 150);
  assert.deepEqual(projected.progress, { remaining: 2, shortage: 100, pause: "capture" });
  const openingAid = occupationReinforcement(world, order, previewOrders(world, order), "changan", projected.progress.shortage);
  const supportedCapture = queueOrder(world, order, { type: "transfer", ...openingAid, to: "changan" });
  assert.equal(firstOccupation(supportedCapture).projection.troops, 350);
  assert.deepEqual(firstOccupation(supportedCapture).progress, { remaining: 2, shortage: 0, pause: "capture" });
  assert.equal(advanceQuarter(world, supportedCapture).cities.changan.occupation, 2);
  const captured = advanceQuarter(world, order);
  assert.equal(captured.cities.changan.occupation, projected.progress.remaining);
  const paused = firstOccupation(captured);
  assert.equal(paused.pending, false);
  assert.deepEqual(paused.progress, { remaining: 2, shortage: 100, pause: "garrison" });

  const aid = occupationReinforcement(world, captured, previewOrders(world, captured), "changan", paused.progress.shortage);
  assert.equal(aid.troops, 200);
  const reinforced = queueOrder(world, captured, { type: "transfer", ...aid, to: "changan" });
  const ready = firstOccupation(reinforced);
  assert.equal(ready.holding.troops, 150);
  assert.equal(ready.projection.troops, 350);
  assert.deepEqual(ready.progress, { remaining: 1, shortage: 0, pause: null });
  assert.equal(advanceQuarter(world, reinforced).cities.changan.occupation, 1);

  const staffed = appoint(world, reinforced, "changan", "governor", "cao-0");
  assert.equal(firstOccupation(staffed).progress.remaining, 0);
  const restored = advanceQuarter(world, staffed);
  assert.equal(restored.cities.changan.occupation, 0);
  assert.ok(restored.history.at(-1).entries.some(({ type, city }) => type === "recovery" && city === "changan"));
});

test("reinforcement drafts respect origin reserves, grain and queue space", () => {
  const captured = advanceQuarter(world, invasion());
  captured.cities.changan.troops = 0;
  for (const { key } of world.cities) {
    if (captured.cities[key].owner === captured.player && key !== "changan") captured.cities[key].troops = cityReserve;
  }
  captured.cities.luoyang.troops = cityReserve + 200;
  const findAid = (state) => occupationReinforcement(world, state, previewOrders(world, state), "changan", cityReserve);
  assert.deepEqual(findAid(captured), { from: "luoyang", troops: 200 });
  const empty = structuredClone(captured);
  empty.factions.cao.grain = 1;
  assert.deepEqual(findAid(empty), { blocker: "grain" });
  const order = { type: "build", city: "xu", project: "commerce" };
  const full = queueOrder(world, queueOrder(world, queueOrder(world, captured, order), order), order);
  assert.deepEqual(findAid(full), { blocker: "queue" });
});

test("a remote donor can lift a shortage when nearby cities have only their reserves", () => {
  const state = advanceQuarter(world, invasion());
  for (const city of Object.values(state.cities)) {
    if (city.owner === state.player) city.troops = cityReserve;
  }
  state.cities.changan.troops = 0;
  state.cities.xu.troops = 1000;
  state.factions.cao.grain = 5;
  const route = ["xu", "luoyang", "changan"];
  const partial = occupationReinforcement(world, state, state, "changan", cityReserve);
  assert.deepEqual(partial, { from: "xu", troops: 200, route });
  state.factions.cao.grain = 8;
  const aid = occupationReinforcement(world, state, state, "changan", cityReserve);
  assert.deepEqual(aid, { from: "xu", troops: 250, route });
  const queued = queueOrder(world, state, { type: "transfer", to: "changan", ...aid });
  assert.equal(firstOccupation(queued).progress.pause, null);
});

test("the occupation link follows the latest matching capture and supports older records", () => {
  const captured = advanceQuarter(world, invasion());
  const initial = captured.history[0].entries.find(({ type, city }) => type === "capture" && city === "changan");
  delete initial.battle;
  delete initial.participants;
  const loaded = decodeSave(world, JSON.stringify(captured));
  const legacy = loaded.history[0].entries.find(({ type, city }) => type === "capture" && city === "changan");
  assert.equal(canInspectOccupation(loaded, legacy), true);
  const newRecord = { ...legacy };
  loaded.history.push({ turn: 2, entries: [newRecord] });
  assert.equal(canInspectOccupation(loaded, legacy), false);
  assert.equal(canInspectOccupation(loaded, newRecord), true);
  loaded.cities.changan.occupation = 0;
  assert.equal(canInspectOccupation(loaded, newRecord), false);
  Object.assign(loaded.cities.changan, { owner: "ma", occupation: 2 });
  assert.equal(canInspectOccupation(loaded, newRecord), false);
});

function occupationPlanFixture(reserve, grain = 30) {
  const state = createGame(world, 199, "cao");
  for (const holding of Object.values(state.cities)) if (holding.owner === "cao") holding.troops = cityReserve;
  state.factions.cao.grain = grain;
  state.cities.luoyang.troops += 200;
  state.cities.xu.troops += reserve;
  Object.assign(state.cities.puyang, { occupation: 2, troops: 200 });
  Object.assign(state.cities.changan, { troops: 0, defense: 0 });
  return queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 200 });
}

test("an occupation plan raises stalled garrisons before newly projected captures and saves the ordered routes", () => {
  const state = occupationPlanFixture(400);
  const before = structuredClone(state);
  const plan = planOccupationReinforcements(world, state);
  assert.deepEqual(state, before);
  assert.deepEqual(plan.steps.map(({ order, number, retained }) => [order.from, order.to, number, retained]),
    [["xu", "puyang", 2, 450], ["xu", "changan", 3, 250]]);
  assert.deepEqual(plan.steps[0].order.route, ["xu", "chenliu", "puyang"]);
  assert.deepEqual(plan.steps[1].order.route, ["xu", "luoyang", "changan"]);
  assert.equal(plan.grain, 8);
  assert.deepEqual(plan.targets.map(({ city, pending, before, arrival, progress }) => [city, pending, before, arrival, progress.remaining, progress.pause]), [
    ["puyang", false, 200, 400, 1, null],
    ["changan", true, 150, 350, 2, "capture"],
  ]);
  const appended = replaceOrders(world, state, [...state.orders, ...plan.steps.map(({ order }) => order)]);
  const restored = readGameRecord(world, createSaveBackup({ state: appended, selected: "puyang" })).state;
  assert.deepEqual(restored.orders, appended.orders);
  assert.equal(previewOrders(world, restored).factions.cao.grain, plan.closingGrain);
  const settled = advanceQuarter(world, restored, rest);
  assert.equal(settled.cities.puyang.occupation, 1);
  assert.equal(settled.cities.changan.occupation, 2);
});

test("an occupation plan accounts for prior transfers, competing donors, grain, queue capacity and terminal states", () => {
  const limited = occupationPlanFixture(200);
  const scarce = planOccupationReinforcements(world, limited);
  assert.equal(scarce.steps.length, 1);
  assert.equal(scarce.steps[0].order.to, "puyang");
  assert.equal(scarce.targets[1].blocker, "donor");
  const thin = planOccupationReinforcements(world, occupationPlanFixture(400, 3));
  assert.deepEqual(thin.steps, []);
  assert.ok(thin.targets.every(({ blocker }) => blocker === "grain"));
  const supported = queueOrder(world, occupationPlanFixture(400), scarce.steps[0].order);
  const later = planOccupationReinforcements(world, supported);
  assert.equal(later.steps.length, 1);
  assert.equal(later.steps[0].number, 3);
  assert.equal(later.steps[0].order.to, "changan");
  const full = ["xu", "wan"].reduce((queued, city) => queueOrder(world, queued, { type: "build", city, project: "defense" }), limited);
  const blocked = planOccupationReinforcements(world, full);
  assert.deepEqual(blocked.steps, []);
  assert.ok(blocked.targets.every(({ blocker }) => blocker === "queue"));

  const fresh = createGame(world, 199, "cao");
  assert.deepEqual(planOccupationReinforcements(world, fresh).targets, []);
  for (const city of Object.values(fresh.cities)) city.owner = "cao";
  Object.assign(fresh.cities.puyang, { occupation: 1, troops: 100 });
  const ended = planOccupationReinforcements(world, fresh);
  assert.equal(ended.ended, true);
  assert.deepEqual(ended.steps, []);
  assert.equal(ended.targets[0].progress.shortage, 150);
});

test("occupation appointments reserve local staff, respect existing orders and preserve their exact forecast after reload", () => {
  let state = occupationPlanFixture(400);
  const [aid] = planOccupationReinforcements(world, state).steps;
  state = queueOrder(world, state, aid.order);
  state = appoint(world, state, "xu", "governor", "cao-0");
  Object.assign(state.cities.chenliu, { occupation: 2, troops: cityReserve });
  Object.assign(state.cities.wan, { occupation: 2, troops: 0 });
  const { matching: staff } = nationalRoster(world, state, { status: "available", sort: "governance", query: "" });
  for (const { person } of staff) state.stations[person.key] = "xu";
  state.stations[staff[0].person.key] = "chenliu";
  const snapshot = structuredClone(state);

  const { rows, assignments } = planOccupationGovernors(world, state);
  assert.deepEqual(rows.map(({ city, before, after, blocker }) => [city, before.remaining, after.remaining, blocker]), [
    ["puyang", 1, 0, null], ["chenliu", 1, 0, null], ["wan", 2, 2, null], ["changan", 2, 2, "capture"],
  ]);
  assert.deepEqual(assignments, [
    { city: "puyang", officer: staff[1].person.key },
    { city: "chenliu", officer: staff[0].person.key },
    { city: "wan", officer: staff[2].person.key },
  ]);
  assert.equal(rows[0].troops, 400);
  assert.equal(rows[2].after.shortage, cityReserve);
  assert.equal(rows[3].candidate, undefined);
  assert.deepEqual(state, snapshot);
  const next = appointOccupationGovernors(world, state, assignments).state;
  const restored = readGameRecord(world, createSaveBackup({ state: next, selected: "puyang" })).state;
  assert.deepEqual(restored.orders, snapshot.orders);
  assert.equal(restored.stations["cao-1"], "luoyang");
  assert.equal(restored.cities.xu.governor, "cao-0");
  assert.deepEqual(restored.personnelHistory.slice(snapshot.personnelHistory.length).map(({ officer, to }) => [officer, to.city, to.role]),
    assignments.map(({ officer, city }) => [officer, city, "governor"]));
  const settled = advanceQuarter(world, restored, rest);
  assert.equal(settled.cities.puyang.occupation, 0);
  assert.equal(settled.cities.chenliu.occupation, 0);
  assert.equal(settled.cities.wan.occupation, 2);
  assert.equal(settled.cities.changan.occupation, 2);
  assert.throws(() => appointOccupationGovernors(world, state, [...assignments, { city: "changan", officer: staff[3].person.key }]));
  assert.deepEqual(state, snapshot);
});

test("occupation appointments prefer ready cities with scarce staff and leave existing posts intact in terminal games", () => {
  const state = createGame(world, 199, "cao");
  for (const [key, city] of Object.entries(state.cities)) {
    if (key !== "changan") Object.assign(city, { owner: "cao", occupation: 2, troops: 100, mode: "direct", governor: null, commander: null });
  }
  state.cities.chenliu.troops = cityReserve;
  const plan = planOccupationGovernors(world, state);
  assert.equal(plan.rows[0].city, "chenliu");
  assert.ok(plan.assignments.length > 0 && plan.assignments.length < plan.rows.length);
  assert.equal(new Set(plan.assignments.map(({ officer }) => officer)).size, plan.assignments.length);
  assert.ok(plan.rows.some(({ blocker }) => blocker === "staff"));
  state.cities.changan.owner = "cao";
  const ended = planOccupationGovernors(world, state);
  assert.equal(ended.ended, true);
  assert.deepEqual(ended.assignments, []);
  assert.ok(ended.rows.every(({ blocker }) => blocker === "ended"));
});

test("takeover planning prioritizes newly reinforced cities and commits the exact transfers and appointments together", () => {
  const state = occupationPlanFixture(400);
  Object.assign(state.cities.chenliu, { occupation: 2, troops: cityReserve });
  Object.assign(state.cities.xu, { occupation: 2 });
  const snapshot = structuredClone(state);
  assert.equal(planOccupationGovernors(world, state).assignments[0].city, "xu");
  const plan = planOccupationTakeover(world, state);
  assert.equal(plan.assignments[0].city, "puyang");
  assert.equal(plan.grain, 8);
  assert.deepEqual(plan.transfers.map(({ to }) => to), ["puyang", "changan"]);
  const byCity = Object.fromEntries(plan.rows.map((row) => [row.city, row]));
  assert.deepEqual([byCity.puyang.before, byCity.puyang.arrival, byCity.puyang.progress.remaining], [200, 400, 0]);
  assert.equal(byCity.puyang.candidate.person.key, plan.assignments[0].officer);
  assert.deepEqual([byCity.xu.before, byCity.xu.arrival, byCity.xu.progress.shortage], [650, 250, 0]);
  assert.equal(byCity.changan.staffBlocker, "capture");
  assert.equal(byCity.changan.progress.pause, "capture");
  assert.equal(byCity.changan.progress.shortage, 0);
  assert.deepEqual(state, snapshot);

  assert.throws(() => applyOccupationTakeover(world, state,
    { ...plan, assignments: [...plan.assignments, { city: "changan", officer: "cao-1" }] }));
  assert.throws(() => applyOccupationTakeover(world, state,
    { ...plan, transfers: [...plan.transfers, plan.transfers[0]] }));
  assert.deepEqual(state, snapshot);
  const committed = applyOccupationTakeover(world, state, plan);
  const loaded = readGameRecord(world, createSaveBackup({ state: committed, selected: "puyang" })).state;
  assert.deepEqual(loaded.orders, [...snapshot.orders, ...plan.transfers]);
  assert.deepEqual(loaded.personnelHistory.map(({ officer, to }) => [officer, to.city, to.role]),
    plan.assignments.map(({ officer, city }) => [officer, city, "governor"]));
  const next = advanceQuarter(world, loaded, rest);
  assert.equal(next.cities.puyang.occupation, 0);
  assert.equal(next.cities.changan.occupation, 2);
});

test("takeover planning handles reinforcement-only, staffing-only, and empty cases", () => {
  const ready = occupationPlanFixture(400);
  const assigned = appoint(world, ready, "puyang", "governor", "cao-0");
  const aidOnly = planOccupationTakeover(world, assigned);
  assert.equal(aidOnly.transfers.length, 2);
  assert.deepEqual(aidOnly.assignments, []);
  assert.equal(aidOnly.rows[0].governor, "cao-0");
  assert.equal(aidOnly.rows[0].progress.remaining, 0);
  assert.equal(applyOccupationTakeover(world, assigned, aidOnly).orders.length, 3);

  const full = ["xu", "wan"].reduce((queued, city) => queueOrder(world, queued, { type: "build", city, project: "defense" }), ready);
  const staffOnly = planOccupationTakeover(world, full);
  assert.deepEqual(staffOnly.transfers, []);
  assert.equal(staffOnly.assignments.length, 1);
  assert.equal(staffOnly.rows[0].aidBlocker, "queue");
  assert.equal(staffOnly.rows[0].progress.pause, "garrison");
  assert.deepEqual(applyOccupationTakeover(world, full, staffOnly).orders, full.orders);

  const initial = createGame(world, 199, "cao");
  const empty = planOccupationTakeover(world, initial);
  assert.deepEqual([empty.rows, empty.transfers, empty.assignments], [[], [], []]);
  assert.equal(applyOccupationTakeover(world, initial, empty), initial);
});
