import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { armyByOfficer } from "../dist/armies.js";
import { advanceQuarter, createGame, forecastFinance, gameOutcome } from "../dist/engine.js";
import { answerReinforcementRevision, formationOf, reinforcementChoices, requestReinforcement } from "../dist/frontline.js";
import { authorizeCampaign, commandBudgets, decideCampaign, enableHighCommand, saveCommandPolicy, staffChoices,
  strategicTargets, urgentCommands } from "../dist/high-command.js";
import { enrichWorld } from "../dist/personnel.js";
import { validEconomy } from "../dist/landscape-economy.js";
import { validCongresses } from "../dist/landscape-treaty.js";
import { interruption } from "../dist/sandtable.js";
import { createSaveBackup, readGameRecord, saveFileLimit } from "../dist/saves.js";
import { postOwner, strategicPost } from "../dist/sandtable-posts.js";
import { declareWar } from "../dist/sandtable-war.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const newGame = (year = 199, faction = "cao") => createGame(world, year, faction, { highCommand: true });
const gate = "changan:luoyang";
const config = { priority: "front", personnel: "manual", floorMoney: 20, floorGrain: 25, front: 65, defense: 20, recovery: 15 };
const policy = (state, options = {}) => saveCommandPolicy(state, { ...config, ...options });
const restore = (state) => {
  const text = createSaveBackup({ state, selected: "luoyang" });
  assert.ok(Buffer.byteLength(text) < saveFileLimit);
  assert.deepEqual(readGameRecord(world, text).state, state);
  return state;
};
const next = (state, proposals) => restore(advanceQuarter(world, state, proposals));
const campaign = (state) => state.highCommand.campaigns[0];

function moveArmy(state, side, point, troops) {
  const army = state.armies.find(({ faction }) => faction === side);
  assert.ok(army);
  Object.assign(army, { location: point, depot: point, target: point, route: [point], phase: "hold", prepared: true, troops, grain: 120 });
  return army;
}

function warrant(state, choices = {}) {
  const { goal = "corridor", target = gate } = choices;
  const commander = staffChoices(world, state, goal, target)[0]?.officer;
  return authorizeCampaign(world, state, { goal, target, commander, mode: "delegate", money: 84, grain: 160,
    withdraw: 350, seasons: 8, terms: goal === "corridor" ? "passage" : "ceasefire", reinforce: true, rebase: true, ...choices });
}

function passageFixture() {
  const state = policy(newGame());
  const own = moveArmy(state, "cao", "luoyang", 2850);
  const rival = moveArmy(state, "ma", "tianshui", 650);
  const proposals = { ma: { maneuver: { [rival.officer]: "M-" + rival.officer + "-hold" } } };
  return { state: warrant(state, { commander: own.officer }), own, proposals };
}

test("a corridor campaign changes real control, consolidates, supports takeover, and closes only after agreed peace", () => {
  let { state, proposals } = passageFixture();
  let row = campaign(state);
  assert.equal(state.sandtable.wars[0].auto, false);
  state = decideCampaign(world, state, row.id, "direct");
  assert.equal(state.frontline.plans[0].mode, "direct");
  state = decideCampaign(world, state, row.id, "delegate");
  state = next(state, proposals);
  assert.equal(campaign(state).stage, "secure");
  assert.equal(postOwner(state, strategicPost(gate)), "cao");
  state = next(state, proposals);
  row = campaign(state);
  assert.equal(row.stage, "settlement");
  assert.equal(row.alert.kind, "settlement");
  assert.ok(interruption({}, state).includes("已达成"));
  state = decideCampaign(world, state, row.id, "negotiate");
  assert.equal(campaign(state).negotiating, true);
  assert.equal(campaign(state).stage, "settlement");
  assert.equal(state.sandtable.wars[0].offer.kind, "passage");
  for (let season = 0; campaign(state).negotiating && season < 6; season++) state = next(state, proposals);
  assert.equal(campaign(state).stage, "ended");
  assert.equal(campaign(state).resolution, "negotiate");
  assert.ok(state.sandtable.peaces.some(({ corridor }) => corridor === gate));
  assert.equal(state.frontline.plans.length, 0);
});

