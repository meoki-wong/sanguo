// 经略三国 4.0 — 军机处中枢奏折、重臣建言、朱批一键裁决与理政托管

import {
  NATIONAL_DECREES_V2, activeTreaty, availableOfficersInCity, cityByKey,
  cityNameV2, factionNameV2, findRoadPath, isHostileV2,
} from "./constants.js";
import {
  CITY_BUILDINGS_V4, TAX_LEVELS_V4, buildingUpgradeCost, computeCourtBonuses,
  ensureV4State, estimateFactionEconomy, setTaxLevel, upgradeCityBuilding,
} from "./court.js";
import { enactDecree, evaluateDeal, proposeDeal } from "./systems.js";
import { recruitWanderingOfficer } from "./arts.js";
import { setSupplyLink } from "./theater.js";

export const OPENING_DEV_DEKADS = 9;

function ministerMeta(state, officeId, fallbackTitle) {
  const bonuses = computeCourtBonuses(state, state.player);
  const off = bonuses.holders?.[officeId] || null;
  return {
    officeId,
    ministerTitle: fallbackTitle,
    ministerName: off ? `${fallbackTitle} · ${off.name}` : `${fallbackTitle}署`,
  };
}

export function buildCabinetBriefings(world, state) {
  if (!state || !state.cities || state.outcome !== "ongoing") return [];
  const player = state.player;
  const fac = state.factions?.[player];
  if (!fac) return [];

  const dismissed = new Set(state.dismissedCabinetIds || []);
  const econ = estimateFactionEconomy(state, player);
  const ownedCities = Object.values(state.cities).filter((c) => c.owner === player);
  const items = [];

  const pushItem = (item) => {
    if (!dismissed.has(item.id)) items.push(item);
  };

  // 1. Urgent siege relief
  for (const c of ownedCities) {
    if (!state.sieges?.[c.key]) continue;
    const alreadyRelieving = (state.armies || []).some(
      (a) => a.faction === player && a.targetCity === c.key && a.stance === "reinforce",
    );
    if (alreadyRelieving) continue;
    const helper = ownedCities.find((other) => (
      other.key !== c.key
      && !state.sieges?.[other.key]
      && other.troops >= 1300
      && availableOfficersInCity(state, other.key, player).length > 0
      && findRoadPath(world, state, player, other.key, c.key, { allowEnemyEnd: false, maxHops: 4 })
    ));
    if (helper) {
      const m = ministerMeta(state, "grand_general", "大将军");
      pushItem({
        id: `cab:relief:${c.key}`,
        category: "military",
        priority: 100,
        urgent: true,
        ...m,
        title: `火速发兵驰援「${cityNameV2(world, c.key)}」`,
        summary: `「${cityNameV2(world, c.key)}」正遭重围！建议即刻自「${cityNameV2(world, helper.key)}」抽调精锐星夜解围。`,
        effectText: "派出一支精锐援军解围",
        costText: "约 8 石军粮",
        action: { kind: "relief", payload: { cityKey: c.key } },
      });
      break;
    }
  }

  // 2. Wandering hero recruitment
  for (const w of state.wanderingOfficers || []) {
    const canReach = state.cities[w.city]?.owner === player
      || (cityByKey(world, w.city)?.links || []).some((nb) => state.cities[nb]?.owner === player && !state.sieges?.[nb]);
    if (canReach && fac.treasury >= 24) {
      const m = ministerMeta(state, "chancellor", "丞相");
      pushItem({
        id: `cab:recruit:${w.id}`,
        category: "personnel",
        priority: 88,
        urgent: false,
        ...m,
        title: `礼聘在野名士「${w.name}」`,
        summary: `「${w.name}」（统${w.command}/武${w.might}/政${w.governance}）近现踪于「${cityNameV2(world, w.city)}」一带，亟宜重礼罗致。`,
        effectText: `${w.name} 归入麾下（忠义 88）`,
        costText: "国库 24 钱",
        action: { kind: "recruit", payload: { heroId: w.id } },
      });
      break;
    }
  }

  // 3. Tax & Public Order alert
  const curTax = fac.taxLevel || "normal";
  if (econ.avgOrder < 58 && curTax === "high") {
    const m = ministerMeta(state, "imperial_censor", "御史大夫");
    pushItem({
      id: "cab:tax:low_calm",
      category: "economy",
      priority: 86,
      urgent: true,
      ...m,
      title: "转行「轻徭薄赋」平抑民怨",
      summary: `全境平均治安已跌至 ${econ.avgOrder}，若不改弦易辙恐激流民起事！`,
      effectText: "每月治安 +8、将领忠义 +1、军粮 +10%",
      costText: "商税暂降 22%",
      action: { kind: "tax", payload: { taxId: "low" } },
    });
  } else if ((econ.netTreasury < 0 || fac.treasury < 30) && econ.avgOrder >= 74 && curTax !== "high") {
    const m = ministerMeta(state, "grand_minister_comm", "大司徒");
    pushItem({
      id: "cab:tax:high_war",
      category: "economy",
      priority: 82,
      urgent: false,
      ...m,
      title: "启用「重敛征饷」充实军费",
      summary: `当前国库吃紧（月净收 ${econ.netTreasury >= 0 ? `+${econ.netTreasury}` : econ.netTreasury} 钱），而全境民情尚稳（治安 ${econ.avgOrder}），可暂加征军赋。`,
      effectText: "全国商税 +35%",
      costText: "每月治安 -7",
      action: { kind: "tax", payload: { taxId: "high" } },
    });
  }

  // 4. Highest-ROI city building upgrades (up to 2)
  const buildCandidates = [];
  for (const c of ownedCities) {
    if (state.sieges?.[c.key]) continue;
    const isBorder = (cityByKey(world, c.key)?.links || []).some(
      (nb) => state.cities[nb] && isHostileV2(state, player, state.cities[nb].owner),
    );
    for (const trackId of ["farm", "market", "workshop", "academy"]) {
      const lv = c.buildings?.[trackId] ?? 0;
      if (lv >= 5) continue;
      const nextLv = lv + 1;
      const cost = buildingUpgradeCost(state, player, trackId, nextLv);
      if (cost > fac.treasury) continue;

      let score = (5 - lv) * 14;
      if (trackId === "farm") score += (econ.netGrain < 55 || fac.grain < 180) ? 28 : 14;
      if (trackId === "market") score += (econ.netTreasury < 45 || fac.treasury < 140) ? 26 : 16;
      if (trackId === "academy") score += (c.publicOrder < 68) ? 32 : (econ.corruptionRate > 0.08 ? 20 : 6);
      if (trackId === "workshop") score += isBorder ? 22 : 8;
      buildCandidates.push({ city: c, trackId, nextLv, cost, score });
    }
  }
  buildCandidates.sort((a, b) => b.score - a.score || a.cost - b.cost);
  const pickedBuildCities = new Set();
  for (const bc of buildCandidates) {
    if (pickedBuildCities.size >= 2) break;
    if (pickedBuildCities.has(bc.city.key)) continue;
    pickedBuildCities.add(bc.city.key);
    const def = CITY_BUILDINGS_V4[bc.trackId];
    const officeMap = {
      farm: ["grand_minister_agri", "大司农"],
      market: ["grand_minister_comm", "大司徒"],
      workshop: ["grand_general", "大将军"],
      academy: ["imperial_censor", "御史大夫"],
    };
    const [oid, otitle] = officeMap[bc.trackId];
    const m = ministerMeta(state, oid, otitle);
    pushItem({
      id: `cab:build:${bc.city.key}:${bc.trackId}:${bc.nextLv}`,
      category: "economy",
      priority: 76 - pickedBuildCities.size,
      urgent: false,
      ...m,
      title: `扩建「${cityNameV2(world, bc.city.key)}」${def.name} Lv.${bc.nextLv}`,
      summary: `${cityNameV2(world, bc.city.key)}基础稳固，扩建${def.name}可长远厚植产额与国家威望。`,
      effectText: `${def.name} +1 级（威望 +${def.prestigePerLv}）`,
      costText: `国库 ${bc.cost} 钱`,
      action: { kind: "build", payload: { cityKey: bc.city.key, trackId: bc.trackId } },
    });
  }

  // 5. Captive resolution
  if (state.captives?.length) {
    const cap = state.captives[0];
    const off = state.officers?.[cap.officer];
    if (off) {
      const m = ministerMeta(state, "imperial_censor", "御史大夫");
      const recCost = off.loyalty > 85 ? 24 : 14;
      const doRecruit = fac.treasury >= recCost;
      pushItem({
        id: `cab:captive:${off.key}`,
        category: "personnel",
        priority: 70,
        urgent: false,
        ...m,
        title: doRecruit ? `劝降在押敌将「${off.name}」` : `索赎放还俘将「${off.name}」`,
        summary: `在押名将「${off.name}」（统${off.command}/武${off.might}）尚羁牢中，宜早决断。`,
        effectText: doRecruit ? `${off.name} 归顺我军` : "换回一笔军费赎金",
        costText: doRecruit ? `礼金 ${recCost} 钱` : "无消耗 · 进账赎金",
        action: { kind: "captive", payload: { officerKey: off.key, act: doRecruit ? "recruit" : "ransom" } },
      });
    }
  }

  // 6. National decrees
  const decreePriority = ["tuntian", "standing_army", "nine_ranks", "iron_walls", "thunder_siege", "repeating_crossbow", "grand_fleet", "imperial_edict"];
  for (const did of decreePriority) {
    if (state.decrees?.[player]?.includes(did)) continue;
    const spec = NATIONAL_DECREES_V2[did];
    if (spec && econ.cityCount >= spec.minCities && fac.treasury >= spec.cost) {
      const m = ministerMeta(state, "chancellor", "丞相");
      pushItem({
        id: `cab:decree:${did}`,
        category: "court",
        priority: 64,
        urgent: false,
        ...m,
        title: `颁布国策「${spec.icon} ${spec.name}」`,
        summary: spec.summary,
        effectText: "永久国策增益",
        costText: `国库 ${spec.cost} 钱`,
        action: { kind: "decree", payload: { decreeId: did } },
      });
      break;
    }
  }

  // 7. Rear-to-front supply link
  const frontNeed = ownedCities.find((c) => c.troops < 1300 && (cityByKey(world, c.key)?.links || []).some(
    (nb) => state.cities[nb] && isHostileV2(state, player, state.cities[nb].owner),
  ));
  if (frontNeed) {
    const rearReady = ownedCities.find((r) => (
      r.key !== frontNeed.key
      && r.troops >= 1800
      && !state.sieges?.[r.key]
      && !state.supplyLinks?.[r.key]
      && !(cityByKey(world, r.key)?.links || []).some((nb) => state.cities[nb] && isHostileV2(state, player, state.cities[nb].owner))
      && findRoadPath(world, state, player, r.key, frontNeed.key, { allowEnemyEnd: false })
    ));
    if (rearReady) {
      const m = ministerMeta(state, "grand_minister_agri", "大司农");
      pushItem({
        id: `cab:supply:${rearReady.key}:${frontNeed.key}`,
        category: "logistics",
        priority: 58,
        urgent: false,
        ...m,
        title: `委任「${cityNameV2(world, rearReady.key)}→${cityNameV2(world, frontNeed.key)}」自动输血`,
        summary: `前线「${cityNameV2(world, frontNeed.key)}」兵微将寡，而腹地「${cityNameV2(world, rearReady.key)}」兵力充裕，可设为常备兵站线。`,
        effectText: "月初自动向该前线输送兵员",
        costText: "免消耗委任",
        action: { kind: "supply_link", payload: { rearKey: rearReady.key, frontKey: frontNeed.key } },
      });
    }
  }

  // 8. Diplomatic truce when multi-front pressure is high
  const hostileRivals = new Set();
  for (const c of ownedCities) {
    for (const nb of cityByKey(world, c.key)?.links || []) {
      const ow = state.cities[nb]?.owner;
      if (ow && isHostileV2(state, player, ow)) hostileRivals.add(ow);
    }
  }
  if (hostileRivals.size >= 2 && fac.treasury >= 24) {
    for (const fk of hostileRivals) {
      if (activeTreaty(state, player, fk)) continue;
      const evalRes = evaluateDeal(world, state, fk, { type: "truce", gold: 20, grain: 0 });
      if (evalRes.ok && evalRes.accepted) {
        const m = ministerMeta(state, "chancellor", "丞相");
        pushItem({
          id: `cab:diplo:${fk}`,
          category: "diplomacy",
          priority: 52,
          urgent: false,
          ...m,
          title: `遣使与「${factionNameV2(world, state, fk)}」议和停战`,
          summary: `我朝四面受敌（${hostileRivals.size} 方接壤敌对），${factionNameV2(world, state, fk)}眼下愿纳礼罢兵 18 旬，宜远交近攻。`,
          effectText: `与${factionNameV2(world, state, fk)}停战 18 旬`,
          costText: "国库 20 钱",
          action: { kind: "diplomacy", payload: { targetFaction: fk, gold: 20 } },
        });
        break;
      }
    }
  }

  return items.sort((a, b) => b.priority - a.priority).slice(0, 8);
}

