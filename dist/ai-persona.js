// v18.0 — 枭雄 AI 人格分化 & 名将世代更替（可选寿元/拜师传承）
// 状态挂在 state.saga.lifespan 与 state.saga.options.enableLifespan 下。

export const AI_PERSONAS = {
  cao: {
    id: "cao",
    title: "治世能臣 · 乱世奸雄",
    badge: "速战挟天子",
    aggression: 1.18,
    betrayChance: 0.22,
    allianceTrust: 0.85,
    preferredTech: "military",
    description: "重奇袭速战、善屯田聚兵，势强时偏好闪电吞并邻邦。",
  },
  liu: {
    id: "liu",
    title: "仁德兴汉 · 坚忍不拔",
    badge: "重义联吴",
    aggression: 0.96,
    betrayChance: 0.04,
    allianceTrust: 1.25,
    preferredTech: "civic",
    description: "重信义结盟，极少背刺盟友，擅长持久战与名将羁绊协同。",
  },
  wu: {
    id: "wu",
    title: "坐断东南 · 权谋守江",
    badge: "守江趁虚",
    aggression: 1.02,
    betrayChance: 0.28,
    allianceTrust: 0.82,
    preferredTech: "strategy",
    description: "依托长江天险固守江东，善借盟约周旋并在邻国空虚时趁虚而入。",
  },
  lvbu: {
    id: "lvbu",
    title: "虓虎无常 · 唯利是图",
    badge: "反复猛攻",
    aggression: 1.32,
    betrayChance: 0.45,
    allianceTrust: 0.55,
    preferredTech: "military",
    description: "好战嗜攻、毁约频仍，单军突击力极强但后勤与外交反复无常。",
  },
  yuan: {
    id: "yuan",
    title: "四世三公 · 大军压境",
    badge: "厚兵慢进",
    aggression: 1.06,
    betrayChance: 0.14,
    allianceTrust: 0.95,
    preferredTech: "civic",
    description: "坐拥河北沃土，擅长高兵力正面压制，但决断偏慢。",
  },
  sima: {
    id: "sima",
    title: "冢虎隐忍 · 后发制人",
    badge: "深谋后发",
    aggression: 1.08,
    betrayChance: 0.3,
    allianceTrust: 0.78,
    preferredTech: "strategy",
    description: "前期蓄力固防、广布细作奇谋，待敌露怯后雷霆反击。",
  },
  dong: {
    id: "dong",
    title: "暴戾专权 · 铁骑掠境",
    badge: "铁血高压",
    aggression: 1.26,
    betrayChance: 0.36,
    allianceTrust: 0.62,
    preferredTech: "military",
    description: "以西凉重骑横扫关中，扩张凶猛但易激起诸侯合纵反抗。",
  },
  ma: {
    id: "ma",
    title: "西凉雄杰 · 突骑奔袭",
    badge: "急攻突袭",
    aggression: 1.15,
    betrayChance: 0.15,
    allianceTrust: 0.92,
    preferredTech: "military",
    description: "纵横雍凉，轻骑突袭凌厉，极重骑兵优势。",
  },
  biao: {
    id: "biao",
    title: "八俊名士 · 守成自保",
    badge: "固守文治",
    aggression: 0.78,
    betrayChance: 0.08,
    allianceTrust: 1.1,
    preferredTech: "civic",
    description: "重文教与城防固守，较少主动远征，偏好以逸待劳。",
  },
  yellow: {
    id: "yellow",
    title: "苍天已死 · 席卷州郡",
    badge: "狂潮四起",
    aggression: 1.28,
    betrayChance: 0.32,
    allianceTrust: 0.6,
    preferredTech: "military",
    description: "裹挟流民四面出击，攻势如潮但城防较弱。",
  },
  shi: {
    id: "shi",
    title: "交州霸主 · 偏安经略",
    badge: "远交稳守",
    aggression: 0.82,
    betrayChance: 0.1,
    allianceTrust: 1.08,
    preferredTech: "civic",
    description: "深耕岭南交州，善通商蓄力，伺机北图荆益。",
  },
};

