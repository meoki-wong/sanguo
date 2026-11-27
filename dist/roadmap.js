// v22.0 — 「霸业路线图」四阶段国策引导与阶梯赏赐
// 状态挂在 state.saga.roadmapClaimed 下，兼容旧存档与非 century 模式。

import { listCorps } from "./corps.js";
import { getCeremonyState } from "./dynasty-ceremony.js";
import { factionOwnedWonders, getBuildingsState } from "./buildings.js";
import { getTechState } from "./tech.js";

export const ROADMAP_STAGES = [
  {
    id: "stage_1_foothold",
    stage: 1,
    title: "第一阶段 · 立足州郡",
    goalText: "修筑 1 处城池设施、研习 1 项兵技，或国库储粮达到 180",
    rewardText: "赏赐：金 +70 · 粮 +70 · 兵技 +50 TP",
    reward: { treasury: 70, grain: 70, tp: 50, reputation: 3 },
    check: (state) => {
      const player = state.player;
      const bCities = getBuildingsState(state).cities;
      const builtCount = Object.entries(bCities).filter(([ck, v]) => state.cities?.[ck]?.owner === player && (v?.slots?.length ?? 0) > 0).length;
      const techCount = getTechState(state).unlocked.length;
      const grain = state.factions?.[player]?.grain ?? 0;
      return builtCount >= 1 || techCount >= 1 || grain >= 180;
    },
  },
  {
    id: "stage_2_hegemon",
    stage: 2,
    title: "第二阶段 · 称霸一方",
    goalText: "辖城达到 10 城、合编 1 支大军团，或完成「封王建都」",
    rewardText: "赏赐：金 +110 · 粮 +110 · 兵技 +80 TP · 声望 +6",
    reward: { treasury: 110, grain: 110, tp: 80, reputation: 6 },
    check: (state) => {
      const owned = Object.values(state.cities || {}).filter((c) => c.owner === state.player).length;
      return owned >= 10 || listCorps(state).length >= 1 || getCeremonyState(state).tier >= 1;
    },
  },
  {
    id: "stage_3_central",
    stage: 3,
    title: "第三阶段 · 问鼎中原",
    goalText: "辖城达到 18 城、建成 1 座地域奇观，或完成「加九锡」",
    rewardText: "赏赐：金 +160 · 粮 +160 · 兵技 +120 TP · 声望 +8",
    reward: { treasury: 160, grain: 160, tp: 120, reputation: 8 },
    check: (state) => {
      const owned = Object.values(state.cities || {}).filter((c) => c.owner === state.player).length;
      return owned >= 18 || factionOwnedWonders(state, state.player).length >= 1 || getCeremonyState(state).tier >= 2;
    },
  },
  {
    id: "stage_4_unify",
    stage: 4,
    title: "第四阶段 · 千秋一统",
    goalText: "辖城达到 28 城，或完成「受禅登基 · 开国大典」",
    rewardText: "赏赐：金 +240 · 粮 +240 · 全军士气 100 · 声望 +10",
    reward: { treasury: 240, grain: 240, tp: 150, reputation: 10, fullMorale: true },
    check: (state) => {
      const owned = Object.values(state.cities || {}).filter((c) => c.owner === state.player).length;
      return owned >= 28 || getCeremonyState(state).tier >= 3;
    },
  },
];

export function evaluateRoadmap(state) {
  const claimed = new Set(Array.isArray(state?.saga?.roadmapClaimed) ? state.saga.roadmapClaimed : []);
  return ROADMAP_STAGES.map((s) => {
    const isClaimed = claimed.has(s.id);
    const completed = isClaimed || Boolean(state?.century && s.check(state));
    return {
      ...s,
      completed,
      claimed: isClaimed,
      claimable: completed && !isClaimed,
    };
  });
}

export function claimRoadmapReward(state, stageId) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可领取霸业路线图赏赐。" };
  const list = evaluateRoadmap(state);
  const item = list.find((x) => x.id === stageId);
  if (!item) return { ok: false, reason: "未知的霸业阶段。" };
  if (item.claimed) return { ok: false, reason: `「${item.title}」赏赐已领取。` };
  if (!item.completed) return { ok: false, reason: `尚未达成「${item.title}」目标：${item.goalText}` };

  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  if (!Array.isArray(next.saga.roadmapClaimed)) next.saga.roadmapClaimed = [];
  next.saga.roadmapClaimed.push(stageId);

  const fac = next.factions?.[next.player];
  const r = item.reward;
  if (fac) {
    if (r.treasury) fac.treasury += r.treasury;
    if (r.grain) fac.grain += r.grain;
    if (r.fullMorale) fac.morale = 100;
  }
  if (r.tp && next.saga.tech) next.saga.tech.points = (next.saga.tech.points ?? 0) + r.tp;
  if (r.reputation) next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + r.reputation);

  return {
    ok: true,
    state: next,
    summary: `【霸业达成 · ${item.title}】已领取国运赏赐（${item.rewardText}）！`,
  };
}
