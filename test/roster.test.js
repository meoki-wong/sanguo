import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { advanceQuarter, appoint, createGame, decodeSave, playableFactions, postingOf, previewOrders, queueOrder } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { nationalRoster, nationalVacancies, personnelDestinations, usePersonnel } from "../dist/roster.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function filtered(state, { status = "all", sort = "governance", query = "" } = {}) {
  return nationalRoster(world, state, { status, sort, query });
}

test("the national roster preserves both the posting and a pending expedition", () => {
  let state = createGame(world, 199, "cao");
  state = appoint(world, state, "luoyang", "commander", "cao-1");
  state = queueOrder(world, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 200 });
  const all = filtered(state, { sort: "command" });
  assert.equal(all.matching.length, all.total);
  assert.ok(all.matching.every(({ person }, index) => person.faction === state.player
    && (index === 0 || all.matching[index - 1].person.command >= person.command)));
  const subject = filtered(state, { status: "expedition", query: " 洛阳 " }).matching;
  assert.deepEqual(subject.map(({ person }) => person.key), ["cao-1"]);
  assert.equal(subject[0].posting.role, "commander");
  assert.equal(subject[0].expedition.to, "changan");
  assert.deepEqual(filtered(state, { status: "commander", query: "曹仁" }).matching, subject);
  assert.equal(filtered(state, { status: "available", query: "曹仁" }).matching.length, 0);
  assert.deepEqual(personnelDestinations(world, state, "cao-1", "station"), []);
  assert.throws(() => usePersonnel(world, state, "cao-1", "governor", "xu"), /出征令/);
});

test("confirmed assignments fill vacancies while preserving existing orders and portable saves", () => {
  const initial = createGame(world, 262, "shu");
  const person = initial.stations["shu-0"];
  const before = queueOrder(world, initial, { type: "recruit", city: "chengdu" });
  assert.equal(person, "chengdu");
  const destinations = personnelDestinations(world, before, "shu-0", "station");
  assert.ok(destinations.some(({ key }) => key === "nanzheng"));
  assert.ok(destinations.every(({ key }) => key !== person && initial.cities[key].owner === "shu"));
  const moved = usePersonnel(world, before, "shu-0", "station", "nanzheng");
  assert.equal(moved.stations["shu-0"], "nanzheng");
  assert.equal(postingOf(moved, "shu-0"), null);
  const appointed = usePersonnel(world, moved, "shu-0", "governor", "nanzheng");
  assert.deepEqual(postingOf(appointed, "shu-0"), { city: "nanzheng", role: "governor" });
  assert.deepEqual(appointed.orders, before.orders);
  assert.deepEqual(appointed.factions, before.factions);
  assert.equal(before.stations["shu-0"], "chengdu");
  assert.throws(() => usePersonnel(world, appointed, "shu-1", "governor", "nanzheng"), /空缺/);
  assert.throws(() => usePersonnel(world, appointed, "shu-0", "commander", "chengdu"), /空缺/);
  assert.throws(() => usePersonnel(world, appointed, "wei-0", "commander", "chengdu"), /空缺/);
  assert.deepEqual(decodeSave(world, JSON.stringify(appointed)), appointed);
});

test("a single-city faction can use local vacancies and a completed campaign is read-only", () => {
  const state = createGame(world, 199, "lu");
  assert.deepEqual(personnelDestinations(world, state, "lu-0", "station"), []);
  const local = personnelDestinations(world, state, "lu-0", "governor");
  assert.deepEqual(local.map(({ key }) => key), ["nanzheng"]);
  let filled = usePersonnel(world, state, "lu-0", "governor", "nanzheng");
  filled = usePersonnel(world, filled, "lu-1", "commander", "nanzheng");
  for (const role of ["station", "governor", "commander"]) {
    assert.deepEqual(personnelDestinations(world, filled, "lu-roster-0", role), []);
  }
  const finished = structuredClone(filled);
  for (const city of Object.values(finished.cities)) city.owner = "lu";
  assert.ok(filtered(finished).total > 0);
  assert.deepEqual(personnelDestinations(world, finished, "lu-roster-0", "station"), []);
  assert.throws(() => usePersonnel(world, finished, "lu-roster-0", "commander", "chengdu"), /当前无法/);
});

