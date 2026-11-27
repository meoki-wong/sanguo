// v27.0 — 「九州兵法局」三路排兵卡牌对战（Marvel Snap 式三路比点 + 阵地地形 + 三国名将羁绊）

import { ensureSaga, recordAnnal } from "./saga.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str || "clash");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const CLASH_VENUES = [
  { id: "hulao", name: "虎牢雄关", icon: "🏯", ruleText: "每方首位出阵猛将战力 +3" },
  { id: "chibi", name: "赤壁水寨", icon: "🔥", ruleText: "奇谋 / 火计牌在此阵战力 +3" },
  { id: "longzhong", name: "卧龙草庐", icon: "🪶", ruleText: "谋士牌在此阵每张战力 +2" },
  { id: "changban", name: "长坂独桥", icon: "🌉", capOne: true, ruleText: "每方限驻 1 员，其总战力 ×1.5" },
  { id: "wuchao", name: "乌巢粮道", icon: "🏮", extraGrainWin: 120, ruleText: "破此阵且全胜额外获 +120 粮草" },
  { id: "hanzhong", name: "汉中栈道", icon: "⛰️", ruleText: "2 费及以下低费牌在此阵 +2" },
  { id: "tongque", name: "铜雀高台", icon: "🏛️", ruleText: "同阵己方 >= 2 张牌时每张 +2" },
  { id: "wuzhang", name: "五丈原", icon: "☄️", ruleText: "3 费及以上高费牌在此阵 +3" },
  { id: "baidi", name: "白帝孤城", icon: "⛵", ruleText: "本阵总战力较弱一方所有牌 +2" },
];

export const CLASH_CARDS = [
  { id: "guanyu", name: "关羽", cost: 3, power: 5, category: "hero", icon: "🐉", desc: "若敌方此阵正好 1 员，战力 +4（单挑必胜）" },
  { id: "lvbu", name: "吕布", cost: 4, power: 11, category: "hero", icon: "👹", desc: "无双猛虎！本阵每多 1 名友军，自身战力 -2" },
  { id: "zhaoyun", name: "赵云", cost: 3, power: 5, category: "hero", icon: "❄️", desc: "七进七出：若己方本阵总点落后，战力 +5" },
  { id: "zhangfei", name: "张飞", cost: 2, power: 4, category: "hero", icon: "🦁", desc: "咆哮：敌方此阵 >= 2 张牌时，自身 +3" },
  { id: "machao", name: "马超", cost: 3, power: 6, category: "hero", icon: "🐎", desc: "西凉铁骑：首回合出战额外 +2" },
  { id: "dianwei", name: "典韦", cost: 2, power: 5, category: "hero", icon: "🪓", desc: "古之恶来：本阵友军达 2 员以上额外 +2" },
  { id: "xuchu", name: "许褚", cost: 3, power: 7, category: "hero", icon: "🐯", desc: "虎痴死战：纯高武镇守，稳压中路" },
  { id: "ganning", name: "甘宁", cost: 2, power: 4, category: "hero", icon: "⚓", desc: "百骑劫营：在乌巢/赤壁或第 3 回合打出 +3" },
  { id: "taishici", name: "太史慈", cost: 2, power: 5, category: "hero", icon: "🏹", desc: "神亭贯虹：精锐稳健前锋（战力 5）" },
  { id: "sunce", name: "孙策", cost: 3, power: 6, category: "hero", icon: "🔥", desc: "小霸王：本阵除自身外无其他友军时 +3" },
  { id: "xiahoudun", name: "夏侯惇", cost: 2, power: 4, category: "hero", icon: "⚔️", desc: "刚烈：本阵每有 1 名敌方牌，自身 +1" },
  { id: "huangzhong", name: "黄忠", cost: 3, power: 5, category: "hero", icon: "🎯", desc: "百步穿杨：第 3 回合出阵战力 +4" },
  { id: "zhuge", name: "诸葛亮", cost: 4, power: 4, category: "advisor", icon: "🪶", desc: "神算全盘：其余两路若有己方牌，各路总点 +3" },
  { id: "zhouyu", name: "周瑜", cost: 3, power: 4, category: "advisor", icon: "🎶", desc: "谈笑破曹：敌方此阵总战力折半（至少削 2 点）" },
  { id: "simayi", name: "司马懿", cost: 3, power: 3, category: "advisor", icon: "🦅", desc: "冢虎镜像：复制此阵敌军最强单卡基础战力" },
  { id: "pangtong", name: "庞统", cost: 2, power: 3, category: "advisor", icon: "🔗", desc: "连环计：本阵其余己方每张牌战力 +2" },
  { id: "guojia", name: "郭嘉", cost: 2, power: 3, category: "advisor", icon: "📜", desc: "奇佐：若出战时手牌 <= 3 张，战力 +3" },
  { id: "jiaxu", name: "贾诩", cost: 2, power: 3, category: "advisor", icon: "🕷️", desc: "算无遗策：令此阵每张敌牌战力 -1" },
  { id: "lusu", name: "鲁肃", cost: 1, power: 2, category: "advisor", icon: "⛵", desc: "合纵运粮：其余两路若有己方牌各 +1" },
  { id: "xunyu", name: "荀彧", cost: 2, power: 4, category: "advisor", icon: "💠", desc: "王佐：本阵有其他谋士或奇谋时自身 +2" },
  { id: "fire_chain", name: "火烧连营", cost: 2, power: 2, category: "scheme", icon: "🔥", desc: "焚营：敌方此阵每驻 1 张牌，本计 +3" },
  { id: "straw_boats", name: "草船借箭", cost: 1, power: 2, category: "scheme", icon: "🏹", desc: "借箭：立即额外补抽 1 张牌且自身 +2" },
  { id: "empty_fort_card", name: "空城退敌", cost: 2, power: 3, category: "scheme", icon: "🎼", desc: "疑阵：本阵仅此 1 张己方牌时战力骤增 +6" },
  { id: "beauty_trap", name: "连环反间", cost: 1, power: 1, category: "scheme", icon: "💎", desc: "离间：直接削弱敌方此阵最强牌 4 点战力" },
];

