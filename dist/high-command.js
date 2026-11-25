import { armyByOfficer, marchRoute, redirectArmy, releaseLegacyArmyControl, supplyRoute, withdrawalRoute } from "./armies.js";
import { availableAttackers, cityName, eraByYear, expeditionGrain, firstCity, gameOutcome } from "./engine.js";
import { isHostile, treatyWith } from "./diplomacy.js";
import { battleLocation, battleObjectives, formationOf, saveBattlePlan } from "./frontline.js";
import { dispatchRoute } from "./grand-logistics.js";
import { strategicPost, postOwner } from "./sandtable-posts.js";
import { declareWar, offerPeace, warTargets } from "./sandtable-war.js";
import { countLevy } from "./sandtable-economy.js";
import { saveStatecraftPolicy } from "./statecraft.js";
import { warBlockaded } from "./war-operations.js";
import { plain, bounded, livingSide } from "./polities-data.js";

export const campaignGoals = { corridor: "夺取走廊", advance: "推进战线", relief: "解围", defense: "据险防守" };
export const campaignStages = { muster: "集结", approach: "进军", engage: "交战", secure: "巩固", settlement: "战后处置",
  ended: "结案" };
export const settlements = { secure: "就地驻防", relief: "撤军休养", negotiate: "按条件议和" };
export const peaceTerms = { ceasefire: "停战", passage: "开放走廊", return: "交还争夺城池" };
export const commandAlerts = { funds: "战费或国库底线", supply: "主力粮道中断", exhaustion: "主力触及撤退线",
  alliance: "联军退出", revision: "联军请求改约", mandate: "需要补任统帅", target: "目标形势变化", settlement: "战役目标已达成",
  local: "地方告急", mutiny: "军团离心" };
export const careerLabels = { lead: "统兵", escort: "护运", guard: "守备", civil: "接管" };

const allocation = ["front", "defense", "recovery"];
const count = (value, max) => bounded(value, 0, max);
const active = (row) => row.stage !== "ended";
const missionFor = (goal) => goal === "relief" || goal === "defense" ? "defense" : "offensive";
const warGoal = { corridor: "corridor", advance: "region", relief: "relief" };
const lineName = (world, key) => strategicPost(key)?.name ?? cityName(world, key);

export function enableHighCommand(state) {
  if (state.highCommand || !state.frontline) return state;
  return { ...state, highCommand: { since: state.turn, nextId: 1, policies: {}, campaigns: [], dispatches: [], career: {} } };
}

export function commandPolicy(state, side = state.player) {
  return state.highCommand?.policies[side] ?? {
    priority: "front", floorMoney: 20, floorGrain: 25, front: 55, defense: 25, recovery: 20, personnel: "manual",
  };
}

function validPolicy(value) {
  return plain(value) && allocation.includes(value.priority) && ["manual", "appoint", "search"].includes(value.personnel)
    && count(value.floorMoney, 600) && count(value.floorGrain, 600)
    && allocation.every((key) => count(value[key], 100)) && allocation.reduce((sum, key) => sum + value[key], 0) === 100;
}

export function saveCommandPolicy(state, draft) {
  if (!state.highCommand || gameOutcome(state) !== "ongoing" || !validPolicy(draft)) {
    throw new Error("请设定钱粮底线，并让前线、守备与恢复额度合计为 100%。");
  }
  const policy = Object.fromEntries(["priority", "floorMoney", "floorGrain", ...allocation, "personnel"].map((key) => [key, draft[key]]));
  const profile = { front: "muster", defense: "growth", recovery: "recovery" }[policy.priority];
  const next = saveStatecraftPolicy(state, { profile, personnel: policy.personnel,
    development: policy.defense, military: policy.front, relief: policy.recovery,
    reserveMoney: policy.floorMoney, reserveGrain: policy.floorGrain });
  return { ...next, highCommand: { ...state.highCommand, policies: { ...state.highCommand.policies, [state.player]: policy } } };
}

