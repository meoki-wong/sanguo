import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityRevenues, createGame, decodeSave, eraByYear, forecastAttack } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import {
  appointGrandOffice, ceremonyCombatModifiers, ceremonyEconomyModifiers,
  getCeremonyState, nextAvailableTier, performCoronation,
} from "../dist/dynasty-ceremony.js";
import { buildAdvisorPlans, executeAdvisorStrategy } from "../dist/advisor-council.js";
import { buildNavalFleet, getRiverPorts, launchNavalRaid, navyCombatModifiers, toggleRiverChain } from "../dist/navy.js";
import { queryHeroCodex } from "../dist/codex.js";
import { buildPosterData } from "../dist/poster.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "cao") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v20.0 coronation ceremony, grand offices, economy/combat bonuses and save validity", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 500;
  state.saga.reputation = 85;
  const era = eraByYear(world, state);
  const nextT = nextAvailableTier(state);
  assert.equal(nextT.tier, 1);
  assert.equal(nextT.eligible, true);

  const xuchang = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao");
  const revBefore = cityRevenues(state, xuchang);

  const cor = performCoronation(world, state, { dynastyName: "大魏", eraName: "建安", capitalKey: xuchang });
  assert.equal(cor.ok, true);
  assert.equal(getCeremonyState(cor.state).tier, 1);
  assert.equal(getCeremonyState(cor.state).dynastyName, "大魏");

  const officer = era.officers.find((o) => o.faction === "cao");
  const app = appointGrandOffice(era, cor.state, "chancellor", officer.key);
  assert.equal(app.ok, true);
  assert.ok(ceremonyEconomyModifiers(app.state, "cao").mult >= 1.14);
  assert.ok(ceremonyCombatModifiers(app.state, "cao").attackMult >= 1.05);
  assert.ok(cityRevenues(app.state, xuchang).treasury >= revBefore.treasury);
  assert.equal(decodeSave(world, JSON.stringify(app.state)).year, 208);
});

test("v20.0 chief advisor 3-plan council and one-click execution", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 300;
  state.factions.cao.grain = 300;
  const era = eraByYear(world, state);

  const { advisor, plans } = buildAdvisorPlans(world, era, state);
  assert.ok(advisor.name.length > 0);
  assert.equal(plans.length, 3);

  const ex1 = executeAdvisorStrategy(world, era, state, "upper_strike");
  assert.equal(ex1.ok, true);
  const ex2 = executeAdvisorStrategy(world, era, ex1.state, "middle_build");
  assert.equal(ex2.ok, true);
  const ex3 = executeAdvisorStrategy(world, era, ex2.state, "lower_fortify");
  assert.equal(ex3.ok, true);
});

test("v20.0 Yangtze navy fleets, river chain defense, fire counter and naval raid", () => {
  const state = makeCenturyGame(208, "wu");
  state.factions.wu.treasury = 400;
  state.factions.wu.grain = 400;
  const ports = getRiverPorts(world, state);
  const myPort = ports.find((p) => p.owner === "wu");
  const enemyPort = ports.find((p) => p.owner !== "wu");
  assert.ok(myPort && enemyPort);

  const built = buildNavalFleet(world, state, myPort.key, "louchuan", "wu");
  assert.equal(built.ok, true);
  const chained = toggleRiverChain(world, built.state, myPort.key, "wu");
  assert.equal(chained.ok, true);

  // 普通进攻受铁索封江阻滞（defMult > 1.2），火攻克制铁索（defMult < 1）
  const normalMod = navyCombatModifiers(chained.state, { fromKey: enemyPort.key, toKey: myPort.key, terrain: "river", tacticId: "assault" });
  const fireMod = navyCombatModifiers(chained.state, { fromKey: enemyPort.key, toKey: myPort.key, terrain: "river", tacticId: "fire" });
  assert.ok(normalMod.defenseMult > 1.2);
  assert.ok(fireMod.defenseMult < normalMod.defenseMult);

  const raid = launchNavalRaid(world, chained.state, myPort.key, enemyPort.key, "wu");
  assert.equal(raid.ok, true);
  assert.ok(raid.enemyLoss > 0);

  // 验证 forecastAttack 正确吃进水师加成
  const era = eraByYear(world, chained.state);
  const officer = era.officers.find((o) => o.faction === "wu");
  const baseFc = forecastAttack(era, state, { from: myPort.key, to: enemyPort.key, officer: officer.key, troops: 4000 }, "wu");
  const navFc = forecastAttack(era, built.state, { from: myPort.key, to: enemyPort.key, officer: officer.key, troops: 4000 }, "wu");
  assert.ok(navFc.offense > baseFc.offense);
});

test("v20.0 Hero Codex search/sort and campaign poster data builder", () => {
  const state = makeCenturyGame(208, "cao");
  const era = eraByYear(world, state);
  const all = queryHeroCodex(world, era, state, { faction: "all", sortBy: "total" });
  assert.ok(all.length > 20);
  const caoOnly = queryHeroCodex(world, era, state, { faction: "cao", sortBy: "command" });
  assert.ok(caoOnly.every((r) => r.faction === "cao"));
  assert.ok(caoOnly[0].command >= caoOnly[caoOnly.length - 1].command);

  const poster = buildPosterData(world, era, state);
  assert.ok(poster.ownedCount > 0);
  assert.ok(["S", "A", "B", "C"].includes(poster.grade));
  assert.equal(poster.totalCities, world.cities.length);
});
