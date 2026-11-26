import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceQuarter, appoint, availableAttackers, cityIncome, cityReserve, createGame, decodeSave,
  delegateCities, forceTotals, forecastAttack, forecastDelegation, forecastFinance, gameOutcome, playableFactions, postingOf, previewOrders, queueOrder, replaceOrders,
  respondToTreaty, sendTreatyOffer, setGovernance, transferOfficer, validateOrder,
} from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { allianceIncome, treatyWith } from "../dist/diplomacy.js";
import { scenarioObjective } from "../dist/objectives.js";
import { filteredReports } from "../dist/chronicle.js";
import { frontierCities, frontierIntel } from "../dist/frontier.js";
import { jointAttackLimit, jointOptions, planJointOrders } from "../dist/joint-orders.js";
import { createSaveBackup, readGameRecord, saveFileLimit } from "../dist/saves.js";

const world = JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8"));

test("every playable start loads the same 44 cities, territory paths and a valid save", () => {
  assert.equal(world.cities.length, 44);
  assert.equal(new Set(world.cities.map(({ key }) => key)).size, 44);
  for (const era of world.scenarios) {
    assert.equal(Object.keys(era.zones).length, 44);
    assert.ok(Object.values(era.zones).every(Boolean));
    for (const faction of playableFactions(era)) {
      const game = createGame(world, era.year, faction.key);
      assert.ok(forceTotals(game, faction.key).cities > 0);
      assert.deepEqual(decodeSave(world, JSON.stringify(game)), game);
    }
  }
});

test("an appointment is exclusive and a delegated project settles once", () => {
  const initial = createGame(world, 199, "cao");
  assert.throws(() => setGovernance(initial, "luoyang", "delegated", "commerce"), /太守/);
  let game = appoint(world, initial, "luoyang", "governor", "cao-0");
  assert.throws(() => appoint(world, game, "xu", "governor", "cao-0"), /已有职务/);
  assert.throws(() => appoint(world, game, "changan", "commander", "cao-1"), /己方城池/);
  game = setGovernance(game, "luoyang", "delegated", "commerce");
  const before = game.cities.luoyang.commerce;
  const income = forceTotals(game, "cao");
  const next = advanceQuarter(world, game);
  assert.equal(game.cities.luoyang.commerce, before);
  assert.equal(next.cities.luoyang.commerce, before + 1);
  assert.equal(next.factions.cao.treasury, game.factions.cao.treasury + income.treasury - 15);
  assert.equal(next.factions.cao.grain, game.factions.cao.grain + income.grain);
  assert.equal(next.turn, 1);
  assert.ok(next.history[0].entries.some(({ type }) => type === "delegation"));
});

test("a delegation preview uses real staffing, queued spending, and selected city program costs", () => {
  const expanded = enrichWorld(world);
  let state = createGame(expanded, 199, "cao");
  state = appoint(expanded, state, "xu", "governor", "cao-0");
  state = delegateCities(expanded, state, ["puyang"], "farming", 22);
  state = queueOrder(expanded, state, { type: "recruit", city: "xu" });
  const cities = ["xu", "luoyang"];
  const snapshot = structuredClone(state);
  const forecast = forecastDelegation(expanded, state, cities, "recruit", 22);
  assert.deepEqual(state, snapshot);
  const settings = delegateCities(expanded, state, cities, "recruit", 22);
  const ledger = forecastFinance(expanded, settings);
  const byCity = Object.fromEntries(forecast.programs.map((program) => [program.city, program]));
  assert.deepEqual(forecast.closing, ledger.closing);
  assert.equal(byCity.xu.governor, "荀彧");
  assert.equal(byCity.xu.newGovernor, false);
  assert.equal(byCity.xu.result, "garrison");
  assert.equal(byCity.luoyang.newGovernor, true);
  assert.equal(byCity.luoyang.result, "completed");
  assert.equal(byCity.luoyang.action, "征募 600 人");
  assert.deepEqual(forecast.spent, byCity.luoyang.spent);
  assert.ok(ledger.delegation.treasury > forecast.spent.treasury);
  assert.equal(forecastDelegation(expanded, state, cities, "recruit", 0).programs.find(({ city }) => city === "luoyang").result, "budget");

  const fewStaff = createGame(world, 199, "cao");
  assert.throws(() => forecastDelegation(world, fewStaff, ["xu", "luoyang", "puyang", "xiaopei"], "recruit", 20), /待任官员不足/);
});

