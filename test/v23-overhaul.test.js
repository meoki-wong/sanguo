import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityRevenues, createGame, decodeSave, eraByYear, forecastAttack } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { annexVassal, demandVassalage, listVassals, settleVassalsTurn } from "../dist/vassals.js";
import { activeSpecialtiesFor, citySpecialty, specialtyCombatModifiers, specialtyEconomyModifiers } from "../dist/specialties.js";
import { castStratagemScroll, isChainFireActive, isEmptyFortActive, scrollCombatModifiers } from "../dist/stratagem-scrolls.js";
import { awakenHeroDestiny, destinyCombatModifiers, evaluateDestinies } from "../dist/destiny.js";
import { dailyTrialSeed, previewTrialBySeed, startTrialGame, trialCombatModifiers } from "../dist/trials.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "cao") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v23.0 vassalage demand, quarterly tribute and peaceful annexation", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 300;
  state.saga.reputation = 86;
  const era = eraByYear(world, state);

  // 208 年刘备仅 1 城，曹操拥多城，满足册封附庸条件
  const res = demandVassalage(world, era, state, "liu");
  assert.equal(res.ok, true);
  assert.equal(listVassals(res.state).length, 1);

  const goldBefore = res.state.factions.cao.treasury;
  const settled = settleVassalsTurn(res.state);
  assert.ok(settled.state.factions.cao.treasury > goldBefore);

  const annexed = annexVassal(world, era, settled.state, "liu");
  assert.equal(annexed.ok, true);
  assert.ok(annexed.gained >= 1);
  assert.equal(listVassals(annexed.state).length, 0);
});

test("v23.0 12 city specialties activate economy and combat modifiers", () => {
  const state = makeCenturyGame(208, "cao");
  assert.equal(citySpecialty("luoyang").name, "太学文脉");
  const active = activeSpecialtiesFor(state, "cao");
  assert.ok(active.length >= 2);
  assert.ok(specialtyEconomyModifiers(state, "cao").treasuryMult > 1);
  assert.ok(specialtyCombatModifiers(state, "cao").attackMult >= 1);
  const xu = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao");
  assert.ok(cityRevenues(state, xu).treasury > 0);
});

test("v23.0 36 Stratagems scrolls: empty fort, chain fire, borrow knife and besiege wei", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 400;
  state.saga.tech.points = 300;
  const era = eraByYear(world, state);
  const myCity = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao");
  const enemyCity = Object.keys(state.cities).find((k) => state.cities[k].owner !== "cao");

  const ef = castStratagemScroll(world, era, state, "empty_fort", { targetCityKey: myCity });
  assert.equal(ef.ok, true);
  assert.equal(isEmptyFortActive(ef.state, myCity), true);
  assert.ok(scrollCombatModifiers(ef.state, myCity).defenseMult >= 1.45);

  ef.state.turn = 4;
  const cf = castStratagemScroll(world, era, ef.state, "chain_fire", { targetCityKey: enemyCity });
  assert.equal(cf.ok, true);
  assert.equal(isChainFireActive(cf.state, enemyCity), true);
  assert.ok(scrollCombatModifiers(cf.state, enemyCity).defenseMult < 0.8);

  cf.state.turn = 8;
  const bk = castStratagemScroll(world, era, cf.state, "borrow_knife");
  assert.equal(bk.ok, true);

  bk.state.turn = 12;
  const bw = castStratagemScroll(world, era, bk.state, "besiege_wei", { targetCityKey: enemyCity });
  assert.equal(bw.ok, true);
});

test("v23.0 legendary hero destiny awakening and daily trial seed game", () => {
  const state = makeCenturyGame(208, "cao");
  const era = eraByYear(world, state);
  const list = evaluateDestinies(era, state);
  const caoDest = list.find((d) => d.id === "destiny_cao");
  assert.ok(caoDest && caoDest.canAwaken);

  const awk = awakenHeroDestiny(era, state, "destiny_cao");
  assert.equal(awk.ok, true);
  const leadOfficer = era.officers.find((o) => o.faction === "cao");
  assert.ok(leadOfficer);
  assert.ok(destinyCombatModifiers(awk.state, leadOfficer).attackMult >= 1.06);

  const fromKey = Object.keys(awk.state.cities).find((k) => awk.state.cities[k].owner === "cao");
  const toKey = Object.keys(awk.state.cities).find((k) => awk.state.cities[k].owner !== "cao");
  const baseFc = forecastAttack(era, state, { from: fromKey, to: toKey, officer: leadOfficer.key, troops: 4000 }, "cao");
  const awkFc = forecastAttack(era, awk.state, { from: fromKey, to: toKey, officer: leadOfficer.key, troops: 4000 }, "cao");
  assert.ok(awkFc.offense > baseFc.offense);

  // 天命试炼种子局确定性测试 + decodeSave 验证
  const seed = dailyTrialSeed();
  const p1 = previewTrialBySeed(world, seed);
  const p2 = previewTrialBySeed(world, seed);
  assert.deepEqual(p1, p2);
  assert.equal(p1.modifiers.length, 3);

  const { state: tState } = startTrialGame(world, seed);
  assert.ok(trialCombatModifiers(tState).attackMult >= 1);
  assert.equal(decodeSave(world, JSON.stringify(tState)).year, p1.year);
});
