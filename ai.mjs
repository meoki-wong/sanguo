import {
  cityName, eraByYear, factionName, forceTotals, playableFactions, postingOf, projects, seasons,
} from "./dist/engine.js";
import { assessGoal, describeChoice, describeGoalProgress, factionPlans } from "./dist/strategy.js";
import { isHostile, treatyTerms } from "./dist/diplomacy.js";
import { armyPhases } from "./dist/armies.js";
import { knownOfficer } from "./dist/personnel.js";
import { accordCandidates, accordCredit, accordKinds, activeAccords } from "./dist/accords.js";
import { realmPolicy, realmReserve } from "./dist/realm.js";
import { intelLabels, intelSummary, militaryView, townIntel } from "./dist/war-intel.js";
import { stances } from "./dist/war-operations.js";
import { politicalChoices, politicalDescription } from "./dist/polity.js";
import { agendaChoices, agendas } from "./dist/grand.js";
import { observerReport } from "./dist/landscape.js";
import { voteOptions } from "./dist/landscape-treaty.js";

const priorities = {
  cao: "先攒钱粮，选择能站稳的进攻机会。",
  wei: "保障国库与边防，兵力占优时再扩张。",
  yuan: "在粮草允许时集结兵力，扩大河北优势。",
  zhang: "积累蜀地粮仓，稳住通向成都的关口。",
  biao: "经营荆州商路，守住长江沿岸。",
  lu: "守住汉中，补足驻军和存粮。",
  ce: "抓住战力优势扩大江东，兼顾储粮。",
  wu: "先经营江东财赋，再守好沿江城池。",
  ma: "留足边城驻兵，重视关陇粮储。",
  gongsun: "辽东兵力有限，优先守城和增募。",
  shu: "粮运与守关优先，谨慎向北出征。",
  jin: "凭借较大城池规模增收，选择成本低的扩张。",
  liu: "优先保住江夏，为弱势开局争取粮援、商路和盟友。",
  han: "守住荆南，利用沿江通商维持地方自主。",
};

