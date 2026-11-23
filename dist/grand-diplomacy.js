import { accordCredit, accordProposal, adjustCredit, commercialRoad, quoteAccord } from "./accords.js";
import { cityName, eraByYear, factionName, gameOutcome } from "./engine.js";
import { treatyWith } from "./diplomacy.js";
import { realmReserve } from "./realm.js";
import { handoverCities } from "./polity-handover.js";
import { bounded, livingSide } from "./polities-data.js";

const involved = (item, faction) => item.from === faction || item.to === faction;
const sameSides = (a, b) => involved(a, b.from) && involved(a, b.to);
export const grandClauses = { halt: "停战", city: "返城", treasury: "赔款", pass: "军路通行", grain: "粮援", joint: "合兵" };
const duration = { halt: 6, pass: 6 };

export function grandArmistice(state, a, b) {
  return state.grand?.passes.find((item) => item.kind === "halt" && item.expires > state.turn
    && livingSide(state, a) && livingSide(state, b) && sameSides(item, { from: a, to: b }));
}

export function packageShape(state, item) {
  return item && item.from !== item.to && Object.hasOwn(state.factions, item.from) && Object.hasOwn(state.factions, item.to)
    && typeof item.halt === "boolean" && typeof item.pass === "boolean" && bounded(item.treasury, 0, 200)
    && bounded(item.grain, 0, 160) && (item.joint === null || Object.hasOwn(state.cities, item.joint))
    && (item.city === null || Object.hasOwn(state.cities, item.city)) && Object.keys(grandClauses).some((key) => item[key]);
}

function packageProblem(world, state, item, clause, quote = false) {
  const { from, to, halt, city, treasury, grain, joint } = item;
  if (!livingSide(state, from) || !livingSide(state, to)) return "已有一方失去全部城池。";
  const reserve = realmReserve(state, from);
  if (clause === "city") {
    if (state.cities[city].owner !== from || !state.polity.formerOwners[city].includes(to)
      || Object.values(state.cities).filter(({ owner }) => owner === from).length <= 1) return "必须由本方控制，且对方曾经拥有此城。";
  }
  if (clause === "treasury" && state.factions[from].treasury - reserve.treasury < treasury) return "扣除预留后，国库不足。";
  if (clause === "pass" && !treatyWith(state, from, to) && !(quote && halt)) return "需要有效停战或同盟。";
  if (clause === "grain") {
    if (!treatyWith(state, from, to) && !(quote && halt)) return "粮援需要停战或同盟。";
    if (!commercialRoad(world, state, from, to)) return "目前无畅通商路。";
    const floor = Math.max(reserve.grain, from === state.player ? state.grand.national.reserve : 0);
    if (state.factions[from].grain - floor < grain) return "扣除预留后，粮食不足。";
  }
  if (clause === "joint") {
    const proposal = accordProposal(world, state, from, to, "joint", joint, undefined, { offset: 0, duty: "assault" });
    const decision = quoteAccord(world, eraByYear(world, state), state, proposal, { queued: true });
    if (!decision.accepted) return decision.reason;
  }
  return "";
}

export function packageQuote(world, state, draft) {
  if (!state.grand || !packageShape(state, draft)) return { ready: false, reason: "请选择对方和至少一项合规条款。", clauses: [] };
  const clauses = Object.entries(grandClauses).filter(([key]) => draft[key])
    .map(([key, name]) => ({ key, name, issue: packageProblem(world, state, draft, key, true) }));
  const queued = [...state.grand.offers, ...state.grand.agreements].some((item) => sameSides(item, draft));
  const reputation = accordCredit(state, draft.from, draft.to);
  const ready = !queued && reputation >= -28 && clauses.every(({ issue }) => !issue);
  const reason = queued ? "这两个势力已有议案待处理。" : reputation < -28 ? "履约信用过低，对方暂缓新约。"
    : ready ? "双方认可后于下一季逐项交割。" : "请调整未满足条件的条款。";
  return { ready, reason, clauses };
}

function register(state, item, submitted = state.turn) {
  state.grand.offers.push({ ...item, id: ++state.grand.serial, submitted });
}

export function proposePackage(world, state, draft) {
  const { ready, reason } = packageQuote(world, state, draft);
  if (!ready || draft.from !== state.player || gameOutcome(state) !== "ongoing") throw new Error(reason);
  if (state.grand.offers.filter(({ from }) => from === state.player).length >= 3) throw new Error("可同时递交三份议案。");
  const next = structuredClone(state);
  const { from, to, halt, pass, city, grain, treasury, joint } = draft;
  register(next, { from, to, halt, pass, city, grain, treasury, joint });
  return next;
}

