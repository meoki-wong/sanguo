// v23.0 — 12 大顶级名将「宿命任务」与史诗觉醒
// 状态挂在 state.saga.awakenedHeroes 下，兼容旧存档与非 century 模式。

export const HERO_DESTINIES = [
  {
    id: "destiny_cao",
    heroName: "曹操",
    title: "魏武挥鞭",
    awakenTitle: "魏武帝 · 治世能臣",
    goalText: "占据许昌或洛阳，且本势力辖城 ≥ 8 城",
    check: (state) => {
      const p = state.player;
      const owned = Object.values(state.cities || {}).filter((c) => c.owner === p).length;
      return owned >= 8 && (state.cities?.xu?.owner === p || state.cities?.luoyang?.owner === p);
    },
  },
  {
    id: "destiny_liu",
    heroName: "刘备",
    title: "弘毅宽厚",
    awakenTitle: "汉昭烈 · 仁德之主",
    goalText: "海内声望 ≥ 70 或占据成都 / 襄阳",
    check: (state) => (state.saga?.reputation ?? 50) >= 70 || state.cities?.chengdu?.owner === state.player || state.cities?.xiangyang?.owner === state.player,
  },
  {
    id: "destiny_sun",
    heroName: "孙权",
    title: "坐断东南",
    awakenTitle: "吴大帝 · 江东雄主",
    goalText: "占据建业（秣陵）与柴桑",
    check: (state) => state.cities?.moling?.owner === state.player && state.cities?.chaisang?.owner === state.player,
  },
  {
    id: "destiny_zhuge",
    heroName: "诸葛亮",
    title: "隆中定策",
    awakenTitle: "卧龙武侯 · 经天纬地",
    goalText: "占据汉中或长安，或兵技点 ≥ 150 TP",
    check: (state) => state.cities?.hanzhong?.owner === state.player || state.cities?.changan?.owner === state.player || (state.saga?.tech?.points ?? 0) >= 150,
  },
  {
    id: "destiny_guanyu",
    heroName: "关羽",
    title: "威震华夏",
    awakenTitle: "武圣关公 · 义薄云天",
    goalText: "占据襄阳/江陵，或本局阵前单挑胜 ≥ 1 次",
    check: (state) => state.cities?.xiangyang?.owner === state.player || state.cities?.jiangling?.owner === state.player || (state.saga?.duelWins ?? 0) >= 1,
  },
  {
    id: "destiny_zhangfei",
    heroName: "张飞",
    title: "当阳喝断",
    awakenTitle: "万人敌 · 燕人翼德",
    goalText: "全军总兵力 ≥ 15,000 或单挑胜 ≥ 1 次",
    check: (state) => {
      const troops = Object.values(state.cities || {}).filter((c) => c.owner === state.player).reduce((s, c) => s + (c.troops ?? 0), 0);
      return troops >= 15000 || (state.saga?.duelWins ?? 0) >= 1;
    },
  },
  {
    id: "destiny_zhaoyun",
    heroName: "赵云",
    title: "一身是胆",
    awakenTitle: "常胜将军 · 顺平侯",
    goalText: "国库储粮 ≥ 180 且全军士气 ≥ 80",
    check: (state) => (state.factions?.[state.player]?.grain ?? 0) >= 180 && (state.factions?.[state.player]?.morale ?? 75) >= 80,
  },
  {
    id: "destiny_zhouyu",
    heroName: "周瑜",
    title: "谈笑樯橹",
    awakenTitle: "美周郎 · 大都督",
    goalText: "占据柴桑或江陵，或组建长江水师舰队",
    check: (state) => state.cities?.chaisang?.owner === state.player || state.cities?.jiangling?.owner === state.player || Object.keys(state.saga?.navy?.fleets || {}).length >= 1,
  },
  {
    id: "destiny_lvbu",
    heroName: "吕布",
    title: "天下无双",
    awakenTitle: "无双鬼神 · 虓虎飞将",
    goalText: "占据濮阳或下邳，或全军攻城辖城 ≥ 4 城",
    check: (state) => {
      const owned = Object.values(state.cities || {}).filter((c) => c.owner === state.player).length;
      return owned >= 4 || state.cities?.puyang?.owner === state.player || state.cities?.xiapi?.owner === state.player;
    },
  },
  {
    id: "destiny_sima",
    heroName: "司马懿",
    title: "冢虎隐忍",
    awakenTitle: "宣王冢虎 · 鹰视狼顾",
    goalText: "国库 ≥ 180 或占据长安/洛阳",
    check: (state) => (state.factions?.[state.player]?.treasury ?? 0) >= 180 || state.cities?.changan?.owner === state.player || state.cities?.luoyang?.owner === state.player,
  },
  {
    id: "destiny_zhangliao",
    heroName: "张辽",
    title: "威震逍遥津",
    awakenTitle: "止啼名将 · 前将军",
    goalText: "占据寿春/合肥，或辖城 ≥ 8 城",
    check: (state) => {
      const owned = Object.values(state.cities || {}).filter((c) => c.owner === state.player).length;
      return owned >= 8 || state.cities?.shouchun?.owner === state.player || state.cities?.hefei?.owner === state.player;
    },
  },
  {
    id: "destiny_luxun",
    heroName: "陆逊",
    title: "火烧连营",
    awakenTitle: "江东社稷臣 · 儒将之宗",
    goalText: "占据建业/吴，或已研习兵技 ≥ 2 项",
    check: (state) => state.cities?.moling?.owner === state.player || state.cities?.wu?.owner === state.player || (state.saga?.tech?.unlocked?.length ?? 0) >= 2,
  },
];

