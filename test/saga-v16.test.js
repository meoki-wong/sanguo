import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, appoint, availableAttackers, availableForPosting, createGame, decodeSave,
  eraByYear, forecastAttack, forceTotals, queueOrder,
} from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { activeBondsForOfficer, OFFICER_BONDS } from "../dist/traits.js";
import {
  captiveRecruitChance, effectiveWildFee, maybeCaptureOfficer, recruitWildTalent,
  resolveCaptive, spawnWildTalents,
} from "../dist/saga.js";
import {
  evaluateHistoricalEvent, getPendingHistoricalEvent, HISTORICAL_EVENTS, resolveHistoricalEvent,
} from "../dist/historical-events.js";
import {
  advisorStrategicBrief, evaluateDemandSurrender, evaluateSowDiscord, evaluateSpreadRumor,
  executeDemandSurrender, executeSowDiscord, executeSpreadRumor, factionPersonality, rivalFriction,
} from "../dist/stratagems.js";
import { buildImperialMemorials, executeGrandManeuver, findGrandManeuverPlan } from "../dist/sovereign.js";
import { opponentTreaty, quoteTreaty } from "../dist/diplomacy.js";
import { generateImperialEpitaph } from "../dist/chronicle-replay.js";
import { saveFileLimit } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

test("officer bonds activate for same-faction living partners in century mode and stay neutral in legacy mode", () => {
  assert.ok(OFFICER_BONDS.length >= 11);
  const era208 = world.scenarios.find((s) => s.year === 208);
  const guanYu = era208.officers.find((o) => o.name === "关羽");
  const zhangFei = era208.officers.find((o) => o.name === "张飞");
  assert.ok(guanYu && zhangFei);

  const legacy = createGame(world, 208, "liu");
  const legacyBond = activeBondsForOfficer(era208, legacy, "liu", guanYu);
  assert.equal(legacyBond.attackMult, 1);
  assert.equal(legacyBond.defenseMult, 1);
  assert.equal(legacyBond.lossMult, 1);
  assert.deepEqual(legacyBond.bonds, []);

  const century = createGame(world, 208, "liu", { century: true });
  const liuBei = era208.officers.find((o) => o.name === "刘备");
  assert.ok(liuBei);
  const active = activeBondsForOfficer(era208, century, "liu", liuBei);
  assert.ok(active.attackMult > 1.05);
  assert.ok(active.defenseMult > 1.05);
  assert.ok(active.lossMult < 0.95);
  assert.ok(active.bonds.some((b) => b.name === "桃园结义"));

  // Executing both bond partners disables Liu Bei's bond
  century.saga.executed = [zhangFei.key, guanYu.key];
  const deadBond = activeBondsForOfficer(era208, century, "liu", liuBei);
  assert.equal(deadBond.attackMult, 1);
  assert.equal(deadBond.bonds.length, 0);
});

test("captive capture and all 4 resolutions (recruit, ransom, release, execute) stay save-valid", () => {
  let base = createGame(world, 199, "cao", { century: true });
  base = advanceQuarter(world, base);
  const era = eraByYear(world, base);
  const targetOfficer = era.officers.find((o) => (
    o.faction === "ma"
    && !o.reserve
    && o.name !== "马超"
    && !base.armies?.some((a) => a.officer === o.key)
    && base.polity?.courts?.ma?.head !== o.key
  ));
  assert.ok(targetOfficer);

  // Guaranteed captive setup on an enemy officer in a city about to fall
  const cap = maybeCaptureOfficer(world, era, base, {
    attackerFaction: "cao",
    defenderFaction: "ma",
    cityKey: "tianshui",
    defenderKey: targetOfficer.key,
    tactic: "stratagem",
    ratio: 1.9,
    wasLastCity: true,
  });
  assert.ok(cap && cap.officer === targetOfficer.key);
  assert.equal(base.saga.captives.length, 1);

  // Captive cannot be posted by Ma
  assert.ok(!availableForPosting(base, targetOfficer.key, "ma"));
  assert.deepEqual(decodeSave(world, JSON.stringify(base)), base);

  // 1. Release: reputation +6, enemy gets station back
  const released = resolveCaptive(world, base, targetOfficer.key, "release");
  assert.equal(released.outcome, "released");
  assert.equal(released.state.saga.reputation, base.saga.reputation + 6);
  assert.equal(released.state.saga.captives.length, 0);
  assert.ok(released.state.stations[targetOfficer.key]);
  assert.deepEqual(decodeSave(world, JSON.stringify(released.state)), released.state);

  // 2. Ransom: adds gold and grain
  const ransomed = resolveCaptive(world, base, targetOfficer.key, "ransom");
  assert.equal(ransomed.outcome, "ransomed");
  assert.ok(ransomed.state.factions.cao.treasury > base.factions.cao.treasury);
  assert.ok(ransomed.state.factions.cao.grain > base.factions.cao.grain);
  assert.deepEqual(decodeSave(world, JSON.stringify(ransomed.state)), ransomed.state);

  // 3. Execute: reputation -8, officer barred forever
  const executed = resolveCaptive(world, base, targetOfficer.key, "execute");
  assert.equal(executed.outcome, "executed");
  assert.equal(executed.state.saga.reputation, base.saga.reputation - 8);
  assert.ok(executed.state.saga.executed.includes(targetOfficer.key));
  assert.equal(executed.state.stations[targetOfficer.key], null);
  assert.deepEqual(decodeSave(world, JSON.stringify(executed.state)), executed.state);

  // 4. Recruit: high reputation + regent tier yields >= 80% for guaranteed recruit without mutating city owners
  const highRep = structuredClone(base);
  highRep.saga.reputation = 96;
  const chance = captiveRecruitChance(world, highRep, targetOfficer.key, "ma");
  assert.ok(chance >= 80, `Expected recruit chance >= 80, got ${chance}`);
  const recruited = resolveCaptive(world, highRep, targetOfficer.key, "recruit");
  assert.equal(recruited.outcome, "recruited");
  assert.ok(recruited.state.stations[targetOfficer.key]);
  assert.ok(availableForPosting(recruited.state, targetOfficer.key, "cao"));
  assert.ok(recruited.state.polity.allegiances[targetOfficer.key]?.some((a) => a.to === "cao"));
  assert.deepEqual(decodeSave(world, JSON.stringify(recruited.state)), recruited.state);
});