test("capture transfers the city and its income and moves the commander only once", () => {
  const era = world.scenarios[0];
  let game = createGame(world, 199, "cao");
  game = appoint(world, game, "luoyang", "commander", "cao-1");
  const force = game.cities.luoyang.troops - cityReserve;
  const attack = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: force };
  assert.throws(() => queueOrder(world, game, { ...attack, to: "chengdu" }), /相邻/);
  assert.throws(() => queueOrder(world, game, { ...attack, troops: force + 1 }), /留守/);
  assert.ok(forecastAttack(era, game, attack).wins);
  const ownBefore = forceTotals(game, "cao").cities;
  game = queueOrder(world, game, attack);
  assert.throws(() => appoint(world, game, "xu", "commander", "cao-1"), /职务|出征/);
  const next = advanceQuarter(world, game);
  assert.equal(game.cities.changan.owner, "ma");
  assert.equal(next.cities.changan.owner, "cao");
  assert.equal(forceTotals(next, "cao").cities, ownBefore + 1);
  assert.equal(next.cities.luoyang.troops, cityReserve);
  assert.equal(next.cities.changan.governor, null);
  assert.deepEqual(postingOf(next, "cao-1"), { city: "changan", role: "commander" });
  assert.equal(next.stations["cao-1"], "changan");
  assert.ok(Object.entries(next.stations).every(([key, city]) => !key.startsWith("ma-") || city !== "changan"));
  assert.equal(forceTotals(next, "cao").treasury, forceTotals(game, "cao").treasury + cityIncome(next.cities.changan).treasury);
  assert.deepEqual(next.orders, []);
  const capture = next.history[0].entries.find(({ type, faction }) => type === "capture" && faction === "cao");
  const { offense, defense } = forecastAttack(era, game, attack);
  const defender = game.cities.changan.troops;
  const retreat = world.cities.find(({ key }) => key !== capture.city && game.cities[key].owner === "ma").key;
  assert.deepEqual(capture.battle, {
    from: "luoyang",
    attacker: { faction: "cao", troops: force, strength: offense, casualties: Math.round(force * .25) },
    defender: { faction: "ma", troops: defender, strength: defense, casualties: Math.round(defender * .62) },
    personnel: { attacker: "cao-1", defender: null, relocated: [] },
    occupation: { garrison: next.cities.changan.troops, retreatTo: retreat },
  });
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);

  const corrupt = structuredClone(next);
  corrupt.cities.xu.governor = "cao-1";
  assert.throws(() => decodeSave(world, JSON.stringify(corrupt)), /职务冲突/);
});

test("held cities record the actual reinforced defenders and older battle text stays valid", () => {
  const expanded = enrichWorld(world);
  const state = createGame(expanded, 199, "cao");
  const era = expanded.scenarios[0];
  state.cities.luoyang.troops = 950;
  state.cities.changan.troops = 1900;
  state.cities.tianshui.commander = null;
  state.stations["ma-1"] = "changan";
  state.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: state.turn, threshold: 1 };
  const attack = { type: "attack", from: "changan", to: "luoyang", officer: "ma-1", troops: 1650 };
  assert.equal(forecastAttack(era, state, attack, "ma").wins, true);
  const queued = queueOrder(expanded, state, { type: "transfer", from: "xu", to: "luoyang", troops: 2000 });
  const projected = previewOrders(expanded, queued);
  const { offense, defense, wins } = forecastAttack(era, projected, attack, "ma");
  assert.equal(wins, false);
  const settled = advanceQuarter(expanded, queued);
  const fight = settled.history[0].entries.find(({ type, city }) => type === "battle" && city === "luoyang");
  const defending = projected.cities.luoyang.troops;
  const casualties = Math.round(defending * .22);
  assert.deepEqual(fight.battle, {
    from: "changan",
    attacker: { faction: "ma", troops: 1650, strength: offense, casualties: Math.round(1650 * .39) },
    defender: { faction: "cao", troops: defending, strength: defense, casualties },
    personnel: { attacker: "ma-1", defender: null },
  });
  assert.equal(settled.cities.luoyang.owner, "cao");
  assert.equal(settled.cities.luoyang.troops, defending - casualties);
  const backup = createSaveBackup({ state: settled, selected: "luoyang" });
  assert.deepEqual(readGameRecord(expanded, backup).state, settled);

  fight.battle.defender.casualties = defending + 1;
  assert.throws(() => decodeSave(expanded, JSON.stringify(settled)), /奏报/);
  delete fight.battle;
  delete fight.participants;
  for (const decision of settled.history[0].decisions) delete decision.entryIndex;
  assert.deepEqual(decodeSave(expanded, JSON.stringify(settled)), settled);
});