export function strategicTargets(world, state, goal, side = state.player) {
  if (goal === "defense") {
    const perimeter = new Set(world.cities.filter(({ key, links }) => state.cities[key].owner === side
      && links.some((link) => isHostile(state, side, state.cities[link].owner))).map(({ key }) => key));
    return battleObjectives(world, state, side, "defense").filter(({ key }) => perimeter.has(key)
      || strategicPost(key) && [strategicPost(key).seat, strategicPost(key).to].some((city) => perimeter.has(city)));
  }
  if (!Object.hasOwn(warGoal, goal)) return [];
  return warTargets(world, state, side, warGoal[goal]).filter((target) => goal !== "relief" || target.ward === side);
}

function pointForArmy(state, objective, army) {
  const post = strategicPost(objective);
  if (!post) return objective;
  if (postOwner(state, post) === army.faction) {
    return [army.location, post.seat, post.to].find((key) => [post.seat, post.to].includes(key) && state.cities[key].owner === army.faction);
  }
  return army.location === post.seat ? post.to : army.location === post.to ? post.seat
    : [post.seat, post.to].find((key) => isHostile(state, army.faction, state.cities[key].owner)) ?? post.seat;
}

export function staffChoices(world, state, goal, objective, except) {
  const era = eraByYear(world, state);
  const mode = missionFor(goal);
  const locked = new Set(state.highCommand?.campaigns.filter((row) => active(row) && row.id !== except).map(({ commander }) => commander));
  const city = battleLocation(state, objective);
  if (!city) return [];
  const people = new Map();
  for (const { key } of world.cities) {
    if (state.cities[key].owner !== state.player || state.cities[key].occupation) continue;
    const route = mode === "defense" ? withdrawalRoute(world, state, { faction: state.player, location: key }, city)
      : [city, strategicPost(objective)?.seat].filter(Boolean)
        .flatMap((target) => ["land", "water"].map((travel) => marchRoute(world, state, state.player, key, target, travel))).filter(Boolean)
        .sort((a, b) => a.length - b.length)[0];
    const post = strategicPost(objective);
    if (route || post && [post.seat, post.to].includes(key)) for (const person of availableAttackers(era, state, state.player, key)) {
      people.set(person.key, { officer: person.key, name: person.name, city: key, distance: route?.length ?? 2,
        command: person.command, field: false });
    }
  }
  for (const army of state.armies ?? []) {
    if (army.faction !== state.player) continue;
    const person = era.officers.find(({ key }) => key === army.officer);
    const point = pointForArmy(state, objective, army);
    if (!point || !person) continue;
    const route = mode === "defense" ? withdrawalRoute(world, state, army, point)
      : marchRoute(world, state, state.player, army.location, point, army.travel);
    const localPost = strategicPost(objective);
    if (!route && !(localPost && [localPost.seat, localPost.to].includes(army.location))) continue;
    people.set(army.officer, { officer: army.officer, name: person.name, city: army.location, distance: route?.length ?? 1,
      command: person.command, field: true });
  }
  return [...people.values()].filter(({ officer }) => !locked.has(officer))
    .sort((a, b) => a.distance - b.distance || Number(b.field) - Number(a.field) || staffRating(state, b, goal) - staffRating(state, a, goal));
}

function staffRating(state, person, goal) {
  const career = state.highCommand?.career[person.officer];
  const merit = goal === "defense" || goal === "relief" ? career?.guard : career?.lead;
  const service = state.strategy9?.service[person.officer];
  return person.command + Math.min(10, merit ?? 0) + (service
    ? Math.max(-8, Math.min(8, service.held + service.advances - Math.floor(service.losses / 700))) : 0);
}

export function commandCareer(state, key) {
  const row = state.highCommand?.career[key];
  return row ? Object.entries(careerLabels).filter(([role]) => row[role] > 0)
    .map(([role, label]) => label + " " + row[role]).join(" · ") : "";
}

function awardCareer(state, key, role) {
  if (!key) return;
  const award = state.highCommand.career[key] ??= { lead: 0, escort: 0, guard: 0, civil: 0 };
  award[role] = Math.min(99, award[role] + 1);
}

function validWarrant(draft) {
  return plain(draft) && Object.hasOwn(campaignGoals, draft.goal) && ["delegate", "direct"].includes(draft.mode)
    && bounded(draft.money, 0, 9999) && bounded(draft.grain, 0, 9999) && bounded(draft.withdraw, 200, 2400)
    && bounded(draft.seasons, 2, 12) && Object.hasOwn(peaceTerms, draft.terms)
    && (draft.terms === "ceasefire" || draft.terms === "passage" && draft.goal === "corridor"
      || draft.terms === "return" && draft.goal === "advance")
    && typeof draft.reinforce === "boolean" && typeof draft.rebase === "boolean";
}

