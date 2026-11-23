import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, cityReserve, createGame, forecastAttack, forecastOrderSteps, minimumMarch, playableFactions, previewOrders, queueOrder, replaceOrders,
} from "../dist/engine.js";
import { frontierAttackOpportunities, planFrontierExpeditions } from "../dist/frontier.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const rest = Object.fromEntries(playableFactions(era).filter(({ key }) => key !== "cao")
  .map(({ key }) => [key, { source: "model", order: null }]));

function opportunities(state, faction) {
  return frontierAttackOpportunities(world, state, previewOrders(world, state), { faction });
}

function at(state, target) {
  return opportunities(state).entries.find(({ order }) => order.to === target);
}

test("each hostile target appears once, with the minimum estimated winning force and a valid queued order", () => {
  const state = createGame(world, 199, "cao");
  const before = structuredClone(state);
  const { entries, blocker } = opportunities(state);
  assert.equal(blocker, null);
  assert.equal(new Set(entries.map(({ order }) => order.to)).size, entries.length);
  const changan = entries.find(({ order }) => order.to === "changan");
  assert.equal(changan.order.from, "wan");
  assert.equal(changan.officer.name, "张辽");
  assert.equal(changan.owner, "ma");
  assert.ok(changan.retained >= cityReserve);
  assert.deepEqual(changan.forecast, forecastAttack(era, state, changan.order));
  assert.equal(forecastAttack(era, state, { ...changan.order, troops: changan.order.troops - 1 }).wins, false);
  for (const { order } of entries) assert.doesNotThrow(() => queueOrder(world, state, order));
  assert.deepEqual(state, before);
  const queued = queueOrder(world, state, changan.order);
  const [step] = forecastOrderSteps(world, queued);
  assert.equal(step.entry.battle.attacker.strength, changan.forecast.offense);
  assert.equal(step.entry.battle.defender.strength, changan.forecast.defense);
  assert.equal(step.spent.grain, changan.forecast.grain);
  assert.equal(advanceQuarter(world, queued, rest).cities.changan.owner, "cao");
});

test("equal troop requirements favor the source with more retained troops and the best available commander there", () => {
  const state = createGame(world, 199, "cao");
  Object.assign(state.cities.changan, { troops: 90, defense: 0 });
  state.cities.luoyang.troops = 2300;
  state.cities.wan.troops = 1200;
  const chance = at(state, "changan");
  assert.equal(chance.order.troops, minimumMarch);
  assert.equal(chance.order.from, "luoyang");
  assert.equal(chance.order.officer, "cao-1");
  assert.equal(chance.retained, 2100);
  state.treaties.push({ sides: ["cao", "ma"], kind: "alliance", expires: 3 });
  assert.equal(at(state, "changan"), undefined);
  state.turn = 3;
  assert.equal(at(state, "changan").order.from, "luoyang");
});

test("eligible expeditions account for queued reinforcement, existing leaders and projected captures", () => {
  const state = createGame(world, 199, "cao");
  state.factions.cao.grain = 35;
  state.cities.luoyang.troops = 350;
  state.cities.wan.troops = 350;
  Object.assign(state.cities.changan, { troops: 500, defense: 1 });
  assert.equal(at(state, "changan"), undefined);
  const support = queueOrder(world, state, { type: "transfer", from: "xu", to: "luoyang", troops: 850 });
  const draft = at(support, "changan");
  assert.equal(draft.order.from, "luoyang");
  assert.equal(draft.retained, 1200 - draft.order.troops);
  assert.throws(() => queueOrder(world, state, draft.order), /留守/);
  const queued = queueOrder(world, support, draft.order);
  assert.equal(at(queued, "changan"), undefined);
  assert.equal(previewOrders(world, queued).cities.changan.owner, "cao");
  assert.ok(opportunities(queued).entries.every(({ order }) => order.officer !== draft.order.officer));

  const thin = structuredClone(state);
  thin.factions.cao.grain = 10;
  const exhausted = queueOrder(world, thin, support.orders[0]);
  assert.deepEqual(opportunities(exhausted), { entries: [], blocker: "grain" });

  const occupied = createGame(world, 199, "cao");
  occupied.cities.puyang.troops = 350;
  Object.assign(occupied.cities.ye, { troops: 150, defense: 0 });
  assert.equal(at(occupied, "ye").order.officer, "cao-1");
  const due = queueOrder(world, occupied, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 200 });
  assert.equal(previewOrders(world, due).stations["cao-1"], "luoyang");
  assert.notEqual(at(due, "ye").order.officer, "cao-1");
});

test("the overview distinguishes a full queue, no eligible officers and a finished campaign", () => {
  const state = createGame(world, 199, "cao");
  const full = ["xu", "luoyang", "wan"].reduce((draft, city) => queueOrder(world, draft, { type: "build", city, project: "defense" }), state);
  assert.deepEqual(opportunities(full), { entries: [], blocker: "queue" });
  const noLeader = structuredClone(state);
  for (const { key, faction } of era.officers) {
    if (faction === "cao") noLeader.stations[key] = "xu";
  }
  assert.deepEqual(opportunities(noLeader), { entries: [], blocker: "none" });
  const finished = structuredClone(state);
  for (const city of Object.values(finished.cities)) city.owner = "cao";
  assert.deepEqual(opportunities(finished), { entries: [], blocker: "ended" });
});