function makePrompt(world, era, state, faction, plan, accords, political, strategy, ballots) {
  const known = militaryView(state, faction);
  const stock = state.factions[faction];
  const totals = forceTotals(state, faction);
  const heldCities = world.cities.filter(({ key }) => state.cities[key].owner === faction).map(({ key, links, name }) => {
    const city = state.cities[key];
    const border = links.some((neighbor) => isHostile(state, faction, state.cities[neighbor].owner)) ? "边" : "";
    const program = city.mode === "delegated"
      ? " 委任" + (projects[city.focus]?.name ?? "征兵") + (city.delegateBudget === null ? "" : "/" + city.delegateBudget + "钱") : "";
    return name + border + " " + city.troops + "兵/" + city.defense + "防" + program;
  });
  const personnel = era.officers.filter((officer) => officer.faction === faction && knownOfficer(state, officer)).map((entry) => {
    const duty = postingOf(state, entry.key);
    const stationed = state.stations[entry.key];
    return entry.name + " 政" + entry.governance + "/统" + entry.command
      + (stationed ? " 驻" + cityName(world, stationed) : "")
      + " " + (duty?.role === "commander" ? "守将" : duty ? "太守" : "待任");
  });
  const orderLabels = { attack: "出征", mobilize: "组建军团", transfer: "调兵", deploy: "武将调任", "appoint-governor": "补任太守",
    "delegate-city": "委任内政", build: "建设", recruit: "征兵", rest: "休整" };
  const past = state.history.slice(-3)
    .map((report) => report.decisions?.find((decision) => decision.faction === faction)?.orderType)
    .map((order) => orderLabels[order]).filter(Boolean);
  const name = factionName(era, faction);
  const fieldArmies = (state.armies ?? []).filter((army) => army.faction === faction).map((army) => {
    return cityName(world, army.location) + "至" + cityName(world, army.target) + " " + armyPhases[army.phase]
      + "，兵" + army.troops + "，随军粮" + army.grain;
  });
  const agreements = (state.treaties ?? []).filter(({ sides }) => sides.includes(faction)).map(({ sides, kind, expires }) => {
    const partner = sides.find((key) => key !== faction);
    return factionName(era, partner) + treatyTerms[kind].name + "余" + (expires - state.turn) + "季";
  });
  const negotiated = (state.grand?.passes ?? []).filter(({ from, to, expires }) => [from, to].includes(faction) && expires > state.turn)
    .map(({ from, to, kind, expires }) => factionName(era, from === faction ? to : from) + (kind === "halt" ? "议约停战" : "军路授权")
      + "余" + (expires - state.turn) + "季");
  const policy = realmPolicy(state, faction);
  const reserve = realmReserve(state, faction);
  const outlook = observerReport(world, state, faction);
  const diplomacy = activeAccords(state, faction).map(({ kind, from, to, expires, target }) => {
    const partner = from === faction ? to : from;
    return factionName(era, partner) + accordKinds[kind] + "余" + (expires - state.turn) + "季，信用 " + accordCredit(state, faction, partner)
      + (target ? "，目标 " + cityName(world, target) : "");
  });
  const recentAccords = state.realm ? state.history.slice(-3).flatMap(({ entries }) => entries)
    .filter(({ type, participants }) => type === "diplomacy" && participants?.includes(faction))
    .slice(-4).map(({ text }) => text) : [];
  const watched = state.war ? [...new Set(plan.goals.map(({ target }) => target).filter(Boolean))].map((key) => {
    const record = townIntel(state, faction, key);
    return cityName(world, key) + "驻军 " + intelSummary(state, faction, key) + "，" + intelLabels[record.source]
      + (record.seen === undefined ? "" : "第" + record.seen + "季");
  }) : [];
  return [
    { role: "system", content: "你在虚构回合制游戏《经略三国》中独立执政。每个政令候选对应一个目标和本季行动。返回 JSON，choice 为政令候选编号字符串，reason 为 20 字以内的中文理由。可用 accord 选择外交候选、politics 选择州郡或朝局候选、agenda 选择未来四季的方针。votes 可按议约编号返回 yes 或 no。依据本势力钱粮、守备和关系取舍。" },
    { role: "user", content: [
      name + " · 第 " + (Math.floor(state.turn / 4) + 1) + " 年" + seasons[state.turn % 4] + "季",
      "施政倾向 " + (priorities[faction] ?? "安集新附州郡，稳固地方驻防与钱粮"),
      "国库 " + stock.treasury + "，储粮 " + stock.grain + "，民心 " + stock.morale
        + "。本季预计入库钱 " + totals.treasury + "、粮 " + totals.grain + "。",
      "己方城池 " + heldCities.join("、"),
      "己方人物 " + personnel.join("、"),
      ...(fieldArmies.length ? ["己方军团 " + fieldArmies.join("、")] : []),
      ...(agreements.length || negotiated.length ? ["现有约定 " + [...agreements, ...negotiated].join("、")] : []),
      ...(policy ? [`全国拨款上限 发展 ${policy.development}、军备 ${policy.military}、救济 ${policy.relief}。底线 ${reserve.treasury} 钱、${reserve.grain} 粮。`] : []),
      ...(diplomacy.length ? ["通商与履约 " + diplomacy.join("、")] : []),
      ...(recentAccords.length ? ["近季外交 " + recentAccords.join(" ")] : []),
      ...(watched.length ? ["本方军情 " + watched.join("、") + "。按区间估算。"] : []),
      ...(outlook ? ["时令 " + outlook.weather + "，本方军械 " + outlook.equipment,
        ...outlook.cities.map(({ city, source, age, confidence, troops }) => city + " " + intelLabels[source]
          + (age === null ? "" : " " + age + " 季前 · " + confidence + "可信 · 驻军 " + troops.join("–"))),
        ...outlook.politics.map(({ host, status, target, delivered, ownContribution }) =>
          factionName(era, host) + "召集的" + target + "议约 " + status + "。交纳军粮 " + delivered + "，我方行动 " + ownContribution + " 季。")] : []),
      ...ballots.map(({ id, target, host, relation, aid, openMarket, border }) => "议约 " + id + " " + factionName(era, host)
        + "邀请共取" + target + "，信用 " + relation + "，每季粮援 " + aid + (openMarket ? "，互市" : "") + (border ? "，互开边界" : "")),
      ...accords.map(({ to, kind, grain, target }, index) => `外交 T${index} 向${factionName(era, to)}提议${accordKinds[kind]}`
        + (target ? cityName(world, target) : grain ? grain + " 粮" : "")),
      ...political.map(({ id, directive }) => "朝局 " + id + " " + politicalDescription(era, directive)),
      ...strategy.map(({ id, kind, rival }) => "方针 " + id + " " + agendas[kind] + (rival ? "，主要对手 " + factionName(era, rival) : "")),
      ...(past.length ? ["近季政令 " + past.join("、")] : []),
      ...(plan.recovering ? ["当前钱粮吃紧，本季以休养和恢复储备为主。"] : []),
      ...(plan.urgent ? ["前线有城池可能失守，优先稳住守军。"] : []),
      ...(plan.supplyCut ? ["有机会切断敌军补给。"] : []),
      plan.keep ? "继续执行现有战略目标。" : "请选择新的战略目标及本季行动。",
      ...plan.goals.flatMap((goal) => [
        "目标 " + describeGoalProgress(world, assessGoal(state, faction, goal), state.turn + 1),
        ...plan.choices.filter((choice) => choice.goal === goal)
          .map(({ id, order }) => id + " " + describeChoice(world, era, known, faction, order)
            + (order?.stance ? " · 战法" + stances[order.stance] : "")),
      ]),
    ].join("\n") },
  ];
}

