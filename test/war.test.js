import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { accordProposal, coalitionCriteria, proposeAccord, quoteAccord, respondAccord } from "../dist/accords.js";
import { seasonAdvice } from "../dist/advice.js";
import { armyByOfficer, commandArmy, supplyRoute } from "../dist/armies.js";
import { answerCampaignEvent, campaignEvent } from "../dist/campaign.js";
import { incomingTreatyBlock, quoteTreaty } from "../dist/diplomacy.js";
import { concludeCoalition } from "../dist/endgame.js";
import {
  advanceQuarter, appoint, availableAttackers, createGame, delegationZones, delegateCities, eraByYear, forceTotals, forecastFinance,
  forecastOrderSteps, gameOutcome, playableFactions, previewMilitaryOrders, previewOrders, queueOrder, respondToTreaty, seasonOrderLimit, sendTreatyOffer, setNationalPolicy,
} from "../dist/engine.js";
import { frontierAttackOpportunities } from "../dist/frontier.js";
import { legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { nationalRoster } from "../dist/roster.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { factionPlans } from "../dist/strategy.js";
import { saveTheater } from "../dist/theaters.js";
import { beginWar, militaryView, queueScout, townIntel } from "../dist/war-intel.js";
import { campaignTasks, operationPreview, warBlockaded } from "../dist/war-operations.js";
import { saveRecovery } from "../dist/war-recovery.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const era199 = eraByYear(world, 199);
const game = (year = 199, faction = "cao") => createGame(world, year, faction, { realm: true, war: true });

function rest(state) {
  return Object.fromEntries(playableFactions(eraByYear(world, state.year)).filter(({ key }) => key !== state.player)
    .map(({ key }) => [key, { source: "model", order: null, reason: "等待", accord: null }]));
}

function restored(state) {
  const snapshot = { state, selected: "luoyang" };
  const record = readGameRecord(world, createSaveBackup(snapshot));
  assert.deepEqual(record, snapshot);
  return record.state;
}

function play(state, proposals = rest(state), count = 1) {
  for (let index = 0; index < count; index += 1) state = restored(advanceQuarter(world, state, proposals));
  return state;
}

function operations(state, extra = {}) {
  return saveTheater(world, state, { id: 1, name: "关中", goal: "advance", cities: ["luoyang"], depot: "luoyang",
    commander: "cao-1", army: null, target: "changan", reserve: 600, priority: 1, budget: { treasury: 40, grain: 70 },
    operation: { mission: "main", stance: "siege", troops: 2700, floor: 650, retreat: "luoyang", started: state.turn, ...extra } });
}

test("a 1.1 campaign with a moving army upgrades and round trips without losing anything", () => {
  let old = createGame(world, 199, "cao", { realm: true });
  old = queueOrder(world, old, { type: "mobilize", from: "luoyang", to: "changan", officer: "cao-1", troops: 800 });
  old = play(old, rest(old), 2);
  assert.equal(armyByOfficer(old, "cao-1").phase, "march");
  const next = restored(beginWar(world, old));
  assert.deepEqual(legacySnapshot(world, next, 23), old);
  assert.equal(next.war.since, 2);
  assert.deepEqual(next.armies, old.armies);
});

test("scouting pays once, reports an actual interval, and hidden changes do not enter faction plans", async () => {
  let state = game();
  const opening = townIntel(state, "cao", "changan");
  assert.equal(opening.source, "border");
  assert.ok(opening.troops[1] - opening.troops[0] > 800);
  const staged = queueScout(world, state, "changan");
  assert.throws(() => queueScout(world, staged, "changan"), /已派出/);
  const predicted = forecastFinance(world, staged);
  state = play(staged);
  const quote = townIntel(state, "cao", "changan");
  assert.ok(quote.troops[0] <= state.cities.changan.troops && state.cities.changan.troops <= quote.troops[1]);
  assert.equal(quote.source, "scout");
  assert.equal(quote.troops[1] - quote.troops[0], 249);
  assert.equal(state.history.at(-1).finance.orders.grain, 6);
  assert.deepEqual(predicted.closing, state.history.at(-1).finance.closing);
  const altered = structuredClone(state);
  altered.cities.luoyang.troops += 30109;
  assert.equal(militaryView(altered, "ma").cities.luoyang.troops, militaryView(state, "ma").cities.luoyang.troops);
  assert.deepEqual(factionPlans(world, era199, altered, "ma"), factionPlans(world, era199, state, "ma"));
  const prompts = [];
  const models = { client: () => ({ decide: async (messages) => {
    const brief = messages[1].content;
    prompts.push(brief);
    return brief.startsWith("袁绍") ? { choice: "invalid", reason: "无效" } : { choice: "0", reason: "留守" };
  } }) };
  const plans = await createPlanner({ models }).plan(world, altered);
  assert.equal(plans.yuan.source, "fallback");
  assert.equal(plans.ma.source, "model");
  assert.ok(prompts.every((prompt) => !prompt.includes(String(altered.cities.luoyang.troops))));
  assert.ok(prompts.some((prompt) => prompt.includes("本方军情")));
});

test("the displayed attack queue cannot reveal a hidden defender by predicting the actual result", () => {
  let state = game();
  state.cities.luoyang.troops = 3200;
  state = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 2400 });
  const concealed = structuredClone(state);
  concealed.cities.changan.troops = 28000;
  assert.notEqual(previewOrders(world, state).cities.changan.owner, previewOrders(world, concealed).cities.changan.owner);
  assert.equal(previewMilitaryOrders(world, state).cities.changan.owner, previewMilitaryOrders(world, concealed).cities.changan.owner);
  assert.deepEqual(forecastOrderSteps(world, state, { byIntelligence: true }), forecastOrderSteps(world, concealed, { byIntelligence: true }));
});

