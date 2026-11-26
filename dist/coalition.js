import { cityName, eraByYear, factionName, forceTotals, gameOutcome } from "./engine.js";
import { treatyWith } from "./diplomacy.js";
import { edgeKey } from "./landscape-terrain.js";
import { livingSide } from "./polities-data.js";
import { retreatCity } from "./polity-handover.js";
import { ensureSaga, MAX_EXECUTED, recordAnnal } from "./saga.js";
import { strategicPost } from "./sandtable-posts.js";
import { hasTrait } from "./traits.js";
import { hasTech } from "./tech.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/* ==================== 1. Anti-Hegemon Coalition (反霸联合军) ==================== */

export function isCoalitionActive(state) {
  const co = state?.saga?.coalition;
  return Boolean(state?.century && co && co.ends > state.turn && (co.members?.length ?? 0) >= 2);
}

export function isCoalitionMember(state, faction) {
  if (!isCoalitionActive(state)) return false;
  return state.saga.coalition.members.includes(faction);
}

export function coalitionProtects(state, first, second) {
  if (!isCoalitionActive(state) || first === second) return false;
  const members = state.saga.coalition.members;
  return members.includes(first) && members.includes(second);
}

export function evaluateCoalition(world, era, state) {
  if (!state?.century || gameOutcome(state) !== "ongoing") return null;
  const saga = ensureSaga(state);
  const existing = saga.coalition;

  // Prune dead members or expired coalition
  if (existing) {
    existing.members = (existing.members ?? []).filter((f) => f !== state.player && livingSide(state, f));
    if (existing.ends <= state.turn || existing.members.length < 2) {
      saga.coalition = null;
      recordAnnal(state, "合纵", "反霸联合军期满解体，天下重归群雄各自为战。");
      return null;
    }
    if (!existing.members.includes(existing.leader)) {
      existing.leader = existing.members[0];
    }
    return existing;
  }

  const threshold = saga.rules?.fierceCoalition ? 14 : 18;
  const cooldownUntil = saga.coalitionCooldownUntil ?? 0;
  if (state.turn < 6 || state.turn < cooldownUntil) return null;
  const playerCities = forceTotals(state, state.player).cities;
  if (playerCities < threshold || playerCities >= world.cities.length - 3) return null;

  const candidates = era.factions
    .filter((f) => f.key !== state.player && livingSide(state, f.key))
    .map((f) => ({ key: f.key, name: f.name, ...forceTotals(state, f.key) }))
    .filter((f) => f.cities >= 1)
    .sort((a, b) => b.troops - a.troops)
    .slice(0, 4);

  if (candidates.length < 2) return null;
  const leader = candidates[0].key;
  const members = candidates.map((c) => c.key);
  saga.coalition = {
    leader,
    members,
    since: state.turn,
    ends: state.turn + 8,
  };
  saga.coalitionCooldownUntil = state.turn + 14;
  const names = candidates.map((c) => c.name).join("、");
  recordAnnal(state, "讨伐盟", `${candidates[0].name}登高一呼，联合${names}结成「反霸联合军」（持续 8 季），共抗${factionName(era, state.player)}！`);
  return saga.coalition;
}

export function leaveCoalition(world, era, state, faction, reason = "退盟") {
  if (!isCoalitionActive(state)) return false;
  const co = state.saga.coalition;
  if (!co.members.includes(faction)) return false;
  const wasLeader = co.leader === faction;
  co.members = co.members.filter((m) => m !== faction);
  if (wasLeader || co.members.length < 2) {
    state.saga.coalition = null;
    state.saga.coalitionBrokenCount = (state.saga.coalitionBrokenCount ?? 0) + 1;
    state.saga.reputation = clamp((state.saga.reputation ?? 50) + 8, 0, 100);
    recordAnnal(state, "破合纵", `${factionName(era, faction)}${reason}，反霸联合军土崩瓦解！我方声望 +8。`);
    return true;
  }
  recordAnnal(state, "瓦解", `${factionName(era, faction)}${reason}退出反霸联合军。`);
  return true;
}

/* ==================== 2. Allied Pincer Strike (邀盟夹击) ==================== */

export const ALLY_STRIKE_COST = 18;