export function opponentKeys(world, state) {
  return playableFactions(eraByYear(world, state)).map(({ key }) => key)
    .filter((key) => key !== state.player && forceTotals(state, key).cities > 0);
}

export function createPlanner({
  models, timeoutMs = 45_000,
} = {}) {
  async function planFaction(world, era, state, faction, client, deadline) {
    const plan = factionPlans(world, era, state, faction);
    const accords = accordCandidates(world, era, state, faction);
    const political = politicalChoices(world, era, state, faction);
    const strategy = agendaChoices(world, state, faction);
    const ballots = voteOptions(world, state, faction);
    try {
      const output = await client.decide(makePrompt(world, era, state, faction, plan, accords, political, strategy, ballots), deadline);
      const selected = plan.choices.find(({ id }) => id === output?.choice);
      if (!selected || typeof output?.reason !== "string" || !output.reason.trim()) {
        return { source: "fallback", reason: "模型政令格式无效" };
      }
      const choice = accords.find((_, index) => output.accord === "T" + index);
      const politics = political.find(({ id }) => id === output.politics);
      const agenda = strategy.find(({ id }) => id === output.agenda);
      const votes = Object.fromEntries(ballots.flatMap(({ id }) => ["yes", "no"].includes(output.votes?.[id]) ? [[id, output.votes[id]]] : []));
      return { source: "model", goal: selected.goal, order: selected.order,
        ...(choice || output.accord === "" ? { accord: choice ?? null } : {}),
        ...(politics || output.politics === "" ? { politics: politics?.id ?? "" } : {}),
        ...(agenda ? { agenda: agenda.id } : {}),
        ...(Object.keys(votes).length ? { votes } : {}),
        reason: output.reason.replace(/\s+/g, " ").trim().slice(0, 64) };
    } catch (error) {
      let cause = "模型服务暂不可用";
      if (error.name === "TimeoutError" || error.name === "AbortError") cause = "模型决策超时";
      else if ([401, 403].includes(error.status)) cause = "模型鉴权失败";
      else if (error.code === "INVALID_MODEL_OUTPUT") cause = "模型政令格式无效";
      return { source: "fallback", reason: cause };
    }
  }

  return {
    async plan(world, state, onProgress) {
      const opponents = opponentKeys(world, state);
      const client = models?.client();
      if (!client) return {};
      const era = eraByYear(world, state);
      const deadline = AbortSignal.timeout(timeoutMs);
      const entries = await Promise.all(opponents.map(async (key) => {
        const decision = await planFaction(world, era, state, key, client, deadline);
        onProgress?.(key, decision.source);
        return [key, decision];
      }));
      return Object.fromEntries(entries);
    },
  };
}
