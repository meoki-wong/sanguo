// 经略三国 3.0 — 名将专属战场战法 / 在野贤才寻访 / 将领跨城驿传调防

import {
  armyWorldPosition, availableOfficersInCity, cityByKey, cityNameV2, clamp,
  edgeKey, factionNameV2, findRoadPath, hashStr, returnOfficerHome,
} from "./constants.js";
import { recordBattleReport } from "./chronicle.js";

export const BATTLE_ARTS_V3 = {
  unrivaled: {
    id: "unrivaled",
    name: "天下无双",
    icon: "🔱",
    desc: "无视敌阵减伤横扫千军，重挫敌军士气",
    dmgPct: 0.22,
    moraleDrop: 16,
  },
  single_charge: {
    id: "single_charge",
    name: "单骑突阵",
    icon: "🐎",
    desc: "轻骑凿穿敌军战线，己方士气大振",
    dmgPct: 0.18,
    moraleDrop: 12,
    selfMorale: 12,
  },
  flood_seven: {
    id: "flood_seven",
    name: "威震华夏",
    icon: "🌊",
    desc: "水陆齐驱威震三军，围城可额外崩毁城防",
    dmgPct: 0.19,
    wallDmg: 110,
    moraleDrop: 14,
  },
  roar_bridge: {
    id: "roar_bridge",
    name: "咆哮断桥",
    icon: "🦁",
    desc: "虎吼震敌胆寒，大幅削弱敌军士气并阻其行动",
    dmgPct: 0.15,
    moraleDrop: 20,
    stagger: 1,
  },
  chain_fire: {
    id: "chain_fire",
    name: "火攻连营",
    icon: "🔥",
    desc: "借风纵火连烧敌营，兼毁敌军与城池余粮",
    dmgPct: 0.2,
    grainBurn: 6,
    foodBurn: 22,
    moraleDrop: 14,
  },
  eight_trigrams: {
    id: "eight_trigrams",
    name: "八阵困敌",
    icon: "☯️",
    desc: "妙算布阵困杀来敌，并整补己方伤疲散卒",
    dmgPct: 0.16,
    healPct: 0.06,
    selfMorale: 10,
    moraleDrop: 12,
  },
  cut_supply: {
    id: "cut_supply",
    name: "奇谋断粮",
    icon: "⚡",
    desc: "遣轻锐绕后焚敌辎重，立断敌部随军粮草",
    dmgPct: 0.13,
    cutGrain: true,
    moraleDrop: 15,
  },
  wei_whip: {
    id: "wei_whip",
    name: "魏武挥鞭",
    icon: "🏴",
    desc: "大军齐进鼓舞三军，显著提升自身与邻军士气",
    dmgPct: 0.16,
    selfMorale: 14,
    moraleDrop: 10,
  },
  benevolence: {
    id: "benevolence",
    name: "仁德归心",
    icon: "🕊️",
    desc: "义声招抚敌卒倒戈，化敌损半数为己军补充",
    dmgPct: 0.14,
    convertRatio: 0.5,
    selfMorale: 12,
  },
  valiant_rally: {
    id: "valiant_rally",
    name: "三军奋威",
    icon: "⚔️",
    desc: "主将身先士卒督战，予敌创伤并振作我军锐气",
    dmgPct: 0.14,
    selfMorale: 10,
    moraleDrop: 10,
  },
};

const NAME_TO_ART = {
  吕布: "unrivaled",
  赵云: "single_charge",
  张辽: "single_charge",
  马超: "single_charge",
  甘宁: "single_charge",
  文鸯: "single_charge",
  关羽: "flood_seven",
  张飞: "roar_bridge",
  许褚: "roar_bridge",
  周瑜: "chain_fire",
  陆逊: "chain_fire",
  庞统: "chain_fire",
  诸葛亮: "eight_trigrams",
  司马懿: "eight_trigrams",
  姜维: "eight_trigrams",
  羊祜: "eight_trigrams",
  杜预: "eight_trigrams",
  郭嘉: "cut_supply",
  贾诩: "cut_supply",
  荀攸: "cut_supply",
  邓艾: "cut_supply",
  曹操: "wei_whip",
  曹仁: "wei_whip",
  孙策: "single_charge",
  孙权: "wei_whip",
  刘备: "benevolence",
};

