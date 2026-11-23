import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advanceQuarter, createGame, playableFactions, previewOrders, queueOrder, replaceOrders, transferGrain } from "../dist/engine.js";
import { frontierGarrisons, planFrontierReinforcements } from "../dist/frontier.js";
import { frontierGarrisonTarget } from "../dist/objectives.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const rest = Object.fromEntries(playableFactions(era).filter(({ key }) => key !== "cao")
  .map(({ key }) => [key, { source: "model", order: null }]));

function fixture() {
  const state = createGame(world, 199, "cao");
  for (const city of Object.values(state.cities)) {
    if (city.owner === "cao") city.troops = frontierGarrisonTarget;
  }
  state.cities.xiapi.troops = 1050;
  state.cities.chenliu.troops = 1100;
  state.cities.xu.troops = 250;
  state.cities.xiaopei.troops = 3000;
  return state;
}

function snapshot(state, target = frontierGarrisonTarget) {
  return frontierGarrisons(world, state, previewOrders(world, state), target);
}

test("the national comparison prioritizes rear donors and updates only after confirming a real queued transfer", () => {
  const state = fixture();
  const before = structuredClone(state);
  const [first] = snapshot(state);
  assert.equal(first.key, "xiapi");
  assert.equal(first.current, 1050);
  assert.equal(first.projected, 1050);
  assert.equal(first.shortage, 750);
  assert.deepEqual(first.aid.order, { type: "transfer", from: "chenliu", to: "xiapi", troops: 750,
    route: ["chenliu", "xiaopei", "xiapi"] });
  assert.equal(first.aid.retained, 350);
  assert.equal(first.aid.grain, transferGrain(first.aid.order));
  assert.deepEqual(state, before);
  const queued = queueOrder(world, state, first.aid.order);
  const updated = snapshot(queued).find(({ key }) => key === "xiapi");
  assert.equal(updated.current, 1050);
  assert.equal(updated.projected, frontierGarrisonTarget);
  assert.equal(updated.shortage, 0);
  assert.equal(updated.aid, null);
  assert.equal(snapshot(queued, 1900).find(({ key }) => key === "xiapi").shortage, 100);
  const settled = advanceQuarter(world, queued, rest);
  assert.equal(settled.cities.xiapi.troops, frontierGarrisonTarget);
});

test("front donors retain their own target, while grain, donor capacity and a full queue are distinguished", () => {
  const state = fixture();
  state.cities.chenliu.troops = 250;
  state.cities.xiaopei.troops = 2250;
  const aid = snapshot(state)[0].aid;
  assert.equal(aid.order.from, "xiaopei");
  assert.equal(aid.order.troops, 450);
  assert.equal(aid.retained, frontierGarrisonTarget);
  assert.equal(aid.onFront, true);
  assert.equal(aid.hops, 1);
  state.factions.cao.grain = 1;
  assert.deepEqual(snapshot(state)[0].aid, { blocker: "grain" });
  state.cities.xiaopei.troops = 1900;
  assert.deepEqual(snapshot(state)[0].aid, { blocker: "donor" });
  const queued = ["xu", "wan", "luoyang"].reduce((draft, city) =>
    queueOrder(world, draft, { type: "build", city, project: "defense" }), state);
  assert.deepEqual(snapshot(queued)[0].aid, { blocker: "queue" });
});

test("a border city under a live treaty is listed without a deficit or reinforcement draft", () => {
  const state = fixture();
  const city = world.cities.find(({ key }) => key === "xiapi");
  const neighbors = new Set(city.links.map((key) => state.cities[key].owner).filter((owner) => owner !== "cao"));
  state.treaties = [...neighbors].map((owner) => ({ sides: ["cao", owner].sort(), kind: "truce", expires: 2 }));
  const protectedRow = snapshot(state).find(({ key }) => key === city.key);
  assert.equal(protectedRow.hostile, false);
  assert.equal(protectedRow.shortage, 0);
  assert.equal(protectedRow.aid, null);
  state.turn = 2;
  assert.equal(snapshot(state).find(({ key }) => key === city.key).shortage, 750);
});

test("predicted captures are excluded until settlement and lost cities leave the list", () => {
  const state = createGame(world, 199, "cao");
  Object.assign(state.cities.changan, { troops: 200, defense: 0 });
  const queued = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1000 });
  assert.equal(previewOrders(world, queued).cities.changan.owner, "cao");
  assert.ok(!snapshot(queued).some(({ key }) => key === "changan"));
  const gained = advanceQuarter(world, queued, rest);
  assert.equal(gained.cities.changan.owner, "cao");
  assert.ok(snapshot(gained).some(({ key, shortage }) => key === "changan" && shortage > 0));

  const exposed = createGame(world, 199, "cao");
  exposed.turn = era.factions.findIndex(({ key }) => key === "ma");
  exposed.cities.luoyang.troops = 350;
  exposed.cities.changan.troops = 3200;
  exposed.cities.tianshui.commander = null;
  exposed.stations["ma-1"] = "changan";
  exposed.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: exposed.turn, threshold: 1 };
  assert.ok(snapshot(exposed).some(({ key }) => key === "luoyang"));
  const lost = advanceQuarter(world, exposed, { ...rest, ma: { source: "rules" } });
  assert.equal(lost.cities.luoyang.owner, "ma");
  assert.ok(!snapshot(lost).some(({ key }) => key === "luoyang"));
});

