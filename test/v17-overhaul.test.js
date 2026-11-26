import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, appoint, cityRevenues, createGame, decodeSave, eraByYear,
  forecastAttack, forceTotals, playableFactions, queueOrder,
} from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import {
  canResearchTech, factionEliteUnit, hasTech, researchTech, TECH_TREE,
} from "../dist/tech.js";
import { officerRankTitle, promotableOfficers, resolveBattleDuel } from "../dist/duels.js";
import {
  chokepointBetween, chokepointModifiers, coalitionProtects, evaluateAllyStrike,
  evaluateCaptivePeace, evaluateCoalition, executeAllyStrike, executeCaptivePeace,
  isCoalitionActive, resolveClimateChoice, settleSeasonalClimate,
} from "../dist/coalition.js";
import { isHostile } from "../dist/diplomacy.js";
import { maybeCaptureOfficer } from "../dist/saga.js";
import { executeSowDiscord, executeSpreadRumor } from "../dist/stratagems.js";
import { createCustomRulerGame } from "../dist/sandbox.js";
import { evaluateAchievementsForState, evaluateCampaignGrade } from "../dist/achievements.js";
import { isOpeningPrepTurn } from "../dist/tactics.js";
import { factionCourtProfile } from "../dist/imperial.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

test("251 Heroes Assembly scenario covers all 44 cities across 11 playable factions with valid saves", () => {
  const era251 = eraByYear(world, 251);
  assert.ok(era251 && era251.title === "英雄集结");
  const factions = playableFactions(era251);
  assert.equal(factions.length, 11);
  assert.equal(Object.keys(era251.ownership).length, 44);
  for (const { key } of factions) {
    const s = createGame(world, 251, key, { century: true });
    assert.deepEqual(decodeSave(world, JSON.stringify(s)), s);
  }
  // Lvbu advances cleanly and triggers 251 assembly event by turn 2
  let lv = createGame(world, 251, "lvbu", { century: true });
  assert.equal(factionEliteUnit("lvbu").name, "陷阵并州");
  lv = advanceQuarter(world, lv);
  lv = advanceQuarter(world, lv);
  assert.equal(lv.saga.pendingEvent?.id, "ev_251_assembly");
  assert.deepEqual(decodeSave(world, JSON.stringify(lv)), lv);

  // 251 faction at >= 18 cities can claim Emperor
  const big = createGame(world, 251, "cao", { century: true });
  let count = forceTotals(big, "cao").cities;
  for (const city of Object.values(big.cities)) {
    if (count >= 18) break;
    if (city.owner !== "cao") { city.owner = "cao"; count += 1; }
  }
  assert.equal(factionCourtProfile(world, big, "cao").canClaimEmperor, true);
});

test("3-branch tech tree unlocks elite units, modifies harvest/combat/stratagems, and round-trips saves", () => {
  assert.equal(TECH_TREE.length, 9);
  let state = createGame(world, 251, "cao", { century: true });
  const beforeTp = state.saga.tech.points;
  state = advanceQuarter(world, state);
  assert.ok(state.saga.tech.points > beforeTp);

  // Prerequisite enforced
  assert.equal(canResearchTech(state, "m2_trebuchet").ok, false);

  state.saga.tech.points = 2000;
  state.factions.cao.treasury = 500;

  // Military branch -> unlocks 虎豹骑
  const beforeFc = forecastAttack(eraByYear(world, state), state, {
    type: "attack", from: "chenliu", to: "luoyang", officer: "cao-251-0", troops: 1500, tactic: "assault",
  });
  state = researchTech(world, state, "m1_crossbow").state;
  state = researchTech(world, state, "m2_trebuchet").state;
  const eliteRes = researchTech(world, state, "m3_elite");
  state = eliteRes.state;
  assert.equal(eliteRes.elite?.name, "虎豹骑");
  assert.equal(hasTech(state, "m3_elite"), true);
  const afterFc = forecastAttack(eraByYear(world, state), state, {
    type: "attack", from: "chenliu", to: "luoyang", officer: "cao-251-0", troops: 1500, tactic: "assault",
  });
  assert.ok(afterFc.offense > beforeFc.offense);
  assert.equal(afterFc.eliteName, "虎豹骑");

  // Civic branch -> +12% grain yield
  state.cities.xu.farming = 3;
  const beforeGrain = forceTotals(state, "cao").grain;
  state = researchTech(world, state, "c1_irrigation").state;
  assert.ok(forceTotals(state, "cao").grain > beforeGrain);

  // Scheme branch -> 2 stratagems per turn
  state = researchTech(world, state, "s1_spies").state;
  state = researchTech(world, state, "s2_firechain").state;
  state = researchTech(world, state, "s3_grandstrategist").state;
  state = executeSpreadRumor(world, state, "luoyang").state;
  state = executeSpreadRumor(world, state, "wan").state;
  assert.equal(state.saga.plotsUsedCount, 2);
  assert.deepEqual(decodeSave(world, JSON.stringify(state)), state);
});

