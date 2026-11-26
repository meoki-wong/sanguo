import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, appoint, createGame, decodeSave, forecastAttack, previewOrders, queueOrder,
} from "../dist/engine.js";
import { provinceAgreement15 } from "../dist/century.js";
import { enrichWorld } from "../dist/personnel.js";
import { regionCandidates10 } from "../dist/reign.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import {
  applySovereignDoctrine, appointAllProvinceGovernors, assignProvinceGovernor,
  bestAttackPlan, executeSovereignAttack, executeSovereignReinforce, listSovereignProvinces, quickReinforcePlan,
} from "../dist/sovereign.js";
import { BATTLE_TACTICS, DIFFICULTY_LEVELS, isOpeningPrepTurn } from "../dist/tactics.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

test("opening preparation turn (turn 0) blocks premature attacks and unlocks at turn 1", () => {
  const state = createGame(world, 199, "cao", { century: true, difficulty: "hard" });
  assert.equal(isOpeningPrepTurn(state), true);
  assert.equal(state.difficulty, "hard");

  const plan = bestAttackPlan(world, state, previewOrders(world, state), "ye");
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "opening-prep");

  const zhangLiao = world.scenarios.find((s) => s.year === 199).officers.find((o) => o.name === "张辽");
  state.stations[zhangLiao.key] = "luoyang";
  assert.throws(() => queueOrder(world, state, {
    type: "attack", from: "luoyang", to: "ye", officer: zhangLiao.key, troops: 1000,
  }), /整军备战/);

  const next = advanceQuarter(world, state);
  assert.equal(isOpeningPrepTurn(next), false);
  // AI rule-orders must also not dispatch direct attack orders during Turn 0 opening prep
  const turn1DirectAttacks = next.history[0].decisions.filter((d) => d.orderType === "attack");
  assert.equal(turn1DirectAttacks.length, 0);
});

test("provincial governor appointment works directly without prior manual annual form and falls back across cities", () => {
  const base = createGame(world, 208, "liu", { century: true, difficulty: "hard" });
  assert.equal(base.century.plan, null);

  // Even without manually visiting century-dialog policy, provinceAgreement15 auto-initializes and succeeds
  const provinces = listSovereignProvinces(world, base);
  assert.ok(provinces.length >= 1);
  const region = provinces[0].region;
  const appointed = provinceAgreement15(world, base, region, "renew");
  assert.ok(appointed.century.plan);
  assert.ok(appointed.reign.seats[region]?.lead);

  // Single-province assignment & all-province assignment under Cao 199 (multiple provinces, some without many idle locals)
  const cao = createGame(world, 199, "cao", { century: true, difficulty: "hard" });
  const staffed = applySovereignDoctrine(world, cao, "prepare");
  assert.ok(staffed.state.nationalPolicy);
  assert.equal(staffed.state.century.plan.primary, "accord");

  const caoProvs = listSovereignProvinces(world, staffed.state);
  assert.ok(caoProvs.length >= 2);
  assert.ok(caoProvs.every((p) => p.leadOfficer && p.seat?.end > staffed.state.turn));

  // Cross-city fallback works even if target region has no idle locals
  const testState = appointAllProvinceGovernors(world, staffed.state).state;
  const anyRegion = caoProvs.at(-1).region;
  assert.ok(regionCandidates10(world, testState, anyRegion).length >= 1);

  const custom = assignProvinceGovernor(world, testState, anyRegion, { directive: "defense" });
  assert.equal(custom.state.reign.seats[anyRegion].objective, "defense");
  decodeSave(world, JSON.stringify(custom.state));
});

