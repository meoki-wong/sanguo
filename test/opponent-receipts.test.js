import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advanceQuarter, createGame, decodeSave, delegateCities, playableFactions, queueOrder } from "../dist/engine.js";
import { filteredReports } from "../dist/chronicle.js";
import { legacyProposals, legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { factionPlans } from "../dist/strategy.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const opponents = playableFactions(era).filter(({ key }) => key !== "cao");
const rest = Object.fromEntries(opponents.map(({ key }) => [key, { source: "model", order: null }]));
const rules = { ...rest, ma: { source: "rules" } };

function expansion() {
  const state = createGame(world, 199, "cao");
  state.cities.luoyang.troops = 950;
  state.cities.changan.troops = 1900;
  state.cities.tianshui.commander = null;
  state.stations["ma-1"] = "changan";
  state.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: state.turn, threshold: 1 };
  return state;
}

function recovery() {
  const state = createGame(world, 199, "cao");
  Object.assign(state.cities.changan, { troops: 500, occupation: 2, farming: 4, commerce: 3 });
  state.strategies.ma = { type: "economy", since: 0, threshold: state.factions.ma.grain + 1000 };
  return state;
}

function decision(report, faction = "ma") {
  return report.decisions.find((candidate) => candidate.faction === faction);
}

function receipt(report, faction = "ma") {
  return report.entries[decision(report, faction).entryIndex];
}

test("combat receipts resolve the actual event by faction and quarter after stage messages are inserted", () => {
  const state = expansion();
  state.cities.xu.farming = state.cities.chenliu.farming = 2;
  const stage = delegateCities(world, state, ["xu", "chenliu"], "farming", 22);
  const captured = advanceQuarter(world, stage, rules);
  const first = captured.history[0];
  assert.equal(first.entries[0].type, "stage");
  assert.equal(receipt(first).type, "capture");
  assert.equal(receipt(first).battle.from, "changan");
  assert.equal(receipt(first).city, "luoyang");
  assert.equal(decision(first, "yuan").entryIndex, null);
  assert.equal(captured.cities.luoyang.owner, "ma");

  const reinforced = queueOrder(world, stage, { type: "transfer", from: "xu", to: "luoyang", troops: 2000 });
  const held = advanceQuarter(world, reinforced, rules);
  assert.equal(held.history[0].entries[0].type, "stage");
  assert.equal(receipt(held.history[0]).type, "battle");
  assert.equal(held.cities.luoyang.owner, "cao");

  const later = advanceQuarter(world, captured, rest);
  const reports = filteredReports(later.history, { section: "plans", turn: "all", category: "all", faction: "ma" });
  assert.deepEqual(reports.map(({ turn, receipt: event }) => [turn, event?.type ?? null]), [[2, null], [1, "capture"]]);
  assert.equal(reports[1].receipt, receipt(later.history[0]));
  const restored = readGameRecord(world, createSaveBackup({ state: later, selected: "luoyang" })).state;
  assert.deepEqual(restored, later);
});

test("staffing, domestic orders and cancellations link to their own settlement entry", () => {
  const state = recovery();
  const appointed = advanceQuarter(world, state, rules);
  assert.equal(decision(appointed.history[0]).orderType, "appoint-governor");
  const entry = receipt(appointed.history[0]);
  assert.equal(entry.city, "changan");
  assert.equal(entry.type, "order");
  assert.ok(entry.personnelChange);
  assert.ok(appointed.history[0].entries.some((item) => item.type === "recovery" && item.city === entry.city));

  const capturedFirst = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1000 });
  const canceled = advanceQuarter(world, capturedFirst, rules);
  const notice = receipt(canceled.history[0]);
  assert.equal(notice.type, "notice");
  assert.equal(notice.city, "changan");
  assert.match(notice.text, /目标城池已经易主/);
  assert.deepEqual(decodeSave(world, JSON.stringify(canceled)), canceled);

  const ordinary = createGame(world, 199, "cao");
  const build = factionPlans(world, era, ordinary, "ma").choices.find(({ order }) => order?.type === "build");
  const constructed = advanceQuarter(world, ordinary, { ...rest, ma: { ...build, source: "model", reason: "筹备税粮" } });
  const report = constructed.history[0];
  assert.equal(decision(report).source, "model");
  assert.equal(receipt(report).orderType, "build");
  assert.equal(receipt(report).city, build.order.city);
  assert.match(receipt(report).text, /升至/);
});

test("the terminal notice leaves the winning opponent's attack connected to its receipt", () => {
  const state = createGame(world, 199, "lu");
  for (const [key, city] of Object.entries(state.cities)) {
    Object.assign(city, { owner: key === "nanzheng" ? "lu" : "ma", governor: null, commander: null });
  }
  for (const { key } of era.officers) state.stations[key] = null;
  state.stations["ma-1"] = "tianshui";
  state.cities.tianshui.troops = 3000;
  Object.assign(state.cities.nanzheng, { troops: 300, defense: 0 });
  state.strategies.ma = { type: "expand", city: "tianshui", target: "nanzheng", since: 0, threshold: 1 };
  const settled = advanceQuarter(world, state);
  const report = settled.history[0];
  assert.equal(report.entries[0].type, "defeat");
  assert.equal(receipt(report).type, "capture");
  assert.equal(receipt(report).city, "nanzheng");
  assert.deepEqual(decodeSave(world, JSON.stringify(settled)), settled);
});

test("loading validates receipt type, faction, range and per-faction uniqueness while keeping old reports readable", () => {
  const settled = advanceQuarter(world, recovery(), rules);
  const assertRejected = (alter) => {
    const bad = structuredClone(settled);
    alter(bad.history[0]);
    assert.throws(() => decodeSave(world, JSON.stringify(bad)), /政令回执/);
  };
  assertRejected((report) => { decision(report).entryIndex = 500; });
  assertRejected((report) => { decision(report).entryIndex = report.entries.findIndex(({ type }) => type === "income"); });
  assertRejected((report) => { decision(report).entryIndex = report.entries.findIndex(({ type }) => type === "recovery"); });
  assertRejected((report) => { decision(report).entryIndex = null; });
  assertRejected((report) => { decision(report, "yuan").entryIndex = decision(report).entryIndex; });
  assertRejected((report) => { report.decisions[1] = structuredClone(decision(report)); });

  const legacy = legacySnapshot(world, settled, 18);
  assert.deepEqual(decodeSave(world, JSON.stringify(legacy)), legacy);
  const [plan] = filteredReports(legacy.history, { section: "plans", turn: "all", category: "all", faction: "ma" });
  assert.equal(Object.hasOwn(plan, "receipt"), false);
  assert.match(plan.entry.action, /太守/);
});

test("an older model response can be replayed without inventing receipts for older quarters", () => {
  const first = advanceQuarter(world, expansion(), rest);
  const before = legacySnapshot(world, first, 18);
  const older = legacySnapshot(world, advanceQuarter(world, before, rules), 18);
  const proposal = legacyProposals(world, before, older.history.at(-1), opponents, 18);
  const replay = advanceQuarter(world, before, proposal);
  assert.deepEqual(replay.history[0], before.history[0]);
  assert.deepEqual(replay, advanceQuarter(world, before, rules));
  assert.equal(receipt(replay.history.at(-1)).type, "capture");
  assert.equal(decision(replay.history[0]).entryIndex, undefined);
});