function sharedDonorFixture() {
  const state = fixture();
  state.cities.xiaopei.troops = frontierGarrisonTarget;
  state.cities.xiapi.troops = 800;
  state.cities.shouchun.troops = 950;
  state.cities.puyang.troops = 1400;
  state.cities.chenliu.troops = 1450;
  state.factions.cao.grain = 24;
  return state;
}

test("a grouped plan spends the shared donor and grain only once across its sequential steps", () => {
  const state = sharedDonorFixture();
  const snapshot = structuredClone(state);
  const { steps, remaining, grain, closingGrain } = planFrontierReinforcements(world, state, frontierGarrisonTarget);
  assert.deepEqual(state, snapshot);
  assert.deepEqual(steps.map(({ number, order, before, arrival, retained, shortage }) =>
    [number, order.from, order.to, order.troops, before, arrival, retained, shortage]), [
    [1, "chenliu", "xiapi", 1000, 800, 1800, 450, 0],
    [2, "chenliu", "shouchun", 200, 950, 1150, 250, 650],
  ]);
  assert.deepEqual(remaining, [
    { key: "shouchun", shortage: 650, blocker: "planned" },
    { key: "puyang", shortage: 400, blocker: "donor" },
  ]);
  assert.equal(grain, 24);
  assert.equal(closingGrain, 0);

  const orders = steps.map(({ order }) => order);
  const queued = replaceOrders(world, state, orders);
  const projected = previewOrders(world, queued);
  assert.equal(projected.factions.cao.grain, closingGrain);
  assert.equal(projected.cities.chenliu.troops, 250);
  const readBack = readGameRecord(world, createSaveBackup({ state: queued, selected: "xiapi" })).state;
  assert.deepEqual(readBack, queued);
  const settled = advanceQuarter(world, readBack, rest);
  assert.equal(settled.cities.xiapi.troops, 1800);
  assert.equal(settled.cities.shouchun.troops, 1150);
  assert.equal(settled.history.at(-1).finance.orders.grain, grain);

  const thin = structuredClone(state);
  thin.factions.cao.grain = 22;
  const thinPlan = planFrontierReinforcements(world, thin, frontierGarrisonTarget);
  assert.deepEqual(thinPlan.steps.map(({ order }) => order.to), ["xiapi", "puyang"]);
  assert.equal(thinPlan.closingGrain, 0);
  assert.ok(thinPlan.remaining.some(({ key, shortage }) => key === "shouchun" && shortage === 850));
});

test("a grouped plan uses only the open queue positions after existing cross-city orders", () => {
  let state = sharedDonorFixture();
  state.factions.cao.grain = 80;
  state = queueOrder(world, state, { type: "transfer", from: "chenliu", to: "xiapi", troops: 200,
    route: ["chenliu", "xiaopei", "xiapi"] });
  state = queueOrder(world, state, { type: "build", city: "xu", project: "defense" });
  const { steps, remaining } = planFrontierReinforcements(world, state, frontierGarrisonTarget);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].number, 3);
  assert.equal(steps[0].order.to, "shouchun");
  assert.equal(steps[0].order.troops, 850);
  assert.ok(remaining.some(({ key, shortage, blocker }) => key === "xiapi" && shortage === 800 && blocker === "queue"));
  const full = replaceOrders(world, state, [...state.orders, steps[0].order]);
  assert.deepEqual(full.orders.slice(0, 2), state.orders);
  assert.equal(planFrontierReinforcements(world, full, frontierGarrisonTarget).steps.length, 0);

  const changed = structuredClone(state);
  changed.cities.chenliu.troops = 520;
  assert.throws(() => replaceOrders(world, changed, [...changed.orders, steps[0].order]), /第 3 道政令/);
  assert.deepEqual(changed.orders, state.orders);
});

test("a partly served city gets one recommendation per plan even with another donor available", () => {
  const state = fixture();
  state.cities.xiaopei.troops = frontierGarrisonTarget;
  state.cities.xiapi.troops = 900;
  state.cities.chenliu.troops = 750;
  state.cities.xu.troops = 650;
  const plan = planFrontierReinforcements(world, state, frontierGarrisonTarget);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].order.troops, 500);
  assert.deepEqual(plan.remaining, [{ key: "xiapi", shortage: 400, blocker: "planned" }]);
  const after = replaceOrders(world, state, plan.steps.map(({ order }) => order));
  assert.equal(snapshot(after).find(({ key }) => key === "xiapi").aid.order.from, "xu");
});
