import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { seasonAdvice } from "../dist/advice.js";
import { armyByOfficer } from "../dist/armies.js";
import { answerCampaignEvent, campaignEvent, campaignRoute } from "../dist/campaign.js";
import { reviewAlliances } from "../dist/diplomacy.js";
import { concludeScenario, scenarioEndingCriteria } from "../dist/endgame.js";
import { advanceQuarter, appoint, availableAttackers, createGame, delegateCities, delegationZones, eraByYear, forecastFinance,
  forceTotals, gameOutcome, playableFactions, previewOrders, queueOrder, seasonOrderLimit, setNationalPolicy } from "../dist/engine.js";
import { frontierAttackOpportunities } from "../dist/frontier.js";
import { legacyProposals, legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { recruitOfficer } from "../dist/recruitment.js";
import { nationalRoster } from "../dist/roster.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { opponentFrontOrder, saveTheater, saveWarBudget } from "../dist/theaters.js";
import { factionPlans } from "../dist/strategy.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era199 = eraByYear(world, 199);
const policy = { front: { focus: "defense", budget: 24, garrison: 1800 }, rear: { focus: "auto", budget: 22, garrison: 900 } };

function rest(state) {
  return Object.fromEntries(playableFactions(eraByYear(world, state.year)).filter(({ key }) => key !== state.player)
    .map(({ key }) => [key, { source: "model", order: null, reason: "等待" }]));
}

function restore(state) {
  const record = { state, selected: "luoyang" };
  const restored = readGameRecord(world, createSaveBackup(record));
  assert.deepEqual(restored, record);
  return restored.state;
}

function theatersFixture() {
  let state = createGame(world, 199, "cao");
  Object.assign(state.cities.puyang, { owner: "yuan", troops: 3500 });
  Object.assign(state.cities.changan, { owner: "yuan", troops: 0, defense: 0 });
  state.cities.chenliu.troops = 2100;
  state.stations["yuan-roster-4"] = "puyang";
  for (const { key, faction } of era199.officers) {
    if (faction === "cao" && state.stations[key] === "puyang") state.stations[key] = "xu";
    if (faction === "ma" && state.stations[key] === "changan") state.stations[key] = "tianshui";
  }
  state = saveWarBudget(state, { treasury: 45, grain: 70 });
  state = saveTheater(world, state, { id: 1, name: "关中进攻", cities: ["chenliu", "luoyang"], commander: "cao-roster-2",
    depot: "chenliu", army: null, target: "changan", goal: "advance", budget: { treasury: 20, grain: 50 }, reserve: 700, priority: 1 });
  return saveTheater(world, state, { id: 2, name: "荆州固守", cities: ["xu", "wan"], commander: "cao-0",
    depot: "xu", army: null, target: "wan", goal: "defend", budget: { treasury: 25, grain: 20 }, reserve: 900, priority: 2 });
}

test("two theater commands share national limits without both pausing when one depot falls", () => {
  let state = theatersFixture();
  assert.throws(() => saveTheater(world, state, { ...state.theaters[1], cities: ["xu", "wan", "luoyang"] }), /只能分配给一个战区/);
  assert.deepEqual(forecastFinance(world, state).closing, advanceQuarter(world, state, rest(state)).history.at(-1).finance.closing);
  for (let turn = 0; turn < 3; turn += 1) state = restore(advanceQuarter(world, state, rest(state)));
  assert.equal(armyByOfficer(state, "cao-roster-2").location, "luoyang");
  state.cities.wan.troops = 210;
  state = restore(advanceQuarter(world, state, { ...rest(state), yuan: { source: "rules" } }));
  assert.equal(state.cities.chenliu.owner, "yuan");
  assert.equal(state.theaters[0].report.status, "blocked");
  assert.equal(state.theaters[0].paused, true);
  assert.equal(armyByOfficer(state, "cao-roster-2").phase, "hold");
  assert.equal(state.theaters[1].report.status, "executed");
  assert.equal(state.theaters[1].paused, false);
  assert.equal(state.cities.wan.troops, 900);
  assert.equal(state.theaters[1].report.grain, 7);
  assert.equal(state.history.at(-1).finance.orders.grain, 7);
});

test("national grain is assigned by priority only once and explicit commands retain their queue slots", () => {
  let state = theatersFixture();
  state.cities.wan.troops = 210;
  state = saveWarBudget(state, { treasury: 45, grain: 28 });
  const next = restore(advanceQuarter(world, state, rest(state)));
  assert.equal(next.theaters[0].report.grain, 28);
  assert.equal(next.theaters[1].report.grain, 0);
  assert.equal(next.theaters[1].report.status, "blocked");
  assert.equal(next.history.at(-1).finance.orders.grain, 28);
  for (const city of ["xu", "luoyang", "chenliu"]) state = queueOrder(world, state, { type: "build", project: "farming", city });
  const manual = advanceQuarter(world, state, rest(state));
  assert.equal(state.orders.length, seasonOrderLimit);
  assert.ok(manual.theaters.every(({ report }) => report.status === "waiting"));
  assert.equal(manual.armies, undefined);
});

test("a lost theater seat stops only that theater even when its depot is intact", () => {
  let state = theatersFixture();
  const first = state.theaters[0];
  assert.throws(() => saveTheater(world, state, { ...first, seat: "wan" }), /治所和粮仓须设在战区内/);
  state = saveTheater(world, state, { ...first, seat: "luoyang" });
  Object.assign(state.cities.luoyang, { troops: 250, defense: 0 });
  state.cities.changan.troops = 5000;
  state.stations["yuan-roster-4"] = "changan";
  state.cities.wan.troops = 210;
  const attack = { type: "attack", from: "changan", to: "luoyang", officer: "yuan-roster-4", troops: 3500 };
  const next = restore(advanceQuarter(world, state, { ...rest(state), yuan: { source: "model", order: attack } }));
  assert.equal(next.cities.luoyang.owner, "yuan");
  assert.equal(next.cities.chenliu.owner, "cao");
  assert.equal(next.theaters[0].report.text, "战区治所失守，请重新部署。");
  assert.equal(next.theaters[0].paused, true);
  assert.equal(next.theaters[1].report.status, "executed");
});

test("a legacy service can still provide decisions while the current client settles national theaters", () => {
  const state = theatersFixture();
  const supplied = legacySnapshot(world, state, 21);
  assert.equal(supplied.theaters, undefined);
  const old = advanceQuarter(world, supplied, rest(supplied));
  const opponents = playableFactions(era199).filter(({ key }) => key !== state.player);
  const proposals = legacyProposals(world, supplied, old.history.at(-1), opponents, 21);
  const settled = restore(advanceQuarter(world, state, proposals));
  assert.equal(settled.theaters[0].report.status, "executed");
  assert.ok(armyByOfficer(settled, "cao-roster-2"));
  assert.ok(settled.history.at(-1).decisions.every(({ source }) => source === "model"));
});

test("a rival's regional strategy can fund a real reinforcement order under the same reserve rules", () => {
  const state = createGame(world, 199, "cao");
  state.turn = 12;
  state.cities.changan.troops = 400;
  state.cities.tianshui.troops = 3500;
  state.factions.ma.grain = 130;
  const goal = { type: "defend", city: "changan", target: "luoyang", threshold: 1800, since: 12 };
  state.strategies.ma = goal;
  const order = opponentFrontOrder(world, era199, state, "ma", goal);
  assert.deepEqual(order, { type: "transfer", from: "tianshui", to: "changan", troops: 1400 });
  assert.deepEqual(factionPlans(world, era199, state, "ma").suggested.order, order);
  const next = restore(advanceQuarter(world, state, { ...rest(state), ma: { source: "rules" } }));
  assert.equal(next.cities.changan.troops, 1800);
  assert.equal(next.cities.tianshui.troops, 2100);
});

test("ordered theater recovery uses existing appointments and recruitment signs only the selected candidate", () => {
  let state = createGame(world, 199, "cao");
  state.turn = 4;
  const candidate = "cao-talent-0";
  assert.throws(() => appoint(world, state, "luoyang", "governor", candidate), /已入仕/);
  const oldTreasure = state.factions.cao.treasury;
  state = recruitOfficer(world, state, candidate, "luoyang");
  assert.equal(state.factions.cao.treasury, oldTreasure - 32);
  assert.equal(state.stations[candidate], "luoyang");
  assert.throws(() => recruitOfficer(world, state, candidate, "luoyang"), /无法招揽/);
  assert.ok(nationalRoster(world, state, { status: "available", sort: "governance", query: "程谦" }).matching.length);
  state.cities.luoyang.occupation = 2;
  state = saveTheater(world, state, { id: 1, name: "洛阳接管", cities: ["luoyang", "xu"], commander: "cao-1", depot: "xu",
    army: null, target: "luoyang", goal: "recover", budget: { treasury: 20, grain: 20 }, reserve: 800, priority: 1 });
  const next = restore(advanceQuarter(world, state, rest(state)));
  assert.equal(next.cities.luoyang.occupation, 0);
  assert.ok(next.cities.luoyang.governor);
  assert.ok(next.history.at(-1).entries.some(({ orderType, city }) => orderType === "appoint-governor" && city === "luoyang"));
  const legacy = legacySnapshot(world, next, 21);
  assert.equal(legacy.recruitedOfficers, undefined);
  assert.equal(legacy.stations[candidate], undefined);
  assert.equal(legacy.theaters, undefined);
});

test("a mature, imbalanced treaty draws a review while its protection remains in force", () => {
  const state = createGame(world, 199, "cao");
  state.turn = 15;
  state.treaties = [{ kind: "alliance", sides: ["cao", "lu"], expires: 16 }];
  assert.deepEqual(reviewAlliances(world, state), [{ sides: ["cao", "lu"], smaller: "lu" }]);
  assert.equal(state.treaties[0].expires, 16);
});

for (const [year, player] of [[199, "cao"], [199, "lu"], [262, "wei"], [262, "shu"], [265, "jin"], [265, "wu"]]) {
  test(`${year} ${player} plays 20 quarters with long-term fiscal, territory and save checks`, (t) => {
    const era = eraByYear(world, year);
    let state = createGame(world, year, player);
    const opening = forceTotals(state, player).cities;
    const frontier = delegationZones(world, state).front.slice(0, 2);
    state = delegateCities(world, state, frontier, year === 199 ? "farming" : "defense", 22);
    if (year !== 199) state = setNationalPolicy(state, policy);
    for (let turn = 1; turn <= 20; turn += 1) {
      const decision = campaignEvent(world, era, state);
      if (decision) state = answerCampaignEvent(world, era, state, decision.available && state.campaignEvents.pending.kind !== "succession");
      const order = seasonAdvice(world, state).find((item) => item.order)?.order;
      if (order) state = queueOrder(world, state, order);
      state = restore(advanceQuarter(world, state));
      assert.equal(state.turn, turn);
      assert.equal(Object.keys(state.cities).length, 44);
      assert.equal(gameOutcome(state), "ongoing");
    }
    const counts = forceTotals(state, player);
    assert.ok(counts.cities >= opening / 2);
    assert.ok(state.campaignRecord.peak >= counts.cities);
    assert.equal(state.campaignRecord.from, 1);
    assert.ok(campaignRoute(world, era, state).filter(({ completed }) => completed !== null).length >= 2);
    assert.ok(state.campaignEvents.records.some(({ kind }) => kind === "historical"));
    const eligibleForEnding = scenarioEndingCriteria(world, state).ready;
    if (eligibleForEnding) assert.equal(gameOutcome(restore(concludeScenario(world, state))), "victory");
    t.diagnostic(JSON.stringify({ opening, holdings: counts.cities, troops: counts.troops,
      treasury: state.factions[player].treasury, grain: state.factions[player].grain, eligibleForEnding }));
  });
}

test("a new 265 campaign can play from opening to full 44-city unification", (t) => {
  const era = eraByYear(world, 265);
  let state = createGame(world, 265, "jin");
  while (gameOutcome(state) === "ongoing" && state.turn < 60) {
    for (let slot = 0; slot < seasonOrderLimit; slot += 1) {
      const planned = previewOrders(world, state);
      const attacks = frontierAttackOpportunities(world, state, planned).entries;
      if (attacks.length) {
        state = queueOrder(world, state, attacks[0].order);
        continue;
      }
      const target = world.cities.find(({ key, links }) => planned.cities[key].owner === "jin" && planned.cities[key].troops < 4500
        && links.some((link) => planned.cities[link].owner !== "jin"));
      if (!target) break;
      if (!availableAttackers(era, planned, "jin", target.key).length && !state.cities[target.key].commander) {
        const candidate = nationalRoster(world, state, { status: "available", sort: "command", query: "" }).matching[0];
        if (candidate && state.cities[target.key].owner === "jin") state = appoint(world, state, target.key, "commander", candidate.person.key);
      }
      if (planned.factions.jin.treasury >= 20 && planned.factions.jin.grain >= 12) state = queueOrder(world, state, { type: "recruit", city: target.key });
      else break;
    }
    state = restore(advanceQuarter(world, state));
  }
  assert.equal(gameOutcome(state), "victory");
  assert.equal(forceTotals(state, "jin").cities, 44);
  assert.equal(state.campaignRecord.peak, 44);
  assert.ok(state.campaignRecord.battles.length > 0);
  assert.throws(() => advanceQuarter(world, state), /战局已结束/);
  t.diagnostic(`unified in ${state.turn} quarters`);
});

test("a qualified scenario ending is confirmable, read-only and survives load", () => {
  let state = createGame(world, 199, "cao");
  state.turn = 16;
  state.stageCompletedAt = 2;
  state.campaignMilestones = [3, 4];
  state.factions.cao.treasury += 100;
  const sites = world.cities.filter(({ key }) => state.cities[key].owner !== state.player).slice(0, 2);
  for (const { key } of sites) {
    Object.assign(state.cities[key], { owner: "cao", commander: null, governor: null });
  }
  delete state.stations;
  state = readGameRecord(world, JSON.stringify({ state, selected: "luoyang" })).state;
  assert.equal(gameOutcome(state), "ongoing");
  assert.equal(scenarioEndingCriteria(world, state).ready, true);
  const finished = restore(concludeScenario(world, state));
  assert.equal(gameOutcome(finished), "victory");
  assert.equal(finished.scenarioEnding.turn, 16);
});