function writeDispatch(state, row, kind, text, entries, city = null) {
  const item = { campaign: row.id, side: row.side, turn: state.turn, kind, city: city ?? row.point, text };
  const records = state.highCommand.dispatches;
  if (records.some((note) => note.campaign === item.campaign && note.turn === item.turn && note.kind === kind && note.text === text)) return;
  records.push(item);
  if (records.length > 36) records.shift();
  entries?.push({ type: "command", faction: row.side, city: item.city, event: kind, campaign: row.id, text });
}

export function authorizeCampaign(world, state, draft) {
  if (!state.highCommand || gameOutcome(state) !== "ongoing" || !validWarrant(draft)) {
    throw new Error("请核对战费、撤退线、战役期限和停战条款。");
  }
  const old = draft.id && state.highCommand.campaigns.find((row) => row.id === draft.id && row.side === state.player && active(row));
  if (draft.id && !old) throw new Error("战役已结案。");
  if (old && (old.target !== draft.target || old.goal !== draft.goal)) throw new Error("改换战争目标需要先结束这场战役。");
  const target = strategicTargets(world, state, draft.goal).find(({ key }) => key === draft.target);
  if (!old && !target || !draft.commander) throw new Error("请选择本方可以着手的目标与统帅。");
  const candidates = staffChoices(world, state, draft.goal, draft.target, old?.id);
  if (draft.commander !== old?.commander && !candidates.some(({ officer }) => officer === draft.commander)) {
    throw new Error("统帅须来自本方可向目标行军的军团或集结地。");
  }
  if (!old && state.highCommand.campaigns.filter((row) => active(row) && row.side === state.player).length >= 3) throw new Error("全国最多同时管理三场战役。");
  if (!old && state.highCommand.campaigns.some((row) => active(row) && row.side === state.player && row.target === draft.target)) {
    throw new Error("这个目标已有战役授权，请在地图打开原战役。");
  }
  if (old && (draft.money < old.spentMoney || draft.grain < old.spentGrain)) throw new Error("战役上限须覆盖已发生的支出。");
  const war = warGoal[draft.goal] && state.sandtable.wars.find((row) => row.from === state.player && row.target === draft.target
    && row.goal === warGoal[draft.goal] && row.status === "fighting");
  const declared = warGoal[draft.goal] && !old && !war;
  let next = declared ? declareWar(world, state, { goal: warGoal[draft.goal], target: draft.target, auto: false }) : structuredClone(state);
  const data = next.highCommand;
  const battle = armyByOfficer(next, draft.commander);
  const formation = battle && formationOf(next, battle.officer);
  let linked = old && next.frontline.plans.find(({ id }) => id === old.plan);
  // Only bind an army to one command chain. A standing 6.0 plan for this same objective can be handed over.
  if (!linked && formation) {
    linked = next.frontline.plans.find((plan) => plan.faction === next.player && plan.objective === draft.target
      && plan.units.some(({ id }) => id === formation.id));
  }
  if (!linked) {
    next = saveBattlePlan(world, next, { objective: draft.target, mission: missionFor(draft.goal), mode: "delegate",
      reserve: commandPolicy(next).floorGrain, units: formation ? [{ id: formation.id, role: "advance" }] : [] });
    linked = next.frontline.plans.at(-1);
  }
  const records = next.highCommand;
  linked.mission = missionFor(draft.goal);
  linked.mode = draft.mode;
  const warrant = Object.fromEntries(["goal", "target", "commander", "mode", "money", "grain", "withdraw", "seasons",
    "terms", "reinforce", "rebase"].map((key) => [key, draft[key]]));
  const branch = records.campaigns.find(({ id }) => id === old?.id);
  if (branch) {
    if (branch.commander !== draft.commander) linked.units = formation ? [{ id: formation.id, role: "advance" }] : [];
    Object.assign(branch, warrant, { plan: linked.id, alert: null, acknowledged: null });
    writeDispatch(next, branch, "orders", "军议更新授权与钱粮底线。");
    return next;
  }
  const newWar = declared ? next.sandtable.wars.at(-1) : war;
  if (war) next.sandtable.wars.find(({ id }) => id === war.id).auto = false;
  const row = { ...warrant, id: records.nextId++, side: next.player, point: battleLocation(next, draft.target),
    started: next.turn, stage: "muster", secure: 0, plan: linked.id, war: newWar?.id ?? null,
    spentMoney: 0, spentGrain: 0, alert: null, acknowledged: null, allyLosses: [], ended: null, resolution: null, negotiating: false };
  records.campaigns.push(row);
  if (records.campaigns.length > 24) {
    const oldest = records.campaigns.findIndex((item) => !active(item));
    if (oldest < 0) throw new Error("战役档案已满，请先完成现有战役。");
    records.campaigns.splice(oldest, 1);
  }
  writeDispatch(next, row, "orders", lineName(world, row.target) + "战役已授权。");
  return next;
}