export function officerBattleArt(officer) {
  if (!officer) return BATTLE_ARTS_V3.valiant_rally;
  const direct = NAME_TO_ART[officer.name];
  if (direct && BATTLE_ARTS_V3[direct]) return BATTLE_ARTS_V3[direct];
  const traits = officer.traits || [];
  if (traits.includes("fire")) return BATTLE_ARTS_V3.chain_fire;
  if ((officer.intellect ?? 60) >= 88) return BATTLE_ARTS_V3.eight_trigrams;
  if (traits.includes("navy")) return BATTLE_ARTS_V3.flood_seven;
  if (traits.includes("cavalry") || (officer.might ?? 60) >= 86) return BATTLE_ARTS_V3.single_charge;
  return BATTLE_ARTS_V3.valiant_rally;
}

export function triggerArmyArt(world, state, armyId, events = [], { manual = false } = {}) {
  const work = manual ? structuredClone(state) : state;
  const army = (work.armies || []).find((a) => a.id === armyId);
  if (!army || army.troops <= 0) {
    if (manual) throw new Error("未找到可施放战法的在役军团。");
    return null;
  }
  if (manual && army.faction !== work.player) {
    throw new Error("仅可指挥己方军团施放战法。");
  }
  if ((army.rage || 0) < 100) {
    if (manual) throw new Error("该军团战意未满（需蓄势至 100%）。");
    return null;
  }

  const off = army.officer ? work.officers[army.officer] : null;
  const art = officerBattleArt(off);
  const offName = off?.name || army.escortName || "主将";
  army.rage = 0;

  if (art.selfMorale) army.morale = clamp(army.morale + art.selfMorale, 10, 100);
  if (art.healPct) army.troops += Math.round(army.troops * art.healPct);

  const curEdge = edgeKey(army.from, army.to);
  const enemyArmy = (army.engagedWith && work.armies.find((x) => x.id === army.engagedWith && x.troops > 0))
    || work.armies.find((x) => x.faction !== army.faction && x.troops > 0 && edgeKey(x.from, x.to) === curEdge);

  let detailMsg = "";
  let dmgTotal = 0;

  if (enemyArmy) {
    const weatherFire = art.id === "chain_fire" ? (work.weather?.fireMult ?? 1) : 1;
    const riverBonus = art.id === "flood_seven" && ((work.weather?.riverMult ?? 1) > 1.05) ? 1.35 : 1;
    const cmdFactor = clamp(0.88 + ((off?.command ?? 72) - 65) * 0.008, 0.85, 1.32);
    const dmg = clamp(Math.round(enemyArmy.troops * art.dmgPct * weatherFire * riverBonus * cmdFactor), 55, Math.max(55, enemyArmy.troops - 80));
    enemyArmy.troops = Math.max(0, enemyArmy.troops - dmg);
    dmgTotal = dmg;
    if (art.moraleDrop) enemyArmy.morale = clamp(enemyArmy.morale - art.moraleDrop, 8, 100);
    if (art.grainBurn) enemyArmy.grain = Math.max(0, enemyArmy.grain - art.grainBurn);
    if (art.cutGrain) {
      enemyArmy.grain = 0;
      enemyArmy.supplyCut = true;
    }
    if (art.stagger) enemyArmy.reorgDekads = Math.max(enemyArmy.reorgDekads || 0, art.stagger);
    if (art.convertRatio) {
      const gained = Math.round(dmg * art.convertRatio);
      army.troops += gained;
    }
    const enemyName = work.officers[enemyArmy.officer]?.name || "敌军";
    detailMsg = `${offName}施展「${art.icon} ${art.name}」，直创${enemyName}所部 ${dmg.toLocaleString()} 人！`;

    if (manual) {
      recordBattleReport(work, {
        kind: "battle_art",
        title: `绝技「${art.name}」临阵建功`,
        location: `${cityNameV2(world, army.from)}—${cityNameV2(world, army.to)}`,
        locationKey: army.to,
        winnerFaction: army.faction,
        attacker: { faction: army.faction, officer: offName, troops: army.troops },
        defender: { faction: enemyArmy.faction, officer: enemyName, troops: enemyArmy.troops },
        factors: [`战法：${art.name}`, art.desc],
        losses: { attacker: 0, defender: dmg },
        artTriggered: [`${offName} · ${art.name}`],
      });
    }
  } else if (army.stance === "besiege" && work.cities[army.targetCity]) {
    const c = work.cities[army.targetCity];
    const dmg = clamp(Math.round(c.troops * art.dmgPct), 50, Math.max(50, c.troops - 60));
    c.troops = Math.max(0, c.troops - dmg);
    dmgTotal = dmg;
    if (art.wallDmg) c.wall = Math.max(0, c.wall - art.wallDmg);
    if (art.foodBurn) c.foodReserve = Math.max(0, c.foodReserve - art.foodBurn);
    if (art.moraleDrop) c.morale = clamp(c.morale - Math.round(art.moraleDrop * 0.8), 8, 100);
    if (art.convertRatio) army.troops += Math.round(dmg * art.convertRatio);
    detailMsg = `${offName}于「${cityNameV2(world, army.targetCity)}」城下发动「${art.icon} ${art.name}」，折敌守军 ${dmg.toLocaleString()} 人！`;
  } else {
    army.grain = Math.min(20, army.grain + 4);
    army.morale = clamp(army.morale + 14, 20, 100);
    detailMsg = `${offName}全军号令齐发「${art.icon} ${art.name}」，士气大振（${army.morale}/100）并整肃军粮！`;
  }

  const ev = {
    turn: work.turn,
    kind: "battle_art",
    faction: army.faction,
    pos: armyWorldPosition(world, army),
    artId: art.id,
    artName: art.name,
    callout: `${offName}·${art.name}!`,
    dmg: dmgTotal,
    text: `${art.icon} ${detailMsg}`,
  };
  if (Array.isArray(events)) events.push(ev);
  if (manual) {
    work.events = [...(work.events || []), ev].slice(-80);
    work.lastTurnEvents = [ev];
    return work;
  }
  return { artName: art.name, icon: art.icon, offName, dmg: dmgTotal };
}

