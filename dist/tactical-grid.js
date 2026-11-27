// v25.0 — 7×5 微型战术棋盘引擎
// 4 兵种（主帅步兵 / 先锋骑兵 / 神臂弓兵 / 火攻器械）× 多地形（平川/密林/高地/浅滩/城垣/粮仓/烈焰）× 风向蔓延火攻

export const GRID_COLS = 7;
export const GRID_ROWS = 5;

export const TERRAIN_META = {
  plain: {
    id: "plain",
    name: "平川",
    icon: "🌾",
    moveCost: 1,
    defBonus: 0,
    atkBonus: 0,
    rangeBonus: 0,
    flammable: false,
    destructible: false,
    summary: "地势开阔，通行无阻。",
  },
  forest: {
    id: "forest",
    name: "密林",
    icon: "🌲",
    moveCost: 2,
    defBonus: 0.2,
    atkBonus: 0,
    rangeBonus: 0,
    flammable: true,
    destructible: false,
    summary: "林木掩蔽（受击减伤 20%），可被火计点燃顺风蔓延。",
  },
  hill: {
    id: "hill",
    name: "高地",
    icon: "⛰️",
    moveCost: 2,
    defBonus: 0.25,
    atkBonus: 0.15,
    rangeBonus: 1,
    flammable: false,
    destructible: false,
    summary: "居高临下（受击减伤 25%，攻击 +15%，远程射程 +1）。",
  },
  ford: {
    id: "ford",
    name: "浅滩",
    icon: "🌊",
    moveCost: 2,
    defBonus: -0.1,
    atkBonus: -0.05,
    rangeBonus: 0,
    flammable: false,
    destructible: false,
    summary: "涉水渡口，移动耗费加倍且受击增伤 10%，火势不可逾越。",
  },
  wall: {
    id: "wall",
    name: "城垣",
    icon: "🧱",
    moveCost: 99,
    defBonus: 0.4,
    atkBonus: 0,
    rangeBonus: 0,
    flammable: false,
    destructible: true,
    summary: "坚城壁垒，阻断通行；攻破后可长驱直入。",
  },
  depot: {
    id: "depot",
    name: "粮仓",
    icon: "🏮",
    moveCost: 1,
    defBonus: 0.1,
    atkBonus: 0,
    rangeBonus: 0,
    flammable: true,
    destructible: true,
    objective: true,
    summary: "敌军屯粮枢纽！摧毁或焚毁后敌防大减、极易阵前倒戈。",
  },
  fire: {
    id: "fire",
    name: "烈焰",
    icon: "🔥",
    moveCost: 2,
    defBonus: -0.2,
    atkBonus: -0.1,
    rangeBonus: 0,
    burnDamage: 18,
    flammable: false,
    destructible: false,
    summary: "火海熊熊：踏入或滞留单位每回合损血，受击增伤 20%。",
  },
};

export const UNIT_TYPES = {
  infantry: {
    type: "infantry",
    name: "主帅步兵",
    shortName: "步",
    icon: "🛡️",
    move: 2,
    range: 1,
    maxHp: 125,
    atk: 36,
    def: 12,
    canIgnite: false,
    siegeMult: 1.0,
    role: "稳阵抗线",
  },
  cavalry: {
    type: "cavalry",
    name: "先锋骑兵",
    shortName: "骑",
    icon: "🐎",
    move: 4,
    range: 1,
    maxHp: 100,
    atk: 40,
    def: 8,
    canIgnite: false,
    siegeMult: 0.95,
    chargeBonus: 0.22,
    role: "疾驰凿阵",
  },
  archer: {
    type: "archer",
    name: "神臂弓兵",
    shortName: "弓",
    icon: "🏹",
    move: 2,
    range: 2,
    maxHp: 85,
    atk: 33,
    def: 6,
    canIgnite: false,
    siegeMult: 0.85,
    role: "登高齐射",
  },
  firecatapult: {
    type: "firecatapult",
    name: "火攻器械",
    shortName: "火",
    icon: "🔥",
    move: 2,
    range: 2,
    maxHp: 85,
    atk: 35,
    def: 5,
    canIgnite: true,
    siegeMult: 1.65,
    role: "纵火破城",
  },
};

export const WIND_DIRS = [
  { key: "east", label: "东风（吹向东阵）", short: "东风 →", dx: 1, dy: 0 },
  { key: "south", label: "南风（吹向南翼）", short: "南风 ↓", dx: 0, dy: 1 },
  { key: "west", label: "西风（吹向西阵）", short: "西风 ←", dx: -1, dy: 0 },
  { key: "north", label: "北风（吹向北翼）", short: "北风 ↑", dx: 0, dy: -1 },
];