export function evaluateAllyStrike(world, state, allyFaction, targetCity) {
  if (!state?.century || gameOutcome(state) !== "ongoing") {
    return { ok: false, reason: "仅限山河大势进行中使用。" };
  }
  const treaty = treatyWith(state, state.player, allyFaction);
  if (!treaty || treaty.kind !== "alliance") {
    return { ok: false, reason: "仅可向已缔结「同盟」的势力发起夹击协约。" };
  }
  const holding = state.cities[targetCity];
  if (!holding || holding.owner === state.player || holding.owner === allyFaction) {
    return { ok: false, reason: "目标须为第三方敌城。" };
  }
  const targetNode = world.cities.find((c) => c.key === targetCity);
  const allyAdjacent = targetNode?.links.some((k) => state.cities[k]?.owner === allyFaction);
  if (!allyAdjacent) {
    return { ok: false, reason: "盟友暂无与该敌城接壤的出兵基地。" };
  }
  if ((state.factions[state.player]?.treasury ?? 0) < ALLY_STRIKE_COST) {
    return { ok: false, reason: `国库不足（需 ${ALLY_STRIKE_COST} 钱军费协饷）。` };
  }
  if ((state.saga?.allyStrikes ?? []).some((s) => s.ally === allyFaction && s.expires > state.turn)) {
    return { ok: false, reason: "该盟友已有在途夹击军约。" };
  }
  return { ok: true, cost: ALLY_STRIKE_COST };
}

export function executeAllyStrike(world, state, allyFaction, targetCity) {
  const check = evaluateAllyStrike(world, state, allyFaction, targetCity);
  if (!check.ok) throw new Error(check.reason);
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const era = eraByYear(world, next);
  next.factions[next.player].treasury -= check.cost;
  saga.allyStrikes = [
    ...(saga.allyStrikes ?? []).filter((s) => s.expires > next.turn),
    { ally: allyFaction, target: targetCity, expires: next.turn + 2 },
  ].slice(-4);
  const msg = `已致书盟友「${factionName(era, allyFaction)}」协饷 ${check.cost} 钱，约期次季夹击${cityName(world, targetCity)}！`;
  recordAnnal(next, "合兵", msg);
  return { state: next, message: msg };
}

export function listAllyStrikeOptions(world, state) {
  if (!state?.century || gameOutcome(state) !== "ongoing") return [];
  const era = eraByYear(world, state);
  const allies = era.factions.filter((f) => (
    f.key !== state.player && livingSide(state, f.key) && treatyWith(state, state.player, f.key)?.kind === "alliance"
  ));
  const options = [];
  for (const ally of allies) {
    const targets = world.cities.filter((c) => {
      const owner = state.cities[c.key]?.owner;
      return owner && owner !== state.player && owner !== ally.key
        && c.links.some((k) => state.cities[k]?.owner === ally.key);
    });
    for (const target of targets.slice(0, 3)) {
      const check = evaluateAllyStrike(world, state, ally.key, target.key);
      options.push({
        ally: ally.key,
        allyName: ally.name,
        target: target.key,
        targetName: target.name,
        targetOwnerName: factionName(era, state.cities[target.key].owner),
        ...check,
      });
    }
  }
  return options;
}

/* ==================== 3. Captive Peace Deal (以俘议和) ==================== */

export function evaluateCaptivePeace(world, state, officerKey) {
  if (!state?.century || gameOutcome(state) !== "ongoing") {
    return { ok: false, reason: "当前无法以俘议和。" };
  }
  const cap = (state.saga?.captives ?? []).find((c) => c.officer === officerKey);
  if (!cap) return { ok: false, reason: "未在俘虏名录中找到该将。" };
  if (!livingSide(state, cap.from)) return { ok: false, reason: "原势力已灭亡，无法议和。" };
  const existing = treatyWith(state, state.player, cap.from);
  if (existing && existing.expires > state.turn + 1) {
    return { ok: false, reason: "与该势力已有有效盟约。" };
  }
  return { ok: true, captive: cap, indemnity: 28, seasons: 2 };
}

