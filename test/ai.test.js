import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPlanner, opponentKeys } from "../ai.mjs";
import {
  advanceQuarter, availableAttackers, createGame, decodeSave, delegateCities, describeOrder,
  forecastAttack, queueOrder, sendTreatyOffer, suggestDeployment, validateOrder,
} from "../dist/engine.js";
import { legacyProposals, legacySnapshot } from "../dist/legacy-turn.js";
import { enrichWorld } from "../dist/personnel.js";
import { assessGoal, factionPlans } from "../dist/strategy.js";
import { frontierIntel } from "../dist/frontier.js";
import { createModelService } from "../model-service.mjs";

const world = JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8"));

test("uses the configured API and only exposes each faction's own roster", async () => {
  const requests = [];
  const models = createModelService(async (url, request) => {
    const body = JSON.parse(request.body);
    const content = body.messages[1].content;
    requests.push({ url, body, content, auth: request.headers.Authorization });
    const choice = content.startsWith("蜀汉") ? "0" : "999";
    return Response.json({ choices: [{ message: { content: JSON.stringify({ choice, reason: "保留本季粮草" }) } }] });
  });
  await models.save({ baseUrl: "https://example.invalid/v1", model: "fixture", apiKey: "unit-test-only" });
  const state = createGame(world, 262, "wei");
  const planner = createPlanner({ models });
  assert.equal(models.status().model, "fixture");
  assert.equal(JSON.stringify(models.status()).includes("unit-test-only"), false);
  const decisions = await planner.plan(world, state);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ url, body, auth }) => url === "https://example.invalid/v1/chat/completions"
    && body.model === "fixture" && auth === "Bearer unit-test-only"));
  const shu = requests.find(({ content }) => content.startsWith("蜀汉"));
  const wu = requests.find(({ content }) => content.startsWith("东吴"));
  assert.match(shu.content, /己方人物.*姜维/);
  assert.doesNotMatch(shu.content, /己方人物.*陆抗|己方人物.*邓艾/);
  assert.match(wu.content, /己方人物.*陆抗/);
  assert.deepEqual(decisions.shu, {
    source: "model", order: null, reason: "保留本季粮草",
    goal: factionPlans(world, world.scenarios[1], state, "shu").goals[0],
  });
  assert.equal(decisions.wu.source, "fallback");
  assert.equal(state.turn, 0);
});

test("looks up a single model on save, preserves a key only for the same endpoint, and redacts status", async () => {
  const requests = [];
  const models = createModelService(async (url, request) => {
    requests.push({ url, auth: request.headers.Authorization });
    return Response.json({ data: [{ id: "default" }] });
  });
  const first = await models.save({ baseUrl: "https://model.example/custom/chat/completions", apiKey: "secret-test-value" });
  assert.equal(first.body.model, "default");
  assert.equal(first.body.hasKey, true);
  assert.ok(!JSON.stringify(first.body).includes("secret-test-value"));
  await models.list({ baseUrl: first.body.baseUrl });
  await models.list({ baseUrl: "https://other.example/custom" });
  assert.equal(requests[0].url, "https://model.example/custom/models");
  assert.equal(requests[1].auth, "Bearer secret-test-value");
  assert.equal(requests[2].auth, undefined);
  await assert.rejects(() => models.save({ baseUrl: "http://127.0.0.1:11434/v1", model: "unused" }), /兼容模型服务/);
});

