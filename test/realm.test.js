import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import {
  accordCandidates, accordCredit, accordProposal, activeAccords, coalitionCriteria, commercialStatus,
  proposeAccord, quoteAccord, respondAccord, revokeTrade,
} from "../dist/accords.js";
import { seasonAdvice } from "../dist/advice.js";
import { armyByOfficer } from "../dist/armies.js";
import { answerCampaignEvent, campaignEvent } from "../dist/campaign.js";
import { incomingTreatyBlock, quoteTreaty, treatyWith } from "../dist/diplomacy.js";
import { concludeCoalition } from "../dist/endgame.js";
import {
  advanceQuarter, appoint, availableAttackers, createGame, decodeSave, delegateCities, delegationZones, eraByYear,
  forceTotals, forecastFinance, gameOutcome, playableFactions, previewOrders, queueOrder, respondToTreaty, seasonOrderLimit, sendTreatyOffer,
  setNationalPolicy,
} from "../dist/engine.js";
import { frontierAttackOpportunities } from "../dist/frontier.js";
import { legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { assignRealmOffice, editRealmPolicy, nationalDuty, startRealm } from "../dist/realm.js";
import { nationalRoster } from "../dist/roster.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { factionPlans } from "../dist/strategy.js";
import { saveTheater, saveWarBudget } from "../dist/theaters.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const redCliff = eraByYear(world, 208);
const budget = { development: 80, military: 75, relief: 24, priority: "military" };

function rest(state) {
  return Object.fromEntries(playableFactions(eraByYear(world, state.year)).filter(({ key }) => key !== state.player)
    .map(({ key }) => [key, { source: "model", order: null, reason: "等待", accord: null }]));
}

function restore(state, selected = "luoyang") {
  const snapshot = { state, selected };
  const result = readGameRecord(world, createSaveBackup(snapshot));
  assert.deepEqual(result, snapshot);
  return result.state;
}

test("all opening factions share the same 44 cities and an old midsession save upgrades without losing data", () => {
  assert.deepEqual(world.scenarios.map(({ year }) => year).sort(), [184, 190, 199, 208, 219, 234, 251, 262, 265]);
  for (const era of world.scenarios) for (const { key } of playableFactions(era)) {
    const state = createGame(world, era.year, key, { realm: true });
    assert.equal(Object.keys(state.realm.cities).length, 44);
    assert.equal(Object.keys(state.cities).length, 44);
    assert.ok(forceTotals(state, key).cities > 0);
    restore(state);
  }
  let old = createGame(world, 199, "cao");
  old = advanceQuarter(world, old, rest(old));
  old = queueOrder(world, old, { type: "build", city: "luoyang", project: "commerce" });
  const current = restore(startRealm(world, restore(old)));
  const { realm, ...unchanged } = current;
  assert.deepEqual(unchanged, old);
  assert.equal(realm.since, old.turn);
  assert.deepEqual(decodeSave(world, JSON.stringify(legacySnapshot(world, current, 22))), old);
});

test("development funding, recruiting, relief and office succession share an exact ledger", () => {
  let state = createGame(world, 208, "liu");
  state = appoint(world, state, "jiangxia", "governor", "liu-208-4");
  state = delegateCities(world, state, ["jiangxia"], "commerce", 50);
  state = assignRealmOffice(world, state, "civil", null, "liu-208-0");
  state = editRealmPolicy(state, { ...budget, development: 0, priority: "relief" }, { treasury: 0, grain: 35 });
  state.realm.cities.jiangxia.welfare = 42;
  const openingPopulation = state.realm.cities.jiangxia.population;
  state = queueOrder(world, state, { type: "recruit", city: "jiangxia" });
  const forecast = forecastFinance(world, state);
  const next = restore(advanceQuarter(world, state, rest(state)));
  const actual = next.history.at(-1).finance;
  assert.deepEqual(forecast.closing, actual.closing);
  assert.deepEqual(forecast.realm, actual.realm);
  assert.equal(actual.realm.relief.treasury, 5);
  assert.equal(actual.realm.relief.grain, 9);
  assert.equal(actual.programs[0].result, "national-budget");
  assert.equal(actual.orders.treasury, 20);
  assert.equal(actual.orders.grain, 12);
  assert.ok(next.realm.cities.jiangxia.population < openingPopulation);
  assert.equal(nationalDuty(next, "liu-208-0"), "civil");
  assert.ok(next.realm.service.some(({ kind }) => kind === "succeeded"));
  assert.ok(next.realm.service.some(({ kind }) => kind === "merit"));
  assert.throws(() => appoint(world, next, "jiangxia", "commander", "liu-208-0"), /国级职务/);
  restore(legacySnapshot(world, next, 22));
});

test("trade income stops when access is revoked and grain aid transfers exactly once", () => {
  let state = createGame(world, 208, "liu");
  const trade = accordProposal(world, state, "liu", "wu", "trade");
  state = proposeAccord(world, redCliff, state, trade);
  assert.throws(() => proposeAccord(world, redCliff, state, trade), /正在等待/);
  state = restore(advanceQuarter(world, state, rest(state)));
  const active = activeAccords(state, "liu")[0];
  assert.equal(commercialStatus(world, state, active).route.length, 2);
  const aid = accordProposal(world, state, "liu", "wu", "aid", null, 18);
  state = proposeAccord(world, redCliff, state, aid);
  state = restore(advanceQuarter(world, state, rest(state)));
  assert.ok(state.history.at(-1).finance.realm.commerce > 0);
  const quoted = forecastFinance(world, state);
  state = restore(advanceQuarter(world, state, rest(state)));
  assert.deepEqual(quoted.closing, state.history.at(-1).finance.closing);
  assert.equal(state.history.at(-1).finance.realm.aidOut, 18);
  assert.ok(state.realm.reports.some(({ status }) => status === "delivered"));
  assert.equal(activeAccords(state, "liu").filter(({ kind }) => kind === "aid").length, 0);
  const credit = accordCredit(state, "liu", "wu");
  state = revokeTrade(state, "wu");
  assert.equal(accordCredit(state, "liu", "wu"), credit - 12);
  state = restore(advanceQuarter(world, state, rest(state)));
  assert.deepEqual(state.history.at(-1).finance.realm, { commerce: 0, aidIn: 0, aidOut: 0, relief: { treasury: 0, grain: 0 } });
});

test("fall of a trade endpoint is localized and reported with the broken road", () => {
  let state = createGame(world, 208, "liu");
  const trade = accordProposal(world, state, "liu", "wu", "trade");
  state = proposeAccord(world, redCliff, state, trade);
  state = advanceQuarter(world, state, rest(state));
  const target = trade.sites[1];
  assert.equal(target, "lujiang");
  Object.assign(state.cities[target], { troops: 250, defense: 0 });
  state.cities.shouchun.troops = 3600;
  state.stations["cao-208-1"] = "shouchun";
  state.strategies.cao = { type: "expand", since: 1, city: "shouchun", target, threshold: 1 };
  const order = { type: "attack", from: "shouchun", to: target, officer: "cao-208-1", troops: 2800 };
  const after = restore(advanceQuarter(world, state, { ...rest(state), cao: { source: "model", order, accord: null } }));
  assert.equal(after.cities[target].owner, "cao");
  const blocked = activeAccords(after, "liu")[0];
  const health = commercialStatus(world, after, blocked);
  assert.equal(health.blocked, target);
  assert.equal(health.income, 0);
  assert.ok(after.realm.reports.some(({ status, text }) => status === "block" && text.includes("庐江")));
});

test("the two independent military orders can fulfill a joint pledge", () => {
  let state = createGame(world, 208, "liu");
  state.treaties = [{ sides: ["han", "liu"], kind: "alliance", expires: 4 }];
  const target = "jiangling";
  const proposal = accordProposal(world, state, "liu", "han", "joint", target);
  state = proposeAccord(world, redCliff, state, proposal);
  state = advanceQuarter(world, state, rest(state));
  assert.equal(activeAccords(state, "liu")[0].target, target);
  state = queueOrder(world, state, { type: "mobilize", from: "jiangxia", to: target, officer: "liu-208-1", troops: 1000 });
  state.cities.linyuan.troops = 3200;
  state.stations["han-208-5"] = "linyuan";
  const { order, goal } = factionPlans(world, redCliff, state, "han").choices.find(({ order }) =>
    order?.type === "mobilize" && order.to === target);
  state = restore(advanceQuarter(world, state, { ...rest(state), han: { source: "model", order, goal, accord: null } }));
  assert.equal(state.armies?.filter((army) => army.target === target).length, 2);
  assert.ok(state.realm.reports.some(({ kind, status }) => kind === "joint" && status === "fulfilled"));
  assert.equal(activeAccords(state, "liu").length, 0);
});

test("model factions receive separate diplomacy choices, and one bad reply falls back independently", async () => {
  const state = createGame(world, 208, "liu");
  const seen = [];
  const models = { client: () => ({ decide: async (messages) => {
    const brief = messages[1].content;
    const header = brief.split(" · ")[0];
    seen.push(header);
    if (header === "公孙康") return { choice: "invalid", reason: "无效" };
    return { choice: "0", reason: "留足储备", ...(brief.includes("外交 T0") ? { accord: "T0" } : {}) };
  } }) };
  const decisions = await createPlanner({ models }).plan(world, state);
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(decisions.gongsun.source, "fallback");
  assert.equal(decisions.wu.source, "model");
  assert.deepEqual(decisions.wu.accord, accordCandidates(world, redCliff, state, "wu")[0]);
  const next = restore(advanceQuarter(world, state, decisions));
  assert.ok(next.history.at(-1).decisions.some(({ faction, source }) => faction === "gongsun" && source === "fallback"));
  assert.ok(next.realm.proposals.some(({ from }) => from === "wu"));
});

test("a theater switches to its own reserve depot while the other front keeps its budget", () => {
  let state = createGame(world, 199, "cao", { realm: true });
  Object.assign(state.cities.puyang, { owner: "yuan", troops: 3500 });
  Object.assign(state.cities.changan, { owner: "yuan", troops: 0, defense: 0 });
  state.cities.chenliu.troops = 2100;
  state.stations["yuan-roster-4"] = "puyang";
  const era = eraByYear(world, 199);
  for (const { key, faction } of era.officers) {
    if (faction === "cao" && state.stations[key] === "puyang") state.stations[key] = "xu";
    if (faction === "ma" && state.stations[key] === "changan") state.stations[key] = "tianshui";
  }
  state = saveWarBudget(state, { treasury: 45, grain: 70 });
  state = saveTheater(world, state, { id: 1, name: "关中进攻", seat: "luoyang", cities: ["chenliu", "luoyang"], commander: "cao-roster-2",
    depot: "chenliu", backup: "luoyang", army: null, target: "changan", goal: "advance", budget: { treasury: 20, grain: 50 }, reserve: 700, priority: 1 });
  state = saveTheater(world, state, { id: 2, name: "荆州固守", cities: ["xu", "wan"], commander: "cao-0",
    depot: "xu", army: null, target: "wan", goal: "defend", budget: { treasury: 25, grain: 20 }, reserve: 900, priority: 2 });
  for (let turn = 0; turn < 3; turn += 1) state = restore(advanceQuarter(world, state, rest(state)));
  const previous = armyByOfficer(state, "cao-roster-2");
  assert.equal(previous.location, "luoyang");
  state.cities.wan.troops = 210;
  state = restore(advanceQuarter(world, state, { ...rest(state), yuan: { source: "rules" } }));
  assert.equal(state.cities.chenliu.owner, "yuan");
  assert.equal(armyByOfficer(state, "cao-roster-2").depot, "luoyang");
  assert.equal(state.theaters[0].paused, false);
  assert.equal(state.theaters[1].report.status, "executed");
  assert.ok(state.history.at(-1).entries.some(({ text }) => text.includes("启用备用粮仓")));
});

for (const [year, faction] of [[199, "cao"], [199, "lu"], [208, "cao"], [208, "liu"], [262, "wei"], [262, "shu"], [265, "jin"], [265, "wu"]]) {
  test(`${year} ${faction} survives 30 quarters with an auditable economy`, (t) => {
    let state = createGame(world, year, faction, { realm: true });
    const era = eraByYear(world, year);
    const initial = forceTotals(state, faction).cities;
    const frontline = delegationZones(world, state).front.slice(0, 2);
    state = delegateCities(world, state, frontline, year === 199 ? "farming" : "defense", 22);
    const multipleFronts = year === 208 && faction === "cao";
    if (multipleFronts) state = setNationalPolicy(state, { front: { focus: "defense", budget: 24, garrison: 2400 },
      rear: { focus: "auto", budget: 20, garrison: 950 } });
    for (let i = 0; i < 30; i += 1) {
      const event = campaignEvent(world, era, state);
      if (event) state = answerCampaignEvent(world, era, state, event.available && state.campaignEvents.pending.kind !== "succession");
      for (let slot = 0; slot < (multipleFronts ? 2 : 1); slot += 1) {
        const order = seasonAdvice(world, state).find((entry) => entry.order)?.order;
        if (order) state = queueOrder(world, state, order);
      }
      state = restore(advanceQuarter(world, state));
      assert.equal(Object.keys(state.cities).length, 44);
      assert.equal(state.turn, i + 1);
      assert.equal(gameOutcome(state), "ongoing");
    }
    t.diagnostic(`${initial} to ${forceTotals(state, faction).cities} cities; ${state.factions[faction].treasury} treasury; ${state.factions[faction].grain} grain`);
    assert.ok(forceTotals(state, faction).cities >= Math.max(1, Math.floor(initial / 2)));
  });
}

test("Liu Bei can reach the coalition ending from one city against ordinary rules AI", (t) => {
  let state = createGame(world, 208, "liu");
  const partners = ["wu", "han"];
  state = queueOrder(world, state, { type: "build", city: "jiangxia", project: "commerce" });
  while (state.turn < 30 && !coalitionCriteria(world, redCliff, state).ready) {
    if (state.incomingTreaty?.answer === null && !incomingTreatyBlock(state)) state = respondToTreaty(world, state, true);
    for (const item of state.realm.proposals.filter(({ to, answer }) => to === "liu" && answer === undefined)) {
      state = respondAccord(state, item.from, item.kind, partners.includes(item.from) || item.kind === "aid");
    }
    for (const partner of partners) {
      const proposal = accordProposal(world, state, "liu", partner, "trade");
      if (quoteAccord(world, redCliff, state, proposal).accepted) state = proposeAccord(world, redCliff, state, proposal);
      if (quoteTreaty(world, state, partner, "alliance").accepted) state = sendTreatyOffer(world, state, partner, "alliance");
    }
    state = restore(advanceQuarter(world, state), "jiangxia");
  }
  assert.equal(forceTotals(state, "liu").cities, 1);
  assert.ok(partners.every((partner) => treatyWith(state, "liu", partner)?.kind === "alliance"));
  const result = restore(concludeCoalition(world, state), "jiangxia");
  assert.equal(gameOutcome(result), "victory");
  assert.equal(result.scenarioEnding.kind, "coalition");
  assert.throws(() => advanceQuarter(world, result), /战局已结束/);
  t.diagnostic(`coalition ending at quarter ${state.turn}`);
});

test("1.1 supports a complete 44-city unification from the regular Jin opening", (t) => {
  const era = eraByYear(world, 265);
  let state = createGame(world, 265, "jin", { realm: true });
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
  assert.equal(forceTotals(state, "jin").cities, 44);
  assert.equal(gameOutcome(state), "victory");
  assert.equal(state.campaignRecord.peak, 44);
  t.diagnostic(`unified in ${state.turn} quarters`);
});
