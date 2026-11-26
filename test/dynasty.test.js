import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { advanceQuarter, createGame, decodeSave, eraByYear, firstCity, forceTotals, gameOutcome, playableFactions, queueOrder } from "../dist/engine.js";
import { dynastyNotices, dynastyPolicy, dynastyProvinces, enableDynasty, orderJurisdiction, saveDynastyPolicy } from "../dist/dynasty.js";
import { authorizeProvince, commissionProgram, dispatchCivilSupply, supplyTrace } from "../dist/dynasty-economy.js";
import { dynastyPass, proposeDynastyTreaty, renegotiateDynastyTreaty } from "../dist/dynasty-treaties.js";
import { isHostile } from "../dist/diplomacy.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const fresh = () => createGame(world, 199, "cao", { dynasty: true });
const verify = (state) => assert.deepEqual(readGameRecord(world, createSaveBackup({ state, selected: firstCity(world, state) })).state, state);

test("national projects have real milestones, can be delayed by emergency deferral, and can relocate a capital", () => {
  let state = fresh();
  state.factions.cao.treasury = state.factions.cao.grain = 700;
  const old = firstCity(world, state);
  const city = old === "xu" ? "luoyang" : "xu";
  state = commissionProgram(world, state, { city, kind: "capital", money: 136, grain: 56 });
  state = saveDynastyPolicy(state, { ...dynastyPolicy(state), priority: "relief", money: 0 });
  state = advanceQuarter(world, state);
  assert.equal(state.dynasty.programs[0].made, 0);
  assert.match(state.dynasty.programs[0].last, /调拨/);
  state = saveDynastyPolicy(state, { ...dynastyPolicy(state), priority: "growth", money: 50 });
  for (let quarter = 0; quarter < 8; quarter++) state = advanceQuarter(world, state);
  const works = state.dynasty.programs[0];
  assert.equal(works.status, "complete");
  assert.equal(works.spentMoney, 136);
  assert.equal(works.spentGrain, 56);
  assert.equal(firstCity(world, state), city);
  verify(state);
});

test("delegated grain actually leaves a warehouse, travels, and enters the intended destination", () => {
  let state = fresh();
  state.grand.depots.xu = 60;
  const before = state.grand.depots.luoyang ?? 0;
  assert.equal(supplyTrace(world, state, "luoyang").status, "stores");
  state = dispatchCivilSupply(world, state, "luoyang");
  const freight = state.dynasty.convoys[0];
  assert.ok(freight.route.length >= 2);
  assert.equal(state.grand.depots.xu, 42);
  assert.equal(supplyTrace(world, state, "luoyang").status, "enroute");
  for (let quarter = 0; quarter < freight.route.length; quarter++) state = advanceQuarter(world, state);
  assert.equal(state.dynasty.convoys[0].status, "delivered");
  assert.equal(state.grand.depots.luoyang, before + 18);
  assert.ok(state.dynasty.timelines.some(({ freights }) => freights.length));
  verify(state);
});

test("treasury defaults affect payments without retroactively resetting legacy armed and delegated state", () => {
  const legacy = createGame(world, 199, "cao", { highCommand: true });
  legacy.treaties.push({ sides: ["cao", "yuan"], kind: "alliance", expires: 4 });
  verify(legacy);
  let state = enableDynasty(legacy);
  const { dynasty, ...rest } = state;
  assert.deepEqual(rest, legacy);
  state = proposeDynastyTreaty(world, state, { to: "biao", seasons: 5, payment: 18, passage: true, defense: false, cede: null, post: null });
  state = advanceQuarter(world, state);
  assert.equal(state.dynasty.treaties[0].status, "active");
  assert.equal(isHostile(state, "cao", "biao"), false);
  assert.equal(dynastyPass(state, "cao", "biao"), true);
  state = advanceQuarter(world, state);
  assert.equal(state.history.at(-1).finance.dynasty.out.treasury, 18);
  assert.equal(state.dynasty.treaties[0].paid, 18);
  state = saveDynastyPolicy(state, { ...dynastyPolicy(state), moneyFloor: 999 });
  state = advanceQuarter(world, state);
  assert.equal(state.dynasty.treaties[0].missed, 1);
  assert.ok(dynastyNotices(state).some(({ kind }) => kind === "treaty"));
  state = renegotiateDynastyTreaty(world, state, state.dynasty.treaties[0].id,
    { seasons: 7, payment: 7, passage: false, defense: true, cede: null, post: null });
  assert.deepEqual(state.dynasty.treaties.map(({ status }) => status), ["breached", "offered"]);
  verify(state);
});

