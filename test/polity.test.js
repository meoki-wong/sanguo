import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { accordProposal, coalitionCriteria, proposeAccord, quoteAccord, respondAccord } from "../dist/accords.js";
import { seasonAdvice } from "../dist/advice.js";
import { armyByOfficer } from "../dist/armies.js";
import { campaignEvent, answerCampaignEvent } from "../dist/campaign.js";
import { incomingTreatyBlock, isHostile, quoteTreaty } from "../dist/diplomacy.js";
import { concludeCoalition } from "../dist/endgame.js";
import {
  advanceQuarter, appoint, availableAttackers, createGame, delegateCities, delegationZones, eraByYear, forceTotals, forecastFinance,
  gameOutcome, previewOrders, queueOrder, respondToTreaty, seasonOrderLimit, sendTreatyOffer, setNationalPolicy,
} from "../dist/engine.js";
import { frontierAttackOpportunities } from "../dist/frontier.js";
import { enrichWorld } from "../dist/personnel.js";
import { territoryAt } from "../dist/polities-data.js";
import { answerEdict, concludePeace, currentEdict, enablePolity, peaceCriteria, politicalChoices } from "../dist/polity.js";
import { courtCandidates, courtFor, provinceRows, saveProvincePolicy, saveSuccession } from "../dist/polity-governance.js";
import { proposeSettlement, respondSettlement, settlementDraft, settlementTerms } from "../dist/polity-settlements.js";
import { officerProfile, nationalRoster } from "../dist/roster.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { militaryView } from "../dist/war-intel.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const game = (year = 199, faction = "cao") => createGame(world, year, faction, { war: true, realm: true, polity: true });
const politics = (state) => state.history.at(-1).finance.politics;
const region = "中原与淮北";
const rest = (state) => Object.fromEntries(Object.keys(state.factions).filter((key) => key !== state.player)
  .map((key) => [key, { source: "model", order: null, reason: "休整", accord: null, politics: "" }]));

function restore(state) {
  const selected = "luoyang";
  const result = readGameRecord(world, createSaveBackup({ state, selected }));
  assert.deepEqual(result, { state, selected });
  return result.state;
}

const quiet = (state) => restore(advanceQuarter(world, state, rest(state)));

function poorHeartland(state) {
  for (const key of ["luoyang", "puyang", "wan", "chenliu", "xiapi", "xiaopei", "shouchun", "runan"]) {
    state.realm.cities[key].welfare = 16;
    state.cities[key].troops = 400;
  }
  state.realm.policy.relief = 0;
}

test("1.2 saves opt in while retaining live military, diplomacy and queued orders", () => {
  let old = createGame(world, 199, "cao", { war: true, realm: true });
  old.cities.luoyang.troops = 4100;
  Object.assign(old.cities.changan, { troops: 950, defense: 3 });
  old = queueOrder(world, old, { type: "build", city: "xu", project: "farming" });
  old = queueOrder(world, old, { type: "mobilize", officer: "cao-1", from: "luoyang", to: "changan", troops: 2700, grain: 70, stance: "siege" });
  old.treaties.push({ sides: ["cao", "ce"], kind: "alliance", expires: 4 });
  old = quiet(old);
  assert.ok(old.armies?.some(({ phase }) => phase === "muster" || phase === "march"));
  for (let index = 0; index < 2; index += 1) old = quiet(old);
  assert.ok(armyByOfficer(old, "cao-1").engagement?.quarters > 0);
  assert.ok(old.treaties.length);
  old = queueOrder(world, old, { type: "build", city: "xu", project: "commerce" });
  const next = restore(enablePolity(world, old));
  const { polity, ...preserved } = next;
  assert.deepEqual(preserved, old);
  assert.equal(polity.atlas[0].turn, old.turn);
  assert.equal(Object.keys(territoryAt(world, next, old.turn)).length, 42);
  assert.equal(quiet(next).turn, old.turn + 1);
});

test("upgrading a signed 1.2 coordinated attack preserves its existing arrival window", () => {
  let state = createGame(world, 208, "liu", { war: true, realm: true });
  const era = eraByYear(world, state);
  state.treaties.push({ sides: ["han", "liu"], kind: "alliance", expires: 4 });
  const pact = accordProposal(world, state, "liu", "han", "joint", "jiangling", undefined, { offset: 1, duty: "assault" });
  const quote = quoteAccord(world, era, state, pact);
  assert.equal(quote.accepted, true, JSON.stringify(quote));
  state = quiet(proposeAccord(world, era, state, pact));
  const signed = state.realm.accords.find(({ kind }) => kind === "joint");
  assert.ok(signed?.coordination);
  const upgraded = restore(enablePolity(world, state));
  assert.deepEqual(upgraded.realm.accords.find(({ kind }) => kind === "joint"), signed);
});

