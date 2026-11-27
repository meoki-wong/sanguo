// v26.0 — 互动式「阵前无双单挑 & 舌战群儒」引擎
// 支持三场景：战中阵前叫阵 (battle_duel) / 敌城传令舌战 (city_debate) / 自由演武切磋 (free_arena)

import { addSagaBuff, ensureSaga, recordAnnal } from "./saga.js";
import { officerMeta } from "./traits.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function hashSeed(text) {
  let h = 2166136261;
  const s = String(text || "arena");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const HERO_SIGNATURE_MOVES = {
  关羽: { duelName: "青龙拖刀斩", duelLine: "某观尔如插标卖首耳！看刀！", debateName: "春秋大义折", debateLine: "玉可碎而不可改其白，大义岂容尔等私议！" },
  吕布: { duelName: "鬼神方天舞", duelLine: "谁敢与吾大战三百回合！", debateName: "戟指震群座", debateLine: "废话少说，辕门百步穿杨可曾见否？" },
  赵云: { duelName: "七探盘蛇枪", duelLine: "常山赵子龙在此，何人敢拦！", debateName: "浑身是胆论", debateLine: "主公仁义在怀，胜败岂在一城一隅！" },
  张飞: { duelName: "丈八咆哮刺", duelLine: "燕人张翼德在此，决一死战！", debateName: "断喝退重兵", debateLine: "战便战，何必效酸腐书生摇唇鼓舌！" },
  马超: { duelName: "西凉锦狮突", duelLine: "锦马超铁骑所向，片甲不留！", debateName: "誓血复仇辞", debateLine: "大丈夫生居乱世，当以铁血洗雪前耻！" },
  典韦: { duelName: "双戟裂石击", duelLine: "主公在此，寸步休想越过！", debateName: "古之恶来威", debateLine: "吾不识文字，唯知忠主护驾到底！" },
  许褚: { duelName: "裸衣虎痴搏", duelLine: "赤膊上阵，酣战痛快！", debateName: "虎侯怒目压", debateLine: "敢言降者，先过我许仲康这关！" },
  夏侯惇: { duelName: "拔矢啖睛斩", duelLine: "父精母血不可弃！迎刃受死！", debateName: "忠烈独目斥", debateLine: "魏武铁律如山，岂惧尔等危言耸听！" },
  甘宁: { duelName: "锦帆百骑劫", duelLine: "锦帆铃响处，取尔大将首级！", debateName: "豪侠折冲辞", debateLine: "奇兵百骑尚敢劫营，区区虚言何足道哉！" },
  太史慈: { duelName: "神亭贯虹戟", duelLine: "大丈夫当带三尺剑，立不世之功！", debateName: "信义诺千金", debateLine: "既许一诺，虽百死而不悔其志！" },
  孙策: { duelName: "江东小霸王崩", duelLine: "江东猛虎在此，天下谁堪一敌！", debateName: "渡江平定论", debateLine: "席卷江表不过弹指，今正欲问鼎中原！" },
  周瑜: { duelName: "长剑指东风", duelLine: "文武兼资，剑气亦能破敌百里！", debateName: "折案誓抗曹", debateLine: "江东尚有精兵十万，岂能向贼屈膝！" },
  诸葛亮: { duelName: "八阵落星诀", duelLine: "奇正相生，尔已入我阵眼之中！", debateName: "草庐隆中判", debateLine: "天下大势尽在掌中，诸君何不观其大略！" },
  司马懿: { duelName: "冢虎隐锋断", duelLine: "一击不发则已，发必见血封喉！", debateName: "善败能忍辩", debateLine: "用兵之道贵在审势待时，躁进者必自折！" },
  曹操: { duelName: "倚天横槊破", duelLine: "对酒当歌，倚天长剑试天下英雄！", debateName: "短歌揽群雄", debateLine: "山不厌高，水不厌深，唯才是举方定乾坤！" },
  郭嘉: { duelName: "十胜鬼谋断", duelLine: "兵贵神速，破绽已悉！", debateName: "十胜十败析", debateLine: "绍有十败而公有十胜，胜负早已先定！" },
  贾诩: { duelName: "乱武绝命算", duelLine: "算无遗策，尔步步皆入死地！", debateName: "完身避祸辞", debateLine: "乱世求存必先审敌我消长，切忌轻赌孤注！" },
  鲁肃: { duelName: "榻上合纵击", duelLine: "忠厚长者亦有定疆之勇！", debateName: "榻上二分策", debateLine: "合两家之力乃保江东百年基业，切莫短视！" },
};

