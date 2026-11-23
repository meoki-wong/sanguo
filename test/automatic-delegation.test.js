import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, createGame, decodeSave, delegateCities, delegateZones, forceTotals, forecastDelegation, forecastDelegationZones,
  forecastFinance, playableFactions, queueOrder, setDelegationPriority, setGovernance,
} from "../dist/engine.js";
import { legacyProposals, legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];

function opponents(player) {
  return playableFactions(era).filter(({ key }) => key !== player);
}

function rest(player) {
  return Object.fromEntries(opponents(player).map(({ key }) => [key, { source: "model", order: null }]));
}

function program(ledger, city) {
  return ledger.programs.find((row) => row.city === city);
}

test("automatic development selects a single affordable low-level project and re-evaluates the next quarter", () => {
  const initial = createGame(world, 199, "cao");
  Object.assign(initial.cities.xu, { farming: 2, commerce: 2, defense: 1 });
  const preview = forecastDelegation(world, initial, ["xu"], "auto", 22);
  assert.equal(initial.cities.xu.governor, null);
  assert.equal(preview.programs[0].project, "defense");
  assert.match(preview.programs[0].action, /城防升至 2 级/);

  let state = delegateCities(world, initial, ["xu"], "auto", 22);
  const person = era.officers.find(({ key }) => key === state.cities.xu.governor);
  const discount = Math.floor(person.governance / 25);
  assert.equal(preview.programs[0].spent.treasury, 22 - discount);
  const directOrder = queueOrder(world, state, { type: "build", city: "xu", project: "defense" });
  const directForecast = forecastFinance(world, directOrder);
  assert.equal(program(directForecast, "xu").project, "farming");
  const directSettlement = advanceQuarter(world, directOrder, rest("cao"));
  assert.deepEqual(directSettlement.history.at(-1).finance, directForecast);
  assert.equal(directSettlement.cities.xu.defense, 2);
  assert.equal(directSettlement.cities.xu.farming, 3);
  for (const project of ["defense", "farming", "commerce"]) {
    const before = structuredClone(state);
    const forecast = forecastFinance(world, state);
    assert.deepEqual(state, before);
    const expected = program(forecast, "xu");
    assert.equal(expected.project, project);
    state = advanceQuarter(world, state, rest("cao"));
    assert.deepEqual(state.history.at(-1).finance, forecast);
    assert.equal(state.cities.xu.focus, "auto");
    assert.equal(state.cities.xu[project], before.cities.xu[project] + 1);
    assert.ok(["defense", "farming", "commerce"].filter((type) => type !== project)
      .every((type) => state.cities.xu[type] === before.cities.xu[type]));
    assert.equal(expected.spent.grain, 0);
    assert.match(state.history.at(-1).entries.find(({ type, city }) => type === "delegation" && city === "xu").text, /自主发展/);
  }
  assert.deepEqual(readGameRecord(world, createSaveBackup({ state, selected: "xu" })).state, state);
  const malformed = structuredClone(state);
  delete malformed.history.at(-1).finance.programs[0].project;
  assert.throws(() => decodeSave(world, JSON.stringify(malformed)), /财政账目/);
});

test("automatic selection skips exhausted and unaffordable projects and reports the limiting budget", () => {
  let state = createGame(world, 199, "lu");
  const city = "nanzheng";
  Object.assign(state.cities[city], { farming: 5, commerce: 2, defense: 1 });
  state = delegateCities(world, state, [city], "auto", 22);
  const governor = era.officers.find(({ key }) => key === state.cities[city].governor);
  const cost = 18 - Math.floor(governor.governance / 25);
  const income = forceTotals(state, "lu").treasury;
  const soleProgram = (snapshot) => program(forecastFinance(world, snapshot), city);

  const limited = setGovernance(state, city, "delegated", "auto", cost);
  assert.equal(soleProgram(limited).project, "commerce");
  state.factions.lu.treasury = cost - income;
  assert.deepEqual(soleProgram(state), { city, focus: "auto", project: "commerce", result: "completed", spent: { treasury: cost, grain: 0 } });
  limited.factions.lu.treasury = cost - income - 1;
  const treasury = soleProgram(limited);
  assert.equal(treasury.result, "treasury");
  assert.equal(treasury.needed, cost);
  assert.equal(treasury.available, cost - 1);
  assert.equal(treasury.project, undefined);
  const budget = setGovernance(limited, city, "delegated", "auto", cost - 1);
  assert.equal(soleProgram(budget).result, "budget");
  assert.equal(soleProgram(budget).needed, cost);
  const deferred = advanceQuarter(world, budget, rest("lu"));
  assert.match(deferred.history.at(-1).entries.find(({ type, city }) => type === "delegation" && city === "nanzheng").text, /本城预算不足/);
  const recovering = structuredClone(limited);
  Object.assign(recovering.cities[city], { occupation: 2, troops: 220 });
  assert.equal(soleProgram(recovering).result, "occupation");
  Object.assign(state.cities[city], { farming: 5, commerce: 5, defense: 5 });
  assert.deepEqual(soleProgram(state), { city, focus: "auto", result: "level", spent: { treasury: 0, grain: 0 } });
});