test("wild famous talents emerge on odd turns, respect loyalist half-price, and survive save decode", () => {
  let state = createGame(world, 199, "cao", { century: true });
  state = advanceQuarter(world, state); // turn 1 (odd turn) -> spawns wild talent
  assert.ok(state.saga.wildPending.length >= 1);
  const talent = state.saga.wildPending[0];

  const baseFee = effectiveWildFee(state, talent);
  state.imperialChoice = "loyalist";
  const loyalFee = effectiveWildFee(state, talent);
  assert.ok(loyalFee < baseFee && loyalFee >= 8);

  const memorials = buildImperialMemorials(world, state);
  assert.ok(memorials.strategicBrief.length > 10);
  assert.ok(memorials.wildPending.length >= 1);

  state.factions.cao.treasury = Math.max(state.factions.cao.treasury, 100);
  const next = recruitWildTalent(world, state, talent.id);
  const key = `saga-wild-${talent.id}`;
  const era = eraByYear(world, next);
  assert.ok(era.officers.some((o) => o.key === key && o.faction === "cao"));
  assert.ok(next.stations[key]);
  assert.equal(next.saga.wildPending.length, 0);
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);

  // Can also spawn deterministically again via spawnWildTalents at turn 3
  next.turn = 3;
  const second = spawnWildTalents(world, era, next);
  assert.ok(second && second.name !== talent.name);
});

test("historical events trigger by era/state, honor toggle off, and apply choices", () => {
  assert.ok(HISTORICAL_EVENTS.length >= 12);

  // Toggle off prevents historical event trigger even across 2 turns
  let suppressed = createGame(world, 199, "cao", { century: true, historicalEvents: false });
  suppressed = advanceQuarter(world, suppressed);
  suppressed = advanceQuarter(world, suppressed);
  assert.equal(suppressed.saga.pendingEvent, null);

  // 199 Cao campaign triggers Guandu/Wuchao event at turn 2
  let state = createGame(world, 199, "cao", { century: true, historicalEvents: true });
  state = advanceQuarter(world, state); // turn 1
  state = advanceQuarter(world, state); // turn 2 -> triggers ev_199_wuchao
  const pending = getPendingHistoricalEvent(world, state);
  assert.ok(pending && pending.id === "ev_199_wuchao");
  assert.equal(pending.choices.length, 2);

  state.factions.cao.grain = 120;
  const resolved = resolveHistoricalEvent(world, state, pending.id, pending.choices[0].id);
  assert.equal(resolved.state.saga.pendingEvent, null);
  assert.ok(resolved.state.saga.buffs.some((b) => b.kind === "fire"));
  assert.ok(resolved.state.saga.annals.length >= 1);
  assert.deepEqual(decodeSave(world, JSON.stringify(resolved.state)), resolved.state);

  // Manual trigger check for Red Cliffs Chibi event in 208 Liu
  let state208 = createGame(world, 208, "liu", { century: true });
  state208.turn = 2;
  evaluateHistoricalEvent(world, eraByYear(world, state208), state208);
  assert.equal(state208.saga.pendingEvent?.id, "ev_208_chibi_pact");
});

