import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGame, decodeSave, eraByYear, forecastAttack, cityRevenues } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import {
  computeSupplyLine, establishSiegeBlockade, isSupplyCut, liftSiegeBlockade,
  raidSupplyLine, settleSupplyTurn, supplyCombatModifiers, supplyLinesForMap,
} from "../dist/supply.js";
import {
  autoResolveTacticalSession, createTacticalSession, currentPhaseOrders,
  finalizeTacticalModifiers, resolveTacticalPhase,
} from "../dist/tactical-battle.js";
import {
  buildingCombatModifiers, buildingEconomyModifiers, cityBuildings,
  constructBuilding, constructWonder, settleBuildingsTurn, wonderForCity,
} from "../dist/buildings.js";
import {
  cityVisibility, espionageCombatModifiers, executeEspionageAction, hasInsider,
  isFogOfWarEnabled, maskedTroopRange, setFogOfWar, settleEspionageTurn,
} from "../dist/espionage.js";
import {
  isLifespanEnabled, mentorshipBonusFor, performMentorship, personaForFaction,
  setLifespanEnabled, settleLifespanTurn,
} from "../dist/ai-persona.js";
import {
  collectWarRoomItems, decodeShareCode, encodeShareCode, recordHistorySnapshot, renderTrendChartSvg,
} from "../dist/war-room.js";
import { createCustomRulerGame } from "../dist/sandbox.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "cao") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v18.0 supply lines, raidSupplyLine, siege blockade and quarterly settlement", () => {
  const state = makeCenturyGame(208, "cao");
  const owned = Object.entries(state.cities).filter(([, c]) => c.owner === "cao").map(([k]) => k);
  const adj = new Map(world.cities.map((c) => [c.key, [...(c.links || [])]]));
  for (const [a, b] of world.roads || []) {
    if (!adj.get(a)?.includes(b)) adj.get(a)?.push(b);
    if (!adj.get(b)?.includes(a)) adj.get(b)?.push(a);
  }
  const frontCity = owned.find((k) => (adj.get(k) || []).some((n) => state.cities[n]?.owner !== "cao"));
  const enemyCity = (adj.get(frontCity) || []).find((n) => state.cities[n]?.owner !== "cao");
  assert.ok(frontCity && enemyCity);

  const line = computeSupplyLine(world, state, "cao", frontCity, enemyCity);
  assert.equal(line.connected, true);
  assert.ok(line.path.length >= 2);

  state.factions.cao.treasury = 300;
  state.factions.cao.grain = 300;
  state.cities[frontCity].troops = Math.max(state.cities[frontCity].troops, 6000);
  const raid = raidSupplyLine(world, state, enemyCity, "cao");
  assert.equal(raid.ok, true);
  assert.equal(isSupplyCut(raid.state, enemyCity), true);

  const siege = establishSiegeBlockade(world, raid.state, frontCity, enemyCity, "cao");
  assert.equal(siege.ok, true);

  const mod = supplyCombatModifiers(world, siege.state, {
    fromKey: frontCity, toKey: enemyCity, attackerFaction: "cao", defenderFaction: state.cities[enemyCity].owner,
  });
  assert.ok(mod.defenseMult < 0.78);
  assert.ok(mod.wallFactor < 1);

  const beforeTroops = siege.state.cities[enemyCity].troops;
  const settled = settleSupplyTurn(world, siege.state);
  assert.ok(settled.state.cities[enemyCity].troops < beforeTroops);
  assert.ok(settled.notes.length >= 2);

  const mapData = supplyLinesForMap(world, siege.state);
  assert.ok(mapData.cutCities.includes(enemyCity));
  assert.ok(mapData.sieges.some((s) => s.target === enemyCity));

  const lifted = liftSiegeBlockade(siege.state, enemyCity);
  assert.equal(lifted.saga.supply.sieges[enemyCity], undefined);
});

test("v18.0 interactive 3-phase tactical battle and auto-resolve", () => {
  const session = createTacticalSession({
    fromName: "许昌",
    toName: "襄阳",
    attackerName: "曹操",
    defenderName: "蔡瑁",
    attacker: { name: "曹操", command: 96, war: 72, intel: 92 },
    defender: { name: "蔡瑁", command: 76, war: 70, intel: 74 },
    terrain: "river",
    season: "夏",
    targetCut: true,
    siegeTurns: 2,
    insiderActive: true,
    baseOffense: 12000,
    baseDefense: 13000,
  });
  const opts0 = currentPhaseOrders(session);
  assert.equal(opts0.length, 4);
  const s1 = resolveTacticalPhase(session, "ambush_grain");
  assert.equal(s1.phaseIndex, 1);
  const s2 = resolveTacticalPhase(s1, "water_flood");
  assert.equal(s2.phaseIndex, 2);
  const s3 = resolveTacticalPhase(s2, "persuade_surrender");
  assert.equal(s3.done, true);
  const fin = finalizeTacticalModifiers(s3);
  assert.ok(fin.atkMult > 1.15);
  assert.ok(fin.defMult < 0.65);

  const auto = finalizeTacticalModifiers(autoResolveTacticalSession(session));
  assert.ok(auto.atkMult > 1.0);
  assert.ok(auto.log.length >= 3);
});