export const GRID_SKILLS = {
  shift_wind: {
    id: "shift_wind",
    name: "借东风",
    cost: 25,
    targetMode: "instant",
    icon: "🌬️",
    summary: "耗 25 战意，顺时针改变战场风向，令纵火转道延烧敌营。",
  },
  knockback: {
    id: "knockback",
    name: "破阵击退",
    cost: 30,
    targetMode: "armed",
    icon: "💥",
    summary: "耗 30 战意蓄势：下次攻击敌将退 1 格；撞墙/撞兵 +22 撞伤，入火 +18 灼烧！",
  },
  ambush: {
    id: "ambush",
    name: "密林伏兵",
    cost: 45,
    targetMode: "forest",
    icon: "🌿",
    summary: "耗 45 战意，择一无人密林唤出「伏兵奇袭营」即刻参战！",
  },
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function hashSeed(str) {
  let h = 2166136261;
  const s = String(str || "sanguo");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function effectiveRange(unit, tiles) {
  const tile = tiles?.[unit.y]?.[unit.x];
  const bonus = tile?.terrain === "hill" ? 1 : 0;
  return unit.range + bonus;
}

function buildGridTiles(terrainKind, season, seed) {
  const tiles = [];
  for (let y = 0; y < GRID_ROWS; y += 1) {
    const row = [];
    for (let x = 0; x < GRID_COLS; x += 1) {
      row.push({
        x,
        y,
        terrain: "plain",
        wallHp: 0,
        wallMaxHp: 0,
        depotHp: 0,
        depotMaxHp: 0,
        burnTurns: 0,
      });
    }
    tiles.push(row);
  }

  // 基础战略地形配置（兼顾视觉辨识与路径多择）
  tiles[0][2].terrain = "forest";
  tiles[1][2].terrain = "hill";
  tiles[3][2].terrain = "hill";
  tiles[4][2].terrain = "forest";

  tiles[1][4].terrain = "forest";
  tiles[2][3].terrain = seed % 2 === 0 ? "hill" : "forest";
  tiles[3][4].terrain = "forest";
  tiles[0][4].terrain = "ford";
  tiles[4][4].terrain = "forest";

  if (terrainKind === "water" || terrainKind === "river" || season === "夏") {
    tiles[1][3].terrain = "ford";
    tiles[3][3].terrain = "ford";
  } else if (terrainKind === "mountain" || terrainKind === "pass") {
    tiles[1][3].terrain = "hill";
    tiles[2][4].terrain = "hill";
  }

  // 敌军前沿城垣（col 5，留出中央及一侧通道可绕行或破城）
  for (const wy of [1, 3]) {
    tiles[wy][5] = {
      x: 5,
      y: wy,
      terrain: "wall",
      wallHp: 65,
      wallMaxHp: 65,
      depotHp: 0,
      depotMaxHp: 0,
      burnTurns: 0,
    };
  }
  tiles[0][5].terrain = "forest";

  // 敌后核心目标：屯粮仓（6, 2）或边翼粮仓
  const depotRow = seed % 3 === 0 ? 1 : seed % 3 === 1 ? 2 : 3;
  tiles[depotRow][6] = {
    x: 6,
    y: depotRow,
    terrain: "depot",
    wallHp: 0,
    wallMaxHp: 0,
    depotHp: 80,
    depotMaxHp: 80,
    burnTurns: 0,
  };

  return { tiles, depotPos: { x: 6, y: depotRow } };
}

function makeUnit({ id, side, type, name, x, y, statBonus = 0, hpMult = 1 }) {
  const tpl = UNIT_TYPES[type];
  const maxHp = Math.round(tpl.maxHp * hpMult);
  return {
    id,
    side,
    type: tpl.type,
    name: name || tpl.name,
    shortName: tpl.shortName,
    icon: tpl.icon,
    move: tpl.move,
    range: tpl.range,
    hp: maxHp,
    maxHp,
    atk: Math.round(tpl.atk * (1 + statBonus)),
    def: tpl.def,
    canIgnite: tpl.canIgnite,
    siegeMult: tpl.siegeMult,
    chargeBonus: tpl.chargeBonus || 0,
    x,
    y,
    moved: false,
    acted: false,
    moveDist: 0,
  };
}

/**
 * 创建 7×5 微型战术棋盘战役会话
 */
export function createGridBattle({
  fromName = "己城",
  toName = "敌城",
  attackerName = "主将",
  defenderName = "守将",
  attacker = null,
  defender = null,
  attackerTroops = 8000,
  defenderTroops = 6000,
  terrain = "land",
  season = "春",
  targetCut = false,
  siegeTurns = 0,
  insiderActive = false,
  baseOffense = 10000,
  baseDefense = 10000,
  wind = null,
} = {}) {
  const seed = hashSeed(`${fromName}:${toName}:${attackerName}:${defenderName}:${season}`);
  const chosenWind = wind && WIND_DIRS.some((w) => w.key === wind)
    ? WIND_DIRS.find((w) => w.key === wind)
    : WIND_DIRS[(season === "冬" ? 2 : seed) % 3]; // 东风为主，利于纵火焚城

  const { tiles, depotPos } = buildGridTiles(terrain, season, seed);
  const atkCmd = attacker?.command ?? 76;
  const atkWar = attacker?.war ?? attacker?.command ?? 75;
  const atkInt = attacker?.intel ?? attacker?.politics ?? 74;
  const defCmd = defender?.command ?? 72;
  const defWar = defender?.war ?? defender?.command ?? 72;

  const ratio = clamp(attackerTroops / Math.max(1200, defenderTroops), 0.72, 1.45);
  const atkStatBonus = clamp((atkCmd - 72) * 0.005, -0.1, 0.22);
  const defStatBonus = clamp((defCmd - 72) * 0.004, -0.1, 0.18);

  const playerUnits = [
    makeUnit({
      id: "p_inf",
      side: "player",
      type: "infantry",
      name: `${attackerName}·中军`,
      x: 1,
      y: 2,
      statBonus: atkStatBonus + (atkCmd - 70) * 0.003,
      hpMult: clamp(0.95 + (ratio - 1) * 0.25, 0.85, 1.25),
    }),
    makeUnit({
      id: "p_cav",
      side: "player",
      type: "cavalry",
      name: "先锋铁骑",
      x: 1,
      y: 0,
      statBonus: atkStatBonus + (atkWar - 70) * 0.004,
      hpMult: clamp(0.95 + (ratio - 1) * 0.2, 0.85, 1.2),
    }),
    makeUnit({
      id: "p_arc",
      side: "player",
      type: "archer",
      name: "神臂强弩",
      x: 0,
      y: 3,
      statBonus: atkStatBonus + (atkCmd - 70) * 0.002,
      hpMult: 1,
    }),
    makeUnit({
      id: "p_fire",
      side: "player",
      type: "firecatapult",
      name: "霹雳火炮",
      x: 0,
      y: 1,
      statBonus: atkStatBonus + (atkInt - 70) * 0.004,
      hpMult: 1,
    }),
  ];

  // 若攻势具有断粮或内应优势，适当削弱敌方守备兵血量
  const enemyHpMult = clamp((targetCut ? 0.84 : 1) * (insiderActive ? 0.9 : 1) * (2 - ratio * 0.35) * 0.62, 0.72, 1.22);
  const enemyUnits = [
    makeUnit({
      id: "e_inf",
      side: "enemy",
      type: "infantry",
      name: `${defenderName}·守卫`,
      x: 6,
      y: depotPos.y === 2 ? 1 : 2,
      statBonus: defStatBonus + (defWar - 70) * 0.003,
      hpMult: enemyHpMult,
    }),
    makeUnit({
      id: "e_guard",
      side: "enemy",
      type: "infantry",
      name: "瓮城盾卫",
      x: 5,
      y: 2,
      statBonus: defStatBonus,
      hpMult: enemyHpMult * 0.95,
    }),
    makeUnit({
      id: "e_arc",
      side: "enemy",
      type: "archer",
      name: "城头箭阵",
      x: 5,
      y: 4,
      statBonus: defStatBonus,
      hpMult: enemyHpMult * 0.9,
    }),
    makeUnit({
      id: "e_cav",
      side: "enemy",
      type: "cavalry",
      name: "突袭游骑",
      x: 6,
      y: 0,
      statBonus: defStatBonus,
      hpMult: enemyHpMult * 0.9,
    }),
  ];

  const introHints = [];
  if (targetCut) introHints.push("敌军粮道已断，守军士气动摇");
  if (insiderActive) introHints.push("城内细作已通消息，可直取粮仓");
  if (siegeTurns > 0) introHints.push(`围城已历 ${siegeTurns} 季`);

  return {
    mode: "grid",
    fromName,
    toName,
    attackerName,
    defenderName,
    terrain,
    season,
    targetCut,
    siegeTurns,
    insiderActive,
    baseOffense,
    baseDefense,
    attackerTroops,
    defenderTroops,
    wind: chosenWind,
    round: 1,
    maxRounds: 6,
    turnSide: "player",
    selectedUnitId: "p_inf",
    tiles,
    depotPos,
    depotDestroyed: false,
    wallsDestroyed: 0,
    firesIgnited: 0,
    units: [...playerUnits, ...enemyUnits],
    done: false,
    outcome: null,
    surrenderTriggered: false,
    spirit: 40,
    maxSpirit: 100,
    armedSkill: null,
    duelUsed: false,
    duelOutcome: null,
    duelWon: false,
    duelAtkBonus: 0,
    duelDefPenalty: 0,
    lastFx: [],
    atkMult: 1,
    defMult: 1,
    lossMult: 1,
    log: [
      `【布阵已毕】${fromName}出兵直逼${toName}，今日风向「${chosenWind.short}」。`
      + (introHints.length ? `（${introHints.join(" · ")}）` : "善用高地射程与火攻烧毁敌军粮仓（6, " + depotPos.y + "），可一举溃敌！"),
    ],
  };
}

export function tileAt(session, x, y) {
  if (!session?.tiles || y < 0 || y >= GRID_ROWS || x < 0 || x >= GRID_COLS) return null;
  return session.tiles[y][x];
}

export function unitAt(session, x, y) {
  return (session?.units || []).find((u) => u.hp > 0 && u.x === x && u.y === y) || null;
}

/**
 * 计算单位当前可移动到的格子（BFS 最短路，含地形消耗）
 */
export function reachableTiles(session, unitId) {
  const unit = (session?.units || []).find((u) => u.id === unitId && u.hp > 0);
  if (!unit || unit.moved || session.done) return [];

  const bestCost = new Map();
  const queue = [{ x: unit.x, y: unit.y, cost: 0 }];
  bestCost.set(`${unit.x},${unit.y}`, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const tile = tileAt(session, nx, ny);
      if (!tile) continue;
      if (tile.terrain === "wall" && tile.wallHp > 0) continue;
      const occ = unitAt(session, nx, ny);
      if (occ && occ.side !== unit.side) continue; // 敌军阻挡通行

      const stepCost = tile.terrain === "fire" && unit.canIgnite ? 1 : (TERRAIN_META[tile.terrain]?.moveCost ?? 1);
      const nextCost = cur.cost + stepCost;
      if (nextCost > unit.move) continue;
      const key = `${nx},${ny}`;
      if (!bestCost.has(key) || nextCost < bestCost.get(key)) {
        bestCost.set(key, nextCost);
        queue.push({ x: nx, y: ny, cost: nextCost });
      }
    }
  }

  const out = [];
  for (const [key, cost] of bestCost.entries()) {
    const [x, y] = key.split(",").map(Number);
    if (x === unit.x && y === unit.y) continue;
    if (unitAt(session, x, y)) continue; // 不能停留在友军格子上
    out.push({ x, y, cost });
  }
  return out;
}

export function isFlankedByAlly(session, attacker, defender) {
  if (!session || !attacker || !defender) return false;
  return (session.units || []).some((u) => (
    u.hp > 0
    && u.side === attacker.side
    && u.id !== attacker.id
    && manhattan(u.x, u.y, defender.x, defender.y) === 1
  ));
}

function estimateDamage(session, attacker, targetUnit = null, targetTile = null) {
  const atkTile = tileAt(session, attacker.x, attacker.y);
  const atkTerrain = TERRAIN_META[atkTile?.terrain || "plain"];
  let raw = attacker.atk * (1 + (atkTerrain.atkBonus || 0));
  if (attacker.type === "cavalry" && attacker.moveDist >= 2) {
    raw *= 1 + attacker.chargeBonus;
  }
  if (targetUnit && isFlankedByAlly(session, attacker, targetUnit)) {
    raw *= 1.28;
  }
  if (targetUnit) {
    const defTile = tileAt(session, targetUnit.x, targetUnit.y);
    const defTerrain = TERRAIN_META[defTile?.terrain || "plain"];
    const dmg = Math.max(8, Math.round(raw * (1 - clamp(defTerrain.defBonus || 0, -0.35, 0.55)) - targetUnit.def * 0.55));
    return dmg;
  }
  if (targetTile?.terrain === "wall" || targetTile?.terrain === "depot") {
    return Math.max(12, Math.round(raw * attacker.siegeMult));
  }
  return Math.max(10, Math.round(raw));
}

/**
 * 列出单位当前射程内可攻击的目标（敌方单位、城垣、粮仓、可燃密林）
 */
export function attackableTargets(session, unitId) {
  const unit = (session?.units || []).find((u) => u.id === unitId && u.hp > 0);
  if (!unit || unit.acted || session.done) return [];
  const range = effectiveRange(unit, session.tiles);
  const targets = [];

  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const dist = manhattan(unit.x, unit.y, x, y);
      if (dist === 0 || dist > range) continue;
      const occ = unitAt(session, x, y);
      const tile = tileAt(session, x, y);
      if (occ && occ.side !== unit.side) {
        const flanked = isFlankedByAlly(session, unit, occ);
        let knockbackCrash = false;
        if (unit.side === "player" && session.armedSkill === "knockback") {
          const dxRaw = x - unit.x;
          const dyRaw = y - unit.y;
          const dx = Math.abs(dxRaw) >= Math.abs(dyRaw) ? Math.sign(dxRaw) : 0;
          const dy = Math.abs(dyRaw) > Math.abs(dxRaw) ? Math.sign(dyRaw) : 0;
          const kTile = tileAt(session, x + dx, y + dy);
          const kOcc = unitAt(session, x + dx, y + dy);
          knockbackCrash = !kTile || (kTile.terrain === "wall" && kTile.wallHp > 0) || Boolean(kOcc) || kTile.terrain === "fire";
        }
        targets.push({
          kind: "unit",
          id: occ.id,
          x,
          y,
          name: occ.name,
          flanked,
          knockbackCrash,
          previewDmg: estimateDamage(session, unit, occ, null),
        });
        continue;
      }
      if (unit.side === "player" && tile) {
        if (tile.terrain === "wall" && tile.wallHp > 0) {
          targets.push({
            kind: "wall",
            id: `wall_${x}_${y}`,
            x,
            y,
            name: "敌军城垣",
            previewDmg: estimateDamage(session, unit, null, tile),
          });
        } else if (tile.terrain === "depot" && tile.depotHp > 0 && !session.depotDestroyed) {
          targets.push({
            kind: "depot",
            id: `depot_${x}_${y}`,
            x,
            y,
            name: "敌军粮仓",
            previewDmg: estimateDamage(session, unit, null, tile),
          });
        } else if (unit.canIgnite && tile.terrain === "forest" && !occ) {
          targets.push({
            kind: "forest",
            id: `forest_${x}_${y}`,
            x,
            y,
            name: "密林纵火",
            previewDmg: 18,
          });
        }
      }
    }
  }
  return targets;
}

