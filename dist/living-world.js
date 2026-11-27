// v27.0 — 「活态九州」沙盘可交互奇遇地标 + 诸侯动态传书 + 霸主战勋追踪

import { addSagaBuff, ensureSaga, recordAnnal } from "./saga.js";
import { hasPendingRoyalCard } from "./royal-cards.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export const ENCOUNTER_KINDS = {
  tavern: {
    id: "tavern",
    icon: "🍶",
    badge: "英雄酒肆",
    title: "酒肆逢豪杰·邀弈兵法局",
    summary: "城郊酒肆名流云集，正设下三路沙盘赌局品评天下英雄。",
  },
  hermit: {
    id: "hermit",
    icon: "🏺",
    badge: "隐士茅庐",
    title: "山阿访幽贤·论策赠谋",
    summary: "隐逸高士于清溪结庐垂钓，可携厚礼拜谒或请教兵法心得。",
  },
  horse_market: {
    id: "horse_market",
    icon: "🐎",
    badge: "塞外马市",
    title: "骏马良驹集·互市充骑",
    summary: "边陲商客汇集大批战马甲具，可择一桩实惠交易充实前沿军备。",
  },
  scout_camp: {
    id: "scout_camp",
    icon: "🔥",
    badge: "敌营哨探",
    title: "截获敌军哨队·奇袭抉择",
    summary: "我方游骑截住敌方传令轻骑与运粮前哨，当断则断可挫敌城！",
  },
  ancient_fort: {
    id: "ancient_fort",
    icon: "🏯",
    badge: "古垒遗风",
    title: "整修先汉故垒·阅兵扬威",
    summary: "此地乃先汉古战场，整肃军容祭旗，可固城防并振奋三军锐气。",
  },
};

function ownedAndEnemyCities(world, state) {
  const owned = [];
  const enemy = [];
  for (const c of world.cities || []) {
    if (state.cities?.[c.key]?.owner === state.player) owned.push(c);
    else if (state.cities?.[c.key]?.owner) enemy.push(c);
  }
  return { owned, enemy };
}

/**
 * 确定性生成本季大地图 3 处可交互活态奇遇地标（非史诗模式返回 []）
 */
export function getSeasonEncounters(world, state) {
  if (!state?.century || !world?.cities?.length) return [];
  const encState = state.saga?.encounters;
  const resolved = new Set(encState?.turn === state.turn ? (encState.resolvedIds || []) : []);
  const { owned, enemy } = ownedAndEnemyCities(world, state);
  const pool = owned.length ? owned : world.cities;
  const turn = state.turn ?? 0;

  const pickCity = (list, salt, fallbackIdx = 0) => {
    const src = list.length ? list : world.cities;
    return src[(turn * 3 + salt) % src.length] || world.cities[fallbackIdx];
  };

  const c1 = pickCity(owned, 0, 0);
  const altOwned = owned.filter((c) => c.key !== c1.key);
  const c2 = pickCity(altOwned.length ? altOwned : pool, 1, 1);
  const c3 = pickCity(enemy.length ? enemy : pool, 2, 2);

  const slots = [
    { kind: "tavern", city: c1, offset: [22, -22] },
    { kind: turn % 2 === 0 ? "horse_market" : "ancient_fort", city: c2, offset: [-26, 18] },
    { kind: turn % 2 === 0 ? "scout_camp" : "hermit", city: c3, offset: [24, 18] },
  ];

  const usedCities = new Set();
  const list = [];
  for (let i = 0; i < slots.length; i += 1) {
    let city = slots[i].city;
    if (usedCities.has(city.key)) {
      city = world.cities.find((w) => !usedCities.has(w.key)) || city;
    }
    usedCities.add(city.key);
    const id = `enc_${turn}_${slots[i].kind}_${city.key}`;
    if (resolved.has(id)) continue;
    const meta = ENCOUNTER_KINDS[slots[i].kind];
    list.push({
      id,
      kind: meta.id,
      icon: meta.icon,
      badge: meta.badge,
      title: `${meta.badge}（近${city.name}）`,
      prompt: meta.summary,
      cityKey: city.key,
      cityName: city.name,
      position: [city.position[0] + slots[i].offset[0], city.position[1] + slots[i].offset[1]],
      options: optionsForKind(meta.id, city.name),
    });
  }
  return list;
}