test("probes draft settings once without saving, sending a game, or copying a key between endpoints", async () => {
  const requests = [];
  const models = createModelService(async (url, request) => {
    requests.push({ url, method: request.method, auth: request.headers.Authorization, body: JSON.parse(request.body) });
    return Response.json({ choices: [{ message: { content: '{"choice":"0","reason":"draft-secret"}' } }] });
  });
  assert.equal((await models.probe({ baseUrl: "https://example.invalid/v1" })).status, 422);
  assert.equal(requests.length, 0);
  await models.save({ baseUrl: "https://example.invalid/v1", model: "live", apiKey: "saved-secret" });
  const saved = models.status();
  const draft = { baseUrl: "https://example.invalid/v1/chat/completions", model: "trial" };
  for (const input of [draft, { ...draft, apiKey: "draft-secret" }, { ...draft, baseUrl: "https://other.example/v2" }]) {
    const before = requests.length;
    assert.deepEqual(await models.probe(input), { status: 200, body: { ok: true } });
    assert.equal(requests.length, before + 1);
  }
  assert.deepEqual(requests.map(({ auth }) => auth), ["Bearer saved-secret", "Bearer draft-secret", undefined]);
  for (const { body, method } of requests) {
    assert.equal(method, "POST");
    assert.deepEqual(Object.keys(body).sort(), ["messages", "model", "stream"]);
    assert.equal(body.model, "trial");
    assert.equal(body.stream, false);
    assert.equal(body.messages.length, 1);
    assert.match(body.messages[0].content, /"choice":"0"/);
  }
  assert.deepEqual(models.status(), saved);
});

test("probe diagnoses response and timeout failures without returning upstream text or retrying", async () => {
  const secret = "opaque-probe-secret";
  const upstreamError = (status, code) => () => Response.json({ error: { code, message: secret } }, { status });
  const badReply = (content) => () => Response.json({ choices: [{ message: { content } }] });
  const cases = [
    [upstreamError(401), /鉴权.*API Key/],
    [upstreamError(403), /鉴权.*API Key/],
    [upstreamError(404), /找不到模型/],
    [upstreamError(400, "model_not_found"), /找不到指定模型/],
    [upstreamError(415), /不兼容/],
    [upstreamError(504), /超时/],
    [badReply(secret), /不兼容/],
    [badReply('{"choice":"7","reason":"ok"}'), /不兼容/],
    [() => { throw new DOMException(secret, "TimeoutError"); }, /超时/],
    [() => { throw new Error(secret); }, /检查 Base URL 和网络/],
  ];
  for (const [reply, message] of cases) {
    let requests = 0;
    const models = createModelService(async (_url, { signal }) => {
      requests += 1;
      assert.equal(signal.aborted, false);
      return reply();
    });
    const result = await models.probe({ baseUrl: "https://example.invalid/v1", apiKey: secret, model: "trial" });
    assert.equal(requests, 1);
    assert.equal(result.body.ok, false);
    assert.match(result.body.error, message);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.equal(models.status().ready, false);
  }
});

test("revalidates proposed orders and keeps the player's order and previous saves usable", () => {
  const initial = createGame(world, 262, "wei");
  const state = queueOrder(world, initial, { type: "build", city: "luoyang", project: "farming" });
  const next = advanceQuarter(world, state, {
    shu: { source: "model", order: { type: "build", city: "luoyang", project: "defense" }, reason: "这座城属于别人" },
    wu: { source: "model", order: null, reason: "需要留粮" },
  });
  const report = next.history.at(-1);
  assert.equal(report.decisions.find(({ faction }) => faction === "shu").source, "fallback");
  assert.equal(report.decisions.find(({ faction }) => faction === "wu").orderType, "rest");
  assert.equal(next.cities.luoyang.farming, initial.cities.luoyang.farming + 1);
  assert.equal(next.cities.luoyang.defense, initial.cities.luoyang.defense);
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
  delete report.decisions;
  assert.deepEqual(decodeSave(world, JSON.stringify(next)), next);
});

test("a running legacy model service contributes decisions without replacing the current game state", () => {
  const expanded = enrichWorld(world);
  const era = world.scenarios[1];
  let state = createGame(expanded, era.year, "wei");
  state = delegateCities(expanded, state, ["luoyang"], "recruit", 22);
  state = queueOrder(expanded, state, { type: "build", city: "luoyang", project: "farming" });
  const request = legacySnapshot(world, state);
  assert.equal(request.stations, undefined);
  assert.equal(request.cities.luoyang.governor, null);
  assert.equal(request.cities.luoyang.focus, "farming");
  assert.equal(request.order, null);
  assert.equal(request.orders, undefined);
  const v2 = legacySnapshot(expanded, state, 2);
  assert.equal(v2.orders, undefined);
  assert.deepEqual(v2.stations, state.stations);
  assert.equal(v2.cities.luoyang.focus, "recruit");
  const order = { type: "build", city: "chengdu", project: "commerce" };
  const report = {
    decisions: [
      { faction: "shu", source: "model", action: describeOrder(world, era, order), reason: "补足税收" },
      { faction: "wu", source: "fallback", reason: "模型决策超时" },
    ],
  };
  const proposals = legacyProposals(world, request, report, [{ key: "shu" }, { key: "wu" }]);
  assert.deepEqual(proposals.shu.order, order);
  assert.equal(proposals.wu.source, "fallback");
  const next = advanceQuarter(expanded, state, proposals);
  assert.equal(next.cities.chengdu.commerce, state.cities.chengdu.commerce + 1);
  assert.equal(next.cities.luoyang.farming, state.cities.luoyang.farming + 1);
  assert.equal(next.cities.luoyang.troops, 2800);
  assert.equal(next.stations[next.cities.luoyang.governor], "luoyang");
});