test("automatic zoning shares money with fixed programs and respects priority before settlement", () => {
  const initial = createGame(world, 199, "cao");
  initial.factions.cao.treasury = 20;
  const queued = queueOrder(world, initial, { type: "recruit", city: "xu" });
  const policies = { front: { focus: "auto", budget: 22 }, rear: { focus: "commerce", budget: 22 } };
  const preview = forecastDelegationZones(world, queued, policies);
  assert.ok(preview.groups.front.rows.some(({ project }) => project));
  assert.ok(preview.groups.rear.rows.every(({ focus, project }) => focus === "commerce" && project === undefined));
  const state = delegateZones(world, queued, policies);
  const before = forecastFinance(world, state);
  const deferred = preview.groups.front.rows.find(({ result }) => result === "treasury");
  assert.ok(deferred);
  const prioritized = setDelegationPriority(state, [deferred.city]);
  const after = forecastFinance(world, prioritized);
  assert.equal(after.programs[0].city, deferred.city);
  assert.equal(after.programs[0].priority, true);
  assert.equal(after.programs[0].result, "completed");
  assert.ok(before.programs.some(({ city, result }) => result === "completed" && program(after, city).result === "treasury"));
  assert.deepEqual(advanceQuarter(world, prioritized, rest("cao")).history.at(-1).finance, after);
});

test("older services receive fixed-focus snapshots while local replay keeps automatic focus and its result", () => {
  let state = createGame(world, 199, "cao");
  Object.assign(state.cities.xu, { farming: 2, commerce: 2, defense: 1 });
  state = delegateCities(world, state, ["xu"], "auto", 22);
  state = advanceQuarter(world, state, rest("cao"));
  assert.equal(state.history.at(-1).finance.programs[0].project, "defense");
  const legacy = legacySnapshot(world, state, 16);
  assert.equal(legacy.cities.xu.focus, "farming");
  assert.equal(legacy.history.at(-1).finance.programs[0].focus, "defense");
  assert.equal(legacy.history.at(-1).finance.programs[0].project, undefined);
  assert.deepEqual(decodeSave(world, JSON.stringify(legacy)), legacy);
  const oldResult = advanceQuarter(world, legacy, rest("cao"));
  const proposals = legacyProposals(world, legacy, oldResult.history.at(-1), opponents("cao"), 16);
  const replay = advanceQuarter(world, state, proposals);
  assert.equal(replay.cities.xu.focus, "auto");
  assert.equal(replay.history.at(-1).finance.programs[0].project, "farming");
  assert.deepEqual(replay.history[0], state.history[0]);
});

test("an automatic program ends without spending when its city is captured", () => {
  const initial = createGame(world, 199, "cao");
  initial.turn = era.factions.findIndex(({ key }) => key === "ma");
  initial.cities.luoyang.troops = 350;
  initial.cities.changan.troops = 3200;
  initial.cities.tianshui.commander = null;
  initial.stations["ma-1"] = "changan";
  initial.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: initial.turn, threshold: 1 };
  const state = setDelegationPriority(delegateCities(world, initial, ["luoyang"], "auto", 22), ["luoyang"]);
  const settled = advanceQuarter(world, state, { ...rest("cao"), ma: { source: "rules" } });
  assert.equal(settled.cities.luoyang.owner, "ma");
  assert.equal(settled.cities.luoyang.focus, "farming");
  const report = settled.history.at(-1);
  assert.deepEqual(program(report.finance, "luoyang"), {
    city: "luoyang", focus: "auto", result: "lost", spent: { treasury: 0, grain: 0 }, priority: true,
  });
  assert.match(report.entries.find(({ type, city }) => type === "delegation" && city === "luoyang").text, /自主发展终止/);
  assert.deepEqual(decodeSave(world, JSON.stringify(settled)), settled);
});
