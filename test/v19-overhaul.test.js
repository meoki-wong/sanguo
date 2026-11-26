import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityRevenues, createGame, decodeSave, eraByYear, forecastAttack } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { createCorps, disbandCorps, listCorps, settleCorpsTurn, updateCorpsDirective } from "../dist/corps.js";
import { enlistTribeRaid, getTribesStatus, giftTribe, pacifyTribe, settleTribesTurn } from "../dist/tribes.js";
import { enactReform, getReforms, reformCombatModifiers, reformEconomyModifiers, settleReformsTurn } from "../dist/reforms.js";
import { getMarketSnapshot, launchCaravan, raidEnemyTrade, settleCommerceTurn, tradeMarketGrain } from "../dist/commerce.js";
import { arrangeMarriage, getRelationships, registerNemesis, relationshipCombatModifiers, swearBrotherhood } from "../dist/relationships.js";
import { CHALLENGE_SCENARIOS, evaluateChallengeProgress, startChallengeScenario } from "../dist/challenges.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "cao") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v19.0 autonomous corps creation, directive switching, turn settlement and disband", () => {
  const state = makeCenturyGame(208, "cao");
  const era = eraByYear(world, state);
  const owned = Object.keys(state.cities).filter((k) => state.cities[k].owner === "cao");
  const cmd = era.officers.find((o) => o.faction === "cao");
  assert.ok(owned.length >= 2 && cmd);

  const created = createCorps(world, era, state, {
    name: "北伐军团",
    commanderKey: cmd.key,
    cityKeys: owned.slice(0, 3),
    directive: "supply",
  });
  assert.equal(created.ok, true);
  assert.equal(listCorps(created.state).length, 1);

  const beforeGold = created.state.factions.cao.treasury;
  const settled = settleCorpsTurn(world, era, created.state);
  assert.ok(settled.state.factions.cao.treasury > beforeGold);
  assert.ok(settled.notes.length >= 1);

  const switched = updateCorpsDirective(settled.state, created.id, { directive: "defend" });
  assert.equal(switched.ok, true);
  const disbanded = disbandCorps(switched.state, created.id);
  assert.equal(disbanded.ok, true);
  assert.equal(listCorps(disbanded.state).length, 0);
});

test("v19.0 frontier tribes diplomacy, raid, pacification and quarterly tribute", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 400;
  state.factions.cao.grain = 300;
  const enemyCity = Object.keys(state.cities).find((k) => state.cities[k].owner !== "cao");
  assert.ok(enemyCity);

  const gifted = giftTribe(state, "wuhuan");
  assert.equal(gifted.ok, true);
  const raid = enlistTribeRaid(world, gifted.state, "wuhuan", enemyCity);
  assert.equal(raid.ok, true);
  assert.ok(raid.state.cities[enemyCity].troops < gifted.state.cities[enemyCity].troops);

  const pacified = pacifyTribe(raid.state, "wuhuan");
  assert.equal(pacified.ok, true);
  assert.equal(getTribesStatus(pacified.state).find((t) => t.id === "wuhuan").pacifiedBy, "cao");

  const goldBefore = pacified.state.factions.cao.treasury;
  const settled = settleTribesTurn(world, pacified.state);
  assert.ok(settled.state.factions.cao.treasury > goldBefore);
});

test("v19.0 court reforms affect city revenues, combat forecasts and quarterly bonuses", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 300;
  const xuchang = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao");
  const revBefore = cityRevenues(state, xuchang);

  const r1 = enactReform(state, "talent", "nine_ranks");
  assert.equal(r1.ok, true);
  assert.equal(getReforms(r1.state).talent, "nine_ranks");
  const revAfter = cityRevenues(r1.state, xuchang);
  assert.ok(revAfter.treasury >= revBefore.treasury);
  assert.ok(reformEconomyModifiers(r1.state, "cao").treasuryMult > 1.1);
  assert.ok(reformCombatModifiers(r1.state, "cao").defenseMult >= 1.08);

  const settled = settleReformsTurn(r1.state);
  assert.ok(settled.state.saga.reputation >= r1.state.saga.reputation);
});

test("v19.0 dynamic grain market, Silk Road caravans and enemy trade raid", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 300;
  state.factions.cao.grain = 200;

  const buy = tradeMarketGrain(state, "buy_grain", 50);
  assert.equal(buy.ok, true);
  assert.equal(buy.state.factions.cao.grain, 250);

  const sell = tradeMarketGrain(buy.state, "sell_grain", 50);
  assert.equal(sell.ok, true);
  assert.equal(sell.state.factions.cao.grain, 200);

  const car = launchCaravan(sell.state, "silk_road");
  assert.equal(car.ok, true);
  assert.equal(getMarketSnapshot(car.state).caravans.length, 1);

  const raid = raidEnemyTrade(car.state, "liu");
  assert.equal(raid.ok, true);
  assert.ok(raid.stolenGold > 0);

  const settled = settleCommerceTurn(raid.state);
  assert.ok(settled.state.factions.cao.treasury > raid.state.factions.cao.treasury);
  assert.ok(settled.notes.length >= 1);
});

test("v19.0 sworn brotherhood, political marriage, nemesis revenge and challenge scenarios", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 300;
  const era = eraByYear(world, state);
  const officers = era.officers.filter((o) => o.faction === "cao");
  assert.ok(officers.length >= 2);

  const sw = swearBrotherhood(era, state, officers[0].key, officers[1].key);
  assert.equal(sw.ok, true);
  const mar = arrangeMarriage(era, sw.state, "wu");
  assert.equal(mar.ok, true);
  assert.equal(getRelationships(mar.state).marriages.length, 1);

  const withNem = registerNemesis(mar.state, officers[0].key, officers[0].name, "liu", "赤壁之仇");
  const relMod = relationshipCombatModifiers(withNem, {
    attackerKey: officers[0].key, attackerFaction: "cao", defenderFaction: "liu",
  });
  assert.ok(relMod.attackMult >= 1.24);
  assert.ok(relMod.lossMult < 0.9);

  // 验证 forecastAttack 吃进关系网加成
  const fromKey = Object.keys(withNem.cities).find((k) => withNem.cities[k].owner === "cao");
  const toKey = Object.keys(withNem.cities).find((k) => withNem.cities[k].owner === "liu");
  const baseFc = forecastAttack(era, state, { from: fromKey, to: toKey, officer: officers[0].key, troops: 4000 }, "cao");
  const relFc = forecastAttack(era, withNem, { from: fromKey, to: toKey, officer: officers[0].key, troops: 4000 }, "cao");
  assert.ok(relFc.offense > baseFc.offense);

  // 验证全部 6 场名战残局均可一键开局、评估进度并通过 decodeSave
  assert.equal(CHALLENGE_SCENARIOS.length, 6);
  for (const ch of CHALLENGE_SCENARIOS) {
    const chState = startChallengeScenario(world, ch.id);
    const prog = evaluateChallengeProgress(chState);
    assert.equal(prog.status, "active");
    assert.equal(decodeSave(world, JSON.stringify(chState)).year, ch.year);
  }
});
