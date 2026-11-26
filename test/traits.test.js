import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, appoint, createGame, decodeSave, forecastAttack, forecastDelegation, queueOrder, setGovernance,
} from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { combatTraitEffects, governorTraitDiscount, hasTrait, officerMeta } from "../dist/traits.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

test("famous officers carry 4-dim stats, surname seals, and curated traits", () => {
  const era208 = world.scenarios.find((s) => s.year === 208);
  const zhouYu = era208.officers.find((o) => o.name === "周瑜");
  const zhaoYun = era208.officers.find((o) => o.name === "赵云");
  const xunYu = era208.officers.find((o) => o.name === "荀彧");

  assert.ok(zhouYu && zhaoYun && xunYu);
  const zyMeta = officerMeta(zhouYu);
  assert.equal(zyMeta.seal, "周");
  assert.equal(zyMeta.title, "公瑾");
  assert.ok(zyMeta.intellect >= 95);
  assert.ok(hasTrait(zhouYu, "fire") && hasTrait(zhouYu, "navy"));
  assert.ok(officerMeta(zhaoYun).might >= 95);
  assert.ok(hasTrait(xunYu, "farming") && hasTrait(xunYu, "logistics"));
});

test("combatTraitEffects stays strictly neutral outside century mode and activates in century mode", () => {
  const era208 = world.scenarios.find((s) => s.year === 208);
  const zhouYu = era208.officers.find((o) => o.name === "周瑜");
  const caoRen = era208.officers.find((o) => o.name === "曹仁");

  const legacyState = createGame(world, 208, "wu");
  const neutral = combatTraitEffects({ attacker: zhouYu, defender: caoRen, weather: { terrain: "river" }, travel: "water", state: legacyState });
  assert.equal(neutral.attackMult, 1);
  assert.equal(neutral.defenseMult, 1);
  assert.equal(neutral.wallFactor, 1);
  assert.equal(neutral.ignoreWeather, false);

  const centuryState = createGame(world, 208, "wu", { century: true });
  const active = combatTraitEffects({ attacker: zhouYu, defender: caoRen, weather: { terrain: "river" }, travel: "water", state: centuryState });
  assert.ok(active.attackMult > 1.2);
  assert.ok(active.defenseMult > 1.1);
  assert.deepEqual(active.attackerTraits, ["火攻", "水师"]);
  assert.deepEqual(active.defenderTraits, ["铁壁", "威名"]);
});

test("century mode forecastAttack and advanceQuarter match trait bonuses and governor discount", () => {
  let state = createGame(world, 199, "cao", { century: true });
  const era = world.scenarios.find((s) => s.year === 199);
  const xunYu = era.officers.find((o) => o.name === "荀彧");
  const zhangLiao = era.officers.find((o) => o.name === "张辽");
  assert.ok(xunYu && zhangLiao);

  state = appoint(world, state, "xu", "governor", xunYu.key);
  assert.equal(governorTraitDiscount(era, state.cities.xu, "farming", state), 3);
  state = setGovernance(state, "xu", "delegated", "farming", 20);
  const forecast = forecastDelegation(world, state, ["xu"], "farming", 20);
  assert.equal(forecast.programs[0].result, "completed");
  assert.ok(forecast.programs[0].spent.treasury <= 12);

  state.stations[zhangLiao.key] = "luoyang";
  state = appoint(world, state, "luoyang", "commander", zhangLiao.key);
  const troops = Math.max(200, state.cities.luoyang.troops - 250);
  const attack = { type: "attack", from: "luoyang", to: "changan", officer: zhangLiao.key, troops };
  assert.throws(() => queueOrder(world, state, attack), /整军备战/);

  state.turn = 1;
  const preview = forecastAttack(era, state, attack);
  assert.ok(preview.traitNotes.attacker.includes("突骑"));
  assert.ok(preview.traitNotes.attacker.includes("奇袭"));

  state = queueOrder(world, state, attack);
  const next = advanceQuarter(world, state);
  const battleEntry = next.history[0].entries.find((e) => e.city === "changan" && (e.type === "capture" || e.type === "battle"));
  assert.ok(battleEntry);
  assert.equal(battleEntry.battle.attacker.strength, preview.offense);
  // Restore polity atlas continuity before round-trip decodeSave check if needed
  next.polity.atlas[0].turn = next.turn - 1;
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
});