test("local refusal reduces income and blocks ordinary levy, while the realm can pay to defuse it", () => {
  let state = fresh();
  state.factions.cao.treasury = state.factions.cao.grain = 500;
  const province = dynastyProvinces(world, state)[0];
  state = authorizeProvince(world, state, { region: province.region, steward: null, goal: "relief", money: 0, grain: 0,
    dispatch: true, appoint: false, mode: "delegate" });
  state.dynasty.provinces.cao = { [province.region]: { authority: 10, conflict: 56, stage: "arrears", pending: null } };
  state.polity.provinces[province.key] = { pressure: 60, warning: null, crisis: null };
  for (const city of province.cities) state.realm.cities[city].welfare = 53;
  state = advanceQuarter(world, state);
  const city = province.cities.find((key) => state.cities[key].owner === "cao");
  assert.equal(state.dynasty.withheld[city], "refusal");
  const normal = structuredClone(state);
  normal.dynasty.withheld = {};
  assert.ok(forceTotals(state, "cao").treasury < forceTotals(normal, "cao").treasury);
  assert.throws(() => queueOrder(world, state, { type: "recruit", city }), /拒绝征募/);
  state = orderJurisdiction(world, state, province.region, "relieve");
  state = advanceQuarter(world, state);
  assert.notEqual(state.dynasty.withheld[city], "refusal");
  assert.equal(state.dynasty.provinces.cao[province.region].pending, null);
  verify(state);
});

test("each AI receives its own eligible national and treaty options, while invalid output falls back", async () => {
  let state = fresh();
  for (let quarter = 0; quarter < 4; quarter++) state = advanceQuarter(world, state);
  state = proposeDynastyTreaty(world, state, { to: "biao", seasons: 5, payment: 18, passage: true, defense: true, cede: null, post: null });
  const received = new Map();
  const models = { client: () => ({ decide: async (messages) => {
    const prompt = messages[1].content;
    const owner = prompt.split(" · ")[0];
    received.set(owner, prompt);
    if (owner === "袁绍") return { choice: "bad" };
    const choice = prompt.match(/^([0-9]+) /m)?.[1];
    return { choice, reason: "独立决策", dynastyAgenda: "G8-relief", settlement: "P" + state.dynasty.treaties[0].id + "-no" };
  } }) };
  const planner = createPlanner({ models, timeoutMs: 500 });
  const result = await planner.plan(world, state);
  assert.equal(result.biao.dynastyAgenda, "G8-relief");
  assert.ok(result.biao.settlement?.endsWith("-no"));
  assert.equal(result.yuan.source, "fallback");
  assert.ok(received.get("刘表").includes("和约候选"));
  assert.ok(!received.get("袁绍").includes("和约候选"));
  state = advanceQuarter(world, state, result);
  assert.equal(state.dynasty.treaties[0].status, "rejected");
  verify(state);
});

for (const year of [184, 190, 199, 208, 219, 234, 262, 265]) {
  const era = eraByYear(world, year);
  const candidates = playableFactions(era);
  for (const faction of [candidates[0], candidates.at(-1)]) {
    test(era.year + " " + faction.key + " completes a 100-quarter soak or reaches a normal outcome", (t) => {
      let state = createGame(world, era.year, faction.key, { dynasty: true });
      const cityKeys = Object.keys(state.cities).sort();
      assert.equal(cityKeys.length, 44);
      for (let quarter = 0; quarter < 100 && gameOutcome(state) === "ongoing"; quarter++) {
        state = advanceQuarter(world, state);
        assert.deepEqual(Object.keys(state.cities).sort(), cityKeys);
        decodeSave(world, JSON.stringify(state));
        if (quarter % 12 === 0) verify(state);
      }
      verify(state);
      t.diagnostic("季数 " + state.turn + " · " + gameOutcome(state));
    });
  }
}