test("an existing save gains stations and keeps a pending expedition available", () => {
  const initial = createGame(world, 199, "cao");
  delete initial.stations;
  delete initial.orders;
  for (const city of Object.values(initial.cities)) {
    delete city.delegateBudget;
    delete city.occupation;
  }
  initial.order = { type: "attack", from: "luoyang", to: "changan", officer: "cao-0", troops: 600 };
  const expanded = enrichWorld(world);
  const restored = decodeSave(expanded, JSON.stringify(initial));
  assert.equal(restored.stations["cao-0"], "luoyang");
  assert.equal(restored.cities.luoyang.delegateBudget, null);
  assert.equal(restored.cities.luoyang.occupation, 0);
  assert.throws(() => transferOfficer(expanded, restored, "cao-0", "xu"), /出征/);
  const general = expanded.scenarios[0].officers.find(({ name }) => name === "张辽");
  const moved = transferOfficer(expanded, restored, general.key, "luoyang");
  assert.ok(availableAttackers(expanded.scenarios[0], moved, "cao", "luoyang").includes(general));
  assert.ok(!availableAttackers(expanded.scenarios[0], moved, "cao", "xu").includes(general));
});

test("the three-order queue reserves funds and troops as orders are added", () => {
  const state = createGame(world, 199, "cao");
  state.factions.cao.treasury = 40;
  state.factions.cao.grain = 50;
  const recruit = { type: "recruit", city: "xu" };
  const move = { type: "transfer", from: "xu", to: "luoyang", troops: 1000 };
  const first = queueOrder(world, queueOrder(world, state, recruit), recruit);
  assert.throws(() => queueOrder(world, first, recruit), /第 3 道政令.*征兵/);
  const full = queueOrder(world, first, move);
  assert.throws(() => queueOrder(world, full, move), /最多/);
  assert.equal(previewOrders(world, full).cities.xu.troops, state.cities.xu.troops + 200);
  assert.equal(previewOrders(world, full).factions.cao.grain, 16);
  assert.throws(() => replaceOrders(world, state, [move, { ...move, troops: 2000 }]), /留守/);
  assert.throws(() => replaceOrders(world, state, [{ ...move, to: "changan" }]), /己方城池/);
  assert.deepEqual(decodeSave(world, JSON.stringify(full)), full);
});

test("reinforcements enable an expedition that depends on their place in the queue", () => {
  let state = createGame(world, 199, "cao");
  state = appoint(world, state, "xu", "governor", "cao-0");
  state = setGovernance(state, "xu", "delegated", "farming", 22);
  state.cities.luoyang.troops = 800;
  const move = { type: "transfer", from: "xu", to: "luoyang", troops: 1400 };
  const attack = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1950 };
  assert.throws(() => queueOrder(world, state, attack), /留守/);
  state = queueOrder(world, queueOrder(world, state, move), attack);
  assert.throws(() => replaceOrders(world, state, [attack, move]), /第 1 道政令/);
  assert.throws(() => queueOrder(world, state, { ...attack, from: "changan", to: "tianshui" }), /只能领一次/);
  const settled = advanceQuarter(world, state);
  assert.equal(settled.cities.luoyang.troops, cityReserve);
  assert.equal(settled.cities.changan.owner, "cao");
  assert.equal(settled.cities.changan.commander, "cao-1");
  assert.equal(settled.cities.changan.occupation, 2);
  assert.equal(settled.cities.xu.farming, state.cities.xu.farming + 1);
  assert.equal(settled.factions.cao.grain, state.factions.cao.grain + forceTotals(state, "cao").grain - 34);
});

test("occupied cities need a garrison and a governor can finish recovery sooner", () => {
  const state = createGame(world, 199, "cao");
  const opponentsRest = Object.fromEntries(playableFactions(world.scenarios[0])
    .filter(({ key }) => key !== "cao").map(({ key }) => [key, { source: "model", order: null }]));
  const attack = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: state.cities.luoyang.troops - cityReserve };
  const captured = advanceQuarter(world, queueOrder(world, state, attack), opponentsRest);
  const normalIncome = cityIncome({ ...captured.cities.changan, occupation: 0 });
  assert.equal(cityIncome(captured.cities.changan).treasury, Math.floor(normalIncome.treasury / 2));
  captured.cities.changan.troops = cityReserve - 1;
  const stalled = advanceQuarter(world, captured, opponentsRest);
  assert.equal(stalled.cities.changan.occupation, 2);

  const mobilized = queueOrder(world, stalled, { type: "recruit", city: "changan" });
  assert.equal(advanceQuarter(world, mobilized, opponentsRest).cities.changan.occupation, 1);
  const appointed = appoint(world, mobilized, "changan", "governor", "cao-0");
  const recovered = advanceQuarter(world, appointed, opponentsRest);
  assert.equal(recovered.cities.changan.occupation, 0);
  assert.deepEqual(cityIncome(recovered.cities.changan), normalIncome);
  assert.ok(recovered.history.at(-1).entries.some(({ type }) => type === "recovery"));
});

