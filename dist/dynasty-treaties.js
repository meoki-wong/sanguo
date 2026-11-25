import { armyByOfficer, redirectArmy, withdrawalRoute } from "./armies.js";
import { cityName, eraByYear, factionName, firstCity, gameOutcome } from "./engine.js";
import { isHostile, treatyWith } from "./diplomacy.js";
import { handoverCities } from "./polity-handover.js";
import { bounded, livingSide, plain } from "./polities-data.js";
import { postOwner, strategicPost, strategicPosts } from "./sandtable-posts.js";
import { dynastyPolicy, dynastyReport, dynastyUrgent } from "./dynasty.js";

export const treatyStatuses8 = { offered: "待答复", active: "履约中", observed: "已履行", rejected: "被拒绝", breached: "已违约", expired: "已到期" };
const paired = (row, first, second) => first !== second && [row.from, row.to].includes(first) && [row.from, row.to].includes(second);
const open = (row) => ["offered", "active"].includes(row.status);

export function dynastyTreaty(state, first, second) {
  return state.dynasty?.treaties.find((row) => row.status === "active" && row.until > state.turn && paired(row, first, second));
}

export function dynastyPass(state, first, second, border = null) {
  const treaty = dynastyTreaty(state, first, second);
  return Boolean(treaty?.passage && (!border || !treaty.post || treaty.post === border));
}

export function treatyOptions(world, state, rival, side = state.player) {
  const available = Boolean(rival && side !== rival && livingSide(state, rival) && livingSide(state, side)
    && !state.dynasty.treaties.some((row) => paired(row, side, rival) && open(row)));
  const cities = available ? world.cities.filter(({ key }) => state.cities[key].owner === side
    && state.polity.formerOwners[key]?.includes(rival) && firstCity(world, state, side) !== key) : [];
  const posts = available ? strategicPosts.filter((post) => [side, rival].includes(postOwner(state, post))
    && [post.seat, post.to].some((key) => state.cities[key].owner === rival)
    && [post.seat, post.to].some((key) => state.cities[key].owner === side)) : [];
  return { available, cities, posts };
}

function goodTerms(draft) {
  return plain(draft) && bounded(draft.seasons, 3, 12) && bounded(draft.payment, 0, 50)
    && typeof draft.passage === "boolean" && typeof draft.defense === "boolean"
    && (draft.post === null || Boolean(strategicPost(draft.post))) && (draft.cede === null || typeof draft.cede === "string");
}

export function proposeDynastyTreaty(world, state, draft) {
  if (!state.dynasty || gameOutcome(state) !== "ongoing" || !goodTerms(draft)) throw new Error("请核对条款、赔付及履约期限。");
  const next = structuredClone(state);
  registerTreaty(world, next, state.player, draft);
  return next;
}

export function offerDynastyFor(world, state, from, draft) {
  if (!state.dynasty || !goodTerms(draft)) return false;
  try {
    registerTreaty(world, state, from, draft);
    return true;
  } catch {
    return false;
  }
}

function registerTreaty(world, state, from, { to, seasons, payment, passage, defense, cede, post }) {
  const can = treatyOptions(world, state, to, from);
  if (!can.available || cede && !can.cities.some(({ key }) => key === cede) || post && !can.posts.some(({ key }) => key === post)
    || post && !passage) throw new Error("交割须符合当前疆域及旧有归属，双方不得同时有另一份待签或生效条约。");
  const data = state.dynasty;
  if (data.treaties.length >= 30) {
    const index = data.treaties.findIndex((row) => !open(row));
    if (index < 0) throw new Error("外交档案已满。");
    data.treaties.splice(index, 1);
  }
  data.treaties.push({ id: data.serial++, from, to, seasons, payment, passage, defense, cede, post, offered: state.turn,
    status: "offered", signed: null, until: null, vote: null, paid: 0, missed: 0, delivered: 0 });
}

export function answerDynastyTreaty(state, id, vote) {
  if (!state.dynasty || typeof vote !== "boolean" || gameOutcome(state) !== "ongoing") throw new Error("当前无法答复和约。");
  const next = structuredClone(state);
  const row = next.dynasty.treaties.find((entry) => entry.id === id && entry.to === state.player && entry.status === "offered");
  if (!row) throw new Error("这份和约无需答复。");
  row.vote = vote;
  return next;
}

export function renegotiateDynastyTreaty(world, state, id, terms) {
  if (!state.dynasty || !goodTerms(terms) || gameOutcome(state) !== "ongoing") throw new Error("请确定合法的新条款。");
  const next = structuredClone(state);
  const row = next.dynasty.treaties.find((entry) => entry.id === id && [entry.from, entry.to].includes(state.player) && open(entry));
  if (!row || row.status === "active" && row.missed < 1) throw new Error("和约履行正常；出现欠付或仍在磋商时可以重谈。");
  row.status = row.status === "active" ? "breached" : "expired";
  registerTreaty(world, next, state.player, { ...terms, to: row.from === state.player ? row.to : row.from });
  return next;
}

