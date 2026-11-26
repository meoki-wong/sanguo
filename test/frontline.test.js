import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { armyByOfficer, commandArmy } from "../dist/armies.js";
import { advanceQuarter, availableAttackers, createGame, decodeSave, eraByYear, forecastFinance, gameOutcome, queueOrder } from "../dist/engine.js";
import { auxiliaryDefense, enableFrontline, formationOf, maneuverChoices, musterBattlePlan, reinforcementChoices,
  requestReinforcement, saveBattlePlan, serviceFormation, visibleBattles } from "../dist/frontline.js";
import { prepareConvoy } from "../dist/landscape-economy.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord, saveFileLimit } from "../dist/saves.js";
import { declareWar } from "../dist/sandtable-war.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const create = (year = 199, side = "cao") => createGame(world, year, side, { frontline: true });
const hold = (state, side, key, troopTotal = 1300) => {
  const army = state.armies.find(({ faction }) => faction === side);
  assert.ok(army, side);
  Object.assign(army, { location: key, depot: key, target: key, route: [key], phase: "hold", troops: troopTotal, grain: 110, prepared: true });
  return army;
};
const plan = (state, army, objective, extras = {}) => saveBattlePlan(world, state, {
  mission: "offensive", mode: "direct", reserve: 0, objective, units: [{ id: formationOf(state, army.officer).id, role: "advance" }], ...extras,
});
const verify = (state) => {
  const backup = createSaveBackup({ state, selected: "luoyang" });
  assert.ok(Buffer.byteLength(backup) < saveFileLimit);
  assert.deepEqual(readGameRecord(world, backup).state, state);
  return state;
};
const quarter = (state, proposals) => verify(advanceQuarter(world, state, proposals));

test("land battles use simultaneous orders, preserve actual losses and allow retreat at the next contact", () => {
  const state = create();
  const own = hold(state, "cao", "luoyang", 2850);
  const rival = hold(state, "ma", "changan", 2500);
  const choice = maneuverChoices(world, state, "ma").find(({ target }) => target === "luoyang");
  assert.ok(choice);
  const proposals = { ma: { maneuver: { [rival.officer]: choice.id } } };
  const campaign = plan(state, own, "changan:luoyang");
  const next = quarter(campaign, proposals);
  const result = visibleBattles(next).find(({ site }) => site === "changan:luoyang");
  assert.equal(result.kind, "contact");
  assert.equal(result.site, "changan:luoyang");
  assert.equal(result.terrain, "pass");
  assert.ok(result.sides.every((side) => side.loss > 0));
  assert.equal(formationOf(next, own.officer).losses, result.sides.find(({ faction }) => faction === "cao").loss);
  assert.equal(armyByOfficer(next, own.officer).location, "luoyang");
  assert.equal(next.cities.changan.owner, "ma");
  const reset = structuredClone(campaign);
  const withdrawing = armyByOfficer(reset, own.officer);
  Object.assign(withdrawing, { phase: "retreat", route: ["luoyang", "xu", "runan"], target: "runan" });
  Object.assign(armyByOfficer(reset, rival.officer), { phase: "march", route: ["changan", "luoyang"], target: "luoyang" });
  reset.frontline.plans = [];
  const retreat = quarter(reset, proposals);
  const withdrawal = visibleBattles(retreat).find(({ kind }) => kind === "withdrawal");
  assert.ok(withdrawal);
  assert.equal(withdrawal.sides.find(({ faction }) => faction === "cao").loss, Math.ceil(own.troops * .12));
  assert.equal(armyByOfficer(retreat, own.officer).phase, "retreat");
  assert.equal(armyByOfficer(retreat, own.officer).location, "xu");
});

test("naval movement contests a mapped water crossing while another army advances independently", () => {
  let state = create(208, "cao");
  const ship = hold(state, "cao", "jiangling", 2800);
  ship.travel = "water";
  formationOf(state, ship.officer).kind = "navy";
  const enemy = hold(state, "liu", "jiangxia", 3000);
  enemy.travel = "land";
  state.cities.jiangling.troops = 800;
  state.cities.jiangxia.troops = 700;
  state.landscape.bridges["jiangling:jiangxia"] = 1;
  state.factions.cao.grain += 1000;
  const other = musterBattlePlan(world, state, "changan");
  assert.ok(other);
  state = queueOrder(world, state, other);
  state = quarter(state, { liu: { maneuver: { [enemy.officer]: "M-" + enemy.officer + "-hold" } } });
  const pending = armyByOfficer(state, other.officer);
  assert.ok(pending);
  const local = armyByOfficer(state, ship.officer);
  assert.ok(local);
  state = plan(state, local, "jiangxia");
  state = plan(state, pending, "changan");
  const opposing = maneuverChoices(world, state, "liu").find(({ officer, target }) => officer === enemy.officer && target === "jiangling");
  assert.ok(opposing);
  state = quarter(state, { liu: { maneuver: { [enemy.officer]: opposing.id } } });
  const naval = visibleBattles(state).find((battle) => battle.terrain === "river");
  assert.ok(naval);
  assert.equal(naval.sides.find(({ faction }) => faction === "cao").kind, "navy");
  assert.equal(state.frontline.plans.length, 2);
  assert.notEqual(armyByOfficer(state, other.officer)?.phase, "muster");
});

