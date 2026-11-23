import {
  advanceQuarter, applyDelegationBudgetAdjustments, appoint, availableAttackers, cityIncome, cityName, cityReserve, createGame, decodeSave,
  delegateCities, delegateZones, delegationBudgetAdjustments, delegationPriorityLimit, delegationZones, describeOrder as describeTurnOrder,
  eraByYear, expeditionGrain, factionName, firstCity, forceTotals, forecastAttack, forecastDelegation, forecastDelegationBudgets,
  forecastDelegationReserve, forecastDelegationZones, forecastFinance, forecastOrderSteps, gameOutcome, previewMilitaryOrders,
  minimumMarch, occupationProgress, pendingExpedition, playableFactions, postingOf, projects, queueOrder, reassignOfficer, recruitment, replaceOrders, respondToTreaty,
  resumeNationalPolicy, seasonOrderLimit, seasons, sendTreatyOffer, setDelegationPriority, setDelegationReserve, setGovernance, setNationalPolicy, transferGrain, transferOfficer, transferRoutes, turnVersion,
} from "./engine.js";
import { allianceIncome, incomingTreatyBlock, isHostile, quoteTreaty, treatyTerms, treatyWith } from "./diplomacy.js";
import { seasonAdvice } from "./advice.js";
import { createArmyPanel } from "./army-panel.js";
import { createTheaterPanel } from "./theater-panel.js";
import { createRealmPanel } from "./realm-panel.js";
import { createWarPanel } from "./war-panel.js";
import { createPolityPanel } from "./polity-panel.js";
import { createGrandPanel, createOpeningEditor } from "./grand-panel.js";
import { createCityCommand } from "./city-command.js";
import { concludePeace, currentEdict, peaceCriteria } from "./polity.js";
import { courtFor, provinceRows } from "./polity-governance.js";
import { intelLabels, intelSummary, militaryView, townIntel } from "./war-intel.js";
import { warBlockaded } from "./war-operations.js";
import { coalitionCriteria } from "./accords.js";
import { nationalDuty, realmOffices } from "./realm.js";
import { concludeCoalition, concludeScenario, scenarioEndingCriteria } from "./endgame.js";
import { recruitOfficer, recruitmentChoices } from "./recruitment.js";
import { armyByOfficer, armyPhases } from "./armies.js";
import { answerCampaignEvent, campaignEvent, campaignEventName, campaignRoute, officerService, officerSkill, promoteOfficer, promotionCost } from "./campaign.js";
import { filteredReports, latestSeasonSummary, opponentBrief, opponentHoldings, territoryChanges } from "./chronicle.js";
import { compareDelegationPresets, presetPolicies, zonePresets } from "./delegation-presets.js";
import { legacyProposals, legacySnapshot } from "./legacy-turn.js";
import { createLandscapeMap } from "./landscape-map.js";
import { createLandscapeDesk } from "./landscape-desk.js";
import { enableLandscape } from "./landscape.js";
import { enableGrand } from "./grand.js";
import { readTurnResponse, turnStreamType } from "./turn-stream.js";
import { frontierAttackOpportunities, frontierCities, frontierDefensePressure, frontierGarrisons, frontierIntel,
  planFrontierExpeditions, planFrontierReinforcements } from "./frontier.js";
import { jointAttackLimit, jointOptions, jointSituation, planJointOrders } from "./joint-orders.js";
import { filterDelegationPrograms, programResults, quarterlyFinance } from "./finance.js";
import { createMap, forceColor } from "./map.js";
import { frontierGarrisonTarget, scenarioObjective } from "./objectives.js";
import { applyOccupationTakeover, appointOccupationGovernors, canInspectOccupation, occupiedHoldings, occupationReinforcement,
  planOccupationGovernors, planOccupationReinforcements, planOccupationTakeover } from "./occupation.js";
import { enrichWorld, knownOfficer } from "./personnel.js";
import { nationalRoster, nationalVacancies, officerProfile, personnelDestinations, reassignmentOptions, usePersonnel } from "./roster.js";
import { describeGoalProgress } from "./strategy.js";
import { createSaveBackup, readGameRecord, saveFileLimit } from "./saves.js";

const find = (id) => document.getElementById(id);
const labels = { governor: "太守", commander: "守将" };
const focusLabels = { farming: "屯田", commerce: "商贸", defense: "城防", recruit: "征兵", auto: "自主发展" };
const zoneLabels = { front: "前线", rear: "后方" };
const reinforcementBlockers = { queue: "政令队列已满", grain: "储粮不足以调兵", donor: "暂无可调援军", planned: "本案已为该城拟令" };
const defensePressureLabels = { treaty: "协定保护", interior: "无相邻敌方", unavailable: "邻敌无法出征" };
const autoSlot = "jinglue-sanguo:auto:v1";
const manualSlot = "jinglue-sanguo:manual:v1";
const manualSlots = [manualSlot, "jinglue-sanguo:manual-2:v1", "jinglue-sanguo:manual-3:v1"];
const opponentModeSlot = "jinglue-sanguo:opponents:v1";
const sources = { model: "模型", rules: "规则", fallback: "规则接管" };
const progressLabels = { pending: "待处理", model: "已拟定", fallback: sources.fallback };
const modelOperationLabels = { models: "正在读取模型列表…", test: "正在测试连接…", settings: "正在保存模型设置…" };
const opponentPanes = { "opponent-cities": "辖城清单", "opponent-territory": "疆域履历" };
const formatted = new Intl.NumberFormat("zh-CN");
const signed = (number) => number > 0 ? "+" + formatted.format(number) : formatted.format(number);

let world;
let oldWorld;
let state;
let planned;
let selected;
let activeTab = "governance";
let attackDraft = {};
let transferDraft = {};
let transferPaths = new Map();
let map;
let armyPanel;
let theaterPanel;
let realmPanel;
let warPanel;
let polityPanel;
let grandPanel;
let openingEditor;
let cityCommand;
let landscapeMap;
let landscapeDesk;
let reviewPane = "realm";
let deciding = false;
let turnProgress;
let modelReady = false;
let savedModel = {};
let editingModel = false;
let stagedBackup;
let stagedOverwrite;
let personnelCandidate;
let postingAdjustment;
let rosterTarget;
let batchForecast;
let groupsForecast;
let zoneComparison;
let reserveForecast;
let budgetForecast;
let budgetTopUpPane = "adjustments";
let activeZone = "front";
let importRevision = 0;
let feedbackTimer;
let reportType = "summary";
let detailView;
let detailRoot;
const detailHistory = [];
let orderPreview = false;
let orderFocusOfficer;
let frontierTab = "opponents";
let attackOpportunityFaction;
let expeditionPlan;
let garrisonTarget = frontierGarrisonTarget;
let reinforcementPlan;
let reinforcementPane = "steps";
let occupationPlan;
let occupationPane = "steps";
let occupationGovernors;
let takeoverPlan;
let jointOrigins = [];
let financeMode = "forecast";
let financeView = "ledger";
let financeProgramFilter = "all";
let financeTrendView = "treasury";
let financeTrendTurn;
let briefFaction;
let briefPane = "opponent-brief-overview";
let campaignOpening;
let campaignPane = "summary";
let councilPane = "route";
const pages = { forces: 0, officers: 0, reports: 0, summary: 0, "person-history": 0, "battle-personnel": 0, "order-preview": 0,
  batch: 0, "batch-preview": 0, "zone-preview": 0, "delegation-comparison": 0,
  holdings: 0, garrisons: 0, "reinforcement-plan": 0, "occupation-plan": 0, "occupation-governors": 0,
  "takeover-plan": 0, vacancies: 0, priority: 0, roster: 0, frontier: 0,
  "attack-opportunities": 0, "expedition-plan": 0, "defense-pressure": 0, "opponent-cities": 0,
  "opponent-territory": 0, finance: 0, reserve: 0, "budget-top-up": 0, "campaign-cities": 0, "campaign-roster": 0,
  "stage-details": 0, "council-alerts": 0 };
const batchCities = new Set();
const priorityDraft = new Set();

