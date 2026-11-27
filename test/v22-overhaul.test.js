import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGame, decodeSave, eraByYear, playableFactions } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { claimRoadmapReward, evaluateRoadmap } from "../dist/roadmap.js";
import { inciteCityDefection, settleUpheavalTurn } from "../dist/upheaval.js";
import { computeCampaignLedger, deleteSaveSlot, listSaveSlots, loadFromSlot, saveToSlot } from "../dist/save-slots.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "cao") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v22.0 new scenarios 194 Xuzhou and 225 Nanzhong cover all 44 cities and decodeSave cleanly", () => {
  const era194 = eraByYear(world, 194);
  const era225 = eraByYear(world, 225);
  assert.equal(era194.title, "徐州风云");
  assert.equal(era225.title, "南中平定");
  assert.equal(Object.keys(era194.ownership).length, 44);
  assert.equal(Object.keys(era225.ownership).length, 44);
  assert.ok(playableFactions(era194).some((f) => f.key === "lvbu"));
  assert.ok(playableFactions(era194).some((f) => f.key === "liu"));
  assert.ok(playableFactions(era225).some((f) => f.key === "shi"));

  const g194 = makeCenturyGame(194, "lvbu");
  const g225 = makeCenturyGame(225, "shu");
  assert.equal(decodeSave(world, JSON.stringify(g194)).year, 194);
  assert.equal(decodeSave(world, JSON.stringify(g225)).year, 225);
});

test("v22.0 4-stage hegemony roadmap evaluation and reward claim", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.grain = 220;
  const stages = evaluateRoadmap(state);
  assert.equal(stages.length, 4);
  assert.equal(stages[0].claimable, true);

  const beforeGold = state.factions.cao.treasury;
  const claimed = claimRoadmapReward(state, stages[0].id);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.state.factions.cao.treasury, beforeGold + 70);
  assert.equal(evaluateRoadmap(claimed.state)[0].claimed, true);
});

test("v22.0 upheaval defection and fallen-faction restoration", () => {
  const state = makeCenturyGame(208, "cao");
  state.saga.reputation = 82;
  state.factions.cao.treasury = 200;
  const adjEnemy = world.cities.find((c) => state.cities[c.key].owner !== "cao" && (c.links || []).some((n) => state.cities[n].owner === "cao"));
  assert.ok(adjEnemy);
  state.cities[adjEnemy.key].troops = 2000;
  state.factions[state.cities[adjEnemy.key].owner].morale = 50;

  const def = inciteCityDefection(world, state, adjEnemy.key, "cao");
  assert.equal(def.ok, true);
  assert.equal(def.captured, true);
  assert.equal(def.state.cities[adjEnemy.key].owner, "cao");

  // 测试流亡复国结算不会抛错
  const s6 = structuredClone(def.state);
  s6.turn = 6;
  const uph = settleUpheavalTurn(world, eraByYear(world, s6), s6);
  assert.ok(uph.state);
});

test("v22.0 5-slot save manager and campaign MVP ledger", () => {
  // 在 Node 中提供简易内存 localStorage 模拟验证持久化闭环
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };

  const state = makeCenturyGame(208, "cao");
  const era = eraByYear(world, state);
  const ledger = computeCampaignLedger(era, state);
  assert.ok(ledger.ownedCount > 0 && ledger.mvp.name.length > 0);

  const saved = saveToSlot("slot_1", { world, era, state, selected: Object.keys(state.cities)[0] });
  assert.equal(saved.ok, true);
  const slots = listSaveSlots();
  assert.equal(slots.length, 5);
  assert.equal(slots[0].empty, false);

  const loaded = loadFromSlot(world, "slot_1");
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.year, 208);

  deleteSaveSlot("slot_1");
  assert.equal(listSaveSlots()[0].empty, true);
});