export function personaForFaction(factionId) {
  return AI_PERSONAS[factionId] || {
    id: factionId || "default",
    title: "割据一方 · 伺机而动",
    badge: "稳健经略",
    aggression: 1,
    betrayChance: 0.15,
    allianceTrust: 1,
    preferredTech: "civic",
    description: "审时度势，相机进退。",
  };
}

/**
 * 拜师传承与后起之秀池（世代更替启用时动态登场或接受老将授艺）
 */
export const RISING_GENERATION = [
  { key: "jiangwei_v18", name: "姜维", faction: "liu", year: 224, command: 90, war: 89, intel: 91, politics: 74, mentorHint: "诸葛亮 / 赵云" },
  { key: "dengai_v18", name: "邓艾", faction: "cao", year: 232, command: 93, war: 87, intel: 89, politics: 82, mentorHint: "司马懿 / 张辽" },
  { key: "zhonghui_v18", name: "钟会", faction: "cao", year: 238, command: 85, war: 72, intel: 92, politics: 84, mentorHint: "司马懿 / 郭嘉" },
  { key: "lukang_v18", name: "陆抗", faction: "wu", year: 236, command: 92, war: 76, intel: 90, politics: 86, mentorHint: "陆逊 / 周瑜" },
  { key: "yanghu_v18", name: "羊祜", faction: "sima", year: 240, command: 89, war: 74, intel: 88, politics: 91, mentorHint: "司马懿" },
  { key: "wenyang_v18", name: "文鸯", faction: "cao", year: 244, command: 84, war: 94, intel: 68, politics: 58, mentorHint: "张辽 / 典韦" },
  { key: "guanxing_v18", name: "关兴", faction: "liu", year: 220, command: 84, war: 88, intel: 72, politics: 66, mentorHint: "关羽 / 张飞" },
  { key: "zhangbao_v18", name: "张苞", faction: "liu", year: 220, command: 82, war: 89, intel: 64, politics: 58, mentorHint: "张飞 / 关羽" },
];

export function isLifespanEnabled(state) {
  if (!state?.century) return false;
  if (state.year === 251 && state.saga?.options?.enableLifespan !== true) return false;
  return Boolean(state?.saga?.options?.enableLifespan);
}

export function setLifespanEnabled(state, enabled) {
  const next = structuredClone(state);
  if (!next.saga) next.saga = {};
  if (!next.saga.options) next.saga.options = {};
  next.saga.options.enableLifespan = Boolean(enabled);
  return next;
}

function ensureLifespan(state) {
  if (!state.saga) state.saga = {};
  if (!state.saga.lifespan || typeof state.saga.lifespan !== "object") {
    state.saga.lifespan = { mentorships: [], retired: [], emerged: [] };
  }
  if (!Array.isArray(state.saga.lifespan.mentorships)) state.saga.lifespan.mentorships = [];
  if (!Array.isArray(state.saga.lifespan.retired)) state.saga.lifespan.retired = [];
  if (!Array.isArray(state.saga.lifespan.emerged)) state.saga.lifespan.emerged = [];
  return state.saga.lifespan;
}

/**
 * 执行「拜师授艺」：由己方资深名将指导年轻将领，永久提升其战功与统/武/智加成
 */
