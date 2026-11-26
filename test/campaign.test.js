import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { answerCampaignEvent, campaignEvent, campaignRoute, officerService, officerSkill, promoteOfficer } from "../dist/campaign.js";
import { opponentTreaty } from "../dist/diplomacy.js";
import { advanceQuarter, createGame, decodeSave, delegateCities, delegationZones, eraByYear, forceTotals, forecastAttack,
  forecastFinance, gameOutcome, playableFactions, queueOrder, resumeNationalPolicy, setGovernance, setNationalPolicy } from "../dist/engine.js";
import { seasonAdvice } from "../dist/advice.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { factionPlans } from "../dist/strategy.js";
import { legacySnapshot } from "../dist/legacy-turn.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const policy = { front: { focus: "defense", budget: 24, garrison: 1800 }, rear: { focus: "auto", budget: 22, garrison: 900 } };

function resting(era, player) {
  return Object.fromEntries(playableFactions(era).filter(({ key }) => key !== player)
    .map(({ key }) => [key, { source: "model", order: null, reason: "fixture rest" }]));
}

function summarize(state) {
  const { cities, troops } = forceTotals(state, state.player);
  const { treasury, grain } = state.factions[state.player];
  return { cities, troops, treasury, grain };
}

for (const [year, player] of [[199, "cao"], [199, "lu"], [262, "wei"], [262, "shu"], [265, "jin"], [265, "wu"]]) {
  test(`${year} ${player} plays twelve quarters with valid finances, milestones and portable saves`, (t) => {
    const era = eraByYear(world, year);
    let state = createGame(world, year, player);
    const opening = summarize(state);
    const frontier = delegationZones(world, state).front.slice(0, 2);
    state = delegateCities(world, state, frontier, year === 199 ? "farming" : "defense", 22);
    if (year !== 199) state = setNationalPolicy(state, policy);
    for (let turn = 1; turn <= 12; turn += 1) {
      const event = campaignEvent(world, era, state);
      if (event) state = answerCampaignEvent(world, era, state, event.available && state.campaignEvents.pending.kind !== "succession");
      const order = seasonAdvice(world, state).find((item) => item.order)?.order;
      if (order) state = queueOrder(world, state, order);
      const next = advanceQuarter(world, state);
      assert.equal(next.turn, turn);
      assert.equal(Object.keys(next.cities).length, 44);
      assert.equal(gameOutcome(next), "ongoing");
      assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
      const report = next.history.at(-1);
      assert.equal(report.finance.closing.treasury, next.factions[player].treasury);
      assert.equal(report.finance.closing.grain, next.factions[player].grain);
      state = next;
    }
    const dates = campaignRoute(world, era, state).map(({ completed }) => completed);
    assert.equal(dates.filter(Boolean).length, 3);
    assert.ok(dates[0] < dates[1] && dates[1] < dates[2]);
    const pending = campaignEvent(world, era, state);
    if (pending) state = answerCampaignEvent(world, era, state, pending.available);
    assert.equal(state.campaignEvents.records.length, 3);
    const record = { state, selected: world.cities[0].key };
    assert.deepEqual(readGameRecord(world, createSaveBackup(record)), record);
    t.diagnostic(JSON.stringify({ opening, yearThree: summarize(state), completedQuarters: dates }));
  });
}

test("ongoing national policy recruits below target, respects manual control and uses the same fiscal forecast", () => {
  const era = eraByYear(world, 199);
  const initial = createGame(world, 199, "cao");
  const [first, second] = delegationZones(world, initial).front;
  let state = delegateCities(world, initial, [first, second], "farming", 22);
  state.cities[first].troops = 1500;
  state = setNationalPolicy(state, policy);
  state = setGovernance(state, second, "direct", "commerce");
  const forecast = forecastFinance(world, state);
  assert.equal(forecast.programs.find(({ city }) => city === first).focus, "recruit");
  assert.equal(forecast.programs.some(({ city }) => city === second), false);
  let next = advanceQuarter(world, state, resting(era, state.player));
  assert.deepEqual(next.history.at(-1).finance.closing, forecast.closing);
  assert.equal(next.cities[first].troops, 2100);
  assert.equal(next.cities[second].mode, "direct");
  next = resumeNationalPolicy(next, second);
  const later = forecastFinance(world, next).programs;
  assert.equal(later.find(({ city }) => city === first).focus, "defense");
  assert.ok(later.some(({ city }) => city === second));
});