test("formation service conserves men and provisions, retains history after replacing commanders and deducts replacement recruits", () => {
  let state = create();
  const own = hold(state, "cao", "xu");
  const { id } = formationOf(state, own.officer);
  const era = eraByYear(world, state);
  const heir = availableAttackers(era, state, "cao", "xu")[0];
  const howMuch = state.landscape.equipment.xu = 7;
  state = serviceFormation(world, state, own.officer, "kind", "cavalry");
  assert.equal(state.landscape.equipment.xu, howMuch - 2);
  state = serviceFormation(world, state, own.officer, "leader", heir.key);
  assert.equal(state.stations[own.officer], "xu");
  assert.equal(formationOf(state, heir.key).id, id);
  const current = armyByOfficer(state, heir.key);
  state = plan(state, current, "xu", { mission: "defense", reserve: 60, units: [{ id, role: "reserve" }] });
  const grown = quarter(state);
  assert.ok(armyByOfficer(grown, heir.key).troops > current.troops);
  assert.ok(formationOf(grown, heir.key).service.some(({ event }) => event.startsWith("补员")));
  const returned = commandArmy(world, grown, heir.key, { type: "garrison" });
  assert.equal(returned.frontline.formations.find((row) => row.id === id).ended, grown.turn);
  assert.equal(returned.frontline.plans[0].units.length, 0);
  verify(returned);
});

test("coalition AI chooses a specific helper from its own eligible units or declines, and an allied guard improves real defense", async () => {
  let state = create();
  const own = hold(state, "cao", "runan");
  const ally = hold(state, "biao", "jiangxia");
  state.treaties.push({ kind: "alliance", sides: ["biao", "cao"], expires: 4 });
  state = plan(state, own, "runan", { mission: "defense" });
  state = requestReinforcement(state, { plan: state.frontline.plans[0].id, faction: "biao", role: "escort", duration: 3, handover: "retain" });
  const options = reinforcementChoices(world, state, "biao");
  assert.equal(options.find(({ officer }) => officer === ally.officer)?.target, "runan");
  const no = options.find(({ unit }) => unit === null);
  const refuse = quarter(state, { biao: { battle: { [no.request]: no.id } } });
  assert.equal(refuse.frontline.requests[0].status, "refused");
  const accepted = quarter(state, { biao: { battle: { [no.request]: "outside-candidate-list" } } });
  assert.equal(accepted.frontline.requests[0].status, "accepted");
  assert.equal(armyByOfficer(accepted, ally.officer).location, "runan");
  assert.ok(auxiliaryDefense(accepted, "runan") > 0);
  const officerChoice = options.find(({ officer }) => officer === ally.officer);
  const model = createPlanner({ models: { client: () => ({ decide: async ([, prompt]) => {
    if (prompt.content.startsWith("刘表")) return { choice: "0", reason: "由己方军团护运", battle: { [no.request]: officerChoice.id } };
    if (prompt.content.startsWith("马腾")) throw new DOMException("mock deadline", "TimeoutError");
    return { choice: "0", reason: "整补", battle: { [no.request]: officerChoice.id }, maneuver: { [ally.officer]: "M-invalid" } };
  } }) } });
  const received = await model.plan(world, state);
  assert.equal(received.biao.battle[no.request], officerChoice.id);
  assert.equal(received.ma.source, "fallback");
  assert.match(received.ma.reason, /超时/);
  assert.ok(Object.entries(received).every(([key, result]) => key === "biao" || !result.battle && !result.maneuver));
});

test("a contested transport holds its cargo, then delivers once the enemy loses access", () => {
  let state = create();
  hold(state, "cao", "puyang");
  const rival = hold(state, "yuan", "ye", 3500);
  state.cities.puyang.troops = 800;
  state = prepareConvoy(world, state, { from: "chenliu", to: "puyang", cargo: "grain", amount: 10, mode: "land" });
  const choice = maneuverChoices(world, state, "yuan").find(({ target }) => target === "puyang");
  assert.ok(choice);
  Object.assign(armyByOfficer(state, state.armies.find(({ faction }) => faction === "cao").officer), {
    phase: "hold", location: "xu", depot: "xu", target: "xu", route: ["xu"],
  });
  state = quarter(state, { yuan: { maneuver: { [rival.officer]: choice.id } } });
  assert.equal(state.landscape.convoys[0].status, "queued");
  assert.equal(state.grand.depots.puyang ?? 0, 0);
  state.treaties.push({ kind: "truce", sides: ["cao", "yuan"], expires: state.turn + 2 });
  state = quarter(state);
  assert.equal(state.landscape.convoys[0].status, "delivered");
  assert.ok(state.grand.depots.puyang >= 10);
});

