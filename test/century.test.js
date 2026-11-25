import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner } from "../ai.mjs";
import { annualDraft15, concludeChapter15, enableCentury, frame15, labor15, previewYear15, provinceAgreement15,
  publishYear15, reopenChapter15 } from "../dist/century.js";
import { advanceQuarter, appoint, availableAttackers, cityRevenues, createGame, decodeSave, eraByYear, gameOutcome, playableFactions,
  previewOrders, queueOrder, seasonOrderLimit } from "../dist/engine.js";
import { frontierAttackOpportunities } from "../dist/frontier.js";
import { proposeDynastyTreaty } from "../dist/dynasty-treaties.js";
import { enrichWorld } from "../dist/personnel.js";
import { charterLeague10 } from "../dist/reign-leagues.js";
import { nationalRoster } from "../dist/roster.js";
import { createSaveBackup, readGameRecord, saveFileLimit } from "../dist/saves.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const start = (year = 199, player = "cao") => createGame(world, year, player, { century: true });
const plan = (state, mode, options) => publishYear15(world, state, annualDraft15(mode), options);
const roundTrip = (state) => decodeSave(world, JSON.stringify(state));
const stay = (state) => Object.fromEntries(Object.keys(state.factions).filter((key) => key !== state.player)
  .map((key) => [key, { source: "model", order: null, accord: null, politics: "", reason: "维持驻防" }]));

test("10.0 migration adds only the new campaign record, then forecasts and settles real quarters", () => {
  const old = createGame(world, 199, "cao", { reign: true });
  const upgraded = enableCentury(old);
  const { century, ...previous } = upgraded;
  assert.deepEqual(previous, old);
  assert.equal(century.plan, null);
  const draft = annualDraft15("accord");
  const projections = previewYear15(world, upgraded, draft, { auto: true });
  assert.equal(projections.proposed.length, 4);
  assert.notEqual(projections.current[0].cash, projections.proposed[0].cash);
  const next = advanceQuarter(world, publishYear15(world, upgraded, draft));
  assert.deepEqual(next.century.frames[0], Object.fromEntries(Object.entries(projections.proposed[0]).filter(([key]) => key !== "stalled")));
  assert.equal(Object.keys(frame15(world, next, 1).ownership).length, 42);
  assert.deepEqual(readGameRecord(world, createSaveBackup({ state: next, selected: "luoyang" })).state, next);
});

test("chartered retention and labor use affect the actual harvest and paid local accounts", () => {
  let state = plan(start(), "expansion");
  const region = world.cities.find(({ key }) => key === "luoyang").region;
  const flat = cityRevenues(state, "luoyang");
  state = provinceAgreement15(world, state, region, "compact");
  const retained = cityRevenues(state, "luoyang");
  assert.equal(flat.local + flat.grain, retained.local + retained.grain);
  assert.ok(retained.local > flat.local);
  const before = labor15(state, "luoyang");
  const army = state.armies.find(({ faction }) => faction === "cao");
  Object.assign(army, { depot: "luoyang", phase: "march", troops: 9000 });
  assert.ok(labor15(state, "luoyang").cultivation < before.cultivation);
  const burden = cityRevenues(state, "luoyang");
  assert.ok(burden.grain + burden.local < retained.grain + retained.local);
  const next = advanceQuarter(world, state, stay(state));
  assert.ok(next.century.charters[region].served > 0);
  assert.ok(next.history.at(-1).finance.century.budget.treasury > 0);
  roundTrip(next);
});

test("small factions can ratify a trade league, achieve their chapter and preserve it on continuation", () => {
  let state = plan(start(208, "liu"), "accord");
  state = charterLeague10(world, state, { target: "cao", invited: ["wu", "zhang"], dues: 1, term: 12, passage: true, military: true });
  for (let i = 0; i < 10 && !state.century.epochs.some(({ kind }) => kind === "accord"); i++) {
    state = advanceQuarter(world, state);
  }
  assert.equal(state.reign.leagues[0].status, "active");
  assert.ok(state.century.epochs.some(({ kind }) => kind === "accord"));
  const ending = concludeChapter15(state, "accord");
  assert.equal(gameOutcome(ending), "victory");
  const next = reopenChapter15(world, ending);
  assert.deepEqual(next.century.epochs, ending.century.epochs);
  assert.deepEqual(next.cities, state.cities);
  assert.equal(next.reign.stewardship.kind, "scenario");
  assert.equal(gameOutcome(next), "ongoing");
  roundTrip(next);
});

test("the regular Jin opening can expand, rebuild and bring a successful chapter to its conclusion", () => {
  let state = plan(start(265, "jin"), "expansion");
  const held = () => Object.values(state.cities).filter(({ owner }) => owner === "jin").length;
  for (let season = 0; season < 55 && gameOutcome(state) === "ongoing"; season++) {
    if (held() >= 35 && state.century.plan.primary === "expansion") state = plan(state, "recovery");
    if (held() < 35) for (let slot = 0; slot < seasonOrderLimit; slot++) {
      const planned = previewOrders(world, state);
      const attack = frontierAttackOpportunities(world, state, planned).entries[0];
      if (attack) { state = queueOrder(world, state, attack.order); continue; }
      const border = world.cities.find(({ key, links }) => planned.cities[key].owner === "jin" && planned.cities[key].troops < 4200
        && links.some((link) => planned.cities[link].owner !== "jin"));
      if (!border || planned.factions.jin.grain < 24 || planned.factions.jin.treasury < 25) break;
      if (!availableAttackers(eraByYear(world, planned), planned, "jin", border.key).length && !state.cities[border.key].commander) {
        const candidate = nationalRoster(world, state, { status: "available", sort: "command", query: "" }).matching[0];
        if (candidate) state = appoint(world, state, border.key, "commander", candidate.person.key);
      }
      state = queueOrder(world, state, { type: "recruit", city: border.key });
    }
    state = advanceQuarter(world, state);
    if (state.century.epochs.some(({ kind }) => kind === "expansion")) state = concludeChapter15(state, "expansion");
  }
  assert.equal(gameOutcome(state), "victory", JSON.stringify({ held: held(), stable: state.century.stable, stock: state.factions.jin,
    ready: Object.keys(state.cities).filter((key) => state.cities[key].owner === "jin" && state.realm.cities[key].welfare >= 59).length,
    stocked: Object.keys(state.cities).filter((key) => state.cities[key].owner === "jin" && state.reign.markets[key]?.bins >= 4).length }));
  assert.equal(state.century.concluded?.kind, "expansion");
  assert.ok(state.century.battles.length);
  roundTrip(state);
});