function make(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function era() {
  return eraByYear(world, state);
}

function currentCity() {
  return world.cities.find(({ key }) => key === selected);
}

function notify(message, error = false) {
  const box = find("feedback");
  box.textContent = message;
  box.dataset.error = String(error);
  box.hidden = !message;
  clearTimeout(feedbackTimer);
  if (message && !deciding) feedbackTimer = setTimeout(() => { box.hidden = true; }, error ? 7000 : 3700);
}

function showView(view) {
  if (view !== "map") {
    cityCommand?.close();
    landscapeMap?.close();
  }
  find("workspace").dataset.view = view;
  for (const button of document.querySelectorAll("#view-switcher [data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  if (view === "city") renderOfficers();
  if (view === "forces") renderForces();
}

function pageOf(items, key, size, renderPage) {
  const controls = find(key + "-pages");
  const total = Math.max(1, Math.ceil(items.length / size));
  pages[key] = Math.max(0, Math.min(pages[key], total - 1));
  if (!controls.children.length) {
    const before = make("button", "上页", "quiet");
    const indicator = make("span");
    const after = make("button", "下页", "quiet");
    before.type = after.type = "button";
    indicator.setAttribute("aria-live", "polite");
    before.addEventListener("click", () => { pages[key] -= 1; renderPage(); });
    after.addEventListener("click", () => { pages[key] += 1; renderPage(); });
    controls.append(before, indicator, after);
  }
  const [before, indicator, after] = controls.children;
  controls.hidden = total === 1;
  before.disabled = pages[key] === 0;
  after.disabled = pages[key] === total - 1;
  indicator.textContent = (pages[key] + 1) + " / " + total;
  const start = pages[key] * size;
  return items.slice(start, start + size);
}

function readSave(key) {
  const raw = localStorage.getItem(key);
  return raw ? readGameRecord(world, raw) : null;
}

function writeSave(key) {
  localStorage.setItem(key, JSON.stringify({ state, selected }));
}

function describeSave(snapshot) {
  const scenario = eraByYear(world, snapshot);
  return snapshot.year + " 年 · " + factionName(scenario, snapshot.player) + " · " + seasonTitle(snapshot.turn);
}

function saveFileMessage(message, error = false) {
  const status = find("save-file-status");
  status.textContent = message;
  status.dataset.error = String(error);
  status.hidden = !message;
}

function selectedManualSlot() {
  return manualSlots[Number(find("manual-save-slot").value)];
}

function describeManualSlot(key) {
  try {
    const manual = readSave(key);
    return { label: manual ? describeSave(manual.state) : "尚未存档", available: Boolean(manual) };
  } catch {
    return { label: "无法读取", available: false };
  }
}

function renderManualSlot() {
  const { label, available } = describeManualSlot(selectedManualSlot());
  find("save-manual-label").textContent = label;
  find("export-manual").disabled = !available;
  find("load-manual-slot").disabled = !available;
}

function showSavePane(pane) {
  find("save-manager-controls").hidden = pane !== "main";
  find("save-overwrite").hidden = pane !== "overwrite";
  find("import-review").hidden = pane !== "import";
}

function openSaveManager() {
  find("save-live-label").textContent = describeSave(state);
  showSavePane("main");
  renderManualSlot();
  saveFileMessage("");
  find("saves-dialog").showModal();
}

function saveToManualSlot(key) {
  writeSave(key);
  stagedOverwrite = undefined;
  showSavePane("main");
  renderManualSlot();
  saveFileMessage("已存入槽 " + (manualSlots.indexOf(key) + 1) + "。");
}

function downloadSave(record) {
  const backup = createSaveBackup(record);
  const url = URL.createObjectURL(new Blob([backup], { type: "application/json" }));
  const link = make("a");
  link.href = url;
  link.download = "经略三国-" + record.state.year + "-" + record.state.player + "-第" + (record.state.turn + 1) + "季.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readBackupFile(file) {
  const revision = ++importRevision;
  stagedBackup = undefined;
  showSavePane("main");
  saveFileMessage("");
  if (!file) return;
  try {
    if (file.size > saveFileLimit) throw new Error("备份文件过大。");
    const backup = readGameRecord(world, await file.text());
    if (revision !== importRevision) return;
    stagedBackup = backup;
    find("import-preview").textContent = describeSave(backup.state);
    showSavePane("import");
  } catch (error) {
    if (revision === importRevision) saveFileMessage(error.message, true);
  }
}

function keepProgress() {
  try {
    writeSave(autoSlot);
    return true;
  } catch {
    notify("浏览器无法保存这局进度，请检查站点存储设置。", true);
    return false;
  }
}

function mutate(operation, message = "") {
  try {
    state = operation();
    notify(message);
    render();
    keepProgress();
  } catch (error) {
    notify(error.message, true);
    render();
  }
}

function seasonTitle(turn) {
  return "第 " + (Math.floor(turn / 4) + 1) + " 年 · " + seasons[turn % 4] + "季";
}

function statList(target, items) {
  const rows = items.map(([label, value]) => {
    const cell = make("div");
    cell.append(make("dt", label), make("dd", value));
    return cell;
  });
  target.replaceChildren(...rows);
}

function renderResources() {
  const scenario = era();
  const name = factionName(scenario, state.player);
  find("active-era").textContent = state.year + " 年 · " + scenario.title + " · " + name;
  find("turn-date").textContent = seasonTitle(state.turn);
  const holdings = forceTotals(state, state.player);
  const stock = state.factions[state.player];
  for (const key of ["treasury", "grain", "morale"]) find(key).textContent = formatted.format(stock[key]);
  statList(find("revenue"), [
    ["钱入账", "+" + formatted.format(holdings.treasury)],
    ["粮食", "+" + formatted.format(holdings.grain)],
    ["辖城", formatted.format(holdings.cities)],
    ["总驻军", formatted.format(holdings.troops)],
  ]);
  find("city-total").textContent = world.cities.length + " 座主城";
  document.querySelector('[data-map-layer="roads"]').hidden = !state.grand;
  const ended = gameOutcome(state) !== "ongoing";
  find("advance").disabled = deciding || ended;
  find("advance").textContent = deciding ? "拟定政令…" : ended ? "战局结束" : "推进一季";
}

function renderCommandDesk() {
  const count = state.orders.length;
  const pending = state.incomingTreaty?.answer === null;
  find("turn-order-count").textContent = count + "/" + seasonOrderLimit;
  find("turn-orders").setAttribute("aria-label", "本季政令 " + count + " / " + seasonOrderLimit);
  find("view-switcher").querySelector('[data-command-action="orders"]').textContent = "政令 " + count;
  find("dock-diplomacy-pending").hidden = !pending;
  const task = find("season-card-action");
  const first = commandPriorities()[0];
  task.textContent = first?.title ?? "查看军政建议";
  task.dataset.commandAction = first?.action ?? "advice";
  task.dataset.commandTarget = first?.target ?? "";
}

function commandPriorities() {
  if (gameOutcome(state) !== "ongoing") return [{ title: "查看战局结果", detail: "回顾疆域、战役和人物。", action: "outcome" }];
  const result = [];
  const add = (title, detail, action, target) => result.push({ title, detail, action, target });
  const offer = state.incomingTreaty;
  if (offer?.answer === null) add("答复" + factionName(era(), offer.from) + "来使",
    "有一份" + treatyTerms[offer.kind].name + "提议等待答复。", "envoy");
  const grandOffer = state.grand?.offers.find(({ to, answer }) => to === state.player && answer === undefined);
  if (grandOffer) add("审核" + factionName(era(), grandOffer.from) + "的议约", "查看停战、通行和钱粮条款。", "grand-inbox", grandOffer.id);
  const formation = state.grand?.campaigns.find(({ status }) => status === "blocked");
  if (formation) add(formation.name + "需要指挥", formation.note, "grand-campaign", formation.id);
  if (state.polity) {
    const proposal = state.polity.offers.find(({ to, accept }) => to === state.player && accept === undefined);
    if (proposal) add("批复" + factionName(era(), proposal.from) + "议案", "查阅条款后决定是否同意。", "polity-inbox", proposal.id);
    const province = provinceRows(world, state).find(({ warning }) => warning !== null);
    if (province) add(province.region + (province.crisis !== null ? "面临地方危机" : "局势告急"),
      "压力 " + province.pressure + " / 100。可调整赈济、守备或商路预算。", "province", province.region);
    const seat = courtFor(state, state.player);
    if (seat && seat.due <= state.turn + 3 && !seat.heir) add("安排继任", "还有 " + (seat.due - state.turn) + " 季交接。", "succession");
    const edict = currentEdict(world, state);
    if (edict && edict.answer === undefined) add("审议" + edict.title, edict.text, "edict");
  }
  const stalled = state.theaters?.find(({ paused, report }) => paused && report?.status === "blocked");
  if (stalled) add(stalled.name + "战区受阻", stalled.report.text, "war-alert", stalled.id);
  if (state.campaignEvents?.pending) add("查看剧本议事", "本季有待处理的剧本事件。", "events");
  if (state.orders.length) add("检查 " + state.orders.length + " 道待执行政令", "可调整执行顺序或撤销政令。", "orders");
  return result;
}

function renderForces() {
  const diplomacy = find("open-diplomacy");
  const pending = state.incomingTreaty?.answer === null;
  diplomacy.dataset.pending = String(pending);
  diplomacy.setAttribute("aria-label", pending ? "外交，有待答复的提议" : "外交");
  const last = state.history.at(-1)?.decisions || [];
  const requested = modelReady && find("opponent-mode").value === "model" ? "模型" : "规则";
  const modelLabel = find("opponent-model");
  if (turnProgress || savedModel.ready !== undefined) {
    modelLabel.hidden = false;
    modelLabel.textContent = turnProgress ? turnProgressLabel() : modelReady ? savedModel.model : "模型未配置";
    modelLabel.title = modelLabel.textContent;
  }
  const forces = playableFactions(era());
  const list = find("forces");
  const [heading, mode] = list.parentElement.children;
  const panel = list.parentElement;
  const style = getComputedStyle(panel);
  const rowsHeight = panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    - heading.offsetHeight - mode.offsetHeight - parseFloat(getComputedStyle(mode).marginTop)
    - parseFloat(getComputedStyle(list).marginTop) - 4;
  const columns = matchMedia("(max-width: 960px)").matches ? 2 : 1;
  const rowHeight = innerHeight <= 650 ? 30 : 38;
  const forceSize = Math.floor(rowsHeight / rowHeight) * columns >= forces.length
    ? forces.length
    : Math.max(columns, Math.floor((rowsHeight - 34) / rowHeight) * columns);
  const items = pageOf(forces, "forces", forceSize, renderForces).map(({ key, name }) => {
    const owned = forceTotals(state, key).cities;
    const row = make("li");
    const player = key === state.player;
    row.dataset.player = String(player);
    row.dataset.faction = key;
    const dot = make("span", "", "force-dot");
    dot.style.setProperty("--force", forceColor(key));
    dot.setAttribute("aria-hidden", "true");
    const decision = last.find((entry) => entry.faction === key);
    const progress = turnProgress?.get(key);
    const source = player ? "玩家" : progressLabels[progress] || sources[decision?.source] || requested;
    if (decision) row.dataset.aiSource = decision.source;
    if (progress) row.dataset.planStatus = progress;
    const treaty = treatyWith(state, state.player, key);
    const status = owned ? (treaty && !progress ? treatyTerms[treaty.kind].name : source) + " · " + owned + " 城" : "已失去辖城";
    if (treaty) {
      row.dataset.treaty = treaty.kind;
      row.title = source + " · " + treatyTerms[treaty.kind].name + "余 " + (treaty.expires - state.turn) + " 季";
    }
    const title = player ? make("span", name) : make("button", name, "quiet force-brief-button");
    if (!player) {
      title.type = "button";
      title.disabled = deciding;
      title.setAttribute("aria-label", "查看" + name + "简报");
      title.addEventListener("click", () => openOpponentBrief(key));
    }
    row.append(dot, title, make("span", status, "muted"));
    return row;
  });
  list.replaceChildren(...items);
}

function renderOpponentBrief() {
  if (briefPane === "opponent-cities") {
    renderOpponentCities();
    return;
  }
  if (briefPane === "opponent-territory") {
    renderOpponentTerritory();
    return;
  }
  const brief = opponentBrief(world, militaryView(state), briefFaction);
  if (!brief) return;
  const { opponent, cities, troops, treaty, seat, strategy, latest } = brief;
  find("opponent-brief-title").textContent = opponent.name;
  statList(find("opponent-brief-stats"), [["辖城", formatted.format(cities)], ["总驻军", state.war ? "见各城军情" : formatted.format(troops)]]);
  const relation = treaty ? (treaty.protection ? "保护协定" : treatyTerms[treaty.kind].name) + " · 余 " + (treaty.expires - state.turn) + " 季" : "敌对";
  find("opponent-brief-relation").textContent = cities ? "当前关系 · " + relation : "已失去辖城";
  const ruler = courtFor(state, briefFaction)?.head;
  const name = cities && era().officers.find(({ key }) => key === ruler)?.name;
  find("opponent-brief-goal").textContent = state.war ? (name ? "现任主政 " + name + "。" : "当前战略意图需由前线军情判断。")
    : strategy ? describeGoalProgress(world, strategy, state.turn) : "暂无持续中的战略目标。";
  const date = find("opponent-brief-plan-date");
  date.hidden = !latest;
  if (latest) date.textContent = seasonTitle(latest.turn - 1) + " · " + sources[latest.entry.source];
  const plan = find("opponent-brief-plan");
  plan.hidden = latest?.receipt === null;
  plan.textContent = state.war && latest && !latest.receipt?.participants?.includes(state.player) ? "未取得该令细节。" : latest?.entry.action ?? "暂无已归档拟令。";
  const receipt = find("opponent-brief-receipt");
  receipt.textContent = latest && (!state.war || latest.receipt?.participants?.includes(state.player)) ? decisionReceiptText(latest.entry, latest.receipt) : "";
  receipt.hidden = !receipt.textContent;
  const locate = find("opponent-brief-locate");
  locate.hidden = !seat;
  locate.dataset.city = seat ?? "";
  if (seat) locate.textContent = "定位" + cityName(world, seat);
  const reports = find("opponent-brief-reports");
  reports.hidden = !state.history.length;
  reports.dataset.section = latest ? "plans" : "news";
  find("opponent-brief-dialog").querySelector(".opponent-brief-actions").hidden = locate.hidden && reports.hidden;
}

function renderOpponentCities() {
  const query = find("opponent-city-search").value;
  const sort = find("opponent-city-sort").value;
  const { total, matching } = opponentHoldings(world, militaryView(state), briefFaction, { query, sort });
  const count = find("opponent-cities-count");
  count.textContent = "筛选 " + matching.length + " / " + total + " 城";
  count.hidden = total === 0;
  find("opponent-cities-toolbar").hidden = total === 0;
  const empty = find("opponent-cities-empty");
  empty.textContent = total ? "没有匹配的城池。" : "该势力当前没有辖城。";
  empty.hidden = matching.length > 0;
  const size = innerHeight <= 460 ? 2 : innerHeight <= 560 ? 3 : innerHeight <= 680 ? 4 : 6;
  const officers = new Map(era().officers.map(({ key, name }) => [key, name]));
  const rows = pageOf(matching, "opponent-cities", size, renderOpponentCities).map(({ city, holding }) => {
    const row = make("li");
    row.dataset.city = city.key;
    const details = make("div", undefined, "holding-detail");
    const heading = make("div", undefined, "holding-heading");
    heading.append(make("strong", city.name));
    if (holding.occupation) {
      const status = holding.troops < cityReserve ? "整顿暂停 · 余 " : "整顿余 ";
      heading.append(make("span", status + holding.occupation + " 季", "occupation-estimate"));
    }
    const governor = officers.get(holding.governor) ?? "空缺";
    const commander = officers.get(holding.commander) ?? "空缺";
    const intel = townIntel(state, state.player, city.key);
    details.append(heading,
      make("span", "驻军 " + intelSummary(state, state.player, city.key) + " · 城防 " + intelSummary(state, state.player, city.key, "defense"), "muted"),
      make("span", state.war ? intelLabels[intel.source] : "太守 " + governor + " · 守将 " + commander, "muted"));
    row.append(details, reportLocateButton(city.key, "opponent-brief-dialog"));
    return row;
  });
  find("opponent-cities-list").replaceChildren(...rows);
}

function renderOpponentTerritory() {
  const changes = territoryChanges(state.history, briefFaction);
  const size = innerHeight <= 460 ? 3 : innerHeight <= 660 ? 5 : 7;
  const origin = "opponent-brief-dialog";
  find("opponent-territory-empty").hidden = changes.length > 0;
  const rows = pageOf(changes, "opponent-territory", size, renderOpponentTerritory).map(({ kind, other, entry, turn }) => {
    const row = make("li", undefined, "report-entry");
    row.dataset.change = kind;
    const note = make("div");
    note.append(make("strong", (kind === "gain" ? "攻占 " : "失守 ") + cityName(world, entry.city)));
    const date = turn ? seasonTitle(turn - 1) : "开局";
    const side = other ? (kind === "gain" ? " · 原属" : " · 攻方") + factionName(era(), other) : "";
    note.append(make("span", date + side, "muted"));
    const actions = make("div", undefined, "report-actions");
    const battle = battleReportButton(entry, turn, origin);
    if (battle) actions.append(battle);
    const locate = reportLocateButton(entry.city, origin);
    if (locate) actions.append(locate);
    row.append(note, actions);
    return row;
  });
  find("opponent-territory-list").replaceChildren(...rows);
}

function showOpponentPane(pane) {
  briefPane = pane;
  find("opponent-brief-overview").hidden = pane !== "opponent-brief-overview";
  for (const [id, label] of Object.entries(opponentPanes)) {
    const visible = pane === id;
    const toggle = find(id + "-toggle");
    toggle.textContent = visible ? "返回概况" : label;
    toggle.setAttribute("aria-expanded", String(visible));
    find(id).hidden = !visible;
  }
  renderOpponentBrief();
}

function openOpponentBrief(faction) {
  briefFaction = faction;
  find("opponent-city-search").value = "";
  find("opponent-city-sort").value = "map";
  pages["opponent-cities"] = 0;
  pages["opponent-territory"] = 0;
  showOpponentPane("opponent-brief-overview");
  find("opponent-brief-dialog").showModal();
}

function updateDraftFactions() {
  const scenario = eraByYear(world, Number(find("era-select").value));
  const options = playableFactions(scenario).map(({ key, name }) => new Option(name, key));
  const select = find("force-select");
  const before = select.value || state.player;
  select.replaceChildren(...options);
  if (options.some(({ value }) => value === before)) select.value = before;
}

function syncStartFields() {
  find("era-select").value = state.year;
  updateDraftFactions();
  find("force-select").value = state.player;
}

function renderCampaignPreview() {
  const year = Number(find("era-select").value);
  const player = find("force-select").value;
  const scenario = eraByYear(world, year);
  const opening = createGame(world, year, player, { landscape: true });
  campaignOpening = opening;
  pages["campaign-cities"] = pages["campaign-roster"] = 0;
  const { cities, troops } = forceTotals(opening, player);
  const { treasury, grain } = opening.factions[player];
  const values = {
    seat: cityName(world, firstCity(world, opening)),
    holdings: cities + " / " + world.cities.length,
    frontier: frontierCities(world, opening).filter(({ exposed }) => exposed).length,
    officers: scenario.officers.filter((person) => person.faction === player && knownOfficer(opening, person)).length,
    troops: formatted.format(troops),
    treasury: formatted.format(treasury),
    grain: formatted.format(grain),
    opponents: playableFactions(scenario).length - 1,
  };
  for (const [key, value] of Object.entries(values)) find("campaign-" + key).textContent = value;
  const objective = scenarioObjective(world, scenario, opening);
  find("campaign-objective-title").textContent = objective?.title || "";
  find("campaign-objective-detail").textContent = objective?.description || "";
  renderCampaignDetails();
}

function renderCampaignDetails() {
  if (campaignPane === "summary") return;

  const opening = campaignOpening;
  const size = innerHeight <= 460 ? 2 : innerHeight <= 600 ? 3 : 5;
  if (campaignPane === "cities") {
    const seat = firstCity(world, opening);
    const front = new Set(frontierCities(world, opening).filter(({ exposed }) => exposed).map(({ key }) => key));
    const owned = world.cities.filter(({ key }) => opening.cities[key].owner === opening.player);
    const priority = (key) => key === seat ? 2 : Number(front.has(key));
    owned.sort((a, b) => priority(b.key) - priority(a.key));
    const rows = pageOf(owned, "campaign-cities", size, renderCampaignDetails).map(({ key, name }) => {
      const holding = opening.cities[key];
      const status = (key === seat ? "治所 · " : "") + (front.has(key) ? "临敌" : "后方");
      const row = make("li");
      row.dataset.city = key;
      row.append(make("strong", name), make("span", status, "muted"),
        make("span", "驻军 " + formatted.format(holding.troops) + " · 城防 " + holding.defense));
      return row;
    });
    find("campaign-cities-list").replaceChildren(...rows);
    return;
  }

  const { matching } = nationalRoster(world, opening, { status: "all", query: "", sort: find("campaign-roster-sort").value });
  const rows = pageOf(matching, "campaign-roster", size, renderCampaignDetails).map(({ person, stationName }) => {
    const row = make("li");
    row.dataset.officer = person.key;
    row.append(make("strong", person.name), make("span", stationName || "无驻地", "muted"),
      make("span", "统率 " + person.command + " · 政务 " + person.governance));
    return row;
  });
  find("campaign-roster-list").replaceChildren(...(rows.length ? rows : [make("li", "该势力开局暂无文武。", "muted")]));
}

function showCampaignPane(pane) {
  campaignPane = pane;
  for (const button of find("campaign-panes").querySelectorAll("button")) {
    const active = button.dataset.campaignPane === pane;
    button.setAttribute("aria-pressed", String(active));
    find(button.getAttribute("aria-controls")).hidden = !active;
  }
  renderCampaignDetails();
}

function renderCityPicker() {
  const select = find("city-picker");
  const groups = new Map();
  const scenario = era();
  for (const city of world.cities) {
    if (!groups.has(city.region)) {
      const group = make("optgroup");
      group.label = city.region;
      groups.set(city.region, group);
    }
    groups.get(city.region).append(new Option(city.name + " · " + factionName(scenario, state.cities[city.key].owner), city.key));
  }
  select.replaceChildren(...groups.values());
  select.value = selected;
}

function renderMapSearch() {
  const scenario = era();
  const query = find("city-search").value.trim().toLowerCase();
  const matches = world.cities.map((city) => ({
    ...city, owner: factionName(scenario, state.cities[city.key].owner), alias: scenario.periodNames[city.key] ?? "",
  })).filter(({ name, owner, alias, region, key }) => [name, owner, alias, region, key].some((label) => label.toLowerCase().includes(query)));
  matches.sort((a, b) => Number(b.name === query || b.alias === query) - Number(a.name === query || a.alias === query));
  const size = innerHeight <= 410 ? 3 : innerHeight <= 620 ? 5 : 8;
  const rows = pageOf(matches, "city-search", size, renderMapSearch).map(({ key, name, region, owner }) => {
    const row = make("li");
    const label = make("button", name, "quiet city-search-result");
    label.type = "button";
    label.append(make("span", region + " · " + owner, "muted"));
    label.addEventListener("click", () => {
      find("city-search-dialog").close();
      selectMapCity(key, true);
    });
    row.append(label);
    return row;
  });
  find("city-search-results").replaceChildren(...(rows.length ? rows : [make("li", "未找到城池，试试城名或所属势力。", "muted")]));
}

function openMapSearch() {
  if (deciding || document.querySelector("dialog[open]")) return;
  pages["city-search"] = 0;
  find("city-search").value = "";
  renderMapSearch();
  find("city-search-dialog").showModal();
  find("city-search").focus();
}

function renderCity() {
  const city = currentCity();
  const holding = state.cities[selected];
  find("city-region").textContent = city.region;
  find("city-name").textContent = city.name;
  const priorName = era().periodNames[city.key];
  find("city-period-name").textContent = priorName || "";
  find("city-period-name").hidden = !priorName;
  const marker = find("city-owner");
  marker.textContent = factionName(era(), holding.owner) + "辖城";
  const treaty = treatyWith(state, state.player, holding.owner);
  const pact = treaty ? " · " + treatyTerms[treaty.kind].name : "";
  marker.title = marker.textContent + pact;
  marker.dataset.treaty = treaty?.kind || "";
  marker.style.setProperty("--force", forceColor(holding.owner));
  const population = state.realm?.cities[selected];
  const income = cityIncome(holding, population);
  const known = !state.war || holding.owner === state.player;
  const strength = intelSummary(state, state.player, selected);
  const defense = intelSummary(state, state.player, selected, "defense");
  find("city-region").title = population ? `人口 ${formatted.format(population.population)} · 民心 ${population.welfare}` : "";
  find("map-city-name").textContent = city.name;
  find("inspect-city").textContent = holding.owner === state.player ? "管理城池" : "查看军情";
  find("map-city-force").textContent = marker.textContent + (warBlockaded(state, selected) && (known || townIntel(state, state.player, selected).source !== "unknown")
    ? " · 道路被封锁" : holding.occupation ? " · 整顿中" : pact);
  statList(find("map-city-stats"), [["驻军", strength], ["城防", defense + (known ? " 级" : "")]]);
  statList(find("city-stats"), [
    ["驻军", strength],
    ["城防", defense + (known ? " 级" : "")],
    ["税收", known ? "+" + income.treasury + " / 季" : "未掌握"],
    ["粮食", known ? "+" + income.grain + " / 季" : "未掌握"],
  ]);
}

function fillPosting(role, holding, isOwned) {
  const select = find(role);
  const options = era().officers.filter((person) => person.faction === holding.owner && knownOfficer(state, person)).map((officer) => {
    const duty = postingOf(state, officer.key);
    const current = holding[role] === officer.key;
    const expedition = pendingExpedition(state, officer.key);
    const army = armyByOfficer(state, officer.key);
    const reserved = expedition && (role !== "commander" || selected !== expedition.from || state.stations[officer.key] !== selected);
    const attribute = role === "governor" ? "政务 " + officerSkill(state, officer, "governance") : "统率 " + officerSkill(state, officer, "command");
    const option = new Option(officer.name + " · " + attribute, officer.key);
    option.disabled = Boolean(army || (duty && !current) || reserved);
    if (option.disabled) option.textContent += army ? " · 领军在外" : reserved ? " · 待出征" : " · 在任";
    return option;
  });
  select.replaceChildren(new Option("待任", ""), ...options);
  select.value = holding[role] || "";
  select.disabled = !isOwned;
}

function renderGovernance() {
  const holding = state.cities[selected];
  const ongoing = gameOutcome(state) === "ongoing";
  const isOwned = ongoing && holding.owner === state.player;
  fillPosting("governor", holding, isOwned);
  fillPosting("commander", holding, isOwned);
  const mode = find("mode");
  mode.value = holding.mode;
  mode.disabled = !isOwned;
  mode.querySelector('[value="delegated"]').disabled = !holding.governor;
  find("focus-wrap").hidden = holding.mode !== "delegated";
  find("budget-wrap").hidden = holding.mode !== "delegated";
  find("focus").disabled = !isOwned;
  find("focus").value = holding.focus;
  find("delegate-budget").value = holding.delegateBudget ?? "";
  find("delegate-budget").disabled = !isOwned;
  find("preview-city-program").hidden = !isOwned;
  find("open-batch").disabled = !ongoing;
  find("appointment-hint").textContent = !ongoing ? "战局已结束。" : isOwned
    ? "任命太守后可在内政中委任。任命守将可同时调其来城驻守。"
    : "占领此城后可任命太守和守将。";
  const development = find("development");
  const levels = Object.entries(projects).map(([key, project]) => project.name + " " + holding[key] + " 级").join(" · ");
  development.title = levels;
  development.textContent = holding.occupation
    ? holding.troops < cityReserve ? "整顿暂停 · 至少留守 " + cityReserve + " 人" : "整顿余 " + holding.occupation + " 季 · 税粮减半"
    : levels;

  const form = find("domestic-form");
  form.hidden = !ongoing || planned.cities[selected].owner !== state.player;
  const order = find("domestic-order");
  const before = order.value;
  const finances = planned.factions[state.player];
  const choices = Object.entries(projects).map(([key, project]) => {
    const maximum = planned.cities[selected][key] >= 5;
    const option = new Option("扩建" + project.name + (maximum ? " · 已满级" : " · " + project.cost + " 钱"), key);
    option.disabled = maximum || finances.treasury < project.cost;
    return option;
  });
  const recruit = new Option("征兵 " + recruitment.troops + " 人 · 20 钱及 12 粮", "recruit");
  recruit.disabled = finances.treasury < recruitment.treasury || finances.grain < recruitment.grain;
  choices.push(recruit);
  order.replaceChildren(...choices);
  order.value = choices.find(({ disabled, value }) => !disabled && value === before)?.value
    || choices.find(({ disabled }) => !disabled)?.value || "";
  form.querySelector("button").disabled = !order.value || state.orders.length >= seasonOrderLimit;
}

function renderOfficers() {
  const current = state.cities[selected];
  const foreign = state.war && current.owner !== state.player;
  const canTransfer = gameOutcome(state) === "ongoing" && current.owner === state.player;
  const filter = find("officer-filter").value.trim();
  const roster = foreign ? [] : era().officers.filter((person) => person.faction === current.owner && knownOfficer(state, person));
  const officers = roster.filter(({ key, name }) => !filter || name.includes(filter)
    || (state.stations[key] && cityName(world, state.stations[key]).includes(filter)));
  const height = find("officers").clientHeight;
  const size = height ? Math.max(1, Math.min(9, Math.floor((height - 87) / 46))) : 3;
  const list = pageOf(officers, "officers", size, renderOfficers).map((officer) => {
    const person = make("li");
    const duty = postingOf(state, officer.key);
    const dispatch = pendingExpedition(state, officer.key);
    const station = state.stations[officer.key];
    const location = station ? cityName(world, station) : "无驻地";
    const dutyText = dispatch ? "待出征" : duty ? labels[duty.role] : "待任";
    const details = make("div");
    details.append(make("strong", officer.name),
      make("span", "政 " + officerSkill(state, officer, "governance") + " · 统 " + officerSkill(state, officer, "command") + " · " + location + " · " + dutyText, "muted"));
    person.append(details);
    if (canTransfer && !duty && !dispatch && station !== selected) {
      const transfer = make("button", "调来此城");
      transfer.type = "button";
      transfer.setAttribute("aria-label", "调" + officer.name + "至" + cityName(world, selected));
      transfer.addEventListener("click", () => {
        mutate(() => transferOfficer(world, state, officer.key, selected), officer.name + "已调至" + cityName(world, selected) + "。");
        find("officer-filter").focus();
      });
      person.append(transfer);
    }
    return person;
  });
  find("officer-list").replaceChildren(...(list.length ? list : [make("li", foreign ? "该势力的官员驻地尚未核实。"
    : roster.length ? "没有符合条件的人物。" : "此势力暂无人物。", "muted")]));
}

function describeOrder(order) {
  return order ? describeTurnOrder(world, era(), order) : "待下令";
}

function renderQueuedOrder() {
  const count = state.orders.length;
  const local = state.orders.filter(({ city, from, to }) => [city, from, to].includes(selected)).length;
  find("queued-order").textContent = local ? local + " 道政令待执行" : "暂无城池政令";
  if (!find("orders-dialog").open) return;
  find("order-advance-actions").hidden = orderPreview || gameOutcome(state) !== "ongoing";
  const stock = planned.factions[state.player];
  find("order-resources").textContent = "排队后余 " + formatted.format(stock.treasury) + " 钱 · " + formatted.format(stock.grain) + " 粮";
  const toggle = find("toggle-order-preview");
  toggle.textContent = orderPreview ? "返回队列" : "逐令预演";
  toggle.setAttribute("aria-expanded", String(orderPreview));
  toggle.disabled = !count;
  find("order-list").hidden = orderPreview;
  find("order-preview").hidden = !orderPreview;
  if (orderPreview) {
    renderOrderPreview();
    return;
  }
  const rows = state.orders.map((order, index) => {
    const row = make("li");
    if (order.type === "attack" && order.officer === orderFocusOfficer) {
      row.dataset.highlight = "true";
      row.tabIndex = -1;
    }
    const action = make("span", (index + 1) + ". " + describeOrder(order));
    const controls = make("div", undefined, "queue-controls");
    for (const [label, shift] of [["上移", -1], ["下移", 1], ["撤销", 0]]) {
      const button = make("button", label, "quiet");
      button.type = "button";
      button.setAttribute("aria-label", "第 " + (index + 1) + " 道政令 " + label);
      const target = index + shift;
      button.disabled = target < 0 || target >= count;
      button.addEventListener("click", () => {
        const orders = [...state.orders];
        orders.splice(index, 1);
        if (shift) orders.splice(target, 0, order);
        try {
          const next = replaceOrders(world, state, orders);
          find("orders-status").hidden = true;
          mutate(() => next);
          const focusRow = find("order-list").children[Math.min(target, orders.length - 1)];
          (focusRow?.querySelector("button:not(:disabled)") || find("orders-dialog").querySelector("[data-close]")).focus();
        } catch (error) {
          const status = find("orders-status");
          status.textContent = (shift ? "无法调整顺序。 " : "请先撤销依赖此令的后续政令。 ") + error.message;
          status.hidden = false;
        }
      });
      controls.append(button);
    }
    row.append(action, controls);
    return row;
  });
  find("order-list").replaceChildren(...(rows.length ? rows : [make("li", "本季尚未下达政令。", "muted")]));
}

function renderOrderPreview() {
  const steps = forecastOrderSteps(world, state, { byIntelligence: Boolean(state.war) });
  const size = innerHeight <= 520 ? 1 : innerHeight <= 720 || innerWidth < 430 ? 2 : 3;
  const rows = pageOf(steps, "order-preview", size, renderOrderPreview).map(({ order, entry, number, spent, prerequisite, garrisons }) => {
    const row = make("li");
    row.dataset.step = String(number);
    row.append(make("strong", "第 " + number + " 道 · " + describeOrder(order)));
    if (order.type !== "transfer") row.append(make("span", entry.text));
    const costs = [];
    if (spent.treasury) costs.push(formatted.format(spent.treasury) + " 钱");
    if (spent.grain) costs.push(formatted.format(spent.grain) + " 粮");
    if (costs.length) row.append(make("span", "支出 " + costs.join(" · "), "muted"));
    if (garrisons.length) {
      const changes = garrisons.map(({ key, before, after, owner, nextOwner }) => {
        const label = cityName(world, key);
        if (owner !== nextOwner) return label + "新驻军 " + formatted.format(after);
        return label + " " + formatted.format(before) + " → " + formatted.format(after);
      });
      row.append(make("span", "驻军 · " + changes.join(" · "), "muted"));
    }
    if (prerequisite) row.append(make("span", "需先执行前置政令 · " + prerequisite, "prerequisite"));
    return row;
  });
  find("order-preview-list").replaceChildren(...rows);
}

function openOrdersDialog(officer) {
  orderPreview = false;
  orderFocusOfficer = officer;
  pages["order-preview"] = 0;
  find("orders-status").hidden = true;
  find("orders-dialog").showModal();
  renderQueuedOrder();
  find("order-list").querySelector("[data-highlight]")?.focus();
}

function readAttack() {
  return {
    type: "attack", from: selected, to: find("target-picker").value,
    officer: find("officer-picker").value, troops: Number(find("troops").value),
  };
}

function updateForecast() {
  const attack = readAttack();
  const forecast = find("attack-forecast");
  const troops = find("troops");
  if (!attack.to || !attack.officer || !troops.checkValidity()) {
    forecast.textContent = "请选择武将、目标和有效兵力。";
    forecast.dataset.state = "";
    find("send-order").disabled = true;
    return;
  }
  const outcome = forecastAttack(era(), militaryView(planned), attack);
  const enough = planned.factions[state.player].grain >= outcome.grain;
  const result = outcome.wins ? "预计占优" : "预计失利";
  const strength = formatted.format(outcome.offense) + " 对 " + formatted.format(outcome.defense);
  forecast.textContent = result + " · " + (state.war ? "情报估算 " : "战力 ") + strength + " · 耗粮 " + outcome.grain + (enough ? "" : " · 储粮不足");
  forecast.dataset.state = outcome.wins ? "advantage" : "disadvantage";
  find("send-order").disabled = !enough || state.orders.length >= seasonOrderLimit;
}

function renderAttack() {
  const city = currentCity();
  const origin = planned.cities[city.key];
  const enemy = origin.owner !== state.player;
  const protectedCity = enemy && !isHostile(planned, state.player, origin.owner);
  const origins = city.links.filter((key) => planned.cities[key].owner === state.player);
  const targets = city.links.filter((key) => isHostile(planned, state.player, planned.cities[key].owner));
  const commanders = availableAttackers(era(), planned, state.player, selected)
    .filter(({ key }) => !pendingExpedition(state, key));
  const capacity = origin.troops - cityReserve;
  const ongoing = gameOutcome(state) === "ongoing";
  const canAttack = ongoing && !enemy && targets.length > 0 && commanders.length > 0 && capacity >= minimumMarch;
  const attackFrom = find("attack-from");
  const hint = find("expedition-status");
  const form = find("attack-form");
  attackFrom.hidden = !ongoing || !enemy || protectedCity || !origins.length;
  if (!attackFrom.hidden) {
    find("origin-picker").replaceChildren(...origins.map((key) => new Option(cityName(world, key), key)));
  }
  hint.hidden = canAttack || !attackFrom.hidden;
  if (!hint.hidden) {
    if (!ongoing) hint.textContent = "战局已结束。";
    else if (protectedCity) hint.textContent = "此城受有效约定保护，期满后才可出征。";
    else if (enemy) hint.textContent = "这座城附近没有己方出征城。";
    else if (!targets.length) hint.textContent = "相邻城池均为己方或受约定保护。";
    else if (!commanders.length) hint.textContent = "此城暂无可出征的武将。可调来待任武将，或为本城任命守将。";
    else hint.textContent = "请先征兵，备足出征兵力和 " + cityReserve + " 名留守兵。";
  }
  form.hidden = !canAttack;
  if (!canAttack) return;

  const to = find("target-picker");
  const officer = find("officer-picker");
  const amount = find("troops");
  if (attackDraft.from !== selected) attackDraft = {};
  to.replaceChildren(...targets.map((key) => new Option(cityName(world, key) + " · " + factionName(era(), planned.cities[key].owner), key)));
  officer.replaceChildren(...[...commanders].sort((a, b) => officerSkill(state, b, "command") - officerSkill(state, a, "command"))
    .map(({ key, name, command }) => new Option(name + " · 统率 " + command, key)));
  if (targets.includes(attackDraft.to)) to.value = attackDraft.to;
  if (commanders.some(({ key }) => key === attackDraft.officer)) officer.value = attackDraft.officer;
  amount.max = capacity;
  amount.value = Math.max(minimumMarch, Math.min(capacity, attackDraft.troops ?? planned.factions[state.player].grain * 100));
  attackDraft = readAttack();
  updateForecast();
}

function readTransfer() {
  const to = find("transfer-target").value;
  const route = transferPaths.get(to);
  return { type: "transfer", from: selected, to, troops: Number(find("transfer-troops").value),
    ...(route?.length > 2 ? { route } : {}) };
}

function updateTransfer() {
  const input = find("transfer-troops");
  const order = readTransfer();
  const stock = planned.factions[state.player];
  const grain = transferGrain(order);
  const enough = stock.grain >= grain;
  const valid = Boolean(order.to) && input.checkValidity();
  const route = find("transfer-route");
  route.textContent = order.route?.map((key) => cityName(world, key)).join(" → ") ?? "";
  route.hidden = !order.route;
  find("transfer-summary").textContent = valid
    ? "出发城留守 " + formatted.format(planned.cities[selected].troops - order.troops) + " 人 · 耗粮 " + grain + (enough ? "" : " · 储粮不足")
    : "至少调动 " + minimumMarch + " 人，出发城须留守 " + cityReserve + " 人。";
  find("send-transfer").disabled = !valid || !enough || state.orders.length >= seasonOrderLimit;
}

function renderTransfer() {
  const from = planned.cities[selected];
  const routes = transferRoutes(world, planned, selected);
  transferPaths = new Map(routes.map((route) => [route.at(-1), route]));
  const capacity = from.troops - cityReserve;
  const form = find("transfer-form");
  const status = find("transfer-status");
  const ongoing = gameOutcome(state) === "ongoing";
  form.hidden = !ongoing || from.owner !== state.player || !routes.length || capacity < minimumMarch;
  status.hidden = !form.hidden;
  if (form.hidden) {
    status.textContent = !ongoing ? "战局已结束。" : from.owner !== state.player ? "可从己方城池调兵。" : !routes.length
      ? "附近没有可调往的己方城池。" : "当前驻军不足。出发城至少须留守 " + cityReserve + " 人。";
    return;
  }
  const target = find("transfer-target");
  const input = find("transfer-troops");
  if (transferDraft.from !== selected) transferDraft = {};
  const neighboring = make("optgroup");
  neighboring.label = "相邻城池";
  const remote = make("optgroup");
  remote.label = "跨城调兵";
  for (const [key, route] of transferPaths) {
    const distance = route.length - 1;
    const label = cityName(world, key) + (distance > 1 ? " · " + distance + " 段" : "") + " · "
      + formatted.format(planned.cities[key].troops) + " 人";
    (distance > 1 ? remote : neighboring).append(new Option(label, key));
  }
  if (remote.children.length) target.replaceChildren(neighboring, remote);
  else target.replaceChildren(...neighboring.children);
  if (transferPaths.has(transferDraft.to)) target.value = transferDraft.to;
  input.max = capacity;
  input.value = Math.max(minimumMarch, Math.min(capacity, transferDraft.troops ?? 600));
  transferDraft = readTransfer();
  updateTransfer();
}

function summaryRow(item, turn) {
  const labels = {
    gain: "攻占", loss: "失城", cancelled: "政令取消", stage: "阶段目标", milestone: "战役目标", event: "战役事件",
    victory: "战局胜利", defeat: "战局结束", army: "军团补给", theater: "战区待决",
    defended: "守住城池", "attack-failed": "出征失利", war: "战役军情",
  };
  const row = make("li");
  row.dataset.summary = item.kind;
  const detail = make("div", undefined, "report-entry");
  const text = make("div");
  text.append(make("strong", labels[item.kind]), make("span", item.entry.text));
  detail.append(text);
  appendReportActions(detail, item.entry, turn);
  if (item.kind === "war") {
    const open = make("button", "战役指挥", "quiet");
    open.type = "button";
    open.addEventListener("click", () => {
      find("chronicle").close();
      const plan = state.theaters?.find(({ army, target }) => (item.entry.officer && army === item.entry.officer) || target === item.entry.city);
      if (plan || item.entry.theater) warPanel.open("plans", plan?.id ?? item.entry.theater);
      else if (item.entry.officer && armyByOfficer(state, item.entry.officer)?.faction === state.player) armyPanel.open(item.entry.officer);
      else warPanel.open("review");
    });
    detail.append(open);
  }
  row.append(detail);
  return row;
}

function reportLocateButton(city, origin = "chronicle") {
  if (!Object.hasOwn(state.cities, city)) return null;
  const locate = make("button", "定位", "quiet");
  locate.type = "button";
  locate.setAttribute("aria-label", "定位" + cityName(world, city));
  locate.addEventListener("click", () => locateOnMap(city, origin));
  return locate;
}

function battleReportButton(entry, turn, origin = "chronicle") {
  if (state.war && !entry.participants?.includes(state.player)) return null;
  if (!entry.battle) return null;
  const battle = make("button", "战报", "quiet");
  battle.type = "button";
  battle.setAttribute("aria-label", "查看" + cityName(world, entry.city) + "战报");
  battle.addEventListener("click", () => openBattleReport(entry, turn, origin));
  return battle;
}

function appendReportActions(detail, entry, turn) {
  const locate = reportLocateButton(entry.city);
  const battle = battleReportButton(entry, turn);
  const council = entry.type === "event" || entry.type === "milestone";
  const currentArmy = entry.armyOfficer && armyByOfficer(state, entry.armyOfficer);
  const army = currentArmy && currentArmy.assembledAt === entry.assembledAt ? currentArmy : null;
  const theater = entry.theater && state.theaters?.find(({ id }) => id === entry.theater);
  if (!locate && !battle && !entry.personnelChange && !council && !army && !theater) return;
  const actions = make("div", undefined, "report-actions");
  if (council) {
    const open = make("button", "查看", "quiet");
    open.type = "button";
    open.addEventListener("click", () => openCouncil(entry.type === "event" ? "events" : "route"));
    actions.append(open);
  }
  if (army) {
    const open = make("button", "军团", "quiet");
    open.type = "button";
    open.addEventListener("click", () => {
      find("chronicle").close();
      find("opponent-brief-dialog").close();
      armyPanel.open(army.officer);
    });
    actions.append(open);
  }
  if (theater) {
    const open = make("button", "战区", "quiet");
    open.type = "button";
    open.addEventListener("click", () => { find("chronicle").close(); theaterPanel.open(theater.id); });
    actions.append(open);
  }
  if (battle) actions.append(battle);
  if (entry.personnelChange) actions.append(officerLink(entry.personnelChange.officer, "chronicle", "档案"));
  if (canInspectOccupation(state, entry)) {
    const occupation = make("button", "整顿", "quiet");
    occupation.type = "button";
    occupation.setAttribute("aria-label", "查看" + cityName(world, entry.city) + "整顿");
    occupation.addEventListener("click", () => {
      find("chronicle").close();
      find("opponent-brief-dialog").close();
      openHoldings(entry.city);
    });
    actions.append(occupation);
  }
  if (locate) actions.append(locate);
  detail.append(actions);
}

function decisionReceiptText(decision, receipt) {
  if (receipt === null) return "本季休整";
  if (!receipt) return "";
  const labels = { order: "已执行", notice: "已取消", capture: "攻占城池", battle: "进攻失利" };
  return labels[receipt.type] + (receipt.text === decision.action + "。" ? "" : " · " + receipt.text);
}

function appendDecisionReceipt(row, decision, receipt, turn) {
  if (receipt === null) {
    row.dataset.receipt = "rest";
    row.append(make("span", decisionReceiptText(decision, receipt), "plan-receipt"));
    return;
  }
  if (!receipt) return;
  row.dataset.receipt = receipt.type;
  const result = make("div", undefined, "plan-receipt");
  result.append(make("span", decisionReceiptText(decision, receipt)));
  appendReportActions(result, receipt, turn);
  row.append(result);
}

function detailDialog(type) {
  return find(type === "battle" ? "battle-dialog" : "person-dialog");
}

function detailBackLabel() {
  const previous = detailHistory.at(-1);
  if (previous) return previous.type === "battle" ? "返回战报" : "返回档案";
  if (detailRoot === "opponent-brief-dialog") return "返回疆域履历";
  return detailRoot === "roster-dialog" ? "返回名册" : "返回奏报";
}

function showDetail(view) {
  if (detailView) detailDialog(detailView.type).close();
  detailView = view;
  if (!view) return;
  if (view.type === "battle") renderBattleReport(view);
  else {
    find("person-feedback").hidden = true;
    renderPersonProfile();
  }
  detailDialog(view.type).showModal();
}

function openDetail(view, root) {
  detailRoot = root;
  detailHistory.length = 0;
  showDetail(view);
}

function backFromDetail() {
  showDetail(detailHistory.pop());
}

function sameDetail(previous, view) {
  if (previous?.type !== view.type) return false;
  if (view.type === "person") return previous.officer === view.officer;
  return previous.turn === view.turn && previous.entry.city === view.entry.city && previous.entry.type === view.entry.type
    && previous.entry.battle.from === view.entry.battle.from
    && previous.entry.battle.personnel?.attacker === view.entry.battle.personnel?.attacker;
}

function followDetail(view) {
  if (sameDetail(detailHistory.at(-1), view)) {
    backFromDetail();
    return;
  }
  detailHistory.push(detailView);
  showDetail(view);
}

function locateFromDetail(city) {
  if (!city) return;
  showDetail(null);
  detailHistory.length = 0;
  locateOnMap(city, detailRoot);
}

function openBattleReport(entry, turn, origin = "chronicle", focusOfficer) {
  openDetail({ type: "battle", entry, turn, pane: focusOfficer ? "personnel" : "overview", focusOfficer }, origin);
}

function officerLink(officer, root, label) {
  const person = era().officers.find(({ key }) => key === officer);
  if (!person) return make("span", "空缺");
  const button = make("button", undefined, "quiet officer-link");
  button.type = "button";
  button.append(make("strong", label ?? person.name));
  button.setAttribute("aria-label", "查看" + person.name + "档案");
  button.addEventListener("click", () => {
    const view = { type: "person", officer, page: 0 };
    if (root) openDetail(view, root);
    else followDetail(view);
  });
  return button;
}

function renderBattleReport({ entry, turn, pane }) {
  const { from, attacker, defender, occupation, personnel } = entry.battle;
  find("battle-back").textContent = detailBackLabel();
  find("battle-title").textContent = cityName(world, entry.city) + "之战";
  find("battle-season").textContent = seasonTitle(turn - 1);
  find("battle-route").textContent = cityName(world, from) + " → " + cityName(world, entry.city);
  find("battle-result").textContent = occupation ? "攻方攻占城池" : "守方守住城池";
  find("battle-attacker").textContent = "攻方 · " + factionName(era(), attacker.faction);
  find("battle-defender").textContent = "守方 · " + factionName(era(), defender.faction);
  find("battle-leaders").hidden = !personnel;
  if (personnel) {
    find("battle-attacker-officer").replaceChildren(officerLink(personnel.attacker));
    find("battle-defender-officer").replaceChildren(officerLink(personnel.defender));
  }
  for (const key of ["troops", "strength", "casualties"]) {
    const [, offense, defense] = find("battle-" + key).cells;
    offense.textContent = formatted.format(attacker[key]);
    defense.textContent = formatted.format(defender[key]);
  }
  const aftermath = find("battle-aftermath");
  aftermath.hidden = !occupation;
  if (occupation) {
    const retreat = defender.troops - defender.casualties - (occupation.fieldRemaining ?? 0);
    const notes = ["攻方留驻 " + formatted.format(occupation.garrison) + " 人"];
    if (occupation.inArmy) notes.push("另有 " + formatted.format(occupation.inArmy) + " 人留在军团");
    if (occupation.fieldRemaining) notes.push("守方仍有 " + formatted.format(occupation.fieldRemaining) + " 名军团兵留在野外");
    if (retreat > 0) {
      const survivors = formatted.format(retreat) + " 名守军";
      notes.push(occupation.retreatTo ? survivors + "退至" + cityName(world, occupation.retreatTo) : survivors + "无城可退，部队溃散");
    }
    aftermath.textContent = notes.join("。") + "。";
  }
  find("battle-panes").hidden = !personnel?.relocated;
  renderBattlePane(pane);
}

function renderBattlePersonnel(onPage) {
  const { entry, focusOfficer } = detailView;
  const route = entry.battle.occupation.retreatTo;
  const people = entry.battle.personnel.relocated;
  const target = route ? cityName(world, route) : null;
  find("battle-relocation-count").textContent = "迁出 " + people.length + " 人"
    + (people.length ? target ? " · 当时移驻" + target : " · 无驻地" : "");
  const locate = find("battle-retreat-map");
  locate.hidden = !target || people.length === 0;
  locate.setAttribute("aria-label", target ? "定位撤往城池" + target : "地图定位");
  const size = innerHeight <= 460 ? 2 : innerHeight <= 670 ? 4 : 6;
  if (focusOfficer && detailView.page === undefined) {
    const index = people.findIndex(({ officer }) => officer === focusOfficer);
    if (index >= 0) detailView.page = Math.floor(index / size);
  }
  if (!onPage) pages["battle-personnel"] = detailView.page ?? 0;
  const rows = pageOf(people, "battle-personnel", size, () => renderBattlePersonnel(true)).map(({ officer, role }) => {
    const row = make("li");
    if (officer === focusOfficer) row.dataset.highlight = "true";
    row.append(officerLink(officer), make("span", role === "available" ? "原待任" : "原" + labels[role], "muted"));
    return row;
  });
  detailView.page = pages["battle-personnel"];
  find("battle-relocation-list").replaceChildren(...rows);
}

function renderBattlePane(pane) {
  const personnel = pane === "personnel";
  for (const button of document.querySelectorAll("[data-battle-pane]")) {
    button.setAttribute("aria-pressed", String(button.dataset.battlePane === pane));
  }
  find("battle-overview").hidden = personnel;
  find("battle-personnel").hidden = !personnel;
  if (personnel) renderBattlePersonnel();
}

function renderPersonProfile(onPage) {
  const profile = officerProfile(world, state, detailView.officer);
  const { person, station, posting, expedition, army, available, timeline } = profile;
  find("person-title").textContent = person.name;
  find("person-back").textContent = detailBackLabel();
  find("person-current").textContent = "当前 · " + seasonTitle(state.turn) + " · " + factionName(era(), person.faction);
  statList(find("person-stats"), [["政务", officerSkill(state, person, "governance")], ["统率", officerSkill(state, person, "command")]]);
  const duty = realmOffices[nationalDuty(state, person.key)];
  find("person-duty").textContent = army ? "随军 · " + cityName(world, army.location) + " · " + armyPhases[army.phase]
    : "驻地 " + (station ? cityName(world, station) : "无驻地") + " · " + (duty ? duty + "官" : posting ? labels[posting.role] : expedition ? "待出征" : "待任");
  find("person-expedition").hidden = !expedition;
  if (expedition) find("person-expedition").textContent = "待执行 · " + describeOrder(expedition);
  find("person-locate").hidden = !station;
  find("person-orders").hidden = !expedition;
  const canManage = person.faction === state.player && !expedition && gameOutcome(state) === "ongoing";
  find("person-assign").hidden = !canManage || !available;
  find("person-reassign").hidden = !canManage || !posting;
  find("person-open-service").hidden = person.faction !== state.player;
  find("person-actions").hidden = [...find("person-actions").children].every((button) => button.hidden);
  if (!onPage) pages["person-history"] = detailView.page ?? 0;
  const mode = detailView.historyMode ?? "all";
  for (const button of document.querySelectorAll("[data-person-history]")) {
    button.setAttribute("aria-pressed", button.dataset.personHistory === mode);
  }
  const records = mode === "all" ? timeline : timeline.filter(({ type }) => type === mode);
  const size = innerHeight <= 480 ? 1 : innerHeight <= 720 ? 2 : 4;
  const rows = pageOf(records, "person-history", size, () => renderPersonProfile(true))
    .map((item) => item.type === "battle" ? personBattleRecord(item.record) : item.type === "polity"
      ? make("li", seasonTitle(item.season) + " · " + item.text) : personPostingRecord(item));
  detailView.page = pages["person-history"];
  const empty = { all: "暂无留存履历。", battle: "留存奏报中暂无此人的战事记录。", personnel: "暂无留存的任免调驻记录。" };
  find("person-history-list").replaceChildren(...(rows.length ? rows : [make("li", empty[mode], "muted")]));
}

function renderOfficerService() {
  const key = detailView.officer;
  const person = era().officers.find((entry) => entry.key === key);
  if (!person) return;
  find("person-service-title").textContent = person.name + " · 资历";
  const service = officerService(state, key);
  const rows = Object.entries({ governance: "政务", command: "统率" }).map(([skill, name]) => {
    const required = promotionCost(state, key, skill);
    const row = make("li");
    const description = required === null ? "最高品阶" : "资历 " + service[skill] + " / " + required;
    const details = make("div", undefined, "holding-detail");
    details.append(make("strong", name + " " + officerSkill(state, person, skill)), make("span", " · " + description, "muted"));
    const promote = make("button", "提拔", "quiet");
    promote.type = "button";
    promote.setAttribute("aria-label", "提拔" + name);
    promote.disabled = gameOutcome(state) !== "ongoing" || !state.stations[key] || required === null || service[skill] < required;
    promote.addEventListener("click", () => {
      mutate(() => promoteOfficer(world, state, key, skill), person.name + "已获提拔，" + name + "增加 5 点。");
      renderOfficerService();
    });
    row.append(details, promote);
    return row;
  });
  find("person-service-list").replaceChildren(...rows);
  const lastDuty = state.realm?.service.findLast(({ person }) => person === key);
  find("person-realm-service").hidden = !lastDuty;
  if (lastDuty) find("person-realm-service").textContent = realmOffices[lastDuty.role] + " · " + lastDuty.detail;
}

function personBattleRecord({ entry, turn, attack, defend, relocation }) {
  const row = make("li");
  row.dataset.city = entry.city;
  row.dataset.turn = turn;
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", cityName(world, entry.city) + "之战"), make("span", seasonTitle(turn - 1), "muted"));
  const roles = [];
  if (attack) roles.push(entry.type === "capture" ? "领兵攻占" : "出征失利");
  if (defend) roles.push(entry.type === "capture" ? "守将 · 城池失守" : "守将 · 守住城池");
  if (relocation) {
    if (!defend || relocation.role !== "commander") {
      roles.push(relocation.role === "available" ? "原待任" : "原" + labels[relocation.role]);
    }
    roles.push(relocation.destination ? "当时移驻" + cityName(world, relocation.destination) : "迁出后无驻地");
  }
  details.append(heading, make("span", roles.join(" · "), "muted"));
  const report = make("button", "战报", "quiet");
  report.type = "button";
  report.addEventListener("click", () => {
    followDetail({ type: "battle", entry, turn, pane: relocation ? "personnel" : "overview",
      focusOfficer: relocation ? detailView.officer : undefined });
  });
  row.append(details, report);
  return row;
}

function personPostingRecord({ season, settled, change: { from, to } }) {
  const row = make("li");
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  const action = to.role ? postingChangeVerb(from, to) + labels[to.role] : from.role ? "卸任" + labels[from.role] : "调驻";
  heading.append(make("strong", action), make("span", seasonTitle(season) + (settled ? " · 季末结算" : " · 季内办理"), "muted"));
  details.append(heading, make("span", postingLabel(from) + " → " + postingLabel(to), "muted"));
  row.append(details);
  return row;
}

function postingLabel({ city, role }) {
  return (city ? cityName(world, city) : "无驻地") + (role ? " · " + labels[role] : " · 待任");
}

function postingChangeVerb(from, to) {
  if (!from.role) return "任命";
  return from.city === to.city ? "改任" : "调任";
}

function renderSeasonSummary() {
  const report = latestSeasonSummary(state);
  const period = find("summary-period");
  period.textContent = report ? seasonTitle(report.turn - 1) + "结算" : state.turn ? "暂无季度结算记录。" : "首季待结算。";
  for (const id of ["summary-counts", "summary-balance-line", "summary-events"]) find(id).hidden = !report;
  find("summary-envoy-line").hidden = !report?.envoy;
  if (!report) {
    find("summary-pages").hidden = true;
    return;
  }

  let lost = "失城 " + report.losses;
  if (report.lossesIncomplete) lost = report.losses > 0 ? "已知失城 " + report.losses : "失城资料不全";
  find("summary-counts").textContent = "攻占 " + report.gains + " · " + lost + " · 政令取消 " + report.cancellations;
  find("summary-balance").textContent = report.balance
    ? "实账净变动 · 钱 " + signed(report.balance.treasury) + " · 粮 " + signed(report.balance.grain)
    : "此季没有可核对的钱粮实账。";
  find("summary-finance").hidden = !report.balance;
  if (report.envoy) {
    find("summary-envoy").textContent = "待答复 · " + factionName(era(), report.envoy.from)
      + "提议" + treatyTerms[report.envoy.kind].name;
  }

  const pageSize = innerHeight <= 470 ? 1 : innerHeight <= 680 || innerWidth < 420 ? 2 : 4;
  const items = pageOf(report.events, "summary", pageSize, renderSeasonSummary).map((item) => summaryRow(item, report.turn));
  find("summary-events").replaceChildren(...items);
  find("summary-events").hidden = items.length === 0;
}

function renderReports({ turn, faction } = {}) {
  const summary = reportType === "summary";
  find("season-summary").hidden = !summary;
  if (summary) {
    for (const id of ["chronicle-turn-wrap", "chronicle-category-wrap", "news", "opponent-plan-list", "reports-pages"]) find(id).hidden = true;
    renderSeasonSummary();
    return;
  }
  const select = find("chronicle-turn");
  const previous = turn ?? select.value;
  const history = [...state.history].reverse();
  select.replaceChildren(...history.map(({ turn }) => new Option(seasonTitle(turn - 1), turn)), new Option("全部已存季度", "all"));
  if ([...select.options].some(({ value }) => value === previous)) select.value = previous;
  find("chronicle-turn-wrap").hidden = !history.length;
  const factions = find("chronicle-faction");
  const previousFaction = faction ?? factions.value;
  factions.replaceChildren(new Option("全部势力", "all"), ...playableFactions(era()).map(({ name, key }) => new Option(name, key)));
  if ([...factions.options].some(({ value }) => value === previousFaction)) factions.value = previousFaction;
  const plans = reportType === "plans";
  const category = find("chronicle-category").value;
  find("chronicle-category-wrap").hidden = !history.length || plans;
  const entries = filteredReports(state.history, { section: reportType, turn: select.value, category, faction: factions.value })
    .filter(({ entry }) => !state.war || plans || entry.faction === state.player || entry.participants?.includes(state.player)
      || ["capture", "diplomacy", "stage", "milestone", "victory", "defeat"].includes(entry.type));
  find("reports-count").textContent = entries.length + " 条奏报";
  const multi = select.value === "all";
  const shortPlan = innerHeight <= 500 || (innerWidth < 420 && innerHeight <= 650);
  const size = plans ? (shortPlan ? 1 : innerHeight <= 680 || innerWidth < 420 ? 2 : 3)
    : innerHeight <= 520 ? 2 : innerHeight <= 650 ? 4 : 6;
  const rows = pageOf(entries, "reports", size, renderReports).map(({ entry: item, turn, receipt }) => {
    const row = make("li");
    row.dataset.turn = String(turn);
    const date = multi ? make("span", seasonTitle(turn - 1), "report-date muted") : null;
    if (plans) {
      if (date) row.append(date);
      row.append(make("strong", factionName(era(), item.faction) + " · " + sources[item.source]));
      const known = !state.war || receipt?.participants?.includes(state.player);
      if (known && item.strategy) row.append(make("span", describeGoalProgress(world, item.strategy, turn), "strategy-progress"));
      if (receipt !== null) row.append(make("span", known ? item.action : "行动细节尚未核实。"));
      if (item.reason && (known || item.source === "fallback")) row.append(make("span", item.reason, "muted"));
      if (known) appendDecisionReceipt(row, item, receipt, turn);
      return row;
    }
    const prefix = item.faction && item.faction !== state.player && item.type !== "capture" && item.type !== "battle"
      ? factionName(era(), item.faction) + " · " : "";
    row.dataset.type = item.type;
    const detail = make("div", undefined, "report-entry");
    const text = make("div");
    if (date) text.append(date);
    const content = state.war && item.type === "capture" && !item.participants?.includes(state.player)
      ? factionName(era(), item.faction) + "占领" + cityName(world, item.city) + "。"
      : item.text;
    text.append(make("span", prefix + content));
    detail.append(text);
    if (!state.war || item.type !== "capture" || item.participants?.includes(state.player)) appendReportActions(detail, item, turn);
    row.append(detail);
    return row;
  });
  const box = find(plans ? "opponent-plan-list" : "news");
  find("news").hidden = plans;
  find("opponent-plan-list").hidden = !plans;
  box.replaceChildren(...(rows.length ? rows : [make("li", history.length ? "没有符合筛选条件的记录。" : "首季待结算。", "muted")]));
}

function renderBatch() {
  const owned = world.cities.filter(({ key }) => state.cities[key].owner === state.player);
  const size = innerHeight <= 430 ? 2 : innerHeight <= 650 ? 4 : 7;
  const items = pageOf(owned, "batch", size, renderBatch).map(({ key, name }) => {
    const { governor, mode } = state.cities[key];
    const row = make("li");
    const label = make("label");
    const check = make("input");
    check.type = "checkbox";
    check.checked = batchCities.has(key);
    check.addEventListener("change", () => {
      if (check.checked) batchCities.add(key);
      else batchCities.delete(key);
      updateBatchSelection(owned.length);
    });
    const person = era().officers.find(({ key }) => key === governor);
    label.append(check, make("span", name),
      make("span", person ? person.name + (mode === "delegated" ? " · 已委任" : " · 太守") : "将补任太守", "muted"));
    row.append(label);
    return row;
  });
  find("batch-cities").replaceChildren(...items);
  updateBatchSelection(owned.length);
}

function updateBatchSelection(total) {
  find("batch-count").textContent = "已选 " + batchCities.size + " / " + total + " 城";
  find("apply-batch").disabled = find("preview-batch").disabled = batchCities.size === 0;
  find("batch-status").hidden = true;
}

function openBatch(keys) {
  batchCities.clear();
  for (const key of keys) if (state.cities[key].owner === state.player) batchCities.add(key);
  pages.batch = 0;
  renderBatch();
  find("batch-dialog").showModal();
}

function batchDraft() {
  const cities = world.cities.map(({ key }) => key).filter((key) => batchCities.has(key));
  return [cities, find("batch-focus").value, find("batch-budget").valueAsNumber];
}

function batchMessage(id, message) {
  const status = find(id);
  status.textContent = message;
  status.hidden = false;
}

function formatResources({ treasury, grain }) {
  return formatted.format(treasury) + " 钱、" + formatted.format(grain) + " 粮";
}

function programFundingStatus(program) {
  if (program?.needed === undefined) return "";
  const { result, needed, available } = program;
  const label = result.startsWith("reserve-") ? "可动用 " : "可用 ";
  return label + available + " / 需 " + needed + (result.endsWith("grain") ? " 粮" : " 钱");
}

function delegationForecastRow(program) {
  const { city, governor, newGovernor, priority, result, action, spent, adjustedForReserve } = program;
  const row = make("li");
  row.dataset.city = city;
  row.dataset.result = result;
  const detail = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", cityName(world, city)), make("span", governor + (newGovernor ? " · 拟补任太守" : " · 太守"), "muted"));
  if (priority) heading.append(make("span", "重点", "priority-mark"));
  let outcome = programResults[result];
  const funding = programFundingStatus(program);
  if (result === "completed") outcome = action + (adjustedForReserve ? " · 按预留改选" : "") + " · 支出 " + formatResources(spent);
  else if (funding) outcome += " · " + funding;
  detail.append(heading, make("span", outcome, "muted"));
  row.append(detail);
  return row;
}

function renderBatchPreview() {
  const { programs, spent, closing } = batchForecast;
  const completed = programs.filter(({ result }) => result === "completed").length;
  const appointments = programs.filter(({ newGovernor }) => newGovernor).length;
  find("batch-preview-summary").textContent = "预计执行 " + completed + " / " + programs.length + " 城 · 补任太守 " + appointments + " 人";
  find("batch-preview-balance").textContent = "所选城支出 " + formatResources(spent) + " · 全国季末余 " + formatResources(closing);
  const size = innerHeight <= 460 ? 2 : innerHeight <= 650 ? 4 : 6;
  const rows = pageOf(programs, "batch-preview", size, renderBatchPreview).map(delegationForecastRow);
  find("batch-preview-list").replaceChildren(...rows);
}

function openBatchPreview() {
  if (!find("batch-form").reportValidity()) return;
  try {
    batchForecast = forecastDelegation(world, state, ...batchDraft());
    pages["batch-preview"] = 0;
    find("batch-preview-error").hidden = true;
    renderBatchPreview();
    find("batch-preview-dialog").showModal();
  } catch (error) {
    batchMessage("batch-status", error.message);
  }
}

function applyBatch() {
  const preview = find("batch-preview-dialog");
  const [cities, focus, budget] = batchDraft();
  try {
    const next = delegateCities(world, state, cities, focus, budget);
    if (preview.open) preview.close();
    find("batch-dialog").close();
    mutate(() => next, "已委任 " + cities.length + " 座城池。");
  } catch (error) {
    batchMessage(preview.open ? "batch-preview-error" : "batch-status", error.message);
  }
}

function zoneDraft() {
  return Object.fromEntries(Object.keys(zoneLabels).map((zone) => {
    const select = find("zone-" + zone + "-focus");
    return [zone, select.disabled || !select.value ? null : {
      focus: select.value,
      budget: find("zone-" + zone + "-budget").valueAsNumber,
    }];
  }));
}

function updateZoneBudgetFields() {
  const policies = zoneDraft();
  for (const zone of Object.keys(zoneLabels)) find("zone-" + zone + "-budget").disabled = !policies[zone];
  find("preview-delegation-groups").disabled = !Object.values(policies).some(Boolean);
  find("delegation-groups-error").hidden = true;
}

function selectZonePreset() {
  const preset = presetPolicies(find("zone-preset").value);
  if (preset) {
    for (const [zone, { focus, budget }] of Object.entries(preset)) {
      const select = find("zone-" + zone + "-focus");
      if (select.disabled) continue;
      select.value = focus;
      find("zone-" + zone + "-budget").value = budget;
    }
  }
  updateZoneBudgetFields();
}

function openDelegationGroups() {
  const zones = delegationZones(world, state);
  find("zone-preset").replaceChildren(new Option("自定义", ""),
    ...Object.entries(zonePresets).map(([key, { name }]) => new Option(name, key)));
  for (const [zone, title] of Object.entries(zoneLabels)) {
    find("zone-" + zone + "-count").textContent = title + " · " + zones[zone].length + " 城";
    const select = find("zone-" + zone + "-focus");
    select.replaceChildren(new Option("沿用本组设置", ""), ...Object.entries(focusLabels).map(([value, name]) => new Option(name, value)));
    select.disabled = zones[zone].length === 0;
    select.value = select.disabled ? "" : zone === "front" ? "defense" : "farming";
    find("zone-" + zone + "-budget").value = projects.defense.cost;
  }
  updateZoneBudgetFields();
  find("delegation-groups").showModal();
}

function zoneComparisonRow({ key, name, completed, total, appointments, projectsDone, spent, closing, blockers, error }) {
  const row = make("li");
  row.dataset.preset = key;
  const heading = make("div", undefined, "dialog-heading");
  const choose = make("button", "选用", "quiet");
  choose.type = "button";
  choose.disabled = Boolean(error);
  choose.setAttribute("aria-label", "选用" + name);
  choose.addEventListener("click", () => {
    const input = find("zone-preset");
    input.value = key;
    selectZonePreset();
    find("delegation-comparison").close();
    input.focus();
  });
  heading.append(make("h3", name), choose);
  row.append(heading);
  if (error) {
    row.append(make("p", error, "occupation-estimate"));
    return row;
  }
  const projectsText = Object.entries(projectsDone).map(([project, count]) => projects[project].name + " " + count + " 城").join(" · ");
  row.append(make("p", "预计建设 " + completed + " / " + total + " 城 · 拟补任 " + appointments + " 人", "muted"),
    make("p", projectsText, "muted"),
    make("p", "本案支出 " + formatResources(spent), "muted"),
    make("p", "季末余 " + formatResources(closing), "muted"));
  if (blockers.length) {
    row.append(make("p", blockers.map(([result, count]) => programResults[result] + " " + count + " 城").join(" · "), "occupation-estimate"));
  }
  return row;
}

function renderZoneComparison() {
  const size = innerWidth >= 780 || innerHeight >= 740 ? 3 : innerHeight >= 550 ? 2 : 1;
  const rows = pageOf(zoneComparison, "delegation-comparison", size, renderZoneComparison).map(zoneComparisonRow);
  find("delegation-comparison-list").replaceChildren(...rows);
}

function openZoneComparison() {
  zoneComparison = compareDelegationPresets(world, state);
  pages["delegation-comparison"] = 0;
  renderZoneComparison();
  find("delegation-comparison").showModal();
}

function renderDelegationGroupsPreview() {
  const { groups, closing, spent } = groupsForecast;
  const { rows, spent: groupSpent, required } = groups[activeZone];
  const recruited = rows.filter(({ newGovernor }) => newGovernor).length;
  const completed = rows.filter(({ result }) => result === "completed").length;
  find("delegation-groups-balance").textContent = "本案预计支出 " + formatResources(spent) + " · 全国季末余 " + formatResources(closing);
  find("delegation-zone-summary").textContent = "预计执行 " + completed + " / " + rows.length + " 城 · 拟补任太守 " + recruited + " 人";
  find("delegation-zone-funds").textContent = "本组计划需额 " + formatResources(required) + " · 预计支出 " + formatResources(groupSpent);
  const blocked = new Map();
  for (const { result } of rows) {
    if (result !== "completed") blocked.set(result, (blocked.get(result) ?? 0) + 1);
  }
  const blockers = find("delegation-zone-blockers");
  blockers.textContent = [...blocked].map(([result, count]) => programResults[result] + " " + count + " 城").join(" · ");
  blockers.hidden = !blocked.size;
  for (const button of document.querySelectorAll("[data-delegation-zone]")) {
    const zone = button.dataset.delegationZone;
    const count = groups[zone].rows.length;
    button.textContent = zoneLabels[zone] + (count ? " · " + count + " 城" : " · 沿用");
    button.setAttribute("aria-pressed", String(zone === activeZone));
    button.disabled = !count;
  }
  const size = innerHeight <= 460 ? 1 : innerHeight <= 690 ? 2 : 4;
  const items = pageOf(rows, "zone-preview", size, renderDelegationGroupsPreview).map(delegationForecastRow);
  find("delegation-zone-list").replaceChildren(...items);
}

function openDelegationGroupsPreview() {
  try {
    groupsForecast = forecastDelegationZones(world, state, zoneDraft());
    activeZone = groupsForecast.groups.front.rows.length ? "front" : "rear";
    pages["zone-preview"] = 0;
    find("delegation-preview-error").hidden = true;
    renderDelegationGroupsPreview();
    find("delegation-groups-preview").showModal();
  } catch (error) {
    batchMessage("delegation-groups-error", error.message);
  }
}

function applyDelegationGroups() {
  try {
    const next = delegateZones(world, state, zoneDraft());
    const count = Object.values(groupsForecast.groups).reduce((total, group) => total + group.rows.length, 0);
    find("delegation-groups-preview").close();
    find("delegation-groups").close();
    mutate(() => next, "已分组委任 " + count + " 座城池。");
  } catch (error) {
    batchMessage("delegation-preview-error", error.message);
  }
}

function matchingHoldings() {
  const filter = find("holdings-filter").value;
  const sort = find("holdings-sort").value;
  const front = new Set(delegationZones(world, state).front);
  const owned = world.cities.filter(({ key }) => state.cities[key].owner === state.player).map((city) => {
    const holding = state.cities[city.key];
    const frontier = front.has(city.key);
    return { city, holding, frontier, income: cityIncome(holding, state.realm?.cities[city.key]) };
  });
  return owned.filter(({ holding, frontier }) => {
    if (filter === "all") return true;
    if (filter === "front") return frontier;
    if (filter === "rear") return !frontier;
    if (filter === "occupation") return holding.occupation > 0;
    return holding.mode === filter;
  }).sort((a, b) => sort === "troops" ? b.holding.troops - a.holding.troops : b.income[sort] - a.income[sort]);
}

function renderHoldings(focusCity) {
  const matched = matchingHoldings();
  const dialog = find("holdings-dialog");
  const recovery = find("holdings-filter").value === "occupation";
  const cities = recovery ? occupiedHoldings(world, state, planned, find("holdings-sort").value) : matched;
  const ongoing = gameOutcome(state) === "ongoing";
  const total = forceTotals(state, state.player).cities;
  const unsettled = Object.values(state.cities).filter(({ owner, occupation }) => owner === state.player && occupation > 0).length;
  const pending = recovery ? cities.filter((row) => row.pending).length : 0;
  find("holdings-count").textContent = recovery
    ? "整顿 " + (cities.length - pending) + " 城" + (pending ? " · 预计攻占 " + pending + " 城" : "")
    : state.war ? `已占 ${total} · 稳定 ${total - unsettled} · 接管 ${unsettled}`
      + (cities.length === total ? "" : ` · 筛选 ${cities.length}`) : "筛选 " + cities.length + " / " + total + " 城";
  find("holdings-recovery-actions").hidden = !recovery;
  find("delegate-holdings").disabled = !matched.length || !ongoing;
  find("open-delegation-groups").disabled = !ongoing;
  const compact = innerHeight <= 460 || (innerWidth < 400 && innerHeight <= 550);
  const recoverySize = compact ? 1 : innerWidth < 400 ? (innerHeight <= 680 ? 2 : 3) : innerHeight <= 680 ? 3 : 5;
  const size = recovery ? recoverySize : compact ? 2 : innerHeight <= 650 ? 4 : 6;
  if (focusCity) {
    const index = cities.findIndex(({ city }) => city.key === focusCity);
    if (index >= 0) pages.holdings = Math.floor(index / size);
  }
  const canAppoint = recovery && ongoing && nationalRoster(world, state, { status: "available", sort: "governance", query: "" }).matching.length > 0;
  const rows = pageOf(cities, "holdings", size, renderHoldings).map((item) => {
    if (recovery) return occupationRow(item, ongoing, canAppoint, focusCity);
    const { city, holding, frontier, income } = item;
    const row = make("li");
    const details = make("div", undefined, "holding-detail");
    const tags = [holding.mode === "delegated" ? "委任" + focusLabels[holding.focus] : "直辖"];
    if (frontier) tags.push("前线");
    if (holding.occupation) tags.push("整顿余 " + holding.occupation + " 季");
    const summary = "驻军 " + formatted.format(holding.troops) + " · 钱 +" + income.treasury + " · 粮 +" + income.grain;
    const heading = make("div", undefined, "holding-heading");
    heading.append(make("strong", city.name), make("span", tags.join(" · "), "muted"));
    if (state.delegationPriority?.includes(city.key)) heading.append(make("span", "重点", "priority-mark"));
    details.append(heading, make("span", summary, "muted"));
    const view = make("button", "查看", "quiet");
    view.type = "button";
    view.setAttribute("aria-label", "查看" + city.name);
    view.addEventListener("click", () => {
      dialog.close();
      selectCity(city.key, true);
      selectTab("governance", true);
    });
    row.append(details, view);
    return row;
  });
  const empty = recovery ? "当前没有整顿中的城池或预计攻占的城池。" : "没有符合条件的城池。";
  find("holdings-list").replaceChildren(...(rows.length ? rows : [make("li", empty, "muted")]));
}

function occupationRow({ city, holding, projection, pending, progress }, ongoing, canAppoint, focusCity) {
  const row = make("li", undefined, "occupation-row");
  row.dataset.city = city.key;
  if (focusCity === city.key) {
    row.dataset.highlight = "true";
    row.tabIndex = -1;
  }
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", city.name),
    make("span", pending ? "预计攻占" : "整顿余 " + holding.occupation + " 季", "muted"));
  const governor = era().officers.find(({ key }) => key === projection.governor)?.name || "空缺";
  const garrison = pending ? "预计留驻 " + formatted.format(projection.troops)
    : "驻军 " + formatted.format(holding.troops) + " · 队列后 " + formatted.format(projection.troops);
  details.append(heading, make("span", garrison + " · 太守 " + governor, "muted"));

  const actions = make("div", undefined, "roster-actions");
  const button = (title, label, handler) => {
    const action = make("button", title, "quiet");
    action.type = "button";
    action.setAttribute("aria-label", label);
    action.addEventListener("click", handler);
    actions.append(action);
  };
  const dialog = find("holdings-dialog");
  button("定位", "定位" + city.name, () => locateOnMap(city.key, "holdings-dialog"));
  const aid = occupationReinforcement(world, state, planned, city.key, progress.shortage);
  if (aid?.from) {
    button("援军", "为" + city.name + "拟定援军", () => {
      dialog.close();
      planFrontierOrder("reinforcement", aid.from, city.key, aid.troops);
    });
  }
  if (!pending && !projection.governor && canAppoint) {
    button("太守", "补任" + city.name + "太守", () => {
      dialog.close();
      openRoster({ city: city.key, role: "governor" });
    });
  }

  let estimate = "预计季末完成";
  if (!ongoing) estimate = "战局已结束";
  else if (pending) estimate = "攻占当季暂停整顿";
  else if (progress.pause === "garrison") estimate = "驻军差 " + formatted.format(progress.shortage) + " 人 · 整顿暂停";
  else if (progress.remaining) estimate = "预计季末余 " + progress.remaining + " 季";
  if (aid?.blocker) estimate += " · " + reinforcementBlockers[aid.blocker];
  if (aid?.from && aid.troops < progress.shortage) estimate += " · 可先调 " + aid.troops + " 人";
  if (aid?.route) estimate += " · " + (aid.route.length - 1) + " 段援军";
  if (ongoing && !pending && !projection.governor && !canAppoint) estimate += " · 无待任官员";
  details.append(make("span", estimate, "occupation-estimate"));
  row.append(details, actions);
  return row;
}

function openHoldings(focusCity) {
  if (focusCity) find("holdings-filter").value = "occupation";
  pages.holdings = 0;
  renderHoldings(focusCity);
  find("holdings-dialog").showModal();
  find("holdings-list").querySelector("[data-highlight]")?.focus();
}

function occupationTargetRow({ city, pending, before, arrival, governor, progress, blocker }) {
  const row = make("li");
  row.dataset.city = city;
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", cityName(world, city)),
    make("span", pending ? "预计攻占" : "已占领", "muted"));
  const officer = era().officers.find(({ key }) => key === governor);
  details.append(heading, make("span", "队列后驻军 " + formatted.format(before) + " → " + formatted.format(arrival)
    + " 人 · 太守 " + (officer?.name ?? "空缺"), "muted"));
  let timing;
  if (progress.shortage) {
    timing = (pending ? "攻占当季暂停整顿 · " : "") + "还缺 " + formatted.format(progress.shortage) + " 人"
      + (blocker ? " · " + reinforcementBlockers[blocker] : "");
  } else if (pending) timing = "攻占当季暂停整顿，下季具备推进条件";
  else timing = progress.remaining ? "本季末可推进 · 预计余 " + progress.remaining + " 季" : "预计本季末整顿完成";
  details.append(make("span", timing, "occupation-estimate"));
  row.append(details);
  return row;
}

function renderOccupationPlan() {
  const { source, steps, targets, ended, grain, closingGrain, error } = occupationPlan;
  const stale = source !== state || deciding;
  const note = find("occupation-plan-note");
  note.textContent = stale ? "战局已有变化，请返回并重新打开预案。" : error ?? (ended ? "战局已结束。" : "");
  note.hidden = !note.textContent;
  find("confirm-occupation-plan").disabled = stale || Boolean(error) || !steps.length;
  find("occupation-plan-summary").textContent = "拟追加 " + steps.length + " 道 · 合计耗粮 " + formatted.format(grain)
    + " · 队列后余粮 " + formatted.format(closingGrain);
  find("occupation-plan-tabs").hidden = !targets.length;
  for (const button of document.querySelectorAll("[data-occupation-pane]")) {
    button.setAttribute("aria-pressed", String(button.dataset.occupationPane === occupationPane));
  }
  const showingSteps = occupationPane === "steps";
  const size = innerHeight <= 500 ? 1 : innerHeight <= 680 ? 2 : 3;
  const rows = pageOf(showingSteps ? steps : targets, "occupation-plan", size, renderOccupationPlan)
    .map(showingSteps ? reinforcementStepRow : occupationTargetRow);
  const empty = error ? "暂无可用预案。" : showingSteps ? "暂无可追加的整顿援军令。" : "队列后暂无驻军不足的整顿城池。";
  find("occupation-plan-list").replaceChildren(...(rows.length ? rows : [make("li", empty, "muted")]));
}

function openOccupationPlan() {
  const source = state;
  try {
    occupationPlan = { source, ...planOccupationReinforcements(world, state) };
  } catch (error) {
    occupationPlan = { source, steps: [], targets: [], grain: 0, closingGrain: planned.factions[state.player].grain, error: error.message };
  }
  occupationPane = occupationPlan.steps.length ? "steps" : "targets";
  pages["occupation-plan"] = 0;
  renderOccupationPlan();
  find("occupation-plan-dialog").showModal();
}

function applyOccupationPlan() {
  const { source, steps, error } = occupationPlan;
  if (source !== state || deciding || !steps.length || error) {
    renderOccupationPlan();
    return;
  }
  let next;
  try {
    next = replaceOrders(world, state, [...state.orders, ...steps.map(({ order }) => order)]);
  } catch (cause) {
    occupationPlan.error = cause.message;
    renderOccupationPlan();
    return;
  }
  find("occupation-plan-dialog").close();
  mutate(() => next);
  const count = find("holdings-count");
  count.textContent = "已追加 " + steps.length + " 道整顿援军令";
  count.focus();
}

function occupationGovernorRow({ city, troops, before, after, candidate, blocker }) {
  const row = make("li");
  row.dataset.city = city;
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", cityName(world, city)), make("span", "队列后驻军 " + formatted.format(troops) + " 人", "muted"));
  details.append(heading);
  if (candidate) {
    const { person, stationName } = candidate;
    details.append(make("span", "拟任 " + person.name + " · 政务 " + person.governance, "muted"),
      make("span", stationName ? "原驻地 " + stationName : "原无驻地", "muted"));
  } else {
    const reason = { staff: "待任官员不足", capture: "攻占后可任命", ended: "太守空缺" };
    details.append(make("span", reason[blocker], "muted"));
  }
  if (blocker !== "ended") {
    let timing = "预计季末余 " + before.remaining + " → " + after.remaining + " 季";
    if (blocker === "capture") timing = "攻占当季暂停整顿";
    if (before.shortage) timing += " · 缺驻军 " + formatted.format(before.shortage) + " 人";
    details.append(make("span", timing, "occupation-estimate"));
  }
  row.append(details);
  return row;
}

function renderOccupationGovernors() {
  const { source, rows, assignments, ended, error } = occupationGovernors;
  const stale = source !== state || deciding;
  const pending = rows.filter((row) => row.pending).length;
  find("occupation-governors-summary").textContent = "拟补任 " + assignments.length + " / " + (rows.length - pending) + " 城"
    + (pending ? " · 待攻占 " + pending + " 城" : "");
  const note = find("occupation-governors-note");
  note.textContent = stale ? "战局已有变化，请返回并重新打开预览。" : error ?? (ended ? "战局已结束。" : "");
  note.hidden = !note.textContent;
  find("confirm-occupation-governors").disabled = stale || Boolean(error) || !assignments.length;
  const size = innerHeight <= 480 ? 1 : innerHeight <= 620 ? 2 : 4;
  const items = pageOf(rows, "occupation-governors", size, renderOccupationGovernors).map(occupationGovernorRow);
  find("occupation-governors-list").replaceChildren(...(items.length ? items : [make("li", "暂无需要补任太守的整顿城。", "muted")]));
}

function openOccupationGovernors() {
  const source = state;
  try {
    occupationGovernors = { source, ...planOccupationGovernors(world, state) };
  } catch (error) {
    occupationGovernors = { source, rows: [], assignments: [], error: error.message };
  }
  pages["occupation-governors"] = 0;
  renderOccupationGovernors();
  find("occupation-governors-dialog").showModal();
}

function applyOccupationGovernors() {
  const { source, assignments, error } = occupationGovernors;
  if (source !== state || deciding || !assignments.length || error) {
    renderOccupationGovernors();
    return;
  }
  let next;
  try {
    next = appointOccupationGovernors(world, state, assignments).state;
  } catch (cause) {
    occupationGovernors.error = cause.message;
    renderOccupationGovernors();
    return;
  }
  find("occupation-governors-dialog").close();
  mutate(() => next);
  const count = find("holdings-count");
  count.textContent = "已补任 " + assignments.length + " 名太守";
  count.focus();
}

function takeoverRow({ city, pending, before, arrival, governor, candidate, staffBlocker, aidBlocker, progress, steps }, ended) {
  const row = make("li");
  row.dataset.city = city;
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", cityName(world, city)), make("span", pending ? "预计攻占" : "已占领", "muted"));
  details.append(heading, make("span", "队列后驻军 " + formatted.format(before) + " → " + formatted.format(arrival) + " 人", "muted"));
  for (const { order, number, retained } of steps) {
    const route = (order.route ?? [order.from, order.to]).map((key) => cityName(world, key)).join(" → ");
    details.append(make("span", "第 " + number + " 令 · " + route + " · 调 " + formatted.format(order.troops)
      + " · 留守 " + formatted.format(retained), "muted"));
  }
  const current = era().officers.find(({ key }) => key === governor);
  const reasons = { capture: "攻占后可任命", staff: "待任官员不足", ended: "太守空缺" };
  const office = candidate ? "拟任太守 " + candidate.person.name : current ? "太守 " + current.name : reasons[staffBlocker];
  if (office) details.append(make("span", office, "muted"));
  if (!ended) {
    let timing = pending ? (progress.shortage ? "攻占当季暂停整顿" : "攻占当季暂停整顿，下季具备推进条件")
      : progress.remaining ? "预计季末整顿余 " + progress.remaining + " 季" : "预计本季末整顿完成";
    if (progress.shortage) timing += " · 缺驻军 " + formatted.format(progress.shortage) + " 人";
    if (aidBlocker) timing += " · " + reinforcementBlockers[aidBlocker];
    details.append(make("span", timing, "occupation-estimate"));
  }
  row.append(details);
  return row;
}

function renderTakeoverPlan() {
  const { source, rows, transfers, assignments, ended, grain, closingGrain, error } = takeoverPlan;
  const stale = source !== state || deciding;
  find("takeover-plan-summary").textContent = "拟排援军 " + transfers.length + " 道 · 拟补任 " + assignments.length + " 城"
    + " · 耗粮 " + formatted.format(grain) + " · 队列后余粮 " + formatted.format(closingGrain);
  const note = find("takeover-plan-note");
  note.textContent = stale ? "战局已有变化，请返回并重新打开预案。" : error ?? (ended ? "战局已结束。" : "");
  note.hidden = !note.textContent;
  find("confirm-takeover-plan").disabled = stale || Boolean(error) || (!transfers.length && !assignments.length);
  const size = innerHeight <= 580 ? 1 : innerHeight <= 730 || innerWidth < 400 ? 2 : 4;
  const items = pageOf(rows, "takeover-plan", size, renderTakeoverPlan).map((row) => takeoverRow(row, ended));
  find("takeover-plan-list").replaceChildren(...(items.length ? items : [make("li", "暂无需要补兵或补任太守的整顿城。", "muted")]));
}

function openTakeoverPlan() {
  const source = state;
  try {
    takeoverPlan = { source, ...planOccupationTakeover(world, state) };
  } catch (error) {
    takeoverPlan = { source, rows: [], transfers: [], assignments: [], grain: 0, closingGrain: planned.factions[state.player].grain, error: error.message };
  }
  pages["takeover-plan"] = 0;
  renderTakeoverPlan();
  find("takeover-plan-dialog").showModal();
}

function confirmTakeoverPlan() {
  const { source, transfers, assignments, error } = takeoverPlan;
  if (source !== state || deciding || (!transfers.length && !assignments.length) || error) {
    renderTakeoverPlan();
    return;
  }
  let next;
  try {
    next = applyOccupationTakeover(world, state, takeoverPlan);
  } catch (cause) {
    takeoverPlan.error = cause.message;
    renderTakeoverPlan();
    return;
  }
  find("takeover-plan-dialog").close();
  mutate(() => next);
  const count = find("holdings-count");
  const result = [];
  if (transfers.length) result.push("已排援军 " + transfers.length + " 道");
  if (assignments.length) result.push("已补任 " + assignments.length + " 名太守");
  count.textContent = result.join(" · ");
  count.focus();
}

function renderGarrisons() {
  const cities = frontierGarrisons(world, state, planned, garrisonTarget);
  const hostile = cities.filter((city) => city.hostile).length;
  const gaps = cities.filter(({ shortage }) => shortage > 0).length;
  find("garrisons-summary").textContent = "临敌 " + hostile + " 城 · 缺口 " + gaps + " 城 · 协定保护 " + (cities.length - hostile) + " 城";
  find("open-reinforcement-plan").disabled = deciding || !cities.some(({ aid }) => aid?.order);
  const size = innerHeight <= 470 ? 2 : innerHeight <= 680 ? 3 : 5;
  const rows = pageOf(cities, "garrisons", size, renderGarrisons).map(garrisonRow);
  find("garrisons-list").replaceChildren(...(rows.length ? rows : [make("li", "当前没有与其他势力接壤的己方城池。", "muted")]));
}

function garrisonRow({ key, hostile, current, projected, shortage, aid }) {
  const row = make("li");
  row.dataset.city = key;
  const name = cityName(world, key);
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  const status = shortage ? "差 " + formatted.format(shortage) + " 人" : hostile ? "已达目标" : "协定保护";
  heading.append(make("strong", name), make("span", status, shortage ? "occupation-estimate" : "muted"));
  details.append(heading, make("span", "当前 " + formatted.format(current) + " · 队列后 " + formatted.format(projected), "muted"));

  const action = make("button", aid?.order ? "拟调兵" : "定位", "quiet");
  action.type = "button";
  if (aid?.order) {
    const { order, onFront, hops, grain, retained } = aid;
    const source = cityName(world, order.from);
    const route = (order.route ?? [order.from, order.to]).map((city) => cityName(world, city)).join(" → ");
    const estimate = make("span", source + (order.troops < shortage ? "可先调 " : "调 ")
      + formatted.format(order.troops) + " · " + hops + " 段 · 粮 " + grain, "muted");
    estimate.title = route + " · " + (onFront ? "前线留守 " : "来源留守 ") + formatted.format(retained) + " 人";
    details.append(estimate);
    action.setAttribute("aria-label", "为" + name + "拟调援军");
    action.addEventListener("click", () => {
      find("garrisons-dialog").close();
      find("holdings-dialog").close();
      planFrontierOrder("reinforcement", order.from, order.to, order.troops);
    });
  } else {
    if (aid?.blocker) details.append(make("span", reinforcementBlockers[aid.blocker], "muted"));
    action.setAttribute("aria-label", "定位" + name);
    action.addEventListener("click", () => locateOnMap(key, "garrisons-dialog"));
  }
  row.append(details, action);
  return row;
}

function openGarrisons() {
  find("garrison-target").value = garrisonTarget;
  renderGarrisons();
  find("garrisons-dialog").showModal();
}

function reinforcementStepRow({ order, number, grain, retained, before, arrival, shortage }) {
  const row = make("li");
  row.dataset.city = order.to;
  const detail = make("div", undefined, "holding-detail");
  const route = (order.route ?? [order.from, order.to]).map((key) => cityName(world, key)).join(" → ");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", "第 " + number + " 令 · " + cityName(world, order.to)),
    make("span", "调 " + formatted.format(order.troops) + " 人 · 粮 " + formatted.format(grain), "muted"));
  const arrivalText = "到达 " + formatted.format(before) + " → " + formatted.format(arrival) + " 人"
    + (shortage ? " · 还差 " + formatted.format(shortage) : " · 达标");
  detail.append(heading, make("span", route, "muted"), make("span", "来源留守 " + formatted.format(retained) + " 人", "muted"),
    make("span", arrivalText, shortage ? "occupation-estimate" : "muted"));
  row.append(detail);
  return row;
}