const DEFAULT_HERO_SIG = {
  duelName: "破阵无双斩",
  duelLine: "三军注视于此，请赐高招！",
  debateName: "鸿胪折冲词",
  debateLine: "理直则气壮，且看谁更明天下大势！",
};

export const ARENA_MOVES = {
  duel: [
    { id: "strike", name: "猛击", icon: "⚔️", beats: "feint", role: "力劈华山（克奇招）", summary: "正面重创，被格挡时会被反震。" },
    { id: "guard", name: "格挡反震", icon: "🛡️", beats: "strike", role: "以逸待劳（克猛击）", summary: "减伤 70%，完美挡住猛击时强力弹反并 +35 怒气。" },
    { id: "feint", name: "奇招破防", icon: "⚡", beats: "guard", role: "虚实绕袭（克格挡）", summary: "灵巧拆招，专破死守格挡并打断敌势。" },
    { id: "musou", name: "无双绝技", icon: "🔥", beats: "all", role: "怒气 100 必杀", summary: "爆发名将专属绝技！无视格挡，造成毁灭级破阵一击。", requiresRage: 100 },
  ],
  debate: [
    { id: "righteous", name: "义理压阵", icon: "📜", beats: "entice", role: "正气凛然（克利害）", summary: "以天下公义与声望压倒对手。" },
    { id: "sophistry", name: "奇诡反诘", icon: "🎭", beats: "righteous", role: "出奇制胜（克义理）", summary: "寻隙反问，令墨守陈规者语塞。" },
    { id: "entice", name: "利害攻心", icon: "💎", beats: "sophistry", role: "切中要害（克奇诡）", summary: "以现实兵粮利弊直击内心动摇处。" },
    { id: "musou", name: "舌压群儒", icon: "🔥", beats: "all", role: "怒气 100 绝辩", summary: "名将绝世雄辩！一锤定音，大溃敌方神气。", requiresRage: 100 },
  ],
};

function signatureFor(name, mode) {
  const rec = HERO_SIGNATURE_MOVES[name] || DEFAULT_HERO_SIG;
  return mode === "debate"
    ? { name: rec.debateName, line: rec.debateLine }
    : { name: rec.duelName, line: rec.duelLine };
}

function statFor(officer, mode) {
  if (!officer) return 75;
  const meta = officerMeta(officer);
  return mode === "debate" ? (meta.intellect ?? officer.governance ?? 75) : (meta.might ?? officer.command ?? 75);
}

function chooseEnemyIntent(session, roundIdx) {
  const modeMoves = ARENA_MOVES[session.mode];
  const baseIds = modeMoves.filter((m) => !m.requiresRage).map((m) => m.id);
  const seed = hashSeed(`${session.seed}:${roundIdx}:${session.enemyHp}:${session.playerHp}`);

  let pickedId = baseIds[seed % baseIds.length];
  if (session.enemyRage >= 100) {
    pickedId = "musou";
  } else if (roundIdx > 1 && session.enemyHp < session.enemyMaxHp * 0.45 && seed % 3 === 0) {
    pickedId = session.mode === "debate" ? "entice" : "guard";
  }

  // 线索可信度 ~75%：真实预告 vs 虚晃一枪
  const deceptive = pickedId !== "musou" && (seed % 4 === 3);
  const hintId = deceptive ? baseIds[(baseIds.indexOf(pickedId) + 1) % baseIds.length] : pickedId;
  const hintMove = modeMoves.find((m) => m.id === hintId) || modeMoves[0];

  const tellText = pickedId === "musou"
    ? `🔥 杀气暴涨！${session.enemyName}怒气已满，蓄势欲施「${session.enemySignature.name}」！`
    : session.mode === "debate"
      ? `观其神色，${session.enemyName}似欲摆出「${hintMove.name}」之势${deceptive ? "（眼神略显游移）" : ""}。`
      : `观其架势，${session.enemyName}肩腕沉落，似要使出「${hintMove.name}」${deceptive ? "（微藏虚实）" : ""}。`;

  return { enemyIntentId: pickedId, enemyTell: tellText };
}

