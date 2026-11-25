import { armyByOfficer, redirectArmy } from "./armies.js";
import { cityName, gameOutcome } from "./engine.js";
import { isHostile } from "./diplomacy.js";
import { edgeKey, weatherAllows } from "./landscape-terrain.js";
import { bounded, plain } from "./polities-data.js";
import { dynastyPass } from "./dynasty-treaties.js";

export const postKinds = { pass: "关隘", ferry: "渡口", port: "港埠", camp: "军营", depot: "转运仓" };
export const strategicPosts = [
  ["changan", "luoyang", "函谷关", "pass"], ["changan", "tianshui", "陇山关", "pass"],
  ["nanzheng", "shangyong", "汉水栈道", "pass"], ["nanzheng", "zitong", "剑门关", "pass"],
  ["yufu", "jiangzhou", "巴东关", "pass"], ["yufu", "jiangling", "三峡渡", "ferry"],
  ["jiangling", "jiangxia", "荆江渡", "ferry"], ["jiangxia", "chaisang", "寻阳渡", "ferry"],
  ["chaisang", "linxiang", "湘江渡", "ferry"], ["moling", "lujiang", "建业港", "port"],
  ["shanyin", "moling", "会稽港", "port"], ["lujiang", "jiangxia", "皖口港", "port"],
  ["xu", "chenliu", "许昌转运仓", "depot"], ["runan", "shouchun", "淮汝转运仓", "depot"],
  ["beiping", "ji", "幽蓟军营", "camp"], ["ye", "pingyuan", "河北军营", "camp"],
  ["chengdu", "zitong", "蜀道转运仓", "depot"],
].map(([seat, to, name, kind]) => ({ key: edgeKey(seat, to), seat, to, name, kind }));

const index = new Map(strategicPosts.map((post) => [post.key, post]));
export const strategicPost = (key) => index.get(key);
export const postOwner = (state, post) => state.sandtable?.posts[post.key]?.owner ?? state.cities[post.seat].owner;
const sides = (post) => [post.seat, post.to];

export function postTransit(state, faction, from, to, assault) {
  if (!state.sandtable) return true;
  const key = edgeKey(from, to);
  const post = index.get(key);
  const hold = state.sandtable.posts[key];
  if (!post || !hold || hold.owner === faction) return true;
  const passage = state.sandtable.peaces.some(({ a, b, until, corridor }) =>
    corridor === key && until > state.turn && [a, b].includes(faction) && [a, b].includes(hold.owner));
  return passage || dynastyPass(state, faction, hold.owner, key) || (!hold.closed && !isHostile(state, faction, hold.owner)) || Boolean(assault);
}

export function postUnits(state, post, faction = state.player) {
  return (state.armies ?? []).filter((army) => army.faction === faction && army.prepared && army.troops >= 250
    && sides(post).includes(army.location) && army.phase !== "retreat"
    && weatherAllows(state, post.seat, post.to, army.travel ?? "land"));
}

export function queuePostOrder(state, key, draft) {
  const post = strategicPost(key);
  if (!post || !state.sandtable || gameOutcome(state) !== "ongoing") throw new Error("请选择可调度的据点。");
  const faction = state.player;
  const owner = postOwner(state, post);
  const { kind, officer, city } = draft;
  const legal = kind === "assault" ? isHostile(state, faction, owner) && postUnits(state, post).some((army) => army.officer === officer)
    : owner === faction && (kind === "close" || kind === "open"
      || kind === "garrison" && sides(post).includes(city) && state.cities[city].owner === faction && state.cities[city].troops >= 500);
  if (!legal) throw new Error("争夺据点需要就位的军团。驻守和通行令需要本方控制据点。");
  const queue = state.sandtable.postOrders.filter((item) => item.key !== key);
  if (queue.length >= 6) throw new Error("本季最多安排六项据点指令。");
  return { ...state, sandtable: { ...state.sandtable, postOrders: [...queue, { key, kind,
    ...(kind === "assault" ? { officer } : kind === "garrison" ? { city } : {}) }] } };
}