function remainingReinforcementRow({ key, shortage, blocker }) {
  const row = make("li");
  row.dataset.city = key;
  const detail = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", cityName(world, key)), make("span", "还差 " + formatted.format(shortage) + " 人", "occupation-estimate"));
  detail.append(heading);
  if (blocker) detail.append(make("span", reinforcementBlockers[blocker], "muted"));
  row.append(detail);
  return row;
}

function renderReinforcementPlan() {
  const { source, target, steps, remaining, grain, closingGrain, error } = reinforcementPlan;
  const stale = source !== state || target !== garrisonTarget || deciding;
  const status = deciding ? "本季正在结算，请结算后重新拟定。" : stale ? "战局或目标已变化，请重新拟定。" : error;
  find("reinforcement-plan-error").hidden = !status;
  if (status) batchMessage("reinforcement-plan-error", status);
  find("refresh-reinforcement-plan").hidden = !status;
  find("refresh-reinforcement-plan").disabled = deciding || gameOutcome(state) !== "ongoing";
  find("confirm-reinforcement-plan").disabled = Boolean(status) || !steps.length;
  find("reinforcement-plan-summary").textContent = "目标 " + formatted.format(target) + " 人 · 拟追加 " + steps.length + " 道 · 耗粮 " + formatted.format(grain)
    + " · 队列后余粮 " + formatted.format(closingGrain);
  const showingSteps = reinforcementPane === "steps";
  for (const button of document.querySelectorAll("[data-reinforcement-pane]")) {
    const show = button.dataset.reinforcementPane === "steps";
    button.setAttribute("aria-pressed", String(show === showingSteps));
    button.textContent = show ? "拟定调兵 · " + steps.length : "剩余缺口 · " + remaining.length;
  }
  const size = showingSteps ? (innerHeight <= 520 ? 1 : innerHeight <= 670 ? 2 : 3)
    : (innerHeight <= 470 ? 2 : innerHeight <= 670 ? 3 : 5);
  const rows = pageOf(showingSteps ? steps : remaining, "reinforcement-plan", size, renderReinforcementPlan)
    .map(showingSteps ? reinforcementStepRow : remainingReinforcementRow);
  const empty = error ? "暂无可用预案。" : showingSteps ? "当前没有可追加的援军令。" : "前线缺口已补齐。";
  find("reinforcement-plan-list").replaceChildren(...(rows.length ? rows : [make("li", empty, "muted")]));
}

