import { cityName, cityReserve, eraByYear, factionName, gameOutcome } from "./engine.js";
import { accordCredit, adjustCredit } from "./accords.js";
import { handoverCities, retreatCity } from "./polity-handover.js";
import { livingSide, plain } from "./polities-data.js";
import { townIntel } from "./war-intel.js";

const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const labels = { yes: "赞成", no: "反对" };
export const allianceDuties = { assault: "攻取目标", screen: "屏护战线", supply: "筹运粮草" };

export function conferencePass(state, a, b, clause = "border") {
  return state.landscape?.congresses.find((row) => row.status === "active" && row[clause] && row.until > state.turn
    && row.parties.includes(a) && row.parties.includes(b));
}

export function congressTarget(state, faction) {
  return state.landscape?.congresses.find((row) => row.status === "active" && !row.completed && row.until > state.turn
    && row.parties.includes(faction) && row.duties?.[faction] !== "supply" && !row.parties.includes(state.cities[row.target].owner))?.target;
}

export function congressDuty(state, faction, target) {
  return state.landscape?.congresses.find((row) => row.status === "active" && row.until > state.turn
    && row.target === target && row.parties.includes(faction))?.duties?.[faction];
}

export function congressExitOptions(state, faction) {
  return state.statecraft ? state.landscape.congresses.filter((row) => row.status === "active" && row.duties
    && state.turn - row.started >= 2 && row.parties.includes(faction) && row.host !== faction && !row.completed
    && (state.factions[faction].grain < 25 || accordCredit(state, faction, row.host) < -12))
    .map((row) => ({ id: "X" + row.id, target: row.target, urgent: state.factions[faction].grain < 12 })) : [];
}

function validTerms(state, terms) {
  if (!terms || !Array.isArray(terms.parties) || terms.parties.length < 3 || terms.parties.length > 5
    || new Set(terms.parties).size !== terms.parties.length || !terms.parties.every((key) => Object.hasOwn(state.factions, key))
    || !terms.parties.includes(terms.host) || !Object.hasOwn(state.cities, terms.target) || !integer(terms.duration, 4, 12)
    || !["market", "border"].every((key) => typeof terms[key] === "boolean") || !terms.market && !terms.border
    || !integer(terms.aid, 0, 30) || (terms.aid > 0 && (!terms.parties.includes(terms.beneficiary) || terms.beneficiary === terms.host))) return false;
  return (!terms.returnTo || terms.parties.includes(terms.returnTo)) && (terms.duties === undefined || (plain(terms.duties)
    && Object.keys(terms.duties).length === terms.parties.length && terms.parties.every((key) => Object.hasOwn(allianceDuties, terms.duties[key]))
    && Object.values(terms.duties).includes("assault") && (!Object.values(terms.duties).includes("supply") || terms.aid > 0)));
}

export function proposeCongress(state, draft) {
  return proposeCongressFor(state, state.player, draft);
}

export function proposeCongressFor(state, host, draft) {
  const data = state.landscape;
  if (!data || gameOutcome(state) !== "ongoing") throw new Error("当前战局不能召集议盟。");
  if (!Array.isArray(draft?.guests)) throw new Error("请选择至少两位受邀方。");
  const terms = { ...draft, host, parties: [host, ...draft.guests] };
  if (!validTerms(state, terms) || terms.parties.some((key) => !livingSide(state, key)) || terms.parties.includes(state.cities[terms.target].owner)) {
    throw new Error("至少邀请两个不同势力，约定共同目标、粮援与边界条款。");
  }
  if (data.congresses.filter(({ status }) => ["active", "voting"].includes(status)).length >= 4) throw new Error("同时最多处理四场议盟。");
  const next = structuredClone(state);
  const { parties, target, duration, market, border, aid, beneficiary, returnTo, duties } = terms;
  next.landscape.congresses = [...data.congresses, { id: data.sequence, host, parties, target, duration, market, border, aid,
    beneficiary: aid ? beneficiary : null, returnTo: returnTo || null, opened: state.turn, status: "voting", votes: { [host]: "yes" },
    contributions: {}, delivered: 0, completed: false, ...(duties ? { duties: { ...duties } } : {}) }];
  if (next.landscape.congresses.length > 18) {
    const old = next.landscape.congresses.findIndex(({ status }) => status === "closed" || status === "rejected");
    next.landscape.congresses.splice(old, 1);
  }
  next.landscape.sequence++;
  return next;
}

