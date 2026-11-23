import { treatyTerms, treatyWith } from "./diplomacy.js";
import { cityName, eraByYear, factionName, firstCity, gameOutcome } from "./engine.js";
import { realmReserve } from "./realm.js";
import { handoverCities } from "./polity-handover.js";
import { polityEntry, provinceRows } from "./polity-governance.js";
import { bounded, livingSide, settlementKinds } from "./polities-data.js";

const occupiedBy = (state, faction) => Object.keys(state.cities).filter((key) => state.cities[key].owner === faction);
const parties = (offer) => [offer.from, offer.to].sort().join(":");
const duplicate = (a, b) => a.kind === b.kind && parties(a) === parties(b);
const clientOf = (offer) => offer.ward;
const patronOf = (offer) => offer.from === offer.ward ? offer.to : offer.from;
const count = (state, faction) => occupiedBy(state, faction).length;

function neighboring(world, state, a, b) {
  return world.cities.some(({ key, links }) => state.cities[key].owner === a && links.some((site) => state.cities[site].owner === b));
}

export function settlementDraft(state, from, to, kind, { payment = 0, city = null, ward = from } = {}) {
  return { from, to, kind, payment: kind === "peace" ? payment : 0, city: kind === "peace" ? city : null,
    ward: kind === "peace" ? null : ward };
}

export function settlementTerms(world, state, draft, queued = false) {
  const deny = (reason) => ({ possible: false, reason });
  if (!state.polity || !Object.hasOwn(settlementKinds, draft.kind) || draft.from === draft.to
    || !livingSide(state, draft.from) || !livingSide(state, draft.to)) return deny("请选两个仍有主城的势力。");
  if (!queued && [...state.polity.offers, ...state.polity.deals].some((item) => duplicate(item, draft))) return deny("同类提案正在处理。");
  const { from, to, kind, payment, city } = draft;
  if (kind === "peace") {
    const stock = state.factions[from];
    if (!bounded(payment, 0, 200) || stock.treasury - realmReserve(state, from).treasury < payment) return deny("请填写 0 至 200 钱，且保留国库预留。");
    if (city !== null && (state.cities[city]?.owner !== from || count(state, from) <= 1
      || !state.polity.formerOwners[city]?.includes(to))) {
      return deny("只可返还当前控制、对方曾经拥有的城池，且须保留本方主城。");
    }
    return { possible: true, reason: "双方批准后次季交割。交割有效时停战两季。",
      summary: (payment ? "本方支付 " + payment + " 钱" : "无赔款") + (city ? "，返还" + cityName(world, city) : "") };
  }
  const ward = clientOf(draft);
  const patron = patronOf(draft);
  if (![from, to].includes(ward)) return deny("请选择申请保护的一方。");
  const protections = state.polity.protections;
  if (kind === "protection") {
    if (protections.some((item) => item.ward === ward || item.ward === patron || item.patron === ward)) return deny("已有保护关系，请先处理原协定。");
    if (count(state, patron) < count(state, ward) * 1.6 || !neighboring(world, state, ward, patron)) {
      return deny("保护方须有明显城池优势，并与受保护方接壤。");
    }
    return { possible: true, reason: "次季生效，双方互不进攻。受保护方保有本国辖城、国库及独立执政。",
      summary: "保护期 12 季" };
  }
  const status = protections.find((item) => item.ward === ward && item.patron === patron);
  if (!status || status.good < 6) return deny("须共同维持至少六季稳定保护关系。");
  if (ward === state.player) return deny("此局选择保留本方势力，可继续履行保护协定。");
  if (provinceRows(world, state, ward).some(({ crisis }) => crisis !== null)) return deny("受保护州郡仍有重大危机，暂不能合并。");
  return { possible: true, reason: "双方批准后次季合并，所有城池、在任人员、军团及钱粮统一交接。",
    summary: "预计交接 " + count(state, ward) + " 城" };
}

function addOffer(state, draft) {
  const data = state.polity;
  const offer = { ...structuredClone(draft), id: ++data.serial, submitted: state.turn };
  data.offers.push(offer);
  return offer;
}