test("a model-chosen goal survives save and load and stays in the next faction prompt", async () => {
  const prompts = [];
  const era = world.scenarios[1];
  const initial = createGame(world, era.year, "wei");
  const shuChoice = factionPlans(world, era, initial, "shu").choices
    .find(({ goal, order }) => goal.type === "economy" && order === null);
  const planner = createPlanner({ models: { client: () => ({
    decide: async ([, message]) => {
      prompts.push(message.content);
      const continuing = message.content.includes("继续执行现有战略目标");
      return { choice: !continuing && message.content.startsWith("蜀汉") ? shuChoice.id : "0", reason: "先稳定局势" };
    },
  }) } });
  const first = advanceQuarter(world, initial, await planner.plan(world, initial));
  const saved = decodeSave(world, JSON.stringify(first));
  assert.deepEqual(saved.strategies.shu, shuChoice.goal);
  assert.ok(saved.strategies.wu && saved.strategies.wu !== saved.strategies.shu);
  const proposals = await planner.plan(world, saved);
  const shu = prompts.filter((prompt) => prompt.startsWith("蜀汉")).at(-1);
  assert.match(shu, /继续执行现有战略目标/);
  assert.equal([...shu.matchAll(/^目标 /gm)].length, 1);
  const fallback = advanceQuarter(world, saved, { ...proposals, shu: { source: "fallback", reason: "模型超时" } });
  const result = fallback.history.at(-1).decisions.find(({ faction }) => faction === "shu");
  assert.equal(result.source, "fallback");
  assert.deepEqual(result.strategy.goal, shuChoice.goal);
  assert.ok(result.strategy.progress > first.history.at(-1).decisions.find(({ faction }) => faction === "shu").strategy.progress);
});

test("strategy candidates can supply a threatened front and replan after achieving or losing a goal", () => {
  const era = world.scenarios[0];
  const state = createGame(world, era.year, "yuan");
  const goal = { type: "defend", city: "luoyang", target: "ye", threshold: 3000, since: 0 };
  state.strategies.cao = goal;
  const plan = factionPlans(world, era, state, "cao");
  assert.equal(plan.keep, true);
  assert.deepEqual(plan.goals, [goal]);
  const reinforcement = plan.choices.find(({ order }) => order?.type === "transfer");
  assert.equal(reinforcement.order.to, "luoyang");
  const settled = advanceQuarter(world, state, { cao: { source: "model", ...reinforcement } });
  const decision = settled.history.at(-1).decisions.find(({ faction }) => faction === "cao");
  assert.equal(decision.orderType, "transfer");
  assert.equal(decision.source, "model");
  assert.equal(settled.cities.luoyang.troops, state.cities.luoyang.troops + reinforcement.order.troops);
  assert.deepEqual(decodeSave(world, JSON.stringify(settled)), settled);
  const v1 = legacySnapshot(world, settled);
  assert.ok(v1.history.at(-1).decisions.every(({ orderType }) => orderType !== "transfer"));
  const v3 = legacySnapshot(world, settled, 3);
  assert.ok(v3.history.at(-1).decisions.some(({ orderType }) => orderType === "transfer"));
  assert.deepEqual(v3.orders, []);
  assert.equal(v3.strategies, undefined);

  state.turn = 3;
  assert.equal(assessGoal(state, "cao", goal).status, "expired");
  assert.ok(factionPlans(world, era, state, "cao").goals.every(({ since }) => since === 3));
  state.cities.luoyang.troops = 3200;
  assert.equal(assessGoal(state, "cao", goal).status, "achieved");
  state.cities.luoyang.owner = "yuan";
  assert.equal(assessGoal(state, "cao", goal).status, "lost");
  assert.equal(factionPlans(world, era, state, "cao").keep, false);
});