export function executeCaptivePeace(world, state, officerKey) {
  const check = evaluateCaptivePeace(world, state, officerKey);
  if (!check.ok) throw new Error(check.reason);
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const era = eraByYear(world, next);
  const idx = saga.captives.findIndex((c) => c.officer === officerKey);
  const cap = saga.captives[idx];
  const officer = era.officers.find((o) => o.key === officerKey);
  saga.captives.splice(idx, 1);

  const home = retreatCity(world, next, cap.from, cap.city);
  if (home) next.stations[officerKey] = home;
  else {
    saga.executed = [...new Set([...(saga.executed ?? []), officerKey])].slice(-MAX_EXECUTED);
    next.stations[officerKey] = null;
  }

  next.factions[next.player].treasury += check.indemnity;
  next.treaties = [
    ...(next.treaties ?? []).filter((t) => !(t.sides.includes(next.player) && t.sides.includes(cap.from))),
    { sides: [next.player, cap.from].sort(), kind: "truce", expires: next.turn + check.seasons },
  ];
  // Clear queued attacks against cap.from so save previewOrders stays legal
  next.orders = (next.orders ?? []).filter((o) => !(
    (o.type === "attack" || o.type === "mobilize") && next.cities[o.to]?.owner === cap.from
  ));
  saga.rivals = (saga.rivals ?? []).filter((r) => !(
    (r.a === next.player && r.b === cap.from) || (r.b === next.player && r.a === cap.from)
  ));
  leaveCoalition(world, era, next, cap.from, "以俘议和");
  saga.reputation = clamp((saga.reputation ?? 50) + 3, 0, 100);
  const msg = `以俘将「${officer?.name ?? "敌将"}」促成停战！${factionName(era, cap.from)}奉赔 ${check.indemnity} 钱并订立 ${check.seasons} 季休战。`;
  recordAnnal(next, "议和", msg);
  return { state: next, message: msg };
}

/* ==================== 4. Chokepoint Fortresses (雄关水寨防线) ==================== */

const MAJOR_PASSES = new Set([
  "虎牢关", "潼关", "函谷关", "剑门关", "阳平关", "武关", "壶关", "陇山关", "巴东关", "梅关",
]);
const MAJOR_PORTS = new Set([
  "濡须口", "乌林港", "樊城渡", "荆江渡", "寻阳渡", "建业港", "官渡港", "白马港", "三峡渡",
]);

export function chokepointBetween(from, to) {
  if (!from || !to) return null;
  const post = strategicPost(edgeKey(from, to));
  if (!post) return null;
  if (MAJOR_PASSES.has(post.name)) {
    return { ...post, tier: "pass", bonusDefense: 0.16, extraGrain: 6 };
  }
  if (MAJOR_PORTS.has(post.name)) {
    return { ...post, tier: "port", bonusDefense: 0.12, extraGrain: 4 };
  }
  return null;
}

export function chokepointModifiers(state, from, to, tacticId = "assault", attacker = null) {
  if (!state?.century) return { post: null, defenseMult: 1, extraGrain: 0, label: "" };
  const cp = chokepointBetween(from, to);
  if (!cp) return { post: null, defenseMult: 1, extraGrain: 0, label: "" };

  let defBonus = cp.bonusDefense;
  if (cp.tier === "pass") {
    if (tacticId === "siege") defBonus *= 0.45;
    else if (tacticId === "stratagem") defBonus *= 0.65;
    if (hasTech(state, "m2_trebuchet")) defBonus *= 0.75;
  } else if (cp.tier === "port") {
    if (hasTrait(attacker, "navy")) defBonus *= 0.35;
    else if (tacticId === "stratagem") defBonus *= 0.60;
  }
  const extraGrain = hasTech(state, "c2_oxcart") ? Math.max(1, Math.round(cp.extraGrain * 0.6)) : cp.extraGrain;
  return {
    post: cp,
    defenseMult: 1 + defBonus,
    extraGrain,
    label: `${cp.name}天险(+${Math.round(defBonus * 100)}%防·+${extraGrain}粮)`,
  };
}

/* ==================== 5. Seasonal Climate & Harvest (天时灾异与岁稔) ==================== */

