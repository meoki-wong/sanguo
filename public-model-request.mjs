import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const reserved = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
]) reserved.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
  reserved.addSubnet(address, prefix, "ipv6");
}
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function cloudModelUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("请填写有效的 Base URL。"); }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash
    || isIP(hostname) || !hostname.includes(".") || /\.(?:localhost|local|internal|home\.arpa)$/i.test(hostname)) {
    throw new Error("网页版模型服务需使用公开域名和标准 HTTPS 端口。");
  }
  return url;
}

async function publicAddresses(url, signal) {
  const rows = await lookup(url.hostname, { all: true });
  signal?.throwIfAborted();
  if (!rows.length || rows.some(({ address, family }) => family === 4 ? reserved.check(address, "ipv4")
    : family !== 6 || !globalV6.check(address, "ipv6") || reserved.check(address, "ipv6"))) {
    throw new Error("模型域名必须解析到公网。");
  }
  return rows;
}

export async function verifyCloudModelAddress(value) {
  const url = cloudModelUrl(value);
  await publicAddresses(url, AbortSignal.timeout(6000));
}

export async function requestPublicModel(value, { method = "GET", headers, body, signal } = {}) {
  const url = cloudModelUrl(value);
  const addresses = await publicAddresses(url, signal);
  return new Promise((resolve, reject) => {
    // Use the vetted DNS answer for the connection and keep the original hostname for TLS.
    const outgoing = httpsRequest(url, { method, headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) },
      signal, agent: false,
      lookup(_hostname, options, callback) {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    }, (incoming) => {
      const status = incoming.statusCode;
      if (status >= 300 && status < 400) {
        incoming.destroy();
        reject(new Error("模型服务返回了重定向。"));
        return;
      }
      const chunks = [];
      let size = 0;
      incoming.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) incoming.destroy(new Error("模型回复过大。"));
        else chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => {
        resolve(new Response([204, 205].includes(status) ? null : Buffer.concat(chunks), { status }));
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}