export function answerCongressInvitation(state, id, vote) {
  const next = structuredClone(state);
  const row = next.landscape?.congresses.find((item) => item.id === id && item.status === "voting" && item.host !== next.player
    && item.parties.includes(next.player) && !item.votes[next.player]);
  if (!row || !Object.hasOwn(labels, vote)) throw new Error("请选择等待本方表决的议盟。");
  row.votes[next.player] = vote;
  return next;
}

export function voteOptions(world, state, faction) {
  return state.landscape?.congresses.filter((row) => row.status === "voting" && row.parties.includes(faction) && !row.votes[faction])
    .map((row) => {
      const intel = townIntel(state, faction, row.target);
      const relation = accordCredit(state, faction, row.host);
      const close = world.cities.some(({ key, links }) => state.cities[key].owner === faction && links.includes(row.target));
      const support = relation >= 4 || (relation >= -10 && (close || row.market || row.beneficiary === faction));
      return { id: "C" + row.id, target: cityName(world, row.target), host: row.host,
        relation, aid: row.beneficiary === faction ? row.aid : 0, openMarket: row.market, border: row.border,
        ...(row.duties ? { duty: allianceDuties[row.duties[faction]] } : {}),
        report: { source: intel.source, age: intel.seen === undefined ? null : state.turn - intel.seen, troops: intel.troops },
        defaultVote: support ? "yes" : "no" };
    }) ?? [];
}

export function leaveCongress(state, id) {
  if (!state.statecraft || gameOutcome(state) !== "ongoing") throw new Error("当前无法退出议盟。");
  const next = structuredClone(state);
  const row = next.landscape.congresses.find((row) => row.id === id && row.parties.includes(state.player) && row.status === "active");
  if (!row?.duties) throw new Error("只能退出本方仍在参与的战区议盟。");
  row.exitRequested = state.player;
  return next;
}

