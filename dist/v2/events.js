// 经略三国 3.0 — 历史大事件分支抉择 / 汉帝奉迎 / 传国玉玺系统

import {
  activeTreaty, cityByKey, cityNameV2, clamp, factionNameV2, isHostileV2,
} from "./constants.js";

export const EMPEROR_EDICTS_V3 = {
  edict_truce: {
    id: "edict_truce",
    name: "奉诏敕和",
    icon: "🕊️",
    cost: 28,
    requiresTarget: true,
    summary: "挟天子圣旨强令指定诸侯与我方停战 12 旬（无视对方谈判意愿）。",
  },
  edict_crusade: {
    id: "edict_crusade",
    name: "矫诏讨逆",
    icon: "⚔️",
    cost: 32,
    requiresTarget: true,
    summary: "宣诏指斥敌方为国贼：削弱其全军民心 -10 与诸将忠义 -6，若曾有旧约亦可无损废除。",
  },
  edict_levy: {
    id: "edict_levy",
    name: "天子募义",
    icon: "🚩",
    cost: 24,
    requiresTarget: false,
    summary: "号召天下忠义义士响应勤王：汉帝所在都城与首都各募精锐 +600、士气 +10。",
  },
};

export function initialSealFaction(state, year = 199) {
  const y = Number(year) || 199;
  if (y <= 191 && state.factions?.dong) return "dong";
  if (y <= 200 && state.factions?.ce) return "ce";
  if (y <= 219 && state.factions?.wu) return "wu";
  if (state.emperorCity && state.cities?.[state.emperorCity]) {
    return state.cities[state.emperorCity].owner;
  }
  return Object.keys(state.factions || {})[0] || null;
}

function ownedCount(state, faction) {
  return Object.values(state.cities).filter((c) => c.owner === faction).length;
}