function applyFinalBattleStats(session) {
  const alivePlayers = session.units.filter((u) => u.side === "player" && u.hp > 0);
  const aliveEnemies = session.units.filter((u) => u.side === "enemy" && u.hp > 0);
  const playerHpPct = alivePlayers.reduce((s, u) => s + u.hp / u.maxHp, 0) / Math.max(1, session.units.filter((u) => u.side === "player").length);
  const enemyHpPct = aliveEnemies.reduce((s, u) => s + u.hp / u.maxHp, 0) / Math.max(1, session.units.filter((u) => u.side === "enemy").length);

  if (aliveEnemies.length === 0) {
    session.done = true;
    session.outcome = "victory";
  } else if (alivePlayers.length === 0) {
    session.done = true;
    session.outcome = "defeat";
  } else if (session.round > session.maxRounds) {
    session.done = true;
    session.outcome = playerHpPct >= enemyHpPct || session.depotDestroyed ? "victory" : "defeat";
  }

  let atkMult = 1 + (0.65 - enemyHpPct) * 0.65 + (session.depotDestroyed ? 0.16 : 0) + (session.wallsDestroyed * 0.05) + (session.duelAtkBonus || 0);
  let defMult = 1 - (1 - enemyHpPct) * 0.38 - (session.depotDestroyed ? 0.2 : 0) - (session.wallsDestroyed * 0.08) - (session.duelDefPenalty || 0);
  let lossMult = 1 - (playerHpPct - 0.55) * 0.45 - (session.depotDestroyed ? 0.12 : 0) - (session.duelWon ? 0.08 : 0);

  if (session.outcome === "defeat" && alivePlayers.length === 0) {
    atkMult = Math.min(atkMult, 0.86);
    defMult = Math.max(defMult, 1.08);
    lossMult = Math.max(lossMult, 1.2);
  }

  session.atkMult = Number(clamp(atkMult, 0.78, 1.72).toFixed(3));
  session.defMult = Number(clamp(defMult, 0.45, 1.22).toFixed(3));
  session.lossMult = Number(clamp(lossMult, 0.45, 1.38).toFixed(3));

  if (session.outcome === "victory" && session.depotDestroyed && (aliveEnemies.length <= 1 || session.targetCut || session.insiderActive || session.duelWon)) {
    session.surrenderTriggered = true;
    session.defMult = Math.min(session.defMult, 0.52);
    session.lossMult = Math.min(session.lossMult, 0.54);
  }
}