test("batch delegation keeps existing appointments and applies each city's budget", () => {
  let state = createGame(world, 199, "cao");
  state = appoint(world, state, "xu", "governor", "cao-0");
  assert.throws(() => delegateCities(world, state, ["xu", "changan"], "recruit", 20), /己方城池/);
  assert.throws(() => delegateCities(world, state, ["xu", "luoyang", "puyang", "xiaopei"], "recruit", 20), /待任官员不足/);
  assert.equal(state.cities.luoyang.governor, null);
  state = delegateCities(world, state, ["xu", "luoyang", "xu"], "recruit", 20);
  assert.equal(state.cities.xu.governor, "cao-0");
  assert.notEqual(state.cities.luoyang.governor, "cao-0");
  state = setGovernance(state, "luoyang", "delegated", "recruit", 0);
  const next = advanceQuarter(world, state);
  assert.equal(next.cities.xu.troops, 2800);
  assert.equal(next.cities.luoyang.troops, state.cities.luoyang.troops);
  assert.equal(next.factions.cao.grain, state.factions.cao.grain + forceTotals(state, "cao").grain - 12);
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
});

test("victory and defeat settle on the last city and stop further orders", () => {
  for (const winner of ["cao", "ma"]) {
    const state = createGame(world, 199, "cao");
    const origin = winner === "cao" ? "luoyang" : "changan";
    const target = winner === "cao" ? "changan" : "luoyang";
    const rival = winner === "cao" ? "ma" : "cao";
    const expected = winner === "cao" ? "victory" : "defeat";
    const officer = world.scenarios[0].officers.find(({ faction }) => faction === winner).key;
    for (const [key, city] of Object.entries(state.cities)) {
      Object.assign(city, { owner: key === target ? rival : winner, governor: null, commander: null });
    }
    for (const { key, faction } of world.scenarios[0].officers) {
      state.stations[key] = faction === winner ? origin : faction === rival ? target : null;
    }
    state.cities[origin].troops = 3200;
    state.cities[target].troops = 350;
    const order = { type: "attack", from: origin, to: target, officer, troops: 2600 };
    assert.equal(gameOutcome(state), "ongoing");
    if (winner === "cao") state.orders = queueOrder(world, state, order).orders;
    else state.strategies.ma = { type: "expand", city: origin, target, threshold: 1, since: 0 };
    const next = advanceQuarter(world, state);
    assert.equal(gameOutcome(next), expected);
    assert.equal(next.history.at(-1).entries[0].type, expected);
    const finalBattle = next.history.at(-1).entries.find(({ type }) => type === "capture").battle;
    assert.equal(finalBattle.occupation.retreatTo, null);
    assert.ok(finalBattle.personnel.relocated.length > 0);
    assert.ok(finalBattle.personnel.relocated.every(({ officer, role }) => next.stations[officer] === null && role === "available"));
    assert.equal(finalBattle.defender.troops - finalBattle.defender.casualties, 133);
    assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
    assert.throws(() => advanceQuarter(world, next), /战局已结束/);
    assert.throws(() => queueOrder(world, next, { type: "recruit", city: origin }), /战局已结束/);
  }
});

test("a truce blocks both sides, honors existing orders, and ends after two quarters", () => {
  const state = createGame(world, 199, "cao");
  const outgoing = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 500 };
  const incoming = { type: "attack", from: "changan", to: "luoyang", officer: "ma-1", troops: 500 };
  const queued = queueOrder(world, state, outgoing);
  assert.throws(() => sendTreatyOffer(world, queued, "ma", "truce"), /撤销进攻/);
  assert.equal(queued.treaties.length, 0);
  const invited = sendTreatyOffer(world, state, "ma", "truce");
  assert.equal(treatyWith(invited, "ma", "cao").expires, 2);
  assert.equal(invited.factions.cao.treasury, state.factions.cao.treasury - 12);
  assert.equal(invited.factions.ma.treasury, state.factions.ma.treasury + 12);
  assert.throws(() => validateOrder(world, invited, "cao", outgoing), /保护/);
  assert.throws(() => validateOrder(world, invited, "ma", incoming), /保护/);
  const first = advanceQuarter(world, invited, { ma: { source: "model", order: incoming } });
  assert.equal(first.history.at(-1).decisions.find(({ faction }) => faction === "ma").source, "fallback");
  assert.ok(first.history.at(-1).entries.some(({ text }) => /同意停战/.test(text)));
  assert.equal(first.treatyOffers.length, 0);
  assert.equal(treatyWith(first, "ma", "cao").kind, "truce");
  const second = advanceQuarter(world, first);
  assert.equal(treatyWith(second, "ma", "cao"), null);
  assert.ok(second.history.at(-1).entries.some(({ text }) => /停战期满/.test(text)));
  assert.doesNotThrow(() => validateOrder(world, second, "cao", outgoing));
});

