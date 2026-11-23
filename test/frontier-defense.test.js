import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, appoint, createGame, defensiveStrength, forecastAttack, playableFactions, previewOrders, queueOrder,
} from "../dist/engine.js";
import { frontierDefensePressure } from "../dist/frontier.js";
import { frontierGarrisonTarget } from "../dist/objectives.js";
import { enrichWorld } from "../dist/personnel.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const rest = Object.fromEntries(playableFactions(era).filter(({ key }) => key !== "cao")
  .map(({ key }) => [key, { source: "model", order: null }]));

function pressure(state) {
  return frontierDefensePressure(world, state, previewOrders(world, state), frontierGarrisonTarget);
}

function luoyang(state) {
  return pressure(state).find(({ key }) => key === "luoyang");
}

function guardedFixture() {
  let state = createGame(world, 199, "cao");
  Object.assign(state.cities.luoyang, { troops: 1200, defense: 1 });
  state.cities.changan.troops = 1350;
  state.factions.yuan.grain = 0;
  state = appoint(world, state, "luoyang", "commander", "cao-1");
  return state;
}

test("a proposed reinforcement reverses the forecast using the actual city defense and standing commander", () => {
  const before = guardedFixture();
  const original = luoyang(before);
  assert.equal(original.projected.threat.from, "changan");
  assert.equal(original.projected.threat.officer, "马腾");
  assert.equal(original.projected.threat.wins, false);
  assert.ok(original.current.defense > before.cities.luoyang.troops + 180);
  const queued = queueOrder(world, before, { type: "transfer", from: "luoyang", to: "xu", troops: 400 });
  const snapshot = structuredClone(queued);
  const danger = luoyang(queued);
  assert.equal(danger.current.defense, original.current.defense);
  assert.equal(danger.projected.threat.wins, true);
  assert.equal(danger.weakened, true);
  assert.equal(danger.aid.order.from, "xu");
  assert.ok(danger.aid.order.troops > 200);
  assert.deepEqual(queued, snapshot);
  const reinforced = queueOrder(world, queued, danger.aid.order);
  const after = luoyang(reinforced);
  assert.equal(after.projected.defense, danger.aid.defense);
  assert.equal(after.projected.threat.wins, false);
  const projected = previewOrders(world, reinforced).cities.luoyang;
  assert.ok(defensiveStrength(era, { ...projected, troops: projected.troops - 1 }) < after.projected.threat.offense);
  const settled = advanceQuarter(world, reinforced, rest);
  assert.equal(defensiveStrength(era, settled.cities.luoyang), after.projected.defense);

  const fortified = queueOrder(world, queued, { type: "build", city: "luoyang", project: "defense" });
  assert.equal(luoyang(fortified).projected.defense, danger.projected.defense + 180);
  const stronger = structuredClone(queued);
  stronger.cities.changan.troops = 3400;
  stronger.cities.xu.troops = 300;
  const partial = luoyang(stronger);
  assert.ok(partial.aid.order);
  assert.ok(partial.aid.defense > partial.projected.defense && partial.aid.defense < partial.projected.threat.offense);
});

test("the strongest feasible neighbor is limited by grain, reserve troops, available leaders and treaties", () => {
  const state = guardedFixture();
  state.factions.yuan.grain = 80;
  const fullest = luoyang(state).current.threat;
  assert.equal(fullest.from, "ye");
  assert.equal(fullest.officer, "张郃");
  const limitedQuote = forecastAttack(era, state, { type: "attack", from: "ye", to: "luoyang", troops: 200,
    officer: "yuan-roster-6" }, "yuan");
  state.factions.yuan.grain = 2;
  state.treaties = [{ sides: ["cao", "ma"], kind: "truce", expires: 2 }];
  assert.equal(luoyang(state).current.threat.offense, limitedQuote.offense);
  state.factions.yuan.grain = 1;
  assert.equal(luoyang(state).current.status, "unavailable");
  state.treaties.push({ sides: ["cao", "yuan"], kind: "alliance", expires: 2 });
  assert.equal(luoyang(state).current.status, "treaty");
  state.turn = 2;
  assert.equal(luoyang(state).current.threat.from, "changan");
  state.stations["ma-roster-0"] = "anding";
  assert.equal(luoyang(state).current.status, "unavailable");
  state.stations["ma-roster-0"] = "changan";
  state.cities.changan.troops = 449;
  assert.equal(luoyang(state).current.status, "unavailable");
  const thinned = queueOrder(world, state, { type: "transfer", from: "luoyang", to: "xu", troops: 400 });
  assert.equal(luoyang(thinned).weakened, true);
  assert.equal(luoyang(thinned).margin, null);
});

test("an existing order can remove an enemy neighbor and move a city's commander out of its defense estimate", () => {
  const state = guardedFixture();
  state.factions.yuan.grain = 80;
  state.cities.ye.troops = 1100;
  Object.assign(state.cities.changan, { troops: 90, defense: 0 });
  const march = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 200 });
  const after = luoyang(march);
  assert.equal(previewOrders(world, march).cities.luoyang.commander, null);
  assert.equal(after.projected.threat.from, "ye");
  assert.equal(after.projected.defense, 1180);
  assert.equal(after.weakened, true);
  const rows = pressure(march);
  const risks = rows.filter(({ margin }) => margin > 0);
  assert.ok(risks.length > 0);
  assert.deepEqual(rows.slice(0, risks.length), risks);
  assert.ok(!rows.some(({ key }) => key === "changan"));
});