// ===== 在野名士出世与寻访登庸 =====

export const WANDERING_HEROES_V3 = [
  { id: "wh_xushu", name: "徐庶", appearYear: 194, city: "xinye", command: 84, might: 68, governance: 80, traits: ["logistics"], bio: "颖川俊杰，擅军谋奇策与机变调度" },
  { id: "wh_lusu", name: "鲁肃", appearYear: 194, city: "lujiang", command: 82, might: 56, governance: 90, traits: ["navy", "farming"], bio: "榻上策定江东，深明联刘抗曹与兵粮调度" },
  { id: "wh_huangzhong", name: "黄忠", appearYear: 195, city: "linxiang", command: 85, might: 92, governance: 60, traits: ["archer"], bio: "百步穿杨老将，弓弩绝伦兼能陷阵" },
  { id: "wh_zhoutai", name: "周泰", appearYear: 196, city: "shanyin", command: 80, might: 89, governance: 55, traits: ["navy"], bio: "水战死士，满身创痕力护主公不退" },
  { id: "wh_lvmeng", name: "吕蒙", appearYear: 198, city: "chaisang", command: 90, might: 83, governance: 82, traits: ["navy", "ambush"], bio: "士别三日刮目相看，白衣渡江夺荆襄" },
  { id: "wh_zhugeliang", name: "诸葛亮", appearYear: 200, city: "xiangyang", command: 96, might: 48, governance: 98, traits: ["logistics", "fire", "farming"], bio: "卧龙出隆中，八阵兵法与治国内政皆臻化境" },
  { id: "wh_pangtong", name: "庞统", appearYear: 201, city: "jiangling", command: 91, might: 44, governance: 84, traits: ["fire"], bio: "凤雏先生，精于连环火攻与奇袭入蜀之策" },
  { id: "wh_weiyan", name: "魏延", appearYear: 202, city: "runan", command: 87, might: 89, governance: 66, traits: ["cavalry"], bio: "胆略过人，子午谷奇谋悍将" },
  { id: "wh_fazheng", name: "法正", appearYear: 203, city: "changan", command: 88, might: 54, governance: 82, traits: ["ambush"], bio: "奇谋百出，定军山斩夏侯之首功臣" },
  { id: "wh_simayi", name: "司马懿", appearYear: 205, city: "luoyang", command: 95, might: 63, governance: 94, traits: ["fortress", "logistics"], bio: "鹰视狼顾，善持重守垒兼神速千里奇袭" },
  { id: "wh_luxun", name: "陆逊", appearYear: 207, city: "wu", command: 93, might: 64, governance: 89, traits: ["fire", "navy"], bio: "社稷儒将，夷陵火烧连营七百里一战定鼎" },
  { id: "wh_caozhang", name: "曹彰", appearYear: 209, city: "ye", command: 84, might: 91, governance: 58, traits: ["cavalry"], bio: "黄须儿勇冠北地，善领轻骑破鲜卑" },
  { id: "wh_madai", name: "马岱", appearYear: 210, city: "guzang", command: 80, might: 85, governance: 62, traits: ["cavalry"], bio: "西凉良将，铁骑驰突稳重干练" },
  { id: "wh_guohuai", name: "郭淮", appearYear: 214, city: "tianshui", command: 85, might: 76, governance: 79, traits: ["fortress"], bio: "雍凉铁壁名将，屡拒蜀军北伐" },
  { id: "wh_jiangwei", name: "姜维", appearYear: 222, city: "tianshui", command: 90, might: 87, governance: 78, traits: ["cavalry", "logistics"], bio: "幼麒承继武侯遗志，文武全才" },
  { id: "wh_dengai", name: "邓艾", appearYear: 226, city: "chenliu", command: 91, might: 80, governance: 88, traits: ["farming", "cavalry"], bio: "屯田兴农兼能偷渡阴平，奇正皆精" },
  { id: "wh_zhonghui", name: "钟会", appearYear: 235, city: "xu", command: 86, might: 60, governance: 87, traits: ["siege"], bio: "才藻机敏，统筹关中粮械统兵灭蜀" },
  { id: "wh_yanghu", name: "羊祜", appearYear: 242, city: "xiangyang", command: 89, might: 72, governance: 91, traits: ["charisma", "fortress"], bio: "轻裘缓带威加江汉，怀柔破吴之先声" },
  { id: "wh_duyu", name: "杜预", appearYear: 248, city: "luoyang", command: 90, might: 66, governance: 92, traits: ["navy", "siege"], bio: "杜武库破竹之势顺江下建业" },
  { id: "wh_wenyang", name: "文鸯", appearYear: 254, city: "shouchun", command: 83, might: 94, governance: 52, traits: ["cavalry"], bio: "七进七出勇震大军，魏晋末年第一猛将" },
];