test("alliance terms and rejected offers survive saves and respect reserved treasury", () => {
  const state = createGame(world, 199, "cao");
  const rejected = sendTreatyOffer(world, state, "lu", "alliance");
  assert.equal(rejected.treatyOffers[0].accepted, false);
  assert.equal(rejected.factions.cao.treasury, state.factions.cao.treasury);
  assert.throws(() => sendTreatyOffer(world, rejected, "lu", "truce"), /本季已/);
  const allied = sendTreatyOffer(world, rejected, "ma", "alliance");
  assert.equal(treatyWith(allied, "ma", "cao").expires, 4);
  for (const key of ["cao", "ma"]) {
    assert.equal(forceTotals(allied, key).treasury, forceTotals(state, key).treasury + allianceIncome);
  }
  assert.deepEqual(decodeSave(world, JSON.stringify(allied)), allied);
  const duplicates = structuredClone(allied);
  duplicates.treaties.push(duplicates.treaties[0]);
  assert.throws(() => decodeSave(world, JSON.stringify(duplicates)), /外交记录无效/);
  const settled = advanceQuarter(world, allied);
  assert.ok(settled.history.at(-1).entries.some(({ text }) => /同盟商贸收入/.test(text)));
  assert.ok(settled.history.at(-1).entries.some(({ text }) => /拒绝同盟/.test(text)));
  state.factions.cao.treasury = 25;
  const committed = queueOrder(world, state, { type: "build", city: "xu", project: "farming" });
  assert.throws(() => sendTreatyOffer(world, committed, "ma", "alliance"), /可用国库不足/);
});

test("incoming diplomacy waits for a reply, protects pending orders, and expires without approval", () => {
  const initial = createGame(world, 199, "cao");
  const state = advanceQuarter(world, initial);
  const offer = state.incomingTreaty;
  assert.ok(offer);
  assert.equal(offer.answer, null);
  assert.equal(offer.from, "yuan");
  assert.equal(state.treaties.length, 0);
  assert.ok(state.history.at(-1).entries.some(({ incomingFrom }) => incomingFrom === offer.from));
  const saved = decodeSave(world, JSON.stringify(state));
  assert.deepEqual(saved.incomingTreaty, offer);
  assert.throws(() => sendTreatyOffer(world, saved, offer.from, offer.kind), /先答复/);

  const attack = { type: "attack", from: "luoyang", to: "ye", officer: "cao-1", troops: 600 };
  const queued = queueOrder(world, saved, attack);
  assert.throws(() => respondToTreaty(world, queued, true), /撤销进攻/);
  const refused = respondToTreaty(world, queued, false);
  assert.deepEqual(refused.orders, queued.orders);
  assert.deepEqual(refused.factions, queued.factions);
  assert.throws(() => respondToTreaty(world, refused, true), /没有待答复/);
  assert.ok(advanceQuarter(world, refused).history.at(-1).entries.some(({ text }) => /我方拒绝/.test(text)));

  const accepted = respondToTreaty(world, saved, true);
  assert.equal(accepted.factions.cao.treasury - saved.factions.cao.treasury, 24);
  assert.equal(saved.factions.yuan.treasury - accepted.factions.yuan.treasury, 24);
  assert.equal(treatyWith(accepted, "cao", offer.from).kind, offer.kind);
  assert.throws(() => queueOrder(world, accepted, attack), /保护/);
  assert.throws(() => sendTreatyOffer(world, accepted, offer.from, "alliance"), /本季已与该势力签约/);
  assert.deepEqual(decodeSave(world, JSON.stringify(accepted)), accepted);
  assert.ok(advanceQuarter(world, accepted).history.at(-1).entries.some(({ text }) => /我方接受/.test(text)));

  const ignored = advanceQuarter(world, saved);
  assert.equal(ignored.incomingTreaty, null);
  assert.equal(ignored.treaties.length, 0);
  assert.ok(ignored.history.at(-1).entries.some(({ text }) => /未获答复/.test(text)));
});

