import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { commandArmy, mobilizeArmy } from "../dist/armies.js";
import { advanceQuarter, availableAttackers, createGame, eraByYear, forecastFinance, gameOutcome, queueOrder, setGovernance } from "../dist/engine.js";
import { saveFront } from "../dist/front-command.js";
import { proposePackage } from "../dist/grand-diplomacy.js";
import { allianceDuties, conferencePass, leaveCongress, proposeCongress } from "../dist/landscape-treaty.js";
import { prepareConvoy } from "../dist/landscape-economy.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { enableStatecraft, saveRegionalMandate, saveStatecraftPolicy } from "../dist/statecraft.js";
import { eligibleApproaches, inviteOfficer, orderCrisisResponse } from "../dist/statecraft-personnel.js";
import { provinceRows } from "../dist/polity-governance.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const game = (year = 199, player = "cao", extra = {}) => createGame(world, year, player, { statecraft: true, ...extra });
const fiscal = { profile: "growth", personnel: "search", development: 65, military: 35, relief: 30, reserveMoney: 24, reserveGrain: 30 };

function roundTrip(state) {
  const record = { selected: "luoyang", state };
  const reread = readGameRecord(world, createSaveBackup(record));
  assert.deepEqual(reread, record);
  return reread.state;
}

function quarter(state) {
  const instructions = Object.fromEntries(Object.keys(state.factions).filter((key) => key !== state.player)
    .map((key) => [key, { source: "model", order: null, accord: null, politics: "", reason: "休整" }]));
  return roundTrip(advanceQuarter(world, state, instructions));
}

function front(state, mission = "siege", target = "changan", overrides = {}) {
  return saveFront(world, state, { id: 1, mission, target, troops: 2300, grain: 70, floor: 450, auto: true, officer: null, ...overrides });
}

test("a single national mandate fills vacancies, protects city overrides, and performs local programs within cash limits", () => {
  let state = saveStatecraftPolicy(game(), fiscal);
  state = setGovernance(state, "luoyang", "direct", "defense", null);
  const region = world.cities.find(({ key }) => key === "xu").region;
  state = saveRegionalMandate(world, state, region, { focus: "growth", budget: 30, floor: 800, officer: null });
  const forecast = forecastFinance(world, state, { includeProgramActions: true });
  assert.ok(forecast.programs.length > 2);
  state = quarter(state);
  assert.equal(state.cities.luoyang.mode, "direct");
  assert.ok(Object.values(state.cities).some(({ governor, mode, owner }) => owner === "cao" && governor && mode === "delegated"));
  assert.equal(state.orders.length, 0);
  for (let turn = state.turn; turn < 10; turn++) state = quarter(state);
  assert.ok(state.recruitedOfficers?.length > 0);
  assert.ok(state.history.some(({ entries }) => entries.some(({ text }) => text.includes("访才令招揽"))));
});

test("appointing an envoy to approach a rival changes in-game service and charges only a successful offer", () => {
  let state = game();
  const prospect = eligibleApproaches(world, state)[0];
  assert.ok(prospect);
  state.statecraft.loyalty[prospect.key] = { value: 31, warning: null };
  state = inviteOfficer(world, state, prospect.key);
  state = quarter(state);
  assert.equal(eraByYear(world, state).officers.find(({ key }) => key === prospect.key).faction, "cao");
  assert.equal(state.history.at(-1).finance.statecraft.budget.treasury, 42);
  assert.equal(state.statecraft.invite, null);
  assert.equal(state.cities[state.stations[prospect.key]].owner, "cao");
});

function crisis() {
  let state = game();
  for (let k = 0; k < 4; k++) state = quarter(state);
  const city = "luoyang";
  const region = world.cities.find(({ key }) => key === city).region;
  const row = provinceRows(world, state).find((row) => row.region === region);
  state.polity.provinces[row.key] = { pressure: 100, warning: 1, crisis: 2 };
  state.realm.cities[city].welfare = 12;
  state.cities[city].troops = 450;
  return { state, region, city };
}

