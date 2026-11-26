import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, createGame, decodeSave, previewOrders, queueOrder,
} from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import {
  applyCityDirective, applySovereignDoctrine, autoStaffRealm, bestAttackPlan,
  buildImperialMemorials, detectSovereignDoctrine, executeSovereignAttack,
} from "../dist/sovereign.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

test("autoStaffRealm fills vacant governors and commanders using traits and preserves save compatibility", () => {
  const base = createGame(world, 199, "cao");
  const { state: staffed, appointed, governors, commanders } = autoStaffRealm(world, base);

  assert.ok(appointed >= 5, "should fill multiple vacant posts across 199 Cao realm");
  assert.ok(governors >= 3);
  assert.ok(commanders >= 2);
  // 荀彧 (屯田) should be appointed as a city governor
  const xunYuKey = world.scenarios.find((s) => s.year === 199).officers.find((o) => o.name === "荀彧").key;
  const xunYuGovernor = Object.values(staffed.cities).some((c) => c.owner === "cao" && c.governor === xunYuKey);
  assert.ok(xunYuGovernor, "荀彧 should be drafted into governor post");

  const roundTrip = decodeSave(world, JSON.stringify(staffed));
  assert.deepEqual(Object.keys(roundTrip.cities), Object.keys(staffed.cities));
});

test("applySovereignDoctrine configures policy without overrides, detects doctrine, and advances cleanly", () => {
  const base = createGame(world, 199, "cao");
  const res = applySovereignDoctrine(world, base, "prepare");
  assert.equal(detectSovereignDoctrine(res.state), "prepare");
  assert.equal(res.state.policyOverrides, undefined);
  assert.ok(res.delegatedCount >= 5);

  const rest = applySovereignDoctrine(world, res.state, "rest", { autoStaff: false });
  assert.equal(detectSovereignDoctrine(rest.state), "rest");
  assert.equal(rest.state.policyOverrides, undefined);

  const afterQuarter = advanceQuarter(world, rest.state);
  assert.equal(afterQuarter.turn, rest.state.turn + 1);
  assert.equal(detectSovereignDoctrine(afterQuarter), "rest");
});

test("applyCityDirective switches a city to front/rear/direct with automatic governor appointment", () => {
  const base = createGame(world, 199, "cao");
  assert.equal(base.cities.luoyang.governor, null);
  const { state: fronted, autoAppointed } = applyCityDirective(world, base, "luoyang", "front");
  assert.ok(autoAppointed);
  assert.equal(fronted.cities.luoyang.mode, "delegated");
  assert.equal(fronted.cities.luoyang.focus, "recruit");

  const { state: directed } = applyCityDirective(world, fronted, "luoyang", "direct");
  assert.equal(directed.cities.luoyang.mode, "direct");
});

test("bestAttackPlan & executeSovereignAttack auto-transfer idle general when needed and validate treaties", () => {
  const base = createGame(world, 199, "cao");
  const planned = previewOrders(world, base);

  // Target neighboring Ye (袁绍) or Chang'an (马腾)
  const yePlan = bestAttackPlan(world, base, planned, "ye");
  assert.equal(yePlan.ok, true);
  assert.ok(yePlan.from);
  assert.ok(yePlan.troops >= 200);
  const queued = executeSovereignAttack(world, base, yePlan);
  assert.equal(queued.orders.length, 1);
  assert.equal(queued.orders[0].type, "attack");
  assert.equal(queued.orders[0].to, "ye");

  // Unreachable far city
  const chengduPlan = bestAttackPlan(world, base, planned, "chengdu");
  assert.equal(chengduPlan.ok, false);
  assert.equal(chengduPlan.reason, "unreachable");

  // Full queue
  let full = queued;
  const ownCity = Object.keys(full.cities).find((k) => full.cities[k].owner === "cao");
  full = queueOrder(world, full, { type: "build", city: ownCity, project: "farming" });
  full = queueOrder(world, full, { type: "build", city: ownCity, project: "commerce" });
  const overPlan = bestAttackPlan(world, full, previewOrders(world, full), "changan");
  assert.equal(overPlan.ok, false);
  assert.equal(overPlan.reason, "queue-full");
});

test("bestAttackPlan excludes already-queued officers so sequential 1-click attacks never conflict", () => {
  const base = createGame(world, 199, "cao");
  const firstPlan = bestAttackPlan(world, base, previewOrders(world, base), "ye");
  assert.equal(firstPlan.ok, true);
  const afterFirst = executeSovereignAttack(world, base, firstPlan);

  const secondPlan = bestAttackPlan(world, afterFirst, previewOrders(world, afterFirst), "changan");
  assert.equal(secondPlan.ok, true);
  assert.notEqual(secondPlan.officer.key, firstPlan.officer.key);
  const afterSecond = executeSovereignAttack(world, afterFirst, secondPlan);
  assert.equal(afterSecond.orders.length, 2);
});

test("buildImperialMemorials picks chief advisor, caps <= 3 items, and prioritizes envoys", () => {
  const base = createGame(world, 199, "cao");
  const withEnvoy = {
    ...base,
    incomingTreaty: { from: "sunce", kind: "truce", answer: null, terms: "停战两季", expires: base.turn + 2 },
  };
  const brief = buildImperialMemorials(world, withEnvoy, previewOrders(world, withEnvoy));
  assert.ok(brief.advisor);
  assert.ok(["荀彧", "郭嘉"].includes(brief.advisor.officer.name));
  assert.ok(brief.memorials.length >= 1 && brief.memorials.length <= 3);
  assert.equal(brief.memorials[0].kind, "envoy");
});