test("court events can be accepted once and promotions change simulated combat strength", () => {
  const era = eraByYear(world, 199);
  let state = createGame(world, 199, "cao");
  const key = "cao-1";
  state.turn = 3;
  state = advanceQuarter(world, state, resting(era, state.player));
  const event = campaignEvent(world, era, state);
  assert.equal(event.title, "人才举荐");
  const money = state.factions.cao.treasury;
  state = answerCampaignEvent(world, era, state, true);
  assert.equal(state.factions.cao.treasury, money - 18);
  assert.equal(officerService(state, event.key).governance, 2);
  assert.throws(() => answerCampaignEvent(world, era, state, true), /没有待处理/);

  state.officerService[key] = { ...officerService(state, key), command: 3 };
  const order = { type: "attack", from: "luoyang", to: "changan", troops: 1200, officer: key };
  const before = forecastAttack(era, state, order).offense;
  const promoted = promoteOfficer(world, state, key, "command");
  const person = era.officers.find((officer) => officer.key === key);
  assert.equal(officerSkill(promoted, person, "command"), person.command + 5);
  assert.equal(forecastAttack(era, promoted, order).offense, before + 50);
  assert.throws(() => promoteOfficer(world, promoted, key, "command"), /资历不足/);

  promoted.turn = 7;
  state = advanceQuarter(world, promoted, resting(era, promoted.player));
  const succession = campaignEvent(world, era, state);
  assert.equal(succession.title, "军务继任");
  const next = answerCampaignEvent(world, era, state, true);
  assert.equal(next.cities[succession.city].commander, succession.key);
  assert.equal(next.stations[succession.key], succession.city);
  assert.equal(next.factions.cao.morale, state.factions.cao.morale + 4);
  assert.equal(legacySnapshot(world, next, 19).campaignEvents, undefined);
  assert.equal(legacySnapshot(world, next, 19).officerService, undefined);
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
});

test("AI diplomacy can coordinate against shared strength or stabilize a second front, and scarcity interrupts expansion", () => {
  const graph = { cities: [
    { key: "a", links: ["b", "c"] }, { key: "b", links: ["a", "c"] }, { key: "c", links: ["a", "b"] },
  ] };
  const situation = { turn: 4, player: "c", strategies: {}, treaties: [],
    factions: { a: { treasury: 100 }, b: { treasury: 100 }, c: { treasury: 100 } },
    cities: { a: { owner: "a", troops: 1000 }, b: { owner: "b", troops: 1000 }, c: { owner: "c", troops: 2000 } } };
  assert.equal(opponentTreaty(graph, situation).kind, "alliance");
  situation.cities.c.troops = 1000;
  assert.equal(opponentTreaty(graph, situation).kind, "truce");
  assert.equal(opponentTreaty(graph, { ...situation, turn: 3 }), null);

  const era = eraByYear(world, 199);
  const state = createGame(world, 199, "cao");
  const city = world.cities.find(({ links, key }) => state.cities[key].owner === "yuan" && links.some((link) => state.cities[link].owner !== "yuan"));
  const target = city.links.find((key) => state.cities[key].owner !== "yuan");
  state.turn = 4;
  state.factions.yuan.grain = 2;
  state.strategies.yuan = { type: "expand", city: city.key, target, since: 4, threshold: 1 };
  const plan = factionPlans(world, era, state, "yuan");
  assert.equal(plan.recovering, true);
  assert.equal(plan.keep, false);
  assert.deepEqual(plan.goals.map(({ type }) => type), ["economy"]);
});
