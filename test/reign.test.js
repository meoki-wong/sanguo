import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { armyByOfficer, redirectArmy } from "../dist/armies.js";
import { advanceQuarter, cityRevenues, createGame, decodeSave, eraByYear, forceTotals, forecastFinance, gameOutcome, playableFactions } from "../dist/engine.js";
import { commissionProgram, dispatchCivilSupply } from "../dist/dynasty-economy.js";
import { proposeDynastyTreaty } from "../dist/dynasty-treaties.js";
import { enrichWorld } from "../dist/personnel.js";
import { proposePackage } from "../dist/grand-diplomacy.js";
import { postOwner, strategicPost } from "../dist/sandtable-posts.js";
import { changeService } from "../dist/polity-handover.js";
import { saveSuccession } from "../dist/polity-governance.js";
import { concludePeace, peaceCriteria } from "../dist/polity.js";
import { enableReign, beginStewardship, giveProvinceCharter, publishReign, pauseMobilization10, reignAlerts, reignFrame, reignPeople,
  reignPolicy, reignSuccession } from "../dist/reign.js";
import { establishTownCompact, marketRow, orderMarketRelief } from "../dist/reign-economy.js";
import { assureHandover10, charterLeague10, embargo10, leagueMarket, marketEmbargo, recognize10 } from "../dist/reign-leagues.js";
import { isHostile } from "../dist/diplomacy.js";
import { visibleBattles } from "../dist/frontline.js";
import { createSaveBackup, readGameRecord } from "../dist/saves.js";
import { publishStrategy9, charterFront9 } from "../dist/strategy-nine.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const game = (year = 199, side = "cao") => createGame(world, year, side, { reign: true });
const verify = (state) => assert.deepEqual(readGameRecord(world, createSaveBackup({ state, selected: "luoyang" })).state, state);
const charter = (state, options = {}, batch = true) => publishReign(world, state, { ...reignPolicy(state), ...options }, { batch });
const town = (key) => world.cities.find((row) => row.key === key);
const rest = (state) => Object.fromEntries(Object.keys(state.factions).filter((key) => key !== state.player)
  .map((key) => [key, { source: "model", order: null, accord: null, politics: "", reason: "本季整备" }]));

test("the 9.0 migration preserves existing theaters, delegates, projects, grain convoys and talks", () => {
  let state = createGame(world, 199, "cao", { strategic: true });
  state.grand.depots.xu = 45;
  state.factions.cao.treasury = state.factions.cao.grain = 350;
  const arm = state.armies.find(({ faction }) => faction === "cao");
  Object.assign(arm, { location: "luoyang", target: "luoyang", depot: "luoyang", route: ["luoyang"], troops: 3200, grain: 80 });
  state = dispatchCivilSupply(world, state, "luoyang");
  state = commissionProgram(world, state, { kind: "fields", city: "luoyang", money: 80, grain: 40 });
  state = proposeDynastyTreaty(world, state, { to: "biao", seasons: 5, payment: 15, passage: true, defense: true, cede: null, post: null });
  state = publishStrategy9(world, state, { primary: { kind: "corridor", key: "changan:luoyang" },
    secondary: { kind: "stability", key: "luoyang" }, money: 42, grain: 60, manpower: 1500, transport: 3, negotiate: true });
  state = charterFront9(world, state, { role: "diversion", target: "changan:luoyang", commander: arm.officer, priority: 4, retire: 400, term: 8 });
  verify(state);
  const upgraded = enableReign(state);
  const { reign, ...unchanged } = upgraded;
  assert.deepEqual(unchanged, state);
  assert.equal(reign.since, 0);
  const next = advanceQuarter(world, charter(upgraded));
  verify(next);
  assert.equal(next.dynasty.programs[0].made, 1);
  assert.equal(next.dynasty.treaties[0].status, "active");
  assert.equal(postOwner(next, strategicPost("changan:luoyang")), "cao");
  assert.ok(next.reign.records[0].battles.length);
  assert.equal(reignFrame(world, next, 1).ownership.luoyang, "cao");
  const nativePruned = structuredClone(next);
  nativePruned.frontline.battles = [];
  assert.ok(visibleBattles(nativePruned).some(({ site }) => site === "changan:luoyang"));
});

