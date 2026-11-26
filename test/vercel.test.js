import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import api from "../api/game.js";
import { createGame, turnVersion } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { readTurnResponse, turnStreamType } from "../dist/turn-stream.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url))));
const origin = "https://jinglue.example";
const call = (operation, body, accept) => api.fetch(new Request(origin + "/api/game?operation=" + operation, body ? {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json", Accept: accept ?? "application/json" },
  body: JSON.stringify(body),
} : undefined));

test("Vercel exposes only per-session model settings and rejects local model destinations", async () => {
  const status = await (await call("status")).json();
  assert.deepEqual(status, { ready: false, sessionScoped: true, turnVersion });
  for (const baseUrl of ["http://provider.example/v1", "https://127.0.0.1/v1", "https://[::1]/v1", "https://server.internal/v1"]) {
    const result = await call("settings", { baseUrl, apiKey: "test-key", model: "fixture" });
    assert.equal(result.status, 400);
    assert.ok(!(await result.text()).includes("test-key"));
  }
  const crossOrigin = await api.fetch(new Request(origin + "/api/game?operation=status", { headers: { Origin: "https://other.example" } }));
  assert.equal(crossOrigin.status, 403);
});

test("Vercel validates a 10.0 save and advances the actual rule engine using JSON and the browser's stream format", async () => {
  const state = createGame(world, 199, "cao", { reign: true });
  assert.equal((await call("turn", { state: {} })).status, 400);
  const plain = await (await call("turn", { state })).json();
  const streamed = await readTurnResponse(await call("turn", { state }, turnStreamType));
  assert.deepEqual(streamed, plain);
  assert.equal(streamed.state.turn, 1);
  assert.equal(Object.keys(streamed.state.cities).length, 44);
  assert.ok(streamed.state.highCommand);
  assert.equal(streamed.state.dynasty.timelines[0].turn, 1);
  assert.equal(streamed.state.strategy9.since, 0);
  assert.equal(streamed.state.reign.since, 0);
  const incompatible = await call("turn", { state, modelConfig: { baseUrl: "http://fixture.invalid", model: "fixture", apiKey: "session-secret" } });
  assert.equal(incompatible.status, 400);
  assert.ok(!(await incompatible.text()).includes("session-secret"));
  const parallel = await Promise.all([call("turn", { state, modelConfig: { baseUrl: "http://fixture.invalid", model: "fixture" } }),
    call("turn", { state })]);
  assert.equal(parallel[0].status, 400);
  assert.deepEqual(await parallel[1].json(), plain);
});
