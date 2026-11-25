import { cityName, eraByYear, firstCity, gameOutcome } from "./engine.js";
import { courtBacking, courtCandidates, courtFor, provinceRows } from "./polity-governance.js";
import { bounded, livingSide, plain } from "./polities-data.js";
import { loyalty } from "./statecraft-personnel.js";
import { mandateGoals, settleEconomy8, validEconomy8 } from "./dynasty-economy.js";
import { settleTreaties8, validTreaties8 } from "./dynasty-treaties.js";

export const jurisdiction = { charter: "授予州牧事权", relieve: "赈济与安抚", recall: "收回委任" };
export const provinceStages = { stable: "正常", arrears: "延缴财赋", refusal: "拒绝征募", revolt: "有起兵风险" };
const basePolicy = { priority: "growth", moneyFloor: 24, grainFloor: 24, money: 32, grain: 24, diplomacy: false };
const cap = (value) => Math.max(0, Math.min(100, value));
const issues = ["supply", "calamity", "treaty", "province", "court"];
const zero = () => ({ treasury: 0, grain: 0 });

export function enableDynasty(state) {
  if (state.dynasty) return state;
  if (!state.highCommand) throw new Error("需先启用全国军议，再升级为 8.0。");
  return { ...state, dynasty: { since: state.turn, serial: 1, policies: {}, sites: {}, capitals: {}, mandates: {},
    restorations: {}, programs: [], convoys: [], treaties: [], notices: [], dispatches: [], timelines: [],
    courts: {}, provinces: {}, agendas: {}, continuity: { unity: gameOutcome(state) === "victory" ? 3 : 0,
      alliance: state.scenarioEnding?.kind === "coalition" ? 3 : 0, peace: state.scenarioEnding?.kind === "peace" ? 3 : 0 } } };
}

export function dynastyPolicy(state, side = state.player) {
  return state.dynasty?.policies[side] ?? basePolicy;
}

function validPolicy(policy) {
  return plain(policy) && Object.hasOwn(mandateGoals, policy.priority) && ["moneyFloor", "grainFloor", "money", "grain"]
    .every((key) => bounded(policy[key], 0, 999)) && typeof policy.diplomacy === "boolean";
}

export function saveDynastyPolicy(state, policy) {
  if (!state.dynasty || gameOutcome(state) !== "ongoing" || !validPolicy(policy)) throw new Error("请填写有效的国库底线及每季拨款。");
  const next = structuredClone(state);
  next.dynasty.policies[state.player] = Object.fromEntries(Object.keys(basePolicy).map((key) => [key, policy[key]]));
  return next;
}

export function dynastyReport(world, state, entries, side, kind, city, text, participants) {
  const subject = { turn: state.turn + Number(Boolean(entries)), side, kind, city, text, ...(participants ? { participants } : {}) };
  const reports = state.dynasty.dispatches;
  reports.push(subject);
  if (reports.length > 64) reports.shift();
  entries?.push({ type: "dynasty", faction: side, event: kind, city, text, ...(participants ? { participants } : {}) });
}

export function dynastyUrgent(world, state, entries, side, kind, city, text) {
  const turn = state.turn + Number(Boolean(entries));
  const notices = state.dynasty.notices;
  if (notices.some((item) => item.side === side && item.kind === kind && item.city === city && item.text === text && turn - item.turn < 4)) return;
  const keep = notices.length >= 36 ? notices.findIndex((row) => row.acknowledged || row.side !== state.player) : -1;
  if (notices.length >= 36) notices.splice(Math.max(keep, 0), 1);
  notices.push({ id: state.dynasty.serial++, side, kind, city, text, turn, acknowledged: false });
  dynastyReport(world, state, entries, side, kind, city, text);
}

export function dynastyNotices(state) {
  return state.dynasty?.notices.filter((row) => row.side === state.player && !row.acknowledged && row.turn >= state.turn - 6) ?? [];
}

export function acknowledgeDynasty(state, id) {
  const next = structuredClone(state);
  const item = next.dynasty?.notices.find((row) => row.id === id && row.side === state.player);
  if (!item) throw new Error("此事件已归档。");
  item.acknowledged = true;
  return next;
}

const provinceRecord = (state, side, region) => state.dynasty?.provinces[side]?.[region];

export function dynastyProvinces(world, state, side = state.player) {
  return provinceRows(world, state, side).map((row) => {
    const record = provinceRecord(state, side, row.region);
    return { ...row, conflict: record?.conflict ?? 0, authority: record?.authority ?? 10, stage: record?.stage ?? "stable",
      pending: record?.pending ?? null, mandate: state.dynasty?.mandates[side]?.[row.region] };
  });
}