test("constitutional retention and shipment change actual stores, tax and finance without adding grain twice", () => {
  const before = game();
  const central = charter(before, { stateForm: "central" }, false);
  let shared = charter(before, { stateForm: "compact" }, false);
  const original = cityRevenues(before, "xu");
  const planned = cityRevenues(shared, "xu");
  assert.equal(original.grain, planned.local + planned.grain);
  assert.ok(forceTotals(shared, "cao").grain < forceTotals(central, "cao").grain);
  shared.reign.markets.xu = { ...marketRow(shared, "xu"), bins: 58 };
  shared.reign.markets.luoyang = { ...marketRow(shared, "luoyang"), bins: 0 };
  shared = orderMarketRelief(shared, "luoyang");
  const projected = forecastFinance(world, shared);
  assert.ok(projected.reign.budget.treasury > 0);
  const first = advanceQuarter(world, shared, rest(shared));
  const cargo = first.reign.freights.find(({ to }) => to === "luoyang");
  assert.equal(cargo.from, "xu");
  assert.equal(cargo.cursor, 0);
  assert.ok(first.reign.markets.xu.bins < 58);
  assert.ok(first.reign.records[0].cargos.length);
  verify(first);
  const second = advanceQuarter(world, first, rest(first));
  const delivery = second.reign.freights.find(({ id }) => id === cargo.id);
  assert.equal(delivery.status, "delivered");
  assert.ok(second.reign.markets.luoyang.bins > first.reign.markets.luoyang.bins);
  assert.equal(second.history.at(-1).finance.tax.grain, forceTotals(first, "cao").grain);
  verify(second);
  const obstructed = structuredClone(first);
  obstructed.cities.luoyang.occupation = 3;
  const halted = advanceQuarter(world, obstructed, rest(obstructed));
  assert.equal(halted.reign.freights.find(({ id }) => id === cargo.id).status, "blocked");
  assert.equal(halted.reign.markets.luoyang.cause, "blocked");
});

test("state organs pass a real deputy into the same local office after the former governor defects", () => {
  let state = charter(game());
  const region = town("luoyang").region;
  state = giveProvinceCharter(world, state, region, { lead: "cao-0", deputy: "cao-1", objective: "relief",
    money: 20, grain: 12, term: 12, people: true, dispatch: true });
  state = advanceQuarter(world, state, rest(state));
  const actor = eraByYear(world, state).officers.find(({ key }) => key === "cao-0");
  assert.ok(changeService(world, state, actor, "yuan", state.turn));
  const next = advanceQuarter(world, state, rest(state));
  assert.equal(next.reign.seats[region].lead, "cao-1");
  assert.equal(next.reign.seats[region].acting, true);
  assert.equal(next.dynasty.mandates.cao[region].steward, "cao-1");
  assert.ok(next.reign.reports.some(({ kind }) => kind === "deputy"));
  verify(next);
});

test("three factions accept a league, pay real grain, and commit soldiers to an actual battle", async () => {
  let state = charter(game());
  const gate = state.armies.find(({ faction }) => faction === "ma");
  Object.assign(gate, { location: "changan", target: "changan", depot: "changan", route: ["changan"], troops: 3500, grain: 80 });
  state = charterLeague10(world, state, { target: "yuan", invited: ["ma", "biao"], dues: 5, term: 8, passage: true, military: true });
  const league = state.reign.leagues[0].id;
  const prompts = new Map();
  const planner = createPlanner({ models: { client: () => ({ decide: async (messages) => {
    const prompt = messages[1].content;
    const player = prompt.split(" · ")[0];
    prompts.set(player, prompt);
    if (player === "袁绍") return { choice: "incompatible" };
    return { choice: prompt.match(/^([0-9]+) /m)[1], reason: "独立议盟", reignChoice: "R" + league + "-yes" };
  } }) }, timeoutMs: 500 });
  const model = await planner.plan(world, state);
  assert.equal(model.ma.reignChoice, "R" + league + "-yes");
  assert.equal(model.lu.reignChoice, undefined);
  assert.equal(model.yuan.source, "fallback");
  assert.ok([...prompts.values()].some((text) => text.includes("诸侯集团 R" + league + "-yes")));
  state = advanceQuarter(world, state, { ...rest(state), ma: model.ma, biao: model.biao });
  assert.equal(state.reign.leagues[0].status, "active");
  assert.deepEqual(Object.keys(state.reign.leagues[0].members), ["cao", "ma", "biao"]);
  assert.equal(isHostile(state, "cao", "ma"), false);
  assert.equal(leagueMarket(state, "cao", "ma"), true);
  const approaching = state.armies.find(({ faction }) => faction === "yuan");
  Object.assign(approaching, { location: "ye", target: "ye", route: ["ye"], depot: "ye", troops: 620, grain: 75 });
  redirectArmy(world, state, approaching, { type: "march", target: "luoyang", depot: "ye" });
  const next = advanceQuarter(world, state, rest(state));
  const duty = next.reign.leagues[0].corps.ma;
  assert.equal(duty?.officer, gate.officer);
  assert.ok(next.frontline.battles.some(({ sides, turn }) => turn === 1 && sides.some(({ faction }) => faction === "ma")
    && sides.some(({ faction }) => faction === "yuan")));
  assert.equal(next.history.at(-1).finance.reign.in.grain, 10);
  verify(next);
  assert.ok(marketEmbargo(embargo10(world, next, "biao"), "cao", "biao"));
});

