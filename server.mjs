import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlanner } from "./ai.mjs";
import { advanceQuarter, decodeSave, gameOutcome, turnVersion } from "./dist/engine.js";
import { enrichWorld } from "./dist/personnel.js";
import { turnStreamType } from "./dist/turn-stream.js";
import { createModelService } from "./model-service.mjs";

const directory = fileURLToPath(new URL("./dist/", import.meta.url));
const port = Number(process.env.SAN_PORT || 5173);
const world = enrichWorld(JSON.parse(await readFile(new URL("./dist/assets/world.json", import.meta.url), "utf8")));
const requestedTimeout = Number(process.env.SAN_AI_TIMEOUT_MS || 45_000);
const models = createModelService();
const planner = createPlanner({
  models,
  timeoutMs: Number.isInteger(requestedTimeout) ? Math.max(3000, Math.min(75_000, requestedTimeout)) : 45_000,
});
let modelRevision = 0;
let pendingRound;
let completedRound;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
};

function json(response, status, object) {
  response.writeHead(status, { "Content-Type": types[".json"], "Cache-Control": "no-store" });
  response.end(JSON.stringify(object));
}

function localCaller(request) {
  const host = request.headers.host;
  if (![ "127.0.0.1:" + port, "localhost:" + port ].includes(host)) return false;
  return !request.headers.origin || request.headers.origin === "http://" + host;
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 384_000) throw new Error("回合数据过大。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveModelSettings(request, response, operation) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    json(response, 415, { error: "请使用 JSON 发送模型配置。" });
    return;
  }
  try {
    const body = await readBody(request);
    if (operation === "models") {
      json(response, 200, { models: await models.list(body) });
      return;
    }
    if (operation === "test") {
      const result = await models.probe(body);
      json(response, result.status, result.body);
      return;
    }
    const result = await models.save(body);
    if (result.status === 200) {
      modelRevision += 1;
      completedRound = undefined;
    }
    json(response, result.status, result.status === 200 ? { ...result.body, turnVersion } : result.body);
  } catch (error) {
    const message = error instanceof SyntaxError ? "模型配置格式无效。" : error.message;
    json(response, 400, { error: message });
  }
}

async function streamTurn(response, round) {
  response.writeHead(200, { "Content-Type": turnStreamType + "; charset=utf-8", "Cache-Control": "no-store", Vary: "Accept" });
  response.flushHeaders();
  const send = (record) => {
    if (!response.destroyed && !response.writableEnded) response.write(JSON.stringify(record) + "\n");
  };
  const unsubscribe = () => round.listeners.delete(send);
  response.once("close", unsubscribe);
  for (const record of round.progress.values()) send(record);
  round.listeners.add(send);
  try {
    send({ type: "result", state: await round.work });
  } catch {
    // Without a result record, the browser settles the snapshot using local rules.
  } finally {
    unsubscribe();
    if (!response.destroyed) response.end();
  }
}

async function serveTurn(request, response) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    json(response, 415, { error: "请使用 JSON 发送回合数据。" });
    return;
  }
  let state;
  try {
    const body = await readBody(request);
    state = decodeSave(world, JSON.stringify(body.state));
  } catch {
    json(response, 400, { error: "回合数据无效。" });
    return;
  }
  if (gameOutcome(state) !== "ongoing") {
    json(response, 409, { error: "战局已结束。" });
    return;
  }
  const signature = createHash("sha256").update(String(modelRevision)).update(JSON.stringify(state)).digest("hex");
  const cached = completedRound?.signature === signature && completedRound.expires > Date.now() ? completedRound : undefined;
  if (!cached && pendingRound && pendingRound.signature !== signature) {
    json(response, 409, { error: "本机模型正在处理另一个回合。" });
    return;
  }
  if (!cached && !pendingRound) {
    const round = { signature, progress: new Map(), listeners: new Set() };
    pendingRound = round;
    round.work = planner.plan(world, state, (faction, source) => {
      const record = { type: "progress", faction, source };
      round.progress.set(faction, record);
      for (const send of round.listeners) send(record);
    }).then((proposals) => {
      const next = advanceQuarter(world, state, proposals);
      completedRound = { ...round, expires: Date.now() + 120_000 };
      return next;
    })
      .finally(() => { pendingRound = undefined; });
  }
  const round = cached ?? pendingRound;
  const acceptsStream = request.headers.accept?.split(",").some((type) => type.trim() === turnStreamType);
  if (acceptsStream) return streamTurn(response, round);
  try {
    const next = await round.work;
    response.setHeader("Vary", "Accept");
    json(response, 200, { state: next });
  } catch {
    json(response, 503, { error: "模型结算暂不可用。" });
  }
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (pathname.startsWith("/api/")) {
      if (!localCaller(request)) {
        json(response, 403, { error: "仅限本地游戏页面访问。" });
        return;
      }
      if (pathname === "/api/ai" && request.method === "GET") {
        json(response, 200, { ...models.status(), turnVersion });
        return;
      }
      if (request.method === "POST" && ["/api/ai/settings", "/api/ai/models", "/api/ai/test"].includes(pathname)) {
        await serveModelSettings(request, response, pathname.split("/").at(-1));
        return;
      }
      if (pathname === "/api/turn" && request.method === "POST") {
        await serveTurn(request, response);
        return;
      }
      json(response, 404, { error: "接口不存在。" });
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const filename = resolve(directory, "." + (pathname === "/" ? "/index.html" : pathname));
    const location = relative(directory, filename);
    if (location === ".." || location.startsWith(".." + sep) || !location || join(directory, location) !== filename) {
      response.writeHead(404).end("Not found");
      return;
    }
    const file = await stat(filename);
    if (!file.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[extname(filename)] || "application/octet-stream",
      "Content-Length": file.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filename).on("error", () => response.destroy()).pipe(response);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 404).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("经略三国  http://127.0.0.1:" + port);
});