function optionsForKind(kind, cityName) {
  if (kind === "tavern") {
    return [
      { id: "open_clash", label: "🃏 与豪杰对弈「九州兵法局」", hint: "即刻开一局三路卡牌对决（可赢府库/粮草/兵技）", action: "open_clash" },
      { id: "feast_quick", label: "🍶 赐酒结交豪侠", hint: "耗 25 金，近城增兵 +320、声望 +3" },
    ];
  }
  if (kind === "horse_market") {
    return [
      { id: "buy_steeds", label: "🐎 易粮买战马", hint: "耗 50 粮，获 +480 骑兵、全军攻势 +7%（2季）" },
      { id: "tax_market", label: "💰 征收边市商税", hint: "府库 +65 金、兵技 +12 点" },
    ];
  }
  if (kind === "scout_camp") {
    return [
      { id: "ambush_grain", label: "🔥 伏击烧毁敌前哨", hint: `耗 30 金：夺粮 +90 且令「${cityName}」陷流言 2 季` },
      { id: "interrogate", label: "🗡️ 捕俘审问兵法图纸", hint: "兵技点 +25、声望 +3" },
    ];
  }
  if (kind === "hermit") {
    return [
      { id: "seek_counsel", label: "📜 奉礼请教奇策", hint: "耗 30 金：兵技 +32、声望 +5" },
      { id: "recruit_disciples", label: "🛡️ 招募门下义勇", hint: "主城增兵 +350、士气 +5" },
    ];
  }
  return [
    { id: "drill_troops", label: "⚔️ 古垒阅兵鼓舞", hint: "全军防御 +9%（3季）、主城增兵 +280" },
    { id: "salvage_arms", label: "⚒️ 搜捡先汉遗甲", hint: "府库 +55 金、兵技 +15" },
  ];
}

/**
 * 结算选中的沙盘奇遇并将其从本季地图移除
 */
