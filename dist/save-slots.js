// v22.0 — 5 槽位可视化存档管理器 & 全军 MVP 战损总账
// 零外部依赖，使用 localStorage 持久化 5 个独立命名槽位。

import { createSaveBackup, readGameRecord } from "./saves.js";
import { getCeremonyState } from "./dynasty-ceremony.js";
import { listCorps } from "./corps.js";
import { factionOwnedWonders, getBuildingsState } from "./buildings.js";

const SLOTS_KEY = "jinglue_sanguo_v22_save_slots";
export const MAX_SAVE_SLOTS = 5;

function readRawSlots() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(SLOTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeRawSlots(map) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SLOTS_KEY, JSON.stringify(map));
  } catch {}
}

export function listSaveSlots() {
  const map = readRawSlots();
  const rows = [];
  for (let i = 1; i <= MAX_SAVE_SLOTS; i++) {
    const id = `slot_${i}`;
    const entry = map[id] || null;
    rows.push({
      id,
      index: i,
      empty: !entry,
      label: entry?.label || `存档槽 ${i}（空）`,
      title: entry?.title || "",
      year: entry?.year ?? null,
      turn: entry?.turn ?? null,
      cities: entry?.cities ?? 0,
      troops: entry?.troops ?? 0,
      savedAt: entry?.savedAt || "",
    });
  }
  return rows;
}

export function saveToSlot(slotId, { label = "", world, era, state, selected }) {
  const backup = createSaveBackup({ state, selected });
  const player = state.player;
  const owned = Object.values(state.cities || {}).filter((c) => c.owner === player);
  const troops = owned.reduce((s, c) => s + (c.troops ?? 0), 0);
  const cer = getCeremonyState(state);
  const fname = (Array.isArray(era?.factions) ? era.factions.find((f) => f.key === player)?.name : era?.factions?.[player]?.name) || player;
  const title = cer.dynastyName || state.saga?.custom?.stateName || fname;
  const curYear = (state.year ?? 208) + Math.floor(((state.turn ?? 1) - 1) / 4);
  const now = new Date();
  const savedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const map = readRawSlots();
  map[slotId] = {
    label: String(label || `${title} · ${curYear}年`).trim().slice(0, 20),
    title,
    year: curYear,
    turn: state.turn ?? 0,
    cities: owned.length,
    troops,
    savedAt,
    backup,
  };
  writeRawSlots(map);
  return { ok: true, summary: `已保存至 ${map[slotId].label}（${owned.length}城 / ${troops.toLocaleString()}兵）。` };
}

export function loadFromSlot(world, slotId) {
  const map = readRawSlots();
  const entry = map[slotId];
  if (!entry?.backup) return { ok: false, reason: "该存档槽为空。" };
  const record = readGameRecord(world, entry.backup);
  return { ok: true, state: record.state, selected: record.selected, label: entry.label };
}

export function deleteSaveSlot(slotId) {
  const map = readRawSlots();
  delete map[slotId];
  writeRawSlots(map);
  return { ok: true };
}

/**
 * 计算本局全军 MVP 名将与经济/军力总账
 */
export function computeCampaignLedger(era, state) {
  const player = state.player;
  const owned = Object.entries(state.cities || {}).filter(([, c]) => c.owner === player);
  const totalTroops = owned.reduce((s, [, c]) => s + (c.troops ?? 0), 0);
  const richest = [...owned].sort((a, b) => (b[1].commerce + b[1].farming) - (a[1].commerce + a[1].farming))[0];

  const allOfficers = [...(era?.officers || []), ...(state.recruitedOfficers || [])].filter((o) => o.faction === player);
  const merits = state.saga?.merits || {};
  let mvp = null;
  for (const o of allOfficers) {
    const m = merits[o.key] || { wins: 0, duels: 0, xp: 0 };
    const score = (m.xp ?? 0) * 2 + (m.wins ?? 0) * 35 + (m.duels ?? 0) * 40 + (o.command ?? 70);
    if (!mvp || score > mvp.score) {
      mvp = { key: o.key, name: o.name, wins: m.wins ?? 0, duels: m.duels ?? 0, xp: m.xp ?? 0, score };
    }
  }

  const bCities = getBuildingsState(state).cities;
  const totalBuildings = owned.reduce((sum, [ck]) => sum + (bCities[ck]?.slots?.length ?? 0), 0);

  return {
    ownedCount: owned.length,
    totalTroops,
    richestCityKey: richest?.[0] || "",
    totalBuildings,
    wondersCount: factionOwnedWonders(state, player).length,
    corpsCount: listCorps(state).length,
    duelWins: state.saga?.duelWins ?? 0,
    mvp: mvp || { name: "暂无", wins: 0, duels: 0, xp: 0 },
  };
}