export function proposeSettlement(world, state, draft) {
  if (!state.polity || gameOutcome(state) !== "ongoing" || draft.from !== state.player) throw new Error("当前无法发送议案。");
  const terms = settlementTerms(world, state, draft);
  if (!terms.possible) throw new Error(terms.reason);
  if (state.polity.offers.filter(({ from }) => from === state.player).length >= 3) throw new Error("本季可递交三份议案。");
  const next = structuredClone(state);
  addOffer(next, draft);
  return next;
}

export function respondSettlement(state, id, accept) {
  const offer = state.polity?.offers.find((item) => item.id === id);
  if (!offer || offer.to !== state.player || gameOutcome(state) !== "ongoing") throw new Error("这份来使议案已结束。");
  return { ...state, polity: { ...state.polity, offers: state.polity.offers.map((item) => item.id === id ? { ...item, accept: Boolean(accept) } : item) } };
}

export function cancelSettlement(state, id) {
  const offer = state.polity?.offers.find((item) => item.id === id);
  if (!offer || offer.from !== state.player || gameOutcome(state) !== "ongoing") throw new Error("只有已送出的待决议案可撤回。");
  return { ...state, polity: { ...state.polity, offers: state.polity.offers.filter((item) => item.id !== id) } };
}

export function aiSettlements(world, state, faction) {
  const rows = [];
  const own = count(state, faction);
  for (const other of Object.keys(state.factions)) {
    if (other === faction || !livingSide(state, other) || !neighboring(world, state, faction, other)) continue;
    const size = count(state, other);
    const relation = treatyWith(state, faction, other);
    const protector = state.polity.protections.find(({ ward, patron }) => ward === faction && patron === other);
    if (protector?.good >= 6 && faction !== state.player) rows.push(settlementDraft(state, faction, other, "union"));
    else if (own <= 2 && size >= own * 2 && state.turn >= 12 && !relation) rows.push(settlementDraft(state, faction, other, "protection"));
    const pledged = [...state.realm.accords, ...state.realm.proposals].some((item) => item.kind === "joint"
      && item.enemy === other && [item.from, item.to].includes(faction) && item.answer !== false);
    const recentLoss = state.history.slice(-6).some(({ entries }) => entries.some(({ type, battle }) => type === "capture"
      && battle?.attacker.faction === other && battle.defender.faction === faction));
    if (!relation && !pledged && state.turn >= 7 && recentLoss && (state.factions[faction].grain < 40 || own * 2 < size) && own > 1) {
      rows.push(settlementDraft(state, faction, other, "peace", { payment: Math.min(18, Math.max(0, state.factions[faction].treasury - 30)) }));
    }
  }
  return rows.filter((draft) => settlementTerms(world, state, draft).possible).slice(0, 3)
    .map((draft) => ({ type: "settlement", draft }));
}

function acceptedByRival(world, state, item) {
  const { from, to, kind, city, payment } = item;
  if (kind === "union") return true;
  if (kind === "protection") {
    const risk = provinceRows(world, state, item.ward).some(({ pressure }) => pressure >= 40);
    return item.ward === from || risk || count(state, from) >= count(state, to) * 3;
  }
  const front = world.cities.filter(({ key, links }) => state.cities[key].owner === to && links.some((site) =>
    ![from, to].includes(state.cities[site].owner) && !treatyWith(state, to, state.cities[site].owner)));
  return Boolean(city || payment >= 10 || count(state, from) >= count(state, to) || front.length >= 2 || state.factions[to].grain <= 60);
}

function event(world, era, state, entries, item, name, detail) {
  const city = item.city ?? (livingSide(state, item.from) ? firstCity(world, state, item.from) : null);
  entries.push(polityEntry(name, item.from, factionName(era, item.from) + "与" + factionName(era, item.to) + " · "
    + settlementKinds[item.kind] + "。 " + detail, { participants: [item.from, item.to], ...(city ? { city } : {}) }));
}