export const CLASH_BONDS = [
  { id: "taoyuan", name: "桃园结义", members: ["guanyu", "zhangfei"], bonus: 4, desc: "关羽与张飞齐上阵，各获 +2 羁绊爆发（共 +4）" },
  { id: "wolong_fengchu", name: "卧龙凤雏", members: ["zhuge", "pangtong"], bonus: 4, desc: "诸葛亮与庞统并谋，各获 +2 奇谋共鸣（共 +4）" },
  { id: "jiangdong_twins", name: "江东双璧", members: ["zhouyu", "sunce"], bonus: 4, desc: "周瑜与孙策齐临，各获 +2 水陆锐气（共 +4）" },
  { id: "wei_tigers", name: "魏武虎卫", members: ["dianwei", "xuchu"], bonus: 4, desc: "典韦与许褚齐守，各获 +2 护军铁壁（共 +4）" },
];

function cardById(id) {
  return CLASH_CARDS.find((c) => c.id === id) || CLASH_CARDS[0];
}

function buildShuffledDeck(seed) {
  const arr = [...CLASH_CARDS];
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function instantiateCard(tpl, playedRound = 1, handSizeAfter = 4) {
  return {
    ...tpl,
    uid: `${tpl.id}_${playedRound}_${Math.random().toString(36).slice(2, 6)}`,
    playedRound,
    lowHandTriggered: tpl.id === "guojia" && handSizeAfter <= 3,
  };
}

function activeBondSetForSide(lanes, side) {
  const placedIds = new Set(lanes.flatMap((l) => (side === "player" ? l.playerCards : l.enemyCards).map((c) => c.id)));
  const active = [];
  const memberBonusIds = new Set();
  for (const bond of CLASH_BONDS) {
    if (bond.members.every((id) => placedIds.has(id))) {
      active.push(bond);
      for (const m of bond.members) memberBonusIds.add(m);
    }
  }
  return { active, memberBonusIds };
}

function rawSidePower(lanes, laneIdx, side, memberBonusIds, applyLagEffects = true) {
  const lane = lanes[laneIdx];
  const mine = side === "player" ? lane.playerCards : lane.enemyCards;
  const opp = side === "player" ? lane.enemyCards : lane.playerCards;
  const venue = lane.venue;
  let total = 0;

  // 若对方阵有连环反间，先找我方基础最高战力牌扣 4 点
  const hasTrap = applyLagEffects && opp.some((c) => c.id === "beauty_trap");
  let maxSinglePower = -1;
  let maxSingleIdx = -1;
  mine.forEach((c, idx) => {
    if (c.power > maxSinglePower) {
      maxSinglePower = c.power;
      maxSingleIdx = idx;
    }
  });

  const enemyPoison = applyLagEffects && opp.some((c) => c.id === "jiaxu") ? 1 : 0;

  for (let i = 0; i < mine.length; i += 1) {
    const c = mine[i];
    let p = c.power;

    // 卡牌自身效果
    if (c.id === "guanyu" && opp.length === 1) p += 4;
    else if (c.id === "lvbu") p = Math.max(1, p - Math.max(0, mine.length - 1) * 2);
    else if (c.id === "zhangfei" && opp.length >= 2) p += 3;
    else if (c.id === "machao" && c.playedRound === 1) p += 2;
    else if (c.id === "dianwei" && mine.length >= 2) p += 2;
    else if (c.id === "ganning" && (["wuchao", "chibi"].includes(venue.id) || c.playedRound === 3)) p += 3;
    else if (c.id === "sunce" && mine.length === 1) p += 3;
    else if (c.id === "xiahoudun") p += opp.length;
    else if (c.id === "huangzhong" && c.playedRound === 3) p += 4;
    else if (c.id === "simayi" && opp.length > 0) p += Math.min(9, Math.max(...opp.map((o) => o.power)));
    else if (c.id === "pangtong") p += Math.max(0, mine.length - 1) * 2;
    else if (c.id === "guojia" && c.lowHandTriggered) p += 3;
    else if (c.id === "xunyu" && mine.some((o, oi) => oi !== i && (o.category === "advisor" || o.category === "scheme"))) p += 2;
    else if (c.id === "fire_chain") p += opp.length * 3;
    else if (c.id === "empty_fort_card" && mine.length === 1) p += 6;

    // 阵地环境效果
    if (venue.id === "hulao" && i === 0 && c.category === "hero") p += 3;
    if (venue.id === "chibi" && c.category === "scheme") p += 3;
    if (venue.id === "longzhong" && c.category === "advisor") p += 2;
    if (venue.id === "hanzhong" && c.cost <= 2) p += 2;
    if (venue.id === "tongque" && mine.length >= 2) p += 2;
    if (venue.id === "wuzhang" && c.cost >= 3) p += 3;

    // 羁绊爆发
    if (memberBonusIds.has(c.id)) p += 2;

    // 敌方贾诩/连环反间减益（许褚免疫部分减益除外）
    if (c.id !== "xuchu") {
      if (enemyPoison) p = Math.max(1, p - enemyPoison);
      if (hasTrap && i === maxSingleIdx) p = Math.max(0, p - 4);
    }

    total += p;
  }

  // 来自其他两路的全局辅助（诸葛亮 +3 / 鲁肃 +1）
  if (mine.length > 0) {
    for (let other = 0; other < lanes.length; other += 1) {
      if (other === laneIdx) continue;
      const otherCards = side === "player" ? lanes[other].playerCards : lanes[other].enemyCards;
      if (otherCards.some((c) => c.id === "zhuge")) total += 3;
      if (otherCards.some((c) => c.id === "lusu")) total += 1;
    }
  }

  return total;
}

/**
 * 实时计算 3 条阵线的双方总战力与已激活羁绊
 */
export function evaluateClashLanes(session) {
  const lanes = session.lanes;
  const pBonds = activeBondSetForSide(lanes, "player");
  const eBonds = activeBondSetForSide(lanes, "enemy");

  const laneScores = lanes.map((lane, idx) => {
    let pRaw = rawSidePower(lanes, idx, "player", pBonds.memberBonusIds, true);
    let eRaw = rawSidePower(lanes, idx, "enemy", eBonds.memberBonusIds, true);

    // 赵云落后反超 +5
    if (lane.playerCards.some((c) => c.id === "zhaoyun") && pRaw < eRaw) pRaw += 5;
    if (lane.enemyCards.some((c) => c.id === "zhaoyun") && eRaw < pRaw) eRaw += 5;

    // 长坂独桥总点 ×1.5
    if (lane.venue.id === "changban") {
      pRaw = Math.round(pRaw * 1.5);
      eRaw = Math.round(eRaw * 1.5);
    }

    // 白帝孤城：较弱方每张牌 +2
    if (lane.venue.id === "baidi" && pRaw !== eRaw) {
      if (pRaw < eRaw && lane.playerCards.length > 0) pRaw += lane.playerCards.length * 2;
      else if (eRaw < pRaw && lane.enemyCards.length > 0) eRaw += lane.enemyCards.length * 2;
    }

    // 周瑜都督减半敌方此阵战力（至少 -2）
    if (lane.playerCards.some((c) => c.id === "zhouyu") && eRaw > 0) {
      eRaw = Math.max(0, eRaw - Math.max(2, Math.floor(eRaw / 2)));
    }
    if (lane.enemyCards.some((c) => c.id === "zhouyu") && pRaw > 0) {
      pRaw = Math.max(0, pRaw - Math.max(2, Math.floor(pRaw / 2)));
    }

    return {
      playerPower: pRaw,
      enemyPower: eRaw,
      leader: pRaw > eRaw ? "player" : eRaw > pRaw ? "enemy" : "tie",
    };
  });

  const playerLanesWon = laneScores.filter((s) => s.leader === "player").length;
  const enemyLanesWon = laneScores.filter((s) => s.leader === "enemy").length;
  const playerTotal = laneScores.reduce((s, l) => s + l.playerPower, 0);
  const enemyTotal = laneScores.reduce((s, l) => s + l.enemyPower, 0);

  return {
    laneScores,
    playerLanesWon,
    enemyLanesWon,
    playerTotal,
    enemyTotal,
    playerBonds: pBonds.active,
    enemyBonds: eBonds.active,
  };
}

function pickVenues(seed, forcedKeys = []) {
  const chosen = [];
  for (const k of forcedKeys) {
    const found = CLASH_VENUES.find((v) => v.id === k);
    if (found && !chosen.some((x) => x.id === found.id)) chosen.push(found);
  }
  const pool = [...CLASH_VENUES];
  let s = seed >>> 0;
  while (chosen.length < 3) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    const candidate = pool[s % pool.length];
    if (!chosen.some((x) => x.id === candidate.id)) chosen.push(candidate);
  }
  return chosen.slice(0, 3);
}

