import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { accordProposal, coalitionCriteria, proposeAccord, quoteAccord, respondAccord } from "../dist/accords.js";
import { seasonAdvice } from "../dist/advice.js";
import { armyByOfficer, marchRoute } from "../dist/armies.js";
import { incomingTreatyBlock, isHostile, quoteTreaty } from "../dist/diplomacy.js";
import { treatyOptions, proposeDynastyTreaty } from "../dist/dynasty-treaties.js";
import { concludeCoalition } from "../dist/endgame.js";
import {
  advanceQuarter, appoint, availableAttackers, createGame, eraByYear, forecastFinance, forceTotals, gameOutcome,
  previewOrders, queueOrder, respondToTreaty, seasonOrderLimit, sendTreatyOffer,
} from "../dist/engine.js";
import { frontierAttackOpportunities } from "../dist/frontier.js";
import { agendaChoices, enableGrand } from "../dist/grand.js";
import { campaignQuote, reinforceGrandWing, reviseGrandSupply, saveGrandCampaign } from "../dist/grand-campaign.js";
import { packageQuote, proposePackage } from "../dist/grand-diplomacy.js";
import { configureGate, saveDistrict, saveGrandNational } from "../dist/grand-logistics.js";
import { enrichWorld } from "../dist/personnel.js";
import { concludePeace, peaceCriteria } from "../dist/polity.js";
import { saveSuccession } from "../dist/polity-governance.js";
import { proposeSettlement, settlementDraft } from "../dist/polity-settlements.js";
import { nationalRoster } from "../dist/roster.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { militaryView } from "../dist/war-intel.js";
import { objectives9, publishStrategy9 } from "../dist/strategy-nine.js";
import { publishReign, reignPolicy } from "../dist/reign.js";
import { charterLeague10 } from "../dist/reign-leagues.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const game = (year = 199, faction = "cao") => createGame(world, year, faction, { grand: true });
const rest = (state) => Object.fromEntries(Object.keys(state.factions).filter((key) => key !== state.player)
  .map((key) => [key, { source: "model", order: null, accord: null, politics: "", reason: "休整" }]));

function standingStrategy(state, partner) {
  if (!state.strategy9) return state;
  const { stability, concord } = objectives9(world, state);
  const next = publishStrategy9(world, state, {
    primary: { kind: "stability", key: stability[0].key },
    secondary: { kind: "concord", key: partner ?? concord[0].key },
    money: 42, grain: 48, manpower: 800, transport: 3, negotiate: true,
  });
  return next.reign ? publishReign(world, next, { ...reignPolicy(next), stateForm: "compact" }, { batch: true }) : next;
}

function restore(state) {
  const record = { state, selected: "luoyang" };
  const restored = readGameRecord(world, createSaveBackup(record));
  assert.deepEqual(restored, record);
  return restored.state;
}

const quarter = (state) => restore(advanceQuarter(world, state, rest(state)));
const finance = (state) => state.history.at(-1).finance;

function plannedBattle() {
  const state = game();
  state.cities.luoyang.troops = 6800;
  state.cities.changan.troops = 850;
  state.factions.cao.grain = 460;
  const wings = Object.fromEntries(["main", "support", "escort"].map((role, i) => {
    const officer = ["cao-1", "cao-2", "cao-roster-3"][i];
    state.stations[officer] = "luoyang";
    return [role, { officer, from: "luoyang", troops: [2900, 900, 550][i] }];
  }));
  const plan = { id: 1, name: "关中战役", target: "changan", depot: "luoyang", backup: "xu", retreat: "luoyang",
    floor: 450, grain: 150, recover: true, wings };
  return { state, plan };
}

