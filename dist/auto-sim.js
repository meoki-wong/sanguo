// v21.0 — 智能多季推演 & 遇急自停引擎
// 自动连续推进 4/8/12 季，并在遭遇城池失陷、粮草告急、历史奇局、晋爵登基或残局结案时立刻自动暂停。

import { gameOutcome } from "./engine.js";
import { nextAvailableTier } from "./dynasty-ceremony.js";
import { evaluateChallengeProgress } from "./challenges.js";

export const AUTO_SIM_PRESETS = [
  { seasons: 4, label: "推演 1 年（4季）" },
  { seasons: 8, label: "推演 2 年（8季）" },
  { seasons: 12, label: "推演 3 年（12季）" },
];

/**
 * 判定智能推演是否应立即自动暂停，并返回清晰禀报原因
 */
export function shouldPauseAutoSim(world, state, prevState = null) {
  if (!state) return { pause: true, reason: "战局未就绪" };
  const outcome = gameOutcome(state);
  if (outcome !== "ongoing") {
    return { pause: true, reason: outcome === "victory" ? "大业已成，天下一统！" : "战局已分胜负，自动停止推演。" };
  }

  const player = state.player;
  const fac = state.factions?.[player];
  if (fac && (fac.grain < 55 || fac.treasury < 30)) {
    return { pause: true, reason: `军资告急（国库 ${fac.treasury} / 储粮 ${fac.grain}），已自动暂停请主公筹措！` };
  }

  if (prevState) {
    const prevOwned = Object.values(prevState.cities || {}).filter((c) => c.owner === player).length;
    const curOwned = Object.values(state.cities || {}).filter((c) => c.owner === player).length;
    if (curOwned < prevOwned) {
      return { pause: true, reason: `急报！我军失陷城池（${prevOwned} → ${curOwned} 城），已自动暂停请主公御敌！` };
    }
  }

  if (state.saga?.pendingEvent) {
    return { pause: true, reason: `触发史诗奇局「${state.saga.pendingEvent.title || "历史事件"}」，请主公亲裁！` };
  }
  if (state.saga?.climate?.pending) {
    return { pause: true, reason: `天时灾异「${state.saga.climate.name || "灾异"}」降临，请主公处置！` };
  }

  const tier = nextAvailableTier(state);
  if (tier?.eligible) {
    return { pause: true, reason: `大喜！已满足「${tier.title}」晋爵条件，可赴朝堂举行大典！` };
  }

  const ch = evaluateChallengeProgress(state);
  if (ch && ch.status !== "active") {
    return { pause: true, reason: ch.headline };
  }

  return { pause: false, reason: "" };
}