function standDown(world, state, row, disposition) {
  const plan = state.frontline.plans.find(({ id }) => id === row.plan);
  for (const { id } of plan?.units ?? []) {
    const formation = state.frontline.formations.find((unit) => unit.id === id && unit.ended === null);
    const army = armyByOfficer(state, formation?.officer);
    if (!army) continue;
    const home = disposition === "relief" && [army.depot, ...world.cities.map(({ key }) => key)]
      .map((key) => withdrawalRoute(world, state, army, key)).filter(Boolean).sort((a, b) => a.length - b.length)[0];
    redirectArmy(world, state, army, home ? { type: "retreat", target: home.at(-1) } : { type: "hold" });
    if (disposition === "secure") formation.resting = true;
  }
  state.frontline.plans = state.frontline.plans.filter(({ id }) => id !== row.plan);
  for (const ask of state.frontline.requests.filter(({ plan, status }) => plan === row.plan && ["pending", "accepted"].includes(status))) ask.status = "expired";
  row.stage = "ended";
  row.ended = state.turn;
  row.alert = null;
  row.resolution = disposition;
  row.negotiating = false;
}

export function decideCampaign(world, state, id, action) {
  if (!state.highCommand || gameOutcome(state) !== "ongoing") throw new Error("当前战局不能更改战役调令。");
  let next = structuredClone(state);
  let row = next.highCommand.campaigns.find((item) => item.id === id && item.side === next.player && active(item));
  if (!row) throw new Error("没有可处置的本方战役。");
  if (action === "direct" || action === "delegate") {
    row.mode = action;
    const plan = next.frontline.plans.find(({ id }) => id === row.plan);
    if (plan) plan.mode = action;
    writeDispatch(next, row, "orders", action === "direct" ? "朝廷接管调度。" : "调度权已交还统帅。");
  } else if (action === "acknowledge" && row.alert && row.alert.kind !== "settlement") {
    row.acknowledged = row.alert.kind;
    row.alert = null;
  } else if (action === "negotiate") {
    if (!row.war || row.negotiating) throw new Error("此战役没有新的议和对象，或已有和议在等待答复。");
    next = offerPeace(next, row.war, { kind: row.terms, payment: 0 });
    row = next.highCommand.campaigns.find((item) => item.id === id);
    row.stage = "settlement";
    row.negotiating = true;
    row.alert = null;
    writeDispatch(next, row, "terms", "按已批准的条件向对方提出和议，等待答复。");
  } else if (action === "secure" || action === "relief") {
    standDown(world, next, row, action);
    writeDispatch(next, row, "settled", settlements[action] + "，战役结案。");
  } else throw new Error("请选择可执行的战役处置。");
  return next;
}

function ownedObjective(state, row) {
  const post = strategicPost(row.target);
  return post ? postOwner(state, post) === row.side : state.cities[row.target].owner === row.side;
}

function safetyAlert(state, row, kind, text, entries) {
  if (row.alert?.kind === kind || row.acknowledged === kind) return;
  const point = row.point;
  row.alert = { kind, turn: state.turn, point, text };
  writeDispatch(state, row, kind, text, entries, point);
}