test("all eight eras share the same 42 cities and a custom opening applies all three kinds of edits", () => {
  assert.deepEqual(world.scenarios.map(({ year }) => year).sort(), [184, 190, 199, 208, 219, 234, 262, 265]);
  for (const era of world.scenarios) assert.deepEqual(Object.keys(era.ownership).sort(), world.cities.map(({ key }) => key).sort());
  const opening = { title: "南线推演", owners: { changan: "cao" }, stocks: { cao: { treasury: 256, grain: 318 } }, stations: { "cao-1": "changan" } };
  const state = restore(createGame(world, 199, "cao", { grand: true, opening }));
  assert.equal(eraByYear(world, state).title, "南线推演");
  assert.equal(state.cities.changan.owner, "cao");
  assert.equal(state.stations["cao-1"], "changan");
  assert.equal(state.factions.cao.treasury, 256);
  assert.equal(state.factions.cao.grain, 318);
  assert.equal(quarter(state).turn, 1);
  assert.throws(() => createGame(world, 199, "cao", { grand: true, opening: { ...opening, stations: { "cao-1": "tianshui" } } }), /本势力辖城/);
});

test("2.0 opt-in preserves a 1.3 siege, its escort pact, and planned succession", () => {
  let old = createGame(world, 199, "cao", { war: true, polity: true });
  old.cities.luoyang.troops = 4100;
  old.cities.changan.troops = 1050;
  old.cities.changan.defense = 3;
  old = queueOrder(world, old, { type: "mobilize", from: "luoyang", to: "changan", officer: "cao-1", troops: 2600, stance: "siege" });
  old.treaties.push({ sides: ["cao", "ce"], kind: "alliance", expires: 4 });
  for (let i = 0; i < 2; i += 1) old = quarter(old);
  old = quarter(proposeSettlement(world, old, settlementDraft(old, "cao", "ce", "peace", { payment: 16 })));
  assert.ok(armyByOfficer(old, "cao-1").engagement);
  assert.equal(old.polity.deals[0].payment, 16);
  old = saveSuccession(world, eraByYear(world, old), old, { heir: "cao-0", regent: "cao-2" });
  const upgrade = restore(enableGrand(world, old));
  assert.deepEqual(Object.fromEntries(Object.entries(upgrade).filter(([key]) => key !== "grand")), old);
  const advanced = quarter(upgrade);
  assert.equal(advanced.turn, 4);
  assert.equal(finance(advanced).politics.out.treasury, 16);
});

test("national caps bound district development and physically move grain into a named depot", () => {
  let state = game();
  state = appoint(world, state, "luoyang", "governor", "cao-0");
  state = saveGrandNational(state, { treasury: 15, grain: 24, reserve: 35 });
  state = saveDistrict(world, state, "中原与淮北", { focus: "growth", treasury: 90, grain: 90, depot: "luoyang" });
  const estimate = forecastFinance(world, state);
  state = quarter(state);
  const ledger = finance(state);
  assert.deepEqual(ledger.grand, estimate.grand);
  assert.ok(state.grand.depots.luoyang > 0);
  assert.equal(state.cities.luoyang.farming, 1);
  assert.ok(ledger.grand.budget.treasury <= 15 && ledger.grand.budget.grain <= 24);
  assert.ok(ledger.grand.budget.grain >= state.grand.depots.luoyang);
});

test("three coordinated formations rally, encircle, fight and fund the recovery of an occupied city", () => {
  let { state, plan } = plannedBattle();
  const estimate = campaignQuote(world, state, { ...plan, status: "ready", lost: 0, note: null });
  assert.ok(estimate.ready, estimate.reason);
  assert.equal(estimate.wings.length, 3);
  state = saveGrandCampaign(world, state, plan);
  state = quarter(state);
  assert.equal(state.armies.filter(({ faction }) => faction === "cao").length, 3);
  assert.equal(armyByOfficer(state, plan.wings.escort.officer).phase, "hold");
  for (let i = 0; i < 8 && state.grand.campaigns[0].status !== "complete"; i += 1) state = quarter(state);
  assert.equal(state.cities.changan.owner, "cao");
  assert.equal(state.cities.changan.occupation, 0);
  assert.equal(state.grand.campaigns[0].status, "complete");
  assert.ok(state.war.timeline.some(({ event }) => event === "encircled"));
  assert.ok(state.history.some(({ finance }) => finance.grand.budget.treasury >= 6));
});