export function performMentorship(era, state, mentorKey, apprenticeKey) {
  if (!state?.century) return { ok: false, reason: "仅在史诗大战略模式可进行名将拜师授艺。" };
  if (!mentorKey || !apprenticeKey || mentorKey === apprenticeKey) {
    return { ok: false, reason: "请选择两位不同的己方武将进行拜师授艺。" };
  }
  const allOfficers = [
    ...(era?.officers || []),
    ...(state.recruitedOfficers || []),
  ];
  const mentor = allOfficers.find((o) => o.key === mentorKey);
  const apprentice = allOfficers.find((o) => o.key === apprenticeKey);
  if (!mentor || !apprentice) return { ok: false, reason: "未找到对应武将。" };

  const faction = state.factions?.[state.player];
  const costTreasury = 30;
  if (!faction || faction.treasury < costTreasury) {
    return { ok: false, reason: `举行拜师授艺礼需金 ${costTreasury}。` };
  }

  const existing = state.saga?.lifespan?.mentorships || [];
  if (existing.some((m) => m.apprenticeKey === apprenticeKey)) {
    return { ok: false, reason: `${apprentice.name}已拜师受业，无需重复授艺。` };
  }

  const next = structuredClone(state);
  next.factions[state.player].treasury -= costTreasury;
  const ls = ensureLifespan(next);
  // 传承加成：从名师最高属性汲取 +4~6 点成长并赠与战功
  const gainCommand = Math.max(2, Math.min(6, Math.round(((mentor.command ?? 80) - (apprentice.command ?? 72)) * 0.25) + 3));
  const gainIntel = Math.max(1, Math.min(5, Math.round(((mentor.intel ?? 75) - (apprentice.intel ?? 70)) * 0.22) + 2));

  ls.mentorships.push({
    mentorKey,
    mentorName: mentor.name,
    apprenticeKey,
    apprenticeName: apprentice.name,
    turn: next.turn ?? 1,
    commandBonus: gainCommand,
    intelBonus: gainIntel,
  });

  // 同步写入军功与成长记录
  if (!next.saga.merits) next.saga.merits = {};
  const m = next.saga.merits[apprenticeKey] || { wins: 0, duels: 0, xp: 0, rank: 0 };
  m.xp = (m.xp ?? 0) + 45;
  next.saga.merits[apprenticeKey] = m;

  return {
    ok: true,
    state: next,
    summary: `【拜师授艺】${apprentice.name}拜${mentor.name}为师，尽得兵法真传（统率 +${gainCommand}、智谋 +${gainIntel}、军功 +45）！`,
  };
}

/**
 * 获取武将因拜师传承获得的额外属性加成
 */
export function mentorshipBonusFor(state, officerKey) {
  const list = state?.saga?.lifespan?.mentorships || [];
  const rec = list.find((m) => m.apprenticeKey === officerKey);
  if (!rec) return { command: 0, intel: 0, mentorName: "" };
  return { command: rec.commandBonus ?? 0, intel: rec.intelBonus ?? 0, mentorName: rec.mentorName || "" };
}

/**
 * 季度结算：若开启「史实寿元 & 世代更替」，按游戏年份动态迎来后起之秀出山
 */
export function settleLifespanTurn(era, state) {
  if (!isLifespanEnabled(state)) return { state, notes: [] };
  const currentYear = (state.year ?? 208) + Math.floor(((state.turn ?? 1) - 1) / 4);
  const next = structuredClone(state);
  const ls = ensureLifespan(next);
  const notes = [];

  for (const hero of RISING_GENERATION) {
    if (ls.emerged.includes(hero.key)) continue;
    if (currentYear < hero.year && (state.turn ?? 1) < 12) continue;
    // 玩家阵营对应或达到出山年份后陆续登场
    if (hero.faction !== next.player && (next.turn ?? 1) % 4 !== 0) continue;
    ls.emerged.push(hero.key);
    if (hero.faction === next.player) {
      if (!Array.isArray(next.recruitedOfficers)) next.recruitedOfficers = [];
      if (!next.recruitedOfficers.some((o) => o.key === hero.key)) {
        next.recruitedOfficers.push({
          key: hero.key,
          name: hero.name,
          faction: next.player,
          command: hero.command,
          war: hero.war,
          intel: hero.intel,
          politics: hero.politics,
          role: "marshal",
          rising: true,
        });
        notes.push(`【后起之秀】新锐名将「${hero.name}」（统${hero.command}/武${hero.war}/智${hero.intel}）出山投效我军！`);
      }
    }
  }

  return { state: next, notes };
}