test("an older strategic model cannot execute an attack covered by a new treaty", () => {
  const era = world.scenarios[0];
  const initial = createGame(world, era.year, "cao");
  initial.cities.changan.troops = 3200;
  initial.cities.tianshui.commander = null;
  initial.stations["ma-1"] = "changan";
  initial.strategies.ma = { type: "expand", since: 0, city: "changan", target: "luoyang", threshold: 1 };
  const signed = sendTreatyOffer(world, initial, "ma", "truce");
  assert.equal(assessGoal(signed, "ma", initial.strategies.ma).status, "lost");
  const snapshot = legacySnapshot(world, signed, 4);
  assert.deepEqual(snapshot.strategies, signed.strategies);
  assert.equal(snapshot.treaties, undefined);
  assert.equal(snapshot.treatyOffers, undefined);
  const threat = factionPlans(world, era, snapshot, "ma").choices.find(({ order }) => order?.type === "attack");
  const report = { decisions: [{
    faction: "ma", source: "model", reason: "进取洛阳",
    action: describeOrder(world, era, threat.order), strategy: { goal: threat.goal },
  }] };
  const proposals = legacyProposals(world, snapshot, report, [{ key: "ma" }], 4);
  assert.deepEqual(proposals.ma.order, threat.order);
  const settled = advanceQuarter(world, signed, proposals);
  const fallback = settled.history.at(-1).decisions.find(({ faction }) => faction === "ma");
  assert.equal(fallback.source, "fallback");
  assert.match(fallback.reason, /保护/);
  assert.equal(settled.cities.luoyang.owner, "cao");
});

function staffingFixture() {
  const expanded = enrichWorld(world);
  const era = expanded.scenarios[1];
  const state = createGame(expanded, era.year, "wei");
  for (const { key, faction } of era.officers) {
    if (faction === "shu" && state.stations[key] === "nanzheng") state.stations[key] = "zitong";
  }
  state.cities.nanzheng.troops = 2200;
  state.cities.tianshui.troops = 850;
  state.cities.tianshui.defense = 1;
  const goal = { type: "expand", city: "nanzheng", target: "tianshui", since: 0, threshold: 1 };
  state.strategies.shu = goal;
  return { expanded, era, state, goal };
}

test("rule opponents fill a vacant front from a connected rear and use the commander next quarter", () => {
  const { expanded, era, state, goal } = staffingFixture();
  const order = suggestDeployment(expanded, era, state, "shu", goal.city, goal.target);
  assert.ok(order);
  assert.equal(factionPlans(expanded, era, state, "shu").suggested.order.type, "deploy");
  assert.ok(!factionPlans(expanded, era, state, "shu", { allowDeployment: false }).choices.some(({ order }) => order?.type === "deploy"));
  const attackAtFront = { type: "attack", from: "tianshui", to: "nanzheng", officer: "wei-1", troops: 600 };
  const before = forecastAttack(era, state, attackAtFront, "wei");
  const after = advanceQuarter(expanded, state);
  const intact = decodeSave(expanded, JSON.stringify(after));
  assert.equal(intact.cities.nanzheng.commander, order.officer);
  assert.equal(frontierIntel(expanded, intact, "tianshui").opponents.find(({ key }) => key === "nanzheng").commander, order.officer);
  assert.notEqual(state.stations[order.officer], "nanzheng");
  assert.equal(intact.stations[order.officer], "nanzheng");
  assert.equal(intact.cities[order.from].commander, state.cities[order.from].commander);
  assert.equal(intact.cities[order.from].troops, state.cities[order.from].troops);
  assert.ok(forecastAttack(era, intact, attackAtFront, "wei").defense > before.defense);
  assert.equal(suggestDeployment(expanded, era, intact, "shu", goal.city, goal.target), null);
  const decision = intact.history.at(-1).decisions.find(({ faction }) => faction === "shu");
  assert.equal(decision.orderType, "deploy");
  assert.equal(decision.source, "rules");
  const deployment = intact.history.at(-1).entries.find(({ orderType, city }) => orderType === "deploy" && city === "nanzheng");
  assert.deepEqual(deployment.personnelChange, {
    officer: order.officer, from: { city: order.from, role: null }, to: { city: "nanzheng", role: "commander" },
  });
  assert.ok(availableAttackers(era, intact, "shu", "nanzheng").some(({ key }) => key === order.officer));
  const following = advanceQuarter(expanded, intact);
  assert.equal(following.cities.tianshui.owner, "shu");
  assert.equal(following.cities.tianshui.commander, order.officer);
});