test("an ignored regional crisis can create a new force, while provincial relief has a real cost and lowers pressure", () => {
  const { state, region, city } = crisis();
  const revolt = quarter(state);
  const owner = revolt.cities[city].owner;
  assert.match(owner, /^spl-/);
  assert.ok(revolt.polity.history.some(({ event }) => event === "uprising"));
  assert.ok(eraByYear(world, revolt).factions.some(({ key }) => key === owner));
  const relieved = quarter(orderCrisisResponse(world, state, region, "relief"));
  assert.equal(relieved.cities[city].owner, "cao");
  assert.equal(relieved.history.at(-1).finance.statecraft.budget.grain, 16);
  assert.ok(relieved.realm.cities[city].welfare > state.realm.cities[city].welfare);
});

test("a disloyal regional governor can declare independence, while an individual defector changes service without transferring the city", () => {
  const { state, city } = crisis();
  const officer = "cao-1";
  state.stations[officer] = city;
  state.cities[city].governor = officer;
  state.statecraft.loyalty[officer] = { value: 35, warning: 3 };
  const separatist = quarter(state);
  assert.ok(separatist.polity.history.some(({ event, officer: actor }) => event === "independence" && actor === officer));
  assert.equal(eraByYear(world, separatist).officers.find(({ key }) => key === officer).faction, separatist.cities[city].owner);

  const losing = structuredClone(state);
  losing.polity.provinces = {};
  losing.statecraft.loyalty[officer] = { value: 8, warning: 2 };
  const defection = quarter(losing);
  assert.equal(defection.cities[city].owner, "cao");
  assert.equal(defection.cities[city].governor, null);
  assert.ok(defection.polity.history.some(({ event }) => event === "defection"));
  assert.notEqual(eraByYear(world, defection).officers.find(({ key }) => key === officer).faction, "cao");
});

test("authorized advance musters a commander, relief dispatches reserves, and water operations retain their mode", () => {
  let state = game();
  state.cities.luoyang.troops = 5700;
  state.cities.changan.troops = 500;
  state.factions.cao.grain = 420;
  state = front(state);
  state = quarter(state);
  const plan = state.statecraft.fronts[0];
  assert.ok(plan.officer);
  const manual = commandArmy(world, state, plan.officer, { type: "hold" });
  assert.equal(manual.statecraft.fronts[0].status, "paused");
  while (state.turn < 8 && state.cities.changan.owner !== "cao") state = quarter(state);
  assert.equal(state.cities.changan.owner, "cao");

  let relief = game();
  relief.cities.xu.troops = 5800;
  relief.cities.luoyang.troops = 520;
  relief = quarter(front(relief, "relief", "luoyang"));
  assert.ok(relief.cities.luoyang.troops > 520);
  assert.ok(relief.history.at(-1).entries.some(({ text }) => text.includes("已接到增援")));

  let river = game(208, "liu");
  river = quarter(front(river, "crossing", "chaisang", { troops: 1200 }));
  assert.equal(river.armies.find(({ faction }) => faction === "liu").travel, "water");
});

test("a field encounter changes both formations and is replayable", () => {
  let state = quarter(game());
  state.cities.luoyang.troops = 6300;
  state.cities.changan.troops = 4800;
  state.stations["cao-1"] = "luoyang";
  let opponent = availableAttackers(eraByYear(world, state), state, "ma", "changan")[0];
  if (!opponent) {
    opponent = eraByYear(world, state).officers.find(({ faction, reserve }) => faction === "ma" && !reserve);
    state.stations[opponent.key] = "changan";
  }
  mobilizeArmy(world, state, "ma", { from: "changan", to: "luoyang", troops: 1500, officer: opponent.key, stance: "assault" });
  state = front(state, "field");
  mobilizeArmy(world, state, "cao", { from: "luoyang", to: "changan", troops: 2400, officer: "cao-1", stance: "assault" });
  state.statecraft.fronts[0].officer = "cao-1";
  for (const army of state.armies) Object.assign(army, { assembledAt: 0, phase: "march", prepared: true });
  state = quarter(state);
  assert.ok(state.landscape.replay.flatMap(({ stages }) => stages).some(({ event }) => event === "field-clash"));
});