export function answerPackage(state, id, answer) {
  const found = state.grand?.offers.find((offer) => offer.id === id);
  if (!found || !involved(found, state.player) || gameOutcome(state) !== "ongoing") throw new Error("这份议案已结束。");
  if (found.from === state.player) {
    if (answer !== "withdraw") throw new Error("只能撤回本方递交的议案。");
    return { ...state, grand: { ...state.grand, offers: state.grand.offers.filter((offer) => offer.id !== id) } };
  }
  if (typeof answer !== "boolean") throw new Error("请选择是否同意来使提议。");
  return { ...state, grand: { ...state.grand, offers: state.grand.offers.map((offer) => offer.id === id ? { ...offer, answer } : offer) } };
}

function accept(world, state, item) {
  const { from, to, city, treasury, grain, joint } = item;
  if (city || treasury >= 12 || grain >= 15 || joint || accordCredit(state, from, to) >= 12) return true;
  const border = world.cities.filter(({ key, links }) => state.cities[key].owner === to
    && links.some((next) => state.cities[next].owner === from));
  return item.halt && (border.length > 0 || treatyWith(state, from, to));
}

function term(state, item, kind, turn) {
  state.grand.passes = state.grand.passes.filter((other) => other.kind !== kind || !sameSides(item, other));
  state.grand.passes.push({ from: item.from, to: item.to, kind, expires: turn + duration[kind] });
}

function fulfill(world, state, item, key, turn) {
  const { from, to } = item;
  if (key === "halt" || key === "pass") term(state, item, key, turn);
  if (key === "grain" || key === "treasury") {
    state.factions[from][key] -= item[key];
    state.factions[to][key] += item[key];
  }
  if (key === "city") handoverCities(world, eraByYear(world, state, turn), state, from, to, [item.city], "return", turn);
  if (key === "joint") {
    const pledge = accordProposal(world, state, from, to, "joint", item.joint, undefined, { offset: 0, duty: "assault" });
    state.realm.accords.push({ ...pledge, signed: turn, expires: turn + 5, joined: [] });
  }
}

const sidesName = (era, item) => factionName(era, item.from) + "与" + factionName(era, item.to);

export function settlePackages(world, state, entries, forecast) {
  const data = state.grand;
  const turn = state.turn + 1;
  for (const item of [...data.agreements]) {
    const player = involved(item, state.player);
    if (forecast && !player) continue;
    data.agreements = data.agreements.filter(({ id }) => id !== item.id);
    const clauses = Object.entries(grandClauses).filter(([key]) => item[key]).map(([key, name]) => {
      const issue = packageProblem(world, state, item, key);
      if (!issue) fulfill(world, state, item, key, turn);
      return { key, ok: !issue, detail: issue || name + (typeof item[key] === "number" ? " " + item[key] : "") + "已交割" };
    });
    if (forecast) continue;
    const failures = clauses.filter(({ ok }) => !ok).length;
    adjustCredit(state, item.from, item.to, Math.max(-24, Math.min(16, (clauses.length - failures) * 4 - failures * 9)));
    if (player && failures) state.polity.lastBreach = turn;
    if (player && !failures && !item.joint) state.polity.peaceDeals += 1;
    const record = { id: item.id, from: item.from, to: item.to, turn, clauses };
    data.receipts = [...data.receipts, record].slice(-36);
    entries.push({ type: "grand", faction: item.from, participants: [item.from, item.to], ...(item.city ? { city: item.city } : {}),
      text: sidesName(eraByYear(world, state, turn), item) + "议案 · " + clauses.map(({ key, detail, ok }) =>
        ok ? detail : grandClauses[key] + "未完成（" + detail + "）").join(" · ") + "。" });
  }
  if (forecast) return;
  const era = eraByYear(world, state, turn);
  for (const item of [...data.offers]) {
    const reply = item.to === state.player ? item.answer : accept(world, state, item);
    if (reply === undefined && turn - item.submitted < 3 && livingSide(state, item.from) && livingSide(state, item.to)) continue;
    data.offers = data.offers.filter(({ id }) => id !== item.id);
    const approved = reply === true && livingSide(state, item.from) && livingSide(state, item.to);
    if (approved) {
      const { submitted, answer, ...terms } = item;
      data.agreements.push({ ...terms, due: turn + 1 });
    }
    entries.push({ type: "grand", faction: item.from, participants: [item.from, item.to],
      text: sidesName(era, item) + (approved ? "批准议案，下季交割。" : "的议案未生效。") });
  }
  data.passes = data.passes.filter(({ from, to, expires }) => expires > turn && livingSide(state, from) && livingSide(state, to));
  if (turn < 16 || turn % 6) return;
  for (const [faction, agenda] of Object.entries(data.agendas)) {
    if (agenda.kind !== "restore" || faction === state.player || agenda.rival === null || !livingSide(state, faction)
      || treatyWith(state, faction, agenda.rival)) continue;
    const terms = { from: faction, to: agenda.rival, halt: true, pass: false, city: null, joint: null, grain: 0,
      treasury: Math.min(16, Math.max(0, state.factions[faction].treasury - realmReserve(state, faction).treasury)) };
    if (packageQuote(world, state, terms).ready) register(state, terms, turn);
  }
}
