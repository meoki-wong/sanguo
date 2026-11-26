// v20.0 — 称王建制 · 九锡禅让与开国大典
// 状态挂在 state.saga.ceremony 下，兼容旧存档与非 century 模式。

export const CEREMONY_TIERS = [
  {
    tier: 1,
    id: "king",
    title: "封王建都",
    minCities: 8,
    minReputation: 60,
    costTreasury: 80,
    summary: "裂土封王、开府仪同三司：全势力钱粮 +8%、攻势 +5%、声望 +6。",
    ecoBonus: 0.08,
    atkBonus: 0.05,
    defBonus: 0.03,
  },
  {
    tier: 2,
    id: "nine_bestowments",
    title: "加九锡 · 进爵国公",
    minCities: 15,
    minReputation: 72,
    costTreasury: 120,
    summary: "剑履上殿、赞拜不名：全势力钱粮 +14%、攻防 +8%、每季额外 +15 TP。",
    ecoBonus: 0.14,
    atkBonus: 0.08,
    defBonus: 0.08,
  },
  {
    tier: 3,
    id: "emperor",
    title: "受禅登基 · 开国大典",
    minCities: 22,
    minReputation: 82,
    costTreasury: 180,
    summary: "定鼎国号与年号、敕封三公大将军：全势力钱粮 +20%、攻防 +12%、士气恒盛！",
    ecoBonus: 0.2,
    atkBonus: 0.12,
    defBonus: 0.12,
  },
];

export const GRAND_OFFICES = [
  { id: "chancellor", title: "丞相（总揽百官）", stat: "governance", summary: "全势力钱粮产出额外 +6%" },
  { id: "grand_marshal", title: "大司马（节制中外诸军）", stat: "command", summary: "全军攻战额外 +6%" },
  { id: "grand_general", title: "大将军（统率虎贲精锐）", stat: "war", summary: "全军守御与突击额外 +5%" },
];

export function getCeremonyState(state) {
  const c = state?.saga?.ceremony;
  return {
    tier: c?.tier ?? 0,
    dynastyName: c?.dynastyName || "",
    eraName: c?.eraName || "",
    capitalKey: c?.capitalKey || "",
    offices: c?.offices && typeof c.offices === "object" ? c.offices : {},
    edict: c?.edict || "",
  };
}

function ensureCeremony(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.ceremony || typeof state.saga.ceremony !== "object") {
    state.saga.ceremony = { tier: 0, dynastyName: "", eraName: "", capitalKey: "", offices: {}, edict: "" };
  }
  if (!state.saga.ceremony.offices) state.saga.ceremony.offices = {};
  return state.saga.ceremony;
}

export function nextAvailableTier(state) {
  if (!state?.century) return null;
  const cur = getCeremonyState(state);
  const nextTier = CEREMONY_TIERS.find((t) => t.tier === cur.tier + 1);
  if (!nextTier) return null;
  const ownedCities = Object.values(state.cities || {}).filter((c) => c.owner === state.player).length;
  const rep = state.saga?.reputation ?? 50;
  const fac = state.factions?.[state.player] || { treasury: 0 };
  const eligible = (ownedCities >= nextTier.minCities || rep >= nextTier.minReputation) && fac.treasury >= nextTier.costTreasury;
  return { ...nextTier, ownedCities, rep, eligible };
}

/**
 * 举行晋爵 / 登基大典
 */
