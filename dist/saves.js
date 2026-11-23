import { decodeSave, firstCity } from "./engine.js";

const format = "jinglue-sanguo-save";
export const saveFileLimit = 370_000;
const gameFields = ["version", "year", "player", "turn", "factions", "cities", "order", "orders", "strategies",
  "stations", "treaties", "treatyOffers", "incomingTreaty", "stageCompletedAt", "delegationPriority", "delegationReserve", "history", "personnelHistory",
  "campaignMilestones", "campaignEvents", "officerService", "nationalPolicy", "policyOverrides", "armies", "theaters", "warBudget", "recruitedOfficers",
  "scenarioEnding", "campaignRecord", "realm", "war", "polity", "grand"];

function gameData(state) {
  return Object.fromEntries(gameFields.filter((key) => Object.hasOwn(state, key)).map((key) => [key, state[key]]));
}

export function readGameRecord(world, text) {
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("备份需要是有效的 JSON 文件。");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("无法识别这个存档。");
  if (data.format !== undefined && (data.format !== format || data.version !== 1)) throw new Error("此备份的格式或版本不可用。");
  const record = data.format === format ? data.game : data;
  const source = record?.state ?? (record?.cities ? record : null);
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("备份缺少游戏战局。");
  const state = decodeSave(world, JSON.stringify(gameData(source)));
  const selected = Object.hasOwn(state.cities, record.selected) ? record.selected : firstCity(world, state);
  return { state, selected };
}

export function createSaveBackup(record) {
  const text = JSON.stringify({ format, version: 1, game: { state: gameData(record.state), selected: record.selected } });
  if (new TextEncoder().encode(text).length > saveFileLimit) throw new Error("当前战局超过备份文件大小限制。");
  return text;
}