function pushFx(session, x, y, text, kind = "dmg") {
  session.lastFx ??= [];
  session.lastFx.push({ x, y, text, kind });
}

function addSpirit(session, amount) {
  session.spirit = clamp((session.spirit ?? 40) + amount, 0, session.maxSpirit ?? 100);
}

/**
 * 列出所有可召唤「密林伏兵」的空闲密林格
 */
export function validAmbushTiles(session) {
  if (!session?.tiles || session.done) return [];
  const out = [];
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const tile = tileAt(session, x, y);
      if (tile?.terrain === "forest" && !unitAt(session, x, y)) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

/**
 * 释放战场战意主动技：借东风 / 破阵击退 / 密林伏兵
 */
export function castGridSkill(session, skillId, targetPos = null) {
  if (!session || session.done) return session;
  const skill = GRID_SKILLS[skillId];
  if (!skill) return session;
  const next = structuredClone(session);
  next.lastFx = [];
  const curSpirit = next.spirit ?? 40;

  if (skillId === "shift_wind") {
    if (curSpirit < skill.cost) return session;
    next.spirit = curSpirit - skill.cost;
    const idx = WIND_DIRS.findIndex((w) => w.key === next.wind?.key);
    next.wind = WIND_DIRS[(idx + 1) % WIND_DIRS.length];
    next.armedSkill = null;
    const anchor = next.units.find((u) => u.side === "player" && u.hp > 0) || { x: 1, y: 2 };
    pushFx(next, anchor.x, anchor.y, `${next.wind.short}`, "buff");
    pushLog(next, `🌬️ 施展「借东风」（-${skill.cost} 战意）：战风骤转为「${next.wind.short}」！`);
    return next;
  }

  if (skillId === "knockback") {
    if (next.armedSkill === "knockback") {
      next.armedSkill = null;
      next.spirit = Math.min(next.maxSpirit ?? 100, curSpirit + skill.cost);
      pushLog(next, "已收起「破阵击退」蓄势，战意如数返还。");
      return next;
    }
    if (curSpirit < skill.cost) return session;
    next.spirit = curSpirit - skill.cost;
    next.armedSkill = "knockback";
    pushLog(next, `💥 蓄势「破阵击退」（-${skill.cost} 战意）：下次攻击命中敌军时强力震退 1 格！`);
    return next;
  }

  if (skillId === "ambush") {
    if (!targetPos) {
      if (next.armedSkill === "ambush") {
        next.armedSkill = null;
        return next;
      }
      if (curSpirit < skill.cost || !validAmbushTiles(next).length) return session;
      next.armedSkill = "ambush";
      pushLog(next, "🌿 请在棋盘上点选一处无人密林，伏兵即刻现身奇袭！");
      return next;
    }
    if (curSpirit < skill.cost) return session;
    const valid = validAmbushTiles(next).some((t) => t.x === targetPos.x && t.y === targetPos.y);
    if (!valid) return session;
    next.spirit = curSpirit - skill.cost;
    next.armedSkill = null;
    const ambushId = `p_ambush_${next.round}_${next.units.length}`;
    const ambushUnit = {
      id: ambushId,
      side: "player",
      type: "cavalry",
      name: "伏兵奇袭营",
      shortName: "伏",
      icon: "🌿",
      move: 3,
      range: 1,
      hp: 75,
      maxHp: 75,
      atk: 35,
      def: 7,
      canIgnite: false,
      siegeMult: 1.0,
      chargeBonus: 0.2,
      x: targetPos.x,
      y: targetPos.y,
      moved: false,
      acted: false,
      moveDist: 0,
    };
    next.units.push(ambushUnit);
    next.selectedUnitId = ambushId;
    pushFx(next, targetPos.x, targetPos.y, "伏兵现!", "buff");
    pushLog(next, `🌿 「密林伏兵」于 (${targetPos.x + 1},${targetPos.y + 1}) 杀出（-${skill.cost} 战意），即刻可战！`);
    applyFinalBattleStats(next);
    return next;
  }

  return session;
}

/**
 * 将「阵前无双单挑」的结果真实写入 7×5 战场态势
 */
export function applyBattleDuelToGrid(session, arenaSession) {
  if (!session || session.duelUsed) return session;
  const next = structuredClone(session);
  next.lastFx = [];
  next.duelUsed = true;
  next.duelOutcome = arenaSession?.winner || "draw";

  if (next.duelOutcome === "player") {
    next.duelWon = true;
    next.duelAtkBonus = 0.15;
    next.duelDefPenalty = 0.14;
    addSpirit(next, 35);
    for (const enemy of next.units) {
      if (enemy.side === "enemy" && enemy.hp > 0) {
        const drop = Math.max(10, Math.round(enemy.hp * 0.22));
        enemy.hp = Math.max(5, enemy.hp - drop);
        pushFx(next, enemy.x, enemy.y, `-${drop}破胆`, "crit");
      }
    }
    pushLog(next, `🏆 阵前斗将「${arenaSession.playerName}」大破敌将！敌阵气势溃 -22%，战意 +35，我军攻势猛增！`);
  } else if (next.duelOutcome === "enemy") {
    next.duelAtkBonus = -0.04;
    addSpirit(next, 15);
    pushLog(next, `💢 阵前斗将失利，稳住阵线以奇谋火攻破敌（战意 +15）。`);
  } else {
    addSpirit(next, 20);
    pushLog(next, `🤝 两将阵前激斗平手，鸣金各自回营（战意 +20）。`);
  }

  applyFinalBattleStats(next);
  return next;
}

function igniteTile(session, x, y, reason) {
  const tile = tileAt(session, x, y);
  if (!tile || tile.terrain === "ford" || tile.terrain === "wall" || tile.terrain === "fire") return false;
  if (tile.terrain !== "forest" && tile.terrain !== "depot" && !reason) return false;
  if (tile.terrain === "depot") {
    tile.depotHp = Math.max(0, tile.depotHp - 45);
  }
  tile.terrain = "fire";
  tile.burnTurns = 2;
  session.firesIgnited += 1;
  return true;
}

function triggerDepotDestroyed(session, sourceText) {
  if (session.depotDestroyed) return;
  session.depotDestroyed = true;
  for (const enemy of session.units) {
    if (enemy.side === "enemy" && enemy.hp > 0) {
      enemy.hp = Math.max(8, Math.round(enemy.hp * 0.75));
    }
  }
  session.log.push(`🔥 ${sourceText}！敌军粮仓焚毁，守军全体士气崩溃（战力大减）！`);
}

function pushLog(session, line) {
  session.log.push(line);
  if (session.log.length > 18) session.log = session.log.slice(-18);
}

/**
 * 移动指定单位到目标格
 */
export function moveUnit(session, unitId, x, y) {
  if (!session || session.done) return session;
  const next = structuredClone(session);
  const unit = next.units.find((u) => u.id === unitId && u.hp > 0);
  if (!unit || unit.side !== next.turnSide || unit.moved) return session;
  const allowed = reachableTiles(next, unitId);
  const step = allowed.find((t) => t.x === x && t.y === y);
  if (!step) return session;

  unit.x = x;
  unit.y = y;
  unit.moved = true;
  unit.moveDist = step.cost;

  const landed = tileAt(next, x, y);
  next.lastFx = [];
  if (landed?.terrain === "fire") {
    unit.hp = Math.max(0, unit.hp - (TERRAIN_META.fire.burnDamage || 16));
    pushFx(next, x, y, "-16🔥", "burn");
    pushLog(next, `${unit.icon} ${unit.name} 踏入火海受灼伤（剩余 ${unit.hp} HP）。`);
  } else {
    pushLog(next, `${unit.icon} ${unit.name} 进驻 (${x + 1},${y + 1}) ${TERRAIN_META[landed.terrain].name}。`);
  }
  applyFinalBattleStats(next);
  return next;
}

/**
 * 单位向目标格发起攻击或纵火
 */
export function attackTarget(session, unitId, targetX, targetY) {
  if (!session || session.done) return session;
  const next = structuredClone(session);
  next.lastFx = [];
  const attacker = next.units.find((u) => u.id === unitId && u.hp > 0);
  if (!attacker || attacker.side !== next.turnSide || attacker.acted) return session;
  const validTargets = attackableTargets(next, unitId);
  const picked = validTargets.find((t) => t.x === targetX && t.y === targetY);
  if (!picked) return session;

  attacker.acted = true;
  attacker.moved = true;

  if (picked.kind === "unit") {
    const defender = unitAt(next, targetX, targetY);
    const flanked = isFlankedByAlly(next, attacker, defender);
    const dmg = estimateDamage(next, attacker, defender, null);
    defender.hp = Math.max(0, defender.hp - dmg);
    addSpirit(next, (defender.hp <= 0 ? 25 : 15) + (flanked && attacker.side === "player" ? 12 : 0));
    pushFx(next, targetX, targetY, flanked ? `-${dmg} 夹击!` : `-${dmg}`, flanked ? "crit" : "dmg");
    let note = `${attacker.icon} ${attacker.name} 痛击 ${defender.name}，造成 ${dmg} 点杀伤` + (flanked ? "（夹击暴击 ×1.28！）" : "");

    // v26.0 破阵击退 + 撞墙/撞敌/入火连锁伤害
    if (next.armedSkill === "knockback" && attacker.side === "player") {
      next.armedSkill = null;
      if (defender.hp > 0) {
        const dxRaw = targetX - attacker.x;
        const dyRaw = targetY - attacker.y;
        const dx = Math.abs(dxRaw) >= Math.abs(dyRaw) ? Math.sign(dxRaw) : 0;
        const dy = Math.abs(dyRaw) > Math.abs(dxRaw) ? Math.sign(dyRaw) : 0;
        const kx = targetX + dx;
        const ky = targetY + dy;
        const kTile = tileAt(next, kx, ky);
        const kOcc = unitAt(next, kx, ky);
        if (!kTile || (kTile.terrain === "wall" && kTile.wallHp > 0) || kOcc) {
          defender.hp = Math.max(0, defender.hp - 22);
          pushFx(next, targetX, targetY, "撞击-22!", "crit");
          note += "；💥击退撞壁/撞阵追加 22 暴击伤";
        } else {
          defender.x = kx;
          defender.y = ky;
          if (kTile.terrain === "fire") {
            defender.hp = Math.max(0, defender.hp - 18);
            pushFx(next, kx, ky, "坠火-18🔥", "burn");
            note += "；💥击退落入火海额外灼伤 18";
          } else {
            pushFx(next, kx, ky, "击退!", "crit");
            note += "；💥震退 1 格";
          }
        }
      }
    }

    // 火攻器械攻击自带点燃油火与顺风蔓延
    if (attacker.canIgnite) {
      const windX = targetX + next.wind.dx;
      const windY = targetY + next.wind.dy;
      const windTile = tileAt(next, windX, windY);
      if (windTile && (windTile.terrain === "forest" || windTile.terrain === "depot")) {
        const wasDepot = windTile.terrain === "depot";
        igniteTile(next, windX, windY, true);
        pushFx(next, windX, windY, "延烧🔥", "burn");
        note += `，火星借${next.wind.short}引燃(${windX + 1},${windY + 1})`;
        if (wasDepot) triggerDepotDestroyed(next, `${attacker.name}火矢顺风引燃粮仓`);
      }
    }

    if (defender.hp <= 0) {
      note += "，敌阵全歼！";
      pushLog(next, note);
    } else {
      // 反击判定（仅近战或射程覆盖时反击，反击伤害略减）
      const dist = manhattan(attacker.x, attacker.y, defender.x, defender.y);
      if (dist <= effectiveRange(defender, next.tiles)) {
        const counterDmg = Math.max(4, Math.round(estimateDamage(next, defender, attacker, null) * 0.55));
        attacker.hp = Math.max(0, attacker.hp - counterDmg);
        pushFx(next, attacker.x, attacker.y, `-${counterDmg}`, "dmg");
        note += `；敌反击致 ${counterDmg} 伤。`;
      } else {
        note += "。";
      }
      pushLog(next, note);
    }
  } else if (picked.kind === "wall") {
    const tile = tileAt(next, targetX, targetY);
    const dmg = estimateDamage(next, attacker, null, tile);
    tile.wallHp = Math.max(0, tile.wallHp - dmg);
    addSpirit(next, tile.wallHp <= 0 ? 25 : 15);
    pushFx(next, targetX, targetY, tile.wallHp <= 0 ? "破城!" : `-${dmg}`, tile.wallHp <= 0 ? "crit" : "dmg");
    if (tile.wallHp <= 0) {
      tile.terrain = "plain";
      next.wallsDestroyed += 1;
      pushLog(next, `💥 ${attacker.name} 轰垮 (${targetX + 1},${targetY + 1}) 城垣，打开破城缺口！`);
    } else {
      pushLog(next, `${attacker.name} 轰击城垣造成 ${dmg} 破坏（剩余耐久 ${tile.wallHp}）。`);
    }
  } else if (picked.kind === "depot") {
    const tile = tileAt(next, targetX, targetY);
    const dmg = attacker.canIgnite ? tile.depotHp : estimateDamage(next, attacker, null, tile);
    tile.depotHp = Math.max(0, tile.depotHp - dmg);
    addSpirit(next, 25);
    pushFx(next, targetX, targetY, tile.depotHp <= 0 ? "焚仓大溃!" : `-${dmg}`, "crit");
    if (tile.depotHp <= 0) {
      tile.terrain = "fire";
      tile.burnTurns = 2;
      triggerDepotDestroyed(next, `${attacker.name} 摧毁敌军粮仓`);
    } else {
      pushLog(next, `${attacker.name} 突袭粮仓造成 ${dmg} 损毁（剩余 ${tile.depotHp}）。`);
    }
  } else if (picked.kind === "forest") {
    igniteTile(next, targetX, targetY, true);
    addSpirit(next, 15);
    pushFx(next, targetX, targetY, "纵火🔥", "burn");
    pushLog(next, `🔥 ${attacker.name} 举火焚林 (${targetX + 1},${targetY + 1})，烟焰顺风而起！`);
    // 顺风蔓延相邻密林/粮仓
    const wx = targetX + next.wind.dx;
    const wy = targetY + next.wind.dy;
    const wt = tileAt(next, wx, wy);
    if (wt && (wt.terrain === "forest" || wt.terrain === "depot")) {
      const wasDepot = wt.terrain === "depot";
      igniteTile(next, wx, wy, true);
      pushFx(next, wx, wy, "顺风延烧🔥", "burn");
      if (wasDepot) triggerDepotDestroyed(next, "密林大火借风延烧至敌军粮仓");
    }
  }

  applyFinalBattleStats(next);
  return next;
}

function advanceFireAndSpread(session) {
  const toSpread = [];
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const tile = session.tiles[y][x];
      if (tile.terrain === "fire") {
        const u = unitAt(session, x, y);
        if (u) {
          u.hp = Math.max(0, u.hp - 15);
          pushLog(session, `🔥 烈焰灼烧 ${u.name}（-15 HP）。`);
        }
        // 顺风蔓延到可燃格
        const nx = x + session.wind.dx;
        const ny = y + session.wind.dy;
        const nt = tileAt(session, nx, ny);
        if (nt && (nt.terrain === "forest" || nt.terrain === "depot")) {
          toSpread.push({ x: nx, y: ny, wasDepot: nt.terrain === "depot" });
        }
        tile.burnTurns = Math.max(0, (tile.burnTurns || 1) - 1);
        if (tile.burnTurns === 0) tile.terrain = "plain";
      }
    }
  }
  for (const s of toSpread) {
    igniteTile(session, s.x, s.y, true);
    if (s.wasDepot) triggerDepotDestroyed(session, "顺风火势延烧并摧毁敌军粮仓");
  }
}

