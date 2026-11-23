const completionPath = "/chat/completions";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);
const probeMessages = [{ role: "user", content: '只返回这个 JSON 对象：{"choice":"0","reason":"ok"}' }];

function readField(input, name, limit) {
  const value = input[name] ?? "";
  if (typeof value !== "string" || value.length > limit) throw new Error("模型配置的字段无效。");
  return value.trim();
}

function parseAddress(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("请填写有效的 Base URL。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL 应为 HTTP 或 HTTPS 地址。请单独填写 API Key。");
  }
  const path = url.pathname.replace(/\/+$/, "") || "/v1";
  const root = path.endsWith(completionPath) ? path.slice(0, -completionPath.length) : path;
  if (url.port === "11434" || (loopbackHosts.has(url.hostname) && path.startsWith("/api/chat"))) {
    throw new Error("请填写你要用的兼容模型服务地址。");
  }
  return {
    url, baseUrl: url.origin + (root || completionPath),
    completion: url.origin + root + completionPath, models: url.origin + root + "/models",
  };
}

function modelResponseError(status) {
  const error = new Error(status === 401 || status === 403
    ? "模型服务拒绝鉴权，请检查 API Key。"
    : "模型服务返回 HTTP " + status + "。");
  error.status = status;
  return error;
}

function invalidDecision() {
  return Object.assign(new Error("模型未返回有效政令。"), { code: "INVALID_MODEL_OUTPUT" });
}

async function readDecision(response, signal, key) {
  const payload = await response.json().catch(() => null);
  signal.throwIfAborted();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw invalidDecision();
  try {
    const text = content.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, "")
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const result = JSON.parse(text);
    if (!result || typeof result.choice !== "string" || typeof result.reason !== "string") throw invalidDecision();
    if (key) result.reason = result.reason.split(key).join("…");
    return result;
  } catch {
    throw invalidDecision();
  }
}

function probeFailure(status, error) {
  return { status, body: { ok: false, error } };
}

function probeTimeout() {
  return probeFailure(504, "模型连接超时，请确认服务在线后重试。");
}

function probeIncompatible() {
  return probeFailure(502, "模型响应与游戏不兼容，请确认支持 Chat Completions 和 JSON 回复。");
}

export function createModelService(request = fetch) {
  let saved;

  function prepare(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("请填写模型配置。");
    const address = parseAddress(readField(input, "baseUrl", 1024));
    const key = readField(input, "apiKey", 8192) || (saved?.completion === address.completion ? saved.key : "");
    if (key && address.url.protocol === "http:" && !loopbackHosts.has(address.url.hostname)) {
      throw new Error("携带 API Key 的远程服务请使用 HTTPS。");
    }
    if (key && /[\r\n]/.test(key)) throw new Error("请填写单行 API Key。");
    return { ...address, key, model: readField(input, "model", 160) };
  }

  function headers(key) {
    return { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) };
  }

  function complete(config, body, signal) {
    return request(config.completion, {
      method: "POST", headers: headers(config.key), redirect: "error", signal, body: JSON.stringify(body),
    });
  }

  async function listModels(config) {
    let response;
    try {
      response = await request(config.models, { headers: headers(config.key), redirect: "error", signal: AbortSignal.timeout(8000) });
    } catch {
      throw new Error("暂时无法读取模型列表，可以填写服务提供的模型 ID。");
    }
    if (!response.ok) throw modelResponseError(response.status);
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.data)) throw new Error("服务未返回模型列表，可以手动填写模型 ID。");
    return [...new Set(payload.data.map((entry) => entry?.id)
      .filter((id) => typeof id === "string" && id.trim() && id.length <= 160))].sort().slice(0, 300);
  }

  function status() {
    return { ready: Boolean(saved), baseUrl: saved?.baseUrl || "", model: saved?.model || "", hasKey: Boolean(saved?.key) };
  }

  async function save(input) {
    const config = prepare(input);
    if (!config.model) {
      const models = await listModels(config);
      if (models.length !== 1) {
        const message = models.length ? "请选择要使用的模型 ID。" : "请填写服务提供的模型 ID。";
        return { status: 422, body: { error: message, models } };
      }
      [config.model] = models;
    }
    saved = config;
    return { status: 200, body: status() };
  }

  async function probe(input) {
    const config = prepare(input);
    if (!config.model) return probeFailure(422, "请填写模型 ID 后再测试。");
    const signal = AbortSignal.timeout(8000);
    try {
      const response = await complete(config, { model: config.model, messages: probeMessages, stream: false }, signal);
      if (!response.ok) {
        const { status } = response;
        if ([400, 422].includes(status)) {
          const payload = await response.json().catch(() => null);
          signal.throwIfAborted();
          if (payload?.error?.code === "model_not_found") {
            return probeFailure(502, "找不到指定模型，请核对模型 ID。");
          }
          return probeIncompatible();
        }
        response.body?.cancel().catch(() => {});
        if ([401, 403].includes(status)) return probeFailure(502, modelResponseError(status).message);
        if (status === 404) return probeFailure(502, "找不到模型或聊天接口，请核对模型 ID 和 Base URL。");
        if ([408, 504].includes(status)) return probeTimeout();
        if ([405, 415, 501].includes(status)) return probeIncompatible();
        if (status === 429) return probeFailure(502, "模型服务请求受限，请检查额度或稍后重试。");
        return probeFailure(502, "模型服务暂不可用，请稍后重试。");
      }
      const decision = await readDecision(response, signal, config.key);
      if (decision.choice !== "0" || !decision.reason.trim()) return probeIncompatible();
      return { status: 200, body: { ok: true } };
    } catch (error) {
      if (signal.aborted || error?.name === "TimeoutError") return probeTimeout();
      if (error?.code === "INVALID_MODEL_OUTPUT") return probeIncompatible();
      return probeFailure(502, "无法连接模型服务，请检查 Base URL 和网络。");
    }
  }

  function client() {
    const config = saved;
    if (!config) return null;
    return {
      async decide(messages, signal) {
        const body = { model: config.model, messages, stream: false, max_tokens: 160, response_format: { type: "json_object" } };
        let response = await complete(config, body, signal);
        if ([400, 415, 422, 501].includes(response.status)) {
          await response.body?.cancel().catch(() => {});
          const { response_format, max_tokens, ...compatible } = body;
          response = await complete(config, compatible, signal);
        }
        if (!response.ok) throw modelResponseError(response.status);
        return readDecision(response, signal, config.key);
      },
    };
  }

  return { status, save, probe, client, list: (input) => listModels(prepare(input)) };
}
