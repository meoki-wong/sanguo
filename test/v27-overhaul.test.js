import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceQuarter, createGame, decodeSave, eraByYear } from "../dist/engine.js";
import { enrichWorld } from "../dist/personnel.js";
import {
  CLASH_BONDS, CLASH_CARDS, CLASH_VENUES, applyClashWorldReward, autoResolveClash,
  createClashSession, endClashTurn, evaluateClashLanes, playClashCard,
} from "../dist/card-clash.js";
import {
  ENCOUNTER_KINDS, answerWarlordDispatch, evaluateWarlordMedals, getActiveWarlordDispatch,
  getSeasonEncounters, resolveWorldEncounter,
} from "../dist/living-world.js";
import {
  attackTarget, attackableTargets, createGridBattle, isFlankedByAlly, unitAt,
} from "../dist/tactical-grid.js";

const world = enrichWorld(JSON.parse(readFileSync(new URL("../dist/assets/world.json", import.meta.url), "utf8")));

function makeCenturyGame(year = 208, player = "liu") {
  return createGame(world, year, player, {
    realm: true, war: true, grand: true, landscape: true, statecraft: true,
    sandtable: true, frontline: true, highCommand: true, dynasty: true,
    strategic: true, reign: true, century: true,
  });
}

test("v27.0 Card Clash venues (Changban cap & 1.5x), hero powers (Guanyu/Zhuge/Zhouyu), bonds, and reward persistence", () => {
  assert.equal(CLASH_VENUES.length, 9);
  assert.equal(CLASH_CARDS.length, 24);
  assert.equal(CLASH_BONDS.length, 4);

  let ses = createClashSession({
    playerName: "刘备",
    enemyName: "曹操",
    venueKeys: ["changban", "wuchao", "chibi"],
  });
  assert.equal(ses.energy, 2);
  assert.equal(ses.playerHand.length, 5);
  assert.equal(ses.lanes[0].venue.id, "changban");

  // 注入指定强力手牌测试长坂桥 1 卡限制、桃园结义 +4 羁绊、诸葛亮全局 +3 与周瑜减半
  const byId = (id) => ({ ...CLASH_CARDS.find((c) => c.id === id), playedRound: 1, lowHandTriggered: false });
  ses.energy = 12;
  ses.playerHand = [byId("guanyu"), byId("zhangfei"), byId("zhuge"), byId("zhouyu")];
  ses.lanes[0].enemyCards = [byId("xiahoudun")]; // 敌单将，让长坂桥关羽触发单挑 +4
  ses.lanes[2].enemyCards = [byId("xuchu"), byId("machao")];

  ses = playClashCard(ses, 0, 0); // 关羽进长坂独桥
  assert.equal(ses.lanes[0].playerCards.length, 1);
  // 试图往限驻 1 员的长坂独桥再放张飞应被拦截
  const blocked = playClashCard(ses, 0, 0);
  assert.equal(blocked.lanes[0].playerCards.length, 1);

  ses = playClashCard(ses, 0, 1); // 张飞进乌巢 -> 激活桃园结义 (+2/+2)
  ses = playClashCard(ses, 0, 1); // 诸葛亮进乌巢 -> 另两路有友军的话各 +3
  ses = playClashCard(ses, 0, 2); // 周瑜进赤壁 -> 敌方此阵战力折半

  const ev = evaluateClashLanes(ses);
  assert.ok(ev.playerBonds.some((b) => b.id === "taoyuan"));
  // 长坂关羽: base 5 + 单挑 4 + 桃园 2 = 11 -> ×1.5 = 17
  assert.ok(ev.laneScores[0].playerPower >= 16);
  // 赤壁周瑜把许褚7 + 马超首回合8 = 15 点压半减 7 至 8 点
  assert.equal(ev.laneScores[2].enemyPower, 8);

  // 自动推演至终局 & 结算赏赐
  const done = autoResolveClash(ses);
  assert.equal(done.done, true);
  assert.ok(["player", "enemy", "draw"].includes(done.winner));

  // 测试确定性全胜奖赏与乌巢额外加粮 + 同季防刷
  let state = makeCenturyGame(208, "liu");
  const tBefore = state.factions.liu.treasury;
  const gBefore = state.factions.liu.grain;
  const forceWin = structuredClone(ses);
  forceWin.done = true;
  forceWin.winner = "player";
  forceWin.evaluation = {
    laneScores: [
      { playerPower: 17, enemyPower: 4, leader: "player" },
      { playerPower: 14, enemyPower: 0, leader: "player" },
      { playerPower: 6, enemyPower: 5, leader: "player" },
    ],
    playerLanesWon: 3,
    enemyLanesWon: 0,
  };
  const r1 = applyClashWorldReward(world, state, forceWin);
  assert.equal(r1.firstWinThisTurn, true);
  assert.equal(r1.state.factions.liu.treasury, tBefore + 90);
  assert.equal(r1.state.factions.liu.grain, gBefore + 140 + 120); // 含乌巢额外 +120 粮
  assert.equal(r1.state.saga.clashStats.streak, 1);

  const r2 = applyClashWorldReward(world, r1.state, forceWin);
  assert.equal(r2.firstWinThisTurn, false);
  assert.equal(r2.state.saga.clashStats.streak, 2);
  assert.equal(r2.state.factions.liu.treasury, tBefore + 90);
  assert.equal(decodeSave(world, JSON.stringify(r2.state)).saga.clashStats.bestStreak, 2);
});