function holdings(state, side) {
  return Object.values(state.cities).filter(({ owner }) => owner === side).length;
}

function shouldRatify(state, row) {
  const receiver = state.factions[row.to];
  const ratio = holdings(state, row.from) / Math.max(1, holdings(state, row.to));
  const terms = row.payment * row.seasons + (row.cede ? 90 : 0);
  return !isHostile(state, row.from, row.to) || ratio >= 1.7 || terms >= 36 || receiver.grain < 35;
}

function withdrawForPeace(world, state, row) {
  for (const unit of state.armies ?? []) {
    const opponent = state.cities[unit.target]?.owner;
    if (!paired(row, unit.faction, opponent)) continue;
    // Keep the troops on the map while the existing movement rules execute the withdrawal.
    const home = [unit.depot, unit.location].find((key) => withdrawalRoute(world, state, unit, key));
    redirectArmy(world, state, unit, home ? { type: "retreat", target: home } : { type: "hold" });
  }
}

function ratify(world, state, row, entries, ledger) {
  if (row.cede && (state.cities[row.cede].owner !== row.from || holdings(state, row.from) < 2)
    || row.post && ![row.from, row.to].includes(postOwner(state, strategicPost(row.post)))) return false;
  const place = row.cede ?? firstCity(world, state, row.from);
  const turn = state.turn + 1;
  row.status = "active";
  row.signed = turn;
  row.until = turn + row.seasons;
  if (row.cede) {
    const before = state.factions[state.player].grain;
    handoverCities(world, eraByYear(world, state), state, row.from, row.to, [row.cede], "return", turn);
    const gain = state.factions[state.player].grain - before;
    if (gain > 0) ledger.in.grain += gain;
  }
  if (row.post) {
    const post = state.sandtable.posts[row.post];
    if (post) post.closed = false;
  }
  for (const war of state.sandtable.wars.filter((war) => war.status === "fighting" && paired(row, war.from, war.to))) {
    war.status = "ended";
    war.offer = null;
    war.receipt = { turn, kind: "ceasefire", detail: "双方签订有履约条款的停战和约。" };
  }
  withdrawForPeace(world, state, row);
  if ([row.from, row.to].includes(state.player)) state.polity.peaceDeals++;
  dynastyReport(world, state, entries, row.from, "treaty", place, "和约正式生效" + (row.cede ? "，" + cityName(world, row.cede) + "完成交割。" : "，双方停止交战。"), [row.from, row.to]);
  return true;
}

function reinforcePartner(world, state, row, entries) {
  if (!row.defense) return;
  const opposing = (unit, partner) => unit.faction !== partner && unit.engagement?.owner === partner && unit.phase === "march";
  for (const [ side, partner ] of [[row.from, row.to], [row.to, row.from]]) {
    const breach = (state.armies ?? []).find((unit) => opposing(unit, partner) && unit.faction !== side);
    if (!breach || !isHostile(state, side, breach.faction)) continue;
    const guard = (state.armies ?? []).find((unit) => unit.faction === side && unit.phase === "hold" && unit.troops >= 600 && unit.grain >= 8
      && world.cities.find(({ key }) => key === unit.location)?.links.includes(breach.target));
    if (!guard) continue;
    // Spend supplies and intervene locally. A guard with another task or farther away cannot react.
    guard.grain -= 8;
    const damage = Math.min(breach.troops - 1, Math.max(1, Math.floor(guard.troops * .09)));
    breach.troops -= damage;
    if (breach.troops < guard.troops) {
      delete breach.engagement;
      breach.phase = "hold";
    }
    row.delivered++;
    dynastyReport(world, state, entries, side, "treaty", breach.target, "按共同守备条款支援盟方，耗随军粮 8，围城军损失 " + damage + " 人。", [side, partner]);
  }
}

export function treatyChoices8(world, state, faction) {
  if (!state.dynasty) return [];
  const answers = state.dynasty.treaties.filter((row) => row.status === "offered" && row.to === faction)
    .flatMap((row) => [{ id: "P" + row.id + "-yes", treaty: row.id, vote: true,
      text: "接受" + factionName(eraByYear(world, state), row.from) + "和约，停战 " + row.seasons + " 季，逐季收取 " + row.payment + " 钱"
        + (row.cede ? "，接收" + cityName(world, row.cede) : "") + (row.passage ? "，开放通路" : "") },
    { id: "P" + row.id + "-no", treaty: row.id, vote: false, text: "拒绝该和约，继续当前战局" }]);
  if (faction === state.player || state.turn < 15 || state.turn % 5 !== 0 || state.dynasty.treaties.length >= 28) return answers;
  const opponents = state.sandtable.wars.filter((row) => row.status === "fighting" && [row.from, row.to].includes(faction))
    .map((row) => row.from === faction ? row.to : row.from);
  const rival = opponents.find((side) => treatyOptions(world, state, side, faction).available);
  if (rival) answers.push({ id: "P-truce-" + rival, to: rival, text: "向" + factionName(eraByYear(world, state), rival) + "提出逐季赔付的和约" });
  return answers;
}

