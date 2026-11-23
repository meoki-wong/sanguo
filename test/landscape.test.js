import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { commandArmy, marchRoute, shippingCost } from "../dist/armies.js";
import { accordCredit } from "../dist/accords.js";
import { advanceQuarter, availableAttackers, createGame, eraByYear, forecastFinance, gameOutcome, queueOrder } from "../dist/engine.js";
import { saveGrandCampaign } from "../dist/grand-campaign.js";
import { proposePackage } from "../dist/grand-diplomacy.js";
import { enableLandscape, observerReport } from "../dist/landscape.js";
import { orderBridge, prepareConvoy, quoteConvoy, setRegionalPolicy } from "../dist/landscape-economy.js";
import { edgeWeather, weatherAllows } from "../dist/landscape-terrain.js";
import { conferencePass, proposeCongress } from "../dist/landscape-treaty.js";
import { scenarioObjective } from "../dist/objectives.js";
import { enrichWorld } from "../dist/personnel.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const game = (year = 199, player = "cao", options = {}) => createGame(world, year, player, { landscape: true, ...options });

function roundTrip(state) {
  const record = { state, selected: "luoyang" };
  const restored = readGameRecord(world, createSaveBackup(record));
  assert.deepEqual(restored, record);
  return restored.state;
}

function holdOpponents(state, choices = {}) {
  return Object.fromEntries(Object.keys(state.factions).filter((faction) => faction !== state.player)
    .map((faction) => [faction, { source: "model", order: null, accord: null, politics: "", reason: "休整", ...choices[faction] }]));
}

const quarter = (state, choices) => roundTrip(advanceQuarter(world, state, holdOpponents(state, choices)));

test("summer floods split usable road and water routes, winter pass shipping costs rise, and repairs change future terrain", () => {
  let state = game(208, "liu");
  state = quarter(state);
  assert.equal(edgeWeather(state, "jiangxia", "chaisang").blocked, true);
  assert.equal(weatherAllows(state, "jiangxia", "chaisang", "water"), true);
  assert.deepEqual(marchRoute(world, state, "liu", "jiangxia", "chaisang", "water"), ["jiangxia", "chaisang"]);
  const officer = availableAttackers(eraByYear(world, state), state, "liu", "jiangxia")[0].key;
  state = queueOrder(world, state, { type: "mobilize", from: "jiangxia", to: "chaisang", troops: 1200, officer, stance: "assault", travel: "water" });
  state = quarter(state);
  const unit = state.armies.find((army) => army.officer === officer);
  assert.equal(unit.travel, "water");
  assert.ok(unit.equipment > 0);
  state = quarter(state);
  state = quarter(state);
  assert.ok(state.landscape.replay.flatMap(({ stages }) => stages).some(({ text }) => text.includes("水运") && text.includes("军械")));

  let winter = game(199, "ma");
  for (let q = 0; q < 3; q++) winter = quarter(winter);
  const army = { faction: "ma", location: "changan" };
  const pass = ["luoyang", "changan"];
  const before = shippingCost(world, winter, army, pass);
  assert.equal(edgeWeather(winter, ...pass).label, "积雪难行");
  winter = orderBridge(winter, "changan:luoyang");
  const budget = forecastFinance(world, winter).landscape.budget;
  winter = quarter(winter);
  assert.deepEqual(budget, winter.history.at(-1).finance.landscape.budget);
  assert.equal(winter.landscape.bridges["changan:luoyang"], 1);
  for (let q = 0; q < 3; q++) winter = quarter(winter);
  assert.equal(edgeWeather(winter, ...pass).cost, 0);
  assert.ok(shippingCost(world, winter, army, pass) < before);
});

test("convoy settlement conserves grain, warehouse equipment fuels armies, and regional policy stays in effect", () => {
  let state = game();
  const from = "xu";
  const to = "luoyang";
  const shipment = { from, to, cargo: "grain", mode: "land", amount: 24 };
  const site = world.cities.find(({ key }) => key === to);
  state = setRegionalPolicy(world, state, site.region, "equipment");
  state.grand.depots[from] = 12;
  const quote = quoteConvoy(world, state, { ...shipment, faction: "cao" });
  assert.ok(quote?.affordable);
  state = prepareConvoy(world, state, shipment);
  state = quarter(state);
  assert.equal(state.landscape.convoys[0].status, "delivered");
  assert.equal(state.grand.depots[from] ?? 0, 0);
  assert.equal(state.grand.depots[to], 24);
  assert.deepEqual(state.history.at(-1).finance.landscape.budget, { treasury: quote.freight + 5, grain: 12 });
  const total = Object.values(state.landscape.equipment).reduce((sum, amount) => sum + amount, 0);
  state = quarter(state);
  assert.ok(Object.values(state.landscape.equipment).reduce((sum, amount) => sum + amount, 0) > total);
  assert.throws(() => prepareConvoy(world, state, { ...shipment, amount: 201 }), /物资/);
});