export function settleCongresses(world, state, proposals, account, entries) {
  const era = eraByYear(world, state);
  const note = (row, text) => entries.push({ type: "grand", faction: row.host, participants: row.parties, city: row.target, text });
  for (const row of state.landscape.congresses) {
    if (row.status === "voting") {
      for (const faction of row.parties) {
        if (row.votes[faction]) continue;
        if (state.sandtable && faction === state.player && state.turn - row.opened < 2 && livingSide(state, faction)) continue;
        const options = voteOptions(world, state, faction);
        const option = options.find(({ id }) => id === "C" + row.id);
        const response = proposals[faction]?.source === "model" ? proposals[faction].votes?.[option?.id] : undefined;
        row.votes[faction] = !livingSide(state, faction) || state.sandtable && faction === state.player ? "no"
          : Object.hasOwn(labels, response) ? response : option.defaultVote;
        note(row, factionName(era, faction) + "对" + cityName(world, row.target) + "议约投票" + labels[row.votes[faction]] + "。");
      }
      if (Object.values(row.votes).includes("no")) {
        row.status = "rejected";
        continue;
      }
      if (row.parties.some((faction) => !row.votes[faction])) continue;
      if (row.parties.includes(state.cities[row.target].owner)) {
        row.status = "rejected";
        note(row, "共同目标已经易主，议约未生效。");
        continue;
      }
      row.status = "active";
      row.started = state.turn;
      row.until = state.turn + row.duration + 1;
      note(row, "多方议约生效。共同目标为" + cityName(world, row.target) + "。");
    }
    if (row.status !== "active") continue;
    const quitter = row.exitRequested ?? row.parties.find((faction) => {
      if (!livingSide(state, faction)) return false;
      const opt = congressExitOptions(state, faction).find(({ id }) => id === "X" + row.id);
      return opt && (opt.urgent || (proposals[faction]?.source === "model" && proposals[faction].withdraw === opt.id));
    });
    if (quitter) {
      row.status = "closed";
      row.withdrawn = { faction: quitter, turn: state.turn };
      delete row.exitRequested;
      for (const other of row.parties.filter((key) => key !== quitter)) adjustCredit(state, quitter, other, -12);
      if (row.parties.includes(state.player)) state.polity.lastBreach = state.turn + 1;
      note(row, factionName(era, quitter) + "退出议盟，停战通行及后续义务终止。");
      continue;
    }
    if (state.turn + 1 < row.until) {
      let aidDelivered = false;
      if (row.aid && livingSide(state, row.beneficiary) && livingSide(state, row.host)
        && account(row.host, "out", { treasury: 0, grain: row.aid })) {
        account(row.beneficiary, "in", { treasury: 0, grain: row.aid });
        row.delivered += row.aid;
        aidDelivered = true;
        adjustCredit(state, row.host, row.beneficiary, 3);
      } else if (row.aid) {
        adjustCredit(state, row.host, row.beneficiary, -5);
        note(row, "本季粮援未履行，双方信用下降。");
      }
      for (const faction of row.parties) {
        const actions = entries.filter((entry) => entry.faction === faction && entry.city === row.target
          && (entry.battle || ["encircled", "pressure", "blockaded", "breach", "support"].includes(entry.event)));
        const role = row.duties?.[faction];
        let performed = actions.length > 0;
        if (role === "screen") {
          const links = world.cities.find(({ key }) => key === row.target).links;
          performed ||= Boolean(state.armies?.some((army) => army.faction === faction && army.troops >= 400
            && links.includes(army.location) && (army.phase === "hold" || army.target === row.target)));
        }
        if (role === "supply") {
          const receiver = row.parties.find((key) => key !== faction && key !== row.host) ?? row.host;
          performed = faction === row.host ? aidDelivered
            : livingSide(state, receiver) && state.factions[faction].grain >= row.aid + 18
              && account(faction, "out", { treasury: 0, grain: row.aid });
          if (performed && faction !== row.host) account(receiver, "in", { treasury: 0, grain: row.aid });
        }
        if (performed) row.contributions[faction] = (row.contributions[faction] ?? 0) + 1;
      }
      if (row.parties.includes(state.cities[row.target].owner)) row.completed = true;
      continue;
    }
    row.status = "closed";
    const owner = state.cities[row.target].owner;
    if (row.completed && row.returnTo && owner !== row.returnTo && row.parties.includes(owner)
      && livingSide(state, row.returnTo) && Object.values(state.cities).filter((city) => city.owner === owner).length > 1) {
      const target = state.cities[row.target];
      const withdrawn = Math.max(0, target.troops - cityReserve);
      const before = state.factions[state.player].grain;
      handoverCities(world, era, state, owner, row.returnTo, [row.target], "return", state.turn + 1);
      const rear = retreatCity(world, state, owner, row.target);
      target.troops -= withdrawn;
      state.cities[rear].troops += withdrawn;
      const returned = state.factions[state.player].grain - before;
      if (returned) {
        state.factions[state.player].grain -= returned;
        account(state.player, "in", { treasury: 0, grain: returned });
      }
      note(row, "战后执行归城。原驻防 " + withdrawn + " 人撤往" + cityName(world, rear) + "。");
    }
    for (const faction of row.parties.filter((key) => key !== row.host)) {
      adjustCredit(state, row.host, faction, row.contributions[faction] ? 6 : row.completed ? -2 : 0);
    }
    if (row.completed && row.border && row.parties.includes(state.player)) state.polity.peaceDeals++;
    note(row, row.completed ? "议约到期，共同目标已完成，按各方履约记录结算。" : "议约到期，共同目标未完成。");
  }
}

export function validCongresses(state, data) {
  return Array.isArray(data.congresses) && data.congresses.length <= 18
    && new Set(data.congresses.map((row) => row?.id)).size === data.congresses.length
    && data.congresses.every((row) => validTerms(state, row) && integer(row.id, 1, data.sequence - 1)
      && integer(row.opened, data.since, state.turn) && ["voting", "rejected", "active", "closed"].includes(row.status)
      && plain(row.votes) && row.votes[row.host] === "yes"
      && Object.entries(row.votes).every(([key, value]) => row.parties.includes(key) && Object.hasOwn(labels, value))
      && plain(row.contributions) && Object.entries(row.contributions).every(([key, value]) => row.parties.includes(key) && integer(value, 1, row.duration + 1))
      && integer(row.delivered, 0, row.aid * (row.duration + 1)) && typeof row.completed === "boolean"
      && (row.exitRequested === undefined || row.status === "active" && row.parties.includes(row.exitRequested))
      && (row.withdrawn === undefined || row.status === "closed" && row.parties.includes(row.withdrawn.faction)
        && integer(row.withdrawn.turn, row.opened, state.turn))
      && (!["active", "closed"].includes(row.status) || (integer(row.started, row.opened, state.turn) && row.until === row.started + row.duration + 1)));
}