test("duels, debates, chokepoints, and merit promotion work deterministically and pass decodeSave", () => {
  const cp = chokepointBetween("luoyang", "chenliu");
  assert.ok(cp && cp.name === "虎牢关" && cp.tier === "pass");

  let state = createGame(world, 251, "lvbu", { century: true });
  state = advanceQuarter(world, state);
  const era = eraByYear(world, state);
  const lvbu = era.officers.find((o) => o.name === "吕布");
  const zhangLiao = era.officers.find((o) => o.name === "张辽");
  const zhuge = era.officers.find((o) => o.name === "诸葛亮");
  const sima = era.officers.find((o) => o.name === "司马懿");
  assert.ok(lvbu && zhangLiao && zhuge && sima);

  const duel = resolveBattleDuel(era, state, {
    attacker: lvbu, defender: zhangLiao, tacticId: "assault", cityKey: "puyang", attFaction: "lvbu", defFaction: "cao",
  });
  assert.ok(duel && duel.kind === "duel" && duel.rounds.length >= 1);

  const debate = resolveBattleDuel(era, state, {
    attacker: zhuge, defender: sima, tacticId: "stratagem", cityKey: "wan", attFaction: "liu", defFaction: "sima",
  });
  assert.ok(debate && debate.kind === "debate" && debate.rounds.length >= 1);

  // Chokepoint defense is mitigated by siege tactic
  const passAssault = chokepointModifiers(state, "chenliu", "luoyang", "assault", lvbu);
  const passSiege = chokepointModifiers(state, "chenliu", "luoyang", "siege", lvbu);
  assert.ok(passAssault.defenseMult > passSiege.defenseMult);

  // Merit promotion detection on a stationed officer
  const stationedOff = era.officers.find((o) => o.faction === "lvbu" && state.stations[o.key]);
  assert.ok(stationedOff);
  state.officerService = { [stationedOff.key]: { command: 3, governance: 0, commandRank: 0, governanceRank: 0 } };
  const promos = promotableOfficers(era, state);
  assert.ok(promos.some((p) => p.officer.key === stationedOff.key && p.skill === "command"));
  assert.ok(officerRankTitle(state, stationedOff).length >= 2);
});