export function spawnWanderingHeroes(world, state, events = []) {
  if (!state?.cities) return;
  const triggered = (state.triggeredWanderingIds ??= []);
  const wandering = (state.wanderingOfficers ??= []);
  const existingNames = new Set(Object.values(state.officers || {}).map((o) => o.name));
  const curYear = state.year + Math.floor((state.turn || 0) / 36);

  for (const h of WANDERING_HEROES_V3) {
    if (wandering.length >= 8) break;
    if (h.appearYear > curYear) continue;
    if (triggered.includes(h.id) || existingNames.has(h.name)) continue;
    if (!state.cities[h.city]) continue;

    triggered.push(h.id);
    wandering.push({ ...h, foundTurn: state.turn || 0 });
    existingNames.add(h.name);
    if (Array.isArray(events) && (state.turn || 0) > 0) {
      events.push({
        turn: state.turn,
        kind: "officer",
        city: h.city,
        pos: cityByKey(world, h.city)?.position,
        text: `📜 天下贤才现身！名士「${h.name}」（统${h.command}/武${h.might}/政${h.governance}）近现踪于「${cityNameV2(world, h.city)}」一带，可遣使礼聘登庸！`,
      });
    }
  }
}

export function recruitWanderingOfficer(world, state, heroId) {
  const next = structuredClone(state);
  const idx = (next.wanderingOfficers || []).findIndex((w) => w.id === heroId);
  if (idx < 0) throw new Error("该名士已出仕或另投明主。");
  const hero = next.wanderingOfficers[idx];
  const player = next.player;
  const cityMeta = cityByKey(world, hero.city);
  const ownExact = next.cities[hero.city]?.owner === player && !next.sieges?.[hero.city];
  const adjOwnKey = (cityMeta?.links || []).find((nb) => next.cities[nb]?.owner === player && !next.sieges?.[nb]);
  if (!ownExact && !adjOwnKey) {
    throw new Error(`须掌控「${cityNameV2(world, hero.city)}」或其未遭围困之邻城方可遣使礼聘。`);
  }
  const cost = 24;
  if ((next.factions[player]?.treasury ?? 0) < cost) {
    throw new Error(`礼贤下士备礼需国库 ${cost} 钱。`);
  }

  next.factions[player].treasury -= cost;
  const destCity = ownExact ? hero.city : adjOwnKey;
  const key = `v3-${hero.id}-${(next.nextArmySeq || 1) + hashStr(hero.name) % 997}`;
  next.officers[key] = {
    key,
    faction: player,
    name: hero.name,
    governance: hero.governance,
    command: hero.command,
    might: hero.might,
    intellect: Math.max(hero.governance, 72),
    traits: [...(hero.traits || [])],
    title: "礼聘贤才",
    seal: hero.name[0],
    city: destCity,
    armyId: null,
    transferringTo: null,
    loyalty: 88,
    merit: 0,
    wins: 0,
    defenses: 0,
    captures: 0,
    awakenedTitle: null,
    injuredDekads: 0,
    capturedBy: null,
  };
  next.wanderingOfficers.splice(idx, 1);

  const ev = {
    turn: next.turn,
    kind: "officer",
    faction: player,
    city: destCity,
    pos: cityByKey(world, destCity)?.position,
    text: `🤝 礼贤下士！名士「${hero.name}」欣然出山效力，已赴「${cityNameV2(world, destCity)}」听用！`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

// ===== 将领无兵快速驿传调防 =====

export function transferOfficer(world, state, officerKey, toCityKey) {
  const next = structuredClone(state);
  const off = next.officers[officerKey];
  if (!off || off.faction !== next.player || off.capturedBy) {
    throw new Error("未找到可调遣的己方将领。");
  }
  if (off.armyId) throw new Error("该将正在外领军作战，不可直接驿传调防。");
  if (off.transferringTo) throw new Error("该将已在调防奔赴途中。");
  if ((off.injuredDekads || 0) > 0) throw new Error("该将尚在养伤期内。");
  const dest = next.cities[toCityKey];
  if (!dest || dest.owner !== next.player) throw new Error("只可调防前往己方掌控之城池。");
  if (off.city === toCityKey) throw new Error("该将已驻守于所选城池。");

  const fromCityKey = off.city;
  if (fromCityKey && next.cities[fromCityKey]) {
    if (next.cities[fromCityKey].governor === officerKey) next.cities[fromCityKey].governor = null;
    if (next.cities[fromCityKey].commander === officerKey) next.cities[fromCityKey].commander = null;
  }

  const route = fromCityKey ? findRoadPath(world, next, next.player, fromCityKey, toCityKey, { allowEnemyEnd: false }) : null;
  const eta = route ? clamp(Math.ceil((route.length - 1) / 2), 1, 2) : 2;
  off.city = null;
  off.transferringTo = toCityKey;
  (next.officerTransfers ??= []).push({
    officerKey,
    fromCity: fromCityKey || toCityKey,
    toCity: toCityKey,
    etaDekads: eta,
  });

  const ev = {
    turn: next.turn,
    kind: "order",
    faction: next.player,
    text: `🐎 驿传急召：「${off.name}」奉命轻骑改驻「${cityNameV2(world, toCityKey)}」（${eta} 旬抵达）。`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function tickOfficerTransfers(world, state, events = []) {
  const list = state.officerTransfers || [];
  if (!list.length) return;
  const remaining = [];
  for (const tr of list) {
    const off = state.officers[tr.officerKey];
    if (!off || off.capturedBy || off.armyId) continue;
    tr.etaDekads -= 1;
    if (tr.etaDekads <= 0) {
      off.transferringTo = null;
      returnOfficerHome(state, tr.officerKey, tr.toCity);
      if (off.faction === state.player && off.city) {
        events.push({
          turn: state.turn,
          kind: "officer",
          city: off.city,
          pos: cityByKey(world, off.city)?.position,
          text: `📍 调防报到：「${off.name}」已安抵「${cityNameV2(world, off.city)}」。`,
        });
      }
    } else {
      remaining.push(tr);
    }
  }
  state.officerTransfers = remaining;
}