test("two front warrants share the same national pool and the ledger forecasts real spending", () => {
  let state = policy(newGame(), { front: 28, defense: 47, recovery: 25 });
  const own = moveArmy(state, "cao", "luoyang", 1800);
  state.factions.cao.grain = 92;
  state = warrant(state, { commander: own.officer, grain: 27 });
  const target = strategicTargets(world, state, "advance").find(({ key }) => key === "ye");
  assert.ok(target);
  state = warrant(state, { goal: "advance", target: target.key, grain: 30 });
  const preview = forecastFinance(world, state);
  const played = next(state);
  const [a, b] = played.highCommand.campaigns;
  assert.notEqual(a.commander, b.commander);
  assert.ok(a.spentGrain <= 27 && b.spentGrain <= 30);
  assert.ok(a.spentGrain + b.spentGrain <= Math.floor((state.factions.cao.grain + preview.tax.grain - 25) * .28));
  assert.ok(played.history.at(-1).finance.orders.grain >= b.spentGrain);
});

test("commissioned reserves remain ordinary formations and low strength forces an authorized withdrawal", () => {
  let { state, own, proposals } = passageFixture();
  const current = armyByOfficer(state, own.officer);
  current.troops = 315;
  const after = next(state, proposals);
  assert.ok(urgentCommands(after).some(({ alert }) => alert.kind === "exhaustion"));
  assert.equal(armyByOfficer(after, own.officer), null);
  assert.ok(after.history.at(-1).entries.some(({ type, event }) => type === "command" && event === "exhaustion"));
  state = decideCampaign(world, after, campaign(after).id, "acknowledge");
  assert.equal(urgentCommands(state).length, 0);
});

test("a governor-led recovery spends real supplies and reduces the burden on a depleted town", () => {
  const state = policy(newGame(), { priority: "recovery", personnel: "search", recovery: 50, front: 30, defense: 20 });
  state.realm.cities.luoyang.welfare = 52;
  state.sandtable.labor.luoyang = 650;
  const forecast = forecastFinance(world, state);
  const played = next(state);
  assert.ok(played.realm.cities.luoyang.welfare > 52);
  assert.ok(played.sandtable.labor.luoyang < 650);
  assert.ok(played.history.at(-1).entries.some(({ type, event, city }) => type === "command" && event === "recovery" && city === "luoyang"));
  assert.ok(forecast.orders.treasury >= 6);
  assert.equal(played.statecraft.policy.personnel, "search");
});

test("an ally's accepted assignment expires with the alliance and is raised in the national briefing", () => {
  let { state, proposals } = passageFixture();
  const ally = moveArmy(state, "biao", "jiangxia", 1200);
  const row = campaign(state);
  state.treaties.push({ sides: ["biao", "cao"], kind: "alliance", expires: 2 });
  state = requestReinforcement(state, { plan: row.plan, faction: "biao", role: "escort", duration: 4, handover: "retain" });
  const promise = state.frontline.requests[0];
  promise.status = "accepted";
  promise.unit = state.frontline.formations.find(({ officer }) => officer === ally.officer).id;
  state.treaties.length = 0;
  state = next(state, proposals);
  assert.equal(state.frontline.requests[0].status, "expired");
  assert.equal(campaign(state).alert.kind, "alliance");
});