test("deployment protects officeholders, exposed stations, disconnected territory, and treaties", () => {
  const { expanded, era, state, goal } = staffingFixture();
  const order = suggestDeployment(expanded, era, state, "shu", goal.city, goal.target);
  const incumbent = state.cities.chengdu.governor;
  assert.throws(() => validateOrder(expanded, state, "shu", { ...order, officer: incumbent, from: state.stations[incumbent] }), /后方城池/);
  const disconnected = structuredClone(state);
  disconnected.cities.zitong.owner = "wei";
  assert.equal(suggestDeployment(expanded, era, disconnected, "shu", goal.city, goal.target), null);
  const offensiveDonor = structuredClone(state);
  offensiveDonor.stations[order.officer] = "shangyong";
  assert.throws(() => validateOrder(expanded, offensiveDonor, "shu", { ...order, from: "shangyong" }), /后方城池/);
  const protectedFront = sendTreatyOffer(expanded, state, "shu", "truce");
  assert.equal(suggestDeployment(expanded, era, protectedFront, "shu", goal.city, goal.target), null);
  assert.throws(() => validateOrder(expanded, protectedFront, "shu", order), /前线城池/);
  assert.throws(() => validateOrder(expanded, state, "wei", order), /前线城池/);
});

test("an earlier change of ownership cancels the deployment and leaves the officer at the rear", () => {
  const { expanded, era, state, goal } = staffingFixture();
  const appointment = suggestDeployment(expanded, era, state, "shu", goal.city, goal.target);
  state.cities.tianshui.troops = 3900;
  state.stations["wei-1"] = "tianshui";
  const queued = queueOrder(expanded, state, { type: "attack", from: "tianshui", to: "nanzheng", troops: 3500, officer: "wei-1" });
  const next = advanceQuarter(expanded, queued);
  assert.equal(next.cities.nanzheng.owner, "wei");
  assert.equal(next.stations[appointment.officer], appointment.from);
  const notice = next.history.at(-1).entries.find(({ type, orderType }) => type === "notice" && orderType === "deploy");
  assert.ok(notice);
  assert.equal(notice.personnelChange, undefined);
});

test("models can select the deployment and an older model leaves the same work to rules", async () => {
  const { expanded, era, state, goal } = staffingFixture();
  const planner = createPlanner({ models: { client: () => ({
    decide: async ([, message]) => {
      const assignment = message.content.match(/^(\d+) 调.*任守将/m);
      return { choice: assignment?.[1] ?? "0", reason: "补足前线守将" };
    },
  }) } });
  const planned = await planner.plan(expanded, state);
  assert.equal(planned.shu.order.type, "deploy");
  const settled = advanceQuarter(expanded, state, planned);
  const decision = settled.history.at(-1).decisions.find(({ faction }) => faction === "shu");
  assert.equal(decision.orderType, "deploy");
  assert.equal(decision.source, "model");
  const modernSnapshot = legacySnapshot(expanded, state, 9);
  assert.deepEqual(modernSnapshot, state);
  const opponents = opponentKeys(expanded, state).map((key) => ({ key }));
  const v9 = legacyProposals(expanded, modernSnapshot, settled.history.at(-1), opponents, 9);
  assert.deepEqual(advanceQuarter(expanded, state, v9), settled);
  const snapshot = legacySnapshot(expanded, settled, 8);
  assert.ok(snapshot.history.at(-1).decisions.every(({ orderType }) => orderType !== "deploy"));
  const old = legacyProposals(expanded, legacySnapshot(expanded, state, 8), { decisions: [
    { faction: "shu", source: "model", reason: "休养兵力", action: describeOrder(expanded, era, null), strategy: { goal } },
  ] }, [{ key: "shu" }], 8);
  assert.equal(old.shu.source, "model");
  const replay = advanceQuarter(expanded, state, old);
  const legacyDecision = replay.history.at(-1).decisions.find(({ faction }) => faction === "shu");
  assert.equal(legacyDecision.source, "fallback");
  assert.equal(legacyDecision.orderType, "deploy");
});

