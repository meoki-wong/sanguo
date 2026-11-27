import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceQuarter, createGame, decodeSave } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import {
  ARENA_MOVES, HERO_SIGNATURE_MOVES, applyArenaWorldReward, autoResolveArena,
  createArenaSession, resolveArenaRound,
} from "../dist/duel-arena.js";
import {
  GRID_SKILLS, applyBattleDuelToGrid, attackTarget, castGridSkill, createGridBattle,
  tileAt, unitAt, validAmbushTiles,
} from "../dist/tactical-grid.js";
import {
  ROYAL_DECREE_CARDS, drawRoyalCard, hasPendingRoyalCard, resolveRoyalCard,
} from "../dist/royal-cards.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "cao") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v26.0 duel arena RPS counters, musou rage skill, auto-resolve, and city_debate/free_arena rewards", () => {
  assert.ok(Object.keys(HERO_SIGNATURE_MOVES).length >= 16);
  assert.ok(HERO_SIGNATURE_MOVES["关羽"] && HERO_SIGNATURE_MOVES["诸葛亮"]);
  assert.equal(ARENA_MOVES.duel.length, 4);
  assert.equal(ARENA_MOVES.debate.length, 4);

  let ses = createArenaSession({
    mode: "duel",
    context: "free_arena",
    playerName: "关羽",
    enemyName: "夏侯惇",
    playerStat: 97,
    enemyStat: 88,
  });
  assert.equal(ses.round, 1);
  assert.ok(ses.enemyTell.length > 0);

  // 强制设敌方意向为猛击，测试格挡反震
  ses.enemyIntentId = "strike";
  const blocked = resolveArenaRound(ses, "guard");
  assert.equal(blocked.lastClash.verdict, "格挡反震！");
  assert.ok(blocked.playerRage >= 60);
  assert.ok(blocked.enemyHp < ses.enemyMaxHp);

  // 怒气满 100 释放无双绝技
  blocked.playerRage = 100;
  const musou = resolveArenaRound(blocked, "musou");
  assert.equal(musou.lastClash.shake, true);
  assert.ok(musou.lastClash.dmgToEnemy >= 36);

  const finished = autoResolveArena(musou);
  assert.equal(finished.done, true);
  assert.ok(["player", "enemy", "draw"].includes(finished.winner));

  // 测试敌城舌战得胜写回流言 + 增益 + 声望，及自由演武同季防刷
  let state = makeCenturyGame(208, "liu");
  const enemyCity = Object.keys(state.cities).find((k) => state.cities[k].owner !== "liu");
  const debWin = {
    ...createArenaSession({ mode: "debate", context: "city_debate", playerName: "诸葛亮", enemyName: "蒋干", cityName: enemyCity, targetCityKey: enemyCity }),
    done: true,
    winner: "player",
  };
  const debRes = applyArenaWorldReward(world, state, debWin, { targetCityKey: enemyCity });
  assert.ok(debRes.state.saga.rumors[enemyCity] > state.turn);
  assert.ok(debRes.state.saga.buffs.some((b) => b.label === "舌战扬威"));
  assert.equal(debRes.state.saga.reputation, state.saga.reputation + 5);

  const freeWin = {
    ...createArenaSession({ mode: "duel", context: "free_arena", playerName: "赵云", enemyName: "张辽" }),
    done: true,
    winner: "player",
  };
  const firstFree = applyArenaWorldReward(world, debRes.state, freeWin);
  const techAfter1 = firstFree.state.saga.tech.points;
  assert.equal(firstFree.state.saga.tech.points, debRes.state.saga.tech.points + 15);
  const secondFree = applyArenaWorldReward(world, firstFree.state, freeWin);
  assert.equal(secondFree.state.saga.tech.points, techAfter1); // 同季不重复刷赏
  assert.equal(decodeSave(world, JSON.stringify(secondFree.state)).year, 208);
});