test("each scenario's optional goal settles once and survives save and later changes", () => {
  for (const [year, player, title] of [[199, "cao", "安民积粮"], [262, "wei", "整备边军"], [265, "jin", "重整州郡"]]) {
    const era = world.scenarios.find((entry) => entry.year === year);
    let state = createGame(world, year, player);
    assert.equal(scenarioObjective(world, era, state).title, title);
    assert.equal(state.stageCompletedAt, null);
    const owns = ({ key }) => state.cities[key].owner === player;
    const rivals = Object.fromEntries(playableFactions(era).filter(({ key }) => key !== player)
      .map(({ key }) => [key, { source: "model", order: null }]));
    if (year === 199) {
      const keys = world.cities.filter(owns).slice(0, 2).map(({ key }) => key);
      state = delegateCities(world, state, keys, "farming", 22);
      for (const key of keys) state.cities[key].farming = 1;
      assert.equal(scenarioObjective(world, era, state).progress, 0);
    } else if (year === 262) {
      const cities = world.cities.filter((city) => owns(city) && city.links.some((key) => !owns({ key }))).slice(0, 2);
      for (const { key } of cities) Object.assign(state.cities[key], { troops: 1800, defense: 2 });
      assert.ok(scenarioObjective(world, era, state).progress >= 2);
    } else {
      const keys = world.cities.filter((city) => !owns(city)).slice(0, 2).map(({ key }) => key);
      for (const key of keys) Object.assign(state.cities[key], { owner: player, occupation: 1, troops: 800, governor: null, commander: null });
      delete state.stations;
      state = decodeSave(world, JSON.stringify(state));
      assert.equal(scenarioObjective(world, era, state).progress, 0);
    }
    const first = advanceQuarter(world, state, rivals);
    assert.equal(first.stageCompletedAt, 1);
    assert.equal(gameOutcome(first), "ongoing");
    assert.equal(first.history.at(-1).entries.filter(({ type }) => type === "stage").length, 1);
    const loaded = decodeSave(world, JSON.stringify(first));
    assert.equal(loaded.stageCompletedAt, 1);
    const next = advanceQuarter(world, loaded, rivals);
    assert.equal(next.stageCompletedAt, 1);
    assert.equal(next.history.at(-1).entries.filter(({ type }) => type === "stage").length, 0);
  }
});

test("the frontier objective lists current garrison and fortification gaps and excludes treaty-protected borders", () => {
  const state = createGame(world, 262, "wei");
  const era = world.scenarios.find(({ year }) => year === state.year);
  const target = world.cities.find(({ key, links }) => state.cities[key].owner === "wei"
    && links.some((link) => state.cities[link].owner === "shu")
    && links.every((link) => ["wei", "shu"].includes(state.cities[link].owner)));
  const read = () => scenarioObjective(world, era, state);
  const row = () => read().rows.find(({ city }) => city.key === target.key);
  Object.assign(state.cities[target.key], { troops: 1700, defense: 1 });
  assert.equal(row().troopShortage, 100);
  assert.equal(row().defenseShortage, 1);
  assert.equal(row().met, false);
  Object.assign(state.cities[target.key], { troops: 1800, defense: 2 });
  assert.equal(row().met, true);
  assert.equal(read().progress, read().rows.filter(({ met }) => met).length);
  state.treaties.push({ kind: "truce", sides: ["wei", "shu"], expires: 1 });
  assert.equal(row(), undefined);
  state.turn = 1;
  assert.equal(row().met, true);
});

test("frontier intelligence distinguishes treaties and uses projected reserves and supply", () => {
  const state = createGame(world, 199, "cao");
  const pact = sendTreatyOffer(world, state, "ma", "truce");
  const front = frontierIntel(world, pact, "luoyang");
  const target = front.opponents.find(({ key }) => key === "changan");
  assert.equal(target.treaty.kind, "truce");
  assert.equal(target.difference, state.cities.changan.troops - state.cities.luoyang.troops);
  assert.equal(frontierCities(world, pact).find(({ key }) => key === "luoyang").exposed, true);
  const aid = front.donors.find(({ key }) => key === "xu");
  assert.equal(aid.available, state.cities.xu.troops - cityReserve);
  const queued = queueOrder(world, pact, { type: "transfer", from: "xu", to: "luoyang", troops: aid.available });
  const projected = frontierIntel(world, previewOrders(world, queued), "luoyang");
  assert.equal(projected.troops, front.troops + aid.available);
  assert.equal(projected.donors.find(({ key }) => key === "xu").available, 0);
});

