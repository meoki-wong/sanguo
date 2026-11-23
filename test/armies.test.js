import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { armyByOfficer, armyStatus, commandArmy, mobilizationQuote } from "../dist/armies.js";
import { advanceQuarter, appoint, createGame, decodeSave, forecastAttack, forecastFinance, playableFactions, queueOrder, transferOfficer } from "../dist/engine.js";
import { legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { factionPlans } from "../dist/strategy.js";
import { createPlanner } from "../ai.mjs";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios.find(({ year }) => year === 199);

function resting(player) {
  return Object.fromEntries(playableFactions(era).filter(({ key }) => key !== player)
    .map(({ key }) => [key, { source: "model", order: null, reason: "等待" }]));
}

function setup() {
  const state = createGame(world, 199, "cao");
  Object.assign(state.cities.changan, { troops: 0, defense: 0 });
  return state;
}

function reload(state) {
  const record = { state, selected: "luoyang" };
  const loaded = readGameRecord(world, createSaveBackup(record));
  assert.deepEqual(loaded, record);
  return loaded.state;
}

test("Luoyang army mobilizes, survives a save, takes Chang'an and garrisons without duplicating troops", () => {
  const initial = setup();
  const order = { type: "mobilize", from: "luoyang", to: "changan", troops: 1000, officer: "cao-1" };
  const quote = mobilizationQuote(world, initial, "cao", order);
  assert.deepEqual(quote.route, ["luoyang", "changan"]);
  assert.equal(quote.carried, 20);
  assert.equal(quote.quarters, 3);
  const queued = queueOrder(world, initial, order);
  const first = reload(advanceQuarter(world, queued, resting("cao")));
  assert.equal(armyByOfficer(first, order.officer).phase, "muster");
  assert.equal(first.cities.luoyang.troops, initial.cities.luoyang.troops - order.troops);
  assert.equal(first.stations[order.officer], null);
  assert.throws(() => appoint(world, first, "luoyang", "commander", order.officer), /率领军团/);
  assert.throws(() => transferOfficer(world, first, order.officer, "xu"), /率领军团/);
  assert.equal(legacySnapshot(world, queued, 20).orders.length, 0);
  const second = advanceQuarter(world, first, resting("cao"));
  assert.equal(armyByOfficer(second, order.officer).phase, "march");
  const third = reload(advanceQuarter(world, second, resting("cao")));
  assert.equal(armyByOfficer(third, order.officer).phase, "secured");
  assert.equal(third.cities.changan.owner, "cao");
  assert.equal(third.cities.changan.occupation, 2);
  assert.equal(third.cities.changan.troops, 400);
  const captured = third.history.at(-1).entries.find(({ type }) => type === "capture");
  assert.equal(captured.battle.occupation.inArmy, 350);
  assert.equal(third.cities.changan.troops + armyByOfficer(third, order.officer).troops, 750);
  const old = legacySnapshot(world, third, 20);
  assert.equal(old.armies, undefined);
  assert.equal(old.history.at(-1).entries.find(({ type }) => type === "capture").battle.occupation.garrison, 750);
  assert.doesNotThrow(() => decodeSave(world, JSON.stringify(old)));
  const stationed = commandArmy(world, third, order.officer, { type: "garrison" });
  assert.equal(stationed.cities.changan.troops, 750);
  assert.equal(stationed.stations[order.officer], "changan");
  assert.equal(stationed.armies, undefined);
  const restored = advanceQuarter(world, stationed, resting("cao"));
  assert.equal(restored.cities.changan.occupation, 1);
});

test("the loss of the actual depot stops an army, which can switch supply or retreat along friendly roads", () => {
  let state = setup();
  const leader = "cao-roster-2";
  Object.assign(state.cities.puyang, { owner: "yuan", troops: 3500 });
  state.cities.changan.owner = "yuan";
  state.stations["yuan-roster-4"] = "puyang";
  for (const officer of era.officers) if (officer.faction === "cao" && state.stations[officer.key] === "puyang") state.stations[officer.key] = "xu";
  for (const officer of era.officers) if (officer.faction === "ma" && state.stations[officer.key] === "changan") state.stations[officer.key] = "tianshui";
  state.cities.chenliu.troops = 2100;
  state = queueOrder(world, state, { type: "mobilize", from: "chenliu", to: "changan", officer: leader, troops: 1200 });
  for (let season = 0; season < 3; season += 1) state = advanceQuarter(world, state, resting("cao"));
  assert.equal(armyByOfficer(state, leader).location, "luoyang");
  const plan = factionPlans(world, era, state, "yuan");
  assert.equal(plan.supplyCut.target, "chenliu");
  assert.equal(plan.suggested.order.type, "attack");
  const cut = reload(advanceQuarter(world, state, { ...resting("cao"), yuan: { source: "rules" } }));
  const halted = armyByOfficer(cut, leader);
  assert.equal(cut.cities.chenliu.owner, "yuan");
  assert.equal(halted.location, "luoyang");
  assert.equal(halted.phase, "hold");
  assert.match(cut.history.at(-1).decisions.find(({ faction }) => faction === "yuan").reason, /切断补给/);
  assert.equal(armyStatus(world, cut, halted).supply, null);
  assert.match(cut.history.at(-1).entries.find(({ type }) => type === "army").text, /补给中断/);
  assert.throws(() => commandArmy(world, cut, leader, { type: "march", depot: "chenliu", target: "changan" }), /补给城/);
  const rerouted = commandArmy(world, cut, leader, { type: "march", depot: "xu", target: "changan" });
  assert.deepEqual(armyStatus(world, rerouted, armyByOfficer(rerouted, leader)).supply, ["xu", "luoyang"]);
  assert.equal(advanceQuarter(world, rerouted, resting("cao")).cities.changan.owner, "cao");

  const withdrawn = commandArmy(world, cut, leader, { type: "retreat", target: "xu" });
  const last = reload(advanceQuarter(world, withdrawn, resting("cao")));
  assert.equal(last.stations[leader], "xu");
  assert.equal(last.armies, undefined);
  assert.equal(last.cities.xu.troops, cut.cities.xu.troops + (halted.grain < 12 ? 1056 : 1200));
});

test("detached provisions and returned grain reconcile the quarterly forecast, ledger and import", () => {
  const initial = setup();
  const queued = queueOrder(world, initial, { type: "mobilize", from: "luoyang", to: "changan", officer: "cao-1", troops: 700 });
  let state = advanceQuarter(world, queued, resting("cao"));
  const returning = commandArmy(world, state, "cao-1", { type: "retreat", target: "luoyang" });
  const forecast = forecastFinance(world, returning);
  state = reload(advanceQuarter(world, returning, resting("cao")));
  const actual = state.history.at(-1).finance;
  assert.equal(actual.armyReturns, 14);
  assert.deepEqual(actual.closing, forecast.closing);
  assert.equal(forecast.armyReturns, 14);
  assert.equal(state.cities.luoyang.troops, initial.cities.luoyang.troops);
  assert.equal(state.armies, undefined);
});

test("a held army defends the adjacent city and takes its own share of losses", () => {
  let state = createGame(world, 199, "cao");
  state = queueOrder(world, state, { type: "mobilize", from: "luoyang", to: "changan", officer: "cao-1", troops: 1000 });
  state = advanceQuarter(world, state, resting("cao"));
  state.strategies.ma = { type: "expand", city: "changan", target: "luoyang", threshold: 1, since: state.turn };
  const attack = { type: "attack", from: "changan", to: "luoyang", troops: 600, officer: "ma-roster-0" };
  const before = forecastAttack(era, state, attack, "ma").defense;
  state = commandArmy(world, state, "cao-1", { type: "hold" });
  assert.ok(forecastAttack(era, state, attack, "ma").defense > before + 1000);
  const oldGarrison = state.cities.luoyang.troops;
  const settled = reload(advanceQuarter(world, state, { ...resting("cao"), ma: { source: "model", reason: "试攻", order: attack } }));
  const battle = settled.history.at(-1).entries.find((entry) => entry.type === "battle").battle;
  assert.equal(battle.defender.troops, oldGarrison + 1000);
  assert.ok(armyByOfficer(settled, "cao-1").troops < 1000);
  assert.equal(battle.defender.casualties, oldGarrison + 1000 - settled.cities.luoyang.troops - armyByOfficer(settled, "cao-1").troops);
  const resumed = commandArmy(world, settled, "cao-1", { type: "march", target: "changan", depot: "luoyang" });
  assert.equal(armyByOfficer(resumed, "cao-1").phase, "muster");
});

test("independent model opponents can select a multi-city army and mobilize under the same rules", async () => {
  const state = createGame(world, 199, "yuan");
  state.turn = 4;
  state.cities.xu.troops = 4300;
  state.cities.luoyang.troops = 300;
  state.factions.cao.grain = 140;
  state.strategies.cao = { type: "expand", city: "luoyang", target: "changan", threshold: 1, since: 4 };
  const models = { client: () => ({ decide: async (messages) => {
    const content = messages[1].content;
    const candidates = content.split("\n");
    const option = content.startsWith("曹操 ·") ? candidates.find((line) => /^\d+ .*集结 .*人，目标长安/.test(line))
      : candidates.find((line) => /^\d+ 休整/.test(line));
    assert.ok(option, content);
    return { choice: option.split(" ")[0], reason: "布置远征" };
  } }) };
  const proposals = await createPlanner({ models }).plan(world, state);
  const selection = proposals.cao;
  assert.equal(selection.order?.type, "mobilize");
  assert.equal(selection.order.from, "xu");
  const next = reload(advanceQuarter(world, state, proposals));
  const army = armyByOfficer(next, selection.order.officer);
  assert.equal(army.faction, "cao");
  assert.equal(army.location, "xu");
  const report = next.history.at(-1);
  const receipt = report.decisions.find(({ faction }) => faction === "cao");
  assert.equal(receipt.orderType, "mobilize");
  assert.equal(report.entries[receipt.entryIndex].city, "xu");
});
