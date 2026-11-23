import assert from "node:assert/strict";
import test from "node:test";
import { latestSeasonSummary, territoryChanges } from "../dist/chronicle.js";

test("season summaries report recorded gains, losses, cancellations, and net finances", () => {
  const report = {
    turn: 2,
    finance: { opening: { treasury: 100, grain: 40 }, closing: { treasury: 86, grain: 52 } },
    entries: [
      { type: "capture", faction: "cao", participants: ["cao", "ma"], city: "changan", text: "曹操攻占长安。" },
      { type: "capture", faction: "yuan", participants: ["yuan", "cao"], city: "luoyang", text: "袁绍攻占洛阳。" },
      { type: "capture", faction: "biao", participants: ["biao", "zhang"], text: "刘表攻占邻城。" },
      { type: "notice", faction: "cao", city: "luoyang", text: "洛阳征兵已取消，城池已经易主。" },
      { type: "notice", faction: "yuan", text: "敌方政令已取消。" },
      { type: "stage", faction: "cao", text: "已完成阶段目标。" },
      { type: "battle", faction: "ma", participants: ["ma", "cao"], city: "changan", text: "马腾攻打长安失利。" },
      { type: "battle", faction: "cao", participants: ["cao", "yuan"], city: "ye", text: "曹操攻打邺失利。" },
    ],
  };
  const envoy = { from: "ma", kind: "truce", turn: 2, answer: null };
  const state = { player: "cao", turn: 2, history: [{ turn: 1, entries: [] }, report], incomingTreaty: envoy };
  const previous = structuredClone(state);
  const summary = latestSeasonSummary(state);
  assert.equal(summary.turn, 2);
  assert.deepEqual([summary.gains, summary.losses, summary.cancellations], [1, 1, 1]);
  assert.equal(summary.lossesIncomplete, false);
  assert.deepEqual(summary.balance, { treasury: -14, grain: 12 });
  assert.deepEqual(summary.events.map(({ kind }) => kind), ["gain", "loss", "cancelled", "stage", "defended", "attack-failed"]);
  assert.match(summary.events[2].entry.text, /易主/);
  assert.deepEqual(summary.envoy, envoy);
  assert.deepEqual(state, previous);
  assert.equal(latestSeasonSummary({ ...state, incomingTreaty: { ...envoy, answer: false } }).envoy, null);
  assert.equal(latestSeasonSummary({ ...state, turn: 3 }).envoy, null);
});

test("old season summaries leave unknown losses and finances incomplete", () => {
  const state = { player: "cao", turn: 2, history: [{ turn: 2, entries: [
    { type: "capture", faction: "cao", city: "changan", text: "曹操攻占长安。" },
    { type: "capture", faction: "yuan", city: "luoyang", text: "袁绍攻占洛阳。" },
    { type: "income", faction: "cao", text: "税粮入库。国库 +23 · 储粮 +9。" },
  ] }] };
  const summary = latestSeasonSummary(state);
  assert.equal(summary.gains, 1);
  assert.equal(summary.losses, 0);
  assert.equal(summary.lossesIncomplete, true);
  assert.equal(summary.balance, null);
  assert.deepEqual(summary.events.map(({ kind }) => kind), ["gain"]);
  assert.equal(latestSeasonSummary({ ...state, history: [] }), null);
});

test("territory history records only identifiable sides of old captures", () => {
  const oldGain = { type: "capture", faction: "ma", city: "changan", text: "马腾攻占长安。" };
  const oldLoss = { type: "capture", faction: "cao", participants: ["ma", "cao", "ma"], city: "anding" };
  const ambiguous = { type: "capture", faction: "cao", participants: ["cao", "yuan", "ma"], city: "tianshui" };
  const malformedSides = { type: "capture", faction: "cao", participants: ["ma", "yuan"], city: "luoyang" };
  const unknownLoss = { type: "capture", faction: "yuan", city: "luoyang" };
  const battle = { type: "battle", faction: "ma", participants: ["ma", "cao"], city: "xuchang" };
  const history = [{ turn: 4, entries: [ambiguous, malformedSides, unknownLoss, battle, oldLoss] }, { turn: 2, entries: [oldGain] }];
  const before = structuredClone(history);

  assert.deepEqual(territoryChanges(history, "ma"), [
    { kind: "loss", other: "cao", entry: oldLoss, turn: 4 },
    { kind: "gain", other: undefined, entry: oldGain, turn: 2 },
  ]);
  assert.deepEqual(territoryChanges(history, "biao"), []);
  assert.deepEqual(territoryChanges([], "ma"), []);
  assert.deepEqual(history, before);
});
