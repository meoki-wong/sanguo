import { readFile } from "node:fs/promises";
import { createPlanner } from "../ai.mjs";
import { createModelService } from "../model-service.mjs";
import { cloudModelUrl, requestPublicModel, verifyCloudModelAddress } from "../public-model-request.mjs";
import { advanceQuarter, decodeSave, gameOutcome, turnVersion } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import { turnStreamType } from "../dist/turn-stream.js";

export const maxDuration = 60;
const world = enrichWorld(JSON.parse(await readFile(new URL("../dist/assets/world.json", import.meta.url), "utf8")));
const cloudStatus = { sessionScoped: true, turnVersion };
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > 400_000) throw new Error("请求数据过大。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function modelOperation(operation, body) {
  const models = createModelService(requestPublicModel);
  try {
    cloudModelUrl(body?.baseUrl);
    if (operation === "models") return json({ models: await models.list(body) });
    if (operation === "test") {
      const result = await models.probe(body);
      return json(result.body, result.status);
    }
    await verifyCloudModelAddress(body.baseUrl);
    const result = await models.save(body);
    return json(result.status === 200 ? { ...result.body, ...cloudStatus } : result.body, result.status);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}

async function settleTurn(request, body) {
  let state;
  try { state = decodeSave(world, JSON.stringify(body?.state)); }
  catch { return json({ error: "回合数据无效。" }, 400); }
  if (gameOutcome(state) !== "ongoing") return json({ error: "战局已结束。" }, 409);
  const models = createModelService(requestPublicModel);
  if (body.modelConfig) {
    try {
      cloudModelUrl(body.modelConfig.baseUrl);
      if (!body.modelConfig.model?.trim()) throw new Error();
      await models.save(body.modelConfig);
    } catch { return json({ error: "模型配置无效。" }, 400); }
  }
  const planner = createPlanner({ models, timeoutMs: 40_000 });
  const play = async (progress) => advanceQuarter(world, state, await planner.plan(world, state, progress));
  const isStream = request.headers.get("accept")?.split(",").some((type) => type.trim() === turnStreamType);
  if (!isStream) {
    try { return json({ state: await play() }); }
    catch { return json({ error: "模型结算暂不可用。" }, 503); }
  }
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (record) => {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(record) + "\n"));
      };
      try {
        const result = await play((faction, source) => send({ type: "progress", faction, source }));
        send({ type: "result", state: result });
      } catch {
        // The browser can finish the round with its rule-based AI.
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, { headers: { "Content-Type": turnStreamType + "; charset=utf-8", "Cache-Control": "no-store", Vary: "Accept" } });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const operation = url.searchParams.get("operation");
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "请从游戏页面访问。" }, 403);
    if (operation === "status" && request.method === "GET") return json({ ready: false, ...cloudStatus });
    if (request.method !== "POST" || !["models", "test", "settings", "turn"].includes(operation)) {
      return json({ error: "接口不存在。" }, 404);
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "请使用 JSON 发送数据。" }, 415);
    }
    let body;
    try { body = await readJson(request); }
    catch { return json({ error: "请求数据无效或过大。" }, 400); }
    return operation === "turn" ? settleTurn(request, body) : modelOperation(operation, body);
  },
};