test("an independent ally can request more time or withdraw its own attached force", async () => {
  let state = policy(newGame());
  const own = moveArmy(state, "cao", "luoyang", 1250);
  const ally = moveArmy(state, "biao", "jiangxia", 950);
  state.treaties.push({ sides: ["biao", "cao"], kind: "alliance", expires: 4 });
  state = warrant(state, { goal: "defense", target: "luoyang", commander: own.officer });
  state = requestReinforcement(state, { plan: campaign(state).plan, faction: "biao", role: "escort", duration: 2, handover: "retain" });
  const request = state.frontline.requests[0];
  request.status = "accepted";
  request.unit = formationOf(state, ally.officer).id;
  const delay = reinforcementChoices(world, state, "biao").find(({ action }) => action === "delay");
  assert.ok(delay);
  const models = { client: () => ({ decide: async ([, input]) => ({
    choice: "0", reason: "先保障粮道", battle: { [request.id]: delay.id },
    ...(input.content.startsWith("刘表") ? {} : { maneuver: { [ally.officer]: "invalid" } }),
  }) }) };
  const choices = await createPlanner({ models }).plan(world, state);
  assert.equal(choices.biao.battle[request.id], delay.id);
  assert.ok(Object.entries(choices).every(([key, row]) => key === "biao" || !row.battle && !row.maneuver));
  const delayed = next(state, choices);
  assert.equal(delayed.frontline.requests[0].revision.until, 4);
  assert.equal(campaign(delayed).alert.kind, "revision");
  const agreed = answerReinforcementRevision(delayed, request.id, true);
  assert.equal(agreed.frontline.requests[0].until, 4);
  const corps = armyByOfficer(agreed, ally.officer);
  if (corps) corps.grain = 0;
  const withdraw = reinforcementChoices(world, agreed, "biao").find(({ action }) => action === "withdraw");
  assert.ok(withdraw);
  const withdrawn = next(agreed, { biao: { battle: { [request.id]: withdraw.id } } });
  assert.equal(withdrawn.frontline.requests[0].status, "withdrawn");
  assert.ok(withdrawn.history.at(-1).entries.some(({ text }) => text.includes("按撤军路线退出")));
});

test("6.0 backups upgrade without rewriting the old army route, war, or extant allied pact", () => {
  let previous = createGame(world, 199, "cao", { frontline: true });
  previous = declareWar(world, previous, { goal: "corridor", target: gate, auto: false });
  previous.treaties.push({ sides: ["biao", "cao"], kind: "alliance", expires: 4 });
  const unit = moveArmy(previous, "cao", "xu", 1200);
  Object.assign(unit, { phase: "march", route: ["xu", "luoyang", "changan"], target: "changan" });
  const migrated = restore(enableHighCommand(restore(previous)));
  const { highCommand, ...legacy } = migrated;
  assert.deepEqual(legacy, previous);
  assert.deepEqual(highCommand.campaigns, []);
  const continued = next(migrated);
  assert.equal(continued.turn, 1);
  assert.equal(continued.sandtable.wars.length >= 1, true);
});

test("a blocked defense produces an explicit budget alert without funding a new force", () => {
  let state = newGame();
  const army = state.armies.find(({ faction }) => faction === "cao");
  const point = strategicTargets(world, state, "defense").find(({ key }) => key === "luoyang");
  assert.ok(point);
  state = policy(state, { floorMoney: 600, floorGrain: 600 });
  assert.equal(commandBudgets(state).defenseMoney, 0);
  state = warrant(state, { goal: "defense", target: point.key, commander: army.officer });
  state = next(state);
  assert.equal(campaign(state).alert.kind, "funds");
  assert.equal(campaign(state).spentMoney, 0);
  assert.equal(campaign(state).spentGrain, 0);
});

test("when the authorized depot is lost, the commander reopens supply through a reachable warehouse", () => {
  let { state, own, proposals } = passageFixture();
  armyByOfficer(state, own.officer).depot = "ye";
  state = next(state, proposals);
  const army = armyByOfficer(state, own.officer);
  assert.equal(state.cities[army.depot].owner, "cao");
  assert.ok(state.highCommand.dispatches.some(({ kind }) => kind === "supply-change"));
  assert.ok(!urgentCommands(state).some(({ alert }) => alert.kind === "supply"));
});