test("domestic neglect is warned, develops into crisis, and recovers with funded provincial relief", () => {
  let state = game();
  while (!provinceRows(world, state).find((row) => row.region === region).crisis && state.turn < 10) {
    poorHeartland(state);
    state = quiet(state);
  }
  const status = state.polity.provinces["cao:" + region];
  assert.ok(status.crisis && status.crisis >= status.warning + 2);
  state = saveProvincePolicy(world, state, region, { focus: "relief", treasury: 55, grain: 85 });
  const forecast = forecastFinance(world, state).politics.budget;
  state = quiet(state);
  assert.deepEqual(politics(state).budget, forecast);
  assert.ok(forecast.treasury > 0 && forecast.grain > 0);
  for (let step = 0; step < 9; step += 1) state = quiet(state);
  assert.equal(state.polity.parties.length, 0);
  assert.ok(state.polity.history.some(({ event }) => event === "recovered"));
  assert.equal(state.polity.provinces["cao:" + region].crisis, null);
});

test("secession creates an independent model actor, then protection and voluntary union transfer the state", async () => {
  let state = game();
  state = appoint(world, state, "luoyang", "governor", "cao-0");
  state = quiet(state);
  state.stations["cao-1"] = null;
  state.armies = [{ faction: "cao", officer: "cao-1", location: "xiapi", depot: "xiapi", target: "xiapi", route: ["xiapi"],
    phase: "hold", prepared: true, troops: 850, grain: 40, assembledAt: 0 }];
  while (!state.polity.parties.length && state.turn < 12) { poorHeartland(state); state = quiet(state); }
  const [party] = state.polity.parties;
  assert.ok(party);
  const { key, city, turn } = party;
  const take = Object.keys(state.cities).filter((site) => state.cities[site].owner === key);
  assert.ok(take.length >= 1);
  assert.equal(territoryAt(world, state, turn - 1)[city], "cao");
  assert.equal(territoryAt(world, state, turn)[city], key);
  assert.equal(courtFor(state, key).head, party.leader);
  assert.ok(politics(state).out.treasury > 0);
  assert.equal(armyByOfficer(state, "cao-1")?.faction, key);
  assert.ok(eraByYear(world, state).officers.some(({ key: person, faction }) => person !== party.leader && faction === key));
  const consulted = [];
  const models = { client: () => ({ decide: async () => { throw new Error("isolated model unavailable"); } }) };
  const planner = createPlanner({ models });
  await planner.plan(world, state, (faction, source) => consulted.push({ faction, source }));
  assert.ok(consulted.some(({ faction, source }) => faction === key && source === "fallback"));
  const delegated = structuredClone(state);
  delegated.polity.courts[key].due = delegated.turn + 1;
  const option = politicalChoices(world, eraByYear(world, delegated), delegated, key)
    .find(({ directive }) => directive.type === "succession");
  assert.ok(option);
  const provider = { client: () => ({ decide: async ([, prompt]) => {
    if (!prompt.content.startsWith(party.name)) throw new Error("isolated model unavailable");
    assert.ok(prompt.content.includes("朝局 " + option.id));
    return { choice: "0", reason: "安排继任", politics: option.id };
  } }) };
  const proposals = await createPlanner({ models: provider }).plan(world, delegated);
  assert.equal(proposals[key].source, "model");
  assert.equal(proposals[key].politics, option.id);
  const selected = restore(advanceQuarter(world, delegated, { ...rest(delegated), [key]: proposals[key] }));
  assert.equal(courtFor(selected, key).head, option.directive.heir);
  const protection = settlementDraft(state, "cao", key, "protection", { ward: key });
  state = quiet(proposeSettlement(world, state, protection));
  assert.equal(state.polity.deals.length, 1);
  state = quiet(state);
  assert.equal(isHostile(state, "cao", key), false);
  assert.ok(take.every((site) => state.cities[site].owner === key));
  assert.equal(settlementTerms(world, state, settlementDraft(state, "cao", key, "union", { ward: key })).possible, false);
  for (const site of take) {
    state.realm.cities[site].welfare = 75;
    state.cities[site].troops = 1350;
  }
  while (state.polity.protections[0]?.good < 6 && state.turn < turn + 12) state = quiet(state);
  const union = settlementDraft(state, "cao", key, "union", { ward: key });
  state = quiet(proposeSettlement(world, state, union));
  assert.ok(state.factions[key].treasury > 0 && state.factions[key].grain > 0);
  const withoutUnion = structuredClone(state);
  withoutUnion.polity.deals = [];
  const funds = quiet(withoutUnion).factions[key];
  const receipt = forecastFinance(world, state).politics.in;
  assert.deepEqual(receipt, { grain: state.factions[key].grain, treasury: state.factions[key].treasury });
  state = quiet(state);
  assert.ok(take.every((site) => state.cities[site].owner === "cao"));
  assert.equal(state.factions[key].treasury, 0);
  assert.equal(state.factions[key].grain, 0);
  assert.deepEqual(politics(state).in, { grain: funds.grain, treasury: funds.treasury });
  assert.equal(state.polity.protections.length, 0);
  assert.ok(state.polity.history.some(({ event }) => event === "protection-ended"));
  assert.ok(officerProfile(world, state, party.leader).timeline.some(({ type, text }) => type === "polity" && text.includes("转仕")));
});