test("a theater proceeds through deployment and siege, then commissions recovery without duplicating fiscal charges", () => {
  let state = game();
  state.cities.luoyang.troops = 4100;
  Object.assign(state.cities.changan, { troops: 950, defense: 3 });
  state = operations(state);
  state = saveRecovery(world, state, { cities: [], follow: true, treasury: 32, grain: 45 });
  assert.equal(operationPreview(world, state, state.theaters[0]).quarters, 3);
  for (let index = 0; index < 7; index += 1) {
    const ledger = forecastFinance(world, state);
    state = play(state);
    assert.deepEqual(state.history.at(-1).finance.closing, ledger.closing);
    if (index === 2) {
      assert.equal(armyByOfficer(state, "cao-1").engagement.quarters, 1);
      assert.equal(state.cities.changan.owner, "ma");
      assert.equal(warBlockaded(state, "changan"), true);
      assert.equal(supplyRoute(world, state, { faction: "ma", depot: "changan", location: "tianshui" }), null);
    }
  }
  assert.equal(state.cities.changan.owner, "cao");
  assert.equal(state.cities.changan.occupation, 0);
  assert.ok(state.war.timeline.some(({ event }) => event === "encircled"));
  assert.ok(state.war.timeline.some(({ event }) => event === "surrender"));
  assert.ok(state.war.timeline.some(({ event }) => event === "restored"));
  assert.ok(state.war.timeline.some(({ event }) => event === "road"));
  assert.equal(state.war.milestones.length, 3);
});

test("reinforcements lift a siege, sending the same general back to regroup before another campaign", () => {
  let state = game();
  state.cities.luoyang.troops = 4200;
  Object.assign(state.cities.changan, { troops: 1350, defense: 3 });
  state.cities.tianshui.troops = 4100;
  state = operations(state, { troops: 2000 });
  state = play(state, rest(state), 3);
  assert.ok(armyByOfficer(state, "cao-1").engagement);
  const goal = { type: "defend", city: "changan", target: "luoyang", threshold: 3600, since: 3 };
  state.strategies.ma = goal;
  const order = { type: "transfer", from: "tianshui", to: "changan", troops: 1900 };
  state = play(state, { ...rest(state), ma: { source: "model", order, goal, accord: null } });
  assert.equal(state.theaters[0].paused, true);
  assert.equal(state.cities.changan.owner, "ma");
  assert.ok(state.war.timeline.some(({ event }) => event === "relieved"));
  state = commandArmy(world, state, "cao-1", { type: "retreat", target: "luoyang" });
  state = play(state);
  assert.equal(armyByOfficer(state, "cao-1"), null);
  assert.equal(state.stations["cao-1"], "luoyang");
  state = operations(state, { troops: 2650, stance: "assault" });
  state.cities.luoyang.troops = 4100;
  state.cities.changan.troops = 650;
  state = play(state, rest(state), 4);
  assert.equal(state.cities.changan.owner, "cao");
  assert.ok(state.war.timeline.some(({ event }) => event === "returned"));
  assert.ok(state.war.timeline.some(({ event }) => event === "captured"));
});

test("an independent blockade completes without taking ownership", () => {
  let state = game();
  state.cities.luoyang.troops = 3200;
  state = operations(state, { mission: "diversion", stance: "blockade", troops: 2200 });
  state = play(state, rest(state), 4);
  assert.equal(state.cities.changan.owner, "ma");
  assert.equal(state.theaters[0].report.status, "complete");
  assert.ok(state.war.timeline.some(({ event }) => event === "diverted"));
});