test("intellect stratagem beats high-troop brute defender, backfires vs master strategist, and siege cuts heavy walls", () => {
  const era208 = world.scenarios.find((s) => s.year === 208);
  let state = createGame(world, 208, "wu", { century: true, difficulty: "standard" });
  state.turn = 1;
  state.factions.wu.treasury = 300;
  state.factions.wu.grain = 300;
  state.factions.wu.morale = 80;
  state.factions.cao.morale = 75;

  const zhouYu = era208.officers.find((o) => o.name === "周瑜");
  const caoHong = era208.officers.find((o) => o.name === "曹洪"); // Might 82, Int 62
  const jiaXu = era208.officers.find((o) => o.name === "贾诩"); // Int 97
  assert.ok(zhouYu && caoHong && jiaXu);

  // Set Wu adjacent attack Lujiang -> Shouchun (defended by Cao Hong with Level 3 walls + 2,100 troops)
  state.cities.lujiang.owner = "wu";
  state.cities.lujiang.troops = 2100;
  state.cities.shouchun.owner = "cao";
  state.cities.shouchun.troops = 2100;
  state.cities.shouchun.defense = 3;
  state.cities.shouchun.commander = caoHong.key;
  state.stations[caoHong.key] = "shouchun";
  if (state.cities.lujiang.commander && state.cities.lujiang.commander !== zhouYu.key) {
    state.cities.lujiang.commander = null;
  }
  state.stations[zhouYu.key] = "lujiang";

  // Equal troops (1750 vs 2100 behind Lv3 walls): frontal assault struggles vs walls, while stratagem/siege wins
  const assaultPreview = forecastAttack(era208, state, {
    type: "attack", from: "lujiang", to: "shouchun", officer: zhouYu.key, troops: 1750, tactic: "assault",
  });
  const stratagemPreview = forecastAttack(era208, state, {
    type: "attack", from: "lujiang", to: "shouchun", officer: zhouYu.key, troops: 1750, tactic: "stratagem",
  });
  const siegePreview = forecastAttack(era208, state, {
    type: "attack", from: "lujiang", to: "shouchun", officer: zhouYu.key, troops: 1750, tactic: "siege",
  });

  assert.equal(assaultPreview.wins, false, "Equal/smaller force should not win via brute frontal assault on Lv3 walls");
  assert.equal(stratagemPreview.tacticTag, "奇谋破敌");
  assert.ok(stratagemPreview.offense > assaultPreview.offense * 1.25);
  assert.ok(siegePreview.defense < assaultPreview.defense * 0.82, "Siege equipment sharply cuts heavy fortifications");
  assert.ok(siegePreview.estimatedAttackerLoss < assaultPreview.estimatedAttackerLoss);

  // If a general with lower intellect than Jia Xu (Int 97) tries stratagem, it gets seen through
  const chengPu = era208.officers.find((o) => o.name === "程普"); // Int 78
  assert.ok(chengPu);
  state.cities.shouchun.commander = jiaXu.key;
  state.stations[jiaXu.key] = "shouchun";
  const chengPuAssault = forecastAttack(era208, state, {
    type: "attack", from: "lujiang", to: "shouchun", officer: chengPu.key, troops: 1750, tactic: "assault",
  });
  const trapPreview = forecastAttack(era208, state, {
    type: "attack", from: "lujiang", to: "shouchun", officer: chengPu.key, troops: 1750, tactic: "stratagem",
  });
  assert.equal(trapPreview.tacticTag, "计略识破");
  assert.ok(trapPreview.offense < chengPuAssault.offense * 0.9);

  // Execute rally vs newly occupied city
  state.cities.shouchun.commander = null;
  state.cities.shouchun.occupation = 2;
  state.factions.cao.morale = 55;
  const rallyPreview = forecastAttack(era208, state, {
    type: "attack", from: "lujiang", to: "shouchun", officer: zhouYu.key, troops: 1750, tactic: "rally",
  });
  assert.equal(rallyPreview.tacticTag, "军心摇动");
  assert.equal(rallyPreview.postCaptureOccupationDelta, -1);

  const queued = queueOrder(world, state, {
    type: "attack", from: "lujiang", to: "shouchun", officer: zhouYu.key, troops: 1750, tactic: "rally",
  });
  const after = advanceQuarter(world, queued);
  assert.equal(after.cities.shouchun.owner, "wu");
  assert.equal(after.cities.shouchun.occupation, 1);
  assert.ok(BATTLE_TACTICS.siege.treasury === 12);
});

test("bestAttackPlan supports explicit tactic switching, quick reinforce, difficulty bonuses, and backup round-trip", () => {
  const std = createGame(world, 199, "cao", { century: true, difficulty: "standard" });
  let hell = createGame(world, 199, "cao", { century: true, difficulty: "hell" });
  assert.equal(Object.keys(DIFFICULTY_LEVELS).length, 3);
  assert.ok(hell.cities.ye.troops > std.cities.ye.troops);
  assert.ok(hell.factions.yuan.treasury > std.factions.yuan.treasury);
  assert.ok(hell.cities.nanyang || hell.cities.changan.commander);

  hell = advanceQuarter(world, hell);
  hell.factions.cao.treasury = 250;
  hell.factions.cao.grain = 250;
  const planned = previewOrders(world, hell);

  const autoPlan = bestAttackPlan(world, hell, planned, "ye");
  assert.equal(autoPlan.ok, true);
  const siegePlan = bestAttackPlan(world, hell, planned, "ye", { tactic: "siege" });
  assert.equal(siegePlan.ok, true);
  assert.equal(siegePlan.tactic, "siege");
  assert.equal(siegePlan.treasury, 12);

  const attacked = executeSovereignAttack(world, hell, siegePlan);
  assert.equal(attacked.orders[0].tactic, "siege");

  // Quick reinforce from rear city
  const reinforce = quickReinforcePlan(world, hell, planned, "luoyang");
  if (reinforce.ok) {
    const withReinforce = executeSovereignReinforce(world, hell, reinforce);
    assert.equal(withReinforce.orders.at(-1).type, "transfer");
  }

  // Advance multiple quarters under hell difficulty and test backup save/restore preserves difficulty & multi-order AI
  let sim = advanceQuarter(world, attacked);
  sim = advanceQuarter(world, sim);
  const backup = createSaveBackup({ state: sim, selected: "luoyang" });
  const restored = readGameRecord(world, backup);
  assert.equal(restored.state.difficulty, "hell");
  assert.deepEqual(restored.state, sim);
});
