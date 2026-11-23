import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, cityReserve, createGame, decodeSave, forecastFinance, forecastOrderSteps, playableFactions, previewOrders, queueOrder,
  replaceOrders, transferGrain, transferRoutes, transferRoutesTo, validateOrder,
} from "../dist/engine.js";
import { legacyProposals, legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { planJointOrders } from "../dist/joint-orders.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const opponents = playableFactions(era).filter(({ key }) => key !== "cao");
const rest = Object.fromEntries(opponents.map(({ key }) => [key, { source: "model", order: null }]));

test("fixed friendly routes charge per segment, preserve intermediate reserves and enable a following attack", () => {
  const state = createGame(world, 199, "cao");
  state.cities.puyang.troops = 1500;
  state.cities.luoyang.troops = 800;
  const route = transferRoutes(world, state, "puyang").find((path) => path.at(-1) === "luoyang");
  assert.deepEqual(route, ["puyang", "chenliu", "luoyang"]);
  const transfer = { type: "transfer", from: "puyang", to: "luoyang", troops: 1000, route };
  const attack = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1550 };
  assert.equal(transferGrain(transfer), 20);
  assert.throws(() => queueOrder(world, state, attack), /留守/);
  const relayed = queueOrder(world, state, transfer);
  const queued = queueOrder(world, relayed, attack);
  route[1] = "xinye";
  assert.equal(queued.orders[0].route[1], "chenliu");
  assert.throws(() => replaceOrders(world, queued, [attack, queued.orders[0]]), /留守/);
  assert.equal(previewOrders(world, queued).cities.luoyang.troops, cityReserve);
  assert.equal(previewOrders(world, queued).cities.chenliu.troops, state.cities.chenliu.troops);
  const snapshot = structuredClone(queued);
  const [supportStep, attackStep] = forecastOrderSteps(world, queued);
  assert.deepEqual(supportStep.spent, { treasury: 0, grain: 20 });
  assert.deepEqual(supportStep.garrisons.map(({ key, before, after }) => [key, before, after]),
    [["puyang", 1500, 500], ["luoyang", 800, 1800]]);
  assert.equal(supportStep.prerequisite, "");
  assert.deepEqual(attackStep.spent, { treasury: 0, grain: 16 });
  assert.equal(attackStep.entry.type, "capture");
  assert.equal(attackStep.garrisons[1].nextOwner, "cao");
  assert.match(attackStep.prerequisite, /留守/);
  assert.deepEqual(queued, snapshot);
  const finance = forecastFinance(world, queued);
  const settled = advanceQuarter(world, queued, rest);
  assert.equal(settled.cities.changan.owner, "cao");
  assert.equal(settled.cities.puyang.troops, 500);
  assert.deepEqual(settled.history.at(-1).finance, finance);
  const report = settled.history.at(-1).entries.find(({ orderType }) => orderType === "transfer");
  assert.match(report.text, /经陈留，支出 20 粮/);
  const backup = createSaveBackup({ state: queued, selected: "puyang" });
  assert.deepEqual(readGameRecord(world, backup).state, queued);
});

test("no route is chosen through foreign holdings and a same-quarter capture can open a route", () => {
  const state = createGame(world, 199, "cao");
  assert.ok(!transferRoutes(world, state, "xu").some((route) => route.at(-1) === "changan"));
  const attack = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1292 };
  const queued = queueOrder(world, state, attack);
  const planned = previewOrders(world, queued);
  const route = transferRoutes(world, planned, "xu").find((route) => route.at(-1) === "changan");
  assert.deepEqual(route, ["xu", "luoyang", "changan"]);
  const supply = { type: "transfer", from: "xu", to: "changan", troops: 301, route };
  assert.equal(transferGrain(supply), 8);
  assert.throws(() => validateOrder(world, state, "cao", supply), /路线中断/);
  assert.throws(() => validateOrder(world, planned, "cao", { ...supply, route: ["xu", "puyang", "changan"] }), /路线无效/);
  assert.throws(() => validateOrder(world, planned, "cao", { ...supply, route: ["xu", "luoyang", "xu", "changan"] }), /两至三段/);
  const final = queueOrder(world, queued, supply);
  assert.equal(previewOrders(world, final).cities.changan.troops, planned.cities.changan.troops + supply.troops);
  const single = { type: "transfer", from: "xu", to: "luoyang", troops: 301 };
  assert.equal(transferGrain(single), 4);
  assert.deepEqual(decodeSave(world, JSON.stringify(queueOrder(world, state, single))).orders, [single]);
});