function recoveryFixture() {
  const expanded = enrichWorld(world);
  const era = expanded.scenarios[0];
  const state = createGame(expanded, 199, "cao");
  Object.assign(state.cities.changan, { occupation: 2, troops: 500, farming: 4, commerce: 3 });
  state.strategies.ma = { type: "economy", since: state.turn, threshold: state.factions.ma.grain + 1000 };
  return { expanded, era, state };
}

test("the AI offers valuable vacant occupation posts and appoints one governor through its ordinary order", async () => {
  const { expanded, era, state } = recoveryFixture();
  for (const city of ["anding", "tianshui"]) {
    Object.assign(state.cities[city], { owner: "ma", troops: 500, occupation: 2, governor: null });
  }
  const before = structuredClone(state);
  const plan = factionPlans(expanded, era, state, "ma");
  const appointments = plan.choices.filter(({ order }) => order?.type === "appoint-governor");
  assert.equal(appointments.length, 2);
  assert.equal(appointments[0].order.city, "changan");
  assert.ok(plan.choices.some(({ order }) => order?.type === "build"));
  assert.deepEqual(plan.suggested.order, appointments[0].order);
  assert.deepEqual(plan.suggested.goal, state.strategies.ma);
  assert.deepEqual(state, before);

  const planner = createPlanner({ models: { client: () => ({
    decide: async ([, message]) => {
      const match = message.content.match(/^(\d+) 任命.*为长安太守/m);
      return { choice: match?.[1] ?? "0", reason: match ? "恢复长安税粮" : "保留钱粮" };
    },
  }) } });
  const proposals = await planner.plan(expanded, state);
  assert.equal(proposals.ma.order.type, "appoint-governor");
  const settled = advanceQuarter(expanded, state, proposals);
  const report = settled.history.at(-1);
  assert.equal(report.decisions.find(({ faction }) => faction === "ma").source, "model");
  assert.deepEqual(report.entries.filter(({ faction, orderType }) => faction === "ma" && orderType === "appoint-governor")
    .map(({ city }) => city), ["changan"]);
  const appointment = report.entries.find(({ faction, orderType }) => faction === "ma" && orderType === "appoint-governor");
  assert.deepEqual(appointment.personnelChange, {
    officer: proposals.ma.order.officer, from: { city: state.stations[proposals.ma.order.officer], role: null },
    to: { city: "changan", role: "governor" },
  });
  assert.ok(report.entries.some(({ type, city }) => type === "recovery" && city === "changan"));
  assert.equal(settled.cities.changan.governor, proposals.ma.order.officer);
  assert.equal(settled.stations[proposals.ma.order.officer], "changan");
  assert.equal(settled.cities.changan.occupation, 0);
  assert.deepEqual(settled.strategies.ma, state.strategies.ma);
  assert.deepEqual(decodeSave(expanded, JSON.stringify(settled)), settled);
  assert.ok(legacySnapshot(expanded, settled, 10).history.at(-1).decisions.every(({ orderType }) => orderType !== "appoint-governor"));
  const oldRequest = legacySnapshot(expanded, state, 11);
  const opponents = opponentKeys(expanded, state).map((key) => ({ key }));
  assert.deepEqual(advanceQuarter(expanded, state, legacyProposals(expanded, oldRequest, report, opponents, 11)), settled);
  const oldReport = legacySnapshot(expanded, settled, 15).history.at(-1);
  assert.ok(oldReport.entries.every(({ personnelChange }) => personnelChange === undefined));
  assert.deepEqual(advanceQuarter(expanded, state, legacyProposals(expanded, state, oldReport, opponents, 15)), settled);
});