export function takePost(world, state, faction, key, officer, entries) {
  const post = strategicPost(key);
  const owner = postOwner(state, post);
  const unit = armyByOfficer(state, officer);
  if (!unit || !isHostile(state, faction, owner) || !postUnits(state, post, faction).includes(unit)) return false;
  const prior = state.sandtable.posts[key];
  const garrison = prior?.troops ?? 180;
  const nearby = (state.armies ?? []).filter((army) => army.faction === owner && army.prepared && army.phase === "hold"
    && sides(post).includes(army.location)).reduce((total, army) => total + Math.floor(army.troops / 3), 0);
  const defense = Math.round((garrison + nearby) * (post.kind === "pass" ? 1.4 : 1.1));
  const power = Math.round(unit.troops * (unit.grain > 0 ? 1 : .7) + (unit.equipment ?? 0) * 14);
  const loss = Math.min(unit.troops - 1, Math.max(35, Math.round((power > defense ? .16 : .23) * defense)));
  unit.troops -= loss;
  if (power > defense) {
    const posted = Math.min(240, Math.floor(unit.troops / 4));
    unit.troops -= posted;
    state.sandtable.posts[key] = { owner: faction, troops: posted, closed: true, since: state.turn + 1 };
  }
  entries.push({ type: "war", event: "post-battle", faction, city: unit.location, participants: [faction, owner], officer,
    text: post.name + (power > defense ? "易手" : "争夺未果") + "，进攻军折损 " + loss + " 人。", post: key });
  return power > defense;
}

export function settlePosts(world, state, entries) {
  if (!state.sandtable) return;
  const data = state.sandtable;
  const reserved = new Set();
  const player = state.player;
  for (const order of data.postOrders) {
    const { key, kind } = order;
    const post = strategicPost(key);
    if (kind === "assault") {
      if (reserved.has(order.officer)) continue;
      reserved.add(order.officer);
      takePost(world, state, player, key, order.officer, entries);
      continue;
    }
    if (postOwner(state, post) !== player) continue;
    const hold = data.posts[key] ??= { owner: player, troops: 180, closed: false, since: state.turn + 1 };
    if (kind === "garrison" && state.cities[order.city].owner === player && state.cities[order.city].troops >= 500) {
      const soldiers = Math.min(250, 1500 - hold.troops);
      state.cities[order.city].troops -= soldiers;
      hold.troops += soldiers;
      entries.push({ type: "notice", faction: player, city: order.city, text: cityName(world, order.city) + "拨 " + soldiers + " 人驻守" + post.name + "。" });
    }
    if (kind === "close" || kind === "open") hold.closed = kind === "close";
  }
  data.postOrders = [];
  for (const war of data.wars.filter(({ status, goal }) => status === "fighting" && goal === "corridor")) {
    if (war.from === player && !war.auto) continue;
    const post = strategicPost(war.target);
    const unit = postUnits(state, post, war.from).filter((army) => !reserved.has(army.officer))
      .sort((a, b) => b.troops - a.troops)[0];
    if (!unit || !isHostile(state, war.from, postOwner(state, post))) continue;
    reserved.add(unit.officer);
    if (takePost(world, state, war.from, post.key, unit.officer, entries)) redirectArmy(world, state, unit, { type: "hold" });
  }
}

export function prunePosts(state) {
  if (!state.sandtable) return;
  for (const [key, hold] of Object.entries(state.sandtable.posts)) {
    const post = strategicPost(key);
    if (!sides(post).some((city) => state.cities[city].owner === hold.owner)
      && !(state.armies ?? []).some((army) => army.faction === hold.owner && army.troops >= 200 && sides(post).includes(army.location))) {
      delete state.sandtable.posts[key];
    }
  }
}

export function validPosts(state, data, officers) {
  return plain(data.posts) && Object.entries(data.posts).every(([key, post]) => index.has(key) && post
    && Object.hasOwn(state.factions, post.owner) && bounded(post.troops, 0, 1500) && typeof post.closed === "boolean"
    && bounded(post.since, data.since, state.turn))
    && Array.isArray(data.postOrders) && data.postOrders.length <= 6 && new Set(data.postOrders.map((item) => item?.key)).size === data.postOrders.length
    && data.postOrders.every((item) => item && index.has(item.key) && (item.kind === "assault" ? officers.has(item.officer)
      : item.kind === "garrison" ? sides(index.get(item.key)).includes(item.city) : ["open", "close"].includes(item.kind)));
}
