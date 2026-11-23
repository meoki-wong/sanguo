import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { seasonAdvice } from "../dist/advice.js";
import { advanceQuarter, appoint, createGame, delegateCities, forecastFinance, previewOrders, queueOrder, setGovernance } from "../dist/engine.js";
import { jointAttackLimit, jointSituation, planJointOrders } from "../dist/joint-orders.js";
import { enrichWorld } from "../dist/personnel.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

test("advice prioritizes live diplomacy, a fixable budget, and an available officer without changing the turn", () => {
  let state = advanceQuarter(world, createGame(world, 199, "cao"));
  state = delegateCities(world, state, ["xu"], "farming", 0);
  for (const key of Object.keys(state.stations)) {
    if (key.startsWith("cao-") && state.stations[key] === "luoyang") state.stations[key] = "xu";
  }
  const before = structuredClone(state);
  const items = seasonAdvice(world, state);
  assert.deepEqual(items.map(({ kind }) => kind), ["diplomacy", "budget", "appointment"]);
  const budget = items[1];
  const increased = setGovernance(state, budget.city, "delegated", state.cities[budget.city].focus, budget.needed);
  assert.ok(forecastFinance(world, increased).programs.some((row) => row.city === budget.city && row.result === "completed"));
  const { city, officer } = items[2];
  assert.equal(appoint(world, state, city, "commander", officer).cities[city].commander, officer);
  assert.deepEqual(state, before);
});

test("a single-city faction gets a legal action even without an allied donor", () => {
  const state = createGame(world, 199, "gongsun");
  const direct = seasonAdvice(world, state).find(({ kind }) => kind === "attack");
  assert.ok(direct);
  assert.doesNotThrow(() => queueOrder(world, state, direct.order));
  const capital = world.cities.find(({ key }) => key === "xiangping");
  for (const key of capital.links) state.cities[key].troops = 5000;
  state.cities.xiangping.troops = 1200;
  const defense = seasonAdvice(world, state).find(({ kind }) => kind === "domestic");
  assert.deepEqual(defense.order, { type: "recruit", city: "xiangping" });
  assert.doesNotThrow(() => queueOrder(world, state, defense.order));
  const poor = delegateCities(world, state, ["xiangping"], "farming", 0);
  poor.factions.gongsun.treasury = 0;
  assert.deepEqual(seasonAdvice(world, poor).map(({ kind }) => kind), ["finance"]);
});

test("budget advice exposes an actual trade-off when another city's program would be delayed", () => {
  const start = createGame(world, 199, "cao");
  const cities = Object.keys(start.cities).filter((key) => start.cities[key].owner === "cao").slice(0, 4);
  let state = delegateCities(world, start, cities, "farming", 22);
  state = setGovernance(state, cities[0], "delegated", "farming", 0);
  state.factions.cao.treasury = 0;
  const budget = seasonAdvice(world, state).find(({ kind }) => kind === "budget");
  assert.equal(budget.city, cities[0]);
  assert.match(budget.detail, /另有 [1-9]\d* 座城的委任会延后/);
});

test("combined advice carries a validated draft and disappears when two queue slots are occupied", () => {
  let state = createGame(world, 199, "cao");
  for (const key of Object.keys(state.stations)) {
    if (key.startsWith("cao-") && key !== "cao-1") state.stations[key] = null;
  }
  state.cities.luoyang.troops = 800;
  state.cities.changan.troops = 1100;
  state.cities.ye.troops = 2600;
  const item = seasonAdvice(world, state).find(({ kind }) => kind === "joint");
  assert.ok(item);
  const plan = planJointOrders(world, state, item.draft);
  assert.ok(plan.outcome.wins);
  assert.deepEqual(plan.queued.orders.map(({ type }) => type), ["transfer", "attack"]);
  state = queueOrder(world, state, { type: "build", city: "xu", project: "farming" });
  state = queueOrder(world, state, { type: "build", city: "xu", project: "commerce" });
  assert.ok(!seasonAdvice(world, state, previewOrders(world, state)).some(({ kind }) => kind === "joint"));
});

test("the military council offers the same fixed-route joint draft when adjacent reserves are committed", () => {
  const state = createGame(world, 199, "cao");
  for (const city of Object.values(state.cities)) {
    if (city.owner === "cao") city.troops = 250;
  }
  for (const key of Object.keys(state.stations)) {
    if (key.startsWith("cao-") && key !== "cao-1") state.stations[key] = null;
  }
  state.cities.luoyang.troops = 800;
  state.cities.puyang.troops = 1500;
  const snapshot = structuredClone(state);
  const item = seasonAdvice(world, state).find(({ kind }) => kind === "joint");
  assert.ok(item);
  const route = ["puyang", "chenliu", "luoyang"];
  assert.deepEqual(item.draft.supportRoute, route);
  assert.match(item.detail, /濮阳 → 陈留 → 洛阳/);
  const plan = planJointOrders(world, state, item.draft);
  assert.deepEqual(plan.queued.orders[0].route, route);
  assert.equal(plan.grain, 44);
  assert.equal(plan.supportGarrison, 1500);
  assert.equal(plan.attackGarrison, 800);
  assert.equal(plan.supportReserve, 250);
  assert.equal(plan.attackReserve, 250);
  assert.ok(plan.outcome.wins);
  assert.deepEqual(state, snapshot);

  const lowGrain = structuredClone(state);
  lowGrain.factions.cao.grain = 21;
  const origin = jointSituation(world, lowGrain).origins.find(({ key }) => key === "luoyang");
  assert.equal(origin.donors[0].maximum, 900);
  assert.equal(jointAttackLimit(origin, 900, origin.donors[0]), 300);
  lowGrain.factions.cao.grain = 5;
  assert.match(jointSituation(world, lowGrain).reason, /储粮不足/);
  assert.throws(() => planJointOrders(world, lowGrain, item.draft), /储粮不足/);

  const disconnected = structuredClone(state);
  disconnected.cities.puyang.owner = "yuan";
  assert.throws(() => planJointOrders(world, disconnected, item.draft), /跨城调兵路线中断/);
});
