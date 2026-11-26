import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { armyByOfficer, mobilizeArmy } from "../dist/armies.js";
import { advanceQuarter, availableAttackers, createGame, decodeSave, eraByYear, forceTotals, gameOutcome, playableFactions } from "../dist/engine.js";
import { authorizeProvince, commissionProgram, dispatchCivilSupply } from "../dist/dynasty-economy.js";
import { proposeDynastyTreaty } from "../dist/dynasty-treaties.js";
import { postOwner, strategicPost } from "../dist/sandtable-posts.js";
import { formationOf, reconcileFormations } from "../dist/frontline.js";
import { staffChoices } from "../dist/high-command.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { amendFront9, charterFront9, enableStrategy9, frontAllocations9, petitionMeasure9, publishStrategy9,
  sendReserve9, strategicAlerts9, strategicProgress9, warResponseChoices9 } from "../dist/strategy-nine.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const gate = "changan:luoyang";
const policy = { primary: { kind: "corridor", key: gate }, secondary: { kind: "stability", key: "luoyang" },
  money: 42, grain: 48, manpower: 1400, transport: 3, negotiate: true };
const save = (state) => {
  assert.deepEqual(readGameRecord(world, createSaveBackup({ state, selected: "luoyang" })).state, state);
  return state;
};
const assign = (state, role, target, commander, priority) => charterFront9(world, state, { role, target, commander, priority, retire: 400, term: 8 });

function preparedEight() {
  const state = createGame(world, 199, "cao", { dynasty: true });
  state.factions.cao.grain = state.factions.cao.treasury = 350;
  const own = state.armies.find(({ faction }) => faction === "cao");
  const rival = state.armies.find(({ faction }) => faction === "ma");
  Object.assign(own, { location: "luoyang", depot: "luoyang", target: "luoyang", route: ["luoyang"], troops: 3200, grain: 80 });
  Object.assign(rival, { troops: 470, grain: 80 });
  const officer = availableAttackers(eraByYear(world, state), state, "cao", "xu")[0].key;
  mobilizeArmy(world, state, "cao", { type: "garrison-muster", from: "xu", to: "xu", officer, troops: 800 });
  Object.assign(armyByOfficer(state, officer), { prepared: true, phase: "hold", grain: 40, opening: true });
  reconcileFormations(state, []);
  return { state, main: own.officer, reserve: officer };
}

function twoFronts(custom = {}) {
  const { state: starting, main, reserve } = preparedEight();
  let state = publishStrategy9(world, enableStrategy9(starting), { ...policy, ...custom });
  state = assign(state, "diversion", gate, main, 5);
  state = assign(state, "defense", "xiapi", staffChoices(world, state, "defense", "xiapi")[0].officer, 2);
  const [western, eastern] = state.strategy9.fronts;
  return { state, main, reserve, western, eastern };
}

test("8.0 retains its programs, envoy, active route and province mandates through a 9.0 upgrade and reload", () => {
  let { state } = preparedEight();
  state.grand.depots.xu = 55;
  state = dispatchCivilSupply(world, state, "luoyang");
  state = commissionProgram(world, state, { city: "luoyang", kind: "fields", money: 80, grain: 40 });
  state = proposeDynastyTreaty(world, state, { to: "biao", seasons: 6, payment: 12, passage: true, defense: true, cede: null, post: null });
  const region = world.cities.find(({ key }) => key === "luoyang").region;
  state = authorizeProvince(world, state, { region, steward: null, goal: "growth", money: 8, grain: 8, appoint: true, dispatch: true, mode: "delegate" });
  state = advanceQuarter(world, state);
  const migrated = save(enableStrategy9(state));
  const { strategy9, ...rest } = migrated;
  assert.deepEqual(rest, state);
  assert.equal(strategy9.since, 1);
  const advanced = save(advanceQuarter(world, migrated));
  assert.equal(advanced.dynasty.treaties[0].paid, 12);
});

test("two delegated fronts fight, share capacity, and face actual independent counterattacks", () => {
  const { state, western, eastern, reserve } = twoFronts({ transport: 1 });
  const baseline = frontAllocations9(state);
  assert.equal(baseline.reduce((total, row) => total + row.grain, 0), 48);
  assert.equal(baseline.reduce((total, row) => total + row.manpower, 0), 1400);
  const reordered = amendFront9(world, state, eastern.id, { priority: 5, status: "active" });
  assert.ok(frontAllocations9(reordered)[0].grain < baseline[0].grain);
  const crowded = sendReserve9(world, state, { front: eastern.id, officer: reserve, role: "reserve" });
  const loose = publishStrategy9(world, crowded, { ...policy, transport: 3 });
  let resulting = save(advanceQuarter(world, crowded));
  const ample = save(advanceQuarter(world, loose));
  assert.equal(armyByOfficer(resulting, reserve).location, "xu");
  assert.notEqual(armyByOfficer(ample, reserve).location, "xu");
  assert.equal(postOwner(resulting, strategicPost(gate)), "cao");
  assert.ok(resulting.frontline.battles.some((row) => row.site === gate && row.winner === "cao"));
  assert.ok(resulting.strategy9.records[0].operations.some(({ id, money }) => id === eastern.id && money > 0));
  assert.equal(resulting.strategy9.records[0].operations[0].id, western.id);
  assert.ok(Object.values(resulting.strategy9.responses).some(({ kind }) => kind === "raid"));
  assert.ok(Object.values(resulting.strategy9.responses).some(({ kind }) => kind === "screen"));
  assert.ok(strategicAlerts9(resulting).some(({ kind }) => kind === "transport"));
  assert.equal(strategicProgress9(world, resulting, policy.primary).value, 1);
  for (let pass = 0; pass < 6 && resulting.strategy9.movements[0].status === "travel"; pass++) resulting = save(advanceQuarter(world, resulting));
  const transfer = resulting.strategy9.movements[0];
  assert.equal(transfer.status, "arrived");
  assert.equal(transfer.eta, 0);
  assert.equal(armyByOfficer(resulting, reserve).location, eastern.seat);
  const plan = resulting.highCommand.campaigns.find(({ id }) => id === eastern.campaign).plan;
  assert.ok(resulting.frontline.plans.find(({ id }) => id === plan).units.some(({ id }) => id === formationOf(resulting, reserve).id));
});