function refreshReinforcementPlan() {
  const source = state;
  const target = garrisonTarget;
  try {
    reinforcementPlan = { source, target, ...planFrontierReinforcements(world, state, target) };
  } catch (error) {
    reinforcementPlan = { source, target, steps: [], remaining: [], grain: 0, closingGrain: 0,
      error: error.message + " 请重新拟定。" };
  }
  reinforcementPane = "steps";
  pages["reinforcement-plan"] = 0;
  renderReinforcementPlan();
}

function openReinforcementPlan() {
  refreshReinforcementPlan();
  find("reinforcement-plan-dialog").showModal();
}

function applyReinforcementPlan() {
  const { source, target, steps, error } = reinforcementPlan;
  if (source !== state || target !== garrisonTarget || deciding || !steps.length || error) {
    renderReinforcementPlan();
    return;
  }
  try {
    const next = replaceOrders(world, state, [...state.orders, ...steps.map(({ order }) => order)]);
    find("reinforcement-plan-dialog").close();
    mutate(() => next);
    const summary = find("garrisons-summary");
    summary.textContent += " · 已追加 " + steps.length + " 道援军令";
    summary.focus();
  } catch (cause) {
    reinforcementPlan.error = cause.message + " 请重新拟定。";
    renderReinforcementPlan();
  }
}

function renderVacancies() {
  const { matching, available, ongoing } = nationalVacancies(world, state, planned, {
    role: find("vacancy-role").value,
    area: find("vacancy-area").value,
  });
  const status = find("vacancies-status");
  status.textContent = matching.length + " 个空缺 · " + (ongoing ? available + " 名可任用" : "战局已结束");
  const size = innerHeight <= 460 ? 3 : innerHeight <= 690 ? 4 : 6;
  const rows = pageOf(matching, "vacancies", size, renderVacancies).map((item) => vacancyRow(item, available, ongoing));
  find("vacancies-list").replaceChildren(...(rows.length ? rows : [make("li", "没有符合条件的职务空缺。", "muted")]));
}

function vacancyRow({ city, role, zone, recovering, accelerates, stationed, departing }, available, ongoing) {
  const row = make("li", undefined, "vacancy-row");
  row.dataset.city = city.key;
  row.dataset.role = role;
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  const location = zoneLabels[zone] + (recovering ? " · 整顿中" : "");
  heading.append(make("strong", city.name + " · " + labels[role]), make("span", location, "muted"));
  details.append(heading);
  if (accelerates && ongoing) details.append(make("span", "预计补任可加快整顿", "occupation-estimate"));
  if (ongoing) {
    const local = "本城待任 " + stationed + " 人" + (departing ? " · 已领出征令 " + departing + " 人" : "");
    details.append(make("span", local, "muted"));
  }
  const actions = make("div", undefined, "roster-actions");
  const locate = make("button", "定位", "quiet");
  locate.type = "button";
  locate.setAttribute("aria-label", "定位" + city.name);
  locate.addEventListener("click", () => locateOnMap(city.key, "vacancies-dialog"));
  actions.append(locate);
  if (ongoing) {
    const choose = make("button", "选人", "quiet");
    choose.type = "button";
    choose.disabled = !available;
    choose.setAttribute("aria-label", "为" + city.name + "选任" + labels[role]);
    choose.addEventListener("click", () => openRoster({ city: city.key, role, fromVacancies: true }));
    actions.append(choose);
  }
  row.append(details, actions);
  return row;
}

function openVacancies() {
  pages.vacancies = 0;
  renderVacancies();
  find("vacancies-dialog").showModal();
}

function plannedProgramLabel(program) {
  if (!program) return "本季暂无委任执行预估";
  if (program.project) return "预计执行" + focusLabels[program.project] + (program.adjustedForReserve ? "（按预留改选）" : "");
  return program.result === "completed" ? "预计执行" : programResults[program.result];
}

function renderDelegationPriority() {
  const prior = state.delegationPriority ?? [];
  const ongoing = gameOutcome(state) === "ongoing";
  const cities = world.cities.filter(({ key }) => state.cities[key].owner === state.player && state.cities[key].mode === "delegated");
  const baseline = ongoing ? forecastFinance(world, state).programs : [];
  const changed = prior.length !== priorityDraft.size || prior.some((key) => !priorityDraft.has(key));
  const proposed = ongoing && changed ? forecastFinance(world, setDelegationPriority(state, [...priorityDraft])).programs : baseline;
  const results = new Map(proposed.map((program) => [program.city, program]));
  const previous = new Map(baseline.map((program) => [program.city, program]));
  const count = (result) => proposed.filter((program) => program.result === result).length;
  find("priority-count").textContent = "重点城 " + priorityDraft.size + " / " + delegationPriorityLimit;
  find("priority-forecast").textContent = ongoing
    ? "预计执行 " + count("completed") + " / " + proposed.length + " 城 · 国库不足 " + count("treasury") + " · 储粮不足 " + count("grain")
    : "战局已结束。";
  find("priority-forecast").hidden = ongoing && cities.length === 0;
  find("clear-priority").disabled = !ongoing || priorityDraft.size === 0;
  find("confirm-priority").disabled = !ongoing || !changed;
  const size = innerHeight <= 430 ? 2 : innerHeight <= 480 ? 3 : innerHeight <= 680 ? 4 : 6;
  const rows = pageOf(cities, "priority", size, renderDelegationPriority).map(({ key, name }) => {
    const row = make("li");
    row.dataset.city = key;
    const check = make("input");
    check.type = "checkbox";
    check.id = "priority-city-" + key;
    check.setAttribute("aria-label", "优先受理" + name);
    check.checked = priorityDraft.has(key);
    check.disabled = !ongoing || (!check.checked && priorityDraft.size >= delegationPriorityLimit);
    check.addEventListener("change", () => {
      if (check.checked) priorityDraft.add(key);
      else priorityDraft.delete(key);
      find("priority-error").hidden = true;
      renderDelegationPriority();
      find(check.id).focus();
    });
    const details = make("div", undefined, "holding-detail");
    const heading = make("div", undefined, "holding-heading");
    heading.append(make("strong", name), make("span", focusLabels[state.cities[key].focus], "muted"));
    if (check.checked) heading.append(make("span", "重点", "priority-mark"));
    details.append(heading);
    if (ongoing) {
      const result = results.get(key);
      const original = previous.get(key);
      const changed = original?.result !== result?.result || original?.project !== result?.project
        || original?.adjustedForReserve !== result?.adjustedForReserve;
      const comparison = changed ? (original?.result === "completed" && !original.project
        ? " · 原预计可执行" : " · 原为" + plannedProgramLabel(original)) : "";
      const funding = programFundingStatus(result);
      details.append(make("span", plannedProgramLabel(result) + (funding ? " · " + funding : "") + comparison, "muted"));
    }
    const label = make("label");
    label.htmlFor = check.id;
    label.append(check, details);
    row.append(label);
    return row;
  });
  find("priority-list").replaceChildren(...(rows.length ? rows : [make("li", "暂无已委任的辖城。", "muted")]));
}

function openDelegationPriority() {
  priorityDraft.clear();
  for (const key of state.delegationPriority ?? []) priorityDraft.add(key);
  pages.priority = 0;
  find("priority-error").hidden = true;
  renderDelegationPriority();
  find("priority-dialog").showModal();
}

function renderRoster() {
  const targeted = Boolean(rosterTarget?.fromVacancies);
  const status = targeted ? "available" : find("roster-filter").value;
  const { matching, total } = nationalRoster(world, state, {
    query: find("roster-search").value,
    status,
    sort: find("roster-sort").value,
  });
  const ongoing = gameOutcome(state) === "ongoing";
  const heading = rosterTarget ? "为" + cityName(world, rosterTarget.city) + "补任" + labels[rosterTarget.role] : factionName(era(), state.player);
  find("roster-status").textContent = heading + " · " + matching.length + " / " + total + " 人"
    + (ongoing ? "" : " · 战局已结束");
  const size = status === "relocated" ? (innerHeight <= 460 ? 2 : innerHeight <= 690 ? 3 : 5)
    : innerHeight <= 440 ? 3 : innerHeight <= 690 ? 4 : 6;
  const rows = pageOf(matching, "roster", size, renderRoster).map(({ person, posting, expedition, army, office, station, stationName, available, relocation }) => {
    const row = make("li");
    row.dataset.officer = person.key;
    const details = make("div", undefined, "holding-detail");
    const heading = make("div", undefined, "holding-heading");
    const role = office ? realmOffices[office] + "官" : posting ? labels[posting.role] : available ? "待任" : "";
    const march = army ? "领军 · " + armyPhases[army.phase] : expedition ? "待出征至" + cityName(world, expedition.to) : "";
    heading.append(officerLink(person.key, "roster-dialog"), make("span", [role, march].filter(Boolean).join(" · "), "muted"));
    details.append(heading, make("span", (stationName || "无驻地") + " · 政务 " + person.governance + " · 统率 " + person.command, "muted"));
    if (relocation) {
      const before = cityName(world, relocation.entry.city);
      const after = relocation.destination ? cityName(world, relocation.destination) : "无驻地";
      details.append(make("span", seasonTitle(relocation.turn - 1) + " · " + before + " → " + after, "muted"));
    }
    row.append(details);

    const actions = make("div", undefined, "roster-actions");
    if (stationName) {
      const locate = make("button", "定位", "quiet");
      locate.type = "button";
      locate.setAttribute("aria-label", "定位" + person.name + "驻地" + stationName);
      locate.addEventListener("click", () => locateOnMap(station, "roster-dialog"));
      actions.append(locate);
    }
    if (ongoing && available) {
      const assign = make("button", "任用", "quiet");
      assign.type = "button";
      assign.setAttribute("aria-label", "任用" + person.name);
      assign.addEventListener("click", () => openPersonnelAssignment(person));
      actions.append(assign);
    }
    if (relocation) {
      const report = make("button", "战报", "quiet");
      report.type = "button";
      report.setAttribute("aria-label", "查看" + person.name + "的战后去向");
      report.addEventListener("click", () => {
        openBattleReport(relocation.entry, relocation.turn, "roster-dialog", person.key);
      });
      actions.append(report);
    }
    if (actions.children.length) row.append(actions);
    return row;
  });
  find("roster-list").replaceChildren(...(rows.length ? rows : [make("li", "没有符合条件的人员。", "muted")]));
}

function assignmentDescription(person, role, city) {
  if (role === "station") return "将" + person.name + "调驻" + cityName(world, city);
  return "任命" + person.name + "为" + cityName(world, city) + labels[role];
}

function renderAssignmentPreview() {
  const { value: role, disabled } = find("assignment-role");
  const city = find("assignment-city").value;
  const preview = find("assignment-preview");
  preview.dataset.error = "false";
  if (disabled) preview.textContent = "当前没有可调驻的城池或可任用的空缺。";
  else preview.textContent = city ? assignmentDescription(personnelCandidate, role, city) + "。" : "请选择目标城池。";
  const confirm = find("confirm-assignment");
  confirm.textContent = disabled ? "确认任用" : role === "station" ? "确认调驻" : "确认任命";
  confirm.disabled = !city || disabled;
}

function renderAssignmentCities(previous = "") {
  const role = find("assignment-role").value;
  const select = find("assignment-city");
  const cities = personnelDestinations(world, state, personnelCandidate.key, role);
  const station = role === "station" ? "" : state.stations[personnelCandidate.key];
  const preferred = [previous, station, selected].find((key) => cities.some((city) => city.key === key));
  select.replaceChildren(new Option(cities.length ? "请选择" : "无可用城池", ""), ...cities.map(({ name, key }) => new Option(name, key)));
  select.disabled = !cities.length;
  select.value = preferred || "";
  renderAssignmentPreview();
}

function openPersonnelAssignment(person) {
  personnelCandidate = person;
  const station = state.stations[person.key];
  find("assignment-title").textContent = "任用" + person.name;
  find("assignment-back").textContent = find("person-dialog").open ? "返回档案" : "返回名册";
  find("assignment-person").textContent = (station ? cityName(world, station) : "无驻地") + " · 政务 " + person.governance + " · 统率 " + person.command;
  const role = find("assignment-role");
  for (const option of role.options) option.disabled = !personnelDestinations(world, state, person.key, option.value).length;
  const first = [...role.options].find((option) => !option.disabled);
  const target = find("roster-dialog").open ? rosterTarget : null;
  const locked = Boolean(target?.fromVacancies);
  const canFill = target && personnelDestinations(world, state, person.key, target.role).some(({ key }) => key === target.city);
  find("assignment-fields").hidden = locked;
  role.disabled = locked ? !canFill : !first;
  role.value = locked || canFill ? target.role : first?.value || "";
  renderAssignmentCities(canFill ? target.city : "");
  find("assignment-dialog").showModal();
}

function openReassignment(officer) {
  const options = reassignmentOptions(world, state, officer);
  if (!options) return;
  postingAdjustment = { officer, from: options.posting };
  find("reassignment-current").textContent = options.person.name + " · " + postingLabel(options.posting);
  const select = find("reassignment-target");
  select.replaceChildren(new Option("请选择", ""), new Option("卸任，留驻原城", "release"));
  for (const [role, cities] of [["governor", options.governors], ["commander", options.commanders]]) {
    if (!cities.length) continue;
    const group = make("optgroup");
    group.label = labels[role] + "空缺";
    group.append(...cities.map(({ key, name }) => new Option(name + " · " + labels[role], role + ":" + key)));
    select.append(group);
  }
  const impact = find("reassignment-impact");
  impact.textContent = options.endsDelegation ? cityName(world, options.posting.city) + "将改为直辖，停止执行委任。" : "";
  if (options.removesPriority) impact.textContent += "该城将移出委任优先级。";
  renderReassignmentPreview();
  find("reassignment-dialog").showModal();
}