/**
 * 开局「九州兵法局」（3 阵地 × 3 回合，每季军令费 2 -> 3 -> 4）
 */
export function createClashSession({
  playerName = "我方主公",
  enemyName = "群雄对手",
  venueKeys = [],
  seedBonus = 1,
} = {}) {
  const seed = hashSeed(`${playerName}:${enemyName}:${seedBonus}`);
  const venues = pickVenues(seed, venueKeys);
  const deck = buildShuffledDeck(seed);
  const aiDeck = buildShuffledDeck(seed ^ 0x9e3779b9);

  const playerHand = deck.slice(0, 5).map((c) => instantiateCard(c, 0, 5));
  const playerDraw = deck.slice(5);
  const enemyHand = aiDeck.slice(0, 5).map((c) => instantiateCard(c, 0, 5));
  const enemyDraw = aiDeck.slice(5);

  const session = {
    playerName,
    enemyName,
    seed,
    round: 1,
    maxRounds: 3,
    energy: 2,
    maxEnergy: 2,
    selectedHandIndex: 0,
    lanes: venues.map((venue, idx) => ({
      index: idx,
      venue,
      playerCards: [],
      enemyCards: [],
    })),
    playerHand,
    playerDraw,
    enemyHand,
    enemyDraw,
    done: false,
    winner: null,
    evaluation: null,
    log: [`【兵法开局】${playerName} 与 ${enemyName} 对弈三路阵地，第 1 回合可用 2 点兵力。`],
  };

  session.evaluation = evaluateClashLanes(session);
  return session;
}

