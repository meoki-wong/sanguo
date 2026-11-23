export const turnStreamType = "application/x-ndjson";

export async function readTurnResponse(response, onProgress) {
  const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== turnStreamType) return response.json();

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("拟令连接在收到结算前中断。");
      pending += value;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        if (record.type === "progress") onProgress(record);
        else if (record.type === "result") return { state: record.state };
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
