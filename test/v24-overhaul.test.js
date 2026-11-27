import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityRevenues, createGame, decodeSave, eraByYear, forecastAttack } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { fundMegaprojectStage, listMegaprojectsStatus, megaprojectEconomyModifiers } from "../dist/megaprojects.js";
import { craftSiegeEngine, engineInCity, siegeEngineCombatModifiers } from "../dist/siege-engines.js";
import { issuePublicEdict } from "../dist/edicts.js";
import { dispatchDisasterRelief, listActiveDisasters, settleDisastersTurn } from "../dist/relief.js";
import { archiveCurrentHistory, composeDynastyHistory, listArchivedHistories } from "../dist/annals-book.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "cao") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v24.0 megaprojects 3-stage funding and permanent economy boost", () => {
  let state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 500;
  state.factions.cao.grain = 400;
  const xu = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao");
  const revBefore = cityRevenues(state, xu);

  for (let i = 0; i < 3; i++) {
    const r = fundMegaprojectStage(state, "zhengguo");
    assert.equal(r.ok, true);
    state = r.state;
  }
  const st = listMegaprojectsStatus(state).find((p) => p.id === "zhengguo");
  assert.equal(st.completed, true);
  assert.ok(megaprojectEconomyModifiers(state, "cao").treasuryMult >= 1.12);
  assert.ok(cityRevenues(state, xu).treasury >= revBefore.treasury);
  assert.equal(decodeSave(world, JSON.stringify(state)).year, 208);
});

test("v24.0 siege engines crafting and forecastAttack combat bonuses", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 300;
  state.factions.cao.grain = 200;
  const era = eraByYear(world, state);
  const fromKey = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao");
  const toKey = Object.keys(state.cities).find((k) => state.cities[k].owner !== "cao");
  const officer = era.officers.find((o) => o.faction === "cao");

  const crafted = craftSiegeEngine(world, state, fromKey, "trebuchet");
  assert.equal(crafted.ok, true);
  assert.equal(engineInCity(crafted.state, fromKey).id, "trebuchet");
  assert.ok(siegeEngineCombatModifiers(crafted.state, { fromKey, toKey }).wallFactor < 0.7);

  const baseFc = forecastAttack(era, state, { from: fromKey, to: toKey, officer: officer.key, troops: 4000 }, "cao");
  const engFc = forecastAttack(era, crafted.state, { from: fromKey, to: toKey, officer: officer.key, troops: 4000 }, "cao");
  assert.ok(engFc.offense > baseFc.offense);
  assert.ok(engFc.defense < baseFc.defense);
});

test("v24.0 public edicts, dynamic disaster spread/relief and Dynasty Annals archive", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };

  let state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 400;
  state.factions.cao.grain = 300;
  const era = eraByYear(world, state);

  const ed = issuePublicEdict(world, era, state, "denounce_rebel", { targetFaction: "liu" });
  assert.equal(ed.ok, true);
  assert.ok(ed.state.factions.liu.morale < state.factions.liu.morale);

  // 动态灾疫生成 -> 蔓延 -> 太医署扑灭
  ed.state.turn = 2;
  const d1 = settleDisastersTurn(world, ed.state);
  assert.ok(listActiveDisasters(d1.state).length >= 1);
  const disCity = listActiveDisasters(d1.state)[0].cityKey;

  d1.state.turn = 3;
  const d2 = settleDisastersTurn(world, d1.state);
  assert.ok(listActiveDisasters(d2.state).length >= 2);

  const cured = dispatchDisasterRelief(world, d2.state, disCity, "medical");
  assert.equal(cured.ok, true);
  assert.ok(!listActiveDisasters(cured.state).some((x) => x.cityKey === disCity));

  // 纪传体本朝实录撰写与归档
  const book = composeDynastyHistory(world, era, cured.state);
  assert.ok(book.fullText.includes("本纪") && book.fullText.includes("名将列传") && book.fullText.includes("疆域与工程志"));
  const archived = archiveCurrentHistory(world, era, cured.state);
  assert.equal(archived.ok, true);
  assert.equal(listArchivedHistories().length, 1);
});
