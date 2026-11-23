import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advanceQuarter, createGame, forceTotals, playableFactions } from "../dist/engine.js";
import { filteredReports, opponentBrief, opponentHoldings, territoryChanges } from "../dist/chronicle.js";
import { legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { factionPlans } from "../dist/strategy.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const era = world.scenarios[0];
const rest = Object.fromEntries(playableFactions(era).filter(({ key }) => key !== "cao")
  .map(({ key }) => [key, { source: "model", order: null, reason: "保留钱粮" }]));

test("the opening briefing uses the faction's actual territory without creating a strategy or archive", () => {
  for (const scenario of world.scenarios) {
    const [player, opponent] = playableFactions(scenario);
    const state = createGame(world, scenario.year, player.key);
    const brief = opponentBrief(world, state, opponent.key);
    assert.equal(brief.opponent, opponent);
    assert.equal(brief.cities, forceTotals(state, opponent.key).cities);
    assert.equal(brief.troops, forceTotals(state, opponent.key).troops);
    assert.equal(state.cities[brief.seat].owner, opponent.key);
    assert.equal(brief.treaty, null);
    assert.equal(brief.strategy, null);
    assert.equal(brief.latest, null);
    assert.equal(opponentBrief(world, state, player.key), null);
    assert.equal(opponentBrief(world, state, "not-a-faction"), null);
  }
  const state = createGame(world, 199, "cao");
  state.cities.tianshui.owner = "cao";
  const brief = opponentBrief(world, state, "ma");
  assert.notEqual(brief.seat, "tianshui");
  assert.equal(state.cities[brief.seat].owner, "ma");
});

test("current relations and strategic progress react to treaties, completion and expiration", () => {
  const state = createGame(world, 199, "cao");
  state.turn = 1;
  state.strategies.ma = { type: "expand", since: 0, city: "changan", target: "luoyang", threshold: 1 };
  assert.equal(opponentBrief(world, state, "ma").strategy.status, "active");
  assert.equal(opponentBrief(world, state, "ma").strategy.progress, 0);
  state.treaties = [{ sides: ["cao", "ma"], kind: "truce", expires: 3 }];
  assert.equal(opponentBrief(world, state, "ma").treaty.expires - state.turn, 2);
  assert.equal(opponentBrief(world, state, "ma").strategy, null);
  state.turn = 3;
  assert.equal(opponentBrief(world, state, "ma").treaty, null);
  assert.equal(opponentBrief(world, state, "ma").strategy, null);
  state.strategies.ma = { type: "economy", since: 2, threshold: state.factions.ma.grain + 100 };
  assert.equal(opponentBrief(world, state, "ma").strategy.progress, state.factions.ma.grain);
  state.factions.ma.grain += 100;
  assert.equal(opponentBrief(world, state, "ma").strategy, null);
});

test("current opponent holdings include all and only controlled cities and filter before sorting", () => {
  for (const scenario of world.scenarios) {
    const [player, opponent] = playableFactions(scenario);
    const state = createGame(world, scenario.year, player.key);
    const { total, matching } = opponentHoldings(world, state, opponent.key);
    assert.equal(total, forceTotals(state, opponent.key).cities);
    assert.equal(matching.length, total);
    assert.ok(matching.every(({ city, holding }) => holding === state.cities[city.key] && holding.owner === opponent.key));
    assert.deepEqual(matching.map(({ city }) => city.key), world.cities.filter(({ key }) => state.cities[key].owner === opponent.key).map(({ key }) => key));
  }

  const state = createGame(world, 199, "cao");
  const byTroops = opponentHoldings(world, state, "ma", { sort: "troops" });
  assert.deepEqual(byTroops.matching.map(({ city }) => city.key), ["tianshui", "changan", "anding", "guzang"]);
  const found = opponentHoldings(world, state, "ma", { query: " 安 ", sort: "troops" });
  assert.equal(found.total, 4);
  assert.deepEqual(found.matching.map(({ city }) => city.key), ["changan", "anding"]);
  assert.deepEqual(opponentHoldings(world, state, "ma", { query: "洛阳" }), { total: 4, matching: [] });
  state.cities.tianshui.owner = "cao";
  const lostCapital = opponentHoldings(world, state, "ma", { sort: "troops" });
  assert.equal(lostCapital.total, 3);
  assert.deepEqual(lostCapital.matching.map(({ city }) => city.key), ["changan", "anding", "guzang"]);
  assert.deepEqual(opponentHoldings(world, state, "ma", { query: "天水" }), { total: 3, matching: [] });
});

test("the latest record stays scoped to the selected faction, including after elimination and save recovery", () => {
  const state = createGame(world, 199, "cao");
  Object.assign(state.cities.changan, { troops: 500, occupation: 2, farming: 4, commerce: 3 });
  state.strategies.ma = { type: "economy", since: 0, threshold: state.factions.ma.grain + 1000 };
  const choice = factionPlans(world, era, state, "ma").suggested;
  const first = advanceQuarter(world, state, { ...rest, ma: { ...choice, source: "model", reason: "恢复长安税粮" } });
  const current = opponentBrief(world, first, "ma");
  assert.equal(current.strategy.status, "active");
  assert.equal(current.latest.entry.source, "model");
  assert.equal(current.latest.receipt.orderType, "appoint-governor");
  assert.equal(current.latest.receipt.city, "changan");
  assert.equal(opponentBrief(world, first, "yuan").latest.receipt, null);

  const eliminated = structuredClone(first);
  for (const city of Object.values(eliminated.cities)) {
    if (city.owner === "ma") Object.assign(city, { owner: "cao", governor: null, commander: null, mode: "direct" });
  }
  for (const { key, faction } of era.officers) {
    if (faction === "ma") eliminated.stations[key] = null;
  }
  const later = advanceQuarter(world, eliminated, rest);
  const restored = readGameRecord(world, createSaveBackup({ state: later, selected: "luoyang" })).state;
  const brief = opponentBrief(world, restored, "ma");
  assert.equal(brief.cities, 0);
  assert.equal(brief.troops, 0);
  assert.equal(brief.seat, null);
  assert.equal(brief.strategy, null);
  assert.equal(brief.latest.turn, 1);
  assert.equal(brief.latest.receipt.city, "changan");
  assert.equal(opponentBrief(world, restored, "yuan").latest.turn, 2);
  assert.deepEqual(brief.latest, filteredReports(restored.history, { section: "plans", turn: "all", faction: "ma" })[0]);

  const old = opponentBrief(world, legacySnapshot(world, restored, 18), "ma");
  assert.equal(old.latest.entry.action, brief.latest.entry.action);
  assert.equal(Object.hasOwn(old.latest, "receipt"), false);
});

test("the exact same-city captures remain in settlement order after elimination and reloading", () => {
  const state = createGame(world, 199, "cao");
  state.turn = era.factions.findIndex(({ key }) => key === "ma");
  state.cities.luoyang.troops = 350;
  state.cities.changan.troops = 2300;
  state.cities.ye.troops = 5200;
  state.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: state.turn, threshold: 1 };
  state.strategies.yuan = { type: "expand", city: "ye", target: "luoyang", since: state.turn, threshold: 1 };
  const settled = advanceQuarter(world, state);
  const [gain, loss] = settled.history.at(-1).entries.filter(({ type, city }) => type === "capture" && city === "luoyang");
  const expected = [
    { kind: "loss", other: "yuan", entry: loss, turn: settled.turn },
    { kind: "gain", other: "cao", entry: gain, turn: settled.turn },
  ];
  assert.deepEqual(territoryChanges(settled.history, "ma"), expected);
  assert.equal(gain.battle.from, "changan");
  assert.equal(loss.battle.from, "ye");
  assert.equal(opponentHoldings(world, settled, "ma", { query: "洛阳" }).matching.length, 0);
  const [occupied] = opponentHoldings(world, settled, "yuan", { query: "洛阳" }).matching;
  assert.equal(occupied.holding.occupation, 2);
  assert.equal(occupied.holding.governor, null);
  assert.equal(occupied.holding.commander, loss.battle.personnel.attacker);

  const old = legacySnapshot(world, settled, 9);
  assert.deepEqual(territoryChanges(old.history, "ma").map(({ kind, entry }) => [kind, entry.battle]),
    [["loss", undefined], ["gain", undefined]]);

  for (const city of Object.values(settled.cities)) {
    if (city.owner === "ma") Object.assign(city, { owner: "cao", governor: null, commander: null, mode: "direct" });
  }
  for (const { key, faction } of era.officers) if (faction === "ma") settled.stations[key] = null;
  const later = advanceQuarter(world, settled, rest);
  const restored = readGameRecord(world, createSaveBackup({ state: later, selected: "luoyang" })).state;
  assert.equal(opponentBrief(world, restored, "ma").cities, 0);
  assert.deepEqual(opponentHoldings(world, restored, "ma"), { total: 0, matching: [] });
  assert.deepEqual(territoryChanges(restored.history, "ma"), expected);
});