test("a delegated front can bring in a reserve commander without a city-level order", () => {
  let state = game();
  const officers = eraByYear(world, state).officers.filter(({ faction, reserve }) => faction === "cao" && !reserve);
  for (const { key } of officers) state.stations[key] = "xu";
  state.cities.xu.troops = 730;
  state.cities.luoyang.troops = 6200;
  state.factions.cao.grain = 440;
  state = front(state);
  state = quarter(state);
  assert.match(state.statecraft.fronts[0].report.text, /已调驻/);
  const officer = state.statecraft.fronts[0].officer;
  state = quarter(state);
  assert.ok(state.armies.some((army) => army.officer === officer));
});

test("an initial warehouse and authorized army survive a custom opening backup; 3.0 operations survive upgrading", () => {
  const custom = { title: "战线试演", owners: {}, stocks: { cao: { treasury: 300, grain: 260 } }, stations: {},
    command: { depot: "xu", amount: 45, truce: "ce",
      front: { id: 1, mission: "siege", target: "changan", troops: 1300, grain: 60, floor: 400, auto: true, army: true } } };
  let opening = roundTrip(game(199, "cao", { opening: custom }));
  assert.equal(opening.grand.depots.xu, 45);
  assert.equal(opening.armies[0].opening, true);
  assert.equal(opening.treaties[0].kind, "truce");
  opening = quarter(opening);
  assert.ok(opening.armies.length);

  let old = game(199, "cao", { statecraft: false, landscape: true });
  old.cities.luoyang.troops = 5700;
  old.cities.changan.troops = 900;
  old.factions.cao.grain = 400;
  old.stations["cao-1"] = "luoyang";
  old = queueOrder(world, old, { type: "mobilize", from: "luoyang", to: "changan", officer: "cao-1", troops: 2700, stance: "siege" });
  for (let turn = 0; turn < 3; turn++) old = quarter(old);
  assert.ok(old.armies[0].engagement);
  old = prepareConvoy(world, old, { from: "xu", to: "luoyang", amount: 20, mode: "land", cargo: "grain" });
  old = proposePackage(world, old, { from: "cao", to: "yuan", halt: true, treasury: 10, grain: 0, pass: false, city: null, joint: null });
  const { statecraft, ...previous } = roundTrip(enableStatecraft(old));
  assert.deepEqual(previous, old);
  assert.equal(statecraft.since, 3);
});

test("members receive individual military and supply obligations, and leaving ends the transit agreement", async () => {
  let state = game();
  const duties = { cao: "supply", ce: "screen", yuan: "assault" };
  state = proposeCongress(state, { guests: ["yuan", "ce"], target: "changan", aid: 8, duration: 4,
    beneficiary: "yuan", market: true, border: true, returnTo: null, duties });
  const names = [];
  const models = { client: () => ({ decide: async ([, message]) => {
    if (message.content.startsWith("袁绍")) names.push(message.content);
    return { choice: "0", reason: "各按约定办事", votes: { C1: "yes" } };
  } }) };
  const instructions = await createPlanner({ models }).plan(world, state);
  assert.equal(instructions.yuan.votes.C1, "yes");
  assert.ok(names[0].includes(allianceDuties.assault));
  state = quarter(state);
  assert.equal(state.landscape.congresses[0].contributions.cao, 1);
  assert.ok(conferencePass(state, "yuan", "ce"));
  state = quarter(leaveCongress(state, 1));
  assert.equal(state.landscape.congresses[0].withdrawn.faction, "cao");
  assert.equal(conferencePass(state, "yuan", "ce"), undefined);
});

for (const [year, players] of [[184, ["han", "yellow"]], [190, ["cao", "dong"]], [199, ["cao", "lu"]], [208, ["cao", "liu"]],
  [219, ["liu", "wu"]], [234, ["wei", "shu"]], [262, ["wei", "shu"]], [265, ["jin", "wu"]]]) {
  for (const player of players) test(`4.0 ${year} ${player} resolves up to 100 quarters under a standing national mandate`, (context) => {
    let state = saveStatecraftPolicy(game(year, player), fiscal);
    while (state.turn < 100 && gameOutcome(state) === "ongoing") {
      state = roundTrip(advanceQuarter(world, state));
      assert.equal(Object.keys(state.cities).length, 44);
    }
    assert.ok(state.turn === 100 || gameOutcome(state) !== "ongoing");
    context.diagnostic(state.turn + " quarters · " + gameOutcome(state));
  });
}