test("v27.0 Living World encounters, Warlord dispatches, and Warlord medals preserve non-century neutrality and save integrity", () => {
  assert.equal(Object.keys(ENCOUNTER_KINDS).length, 5);
  const classic = createGame(world, 208, "cao");
  const eraClassic = eraByYear(world, classic);
  assert.deepEqual(getSeasonEncounters(world, classic), []);
  assert.equal(getActiveWarlordDispatch(world, eraClassic, classic), null);

  let state = makeCenturyGame(208, "cao");
  const era = eraByYear(world, state);
  const encounters = getSeasonEncounters(world, state);
  assert.equal(encounters.length, 3);
  assert.ok(encounters.some((e) => e.kind === "tavern"));

  // 解决第 2 处奇遇后地图只剩 2 处，且本季已解决不再复现
  const picked = encounters[1];
  const resEnc = resolveWorldEncounter(world, state, picked.id, picked.options[0].id);
  state = resEnc.state;
  assert.ok(resEnc.summary.length > 0);
  assert.equal(getSeasonEncounters(world, state).length, 2);
  assert.equal(getSeasonEncounters(world, state).some((e) => e.id === picked.id), false);

  // 动态诸侯传书：初始可见，回应后该季消失，推进到下季再度产生
  const disp = getActiveWarlordDispatch(world, era, state);
  assert.ok(disp && disp.warlordName && disp.choices.length === 2);
  const ans = answerWarlordDispatch(world, state, disp, "reply_wits");
  state = ans.state;
  assert.equal(getActiveWarlordDispatch(world, era, state), null);
  assert.equal(decodeSave(world, JSON.stringify(state)).saga.dispatchTurn, state.turn);

  state = advanceQuarter(world, state);
  assert.ok(getActiveWarlordDispatch(world, eraByYear(world, state), state));

  const medals = evaluateWarlordMedals(state);
  assert.equal(medals.length, 4);
});

test("v27.0 tactical grid flank crit deals 1.28x damage and extra +12 spirit", () => {
  let ses = createGridBattle({ wind: "east" });
  ses.spirit = 20;
  // 清场测试夹击：把 p_inf 与 p_cav 紧贴 e_inf 两侧，p_inf 攻击触发夹击暴击
  const pInf = ses.units.find((u) => u.id === "p_inf");
  const pCav = ses.units.find((u) => u.id === "p_cav");
  const eInf = ses.units.find((u) => u.id === "e_inf");
  for (const u of ses.units) {
    if (![pInf.id, pCav.id, eInf.id].includes(u.id)) {
      u.x = 0; u.y = 4;
    }
  }
  ses.tiles[2][2].terrain = "plain";
  ses.tiles[2][3].terrain = "plain";
  ses.tiles[2][4].terrain = "plain";
  pInf.x = 2; pInf.y = 2; pInf.acted = false;
  eInf.x = 3; eInf.y = 2; eInf.hp = 120;
  pCav.x = 4; pCav.y = 2; pCav.acted = false;

  assert.equal(isFlankedByAlly(ses, pInf, eInf), true);
  const targets = attackableTargets(ses, pInf.id);
  const tEnemy = targets.find((t) => t.id === eInf.id);
  assert.equal(tEnemy?.flanked, true);

  ses = attackTarget(ses, pInf.id, 3, 2);
  const afterE = unitAt(ses, 3, 2);
  assert.ok(afterE.hp < 120 - 30);
  // 常规 +15 战意 + 夹击 +12 战意 = +27 (20 -> 47)
  assert.equal(ses.spirit, 47);
  assert.ok(ses.lastFx.some((f) => f.text.includes("夹击")));
});