function runEnemyTurn(session) {
  session.turnSide = "enemy";
  const enemies = session.units.filter((u) => u.side === "enemy" && u.hp > 0);
  for (const enemy of enemies) {
    enemy.moved = false;
    enemy.acted = false;
    const players = session.units.filter((u) => u.side === "player" && u.hp > 0);
    if (!players.length) break;

    // 若射程内已有玩家单位，先判断是否能移动到高地/更好攻击位；否则直接趋近最近玩家单位
    const immediateTargets = attackableTargets(session, enemy.id);
    if (!immediateTargets.length) {
      const reach = reachableTiles(session, enemy.id);
      if (reach.length) {
        let bestTile = reach[0];
        let bestScore = -1e9;
        for (const candidate of reach) {
          const tMeta = TERRAIN_META[tileAt(session, candidate.x, candidate.y).terrain];
          const minPlayerDist = Math.min(...players.map((p) => manhattan(candidate.x, candidate.y, p.x, p.y)));
          const firePenalty = tMeta.id === "fire" ? -60 : 0;
          const hillBonus = tMeta.id === "hill" ? 8 : 0;
          const score = -minPlayerDist * 12 + hillBonus + firePenalty;
          if (score > bestScore) {
            bestScore = score;
            bestTile = candidate;
          }
        }
        enemy.x = bestTile.x;
        enemy.y = bestTile.y;
        enemy.moved = true;
        enemy.moveDist = bestTile.cost;
      }
    }

    const targetsAfterMove = attackableTargets(session, enemy.id);
    if (targetsAfterMove.length) {
      targetsAfterMove.sort((a, b) => b.previewDmg - a.previewDmg);
      const t = targetsAfterMove[0];
      const def = unitAt(session, t.x, t.y);
      if (def) {
        const dmg = estimateDamage(session, enemy, def, null);
        def.hp = Math.max(0, def.hp - dmg);
        enemy.acted = true;
        let msg = `⚔️ 敌「${enemy.name}」反扑 ${def.name}，造成 ${dmg} 伤`;
        if (def.hp <= 0) msg += "（溃散）";
        else if (manhattan(enemy.x, enemy.y, def.x, def.y) <= effectiveRange(def, session.tiles)) {
          const rep = Math.max(4, Math.round(estimateDamage(session, def, enemy, null) * 0.5));
          enemy.hp = Math.max(0, enemy.hp - rep);
          msg += `，我反击 ${rep} 伤`;
        }
        pushLog(session, msg + "。");
      }
    }
  }
}