export function settleTreaties8(world, state, proposals, entries, ledger, { forecast = false } = {}) {
  const data = state.dynasty;
  const turn = state.turn + 1;
  if (!forecast) for (const side of Object.keys(state.factions).filter((key) => key !== state.player && livingSide(state, key))) {
    const proposal = treatyChoices8(world, state, side).find(({ id, to }) => to && id === proposals[side]?.settlement)
      ?? (state.factions[side].grain <= 30 && treatyChoices8(world, state, side).find(({ to }) => to));
    if (proposal?.to && treatyOptions(world, state, proposal.to, side).available && data.treaties.length < 28) {
      registerTreaty(world, state, side, { to: proposal.to, seasons: 5, payment: 8, passage: true, defense: false, cede: null, post: null });
      if (proposal.to === state.player) dynastyUrgent(world, state, entries, state.player, "treaty",
        firstCity(world, state, state.player), factionName(eraByYear(world, state), side) + "提出新的和约，请答复。");
    }
  }
  for (const row of data.treaties.filter((item) => open(item) && (!forecast || [item.from, item.to].includes(state.player)))) {
    const place = firstCity(world, state, row.from);
    if (!livingSide(state, row.from) || !livingSide(state, row.to)) { row.status = "expired"; continue; }
    if (row.status === "offered") {
      const selected = treatyChoices8(world, state, row.to).find((choice) => choice.treaty === row.id && choice.id === proposals[row.to]?.settlement);
      const vote = row.vote ?? (row.to !== state.player ? selected?.vote ?? shouldRatify(state, row)
        : dynastyPolicy(state).diplomacy && treatyWith(state, row.from, row.to)?.kind === "alliance" && !row.cede ? true : null);
      if (vote === null && turn - row.offered >= 4) row.status = "expired";
      else if (vote !== null) {
        if (!vote || !ratify(world, state, row, entries, ledger)) {
          row.status = "rejected";
          dynastyReport(world, state, entries, row.from, "treaty", place, "和约未获签署。", [row.from, row.to]);
        }
      }
      continue;
    }
    if (turn > row.until) {
      row.status = "observed";
      continue;
    }
    const payer = state.factions[row.from];
    const floor = dynastyPolicy(state, row.from).moneyFloor;
    if (row.payment && payer.treasury - row.payment < floor) {
      row.missed++;
      if (row.missed >= 2) {
        row.status = "breached";
        if ([row.from, row.to].includes(state.player)) state.polity.calm = 0;
      }
      for (const side of [row.from, row.to]) dynastyUrgent(world, state, entries, side, "treaty", firstCity(world, state, side),
        row.status === "breached" ? "和约连续欠付，停战与通行条款失效。" : "和约本季欠付一次，可提出新条款。");
      continue;
    }
    payer.treasury -= row.payment;
    state.factions[row.to].treasury += row.payment;
    if (row.from === state.player) ledger.out.treasury += row.payment;
    if (row.to === state.player) ledger.in.treasury += row.payment;
    row.paid += row.payment;
    row.missed = 0;
    if (row.payment) dynastyReport(world, state, entries, row.from, "treaty", place, "按约支付本季赔款 " + row.payment + " 钱。", [row.from, row.to]);
    reinforcePartner(world, state, row, entries);
    if (turn === row.until) row.status = "observed";
  }
}

export function validTreaties8(state, data) {
  const id = (value) => bounded(value, 1, data.serial - 1);
  const date = (value) => bounded(value, data.since, state.turn);
  return Array.isArray(data.treaties) && data.treaties.length <= 30 && data.treaties.every((row) => goodTerms(row) && id(row.id)
    && row.from !== row.to && Object.hasOwn(state.factions, row.from) && Object.hasOwn(state.factions, row.to)
    && (row.cede === null || Object.hasOwn(state.cities, row.cede)) && date(row.offered) && Object.hasOwn(treatyStatuses8, row.status)
    && (row.vote === null || typeof row.vote === "boolean") && (row.signed === null && row.until === null
      || date(row.signed) && row.signed > row.offered && row.until === row.signed + row.seasons)
    && bounded(row.paid, 0, row.payment * row.seasons) && bounded(row.missed, 0, 2) && bounded(row.delivered, 0, 100));
}