test("signed peace returns former territory, moves actual treasury once, and records breach if funds turn unavailable", () => {
  const opening = game();
  opening.cities.changan.owner = "cao";
  opening.cities.changan.governor = null;
  opening.cities.changan.commander = null;
  for (const [person, city] of Object.entries(opening.stations)) {
    if (city === "changan") opening.stations[person] = "tianshui";
  }
  let state = quiet(opening);
  const draft = settlementDraft(state, "cao", "ma", "peace", { payment: 160, city: "changan" });
  assert.equal(settlementTerms(world, state, { ...draft, city: "xu" }).possible, false);
  const signed = quiet(proposeSettlement(world, state, draft));
  assert.equal(signed.polity.deals.length, 1);
  assert.equal(forecastFinance(world, signed).politics.out.treasury, 160);
  state = quiet(signed);
  assert.equal(state.cities.changan.owner, "ma");
  assert.equal(politics(state).out.treasury, 160);
  assert.equal(isHostile(state, "cao", "ma"), false);
  assert.equal(politics(quiet(state)).out.treasury, 0);
  assert.equal(state.polity.peaceDeals, 1);
  signed.factions.cao.treasury = 0;
  const broke = quiet(signed);
  assert.equal(broke.cities.changan.owner, "cao");
  assert.equal(broke.polity.lastBreach, broke.turn);
  assert.equal(broke.polity.peaceDeals, 0);
  assert.ok(broke.polity.history.some(({ event }) => event === "breach"));
});

test("a named regent preserves the administration and an accepted heir can follow", () => {
  let state = game();
  const era = eraByYear(world, state);
  const [heir, regent] = courtCandidates(era, state).filter(({ key }) => key !== courtFor(state, state.player).head);
  state = saveSuccession(world, era, state, { heir: heir.key, regent: regent.key, abdicate: true });
  state.factions.cao.morale = 12;
  state.polity.provinces["cao:" + region] = { pressure: 42, warning: null, crisis: null };
  state = quiet(state);
  assert.equal(courtFor(state, "cao").last.result, "regency");
  assert.equal(courtFor(state, "cao").head, regent.key);
  assert.equal(courtFor(state, "cao").due, state.turn + 4);
  state.factions.cao.morale = 85;
  for (let step = 0; step < 4; step += 1) state = quiet(state);
  assert.equal(courtFor(state, "cao").head, heir.key);
  assert.equal(courtFor(state, "cao").successions, 1);
  assert.ok(officerProfile(world, state, heir.key).timeline.some(({ type }) => type === "polity"));
});