export function orderJurisdiction(world, state, region, action) {
  if (!state.dynasty || gameOutcome(state) !== "ongoing" || !Object.hasOwn(jurisdiction, action)
    || !provinceRows(world, state).some((row) => row.region === region)) throw new Error("请选择可治理的州郡。");
  const next = structuredClone(state);
  getProvince(next, state.player, region).pending = action;
  return next;
}

function getProvince(state, side, region) {
  const regions = state.dynasty.provinces[side] ??= {};
  return regions[region] ??= { authority: 10, conflict: 0, stage: "stable", pending: null };
}

export function dynastyTaxRate(state, key) {
  const stage = state.dynasty?.withheld?.[key];
  return stage === "revolt" ? .55 : stage === "refusal" ? .72 : stage === "arrears" ? .85 : 1;
}

export function dynastyLevyRefused(state, key) {
  return ["refusal", "revolt"].includes(state.dynasty?.withheld?.[key]);
}

export function courtStanding(world, state, side = state.player) {
  const seat = courtFor(state, side);
  const candidates = courtCandidates(eraByYear(world, state), state, side);
  const heir = candidates.find(({ key }) => key === seat?.heir);
  const legitimacy = state.dynasty?.courts[side]?.legitimacy ?? 68;
  return { seat, candidates, legitimacy, support: courtBacking(world, state, side, heir) };
}

function settleAuthority(world, state, entries, accounts, forecast) {
  const data = state.dynasty;
  const turn = state.turn + 1;
  const withheld = data.withheld ??= {};
  const people = new Map(eraByYear(world, state, turn).officers.map((person) => [person.key, person]));
  if (!forecast) for (const entry of entries.filter(({ type, event, faction }) => type === "polity" && faction === state.player
    && ["loyalty-warning", "defection", "independence", "uprising"].includes(event))) {
    dynastyUrgent(world, state, entries, state.player, "province", entry.city, entry.text);
  }
  for (const side of Object.keys(state.factions).filter((key) => (!forecast || key === state.player) && livingSide(state, key))) {
    const seat = courtFor(state, side);
    const court = data.courts[side] ??= { legitimacy: 68 };
    const provinces = dynastyProvinces(world, state, side);
    if (!forecast) {
      if (seat?.last?.turn === turn) {
        const delta = { succession: 20, regency: -9, "court-crisis": -22 }[seat.last.result] ?? 0;
        court.legitimacy = cap(court.legitimacy + delta);
        dynastyReport(world, state, entries, side, "court", firstCity(world, state, side), "交接后朝廷正统 " + court.legitimacy + "。");
      } else {
        court.legitimacy = cap(court.legitimacy + (provinces.some(({ pressure }) => pressure >= 55) ? -2 : 1));
      }
      if (seat?.warned) dynastyUrgent(world, state, entries, side, "court", firstCity(world, state, side), "君主任期将满，请拟定继承人和摄政。");
    }
    for (const province of provinces) {
      const row = getProvince(state, side, province.region);
      const administrativeSeat = province.cities[0];
      const action = row.pending;
      const native = state.polity.provinces[province.key];
      const pay = accounts(side);
      if (action && (action === "recall" || (action === "charter" ? pay(6, 0) : pay(9, 7)))) {
        if (action === "charter") {
          row.authority = cap(row.authority + 22);
          row.conflict = cap(row.conflict - 19);
        } else if (action === "relieve") {
          row.conflict = cap(row.conflict - 28);
          for (const key of province.cities) state.realm.cities[key].welfare = cap(state.realm.cities[key].welfare + 4);
        } else {
          row.authority = cap(row.authority - 30);
          row.conflict = cap(row.conflict + (row.authority > 29 ? 11 : 0));
          if (data.mandates[side]?.[province.region]) data.mandates[side][province.region].mode = "direct";
        }
        if (native) native.pressure = cap(native.pressure + (action === "recall" ? 4 : -10));
        dynastyReport(world, state, entries, side, "province", administrativeSeat, province.region + "执行「" + jurisdiction[action] + "」。");
        row.pending = null;
      }
      if (forecast) continue;
      const steward = people.get(province.mandate?.steward);
      const stewardLoyalty = steward?.faction === side && province.cities.includes(state.stations[steward.key])
        ? loyalty(state, steward) : 75;
      const increments = (province.pressure >= 48 ? 13 : province.danger >= 45 ? 7 : -7)
        + (court.legitimacy < 48 ? 9 : 0) + (row.authority >= 50 && stewardLoyalty < 60 ? 13 : 0);
      row.conflict = cap(row.conflict + increments);
      const stage = row.conflict >= 82 ? "revolt" : row.conflict >= 59 ? "refusal" : row.conflict >= 34 ? "arrears" : "stable";
      for (const city of province.cities) {
        if (stage === "stable") delete withheld[city];
        else withheld[city] = stage;
      }
      if (stage === "revolt" && native) native.pressure = cap(native.pressure + 13);
      if (stage !== "stable" && row.stage !== stage) dynastyUrgent(world, state, entries, side, "province", administrativeSeat,
        province.region + "进入「" + provinceStages[stage] + "」阶段，可安抚、谈判授权或收回委任。");
      row.stage = stage;
    }
  }
}