test("stratagems (sow_discord, spread_rumor, demand_surrender), personalities, grand maneuvers, and epitaph", () => {
  const caoP = factionPersonality("cao");
  const biaoP = factionPersonality("biao");
  assert.ok(caoP.aggression > biaoP.aggression);
  assert.ok(caoP.preferredTactics.includes("stratagem"));

  let state = createGame(world, 199, "cao", { century: true });
  state = advanceQuarter(world, state); // turn 1
  state.factions.cao.treasury = 300;
  state.factions.cao.grain = 300;
  state.saga.reputation = 85;

  // 1. Spread rumor degrades target city defense & enhances rally
  const beforeFc = forecastAttack(eraByYear(world, state), state, {
    type: "attack", from: "luoyang", to: "changan", officer: "cao-0", troops: 1500, tactic: "rally",
  });
  const rumored = executeSpreadRumor(world, state, "changan");
  const afterFc = forecastAttack(eraByYear(world, rumored.state), rumored.state, {
    type: "attack", from: "luoyang", to: "changan", officer: "cao-0", troops: 1500, tactic: "rally",
  });
  assert.ok(afterFc.defense < beforeFc.defense);
  assert.ok(afterFc.offense > beforeFc.offense);
  assert.equal(afterFc.rumorActive, true);
  assert.deepEqual(decodeSave(world, JSON.stringify(rumored.state)), rumored.state);

  // 2. Sow discord breaks treaty & establishes rivalFriction blocking treaties
  const sowedBase = structuredClone(state);
  sowedBase.treaties.push({ sides: ["yuan", "ce"], kind: "alliance", ends: 8 });
  const evalDis = evaluateSowDiscord(world, sowedBase, "yuan", "ce");
  assert.ok(evalDis.ok && evalDis.chance >= 60);
  sowedBase.saga.reputation = 95;
  const sowed = executeSowDiscord(world, sowedBase, "yuan", "ce");
  assert.equal(sowed.succeeded, true);
  assert.ok(rivalFriction(sowed.state, "yuan", "ce"));
  assert.equal(sowed.state.treaties.some((t) => t.sides.includes("yuan") && t.sides.includes("ce")), false);
  const aiTreaty = opponentTreaty(world, sowed.state);
  assert.ok(!aiTreaty || !((aiTreaty.from === "yuan" && aiTreaty.to === "ce") || (aiTreaty.from === "ce" && aiTreaty.to === "yuan")));
  const frictionQuoteState = structuredClone(sowed.state);
  frictionQuoteState.saga.rivals.push({ a: "cao", b: "ce", expires: frictionQuoteState.turn + 5 });
  const blockedQuote = quoteTreaty(world, frictionQuoteState, "ce", "alliance");
  assert.equal(blockedQuote.available, false);
  assert.match(blockedQuote.reason, /反目/);
  assert.deepEqual(decodeSave(world, JSON.stringify(sowed.state)), sowed.state);

  // 3. Demand surrender annexes a weak neighbor cleanly (208 cao -> 1-city lu in nanzheng)
  let surBase = createGame(world, 208, "cao", { century: true });
  surBase = advanceQuarter(world, surBase);
  surBase.factions.cao.treasury = 300;
  surBase.factions.cao.grain = 300;
  surBase.treaties = surBase.treaties.filter((t) => !t.sides.includes("lu"));
  surBase.saga.reputation = 95;
  const evalSur = evaluateDemandSurrender(world, surBase, "lu");
  assert.ok(evalSur.ok, evalSur.reason);
  const surrendered = executeDemandSurrender(world, surBase, "lu");
  assert.equal(surrendered.succeeded, true);
  assert.equal(forceTotals(surrendered.state, "lu").cities, 0);
  assert.equal(surrendered.state.cities.nanzheng.owner, "cao");
  assert.deepEqual(decodeSave(world, JSON.stringify(surrendered.state)), surrendered.state);

  // 4. Grand maneuver (supply cut when Yuan's genuine army is marching from ye -> puyang)
  const maneuverBase = structuredClone(state);
  const yuanArmy = maneuverBase.armies.find((a) => a.faction === "yuan");
  assert.ok(yuanArmy);
  yuanArmy.phase = "march";
  maneuverBase.cities.puyang.troops = Math.max(maneuverBase.cities.puyang.troops, 3200);
  maneuverBase.cities.ye.troops = Math.min(maneuverBase.cities.ye.troops, 900);
  const gmPlan = findGrandManeuverPlan(world, maneuverBase);
  assert.ok(gmPlan && (gmPlan.kind === "cut_supply" || gmPlan.kind === "naval_expedition"));
  const afterGm = executeGrandManeuver(world, maneuverBase, gmPlan);
  assert.equal(afterGm.orders.length, 1);
  assert.deepEqual(decodeSave(world, JSON.stringify(afterGm)), afterGm);

  // 5. Imperial epitaph
  const epi = generateImperialEpitaph(world, eraByYear(world, state), state);
  assert.ok(epi.title.includes("本纪") && epi.text.length > 20);
});

test("60-quarter century + saga campaign save stays well below saveFileLimit", () => {
  let state = createGame(world, 262, "wei", { century: true, historicalEvents: true });
  for (let i = 0; i < 60; i += 1) {
    if (state.saga?.pendingEvent) {
      const ev = getPendingHistoricalEvent(world, state);
      if (ev) state = resolveHistoricalEvent(world, state, ev.id, ev.choices[0].id).state;
    }
    state = advanceQuarter(world, state);
    if (forceTotals(state, "wei").cities === 0 || Object.values(state.cities).every((c) => c.owner === "wei")) break;
  }
  const encoded = JSON.stringify(state);
  assert.ok(encoded.length < saveFileLimit - 1500, `Save too large: ${encoded.length}`);
  assert.deepEqual(decodeSave(world, encoded), state);
});