function vacancies(state, role = "all", area = "all") {
  return nationalVacancies(world, state, previewOrders(world, state), { role, area });
}

test("national vacancies prioritize effective recovery and front commanders while excluding queued personnel", () => {
  const initial = createGame(world, 199, "cao");
  Object.assign(initial.cities.luoyang, { occupation: 2 });
  Object.assign(initial.cities.xu, { occupation: 2, troops: 170 });
  const attack = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 200 };
  const state = queueOrder(world, initial, attack);
  const all = vacancies(state);
  assert.equal(all.available, vacancies(initial).available - 1);
  const [first, second] = all.matching;
  assert.equal(first.city.key, "luoyang");
  assert.equal(first.role, "governor");
  assert.equal(first.accelerates, true);
  assert.equal(first.departing, 1);
  assert.equal(first.stationed, vacancies(initial).matching[0].stationed - 1);
  assert.equal(second.zone, "front");
  assert.equal(second.role, "commander");
  assert.deepEqual(vacancies(state, "governor", "occupation").matching.map(({ city, accelerates }) =>
    [city.key, accelerates]), [["luoyang", true], ["xu", false]]);
  const reinforced = queueOrder(world, state, { type: "recruit", city: "xu" });
  assert.ok(vacancies(reinforced, "governor", "rear").matching.find(({ city }) => city.key === "xu").accelerates);
  assert.throws(() => usePersonnel(world, state, "cao-1", "commander", "luoyang"), /出征令/);

  const candidate = filtered(state, { status: "available" }).matching[0].person.key;
  const staffed = usePersonnel(world, state, candidate, "governor", "luoyang");
  assert.equal(vacancies(staffed).available, all.available - 1);
  assert.ok(!vacancies(staffed, "governor", "occupation").matching.some(({ city }) => city.key === "luoyang"));
  assert.deepEqual(staffed.personnelHistory.at(-1).to, { city: "luoyang", role: "governor" });
  assert.deepEqual(staffed.orders, state.orders);
});

test("vacancies reflect settled borders and remain inspectable when staffing is unavailable", () => {
  const initial = createGame(world, 199, "cao");
  initial.cities.changan.troops = 250;
  const attack = { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1000 };
  const state = queueOrder(world, initial, attack);
  assert.equal(previewOrders(world, state).cities.changan.owner, "cao");
  assert.ok(!vacancies(state).matching.some(({ city }) => city.key === "changan"));
  const rest = Object.fromEntries(playableFactions(world.scenarios[0]).filter(({ key }) => key !== "cao")
    .map(({ key }) => [key, { source: "model", order: null }]));
  const settled = advanceQuarter(world, state, rest);
  assert.deepEqual(vacancies(settled).matching.filter(({ city }) => city.key === "changan").map(({ role }) => role), ["governor"]);

  const exposed = createGame(world, 199, "cao");
  exposed.turn = world.scenarios[0].factions.findIndex(({ key }) => key === "ma");
  exposed.cities.luoyang.troops = 350;
  exposed.cities.changan.troops = 3200;
  exposed.stations["ma-1"] = "changan";
  exposed.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: exposed.turn, threshold: 1 };
  const lost = advanceQuarter(world, exposed, { ...rest, ma: { source: "rules" } });
  assert.equal(lost.cities.luoyang.owner, "ma");
  assert.ok(!vacancies(lost).matching.some(({ city }) => city.key === "luoyang"));

  const large = createGame(world, 265, "jin");
  let staffed = large;
  const idle = filtered(large, { status: "available" }).matching;
  vacancies(large).matching.slice(0, idle.length).forEach(({ city, role }, index) => {
    staffed = usePersonnel(world, staffed, idle[index].person.key, role, city.key);
  });
  assert.equal(vacancies(staffed).available, 0);
  assert.ok(vacancies(staffed).ongoing);
  assert.ok(vacancies(staffed).matching.length > 0);
  const finished = structuredClone(staffed);
  for (const city of Object.values(finished.cities)) city.owner = "jin";
  assert.equal(vacancies(finished).ongoing, false);
  assert.equal(vacancies(finished).available, 0);
  assert.ok(vacancies(finished).matching.length > vacancies(staffed).matching.length);
});
