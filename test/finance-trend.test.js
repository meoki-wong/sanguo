import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advanceQuarter, createGame, delegateCities, playableFactions, queueOrder } from "../dist/engine.js";
import { filterDelegationPrograms, quarterlyFinance } from "../dist/finance.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

test("the trend keeps zero balances, season-relative net changes, and gaps in chronological order", () => {
  const prior = { turn: 2, finance: { opening: { treasury: 15, grain: 4 }, closing: { treasury: 10, grain: 6 } } };
  const zero = { turn: 4, finance: { opening: { treasury: 7, grain: 1 }, closing: { treasury: 0, grain: 0 } } };
  const latest = { turn: 7, finance: { opening: { treasury: 5, grain: 13 }, closing: { treasury: 14, grain: 13 } } };
  const history = [latest, { turn: 5 }, prior, zero];
  const before = structuredClone(history);
  const trend = quarterlyFinance(history);
  assert.deepEqual(trend.map(({ turn }) => turn), [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(trend[0].net, { treasury: -5, grain: 2 });
  assert.deepEqual(trend[1], { turn: 3, closing: null, net: null, delegation: null });
  assert.deepEqual(trend[2], { turn: 4, closing: { treasury: 0, grain: 0 }, net: { treasury: -7, grain: -1 }, delegation: null });
  assert.deepEqual(trend[3], { turn: 5, closing: null, net: null, delegation: null });
  assert.deepEqual(trend[5].net, { treasury: 9, grain: 0 });
  assert.deepEqual(history, before);
  assert.deepEqual(quarterlyFinance([]), []);

  const limited = quarterlyFinance([prior, { ...latest, turn: 50 }]);
  assert.equal(limited.length, 12);
  assert.equal(limited[0].turn, 39);
  assert.deepEqual(limited.at(-1).closing, latest.finance.closing);
});

test("the trend reads retained financial ledgers after backup recovery while leaving older quarters blank", () => {
  const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
  const player = "cao";
  const rest = Object.fromEntries(playableFactions(world.scenarios[0]).filter(({ key }) => key !== player)
    .map(({ key }) => [key, { source: "model", order: null }]));
  const initial = createGame(world, 199, player);
  Object.assign(initial.cities.xu, { farming: 4, commerce: 0, defense: 4 });
  const first = advanceQuarter(world, delegateCities(world, initial, ["xu"], "auto", 22), rest);
  const second = advanceQuarter(world, queueOrder(world, first, { type: "build", project: "farming", city: "xu" }), rest);
  const third = advanceQuarter(world, second, rest);
  delete third.history[1].finance;
  const saved = createSaveBackup({ state: third, selected: "xu" });
  const restored = readGameRecord(world, saved).state;
  const trend = quarterlyFinance(restored.history);
  assert.deepEqual(trend.map(({ closing }) => closing), [first.history[0].finance.closing, null, third.history[2].finance.closing]);
  assert.equal(trend[0].delegation.projects.commerce, 1);
  assert.deepEqual(trend[0].delegation.spent, first.history[0].finance.delegation);
  assert.equal(trend[1].delegation, null);
  const { opening, closing } = restored.history[2].finance;
  assert.deepEqual(trend[2].net, { treasury: closing.treasury - opening.treasury, grain: closing.grain - opening.grain });
});

test("delegation trends distinguish empty quarters, blocked programs and missing ledgers", () => {
  const zero = { treasury: 0, grain: 0 };
  const base = { closing: zero, opening: zero, delegation: zero, programs: [] };
  const recorded = {
    ...base,
    delegation: { treasury: 38, grain: 12 },
    programs: [
      { city: "xu", focus: "auto", project: "commerce", result: "completed" },
      { city: "wan", focus: "recruit", result: "completed" },
      { city: "chenliu", focus: "farming", result: "budget" },
      { city: "runan", focus: "farming", result: "reserve-treasury" },
      { city: "puyang", focus: "defense", result: "reserve-treasury" },
      { city: "luoyang", focus: "auto", result: "occupation" },
      { city: "shouchun", focus: "farming", result: "lost" },
    ],
  };
  const allBlocked = { ...base, programs: recorded.programs.slice(2) };
  const history = [{ turn: 1, finance: recorded }, { turn: 3, finance: base }, { turn: 4, finance: allBlocked }];
  const [mixed, missing, empty, paused] = quarterlyFinance(history).map(({ delegation }) => delegation);
  assert.equal(mixed.cities, 7);
  assert.equal(mixed.completed, 2);
  assert.deepEqual(mixed.projects, { farming: 0, commerce: 1, defense: 0, recruit: 1 });
  assert.deepEqual(mixed.spent, recorded.delegation);
  assert.deepEqual(mixed.unexecuted, [["reserve-treasury", 2], ["budget", 1], ["occupation", 1], ["lost", 1]]);
  assert.equal(missing, null);
  assert.equal(empty.cities, 0);
  assert.deepEqual(empty.unexecuted, []);
  assert.equal(paused.cities, 5);
  assert.equal(paused.completed, 0);
  assert.deepEqual(paused.spent, zero);
});

test("delegation filters use recorded results and drop unavailable specific reasons", () => {
  const done = { city: "xu", result: "completed", focus: "auto", project: "commerce" };
  const lost = { city: "wan", result: "lost", focus: "defense" };
  const reserved = { city: "luoyang", result: "reserve-treasury", focus: "farming" };
  const budget = { city: "chenliu", result: "budget", focus: "farming" };
  const programs = [done, lost, reserved, budget];
  const before = structuredClone(programs);

  assert.deepEqual(filterDelegationPrograms(programs, "all"), {
    filter: "all", reasons: ["budget", "reserve-treasury", "lost"], matching: programs,
  });
  assert.deepEqual(filterDelegationPrograms(programs, "completed").matching, [done]);
  assert.deepEqual(filterDelegationPrograms(programs, "unexecuted").matching, [lost, reserved, budget]);
  assert.deepEqual(filterDelegationPrograms(programs, "lost").matching, [lost]);
  assert.equal(filterDelegationPrograms([budget, reserved], "reserve-treasury").filter, "reserve-treasury");
  assert.deepEqual(filterDelegationPrograms([budget], "lost"), { filter: "all", reasons: ["budget"], matching: [budget] });
  assert.deepEqual(filterDelegationPrograms([done], "unexecuted").matching, []);
  assert.deepEqual(filterDelegationPrograms([], "budget"), { filter: "all", reasons: [], matching: [] });
  assert.deepEqual(programs, before);
});
