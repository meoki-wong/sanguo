// v20.0 — 《天下群雄谱》全名将图鉴 & 跨局战绩名人堂
// 零外部依赖，跨存档使用 localStorage 持久化名将战绩。

import { officerMeta } from "./traits.js";

const HOF_STORAGE_KEY = "jinglue_sanguo_v20_hall_of_fame";

export function loadHallOfFame() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(HOF_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function syncHallOfFameFromState(era, state) {
  const hof = loadHallOfFame();
  const merits = state?.saga?.merits || {};
  const all = [...(era?.officers || []), ...(state?.recruitedOfficers || [])];
  for (const [key, m] of Object.entries(merits)) {
    const person = all.find((o) => o.key === key);
    if (!person) continue;
    const prev = hof[key] || { name: person.name, bestWins: 0, bestDuels: 0, bestXp: 0, runs: 0 };
    hof[key] = {
      name: person.name,
      bestWins: Math.max(prev.bestWins ?? 0, m.wins ?? 0),
      bestDuels: Math.max(prev.bestDuels ?? 0, m.duels ?? 0),
      bestXp: Math.max(prev.bestXp ?? 0, m.xp ?? 0),
      runs: Math.max(1, prev.runs ?? 1),
    };
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(HOF_STORAGE_KEY, JSON.stringify(hof));
  } catch {}
  return hof;
}

/**
 * 检索全图名将图鉴
 */
export function queryHeroCodex(world, era, state, { faction = "all", search = "", sortBy = "total" } = {}) {
  const hof = syncHallOfFameFromState(era, state);
  const all = [...(era?.officers || []), ...(state?.recruitedOfficers || [])];
  const seen = new Set();
  const unique = [];
  for (const o of all) {
    if (seen.has(o.key)) continue;
    seen.add(o.key);
    unique.push(o);
  }

  const cityNameOf = (k) => world?.cities?.find((c) => c.key === k)?.name || "";
  const factionNameOf = (fid) => {
    if (Array.isArray(era?.factions)) return era.factions.find((f) => f.key === fid)?.name || fid;
    return era?.factions?.[fid]?.name || fid;
  };
  const q = String(search || "").trim().toLowerCase();

  const list = unique.map((o) => {
    const meta = officerMeta(o);
    const command = o.command ?? 70;
    const governance = o.governance ?? o.politics ?? 68;
    const intel = o.intel ?? meta.intellect ?? 70;
    const war = o.war ?? Math.round((command + 75) / 2);
    const total = command + governance + intel + war;
    const station = state?.stations?.[o.key] || "";
    const curMerit = state?.saga?.merits?.[o.key] || { wins: 0, duels: 0, xp: 0 };
    const record = hof[o.key] || { bestWins: curMerit.wins ?? 0, bestDuels: curMerit.duels ?? 0, bestXp: curMerit.xp ?? 0 };
    const traits = Array.isArray(meta.traits) ? meta.traits.map((t) => t.name || t) : [];
    return {
      key: o.key,
      name: o.name,
      faction: o.faction,
      factionName: factionNameOf(o.faction),
      command,
      war,
      intel,
      governance,
      total,
      traits,
      stationKey: station,
      stationName: station ? cityNameOf(station) : "在野 / 待命",
      bestWins: record.bestWins ?? 0,
      bestDuels: record.bestDuels ?? 0,
      bestXp: record.bestXp ?? 0,
    };
  }).filter((row) => {
    if (faction && faction !== "all" && row.faction !== faction) return false;
    if (q && !row.name.toLowerCase().includes(q) && !row.factionName.toLowerCase().includes(q) && !row.traits.some((t) => String(t).toLowerCase().includes(q))) {
      return false;
    }
    return true;
  });

  const keyMap = { total: "total", command: "command", war: "war", intel: "intel", governance: "governance", xp: "bestXp" };
  const sortField = keyMap[sortBy] || "total";
  list.sort((a, b) => (b[sortField] - a[sortField]) || (b.total - a.total));
  return list;
}