export function evaluateDestinies(era, state) {
  if (!state?.century) return [];
  const player = state.player;
  const myOfficers = [
    ...(era?.officers || []).filter((o) => o.faction === player),
    ...(state.recruitedOfficers || []).filter((o) => o.faction === player),
  ];
  const myNames = new Set(myOfficers.map((o) => o.name));
  const facEntry = Array.isArray(era?.factions) ? era.factions.find((f) => f.key === player) : era?.factions?.[player];
  if (facEntry?.name) {
    for (const part of String(facEntry.name).split("·")) myNames.add(part.trim());
  }
  const awakened = new Set(Array.isArray(state.saga?.awakenedHeroes) ? state.saga.awakenedHeroes : []);

  return HERO_DESTINIES
    .filter((d) => myNames.has(d.heroName))
    .map((d) => {
      const isAwakened = awakened.has(d.heroName);
      const ready = isAwakened || d.check(state);
      return {
        ...d,
        awakened: isAwakened,
        ready,
        canAwaken: ready && !isAwakened,
      };
    });
}

export function awakenHeroDestiny(era, state, destinyId) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可触发名将史诗觉醒。" };
  const list = evaluateDestinies(era, state);
  const item = list.find((d) => d.id === destinyId);
  if (!item) return { ok: false, reason: "该名将当前未在我军麾下。" };
  if (item.awakened) return { ok: false, reason: `${item.heroName}已完成史诗觉醒。` };
  if (!item.ready) return { ok: false, reason: `尚未达成宿命目标：${item.goalText}` };

  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  if (!Array.isArray(next.saga.awakenedHeroes)) next.saga.awakenedHeroes = [];
  next.saga.awakenedHeroes.push(item.heroName);
  next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + 5);
  if (next.factions?.[next.player]) {
    next.factions[next.player].morale = Math.min(100, (next.factions[next.player].morale ?? 75) + 6);
  }

  return {
    ok: true,
    state: next,
    summary: `【名将史诗觉醒】${item.heroName}达成「${item.title}」，晋封「${item.awakenTitle}」！领兵出征攻势 +14%、战损 -12%，全军士气 +6！`,
  };
}

/**
 * 史诗觉醒名将战斗修正（接入 engine.js forecastAttack）
 */
export function destinyCombatModifiers(state, officerObj) {
  if (!state?.century) return { attackMult: 1, lossMult: 1, label: "" };
  const awakened = Array.isArray(state.saga?.awakenedHeroes) ? state.saga.awakenedHeroes : [];
  if (!awakened.length) return { attackMult: 1, lossMult: 1, label: "" };
  if (officerObj?.name && awakened.includes(officerObj.name)) {
    const def = HERO_DESTINIES.find((d) => d.heroName === officerObj.name);
    return {
      attackMult: 1.14,
      lossMult: 0.88,
      label: `觉醒·${def?.awakenTitle || officerObj.name}`,
    };
  }
  // 若阵营已有主公或名将完成史诗觉醒，己方全军亦享 +6% 觉醒光环
  if (officerObj?.faction === state.player) {
    return { attackMult: 1.06, lossMult: 0.96, label: "史诗觉醒光环" };
  }
  return { attackMult: 1, lossMult: 1, label: "" };
}