export function performCoronation(world, state, { dynastyName = "", eraName = "", capitalKey = "" } = {}) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可举行称王登基大典。" };
  const check = nextAvailableTier(state);
  if (!check) return { ok: false, reason: "已登九五之尊，威加海内。" };
  if (!check.eligible) {
    return {
      ok: false,
      reason: `晋升「${check.title}」需辖城 ≥ ${check.minCities}（当前 ${check.ownedCities}）或声望 ≥ ${check.minReputation}（当前 ${check.rep}），且国库金 ≥ ${check.costTreasury}。`,
    };
  }

  const next = structuredClone(state);
  const player = next.player;
  next.factions[player].treasury -= check.costTreasury;
  next.factions[player].morale = Math.min(100, (next.factions[player].morale ?? 75) + 10);
  const cer = ensureCeremony(next);
  cer.tier = check.tier;

  const defaultDynasty = player === "cao" || player === "wei" ? "大魏" : player === "liu" || player === "shu" ? "季汉" : player === "wu" ? "大吴" : "大汉";
  const defaultEra = check.tier === 3 ? "太和" : check.tier === 2 ? "建安" : "兴平";
  cer.dynastyName = String(dynastyName || cer.dynastyName || defaultDynasty).trim().slice(0, 8) || defaultDynasty;
  cer.eraName = String(eraName || cer.eraName || defaultEra).trim().slice(0, 6) || defaultEra;
  if (capitalKey && next.cities?.[capitalKey]?.owner === player) {
    cer.capitalKey = capitalKey;
  } else if (!cer.capitalKey) {
    cer.capitalKey = Object.keys(next.cities || {}).find((k) => next.cities[k].owner === player) || "";
  }

  const capName = world?.cities?.find((c) => c.key === cer.capitalKey)?.name || cer.capitalKey;
  cer.edict = `诏曰：顺天应人，定鼎${capName}，建国号「${cer.dynastyName}」，改元「${cer.eraName}」，大赦天下！`;
  if (next.saga) {
    next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 8);
    if (Array.isArray(next.saga.annals)) {
      next.saga.annals.push({
        turn: next.turn ?? 1,
        year: (next.year ?? 208) + Math.floor(((next.turn ?? 1) - 1) / 4),
        title: check.title,
        text: cer.edict,
        kind: "imperial",
      });
    }
  }

  return {
    ok: true,
    state: next,
    tier: check.tier,
    summary: `【${check.title}】${cer.edict}（${check.summary}）`,
  };
}

/**
 * 敕封三公/大将军席位（封王及以上即可封赏）
 */
export function appointGrandOffice(era, state, officeId, officerKey) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可敕封三公大将军。" };
  const cer = getCeremonyState(state);
  if (cer.tier < 1) return { ok: false, reason: "需先完成「封王建都」方可开府敕封三公大将军。" };
  const officeDef = GRAND_OFFICES.find((o) => o.id === officeId);
  if (!officeDef) return { ok: false, reason: "未知的官职席位。" };
  const all = [...(era?.officers || []), ...(state.recruitedOfficers || [])];
  const officer = all.find((o) => o.key === officerKey && o.faction === state.player);
  if (!officer) return { ok: false, reason: "请从己方现役名将中拣选受封者。" };

  const next = structuredClone(state);
  const c = ensureCeremony(next);
  c.offices[officeId] = { key: officer.key, name: officer.name };
  return {
    ok: true,
    state: next,
    summary: `【开国封赏】敕封${officer.name}为「${officeDef.title}」：${officeDef.summary}！`,
  };
}

export function ceremonyEconomyModifiers(state, factionId) {
  if (!state?.century || factionId !== state.player) return { mult: 1 };
  const c = getCeremonyState(state);
  const tierDef = CEREMONY_TIERS.find((t) => t.tier === c.tier);
  let mult = 1 + (tierDef?.ecoBonus ?? 0);
  if (c.offices?.chancellor?.key) mult += 0.06;
  return { mult: Number(mult.toFixed(3)) };
}

export function ceremonyCombatModifiers(state, factionId) {
  if (!state?.century || factionId !== state.player) return { attackMult: 1, defenseMult: 1 };
  const c = getCeremonyState(state);
  const tierDef = CEREMONY_TIERS.find((t) => t.tier === c.tier);
  let attackMult = 1 + (tierDef?.atkBonus ?? 0);
  let defenseMult = 1 + (tierDef?.defBonus ?? 0);
  if (c.offices?.grand_marshal?.key) attackMult += 0.06;
  if (c.offices?.grand_general?.key) {
    attackMult += 0.05;
    defenseMult += 0.05;
  }
  return {
    attackMult: Number(attackMult.toFixed(3)),
    defenseMult: Number(defenseMult.toFixed(3)),
  };
}