test("an authorized relief intercepts the investing army and lifts the real blockade", () => {
  let state = newGame(208, "liu");
  const relief = moveArmy(state, "liu", "jiangxia", 2800);
  const attacking = moveArmy(state, "cao", "runan", 1300);
  Object.assign(attacking, { phase: "march", target: "jiangxia", route: ["runan", "jiangxia"], stance: "blockade",
    engagement: { owner: "liu", quarters: 2, progress: 40, defenders: state.cities.jiangxia.troops } });
  const proposal = { cao: { maneuver: { [attacking.officer]: "M-" + attacking.officer + "-jiangxia" } } };
  assert.ok(strategicTargets(world, state, "relief").some(({ key }) => key === "jiangxia"));
  state = warrant(state, { goal: "relief", target: "jiangxia", commander: relief.officer });
  state = next(state, proposal);
  assert.equal(campaign(state).stage, "settlement");
  assert.ok(state.frontline.battles.some(({ kind, site }) => kind === "contact" && site === "jiangxia"));
  assert.equal(armyByOfficer(state, attacking.officer)?.engagement, undefined);
  assert.ok(state.highCommand.career[relief.officer].guard >= 1);
});

test("an authorized navy uses the river approach and takes the actual crossing", () => {
  let state = policy(newGame(208, "cao"));
  const own = moveArmy(state, "cao", "jiangling", 3000);
  const crossing = "jiangling:jiangxia";
  own.travel = "water";
  formationOf(state, own.officer).kind = "navy";
  state.sandtable.posts[crossing] = { owner: "liu", troops: 180, closed: true, since: state.turn };
  const hostile = moveArmy(state, "liu", "jiangxia", 360);
  state.cities.jiangxia.troops = 2500;
  state = warrant(state, { goal: "corridor", target: crossing, commander: own.officer });
  const proposals = { liu: { maneuver: { [hostile.officer]: "M-" + hostile.officer + "-hold" } } };
  for (let season = 0; season < 6 && state.sandtable.posts[crossing]?.owner !== "cao"; season++) state = next(state, proposals);
  assert.equal(state.sandtable.posts[crossing]?.owner, "cao");
  assert.ok(state.frontline.battles.some(({ terrain, sides }) => terrain === "river" && sides.some(({ kind }) => kind === "navy")));
});

test("all sixteen 7.0 scenario starts hold 44 cities through 100 turns or a natural finish", { timeout: 160000 }, () => {
  for (const { year, factions, ownership } of world.scenarios) {
    const sides = factions.filter(({ key }) => Object.values(ownership).includes(key));
    for (const { key } of [sides[0], sides.at(-1)]) {
      let state = policy(newGame(year, key), { personnel: "appoint" });
      const candidate = ["corridor", "defense"].flatMap((goal) => strategicTargets(world, state, goal)
        .map(({ key: target }) => ({ goal, target }))).find(({ goal, target }) => staffChoices(world, state, goal, target).length);
      if (candidate) state = warrant(state, candidate);
      for (let round = 0; round < 100 && gameOutcome(state) === "ongoing"; round++) {
        state = advanceQuarter(world, state);
        assert.equal(Object.keys(state.cities).length, 44);
        const planned = campaign(state);
        if (planned?.stage === "settlement" && gameOutcome(state) === "ongoing") state = decideCampaign(world, state, planned.id, "secure");
        if (round % 14 === 0) {
          const label = year + " " + key + " season " + state.turn;
          assert.ok(validEconomy(world, state, state.landscape), label + " logistics");
          assert.ok(validCongresses(state, state.landscape), label + " coalition");
          restore(state);
        }
      }
      assert.ok(state.turn === 100 || gameOutcome(state) !== "ongoing");
      restore(state);
    }
  }
});