test("anti-hegemon coalition, allied pincer strike, captive peace, and seasonal climate stay save-valid", () => {
  // 1. Coalition triggers at >= 18 cities (using 208 Cao who starts with 20 cities)
  let state = createGame(world, 208, "cao", { century: true });
  state.turn = 6;
  const era = eraByYear(world, state);
  const co = evaluateCoalition(world, era, state);
  assert.ok(co && isCoalitionActive(state) && co.members.length >= 2);
  const [m1, m2] = co.members;
  assert.equal(coalitionProtects(state, m1, m2), true);
  assert.equal(isHostile(state, m1, m2), false);

  // Breaking coalition via sow_discord
  state.factions.cao.treasury = 300;
  state.saga.reputation = 95;
  const broke = executeSowDiscord(world, state, m1, m2);
  assert.equal(broke.succeeded, true);
  assert.ok(!broke.state.saga.coalition || !broke.state.saga.coalition.members.includes(m2));

  // 2. Allied pincer strike
  let allyBase = createGame(world, 251, "liu", { century: true });
  allyBase = advanceQuarter(world, allyBase);
  allyBase.factions.liu.treasury = 200;
  allyBase.treaties.push({ sides: ["biao", "liu"], kind: "alliance", expires: allyBase.turn + 4 });
  const evalStrike = evaluateAllyStrike(world, allyBase, "biao", "xinye");
  assert.ok(evalStrike.ok, evalStrike.reason);
  const struck = executeAllyStrike(world, allyBase, "biao", "xinye");
  assert.equal(struck.state.saga.allyStrikes.length, 1);
  assert.deepEqual(decodeSave(world, JSON.stringify(struck.state)), struck.state);

  // 3. Captive peace deal
  let capBase = createGame(world, 199, "cao", { century: true });
  capBase = advanceQuarter(world, capBase);
  const era199 = eraByYear(world, capBase);
  const maOff = era199.officers.find((o) => o.faction === "ma" && !o.reserve && !capBase.armies.some((a) => a.officer === o.key) && capBase.polity?.courts?.ma?.head !== o.key);
  assert.ok(maOff);
  maybeCaptureOfficer(world, era199, capBase, {
    attackerFaction: "cao", defenderFaction: "ma", cityKey: "tianshui", defenderKey: maOff.key, tactic: "stratagem", ratio: 2, wasLastCity: true,
  });
  const evalPeace = evaluateCaptivePeace(world, capBase, maOff.key);
  assert.ok(evalPeace.ok, evalPeace.reason);
  const peaced = executeCaptivePeace(world, capBase, maOff.key);
  assert.equal(peaced.state.saga.captives.length, 0);
  assert.equal(isHostile(peaced.state, "cao", "ma"), false);
  assert.deepEqual(decodeSave(world, JSON.stringify(peaced.state)), peaced.state);

  // 4. Seasonal climate choice triggered naturally on turn 3
  let climBase = createGame(world, 199, "cao", { century: true });
  for (let i = 0; i < 3; i += 1) climBase = advanceQuarter(world, climBase);
  assert.ok(climBase.saga.climate && climBase.saga.climate.pending);
  const afterClim = resolveClimateChoice(world, climBase, "relief");
  assert.equal(afterClim.state.saga.climate.pending, false);
  assert.deepEqual(decodeSave(world, JSON.stringify(afterClim.state)), afterClim.state);
});

test("sandbox custom ruler opening and achievements/grade calculator work cleanly", () => {
  const sb = createCustomRulerGame(world, {
    year: 251,
    baseFaction: "cao",
    rulerName: "天命君",
    stateName: "玄汉",
    heroIds: ["sb_zhuge", "sb_lvbu", "sb_zhouyu"],
    difficulty: "hard",
    rules: { noPrepTurn: true, doubleTech: true, bonusResources: true },
  });
  assert.equal(isOpeningPrepTurn(sb), false);
  assert.equal(sb.saga.custom.rulerName, "天命君");
  assert.equal(sb.saga.wildRecruits.length, 3);
  assert.ok(sb.saga.tech.points >= 160);
  assert.deepEqual(decodeSave(world, JSON.stringify(sb)), sb);

  const unlocked = evaluateAchievementsForState(world, sb);
  assert.ok(unlocked.includes("wild_patron") && unlocked.includes("three_wilds"));
  const grade = evaluateCampaignGrade(world, sb);
  assert.ok(["S", "A", "B", "C"].includes(grade.grade));
  assert.ok(grade.shareText.includes("玄汉"));
});