test("formation changes depot after the main road closes and withdraws if both supplies fail", () => {
  let { state, plan } = plannedBattle();
  state = quarter(saveGrandCampaign(world, state, plan));
  state.cities.luoyang.occupation = 2;
  state = quarter(state);
  assert.equal(armyByOfficer(state, plan.wings.main.officer).depot, "xu");
  assert.match(state.grand.campaigns[0].note, /备用粮仓/);
  for (let i = 0; i < 3; i += 1) {
    state.cities.luoyang.occupation = 2;
    state.cities.xu.occupation = 2;
    state = quarter(state);
  }
  assert.equal(state.cities.changan.owner, "ma");
  assert.ok(state.grand.campaigns[0].lost > 0);
  assert.ok(!armyByOfficer(state, plan.wings.main.officer) || armyByOfficer(state, plan.wings.main.officer).phase === "retreat");
});

test("revising field instructions and committing reserves move actual troops only once", () => {
  let { state, plan } = plannedBattle();
  state = quarter(saveGrandCampaign(world, state, plan));
  state = reviseGrandSupply(state, 1, { depot: "xu", backup: "luoyang", retreat: "xu", grain: 110, floor: 450 });
  state = reinforceGrandWing(state, 1, "main", 350);
  const before = state.cities.luoyang.troops;
  const unit = plan.wings.main.officer;
  state = quarter(state);
  assert.equal(armyByOfficer(state, unit).depot, "xu");
  assert.equal(armyByOfficer(state, unit).troops, plan.wings.main.troops + 350);
  assert.equal(state.cities.luoyang.troops, before - 350);
  assert.equal(state.grand.campaigns[0].aid, undefined);
  state = quarter(state);
  assert.equal(state.history.flatMap(({ entries }) => entries).filter(({ text }) => text.includes("获预备队")).length, 1);
});

test("approved clauses open a real guest military route and a captured gate can control traversal", () => {
  let state = game();
  const terms = { from: "cao", to: "ma", halt: true, treasury: 12, grain: 16, pass: true, city: null, joint: null };
  assert.equal(marchRoute(world, state, "cao", "luoyang", "nanzheng"), null);
  assert.ok(packageQuote(world, state, terms).ready);
  state = quarter(proposePackage(world, state, terms));
  assert.ok(state.grand.agreements.length);
  state = quarter(state);
  assert.deepEqual(finance(state).grand.out, { treasury: 12, grain: 16 });
  assert.equal(isHostile(state, "cao", "ma"), false);
  assert.deepEqual(marchRoute(world, state, "cao", "luoyang", "nanzheng"), ["luoyang", "changan", "tianshui", "nanzheng"]);
  const closed = configureGate({ ...state, player: "ma" }, "changan:luoyang", true);
  assert.deepEqual(marchRoute(world, closed, "cao", "luoyang", "nanzheng"), ["luoyang", "wan", "changan", "tianshui", "nanzheng"]);
  const severed = configureGate(closed, "changan:tianshui", true);
  assert.equal(marchRoute(world, severed, "cao", "luoyang", "nanzheng"), null);
  assert.ok(state.grand.receipts[0].clauses.every(({ ok }) => ok));
  assert.deepEqual(finance(quarter(state)).grand.out, { treasury: 0, grain: 0 });
});

test("one failed package clause does not charge the resource or cancel successful clauses", () => {
  let state = game();
  const terms = { from: "cao", to: "ma", halt: true, treasury: 150, grain: 0, pass: true, city: null, joint: null };
  state = quarter(proposePackage(world, state, { ...terms, treasury: 90 }));
  state.factions.cao.treasury = 0;
  state = quarter(state);
  const record = state.grand.receipts[0];
  assert.equal(record.clauses.find(({ key }) => key === "treasury").ok, false);
  assert.equal(record.clauses.find(({ key }) => key === "halt").ok, true);
  assert.equal(record.clauses.find(({ key }) => key === "pass").ok, true);
  assert.equal(finance(state).grand.out.treasury, 0);
  assert.equal(state.polity.lastBreach, state.turn);
});