/**
 * 创建交互式单挑 / 舌战会话
 */
export function createArenaSession({
  mode = "duel",
  context = "free_arena",
  playerOfficer = null,
  enemyOfficer = null,
  playerName = "",
  enemyName = "",
  playerStat = 0,
  enemyStat = 0,
  cityName = "",
  targetCityKey = null,
  seedBonus = 0,
} = {}) {
  const m = mode === "debate" ? "debate" : "duel";
  const pName = playerOfficer?.name || playerName || "我方大将";
  const eName = enemyOfficer?.name || enemyName || "敌阵名将";
  const pStat = clamp(playerStat || statFor(playerOfficer, m), 45, 100);
  const eStat = clamp(enemyStat || statFor(enemyOfficer, m), 45, 100);

  const playerMaxHp = clamp(100 + Math.round((pStat - 72) * 1.35), 85, 145);
  const enemyMaxHp = clamp(100 + Math.round((eStat - 72) * 1.35), 85, 145);
  const pSig = signatureFor(pName, m);
  const eSig = signatureFor(eName, m);

  const session = {
    mode: m,
    context,
    targetCityKey,
    cityName: cityName || "演武擂台",
    playerName: pName,
    enemyName: eName,
    playerKey: playerOfficer?.key || null,
    enemyKey: enemyOfficer?.key || null,
    playerStat: pStat,
    enemyStat: eStat,
    playerMaxHp,
    enemyMaxHp,
    playerHp: playerMaxHp,
    enemyHp: enemyMaxHp,
    playerRage: 30,
    enemyRage: 20,
    playerSignature: pSig,
    enemySignature: eSig,
    round: 1,
    maxRounds: 5,
    done: false,
    winner: null,
    seed: hashSeed(`${m}:${pName}:${eName}:${cityName}:${seedBonus}`),
    enemyIntentId: null,
    enemyTell: "",
    lastClash: null,
    log: [
      `【${m === "debate" ? "舌战起论" : "阵前交锋"}】${pName}（${m === "debate" ? "智" : "武"} ${pStat}） 对阵 ${eName}（${m === "debate" ? "智" : "武"} ${eStat}）！`,
    ],
  };

  const firstIntent = chooseEnemyIntent(session, 1);
  session.enemyIntentId = firstIntent.enemyIntentId;
  session.enemyTell = firstIntent.enemyTell;
  return session;
}

function finalizeWinner(session) {
  if (session.playerHp <= 0 && session.enemyHp <= 0) {
    session.winner = session.playerStat >= session.enemyStat ? "player" : "enemy";
  } else if (session.enemyHp <= 0) {
    session.winner = "player";
  } else if (session.playerHp <= 0) {
    session.winner = "enemy";
  } else {
    const pPct = session.playerHp / session.playerMaxHp;
    const ePct = session.enemyHp / session.enemyMaxHp;
    if (pPct > ePct + 0.03) session.winner = "player";
    else if (ePct > pPct + 0.03) session.winner = "enemy";
    else session.winner = "draw";
  }
  session.done = true;
}

/**
 * 结算一个单挑/舌战回合
 */