test("the whole transfer cancels without resource or troop changes if a named waypoint falls", () => {
  const initial = createGame(world, 199, "cao");
  initial.turn = era.factions.findIndex(({ key }) => key === "ma");
  initial.cities.luoyang.troops = 350;
  initial.cities.changan.troops = 3200;
  initial.cities.tianshui.commander = null;
  initial.stations["ma-1"] = "changan";
  initial.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: initial.turn, threshold: 1 };
  const route = transferRoutes(world, initial, "chenliu").find((route) => route.at(-1) === "wan");
  assert.deepEqual(route, ["chenliu", "luoyang", "wan"]);
  const order = { type: "transfer", from: "chenliu", to: "wan", troops: 300, route };
  const queued = queueOrder(world, initial, order);
  const settled = advanceQuarter(world, queued);
  assert.equal(settled.cities.luoyang.owner, "ma");
  assert.deepEqual(transferRoutes(world, settled, "chenliu").find((path) => path.at(-1) === "wan"), ["chenliu", "xu", "wan"]);
  const baseline = advanceQuarter(world, initial);
  assert.deepEqual(settled.cities, baseline.cities);
  assert.deepEqual(settled.factions, baseline.factions);
  assert.equal(settled.history.at(-1).finance.orders.grain, 0);
  assert.match(settled.history.at(-1).entries.find(({ type, orderType }) => type === "notice" && orderType === "transfer").text,
    /洛阳已经易主，跨城调兵路线中断/);
});

test("an older service can decide for opponents while the whole player queue settles locally", () => {
  const state = createGame(world, 199, "cao");
  const route = ["xu", "chenliu", "xiaopei", "xiapi"];
  const order = { type: "transfer", from: "xu", to: "xiapi", troops: 301, route };
  assert.equal(transferGrain(order), 12);
  const queued = queueOrder(world, state, order);
  const request = legacySnapshot(world, queued, 12);
  assert.deepEqual(request.orders, []);
  assert.deepEqual(legacySnapshot(world, queued, 13).orders, [order]);
  assert.deepEqual(queued.orders, [order]);
  const oldReply = advanceQuarter(world, request, rest);
  const replayed = advanceQuarter(world, queued, legacyProposals(world, request, oldReply.history.at(-1), opponents, 12));
  assert.equal(replayed.cities.xiapi.troops, state.cities.xiapi.troops + order.troops);
  assert.equal(replayed.history.at(-1).finance.orders.grain, 12);
  assert.ok(replayed.history.at(-1).decisions.every(({ source }) => source === "model"));
});

test("frontline routes use the same fixed road choices as the origin selector in every opening", () => {
  for (const scenario of world.scenarios) {
    for (const { key } of playableFactions(scenario)) {
      const state = createGame(world, scenario.year, key);
      const owned = world.cities.filter(({ key: city }) => state.cities[city].owner === key);
      const from = new Map(owned.map(({ key: city }) => [city, transferRoutes(world, state, city)]));
      for (const { key: city } of owned) {
        const expected = owned.flatMap(({ key }) => from.get(key).filter((route) => route.at(-1) === city));
        assert.deepEqual(transferRoutesTo(world, state, city), expected);
      }
    }
  }
});

test("a joint draft stays atomic on enqueue and a lost road can cancel both dependent orders", () => {
  const state = createGame(world, 199, "cao");
  state.turn = era.factions.findIndex(({ key }) => key === "ma");
  state.cities.luoyang.troops = 350;
  state.cities.changan.troops = 3200;
  state.cities.wan.troops = 200;
  state.cities.chenliu.troops = 1250;
  state.cities.tianshui.commander = null;
  state.stations["ma-1"] = "changan";
  state.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: state.turn, threshold: 1 };
  const order = {
    from: "wan", target: "changan", officer: "cao-roster-5", support: "chenliu",
    supportRoute: ["chenliu", "luoyang", "wan"], supportTroops: 750, attackTroops: 700,
  };
  const { queued } = planJointOrders(world, state, order);
  assert.deepEqual(state.orders, []);
  const [transfer, attack] = queued.orders;
  assert.throws(() => replaceOrders(world, queued, [attack, transfer]), /留守/);
  const reloaded = readGameRecord(world, createSaveBackup({ state: queued, selected: "wan" })).state;
  assert.deepEqual(reloaded, queued);
  assert.deepEqual(legacySnapshot(world, reloaded, 12).orders, []);
  const after = advanceQuarter(world, reloaded);
  const report = after.history.at(-1);
  const cancelled = report.entries.filter(({ type, faction }) => type === "notice" && faction === "cao");
  assert.deepEqual(cancelled.map(({ orderType }) => orderType), ["transfer", "attack"]);
  assert.match(cancelled[0].text, /洛阳已经易主/);
  assert.match(cancelled[1].text, /留守 250 人/);
  assert.equal(report.finance.orders.grain, 0);
  assert.equal(after.cities.wan.troops, state.cities.wan.troops);
});