function completeSettlement(world, era, state, item, turn, entries, ledger) {
  const { from, to, kind, city, payment } = item;
  const before = { ...state.factions[state.player] };
  if (kind === "peace") {
    state.factions[from].treasury -= payment;
    state.factions[to].treasury += payment;
    if (city) handoverCities(world, era, state, from, to, [city], "return", turn);
    const sides = [from, to].sort();
    const existing = state.treaties.find(({ sides: pair }) => pair[0] === sides[0] && pair[1] === sides[1]);
    const expires = turn + treatyTerms.truce.seasons;
    if (existing) existing.expires = Math.max(existing.expires, expires);
    else state.treaties.push({ sides, kind: "truce", expires });
  }
  if (kind === "protection") {
    state.polity.protections.push({ ward: item.ward, patron: patronOf(item), since: turn, expires: turn + 12, good: 0 });
  }
  if (kind === "union") {
    const ward = item.ward;
    const patron = patronOf(item);
    const cities = occupiedBy(state, ward);
    handoverCities(world, era, state, ward, patron, cities, "union", turn);
    item.city = cities[0];
  }
  for (const resource of ["treasury", "grain"]) {
    const delta = state.factions[state.player][resource] - before[resource];
    if (delta >= 0) ledger.in[resource] += delta;
    else ledger.out[resource] -= delta;
  }
  if ([from, to].includes(state.player)) state.polity.peaceDeals += 1;
  event(world, era, state, entries, item, kind === "union" ? "union" : "delivered",
    kind === "peace" ? "交割完毕，停战生效。" + (city ? "已返还" + cityName(world, city) + "。" : "")
      + (payment ? "实际支付 " + payment + " 钱。" : "")
      : kind === "union" ? "完成城池、人员和国库交接。" : "保护期开始，双方独立执政。");
}

export function settleNegotiations(world, state, proposals, entries, ledger, turn, forecast = false) {
  const data = state.polity;
  for (const item of [...data.deals]) {
    const playerInvolved = [item.from, item.to].includes(state.player);
    if (turn < item.due || (forecast && !playerInvolved)) continue;
    data.deals = data.deals.filter(({ id }) => id !== item.id);
    const condition = settlementTerms(world, state, item, true);
    const era = eraByYear(world, state, turn);
    if (condition.possible) completeSettlement(world, era, state, item, turn, entries, ledger);
    else {
      if (playerInvolved) data.lastBreach = turn;
      event(world, era, state, entries, item, "breach", "交割失败。" + condition.reason);
    }
  }
  if (forecast) return;
  const era = eraByYear(world, state, turn);
  for (const item of [...data.offers]) {
    if (item.to === state.player && item.accept === undefined && turn - item.submitted < 3
      && livingSide(state, item.from) && livingSide(state, item.to)) continue;
    data.offers = data.offers.filter(({ id }) => id !== item.id);
    const terms = settlementTerms(world, state, item, true);
    const approved = terms.possible && (item.to === state.player ? item.accept === true : acceptedByRival(world, state, item));
    if (approved) {
      const { accept, submitted, ...deal } = item;
      data.deals.push({ ...deal, due: turn + 1 });
    }
    event(world, era, state, entries, item, approved ? "signed" : "rejected",
      approved ? "已批准，次季执行。" + terms.summary : terms.possible ? "议案未获同意或答复逾期。" : terms.reason);
  }
  for (const { key } of era.factions) {
    const directive = proposals[key];
    if (key === state.player || !livingSide(state, key) || directive?.type !== "settlement") continue;
    const draft = directive.draft;
    if (!settlementTerms(world, state, draft).possible) continue;
    const item = addOffer(state, draft);
    item.submitted = turn;
    event(world, era, state, entries, item, "petition", "新议案已递交。");
  }
  for (const item of data.protections) {
    if (item.since >= turn || !livingSide(state, item.ward) || !livingSide(state, item.patron) || item.expires <= turn) continue;
    const calm = provinceRows(world, state, item.ward).every(({ pressure }) => pressure < 55);
    item.good = calm ? Math.min(12, item.good + 1) : 0;
  }
}