function reassignmentDestination(value) {
  if (value === "release") return null;
  const [role, city] = value.split(":");
  return { city, role };
}

function describeReassignment(from, to) {
  if (!to) return "卸任" + labels[from.role] + "，留驻" + cityName(world, from.city) + "待任。";
  return postingChangeVerb(from, to) + cityName(world, to.city) + labels[to.role] + "。";
}

function renderReassignmentPreview() {
  const value = find("reassignment-target").value;
  const to = value ? reassignmentDestination(value) : null;
  const preview = find("reassignment-preview");
  preview.dataset.error = "false";
  preview.textContent = value ? describeReassignment(postingAdjustment.from, to) : "";
  preview.hidden = !value;
  const impact = find("reassignment-impact");
  impact.hidden = !value || !impact.textContent;
  const confirm = find("confirm-reassignment");
  confirm.textContent = value ? "确认" + (to ? postingChangeVerb(postingAdjustment.from, to) : "卸任") : "确认调整";
  confirm.disabled = !value;
}

function applyReassignment(event) {
  event.preventDefault();
  const value = find("reassignment-target").value;
  if (!value) return;
  const { officer, from } = postingAdjustment;
  const to = reassignmentDestination(value);
  try {
    const next = reassignOfficer(world, state, officer, from, to);
    find("reassignment-dialog").close();
    mutate(() => next);
    const feedback = find("person-feedback");
    feedback.textContent = "已" + describeReassignment(from, to);
    feedback.hidden = false;
    feedback.focus();
  } catch (error) {
    const preview = find("reassignment-preview");
    preview.textContent = error.message;
    preview.dataset.error = "true";
    preview.hidden = false;
  }
}

function openRoster(target) {
  if (target) {
    find("roster-search").value = "";
    if (!target.fromVacancies) find("roster-filter").value = "available";
    find("roster-sort").value = target.role === "commander" ? "command" : "governance";
    pages.roster = 0;
  }
  rosterTarget = target;
  find("roster-filter-field").hidden = Boolean(target?.fromVacancies);
  find("roster-close").textContent = target?.fromVacancies ? "返回空缺" : "关闭";
  renderRoster();
  find("roster-dialog").showModal();
}

function showFinanceRows(ledger) {
  const amount = (number, signed, negative = false) => number
    ? (negative ? "−" : signed ? "+" : "") + formatted.format(number)
    : "0";
  const { opening, tax, trade, gifts, orders, delegation, closing, armyReturns, realm, politics, grand } = ledger;
  const incoming = (key) => (politics?.in[key] ?? 0) + (grand?.in[key] ?? 0);
  const outgoing = (key) => (politics?.budget[key] ?? 0) + (politics?.out[key] ?? 0) + (grand?.budget[key] ?? 0) + (grand?.out[key] ?? 0);
  const rows = [
    ["期初结存", opening, false],
    [incoming("treasury") || incoming("grain") ? "税粮、援粮及交割" : realm?.aidIn ? "税粮及援粮" : armyReturns ? "税粮及随军归粮" : "城池税粮",
      { treasury: tax.treasury + incoming("treasury"), grain: tax.grain + (armyReturns ?? 0) + (realm?.aidIn ?? 0) + incoming("grain") }, true],
    [realm?.commerce ? "同盟及商路" : "同盟商贸", { treasury: trade + (realm?.commerce ?? 0) }, true],
    ["礼金收入", { treasury: gifts.received }, true],
    ["礼金支出", { treasury: gifts.paid }, false, true],
    [outgoing("treasury") || outgoing("grain") ? "政令及国政拨支"
      : realm?.aidOut || realm?.relief.treasury ? "政令、粮援及救济" : "国家政令",
      { treasury: orders.treasury + (realm?.relief.treasury ?? 0) + outgoing("treasury"),
        grain: orders.grain + (realm?.aidOut ?? 0) + (realm?.relief.grain ?? 0) + outgoing("grain") }, false, true],
    ["委任支出", delegation, false, true],
    ["期末结存", closing, false],
  ].map(([label, balance, signed, negative]) => {
    const row = make("tr");
    const heading = make("th", label);
    heading.scope = "row";
    row.append(heading, make("td", amount(balance.treasury, signed, negative)),
      make("td", balance.grain === undefined ? "—" : amount(balance.grain, signed, negative)));
    return row;
  });
  find("finance-lines").replaceChildren(...rows);
}

function showProgramResults(programs, focusCity) {
  const actual = financeMode === "actual";
  const { filter, reasons, matching } = filterDelegationPrograms(programs, financeProgramFilter);
  financeProgramFilter = filter;
  const picker = find("finance-program-filter");
  picker.replaceChildren(new Option("全部", "all"), new Option(actual ? "已执行" : "预计执行", "completed"),
    new Option("未执行", "unexecuted"), ...reasons.map((reason) => new Option(programResults[reason], reason)));
  picker.value = filter;
  picker.parentElement.hidden = !programs.length;
  const completed = programs.filter(({ result }) => result === "completed").length;
  let count = "本季没有委任任务。";
  if (programs.length) {
    count = filter === "all" ? (actual ? "已执行 " : "预计执行 ") + completed + " / " + programs.length + " 城"
      : "匹配 " + matching.length + " / " + programs.length + " 城";
  }
  find("finance-program-count").textContent = count;
  const compact = innerHeight <= 470 || (innerWidth < 420 && innerHeight <= 600);
  const shortArchive = actual && innerWidth < 400 && innerHeight <= 460;
  const size = shortArchive ? 1 : compact ? 2 : innerHeight <= 650 ? 4 : 6;
  if (focusCity) {
    const index = matching.findIndex(({ city }) => city === focusCity);
    if (index >= 0) pages.finance = Math.floor(index / size);
  }
  const items = pageOf(matching, "finance", size, renderFinance).map((program) => {
    const { city, focus, project, spent, result, priority, adjustedForReserve } = program;
    const row = make("li");
    row.dataset.city = city;
    row.dataset.programResult = result;
    const title = cityName(world, city);
    const subject = make("div", undefined, "holding-detail");
    const label = result === "completed" && !actual ? "预计执行" : programResults[result];
    const outcome = result === "completed"
      ? (adjustedForReserve ? "按预留改选 · " : "") + "支出 " + spent.treasury + " 钱" + (spent.grain ? " · " + spent.grain + " 粮" : "")
      : programFundingStatus(program);
    const heading = make("div", undefined, "holding-heading");
    const direction = focusLabels[focus] + (project ? " → " + focusLabels[project] : "");
    heading.append(make("strong", title), make("span", direction + " · " + label, "muted"));
    if (priority) heading.append(make("span", "重点", "priority-mark"));
    subject.append(heading);
    if (outcome) subject.append(make("span", outcome, "muted"));
    const view = make("button", "查看", "quiet");
    view.type = "button";
    view.setAttribute("aria-label", "查看" + title);
    view.addEventListener("click", () => {
      find("finance-dialog").close();
      selectCity(city, true);
      selectTab("governance", true);
    });
    const actions = make("div", undefined, "report-actions finance-program-actions");
    actions.append(view, reportLocateButton(city, "finance-dialog"));
    row.append(subject, actions);
    return row;
  });
  const visible = programs.length && !items.length ? [make("li", "没有符合该筛选的城池。", "muted")] : items;
  find("finance-program-list").replaceChildren(...visible);
}

function renderFinance(focusCity) {
  const actual = financeMode === "actual";
  const select = find("finance-turn");
  const previous = select.value;
  const archive = [...state.history].reverse().filter((report) => report.finance);
  select.replaceChildren(...archive.map(({ turn }) => new Option(seasonTitle(turn - 1), turn)));
  if (archive.some(({ turn }) => String(turn) === previous)) select.value = previous;
  find("finance-turn-wrap").hidden = !actual || archive.length === 0;
  const finished = gameOutcome(state) !== "ongoing";
  find("finance-dialog").querySelector('[data-finance-mode="forecast"]').disabled = finished;
  find("open-delegation-reserve").disabled = finished || deciding;
  const ledger = actual ? archive.find(({ turn }) => String(turn) === select.value)?.finance
    : finished ? null : forecastFinance(world, state);
  find("finance-note").textContent = actual ? ledger ? "按季末结算记录。" : "暂无财政实账。新版结算后会在此记录。"
    : "根据当前队列与协定预估，实际战况会影响结算。";
  if (ledger?.reserve) find("finance-note").textContent += " 委任预留 " + formatResources(ledger.reserve) + "。";
  if (ledger?.armyReturns) find("finance-note").textContent += " 含随军归粮 " + formatted.format(ledger.armyReturns) + "。";
  find("finance-view-controls").hidden = !ledger;
  find("open-realm-ledger").hidden = !ledger?.realm || financeView !== "ledger";
  find("finance-ledger").hidden = !ledger || financeView !== "ledger";
  find("finance-programs").hidden = !ledger || financeView !== "programs";
  find("open-budget-top-up").hidden = actual || deciding || financeView !== "programs" || !ledger
    || !delegationBudgetAdjustments(state, ledger.programs).length;
  if (!ledger) return;
  if (financeView === "ledger") showFinanceRows(ledger);
  else showProgramResults(ledger.programs, focusCity);
}

function selectFinance(mode, view, focusCity) {
  financeMode = mode;
  financeView = view;
  if (focusCity) financeProgramFilter = "all";
  pages.finance = 0;
  for (const button of document.querySelectorAll("[data-finance-mode], [data-finance-view]")) {
    const selected = button.dataset.financeMode === mode || button.dataset.financeView === view;
    button.setAttribute("aria-pressed", String(selected));
  }
  renderFinance(focusCity);
}

function financeTrendValue(point) {
  return financeTrendView === "delegation" ? point.delegation?.cities : point.closing?.[financeTrendView];
}

function renderQuarterDelegation(delegation) {
  find("finance-trend-projects").textContent = Object.entries(delegation.projects)
    .map(([project, count]) => focusLabels[project] + " " + count + " 城").join(" · ");
  find("finance-trend-delegation-spent").textContent = "委任支出 " + formatResources(delegation.spent);
  const unexecuted = find("finance-trend-unexecuted");
  const links = delegation.unexecuted.map(([reason, count]) => {
    const label = programResults[reason];
    const link = make("button", label + " " + count + " 城", "quiet");
    link.type = "button";
    link.dataset.reason = reason;
    link.setAttribute("aria-label", "筛选" + label);
    link.addEventListener("click", () => openFinanceTrendLedger(reason));
    return link;
  });
  unexecuted.replaceChildren(...links);
  unexecuted.hidden = !delegation.unexecuted.length;
}

function selectFinanceTrendTurn(turn) {
  financeTrendTurn = turn;
  const point = quarterlyFinance(state.history).find((entry) => entry.turn === turn);
  const delegationView = financeTrendView === "delegation";
  for (const button of find("finance-trend-series").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.turn) === turn));
  }
  const detail = find("finance-trend-detail");
  const view = find("finance-trend-open-ledger");
  const breakdown = find("finance-trend-delegation");
  breakdown.hidden = true;
  view.hidden = !point || financeTrendValue(point) === undefined;
  view.textContent = delegationView ? "查看委任明细" : "查看本季实账";
  if (!point) {
    detail.textContent = "暂无已结算的季度可查看。";
    return;
  }
  const date = seasonTitle(turn - 1);
  if (view.hidden) {
    detail.textContent = date + " · 缺少财政实账。";
  } else if (delegationView) {
    const { delegation } = point;
    detail.textContent = date + (delegation.cities ? " · 委任 " + delegation.cities + " 城 · 执行 " + delegation.completed + " 城" : " · 本季无委任记录。");
    if (delegation.cities) {
      renderQuarterDelegation(delegation);
      breakdown.hidden = false;
    }
  } else {
    const unit = financeTrendView === "treasury" ? " 钱" : " 粮";
    detail.textContent = date + " · 季末余 " + formatted.format(point.closing[financeTrendView]) + unit
      + " · 较开账 " + signed(point.net[financeTrendView]) + unit;
  }
}

function renderFinanceTrend() {
  const points = quarterlyFinance(state.history);
  const resource = financeTrendView;
  const delegationView = resource === "delegation";
  const range = find("finance-trend-range");
  const series = find("finance-trend-series");
  find("finance-trend-controls").hidden = !points.length;
  range.hidden = series.hidden = !points.length;
  for (const button of document.querySelectorAll("[data-finance-trend]")) {
    button.setAttribute("aria-pressed", String(button.dataset.financeTrend === resource));
  }
  const last = points.at(-1)?.turn;
  if (points.length) {
    const first = points[0].turn;
    range.textContent = seasonTitle(first - 1) + (first === last ? "" : " 至 " + seasonTitle(last - 1))
      + (points.some((point) => financeTrendValue(point) === undefined) ? " · 虚线框表示缺实账" : "")
      + (delegationView ? " · 柱高为委任城数，亮色为执行" : "");
  }
  series.dataset.resource = resource;
  series.setAttribute("aria-label", delegationView ? "按季度查看委任成效" : "按季度查看季末结余");
  series.style.setProperty("--trend-count", points.length);
  const maximum = Math.max(1, ...points.map((point) => financeTrendValue(point) ?? 0));
  const rows = points.map((point) => {
    const { turn, delegation } = point;
    const row = make("li");
    const button = make("button");
    button.type = "button";
    button.dataset.turn = String(turn);
    const track = make("span", undefined, "finance-trend-track");
    const bar = make("span", undefined, "finance-trend-bar");
    const value = financeTrendValue(point);
    let description = "缺少财政实账";
    if (value === undefined) row.dataset.missing = "";
    else {
      bar.style.height = (value / maximum * 100) + "%";
      description = delegationView ? "委任 " + value + " 城 · 执行 " + delegation.completed + " 城"
        : "季末余 " + formatted.format(value) + (resource === "treasury" ? " 钱" : " 粮");
      if (delegationView && delegation.completed) {
        const completed = make("span", undefined, "finance-trend-completed");
        completed.style.height = (delegation.completed / value * 100) + "%";
        bar.append(completed);
      }
    }
    track.setAttribute("aria-hidden", "true");
    track.append(bar);
    button.title = seasonTitle(turn - 1) + " · " + description;
    button.setAttribute("aria-label", button.title);
    button.append(track, make("span", seasons[(turn - 1) % seasons.length]));
    button.addEventListener("click", () => selectFinanceTrendTurn(turn));
    row.append(button);
    return row;
  });
  series.replaceChildren(...rows);
  selectFinanceTrendTurn(points.some(({ turn }) => turn === financeTrendTurn) ? financeTrendTurn : last);
}

function openFinanceTrend() {
  financeTrendView = financeMode === "actual" && financeView === "programs" ? "delegation" : "treasury";
  financeTrendTurn = financeMode === "actual" ? Number(find("finance-turn").value) : undefined;
  renderFinanceTrend();
  find("finance-trend-dialog").showModal();
}

function openFinanceTrendLedger(filter = "all") {
  const point = quarterlyFinance(state.history).find(({ turn }) => turn === financeTrendTurn);
  if (!point || financeTrendValue(point) === undefined) return;
  const select = find("finance-turn");
  select.value = String(financeTrendTurn);
  const delegation = financeTrendView === "delegation";
  if (delegation) financeProgramFilter = filter;
  selectFinance("actual", delegation ? "programs" : "ledger");
  find("finance-trend-dialog").close();
  (filter === "all" ? select : find("finance-program-filter")).focus();
}

function resetReservePreview() {
  reserveForecast = undefined;
  find("reserve-preview").hidden = true;
  find("reserve-error").hidden = true;
  find("apply-reserve").disabled = true;
}

function openDelegationReserve() {
  if (deciding || gameOutcome(state) !== "ongoing") return;
  find("reserve-treasury").value = state.delegationReserve?.treasury ?? 0;
  find("reserve-grain").value = state.delegationReserve?.grain ?? 0;
  resetReservePreview();
  find("reserve-dialog").showModal();
}

function renderReservePreview() {
  const { closing, changes } = reserveForecast;
  find("reserve-summary").textContent = "预计季末余 " + formatResources(closing) + " · " + changes.length + " 城的委任预估有变化";
  const size = innerHeight <= 470 ? 1 : innerHeight <= 690 ? 3 : 5;
  const rows = pageOf(changes, "reserve", size, renderReservePreview).map(({ previous, program }) => {
    const row = make("li");
    row.dataset.city = program.city;
    const details = make("div", undefined, "holding-detail");
    const heading = make("div", undefined, "holding-heading");
    heading.append(make("strong", cityName(world, program.city)), make("span", focusLabels[program.focus], "muted"));
    details.append(heading, make("span", plannedProgramLabel(previous) + " → " + plannedProgramLabel(program), "muted"));
    const funding = programFundingStatus(program);
    if (funding) details.append(make("span", funding, "muted"));
    row.append(details);
    return row;
  });
  find("reserve-changes").replaceChildren(...rows);
  find("reserve-preview").hidden = false;
}

function reserveValues() {
  return { treasury: find("reserve-treasury").valueAsNumber, grain: find("reserve-grain").valueAsNumber };
}

function previewDelegationReserve(event) {
  event.preventDefault();
  resetReservePreview();
  try {
    const reserve = reserveValues();
    reserveForecast = { ...forecastDelegationReserve(world, state, reserve), reserve, state };
    pages.reserve = 0;
    renderReservePreview();
    find("apply-reserve").disabled = reserve.treasury === (state.delegationReserve?.treasury ?? 0)
      && reserve.grain === (state.delegationReserve?.grain ?? 0);
  } catch (error) {
    batchMessage("reserve-error", error.message);
  }
}

function applyDelegationReserve() {
  if (find("apply-reserve").disabled || !reserveForecast) return;
  const reserve = reserveValues();
  if (deciding || reserveForecast.state !== state || reserve.treasury !== reserveForecast.reserve.treasury
    || reserve.grain !== reserveForecast.reserve.grain) {
    resetReservePreview();
    batchMessage("reserve-error", "当前设置或战局已变化，请重新预演。");
    return;
  }
  try {
    const next = setDelegationReserve(state, reserve);
    find("reserve-dialog").close();
    resetReservePreview();
    mutate(() => next, next.delegationReserve ? "已保存委任钱粮预留。" : "已清空委任钱粮预留。");
  } catch (error) {
    batchMessage("reserve-error", error.message);
  }
}

function budgetTopUpRow({ city, previous, budget, program }) {
  const key = city ?? program.city;
  const row = make("li");
  row.dataset.city = key;
  row.dataset.result = program?.result ?? "";
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", cityName(world, key)));
  if (program) heading.append(make("span", focusLabels[program.focus], "muted"));
  details.append(heading);
  const after = program?.action ?? plannedProgramLabel(program);
  if (city) {
    details.append(make("span", "每城预算 " + previous + " → " + budget + " 钱", "muted"),
      make("span", after, "occupation-estimate"));
  } else {
    const before = previous?.action ?? plannedProgramLabel(previous);
    details.append(make("span", before + " → " + after, "occupation-estimate"));
  }
  const funding = programFundingStatus(program);
  if (funding) {
    const before = city ? "" : programFundingStatus(previous);
    details.append(make("span", before && before !== funding ? before + " → " + funding : funding, "muted"));
  }
  row.append(details);
  return row;
}

function renderBudgetTopUp() {
  const { source, adjustments, effects, previousClosing, closing, error } = budgetForecast;
  const stale = source !== state || deciding || financeMode !== "forecast";
  const note = find("budget-top-up-note");
  note.textContent = stale ? "战局或查看方式已变化，请返回并重新打开预案。" : error ?? "";
  note.hidden = !note.textContent;
  find("confirm-budget-top-up").disabled = stale || Boolean(error) || !adjustments.length;
  find("budget-top-up-balance").textContent = "拟补足 " + adjustments.length + " 城 · 另影响 " + effects.length
    + " 城 · 预计季末余 " + formatResources(previousClosing) + " → " + formatResources(closing);
  for (const button of document.querySelectorAll("[data-budget-top-up]")) {
    button.setAttribute("aria-pressed", String(button.dataset.budgetTopUp === budgetTopUpPane));
  }
  const size = innerHeight <= 500 ? 1 : innerHeight <= 690 || innerWidth < 420 ? 2 : 4;
  const showingAdjustments = budgetTopUpPane === "adjustments";
  const rows = pageOf(showingAdjustments ? adjustments : effects, "budget-top-up", size, renderBudgetTopUp).map(budgetTopUpRow);
  const empty = showingAdjustments ? "暂无可补足预算的城池。" : "暂无其他受影响的城池。";
  find("budget-top-up-list").replaceChildren(...(rows.length ? rows : [make("li", empty, "muted")]));
}

function openBudgetTopUp() {
  if (deciding || financeMode !== "forecast" || gameOutcome(state) !== "ongoing") return;
  const source = state;
  try {
    budgetForecast = { source, ...forecastDelegationBudgets(world, state) };
  } catch (error) {
    const balance = state.factions[state.player];
    budgetForecast = { source, adjustments: [], effects: [], previousClosing: balance, closing: balance, error: error.message };
  }
  budgetTopUpPane = "adjustments";
  pages["budget-top-up"] = 0;
  renderBudgetTopUp();
  find("budget-top-up-dialog").showModal();
}

function confirmBudgetTopUp() {
  const { source, adjustments, error } = budgetForecast;
  if (source !== state || deciding || financeMode !== "forecast" || !adjustments.length || error) {
    renderBudgetTopUp();
    return;
  }
  let next;
  try {
    next = applyDelegationBudgetAdjustments(state, adjustments);
  } catch (cause) {
    budgetForecast.error = cause.message;
    renderBudgetTopUp();
    return;
  }
  find("budget-top-up-dialog").close();
  mutate(() => next);
  const status = find("finance-program-count");
  status.textContent = "已补足 " + adjustments.length + " 城预算";
  status.focus();
}

function locateOnMap(key, dialog) {
  find(dialog).close();
  if (dialog === "stage-detail-dialog") closeStageParents();
  if (dialog === "chronicle") find("opponent-brief-dialog").close();
  if (dialog === "garrisons-dialog") find("holdings-dialog").close();
  if (dialog === "defense-pressure-dialog") find("frontier-dialog").close();
  if (dialog === "vacancies-dialog" || (dialog === "roster-dialog" && find("vacancies-dialog").open)) {
    find("vacancies-dialog").close();
    find("holdings-dialog").close();
  }
  selectCity(key);
  selectTab("governance");
  showView("map");
  map.locate(key);
}

function planFrontierOrder(tab, from, to, troops, officer) {
  if (find("frontier-dialog").open) find("frontier-dialog").close();
  selectCity(from, true);
  if (tab === "expedition") {
    attackDraft = { ...attackDraft, from, to, troops, officer };
    renderAttack();
  } else {
    transferDraft = { ...transferDraft, from, to, troops };
    renderTransfer();
  }
  selectTab(tab, true);
}

function selectFrontierTab(tab) {
  frontierTab = tab;
  pages.frontier = 0;
  for (const button of document.querySelectorAll("[data-frontier-tab]")) {
    button.setAttribute("aria-pressed", String(button.dataset.frontierTab === tab));
  }
}

function renderFrontier(preferred = find("frontier-city").value) {
  const cities = frontierCities(world, planned);
  const picker = find("frontier-city");
  picker.replaceChildren(...cities.map(({ key, exposed }) => new Option(cityName(world, key) + (exposed ? "" : " · 约定保护"), key)));
  if (cities.some(({ key }) => key === preferred)) picker.value = preferred;
  find("frontier-controls").hidden = !cities.length;
  find("frontier-switch").hidden = !cities.length;
  const intel = frontierIntel(world, militaryView(planned), picker.value, { includeRemote: frontierTab === "donors" });
  const summary = find("frontier-summary");
  const commanderName = (key) => era().officers.find((officer) => officer.key === key)?.name ?? "空缺";
  summary.textContent = intel
    ? "本城驻军 " + formatted.format(intel.troops) + " · 城防 " + intel.defense + " 级"
      + " · 守将 " + commanderName(intel.commander)
      + (state.orders.length ? " · 按队列估算" : "")
    : "当前没有与其他势力接壤的己方城池。";
  const rows = intel ? intel[frontierTab] : [];
  const opponents = frontierTab === "opponents";
  const actionOpen = gameOutcome(state) === "ongoing" && state.orders.length < seasonOrderLimit;
  const jointState = jointSituation(world, militaryView(state), militaryView(planned));
  const joint = find("frontier-joint");
  joint.disabled = !jointState.origins.length;
  const jointHint = find("frontier-joint-hint");
  jointHint.hidden = !intel || !joint.disabled;
  jointHint.textContent = jointState.reason;
  const canAttack = intel && intel.troops - cityReserve >= minimumMarch
    && planned.factions[state.player].grain * 100 >= minimumMarch
    && availableAttackers(era(), planned, state.player, intel.key).some(({ key }) => !pendingExpedition(state, key));
  const size = innerHeight <= 520 ? 2 : innerHeight <= 650 ? 4 : 5;
  const items = pageOf(rows, "frontier", size, renderFrontier).map((entry) => {
    const row = make("li");
    const detail = make("div", undefined, "holding-detail");
    const title = cityName(world, entry.key);
    const status = opponents
      ? factionName(era(), entry.owner) + (entry.treaty ? " · " + treatyTerms[entry.treaty.kind].name + "余 " + (entry.treaty.expires - state.turn) + " 季" : "")
      : (entry.exposed ? "前线援军" : "后方援军") + (entry.hops > 1 ? " · " + entry.hops + " 段" : "");
    const comparison = !opponents ? "" : entry.difference === 0 ? "兵力持平"
      : "比本城" + (entry.difference > 0 ? "多 " : "少 ") + formatted.format(Math.abs(entry.difference));
    const detailText = opponents
      ? (state.war ? "驻军 " + intelSummary(state, state.player, entry.key) + " · 防 " + intelSummary(state, state.player, entry.key, "defense")
        : "驻军 " + formatted.format(entry.troops) + " · 防 " + entry.defense + " · " + comparison)
      : "驻军 " + formatted.format(entry.troops) + " · 可调 " + formatted.format(entry.available);
    const heading = make("div", undefined, "holding-heading");
    heading.append(make("strong", title), make("span", status, "muted"));
    detail.append(heading, make("span", detailText, "muted"));
    if (opponents) detail.append(make("span", state.war ? intelLabels[townIntel(state, state.player, entry.key).source] : "守将 " + commanderName(entry.commander), "muted"));
    row.append(detail);

    const actions = make("div", undefined, "frontier-actions");
    const locate = make("button", "定位", "quiet");
    locate.type = "button";
    locate.setAttribute("aria-label", "定位" + title);
    locate.addEventListener("click", () => locateOnMap(entry.key, "frontier-dialog"));
    actions.append(locate);
    if (actionOpen && (opponents ? !entry.treaty && canAttack : entry.available > 0)) {
      const order = make("button", opponents ? "拟出征" : "拟调兵");
      order.type = "button";
      order.addEventListener("click", () => opponents
        ? planFrontierOrder("expedition", intel.key, entry.key)
        : planFrontierOrder("reinforcement", entry.key, intel.key, Math.min(600, entry.available)));
      actions.append(order);
    }
    row.append(actions);
    return row;
  });
  const empty = opponents ? "没有相邻的外势力城池。" : "没有三段道路内的己方援军城池。";
  find("frontier-list").replaceChildren(...(items.length ? items : intel ? [make("li", empty, "muted")] : []));
}

function openFrontier() {
  selectFrontierTab("opponents");
  renderFrontier(selected);
  find("frontier-dialog").showModal();
}

function attackOpportunityRow({ order, officer, owner, forecast, retained }) {
  const row = make("li");
  row.dataset.city = order.to;
  const name = cityName(world, order.to);
  const detail = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  heading.append(make("strong", name), make("span", factionName(era(), owner), "muted"));
  const march = cityName(world, order.from) + " · " + officer.name + "领 " + formatted.format(order.troops) + " 人";
  const estimates = "战力 " + formatted.format(forecast.offense) + " 对 " + formatted.format(forecast.defense)
    + " · 粮 " + formatted.format(forecast.grain);
  detail.append(heading, make("span", march, "muted"), make("span", estimates, "occupation-estimate"),
    make("span", "来源留守 " + formatted.format(retained) + " 人", "muted"));
  const action = make("button", "拟出征", "quiet");
  action.type = "button";
  action.setAttribute("aria-label", "拟定出征" + name);
  action.addEventListener("click", () => {
    find("attack-opportunities-dialog").close();
    if (attackOpportunityFaction) find("opponent-brief-dialog").close();
    planFrontierOrder("expedition", order.from, order.to, order.troops, order.officer);
  });
  row.append(detail, action);
  return row;
}

function expeditionBlockerMessage(blocker, faction) {
  const messages = { ended: "战局已结束。", queue: "政令队列已满。撤回一道政令后可重新查看。",
    grain: "队列后储粮不足，暂无可拟定的出征令。",
    none: faction ? "当前没有对该势力预计占优且可入队的出征机会。" : "当前没有按队列预估占优且可入队的出征机会。",
    eliminated: "该势力已无辖城。", "projected-loss": "按当前队列预估，该势力将失去全部辖城。" };
  if (blocker === "treaty") {
    const treaty = treatyWith(planned, state.player, faction);
    return treatyTerms[treaty.kind].name + "余 " + (treaty.expires - planned.turn) + " 季，期间互不进攻。";
  }
  return messages[blocker];
}