export function realmAgendaChoices(state, side) {
  if (!state.dynasty || state.turn < 3 || !livingSide(state, side)) return [];
  return Object.entries(mandateGoals).map(([priority, text]) => ({ id: "G8-" + priority, priority, text }));
}

function opponentPolicies(world, state, proposals) {
  for (const side of Object.keys(state.factions).filter((key) => key !== state.player && livingSide(state, key))) {
    const old = state.dynasty.agendas[side];
    if (old?.until > state.turn || state.turn < 4) continue;
    const select = realmAgendaChoices(state, side).find(({ id }) => id === proposals[side]?.dynastyAgenda);
    const police = dynastyProvinces(world, state, side);
    const stock = state.factions[side];
    const priority = select?.priority ?? (police.some(({ conflict }) => conflict >= 38) || stock.grain < 45 ? "relief"
      : police.some(({ shortGarrison }) => shortGarrison > 1) ? "defense" : "growth");
    state.dynasty.policies[side] = { ...basePolicy, priority };
    state.dynasty.agendas[side] = { priority, until: state.turn + 4 };
    const risk = police.find(({ conflict }) => conflict >= 42);
    if (risk && priority === "relief") getProvince(state, side, risk.region).pending = "relieve";
    if (stock.treasury < 120 || !police.length) continue;
    const province = police.find((item) => item.cities.some((key) => state.cities[key].governor));
    if (province) {
      const mandates = state.dynasty.mandates[side] ??= {};
      mandates[province.region] = { region: province.region, steward: null, goal: priority, money: 7, grain: 5,
        dispatch: false, appoint: true, mode: "delegate" };
    }
  }
}

export function settleDynasty(world, previous, state, proposals, entries, forecast = false) {
  if (!state.dynasty) return null;
  const ledger = { in: zero(), out: zero(), budget: zero() };
  const accounts = new Map();
  const payment = (side) => {
    if (accounts.has(side)) return accounts.get(side);
    const policy = dynastyPolicy(state, side);
    const stock = state.factions[side];
    let treasury = policy.money;
    let grain = policy.grain;
    const pay = (t, g) => {
      const floorT = side === state.player ? Math.max(policy.moneyFloor, state.delegationReserve?.treasury ?? 0) : policy.moneyFloor;
      const floorG = side === state.player ? Math.max(policy.grainFloor, state.delegationReserve?.grain ?? 0) : policy.grainFloor;
      if (t > treasury || g > grain || t > Math.max(0, stock.treasury - floorT) || g > Math.max(0, stock.grain - floorG)) return false;
      stock.treasury -= t;
      stock.grain -= g;
      treasury -= t;
      grain -= g;
      if (side === state.player) { ledger.budget.treasury += t; ledger.budget.grain += g; }
      return true;
    };
    accounts.set(side, pay);
    return pay;
  };
  if (!forecast) opponentPolicies(world, state, proposals);
  settleTreaties8(world, state, proposals, entries, ledger, { forecast });
  // Emergency responses get first claim on the seasonal budget.
  if (dynastyPolicy(state).priority === "relief") settleAuthority(world, state, entries, payment, forecast);
  settleEconomy8(world, previous, state, entries, payment, { onlyPlayer: forecast });
  if (dynastyPolicy(state).priority !== "relief") settleAuthority(world, state, entries, payment, forecast);
  return ledger;
}

