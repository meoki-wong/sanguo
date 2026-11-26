import { advanceQuarter, cityName, factionName, firstCity, gameOutcome, seasons } from "./engine.js";
import { dynastyProvinces } from "./dynasty.js";
import { compactOptions, establishTownCompact, marketCauses, marketHealth, marketLines, marketRow, orderMarketRelief } from "./reign-economy.js";
import { assureHandover10, charterLeague10, embargo10, leagueCandidates, leagueLabels, marketEmbargo, recognize10,
  stewardshipTerms, voteLeague10 } from "./reign-leagues.js";
import { administrativeDuties, beginStewardship, confirmWarDeputy, constitutions, giveCourtCharter, giveProvinceCharter,
  pauseMobilization10, publishReign, regionCandidates10, reignAlerts, reignOfficeOptions, reignPeople, reignPolicy,
  reignStages, reignSuccession, reignTemplates, resolveReignAlert, stewardshipProgress } from "./reign.js";
import { mandateGoals } from "./dynasty-economy.js";
import { courtFor } from "./polity-governance.js";
import { livingSide } from "./polities-data.js";
import { strategicFronts9, theaterRoles9 } from "./strategy-nine.js";
import { strategicPost } from "./sandtable-posts.js";
import { factionCourtProfile } from "./imperial.js";

