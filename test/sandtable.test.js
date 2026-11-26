import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { mobilizeArmy } from "../dist/armies.js";
import { treatyWith } from "../dist/diplomacy.js";
import { advanceQuarter, availableAttackers, createGame, eraByYear, forceTotals, gameOutcome, queueOrder } from "../dist/engine.js";
import { openRoadEdge } from "../dist/grand-logistics.js";
import { answerCongressInvitation, proposeCongressFor } from "../dist/landscape-treaty.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { enableSandtable, interruption } from "../dist/sandtable.js";
import { saveIndustry, workforceYield } from "../dist/sandtable-economy.js";
import { branchChoices, continueAs, orderRegimeResponse } from "../dist/sandtable-politics.js";
import { postOwner, queuePostOrder, strategicPost, strategicPosts } from "../dist/sandtable-posts.js";
import { declareWar, diplomaticManeuvers, offerPeace, warTargets } from "../dist/sandtable-war.js";
import { saveStatecraftPolicy } from "../dist/statecraft.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const create = (year = 199, player = "cao") => createGame(world, year, player, { sandtable: true });

function backup(state) {
  const selected = "luoyang";
  const restored = readGameRecord(world, createSaveBackup({ state, selected }));
  assert.deepEqual(restored.state, state);
  return restored.state;
}

function quarter(state, proposals = {}) {
  return backup(advanceQuarter(world, state, proposals));
}

test("from the actual Cao opening a corridor war changes road control and concludes with paid passage and withdrawal", () => {
  const key = "changan:luoyang";
  const site = strategicPost(key);
  assert.ok(strategicPosts.every((post) => world.cities.find(({ key }) => key === post.seat).links.includes(post.to)));
  assert.equal(new Set(strategicPosts.map(({ kind }) => kind)).size, 5);
  let state = create();
  assert.equal(postOwner(state, site), "ma");
  state = declareWar(world, state, { goal: "corridor", target: key, auto: true });
  for (let q = 0; q < 4 && postOwner(state, site) !== "cao"; q++) state = quarter(state);
  assert.equal(postOwner(state, site), "cao");
  assert.equal(state.cities.changan.owner, "ma");
  assert.equal(state.sandtable.wars[0].phase, "consolidate");
  assert.equal(openRoadEdge(state, "ma", "changan", "luoyang"), false);
  assert.ok(state.sandtable.journal.some(({ news }) => news.some(({ post }) => post === key)));
  state = offerPeace(state, 1, { kind: "passage", payment: 12 });
  state = quarter(state);
  assert.equal(state.sandtable.wars[0].status, "ended");
  assert.equal(state.sandtable.wars[0].receipt.kind, "passage");
  assert.match(state.sandtable.wars[0].receipt.detail, /停止进攻/);
  assert.equal(state.history.at(-1).finance.sandtable.out.treasury, 12);
  assert.equal(treatyWith(state, "ma", "cao").kind, "truce");
  assert.equal(openRoadEdge(state, "ma", "changan", "luoyang"), true);

  const old = state.sandtable.posts[key].troops;
  state = queuePostOrder(state, key, { kind: "garrison", city: "luoyang" });
  state = quarter(state);
  assert.equal(state.sandtable.posts[key].troops, old + 250);
});

test("recruitment reduces available labor; assigned regions create actual stock and pay freight from the national ledger", () => {
  let state = create();
  const region = world.cities.find(({ key }) => key === "xu").region;
  const second = world.cities.find(({ key }) => key === "luoyang").region;
  state.factions.cao.treasury = 400;
  state.factions.cao.grain = 250;
  state = saveIndustry(world, state, { mode: "urgent", budget: 65, reserve: 20, region, role: "industry" });
  if (region !== second) state = saveIndustry(world, state, { mode: "urgent", budget: 65, reserve: 20, region: second, role: "farms" });
  const initial = forceTotals(state, "cao").grain;
  state = queueOrder(world, state, { type: "recruit", city: "xu" });
  state = quarter(state);
  assert.ok(state.sandtable.labor.xu >= 400);
  assert.ok(workforceYield(state, "xu") < 1);
  assert.ok(forceTotals(state, "cao").grain < initial);
  assert.ok(Object.values(state.landscape.equipment).some((stock) => stock > 14));
  assert.ok(state.history.at(-1).finance.sandtable.budget.treasury >= 8);
  assert.ok(state.sandtable.journal.at(-1).news.some(({ text }) => text.includes("制械")));
});

function mutinySetup() {
  const state = create();
  state.factions.cao.morale = 24;
  state.delegationReserve = { treasury: 0, grain: 1200 };
  state.cities.luoyang.troops = 4800;
  state.stations["cao-1"] = "luoyang";
  mobilizeArmy(world, state, "cao", { from: "luoyang", to: "changan", officer: "cao-1", troops: 1800, stance: "siege" });
  Object.assign(state.armies[0], { opening: true, phase: "hold", prepared: true, grain: 0 });
  return state;
}

test("a military warning interrupts a multi-quarter order; it can be resolved or lead to a new playable regime", () => {
  const before = mutinySetup();
  const first = quarter(before);
  assert.ok(first.sandtable.unrest["cao-1"]);
  assert.match(interruption(before, first), /军团缺粮离心/);
  const secured = quarter(orderRegimeResponse(first, "cao-1", "pardon"));
  assert.equal(secured.sandtable.unrest["cao-1"], undefined);
  assert.ok(secured.history.at(-1).finance.sandtable.budget.treasury > 0);
  let revolt = quarter(quarter(first));
  const side = branchChoices(revolt).find(({ cause }) => cause === "mutiny");
  assert.ok(side);
  assert.equal(revolt.cities.luoyang.owner, side.key);
  assert.equal(eraByYear(world, revolt).officers.find(({ key }) => key === "cao-1").faction, side.key);
  const branch = backup(continueAs(world, revolt, side.key));
  assert.equal(branch.player, side.key);
  assert.equal(branch.history[0].viewer, "cao");
  assert.equal(revolt.player, "cao");
  revolt = quarter(branch);
  assert.equal(revolt.player, side.key);
  assert.equal(revolt.sandtable.branches.at(-1).previous, "cao");
});