test("scoped opportunities select only the faction's eligible projected holdings", () => {
  const state = createGame(world, 199, "cao");
  const global = opportunities(state).entries;
  const scoped = opportunities(state, "biao");
  assert.equal(scoped.blocker, null);
  assert.equal(scoped.entries.length, 2);
  assert.deepEqual(scoped.entries, global.filter(({ owner }) => owner === "biao"));
  const [opportunity] = scoped.entries;
  const queued = queueOrder(world, state, opportunity.order);
  const remaining = opportunities(queued, "biao");
  assert.equal(previewOrders(world, queued).cities[opportunity.order.to].owner, "cao");
  assert.ok(remaining.entries.length > 0);
  assert.ok(remaining.entries.every(({ owner, order }) => owner === "biao" && order.to !== opportunity.order.to));
  assert.deepEqual(opportunities(state).entries, global);
});

test("scoped opportunities distinguish protection, projected elimination, defeat and resource limits", () => {
  const state = createGame(world, 199, "cao");
  state.treaties.push({ sides: ["cao", "ma"], kind: "truce", expires: 2 });
  assert.deepEqual(opportunities(state, "ma"), { entries: [], blocker: "treaty" });
  state.turn = 2;
  assert.equal(opportunities(state, "ma").blocker, null);
  const full = ["xu", "luoyang", "wan"].reduce((draft, city) => queueOrder(world, draft, { type: "build", city, project: "defense" }), state);
  assert.deepEqual(opportunities(full, "ma"), { entries: [], blocker: "queue" });
  const thin = structuredClone(state);
  thin.factions.cao.grain = 1;
  assert.deepEqual(opportunities(thin, "ma"), { entries: [], blocker: "grain" });

  for (const [key, city] of Object.entries(state.cities)) {
    if (city.owner === "ma" && key !== "changan") Object.assign(city, { owner: "cao", governor: null, commander: null });
  }
  for (const { key, faction } of era.officers) if (faction === "ma") state.stations[key] = "changan";
  Object.assign(state.cities.changan, { troops: 200, defense: 0 });
  const [last] = opportunities(state, "ma").entries;
  const projected = queueOrder(world, state, last.order);
  assert.equal(state.cities.changan.owner, "ma");
  assert.equal(previewOrders(world, projected).cities.changan.owner, "cao");
  assert.deepEqual(opportunities(projected, "ma"), { entries: [], blocker: "projected-loss" });
  const settled = advanceQuarter(world, projected, rest);
  assert.deepEqual(opportunities(settled, "ma"), { entries: [], blocker: "eliminated" });
  for (const city of Object.values(settled.cities)) if (city.owner === "cao") city.owner = "biao";
  assert.deepEqual(opportunities(settled, "biao"), { entries: [], blocker: "ended" });
});

test("multi-city expedition plans recalculate conflicting origins and leaders before saving the exact orders", () => {
  const state = createGame(world, 265, "wu");
  const before = structuredClone(state);
  const [first, competing] = opportunities(state, "jin").entries;
  assert.equal(first.order.officer, competing.order.officer);
  assert.equal(first.order.from, competing.order.from);
  const { steps, blocker, grain, closingGrain } = planFrontierExpeditions(world, state, { faction: "jin", limit: 2 });
  assert.equal(blocker, null);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].order, first.order);
  assert.equal(steps[1].order.to, competing.order.to);
  assert.notEqual(steps[1].order.from, competing.order.from);
  assert.notEqual(steps[1].order.officer, competing.order.officer);
  assert.deepEqual(steps.map(({ number }) => number), [1, 2]);
  assert.ok(steps.every(({ owner, forecast }) => owner === "jin" && forecast.wins));
  assert.deepEqual(state, before);

  const queued = replaceOrders(world, state, steps.map(({ order }) => order));
  const restored = readGameRecord(world, createSaveBackup({ state: queued, selected: first.order.from })).state;
  assert.deepEqual(restored.orders, queued.orders);
  const receipts = forecastOrderSteps(world, restored);
  assert.deepEqual(receipts.map(({ entry }) => entry.type), ["capture", "capture"]);
  assert.deepEqual(receipts.map(({ spent }) => spent.grain), steps.map(({ forecast }) => forecast.grain));
  assert.equal(grain, receipts[0].spent.grain + receipts[1].spent.grain);
  assert.equal(closingGrain, previewOrders(world, restored).factions.wu.grain);
});

test("multi-city plans use queued support and stop at scope, grain or capacity limits", () => {
  const state = createGame(world, 199, "cao");
  state.cities.luoyang.troops = 350;
  state.cities.wan.troops = 350;
  Object.assign(state.cities.changan, { troops: 500, defense: 1 });
  assert.equal(planFrontierExpeditions(world, state, { faction: "ma" }).steps.length, 0);
  const support = queueOrder(world, state, { type: "transfer", from: "xu", to: "luoyang", troops: 850 });
  const plan = planFrontierExpeditions(world, support, { faction: "ma", limit: 2 });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.blocker, "none");
  const [step] = plan.steps;
  assert.equal(step.number, 2);
  assert.equal(step.order.from, "luoyang");
  assert.equal(step.order.to, "changan");
  assert.equal(step.retained, 1200 - step.order.troops);
  assert.equal(plan.grain, step.forecast.grain);

  const protectedState = structuredClone(support);
  protectedState.treaties.push({ sides: ["cao", "ma"], kind: "truce", expires: 2 });
  assert.equal(planFrontierExpeditions(world, protectedState, { faction: "ma" }).blocker, "treaty");
  const thin = structuredClone(support);
  thin.factions.cao.grain = 10;
  assert.equal(planFrontierExpeditions(world, thin).blocker, "grain");
  const full = ["luoyang", "wan"].reduce((queued, city) => queueOrder(world, queued, { type: "build", city, project: "defense" }), support);
  const blocked = planFrontierExpeditions(world, full);
  assert.equal(blocked.blocker, "queue");
  assert.deepEqual(blocked.steps, []);
});