function renderAttackOpportunities() {
  const faction = attackOpportunityFaction;
  const { entries, blocker } = frontierAttackOpportunities(world, militaryView(state), militaryView(planned), { faction });
  const name = faction ? factionName(era(), faction) : "";
  find("attack-opportunities-title").textContent = name ? name + " · 出征机会" : "出征机会";
  find("attack-opportunities-back").textContent = faction ? "返回辖城" : "返回前线";
  find("attack-opportunities-status").textContent = blocker ? expeditionBlockerMessage(blocker, faction) : "队列后预计占优 " + entries.length + " 城 · 按所需兵力排序";
  find("attack-opportunities-rule").hidden = Boolean(blocker);
  find("open-expedition-plan").hidden = !entries.length;
  const size = innerHeight <= 480 ? 2 : innerHeight <= 680 ? 3 : 5;
  const rows = pageOf(entries, "attack-opportunities", size, renderAttackOpportunities).map(attackOpportunityRow);
  find("attack-opportunities-list").replaceChildren(...rows);
}

function openAttackOpportunities(faction) {
  if (attackOpportunityFaction !== faction) pages["attack-opportunities"] = 0;
  attackOpportunityFaction = faction;
  renderAttackOpportunities();
  find("attack-opportunities-dialog").showModal();
}

function expeditionPlanRow({ order, officer, forecast, retained, number }) {
  const row = make("li");
  row.dataset.city = order.to;
  const detail = make("div", undefined, "holding-detail");
  detail.append(make("strong", "第 " + number + " 令 · " + cityName(world, order.from) + " → " + cityName(world, order.to)),
    make("span", officer.name + "领 " + formatted.format(order.troops) + " 人 · 耗粮 " + formatted.format(forecast.grain), "muted"),
    make("span", "本令后来源留守 " + formatted.format(retained) + " 人", "muted"));
  row.append(detail);
  return row;
}

function renderExpeditionPlan() {
  const { source, faction, limit, steps, blocker, grain, closingGrain, error } = expeditionPlan;
  const stale = source !== state || faction !== attackOpportunityFaction || deciding;
  const note = find("expedition-plan-note");
  let message = error;
  if (!message && blocker) {
    const partial = { none: "余下位置暂无可追加的出征令。", "projected-loss": "按预案执行后，该势力预计失去全部辖城。" };
    message = (steps.length && partial[blocker]) || expeditionBlockerMessage(blocker, faction);
  }
  if (stale) message = "战局已有变化，请返回并重新打开预案。";
  note.textContent = message ?? "";
  note.hidden = !message;
  find("expedition-plan-limit").disabled = stale;
  find("confirm-expedition-plan").disabled = stale || Boolean(error) || !steps.length;
  const scope = find("expedition-plan-scope");
  scope.textContent = faction ? "目标势力 " + factionName(era(), faction) : "";
  scope.hidden = !faction;
  find("expedition-plan-summary").textContent = "拟追加 " + steps.length + " / " + limit + " 道 · 合计耗粮 " + formatted.format(grain)
    + " · 队列后余粮 " + formatted.format(closingGrain);
  const size = innerHeight <= 450 ? 1 : innerHeight <= 540 || innerWidth < 400 ? 2 : 3;
  const rows = pageOf(steps, "expedition-plan", size, renderExpeditionPlan).map(expeditionPlanRow);
  find("expedition-plan-list").replaceChildren(...rows);
}

function refreshExpeditionPlan() {
  const source = state;
  const faction = attackOpportunityFaction;
  const limit = Number(find("expedition-plan-limit").value);
  try {
    expeditionPlan = { source, faction, limit, ...planFrontierExpeditions(world, state, { faction, limit }) };
  } catch (error) {
    expeditionPlan = { source, faction, limit, steps: [], grain: 0, closingGrain: planned.factions[state.player].grain, error: error.message };
  }
  pages["expedition-plan"] = 0;
  renderExpeditionPlan();
}

function openExpeditionPlan() {
  const limit = seasonOrderLimit - state.orders.length;
  if (limit <= 0 || deciding) return;
  const field = find("expedition-plan-limit");
  field.replaceChildren(...Array.from({ length: limit }, (_, index) => new Option(String(index + 1), String(index + 1))));
  field.value = String(limit);
  refreshExpeditionPlan();
  find("expedition-plan-dialog").showModal();
}

function applyExpeditionPlan() {
  const { source, faction, steps, error } = expeditionPlan;
  if (source !== state || faction !== attackOpportunityFaction || deciding || !steps.length || error) {
    renderExpeditionPlan();
    return;
  }
  let next;
  try {
    next = replaceOrders(world, state, [...state.orders, ...steps.map(({ order }) => order)]);
  } catch (cause) {
    expeditionPlan.error = cause.message;
    renderExpeditionPlan();
    return;
  }
  find("expedition-plan-dialog").close();
  mutate(() => next);
  const status = find("attack-opportunities-status");
  status.textContent = "已追加 " + steps.length + " 道出征令。 " + status.textContent;
  status.focus();
}

function defensiveEstimate(label, { threat, defense, status }) {
  const strength = "守 " + formatted.format(defense);
  return threat ? label + " · " + cityName(world, threat.from) + " " + threat.officer + " 攻 " + formatted.format(threat.offense) + " 对 " + strength
    : label + " · " + strength + " · " + defensePressureLabels[status];
}

function defensePressureRow({ key, current, projected, weakened, aid }) {
  const row = make("li");
  row.dataset.city = key;
  const name = cityName(world, key);
  const details = make("div", undefined, "holding-detail");
  const heading = make("div", undefined, "holding-heading");
  const danger = projected.threat?.wins;
  const status = danger ? "可能失守" : projected.threat ? "预计守住" : defensePressureLabels[projected.status];
  heading.append(make("strong", name), make("span", status + (weakened ? " · 队列后守备减弱" : ""),
    danger || weakened ? "occupation-estimate" : "muted"));
  details.append(heading, make("span", defensiveEstimate("当前", current), "muted"),
    make("span", defensiveEstimate("队列后", projected), "muted"));
  const action = make("button", aid?.order ? "拟调兵" : "定位", "quiet");
  action.type = "button";
  if (aid?.order) {
    const { order, defense } = aid;
    const remaining = projected.threat.offense - defense;
    details.append(make("span", cityName(world, order.from) + "援 " + formatted.format(order.troops) + " 人 · "
      + (remaining > 0 ? "守备战力仍差 " + formatted.format(remaining) : "补援后预计守住"), "muted"));
    action.setAttribute("aria-label", "为" + name + "拟调守军");
    action.addEventListener("click", () => {
      find("defense-pressure-dialog").close();
      planFrontierOrder("reinforcement", order.from, order.to, order.troops);
    });
  } else {
    if (aid?.blocker) details.append(make("span", reinforcementBlockers[aid.blocker], "muted"));
    action.setAttribute("aria-label", "定位" + name);
    action.addEventListener("click", () => locateOnMap(key, "defense-pressure-dialog"));
  }
  row.append(details, action);
  return row;
}

function renderDefensePressure() {
  const rows = frontierDefensePressure(world, militaryView(state), militaryView(planned), garrisonTarget);
  const status = find("defense-pressure-status");
  status.textContent = rows.length ? "可能失守 " + rows.filter(({ margin }) => margin > 0).length + " 城 · 队列后守备减弱 "
    + rows.filter(({ weakened }) => weakened).length + " 城" : gameOutcome(state) === "ongoing" ? "当前没有接壤外势力的辖城。" : "战局已结束。";
  find("defense-pressure-note").hidden = !rows.length;
  const size = innerHeight <= 480 ? 1 : innerHeight <= 690 ? 2 : 4;
  find("defense-pressure-list").replaceChildren(...pageOf(rows, "defense-pressure", size, renderDefensePressure).map(defensePressureRow));
}

function openDefensePressure() {
  renderDefensePressure();
  find("defense-pressure-dialog").showModal();
}

function jointDraft() {
  const donor = selectedJointDonor();
  return {
    from: find("joint-from").value,
    target: find("joint-target").value,
    support: find("joint-support").value,
    officer: find("joint-officer").value,
    supportTroops: find("joint-support-troops").valueAsNumber,
    attackTroops: find("joint-attack-troops").valueAsNumber,
    ...(donor?.hops > 1 ? { supportRoute: donor.route } : {}),
  };
}

function selectedJointOrigin() {
  return jointOrigins.find(({ key }) => key === find("joint-from").value);
}

function selectedJointDonor(origin = selectedJointOrigin()) {
  return origin?.donors.find(({ key }) => key === find("joint-support").value);
}

function showJointError(message) {
  const outcome = find("joint-outcome");
  outcome.textContent = message;
  outcome.dataset.state = "invalid";
  find("joint-reserves").textContent = "";
  find("queue-joint").disabled = true;
}

function updateJointPreview(event) {
  const origin = selectedJointOrigin();
  const draft = jointDraft();
  if (!origin) return;
  const attack = find("joint-attack-troops");
  const donor = selectedJointDonor(origin);
  const limit = jointAttackLimit(origin, draft.supportTroops, donor);
  if (event?.target.id === "joint-support-troops" && Number.isFinite(limit) && limit >= minimumMarch
    && find("joint-support-troops").validity.valid && draft.attackTroops === Number(attack.max)) {
    attack.value = limit;
    draft.attackTroops = limit;
  }
  attack.max = Number.isFinite(limit) ? limit : minimumMarch;
  find("joint-position").textContent = "先调兵第 " + (state.orders.length + 1) + " 道 · 后出征第 " + (state.orders.length + 2) + " 道"
    + (Number.isFinite(limit) ? " · 出征上限 " + formatted.format(limit) : "");
  find("joint-route").textContent = donor ? "援军路线 " + donor.route.map((key) => cityName(world, key)).join(" → ") : "";
  try {
    const result = planJointOrders(world, militaryView(state), draft);
    const outcome = find("joint-outcome");
    const { offense, defense, wins } = result.outcome;
    outcome.textContent = (wins ? "预计占优" : "预计失利") + " · 战力 "
      + formatted.format(offense) + " 对 " + formatted.format(defense) + " · 耗粮 " + result.grain;
    outcome.dataset.state = wins ? "advantage" : "disadvantage";
    find("joint-reserves").textContent = "驻军 → 留守 · 援军城 " + formatted.format(result.supportGarrison) + " → "
      + formatted.format(result.supportReserve) + " · 进攻城 " + formatted.format(result.attackGarrison) + " → "
      + formatted.format(result.attackReserve);
    find("queue-joint").disabled = false;
  } catch (error) {
    showJointError(error.message);
  }
}

function fillJointTroops() {
  const origin = selectedJointOrigin();
  const donor = selectedJointDonor(origin);
  if (!donor) return;
  const supply = find("joint-support-troops");
  supply.min = origin.supportMinimum;
  supply.max = donor.maximum;
  supply.value = Math.min(donor.maximum, Math.max(origin.supportMinimum, 600));
  const army = find("joint-attack-troops");
  army.min = minimumMarch;
  army.value = jointAttackLimit(origin, Number(supply.value), donor);
  updateJointPreview();
}

function fillJointOrigin() {
  const origin = selectedJointOrigin();
  if (!origin) return;
  find("joint-target").replaceChildren(...origin.targets.map(({ key }) =>
    new Option(cityName(world, key) + " · " + factionName(era(), planned.cities[key].owner), key)));
  find("joint-support").replaceChildren(...origin.donors.map(({ key, hops, maximum }) =>
    new Option(cityName(world, key) + (hops > 1 ? " · " + hops + " 段" : "") + " · 可调 " + formatted.format(maximum), key)));
  find("joint-officer").replaceChildren(...origin.officers.map(({ key, name, command }) =>
    new Option(name + " · 统率 " + command, key)));
  fillJointTroops();
}

function openJointPlan(draft) {
  jointOrigins = jointOptions(world, militaryView(state), militaryView(planned));
  if (!jointOrigins.length) return;
  const previous = draft?.from ?? find("frontier-city").value;
  const picker = find("joint-from");
  picker.replaceChildren(...jointOrigins.map(({ key }) => new Option(cityName(world, key), key)));
  if (jointOrigins.some(({ key }) => key === previous)) picker.value = previous;
  fillJointOrigin();
  if (draft && picker.value === draft.from) {
    find("joint-target").value = draft.target;
    find("joint-officer").value = draft.officer;
    find("joint-support").value = draft.support;
    fillJointTroops();
    find("joint-support-troops").value = draft.supportTroops;
    find("joint-attack-troops").value = draft.attackTroops;
    updateJointPreview();
  }
  if (find("frontier-dialog").open) find("frontier-dialog").close();
  find("joint-dialog").showModal();
}

function renderMap() {
  const command = cityCommand?.overlay() ?? landscapeMap?.overlay();
  if (command) {
    map.show(state, selected, command.to, command.type, command.route, command);
    return;
  }
  const attackActive = activeTab === "expedition" && !find("attack-form").hidden;
  const transferActive = activeTab === "reinforcement" && !find("transfer-form").hidden;
  const destination = attackActive ? find("target-picker").value : transferActive ? find("transfer-target").value : null;
  map.show(state, selected, destination, transferActive ? "transfer" : "attack", transferActive ? transferPaths.get(destination) : null);
}

function renderDiplomacyOffer() {
  const target = find("diplomacy-target");
  const kind = find("diplomacy-kind").value;
  const previous = target.value;
  const opponents = activeOpponents();
  target.replaceChildren(...opponents.map(({ key, name }) => {
    const treaty = treatyWith(state, state.player, key);
    const label = treaty ? name + " · " + treatyTerms[treaty.kind].name + "余 " + (treaty.expires - state.turn) + " 季" : name;
    return new Option(label, key);
  }));
  if (opponents.some(({ key }) => key === previous)) target.value = previous;
  const response = find("diplomacy-response");
  const submit = find("propose-treaty");
  find("diplomacy-fields").hidden = !opponents.length;
  find("diplomacy-terms").hidden = !opponents.length;
  if (!opponents.length) {
    find("diplomacy-relation").textContent = "当前没有可交涉的势力。";
    response.textContent = "";
    submit.disabled = true;
    return;
  }

  const current = treatyWith(state, state.player, target.value);
  find("diplomacy-relation").textContent = current
    ? "当前" + treatyTerms[current.kind].name + " · 余 " + (current.expires - state.turn) + " 季"
    : "双方可交战";
  const terms = treatyTerms[kind];
  find("diplomacy-terms").textContent = terms.seasons + " 季互不进攻 · 接受后支付礼金 " + terms.treasury + " 钱。"
    + (kind === "alliance" ? " 同盟双方每季各得 " + allianceIncome + " 钱商贸收入。" : "");
  const previousOffer = state.treatyOffers.find((offer) => offer.target === target.value);
  const quote = quoteTreaty(world, state, target.value, kind, planned.factions[state.player].treasury);
  response.textContent = previousOffer
    ? "对方本季已" + (previousOffer.accepted ? "同意" : "拒绝") + treatyTerms[previousOffer.kind].name + "。 " + previousOffer.reason
    : (quote.available ? "预计答复 · " : "") + quote.reason;
  response.dataset.agreed = String(previousOffer?.accepted ?? quote.accepted);
  submit.disabled = !quote.available;
}

function renderDiplomacyInbox() {
  const offer = state.incomingTreaty;
  const waiting = offer?.answer === null;
  const status = find("inbox-status");
  find("inbox-tab").textContent = waiting ? "来使 · 1" : "来使";
  find("inbox-terms").hidden = !offer;
  find("inbox-reason").hidden = !offer;
  find("inbox-actions").hidden = !waiting;
  if (!offer) {
    find("inbox-heading").textContent = "本季暂无来使。";
    status.textContent = "";
    return;
  }
  const name = factionName(era(), offer.from);
  const term = treatyTerms[offer.kind];
  find("inbox-heading").textContent = name + "提议" + term.name;
  find("inbox-terms").textContent = term.seasons + " 季互不进攻 · 对方支付 " + term.treasury + " 钱礼金。"
    + (offer.kind === "alliance" ? " 双方每季各得 " + allianceIncome + " 钱商贸收入。" : "");
  find("inbox-reason").textContent = offer.reason;
  const blocked = waiting ? incomingTreatyBlock(state) : "";
  find("accept-treaty").disabled = Boolean(blocked);
  status.textContent = waiting ? blocked || "请在推进下一季前答复。"
    : offer.answer ? "已接受，约定即刻生效。" : "已拒绝此提议。";
}

function renderDiplomacy() {
  renderDiplomacyOffer();
  renderDiplomacyInbox();
}

function selectDiplomacyPane(pane) {
  find("diplomacy-form").hidden = pane !== "outgoing";
  find("diplomacy-inbox").hidden = pane !== "incoming";
  for (const button of document.querySelectorAll("[data-diplomacy-tab]")) {
    button.setAttribute("aria-pressed", String(button.dataset.diplomacyTab === pane));
  }
}

function openDiplomacyDialog(pane = state.incomingTreaty?.answer === null ? "incoming" : "outgoing") {
  renderDiplomacy();
  selectDiplomacyPane(pane);
  find("diplomacy-dialog").showModal();
}

function openFinanceDialog(turn) {
  find("finance-turn").value = "";
  financeProgramFilter = "all";
  const requestedTurn = turn !== undefined;
  selectFinance(requestedTurn || gameOutcome(state) !== "ongoing" ? "actual" : "forecast", "ledger");
  if (requestedTurn && [...find("finance-turn").options].some(({ value }) => value === String(turn))) {
    find("finance-turn").value = turn;
    renderFinance();
  }
  find("finance-dialog").showModal();
}

const adviceActions = {
  diplomacy: "查看来使", budget: "查看预算", appointment: "查看任命", attack: "查看出征",
  joint: "查看拟令", domestic: "查看内政", orders: "查看队列", finance: "查看财政",
};

function followAdvice(item) {
  find("advice-dialog").close();
  switch (item.kind) {
    case "diplomacy": openDiplomacyDialog("incoming"); return;
    case "orders": openOrdersDialog(); return;
    case "finance": openFinanceDialog(); return;
    case "joint": openJointPlan(item.draft); return;
    case "attack":
      planFrontierOrder("expedition", item.order.from, item.order.to, item.order.troops, item.order.officer);
      return;
    case "appointment":
      selectCity(item.city, true);
      selectTab("appointments");
      find("commander").focus();
      return;
    case "budget":
      selectCity(item.city, true);
      selectTab("governance");
      find("delegate-budget").focus();
      return;
    case "domestic":
      selectCity(item.order.city, true);
      selectTab("governance");
      find("domestic-order").value = item.order.project ?? "recruit";
      find("domestic-order").focus();
  }
}

function performDeskAction(action, target) {
  const actions = {
    advice: openAdvice, orders: () => openOrdersDialog(), policy: () => state.grand ? grandPanel.open("govern") : openCouncil("policy"),
    war: () => state.grand ? grandPanel.open("campaign") : warPanel.open(), armies: () => armyPanel.open(),
    diplomacy: () => state.incomingTreaty?.answer === null || !state.grand ? openDiplomacyDialog() : grandPanel.open("treaty"),
    envoy: () => openDiplomacyDialog("incoming"), roster: () => openRoster(), polity: () => polityPanel.open(),
    "polity-inbox": () => polityPanel.open("diplomacy", target), province: () => polityPanel.open("province", target),
    edict: () => polityPanel.open("tasks", "edict"), succession: () => polityPanel.open("court"), events: () => openCouncil("events"),
    "war-alert": () => warPanel.open("plans", Number(target)),
    "grand-inbox": () => grandPanel.open("treaty", target),
    "grand-campaign": () => grandPanel.open("campaign", target),
    outcome: openOutcome,
  };
  actions[action]();
}

function renderAdvice() {
  const suggestions = seasonAdvice(world, militaryView(state), militaryView(planned))
    .filter(({ kind }) => kind !== "diplomacy" && !(kind === "orders" && state.orders.length));
  const size = innerHeight <= 410 ? 2 : innerHeight <= 560 ? 3 : 5;
  const rows = pageOf([...commandPriorities(), ...suggestions], "advice", size, renderAdvice).map((item) => {
    const row = make("li");
    row.dataset.advice = item.kind ?? item.action;
    const detail = make("div", undefined, "holding-detail");
    const title = make("strong", item.title);
    detail.append(title, make("span", item.detail, "muted"));
    const button = make("button", adviceActions[item.kind] ?? "处理", "quiet");
    button.type = "button";
    button.addEventListener("click", () => {
      if (!item.action) { followAdvice(item); return; }
      find("advice-dialog").close();
      performDeskAction(item.action, item.target);
    });
    row.append(detail, button);
    return row;
  });
  find("advice-list").replaceChildren(...rows);
}

function openAdvice() {
  pages.advice = 0;
  renderAdvice();
  find("advice-dialog").showModal();
}

function renderGameGuide() {
  const holdings = Object.values(state.cities).filter(({ owner }) => owner === state.player);
  const delegated = holdings.filter(({ mode }) => mode === "delegated").length;
  const outcome = gameOutcome(state);
  const ongoing = outcome === "ongoing";
  const outcomeLabel = { victory: state.scenarioEnding?.kind === "coalition" ? "诸侯共守"
    : state.scenarioEnding?.kind === "peace" ? "天下承平" : state.scenarioEnding ? "剧本结局" : "统一天下", defeat: "势力覆灭" };
  find("guide-campaign").textContent = era().title + " · " + factionName(era(), state.player);
  find("guide-season").textContent = seasonTitle(state.turn) + " · 辖城 " + holdings.length + " / " + world.cities.length
    + (ongoing ? "" : " · " + outcomeLabel[outcome]);
  for (const id of ["guide-domestic", "guide-military", "guide-orders"]) find(id).hidden = !ongoing;
  if (ongoing) {
    find("guide-domestic-note").textContent = delegated
      ? "已委任 " + delegated + " 城，可调整前后方国策。"
      : "预演前后方建设。";
    const exposed = frontierCities(world, state).filter((city) => city.exposed).length;
    find("guide-military-note").textContent = exposed ? exposed + " 城临敌，可先看本季建议。" : "查看本季优先事项。";
    find("guide-orders-note").textContent = state.orders.length
      ? "已排 " + state.orders.length + " / " + seasonOrderLimit + " 道政令。"
      : "可排 " + seasonOrderLimit + " 道政令。";
  }
  find("guide-report-note").textContent = state.history.length
    ? "已保存 " + state.history.length + " 季奏报，可看战果与收支。"
    : ongoing && state.turn === 0 ? "推进首季后可查结算。" : "本局暂无已保存的季报。";
}

function openGameGuide() {
  renderGameGuide();
  find("game-guide").showModal();
}

function closeGameGuideMenus() {
  if (!find("game-guide").open) return;
  find("game-guide").close();
  find("menu-dialog").close();
}

function render() {
  planned = previewMilitaryOrders(world, state);
  renderResources();
  renderCommandDesk();
  renderForces();
  renderCityPicker();
  renderCity();
  renderGovernance();
  renderAttack();
  renderTransfer();
  renderOfficers();
  renderQueuedOrder();
  if (find("holdings-dialog").open) renderHoldings();
  if (find("occupation-plan-dialog").open) renderOccupationPlan();
  if (find("occupation-governors-dialog").open) renderOccupationGovernors();
  if (find("takeover-plan-dialog").open) renderTakeoverPlan();
  if (find("garrisons-dialog").open) renderGarrisons();
  if (find("reinforcement-plan-dialog").open) renderReinforcementPlan();
  if (find("vacancies-dialog").open) renderVacancies();
  if (find("roster-dialog").open) renderRoster();
  if (find("person-dialog").open) renderPersonProfile();
  if (find("finance-dialog").open) renderFinance();
  if (find("finance-trend-dialog").open) renderFinanceTrend();
  if (find("budget-top-up-dialog").open) renderBudgetTopUp();
  if (find("frontier-dialog").open) renderFrontier();
  if (find("attack-opportunities-dialog").open) renderAttackOpportunities();
  if (find("expedition-plan-dialog").open) renderExpeditionPlan();
  if (find("defense-pressure-dialog").open) renderDefensePressure();
  if (find("opponent-brief-dialog").open) renderOpponentBrief();
  if (find("diplomacy-dialog").open) renderDiplomacy();
  if (find("chronicle").open) renderReports();
  if (find("game-guide").open) renderGameGuide();
  cityCommand?.sync();
  landscapeMap?.sync();
  if (find("landscape-dialog").open) landscapeDesk?.render();
  const weather = find("map-weather");
  weather.hidden = !state.landscape;
  if (state.landscape) {
    const season = landscapeMap.weather();
    weather.textContent = season.name;
    weather.title = season.description;
    weather.dataset.season = season.key;
  }
  const roadTab = document.querySelector('[data-map-layer="roads"]');
  roadTab.textContent = state.landscape ? "关隘粮道" : "军路";
  renderMap();
}

function selectCity(key, locate = false, view = "city") {
  if (!Object.hasOwn(state.cities, key)) return;
  closeGameGuideMenus();
  if (state.cities[key].owner !== state.cities[selected].owner) {
    pages.officers = 0;
    find("officer-filter").value = "";
  }
  selected = key;
  attackDraft = {};
  transferDraft = {};
  if (locate) map.locate(key);
  showView(view);
  render();
  keepProgress();
}

function selectMapCity(key, locate = false) {
  if (key === selected && !locate) return;
  selectCity(key, locate, "map");
  selectTab(state.cities[key].owner === state.player ? "governance" : "expedition");
  if (locate) {
    landscapeMap?.close();
    cityCommand?.open(key);
  }
}

function clickMapCity(key) {
  if (cityCommand?.pick(key) || landscapeMap?.pick(key)) return;
  landscapeMap?.close();
  selectMapCity(key);
  cityCommand?.open(key);
}

function selectTab(id, focus = false) {
  activeTab = id;
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const active = tab.dataset.tab === id;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    find(tab.dataset.tab).hidden = !active;
    if (active && focus) tab.focus();
  }
  if (id === "officers") renderOfficers();
  renderMap();
}

function replaceGame(next, city) {
  cityCommand?.close();
  landscapeMap?.close();
  closeGameGuideMenus();
  for (const key of Object.keys(pages)) pages[key] = 0;
  garrisonTarget = frontierGarrisonTarget;
  find("officer-filter").value = "";
  find("roster-search").value = "";
  find("roster-filter").value = "all";
  find("roster-sort").value = "governance";
  state = next;
  selected = city || firstCity(world, state);
  attackDraft = {};
  transferDraft = {};
  syncStartFields();
  map.reset();
  showView("map");
  selectTab("governance");
  render();
}

function activeOpponents() {
  return playableFactions(era()).filter(({ key }) => key !== state.player && forceTotals(state, key).cities > 0);
}

function showModelStatus(status, preference) {
  const mode = find("opponent-mode");
  savedModel = status;
  modelReady = status.ready === true;
  mode.querySelector("[value=model]").disabled = !modelReady;
  mode.value = modelReady && preference !== "rules" ? "model" : "rules";
  renderForces();
}

async function discoverModel() {
  const before = savedModel;
  try {
    const response = await fetch("/api/ai", { signal: AbortSignal.timeout(3500) });
    if (!response.ok) return;
    const status = await response.json();
    if (savedModel !== before) return;
    let preference;
    try { preference = localStorage.getItem(opponentModeSlot); } catch { /* game remains playable */ }
    showModelStatus(status, preference);
  } catch {
    // A static or offline game can use its own rules.
  }
}

function modelMessage(text, error = false) {
  const status = find("model-settings-status");
  status.textContent = text;
  status.dataset.error = String(error);
  status.hidden = !text;
}

function fillModelList(ids) {
  find("model-options").replaceChildren(...ids.map((id) => new Option(id, id)));
  if (ids.length === 1 && !find("model-id").value.trim()) find("model-id").value = ids[0];
}

function openModelSettings() {
  const password = find("model-api-key");
  find("model-base-url").value = savedModel.baseUrl || "";
  find("model-id").value = savedModel.model || "";
  find("model-options").replaceChildren();
  password.value = "";
  password.placeholder = savedModel.hasKey ? "已填写，留空沿用" : "填写服务提供的 API Key";
  modelMessage("");
  find("model-settings").showModal();
}

async function submitModelSettings(operation) {
  if (editingModel || !find("model-base-url").reportValidity()) return;
  const model = find("model-id");
  if (operation === "test" && !model.value.trim()) {
    modelMessage("请填写模型 ID 后再测试。", true);
    model.focus();
    return;
  }
  editingModel = true;
  const fields = [
    "model-base-url", "model-api-key", "model-id", "read-models", "test-model-connection", "save-model-settings", "close-model-settings",
  ];
  const modelInfo = {
    baseUrl: find("model-base-url").value, apiKey: find("model-api-key").value, model: model.value,
  };
  for (const id of fields) find(id).disabled = true;
  modelMessage(modelOperationLabels[operation]);
  try {
    const response = await fetch("/api/ai/" + operation, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modelInfo),
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json();
    if (operation === "test") {
      const message = response.status === 404 ? "新版游戏服务可测试连接。"
        : result.error || "测试暂不可用，请稍后重试。";
      const passed = response.ok && result.ok === true;
      modelMessage(passed ? "测试通过，模型可用。" : message, !passed);
      return;
    }
    if (Array.isArray(result.models)) fillModelList(result.models);
    if (!response.ok) {
      modelMessage(result.error || "模型服务暂不可用。", true);
      return;
    }
    if (operation === "models") {
      const count = result.models.length;
      modelMessage(count ? "已读取 " + count + " 个模型。可在模型 ID 中选择。" : "服务未列出模型，请手动填写模型 ID。");
      return;
    }
    showModelStatus({ ...savedModel, ...result }, "model");
    try { localStorage.setItem(opponentModeSlot, "model"); } catch { /* optional preference */ }
    find("model-settings").close();
    notify("已保存模型设置 · " + result.model);
  } catch {
    modelMessage("暂时无法访问设置服务，请重试。", true);
  } finally {
    for (const id of fields) find(id).disabled = false;
    editingModel = false;
  }
}