export function commandBudgets(state, side = state.player) {
  const policy = commandPolicy(state, side);
  const stock = state.factions[side];
  return {
    money: Math.max(0, stock.treasury - policy.floorMoney),
    grain: Math.max(0, stock.grain - policy.floorGrain),
    frontMoney: Math.floor(Math.max(0, stock.treasury - policy.floorMoney) * policy.front / 100),
    frontGrain: Math.floor(Math.max(0, stock.grain - policy.floorGrain) * policy.front / 100),
    defenseMoney: Math.floor(Math.max(0, stock.treasury - policy.floorMoney) * policy.defense / 100),
    defenseGrain: Math.floor(Math.max(0, stock.grain - policy.floorGrain) * policy.defense / 100),
    recoveryMoney: Math.floor(Math.max(0, stock.treasury - policy.floorMoney) * policy.recovery / 100),
    recoveryGrain: Math.floor(Math.max(0, stock.grain - policy.floorGrain) * policy.recovery / 100),
  };
}

export function prepareCommand(world, state, entries, logistics, slots, strategy) {
  if (!state.highCommand) return new Map();
  const side = state.player;
  const policy = commandPolicy(state, side);
  const stock = state.factions[side];
  const officers = new Map(eraByYear(world, state).officers.map(({ key, faction }) => [key, faction]));
  const treasury = commandBudgets(state, side);
  const pools = { front: { money: treasury.frontMoney, grain: treasury.frontGrain },
    defense: { money: treasury.defenseMoney, grain: treasury.defenseGrain } };
  const controls = new Map();
  const marshal = state.realm?.offices.marshal?.holder && state.reign?.offices.marshal;
  let martialRoom = marshal ? (marshal.term > state.turn ? marshal.cap : 0) : Infinity;
  for (const row of state.highCommand.campaigns.filter((item) => item.side === side && active(item))) {
    const plan = state.frontline.plans.find(({ id }) => id === row.plan);
    if (!plan) { safetyAlert(state, row, "mandate", "战役编组已取消，请更新统帅或结案。", entries); continue; }
    const army = armyByOfficer(state, row.commander);
    const formation = formationOf(state, row.commander);
    const pool = pools[missionFor(row.goal) === "defense" ? "defense" : "front"];
    const allocation = strategy?.allocations.find(({ campaign }) => campaign === row.id);
    const reserveMoney = Math.max(policy.floorMoney, allocation ? state.dynasty.policies[side]?.moneyFloor ?? 24 : 0);
    const reserveGrain = Math.max(policy.floorGrain, allocation ? state.dynasty.policies[side]?.grainFloor ?? 24 : 0);
    const moneyRoom = () => Math.max(0, Math.min(row.money - row.spentMoney, pool.money, stock.treasury - reserveMoney, allocation?.money ?? Infinity, martialRoom));
    const grainRoom = () => Math.max(0, Math.min(row.grain - row.spentGrain, pool.grain, allocation?.grain ?? Infinity));
    const centralGrain = () => Math.max(0, Math.min(grainRoom(), stock.grain - reserveGrain));
    const charge = (money, grain, national = true) => {
      stock.treasury -= money;
      if (national) stock.grain -= grain;
      row.spentMoney += money;
      row.spentGrain += grain;
      pool.money -= money;
      pool.grain -= grain;
      martialRoom -= money;
      if (allocation) { allocation.money -= money; allocation.grain -= grain; }
    };
    const apportion = { moneyRoom, grainRoom, centralGrain, charge, reserve: reserveGrain, commander: row.commander,
      escort: allocation?.role === "escort",
      availableMen: () => allocation?.manpower ?? Infinity,
      enroll: (troops) => { if (allocation) allocation.manpower -= troops; },
      reinforced: row.reinforce && slots > 0, defense: missionFor(row.goal) === "defense", resting: row.stage === "settlement" || allocation?.status === "paused",
      withdraw: row.withdraw, initial: row.stage === "muster" && row.spentGrain === 0, approach: "siege" };
    controls.set(plan.id, apportion);
    plan.mode = row.mode;
    plan.reserve = reserveGrain;
    if (apportion.resting) continue;
    if (officers.get(row.commander) !== side || !army && !state.stations[row.commander]) {
      apportion.reinforced = false;
      apportion.resting = true;
      safetyAlert(state, row, "mandate", "指定统帅已离开本方编制，请另行任命。", entries);
      continue;
    }
    if (row.mode === "delegate" && army && formation && !plan.units.some(({ id }) => id === formation.id)
      && !state.frontline.plans.some((other) => other.id !== plan.id && other.units.some(({ id }) => id === formation.id))) {
      plan.units.unshift({ id: formation.id, role: "advance" });
      plan.units = plan.units.slice(0, 4);
    }
    if (row.mode === "delegate" && row.reinforce && army && army.troops <= row.withdraw + 150
      && plan.units.length < 4 && !plan.units.some(({ role }) => role === "reserve")) {
      const reserve = state.frontline.formations.find((unit) => {
        if (unit.faction !== side || unit.ended !== null || unit.resting || unit.fatigue >= 70 || strategy?.controlled.has(unit.officer)
          || state.frontline.plans.some((other) => other.units.some(({ id }) => id === unit.id))) return false;
        const wing = armyByOfficer(state, unit.officer);
        if (!wing || wing.troops <= row.withdraw || !supplyRoute(world, state, wing)) return false;
        const point = pointForArmy(state, row.target, wing);
        return point && (missionFor(row.goal) === "defense"
          ? withdrawalRoute(world, state, wing, point)
          : marchRoute(world, state, side, wing.location, point, wing.travel));
      });
      if (reserve) {
        plan.units.push({ id: reserve.id, role: "reserve" });
        releaseLegacyArmyControl(state, reserve.officer);
        writeDispatch(state, row, "reserve", "统帅按授权调入一支预备军团。", entries);
      }
    }
    if (army && row.mode === "delegate" && row.rebase && (!supplyRoute(world, state, army) || !dispatchRoute(world, state, side, army.depot))) {
      const alternative = world.cities.filter(({ key }) => state.cities[key].owner === side && key !== army.depot)
        .map(({ key }) => ({ key, route: supplyRoute(world, state, army, key) }))
        .filter(({ key, route }) => route && (state.grand.depots[key] > 0 || dispatchRoute(world, state, side, key)))
        .sort((a, b) => a.route.length - b.route.length)[0];
      if (alternative) {
        redirectArmy(world, state, army, { type: "supply", depot: alternative.key });
        writeDispatch(state, row, "supply-change", "统帅改用" + cityName(world, alternative.key) + "粮仓。", entries, alternative.key);
      }
    }
    if (moneyRoom() === 0 || grainRoom() === 0) safetyAlert(state, row, "funds", "战费已触及授权或全国额度，请调整预算。", entries);
    else if (army && !supplyRoute(world, state, army)) safetyAlert(state, row, "supply", "主力粮道中断，统帅请求裁决。", entries);
    else if (army && (army.troops < row.withdraw || (formation?.fatigue ?? 0) >= 80)) {
      safetyAlert(state, row, "exhaustion", "主力触及撤退线。委任部队会按授权收拢。", entries);
    } else if (row.acknowledged && !["alliance", "target"].includes(row.acknowledged)) row.acknowledged = null;
    // Existing theater allocations remain in force if they are tighter.
    for (const unit of plan.units) {
      const officer = state.frontline.formations.find(({ id }) => id === unit.id)?.officer;
      if (!officer) continue;
      const prior = logistics.get(officer);
      logistics.set(officer, {
        reserve: Math.max(prior?.reserve ?? 0, reserveGrain),
        limit: () => Math.min(grainRoom(), prior?.limit?.() ?? Infinity),
        charge: (grain) => { charge(0, grain, false); prior?.charge?.(grain); },
      });
    }
    for (const { id } of plan.units) {
      const unit = state.frontline.formations.find((item) => item.id === id);
      const corps = armyByOfficer(state, unit?.officer);
      if (!corps || !["march", "muster"].includes(corps.phase) && row.stage === "muster") continue;
      const pay = Math.min(6, 1 + Math.floor(corps.troops / 650));
      if (moneyRoom() >= pay) {
        charge(pay, 0);
        if (corps.phase === "march" && state.turn - row.started >= 2 && state.cities[corps.depot].owner === side) {
          countLevy(state, corps.depot, Math.min(280, Math.round(corps.troops / 5)));
        }
      }
      else safetyAlert(state, row, "funds", "本季军饷触及战费或国库底线。", entries);
    }
  }
  return controls;
}

