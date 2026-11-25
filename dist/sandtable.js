import { gameOutcome } from "./engine.js";
import { settleIndustry, validIndustry } from "./sandtable-economy.js";
import { prunePosts, strategicPost, strategicPosts, validPosts } from "./sandtable-posts.js";
import { settleRegimes, validRegimes } from "./sandtable-politics.js";
import { queueOpponentWarDecisions, settleLimitedWars, validLimitedWars } from "./sandtable-war.js";
import { bounded, plain } from "./polities-data.js";

export function enableSandtable(state) {
  if (state.sandtable) return state;
  if (!state.statecraft || gameOutcome(state) !== "ongoing") throw new Error("请选择可继续的战局再启用天下沙盘。");
  return { ...state, sandtable: { since: state.turn, serial: 1, posts: {}, postOrders: [], wars: [], peaces: [],
    economy: {}, labor: {}, unrest: {}, branches: [], journal: [] } };
}

export function settleSandtable(world, before, state, proposals, entries, forecast = false) {
  if (!state.sandtable) return null;
  const ledger = { budget: { treasury: 0, grain: 0 }, in: { treasury: 0, grain: 0 }, out: { treasury: 0, grain: 0 } };
  function account(side, kind, amount) {
    const stock = state.factions[side];
    if (kind !== "in" && (stock.treasury < amount.treasury || stock.grain < amount.grain)) return false;
    for (const key of ["treasury", "grain"]) {
      stock[key] += amount[key] * (kind === "in" ? 1 : -1);
      if (side === state.player) ledger[kind][key] += amount[key];
    }
    return true;
  }
  settleIndustry(world, state, account, entries, forecast);
  if (forecast) return ledger;
  settleRegimes(world, state, entries, account);
  queueOpponentWarDecisions(world, before, state, proposals, entries);
  settleLimitedWars(world, state, entries, account);
  prunePosts(state);
  const news = entries.filter((entry) => ["post-battle", "war-treaty", "military-warning", "military-settled", "military-mutiny",
    "uprising", "independence", "succession", "defection"].includes(entry.event) || entry.text.startsWith("州郡调度"))
    .filter(({ faction, participants }) => faction === state.player || participants?.includes(state.player))
    .slice(-7).map(({ city, text, post }) => ({ city, text: text.slice(0, 180), ...(post ? { post } : {}) }));
  if (news.length) {
    const posts = Object.entries(state.sandtable.posts).map(([key, { owner, closed }]) => ({ key, owner, closed }));
    state.sandtable.journal = [...state.sandtable.journal, { turn: state.turn + 1, news, posts }].slice(-24);
  }
  return ledger;
}

export function interruption(before, after) {
  if (gameOutcome(after) !== "ongoing") return "战局已结束。";
  const side = after.player;
  const details = after.history.at(-1)?.entries ?? [];
  const urgent = after.highCommand?.campaigns.find((row) => row.side === side && row.alert?.turn === after.turn - 1);
  if (urgent) return urgent.alert.text;
  if (!after.highCommand && after.frontline?.battles.some(({ turn, sides }) => turn === after.turn - 1 && sides.some(({ faction }) => faction === side))) {
    return "有新的会战战报，可逐季调整调令。";
  }
  const event = details.find(({ faction, participants, event }) => (faction === side || participants?.includes(side))
    && ["military-warning", "military-mutiny", "court-warning", "crisis", "uprising", "independence", "isolated", "defection"].includes(event));
  if (event) return event.text;
  if (after.landscape?.congresses.some((row) => row.host !== side && row.parties.includes(side)
    && row.status === "voting" && !row.votes[side])) return "有待表决的多方会盟。";
  if (after.sandtable?.wars.some((war) => war.status === "fighting" && [war.from, war.to].includes(side)
    && war.offer?.by !== side && war.offer?.answer === null)) return "有待裁决的和议。";
  if (after.incomingTreaty && !before.incomingTreaty) return "有使者请见，等待裁决。";
  const lost = Object.keys(before.grand.depots).find((key) => before.grand.depots[key] > 0 && before.cities[key].owner === side && after.cities[key].owner !== side);
  if (lost) return "有粮仓失守，等待调整军粮。";
  return "";
}

export function validSandtable(world, state, officers) {
  const data = state.sandtable;
  if (data === undefined) return true;
  return Boolean(state.statecraft && plain(data) && bounded(data.since, state.statecraft.since, state.turn) && bounded(data.serial, 1, 1000000)
    && validPosts(state, data, officers) && validLimitedWars(state, data, officers) && validIndustry(world, state, data) && validRegimes(state, data, officers)
    && Array.isArray(data.journal) && data.journal.length <= 24 && data.journal.every((row) => row
      && bounded(row.turn, data.since + 1, state.turn) && Array.isArray(row.posts) && row.posts.length <= strategicPosts.length
      && row.posts.every((post) => post && strategicPost(post.key) && Object.hasOwn(state.factions, post.owner) && typeof post.closed === "boolean")
      && Array.isArray(row.news) && row.news.length <= 7 && row.news.every((item) => item
        && (item.city === undefined || Object.hasOwn(state.cities, item.city)) && (item.post === undefined || strategicPost(item.post))
        && typeof item.text === "string" && item.text.length <= 180)));
}
