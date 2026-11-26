// v21.0 — 九州奇闻 & 隐士寻访（沙盘动态奇遇）
// 状态挂在 state.saga.adventures 下，兼容旧存档与非 century 模式。

export const ADVENTURE_TEMPLATES = [
  {
    id: "shuijing_sage",
    name: "水镜庄访贤",
    icon: "🎋",
    costTreasury: 25,
    summary: "水镜先生荐举奇才：获得兵技 +75 TP、海内声望 +4。",
    reward: { tp: 75, reputation: 4 },
  },
  {
    id: "huatuo_clinic",
    name: "名医华佗行医",
    icon: "🌿",
    costTreasury: 20,
    summary: "神医济世安军：全军士气 +10，所在城池伤兵康复增兵 +900。",
    reward: { morale: 10, troops: 900 },
  },
  {
    id: "ancient_scroll",
    name: "古兵书残卷",
    icon: "📜",
    costTreasury: 20,
    summary: "偶得《六韬》《孙子》批注残卷：兵技 +95 TP！",
    reward: { tp: 95 },
  },
  {
    id: "volunteer_militia",
    name: "忠义游侠投效",
    icon: "🗡️",
    costTreasury: 15,
    summary: "豪侠慕义来归：所在城池立刻增补精壮义军 +1,400 人！",
    reward: { troops: 1400, morale: 4 },
  },
  {
    id: "merchant_guild",
    name: "西域商贾献金",
    icon: "🪙",
    costTreasury: 10,
    summary: "胡商感念通商之恩：进献国库金 +90、军粮 +70。",
    reward: { treasury: 90, grain: 70 },
  },
  {
    id: "luban_blueprint",
    name: "巧匠献器械图",
    icon: "⚙️",
    costTreasury: 25,
    summary: "墨家巧匠献上连弩冲车图谱：城防 +4、兵技 +60 TP。",
    reward: { defense: 4, tp: 60 },
  },
  {
    id: "hermit_recruit",
    name: "草庐隐士出山",
    icon: "🏔️",
    costTreasury: 35,
    summary: "礼贤下士请出在野名士入幕，并提升声望 +5！",
    reward: { recruit: true, reputation: 5 },
  },
];

const HERMIT_NAMES = ["司马徽", "徐庶", "庞德公", "崔州平", "石广元", "孟公威", "管宁", "邴原"];

export function listActiveAdventures(state) {
  const list = state?.saga?.adventures;
  return Array.isArray(list) ? list : [];
}

/**
 * 为当前战局刷新 1–2 处活跃九州奇闻（保证开局和每季都有可探索奇遇）
 */
export function spawnAdventures(world, state) {
  if (!state?.century || !world) return state;
  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  const existing = Array.isArray(next.saga.adventures) ? next.saga.adventures : [];
  const turn = next.turn ?? 0;
  // 清理过期奇闻（保留 3 季内）
  const active = existing.filter((a) => (a.expires ?? 0) >= turn);
  const owned = Object.keys(next.cities || {}).filter((k) => next.cities[k].owner === next.player);
  if (!owned.length) {
    next.saga.adventures = active;
    return next;
  }

  while (active.length < 2) {
    const seed = Math.abs(turn * 7 + active.length * 13 + owned.length * 3);
    const tpl = ADVENTURE_TEMPLATES[seed % ADVENTURE_TEMPLATES.length];
    const cityKey = owned[(seed + active.length) % owned.length];
    const cityName = world.cities.find((c) => c.key === cityKey)?.name || cityKey;
    const id = `adv_${turn}_${active.length}_${tpl.id}`;
    if (active.some((a) => a.templateId === tpl.id)) {
      const alt = ADVENTURE_TEMPLATES[(seed + 1) % ADVENTURE_TEMPLATES.length];
      active.push({
        id: `adv_${turn}_${active.length}_${alt.id}`,
        templateId: alt.id,
        name: alt.name,
        icon: alt.icon,
        cityKey,
        cityName,
        costTreasury: alt.costTreasury,
        summary: alt.summary,
        expires: turn + 3,
      });
    } else {
      active.push({
        id,
        templateId: tpl.id,
        name: tpl.name,
        icon: tpl.icon,
        cityKey,
        cityName,
        costTreasury: tpl.costTreasury,
        summary: tpl.summary,
        expires: turn + 3,
      });
    }
  }
  next.saga.adventures = active.slice(0, 3);
  return next;
}

/**
 * 遣使寻访指定九州奇闻并领取奇遇奖励
 */
export function visitAdventure(world, state, adventureId) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可寻访九州奇闻。" };
  const list = listActiveAdventures(state);
  const adv = list.find((a) => a.id === adventureId);
  if (!adv) return { ok: false, reason: "该处奇闻已消散或已寻访完毕。" };

  const player = state.player;
  const fac = state.factions?.[player];
  if (!fac || fac.treasury < adv.costTreasury) {
    return { ok: false, reason: `遣使寻访「${adv.name}」需盘缠金 ${adv.costTreasury}。` };
  }
  const tpl = ADVENTURE_TEMPLATES.find((t) => t.id === adv.templateId);
  if (!tpl) return { ok: false, reason: "奇闻数据异常。" };

  const next = structuredClone(state);
  next.factions[player].treasury -= adv.costTreasury;
  next.saga.adventures = list.filter((a) => a.id !== adventureId);

  const r = tpl.reward || {};
  const notes = [];
  if (r.treasury) { next.factions[player].treasury += r.treasury; notes.push(`金+${r.treasury}`); }
  if (r.grain) { next.factions[player].grain += r.grain; notes.push(`粮+${r.grain}`); }
  if (r.morale) { next.factions[player].morale = Math.min(100, (next.factions[player].morale ?? 75) + r.morale); notes.push(`士气+${r.morale}`); }
  if (r.reputation && next.saga) { next.saga.reputation = Math.min(100, (next.saga.reputation ?? 50) + r.reputation); notes.push(`声望+${r.reputation}`); }
  if (r.tp && next.saga?.tech) { next.saga.tech.points = (next.saga.tech.points ?? 0) + r.tp; notes.push(`兵技+${r.tp}TP`); }

  const targetCity = next.cities?.[adv.cityKey]?.owner === player
    ? adv.cityKey
    : Object.keys(next.cities || {}).find((k) => next.cities[k].owner === player);
  if (targetCity) {
    if (r.troops) { next.cities[targetCity].troops = Math.min(42000, next.cities[targetCity].troops + r.troops); notes.push(`兵力+${r.troops}`); }
    if (r.defense) { next.cities[targetCity].defense = Math.min(48, (next.cities[targetCity].defense ?? 20) + r.defense); notes.push(`城防+${r.defense}`); }
  }

  if (r.recruit) {
    if (!Array.isArray(next.recruitedOfficers)) next.recruitedOfficers = [];
    const name = HERMIT_NAMES[(next.turn ?? 1 + next.recruitedOfficers.length) % HERMIT_NAMES.length];
    const key = `hermit_${next.turn ?? 1}_${next.recruitedOfficers.length}`;
    next.recruitedOfficers.push({
      key,
      name,
      faction: player,
      command: 82,
      war: 68,
      intel: 91,
      politics: 88,
      governance: 88,
      role: "advisor",
    });
    if (targetCity && next.stations) next.stations[key] = targetCity;
    notes.push(`延揽名士「${name}」（智91/政88）`);
  }

  return {
    ok: true,
    state: next,
    summary: `【九州奇闻 · ${adv.icon}${adv.name}】寻访${adv.cityName}大获全胜：${notes.join(" · ")}！`,
  };
}