export function settleCommand(world, state, entries) {
  if (!state.highCommand) return;
  const episodes = state.frontline.battles.filter(({ turn }) => turn === state.turn);
  for (const { sides } of episodes) {
    for (const [index, side] of sides.entries()) awardCareer(state, side.officer, index === 0 ? "lead" : "guard");
  }
  const supported = new Set();
  for (const plan of state.frontline.plans) {
    for (const { id } of plan.units.filter(({ role }) => role === "escort")) {
      const key = state.frontline.formations.find((row) => row.id === id)?.officer;
      const unit = armyByOfficer(state, key);
      if (unit && unit.phase === "hold" && unit.grain > 0 && !supported.has(key)
        && state.landscape.convoys.some(({ faction, status, settled, route }) => faction === unit.faction
          && status === "delivered" && settled === state.turn && route.includes(unit.location))) {
        supported.add(key);
        awardCareer(state, key, "escort");
      }
    }
  }
  for (const row of state.highCommand.campaigns.filter(active)) {
    if (!livingSide(state, row.side)) {
      standDown(world, state, row, "relief");
      continue;
    }
    if (row.side !== state.player) continue;
    const army = armyByOfficer(state, row.commander);
    const war = state.sandtable.wars.find(({ id }) => id === row.war);
    if (row.negotiating) {
      if (war?.status === "ended") {
        standDown(world, state, row, "negotiate");
        writeDispatch(state, row, "settled", "战约已经结束，军团停止进军。", entries);
      } else if (!war?.offer) {
        row.negotiating = false;
        safetyAlert(state, row, "settlement", "和议没有达成，请重新决定战后安排。", entries);
      }
      continue;
    }
    if (row.stage === "settlement") continue;
    const lost = state.frontline.requests.filter((ask) => ask.plan === row.plan && ask.unit && !row.allyLosses.includes(ask.id)
      && (ask.status === "withdrawn" || ask.status === "expired" && treatyWith(state, ask.from, ask.to)?.kind !== "alliance")).map(({ id }) => id);
    if (lost.length) {
      row.allyLosses = [...row.allyLosses, ...lost].slice(-12);
      row.acknowledged = null;
      safetyAlert(state, row, "alliance", "联军协议失效，协同军团已结束履约。", entries);
    }
    if (state.frontline.requests.some((ask) => ask.plan === row.plan && ask.status === "accepted" && ask.revision?.turn === state.turn)) {
      safetyAlert(state, row, "revision", "联军请求推迟抵达，可在联军安排答复。", entries);
    }
    const won = ownedObjective(state, row) && (row.goal !== "relief" || !warBlockaded(state, row.point))
      && (row.goal !== "defense" || army?.location === row.point || strategicPost(row.target) && army
        && [strategicPost(row.target).seat, strategicPost(row.target).to].includes(army.location));
    const canHold = won && !state.cities[row.point].occupation;
    row.secure = won ? Math.min(3, row.secure + Number(canHold || row.goal === "advance")) : 0;
    const elapsed = state.turn - row.started + 1;
    const contact = state.frontline.battles.some(({ turn, sides, site }) => turn === state.turn
      && (site === row.target || sides.some(({ officer }) => officer === row.commander)));
    const ready = row.secure >= (row.goal === "relief" ? 1 : 2);
    if (ready || war?.status === "ended" || elapsed >= row.seasons) {
      if (ready) awardCareer(state, row.commander, missionFor(row.goal) === "defense" ? "guard" : "lead");
      row.stage = "settlement";
      safetyAlert(state, row, "settlement", ready ? "战役目标已达成，请决定驻防、休养或议和。"
        : war?.status === "ended" ? "原有战约已结束，请安排军团后续。" : "授权期限已满，请决定是否收兵或议和。", entries);
      continue;
    }
    const stage = won ? "secure" : contact || warBlockaded(state, row.point) ? "engage"
      : army && army.phase !== "muster" ? "approach" : "muster";
    if (stage !== row.stage) {
      row.stage = stage;
      writeDispatch(state, row, "stage", lineName(world, row.target) + "进入" + campaignStages[stage] + "阶段。", entries);
    }
  }
}