test("a negotiated joint clause becomes an actual alliance obligation for the selected objective", () => {
  let state = game(208, "liu");
  state.treaties.push({ sides: ["han", "liu"], kind: "alliance", expires: 4 });
  const terms = { from: "liu", to: "han", halt: true, treasury: 0, grain: 0, pass: true, city: null, joint: "jiangling" };
  assert.ok(packageQuote(world, state, terms).ready);
  state = quarter(proposePackage(world, state, terms));
  state = quarter(state);
  const record = state.grand.receipts[0];
  assert.ok(record.clauses.find(({ key }) => key === "joint").ok);
  const joint = state.realm.accords.find(({ kind }) => kind === "joint");
  assert.equal(joint.signed, state.turn);
  assert.equal(joint.target, "jiangling");
  assert.equal(joint.coordination.duty, "assault");
});

test("rivals receive independent four-quarter model choices and invalid advice falls back", async () => {
  let state = game(190, "cao");
  for (let i = 0; i < 15; i += 1) state = quarter(state);
  const second = agendaChoices(world, state, "dong")[1];
  let valid = false;
  const models = { client: () => ({ decide: async ([, message]) => {
    if (!message.content.startsWith("董卓")) throw new Error("mock unavailable");
    valid = message.content.includes("方针 " + second.id);
    return { choice: "0", reason: "施行新方针", agenda: second.id };
  } }) };
  const proposals = await createPlanner({ models }).plan(world, state);
  assert.equal(valid, true);
  assert.equal(proposals.dong.agenda, second.id);
  assert.equal(proposals.jian.source, "fallback");
  state = restore(advanceQuarter(world, state, proposals));
  assert.equal(state.grand.agendas.dong.kind, second.kind);
  assert.equal(state.grand.agendas.dong.until - state.grand.agendas.dong.since, 4);
});

for (const [year, faction] of [[190, "cao"], [190, "dong"], [199, "cao"], [199, "lu"], [208, "cao"], [208, "liu"],
  [219, "liu"], [219, "wu"], [262, "wei"], [262, "shu"], [265, "jin"], [265, "wu"]]) {
  test(`${year} ${faction} plays 100 quarters or reaches its natural ending`, (context) => {
    let state = game(year, faction);
    while (state.turn < 100 && gameOutcome(state) === "ongoing") {
      const advice = seasonAdvice(world, militaryView(state)).find(({ order }) => order);
      if (advice) state = queueOrder(world, state, advice.order);
      state = restore(advanceQuarter(world, state));
      assert.equal(Object.keys(state.cities).length, 42);
    }
    assert.ok(state.turn === 100 || gameOutcome(state) !== "ongoing");
    context.diagnostic(state.turn + " quarters · " + gameOutcome(state));
  });
}