test("rules appoint when useful, while a stale appointment cancels if the player takes the city first", () => {
  const { expanded, era, state } = recoveryFixture();
  const expected = factionPlans(expanded, era, state, "ma").suggested.order;
  const recovered = advanceQuarter(expanded, state, { ma: { source: "fallback", reason: "模拟模型超时" } });
  assert.equal(recovered.cities.changan.governor, expected.officer);
  const decision = recovered.history.at(-1).decisions.find(({ faction }) => faction === "ma");
  assert.equal(decision.source, "fallback");
  assert.equal(decision.reason, "模拟模型超时");

  const unavailable = structuredClone(state);
  unavailable.cities.changan.troops = 249;
  assert.ok(!factionPlans(expanded, era, unavailable, "ma").choices.some(({ order }) => order?.type === "appoint-governor"));
  assert.throws(() => validateOrder(expanded, unavailable, "ma", expected), /无需补任/);
  unavailable.cities.changan.troops = 500;
  unavailable.cities.tianshui.commander = expected.officer;
  assert.throws(() => validateOrder(expanded, unavailable, "ma", expected), /待任/);

  const attack = queueOrder(expanded, state, { type: "attack", from: "luoyang", to: "changan", officer: "cao-1", troops: 1000 });
  const seized = advanceQuarter(expanded, attack);
  assert.equal(seized.cities.changan.owner, "cao");
  assert.equal(seized.cities.changan.governor, null);
  const notice = seized.history.at(-1).entries.find(({ type, orderType, text }) =>
    type === "notice" && orderType === "appoint-governor" && text.includes("目标城池已经易主"));
  assert.ok(notice);
  assert.equal(notice.personnelChange, undefined);

  const oldRequest = legacySnapshot(expanded, state, 10);
  const previous = factionPlans(expanded, era, oldRequest, "ma", { allowRecoveryAppointments: false });
  const rest = previous.choices.find(({ order }) => !order);
  const oldDecisions = { decisions: [{ faction: "ma", source: "model", action: describeOrder(expanded, era, rest.order),
    reason: "保留钱粮", strategy: { goal: rest.goal } }] };
  const replay = advanceQuarter(expanded, state, legacyProposals(expanded, oldRequest, oldDecisions, [{ key: "ma" }], 10));
  assert.equal(replay.cities.changan.occupation, 1);
  assert.equal(replay.cities.changan.governor, null);
  assert.equal(replay.history.at(-1).decisions.find(({ faction }) => faction === "ma").source, "model");

  const opening = structuredClone(state);
  opening.cities.changan.troops = 3000;
  opening.cities.luoyang.troops = 750;
  opening.strategies.ma = { type: "expand", city: "changan", target: "luoyang", since: 0, threshold: 1 };
  const military = factionPlans(expanded, era, opening, "ma");
  assert.equal(military.suggested.order.type, "attack");
  assert.ok(military.choices.some(({ order }) => order?.type === "appoint-governor"));
});

test("rules keep a defense that can stop the attack and may restore a safer city when it cannot", () => {
  const { expanded, era, state } = recoveryFixture();
  Object.assign(state.cities.tianshui, { troops: 850, defense: 1, commander: null });
  state.cities.guzang.troops = 250;
  state.cities.anding.troops = 250;
  state.cities.nanzheng.troops = 1100;
  state.strategies.ma = { type: "defend", city: "tianshui", target: "nanzheng", since: 0, threshold: 2600 };
  const protect = factionPlans(expanded, era, state, "ma");
  assert.equal(protect.suggested.order.type, "recruit");
  assert.equal(protect.suggested.order.city, "tianshui");
  state.cities.nanzheng.troops = 2600;
  const restore = factionPlans(expanded, era, state, "ma");
  assert.equal(restore.suggested.order.type, "appoint-governor");
  assert.equal(restore.suggested.order.city, "changan");
  assert.deepEqual(restore.suggested.goal, state.strategies.ma);
});