export function settleCommandRecovery(world, state, entries) {
  const side = state.player;
  if (!state.highCommand?.policies[side]) return;
  const funds = commandBudgets(state);
  const candidates = world.cities.filter(({ key }) => state.cities[key].owner === side && !warBlockaded(state, key))
    .filter(({ key }) => state.realm.cities[key].welfare <= 63 || (state.sandtable.labor[key] ?? 0) >= 360)
    .sort((a, b) => state.realm.cities[a.key].welfare - state.realm.cities[b.key].welfare);
  const stock = state.factions[side];
  const count = Math.min(2, candidates.length, Math.floor(funds.recoveryMoney / 6), Math.floor(funds.recoveryGrain / 5));
  for (const { key } of candidates.slice(0, count)) {
    stock.treasury -= 6;
    stock.grain -= 5;
    const town = state.realm.cities[key];
    town.welfare = Math.min(100, town.welfare + 5);
    if (state.sandtable.labor[key]) state.sandtable.labor[key] = Math.max(0, state.sandtable.labor[key] - 220);
    awardCareer(state, state.cities[key].governor, "civil");
    entries.push({ type: "command", event: "recovery", faction: side, city: key, text: cityName(world, key) + "按恢复额度赈济。支出 6 钱、5 粮。" });
  }
}