/**
 * 将玩家手中指定牌部署到第 laneIndex 路阵地
 */
export function playClashCard(session, handIndex, laneIndex) {
  if (!session || session.done) return session;
  const card = session.playerHand[handIndex];
  const lane = session.lanes[laneIndex];
  if (!card || !lane) return session;
  if (session.energy < card.cost) return session;
  const cap = lane.venue.capOne ? 1 : 4;
  if (lane.playerCards.length >= cap) return session;

  const next = structuredClone(session);
  const [picked] = next.playerHand.splice(handIndex, 1);
  next.energy -= picked.cost;

  const placed = instantiateCard(cardById(picked.id), next.round, next.playerHand.length);
  next.lanes[laneIndex].playerCards.push(placed);
  next.log.push(`我方于「${next.lanes[laneIndex].venue.name}」部署 ${placed.icon}${placed.name}（费${placed.cost}/力${placed.power}）。`);

  if (placed.id === "straw_boats" && next.playerDraw.length > 0 && next.playerHand.length < 7) {
    const extra = next.playerDraw.shift();
    next.playerHand.push(instantiateCard(extra, next.round, next.playerHand.length));
    next.log.push(`🏹「草船借箭」触发：补抽「${extra.name}」！`);
  }

  next.selectedHandIndex = next.playerHand.length ? 0 : -1;
  next.evaluation = evaluateClashLanes(next);
  return next;
}