export function archiveDynasty(world, previous, state) {
  if (!state.dynasty) return;
  const data = state.dynasty;
  for (const [city] of Object.entries(data.withheld ?? {})) if (state.cities[city].owner !== previous.cities[city].owner) delete data.withheld[city];
  const side = state.player;
  const own = Object.values(state.cities).filter(({ owner }) => owner === side);
  const stock = state.factions[side];
  const { moneyFloor, grainFloor } = dynastyPolicy(state);
  const sustainable = stock.treasury >= moneyFloor && stock.grain >= grainFloor
    && dynastyProvinces(world, state).every(({ stage }) => !["refusal", "revolt"].includes(stage));
  const peace = !data.treaties.some((row) => [row.from, row.to].includes(side)
    && (row.status === "offered" || row.status === "active" && row.missed > 0));
  const continuity = data.continuity;
  continuity.unity = sustainable && own.length === world.cities.length && own.filter(({ occupation }) => !occupation).length >= own.length * .8
    ? Math.min(3, continuity.unity + 1) : 0;
  continuity.alliance = sustainable && peace
    ? Math.min(3, continuity.alliance + 1) : 0;
  continuity.peace = sustainable && peace && state.polity.calm > 0 ? Math.min(3, continuity.peace + 1) : 0;
  data.timelines.push({ turn: state.turn, ownership: Object.fromEntries(Object.entries(state.cities).map(([key, value]) => [key, value.owner])),
    freights: data.convoys.filter((row) => row.side === side && ["march", "blocked"].includes(row.status))
      .map((row) => ({ city: row.route[row.cursor], to: row.to, route: row.route.slice(row.cursor), status: row.status })),
    front: (state.armies ?? []).filter((row) => row.faction === side).slice(0, 20)
      .map((row) => ({ city: row.location, to: row.target, route: row.route.slice(), phase: row.phase })),
    distress: world.cities.filter(({ key }) => state.cities[key].owner === side
      && (data.sites[key]?.calamity || data.restorations[key])).map(({ key }) => key) });
  data.timelines = data.timelines.slice(-8);
}

export function validDynasty(world, state, officers) {
  const data = state.dynasty;
  if (data === undefined) return true;
  const city = (key) => Object.hasOwn(state.cities, key);
  const side = (key) => Object.hasOwn(state.factions, key);
  const season = (turn) => bounded(turn, data.since, state.turn);
  const regions = new Set(world.cities.map(({ region }) => region));
  const dictionary = (value, key, item) => plain(value) && Object.entries(value).every(([id, entry]) => key(id) && item(entry));
  const report = (row) => plain(row) && side(row.side) && city(row.city) && season(row.turn) && typeof row.kind === "string"
    && row.kind.length <= 32 && typeof row.text === "string" && row.text.length <= 200;
  const vector = (rows, max) => Array.isArray(rows) && rows.length <= max && rows.every((row) => plain(row) && city(row.city) && city(row.to)
    && Array.isArray(row.route) && row.route.length >= 1 && row.route.length <= world.cities.length && row.route.every(city));
  return Boolean(state.highCommand && plain(data) && bounded(data.since, 0, state.turn) && bounded(data.serial, 1, 100_000_000)
    && dictionary(data.policies, side, validPolicy)
    && dictionary(data.courts, side, (row) => plain(row) && bounded(row.legitimacy, 0, 100))
    && dictionary(data.provinces, side, (group) => dictionary(group, (key) => regions.has(key),
      (row) => plain(row) && bounded(row.authority, 0, 100) && bounded(row.conflict, 0, 100)
        && Object.hasOwn(provinceStages, row.stage) && (row.pending === null || Object.hasOwn(jurisdiction, row.pending))))
    && dictionary(data.withheld ?? {}, city, (value) => Object.hasOwn(provinceStages, value))
    && dictionary(data.agendas, side, (row) => plain(row) && Object.hasOwn(mandateGoals, row.priority)
      && bounded(row.until, data.since, state.turn + 4))
    && plain(data.continuity) && ["unity", "alliance", "peace"].every((key) => bounded(data.continuity[key], 0, 3))
    && Array.isArray(data.dispatches) && data.dispatches.length <= 64 && data.dispatches.every(report)
    && Array.isArray(data.notices) && data.notices.length <= 36 && data.notices.every((row) => report(row)
      && issues.includes(row.kind) && bounded(row.id, 1, data.serial - 1) && typeof row.acknowledged === "boolean")
    && Array.isArray(data.timelines) && data.timelines.length <= 8 && data.timelines.every((row) => plain(row) && season(row.turn)
      && dictionary(row.ownership, city, side) && Object.keys(row.ownership).length === world.cities.length
      && vector(row.freights, 3) && vector(row.front, 20) && Array.isArray(row.distress) && row.distress.length <= 42 && row.distress.every(city))
    && validEconomy8(world, state, officers, data) && validTreaties8(state, data));
}