function firstHostileFaction(state) {
  const counts = {};
  for (const c of Object.values(state.cities)) {
    if (c.owner !== state.player && isHostileV2(state, state.player, c.owner)) {
      counts[c.owner] = (counts[c.owner] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function topPlayerCity(state) {
  return Object.values(state.cities).filter((c) => c.owner === state.player).sort((a, b) => b.troops - a.troops)[0] || null;
}

export const HISTORICAL_EVENTS_V3 = [
  {
    id: "coalition_dongzhuo",
    title: "诸侯讨董 · 虎牢会盟",
    icon: "🚩",
    eraMin: 189,
    eraMax: 193,
    condition: (_w, s) => Boolean(s.factions?.dong && ownedCount(s, "dong") > 0),
    text: (_w, s) => s.player === "dong"
      ? "关东十八路诸侯联军陈兵函谷，天下物议沸腾。是死守洛阳天险迎战，还是迁都关中焚洛阳以避锐气？"
      : "董卓乱政擅废立，天下诸侯共传矫诏讨贼！此刻顺应忠义号召高举义旗，必获海内响应。",
    choices: [
      {
        label: "整备义军直指强敌",
        hint: "全军士气 +10，首都增兵 650，与主要强敌进入厉兵秣马态势",
        apply: (_w, s) => {
          const pc = topPlayerCity(s);
          if (pc) {
            pc.troops += 650;
            pc.morale = clamp(pc.morale + 10, 40, 100);
          }
          s.factions[s.player].morale = clamp(s.factions[s.player].morale + 10, 20, 100);
          return "高举大义旗帜，三军士气暴涨并募得义从 650 人！";
        },
      },
      {
        label: "深挖广积厚植粮饷",
        hint: "国库 +45 钱，军粮 +70 石，首都城防 +90",
        apply: (_w, s) => {
          s.factions[s.player].treasury += 45;
          s.factions[s.player].grain += 70;
          const pc = topPlayerCity(s);
          if (pc) pc.wall = Math.min(pc.wallMax + 90, pc.wall + 90);
          return "先筹钱粮稳固根本，国库进账 45 钱、军粮增储 70 石。";
        },
      },
    ],
  },
  {
    id: "emperor_welcome",
    title: "汉室东归 · 奉迎天子",
    icon: "👑",
    eraMin: 194,
    eraMax: 215,
    condition: (_w, s) => Boolean(s.emperorCity && s.cities[s.emperorCity]?.owner !== s.player),
    text: (w, s) => `献帝车驾辗转播迁，眼下尚驻于「${cityNameV2(w, s.emperorCity)}」。荀彧进言：「奉天子以令不臣，天下大义在兹一举！」`,
    choices: [
      {
        label: "尊奉汉室礼送重贡 (-35钱)",
        hint: "若能夺取天子所在之城可名正言顺号令群雄；先行获取全军将领忠义 +5 与民心 +6",
        apply: (_w, s) => {
          if (s.factions[s.player].treasury >= 35) s.factions[s.player].treasury -= 35;
          s.factions[s.player].morale = clamp(s.factions[s.player].morale + 6, 20, 100);
          for (const o of Object.values(s.officers)) {
            if (o.faction === s.player) o.loyalty = clamp(o.loyalty + 5, 0, 100);
          }
          return "遣使朝觐汉室，海内士林归心，麾下忠义齐升！";
        },
      },
      {
        label: "厉兵秣马准备直取帝都",
        hint: "最接近前线城池募兵 +500、国库充盈 +30 钱备战",
        apply: (_w, s) => {
          s.factions[s.player].treasury += 30;
          const pc = topPlayerCity(s);
          if (pc) pc.troops += 500;
          return "厚积甲兵直指中原枢要，前线增兵 500 人。";
        },
      },
    ],
  },
  {
    id: "guandu_wuchao",
    title: "官渡决战 · 乌巢劫粮",
    icon: "🔥",
    eraMin: 198,
    eraMax: 204,
    condition: (_w, s) => Boolean(s.factions?.cao && s.factions?.yuan && ownedCount(s, "yuan") > 0 && ownedCount(s, "cao") > 0),
    text: () => "袁曹官渡对峙日久！探马报敌将淳于琼重兵囤粮于乌巢。此战系北方霸权一战而决，主公作何定夺？",
    choices: [
      {
        label: "亲率死士星夜火焚乌巢 (-20钱)",
        hint: "大创敌国军粮 -120 石、削弱敌方主力士气 -14，己方兵精粮足",
        apply: (_w, s) => {
          const enemyKey = s.player === "yuan" ? "cao" : "yuan";
          if (s.factions[s.player].treasury >= 20) s.factions[s.player].treasury -= 20;
          s.factions[enemyKey].grain = Math.max(0, s.factions[enemyKey].grain - 120);
          s.factions[enemyKey].morale = clamp(s.factions[enemyKey].morale - 14, 20, 100);
          for (const a of s.armies) {
            if (a.faction === enemyKey) {
              a.grain = 0;
              a.supplyCut = true;
              a.morale = clamp(a.morale - 16, 15, 100);
            }
          }
          return `雪夜火光冲天！${s.factions[enemyKey].name}粮草辎重灰飞烟灭，外野大军断粮哗变！`;
        },
      },
      {
        label: "稳筑高垒以待其疲",
        hint: "各城池城防 +80、前线驻军余粮恢复满值，国库 +25 钱",
        apply: (_w, s) => {
          s.factions[s.player].treasury += 25;
          for (const c of Object.values(s.cities)) {
            if (c.owner === s.player) {
              c.wall = Math.min(c.wallMax + 60, c.wall + 80);
              c.foodReserve = 100;
            }
          }
          return "全线深沟高垒固若金汤，各城墙防与余粮齐充。";
        },
      },
    ],
  },
  {
    id: "three_visits",
    title: "三顾茅庐 · 隆中定策",
    icon: "📜",
    eraMin: 204,
    eraMax: 212,
    condition: (_w, s) => Boolean(s.cities.xiangyang && s.cities.jiangling && (s.cities.xiangyang.owner === s.player || s.cities.xinye?.owner === s.player || s.player === "liu")),
    text: () => "水镜先生力荐襄阳南阳卧龙岗高士：「伏龙凤雏，得一可安天下！」是否倾诚礼遇，迎请辅政？",
    choices: [
      {
        label: "虔诚折节延揽俊才 (-25钱)",
        hint: "全军武将忠义 +6，我方获得军粮 +65 与月度治政威望加成",
        apply: (_w, s) => {
          if (s.factions[s.player].treasury >= 25) s.factions[s.player].treasury -= 25;
          s.factions[s.player].grain += 65;
          s.factions[s.player].morale = clamp(s.factions[s.player].morale + 8, 20, 100);
          for (const o of Object.values(s.officers)) {
            if (o.faction === s.player) {
              o.loyalty = clamp(o.loyalty + 6, 0, 100);
              o.merit += 15;
            }
          }
          return "名士归心献策三分天下大略，全军士气与将领忠义齐升！";
        },
      },
      {
        label: "广招乡勇先充前营",
        hint: "首都立即募兵 +750 人",
        apply: (_w, s) => {
          const pc = topPlayerCity(s);
          if (pc) pc.troops += 750;
          return "大募荆楚精锐 750 人充实战阵。";
        },
      },
    ],
  },
  {
    id: "red_cliffs_fire",
    title: "赤壁之战 · 借东风起",
    icon: "⛵",
    eraMin: 207,
    eraMax: 214,
    condition: (_w, s) => Boolean(s.cities.chaisang && s.cities.jiangxia),
    text: () => "大江南北舟楫如林，偏逢东南风大作！若乘此天时倾水师顺风施放连环火船，必令北军楼船惨烈受创。",
    choices: [
      {
        label: "东南顺风 · 火船焚江",
        hint: "天时转为「秋高顺风(火+20%)」，若江渡有敌军立即折损兵马 25%",
        apply: (w, s) => {
          s.weather = { key: "wind", name: "秋高顺风", icon: "💨", marchMult: 1.05, archerMult: 1.05, fireMult: 1.24, riverMult: 1.15, landRiverMult: 0.9, grainMult: 0.96, summary: "东南顺风怒号，火攻水师战力激增。" };
          let burnt = 0;
          for (const a of s.armies) {
            if (isHostileV2(s, s.player, a.faction) && a.troops > 200) {
              const dmg = Math.round(a.troops * 0.25);
              a.troops -= dmg;
              a.morale = clamp(a.morale - 18, 10, 100);
              burnt += dmg;
            }
          }
          return burnt > 0
            ? `赤壁烈焰映红大江！顺风焚毁在野敌军共 ${burnt.toLocaleString()} 人！`
            : "天时转为「秋高顺风」，大江之上火攻与水师威力飙升！";
        },
      },
      {
        label: "水寨增筑楼船备战",
        hint: "首都重配「水师」且兵力 +550、国库 +30 钱",
        apply: (_w, s) => {
          s.factions[s.player].treasury += 30;
          const pc = topPlayerCity(s);
          if (pc) {
            pc.troopType = "navy";
            pc.troops += 550;
          }
          return "水师整编就绪，艨艟战舰新增 550 精锐！";
        },
      },
    ],
  },
  {
    id: "imperial_seal_rumor",
    title: "和氏传国玉玺 · 威震九州",
    icon: "💎",
    eraMin: 189,
    eraMax: 280,
    condition: (_w, s) => s.sealFaction !== s.player && ownedCount(s, s.player) >= 8,
    text: (_w, s) => `传闻汉室「传国玉玺」流落民间消息再现，${s.sealFaction && s.factions[s.sealFaction] ? `现藏于${s.factions[s.sealFaction].name}之手` : "亟待有德者奉迎"}。是否遣死士暗夺玉玺，还是以德服众暂缓显露锋芒？`,
    choices: [
      {
        label: "重赏奇士奉迎传国玉玺 (-50钱)",
        hint: "传国玉玺归属我方（全将忠义 +8、全国民心 +10），唯恐引强敌警惕",
        apply: (_w, s) => {
          if (s.factions[s.player].treasury < 50) throw new Error("需国库 50 钱方能暗中购回/奇取传国玉玺。");
          s.factions[s.player].treasury -= 50;
          s.sealFaction = s.player;
          s.factions[s.player].morale = clamp(s.factions[s.player].morale + 10, 20, 100);
          for (const o of Object.values(s.officers)) {
            if (o.faction === s.player) o.loyalty = clamp(o.loyalty + 8, 0, 100);
          }
          return "「受命于天，既寿永昌」— 传国玉玺终归我主，举国上下士气忠义暴涨！";
        },
      },
      {
        label: "韬光养晦专务内政",
        hint: "规避强敌锋芒，国库 +40 钱、军粮 +50 石",
        apply: (_w, s) => {
          s.factions[s.player].treasury += 40;
          s.factions[s.player].grain += 50;
          return "隐而不发厚积国力，获银 40 钱、军粮 50 石。";
        },
      },
    ],
  },
  {
    id: "drought_locusts",
    title: "关中蝗旱 · 开仓赈灾",
    icon: "🌾",
    eraMin: 189,
    eraMax: 280,
    repeatableCooldown: 18,
    condition: (_w, s) => (s.turn || 0) >= 6,
    text: () => "岁逢久旱兼生蝗蝻，数郡流民起于野。若开官仓赈济可安万民军心；若强行督税充军恐生内患。",
    choices: [
      {
        label: "开仓放粮赈抚流民 (-45石粮)",
        hint: "全国民心 +10，各城守军士气 +6，募入青壮 +300",
        apply: (_w, s) => {
          s.factions[s.player].grain = Math.max(0, s.factions[s.player].grain - 45);
          s.factions[s.player].morale = clamp(s.factions[s.player].morale + 10, 20, 100);
          const pc = topPlayerCity(s);
          if (pc) pc.troops += 300;
          for (const c of Object.values(s.cities)) {
            if (c.owner === s.player) c.morale = clamp(c.morale + 6, 30, 100);
          }
          return "仁政赈民化危为安，流民感德投效军伍 +300！";
        },
      },
      {
        label: "严令督缴军赋先济前线",
        hint: "国库 +55 钱，但全国民心 -6",
        apply: (_w, s) => {
          s.factions[s.player].treasury += 55;
          s.factions[s.player].morale = clamp(s.factions[s.player].morale - 6, 20, 100);
          return "强征租赋得银 55 钱充军，唯民间微有怨声。";
        },
      },
    ],
  },
  {
    id: "merchant_convoy",
    title: "豪商献饷 · 军械特购",
    icon: "💰",
    eraMin: 189,
    eraMax: 280,
    repeatableCooldown: 15,
    condition: (_w, s) => (s.turn || 0) >= 3,
    text: () => "江南与朔北豪商感慕我朝商道安宁，愿倾私财助军。正值战事吃紧，主公意下如何筹措？",
    choices: [
      {
        label: "购置霹雳冲车充前线 (-22钱)",
        hint: "国库略支即刻添配高战力「攻城械」兵员 +450 与随军军粮 +50",
        apply: (_w, s) => {
          if (s.factions[s.player].treasury >= 22) s.factions[s.player].treasury -= 22;
          s.factions[s.player].grain += 50;
          const pc = topPlayerCity(s);
          if (pc) {
            pc.troopType = "siege";
            pc.troops += 450;
          }
          return "豪商运抵良木铁石，前线添置攻城重械 450 人份及军粮 50 石！";
        },
      },
      {
        label: "通商免关优待商队",
        hint: "国库增收 +50 钱，城内余粮小幅增加",
        apply: (_w, s) => {
          s.factions[s.player].treasury += 50;
          return "商旅络绎输税，国库进账 50 钱！";
        },
      },
    ],
  },
  {
    id: "border_truce_envoy",
    title: "邻邦秘使 · 纵横合议",
    icon: "📜",
    eraMin: 189,
    eraMax: 280,
    repeatableCooldown: 21,
    condition: (_w, s) => Boolean(firstHostileFaction(s)),
    text: (w, s) => {
      const fk = firstHostileFaction(s);
      return `「${factionNameV2(w, s, fk)}」密使夜入幕府，称若我方愿各退一步暂罢兵戈，可暂免腹背受敌之忧。`;
    },
    choices: [
      {
        label: "厚礼安抚暂缔停战 (-20钱)",
        hint: "立刻与该主要敌手停战 12 旬，专心经营他线战局",
        apply: (w, s) => {
          const fk = firstHostileFaction(s);
          if (!fk) return "敌邦已无寸土，无需和议。";
          if (s.factions[s.player].treasury >= 20) s.factions[s.player].treasury -= 20;
          s.treaties.push({ kind: "truce", sides: [s.player, fk].sort(), expires: s.turn + 12 });
          return `与「${factionNameV2(w, s, fk)}」达成密约停战 12 旬！`;
        },
      },
      {
        label: "斩使示威传檄全军",
        hint: "国力士气 +8，前线在野大军士气 +10",
        apply: (_w, s) => {
          s.factions[s.player].morale = clamp(s.factions[s.player].morale + 8, 20, 100);
          for (const a of s.armies) {
            if (a.faction === s.player) a.morale = clamp(a.morale + 10, 20, 100);
          }
          return "严词拒和誓扫六合，三军将士倍添破敌决意！";
        },
      },
    ],
  },
];

export function maybeTriggerEvent(world, state, events = []) {
  if (!state || state.pendingEvent || state.outcome !== "ongoing") return null;
  if ((state.turn || 0) < 3) return null;

  const triggered = (state.triggeredEvents ??= []);
  const cooldowns = (state.eventCooldowns ??= {});
  const curYear = state.year + Math.floor((state.turn || 0) / 36);

  for (const def of HISTORICAL_EVENTS_V3) {
    if (curYear < (def.eraMin || 180) || curYear > (def.eraMax || 290)) continue;
    if (def.repeatableCooldown) {
      if ((cooldowns[def.id] || 0) > state.turn) continue;
    } else if (triggered.includes(def.id)) {
      continue;
    }
    if (def.condition && !def.condition(world, state)) continue;

    if (def.repeatableCooldown) {
      cooldowns[def.id] = state.turn + def.repeatableCooldown;
    } else {
      triggered.push(def.id);
    }

    const bodyText = typeof def.text === "function" ? def.text(world, state) : def.text;
    state.pendingEvent = {
      id: def.id,
      title: def.title,
      icon: def.icon,
      turn: state.turn,
      text: bodyText,
      choices: def.choices.map((c) => ({ label: c.label, hint: c.hint })),
    };
    if (Array.isArray(events)) {
      events.push({
        turn: state.turn,
        kind: "dilemma",
        faction: state.player,
        text: `${def.icon} 朝野重大抉择：「${def.title}」，请主公定夺！`,
      });
    }
    return state.pendingEvent;
  }
  return null;
}

export function resolveEventChoice(world, state, choiceIndex = 0) {
  const next = structuredClone(state);
  const pending = next.pendingEvent;
  if (!pending) throw new Error("当前暂无待裁决的历史重大事件。");
  const def = HISTORICAL_EVENTS_V3.find((e) => e.id === pending.id);
  const choice = def?.choices?.[choiceIndex];
  if (!choice) throw new Error("无效的事件抉择项。");

  const outcomeTxt = choice.apply(world, next);
  next.pendingEvent = null;
  const ev = {
    turn: next.turn,
    kind: "system",
    faction: next.player,
    text: `${pending.icon} 「${pending.title}」定策：${outcomeTxt}`,
  };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}

export function issueImperialEdict(world, state, edictId, targetFaction = null) {
  const edict = EMPEROR_EDICTS_V3[edictId];
  if (!edict) throw new Error("未知天子诏令。");
  const next = structuredClone(state);
  const player = next.player;
  const holdsEmperor = Boolean(next.emperorCity && next.cities[next.emperorCity]?.owner === player);
  const holdsSeal = next.sealFaction === player;
  if (!holdsEmperor && !holdsSeal) {
    throw new Error("须先奉迎汉帝驻跸或掌控「传国玉玺」方可颁布天子诏书。");
  }
  if ((next.edictCooldown || 0) > 0) {
    throw new Error(`天子诏令尚在冷却中，请候 ${next.edictCooldown} 旬后再诏天下。`);
  }
  if ((next.factions[player]?.treasury ?? 0) < edict.cost) {
    throw new Error(`颁布「${edict.name}」需国库 ${edict.cost} 钱。`);
  }

  let msg = "";
  if (edictId === "edict_truce") {
    if (!targetFaction || !next.factions[targetFaction] || targetFaction === player) {
      throw new Error("请选择有效诏令目标势力。");
    }
    next.factions[player].treasury -= edict.cost;
    next.treaties = (next.treaties || []).filter((t) => !(t.sides.includes(player) && t.sides.includes(targetFaction)));
    next.treaties.push({ kind: "truce", sides: [player, targetFaction].sort(), expires: next.turn + 12 });
    msg = `🕊️ 奉天子明诏：「${factionNameV2(world, next, targetFaction)}」不敢违诏抗命，与我方停战休兵 12 旬！`;
  } else if (edictId === "edict_crusade") {
    if (!targetFaction || !next.factions[targetFaction] || targetFaction === player) {
      throw new Error("请选择要宣布讨逆的诸侯势力。");
    }
    next.factions[player].treasury -= edict.cost;
    next.treaties = (next.treaties || []).filter((t) => !(t.sides.includes(player) && t.sides.includes(targetFaction)));
    next.factions[targetFaction].morale = clamp(next.factions[targetFaction].morale - 10, 15, 100);
    for (const o of Object.values(next.officers)) {
      if (o.faction === targetFaction && !o.capturedBy) {
        o.loyalty = clamp(o.loyalty - 6, 0, 100);
      }
    }
    msg = `⚔️ 矫诏天下讨逆！指斥「${factionNameV2(world, next, targetFaction)}」为汉贼，其国内民心 -10、全将忠义 -6！`;
  } else if (edictId === "edict_levy") {
    next.factions[player].treasury -= edict.cost;
    const emp = next.emperorCity && next.cities[next.emperorCity]?.owner === player ? next.cities[next.emperorCity] : null;
    const bestOwn = topPlayerCity(next);
    const targets = [emp, bestOwn].filter((c, i, arr) => c && arr.indexOf(c) === i);
    for (const c of targets) {
      c.troops += 600;
      c.morale = clamp(c.morale + 10, 30, 100);
    }
    msg = `🚩 天子诏募天下勤王！${targets.map((c) => cityNameV2(world, c.key)).join("、")}各增精锐 600 人、士气大振！`;
  }

  next.edictCooldown = 9;
  const ev = { turn: next.turn, kind: "diplomacy", faction: player, text: msg };
  next.events = [...(next.events || []), ev].slice(-80);
  next.lastTurnEvents = [ev];
  return next;
}