function playEnemyRoundAi(session) {
  let budget = session.round + 1;
  const plays = [];
  // 在可用费用内择优布阵
  while (budget > 0 && session.enemyHand.length > 0 && plays.length < 3) {
    const affordable = session.enemyHand
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c.cost <= budget);
    if (!affordable.length) break;

    affordable.sort((a, b) => b.c.power - a.c.power || b.c.cost - a.c.cost);
    const pick = affordable[0];
    const openLanes = session.lanes
      .filter((l) => l.enemyCards.length < (l.venue.capOne ? 1 : 4))
      .sort((a, b) => {
        const diffA = evaluateClashLanes(session).laneScores[a.index];
        const diffB = evaluateClashLanes(session).laneScores[b.index];
        const needA = Math.abs(diffA.playerPower - diffA.enemyPower);
        const needB = Math.abs(diffB.playerPower - diffB.enemyPower);
        return needA - needB;
      });
    if (!openLanes.length) break;

    const targetLane = openLanes[(session.seed + session.round + plays.length) % openLanes.length];
    const [removed] = session.enemyHand.splice(pick.idx, 1);
    budget -= removed.cost;
    const placed = instantiateCard(cardById(removed.id), session.round, session.enemyHand.length);
    targetLane.enemyCards.push(placed);
    plays.push(`${targetLane.venue.name}→${placed.name}`);
  }
  if (plays.length) {
    session.log.push(`对手第${session.round}回合布阵：${plays.join(" · ")}。`);
  }
}

/**
 * 结束当前回合：对手落子，并在第 3 回合后结算胜负
 */
export function endClashTurn(session) {
  if (!session || session.done) return session;
  const next = structuredClone(session);
  playEnemyRoundAi(next);

  if (next.round >= next.maxRounds) {
    next.done = true;
    next.evaluation = evaluateClashLanes(next);
    const { playerLanesWon, enemyLanesWon, playerTotal, enemyTotal } = next.evaluation;
    if (playerLanesWon > enemyLanesWon) next.winner = "player";
    else if (enemyLanesWon > playerLanesWon) next.winner = "enemy";
    else if (playerTotal > enemyTotal) next.winner = "player";
    else if (enemyTotal > playerTotal) next.winner = "enemy";
    else next.winner = "draw";

    next.log.push(
      next.winner === "player"
        ? `🏆 三路终局：我方占 ${playerLanesWon} 路（总点 ${playerTotal} 对 ${enemyTotal}），大胜对手！`
        : next.winner === "enemy"
          ? `💢 三路终局：对手占 ${enemyLanesWon} 路（总点 ${enemyTotal} 对 ${playerTotal}），惜败一筹。`
          : `🤝 三路终局：势均力敌（总点 ${playerTotal}），握手言和。`,
    );
    return next;
  }

  next.round += 1;
  next.maxEnergy = Math.min(5, next.round + 1);
  next.energy = next.maxEnergy;
  if (next.playerDraw.length > 0 && next.playerHand.length < 7) {
    const drawn = next.playerDraw.shift();
    next.playerHand.push(instantiateCard(drawn, next.round, next.playerHand.length));
  }
  if (next.enemyDraw.length > 0 && next.enemyHand.length < 7) {
    const eDrawn = next.enemyDraw.shift();
    next.enemyHand.push(instantiateCard(eDrawn, next.round, next.enemyHand.length));
  }
  next.evaluation = evaluateClashLanes(next);
  next.log.push(`—— 第 ${next.round} 回合 · 可用兵力 ${next.energy} 点 ——`);
  return next;
}