const pages = { summary: "总览", policy: "国制", staff: "册任", markets: "粮政", leagues: "诸侯", record: "回放" };
const staffPages = { offices: "朝廷", regions: "州郡", commands: "战区", succession: "继嗣" };
const bank = { travel: "在途", blocked: "停运待通", delivered: "已入仓", lost: "失去货运", stored: "就地入仓" };
const entries = Object.entries;
const time = (turn) => (Math.floor(turn / 4) + 1) + "年" + seasons[turn % 4];
const signed = (value) => (value > 0 ? "+" : value < 0 ? "−" : "±") + Math.abs(value);

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function createReignDesk(world, actions) {
  const dialog = document.querySelector("#reign-dialog");
  const nav = dialog.querySelector("nav");
  const body = dialog.querySelector(".dynasty-body");
  const notice = dialog.querySelector(".dynasty-notice");
  let pane = "summary";
  let staffPane = "regions";
  let setup = 0;
  let draft;
  let preview;
  let region;
  let city;
  let office;
  let campaign;
  let group;
  let rival;
  let selectedTurn;
  let selectedBattle;
  let event = 0;

  const current = () => actions.snapshot().state;
  const town = (key) => cityName(world, key);
  const where = (key) => strategicPost(key)?.name ?? town(key);
  const report = (text) => node("p", text);
  function row(...items) {
    const block = node("div", undefined, "dynasty-row");
    block.append(...items);
    return block;
  }
  function button(text, id, invoke, disabled = false) {
    const control = node("button", text);
    Object.assign(control, { type: "button", onclick: invoke, disabled });
    control.dataset.reignAction = id;
    return control;
  }
  function field(label, control) {
    const wrapper = node("label", label, "dynasty-field");
    control.setAttribute("aria-label", label);
    wrapper.append(control);
    return { wrapper, control, get value() {
      return control.type === "number" ? control.valueAsNumber : control.type === "checkbox" ? control.checked : control.value;
    } };
  }
  function select(label, choices, value, change) {
    const control = node("select");
    control.append(...choices.map(([key, text]) => new Option(text, key)));
    if (choices.some(([key]) => String(key) === String(value))) control.value = value;
    if (change) control.onchange = () => change(control.value);
    return field(label, control);
  }
  function number(label, value, min, max) {
    const control = node("input");
    Object.assign(control, { type: "number", inputMode: "numeric", value, min, max, step: 1 });
    return field(label, control);
  }
  function check(label, value = false) {
    const control = node("input");
    Object.assign(control, { type: "checkbox", checked: value });
    return field(label, control);
  }
  function heading(title, detail, photo = false) {
    const wrapper = node("header", undefined, "dynasty-heading" + (photo ? " reign-banner" : ""));
    wrapper.append(node("h3", title), report(detail));
    return wrapper;
  }
  function close() { dialog.close(); }
  function leave(method, ...arguments_) { close(); actions[method](...arguments_); }
  function detail(next, key) {
    pane = next;
    if (next === "markets" && key) city = key;
    if (next === "staff" && Object.hasOwn(staffPages, key)) staffPane = key;
    else if (next === "staff" && key) {
      staffPane = "regions";
      region = key;
    }
    notice.textContent = "";
    render();
  }
  function open(next = "summary", key) {
    detail(next, key);
    if (!dialog.open) dialog.showModal();
  }
  function apply(operation, message, then) {
    try {
      const next = operation(current());
      then?.(next);
      actions.commit(next, message);
      notice.textContent = message;
      render();
    } catch (error) { notice.textContent = error.message; }
  }
  function overview(state, era) {
    const data = state.reign;
    const stock = state.factions[state.player];
    const market = marketHealth(state, state.player);
    const active = gameOutcome(state) === "ongoing";
    const notes = [...reignAlerts(state)].reverse();
    const note = notes[event % Math.max(1, notes.length)];
    body.append(heading(factionName(era, state.player) + " · " + reignStages[data.stage],
      "国库 " + stock.treasury + " · 储粮 " + stock.grain + " · 缺粮城 " + market.shortage, true));
    const stewardship = stewardshipProgress(world, state);
    if (stewardship) body.append(report("守成 · 交班" + (stewardship.transferred !== null ? "已完成" : "待安排")
      + " · 稳定 " + stewardship.stable + "/" + stewardship.required + " 季 · " + (data.emergency ? "战时体制待裁撤" : "按常制运行")));
    if (note) {
      const target = ["market", "levy"].includes(note.kind) ? ["markets", note.city]
        : note.kind === "succession" || note.kind === "court-warning" ? ["staff", "succession"]
          : ["league", "sanction", "arrears", "recognition"].includes(note.kind) ? ["leagues"]
            : ["staff", note.region ?? (note.kind === "command" ? "commands" : "regions")];
      body.append(report(note.text), row(button("处理", "handle", () => detail(...target)),
        ...(active && note.region && state.cities[note.city].owner === state.player ? [button("批准赈济", "relief-urgent", () =>
          apply((next) => resolveReignAlert(world, next, note.id, "relief"), "已下达赈济令。"))] : []),
        ...(active && note.kind === "autonomy" && note.region && state.cities[note.city].owner === state.player ? [button("协议让权", "devolve", () =>
          apply((next) => resolveReignAlert(world, next, note.id, "devolve"), "拟以地方民政换取军事事权收束。"))] : []),
        button("已阅", "ack", () => apply((next) => resolveReignAlert(world, next, note.id, "read"), "奏报已阅。")),
        ...(notes.length > 1 ? [button("下一件", "next-alert", () => { event++; render(); })] : [])));
    } else body.append(report(data.blueprint ? "当前没有待裁决的奏报。" : "先选择执政方针、设定授权，再核对下一季的钱粮。"));
    if (active) body.append(row(
      data.blueprint ? button("全国方略", "strategy", () => leave("strategy")) : button("制定国策", "start-policy", () => { setup = 0; detail("policy"); }),
      button("全国地图", "map", () => leave("map", "regions")),
      button("推进一季", "advance", () => leave("advance")),
      button("连推一年", "batch", () => leave("batch"), notes.length > 0),
      ...(stewardship && data.emergency ? [button("裁撤战时征发", "demobilize", () => apply(pauseMobilization10, "战时征发已按常制收束。"))] : [])));
    else if (gameOutcome(state) === "victory" && !stewardship) body.append(
      button("进入守成篇", "continue", () => apply((next) => beginStewardship(world, next), "继任朝廷已接收国库和军令。")));
    if (stewardship && active) {
      const terms = stewardshipTerms(world, state);
      if (terms.length) body.append(row(button("续定交班停战 · " + terms.reduce((sum, item) => sum + item.cost, 0) + " 钱",
        "armistice", () => apply((next) => assureHandover10(world, next), "停战款项已实际交付。"))));
    }
  }
  function policy(state) {
    const existing = reignPolicy(state);
    draft ??= { ...existing };
    if (setup === 0) {
      const objective = select("执政方向", entries(reignTemplates), draft.objective);
      const structure = select("治理制度", entries(constitutions), draft.stateForm);
      body.append(heading(state.reign.blueprint ? "调整执政方针" : "先定执政方针", "制度影响地方留粮、州郡额度和交班时的事权。"),
        row(objective.wrapper, structure.wrapper, button("设授权", "to-authority", () => {
          draft = { ...draft, objective: objective.value, stateForm: structure.value };
          setup = 1;
          render();
        })));
      return;
    }
    if (setup === 1) {
      const storage = number("地方目标库存", draft.stock, 5, 40);
      const levy = number("年征发粮上限", draft.annualLevy, 0, 160);
      const budget = number("季拨赈济钱", draft.relief, 0, 120);
      const grain = number("季拨赈济粮", draft.grain, 0, 90);
      const routes = number("在途粮队上限", draft.freight, 1, 6);
      const reserve = number("国库钱粮底线", draft.reserve, 5, 150);
      const batch = check("补齐未设州郡委任", draft.batch ?? true);
      body.append(row(storage.wrapper, levy.wrapper, budget.wrapper), row(grain.wrapper, routes.wrapper, reserve.wrapper),
        row(batch.wrapper, button("核对钱粮", "review-policy", () => {
          draft = { ...draft, stock: storage.value, annualLevy: levy.value, relief: budget.value, grain: grain.value,
            freight: routes.value, reserve: reserve.value, batch: batch.value };
          try {
            const changed = publishReign(world, state, draft, { batch: draft.batch });
            const before = advanceQuarter(world, state);
            const after = advanceQuarter(world, changed);
            preview = { before: before.factions[state.player], after: after.factions[state.player],
              towns: world.cities.filter(({ key }) => after.cities[key].owner === state.player)
                .map(({ key }) => ({ key, change: marketRow(after, key).bins - marketRow(before, key).bins }))
                .filter(({ change }) => change !== 0),
              staff: Object.keys(changed.reign.seats).length };
            setup = 2;
            render();
          } catch (error) { notice.textContent = error.message; }
        }), button("返回", "policy-back", () => { setup = 0; render(); })));
      return;
    }
    if (!preview) { setup = 0; policy(state); return; }
    body.append(heading("下一季预演", "按规则推演，括号内为与当前方针相比的变化。"),
      report("国库 " + preview.after.treasury + "（" + signed(preview.after.treasury - preview.before.treasury)
        + "） · 储粮 " + preview.after.grain + "（" + signed(preview.after.grain - preview.before.grain) + "）"),
      report("册任州郡 " + preview.staff + " · " + preview.towns.length + " 城的库存预计改变"),
      row(button("颁布国策", "publish", () => apply((next) => publishReign(world, next, draft, { batch: draft.batch }),
        "国策已颁布，授权从下季执行。", () => { setup = 0; draft = null; preview = null; pane = "summary"; })),
      button("地图看影响", "policy-map", () => leave("map", "economy", preview.towns)),
      button("返回授权", "policy-back", () => { setup = 1; render(); })));
  }
  function staff(state, era) {
    const courtLabel = factionCourtProfile(world, state).lexicon.courtLabel;
    const choose = select("册任范围", entries(staffPages).map(([k, v]) => [k, k === "offices" ? courtLabel : v]), staffPane, (value) => { staffPane = value; render(); });
    body.append(row(choose.wrapper, button("招揽人才", "talent", () => leave("talent"))));
    const person = (key) => era.officers.find((item) => item.key === key)?.name ?? "空缺";
    const roster = (people) => people.map(({ key, name }) => [key, name]);
    if (staffPane === "offices") {
      body.append(heading(courtLabel + "署理公卿", "以" + courtLabel + "名义统筹全国府库与军政。"));
      const department = select("朝廷职责", entries(administrativeDuties), office, (value) => { office = value; render(); });
      const officeKey = department.value;
      const old = state.realm.offices[officeKey];
      const picks = roster(reignOfficeOptions(world, state, officeKey));
      const lead = select("朝廷主官", [["", "空缺"], ...picks], old?.holder);
      const deputy = select("朝廷副手", [["", "暂不任命"], ...picks], old?.deputy);
      const cap = number("每季授权上限", state.reign.offices[officeKey]?.cap ?? 28, 0, 90);
      body.append(row(department.wrapper, lead.wrapper, deputy.wrapper), row(cap.wrapper, button("册任要职", "court-grant", () =>
        apply((next) => giveCourtCharter(world, next, officeKey, lead.value || null, deputy.value || null, cap.value), courtLabel + "授权已登记。"))));
      return;
    }
    if (staffPane === "succession") {
      const court = courtFor(state, state.player);
      if (!court) return;
      const people = roster(reignPeople(world, state));
      const heir = select("继任人", [["", "暂不指定"], ...people], court.heir);
      const deputy = select("摄政", [["", "暂不指定"], ...people], court.regent);
      const handover = check("下季交班");
      const last = state.reign.generations.at(-1);
      body.append(heading("当政者 · " + person(court.head), "任期至 " + time(court.due - 1)
        + (last ? " · 最近交班支持 " + last.support : "")),
        row(heir.wrapper, deputy.wrapper, handover.wrapper), row(button("登记继任", "succession", () =>
          apply((next) => reignSuccession(world, next, heir.value || null, deputy.value || null, handover.value), "继任名册已登记。"))));
      return;
    }
    if (staffPane === "commands") {
      const fronts = strategicFronts9(state);
      const war = (front) => state.highCommand.campaigns.find(({ id }) => id === front.campaign);
      const selector = select("战区", fronts.map((front) => [front.id, theaterRoles9[front.role] + " · " + where(war(front).target)]),
        campaign, (key) => { campaign = Number(key); render(); });
      const front = fronts.find(({ id }) => id === Number(selector.value));
      if (!front) { body.append(report("先在全国方略里授权战区。"), button("全国方略", "strategy", () => leave("strategy", "fronts"))); return; }
      const clash = war(front);
      const occupied = new Set(state.highCommand.campaigns.filter(({ stage }) => stage !== "ended").map(({ commander }) => commander));
      const candidates = era.officers.filter(({ key, faction }) => faction === state.player && !occupied.has(key)
        && (state.cities[state.stations[key]]?.owner === state.player || state.armies?.some((army) => army.officer === key)));
      const deputy = select("战区副手", [["", "暂不任命"], ...roster(candidates)], state.reign.deputies[front.id]);
      body.append(report("主帅 " + person(clash.commander) + " · 集结地 " + town(front.seat)),
        row(selector.wrapper, deputy.wrapper, button("登记战区副手", "command-grant", () =>
          apply((next) => confirmWarDeputy(world, next, front.id, deputy.value || null), "战区副手已登记。"))),
        row(button("作战图", "war-map", () => leave("map", "war")), button("进入会战", "battle", () => leave("battle", clash.target))));
      return;
    }
    const rows = dynastyProvinces(world, state);
    const district = select("州郡", rows.map(({ region }) => [region, region]), region, (value) => { region = value; render(); });
    const selected = district.value;
    if (!selected) { body.append(report("当前没有可任命的州郡。")); return; }
    const charter = state.reign.seats[selected];
    const candidates = roster(regionCandidates10(world, state, selected));
    const lead = select("州郡主官", candidates, charter?.lead);
    const deputy = select("州郡副手", [["", "暂不任命"], ...candidates], charter?.deputy);
    const focus = select("州郡授权", entries(mandateGoals), charter?.objective);
    const money = number("季拨钱", charter?.money ?? 14, 0, 70);
    const grain = number("季拨粮", charter?.grain ?? 10, 0, 70);
    const appoint = check("准许补任", charter?.people ?? true);
    const dispatch = check("准许转运", charter?.dispatch ?? true);
    const term = number("任期（季）", 12, 4, 16);
    body.append(row(district.wrapper, lead.wrapper, deputy.wrapper), row(focus.wrapper, money.wrapper, grain.wrapper, term.wrapper),
      row(appoint.wrapper, dispatch.wrapper, button("册任州郡", "province-grant", () => apply((next) => giveProvinceCharter(world, next, selected,
        { lead: lead.value, deputy: deputy.value || null, objective: focus.value, money: money.value, grain: grain.value,
          term: term.value, people: appoint.value, dispatch: dispatch.value }), "州郡权限已登记。"), !lead.value)),
      ...(charter ? [report((charter.acting ? "副手接任" : "任期至 " + time(charter.end - 1)) + " · 事权 "
        + (state.reign.titles[selected]?.charter ?? 0) + " · 考核功绩 " + (state.reign.audits[charter.lead]?.merit ?? 0))] : []));
  }
  function markets(state, era) {
    const choices = marketLines(world, state);
    const selector = select("粮政城市", choices.map(({ key, name }) => [key, name]), city,
      (value) => { city = value; render(); });
    const key = selector.value;
    if (!key) { body.append(report("无本方城池。")); return; }
    const market = marketRow(state, key);
    const freight = state.reign.freights.findLast((item) => item.to === key && item.side === state.player);
    const allies = compactOptions(state, key);
    body.append(row(selector.wrapper, button("看粮政图", "economy-map", () => leave("map", "economy", [], key))),
      heading(town(key) + " · " + marketCauses[market.cause], "民仓 " + market.bins + " · 粮价 " + market.price + " · 工坊存料 " + market.goods),
      report("上一季留粮 " + market.produced + " · 入国库 " + market.paid + " · 民用 " + market.consumed
        + (market.missing ? " · 缺口 " + market.missing : "")),
      ...(freight ? [report("粮队 · " + bank[freight.status] + " · " + town(freight.route[freight.cursor]) + " → " + town(freight.to) + " · " + freight.amount + " 粮")] : []),
      row(button("批准调仓赈济", "order-relief", () => apply((next) => orderMarketRelief(next, key), "已令负责官员查仓和备粮。"),
        !state.reign.blueprint || state.reign.relief.includes(key) || gameOutcome(state) !== "ongoing"),
      button("军粮与工程", "old-market", () => leave("dynasty", "supply", key))));
    if (allies.length) {
      const partner = select("共治伙伴", allies.map((key) => [key, factionName(era, key)]), state.reign.compacts[key]?.partner);
      body.append(row(partner.wrapper, button("批准共治", "compact", () => apply((next) => establishTownCompact(next, key, partner.value),
        "共治条款已登记。"), gameOutcome(state) !== "ongoing"),
      ...(state.reign.compacts[key] ? [report("已履约 " + state.reign.compacts[key].served + " 季")] : [])));
    }
  }
  function leagues(state, era) {
    const name = (key) => factionName(era, key);
    const rows = state.reign.leagues.slice().reverse();
    const picker = select("诸侯集团", [["", "召集集团"], ...rows.map((order) => [order.id, name(order.host) + " · " + leagueLabels[order.status]])],
      group, (value) => { group = value ? Number(value) : null; render(); });
    const selected = rows.find(({ id }) => id === Number(picker.value));
    body.append(row(picker.wrapper, button("外交地图", "diplomatic-map", () => leave("map", "diplomacy"))));
    if (selected) {
      const signatories = Object.keys(selected.members).map((key) => {
        const duty = selected.members[key];
        return name(key) + (duty.suspended ? "停权" : duty.paid ? " " + duty.paid + "粮" : "");
      });
      body.append(heading(name(selected.host) + " · " + leagueLabels[selected.status],
        "共同目标 " + name(selected.target) + " · " + (selected.passage ? "通商" : "限行") + " · " + (selected.military ? "共同守备" : "外交约定")),
        report("成员与已缴盟粮 · " + signatories.join("、")));
      if (Object.keys(selected.corps).length) body.append(report(Object.values(selected.corps).slice(0, 2)
        .map((unit) => town(unit.city) + (unit.arrived ? "已到防" : "援军在途")).join(" · ")));
      if (selected.status === "proposed" && selected.invited.includes(state.player)) body.append(row(
        button("加入", "join", () => apply((next) => voteLeague10(next, selected.id, true), "已同意按约履行。")),
        button("拒绝", "reject", () => apply((next) => voteLeague10(next, selected.id, false), "已发拒绝答复。"))));
      return;
    }
    const sides = Object.keys(state.factions).filter((key) => key !== state.player && livingSide(state, key));
    if (!sides.length) { body.append(report("暂时没有其他势力可交涉。")); return; }
    const enemy = select("共同目标", sides.map((key) => [key, name(key)]), rival, (value) => { rival = value; render(); });
    const candidates = leagueCandidates(world, state, enemy.value);
    const invite = select("邀请主盟友", candidates.map((key) => [key, name(key)]));
    const join = select("追加盟友", [["", "暂不邀请"], ...candidates.map((key) => [key, name(key)])]);
    const dues = number("每季盟粮", 4, 0, 24);
    const term = number("条约季数", 8, 4, 12);
    const military = check("共同守备", true);
    const passage = check("开放互市", true);
    const evolved = state.polity.parties.some(({ key }) => key === enemy.value);
    body.append(row(enemy.wrapper, invite.wrapper, join.wrapper), row(dues.wrapper, term.wrapper, military.wrapper, passage.wrapper),
      row(button("发出盟书", "summon", () => apply((next) => charterLeague10(world, next, { target: enemy.value,
        invited: [...new Set([invite.value, join.value].filter(Boolean))], dues: dues.value, term: term.value, passage: passage.value,
        military: military.value }), "盟书已送出。", (next) => { group = next.reign.leagues.at(-1).id; }), !invite.value),
      button(marketEmbargo(state, state.player, enemy.value) ? "恢复互市" : "暂停互市", "embargo", () =>
        apply((next) => embargo10(world, next, enemy.value), "商贸规则已更新。")),
      ...(evolved ? [button("承认政权", "recognize", () => apply((next) => recognize10(world, next, enemy.value, "recognition"), "已通报诸侯。")),
        button("承诺保护", "protect", () => apply((next) => recognize10(world, next, enemy.value, "protection"), "保护约定已生效。"))] : []),
      button("双边议约", "treaties", () => leave("dynasty", "treaties"))));
  }
  function records(state) {
    const archive = state.reign.records.slice().reverse();
    const timePoint = select("回放季度", archive.map(({ at, stage }) => [at, time(at - 1) + " · " + reignStages[stage]]), selectedTurn,
      (value) => { selectedTurn = Number(value); selectedBattle = undefined; render(); });
    const record = archive.find(({ at }) => at === Number(timePoint.value));
    if (!record) { body.append(report("国策施行后，可按季度回看疆域、粮队和各战区的推进。")); return; }
    const available = record.battles;
    const battle = select("当季会战", available.map(({ id, site }) => [id, where(site)]), selectedBattle,
      (value) => { selectedBattle = Number(value); });
    body.append(row(timePoint.wrapper, button("回看地图", "timeline", () => leave("timeline", record.at))),
      heading("国库 " + record.cash + " · 粮 " + record.grain, "野战军 " + record.moves.length + " · 在途粮队 " + record.cargos.length
        + " · 易主城 " + record.losses.length + " · 会战 " + record.battles.length),
      ...state.reign.reports.filter(({ turn, side }) => turn === record.at && side === state.player).slice(-2).map(({ text }) => report(text)),
      ...(available.length ? [row(battle.wrapper, button("打开会战实录", "replay", () => leave("replay", Number(battle.value))))] : []));
  }
  const renderers = { summary: overview, policy, staff, markets, leagues, record: records };
  function render() {
    const { state, era } = actions.snapshot();
    nav.replaceChildren();
    body.replaceChildren();
    if (!state.reign) {
      body.append(heading("升级至王朝兴替", "沿用现有军团、战区、工程、委任和议约。"),
        button("升级当前存档", "upgrade", () => apply(actions.upgrade, "已启用王朝兴替。")));
      return;
    }
    nav.append(...entries(pages).map(([id, text]) => {
      const tab = button(text, id, () => detail(id));
      tab.setAttribute("aria-pressed", String(id === pane));
      return tab;
    }));
    renderers[pane](state, era);
  }
  return { open, close, render() { if (dialog.open) render(); } };
}