test("chronicle filters by multiple seasons, both battle participants, and migrated reports", () => {
  let state = createGame(world, 199, "cao");
  state = sendTreatyOffer(world, state, "yuan", "truce");
  state = queueOrder(world, state, { type: "transfer", from: "xu", to: "luoyang", troops: 900 });
  const troops = previewOrders(world, state).cities.luoyang.troops - cityReserve;
  state = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops });
  const settled = advanceQuarter(world, state);
  const history = [...settled.history, { turn: 2, entries: [{ type: "order", faction: "cao", text: "许昌调 1,400 人至洛阳。" }] }];
  const filters = { section: "news", turn: "all", faction: "all" };
  assert.deepEqual(filteredReports(history, { ...filters, category: "transfer", faction: "cao" }).map(({ turn }) => turn), [2, 1]);
  const combat = filteredReports(history, { ...filters, category: "combat", faction: "ma" });
  assert.equal(combat[0].entry.city, "changan");
  assert.equal(combat[0].entry.type, "capture");
  const diplomacy = filteredReports(history, { ...filters, category: "diplomacy", faction: "yuan" });
  assert.ok(diplomacy[0].entry.participants.includes("cao"));
  assert.equal(filteredReports(history, { ...filters, category: "combat", turn: "2" }).length, 0);
  assert.ok(filteredReports(history, { ...filters, section: "plans", faction: "ma", category: "transfer" }).length);
});

test("the forecast and actual ledger separate gifts, trade, orders, and delegation", () => {
  const initial = createGame(world, 199, "cao");
  let state = sendTreatyOffer(world, initial, "ma", "alliance");
  state = delegateCities(world, state, ["xu", "luoyang"], "commerce", 22);
  state = setGovernance(state, "xu", "delegated", "commerce", 0);
  state = queueOrder(world, state, { type: "recruit", city: "luoyang" });
  const snapshot = structuredClone(state);
  const forecast = forecastFinance(world, state);
  assert.deepEqual(state, snapshot);
  assert.deepEqual(forecast.gifts, { paid: 24, received: 0 });
  assert.equal(forecast.opening.treasury, initial.factions.cao.treasury);
  assert.equal(forecast.trade, allianceIncome);
  assert.equal(forecast.tax.treasury, forceTotals(initial, "cao").treasury);
  assert.deepEqual(forecast.orders, { treasury: 20, grain: 12 });
  assert.equal(forecast.programs.find(({ city }) => city === "xu").result, "budget");
  assert.equal(forecast.programs.find(({ city }) => city === "luoyang").result, "completed");
  const allRest = Object.fromEntries(playableFactions(world.scenarios[0]).map(({ key }) => [key, { source: "model", order: null }]));
  const settled = advanceQuarter(world, state, allRest);
  assert.deepEqual(settled.history.at(-1).finance, forecast);
  assert.equal(settled.factions.cao.treasury, forecast.closing.treasury);
  assert.deepEqual(decodeSave(world, JSON.stringify(settled)), settled);
  const invalid = structuredClone(settled);
  invalid.history.at(-1).finance.closing.treasury += 1;
  assert.throws(() => decodeSave(world, JSON.stringify(invalid)), /账目无效/);
  const offered = advanceQuarter(world, initial);
  const accepted = respondToTreaty(world, offered, true);
  assert.deepEqual(forecastFinance(world, accepted).gifts, { received: 24, paid: 0 });
  assert.equal(forecastFinance(world, accepted).opening.treasury, offered.factions.cao.treasury);
});

test("delegation records grain and national treasury shortages with their current limits", () => {
  const expanded = enrichWorld(world);
  const initial = createGame(expanded, 199, "cao");
  const keys = Object.keys(initial.cities).filter((key) => initial.cities[key].owner === "cao");
  const treasury = delegateCities(expanded, initial, keys, "defense", 30);
  treasury.factions.cao.treasury = 0;
  const grain = delegateCities(expanded, initial, keys, "recruit", 30);
  grain.factions.cao.treasury = 1000;
  grain.factions.cao.grain = 0;
  for (const [state, reason] of [[treasury, "treasury"], [grain, "grain"]]) {
    const programs = advanceQuarter(expanded, state).history.at(-1).finance.programs;
    const stalled = programs.find(({ result }) => result === reason);
    assert.ok(stalled?.available < stalled?.needed);
    assert.deepEqual(stalled.spent, { treasury: 0, grain: 0 });
  }
});