/**
 * 一键自动完成剩余卡牌对决回合
 */
export function autoResolveClash(session) {
  let cur = structuredClone(session);
  let guard = 0;
  while (cur && !cur.done && guard < 6) {
    guard += 1;
    let stepGuard = 0;
    while (!cur.done && cur.energy > 0 && stepGuard < 5) {
      stepGuard += 1;
      const affordable = cur.playerHand
        .map((c, idx) => ({ c, idx }))
        .filter(({ c }) => c.cost <= cur.energy)
        .sort((a, b) => b.c.power - a.c.power);
      if (!affordable.length) break;
      let playedThisStep = false;
      for (const candidate of affordable) {
        for (const laneIdx of [0, 1, 2]) {
          const cap = cur.lanes[laneIdx].venue.capOne ? 1 : 4;
          if (cur.lanes[laneIdx].playerCards.length < cap) {
            cur = playClashCard(cur, candidate.idx, laneIdx);
            playedThisStep = true;
            break;
          }
        }
        if (playedThisStep) break;
      }
      if (!playedThisStep) break;
    }
    cur = endClashTurn(cur);
  }
  return cur;
}

/**
 * 结算牌局胜利奖赏并写入国家仓库（每季首胜获正赏，连胜计入 clashStats）
 */
export function applyClashWorldReward(world, state, session) {
  if (!state?.century || !session?.done) {
    return { state, rewardText: "", firstWinThisTurn: false };
  }
  const next = structuredClone(state);
  const saga = ensureSaga(next);
  saga.clashStats ??= { wins: 0, streak: 0, bestStreak: 0, lastRewardTurn: -1 };

  if (session.winner !== "player") {
    saga.clashStats.streak = 0;
    return {
      state: next,
      rewardText: session.winner === "draw" ? "棋逢对手弈和，连胜归零，可再开一局！" : "惜败一着，重整牌阵再战！",
      firstWinThisTurn: false,
    };
  }

  saga.clashStats.wins = (saga.clashStats.wins ?? 0) + 1;
  saga.clashStats.streak = (saga.clashStats.streak ?? 0) + 1;
  saga.clashStats.bestStreak = Math.max(saga.clashStats.bestStreak ?? 0, saga.clashStats.streak);

  const firstWinThisTurn = saga.clashStats.lastRewardTurn !== next.turn;
  const wuchaoWon = session.lanes.some((l, i) => l.venue.id === "wuchao" && session.evaluation?.laneScores?.[i]?.leader === "player");

  if (firstWinThisTurn) {
    saga.clashStats.lastRewardTurn = next.turn;
    const f = next.factions?.[next.player];
    if (f) {
      f.treasury = Math.max(0, Math.round((f.treasury ?? 0) + 90));
      f.grain = Math.max(0, Math.round((f.grain ?? 0) + 140 + (wuchaoWon ? 120 : 0)));
    }
    saga.tech ??= { points: 0, unlocked: [] };
    saga.tech.points = Math.min(9999, (saga.tech.points ?? 0) + 24);
    saga.reputation = clamp((saga.reputation ?? 50) + 4, 0, 100);

    const enemyFront = Object.entries(next.cities || {}).find(([, c]) => c?.owner && c.owner !== next.player)?.[0];
    if (enemyFront) {
      saga.rumors ??= {};
      saga.rumors[enemyFront] = next.turn + 2;
    }

    const extraNote = wuchaoWon ? "· 兼夺「乌巢粮道」额外获 +120 粮" : "";
    recordAnnal(next, "九州兵法局", `三路演兵击败${session.enemyName}（${saga.clashStats.streak}连胜），获府库 +90、粮草 +${140 + (wuchaoWon ? 120 : 0)}、兵技 +24、声望 +4。`);
    return {
      state: next,
      rewardText: `🏆 牌局克捷（${saga.clashStats.streak} 连胜）！府库 +90 · 粮草 +${140 + (wuchaoWon ? 120 : 0)} · 兵技 +24 · 声望 +4 ${extraNote}`,
      firstWinThisTurn: true,
    };
  }

  return {
    state: next,
    rewardText: `🔥 再捷一场！当前牌局 ${saga.clashStats.streak} 连胜（最佳 ${saga.clashStats.bestStreak} 连胜；本季资源赏赐已领）。`,
    firstWinThisTurn: false,
  };
}