function setDeciding(value) {
  if (value) cityCommand?.close();
  deciding = value;
  for (const section of find("workspace").children) {
    if (!section.classList.contains("left-column")) section.inert = value;
  }
  find("forces").closest(".force-panel").querySelector(".force-actions").inert = value;
  find("revenue").closest(".revenue").inert = value;
  find("opponent-mode").disabled = value;
  find("open-menu").disabled = value;
  find("open-advice").disabled = value;
  find("open-chronicle").disabled = value;
  for (const button of document.querySelectorAll("[data-command-action], #turn-orders")) button.disabled = value;
  renderResources();
  renderForces();
}

function turnProgressLabel() {
  const completed = [...turnProgress.values()].filter((source) => source !== "pending").length;
  return "拟令进度 " + completed + " / " + turnProgress.size;
}

function showTurnProgress({ faction, source }) {
  if (!turnProgress?.has(faction) || !["model", "fallback"].includes(source) || turnProgress.get(faction) === source) return;
  turnProgress.set(faction, source);
  renderForces();
  notify(turnProgressLabel());
}

function openOutcome() {
  const result = gameOutcome(state);
  const holdings = forceTotals(state, state.player).cities;
  const coalition = state.scenarioEnding?.kind === "coalition";
  const peace = state.scenarioEnding?.kind === "peace";
  const ending = state.scenarioEnding && (coalition ? coalitionCriteria(world, era(), state) : peace
    ? peaceCriteria(world, state) : scenarioEndingCriteria(world, state));
  find("outcome-title").textContent = ending ? ending.title : { ongoing: "剧本目标", victory: "统一天下", defeat: "势力覆灭" }[result];
  find("outcome-campaign").textContent = state.year + " 年 · " + era().title + " · " + factionName(era(), state.player);
  find("outcome-summary").textContent = coalition ? "已达成联盟结局。复盘可查看盟友疆域和人才履历。"
    : peace ? "已达成天下承平。复盘可查看国政、疆域及人物履历。"
    : ending ? "已达成本剧本的战役结局。可回顾疆域、战役和人物履历。" : {
    ongoing: "占领全部主城即可获胜，失去全部城池则战败。",
    victory: "你已占领全部主城，战局获胜。",
    defeat: "你已失去全部城池，战局结束。",
  }[result];
  find("outcome-holdings").textContent = "控制主城 " + holdings + " / " + world.cities.length;
  const objective = scenarioObjective(world, era(), state);
  find("stage-objective").hidden = !objective;
  if (objective) {
    const completed = state.stageCompletedAt !== null;
    find("stage-title").textContent = "阶段目标 · " + objective.title;
    find("stage-description").textContent = objective.description;
    const progress = Math.min(objective.progress, objective.required);
    const pending = progress >= objective.required && result === "ongoing";
    find("stage-progress").textContent = completed ? seasonTitle(state.stageCompletedAt - 1) + "已完成"
      : progress + " / " + objective.required + (pending ? " · 待季末验收" : "");
    find("stage-progress").dataset.completed = String(completed);
  }
  find("outcome-restart").hidden = result === "ongoing";
  find("open-ending-record").textContent = result === "ongoing" ? "战役结局" : "战役复盘";
  find("outcome-dialog").showModal();
}

function renderEndingRecord() {
  const current = gameOutcome(state) === "ongoing";
  find("ending-goal").hidden = !current;
  find("ending-review").hidden = current;
  if (current) {
    const { title, checks, ready } = scenarioEndingCriteria(world, state);
    find("ending-record-title").textContent = title;
    find("ending-requirements").replaceChildren(...checks.map(({ label, value, target }) => {
      return make("li", `${label} ${formatted.format(value)} / ${formatted.format(target)}`, value >= target ? "stage-met" : "muted");
    }));
    find("ending-status").textContent = ready ? "条件齐备。确认后进入复盘。" : "可继续推进，达成条件后确认结局。";
    find("conclude-scenario").disabled = !ready;
    return;
  }
  find("ending-record-title").textContent = "战役复盘";
  for (const button of find("review-tabs").querySelectorAll("button")) {
    button.hidden = button.dataset.reviewPane === "operations" && !state.war || button.dataset.reviewPane === "polities" && !state.polity;
    button.setAttribute("aria-pressed", button.dataset.reviewPane === reviewPane);
  }
  const record = state.campaignRecord;
  const count = forceTotals(state, state.player).cities;
  let items;
  if (reviewPane === "realm") {
    const factions = era().factions.map(({ key, name }) => ({ name, total: forceTotals(state, key).cities })).filter(({ total }) => total);
    factions.sort((a, b) => b.total - a.total);
    items = factions.map(({ name, total }) => name + " · " + total + " 城");
    if (state.scenarioEnding?.kind === "coalition") items.unshift("联盟维持 " + state.realm.coalition.streak + " 季 · "
      + state.realm.coalition.partners.map((faction) => factionName(era(), faction)).join("、"));
  } else if (reviewPane === "battles") {
    items = (record?.battles ?? []).map(({ city, turn, won, worth }) => cityName(world, city) + " · "
      + seasonTitle(turn - 1) + " · " + (won ? "胜" : "负") + " · 双方折损 " + formatted.format(worth));
  } else if (reviewPane === "operations") {
    items = [...(state.war?.timeline ?? [])].reverse().map(({ turn, text, cost }) => (turn ? seasonTitle(turn - 1) : "战前")
      + " · " + text + (cost ? " 支出 " + cost + " 粮。" : ""));
  } else if (reviewPane === "polities") {
    items = [...(state.polity?.history ?? [])].reverse().map(({ turn, faction, text }) =>
      seasonTitle(turn - 1) + " · " + factionName(era(), faction) + " · " + text);
  } else {
    const featured = era().officers.filter((person) => person.faction === state.player && knownOfficer(state, person));
    const weight = ({ key }) => officerService(state, key).governance + officerService(state, key).command;
    items = featured.sort((a, b) => weight(b) - weight(a)).map(({ key, name }) => {
      const { governance, command, governanceRank, commandRank } = officerService(state, key);
      const fights = record?.people?.[key];
      return `${name} · 政 ${governance} / 统 ${command} · 提拔 ${governanceRank + commandRank} 次`
        + (fights ? ` · ${fights.wins} 胜 ${fights.defeats} 负` : "");
    });
  }
  find("review-summary").textContent = record ? `${state.turn} 季 · 现有 ${count} 城 · 峰值 ${record.peak} 城 · 战胜 ${record.victories} · 战败 ${record.defeats}`
    : `${state.turn} 季 · 现有 ${count} 城 · 此存档始于复盘记录之前`;
  const size = ["operations", "polities"].includes(reviewPane) ? (innerHeight <= 440 ? 1 : innerHeight <= 650 ? 2 : 4)
    : innerHeight <= 400 ? 3 : innerHeight <= 650 ? 4 : 6;
  const rows = pageOf(items, "ending-review", size, renderEndingRecord).map((text) => make("li", text));
  find("review-list").replaceChildren(...(rows.length ? rows : [make("li", "这里暂无可回顾的记录。", "muted")]));
}

function renderRecruitment() {
  const cities = world.cities.filter(({ key }) => state.cities[key].owner === state.player && !state.cities[key].occupation);
  const picker = find("recruitment-city");
  const previous = picker.value || selected;
  picker.replaceChildren(...cities.map(({ key, name }) => new Option(name, key)));
  if (cities.some(({ key }) => key === previous)) picker.value = previous;
  const rows = recruitmentChoices(world, state).map(({ person, ready }) => {
    const row = make("li");
    row.dataset.talent = person.key;
    const detail = make("div", undefined, "holding-detail");
    const terms = state.turn < person.reserve.turn ? `第 ${person.reserve.turn} 季后可招揽` : `${person.reserve.fee} 钱`;
    detail.append(make("strong", person.name), make("span", ` · 政 ${person.governance} · 统 ${person.command} · ${terms}`, "muted"));
    const sign = make("button", "招揽", "quiet");
    sign.type = "button";
    sign.disabled = !ready || !picker.value || gameOutcome(state) !== "ongoing";
    sign.addEventListener("click", () => {
      const note = find("recruitment-status");
      try {
        const next = recruitOfficer(world, state, person.key, picker.value);
        mutate(() => next, person.name + "已入仕。");
        note.textContent = person.name + "已入仕，可在人才名册中任用。";
        renderRecruitment();
      } catch (error) { note.textContent = error.message; }
      note.hidden = false;
    });
    row.append(detail, sign);
    return row;
  });
  find("recruitment-list").replaceChildren(...(rows.length ? rows : [make("li", "可招揽的人才已全部入仕。", "muted")]));
}

function stageCityDescription({ holding, troopShortage, defenseShortage, met }) {
  if (state.year === 199) {
    const policy = holding.mode === "delegated" ? "委任" + focusLabels[holding.focus] : "直辖";
    return policy + " · 屯田 " + holding.farming + " 级";
  }
  if (state.year === 208) return "商贸 " + holding.commerce + " 级" + (holding.occupation ? " · 整顿中" : "");
  if (state.year === 262) {
    const gaps = [];
    if (troopShortage) gaps.push("缺驻军 " + formatted.format(troopShortage));
    if (defenseShortage) gaps.push("缺城防 " + defenseShortage + " 级");
    const current = "驻军 " + formatted.format(holding.troops) + " · 城防 " + holding.defense + " 级";
    return [current, ...gaps].join(" · ");
  }
  if (met) return "已完成整顿";
  const { shortage } = occupationProgress(holding, false);
  return "整顿余 " + holding.occupation + " 季" + (shortage ? " · 缺驻军 " + formatted.format(shortage) + "，整顿暂停" : "");
}

function renderStageDetails() {
  const objective = scenarioObjective(world, era(), state);
  if (!objective) return;
  const { title, description, required, progress, rows } = objective;
  const ongoing = gameOutcome(state) === "ongoing";
  find("stage-detail-title").textContent = title + " · 进度详情";
  find("stage-detail-rule").textContent = description;
  find("stage-detail-count").textContent = "当前达标 " + progress + " 城 · 目标 " + required + " 城";
  const completion = find("stage-detail-completion");
  const completed = state.stageCompletedAt !== null;
  completion.textContent = completed ? seasonTitle(state.stageCompletedAt - 1) + "已完成阶段目标" : "已达当前条件，待季末验收";
  completion.hidden = !completed && !(ongoing && progress >= required);
  const showExpeditions = state.year === 265 && ongoing && !rows.length;
  find("stage-detail-actions").hidden = !showExpeditions;

  rows.sort((a, b) => Number(b.met) - Number(a.met));
  const size = innerHeight <= 410 ? 2 : innerHeight <= 620 ? 3 : 5;
  const items = pageOf(rows, "stage-details", size, renderStageDetails).map((record) => {
    const { city, met } = record;
    const row = make("li");
    row.dataset.city = city.key;
    row.dataset.met = String(met);
    const details = make("div", undefined, "holding-detail");
    const heading = make("div", undefined, "holding-heading");
    heading.append(make("strong", city.name), make("span", met ? "达标" : "未达标", met ? "stage-met" : "muted"));
    details.append(heading, make("span", stageCityDescription(record), "muted"));
    const locate = make("button", "定位", "quiet");
    locate.type = "button";
    locate.setAttribute("aria-label", "定位" + city.name);
    locate.addEventListener("click", () => locateOnMap(city.key, "stage-detail-dialog"));
    row.append(details, locate);
    return row;
  });
  const empty = state.year === 265 ? "当前没有符合目标的新占城。" : "当前没有符合目标的辖城。";
  find("stage-detail-list").replaceChildren(...(items.length ? items : [make("li", empty, "muted")]));
}

function openStageDetails() {
  pages["stage-details"] = 0;
  renderStageDetails();
  find("stage-detail-dialog").showModal();
}

function closeStageParents() {
  find("holdings-dialog").close();
  find("outcome-dialog").close();
}

function renderCampaignRoute() {
  const steps = campaignRoute(world, era(), state);
  const next = steps.findIndex(({ completed }) => completed === null);
  const rows = steps.map(({ title, description, checks, completed, ready }, index) => {
    const status = completed !== null ? seasonTitle(completed - 1) + "完成"
      : index !== next ? "待解锁" : ready ? "待季末验收" : "进行中";
    const row = make("li");
    row.title = description;
    row.dataset.completed = String(completed !== null);
    const details = make("div", undefined, "holding-detail");
    const heading = make("div", undefined, "holding-heading");
    heading.append(make("strong", title), make("span", status, completed === null ? "muted" : "stage-met"));
    details.append(heading, make("span", checks.map(({ label, value, target }) => label + " " + formatted.format(value)
      + " / " + formatted.format(target)).join(" · "), "muted"));
    row.append(details);
    return row;
  });
  find("campaign-route-list").replaceChildren(...rows);
}

function fillNationalPolicy() {
  const defaults = { front: { focus: "defense", budget: 24, garrison: 1800 }, rear: { focus: "auto", budget: 22, garrison: 900 } };
  const ongoing = gameOutcome(state) === "ongoing";
  for (const [zone, fallback] of Object.entries(defaults)) {
    for (const [field, value] of Object.entries(state.nationalPolicy?.[zone] ?? fallback)) {
      const input = find("national-" + zone + "-" + field);
      input.value = value;
      input.disabled = !ongoing;
    }
  }
  for (const resource of ["treasury", "grain"]) {
    const input = find("national-" + resource);
    input.value = state.delegationReserve?.[resource] ?? 0;
    input.disabled = !ongoing;
  }
  find("apply-national-policy").disabled = !ongoing;
  find("stop-national-policy").disabled = !ongoing || !state.nationalPolicy;
  find("council-policy-status").textContent = state.nationalPolicy
    ? "国策生效。太守优先补足驻军，手动接管的城沿用原安排。"
    : "保存后分区逐季委任，已有太守的辖城可执行。";
}

function renderNationalAlerts() {
  const active = state.nationalPolicy;
  const zones = delegationZones(world, state);
  const forecasts = active || state.realm ? new Map(forecastFinance(world, state).programs.map((row) => [row.city, row])) : new Map();
  const blocked = ["budget", "national-budget", "treasury", "grain", "reserve-treasury", "reserve-grain"];
  const items = Object.entries(zones).flatMap(([zone, keys]) => keys.flatMap((key) => {
    const city = state.cities[key];
    const manual = state.policyOverrides?.includes(key);
    const shortage = Math.max(0, (active?.[zone].garrison ?? 0) - (planned.cities[key].owner === state.player ? planned.cities[key].troops : city.troops));
    const result = forecasts.get(key)?.result;
    const notes = [];
    if (!city.governor) notes.push("太守空缺");
    if (shortage) notes.push("驻军缺 " + formatted.format(shortage));
    if (blocked.includes(result)) notes.push(programResults[result]);
    if ((state.realm?.cities[key].welfare ?? 100) <= 50) notes.push("民心偏低");
    if (manual) notes.push("手动接管");
    return notes.length ? [{ key, notes, manual }] : [];
  }));
  const blockedTheater = state.theaters?.find((plan) => plan.paused && plan.report?.status === "blocked");
  find("council-alert-summary").textContent = items.length + " 城待处理" + (blockedTheater ? " · 有战区待决" : "");
  const polityPending = state.polity && (provinceRows(world, state).some(({ warning }) => warning !== null)
    || state.polity.offers.some(({ to }) => to === state.player)
    || state.polity.deals.some(({ from, to }) => from === state.player || to === state.player)
    || (courtFor(state, state.player)?.due ?? Infinity) <= state.turn + 4 || currentEdict(world, state));
  find("council-open-polity").hidden = !polityPending || Boolean(blockedTheater);
  if (polityPending) find("council-alert-summary").textContent += " · 有国政待决";
  find("council-open-theater").hidden = !blockedTheater;
  find("council-open-theater").onclick = blockedTheater ? () => theaterPanel.open(blockedTheater.id) : null;
  const size = innerHeight <= 420 ? 2 : innerHeight <= 630 ? 3 : 5;
  const rows = pageOf(items, "council-alerts", size, renderNationalAlerts).map(({ key, notes, manual }) => {
    const row = make("li");
    row.dataset.city = key;
    const details = make("div", undefined, "holding-detail");
    details.append(make("strong", cityName(world, key)), make("span", notes.join(" · "), "muted"));
    const open = make("button", "查看", "quiet");
    open.type = "button";
    open.addEventListener("click", () => {
      find("campaign-council").close();
      closeStageParents();
      selectCity(key, true);
      selectTab("governance", true);
    });
    row.append(details, open);
    if (manual && gameOutcome(state) === "ongoing") {
      const resume = make("button", "交回国策", "quiet");
      resume.type = "button";
      resume.addEventListener("click", () => {
        mutate(() => resumeNationalPolicy(state, key));
        renderNationalAlerts();
      });
      row.append(resume);
    }
    return row;
  });
  find("council-alert-list").replaceChildren(...(rows.length ? rows : [make("li", "当前没有国政待办。", "muted")]));
}

function renderCouncilEvents() {
  const event = campaignEvent(world, era(), state);
  const ongoing = gameOutcome(state) === "ongoing";
  find("council-event-title").textContent = event?.title || "本季没有待决事件";
  find("council-event-description").textContent = (event?.description || "")
    + (event?.cost && !event.available ? " 排定政令后的钱粮不足。" : "");
  find("council-event-description").hidden = !event;
  find("council-event-actions").hidden = !event || !ongoing;
  find("accept-campaign-event").disabled = !event?.available;
  const records = [...(state.campaignEvents?.records ?? [])].reverse();
  find("council-event-history").replaceChildren(...records.map(({ kind, turn, accepted }) => {
    return make("li", campaignEventName(state.year, kind) + " · " + (accepted ? "已接受" : "已婉拒") + " · " + seasonTitle(turn));
  }));
}

function showCouncilPane(pane) {
  councilPane = pane;
  for (const button of find("council-switch").querySelectorAll("button")) {
    const active = pane === button.dataset.councilPane;
    button.setAttribute("aria-pressed", String(active));
    find(button.getAttribute("aria-controls")).hidden = !active;
  }
  if (pane === "route") renderCampaignRoute();
  if (pane === "policy") fillNationalPolicy();
  if (pane === "alerts") renderNationalAlerts();
  if (pane === "events") renderCouncilEvents();
}

function openCouncil(pane) {
  pages["council-alerts"] = 0;
  showCouncilPane(pane);
  find("campaign-council").showModal();
}

function settleTurn(operation, status) {
  const previousStage = state.stageCompletedAt;
  if (state.landscape) {
    cityCommand?.close();
    landscapeMap?.close();
  }
  mutate(operation, status);
  if (gameOutcome(state) !== "ongoing") openOutcome();
  else if (state.history.at(-1)?.entries.some((entry) => entry.type === "war"
    && (entry.faction === state.player || entry.participants?.includes(state.player)) && ["isolated", "relieved", "withdraw-blocked", "strained"].includes(entry.event))) {
    notify("有战役待决，可从「奏报」打开对应军团或战区。");
  } else if (state.history.at(-1)?.entries.some((entry) => entry.faction === state.player && entry.type === "army" && entry.reason === "supply-cut")) {
    notify("有军团补给中断，可在「军团」改道或撤军。");
  } else if (state.history.at(-1)?.entries.some((entry) => entry.type === "theater" && entry.reason === "theater-blocked")) {
    notify("战区已上报待决事项，可在「战区」查看。");
  } else if (previousStage === null && state.stageCompletedAt !== null) notify("已完成剧本阶段目标，记录见奏报。");
  else if (state.campaignEvents?.pending?.turn === state.turn) notify("有新的战役事件，可从「战役方略」处理。");
  else if (state.incomingTreaty?.answer === null) notify("有新的外交提议，可从「奏报」摘要前往答复。");
  else if (state.realm?.proposals.some((item) => item.to === state.player && item.submitted === state.turn)) notify("有新的通商或合兵提案，可从「天下格局 → 外交」答复。");
}

async function takeTurn() {
  if (deciding || find("advance").disabled) return;
  const opponents = activeOpponents();
  if (!modelReady || find("opponent-mode").value !== "model" || !opponents.length) {
    settleTurn(() => advanceQuarter(world, state), "本季已结算，摘要见奏报。");
    return;
  }
  const snapshot = state;
  turnProgress = new Map(opponents.map(({ key }) => [key, "pending"]));
  setDeciding(true);
  notify(turnProgressLabel());
  let next;
  let status = "本季已结算，摘要见奏报。";
  const serviceVersion = savedModel.turnVersion;
  const legacy = serviceVersion !== turnVersion && (serviceVersion !== 26 || state.landscape);
  try {
    if (legacy && state.landscape) throw new Error("山河变局需要 3.0 模型服务。");
    if (!(serviceVersion >= 26) && state.grand) throw new Error("天下大势需要 2.0 模型服务。");
    if (!(serviceVersion >= 27) && [184, 234].includes(state.year)) throw new Error("旧版服务尚未加载此剧本。");
    if (!(serviceVersion >= 25) && state.polity) throw new Error("势力演变需要 1.3 模型服务。");
    if (!(serviceVersion >= 24) && state.war) throw new Error("战役情报需要 1.2 模型服务。");
    if (legacy && [190, 208, 219].includes(state.year) && !(serviceVersion >= 25)) throw new Error("旧版服务尚未加载此剧本。");
    const plannerWorld = serviceVersion >= 2 ? world : oldWorld;
    const requestState = legacy ? legacySnapshot(plannerWorld, snapshot, serviceVersion) : snapshot;
    const response = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: turnStreamType + ", application/json" },
      body: JSON.stringify({ state: requestState }),
      signal: AbortSignal.timeout(80_000),
    });
    if (!response.ok) throw new Error("模型结算暂不可用");
    const result = await readTurnResponse(response, showTurnProgress);
    const settled = result.state;
    if (settled.turn !== snapshot.turn + 1 || settled.player !== snapshot.player || settled.year !== snapshot.year) {
      throw new Error("返回的回合与当前进度不匹配");
    }
    next = legacy
      ? advanceQuarter(world, snapshot, legacyProposals(plannerWorld, requestState, settled.history.at(-1), opponents, serviceVersion))
      : decodeSave(world, JSON.stringify(settled));
  } catch {
    const fallback = Object.fromEntries(opponents.map(({ key }) => [key, {
      source: "fallback", reason: "本季模型结算暂不可用",
    }]));
    next = advanceQuarter(world, snapshot, fallback);
    status = "本季已由本地规则结算。";
  } finally {
    turnProgress = undefined;
    setDeciding(false);
  }
  settleTurn(() => next, status);
}

function openCampaign() {
  syncStartFields();
  showCampaignPane("summary");
  find("campaign-roster-sort").value = "command";
  renderCampaignPreview();
  find("campaign-dialog").showModal();
}

function wireControls() {
  for (const button of document.querySelectorAll("[data-command-action]")) {
    button.addEventListener("click", () => performDeskAction(button.dataset.commandAction, button.dataset.commandTarget));
  }
  find("turn-orders").addEventListener("click", () => openOrdersDialog());
  find("advance-from-orders").addEventListener("click", () => {
    find("orders-dialog").close();
    find("advance").click();
  });
  find("open-grand-shortcut").addEventListener("click", () => state.landscape ? landscapeDesk.open("summary") : grandPanel.open());
  find("map-weather").addEventListener("click", () => landscapeDesk.open("summary"));
  find("open-landscape-menu").addEventListener("click", () => { find("menu-dialog").close(); landscapeDesk.open(); });
  find("open-grand-menu").addEventListener("click", () => { find("menu-dialog").close(); grandPanel.open(); });
  find("open-custom-opening").addEventListener("click", () =>
    openingEditor.open(eraByYear(world, Number(find("era-select").value)), find("force-select").value));
  find("open-city-search").addEventListener("click", openMapSearch);
  find("city-search").addEventListener("input", () => { pages["city-search"] = 0; renderMapSearch(); });
  find("city-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    find("city-search-results").querySelector("button")?.click();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
      || event.target.closest?.("input, select, textarea, [contenteditable], dialog")) return;
    event.preventDefault();
    showView("map");
    openMapSearch();
  });
  find("open-theaters").addEventListener("click", () => { find("menu-dialog").close(); theaterPanel.open(); });
  find("open-war").addEventListener("click", () => { find("menu-dialog").close(); warPanel.open(); });
  find("open-polity").addEventListener("click", () => { find("menu-dialog").close(); polityPanel.open(); });
  find("council-open-polity").addEventListener("click", () => { find("campaign-council").close(); polityPanel.open(); });
  find("open-realm").addEventListener("click", () => { find("menu-dialog").close(); realmPanel.open(); });
  find("open-realm-ledger").addEventListener("click", () => { find("finance-dialog").close(); realmPanel.open("ledger"); });
  find("open-recruitment").addEventListener("click", () => {
    find("menu-dialog").close();
    find("recruitment-status").hidden = true;
    renderRecruitment();
    find("recruitment-dialog").showModal();
  });
  find("open-ending-record").addEventListener("click", () => {
    reviewPane = "realm";
    pages["ending-review"] = 0;
    renderEndingRecord();
    find("ending-record-dialog").showModal();
  });
  find("conclude-scenario").addEventListener("click", () => {
    mutate(() => concludeScenario(world, state), "已达成剧本结局。");
    openOutcome();
    renderEndingRecord();
  });
  for (const button of find("review-tabs").querySelectorAll("button")) button.addEventListener("click", () => {
    reviewPane = button.dataset.reviewPane;
    pages["ending-review"] = 0;
    renderEndingRecord();
  });
  find("open-armies").addEventListener("click", () => {
    find("menu-dialog").close();
    armyPanel.open();
  });
  for (const zone of ["front", "rear"]) {
    find("national-" + zone + "-focus").replaceChildren(...Object.entries(focusLabels).map(([value, name]) => new Option(name, value)));
  }
  find("open-campaign-council").addEventListener("click", () => {
    find("menu-dialog").close();
    openCouncil(state.campaignEvents?.pending ? "events" : "route");
  });
  find("holdings-council").addEventListener("click", () => openCouncil("policy"));
  find("outcome-council").addEventListener("click", () => openCouncil("route"));
  for (const button of find("council-switch").querySelectorAll("button")) {
    button.addEventListener("click", () => showCouncilPane(button.dataset.councilPane));
  }
  find("council-policy").addEventListener("submit", (event) => {
    event.preventDefault();
    const policy = Object.fromEntries(["front", "rear"].map((zone) => [zone, {
      focus: find("national-" + zone + "-focus").value,
      budget: find("national-" + zone + "-budget").valueAsNumber,
      garrison: find("national-" + zone + "-garrison").valueAsNumber,
    }]));
    const reserve = { treasury: find("national-treasury").valueAsNumber, grain: find("national-grain").valueAsNumber };
    mutate(() => setDelegationReserve(setNationalPolicy(state, policy), reserve), "已保存常设国策。");
    fillNationalPolicy();
  });
  find("stop-national-policy").addEventListener("click", () => {
    mutate(() => setNationalPolicy(state, null), "已停止按国策分区，各城沿用现有委任。");
    fillNationalPolicy();
  });
  for (const [id, accepted] of [["accept-campaign-event", true], ["decline-campaign-event", false]]) {
    find(id).addEventListener("click", () => {
      mutate(() => answerCampaignEvent(world, era(), state, accepted), accepted ? "已接受事件。" : "已婉拒事件。");
      renderCouncilEvents();
    });
  }
  find("person-open-service").addEventListener("click", () => {
    renderOfficerService();
    find("person-service-dialog").showModal();
  });
  find("era-select").replaceChildren(...[...world.scenarios].sort((a, b) => a.year - b.year)
    .map(({ year, title }) => new Option(title + " · " + year + " 年", year)));
  syncStartFields();
  find("era-select").addEventListener("change", () => {
    updateDraftFactions();
    renderCampaignPreview();
  });
  find("force-select").addEventListener("change", renderCampaignPreview);
  for (const button of find("campaign-panes").querySelectorAll("button")) {
    button.addEventListener("click", () => showCampaignPane(button.dataset.campaignPane));
  }
  find("campaign-roster-sort").addEventListener("change", () => {
    pages["campaign-roster"] = 0;
    renderCampaignDetails();
  });
  find("open-campaign").addEventListener("click", openCampaign);
  find("campaign-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      replaceGame(campaignOpening);
      find("campaign-dialog").close();
      if (keepProgress()) notify("已开局 · " + factionName(era(), state.player));
    } catch (error) {
      notify(error.message, true);
    }
  });

  find("open-menu").addEventListener("click", () => find("menu-dialog").showModal());
  find("open-game-guide").addEventListener("click", openGameGuide);
  find("guide-open-campaign").addEventListener("click", openCampaign);
  find("guide-open-model").addEventListener("click", openModelSettings);
  find("open-saves").addEventListener("click", () => {
    find("menu-dialog").close();
    openSaveManager();
  });
  find("manual-save-slot").addEventListener("change", () => { renderManualSlot(); saveFileMessage(""); });
  find("write-manual-slot").addEventListener("click", () => {
    importRevision += 1;
    const key = selectedManualSlot();
    try {
      const previous = localStorage.getItem(key);
      if (previous === null) saveToManualSlot(key);
      else {
        stagedOverwrite = { key, previous };
        find("save-overwrite-label").textContent = "覆盖槽 " + (manualSlots.indexOf(key) + 1) + "中的战局？";
        showSavePane("overwrite");
        saveFileMessage("");
        find("cancel-slot-overwrite").focus();
      }
    } catch (error) { saveFileMessage(error.message, true); }
  });
  find("cancel-slot-overwrite").addEventListener("click", () => {
    stagedOverwrite = undefined;
    showSavePane("main");
    find("write-manual-slot").focus();
  });
  find("confirm-slot-overwrite").addEventListener("click", () => {
    if (!stagedOverwrite) return;
    const { key, previous } = stagedOverwrite;
    try {
      if (localStorage.getItem(key) !== previous) {
        stagedOverwrite = undefined;
        showSavePane("main");
        renderManualSlot();
        saveFileMessage("该槽刚有更新，请核对后再存入。", true);
        return;
      }
      saveToManualSlot(key);
      find("write-manual-slot").focus();
    } catch (error) { saveFileMessage(error.message, true); }
  });
  find("load-manual-slot").addEventListener("click", () => {
    try {
      const record = readSave(selectedManualSlot());
      if (!record) throw new Error("该槽尚未存档。");
      localStorage.setItem(autoSlot, JSON.stringify(record));
      replaceGame(record.state, record.selected);
      find("saves-dialog").close();
      notify("已载入 · " + describeSave(state));
    } catch (error) { saveFileMessage(error.message, true); }
  });
  for (const id of ["export-current", "export-manual"]) {
    find(id).addEventListener("click", () => {
      try {
        const record = id === "export-manual" ? readSave(selectedManualSlot()) : { state, selected };
        if (!record) throw new Error("没有可导出的存档。");
        downloadSave(record);
        saveFileMessage("已生成 JSON 备份。");
      } catch (error) {
        saveFileMessage(error.message, true);
      }
    });
  }
  find("choose-save-file").addEventListener("click", () => find("save-file").click());
  find("save-file").addEventListener("change", (event) => {
    readBackupFile(event.target.files[0]);
    event.target.value = "";
  });
  find("saves-dialog").addEventListener("close", () => {
    importRevision += 1;
    stagedBackup = undefined;
    stagedOverwrite = undefined;
    showSavePane("main");
  });
  find("cancel-import").addEventListener("click", () => {
    stagedBackup = undefined;
    showSavePane("main");
    find("choose-save-file").focus();
  });
  find("confirm-import").addEventListener("click", () => {
    const backup = stagedBackup;
    if (!backup) return;
    try {
      localStorage.setItem(autoSlot, JSON.stringify(backup));
      replaceGame(backup.state, backup.selected);
      find("saves-dialog").close();
      notify("已载入备份 · " + describeSave(state));
    } catch (error) {
      saveFileMessage(error.message, true);
    }
  });
  find("open-outcome").addEventListener("click", () => {
    find("menu-dialog").close();
    openOutcome();
  });
  find("outcome-stage-details").addEventListener("click", openStageDetails);
  find("open-stage-details").addEventListener("click", openStageDetails);
  find("stage-open-expeditions").addEventListener("click", () => {
    find("stage-detail-dialog").close();
    closeStageParents();
    openFrontier();
    openAttackOpportunities();
  });
  find("outcome-restart").addEventListener("click", () => {
    find("outcome-dialog").close();
    openCampaign();
  });
  find("outcome-map").addEventListener("click", () => {
    find("outcome-dialog").close();
    showView("map");
    map.reset();
  });
  for (const button of document.querySelectorAll("[data-close]")) {
    button.addEventListener("click", () => find(button.dataset.close).close());
  }
  find("save-game").addEventListener("click", () => {
    find("menu-dialog").close();
    try {
      writeSave(manualSlot);
      notify("已存档 · " + state.year + " 年开局 · " + seasonTitle(state.turn));
    } catch {
      notify("存档写入失败。", true);
    }
  });
  find("load-game").addEventListener("click", () => {
    find("menu-dialog").close();
    try {
      const saved = readSave(manualSlot);
      if (!saved) {
        notify("还没有手动存档。");
        return;
      }
      replaceGame(saved.state, saved.selected);
      if (keepProgress()) notify("已读档 · " + seasonTitle(state.turn));
    } catch (error) {
      notify("读取失败。 " + error.message, true);
    }
  });
  find("advance").addEventListener("click", takeTurn);
  find("open-model-settings").addEventListener("click", () => {
    find("menu-dialog").close();
    openModelSettings();
  });
  find("close-model-settings").addEventListener("click", () => find("model-settings").close());
  find("model-settings").addEventListener("close", () => { find("model-api-key").value = ""; });
  find("model-settings").addEventListener("cancel", (event) => { if (editingModel) event.preventDefault(); });
  find("read-models").addEventListener("click", () => submitModelSettings("models"));
  find("test-model-connection").addEventListener("click", () => submitModelSettings("test"));
  find("model-settings-form").addEventListener("input", () => modelMessage(""));
  find("model-settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitModelSettings("settings");
  });
  find("opponent-mode").addEventListener("change", (event) => {
    try { localStorage.setItem(opponentModeSlot, event.target.value); } catch { /* optional preference */ }
    renderForces();
  });
  window.addEventListener("focus", discoverModel);
  find("city-picker").addEventListener("change", (event) => selectMapCity(event.target.value, true));
  for (const layer of document.querySelectorAll("[data-map-layer]")) {
    layer.addEventListener("click", () => {
      cityCommand?.close();
      map.reset(layer.dataset.mapLayer);
    });
  }
  find("zoom-in").addEventListener("click", () => map.zoom(1.32));
  find("zoom-out").addEventListener("click", () => map.zoom(1 / 1.32));

  const tabs = [...document.querySelectorAll("[data-tab]")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      selectTab(tabs[(index + delta + tabs.length) % tabs.length].dataset.tab, true);
    });
  });
  for (const role of ["governor", "commander"]) {
    find(role).addEventListener("change", (event) => {
      mutate(() => appoint(world, state, selected, role, event.target.value || null));
    });
  }
  for (const id of ["mode", "focus", "delegate-budget"]) {
    find(id).addEventListener("change", () => {
      const budget = find("delegate-budget");
      mutate(() => setGovernance(state, selected, find("mode").value, find("focus").value,
        budget.value === "" && !budget.validity.badInput ? null : budget.valueAsNumber));
    });
  }
  find("preview-city-program").addEventListener("click", () => {
    selectFinance("forecast", "programs", selected);
    find("finance-dialog").showModal();
    find("finance-program-list").querySelector(`[data-city="${selected}"] button`)?.focus();
  });
  find("domestic-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const project = find("domestic-order").value;
    const order = project === "recruit" ? { type: "recruit", city: selected } : { type: "build", city: selected, project };
    mutate(() => queueOrder(world, state, order), "已下达政令 · " + describeOrder(order));
  });
  find("go-origin").addEventListener("click", () => selectCity(find("origin-picker").value, true));
  for (const id of ["target-picker", "officer-picker", "troops"]) {
    find(id).addEventListener("input", () => {
      attackDraft = readAttack();
      updateForecast();
      renderMap();
    });
  }
  find("attack-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const order = readAttack();
    mutate(() => queueOrder(world, state, order), "已下达出征令 · " + describeOrder(order));
  });
  for (const id of ["transfer-target", "transfer-troops"]) {
    find(id).addEventListener("input", () => {
      transferDraft = readTransfer();
      updateTransfer();
      renderMap();
    });
  }
  find("transfer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const order = readTransfer();
    mutate(() => queueOrder(world, state, order), "已下达调兵令 · " + describeOrder(order));
  });
}