test("loss of a depot triggers one campaign's retreat while the relief theater still sends help", () => {
  let state = game();
  Object.assign(state.cities.puyang, { owner: "yuan", troops: 4000 });
  Object.assign(state.cities.changan, { owner: "yuan", troops: 0, defense: 0 });
  state.cities.chenliu.troops = 3150;
  state.stations["yuan-roster-4"] = "puyang";
  for (const { key, faction } of era199.officers) {
    if (faction === "cao" && state.stations[key] === "puyang") state.stations[key] = "xu";
    if (faction === "ma" && state.stations[key] === "changan") state.stations[key] = "tianshui";
  }
  state = saveTheater(world, state, { id: 1, name: "关中战役", goal: "advance", cities: ["chenliu", "luoyang"],
    seat: "luoyang", depot: "chenliu", target: "changan", commander: "cao-roster-2", army: null, reserve: 700,
    priority: 1, budget: { treasury: 20, grain: 55 }, operation: { mission: "main", stance: "siege", troops: 2350, floor: 650, retreat: "luoyang", started: 0 } });
  state = saveTheater(world, state, { id: 2, name: "南线救援", goal: "defend", cities: ["xu", "wan"], depot: "xu",
    target: "wan", commander: "cao-0", army: null, reserve: 900, priority: 2, budget: { treasury: 25, grain: 20 },
    operation: { mission: "relief", stance: "assault", troops: 1600, floor: 500, retreat: "xu", started: 0 } });
  state = play(state, rest(state), 3);
  assert.equal(armyByOfficer(state, "cao-roster-2").location, "luoyang");
  state.cities.wan.troops = 210;
  const goal = { type: "expand", city: "puyang", target: "chenliu", threshold: 1, since: 3 };
  const order = { type: "attack", from: "puyang", to: "chenliu", officer: "yuan-roster-4", troops: 3300 };
  state.strategies.yuan = goal;
  state = play(state, { ...rest(state), yuan: { source: "model", order, goal, accord: null } });
  assert.equal(state.cities.chenliu.owner, "yuan");
  assert.equal(state.theaters[0].paused, true);
  assert.equal(state.stations["cao-roster-2"], "luoyang");
  assert.equal(state.theaters[1].report.status, "executed");
  assert.equal(state.cities.wan.troops, 900);
  assert.ok(state.war.timeline.some(({ event }) => event === "retreat"));
});

test("two hostile field armies cannot capture the same city twice in one season", () => {
  let state = game(208, "liu");
  state.turn = 2;
  state.stations["liu-208-1"] = state.stations["han-208-5"] = null;
  const force = (faction, officer, location) => ({ faction, officer, location, depot: location, target: "jiangling",
    route: [location, "jiangling"], phase: "march", prepared: true, troops: 3000, grain: 60, assembledAt: 0, stance: "assault" });
  state.armies = [force("liu", "liu-208-1", "jiangxia"), force("han", "han-208-5", "linyuan")];
  state.cities.jiangling.troops = 250;
  state = play(state);
  assert.equal(state.history.at(-1).entries.filter(({ city, type }) => city === "jiangling" && type === "capture").length, 1);
  assert.equal(state.cities.jiangling.owner, "liu");
  assert.equal(armyByOfficer(state, "han-208-5").phase, "hold");
});

test("joint pledges require a real action during the named window", () => {
  const era = eraByYear(world, 208);
  let state = game(208, "liu");
  state.treaties = [{ sides: ["han", "liu"], kind: "alliance", expires: 4 }];
  const pact = accordProposal(world, state, "liu", "han", "joint", "jiangling", undefined, { duty: "assault", offset: 1 });
  state = proposeAccord(world, era, state, pact);
  state = play(state);
  state = queueOrder(world, state, { type: "mobilize", from: "jiangxia", to: "jiangling", officer: "liu-208-1", troops: 1200, stance: "siege" });
  state = play(state);
  assert.equal(state.realm.accords.find(({ kind }) => kind === "joint").joined.length, 0);
  state.cities.linyuan.troops = 3300;
  state.stations["han-208-5"] = "linyuan";
  const options = factionPlans(world, era, state, "han").choices;
  const support = options.find(({ order }) => order?.type === "mobilize" && order.to === "jiangling");
  assert.ok(support);
  state = play(state, { ...rest(state), han: { source: "model", ...support, accord: null } });
  assert.equal(state.realm.accords.find(({ kind }) => kind === "joint"), undefined);
  assert.equal(state.war.timeline.filter(({ event }) => event === "allied").length, 2);
});