/**
 * 结束玩家本轮操作：触发火势蔓延、敌军AI行动并推进到下一回合
 */
export function endPlayerRound(session) {
  if (!session || session.done) return session;
  let next = structuredClone(session);
  next.lastFx = [];
  next.armedSkill = null;
  advanceFireAndSpread(next);
  applyFinalBattleStats(next);
  if (next.done) return next;

  runEnemyTurn(next);
  next.turnSide = "player";
  next.round += 1;
  addSpirit(next, 10);
  for (const u of next.units) {
    u.moved = false;
    u.acted = false;
    u.moveDist = 0;
  }
  applyFinalBattleStats(next);
  if (!next.done) {
    pushLog(next, `—— 第 ${next.round} / ${next.maxRounds} 回合（战意 +10）——`);
  }
  return next;
}

/**
 * 一键自动指挥完成剩余棋盘回合
 */
export function autoResolveGridBattle(session) {
  let cur = structuredClone(session);
  let guard = 0;
  while (cur && !cur.done && guard < 12) {
    guard += 1;
    const myUnits = cur.units.filter((u) => u.side === "player" && u.hp > 0);
    for (const u of myUnits) {
      if (cur.done) break;
      const fresh = cur.units.find((x) => x.id === u.id && x.hp > 0);
      if (!fresh) continue;

      let direct = attackableTargets(cur, fresh.id);
      if (!direct.length && !fresh.moved) {
        const reach = reachableTiles(cur, fresh.id);
        if (reach.length) {
          const enemies = cur.units.filter((e) => e.side === "enemy" && e.hp > 0);
          let bestStep = reach[0];
          let bestScore = -1e9;
          for (const step of reach) {
            const tile = tileAt(cur, step.x, step.y);
            if (tile.terrain === "fire") continue;
            const depotDist = !cur.depotDestroyed ? manhattan(step.x, step.y, cur.depotPos.x, cur.depotPos.y) : 99;
            const enemyDist = enemies.length ? Math.min(...enemies.map((e) => manhattan(step.x, step.y, e.x, e.y))) : 99;
            const targetDist = fresh.canIgnite ? Math.min(depotDist, enemyDist) : Math.min(enemyDist, depotDist + 1);
            const hillScore = tile.terrain === "hill" ? 10 : 0;
            const score = -targetDist * 10 + hillScore + (fresh.type === "cavalry" ? step.cost * 2 : 0);
            if (score > bestScore) {
              bestScore = score;
              bestStep = step;
            }
          }
          cur = moveUnit(cur, fresh.id, bestStep.x, bestStep.y);
        }
      }

      const movedUnit = cur.units.find((x) => x.id === fresh.id && x.hp > 0);
      if (movedUnit && !movedUnit.acted && !cur.done) {
        direct = attackableTargets(cur, movedUnit.id);
        if (direct.length) {
          direct.sort((a, b) => {
            const prio = (t) => (t.kind === "depot" ? 200 : t.kind === "unit" ? 120 + t.previewDmg : t.kind === "wall" ? 90 : 40);
            return prio(b) - prio(a);
          });
          cur = attackTarget(cur, movedUnit.id, direct[0].x, direct[0].y);
        }
      }
    }
    if (!cur.done) cur = endPlayerRound(cur);
  }
  return cur;
}