export function resolveWorldEncounter(world, state, encounterId, optionId) {
  if (!state?.century) return { state, summary: "", nextAction: null };
  const active = getSeasonEncounters(world, state);
  const enc = active.find((e) => e.id === encounterId);
  if (!enc) return { state, summary: "此处奇遇已了结。", nextAction: null };

  const opt = enc.options.find((o) => o.id === optionId) || enc.options[0];
  if (opt.action === "open_clash") {
    // 玩家入局再消散图标，先标记处理
    const next = structuredClone(state);
    const saga = ensureSaga(next);
    saga.encounters = {
      turn: next.turn,
      resolvedIds: [...new Set([...(saga.encounters?.turn === next.turn ? saga.encounters.resolvedIds : []), enc.id])],
    };
    return { state: next, summary: `赴「${enc.cityName}」酒肆设局对弈！`, nextAction: "card_clash", encounter: enc };
  }

  const next = structuredClone(state);
  const saga = ensureSaga(next);
  const f = next.factions?.[next.player];
  saga.encounters = {
    turn: next.turn,
    resolvedIds: [...new Set([...(saga.encounters?.turn === next.turn ? saga.encounters.resolvedIds : []), enc.id])],
  };

  const addTroops = (amt, preferKey = null) => {
    const owned = Object.entries(next.cities || {}).filter(([, c]) => c?.owner === next.player);
    if (!owned.length) return;
    const target = (preferKey && owned.find(([k]) => k === preferKey)) || owned.sort((a, b) => (b[1].troops ?? 0) - (a[1].troops ?? 0))[0];
    target[1].troops = Math.min(60000, Math.round((target[1].troops ?? 0) + amt));
  };

  let msg = "";
  if (opt.id === "feast_quick") {
    if (f) f.treasury = Math.max(0, (f.treasury ?? 0) - 25);
    addTroops(320, enc.cityKey);
    saga.reputation = clamp((saga.reputation ?? 50) + 3, 0, 100);
    msg = `🍶 与「${enc.cityName}」豪侠痛饮：募兵 +320 · 声望 +3`;
  } else if (opt.id === "buy_steeds") {
    if (f) f.grain = Math.max(0, (f.grain ?? 0) - 50);
    addTroops(480, enc.cityKey);
    addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.07, duration: 2, label: "胡市骏马" });
    msg = "🐎 边市易马成军：增骑 +480 · 全军攻势 +7%（2季）";
  } else if (opt.id === "tax_market") {
    if (f) f.treasury = (f.treasury ?? 0) + 65;
    saga.tech ??= { points: 0, unlocked: [] };
    saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + 12);
    msg = "💰 收缴边市关税：府库 +65 · 兵技 +12";
  } else if (opt.id === "ambush_grain") {
    if (f) {
      f.treasury = Math.max(0, (f.treasury ?? 0) - 30);
      f.grain = (f.grain ?? 0) + 90;
    }
    saga.rumors ??= {};
    saga.rumors[enc.cityKey] = next.turn + 2;
    msg = `🔥 伏击「${enc.cityName}」哨队：获粮 +90 且敌城流言动摇 2 季！`;
  } else if (opt.id === "interrogate") {
    saga.tech ??= { points: 0, unlocked: [] };
    saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + 25);
    saga.reputation = clamp((saga.reputation ?? 50) + 3, 0, 100);
    msg = "🗡️ 捕俘审得密图：兵技 +25 · 声望 +3";
  } else if (opt.id === "seek_counsel") {
    if (f) f.treasury = Math.max(0, (f.treasury ?? 0) - 30);
    saga.tech ??= { points: 0, unlocked: [] };
    saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + 32);
    saga.reputation = clamp((saga.reputation ?? 50) + 5, 0, 100);
    msg = "📜 拜谒高士问计：兵技 +32 · 海内声望 +5";
  } else if (opt.id === "recruit_disciples") {
    addTroops(350);
    for (const c of Object.values(next.cities || {})) {
      if (c?.owner === next.player) c.morale = clamp((c.morale ?? 70) + 5, 0, 100);
    }
    msg = "🛡️ 招募幽林义从 +350 · 全境民心 +5";
  } else if (opt.id === "drill_troops") {
    addTroops(280);
    addSagaBuff(next, { kind: "defense", faction: next.player, value: 0.09, duration: 3, label: "古垒阅兵" });
    msg = "🏯 先汉古垒阅兵：全军防御 +9%（3季）· 增兵 +280";
  } else {
    if (f) f.treasury = (f.treasury ?? 0) + 55;
    saga.tech ??= { points: 0, unlocked: [] };
    saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + 15);
    msg = "⚒️ 古垒获先汉兵器：府库 +55 · 兵技 +15";
  }

  recordAnnal(next, "九州奇遇", msg);
  return { state: next, summary: msg, nextAction: null, encounter: enc };
}

/**
 * 获取本季仍在世敌对名主发出的「诸侯动态传书」（每季一条，回复即止）
 */