test("shared administration uses real former claims and funded trade instead of transferring the city", () => {
  let state = charter(game());
  state.polity.formerOwners.luoyang.push("ma");
  state = charterLeague10(world, state, { target: "yuan", invited: ["ma"], dues: 0, term: 8, passage: true, military: true });
  state = advanceQuarter(world, state, rest(state));
  state = establishTownCompact(state, "luoyang", "ma");
  const next = advanceQuarter(world, state, rest(state));
  assert.equal(next.cities.luoyang.owner, "cao");
  assert.equal(next.reign.compacts.luoyang.served, 1);
  assert.equal(next.history.at(-1).finance.reign.in.treasury, 2);
  verify(next);
});

test("a provincial uprising creates a new peer that can sign for recognition and receive funded protection", () => {
  let state = charter(game(), { stateForm: "compact", objective: "defense" });
  for (let k = 0; k < 4; k++) state = advanceQuarter(world, state, rest(state));
  const zone = town("luoyang").region;
  state.polity.provinces["cao:" + zone] = { pressure: 100, warning: 1, crisis: 2 };
  state.realm.cities.luoyang.welfare = 8;
  state.cities.luoyang.troops = 350;
  const revolt = advanceQuarter(world, state, rest(state));
  const side = revolt.cities.luoyang.owner;
  assert.match(side, /^spl-/);
  assert.ok(reignAlerts(revolt).some(({ kind }) => ["uprising", "recognition"].includes(kind)));
  const protectedPeer = recognize10(world, revolt, side, "protection");
  assert.equal(protectedPeer.factions[side].grain, revolt.factions[side].grain + 12);
  assert.equal(isHostile(protectedPeer, "cao", side), false);
  verify(protectedPeer);
});

test("an actual peaceful ending can continue across a ruler's handover and finish the stewardship campaign", () => {
  let state = game();
  state = saveSuccession(world, eraByYear(world, state), state, { heir: "cao-0", regent: "cao-1", abdicate: true });
  for (const to of ["yuan", "ce"]) state = proposePackage(world, state, { from: "cao", to,
    halt: true, pass: false, city: null, joint: null, grain: 0, treasury: 15 });
  while (!peaceCriteria(world, state).ready && state.turn < 48 && gameOutcome(state) === "ongoing") state = advanceQuarter(world, state);
  state = concludePeace(world, state);
  const before = state;
  state = beginStewardship(world, state);
  assert.equal(state.reign.stewardship.kind, "peace");
  assert.equal(gameOutcome(state), "ongoing");
  assert.deepEqual(state.armies, before.armies);
  assert.deepEqual(state.factions, before.factions);
  state = charter(state, { stateForm: "compact" });
  state = assureHandover10(world, state);
  assert.ok(state.factions.cao.treasury < before.factions.cao.treasury);
  const [heir, deputy] = reignPeople(world, state);
  state = reignSuccession(world, state, heir.key, deputy?.key ?? null, true);
  while (state.turn < before.turn + 30 && gameOutcome(state) === "ongoing") state = advanceQuarter(world, state);
  assert.equal(gameOutcome(state), "victory", JSON.stringify({ crown: state.reign.stewardship, crownHistory: state.reign.generations }));
  assert.ok(state.reign.stewardship.transferred > before.turn);
  assert.equal(state.reign.stewardship.stable, 6);
  assert.equal(state.polity.courts.cao.head, heir.key);
  verify(state);
});

for (const year of [184, 190, 199, 208, 219, 234, 262, 265]) {
  const factions = playableFactions(eraByYear(world, year));
  for (const candidate of [factions[0], factions.at(-1)]) for (const stateForm of ["central", "compact"]) {
    test(year + " " + candidate.key + " " + stateForm + " keeps 44 cities through 120 quarters or a natural ending", (t) => {
      let state = charter(game(year, candidate.key), { stateForm, objective: stateForm === "central" ? "growth" : "concord" });
      for (let i = 0; i < 120 && gameOutcome(state) === "ongoing"; i++) {
        state = advanceQuarter(world, state);
        assert.equal(Object.keys(state.cities).length, 44);
        if (i % 4 === 0) decodeSave(world, JSON.stringify(state));
        if (i % 20 === 0) verify(state);
      }
      verify(state);
      t.diagnostic(state.turn + " seasons · " + gameOutcome(state));
    });
  }
}