test("v26.0 tactical grid 2.0 spirit skills (wind shift, knockback wall/fire collision, forest ambush, battle duel)", () => {
  assert.equal(GRID_SKILLS.shift_wind.cost, 25);
  let ses = createGridBattle({ wind: "east" });
  assert.equal(ses.spirit, 40);

  // 1) 借东风：东 -> 南
  ses = castGridSkill(ses, "shift_wind");
  assert.equal(ses.wind.key, "south");
  assert.equal(ses.spirit, 15);

  // 2) 密林伏兵：恢复战意后在空密林召唤奇袭营
  ses.spirit = 80;
  const forests = validAmbushTiles(ses);
  assert.ok(forests.length > 0);
  const fTile = forests[0];
  ses = castGridSkill(ses, "ambush", fTile);
  assert.equal(ses.spirit, 35);
  const spawned = unitAt(ses, fTile.x, fTile.y);
  assert.equal(spawned?.shortName, "伏");
  assert.equal(spawned?.acted, false);

  // 3) 破阵击退撞墙 / 撞边追加暴击伤
  ses.spirit = 50;
  ses = castGridSkill(ses, "knockback");
  assert.equal(ses.armedSkill, "knockback");
  assert.equal(ses.spirit, 20);
  const pInf = ses.units.find((u) => u.id === "p_inf");
  const eInf = ses.units.find((u) => u.id === "e_inf");
  // 将敌军置在东侧边缘 (6, 2)，我军步兵在 (5, 2) 攻击触发撞边界 -22！
  ses.tiles[2][5].terrain = "plain";
  ses.tiles[2][6].terrain = "plain";
  for (const u of ses.units) {
    if (u.id !== pInf.id && u.id !== eInf.id && ((u.x === 5 && u.y === 2) || (u.x === 6 && u.y === 2))) {
      u.x = 0; u.y = 4;
    }
  }
  pInf.x = 5; pInf.y = 2; pInf.acted = false;
  eInf.x = 6; eInf.y = 2; eInf.hp = 100;
  const beforeHp = eInf.hp;
  ses = attackTarget(ses, pInf.id, 6, 2);
  const afterEnemy = unitAt(ses, 6, 2);
  // 应受到常规伤害 + 22 碰撞伤害
  assert.ok(beforeHp - afterEnemy.hp >= 40);
  assert.ok(ses.lastFx.some((fx) => fx.kind === "crit"));

  // 4) 阵前叫阵获胜同步敌全体扣血与攻势加成
  const arenaWin = { winner: "player", playerName: "张飞", enemyName: "颜良" };
  const afterDuel = applyBattleDuelToGrid(ses, arenaWin);
  assert.equal(afterDuel.duelUsed, true);
  assert.equal(afterDuel.duelWon, true);
  assert.ok(afterDuel.atkMult > ses.atkMult);
  assert.ok(afterDuel.defMult < ses.defMult);
});

test("v26.0 Reigns-style 24 royal decree cards, streak rewards, and decodeSave persistence", () => {
  assert.equal(ROYAL_DECREE_CARDS.length, 24);
  const classic = createGame(world, 208, "liu");
  assert.equal(hasPendingRoyalCard(classic), false);

  let state = makeCenturyGame(208, "cao");
  assert.equal(hasPendingRoyalCard(state), true);

  const treasuryBefore = state.factions.cao.treasury;
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(hasPendingRoyalCard(state), true);
    const card = drawRoyalCard(state);
    assert.ok(card && card.left && card.right);
    const res = resolveRoyalCard(state, card.id, "right");
    state = res.state;
    assert.equal(hasPendingRoyalCard(state), false);
    assert.equal(res.streak, i);
    if (i === 3) {
      assert.equal(res.streakBonus, true);
      assert.ok(res.notes.some((n) => n.includes("三连批")));
    } else {
      state = advanceQuarter(world, state);
    }
  }
  assert.equal(state.saga.royalDecrees.seen.length, 3);
  assert.notEqual(state.factions.cao.treasury, treasuryBefore);
  assert.equal(decodeSave(world, JSON.stringify(state)).saga.royalDecrees.streak, 3);
});