test("a 4.0 authorization carries over; invitations from rival rulers require a real player vote", () => {
  const original = saveStatecraftPolicy(createGame(world, 199, "cao", { statecraft: true }), {
    profile: "growth", personnel: "search", development: 60, military: 35, relief: 30, reserveMoney: 20, reserveGrain: 25,
  });
  const seeded = backup(enableSandtable(original));
  const { sandtable, ...earlier } = seeded;
  assert.deepEqual(earlier, original);
  assert.equal(sandtable.since, original.turn);
  const open = proposeCongressFor(seeded, "yuan", { guests: ["cao", "ce"], target: "changan", duration: 4, border: true, market: true,
    aid: 0, returnTo: null, beneficiary: null });
  const waiting = quarter(open);
  assert.equal(waiting.landscape.congresses[0].votes.cao, undefined);
  assert.equal(waiting.landscape.congresses[0].status, "voting");
  assert.match(interruption(open, waiting), /会盟/);
  const ratified = quarter(answerCongressInvitation(waiting, 1, "yes"));
  assert.equal(ratified.landscape.congresses[0].status, "active");
});

test("the external planner only receives legal strategic candidates for its own faction", async () => {
  const state = create();
  state.turn = 13;
  state.factions.ce.grain = 300;
  state.factions.ce.treasury = 300;
  const candidate = diplomaticManeuvers(world, state, "ce").find(({ kind }) => kind === "war");
  assert.ok(candidate);
  const models = { client: () => ({ decide: async ([, input]) => ({
    choice: "0", reason: "守住通路", strategic: input.content.startsWith("孙策") ? candidate.id : "非法议案",
  }) }) };
  const proposals = await createPlanner({ models }).plan(world, state);
  assert.equal(proposals.ce.strategic, candidate.id);
  assert.ok(Object.keys(proposals).filter((key) => key !== "ce").every((key) => !proposals[key].strategic));
});

test("regional wars have connected objectives and city restitution moves the garrison and title", () => {
  let state = create();
  state.cities.luoyang.troops = 5900;
  state.cities.changan.troops = 500;
  state.stations["cao-1"] = "luoyang";
  state = declareWar(world, state, { goal: "region", target: "changan", auto: false });
  assert.ok(state.sandtable.wars[0].objectives.length >= 2);
  const general = availableAttackers(eraByYear(world, state), state, "cao", "luoyang").find(({ key }) => key === "cao-1");
  state = quarter(queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan",
    troops: 3300, officer: general.key }));
  assert.equal(state.cities.changan.owner, "cao");
  assert.ok(state.sandtable.wars[0].score < 75);
  state = quarter(offerPeace(state, 1, { kind: "return", payment: 0 }));
  assert.equal(state.sandtable.wars[0].receipt.kind, "return");
  assert.equal(state.cities.changan.owner, "ma");
  assert.equal(state.cities.changan.troops, 250);
});

test("an allied relief war sends real reserves to the besieged ally and records the ward", () => {
  let state = createGame(world, 208, "liu", { sandtable: true, opening: {
    title: "荆江解围", owners: { lujiang: "cao" }, stocks: {}, stations: {},
  } });
  state.treaties.push({ sides: ["liu", "wu"], kind: "alliance", expires: 4 });
  state.cities.jiangxia.troops = 2900;
  const general = eraByYear(world, state).officers.find(({ faction, reserve }) => faction === "cao" && !reserve);
  for (const holding of Object.values(state.cities)) {
    if (holding.governor === general.key) holding.governor = null;
    if (holding.commander === general.key) holding.commander = null;
  }
  state.stations[general.key] = "lujiang";
  mobilizeArmy(world, state, "cao", { from: "lujiang", to: "chaisang", officer: general.key, troops: 700, stance: "siege" });
  Object.assign(state.armies[0], { opening: true, prepared: true, phase: "march",
    engagement: { owner: "wu", quarters: 1, progress: 10, defenders: state.cities.chaisang.troops } });
  assert.equal(warTargets(world, state, "liu", "relief").find(({ key }) => key === "chaisang").ward, "wu");
  state = quarter(declareWar(world, state, { goal: "relief", target: "chaisang", auto: true }));
  assert.ok(state.history.at(-1).entries.some(({ text }) => text.includes("向柴桑增援 550 人")));
  assert.equal(state.sandtable.wars[0].ward, "wu");
});

for (const [year, players] of [[184, ["han", "yellow"]], [190, ["cao", "dong"]], [199, ["cao", "lu"]], [208, ["cao", "liu"]],
  [219, ["liu", "wu"]], [234, ["wei", "shu"]], [262, ["wei", "shu"]], [265, ["jin", "wu"]]]) {
  for (const player of players) test(`5.0 ${year} ${player} plays to 100 seasons or a natural ending`, (context) => {
    let state = create(year, player);
    while (state.turn < 100 && gameOutcome(state) === "ongoing") {
      state = quarter(state);
      assert.equal(Object.keys(state.cities).length, 44);
    }
    assert.ok(state.turn === 100 || gameOutcome(state) !== "ongoing");
    context.diagnostic(state.turn + " seasons · " + gameOutcome(state));
  });
}