/**
 * 输出可注入 engine.js 与 sovereign.js 的最终临阵战果修正
 */
export function finalizeGridBattleModifiers(session) {
  if (!session) {
    return {
      atkMult: 1,
      defMult: 1,
      lossMult: 1,
      surrender: false,
      depotDestroyed: false,
      remainingEnemies: 0,
      remainingPlayers: 0,
      roundsUsed: 0,
      summary: "",
      log: [],
    };
  }
  const doneSession = session.done ? session : autoResolveGridBattle(session);
  const remainingEnemies = doneSession.units.filter((u) => u.side === "enemy" && u.hp > 0).length;
  const remainingPlayers = doneSession.units.filter((u) => u.side === "player" && u.hp > 0).length;
  return {
    atkMult: doneSession.atkMult,
    defMult: doneSession.defMult,
    lossMult: doneSession.lossMult,
    surrender: Boolean(doneSession.surrenderTriggered),
    depotDestroyed: Boolean(doneSession.depotDestroyed),
    remainingEnemies,
    remainingPlayers,
    roundsUsed: Math.min(doneSession.round, doneSession.maxRounds),
    log: doneSession.log,
    summary: doneSession.surrenderTriggered
      ? `棋盘克捷·焚粮定鼎：${doneSession.toName}守军闻风请降！`
      : `棋盘微操结案（${doneSession.depotDestroyed ? "粮仓已焚" : `余敌 ${remainingEnemies} 队`}）：攻势 ×${doneSession.atkMult.toFixed(2)}，敌防 ×${doneSession.defMult.toFixed(2)}，战损 ×${doneSession.lossMult.toFixed(2)}。`,
  };
}