export function urgentCommands(state) {
  return (state.highCommand?.campaigns ?? []).filter((row) => row.side === state.player && row.alert && active(row));
}

export function validHighCommand(state, officers) {
  const data = state.highCommand;
  if (data === undefined) return true;
  const faction = (key) => typeof key === "string" && Object.hasOwn(state.factions, key);
  const city = (key) => typeof key === "string" && Object.hasOwn(state.cities, key);
  const time = (turn) => bounded(turn, data.since, state.turn);
  const id = (value) => bounded(value, 1, data.nextId - 1);
  const note = (value) => typeof value === "string" && value.length <= 110;
  return plain(data) && state.frontline && bounded(data.since, state.frontline.since, state.turn) && bounded(data.nextId, 1, 1000000)
    && plain(data.policies) && Object.entries(data.policies).every(([key, value]) => faction(key) && validPolicy(value))
    && plain(data.career) && Object.entries(data.career).every(([key, history]) => officers.has(key) && plain(history)
      && Object.keys(careerLabels).every((role) => count(history[role], 99)))
    && Array.isArray(data.campaigns) && data.campaigns.length <= 24 && data.campaigns.every((row) => validWarrant(row) && id(row.id)
      && faction(row.side) && officers.has(row.commander) && city(row.point) && (city(row.target) || strategicPost(row.target))
      && row.point === battleLocation(state, row.target) && time(row.started) && Object.hasOwn(campaignStages, row.stage)
      && bounded(row.plan, 1, state.frontline.sequence - 1) && (row.war === null || bounded(row.war, 1, state.sandtable.serial - 1))
      && count(row.spentMoney, row.money) && count(row.spentGrain, row.grain) && count(row.secure, 3)
      && (row.alert === null || plain(row.alert) && Object.hasOwn(commandAlerts, row.alert.kind) && time(row.alert.turn)
        && city(row.alert.point) && note(row.alert.text))
      && (row.acknowledged === null || Object.hasOwn(commandAlerts, row.acknowledged))
      && (row.ended === null && active(row) && row.resolution === null || !active(row) && time(row.ended) && Object.hasOwn(settlements, row.resolution))
      && typeof row.negotiating === "boolean" && (!row.negotiating || row.stage === "settlement" && row.war !== null)
      && Array.isArray(row.allyLosses) && row.allyLosses.length <= 12 && row.allyLosses.every((key) => bounded(key, 1, state.frontline.sequence - 1)))
    && new Set(data.campaigns.map((row) => row.id)).size === data.campaigns.length
    && Array.isArray(data.dispatches) && data.dispatches.length <= 36 && data.dispatches.every((item) => plain(item) && id(item.campaign)
      && faction(item.side) && city(item.city) && time(item.turn) && note(item.text) && typeof item.kind === "string" && item.kind.length <= 20);
}
