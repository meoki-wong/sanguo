import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, createGame, decodeSave, delegateCities, forceTotals, forecastDelegationReserve, forecastFinance,
  playableFactions, projects, queueOrder, recruitment, setDelegationPriority, setDelegationReserve, setGovernance,
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

function cost(state, city, focus) {
  const governor = era.officers.find(({ key }) => key === state.cities[city].governor);
  return (focus === "recruit" ? recruitment.treasury : projects[focus].cost) - Math.floor(governor.governance / 25);
}

function program(ledger, city) {
  return ledger.programs.find((row) => row.city === city);
}

test("treasury reserve applies after queued orders and follows delegation priority", () => {
  let state = delegateCities(world, createGame(world, 199, "cao"), ["xu", "luoyang"], "farming", 22);
  state = setDelegationPriority(state, ["luoyang"]);
  state = queueOrder(world, state, { type: "build", city: "xu", project: "defense" });
  const afterOrders = state.factions.cao.treasury + forceTotals(state, "cao").treasury - projects.defense.cost;
  const reserve = { treasury: afterOrders - cost(state, "luoyang", "farming"), grain: 0 };
  const before = structuredClone(state);
  const preview = forecastDelegationReserve(world, state, reserve);
  assert.deepEqual(state, before);
  assert.equal(preview.closing.treasury, reserve.treasury);
  assert.deepEqual(preview.changes.map(({ previous, program: row }) => [row.city, previous.result, row.result]),
    [["xu", "completed", "reserve-treasury"]]);

  const configured = setDelegationReserve(state, reserve);
  const forecast = forecastFinance(world, configured);
  assert.equal(forecast.orders.treasury, projects.defense.cost);
  assert.equal(program(forecast, "luoyang").result, "completed");
  assert.equal(program(forecast, "xu").available, 0);
  const settled = advanceQuarter(world, configured, rest("cao"));
  const report = settled.history.at(-1);
  assert.deepEqual(report.finance, forecast);
  assert.match(report.entries.find(({ city, type }) => city === "xu" && type === "delegation").text, /国库预留/);
  assert.equal(settled.cities.xu.defense, state.cities.xu.defense + 1);
  assert.deepEqual(settled.delegationPriority, ["luoyang"]);
});

test("grain reserve distinguishes actual scarcity and respects a city's own budget", () => {
  const city = "nanzheng";
  const initial = createGame(world, 199, "lu");
  const delegated = delegateCities(world, initial, [city], "recruit", 22);
  const income = forceTotals(delegated, "lu");
  const grain = delegated.factions.lu.grain + income.grain - recruitment.grain + 1;
  const reserve = { treasury: 0, grain };
  const configured = setDelegationReserve(delegated, reserve);
  const forecast = forecastFinance(world, configured);
  assert.deepEqual(program(forecast, city), {
    city, focus: "recruit", result: "reserve-grain", needed: recruitment.grain,
    available: recruitment.grain - 1, spent: { treasury: 0, grain: 0 },
  });
  const noGrain = structuredClone(configured);
  noGrain.factions.lu.grain = 0;
  const scarce = program(forecastFinance(world, noGrain), city);
  assert.equal(scarce.result, "grain");
  assert.equal(scarce.available, income.grain);
  const scarceReport = advanceQuarter(world, noGrain, rest("lu")).history.at(-1);
  assert.match(scarceReport.entries.find(({ city, type }) => city === "nanzheng" && type === "delegation").text, /储粮不足/);
  const localBudget = setGovernance(configured, city, "delegated", "recruit", 0);
  assert.equal(program(forecastFinance(world, localBudget), city).result, "budget");
  const cleared = setDelegationReserve(configured, { treasury: 0, grain: 0 });
  assert.deepEqual(cleared, delegated);
  assert.equal(program(forecastFinance(world, cleared), city).result, "completed");
});

test("automatic development can change projects under reserve and keeps that reason in the quarter archive", () => {
  const initial = createGame(world, 199, "cao");
  Object.assign(initial.cities.xu, { farming: 2, commerce: 2, defense: 1 });
  const state = delegateCities(world, initial, ["xu"], "auto", 22);
  const inc = forceTotals(state, "cao");
  const reserve = { treasury: state.factions.cao.treasury + inc.treasury - cost(state, "xu", "farming"), grain: 0 };
  const preview = forecastDelegationReserve(world, state, reserve);
  const [{ previous, program: after }] = preview.changes;
  assert.equal(previous.project, "defense");
  assert.equal(after.project, "farming");
  assert.equal(after.adjustedForReserve, true);
  const configured = setDelegationReserve(state, reserve);
  const forecast = forecastFinance(world, configured);
  const settled = advanceQuarter(world, configured, rest("cao"));
  const report = settled.history.at(-1);
  assert.deepEqual(report.finance, forecast);
  assert.deepEqual(report.finance.reserve, reserve);
  assert.match(report.entries.find(({ city, type }) => city === "xu" && type === "delegation").text, /按国库预留改选/);
  assert.deepEqual(readGameRecord(world, createSaveBackup({ state: settled, selected: "xu" })).state, settled);

  const cleared = setDelegationReserve(settled, { treasury: 0, grain: 0 });
  assert.equal(cleared.delegationReserve, undefined);
  assert.deepEqual(cleared.history[0].finance.reserve, reserve);
  const malformed = structuredClone(cleared);
  delete malformed.history[0].finance.reserve;
  assert.throws(() => decodeSave(world, JSON.stringify(malformed)), /财政账目/);
});

test("settings reject invalid amounts and completed wars and are replayed locally for older model services", () => {
  const initial = delegateCities(world, createGame(world, 199, "cao"), ["xu"], "farming", 22);
  const reserve = { treasury: initial.factions.cao.treasury + forceTotals(initial, "cao").treasury, grain: 0 };
  assert.throws(() => setDelegationReserve(initial, { treasury: -1, grain: 0 }), /非负整数/);
  assert.throws(() => setDelegationReserve(initial, { treasury: 0, grain: 1.5 }), /非负整数/);
  assert.throws(() => setDelegationReserve(initial, { treasury: Number.MAX_SAFE_INTEGER + 1, grain: 0 }), /非负整数/);
  const finished = structuredClone(initial);
  for (const city of Object.values(finished.cities)) city.owner = "cao";
  assert.throws(() => forecastDelegationReserve(world, finished, reserve), /战局已结束/);
  const configured = setDelegationReserve(initial, reserve);
  assert.deepEqual(initial.delegationReserve, undefined);
  const result = advanceQuarter(world, configured, rest("cao"));
  const legacy = legacySnapshot(world, result, 17);
  assert.equal(legacy.delegationReserve, undefined);
  assert.equal(legacy.history[0].finance.reserve, undefined);
  assert.equal(legacy.history[0].finance.programs[0].result, "treasury");
  assert.deepEqual(decodeSave(world, JSON.stringify(legacy)), legacy);
  const olderResult = advanceQuarter(world, legacy, rest("cao"));
  const choices = legacyProposals(world, legacy, olderResult.history.at(-1), opponents("cao"), 17);
  const replay = advanceQuarter(world, result, choices);
  assert.deepEqual(replay.delegationReserve, reserve);
  assert.equal(replay.history[0].finance.programs[0].result, "reserve-treasury");
  assert.deepEqual(replay.history[1].finance, forecastFinance(world, result));
});
