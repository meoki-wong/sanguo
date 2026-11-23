import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advanceQuarter, createGame, decodeSave, playableFactions, queueOrder } from "../dist/engine.js";
import { legacyProposals, legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { nationalRoster, officerProfile } from "../dist/roster.js";
import { factionPlans } from "../dist/strategy.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const opponents = playableFactions(era).filter(({ key }) => key !== "cao");

test("capture records the people who actually left and the posts they held", () => {
  const state = createGame(world, 199, "cao");
  const leaving = ["ma-0", "ma-1", "ma-roster-0"];
  for (const city of Object.values(state.cities)) {
    if (leaving.includes(city.governor)) city.governor = null;
    if (leaving.includes(city.commander)) city.commander = null;
  }
  for (const officer of leaving) state.stations[officer] = "changan";
  Object.assign(state.cities.changan, { governor: leaving[0], commander: leaving[1], troops: 400 });
  const order = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1000 };
  const next = advanceQuarter(world, queueOrder(world, state, order));
  const battle = next.history.at(-1).entries.find(({ type, city }) => type === "capture" && city === "changan").battle;
  assert.equal(battle.personnel.attacker, order.officer);
  assert.equal(battle.personnel.defender, leaving[1]);
  assert.deepEqual(battle.personnel.relocated.filter(({ officer }) => leaving.includes(officer)),
    [{ officer: leaving[0], role: "governor" }, { officer: leaving[1], role: "commander" }, { officer: leaving[2], role: "available" }]);
  assert.ok(battle.personnel.relocated.every(({ officer }) => next.stations[officer] === battle.occupation.retreatTo));
  const saved = createSaveBackup({ state: next, selected: "changan" });
  assert.deepEqual(readGameRecord(world, saved).state, next);
  next.stations[leaving[0]] = "anding";
  const later = decodeSave(world, JSON.stringify(next));
  const stored = later.history.at(-1).entries.find(({ type, city }) => type === "capture" && city === "changan").battle;
  assert.deepEqual(stored.personnel, battle.personnel);
  assert.notEqual(later.stations[leaving[0]], stored.occupation.retreatTo);
  battle.personnel.relocated.push(battle.personnel.relocated[0]);
  assert.throws(() => decodeSave(world, JSON.stringify(next)), /奏报/);
});

test("two captures of the same city in one quarter record separate people and retreats", () => {
  const state = createGame(world, 199, "cao");
  state.turn = era.factions.findIndex(({ key }) => key === "ma");
  state.cities.luoyang.troops = 350;
  state.cities.changan.troops = 2300;
  state.cities.ye.troops = 5200;
  state.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: state.turn, threshold: 1 };
  state.strategies.yuan = { type: "expand", city: "ye", target: "luoyang", since: state.turn, threshold: 1 };
  const next = advanceQuarter(world, state);
  const captures = next.history.at(-1).entries.filter(({ type, city }) => type === "capture" && city === "luoyang");
  assert.deepEqual(captures.map(({ faction }) => faction), ["ma", "yuan"]);
  const [first, second] = captures.map(({ battle }) => battle);
  assert.equal(first.personnel.defender, null);
  assert.ok(first.personnel.relocated.some(({ officer, role }) => officer === "cao-1" && role === "available"));
  assert.equal(second.personnel.defender, first.personnel.attacker);
  assert.deepEqual(second.personnel.relocated, [{ officer: first.personnel.attacker, role: "commander" }]);
  assert.notEqual(first.occupation.retreatTo, second.occupation.retreatTo);
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
  const profile = officerProfile(world, next, first.personnel.attacker);
  assert.equal(profile.station, second.occupation.retreatTo);
  assert.equal(profile.posting, null);
  assert.deepEqual(profile.records.map(({ entry, attack, defend, relocation }) =>
    [entry.faction, attack, defend, relocation?.role ?? null]), [
    ["yuan", false, true, "commander"],
    ["ma", true, false, null],
  ]);
  assert.equal(profile.records[0].turn, profile.records[1].turn);
  next.stations["cao-1"] = "xu";
  const roster = nationalRoster(world, next, { status: "relocated", sort: "command", query: "曹仁" }).matching;
  assert.equal(roster.length, 1);
  assert.equal(roster[0].station, "xu");
  assert.equal(roster[0].relocation.destination, first.occupation.retreatTo);
  assert.equal(roster[0].relocation.entry, captures[0]);
  const old = legacySnapshot(world, next, 14);
  assert.equal(nationalRoster(world, old, { status: "relocated", sort: "command", query: "曹仁" }).matching.length, 0);
  assert.deepEqual(officerProfile(world, old, first.personnel.attacker).records, []);
});

test("a profile distinguishes a current expedition from earlier battles and orders the retained quarters", () => {
  let initial = createGame(world, 199, "cao");
  const order = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 200 };
  initial = queueOrder(world, initial, order);
  const current = officerProfile(world, initial, "cao-1");
  assert.equal(current.station, "luoyang");
  assert.deepEqual(current.expedition, order);
  assert.equal(current.available, false);
  assert.deepEqual(current.records, []);
  const afterFirst = advanceQuarter(world, initial);
  const afterSecond = advanceQuarter(world, queueOrder(world, afterFirst, order));
  const report = officerProfile(world, afterSecond, "cao-1");
  assert.equal(report.expedition, undefined);
  assert.deepEqual(report.records.map(({ turn }) => turn), [2, 1]);
  assert.ok(report.records.every(({ attack, defend }) => attack && !defend));
});

test("old battle details may omit personnel and a version 14 model selection survives local recording", () => {
  const initial = createGame(world, 199, "cao");
  initial.strategies.ma = { type: "economy", since: 0, threshold: 1500 };
  initial.factions.ma.treasury = 120;
  initial.factions.ma.grain = 20;
  const queued = queueOrder(world, initial, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1292 });
  const order = factionPlans(world, era, queued, "ma").suggested;
  assert.equal(order.order.type, "delegate-city");
  const rest = Object.fromEntries(opponents.map(({ key }) => [key, { source: "model", order: null }]));
  const oldInput = legacySnapshot(world, queued, 14);
  const oldOutput = legacySnapshot(world, advanceQuarter(world, oldInput, { ...rest, ma: { ...order, source: "model" } }), 14);
  const oldFight = oldOutput.history.at(-1).entries.find(({ type, city }) => type === "capture" && city === "changan");
  assert.equal(oldFight.battle.personnel, undefined);
  assert.deepEqual(decodeSave(world, JSON.stringify(oldOutput)), oldOutput);
  const choices = legacyProposals(world, oldInput, oldOutput.history.at(-1), opponents, 14);
  const current = advanceQuarter(world, queued, choices);
  const report = current.history.at(-1);
  assert.equal(report.decisions.find(({ faction }) => faction === "ma").orderType, "delegate-city");
  assert.equal(report.decisions.find(({ faction }) => faction === "ma").source, "model");
  assert.equal(report.entries.find(({ type, city }) => type === "capture" && city === "changan").battle.personnel.attacker, "cao-1");
});
