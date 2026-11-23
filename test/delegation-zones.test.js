import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, createGame, decodeSave, delegateCities, delegateZones, delegationZones, forecastDelegationZones,
  forecastFinance, playableFactions, queueOrder, setDelegationPriority, setDelegationReserve,
} from "../dist/engine.js";
import { compareDelegationPresets, presetPolicies } from "../dist/delegation-presets.js";
import { enrichWorld } from "../dist/personnel.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const policies = { front: { focus: "recruit", budget: 22 }, rear: { focus: "commerce", budget: 30 } };

test("front and rear policies share officers, priorities, and a single real forecast", () => {
  let state = createGame(world, 199, "cao");
  state.factions.cao.treasury = 400;
  state.factions.cao.grain = 0;
  Object.assign(state.cities.luoyang, { occupation: 2, troops: 200 });
  state = delegateCities(world, state, ["xu"], "farming", 12);
  state = setDelegationPriority(state, ["xu"]);
  state = queueOrder(world, state, { type: "build", city: "xu", project: "commerce" });
  const before = structuredClone(state);
  const zones = delegationZones(world, state);
  assert.ok(zones.front.includes("luoyang"));
  assert.ok(zones.rear.includes("xu"));
  const forecast = forecastDelegationZones(world, state, policies);
  assert.deepEqual(state, before);
  const { front, rear } = forecast.groups;
  assert.equal(front.rows.length, zones.front.length);
  assert.equal(rear.rows.length, zones.rear.length);
  assert.equal(front.rows.find(({ city }) => city === "luoyang").result, "occupation");
  assert.ok(front.rows.some(({ result }) => result === "grain"));
  assert.ok(front.required.grain > front.spent.grain);
  const priority = rear.rows.find(({ city }) => city === "xu");
  assert.equal(priority.priority, true);
  assert.equal(priority.newGovernor, false);
  assert.ok(priority.action.includes("升至 3 级"));

  const next = delegateZones(world, state, policies);
  const governors = zones.front.concat(zones.rear).map((city) => next.cities[city].governor);
  assert.equal(new Set(governors).size, governors.length);
  assert.equal(next.cities.xu.governor, state.cities.xu.governor);
  assert.deepEqual(next.orders, state.orders);
  assert.deepEqual(next.factions, state.factions);
  assert.deepEqual(next.delegationPriority, ["xu"]);
  const rest = Object.fromEntries(playableFactions(world.scenarios[0]).filter(({ key }) => key !== "cao")
    .map(({ key }) => [key, { source: "model", order: null }]));
  const receipt = advanceQuarter(world, next, rest).history.at(-1).finance;
  assert.deepEqual(receipt, forecastFinance(world, next));
  assert.deepEqual(receipt.closing, forecast.closing);
  assert.deepEqual(receipt.delegation, forecast.spent);

  const poor = structuredClone(state);
  poor.factions.cao.treasury = 20;
  assert.ok(forecastDelegationZones(world, poor, policies).groups.front.rows.some(({ result }) => result === "treasury"));
});

test("groups follow hostile neighbors, including sole cities and treaties in older saves", () => {
  const state = createGame(world, 199, "lu");
  assert.deepEqual(delegationZones(world, state), { front: ["nanzheng"], rear: [] });
  const front = forecastDelegationZones(world, state, policies);
  assert.equal(front.groups.front.rows.length, 1);
  assert.deepEqual(front.groups.rear.rows, []);
  const from = world.cities.find(({ key }) => key === "nanzheng");
  const others = new Set(from.links.map((key) => state.cities[key].owner).filter((owner) => owner !== state.player));
  state.treaties = [...others].map((owner) => ({ sides: [state.player, owner].sort(), kind: "truce", expires: 2 }));
  for (const city of Object.values(state.cities)) delete city.delegateBudget;
  const restored = decodeSave(world, JSON.stringify(state));
  assert.deepEqual(delegationZones(world, restored), { front: [], rear: ["nanzheng"] });
  const rear = delegateZones(world, restored, { front: null, rear: policies.rear });
  assert.equal(rear.cities.nanzheng.focus, "commerce");
});

test("staff shortages and invalid policies never leave one group partially applied", () => {
  const state = createGame(world, 265, "jin");
  const snapshot = structuredClone(state);
  assert.throws(() => forecastDelegationZones(world, state, policies), /待任官员不足/);
  assert.throws(() => delegateZones(world, state, policies), /待任官员不足/);
  assert.throws(() => delegateZones(world, state, { front: policies.front, rear: { ...policies.rear, budget: -1 } }), /每城预算/);
  assert.deepEqual(state, snapshot);
  const staged = delegateZones(world, state, { front: policies.front, rear: null });
  const zones = delegationZones(world, state);
  assert.ok(zones.front.every((key) => staged.cities[key].focus === "recruit" && staged.cities[key].mode === "delegated"));
  assert.ok(zones.rear.every((key) => staged.cities[key].mode === "direct"));
});

test("preset comparison forecasts actual construction and finances from the same unchanged orders", () => {
  let state = createGame(world, 199, "cao");
  state.factions.cao.treasury = 800;
  Object.assign(state.cities.xu, { farming: 4, commerce: 0, defense: 4 });
  Object.assign(state.cities.wan, { farming: 4, commerce: 4, defense: 0 });
  Object.assign(state.cities.luoyang, { occupation: 2, troops: 200 });
  state = queueOrder(world, state, { type: "build", city: "xu", project: "farming" });
  const before = structuredClone(state);
  const [balanced, grain, defense] = compareDelegationPresets(world, state);
  assert.deepEqual(state, before);
  assert.ok(balanced.projectsDone.commerce > 0 && balanced.projectsDone.defense > 0);
  assert.deepEqual(grain.projectsDone, { farming: grain.completed, commerce: 0, defense: 0 });
  assert.equal(defense.projectsDone.commerce, 0);
  for (const option of [balanced, grain, defense]) {
    const forecast = forecastDelegationZones(world, state, presetPolicies(option.key));
    assert.deepEqual(option.spent, forecast.spent);
    assert.deepEqual(option.closing, forecast.closing);
    assert.equal(option.appointments, option.total);
    assert.equal(Object.values(option.projectsDone).reduce((sum, count) => sum + count, 0), option.completed);
    assert.ok(option.blockers.some(([result, count]) => result === "occupation" && count === 1));
  }
  const reserved = compareDelegationPresets(world, setDelegationReserve(state, { treasury: 5000, grain: 0 }));
  assert.ok(reserved.every(({ completed, blockers }) => completed === 0 && blockers[0][0] === "reserve-treasury"));
});

test("preset comparison keeps one-zone forecasts and reports unavailable options independently", () => {
  const small = createGame(world, 199, "lu");
  const restored = decodeSave(world, JSON.stringify(small));
  assert.ok(compareDelegationPresets(world, restored).every(({ total }) => total === 1));
  const large = createGame(world, 265, "jin");
  const blocked = compareDelegationPresets(world, large);
  assert.deepEqual(blocked.map(({ key }) => key), ["balanced", "grain", "defense"]);
  assert.ok(blocked.every(({ error }) => /待任官员不足/.test(error)));
  for (const city of Object.values(large.cities)) city.owner = "jin";
  assert.ok(compareDelegationPresets(world, large).every(({ error }) => /战局已结束/.test(error)));
});