export function resolveArenaRound(session, playerMoveId) {
  if (!session || session.done) return session;
  const moves = ARENA_MOVES[session.mode];
  let pMove = moves.find((m) => m.id === playerMoveId) || moves[0];
  if (pMove.requiresRage && session.playerRage < pMove.requiresRage) {
    pMove = moves[0];
  }
  const eMove = moves.find((m) => m.id === session.enemyIntentId) || moves[0];

  const next = structuredClone(session);
  const diff = (next.playerStat - next.enemyStat) * 0.35;
  const basePlayerHit = clamp(24 + diff, 15, 36);
  const baseEnemyHit = clamp(24 - diff, 15, 36);
  const guardId = next.mode === "debate" ? "sophistry_none" : "guard"; // 仅武斗有主动格挡反震，文斗三克相等

  let dmgToEnemy = 0;
  let dmgToPlayer = 0;
  let playerRageGain = 22;
  let enemyRageGain = 22;
  let verdict = "平分秋色";
  let shake = false;
  let headline = "";

  if (pMove.id === "musou") {
    next.playerRage = 0;
    dmgToEnemy = clamp(Math.round(basePlayerHit * 1.85), 36, 56);
    dmgToPlayer = eMove.id === "musou" ? clamp(Math.round(baseEnemyHit * 1.45), 26, 46) : Math.round(baseEnemyHit * 0.45);
    if (eMove.id === "musou") next.enemyRage = 0;
    playerRageGain = 15;
    verdict = `无双绝技·${next.playerSignature.name}`;
    shake = true;
    headline = `🔥 ${next.playerName}大喝「${next.playerSignature.line}」，施出【${next.playerSignature.name}】横扫 ${dmgToEnemy} 气势！`;
  } else if (eMove.id === "musou") {
    next.enemyRage = 0;
    const blocked = pMove.id === guardId;
    dmgToPlayer = blocked ? Math.round(baseEnemyHit * 0.95) : clamp(Math.round(baseEnemyHit * 1.78), 34, 52);
    dmgToEnemy = blocked ? 14 : Math.round(basePlayerHit * 0.6);
    enemyRageGain = 15;
    playerRageGain = 34;
    verdict = blocked ? "勉力架住绝技" : `敌施绝技·${next.enemySignature.name}`;
    shake = true;
    headline = `⚡ ${next.enemyName}爆发【${next.enemySignature.name}】，${blocked ? `${next.playerName}死守化去大半锋芒（受 ${dmgToPlayer} 伤）` : `重创 ${next.playerName} ${dmgToPlayer} 气势`}！`;
  } else if (pMove.id === guardId && eMove.id === "strike") {
    // 完美格挡反震
    dmgToPlayer = Math.max(4, Math.round(baseEnemyHit * 0.3));
    dmgToEnemy = clamp(Math.round(basePlayerHit * 1.15), 22, 38);
    playerRageGain = 35;
    verdict = "格挡反震！";
    shake = true;
    headline = `🛡️ ${next.playerName}稳稳格挡${next.enemyName}的猛击，顺势震伤对手 ${dmgToEnemy}（我仅损 ${dmgToPlayer}）！`;
  } else if (eMove.id === guardId && pMove.id === "strike") {
    dmgToEnemy = Math.max(4, Math.round(basePlayerHit * 0.3));
    dmgToPlayer = clamp(Math.round(baseEnemyHit * 1.15), 22, 38);
    enemyRageGain = 35;
    verdict = "被敌反震！";
    headline = `⚠️ ${next.playerName}猛击撞上敌方铁壁，遭反震受创 ${dmgToPlayer}！`;
  } else if (pMove.beats === eMove.id) {
    dmgToEnemy = clamp(Math.round(basePlayerHit * 1.38), 24, 44);
    dmgToPlayer = Math.round(baseEnemyHit * 0.55);
    playerRageGain = 30;
    verdict = "招式大克！";
    shake = true;
    headline = `✨ ${next.playerName}「${pMove.name}」完克${next.enemyName}「${eMove.name}」，压进 ${dmgToEnemy} 气势！`;
  } else if (eMove.beats === pMove.id) {
    dmgToEnemy = Math.round(basePlayerHit * 0.55);
    dmgToPlayer = clamp(Math.round(baseEnemyHit * 1.38), 24, 44);
    enemyRageGain = 30;
    verdict = "招式受制";
    headline = `💢 ${next.enemyName}以「${eMove.name}」抢先制住我方「${pMove.name}」，反损 ${dmgToPlayer} 气势。`;
  } else {
    dmgToEnemy = basePlayerHit;
    dmgToPlayer = baseEnemyHit;
    verdict = "势均力敌";
    headline = `⚔️ 双方同施「${pMove.name}」硬碰一合，各折 ${dmgToEnemy} / ${dmgToPlayer} 气势。`;
  }

  next.enemyHp = Math.max(0, next.enemyHp - dmgToEnemy);
  next.playerHp = Math.max(0, next.playerHp - dmgToPlayer);
  next.playerRage = Math.min(100, next.playerRage + playerRageGain);
  next.enemyRage = Math.min(100, next.enemyRage + enemyRageGain);
  next.lastClash = {
    round: next.round,
    playerMove: pMove.name,
    enemyMove: eMove.name,
    dmgToEnemy,
    dmgToPlayer,
    verdict,
    shake,
    headline,
  };
  next.log.push(`第${next.round}合：${headline}`);
  if (next.log.length > 10) next.log = next.log.slice(-10);

  next.round += 1;
  if (next.enemyHp <= 0 || next.playerHp <= 0 || next.round > next.maxRounds) {
    finalizeWinner(next);
    next.enemyTell = next.winner === "player"
      ? `🏆 ${next.playerName}大获全胜！`
      : next.winner === "enemy"
        ? `😔 ${next.playerName}惜败退阵。`
        : "🤝 双方战成平手，各有千秋。";
    next.log.push(`【决胜落定】${next.enemyTell}`);
  } else {
    const nextIntent = chooseEnemyIntent(next, next.round);
    next.enemyIntentId = nextIntent.enemyIntentId;
    next.enemyTell = nextIntent.enemyTell;
  }
  return next;
}