test("only the promised force can earn an allied transfer of a newly won city", () => {
  let state = create();
  const own = hold(state, "cao", "luoyang");
  const ally = hold(state, "yuan", "jinyang", 2800);
  const rival = hold(state, "ma", "tianshui", 1600);
  state.cities.changan.troops = 175;
  state.cities.changan.defense = 0;
  state.treaties.push({ kind: "alliance", sides: ["cao", "yuan"], expires: 4 });
  state = plan(state, own, "changan", { units: [{ id: formationOf(state, own.officer).id, role: "reserve" }] });
  state = requestReinforcement(state, { plan: state.frontline.plans[0].id, faction: "yuan", role: "advance", duration: 3, handover: "handover" });
  const selected = reinforcementChoices(world, state, "yuan").find(({ officer }) => officer === ally.officer);
  assert.ok(selected);
  state = quarter(state, { yuan: { battle: { [selected.request]: selected.id } },
    ma: { maneuver: { [rival.officer]: "M-" + rival.officer + "-hold" } } });
  assert.equal(state.frontline.requests[0].status, "fulfilled");
  assert.equal(state.cities.changan.owner, "cao");
  assert.ok(state.history.at(-1).entries.some(({ text }) => text.includes("盟军履约")));
});

test("5.0 in-flight units, war state and pacts migrate intact and can continue with 6.0 formation records", () => {
  const previous = createGame(world, 199, "cao", { sandtable: true });
  previous.treaties.push({ kind: "truce", sides: ["biao", "cao"], expires: 3 });
  const old = declareWar(world, previous, { goal: "corridor", target: "changan:luoyang", auto: false });
  const marshal = musterBattlePlan(world, old, "changan");
  assert.ok(marshal);
  const marching = advanceQuarter(world, queueOrder(world, old, marshal));
  const migrated = enableFrontline(marching);
  assert.deepEqual(migrated.armies, marching.armies);
  assert.deepEqual(migrated.sandtable.wars, marching.sandtable.wars);
  assert.deepEqual(migrated.treaties, marching.treaties);
  assert.ok(formationOf(migrated, marshal.officer));
  verify(migrated);
  const broken = structuredClone(migrated);
  broken.frontline.formations[0].fatigue = 500;
  assert.throws(() => decodeSave(world, JSON.stringify(broken)), /军团履历/);
});

test("direct and delegated command use the same post casualties and garrison transfer for equivalent orders", () => {
  const state = create();
  const own = hold(state, "cao", "luoyang", 3000);
  const rival = hold(state, "ma", "tianshui", 600);
  const models = { ma: { maneuver: { [rival.officer]: "M-" + rival.officer + "-hold" } } };
  const direct = quarter(plan(state, own, "changan:luoyang"), models);
  const delegate = quarter(plan(state, own, "changan:luoyang", { mode: "delegate" }), models);
  assert.deepEqual(direct.sandtable.posts, delegate.sandtable.posts);
  assert.equal(direct.sandtable.posts["changan:luoyang"].owner, "cao");
  const scene = visibleBattles(direct).find(({ kind }) => kind === "post");
  assert.ok(scene);
  const [[command], [officer]] = [direct, delegate].map((run) => visibleBattles(run).filter(({ kind }) => kind === "post"));
  assert.deepEqual(command, officer);
  assert.equal(own.troops - armyByOfficer(direct, own.officer).troops, scene.sides[0].loss + direct.sandtable.posts["changan:luoyang"].troops);
});

test("all eight eras retain 44 cities for two actual choices each, with up to a hundred 6.0 quarters", { timeout: 140000 }, () => {
  for (const era of world.scenarios) {
    const factions = era.factions.filter(({ key }) => Object.values(era.ownership).includes(key));
    for (const { key } of [factions[0], factions.at(-1)]) {
      let state = create(era.year, key);
      assert.equal(Object.keys(state.cities).length, 44);
      const storageBefore = JSON.stringify(state);
      const forecast = forecastFinance(world, state);
      assert.deepEqual(JSON.stringify(state), storageBefore);
      assert.ok(forecast.closing.grain >= 0);
      for (let step = 0; step < 100 && gameOutcome(state) === "ongoing"; step++) {
        state = advanceQuarter(world, state);
        if (step % 12 === 0) verify(state);
        assert.equal(Object.keys(state.cities).length, 44);
      }
      verify(state);
    }
  }
});