test("an actual provincial uprising opens the restoration chapter and recapture can resolve it", () => {
  let state = plan(start(), "accord");
  for (let i = 0; i < 4; i++) state = advanceQuarter(world, state, stay(state));
  const region = world.cities.find(({ key }) => key === "luoyang").region;
  state.polity.provinces["cao:" + region] = { pressure: 100, warning: 1, crisis: 2 };
  state.realm.cities.luoyang.welfare = 12;
  state.cities.luoyang.troops = 350;
  state = advanceQuarter(world, state, stay(state));
  const rebels = state.cities.luoyang.owner;
  assert.match(rebels, /^spl-/);
  assert.equal(state.century.chapter, "restoration");
  assert.equal(state.century.transitions.luoyang.to, rebels);
  assert.equal(state.century.transitions.luoyang.from, "cao");
  const front = world.cities.find(({ key, links }) => state.cities[key].owner === "cao" && links.includes("luoyang")
    && availableAttackers(eraByYear(world, state), state, "cao", key).length);
  assert.ok(front, "需要有可指挥的相邻城");
  state.cities[front.key].troops = 5800;
  state = plan(state, "recovery");
  state = proposeDynastyTreaty(world, state, { to: "yuan", seasons: 12, passage: false, defense: false, payment: 12, cede: null, post: null });
  const orders = frontierAttackOpportunities(world, state, previewOrders(world, state)).entries;
  const attack = orders.find(({ order }) => order.to === "luoyang");
  assert.ok(attack);
  state = queueOrder(world, state, attack.order);
  for (let i = 0; i < 25 && !state.century.epochs.some(({ kind }) => kind === "recovery"); i++) {
    state = advanceQuarter(world, state, stay(state));
  }
  assert.equal(state.cities.luoyang.owner, "cao", JSON.stringify({ restoration: state.century.restoration, stable: state.century.stable,
    transition: state.century.transitions.luoyang, battles: state.century.battles.filter(({ site }) => site === "luoyang").slice(-4) }));
  assert.ok(state.century.epochs.some(({ kind }) => kind === "recovery"));
  assert.equal(gameOutcome(concludeChapter15(state, "recovery")), "victory");
  roundTrip(state);
});

test("each rival has an independent annual choice and keeps valid decisions through another rival's failure", async () => {
  const first = plan(start(), "accord");
  const seen = [];
  const planner = createPlanner({ models: { client: () => ({ decide: async (messages) => {
    const prompt = messages[1].content;
    seen.push(prompt);
    if (prompt.startsWith("袁绍")) return { choice: "invalid" };
    return { choice: prompt.match(/^([0-9]+) /m)[1], reason: "恢复", century: prompt.startsWith("马腾") ? "recovery" : "accord" };
  } }) } });
  const proposals = await planner.plan(world, first);
  assert.equal(proposals.yuan.source, "fallback");
  assert.equal(proposals.ma.century, "recovery");
  assert.equal(proposals.biao.century, "accord");
  assert.ok(seen.every((prompt) => prompt.includes("年度国策 expansion")));
  const next = advanceQuarter(world, first, proposals);
  assert.equal(next.century.rulers.ma.kind, "recovery");
  assert.equal(next.century.rulers.biao.kind, "accord");
  assert.deepEqual(advanceQuarter(world, next, { ma: { century: "expansion" } }).century.rulers.ma, next.century.rulers.ma);
  roundTrip(next);
});

for (const year of [184, 190, 199, 208, 219, 234, 262, 265]) {
  const factions = playableFactions(eraByYear(world, year));
  for (const { key } of [factions[0], factions.at(-1)]) {
    for (const mode of ["expansion", "accord", "recovery"]) {
      for (const auto of [true, false]) {
        test(`${year} ${key} ${mode} ${auto ? "delegated" : "direct"} advances to a natural ending or 192 quarters`, (t) => {
          let state = plan(start(year, key), mode, { auto });
          let peakBytes = 0;
          for (let season = 0; season < 192 && gameOutcome(state) === "ongoing"; season++) {
            state = advanceQuarter(world, state);
            assert.equal(Object.keys(state.cities).length, 42);
            assert.equal(state.century.frames.length, state.turn);
            const backup = JSON.stringify(state);
            peakBytes = Math.max(peakBytes, Buffer.byteLength(backup));
            if (season % 8 === 0) assert.doesNotThrow(() => decodeSave(world, backup), "季度 " + state.turn);
          }
          roundTrip(state);
          assert.ok(peakBytes < saveFileLimit - 1500, "备份大小 " + peakBytes);
          assert.equal(Object.keys(frame15(world, state, state.turn).ownership).length, 42);
          t.diagnostic(state.turn + " quarters · " + gameOutcome(state) + " · " + peakBytes + " bytes");
        });
      }
    }
  }
}