test("the actual ledger charges only executed orders when an opponent beats the player to a city", () => {
  const era = world.scenarios[0];
  let state = createGame(world, 199, "cao");
  state.turn = era.factions.findIndex(({ key }) => key === "ma");
  state.cities.luoyang.troops = 350;
  state.cities.changan.troops = 3200;
  state.cities.tianshui.commander = null;
  state.stations["ma-1"] = "changan";
  state.strategies.ma = { type: "expand", since: state.turn, city: "changan", target: "luoyang", threshold: 1 };
  state = delegateCities(world, state, ["luoyang"], "farming", 22);
  state = queueOrder(world, state, { type: "recruit", city: "luoyang" });
  const predicted = forecastFinance(world, state);
  assert.equal(predicted.orders.treasury, 20);
  assert.equal(predicted.programs[0].result, "completed");
  const after = advanceQuarter(world, state);
  const ledger = after.history.at(-1).finance;
  assert.equal(after.cities.luoyang.owner, "ma");
  assert.deepEqual(ledger.orders, { treasury: 0, grain: 0 });
  assert.deepEqual(ledger.delegation, { treasury: 0, grain: 0 });
  assert.equal(ledger.programs[0].result, "lost");
});

test("portable saves keep the game and ledger, validate old formats, and omit unrelated fields", () => {
  const state = advanceQuarter(world, createGame(world, 199, "cao"));
  const record = { state, selected: "luoyang" };
  const backup = createSaveBackup({ ...record, state: { ...state, baseUrl: "fixture/not-game-data", apiKey: "not-part-of-the-game" } });
  assert.doesNotMatch(backup, /apiKey|baseUrl/);
  assert.deepEqual(readGameRecord(world, backup), record);
  assert.deepEqual(readGameRecord(world, JSON.stringify(record)), record);
  assert.deepEqual(readGameRecord(world, JSON.stringify(state)).state, state);
  assert.throws(() => readGameRecord(world, "{"), /JSON/);
  assert.throws(() => readGameRecord(world, JSON.stringify({ format: "jinglue-sanguo-save", version: 9 })), /版本/);
  assert.throws(() => readGameRecord(world, JSON.stringify({ format: "other" })), /格式/);
  const damaged = structuredClone(state);
  delete damaged.cities.luoyang;
  assert.throws(() => readGameRecord(world, createSaveBackup({ state: damaged, selected: "xu" })), /完整的 44 城/);
  const oversized = structuredClone(state);
  oversized.history[0].entries[0].text = "城".repeat(saveFileLimit);
  assert.throws(() => createSaveBackup({ state: oversized }), /大小限制/);
});

test("a joint plan previews a connected reinforcement and attack in the next two queue slots", () => {
  const initial = createGame(world, 199, "cao");
  initial.cities.luoyang.troops = 800;
  const state = queueOrder(world, initial, { type: "build", city: "xu", project: "farming" });
  const draft = { from: "luoyang", target: "changan", support: "xu", officer: "cao-1", supportTroops: 1400, attackTroops: 1950 };
  const origin = jointOptions(world, state).find(({ key }) => key === "luoyang");
  assert.ok(origin.donors.some(({ key }) => key === "xu"));
  assert.equal(jointAttackLimit(origin, draft.supportTroops), draft.attackTroops);
  const previous = structuredClone(state);
  const report = planJointOrders(world, state, draft);
  assert.deepEqual(state, previous);
  assert.deepEqual(report.positions, [2, 3]);
  assert.equal(report.grain, 34);
  assert.equal(report.supportReserve, state.cities.xu.troops - 1400);
  assert.equal(report.attackReserve, cityReserve);
  assert.ok(report.outcome.wins);
  assert.deepEqual(report.queued.orders.map(({ type }) => type), ["build", "transfer", "attack"]);
  const reloaded = decodeSave(world, JSON.stringify(report.queued));
  const after = advanceQuarter(world, reloaded);
  assert.equal(after.cities.changan.owner, "cao");
  assert.equal(after.cities.changan.commander, "cao-1");
  assert.deepEqual(after.history.at(-1).finance.orders, { treasury: 18, grain: 34 });
});

test("joint orders fail atomically on shared supply, treaty, or remaining queue space", () => {
  const initial = createGame(world, 199, "cao");
  initial.cities.luoyang.troops = 800;
  const draft = { from: "luoyang", target: "changan", support: "xu", officer: "cao-1", supportTroops: 1400, attackTroops: 1950 };
  const limited = structuredClone(initial);
  limited.factions.cao.grain = 20;
  assert.throws(() => planJointOrders(world, limited, draft), /储粮不足/);
  assert.deepEqual(limited.orders, []);
  const truce = sendTreatyOffer(world, initial, "ma", "truce");
  assert.throws(() => planJointOrders(world, truce, draft), /保护/);
  assert.deepEqual(truce.orders, []);
  const two = replaceOrders(world, initial, [
    { type: "build", city: "xu", project: "farming" },
    { type: "build", city: "xu", project: "commerce" },
  ]);
  assert.deepEqual(jointOptions(world, two), []);
  assert.throws(() => planJointOrders(world, two, draft), /最多可下达 3/);
  assert.equal(two.orders.length, 2);
});