test("changing commanders keeps the original mandate and a tax concession changes real revenue and welfare", () => {
  let { state, western, main, reserve } = twoFronts();
  const original = state.highCommand.campaigns.find(({ id }) => id === western.campaign);
  state = amendFront9(world, state, western.id, { priority: 4, status: "active", commander: reserve });
  const renamed = state.highCommand.campaigns.find(({ id }) => id === western.campaign);
  assert.equal(renamed.commander, reserve);
  assert.equal(renamed.war, original.war);
  assert.equal(renamed.plan, original.plan);
  assert.equal(renamed.money, original.money);
  assert.ok(state.frontline.plans.find(({ id }) => id === renamed.plan).units.some(({ id }) => id === formationOf(state, main).id));
  const region = world.cities.find(({ key }) => key === "luoyang").region;
  const easing = petitionMeasure9(world, state, "ease", region);
  assert.ok(forceTotals(easing, "cao").treasury < forceTotals(state, "cao").treasury);
  const withMeasure = save(advanceQuarter(world, easing));
  const standard = save(advanceQuarter(world, state));
  assert.ok(withMeasure.strategy9.support.cao.districts > standard.strategy9.support.cao.districts);
});

test("an independent rival can ratify a real alliance of interests, and tactical model responses are scoped", async () => {
  let { state, main } = preparedEight();
  state = advanceQuarter(world, enableStrategy9(state));
  const unit = armyByOfficer(state, main);
  if (unit) unit.troops = 440;
  state = publishStrategy9(world, state, policy);
  state = assign(state, "diversion", gate, main, 2);
  const target = Object.keys(state.factions).find((side) => warResponseChoices9(world, state, side).some(({ kind }) => kind === "treaty"));
  assert.ok(target);
  if (target) {
    const name = eraByYear(world, state).factions.find(({ key }) => key === target).name;
    const prompts = new Map();
    const planner = createPlanner({ models: { client: () => ({ decide: async (messages) => {
      const prompt = messages[1].content;
      const faction = prompt.split(" · ")[0];
      prompts.set(faction, prompt);
      return faction === name ? { choice: prompt.match(/^([0-9]+) /m)[1], reason: "共同守备", warResponse9: "S9-treaty" } : { choice: "invalid" };
    } }) }, timeoutMs: 500 });
    const replies = await planner.plan(world, state);
    assert.equal(replies[target].warResponse9, "S9-treaty");
    assert.ok(prompts.get(name).includes("战区应对 S9-treaty"));
    assert.ok(Object.values(replies).some(({ source }) => source === "fallback"));
    state = save(advanceQuarter(world, state, replies));
  }
  assert.ok(state.dynasty.treaties.some(({ defense, passage, status, from, to }) => defense && passage && from !== "cao" && to !== "cao"
    && status === "active"));
});

for (const year of [184, 190, 199, 208, 219, 234, 262, 265]) {
  const era = eraByYear(world, year);
  for (const side of [playableFactions(era)[0], playableFactions(era).at(-1)]) {
    test(year + " " + side.key + " preserves 44 cities over 100 quarters or a natural ending in 9.0", (t) => {
      let state = createGame(world, year, side.key, { strategic: true });
      const owned = world.cities.find(({ key }) => state.cities[key].owner === side.key).key;
      const partner = Object.keys(state.factions).find((key) => key !== side.key && Object.values(state.cities).some(({ owner }) => owner === key));
      state = publishStrategy9(world, state, { ...policy, primary: { kind: "stability", key: owned }, secondary: { kind: "concord", key: partner } });
      for (let i = 0; i < 100 && gameOutcome(state) === "ongoing"; i++) {
        state = advanceQuarter(world, state);
        assert.equal(Object.keys(state.cities).length, 44);
        decodeSave(world, JSON.stringify(state));
        if (i % 16 === 0) save(state);
      }
      save(state);
      t.diagnostic(state.turn + " seasons · " + gameOutcome(state));
    });
  }
}
