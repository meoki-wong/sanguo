import assert from "node:assert/strict";
import test from "node:test";
import { readTurnResponse, turnStreamType } from "../dist/turn-stream.js";

test("reads fragmented stream records before returning the complete quarter", async () => {
  const progress = { type: "progress", faction: "yuan", source: "fallback" };
  const state = { turn: 1, report: "季末结算" };
  let stream;
  const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }), {
    headers: { "Content-Type": turnStreamType + "; charset=utf-8" },
  });
  let sawProgress;
  const pending = new Promise((resolve) => { sawProgress = resolve; });
  const result = readTurnResponse(response, sawProgress);
  const encoder = new TextEncoder();
  for (const byte of encoder.encode(JSON.stringify(progress) + "\n")) stream.enqueue(Uint8Array.of(byte));
  assert.deepEqual(await pending, progress);
  for (const byte of encoder.encode(JSON.stringify({ type: "result", state }) + "\n")) stream.enqueue(Uint8Array.of(byte));
  stream.close();
  assert.deepEqual(await result, { state });
});

test("still accepts the JSON response from an older game server", async () => {
  const result = { state: { turn: 1 } };
  assert.deepEqual(await readTurnResponse(Response.json(result), assert.fail), result);
});

test("a stream ending after partial progress does not produce a settlement", async () => {
  const body = '{"type":"progress","faction":"yuan","source":"model"}\n{"type":"result"';
  const response = new Response(body, { headers: { "Content-Type": turnStreamType } });
  const reports = [];
  await assert.rejects(readTurnResponse(response, (record) => reports.push(record)), /结算前中断/);
  assert.equal(reports.length, 1);
});