export function getActiveWarlordDispatch(world, era, state) {
  if (!state?.century || !era?.factions?.length) return null;
  if ((state.saga?.dispatchTurn ?? -1) === state.turn) return null;

  const rivalFactions = era.factions.filter(
    (f) => f.key !== state.player && Object.values(state.cities || {}).some((c) => c?.owner === f.key),
  );
  if (!rivalFactions.length) return null;

  const pickedFaction = rivalFactions[(state.turn ?? 0) % rivalFactions.length];
  const leader = era.officers.find((o) => o.faction === pickedFaction.key && o.name === pickedFaction.name)
    || era.officers.find((o) => o.faction === pickedFaction.key)
    || { key: null, name: pickedFaction.name };
  const targetCityKey = Object.entries(state.cities || {}).find(([, c]) => c?.owner === pickedFaction.key)?.[0] || null;
  const playerCities = Object.values(state.cities || {}).filter((c) => c?.owner === state.player).length;
  const templates = [
    `「今闻阁下坐拥 ${playerCities} 城，兵锋正盛。敢邀将校对弈一局『九州兵法』，抑或犒酒试胆否？」`,
    `「乱世争雄，岂在多言！我军铁甲已枕戈待旦，阁下可敢亲派大将赴阵前试我锋芒？」`,
    `「既图天下大势，何如立此盟书互通有无——抑或直接兵戎相见，看天命归谁！」`,
  ];
  const quote = templates[(state.turn ?? 0) % templates.length];

  return {
    id: `dispatch_${state.turn}_${pickedFaction.key}`,
    factionKey: pickedFaction.key,
    factionName: pickedFaction.name,
    warlordName: leader.name,
    warlordOfficerKey: leader.key,
    targetCityKey,
    quote,
    choices: [
      { id: "challenge", label: "⚔️ 应战破其锋（开擂台/牌局）" },
      { id: "reply_wits", label: "📜 传檄斥之（声望 +3 · 动摇敌城）" },
    ],
  };
}

/**
 * 回应诸侯动态传书并标记本季已应对
 */
export function answerWarlordDispatch(world, state, dispatch, choiceId) {
  if (!state?.century || !dispatch) return { state, nextAction: null, summary: "" };
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  saga.dispatchTurn = next.turn;

  if (choiceId === "challenge") {
    const modeAction = (next.turn % 2 === 0) ? "card_clash" : "free_arena";
    return {
      state: next,
      nextAction: modeAction,
      enemyOfficerKey: dispatch.warlordOfficerKey,
      enemyName: dispatch.warlordName,
      factionName: dispatch.factionName,
      summary: `⚔️ 已接「${dispatch.factionName}·${dispatch.warlordName}」下书应战！`,
    };
  }

  saga.reputation = clamp((saga.reputation ?? 50) + 3, 0, 100);
  if (dispatch.targetCityKey) {
    saga.rumors ??= {};
    saga.rumors[dispatch.targetCityKey] = next.turn + 2;
  }
  const cName = world?.cities?.find((c) => c.key === dispatch.targetCityKey)?.name || dispatch.targetCityKey || "";
  recordAnnal(next, "诸侯传书", `传檄痛斥${dispatch.factionName}使节，海内声望 +3，敌城${cName ? `「${cName}」` : ""}防心略摇。`);
  return {
    state: next,
    nextAction: null,
    summary: `📜 已传檄斥责「${dispatch.factionName}」来使：声望 +3${cName ? ` · 敌城「${cName}」动摇 2 季` : ""}`,
  };
}

/**
 * 计算当世霸主四项跨玩法战勋进度
 */
export function evaluateWarlordMedals(state) {
  const saga = state?.saga || {};
  const duelCnt = (saga.duelWins ?? 0);
  const clashCnt = (saga.clashStats?.wins ?? 0);
  const royalStreak = (saga.royalDecrees?.streak ?? 0);
  const dramaCnt = (saga.dramasPlayed?.length ?? 0);
  const pendingRoyal = hasPendingRoyalCard(state);
  return [
    { id: "duel_master", icon: "⚔️", title: "阵前战神", desc: "单挑 / 演武捷报累计 3 场", current: Math.min(3, duelCnt), target: 3, unlocked: duelCnt >= 3 },
    { id: "clash_sage", icon: "🃏", title: "九州牌圣", desc: "九州兵法局克捷 2 局", current: Math.min(2, clashCnt), target: 2, unlocked: clashCnt >= 2 },
    { id: "royal_hand", icon: "📜", title: "明君圣裁", desc: `连续批复密奏达 3 季${pendingRoyal ? "（本季待批）" : ""}`, current: Math.min(3, royalStreak), target: 3, unlocked: royalStreak >= 3 },
    { id: "drama_patron", icon: "🎭", title: "演义巨擘", desc: "演绎名剧章节达 2 幕", current: Math.min(2, dramaCnt), target: 2, unlocked: dramaCnt >= 2 },
  ];
}