/**
 * 自动推演完成剩余对决回合（优先释放无双，其次顺应线索克制敌招）
 */
export function autoResolveArena(session) {
  let cur = structuredClone(session);
  const moves = ARENA_MOVES[cur.mode];
  let guard = 0;
  while (cur && !cur.done && guard < 8) {
    guard += 1;
    let pickId = moves[0].id;
    if (cur.playerRage >= 100) {
      pickId = "musou";
    } else {
      const counter = moves.find((m) => m.beats === cur.enemyIntentId);
      if (counter) pickId = counter.id;
    }
    cur = resolveArenaRound(cur, pickId);
  }
  return cur;
}

/**
 * 将敌城舌战或演武擂台结果写回天下大局（自由切磋每季防重复刷赏）
 */
export function applyArenaWorldReward(world, state, session, { targetCityKey = null } = {}) {
  if (!state?.century || !session?.done) {
    return { state, rewardText: "" };
  }
  if (session.winner !== "player") {
    return { state, rewardText: session.winner === "draw" ? "两将战平，各有收获。" : "败阵而还，尚须砺兵再战。" };
  }

  const next = structuredClone(state);
  const saga = ensureSaga(next);
  saga.arenaWins ??= { duel: 0, debate: 0, lastTurn: -1 };

  if (session.context === "city_debate") {
    const cKey = targetCityKey || session.targetCityKey;
    saga.arenaWins.debate = (saga.arenaWins.debate ?? 0) + 1;
    saga.reputation = clamp((saga.reputation ?? 50) + 5, 0, 100);
    if (cKey) {
      saga.rumors ??= {};
      saga.rumors[cKey] = next.turn + 3;
    }
    addSagaBuff(next, { kind: "attack", faction: next.player, value: 0.08, duration: 2, label: "舌战扬威" });
    recordAnnal(next, "阵前舌战", `${session.playerName}在${session.cityName || "敌城"}外舌战挫败${session.enemyName}，守军动摇 3 季，我军声望 +5、攻势 +8%（2季）。`);
    return {
      state: next,
      rewardText: `大胜！${session.cityName || "敌城"}流言动摇 3 季（防大减）· 我军攻势 +8%（2季）· 声望 +5！`,
    };
  }

  if (session.context === "free_arena") {
    const firstThisTurn = saga.arenaWins.lastTurn !== next.turn;
    if (session.mode === "debate") saga.arenaWins.debate = (saga.arenaWins.debate ?? 0) + 1;
    else saga.arenaWins.duel = (saga.arenaWins.duel ?? 0) + 1;

    if (firstThisTurn) {
      saga.arenaWins.lastTurn = next.turn;
      saga.reputation = clamp((saga.reputation ?? 50) + 4, 0, 100);
      saga.duelWins = (saga.duelWins ?? 0) + 1;
      saga.tech ??= { points: 0, unlocked: [] };
      saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + 15);
      recordAnnal(next, "演武扬威", `${session.playerName}于演武场击败${session.enemyName}，全军喝彩，海内声望 +4、兵技点 +15。`);
      return {
        state: next,
        rewardText: `演武首捷！海内声望 +4 · 兵技点 +15（本季再战仅作切磋不再重赏）。`,
      };
    }
    return {
      state: next,
      rewardText: `切磋取胜！（本季演武赏赐已领，可下季再来扬威）`,
    };
  }

  return { state, rewardText: "" };
}