for (const [year, faction] of [[199, "cao"], [199, "lu"], [208, "cao"], [208, "liu"], [262, "wei"], [262, "shu"], [265, "jin"], [265, "wu"]]) {
  test(`${year} ${faction} advances 40 quarters under the 1.2 rules`, (t) => {
    let state = game(year, faction);
    const era = eraByYear(world, year);
    const initial = forceTotals(state, faction).cities;
    const front = delegationZones(world, state).front.slice(0, 2);
    state = delegateCities(world, state, front, year === 199 ? "farming" : "defense", 22);
    if (initial > 4) state = setNationalPolicy(state, { front: { focus: "defense", budget: 24, garrison: 2300 },
      rear: { focus: "auto", budget: 20, garrison: 900 } });
    for (let turn = 0; turn < 40; turn += 1) {
      const event = campaignEvent(world, era, state);
      if (event) state = answerCampaignEvent(world, era, state, event.available && state.campaignEvents.pending.kind !== "succession");
      const advice = seasonAdvice(world, militaryView(state)).find(({ order }) => order);
      if (advice) state = queueOrder(world, state, advice.order);
      state = restored(advanceQuarter(world, state));
      assert.equal(state.turn, turn + 1);
      assert.equal(Object.keys(state.cities).length, 44);
      assert.equal(gameOutcome(state), "ongoing");
    }
    t.diagnostic(`${initial} → ${forceTotals(state, faction).cities} cities in ${state.turn} quarters`);
  });
}

test("the regular Liu Bei opening can still finish the coalition campaign with fog and independent rules rivals", (t) => {
  let state = game(208, "liu");
  const era = eraByYear(world, 208);
  const allies = ["wu", "han"];
  state = queueOrder(world, state, { type: "build", city: "jiangxia", project: "commerce" });
  while (state.turn < 45 && !coalitionCriteria(world, era, state).ready) {
    if (state.incomingTreaty?.answer === null && !incomingTreatyBlock(state)) state = respondToTreaty(world, state, true);
    for (const item of state.realm.proposals.filter(({ to, answer }) => to === "liu" && answer === undefined)) {
      state = respondAccord(state, item.from, item.kind, allies.includes(item.from) || item.kind === "aid");
    }
    for (const ally of allies) {
      const trade = accordProposal(world, state, "liu", ally, "trade");
      if (quoteAccord(world, era, state, trade).accepted) state = proposeAccord(world, era, state, trade);
      if (quoteTreaty(world, state, ally, "alliance").accepted) state = sendTreatyOffer(world, state, ally, "alliance");
    }
    state = restored(advanceQuarter(world, state));
  }
  const result = restored(concludeCoalition(world, state));
  assert.equal(gameOutcome(result), "victory");
  assert.equal(result.scenarioEnding.kind, "coalition");
  t.diagnostic(`coalition ending at quarter ${result.turn}`);
});

test("the regular Jin opening still reaches all 44 cities against independent 1.2 rules rivals", (t) => {
  let state = game(265, "jin");
  const era = eraByYear(world, 265);
  while (gameOutcome(state) === "ongoing" && state.turn < 70) {
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
      if (planned.factions.jin.treasury >= 20 && planned.factions.jin.grain >= 12
        && planned.realm.cities[target.key].population >= 1400) {
        state = queueOrder(world, state, { type: "recruit", city: target.key });
      } else break;
    }
    state = restored(advanceQuarter(world, state));
  }
  assert.equal(gameOutcome(state), "victory");
  assert.equal(forceTotals(state, "jin").cities, 44);
  t.diagnostic(`unified in ${state.turn} quarters`);
});

for (const [year, faction] of [[199, "cao"], [208, "cao"], [262, "wei"], [265, "jin"]]) {
  test(`${year} campaign objectives can be completed from its real opening`, () => {
    let state = game(year, faction);
    const era = eraByYear(world, year);
    assert.equal(campaignTasks(world, state).length, 3);
    const owned = world.cities.filter(({ key, links }) => state.cities[key].owner === faction
      && links.some((target) => state.cities[target].owner !== faction) && availableAttackers(era, state, faction, key).length);
    const origin = owned.sort((a, b) => state.cities[b.key].troops - state.cities[a.key].troops)[0];
    const target = origin.links.find((key) => state.cities[key].owner !== faction);
    state = queueScout(world, state, target);
    state = saveRecovery(world, state, { cities: [], follow: true, treasury: 28, grain: 40 });
    for (let index = 0; index < 4; index += 1) {
      state = queueOrder(world, state, { type: "recruit", city: origin.key });
      state = play(state);
    }
    const leader = availableAttackers(era, state, faction, origin.key)[0];
    state = saveTheater(world, state, { id: 1, name: "剧本战役", goal: "advance", cities: [origin.key], depot: origin.key,
      commander: leader.key, army: null, target, reserve: 500, priority: 1, budget: { treasury: 40, grain: 90 },
      operation: { mission: "main", stance: "siege", troops: 3500, floor: 650, retreat: origin.key, started: state.turn } });
    for (let turn = 0; turn < 10 && state.war.milestones.length < 3; turn += 1) state = play(state);
    assert.equal(state.cities[target].owner, faction);
    assert.equal(state.war.milestones.length, 3);
  });
}
