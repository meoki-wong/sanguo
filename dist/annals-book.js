// v24.0 — 纪传体《本朝实录》自动撰史 & 跨存档「历代战局档案室」
// 零外部依赖，跨存档使用 localStorage 持久化最多 12 卷历代史书。

import { evaluateCampaignGrade } from "./achievements.js";
import { getCeremonyState } from "./dynasty-ceremony.js";
import { computeCampaignLedger } from "./save-slots.js";
import { listMegaprojectsStatus } from "./megaprojects.js";
import { activeSpecialtiesFor } from "./specialties.js";

const ARCHIVE_KEY = "jinglue_sanguo_v24_dynasty_archives";
const MAX_ARCHIVES = 12;

/**
 * 自动撰写纪传体《本朝实录》（含《本纪》《名将列传》《疆域与工程志》三篇）
 */
export function composeDynastyHistory(world, era, state) {
  const player = state.player;
  const cer = getCeremonyState(state);
  const grade = evaluateCampaignGrade(world, state);
  const ledger = computeCampaignLedger(era, state);
  const fname = (Array.isArray(era?.factions) ? era.factions.find((f) => f.key === player)?.name : era?.factions?.[player]?.name) || player;
  const dynasty = cer.dynastyName || state.saga?.custom?.stateName || fname;
  const curYear = (state.year ?? 208) + Math.floor(((state.turn ?? 1) - 1) / 4);
  const eraTitle = cer.eraName ? `${cer.eraName}年间` : `公元${curYear}年`;

  const awakened = Array.isArray(state.saga?.awakenedHeroes) ? state.saga.awakenedHeroes : [];
  const completedProjects = listMegaprojectsStatus(state).filter((p) => p.completed).map((p) => p.name);
  const specs = activeSpecialtiesFor(state, player).map((s) => s.name);
  const annals = (state.saga?.annals || []).slice(-5);

  const benji = [
    `《${dynasty}本纪》：${era?.year || state.year}年起兵于乱世，历 ${state.turn ?? 0} 季至${eraTitle}，今拥九州 ${ledger.ownedCount} 城、甲士 ${ledger.totalTroops.toLocaleString()} 人。`,
    cer.edict || `主公雄才大略，海内声望达 ${state.saga?.reputation ?? 50}，史官综合评定为「${grade.grade} 级 · ${grade.verdict}」（${grade.score} 分）。`,
    ...annals.map((a) => `• ${a.year}年【${a.title}】${a.text}`),
  ].join("\n");

  const liezhuan = [
    `《名将列传》：本朝全军首功 MVP 为「${ledger.mvp.name}」（军功 ${ledger.mvp.xp}），全军累计阵前单挑 ${ledger.duelWins} 胜。`,
    awakened.length
      ? `史诗觉醒名将录：${awakened.join("、")}，皆以绝世功业名垂青史。`
      : "麾下文武群英荟萃，正待建功立业、触发史诗觉醒。",
  ].join("\n");

  const dilizhi = [
    `《疆域与工程志》：累计兴修城池设施 ${ledger.totalBuildings} 处、地域奇观 ${ledger.wondersCount} 座、大军团 ${ledger.corpsCount} 支。`,
    completedProjects.length ? `千秋超级工程竣工：${completedProjects.join("、")}。` : "尚无跨州超级工程竣工。",
    specs.length ? `掌控九州名城特产：${specs.join("、")}。` : "尚未掌控九州名城特产。",
  ].join("\n");

  const fullText = `【${dynasty}实录 · ${eraTitle}】\n\n${benji}\n\n${liezhuan}\n\n${dilizhi}`;
  return {
    id: `hist_${Date.now().toString(36)}`,
    title: `《${dynasty}实录 · ${eraTitle}》`,
    grade: grade.grade,
    score: grade.score,
    cities: ledger.ownedCount,
    year: curYear,
    benji,
    liezhuan,
    dilizhi,
    fullText,
  };
}

export function listArchivedHistories() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(ARCHIVE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function archiveCurrentHistory(world, era, state) {
  const book = composeDynastyHistory(world, era, state);
  const list = listArchivedHistories();
  list.unshift({
    id: book.id,
    title: book.title,
    grade: book.grade,
    score: book.score,
    cities: book.cities,
    year: book.year,
    fullText: book.fullText,
    archivedAt: new Date().toISOString().slice(0, 10),
  });
  const trimmed = list.slice(0, MAX_ARCHIVES);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(ARCHIVE_KEY, JSON.stringify(trimmed));
  } catch {}
  return { ok: true, book, count: trimmed.length };
}