test("separate votes and each signatory's contributions persist, invalid model ballots use rules, and postwar clauses move troops", async () => {
  let state = game();
  state.cities.luoyang.troops = 5600;
  state.cities.changan.troops = 350;
  state = proposeCongress(state, { guests: ["yuan", "ce"], target: "changan", aid: 8, duration: 4, market: true, border: true,
    beneficiary: "yuan", returnTo: "yuan" });
  const seen = new Map();
  const models = { client: () => ({ decide: async ([, message]) => {
    const content = message.content;
    seen.set(content.split(" · ")[0], content);
    return { choice: "0", reason: "依约出兵", votes: { C1: content.startsWith("袁绍") ? "yes" : "maybe", C5: "yes" } };
  } }) };
  const proposals = await createPlanner({ models }).plan(world, state);
  assert.deepEqual(proposals.yuan.votes, { C1: "yes" });
  assert.equal(proposals.ce.votes, undefined);
  assert.match(seen.get("袁绍"), /议约 C1/);
  const outside = [...seen].find(([name]) => name.startsWith("马腾"))?.[1];
  assert.doesNotMatch(outside, /议约 C1/);
  assert.ok(observerReport(world, state, "yuan").cities.every(({ confidence, age }) => confidence === "未知" ? age === null : age >= 0));
  state = quarter(state, { yuan: { votes: proposals.yuan.votes } });
  assert.deepEqual(state.landscape.congresses[0].votes, { cao: "yes", yuan: "yes", ce: "yes" });
  assert.ok(conferencePass(state, "yuan", "ce"));
  const officer = availableAttackers(eraByYear(world, state), state, "cao", "luoyang")[0].key;
  state = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", troops: 3200, officer });
  state = quarter(state);
  assert.equal(state.cities.changan.owner, "cao");
  assert.deepEqual(state.landscape.congresses[0].contributions, { cao: 1 });
  while (state.landscape.congresses[0].status === "active") state = quarter(state);
  assert.equal(state.cities.changan.owner, "yuan");
  assert.equal(state.cities.changan.troops, 250);
  assert.equal(state.landscape.congresses[0].delivered, 32);
  assert.equal(state.landscape.congresses[0].completed, true);
  assert.equal(state.stations[officer] === "changan", false);
});

test("a 2.0 save upgrades with three active wings, a siege and a pending package; only a direct wing command pauses the campaign", () => {
  let state = game(199, "cao", { landscape: false, grand: true });
  state.cities.luoyang.troops = 7200;
  state.cities.changan.troops = 1500;
  state.factions.cao.grain = 900;
  const officers = ["cao-1", "cao-2", "cao-roster-3"];
  for (const officer of officers) state.stations[officer] = "luoyang";
  const wings = Object.fromEntries(["main", "support", "escort"].map((role, index) =>
    [role, { from: "luoyang", officer: officers[index], troops: [2900, 900, 550][index] }]));
  state = saveGrandCampaign(world, state, { id: 1, name: "关中战役", target: "changan", depot: "luoyang", backup: "xu",
    retreat: "luoyang", floor: 450, grain: 150, recover: true, wings });
  for (let q = 0; q < 3; q++) state = quarter(state);
  assert.ok(state.armies.some(({ engagement }) => engagement));
  state = proposePackage(world, state, { from: "cao", to: "yuan", halt: true, pass: false, city: null, joint: null, grain: 0, treasury: 12 });
  const upgrade = roundTrip(enableLandscape(world, state));
  const { landscape, ...legacy } = upgrade;
  assert.deepEqual(legacy, state);
  assert.equal(landscape.since, state.turn);
  assert.equal(upgrade.armies.filter(({ faction }) => faction === "cao").length, 3);
  const ordered = commandArmy(world, upgrade, officers[0], { type: "hold" });
  assert.equal(ordered.grand.campaigns[0].status, "paused");
  assert.ok(quarter(ordered).turn > upgrade.turn);
});

test("custom difficulty, initial diplomacy and objectives belong to an independent opening", () => {
  const opening = { title: "军镇试演", owners: {}, stocks: {}, stations: {}, relations: { ce: 32 }, difficulty: "hard", goal: "defense" };
  const normal = game();
  const custom = roundTrip(game(199, "cao", { opening }));
  assert.equal(eraByYear(world, custom).title, opening.title);
  assert.equal(accordCredit(custom, "cao", "ce"), accordCredit(normal, "cao", "ce") + 32);
  assert.equal(custom.factions.ce.grain, normal.factions.ce.grain + 60);
  assert.equal(scenarioObjective(world, eraByYear(world, custom), custom).title, "稳固城防");
  assert.throws(() => game(199, "cao", { opening: { ...opening, relations: { ce: 150 } } }), /初始关系/);
});

for (const [year, players] of [[184, ["han", "yellow"]], [190, ["cao", "dong"]], [199, ["cao", "lu"]], [208, ["cao", "liu"]],
  [219, ["liu", "wu"]], [234, ["wei", "shu"]], [262, ["wei", "shu"]], [265, ["jin", "wu"]]]) {
  for (const player of players) test(`3.0 ${year} ${player} runs 100 quarters or reaches its natural ending`, (context) => {
    let state = game(year, player);
    while (state.turn < 100 && gameOutcome(state) === "ongoing") {
      state = roundTrip(advanceQuarter(world, state));
      assert.equal(Object.keys(state.cities).length, 42);
    }
    assert.ok(state.turn === 100 || gameOutcome(state) !== "ongoing");
    context.diagnostic(state.turn + " seasons · " + gameOutcome(state));
  });
}