const CLIMATE_TYPES = [
  { id: "harvest", name: "丰年大稔", tone: "good", desc: "风调雨顺，五谷丰登，本州粮仓充实、民心大振。" },
  { id: "drought", name: "关内旱蝗", tone: "warn", desc: "久旱生蝗，田禾受损，急需开仓赈济以安民心。" },
  { id: "flood", name: "大水泛滥", tone: "warn", desc: "江河决堤，堤防受损，须拨款抢修或严防外寇趁虚而入。" },
  { id: "plague", name: "时疫流行", tone: "warn", desc: "军民染疾，士气低迷，宜施药赈抚以稳固大局。" },
];

export function settleSeasonalClimate(world, era, state) {
  if (!state?.century || state.turn < 3 || state.turn % 4 !== 3 || gameOutcome(state) !== "ongoing") return null;
  const saga = ensureSaga(state);
  if (saga.climate?.pending) return saga.climate;

  const ownedRegions = [...new Set(
    world.cities.filter(({ key }) => state.cities[key]?.owner === state.player).map(({ region }) => region),
  )];
  if (!ownedRegions.length) return null;
  const region = ownedRegions[(state.turn * 5 + ownedRegions.length) % ownedRegions.length];
  const seasonIdx = state.turn % 4;
  // Deterministic mix: ~40% harvest, ~60% calamity
  const roll = (state.turn * 17 + region.charCodeAt(0)) % 10;
  const kind = roll < 4 ? CLIMATE_TYPES[0] : CLIMATE_TYPES[1 + ((roll + seasonIdx) % 3)];
  saga.climate = {
    id: kind.id,
    name: kind.name,
    region,
    turn: state.turn,
    pending: true,
    tone: kind.tone,
    desc: `${region}出现「${kind.name}」：${kind.desc}`,
  };
  return saga.climate;
}

export function resolveClimateChoice(world, state, action = "relief") {
  if (!state?.century || !state.saga?.climate?.pending) {
    throw new Error("当前暂无待决天时奏报。");
  }
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const clim = saga.climate;
  const regionCities = world.cities.filter((c) => c.region === clim.region && next.cities[c.key]?.owner === next.player);
  let message = "";

  if (clim.id === "harvest") {
    const bonusGrain = 24 + regionCities.length * 10;
    const bonusGold = action === "tax" ? 20 + regionCities.length * 6 : 8;
    next.factions[next.player].grain += bonusGrain;
    next.factions[next.player].treasury += bonusGold;
    if (action === "relief") {
      saga.reputation = clamp((saga.reputation ?? 50) + 5, 0, 100);
      next.factions[next.player].morale = clamp((next.factions[next.player].morale ?? 75) + 4, 15, 100);
      message = `${clim.region}丰年减赋与民同乐：储粮 +${bonusGrain}、声望 +5、士气 +4。`;
    } else {
      message = `${clim.region}丰年征储实边：储粮 +${bonusGrain}、国库 +${bonusGold}。`;
    }
  } else if (action === "relief") {
    const cost = Math.min(next.factions[next.player].treasury, 18);
    next.factions[next.player].treasury -= cost;
    saga.reputation = clamp((saga.reputation ?? 50) + 6, 0, 100);
    next.factions[next.player].morale = clamp((next.factions[next.player].morale ?? 75) + 2, 15, 100);
    for (const c of regionCities) {
      if (next.realm?.cities?.[c.key]) {
        next.realm.cities[c.key].welfare = Math.min(95, (next.realm.cities[c.key].welfare ?? 68) + 6);
      }
    }
    message = `拨款 ${cost} 钱赈抚${clim.region}「${clim.name}」，民心安定、声望 +6！`;
  } else {
    // Hold treasury, suffer light welfare/morale hit
    next.factions[next.player].morale = clamp((next.factions[next.player].morale ?? 75) - 4, 15, 100);
    saga.reputation = clamp((saga.reputation ?? 50) - 3, 0, 100);
    for (const c of regionCities) {
      if (next.realm?.cities?.[c.key]) {
        next.realm.cities[c.key].welfare = Math.max(25, (next.realm.cities[c.key].welfare ?? 68) - 8);
      }
    }
    message = `暂缓赈济${clim.region}「${clim.name}」，国库未损但士气 -4、声望 -3。`;
  }

  clim.pending = false;
  recordAnnal(next, "天时", message);
  return { state: next, message };
}