for (const [year, faction] of [[199, "cao"], [199, "lu"], [208, "cao"], [208, "liu"], [262, "wei"], [262, "shu"], [265, "jin"], [265, "wu"]]) {
  test(`${year} ${faction} survives 60 quarterly turns with original rules opponents and saves`, (t) => {
    let state = game(year, faction);
    const initial = forceTotals(state, faction).cities;
    const front = delegationZones(world, state).front.slice(0, 2);
    state = delegateCities(world, state, front, year === 199 ? "farming" : "defense", 22);
    if (initial > 4) state = setNationalPolicy(state, { front: { focus: "defense", budget: 24, garrison: 2300 },
      rear: { focus: "auto", budget: 20, garrison: 900 } });
    for (let turn = 0; turn < 60; turn += 1) {
      const era = eraByYear(world, state);
      if (faction === "lu") {
        if (state.incomingTreaty?.answer === null && !incomingTreatyBlock(state)) state = respondToTreaty(world, state, true);
        for (const item of state.realm.proposals.filter(({ to, answer }) => to === faction && answer === undefined)) {
          state = respondAccord(state, item.from, item.kind, item.kind !== "joint");
        }
        for (const { id, to, kind } of state.polity.offers) if (to === faction) state = respondSettlement(state, id, kind !== "union");
        const neighbors = new Set(world.cities.filter(({ key }) => state.cities[key].owner === faction)
          .flatMap(({ links }) => links.map((city) => state.cities[city].owner)).filter((owner) => owner !== faction));
        for (const to of neighbors) {
          const trade = accordProposal(world, state, faction, to, "trade");
          if (quoteAccord(world, era, state, trade).accepted) state = proposeAccord(world, era, state, trade);
          for (const kind of ["alliance", "truce"]) {
            if (!quoteTreaty(world, state, to, kind).accepted) continue;
            state = sendTreatyOffer(world, state, to, kind);
            break;
          }
        }
      }
      const event = campaignEvent(world, era, state);
      if (event) state = answerCampaignEvent(world, era, state, event.available && state.campaignEvents.pending.kind !== "succession");
      const advice = seasonAdvice(world, militaryView(state)).find(({ order }) => order);
      if (advice) state = queueOrder(world, state, advice.order);
      state = restore(advanceQuarter(world, state));
      assert.equal(state.turn, turn + 1);
      assert.equal(Object.keys(state.cities).length, 42);
      assert.equal(gameOutcome(state), "ongoing", year + " " + faction + " · " + state.turn);
    }
    t.diagnostic(`${initial} → ${forceTotals(state, faction).cities} cities, ${state.polity.atlas.length} map frames`);
  });
}

test("the peace ending is reachable from a normal opening through diplomacy, succession and stability", () => {
  let state = game();
  const era = eraByYear(world, state);
  const [heir] = courtCandidates(era, state).filter(({ key }) => key !== courtFor(state, "cao").head);
  state = saveSuccession(world, era, state, { heir: heir.key, regent: null, abdicate: true });
  let approved = false;
  for (const to of ["yuan", "ce"]) state = proposeSettlement(world, state, settlementDraft(state, "cao", to, "peace", { payment: 15 }));
  while (state.turn < 55 && !peaceCriteria(world, state).ready) {
    const edict = currentEdict(world, state);
    if (edict && edict.answer === undefined && edict.available) {
      state = answerEdict(world, state, true);
      approved = true;
    }
    for (const { id, to, kind } of state.polity.offers) if (to === state.player) state = respondSettlement(state, id, kind === "peace");
    const waiting = provinceRows(world, state).find(({ danger, policy }) => !policy && danger >= 30);
    if (waiting) state = saveProvincePolicy(world, state, waiting.region, { focus: "relief", treasury: 36, grain: 54 });
    state = advanceQuarter(world, state);
  }
  assert.ok(approved);
  assert.ok(peaceCriteria(world, state).ready, JSON.stringify(peaceCriteria(world, state)));
  state = restore(concludePeace(world, state));
  assert.equal(gameOutcome(state), "victory");
  assert.equal(state.scenarioEnding.kind, "peace");
  assert.ok(forceTotals(state, "cao").cities < 42);
});

test("the 1.3 rules preserve Liu Bei's viable coalition route", () => {
  let state = game(208, "liu");
  const allies = ["wu", "han"];
  state = queueOrder(world, state, { type: "build", city: "jiangxia", project: "commerce" });
  while (state.turn < 45 && !coalitionCriteria(world, eraByYear(world, state), state).ready) {
    const era = eraByYear(world, state);
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
  const result = restore(concludeCoalition(world, state));
  assert.equal(gameOutcome(result), "victory");
  assert.equal(result.scenarioEnding.kind, "coalition");
});

test("the 1.3 rules preserve the 42-city victory from the regular Jin opening", () => {
  let state = game(265, "jin");
  while (gameOutcome(state) === "ongoing" && state.turn < 70) {
    const era = eraByYear(world, state);
    for (let slot = 0; slot < seasonOrderLimit; slot += 1) {
      const planned = previewOrders(world, state);
      const attacks = frontierAttackOpportunities(world, state, planned).entries;
      if (attacks.length) { state = queueOrder(world, state, attacks[0].order); continue; }
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