function selectReport(type, filters) {
  reportType = type;
  pages.reports = 0;
  pages.summary = 0;
  for (const button of document.querySelectorAll("[data-report]")) {
    button.setAttribute("aria-pressed", String(button.dataset.report === type));
  }
  renderReports(filters);
}

function openChronicle({ section = "summary", faction = "all", turn = "" } = {}) {
  find("chronicle-turn").value = "";
  find("chronicle-faction").value = "all";
  find("chronicle-category").value = "all";
  find("chronicle-close").textContent = find("opponent-brief-dialog").open ? "返回简报" : find("game-guide").open ? "返回指引" : "关闭";
  selectReport(section, { faction, turn });
  find("chronicle").showModal();
}

function wirePanels() {
  find("open-advice").addEventListener("click", openAdvice);
  find("guide-open-governance").addEventListener("click", openDelegationGroups);
  find("guide-open-advice").addEventListener("click", openAdvice);
  find("guide-open-orders").addEventListener("click", () => openOrdersDialog());
  find("guide-open-reports").addEventListener("click", () => openChronicle());
  find("open-finance").addEventListener("click", () => openFinanceDialog());
  for (const button of document.querySelectorAll("[data-finance-mode], [data-finance-view]")) {
    button.addEventListener("click", () => selectFinance(button.dataset.financeMode || financeMode, button.dataset.financeView || financeView));
  }
  find("open-delegation-reserve").addEventListener("click", openDelegationReserve);
  find("open-budget-top-up").addEventListener("click", openBudgetTopUp);
  find("confirm-budget-top-up").addEventListener("click", confirmBudgetTopUp);
  for (const button of document.querySelectorAll("[data-budget-top-up]")) {
    button.addEventListener("click", () => {
      budgetTopUpPane = button.dataset.budgetTopUp;
      pages["budget-top-up"] = 0;
      renderBudgetTopUp();
    });
  }
  find("open-finance-trend").addEventListener("click", openFinanceTrend);
  find("finance-trend-open-ledger").addEventListener("click", () => openFinanceTrendLedger());
  for (const button of document.querySelectorAll("[data-finance-trend]")) {
    button.addEventListener("click", () => {
      financeTrendView = button.dataset.financeTrend;
      renderFinanceTrend();
    });
  }
  find("reserve-form").addEventListener("input", resetReservePreview);
  find("reserve-form").addEventListener("submit", previewDelegationReserve);
  find("apply-reserve").addEventListener("click", applyDelegationReserve);
  find("finance-turn").addEventListener("change", () => {
    pages.finance = 0;
    renderFinance();
  });
  find("finance-program-filter").addEventListener("change", (event) => {
    financeProgramFilter = event.target.value;
    pages.finance = 0;
    renderFinance();
  });
  find("open-frontier").addEventListener("click", openFrontier);
  find("open-attack-opportunities").addEventListener("click", () => openAttackOpportunities());
  find("open-expedition-plan").addEventListener("click", openExpeditionPlan);
  find("expedition-plan-limit").addEventListener("change", refreshExpeditionPlan);
  find("confirm-expedition-plan").addEventListener("click", applyExpeditionPlan);
  find("open-defense-pressure").addEventListener("click", openDefensePressure);
  find("holdings-frontier").addEventListener("click", () => {
    find("holdings-dialog").close();
    openFrontier();
  });
  find("open-garrisons").addEventListener("click", openGarrisons);
  find("open-reinforcement-plan").addEventListener("click", openReinforcementPlan);
  find("refresh-reinforcement-plan").addEventListener("click", refreshReinforcementPlan);
  find("confirm-reinforcement-plan").addEventListener("click", applyReinforcementPlan);
  for (const button of document.querySelectorAll("[data-reinforcement-pane]")) button.addEventListener("click", () => {
    if (reinforcementPane === button.dataset.reinforcementPane) return;
    reinforcementPane = button.dataset.reinforcementPane;
    pages["reinforcement-plan"] = 0;
    renderReinforcementPlan();
  });
  find("garrison-target").addEventListener("input", (event) => {
    const target = event.target.valueAsNumber;
    if (!event.target.validity.valid || !Number.isSafeInteger(target)) return;
    garrisonTarget = target;
    pages.garrisons = 0;
    renderGarrisons();
  });
  find("garrison-target").addEventListener("change", (event) => {
    if (!event.target.validity.valid) event.target.value = garrisonTarget;
  });
  find("frontier-city").addEventListener("change", () => {
    pages.frontier = 0;
    renderFrontier();
  });
  find("frontier-map").addEventListener("click", () => locateOnMap(find("frontier-city").value, "frontier-dialog"));
  find("frontier-joint").addEventListener("click", () => openJointPlan());
  find("joint-from").addEventListener("change", fillJointOrigin);
  find("joint-support").addEventListener("change", fillJointTroops);
  for (const id of ["joint-target", "joint-officer"]) find(id).addEventListener("change", updateJointPreview);
  for (const id of ["joint-support-troops", "joint-attack-troops"]) find(id).addEventListener("input", updateJointPreview);
  find("return-frontier").addEventListener("click", () => {
    find("joint-dialog").close();
    renderFrontier(find("joint-from").value);
    find("frontier-dialog").showModal();
  });
  find("joint-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const { queued } = planJointOrders(world, state, jointDraft());
      find("joint-dialog").close();
      mutate(() => queued, "已依序加入调兵和出征。");
      openOrdersDialog();
    } catch (error) {
      showJointError(error.message);
    }
  });
  for (const button of document.querySelectorAll("[data-frontier-tab]")) {
    button.addEventListener("click", () => {
      selectFrontierTab(button.dataset.frontierTab);
      renderFrontier();
    });
  }
  find("open-holdings").addEventListener("click", () => openHoldings());
  find("open-occupation-plan").addEventListener("click", openOccupationPlan);
  find("confirm-occupation-plan").addEventListener("click", applyOccupationPlan);
  find("open-occupation-governors").addEventListener("click", openOccupationGovernors);
  find("confirm-occupation-governors").addEventListener("click", applyOccupationGovernors);
  find("open-takeover-plan").addEventListener("click", openTakeoverPlan);
  find("confirm-takeover-plan").addEventListener("click", confirmTakeoverPlan);
  for (const button of document.querySelectorAll("[data-occupation-pane]")) {
    button.addEventListener("click", () => {
      occupationPane = button.dataset.occupationPane;
      pages["occupation-plan"] = 0;
      renderOccupationPlan();
    });
  }
  find("open-vacancies").addEventListener("click", openVacancies);
  for (const id of ["vacancy-role", "vacancy-area"]) find(id).addEventListener("change", () => {
    pages.vacancies = 0;
    renderVacancies();
  });
  for (const id of ["holdings-filter", "holdings-sort"]) find(id).addEventListener("change", () => {
    pages.holdings = 0;
    renderHoldings();
  });
  find("delegate-holdings").addEventListener("click", () => {
    const keys = matchingHoldings().map(({ city }) => city.key);
    find("holdings-dialog").close();
    openBatch(keys);
  });
  find("open-delegation-groups").addEventListener("click", openDelegationGroups);
  find("zone-preset").addEventListener("change", selectZonePreset);
  find("compare-zone-presets").addEventListener("click", openZoneComparison);
  find("delegation-groups-form").addEventListener("input", (event) => {
    const preset = find("zone-preset");
    if (event.target === preset) return;
    preset.value = "";
    updateZoneBudgetFields();
  });
  find("delegation-groups-form").addEventListener("submit", (event) => {
    event.preventDefault();
    openDelegationGroupsPreview();
  });
  for (const button of document.querySelectorAll("[data-delegation-zone]")) {
    button.addEventListener("click", () => {
      activeZone = button.dataset.delegationZone;
      pages["zone-preview"] = 0;
      renderDelegationGroupsPreview();
    });
  }
  find("apply-delegation-groups").addEventListener("click", applyDelegationGroups);
  find("open-delegation-priority").addEventListener("click", openDelegationPriority);
  find("clear-priority").addEventListener("click", () => {
    priorityDraft.clear();
    find("priority-error").hidden = true;
    renderDelegationPriority();
  });
  find("priority-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const next = setDelegationPriority(state, [...priorityDraft]);
      find("priority-dialog").close();
      mutate(() => next, "已保存委任优先级。");
    } catch (error) {
      batchMessage("priority-error", error.message);
    }
  });
  find("open-roster").addEventListener("click", () => openRoster());
  for (const [id, event] of [["roster-search", "input"], ["roster-filter", "change"], ["roster-sort", "change"]]) {
    find(id).addEventListener(event, () => {
      pages.roster = 0;
      renderRoster();
    });
  }
  find("assignment-role").addEventListener("change", () => renderAssignmentCities(find("assignment-city").value));
  find("assignment-city").addEventListener("change", renderAssignmentPreview);
  find("assignment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (find("confirm-assignment").disabled) return;
    const target = find("roster-dialog").open && rosterTarget?.fromVacancies ? rosterTarget : null;
    const role = target?.role ?? find("assignment-role").value;
    const city = target?.city ?? find("assignment-city").value;
    try {
      const next = usePersonnel(world, state, personnelCandidate.key, role, city);
      find("assignment-dialog").close();
      if (target) {
        if (find("person-dialog").open) showDetail(null);
        detailHistory.length = 0;
        find("roster-dialog").close();
      }
      if (role === rosterTarget?.role && city === rosterTarget.city) rosterTarget = undefined;
      mutate(() => next);
      const message = "已" + assignmentDescription(personnelCandidate, role, city) + "。";
      const feedback = target ? find("vacancies-status") : find("person-dialog").open ? find("person-feedback") : find("roster-status");
      if (feedback.id === "person-feedback") {
        feedback.textContent = message;
        feedback.hidden = false;
      } else feedback.textContent += " · " + message;
      feedback.focus();
    } catch (error) {
      const preview = find("assignment-preview");
      preview.textContent = error.message;
      preview.dataset.error = "true";
    }
  });
  const kinds = Object.entries(treatyTerms).map(([kind, term]) => new Option(term.name, kind));
  find("diplomacy-kind").replaceChildren(...kinds);
  find("open-diplomacy").addEventListener("click", () => openDiplomacyDialog());
  for (const button of document.querySelectorAll("[data-diplomacy-tab]")) {
    button.addEventListener("click", () => selectDiplomacyPane(button.dataset.diplomacyTab));
  }
  for (const id of ["diplomacy-kind", "diplomacy-target"]) find(id).addEventListener("change", renderDiplomacyOffer);
  for (const [id, accepted] of [["accept-treaty", true], ["decline-treaty", false]]) {
    find(id).addEventListener("click", () => {
      try {
        const next = respondToTreaty(world, state, accepted);
        mutate(() => next);
      } catch (error) {
        find("inbox-status").textContent = error.message;
      }
      find("inbox-status").focus();
    });
  }
  find("diplomacy-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const next = sendTreatyOffer(world, state, find("diplomacy-target").value, find("diplomacy-kind").value);
      mutate(() => next);
    } catch (error) {
      const response = find("diplomacy-response");
      response.dataset.agreed = "false";
      response.textContent = error.message;
    }
  });
  find("open-orders").addEventListener("click", () => openOrdersDialog());
  find("toggle-order-preview").addEventListener("click", () => {
    orderPreview = !orderPreview;
    find("orders-status").hidden = true;
    renderQueuedOrder();
  });
  for (const button of document.querySelectorAll("#view-switcher [data-view]")) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }
  find("inspect-city").addEventListener("click", () => showView("city"));
  find("officer-filter").addEventListener("input", () => {
    pages.officers = 0;
    renderOfficers();
  });
  find("open-chronicle").addEventListener("click", () => openChronicle());
  for (const pane of Object.keys(opponentPanes)) {
    find(pane + "-toggle").addEventListener("click", () => {
      showOpponentPane(briefPane === pane ? "opponent-brief-overview" : pane);
    });
  }
  for (const [id, event] of [["opponent-city-search", "input"], ["opponent-city-sort", "change"]]) {
    find(id).addEventListener(event, () => {
      pages["opponent-cities"] = 0;
      renderOpponentCities();
    });
  }
  find("opponent-cities-opportunities").addEventListener("click", () => openAttackOpportunities(briefFaction));
  find("opponent-brief-locate").addEventListener("click", (event) => {
    const { city } = event.currentTarget.dataset;
    if (city) locateOnMap(city, "opponent-brief-dialog");
  });
  find("opponent-brief-reports").addEventListener("click", (event) => {
    openChronicle({ section: event.currentTarget.dataset.section, faction: briefFaction, turn: "all" });
  });
  find("summary-finance").addEventListener("click", () => {
    const report = latestSeasonSummary(state);
    if (!report?.balance) return;
    find("chronicle").close();
    openFinanceDialog(report.turn);
  });
  find("summary-diplomacy").addEventListener("click", () => {
    if (!latestSeasonSummary(state)?.envoy) return;
    find("chronicle").close();
    openDiplomacyDialog("incoming");
  });
  for (const id of ["chronicle-turn", "chronicle-faction", "chronicle-category"]) find(id).addEventListener("change", () => {
    pages.reports = 0;
    renderReports();
  });
  for (const button of document.querySelectorAll("[data-report]")) {
    button.addEventListener("click", () => selectReport(button.dataset.report));
  }
  for (const button of document.querySelectorAll("[data-battle-pane]")) {
    button.addEventListener("click", () => {
      detailView.pane = button.dataset.battlePane;
      renderBattlePane(detailView.pane);
    });
  }
  for (const button of document.querySelectorAll("[data-person-history]")) {
    button.addEventListener("click", () => {
      if ((detailView.historyMode ?? "all") === button.dataset.personHistory) return;
      detailView.historyMode = button.dataset.personHistory;
      detailView.page = 0;
      renderPersonProfile();
    });
  }
  for (const id of ["battle-back", "person-back"]) find(id).addEventListener("click", backFromDetail);
  for (const id of ["battle-dialog", "person-dialog"]) find(id).addEventListener("cancel", (event) => {
    event.preventDefault();
    backFromDetail();
  });
  find("battle-retreat-map").addEventListener("click", () => locateFromDetail(detailView.entry.battle.occupation.retreatTo));
  find("person-locate").addEventListener("click", () => locateFromDetail(state.stations[detailView.officer]));
  find("person-orders").addEventListener("click", () => openOrdersDialog(detailView.officer));
  find("person-assign").addEventListener("click", () => {
    const person = era().officers.find(({ key }) => key === detailView.officer);
    openPersonnelAssignment(person);
  });
  find("person-reassign").addEventListener("click", () => openReassignment(detailView.officer));
  find("reassignment-target").addEventListener("change", renderReassignmentPreview);
  find("reassignment-form").addEventListener("submit", applyReassignment);
  find("open-batch").addEventListener("click", () => openBatch([selected]));
  find("batch-all").addEventListener("click", () => {
    for (const { key } of world.cities) if (state.cities[key].owner === state.player) batchCities.add(key);
    renderBatch();
  });
  find("batch-clear").addEventListener("click", () => {
    batchCities.clear();
    renderBatch();
  });
  find("preview-batch").addEventListener("click", openBatchPreview);
  find("apply-preview-batch").addEventListener("click", applyBatch);
  for (const id of ["batch-focus", "batch-budget"]) {
    find(id).addEventListener("input", () => { find("batch-status").hidden = true; });
  }
  find("batch-form").addEventListener("submit", (event) => {
    event.preventDefault();
    applyBatch();
  });
  window.addEventListener("resize", () => {
    renderForces();
    if (activeTab === "officers") renderOfficers();
    if (find("campaign-dialog").open) renderCampaignDetails();
    if (find("opponent-brief-dialog").open && briefPane !== "opponent-brief-overview") renderOpponentBrief();
    if (find("chronicle").open) renderReports();
    if (find("advice-dialog").open) renderAdvice();
    if (find("city-search-dialog").open) renderMapSearch();
    if (find("battle-dialog").open && !find("battle-personnel").hidden) renderBattlePersonnel();
    if (find("person-dialog").open) renderPersonProfile();
    if (find("orders-dialog").open && orderPreview) renderOrderPreview();
    if (find("batch-dialog").open) renderBatch();
    if (find("batch-preview-dialog").open) renderBatchPreview();
    if (find("delegation-groups-preview").open) renderDelegationGroupsPreview();
    if (find("delegation-comparison").open) renderZoneComparison();
    if (find("holdings-dialog").open) renderHoldings();
    if (find("stage-detail-dialog").open) renderStageDetails();
    if (find("campaign-council").open && councilPane === "alerts") renderNationalAlerts();
    if (find("occupation-plan-dialog").open) renderOccupationPlan();
    if (find("occupation-governors-dialog").open) renderOccupationGovernors();
    if (find("takeover-plan-dialog").open) renderTakeoverPlan();
    if (find("garrisons-dialog").open) renderGarrisons();
    if (find("reinforcement-plan-dialog").open) renderReinforcementPlan();
    if (find("vacancies-dialog").open) renderVacancies();
    if (find("priority-dialog").open) renderDelegationPriority();
    if (find("roster-dialog").open) renderRoster();
    if (find("finance-dialog").open) renderFinance();
    if (find("budget-top-up-dialog").open) renderBudgetTopUp();
    if (find("reserve-dialog").open && reserveForecast) renderReservePreview();
    if (find("frontier-dialog").open) renderFrontier();
    if (find("attack-opportunities-dialog").open) renderAttackOpportunities();
    if (find("expedition-plan-dialog").open) renderExpeditionPlan();
    if (find("defense-pressure-dialog").open) renderDefensePressure();
  });
}

async function start() {
  const data = await fetch(new URL("./assets/world.json", import.meta.url));
  if (!data.ok) throw new Error("地图数据加载失败。");
  oldWorld = await data.json();
  world = enrichWorld(oldWorld);
  if (world.cities.length !== 42) throw new Error("地图数据需要包含 42 座主城。");
  try {
    const saved = readSave(autoSlot);
    if (saved) ({ state, selected } = saved);
  } catch (error) {
    notify("自动存档无法读取，已载入初始剧本。 " + error.message, true);
  }
  state ??= createGame(world, 199, "cao", { landscape: true });
  selected ??= state.year === 199 && state.player === "cao" ? "luoyang" : firstCity(world, state);
  find("boot").hidden = true;
  find("workspace").hidden = false;
  armyPanel = createArmyPanel(world, {
    snapshot: () => ({ state, planned, selected }),
    commit: (next, message) => mutate(() => next, message),
    locate: (key) => locateOnMap(key, "army-dialog"),
  });
  pages["ending-review"] = 0;
  theaterPanel = createTheaterPanel(world, {
    snapshot: () => ({ state, selected }),
    commit: (next, message) => mutate(() => next, message),
    locate: (key) => locateOnMap(key, "theater-dialog"),
    campaign: (id) => warPanel.open("plans", id),
  });
  realmPanel = createRealmPanel(world, {
    snapshot: () => ({ state, era: era(), selected }),
    commit: (next, message) => mutate(() => next, message),
    locateRoad: (route, blocked) => {
      locateOnMap(blocked || route[0], "realm-dialog");
      map.showTrade(route, blocked);
    },
    conclude: () => {
      mutate(() => concludeCoalition(world, state), "已确认联盟结局。");
      if (state.scenarioEnding?.kind !== "coalition") return;
      find("realm-dialog").close();
      openOutcome();
    },
    seasonTitle,
    statList,
  });
  warPanel = createWarPanel(world, {
    snapshot: () => ({ state, era: era(), selected }),
    commit: (next, message) => mutate(() => next, message),
    locate: (key, route) => {
      locateOnMap(key, "war-dialog");
      if (route) map.showWarRoute(route);
    },
    theater: (id, pane) => { find("war-dialog").close(); theaterPanel.open(id, pane); },
    army: (officer) => { find("war-dialog").close(); armyPanel.open(officer); },
    seasonTitle,
  });
  polityPanel = createPolityPanel(world, {
    snapshot: () => ({ state, era: era() }),
    commit: (next, message) => mutate(() => next, message),
    locate: (key) => locateOnMap(key, "polity-dialog"),
    conclude: () => {
      mutate(() => concludePeace(world, state), "已确认天下承平。");
      if (state.scenarioEnding?.kind !== "peace") return;
      find("polity-dialog").close();
      openOutcome();
    },
    seasonTitle,
  });
  grandPanel = createGrandPanel(world, {
    snapshot: () => ({ state, era: era(), selected }),
    commit: (next, message) => mutate(() => next, message),
    locate: (key, route, layer) => {
      locateOnMap(key, "grand-dialog");
      if (layer) map.setLayer(layer);
      if (route?.length > 1) map.showWarRoute(route);
    },
    classic(target) {
      if (target === "policy") openCouncil("policy");
      if (target === "war") warPanel.open();
      if (target === "diplomacy") openDiplomacyDialog();
    },
  });
  openingEditor = createOpeningEditor(world, (opening) => {
    replaceGame(opening);
    find("custom-opening-dialog").close();
    find("campaign-dialog").close();
    if (keepProgress()) notify("自定义战局已开局。");
  });
  map = createMap(world, find("map-stage"), clickMapCity, (layer) => {
    for (const button of document.querySelectorAll("[data-map-layer]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mapLayer === layer));
    }
    document.querySelector(".map-hint").textContent = layer === "roads"
      ? state.landscape ? "点关隘或粮道 · 红线为阻断" : "金色粮路 · 红色封控 · 方标粮仓" : "滚轮缩放 · 拖动地图";
  }, (officer) => state.landscape ? openLandscapeMap("army", officer) : armyPanel.open(officer),
  (id) => theaterPanel.open(id), (key) => state.landscape ? openLandscapeMap("gate", key) : grandPanel.open("road", key),
  (route) => openLandscapeMap("convoy", route));
  function openLandscapeMap(type, key) {
    cityCommand?.close();
    landscapeMap.open(type, key);
  }
  landscapeMap = createLandscapeMap(world, {
    snapshot: () => ({ state, era: era() }),
    commit: (next, message) => mutate(() => next, message),
    redraw: renderMap,
    showCities: () => map.setLayer("cities"),
  });
  landscapeDesk = createLandscapeDesk(world, {
    snapshot: () => ({ state, era: era() }),
    commit: (next, message) => mutate(() => next, message),
    locate(layer, key, from) {
      if (key) locateOnMap(key, "landscape-dialog");
      else showView("map");
      map.setLayer(layer);
      if (from && from !== key) map.showWarRoute([from, key]);
    },
    original: (key) => grandPanel.open(key),
    upgrade: () => mutate(() => enableLandscape(world, state.grand ? state : enableGrand(world, state)), "已将当前战局升级至山河变局。"),
  });
  cityCommand = createCityCommand(world, {
    snapshot: () => ({ state, planned, era: era(), selected }),
    commit: (next, message) => mutate(() => next, message),
    showDetails: () => showView("city"),
    showCities: () => map.setLayer("cities"),
    openLandscape: openLandscapeMap,
    redraw: renderMap,
  });
  wireControls();
  wirePanels();
  find("view-switcher").hidden = false;
  find("command-dock").hidden = false;
  showView("map");
  selectTab("governance");
  render();
  discoverModel();
}

start().catch((error) => {
  find("boot").hidden = false;
  find("boot").textContent = error.message;
});