export function executeCabinetProposal(world, state, proposalId, helpers = {}) {
  const list = buildCabinetBriefings(world, state);
  const prop = list.find((p) => p.id === proposalId);
  if (!prop) throw new Error("该军机奏折已处理或条件已变更。");

  const { kind, payload } = prop.action;
  let next;
  if (kind === "relief") {
    if (!helpers.dispatchEmergencyReinforce) throw new Error("缺失急援调度接口。");
    next = helpers.dispatchEmergencyReinforce(world, state, payload.cityKey);
  } else if (kind === "recruit") {
    next = recruitWanderingOfficer(world, state, payload.heroId);
  } else if (kind === "tax") {
    next = setTaxLevel(state, payload.taxId);
  } else if (kind === "build") {
    next = upgradeCityBuilding(world, state, payload.cityKey, payload.trackId);
  } else if (kind === "captive") {
    if (!helpers.resolveCaptive) throw new Error("缺失俘将处置接口。");
    next = helpers.resolveCaptive(state, payload.officerKey, payload.act);
  } else if (kind === "decree") {
    next = enactDecree(world, state, payload.decreeId);
  } else if (kind === "supply_link") {
    next = setSupplyLink(world, state, payload.rearKey, payload.frontKey);
  } else if (kind === "diplomacy") {
    next = proposeDeal(world, state, payload.targetFaction, { type: "truce", gold: payload.gold, grain: 0 });
  } else {
    throw new Error("未知奏折指令类型。");
  }

  const ev = {
    turn: next.turn,
    kind: "system",
    faction: next.player,
    text: `🏛️ 军机朱批：准「${prop.ministerName}」所奏 — ${prop.title}。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function dismissCabinetProposal(state, proposalId) {
  const next = ensureV4State(structuredClone(state));
  if (!next.dismissedCabinetIds.includes(proposalId)) {
    next.dismissedCabinetIds.push(proposalId);
  }
  return next;
}

export function approveAllRecommended(world, state, helpers = {}) {
  let cur = ensureV4State(structuredClone(state));
  const initial = buildCabinetBriefings(world, cur);
  if (!initial.length) throw new Error("当前暂无可一键批复的军机奏折。");

  let doneCount = 0;
  for (const item of initial) {
    try {
      cur = executeCabinetProposal(world, cur, item.id, helpers);
      doneCount += 1;
    } catch {
      // Skip items whose prerequisites/treasury changed after earlier approvals
    }
  }
  if (!doneCount) throw new Error("国库或前置条件不足，暂未能批复推荐奏折。");

  const ev = {
    turn: cur.turn,
    kind: "system",
    faction: cur.player,
    text: `📜 军机总批：主公御批通行，已一键落实 ${doneCount} 件重臣建言！`,
  };
  cur.events = [...(cur.events || []), ev].slice(-80);
  cur.lastTurnEvents = [ev];
  return cur;
}

export function setAutoGovernance(state, key, enabled) {
  if (!["autoEconomy", "autoPersonnel", "autoDefense"].includes(key)) {
    throw new Error("未知托管政令项。");
  }
  const next = ensureV4State(structuredClone(state));
  next.autoGovernance[key] = Boolean(enabled);
  const labelMap = {
    autoEconomy: "大司农/大司徒自理基建",
    autoPersonnel: "丞相/御史自理贤才俘将",
    autoDefense: "大将军自理危城急援",
  };
  const ev = {
    turn: next.turn,
    kind: "system",
    faction: next.player,
    text: `🤖 军机托管：「${labelMap[key]}」已${enabled ? "开启" : "关闭"}。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function runAutoGovernanceMonthly(world, state, events = [], helpers = {}) {
  const flags = state?.autoGovernance;
  if (!flags || (!flags.autoEconomy && !flags.autoPersonnel && !flags.autoDefense)) return state;

  let cur = state;
  const player = cur.player;

  if (flags.autoDefense && helpers.dispatchEmergencyReinforce) {
    const besieged = Object.values(cur.cities || {}).find((c) => (
      c.owner === player
      && cur.sieges?.[c.key]
      && !(cur.armies || []).some((a) => a.faction === player && a.targetCity === c.key && a.stance === "reinforce")
    ));
    if (besieged) {
      try {
        cur = helpers.dispatchEmergencyReinforce(world, cur, besieged.key);
        events.push({ turn: cur.turn, kind: "order", faction: player, text: `🤖 军机自动调援：大将军已自近城发兵驰援「${cityNameV2(world, besieged.key)}」。` });
      } catch {
        // Skip if no spare force
      }
    }
  }

  if (flags.autoPersonnel) {
    if ((cur.factions?.[player]?.treasury ?? 0) >= 48 && cur.wanderingOfficers?.length) {
      const hero = cur.wanderingOfficers.find((w) => (
        cur.cities[w.city]?.owner === player
        || (cityByKey(world, w.city)?.links || []).some((nb) => cur.cities[nb]?.owner === player && !cur.sieges?.[nb])
      ));
      if (hero) {
        try {
          cur = recruitWanderingOfficer(world, cur, hero.id);
          events.push({ turn: cur.turn, kind: "officer", faction: player, text: `🤖 军机自动招贤：丞相遣使礼聘名士「${hero.name}」入仕！` });
        } catch {
          // Ignore
        }
      }
    }
    if ((cur.factions?.[player]?.treasury ?? 0) >= 40 && cur.captives?.length && helpers.resolveCaptive) {
      try {
        const capName = cur.officers?.[cur.captives[0].officer]?.name || "降将";
        cur = helpers.resolveCaptive(cur, cur.captives[0].officer, "recruit");
        events.push({ turn: cur.turn, kind: "officer", faction: player, text: `🤖 军机自动理狱：已招降在押将领「${capName}」。` });
      } catch {
        // Ignore
      }
    }
  }

  if (flags.autoEconomy && (cur.factions?.[player]?.treasury ?? 0) >= 85) {
    const econ = estimateFactionEconomy(cur, player);
    const buildProp = buildCabinetBriefings(world, cur).find((p) => p.action?.kind === "build");
    if (buildProp && cur.factions[player].treasury >= 85) {
      const { cityKey, trackId } = buildProp.action.payload;
      try {
        cur = upgradeCityBuilding(world, cur, cityKey, trackId, { actorFaction: player, silent: true });
        const def = CITY_BUILDINGS_V4[trackId];
        events.push({
          turn: cur.turn,
          kind: "economy",
          faction: player,
          text: `🤖 军机自动兴建：依重臣所议，已扩建「${cityNameV2(world, cityKey)}」${def.name}（余钱 ${cur.factions[player].treasury}，治安 ${econ.avgOrder}）。`,
        });
      } catch {
        // Ignore
      }
    }
  }

  return cur;
}
