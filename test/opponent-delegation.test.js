import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import {
  advanceQuarter, createGame, decodeSave, describeOrder, forceTotals, opponentDelegationQuote, playableFactions,
  queueOrder, recruitment, validateOrder,
} from "../dist/engine.js";
import { legacyProposals, legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { factionPlans } from "../dist/strategy.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const opponents = playableFactions(era).filter(({ key }) => key !== "cao");
const rest = Object.fromEntries(opponents.map(({ key }) => [key, { source: "model", order: null }]));

function fixture() {
  const state = createGame(world, 199, "cao");
  state.strategies.ma = { type: "economy", since: 0, threshold: 1500 };
  state.factions.ma.treasury = 120;
  state.factions.ma.grain = 20;
  return state;
}

test("an independent model can choose recurring delegation and the same quarterly rules execute it", async () => {
  const initial = fixture();
  const plan = factionPlans(world, era, initial, "ma");
  const order = plan.suggested.order;
  assert.deepEqual(order, { type: "delegate-city", city: "tianshui", focus: "defense", budget: 19 });
  assert.ok(plan.choices.some(({ order }) => order?.type === "build"));
  const planner = createPlanner({ models: { client: () => ({
    decide: async ([, message]) => {
      const match = message.content.match(/^(\d+) 委任天水城防/m);
      return { choice: match?.[1] ?? "0", reason: match ? "由太守持续修城" : "保留钱粮" };
    },
  }) } });
  const proposals = await planner.plan(world, initial);
  assert.deepEqual(proposals.ma.order, order);
  const settled = advanceQuarter(world, initial, proposals);
  const { tianshui } = settled.cities;
  assert.equal(tianshui.mode, "delegated");
  assert.equal(tianshui.delegateBudget, order.budget);
  assert.equal(tianshui.defense, initial.cities.tianshui.defense + 1);
  assert.equal(settled.factions.ma.treasury, initial.factions.ma.treasury + forceTotals(initial, "ma").treasury - order.budget);
  const report = settled.history.at(-1);
  assert.equal(report.decisions.find(({ faction }) => faction === "ma").source, "model");
  assert.equal(report.entries.filter(({ faction, orderType }) => faction === "ma" && orderType === "delegate-city").length, 1);
  assert.match(report.entries.find(({ faction, type }) => faction === "ma" && type === "delegation").text, /天水城防升至 3 级，支出 19 钱/);
  assert.deepEqual(settled.strategies.ma, initial.strategies.ma);
  assert.deepEqual(decodeSave(world, JSON.stringify(settled)), settled);

  const repeated = advanceQuarter(world, settled, rest);
  assert.equal(repeated.cities.tianshui.defense, tianshui.defense + 1);
  assert.equal(repeated.history.at(-1).decisions.find(({ faction }) => faction === "ma").orderType, "rest");
});

test("the reserve holds in later quarters and prevents unfunded or excessive commitments", () => {
  const initial = fixture();
  const fallback = advanceQuarter(world, initial, { ...rest, ma: { source: "fallback", reason: "模拟模型超时" } });
  assert.equal(fallback.history.at(-1).decisions.find(({ faction }) => faction === "ma").source, "fallback");
  assert.equal(fallback.cities.tianshui.mode, "delegated");
  fallback.cities.anding.governor = "ma-2";
  fallback.stations["ma-2"] = "anding";
  assert.equal(opponentDelegationQuote(world, fallback, "ma", "anding", "commerce"), null);
  const tax = forceTotals(fallback, "ma").treasury;
  fallback.factions.ma.treasury = recruitment.treasury + fallback.cities.tianshui.delegateBudget - tax - 1;
  const beforeDefense = fallback.cities.tianshui.defense;
  const reduced = advanceQuarter(world, fallback, rest);
  assert.equal(reduced.cities.tianshui.defense, beforeDefense);
  assert.equal(reduced.factions.ma.treasury, fallback.factions.ma.treasury + tax);
  assert.ok(reduced.factions.ma.treasury >= recruitment.treasury);
  assert.match(reduced.history.at(-1).entries.find(({ type, city }) => type === "delegation" && city === "tianshui").text,
    /预留征兵资金后国库不足/);

  initial.factions.ma.treasury = recruitment.treasury;
  assert.ok(!factionPlans(world, era, initial, "ma").choices.some(({ order }) => order?.type === "delegate-city"));
  initial.factions.ma.treasury = 120;
  initial.cities.tianshui.occupation = 2;
  assert.ok(!factionPlans(world, era, initial, "ma").choices.some(({ order }) => order?.type === "delegate-city"));
});

test("a finished program can be reassigned without replacing useful work", () => {
  const state = advanceQuarter(world, fixture(), { ...rest, ma: { source: "fallback", reason: "模拟模型超时" } });
  assert.ok(!factionPlans(world, era, state, "ma").choices.some(({ order }) => order?.type === "delegate-city" && order.city === "tianshui"));
  const capped = structuredClone(state);
  capped.cities.tianshui.defense = 5;
  const order = factionPlans(world, era, capped, "ma").suggested.order;
  assert.equal(order.type, "delegate-city");
  assert.equal(order.previousFocus, "defense");
  assert.equal(order.focus, "farming");
  assert.throws(() => validateOrder(world, state, "ma", order), /无法改派/);
  const next = advanceQuarter(world, capped, { ...rest, ma: undefined });
  assert.equal(next.cities.tianshui.farming, capped.cities.tianshui.farming + 1);
  assert.equal(next.cities.tianshui.defense, 5);
  assert.equal(next.cities.tianshui.focus, "farming");
  assert.equal(next.cities.tianshui.governor, capped.cities.tianshui.governor);
  const report = next.history.at(-1);
  assert.match(report.decisions.find(({ faction }) => faction === "ma").reason, /原项目已达上限/);
  assert.match(report.entries.find(({ orderType, faction }) => faction === "ma" && orderType === "delegate-city").text, /改派天水屯田/);
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
});

test("a captured city cancels the policy and older model choices are replayed without inventing delegation", () => {
  const state = fixture();
  const governor = state.cities.tianshui.governor;
  state.cities.tianshui.governor = null;
  state.cities.changan.governor = governor;
  state.stations[governor] = "changan";
  state.cities.changan.troops = 500;
  const order = factionPlans(world, era, state, "ma").suggested.order;
  assert.equal(order.city, "changan");
  assert.throws(() => validateOrder(world, state, "ma", { ...order, budget: order.budget + 1 }), /预算/);
  const attack = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1000 });
  const taken = advanceQuarter(world, attack, { ...rest, ma: { source: "fallback", reason: "模拟模型超时" } });
  assert.equal(taken.cities.changan.owner, "cao");
  assert.equal(taken.cities.changan.mode, "direct");
  const cancelled = taken.history.at(-1).entries.find(({ type, orderType }) => type === "notice" && orderType === "delegate-city");
  assert.match(cancelled.text, /目标城池已经易主/);
  const oldReport = legacySnapshot(world, taken, 13).history.at(-1);
  assert.ok(oldReport.decisions.every(({ orderType }) => orderType !== "delegate-city"));

  const request = legacySnapshot(world, state, 13);
  const oldChoice = factionPlans(world, era, request, "ma", { allowDomesticDelegation: false }).choices.find(({ order }) => !order);
  const decisions = [{ faction: "ma", source: "model", action: describeOrder(world, era, oldChoice.order),
    reason: "旧版拟令", strategy: { goal: oldChoice.goal } }];
  const replayed = advanceQuarter(world, state, legacyProposals(world, request, { decisions }, [{ key: "ma" }], 13));
  assert.equal(replayed.history.at(-1).decisions.find(({ faction }) => faction === "ma").source, "model");
  assert.equal(replayed.cities.changan.mode, "direct");
});