for (const [version, rules] of [["5.0", "sandtable"], ["6.0", "frontline"], ["7.0", "highCommand"], ["8.0", "dynasty"], ["9.0", "strategic"], ["10.0", "reign"]]) {
  test(`standard Cao opening reaches peaceful succession and completed diplomacy in ${version}`, () => {
    let state = standingStrategy(createGame(world, 199, "cao", { [rules]: true }), "yuan");
    state = saveSuccession(world, eraByYear(world, state), state, { heir: "cao-0", regent: "cao-1", abdicate: true });
    for (const to of ["yuan", "ce"]) state = proposePackage(world, state, {
      from: "cao", to, halt: true, pass: false, city: null, joint: null, grain: 0, treasury: 15,
    });
    while (state.turn < 56 && gameOutcome(state) === "ongoing" && !peaceCriteria(world, state).ready) {
      state = restore(advanceQuarter(world, state));
    }
    state = restore(concludePeace(world, state));
    assert.equal(state.scenarioEnding.kind, "peace");
  });

  test(`standard Liu Bei opening reaches the coalition ending in ${version}`, () => {
    let state = standingStrategy(createGame(world, 208, "liu", { [rules]: true }), "wu");
    const allies = ["wu", "han"];
    if (state.reign) state = charterLeague10(world, state, { target: "cao", invited: allies, passage: true, military: true, term: 12, dues: 2 });
    state = queueOrder(world, state, { type: "build", city: "jiangxia", project: "commerce" });
    while (state.turn < 45 && gameOutcome(state) === "ongoing" && !coalitionCriteria(world, eraByYear(world, state), state).ready) {
      const era = eraByYear(world, state);
      if (state.dynasty && treatyOptions(world, state, "cao").available && state.factions.liu.treasury > 65) {
        state = proposeDynastyTreaty(world, state, { to: "cao", seasons: 8, payment: 6, passage: false, defense: false, cede: null, post: null });
      }
      if (state.dynasty && state.turn >= 6) for (const to of allies) {
        if (!treatyOptions(world, state, to).available || state.factions.liu.treasury < 70) continue;
        state = proposeDynastyTreaty(world, state, { to, seasons: 12, payment: 3, passage: true, defense: true, cede: null, post: null });
      }
      if (state.incomingTreaty?.answer === null && !incomingTreatyBlock(state)) state = respondToTreaty(world, state, true);
      for (const item of state.realm.proposals.filter(({ to, answer }) => to === "liu" && answer === undefined)) {
        state = respondAccord(state, item.from, item.kind, allies.includes(item.from) || item.kind === "aid");
      }
      for (const ally of allies) {
        const trade = accordProposal(world, state, "liu", ally, "trade");
        if (quoteAccord(world, era, state, trade).accepted) state = proposeAccord(world, era, state, trade);
        if (quoteTreaty(world, state, ally, "alliance").accepted) state = sendTreatyOffer(world, state, ally, "alliance");
      }
      state = restore(advanceQuarter(world, state));
    }
    const criteria = coalitionCriteria(world, eraByYear(world, state), state);
    assert.ok(criteria.ready, JSON.stringify({ criteria, stock: state.factions.liu, outcome: gameOutcome(state) }));
    assert.equal(restore(concludeCoalition(world, state)).scenarioEnding.kind, "coalition");
  });

  test(`standard Jin opening can unify all 42 cities in ${version}`, () => {
    let state = standingStrategy(createGame(world, 265, "jin", { [rules]: true }));
    while (gameOutcome(state) === "ongoing" && state.turn < 70) {
      const era = eraByYear(world, state);
      for (let i = 0; i < seasonOrderLimit; i += 1) {
        const planned = previewOrders(world, state);
        const order = frontierAttackOpportunities(world, state, planned).entries[0]?.order;
        if (order) { state = queueOrder(world, state, order); continue; }
        const target = world.cities.find(({ key, links }) => planned.cities[key].owner === "jin" && planned.cities[key].troops < 4500
          && links.some((link) => planned.cities[link].owner !== "jin"));
        if (!target) break;
        if (!availableAttackers(era, planned, "jin", target.key).length && !state.cities[target.key].commander) {
          const candidate = nationalRoster(world, state, { status: "available", sort: "command", query: "" }).matching[0];
          if (candidate) state = appoint(world, state, target.key, "commander", candidate.person.key);
        }
        if (planned.factions.jin.treasury < 20 || planned.factions.jin.grain < 12 || planned.realm.cities[target.key].population < 1400) break;
        state = queueOrder(world, state, { type: "recruit", city: target.key });
      }
      state = restore(advanceQuarter(world, state));
    }
    assert.equal(forceTotals(state, "jin").cities, 42);
    assert.equal(gameOutcome(state), "victory");
  });
}