test("v18.0 city facilities, regional wonders and economy/combat modifiers", () => {
  const state = makeCenturyGame(208, "cao");
  state.factions.cao.treasury = 500;
  state.factions.cao.grain = 400;
  const xuchang = Object.keys(state.cities).find((k) => state.cities[k].owner === "cao" && wonderForCity(k));
  assert.ok(xuchang);

  const revBefore = cityRevenues(state, xuchang);
  const b1 = constructBuilding(world, state, xuchang, "tuntian", "cao");
  assert.equal(b1.ok, true);
  assert.ok(cityBuildings(b1.state, xuchang).includes("tuntian"));
  const revAfter = cityRevenues(b1.state, xuchang);
  assert.ok(revAfter.grain > revBefore.grain);

  const b2 = constructBuilding(world, b1.state, xuchang, "academy", "cao");
  assert.equal(b2.ok, true);
  const wRes = constructWonder(world, b2.state, xuchang, "cao");
  assert.equal(wRes.ok, true);

  const ecoMod = buildingEconomyModifiers(wRes.state, xuchang);
  assert.ok(ecoMod.grainMult > 1.3);
  assert.ok(ecoMod.tpBonus >= 12);

  const cMod = buildingCombatModifiers(world, wRes.state, {
    fromKey: xuchang, toKey: xuchang, attackerFaction: "cao", defenderFaction: "cao", terrain: "land",
  });
  assert.ok(cMod.attackMult >= 1);

  const settled = settleBuildingsTurn(world, wRes.state);
  assert.ok(settled.state.saga.tech.points > wRes.state.saga.tech.points);
});

test("v18.0 fog of war and espionage actions integrate into forecastAttack", () => {
  let state = makeCenturyGame(208, "cao");
  state = setFogOfWar(state, true);
  assert.equal(isFogOfWarEnabled(state), true);

  const foggedCity = Object.keys(state.cities).find((k) => cityVisibility(world, state, k) === "fogged");
  assert.ok(foggedCity);
  assert.ok(maskedTroopRange(foggedCity, state.cities[foggedCity].troops).startsWith("约 "));

  state.factions.cao.treasury = 300;
  const scout = executeEspionageAction(world, state, "scout_intel", foggedCity, "cao");
  assert.equal(scout.ok, true);
  assert.equal(cityVisibility(world, scout.state, foggedCity), "scouted");

  const insider = executeEspionageAction(world, scout.state, "plant_insider", foggedCity, "cao");
  assert.equal(insider.ok, true);
  assert.equal(hasInsider(insider.state, foggedCity), true);

  const espMod = espionageCombatModifiers(insider.state, foggedCity);
  assert.ok(espMod.wallFactor < 0.7);
  assert.ok(espMod.defenseMult < 0.9);

  // 确认 forecastAttack 正确吸收战术与内应修正且非 century 模式保持中性
  const era = eraByYear(world, insider.state);
  const fromKey = Object.keys(insider.state.cities).find((k) => insider.state.cities[k].owner === "cao");
  const officer = era.officers.find((o) => o.faction === "cao");
  const plainForecast = forecastAttack(era, insider.state, { from: fromKey, to: foggedCity, officer: officer.key, troops: 4000 }, "cao");
  const tacForecast = forecastAttack(era, insider.state, {
    from: fromKey, to: foggedCity, officer: officer.key, troops: 4000,
    tactical: { atkMult: 1.3, defMult: 0.7, lossMult: 0.8, surrender: false },
  }, "cao");
  assert.ok(tacForecast.offense > plainForecast.offense);
  assert.ok(tacForecast.defense < plainForecast.defense);

  const cleaned = settleEspionageTurn(insider.state);
  assert.equal(hasInsider(cleaned, foggedCity), true);
});

test("v18.0 AI personas, mentorship, rising generation and war room + share code round-trip", () => {
  assert.equal(personaForFaction("cao").badge, "速战挟天子");
  assert.equal(personaForFaction("lvbu").badge, "反复猛攻");

  let state = createCustomRulerGame(world, {
    year: 208,
    baseFaction: "liu",
    rulerName: "汉昭烈",
    stateName: "季汉",
    heroIds: ["sb_zhuge"],
    rules: { fogOfWar: true, enableLifespan: true, bonusResources: true },
  });
  assert.equal(isFogOfWarEnabled(state), true);
  assert.equal(isLifespanEnabled(state), true);

  const era = eraByYear(world, state);
  const liuOfficers = era.officers.filter((o) => o.faction === "liu");
  assert.ok(liuOfficers.length >= 2);
  const mRes = performMentorship(era, state, liuOfficers[0].key, liuOfficers[1].key);
  assert.equal(mRes.ok, true);
  const bonus = mentorshipBonusFor(mRes.state, liuOfficers[1].key);
  assert.ok(bonus.command >= 2);

  // 推进年份以触发后起之秀出山
  const futureState = structuredClone(mRes.state);
  futureState.turn = 60; // 208 + 14 = 222 年
  const lifeRes = settleLifespanTurn(era, futureState);
  assert.ok(lifeRes.notes.length >= 1);

  const items = collectWarRoomItems(world, era, mRes.state);
  assert.ok(Array.isArray(items) && items.length >= 1);

  const snapState = recordHistorySnapshot(mRes.state);
  const svg = renderTrendChartSvg(era, snapState, "power");
  assert.ok(svg.includes("<svg") && svg.includes("polyline"));

  // 存档码编码/解码完整往返
  const backupJson = createSaveBackup({ state: snapState, selected: Object.keys(snapState.cities)[0] });
  const code = encodeShareCode(backupJson);
  assert.ok(code.startsWith("SG18:"));
  const decodedJson = decodeShareCode(code);
  const restored = readGameRecord(world, decodedJson);
  assert.equal(restored.state.player, "liu");
  assert.equal(isFogOfWarEnabled(restored.state), true);
  assert.equal(decodeSave(world, JSON.stringify(restored.state)).year, 208);
});
