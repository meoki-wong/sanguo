import { allianceTrade, incomingTreatyBlock, isHostile, opponentTreaty, quoteTreaty, reviewAlliances, selectIncomingTreaty, treatyTerms, validDiplomacy } from "./diplomacy.js";
import { scenarioObjective } from "./objectives.js";
import { funds, openingLedger, programResults, spending, validLedger, validResourcePair } from "./finance.js";
import { assessGoal, compatibleGoal, factionPlans, validGoal, validGoalResult } from "./strategy.js";
import { awardService, officerSkill, settleCampaignEvent, settleCampaignRoute, settleCommandService, validCampaignProgress } from "./campaign.js";
import { armyByOfficer, armyGarrison, holdingArmies, mobilizationQuote, mobilizeArmy, settleArmies, validArmies } from "./armies.js";
import { defenseUnits, deployOpeningFormations, enableFrontline, formationOf, prepareFrontline, reconcileFormations, recordFormationLoss,
  recordTownBattle, settleReinforcementPromises, validFrontline } from "./frontline.js";
import { enableHighCommand, prepareCommand, settleCommand, settleCommandRecovery, validHighCommand } from "./high-command.js";
import { archiveDynasty, dynastyLevyRefused, dynastyTaxRate, enableDynasty, settleDynasty, validDynasty } from "./dynasty.js";
import { enableStrategy9, levyRate9, prepareStrategy9, schedulePassage9, settleStrategy9, validStrategy9 } from "./strategy-nine.js";
import { archiveReign, enableReign, prepareReign, settleReign, validReign } from "./reign.js";
import { adjustedHarvest15, archiveCentury, enableCentury, prepareCenturyYear, settleCentury, validCentury } from "./century.js";
import { taxSplit10 } from "./reign-economy.js";
import { dynastyYield } from "./dynasty-economy.js";
import { directTheaters, validTheaters } from "./theaters.js";
import { knownOfficer } from "./personnel.js";
import { recruitRivals } from "./recruitment.js";
import { recordCampaign, validEnding } from "./endgame.js";
import { beginWar, militaryView, settleIntelligence, validIntelligence } from "./war-intel.js";
import { appendWarReports, settleCampaignTasks, stances, validWarRecords, warBlockaded, warEvents } from "./war-operations.js";
import { finishWarRecovery, settleWarRecovery, validRecovery } from "./war-recovery.js";
import { polityEra } from "./polities-data.js";
import { enablePolity, recordPolity, settlePolity, validPolity } from "./polity.js";
import { settleAccords, updateCoalition, validAccords } from "./accords.js";
import { incomeFactor, nationalDuty, noteRecruitment, officeSkill, realmPolicy, settlePopulation, settleRealmOffices, startRealm, validRealm } from "./realm.js";
import { enableGrand, settleGrand, validGrand, validateOpening } from "./grand.js";
import { enableLandscape, settleLandscape, validLandscape } from "./landscape.js";
import { edgeWeather, weatherAllows } from "./landscape-terrain.js";
import { applyRegionalMandates, configureStatecraftOpening, enableStatecraft, prepareAdministration, settleStatecraft, statecraftLedger, validStatecraft } from "./statecraft.js";
import { settleCrisisOrders } from "./statecraft-personnel.js";
import { settleFrontCommands } from "./front-command.js";
import { reconcilePolities } from "./polity-handover.js";
import { enableSandtable, settleSandtable, validSandtable } from "./sandtable.js";
import { workforceYield } from "./sandtable-economy.js";
import { postTransit, settlePosts } from "./sandtable-posts.js";
import { authorizeWars } from "./sandtable-war.js";
import { directGrandCampaigns } from "./grand-campaign.js";

export const projects = {
  farming: { name: "屯田", cost: 18 },
  commerce: { name: "商贸", cost: 18 },
  defense: { name: "城防", cost: 22 },
};

export const cityReserve = 250;
export const seasonOrderLimit = 3;
export const minimumMarch = 200;
export const delegationPriorityLimit = 5;
export const turnVersion = 35;
const personnelHistoryLimit = 256;
const archivedQuarters = 12;
const transferHopLimit = 3;
const occupationSeasons = 2;
const delegatedGarrisonLimit = 2800;
export const recruitment = { troops: 600, treasury: 20, grain: 12 };
const developmentProjects = Object.keys(projects);
export const governanceFocus = [...developmentProjects, "recruit", "auto"];
export const seasons = ["春", "夏", "秋", "冬"];

const capitals = {
  199: { cao: "xu", yuan: "ye", zhang: "chengdu", biao: "xiangyang", lu: "nanzheng", ce: "moling", ma: "tianshui", gongsun: "xiangping" },
  262: { wei: "luoyang", shu: "chengdu", wu: "moling" },
  265: { jin: "luoyang", wu: "moling" },
};

export function eraByYear(world, year, turn) {
  const state = typeof year === "object" ? year : null;
  const origin = world.scenarios.find((era) => era.year === (state?.year ?? year));
  const base = origin && state?.grand?.custom ? { ...origin, title: state.grand.custom.title, ownership: state.grand.custom.ownership } : origin;
  return state?.polity && base ? polityEra(base, state, turn) : base;
}

export function playableFactions(era) {
  const owners = new Set([...Object.values(era.ownership), ...(era.emergent ?? [])]);
  return era.factions.filter(({ key }) => owners.has(key));
}

export function cityName(world, key) {
  return world.cities.find((entry) => entry.key === key)?.name || key;
}

export function factionName(era, key) {
  return era.factions.find((entry) => entry.key === key)?.name || "中立";
}

export function openingCapital(era, faction) {
  return era.capitals?.[faction] ?? capitals[era.year]?.[faction];
}

export function firstCity(world, state, faction = state.player) {
  const relocated = state.dynasty?.capitals[faction];
  const capital = state.cities[relocated]?.owner === faction ? relocated : openingCapital(eraByYear(world, state), faction);
  if (state.cities[capital]?.owner === faction) return capital;
  return world.cities.find(({ key }) => state.cities[key].owner === faction)?.key || world.cities[0].key;
}

export function cityIncome(city, population) {
  const factor = incomeFactor(population) / (city.occupation > 0 ? 200 : 100);
  return { treasury: Math.floor((4 + city.commerce * 3) * factor), grain: Math.floor((5 + city.farming * 4) * factor) };
}

export function cityRevenues(state, key) {
  const city = state.cities[key];
  const income = cityIncome(city, state.realm?.cities[key]);
  const yieldRate = dynastyYield(state, key);
  const taxRate = dynastyTaxRate(state, key) * levyRate9(state, key);
  const gross = {
    treasury: Math.floor((income.treasury * yieldRate.money + yieldRate.extra) * taxRate),
    grain: Math.floor((income.grain * yieldRate.grain + yieldRate.extra * 2) * workforceYield(state, key) * taxRate),
  };
  return taxSplit10(state, key, adjustedHarvest15(state, key, gross));
}

export function forceTotals(state, faction) {
  const total = { cities: 0, troops: 0, treasury: 0, grain: 0 };
  for (const [key, city] of Object.entries(state.cities)) {
    if (city.owner !== faction) continue;
    const income = cityRevenues(state, key);
    total.cities += 1;
    total.troops += city.troops;
    total.treasury += income.treasury;
    total.grain += income.grain;
  }
  total.treasury += allianceTrade(state, faction);
  return total;
}

function requireRule(condition, message) {
  if (!condition) throw new Error(message);
}

export function gameOutcome(state) {
  const cities = Object.values(state.cities);
  const controlled = cities.filter(({ owner }) => owner === state.player).length;
  if (controlled === 0) return "defeat";
  if (state.century?.concluded) return "victory";
  if (state.reign?.stewardship) return state.reign.stewardship.finished === null ? "ongoing" : "victory";
  if (state.scenarioEnding) return "victory";
  if (controlled === cities.length && (!state.dynasty || state.dynasty.continuity.unity >= 3)) return "victory";
  return "ongoing";
}

function requireCampaignOpen(state) {
  requireRule(gameOutcome(state) === "ongoing", "战局已结束。");
}

export function createGame(world, year, player, { realm = year === 208, war = false, polity = false, grand = false, landscape = false,
  statecraft = false, sandtable = false, frontline = false, highCommand = false, dynasty = false, strategic = false, reign = false, century = false, opening } = {}) {
  reign ||= century;
  strategic ||= reign;
  dynasty ||= strategic;
  highCommand ||= dynasty;
  const era = eraByYear(world, year);
  requireRule(era && era.factions.some(({ key }) => key === player), "请选择拥有主城的势力。");
  validateOpening(world, era, player, opening);
  const ownership = opening ? { ...era.ownership, ...opening.owners } : era.ownership;
  requireRule(Object.values(ownership).includes(player), "请选择拥有主城的势力。");
  const holdings = {};
  for (const [index, { key, links }] of world.cities.entries()) {
    const owner = ownership[key];
    const isCapital = key === openingCapital(era, owner);
    const border = links.some((neighbor) => ownership[neighbor] !== owner);
    holdings[key] = {
      owner,
      troops: isCapital ? 2450 : (border ? 1450 : 800) + ((index * 97 + year) % 390),
      farming: index % 4 === 0 ? 1 : 0,
      commerce: isCapital ? 1 : 0,
      defense: isCapital ? 2 : 1,
      occupation: 0,
      governor: null,
      commander: null,
      mode: "direct",
      focus: "farming",
      delegateBudget: null,
    };
  }
  const state = {
    version: 1,
    year,
    player,
    turn: 0,
    factions: Object.fromEntries(era.factions.map(({ key, stats }) => [
      key, { treasury: opening?.stocks[key]?.treasury ?? stats[0], grain: opening?.stocks[key]?.grain ?? stats[1], morale: stats[2] },
    ])),
    cities: holdings,
    orders: [],
    strategies: {},
    treaties: [],
    treatyOffers: [],
    incomingTreaty: null,
    stageCompletedAt: null,
    history: [],
  };

  for (const key of new Set(Object.values(ownership))) {
    if (key === player) continue;
    const seat = state.cities[firstCity(world, state, key)];
    const roster = era.officers.filter((person) => person.faction === key && knownOfficer(state, person));
    const administrator = [...roster].sort((a, b) => b.governance - a.governance)[0];
    const general = roster.filter(({ key }) => key !== administrator?.key).sort((a, b) => b.command - a.command)[0];
    if (administrator) seat.governor = administrator.key;
    if (general) seat.commander = general.key;
  }
  for (const [officer, city] of Object.entries(opening?.stations ?? {})) {
    const role = postingOf(state, officer);
    if (role && role.city !== city) holdings[role.city][role.role] = null;
  }
  state.stations = initialStations(world, era, state);
  Object.assign(state.stations, opening?.stations);
  const ready = realm ? startRealm(world, state) : state;
  const warfare = war ? beginWar(world, ready) : ready;
  if (grand || landscape || statecraft || sandtable || frontline || highCommand || opening) {
    const ready = enableGrand(world, warfare, opening ? { title: opening.title.trim(), ownership } : null);
    const terrain = landscape || statecraft || sandtable || frontline || highCommand ? enableLandscape(world, ready, opening) : ready;
    const governance = statecraft || sandtable || frontline || highCommand ? configureStatecraftOpening(world, enableStatecraft(terrain), opening?.command) : terrain;
    const sandbox = sandtable || frontline || highCommand ? enableSandtable(governance) : governance;
    if (!frontline && !highCommand) return sandbox;
    const campaign = enableFrontline(sandbox);
    if (!opening) deployOpeningFormations(world, campaign);
    const command = highCommand ? enableHighCommand(campaign) : campaign;
    const government = dynasty ? enableDynasty(command) : command;
    const strategy = strategic ? enableStrategy9(government) : government;
    const realm = reign ? enableReign(strategy) : strategy;
    return century ? enableCentury(realm) : realm;
  }
  return polity ? enablePolity(world, warfare) : warfare;
}

export function postingOf(state, officer) {
  for (const [city, site] of Object.entries(state.cities)) {
    if (site.governor === officer) return { city, role: "governor" };
    if (site.commander === officer) return { city, role: "commander" };
  }
  return null;
}

function owns(state, city, faction = state.player) {
  return Object.hasOwn(state.cities, city) && state.cities[city].owner === faction;
}

function initialStations(world, era, state) {
  const owned = new Map(era.factions.map(({ key }) => {
    const capital = firstCity(world, state, key);
    const cities = world.cities.filter((city) => owns(state, city.key, key)).map((city) => city.key);
    return [key, cities.includes(capital) ? [capital, ...cities.filter((city) => city !== capital)] : cities];
  }));
  const assigned = new Map();
  const stations = {};
  for (const person of era.officers) {
    const { key, faction } = person;
    if (!knownOfficer(state, person)) continue;
    const cities = owned.get(faction);
    const index = assigned.get(faction) || 0;
    const departure = pendingExpedition(state, key)?.from;
    const preferred = person.home ?? (key === "cao-1" ? "luoyang" : null);
    const home = owns(state, preferred, faction) ? preferred : cities[index % cities.length];
    stations[key] = postingOf(state, key)?.city || departure || home || null;
    assigned.set(faction, index + 1);
  }
  return stations;
}

export function pendingExpedition(state, officer) {
  return state.orders.find((order) => ["attack", "mobilize"].includes(order.type) && order.officer === officer);
}

export function availableForPosting(state, officer) {
  return Boolean(state.stations?.[officer]) && !nationalDuty(state, officer) && !postingOf(state, officer)
    && !pendingExpedition(state, officer) && !armyByOfficer(state, officer);
}

function personnelPosition(state, officer) {
  return { city: state.stations[officer] ?? null, role: postingOf(state, officer)?.role ?? null };
}

function personnelChanged(from, to) {
  return from.city !== to.city || from.role !== to.role;
}

function recordPersonnelChanges(next, previous, officers) {
  const changes = [];
  for (const officer of new Set(officers)) {
    if (!officer) continue;
    const from = personnelPosition(previous, officer);
    const to = personnelPosition(next, officer);
    if (personnelChanged(from, to)) changes.push({ officer, turn: next.turn, from, to });
  }
  if (changes.length) next.personnelHistory = [...(next.personnelHistory ?? []), ...changes].slice(-personnelHistoryLimit);
}

function writePosting(state, city, role, officer) {
  state.cities[city][role] = officer;
  if (officer) state.stations[officer] = city;
  if (!state.cities[city].governor) {
    state.cities[city].mode = "direct";
    removeDelegationPriority(state, city);
  }
}

export function appoint(world, state, city, role, officer) {
  requireCampaignOpen(state);
  requireRule(owns(state, city), "只能任命己方城池的人员。");
  requireRule(role === "governor" || role === "commander", "未知职务。");
  if (officer) {
    const era = eraByYear(world, state);
    const person = era.officers.find(({ key, faction }) => key === officer && faction === state.player);
    requireRule(person && knownOfficer(state, person), "请选择本势力已入仕的人员。");
    requireRule(!armyByOfficer(state, officer), "这名武将正在率领军团。");
    requireRule(!nationalDuty(state, officer), "请先解除这名人员的国级职务。");
    const posting = postingOf(state, officer);
    requireRule(!posting || (city === posting.city && role === posting.role), "这名人员已有职务。");
    const expedition = pendingExpedition(state, officer);
    if (expedition) {
      requireRule(role === "commander" && city === expedition.from && state.stations[officer] === city, "这名武将本季已领出征令。");
    }
  }
  const next = structuredClone(state);
  writePosting(next, city, role, officer || null);
  recordPersonnelChanges(next, state, [state.cities[city][role], officer]);
  return next;
}

export function reassignOfficer(world, state, officer, from, to) {
  requireCampaignOpen(state);
  const era = eraByYear(world, state);
  requireRule(era.officers.some(({ key, faction }) => key === officer && faction === state.player), "只能调整本势力人员的职务。");
  const posting = postingOf(state, officer);
  requireRule(posting && posting.city === from?.city && posting.role === from?.role && owns(state, posting.city), "原职务已变化，请重新查看人物档案。");
  requireRule(!pendingExpedition(state, officer), "这名武将本季已领出征令。");
  if (to !== null) {
    requireRule(to && (to.role === "governor" || to.role === "commander"), "请选择有效的目标职务。");
    requireRule(typeof to.city === "string" && owns(state, to.city), "只能调任至己方城池。");
    requireRule(!state.cities[to.city][to.role], "目标职务已有人担任。");
  }
  const next = structuredClone(state);
  writePosting(next, posting.city, posting.role, null);
  if (to) writePosting(next, to.city, to.role, officer);
  previewOrders(world, next);
  recordPersonnelChanges(next, state, [officer]);
  return next;
}

export function transferOfficer(world, state, officer, city) {
  requireCampaignOpen(state);
  const era = eraByYear(world, state);
  requireRule(owns(state, city) && era.officers.some((person) => person.key === officer && person.faction === state.player
    && knownOfficer(state, person)), "只能调任己方人员到己方城池。");
  requireRule(!postingOf(state, officer), "请先解除这名人员的职务。");
  requireRule(!armyByOfficer(state, officer), "这名武将正在率领军团。");
  requireRule(!pendingExpedition(state, officer), "这名武将本季已领出征令。");
  const next = { ...state, stations: { ...state.stations, [officer]: city } };
  recordPersonnelChanges(next, state, [officer]);
  return next;
}

function validBudget(budget) {
  return budget === null || (Number.isInteger(budget) && budget >= 0 && budget <= 100);
}

export function setGovernance(state, city, mode, focus, budget = state.cities[city]?.delegateBudget ?? null) {
  requireCampaignOpen(state);
  requireRule(owns(state, city), "只能调整己方城池的内政。");
  requireRule(mode === "direct" || mode === "delegated", "未知治理方式。");
  requireRule(governanceFocus.includes(focus), "未知建设方向。");
  requireRule(validBudget(budget), "每城预算须为 0 到 100 钱。");
  requireRule(mode !== "delegated" || state.cities[city].governor, "任命太守后可以委任。");
  const next = structuredClone(state);
  Object.assign(next.cities[city], { mode, focus, delegateBudget: budget });
  if (next.nationalPolicy) setPolicyCityOverride(next, city, true);
  if (mode === "direct") removeDelegationPriority(next, city);
  return next;
}

function validDelegationPriority(state, cities) {
  return Array.isArray(cities) && cities.length <= delegationPriorityLimit && new Set(cities).size === cities.length
    && cities.every((city) => typeof city === "string" && owns(state, city) && state.cities[city].mode === "delegated");
}

function removeDelegationPriority(state, city) {
  if (!state.delegationPriority?.includes(city)) return;
  const priorities = state.delegationPriority.filter((key) => key !== city);
  if (priorities.length) state.delegationPriority = priorities;
  else delete state.delegationPriority;
}

export function setDelegationPriority(state, cities) {
  requireCampaignOpen(state);
  requireRule(validDelegationPriority(state, cities), "请选择最多 " + delegationPriorityLimit + " 座己方已委任的城池。");
  const next = { ...state };
  if (cities.length) next.delegationPriority = [...cities];
  else delete next.delegationPriority;
  return next;
}

export function setDelegationReserve(state, reserve) {
  requireCampaignOpen(state);
  requireRule(validResourcePair(reserve), "委任预留须填写非负整数的钱与粮。");
  const next = { ...state };
  if (reserve.treasury || reserve.grain) next.delegationReserve = funds(reserve);
  else delete next.delegationReserve;
  return next;
}

function validNationalPolicy(policy) {
  return policy && ["front", "rear"].every((zone) => {
    const setting = policy[zone];
    return setting && governanceFocus.includes(setting.focus) && setting.budget !== null && validBudget(setting.budget)
      && Number.isInteger(setting.garrison) && setting.garrison >= 0 && setting.garrison <= delegatedGarrisonLimit;
  });
}

export function setNationalPolicy(state, policy) {
  requireCampaignOpen(state);
  if (policy !== null) requireRule(validNationalPolicy(policy), "请为前线和后方填写有效方略，最低驻军为 0 至 2800。");
  const next = { ...state };
  if (policy === null) {
    delete next.nationalPolicy;
    delete next.policyOverrides;
  } else {
    next.nationalPolicy = Object.fromEntries(["front", "rear"].map((zone) => {
      const { focus, budget, garrison } = policy[zone];
      return [zone, { focus, budget, garrison }];
    }));
  }
  return next;
}

function setPolicyCityOverride(state, city, enabled) {
  const others = (state.policyOverrides ?? []).filter((key) => key !== city);
  if (enabled) others.push(city);
  if (others.length) state.policyOverrides = others;
  else delete state.policyOverrides;
}

export function resumeNationalPolicy(state, city) {
  requireCampaignOpen(state);
  requireRule(state.nationalPolicy && owns(state, city), "这座城无法恢复国策委任。");
  const next = { ...state };
  setPolicyCityOverride(next, city, false);
  return next;
}

export function delegateCities(world, state, cities, focus, budget) {
  return applyDelegations(world, state, delegationAssignments(cities, focus, budget));
}

function delegationAssignments(cities, focus, budget) {
  return [...new Set(cities)].map((city) => ({ city, focus, budget }));
}

function applyDelegations(world, state, assignments, recordChanges = true) {
  requireCampaignOpen(state);
  const selected = assignments.map(({ city }) => city);
  requireRule(selected.length && selected.every((city) => owns(state, city)), "请选择至少一座己方城池。");
  requireRule(assignments.every(({ focus }) => governanceFocus.includes(focus)), "未知建设方向。");
  requireRule(assignments.every(({ budget }) => validBudget(budget) && budget !== null), "每城预算须为 0 到 100 钱。");
  const vacant = selected.filter((city) => !state.cities[city].governor);
  const candidates = eraByYear(world, state).officers
    .filter(({ key, faction }) => faction === state.player && availableForPosting(state, key))
    .sort((a, b) => officerSkill(state, b, "governance") - officerSkill(state, a, "governance"));
  requireRule(candidates.length >= vacant.length, "待任官员不足，还缺 " + (vacant.length - candidates.length) + " 人。");
  const next = structuredClone(state);
  vacant.forEach((city, index) => {
    const officer = candidates[index].key;
    next.cities[city].governor = officer;
    next.stations[officer] = city;
  });
  for (const { city, focus, budget } of assignments) {
    Object.assign(next.cities[city], { mode: "delegated", focus, delegateBudget: budget });
    if (next.nationalPolicy) setPolicyCityOverride(next, city, true);
  }
  if (recordChanges) recordPersonnelChanges(next, state, candidates.slice(0, vacant.length).map(({ key }) => key));
  return next;
}

export function delegationZones(world, state) {
  const zones = { front: [], rear: [] };
  for (const { key, links } of world.cities) {
    if (!owns(state, key)) continue;
    const front = links.some((neighbor) => isHostile(state, state.player, state.cities[neighbor].owner));
    zones[front ? "front" : "rear"].push(key);
  }
  return zones;
}

function applyNationalPolicy(world, state) {
  if (!state.nationalPolicy) return;
  const manual = new Set(state.policyOverrides);
  for (const [zone, keys] of Object.entries(delegationZones(world, state))) {
    const policy = state.nationalPolicy[zone];
    for (const key of keys) {
      const city = state.cities[key];
      if (manual.has(key) || !city.governor) continue;
      const focus = city.troops < policy.garrison ? "recruit" : policy.focus;
      Object.assign(city, { mode: "delegated", focus, delegateBudget: policy.budget });
    }
  }
}

function groupedAssignments(world, state, policies) {
  const zones = delegationZones(world, state);
  const participating = new Map(Object.entries(zones).flatMap(([zone, cities]) =>
    (policies?.[zone] ? cities : []).map((city) => [city, zone])));
  const assignments = world.cities.flatMap(({ key }) => participating.has(key)
    ? [{ ...policies[participating.get(key)], city: key }] : []);
  return { assignments, participating };
}

export function delegateZones(world, state, policies) {
  return applyDelegations(world, state, groupedAssignments(world, state, policies).assignments);
}

export function availableAttackers(era, state, faction, from) {
  return era.officers.filter((entry) => {
    if (entry.faction !== faction || armyByOfficer(state, entry.key) || nationalDuty(state, entry.key)) return false;
    const duty = postingOf(state, entry.key);
    if (duty) return duty.city === from && duty.role === "commander";
    return !state.stations || state.stations[entry.key] === from;
  });
}

function friendlyRoutes(world, state, faction, destination, hopLimit = Infinity) {
  const distance = new Map([[destination, 0]]);
  const queue = [destination];
  for (const current of queue) {
    if (distance.get(current) >= hopLimit) continue;
    for (const { key, links } of world.cities) {
      if (distance.has(key) || !links.includes(current) || !owns(state, key, faction) || !weatherAllows(state, key, current)
        || !postTransit(state, faction, key, current)) continue;
      distance.set(key, distance.get(current) + 1);
      queue.push(key);
    }
  }
  return distance;
}

function needsCommander(world, era, state, faction, to, target) {
  const city = world.cities.find(({ key }) => key === to);
  return faction !== state.player && owns(state, to, faction) && city?.links.includes(target)
    && isHostile(state, faction, state.cities[target].owner)
    && !state.cities[to].commander && availableAttackers(era, state, faction, to).length === 0;
}

function canLeaveStation(world, state, faction, officer, from, to, distance) {
  if (!from || from === to || state.stations?.[officer] !== from || !distance.has(from)) return false;
  const city = world.cities.find(({ key }) => key === from);
  return city && !city.links.some((key) => isHostile(state, faction, state.cities[key].owner))
    && !postingOf(state, officer) && !pendingExpedition(state, officer);
}

export function suggestDeployment(world, era, state, faction, to, target) {
  if (!needsCommander(world, era, state, faction, to, target)) return null;
  const distance = friendlyRoutes(world, state, faction, to);
  const candidate = era.officers
    .filter(({ key, faction: allegiance }) => allegiance === faction
      && canLeaveStation(world, state, faction, key, state.stations[key], to, distance))
    .sort((a, b) => b.command - a.command || distance.get(state.stations[a.key]) - distance.get(state.stations[b.key]))[0];
  return candidate ? { type: "deploy", officer: candidate.key, from: state.stations[candidate.key], to, target } : null;
}

export function expeditionGrain(troops) {
  return Math.ceil(troops / 100);
}

export function transferGrain({ troops, route }) {
  return expeditionGrain(troops) * (route ? route.length - 1 : 1);
}

export function transferRoutes(world, state, from) {
  if (!owns(state, from)) return [];
  const cities = new Map(world.cities.map((city) => [city.key, city]));
  const seen = new Set([from]);
  const routes = [[from]];
  for (const route of routes) {
    if (route.length > transferHopLimit) continue;
    if (route.length > 1 && warBlockaded(state, route.at(-1))) continue;
    const city = cities.get(route.at(-1));
    for (const target of city.links) {
      if (seen.has(target) || !owns(state, target) || !weatherAllows(state, route.at(-1), target)
        || !postTransit(state, state.player, route.at(-1), target)) continue;
      seen.add(target);
      routes.push([...route, target]);
    }
  }
  return routes.slice(1);
}

export function transferRoutesTo(world, state, to) {
  if (!owns(state, to)) return [];
  const cities = new Map(world.cities.map((city) => [city.key, city]));
  const distance = friendlyRoutes(world, state, state.player, to, transferHopLimit);
  return world.cities.filter(({ key }) => key !== to && distance.has(key)).map(({ key }) => {
    const route = [key];
    for (let hops = distance.get(key); hops > 0; hops -= 1) {
      const from = route.at(-1);
      route.push(cities.get(from).links.find((neighbor) => distance.get(neighbor) === hops - 1 && weatherAllows(state, from, neighbor)
        && postTransit(state, state.player, from, neighbor)));
    }
    return route;
  });
}

function validateTransferRoute(world, state, faction, order) {
  const { from, to, route } = order;
  if (route === undefined) {
    requireRule(owns(state, from, faction) && owns(state, to, faction), "只能在己方城池之间调兵。");
    const origin = world.cities.find(({ key }) => key === from);
    requireRule(origin.links.includes(to), "调兵目标须与出发城相邻。");
    requireRule(weatherAllows(state, from, to), "此段军路受时令影响，请改道调兵。");
    requireRule(postTransit(state, faction, from, to), "此段军路被据点阻断，请改道调兵。");
    return;
  }
  requireRule(Array.isArray(route) && route.length >= 3 && route.length <= transferHopLimit + 1
    && route[0] === from && route.at(-1) === to && new Set(route).size === route.length
    && route.every((key) => typeof key === "string"), "跨城调兵须指定两至三段相连道路。");
  for (const [index, key] of route.entries()) {
    const city = world.cities.find((entry) => entry.key === key);
    requireRule(city && (index === route.length - 1 || city.links.includes(route[index + 1])), "跨城调兵路线无效。");
    requireRule(!index || weatherAllows(state, route[index - 1], key), "跨城调兵路线受时令影响，请改道。");
    requireRule(!index || postTransit(state, faction, route[index - 1], key), "跨城调兵路线被据点阻断。");
    requireRule(owns(state, key, faction), cityName(world, key) + "已经易主，跨城调兵路线中断。");
    requireRule(!index || index === route.length - 1 || !warBlockaded(state, key), cityName(world, key) + "被封锁，须为援军改道。");
  }
}

export function validateOrder(world, state, faction, order) {
  requireRule(order && typeof order === "object", "请选择一项政令。");
  if (order.type === "mobilize") {
    mobilizationQuote(world, state, faction, order);
    return;
  }
  if (order.type === "deploy") {
    const era = eraByYear(world, state);
    requireRule(needsCommander(world, era, state, faction, order.to, order.target), "已无符合调任条件的前线城池。");
    requireRule(era.officers.some(({ key, faction: allegiance }) => key === order.officer && allegiance === faction), "请选择本势力的待任武将。");
    const distance = friendlyRoutes(world, state, faction, order.to);
    requireRule(canLeaveStation(world, state, faction, order.officer, order.from, order.to, distance), "待任武将须驻在道路相通的后方城池。");
    return;
  }
  if (order.type === "attack") {
    const origin = world.cities.find(({ key }) => key === order.from);
    requireRule(owns(state, order.from, faction), "出征城池已经易主。");
    requireRule(origin.links.includes(order.to) && !owns(state, order.to, faction), "只能攻打相邻的非己方城池。");
    requireRule(weatherAllows(state, order.from, order.to), "时令阻断直达陆路，请安排水运军团或另选道路。");
    requireRule(postTransit(state, faction, order.from, order.to), "直达军路由敌方据点控制，请派军团夺取或改道。");
    requireRule(isHostile(state, faction, state.cities[order.to].owner), "该势力受停战或同盟保护。");
    const era = eraByYear(world, state);
    requireRule(availableAttackers(era, state, faction, order.from).some(({ key }) => key === order.officer), "请选择驻在出征城的待任武将或守将。");
    const maximum = state.cities[order.from].troops - cityReserve;
    requireRule(Number.isInteger(order.troops) && order.troops >= minimumMarch && order.troops <= maximum, "请至少派出 200 人，并留守 250 人。");
    requireRule(state.factions[faction].grain >= expeditionGrain(order.troops), "储粮不足。");
    return;
  }
  if (order.type === "transfer") {
    validateTransferRoute(world, state, faction, order);
    const maximum = state.cities[order.from].troops - cityReserve;
    requireRule(Number.isInteger(order.troops) && order.troops >= minimumMarch && order.troops <= maximum, "请至少调动 200 人，并留守 250 人。");
    requireRule(state.factions[faction].grain >= transferGrain(order), "储粮不足。");
    return;
  }
  requireRule(owns(state, order.city, faction), "政令的目标城池已经易主。");
  if (order.type === "delegate-city") {
    const city = state.cities[order.city];
    requireRule(faction !== state.player && city.governor && city.occupation === 0,
      "委任须选择有太守且已完成整顿的己方城池。");
    const era = eraByYear(world, state);
    const canChange = city.mode === "direct" ? order.previousFocus === undefined
      : order.previousFocus === city.focus && exhaustedCityProgram(era, city);
    requireRule(canChange, "原委任状态已经变化，当前无法改派。");
    const quote = opponentDelegationQuote(world, state, faction, order.city, order.focus);
    requireRule(quote && order.budget === quote.treasury, "项目无可用预算或会挤占现有委任与征兵储备。");
    return;
  }
  if (order.type === "appoint-governor") {
    const era = eraByYear(world, state);
    requireRule(needsRecoveryGovernor(state.cities[order.city]), "此城已无需补任太守加快整顿。");
    requireRule(era.officers.some(({ key, faction: allegiance }) => key === order.officer && allegiance === faction)
      && availableForPosting(state, order.officer), "只能任命本势力待任且未领出征令的人员。");
    return;
  }
  if (order.type === "recruit") {
    requireRule(!dynastyLevyRefused(state, order.city), "地方拒绝征募，请在天下经略中处理州郡交涉。");
    const stock = state.factions[faction];
    requireRule(stock.treasury >= recruitment.treasury && stock.grain >= recruitment.grain, "征兵需要 20 国库和 12 粮。");
    const population = state.realm?.cities[order.city]?.population;
    requireRule(population === undefined || population >= 800 + recruitment.troops, "本城人口不足以征募 600 人。");
    return;
  }
  requireRule(order.type === "build" && Object.hasOwn(projects, order.project), "未知政令。");
  requireRule(state.cities[order.city][order.project] < 5, "此项目已达最高等级。");
  requireRule(state.factions[faction].treasury >= projects[order.project].cost, "国库不足。");
}

export function queueOrder(world, state, order) {
  const orders = order === null ? [] : [...state.orders, { ...order }];
  return replaceOrders(world, state, orders);
}

export function replaceOrders(world, state, orders) {
  requireCampaignOpen(state);
  const next = { ...state, orders };
  previewOrders(world, next);
  return { ...next, orders: orders.map((order) => order.type === "transfer" && order.route
    ? { ...order, route: [...order.route] } : { ...order }) };
}

export function previewOrders(world, state) {
  return projectOrders(world, state).state;
}

export function previewMilitaryOrders(world, state) {
  return projectOrders(world, militaryView(state), false, Boolean(state.war)).state;
}

export function forecastOrderSteps(world, state, { byIntelligence = false } = {}) {
  return projectOrders(world, byIntelligence ? militaryView(state) : state, true, byIntelligence && Boolean(state.war)).steps;
}

function priorOrderRequirement(world, state, order, index) {
  if (index === 0) return "";
  try {
    validateOrder(world, state, state.player, order);
    return "";
  } catch (error) {
    return error.message;
  }
}

function projectOrders(world, state, trace = false, uncertain = false) {
  requireRule(Array.isArray(state.orders) && state.orders.length <= seasonOrderLimit, "本季最多可下达 " + seasonOrderLimit + " 道政令。");
  const captured = new Set();
  const steps = [];
  if (!state.orders.length) return { state, captured, steps };
  const next = structuredClone(state);
  const era = eraByYear(world, state);
  const officers = new Set();
  for (const [index, order] of next.orders.entries()) {
    try {
      if (["attack", "mobilize"].includes(order?.type)) {
        requireRule(!officers.has(order.officer), "同一名武将每季只能领一次出征令。");
        officers.add(order.officer);
      }
      validateOrder(world, next, state.player, order);
      const stock = trace ? funds(next.factions[state.player]) : null;
      const garrisons = trace ? [order.from, order.to ?? order.city].filter((key) => Object.hasOwn(next.cities, key))
        .map((key) => ({ key, before: next.cities[key].troops, owner: next.cities[key].owner })) : [];
      const entry = executeOrder(world, era, next, state.player, order);
      if (entry.type === "capture") captured.add(entry.city);
      if (trace) {
        steps.push({
          order, entry, number: index + 1, spent: spending(stock, next.factions[state.player]),
          prerequisite: priorOrderRequirement(world, state, order, index),
          garrisons: garrisons.map(({ key, before, owner }) => ({
            key, before, owner, after: next.cities[key].troops, nextOwner: next.cities[key].owner,
          })).filter(({ before, after, owner, nextOwner }) => before !== after || owner !== nextOwner),
        });
      }
    } catch (error) {
      if (!uncertain) throw new Error("第 " + (index + 1) + " 道政令 · " + error.message);
      if (trace) steps.push({ order, number: index + 1, spent: { treasury: 0, grain: 0 }, garrisons: [],
        entry: { text: "按当前军情，预计此令暂无法执行。" }, prerequisite: error.message });
    }
  }
  return { state: next, captured, steps };
}

export function sendTreatyOffer(world, state, target, kind) {
  requireCampaignOpen(state);
  const stock = previewOrders(world, state).factions[state.player];
  const quote = quoteTreaty(world, state, target, kind, stock.treasury);
  requireRule(quote.available, quote.reason);
  const next = structuredClone(state);
  next.treatyOffers.push({ target, kind, accepted: quote.accepted, reason: quote.reason });
  if (quote.accepted) signTreaty(world, next, state.player, target, kind);
  return next;
}

function signTreaty(world, state, sender, recipient, kind) {
  const term = treatyTerms[kind];
  const sides = [sender, recipient].sort();
  state.treaties = state.treaties.filter((entry) => entry.sides[0] !== sides[0] || entry.sides[1] !== sides[1]);
  state.treaties.push({ sides, kind, expires: state.turn + term.seasons });
  state.factions[sender].treasury -= term.treasury;
  state.factions[recipient].treasury += term.treasury;
  previewOrders(world, state);
}

export function respondToTreaty(world, state, accepted) {
  requireCampaignOpen(state);
  const offer = state.incomingTreaty;
  requireRule(offer?.answer === null && offer.turn === state.turn, "没有待答复的提议。");
  requireRule(typeof accepted === "boolean", "请选择接受或拒绝。");
  if (accepted) {
    const reason = incomingTreatyBlock(state);
    requireRule(!reason, reason);
  }
  const next = structuredClone(state);
  next.incomingTreaty.answer = accepted;
  if (accepted) signTreaty(world, next, offer.from, state.player, offer.kind);
  return next;
}

function diplomacyEntries(era, state) {
  const entries = state.treatyOffers.map(({ target, kind, accepted, reason }) => {
    const term = treatyTerms[kind];
    const outcome = accepted ? "同意" + term.name + " " + term.seasons + " 季，礼金 " + term.treasury + " 钱。" : "拒绝" + term.name + "。";
    return { type: "diplomacy", faction: state.player, participants: [state.player, target], text: factionName(era, target) + outcome + reason };
  });
  const offer = state.incomingTreaty;
  if (offer) {
    const name = factionName(era, offer.from);
    const term = treatyTerms[offer.kind];
    const text = offer.answer === null ? name + "的" + term.name + "提议未获答复，已失效。"
      : offer.answer ? "我方接受" + name + "的" + term.name + "提议，收到 " + term.treasury + " 钱礼金。"
        : "我方拒绝" + name + "的" + term.name + "提议。";
    entries.push({ type: "diplomacy", faction: state.player, participants: [state.player, offer.from], text });
  }
  return entries;
}

function clearEndedTreaties(era, state, entries) {
  const alive = new Set(Object.values(state.cities).map(({ owner }) => owner));
  state.treaties = state.treaties.filter(({ kind, sides, expires }) => {
    const partnerDefeated = sides.some((faction) => !alive.has(faction));
    if (!partnerDefeated && expires > state.turn) return true;
    const partners = sides.map((key) => factionName(era, key)).join("与");
    entries.push({
      type: "diplomacy", faction: sides.includes(state.player) ? state.player : sides[0],
      participants: sides,
      text: partners + "的" + treatyTerms[kind].name + (partnerDefeated ? "因一方覆灭解除。" : "期满。"),
    });
    return false;
  });
  state.treatyOffers = [];
}

export function describeOrder(world, era, order) {
  if (!order) return "休整";
  if (order.type === "delegate-city") {
    const city = cityName(world, order.city);
    const project = projects[order.focus].name;
    const title = order.previousFocus ? "改派" + city + project : "委任" + city + project;
    return title + "，每季预算 " + order.budget + " 钱";
  }
  if (order.type === "appoint-governor") {
    const officer = era.officers.find(({ key }) => key === order.officer);
    return "任命" + officer.name + "为" + cityName(world, order.city) + "太守";
  }
  if (order.type === "deploy") {
    const officer = era.officers.find(({ key }) => key === order.officer);
    return "调" + officer.name + "自" + cityName(world, order.from) + "至" + cityName(world, order.to) + "任守将";
  }
  if (order.type === "attack") {
    const general = era.officers.find(({ key }) => key === order.officer);
    return general.name + "率 " + order.troops.toLocaleString("zh-CN") + " 人自" + cityName(world, order.from) + "攻打" + cityName(world, order.to);
  }
  if (order.type === "mobilize") {
    const general = era.officers.find(({ key }) => key === order.officer);
    return general.name + "在" + cityName(world, order.from) + "集结 " + order.troops.toLocaleString("zh-CN") + " 人，目标" + cityName(world, order.to);
  }
  if (order.type === "transfer") {
    const description = cityName(world, order.from) + "调 " + order.troops.toLocaleString("zh-CN") + " 人至" + cityName(world, order.to);
    return order.route ? description + "，经" + order.route.slice(1, -1).map((key) => cityName(world, key)).join("、") : description;
  }
  if (order.type === "recruit") return cityName(world, order.city) + "征兵";
  return cityName(world, order.city) + "扩建" + projects[order.project].name;
}

export function defensiveStrength(era, target, state, key) {
  const defender = era.officers.find(({ key }) => key === target.commander);
  const guard = holdingArmies(state, target.owner, key).reduce((total, army) => {
    const leader = era.officers.find(({ key }) => key === army.officer);
    return total + army.troops * (1 + officerSkill(state, leader, "command") / 145);
  }, 0);
  return Math.round(target.troops * (1 + officerSkill(state, defender, "command") / 145) + 180 * target.defense + guard);
}

export function forecastAttack(era, state, order, faction = state.player, conditions = {}) {
  const leader = era.officers.find(({ key, faction: allegiance }) => key === order.officer && allegiance === faction);
  const gear = Math.min(.14, (conditions.equipment ?? 0) * 22 / order.troops);
  const weather = edgeWeather(state, order.from, order.to);
  const travel = conditions.travel === "water" && weather.terrain === "river" ? 1.12 : 1 - Math.min(.15, weather.cost * .035);
  const offense = Math.round(order.troops * (1 + officerSkill(state, leader, "command") / 120 + gear) * travel * (conditions.readiness ?? 1));
  const terrain = state.war && weather.terrain;
  const ground = terrain === "pass" ? 1.12 : terrain === "river" ? 1.08 : 1;
  const defense = conditions.surrender ? Math.max(0, offense - 1)
    : Math.round((defensiveStrength(era, state.cities[order.to], state, order.to) + (conditions.relief ?? 0)) * ground * (1 - (conditions.breach ?? 0) / 330));
  return { offense, defense, grain: expeditionGrain(order.troops), wins: offense > defense };
}

export function occupationProgress(city, capturedThisSeason) {
  if (!city.occupation) return { remaining: 0, shortage: 0, pause: null };
  const shortage = Math.max(0, cityReserve - city.troops);
  const pause = capturedThisSeason ? "capture" : shortage > 0 ? "garrison" : null;
  const remaining = pause ? city.occupation : Math.max(0, city.occupation - (city.governor ? 2 : 1));
  return { remaining, shortage, pause };
}

export function needsRecoveryGovernor(city) {
  if (city.governor) return false;
  const { remaining, pause } = occupationProgress(city, false);
  return !pause && remaining > 0;
}

function resolveAttack(world, era, state, faction, order, army, conditions = {}) {
  const origin = state.cities[order.from];
  const target = state.cities[order.to];
  const oldOwner = target.owner;
  const odds = forecastAttack(era, state, order, faction, conditions);
  const attackerLoss = Math.min(order.troops - 1, Math.max(1, Math.round(order.troops * (conditions.surrender ? .02 : odds.wins ? .25 : .39))));
  const fieldGuard = holdingArmies(state, oldOwner, order.to);
  const defenders = target.troops + fieldGuard.reduce((total, guard) => total + guard.troops, 0);
  const defensiveLoss = Math.round(defenders * (conditions.surrender ? .05 : odds.wins ? .62 : .22));
  const lossUpTo = (troops) => defenders ? Math.floor(defensiveLoss * troops / defenders) : 0;
  let counted = target.troops;
  const garrisonLoss = lossUpTo(counted);
  for (const guard of fieldGuard) {
    const losses = lossUpTo(counted + guard.troops) - lossUpTo(counted);
    counted += guard.troops;
    guard.troops -= losses;
    recordFormationLoss(state, guard.officer, losses, "守城战损");
  }
  const battle = {
    from: order.from,
    attacker: { faction, troops: order.troops, strength: odds.offense, casualties: attackerLoss },
    defender: { faction: oldOwner, troops: defenders, strength: odds.defense, casualties: defensiveLoss },
    personnel: { attacker: order.officer, defender: target.commander },
    ...(army?.stance ? { tactic: conditions.surrender ? "surrender" : army.stance } : {}),
  };
  if (!army) state.factions[faction].grain -= odds.grain;
  if (!odds.wins) {
    if (army) {
      army.troops -= attackerLoss;
      army.phase = "hold";
    } else origin.troops -= attackerLoss;
    target.troops -= garrisonLoss;
    return {
      type: "battle", faction, city: order.to, participants: [faction, oldOwner], battle,
      text: factionName(era, faction) + "攻打" + cityName(world, order.to) + "失利，折损 " + attackerLoss + " 人。",
    };
  }

  if (!army) {
    origin.troops -= order.troops;
    if (origin.commander === order.officer) origin.commander = null;
  }
  const retreat = world.cities.find(({ key }) => key !== order.to && owns(state, key, oldOwner));
  if (retreat) state.cities[retreat.key].troops += target.troops - garrisonLoss;
  const fieldRemaining = fieldGuard.reduce((total, guard) => total + guard.troops, 0);
  battle.personnel.relocated = [];
  for (const [officer, station] of Object.entries(state.stations)) {
    if (station !== order.to) continue;
    const role = officer === target.governor ? "governor" : officer === target.commander ? "commander" : "available";
    battle.personnel.relocated.push({ officer, role });
    state.stations[officer] = retreat?.key ?? null;
  }
  const survivors = order.troops - attackerLoss;
  const marching = army && survivors >= armyGarrison + minimumMarch ? survivors - armyGarrison : 0;
  const grainReturned = army && !marching ? army.grain : 0;
  if (army) {
    Object.assign(army, { troops: marching, phase: "secured", location: order.to, route: [order.to] });
    state.factions[faction].grain += grainReturned;
  }
  state.stations[order.officer] = marching ? null : order.to;
  removeDelegationPriority(state, order.to);
  if (state.policyOverrides?.includes(order.to)) setPolicyCityOverride(state, order.to, false);
  Object.assign(target, {
    owner: faction,
    troops: survivors - marching,
    defense: Math.max(0, target.defense - 1),
    occupation: occupationSeasons,
    governor: null,
    commander: marching ? null : order.officer,
    mode: "direct",
    focus: "farming",
    delegateBudget: null,
  });
  return {
    type: "capture", faction, city: order.to, participants: [faction, oldOwner],
    ...(grainReturned ? { grainReturned } : {}),
    battle: { ...battle, occupation: { garrison: target.troops, retreatTo: retreat?.key ?? null,
      ...(marching ? { inArmy: marching } : {}), ...(fieldRemaining ? { fieldRemaining } : {}) } },
    text: factionName(era, faction) + "攻占" + cityName(world, order.to) + "。" + cityName(world, order.to)
      + "留下 " + target.troops + " 人驻守，进入整顿。",
  };
}

function executeOrder(world, era, state, faction, order) {
  if (order.type === "attack") return resolveAttack(world, era, state, faction, order);
  if (order.type === "mobilize") {
    const grain = mobilizeArmy(world, state, faction, order);
    return { type: "order", orderType: order.type, faction, city: order.from,
      ...(state.landscape ? { operationTarget: order.to } : {}),
      text: describeOrder(world, era, order) + "。携带 " + grain + " 粮。" + (order.stance ? "拟施" + stances[order.stance] + "。" : "") };
  }
  if (order.type === "deploy" || order.type === "appoint-governor") {
    const { officer, type } = order;
    const city = type === "deploy" ? order.to : order.city;
    const role = type === "deploy" ? "commander" : "governor";
    const from = personnelPosition(state, officer);
    state.stations[officer] = city;
    state.cities[city][role] = officer;
    return { type: "order", orderType: type, faction, city,
      text: describeOrder(world, era, order) + (role === "governor" ? "，加快整顿。" : "。"),
      personnelChange: { officer, from, to: { city, role } } };
  }
  if (order.type === "delegate-city") {
    Object.assign(state.cities[order.city], { mode: "delegated", focus: order.focus, delegateBudget: order.budget });
    return { type: "order", orderType: order.type, faction, city: order.city, text: describeOrder(world, era, order) + "。" };
  }
  const stock = state.factions[faction];
  if (order.type === "transfer") {
    const grain = transferGrain(order);
    stock.grain -= grain;
    state.cities[order.from].troops -= order.troops;
    state.cities[order.to].troops += order.troops;
    return { type: "order", orderType: order.type, faction, city: order.to, text: describeOrder(world, era, order) + "，支出 " + grain + " 粮。" };
  }
  const city = state.cities[order.city];
  const name = cityName(world, order.city);
  if (order.type === "recruit") {
    stock.treasury -= recruitment.treasury;
    stock.grain -= recruitment.grain;
    city.troops += recruitment.troops;
    noteRecruitment(state, order.city, recruitment.troops);
    return { type: "order", orderType: order.type, faction, city: order.city, text: name + "征募 " + recruitment.troops + " 人。" };
  }
  stock.treasury -= projects[order.project].cost;
  city[order.project] += 1;
  return { type: "order", orderType: order.type, faction, city: order.city, text: name + projects[order.project].name + "升至 " + city[order.project] + " 级。" };
}

function applyOrder(world, era, state, faction, order) {
  try {
    validateOrder(world, state, faction, order);
  } catch (error) {
    return {
      type: "notice", orderType: order.type, faction, city: order.to ?? order.city,
      text: describeOrder(world, era, order) + "已取消。 " + error.message,
    };
  }
  return executeOrder(world, era, state, faction, order);
}

function prepareOpponents(world, era, state, proposals) {
  const orders = new Map();
  const decisions = [];
  for (const { key } of playableFactions(era)) {
    if (key === state.player || forceTotals(state, key).cities === 0) continue;
    const proposal = proposals[key];
    const plan = factionPlans(world, era, state, key);
    let { order: choice, goal } = plan.suggested;
    let source = proposal?.source === "fallback" ? "fallback" : "rules";
    let reason = source === "fallback" ? proposal.reason : "";
    if (proposal?.source === "model" && proposal.legacy && choice?.type === "deploy") {
      source = "fallback";
      reason = "当前战线缺员，规则接管调任守将。";
    } else if (proposal?.source === "model") {
      try {
        if (proposal.order !== null) validateOrder(world, state, key, proposal.order);
        const matching = compatibleGoal(plan, proposal);
        requireRule(matching, "拟令与当前战略目标不符");
        choice = proposal.order;
        goal = matching;
        source = "model";
        reason = proposal.reason;
      } catch (error) {
        source = "fallback";
        reason = error.message;
      }
    }
    if (source === "rules" && choice?.type === "appoint-governor") reason = "加快整顿，尽早恢复税粮。";
    if (source === "rules" && choice?.type === "delegate-city") {
      reason = choice.previousFocus ? "原项目已达上限，改派可继续发展。" : "持续发展辖城，预留征兵储备。";
    }
    if (source === "rules" && plan.recovering) reason = "钱粮吃紧，转为休养和补充储备。";
    if (source === "rules" && plan.urgent && goal.type === "defend") reason = "边境有实际失守风险，先稳住守军。";
    if (source === "rules" && goal === plan.supplyCut) reason = "趁对方军团在外，尝试切断补给。";
    orders.set(key, choice);
    decisions.push({
      faction: key, source, reason: typeof reason === "string" ? reason.slice(0, 64) : "",
      action: describeOrder(world, era, choice), orderType: choice?.type ?? "rest",
      goal,
    });
  }
  return { orders, decisions };
}

function cityProgramTerms(era, city, focus = city.focus, state) {
  if (city.occupation > 0) return { result: "occupation" };
  const recruiting = focus === "recruit";
  if (recruiting && city.troops >= delegatedGarrisonLimit) return { result: "garrison" };
  if (!recruiting && city[focus] >= 5) return { result: "level" };
  const governor = era.officers.find(({ key }) => key === city.governor);
  const oversight = city.owner === state?.player && !recruiting && officeSkill(era, state, "civil") >= 80 ? 2 : 0;
  const price = (recruiting ? recruitment.treasury : projects[focus].cost) - Math.floor(officerSkill(state, governor, "governance") / 25) - oversight;
  const grain = recruiting ? recruitment.grain : 0;
  return { governor: governor.name, required: { treasury: price, grain } };
}

function exhaustedCityProgram(era, city) {
  const { result } = cityProgramTerms(era, city);
  return result === "level" || result === "garrison";
}

export function opponentDelegationQuote(world, state, faction, key, focus) {
  if (faction === state.player || !owns(state, key, faction) || !Object.hasOwn(projects, focus)) return null;
  const city = state.cities[key];
  if (!city.governor || city.occupation) return null;
  const era = eraByYear(world, state);
  if (city.mode === "delegated" && (city.focus === focus || !exhaustedCityProgram(era, city))) return null;
  const { required } = cityProgramTerms(era, { ...city, focus });
  if (!required) return null;

  let committed = 0;
  for (const holding of Object.values(state.cities)) {
    if (holding.owner !== faction || holding.mode !== "delegated" || !holding.governor) continue;
    const occupation = occupationProgress(holding, false).remaining;
    const { required: existing } = cityProgramTerms(era, { ...holding, occupation });
    if (existing && (holding.delegateBudget === null || existing.treasury <= holding.delegateBudget)) committed += existing.treasury;
  }
  const recurring = committed + required.treasury;
  const income = forceTotals(state, faction).treasury;
  return recurring <= Math.max(income, required.treasury)
    && recurring + recruitment.treasury <= state.factions[faction].treasury ? required : null;
}

const programCategory = (focus) => focus === "recruit" || focus === "defense" ? "military" : "development";

function quoteCityProgram(era, city, { balance, spendable, cap }, focus, state) {
  const terms = cityProgramTerms(era, city, focus, state);
  if (terms.result) return terms;
  const { required } = terms;
  const { treasury: price, grain } = required;
  if (city.delegateBudget !== null && price > city.delegateBudget) {
    return { result: "budget", needed: price, available: city.delegateBudget, required };
  }
  if (balance.treasury < price) return { result: "treasury", needed: price, available: balance.treasury, required };
  if (balance.grain < grain) return { result: "grain", needed: grain, available: balance.grain, required };
  if (spendable.treasury < price) return { result: "reserve-treasury", needed: price, available: spendable.treasury, required };
  if (spendable.grain < grain) return { result: "reserve-grain", needed: grain, available: spendable.grain, required };
  const category = programCategory(focus);
  if (cap && cap[category] < price) return { result: "national-budget", needed: price, available: cap[category], required };
  return terms;
}

function quoteAutomaticDevelopment(era, city, resources, state) {
  if (city.occupation > 0) return { result: "occupation" };
  const ranked = developmentProjects.filter((project) => city[project] < 5).sort((a, b) => city[a] - city[b]);
  const blockerRank = { level: 0, budget: 1, treasury: 2, "reserve-treasury": 3, "national-budget": 4 };
  let blocked = { result: "level" };
  for (const project of ranked) {
    const quote = quoteCityProgram(era, city, resources, project, state);
    if (!quote.result) {
      const selected = { ...quote, project };
      if (blocked.result === "reserve-treasury") selected.adjustedForReserve = true;
      return selected;
    }
    // Prefer a project within the city's budget when every candidate is blocked.
    if (blockerRank[quote.result] > blockerRank[blocked.result]
      || (blocked.result === quote.result && quote.needed < blocked.needed)) blocked = quote;
  }
  return blocked;
}

function runCityProgram(era, key, city, stock, { reserve, opponent, state, cap }) {
  const spendable = {
    treasury: Math.max(0, stock.treasury - (reserve?.treasury ?? 0)),
    grain: Math.max(0, stock.grain - (reserve?.grain ?? 0)),
  };
  // Opponent quotes have always treated their recruitment reserve as unavailable stock.
  const population = state.realm?.cities[key]?.population;
  if (city.focus === "recruit" && dynastyLevyRefused(state, key)) return { result: "unrest" };
  if (city.focus === "recruit" && population !== undefined && population < 800 + minimumMarch && !city.occupation) return { result: "population" };
  const resources = { balance: opponent ? spendable : stock, spendable, cap };
  const terms = city.focus === "auto" ? quoteAutomaticDevelopment(era, city, resources, state)
    : quoteCityProgram(era, city, resources, city.focus, state);
  if (terms.result) return terms;
  const { required, governor, project, adjustedForReserve } = terms;
  const { treasury: price, grain } = required;
  const focus = project ?? city.focus;
  const category = programCategory(focus);
  if (cap) cap[category] -= price;
  stock.treasury -= price;
  stock.grain -= grain;
  let action;
  if (focus === "recruit") {
    const recruits = Math.min(recruitment.troops, delegatedGarrisonLimit - city.troops, population === undefined ? Infinity : population - 800);
    city.troops += recruits;
    noteRecruitment(state, key, recruits);
    action = "征募 " + recruits + " 人";
  } else {
    city[focus] += 1;
    action = projects[focus].name + "升至 " + city[focus] + " 级";
  }
  const completed = { result: "completed", spent: required, required, governor, action };
  if (project) completed.project = project;
  if (adjustedForReserve) completed.adjustedForReserve = true;
  return completed;
}

function settleCityPrograms(world, era, previous, next, captured, entries, { playerOnly = false, includeProgramActions = false } = {}) {
  prepareAdministration(world, era, next, entries);
  applyNationalPolicy(world, next);
  applyRegionalMandates(world, next);
  const programs = [];
  const priority = new Set(next.delegationPriority);
  const ordered = Object.entries(next.cities);
  const caps = new Map(era.factions.map(({ key }) => [key, next.realm ? { ...realmPolicy(next, key) } : null]));
  const budget = caps.get(next.player);
  if (budget) budget.military = Math.max(0, budget.military - (next.theaters ?? [])
    .filter(({ report }) => report?.turn === next.turn + 1).reduce((sum, { report }) => sum + report.treasury, 0));
  const preferred = (city, key) => {
    const group = programCategory(city.focus);
    return Number(priority.has(key)) * 2 + Number(caps.get(city.owner)?.priority === group);
  };
  if (priority.size || budget) ordered.sort(([a, left], [b, right]) => preferred(right, b) - preferred(left, a));
  for (const [key, city] of ordered) {
    const before = previous.cities[key];
    if (before.owner === next.player && before.mode === "delegated" && city.owner !== next.player) {
      const lost = { city: key, focus: before.focus, result: "lost", spent: { treasury: 0, grain: 0 } };
      if (previous.delegationPriority?.includes(key)) lost.priority = true;
      programs.push(lost);
      if (before.focus === "auto") entries.push({ type: "delegation", faction: next.player, city: key,
        text: cityName(world, key) + "自主发展终止，城池易主。" });
    }
    if (playerOnly && city.owner !== next.player) continue;
    if (city.occupation > 0) {
      city.occupation = occupationProgress(city, captured.has(key)).remaining;
      if (city.occupation === 0) {
        entries.push({ type: "recovery", faction: city.owner, city: key, text: cityName(world, key) + "整顿完成，下季恢复全额税粮。" });
      }
    }
    if (city.mode !== "delegated" || !city.governor) continue;
    const opponent = city.owner !== next.player;
    const automatic = city.focus === "auto";
    const baseline = opponent ? recruitment : next.delegationReserve;
    const national = next.dynasty?.policies[city.owner];
    const reserve = national ? { treasury: Math.max(national.moneyFloor, baseline?.treasury ?? 0),
      grain: Math.max(national.grainFloor, baseline?.grain ?? 0) } : baseline;
    const { governor, action, required, spent = { treasury: 0, grain: 0 }, ...status } =
      runCityProgram(era, key, city, next.factions[city.owner], { reserve, opponent, state: next, cap: caps.get(city.owner) });
    if (city.owner === next.player) {
      const program = { city: key, focus: city.focus, spent, ...status };
      if (priority.has(key)) program.priority = true;
      if (includeProgramActions && action) program.action = action;
      if (includeProgramActions && required) program.required = required;
      programs.push(program);
    }
    if (status.result !== "completed") {
      if (automatic) {
        entries.push({ type: "delegation", faction: city.owner, city: key,
          text: cityName(world, key) + "自主发展暂缓，" + programResults[status.result] + "。" });
      } else if (!opponent && (reserve || status.result === "national-budget")
        && ["treasury", "grain", "reserve-treasury", "reserve-grain", "national-budget"].includes(status.result)) {
        entries.push({ type: "delegation", faction: city.owner, city: key,
          text: cityName(world, key) + "委任" + programResults[status.result] + "。" });
      } else if (opponent && (before.mode !== "delegated" || ["treasury", "grain", "budget", "occupation"].includes(status.result))) {
        const reason = status.result === "treasury" ? "预留征兵资金后国库不足"
          : status.result === "grain" ? "预留征兵用粮后储粮不足" : programResults[status.result];
        entries.push({ type: "delegation", faction: city.owner, city: key, text: cityName(world, key) + "本季委任暂缓，" + reason + "。" });
      }
      continue;
    }
    const costs = "，支出 " + spent.treasury + " 钱" + (spent.grain ? "、" + spent.grain + " 粮。" : "。");
    if (!playerOnly && !opponent) awardService(next, city.governor, "governance");
    const policy = status.adjustedForReserve ? "（自主发展，按国库预留改选）" : automatic ? "（自主发展）" : "";
    entries.push({ type: "delegation", faction: city.owner, city: key,
      text: governor + "在" + cityName(world, key) + action + policy + costs });
  }
  return programs;
}

function settleDomestic(world, era, previous, next, captured, entries, options = {}) {
  const reliefFirst = realmPolicy(next, next.player)?.priority === "relief";
  settleRealmOffices(era, previous, next, captured, entries);
  const early = reliefFirst && settlePopulation(world, era, next, captured, entries, options.playerOnly);
  const programs = settleCityPrograms(world, era, previous, next, captured, entries, options);
  const relief = early || settlePopulation(world, era, next, captured, entries, options.playerOnly);
  return { programs, relief };
}

export function forecastFinance(world, state, { includeProgramActions = false } = {}) {
  const era = eraByYear(world, state);
  const prepared = state.sandtable ? structuredClone(state) : state;
  const grandOrders = [];
  settlePosts(world, prepared, grandOrders);
  const { state: projected, captured } = projectOrders(world, prepared);
  const next = projected === state ? structuredClone(state) : projected;
  const stock = next.factions[next.player];
  const income = forceTotals(state, state.player);
  stock.treasury += income.treasury;
  stock.grain += income.grain;
  const theaters = directTheaters(world, era, next, state.orders.length, (order) => applyOrder(world, era, next, next.player, order), true);
  directGrandCampaigns(world, next, (order) => applyOrder(world, era, next, next.player, order), theaters.logistics, grandOrders);
  settleFrontCommands(world, era, next, (order) => applyOrder(world, era, next, next.player, order), theaters.logistics, grandOrders,
    Math.max(0, theaters.slots - grandOrders.filter(({ type }) => type === "order").length));
  authorizeWars(world, era, next, (order) => applyOrder(world, era, next, next.player, order), grandOrders,
    Math.max(0, theaters.slots - grandOrders.filter(({ type }) => type === "order").length));
  const armyReports = advanceFieldArmies(world, era, state, next, true, theaters.logistics, captured, {},
    Math.max(0, theaters.slots - grandOrders.filter(({ type }) => type === "order").length));
  for (const entry of armyReports) if (entry.type === "capture") captured.add(entry.city);
  const entries = [...grandOrders, ...armyReports, ...theaters.reports];
  settleWarSeason(world, era, next, entries, theaters, true);
  settleCommandRecovery(world, next, entries);
  const armyReturns = returnedGrain(armyReports, state.player);
  const orders = spending({ treasury: state.factions[state.player].treasury + income.treasury,
    grain: state.factions[state.player].grain + income.grain + armyReturns }, stock);
  const beforePrograms = funds(stock);
  const { programs, relief } = settleDomestic(world, era, state, next, captured, entries, { playerOnly: true, includeProgramActions });
  const afterDomestic = funds(stock);
  const statecraft = next.statecraft && statecraftLedger();
  settleCrisisOrders(world, next, entries, statecraft, relief.treasury);
  const ties = settleAccords(world, era, state, next, entries, {}, true);
  const politics = settlePolity(world, state, next, {}, entries, true);
  const grand = settleGrand(world, state, next, entries, {}, true);
  const landscape = settleLandscape(world, next, {}, entries, true);
  settleStatecraft(world, next, entries, statecraft, true);
  const sandtable = settleSandtable(world, state, next, {}, entries, true);
  const dynasty = settleDynasty(world, state, next, {}, entries, true);
  const reign = settleReign(world, state, next, {}, entries, true);
  const century = settleCentury(world, state, next, {}, entries, true);
  const closing = funds(stock);
  return { ...openingLedger(state, income), ...(armyReturns ? { armyReturns } : {}),
    orders, delegation: spending({ treasury: beforePrograms.treasury - relief.treasury, grain: beforePrograms.grain - relief.grain }, afterDomestic),
    ...(ties ? { realm: { ...ties, relief } } : {}), ...(politics ? { politics } : {}), ...(grand ? { grand } : {}),
    ...(landscape ? { landscape } : {}), ...(statecraft ? { statecraft } : {}), ...(sandtable ? { sandtable } : {}), ...(dynasty ? { dynasty } : {}),
    ...(reign ? { reign } : {}), ...(century ? { century } : {}), closing, programs };
}

export function forecastDelegationReserve(world, state, reserve) {
  const draft = setDelegationReserve(state, reserve);
  const before = new Map(forecastFinance(world, state).programs.map((program) => [program.city, program]));
  const { closing, programs } = forecastFinance(world, draft);
  const changes = [];
  for (const program of programs) {
    const previous = before.get(program.city);
    if (program.result !== previous?.result || program.project !== previous?.project
      || program.adjustedForReserve !== previous?.adjustedForReserve) changes.push({ previous, program });
  }
  return { closing, changes };
}

export function delegationBudgetAdjustments(state, programs) {
  return programs.flatMap(({ city, result, available, needed }) => {
    const holding = state.cities[city];
    if (state.nationalPolicy && !state.policyOverrides?.includes(city)) return [];
    if (result !== "budget" || holding?.owner !== state.player || holding.mode !== "delegated"
      || holding.delegateBudget === null || holding.delegateBudget !== available || !Number.isInteger(needed)
      || !validBudget(needed) || needed <= available) return [];
    return [{ city, previous: available, budget: needed }];
  });
}

export function applyDelegationBudgetAdjustments(state, adjustments) {
  requireCampaignOpen(state);
  let next = state;
  for (const { city, previous, budget } of adjustments) {
    const holding = next.cities[city];
    requireRule(holding?.owner === state.player && holding.mode === "delegated" && holding.delegateBudget === previous
      && Number.isInteger(previous) && Number.isInteger(budget) && budget > previous, "城池预算或委任状态已变化，请重新预演。");
    next = setGovernance(next, city, holding.mode, holding.focus, budget);
  }
  return next;
}

export function forecastDelegationBudgets(world, state) {
  requireCampaignOpen(state);
  const before = forecastFinance(world, state, { includeProgramActions: true });
  const adjustments = delegationBudgetAdjustments(state, before.programs);
  const draft = applyDelegationBudgetAdjustments(state, adjustments);
  const after = adjustments.length ? forecastFinance(world, draft, { includeProgramActions: true }) : before;
  const original = new Map(before.programs.map((program) => [program.city, program]));
  const projected = new Map(after.programs.map((program) => [program.city, program]));
  const selected = new Set(adjustments.map(({ city }) => city));
  const effects = [];
  for (const program of after.programs) {
    if (selected.has(program.city)) continue;
    const previous = original.get(program.city);
    if (program.result !== previous?.result || program.project !== previous?.project
      || program.adjustedForReserve !== previous?.adjustedForReserve || program.available !== previous?.available
      || program.needed !== previous?.needed) {
      effects.push({ previous, program });
    }
  }
  return {
    adjustments: adjustments.map((adjustment) => ({ ...adjustment, program: projected.get(adjustment.city) })),
    effects, previousClosing: before.closing, closing: after.closing,
  };
}

export function forecastDelegation(world, state, cities, focus, budget) {
  const draft = applyDelegations(world, state, delegationAssignments(cities, focus, budget), false);
  return delegationForecast(world, state, draft, new Set(cities));
}

function delegationForecast(world, state, draft, selected) {
  const { programs, closing } = forecastFinance(world, draft, { includeProgramActions: true });
  const officers = new Map(eraByYear(world, state).officers.map(({ key, name }) => [key, name]));
  const projected = programs.filter(({ city }) => selected.has(city)).map((program) => ({
    ...program,
    governor: officers.get(draft.cities[program.city].governor),
    newGovernor: !state.cities[program.city].governor,
  }));
  return { programs: projected, closing, spent: sumPrograms(projected, "spent") };
}

function sumPrograms(programs, field) {
  return programs.reduce((total, program) => ({
    treasury: total.treasury + (program[field]?.treasury ?? 0),
    grain: total.grain + (program[field]?.grain ?? 0),
  }), { treasury: 0, grain: 0 });
}

export function forecastDelegationZones(world, state, policies) {
  const { assignments, participating } = groupedAssignments(world, state, policies);
  const draft = applyDelegations(world, state, assignments, false);
  const { programs, closing, spent } = delegationForecast(world, state, draft, participating);
  const groups = Object.fromEntries(["front", "rear"].map((zone) => {
    const rows = programs.filter(({ city }) => participating.get(city) === zone);
    return [zone, { rows, spent: sumPrograms(rows, "spent"), required: sumPrograms(rows, "required") }];
  }));
  return { groups, closing, spent };
}

function advanceFieldArmies(world, era, previous, next, playerOnly, logistics, captured, proposals, slots) {
  const existing = new Set(previous.armies?.map(({ officer }) => officer));
  const entries = [];
  const strategy = prepareStrategy9(world, next, proposals, entries, { playerOnly });
  if (strategy) prepareReign(world, next, proposals, entries, strategy.controlled, { playerOnly });
  const commands = prepareCommand(world, next, entries, logistics, slots, strategy);
  const controlled = prepareFrontline(world, next, existing, entries, { playerOnly, proposals, logistics, slots, commands, precontrolled: strategy?.controlled,
    applyOrder: (order) => applyOrder(world, era, next, next.player, order) });
  schedulePassage9(world, next, strategy, entries);
  const attack = (army, order, conditions) => {
    const assistance = defenseUnits(next, order.to);
    const relief = assistance.reduce((sum, { contribution }) => sum + contribution, 0);
    const row = formationOf(next, army.officer);
    const readiness = row ? 1 + row.experience / 500 - row.fatigue / 300 : 1;
    const entry = resolveAttack(world, era, next, army.faction, order, army, { ...conditions, relief, readiness });
    recordTownBattle(world, next, order, army, entry, assistance);
    return entry;
  };
  entries.push(...settleArmies(world, era, next, existing, attack, { playerOnly, logistics, captured, controlled, passageWait: strategy?.blocked }));
  if (!playerOnly) settleReinforcementPromises(world, next, entries);
  return entries;
}

function settleWarSeason(world, era, next, entries, theaterWork, forecast) {
  if (!next.war) return;
  for (const entry of entries) {
    if (entry.type !== "war" || !["held", "relieved", "diverted"].includes(entry.event)) continue;
    const plan = next.theaters?.find(({ army, operation }) => operation && army === entry.officer);
    if (!plan?.report) continue;
    plan.paused = true;
    plan.report.status = entry.event === "diverted" ? "complete" : "blocked";
    plan.report.text = entry.text;
  }
  settleWarRecovery(world, era, next, entries, theaterWork.slots, (draft) => applyOrder(world, era, next, next.player, draft));
  settleIntelligence(world, next, entries, forecast);
}

function returnedGrain(entries, faction) {
  return entries.reduce((total, entry) => total + (entry.faction === faction ? entry.grainReturned ?? 0 : 0), 0);
}

export function advanceQuarter(world, state, proposals = {}) {
  requireCampaignOpen(state);
  const era = eraByYear(world, state);
  const next = structuredClone(state);
  const entries = diplomacyEntries(era, state);
  prepareCenturyYear(world, next);
  const finance = openingLedger(state, forceTotals(state, state.player));
  const opponents = prepareOpponents(world, era, state, proposals);
  const orders = era.factions.map(({ key }) => ({
    faction: key,
    orders: key === state.player ? state.orders : [opponents.orders.get(key)],
  }));
  for (const { key } of era.factions) {
    const income = forceTotals(state, key);
    next.factions[key].treasury += income.treasury;
    next.factions[key].grain += income.grain;
    if (key === state.player) {
      entries.push({ type: "income", faction: key, text: "税粮入库。国库 +" + income.treasury + " · 储粮 +" + income.grain + "。" });
      const trade = allianceTrade(state, key);
      if (trade) entries.push({ type: "diplomacy", faction: key, text: "同盟商贸收入 +" + trade + " 钱，已计入国库。" });
    }
  }
  const afterIncome = funds(next.factions[next.player]);
  settlePosts(world, next, entries);
  const receipts = new Map();
  const captured = new Set();
  for (let step = 0; step < orders.length; step += 1) {
    const turn = orders[(state.turn + step) % orders.length];
    for (const order of turn.orders) {
      if (!order) continue;
      const entry = next.war && order.type === "attack" && captured.has(order.to)
        ? { type: "notice", orderType: "attack", faction: turn.faction, city: order.to,
          text: cityName(world, order.to) + "本季已被接管，后续出征留待重新部署。" }
        : applyOrder(world, era, next, turn.faction, order);
      if (entry.type === "capture") captured.add(entry.city);
      entries.push(entry);
      if (turn.faction !== state.player) receipts.set(turn.faction, entry);
    }
  }
  const theaterWork = directTheaters(world, era, next, state.orders.length, (order) => applyOrder(world, era, next, next.player, order));
  entries.push(...theaterWork.reports);
  const firstCampaignEntry = entries.length;
  directGrandCampaigns(world, next, (order) => applyOrder(world, era, next, next.player, order), theaterWork.logistics, entries);
  settleFrontCommands(world, era, next, (order) => applyOrder(world, era, next, next.player, order), theaterWork.logistics, entries,
    Math.max(0, theaterWork.slots - entries.slice(firstCampaignEntry).filter(({ type }) => type === "order").length));
  authorizeWars(world, era, next, (order) => applyOrder(world, era, next, next.player, order), entries,
    Math.max(0, theaterWork.slots - entries.slice(firstCampaignEntry).filter(({ type }) => type === "order").length),
    (faction, order) => applyOrder(world, era, next, faction, order));
  const room = Math.max(0, theaterWork.slots - entries.slice(firstCampaignEntry).filter(({ type }) => type === "order").length);
  const armyReports = advanceFieldArmies(world, era, state, next, false, theaterWork.logistics, captured, proposals, room);
  entries.push(...armyReports);
  const armyReturns = returnedGrain(armyReports, next.player);
  if (armyReturns) finance.armyReturns = armyReturns;
  settleWarSeason(world, era, next, entries, theaterWork, false);
  settleCommandRecovery(world, next, entries);
  const afterOrders = funds(next.factions[next.player]);
  const { programs, relief } = settleDomestic(world, era, state, next, captured, entries);
  finishWarRecovery(world, state, next, entries);
  const afterDomestic = funds(next.factions[next.player]);
  const statecraft = next.statecraft && statecraftLedger();
  settleCrisisOrders(world, next, entries, statecraft, relief.treasury);
  const ties = settleAccords(world, era, state, next, entries, proposals);
  const politics = settlePolity(world, state, next, proposals, entries);
  const grand = settleGrand(world, state, next, entries, proposals);
  const landscape = settleLandscape(world, next, proposals, entries);
  settleStatecraft(world, next, entries, statecraft);
  const sandtable = settleSandtable(world, state, next, proposals, entries);
  const dynasty = settleDynasty(world, state, next, proposals, entries);
  const reign = settleReign(world, state, next, proposals, entries);
  const century = settleCentury(world, state, next, proposals, entries);
  if (next.statecraft) reconcilePolities(next, next.turn + 1);
  reconcileFormations(next, []);
  settleCommand(world, next, entries);
  settleStrategy9(world, state, next, entries);
  const closing = funds(next.factions[next.player]);
  Object.assign(finance, { orders: spending({ ...afterIncome, grain: afterIncome.grain + armyReturns }, afterOrders),
    delegation: spending({ treasury: afterOrders.treasury - relief.treasury, grain: afterOrders.grain - relief.grain }, afterDomestic),
    ...(ties ? { realm: { ...ties, relief } } : {}), ...(politics ? { politics } : {}), ...(grand ? { grand } : {}),
    ...(landscape ? { landscape } : {}), ...(statecraft ? { statecraft } : {}), ...(sandtable ? { sandtable } : {}), ...(dynasty ? { dynasty } : {}),
    ...(reign ? { reign } : {}), ...(century ? { century } : {}), closing, programs });
  next.turn += 1;
  next.orders = [];
  const currentEra = next.polity ? eraByYear(world, next) : era;
  clearEndedTreaties(currentEra, next, entries);
  updateCoalition(world, currentEra, next);
  archiveDynasty(world, state, next);
  next.strategies = {};
  const decisions = opponents.decisions.map(({ goal, ...decision }) => {
    const strategy = assessGoal(next, decision.faction, goal);
    if (strategy.status === "active") next.strategies[decision.faction] = goal;
    return { ...decision, strategy };
  });
  const result = gameOutcome(next);
  settleCommandService(world, currentEra, next, entries);
  if (next.stageCompletedAt === null && result !== "defeat") {
    const stage = scenarioObjective(world, era, next);
    if (stage && stage.progress >= stage.required) {
      next.stageCompletedAt = next.turn;
      entries.unshift({ type: "stage", faction: state.player, text: "已完成阶段目标「" + stage.title + "」。" });
    }
  }
  if (result !== "defeat") {
    const milestone = settleCampaignRoute(world, era, next);
    if (milestone) entries.push({ type: "milestone", faction: state.player, text: "达成战役目标「" + milestone + "」。" });
  }
  if (result === "ongoing") {
    entries.push(...recruitRivals(world, currentEra, next));
    for (const { sides, smaller } of reviewAlliances(world, next)) {
      entries.push({ type: "diplomacy", faction: smaller, participants: sides,
        text: sides.map((key) => factionName(currentEra, key)).join("与") + "的同盟尚余一季。双方实力悬殊，续盟意愿下降。" });
    }
    const event = settleCampaignEvent(world, currentEra, next);
    if (event) entries.push({ type: "event", faction: state.player, text: "收到「" + event + "」，可在战役方略中处理。" });
    const treaty = opponentTreaty(world, next);
    if (treaty) {
      const { from, to, kind, reason } = treaty;
      signTreaty(world, next, from, to, kind);
      entries.push({ type: "diplomacy", faction: from, participants: [from, to],
        text: factionName(currentEra, from) + "与" + factionName(currentEra, to) + "签订" + treatyTerms[kind].name + "。" + reason + "。" });
    }
  }
  next.incomingTreaty = result === "ongoing" ? selectIncomingTreaty(world, next) : null;
  if (next.incomingTreaty) {
    const { from, kind, reason } = next.incomingTreaty;
    entries.push({
      type: "diplomacy", faction: state.player, incomingFrom: from, participants: [state.player, from],
      text: factionName(currentEra, from) + "遣使提议" + treatyTerms[kind].name + "。 " + reason,
    });
  }
  if (result !== "ongoing") {
    const name = factionName(era, state.player);
    entries.unshift({
      type: result, faction: state.player,
      text: result === "victory" ? name + (next.reign?.stewardship?.finished ? "完成交班与治理恢复，守成篇结卷。" : "统一天下，战局获胜。")
        : name + "失去所有城池，战局结束。",
    });
  }
  // Stage and terminal notices can be inserted ahead of the orders in the archived report.
  for (const decision of decisions) {
    decision.entryIndex = decision.orderType === "rest" ? null : entries.indexOf(receipts.get(decision.faction));
  }
  recordCampaign(next, entries);
  appendWarReports(next, entries);
  const count = entries.length;
  settleCampaignTasks(world, next, entries);
  appendWarReports(next, entries.slice(count));
  recordPolity(world, next, entries);
  archiveReign(world, state, next);
  archiveCentury(world, next, entries);
  next.history = [...next.history, { turn: next.turn, entries, decisions, finance }].slice(-archivedQuarters);
  if (next.personnelHistory) {
    next.personnelHistory = next.personnelHistory.filter(({ turn }) => turn >= next.turn - archivedQuarters);
    if (!next.personnelHistory.length) delete next.personnelHistory;
  }
  return next;
}

function validPersonnelChange(change, cities, officers, faction) {
  function validPosition(position) {
    return position && (position.city === null || (typeof position.city === "string" && Object.hasOwn(cities, position.city)))
      && (position.role === null || (position.city !== null && ["governor", "commander"].includes(position.role)));
  }
  return change && officers.get(change.officer)?.faction === faction
    && validPosition(change.from) && validPosition(change.to) && personnelChanged(change.from, change.to);
}

function validOrderPersonnel(entry, cities, officers) {
  const role = entry.orderType === "deploy" ? "commander" : entry.orderType === "appoint-governor" ? "governor" : null;
  const change = entry.personnelChange;
  return entry.type === "order" && role && typeof entry.faction === "string"
    && validPersonnelChange(change, cities, officers, entry.faction)
    && change.from.role === null && change.to.role === role && change.to.city === entry.city;
}

function validDecisionReceipt(state, report, { entryIndex, orderType, faction }) {
  if (faction === (report.viewer ?? state.player) || report.turn < 1 || report.turn > state.turn) return false;
  if (orderType === "rest") return entryIndex === null;
  if (!Number.isSafeInteger(entryIndex) || entryIndex < 0) return false;
  const entry = report.entries[entryIndex];
  if (entry?.faction !== faction || typeof entry.city !== "string") return false;
  if (entry.type === "notice") return entry.orderType === orderType;
  if (orderType === "attack") return (entry.type === "capture" || entry.type === "battle") && Boolean(entry.battle);
  return entry.type === "order" && entry.orderType === orderType;
}

function validBattlePersonnel(battle, officers, type) {
  const { personnel, attacker, defender } = battle;
  if (personnel === undefined) return true;
  if (!personnel || officers.get(personnel.attacker)?.faction !== attacker.faction
      || (personnel.defender !== null && officers.get(personnel.defender)?.faction !== defender.faction)) return false;
  const { relocated } = personnel;
  if (type === "battle") return relocated === undefined;
  if (!Array.isArray(relocated) || relocated.length > officers.size) return false;
  const seen = new Set();
  let governor = false;
  let commander = false;
  for (const person of relocated) {
    if (!person || officers.get(person.officer)?.faction !== defender.faction || seen.has(person.officer)) return false;
    if (!["governor", "commander", "available"].includes(person.role)) return false;
    if (person.role === "governor") {
      if (governor) return false;
      governor = true;
    }
    if (person.role === "commander") {
      if (person.officer !== personnel.defender) return false;
      commander = true;
    }
    seen.add(person.officer);
  }
  return commander === (personnel.defender !== null);
}

function validBattle(world, state, officers, entry) {
  const { battle, city, faction, participants, type } = entry;
  if (!battle || (type !== "capture" && type !== "battle")) return false;
  const { from, attacker, defender, occupation } = battle;
  const route = world.cities.find(({ key }) => key === from);
  if (!route?.links.includes(city) || !attacker || !defender || attacker.faction !== faction
      || defender.faction === faction || !participants?.includes(attacker.faction)
      || !participants.includes(defender.faction)) return false;
  for (const { troops, strength, casualties } of [attacker, defender]) {
    if (![troops, casualties].every((value) => Number.isSafeInteger(value) && value >= 0)
        || !Number.isInteger(strength) || strength < 0 || casualties > troops) return false;
  }
  if (attacker.troops < minimumMarch || attacker.casualties >= attacker.troops) return false;
  if (!validBattlePersonnel(battle, officers, type)) return false;
  if (type === "battle") return occupation === undefined && attacker.strength <= defender.strength;
  return occupation && attacker.strength > defender.strength
    && (occupation.inArmy === undefined || (Number.isSafeInteger(occupation.inArmy) && occupation.inArmy >= minimumMarch))
    && (occupation.fieldRemaining === undefined || (Number.isSafeInteger(occupation.fieldRemaining)
      && occupation.fieldRemaining >= 0 && occupation.fieldRemaining <= defender.troops - defender.casualties))
    && occupation.garrison + (occupation.inArmy ?? 0) === attacker.troops - attacker.casualties
    && (occupation.retreatTo === null || (occupation.retreatTo !== city && Object.hasOwn(state.cities, occupation.retreatTo)));
}

export function decodeSave(world, text) {
  const state = JSON.parse(text);
  const era = state && eraByYear(world, state);
  const base = state && eraByYear(world, state.year);
  requireRule(era && state.version === 1 && playableFactions(era).some(({ key }) => key === state.player), "这个存档版本或剧本不可用。");
  if (state.orders === undefined) state.orders = state.order ? [state.order] : [];
  delete state.order;
  requireRule(Array.isArray(state.orders) && state.orders.every((order) => order && typeof order === "object"), "存档政令队列无效。");
  const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
  requireRule(nonnegative(state.turn) && state.turn < 1000000 && Array.isArray(state.history)
    && state.history.length <= archivedQuarters, "存档季度记录无效。");
  state.stageCompletedAt ??= null;
  requireRule(state.stageCompletedAt === null || (Number.isSafeInteger(state.stageCompletedAt)
    && state.stageCompletedAt >= 1 && state.stageCompletedAt <= state.turn), "存档阶段目标记录无效。");
  const officers = new Map(era.officers.map((entry) => [entry.key, entry]));
  requireRule(state.recruitedOfficers === undefined || (Array.isArray(state.recruitedOfficers)
    && new Set(state.recruitedOfficers).size === state.recruitedOfficers.length
    && state.recruitedOfficers.every((key) => officers.get(key)?.reserve?.turn <= state.turn)), "存档招揽名单无效。");
  requireRule(validTheaters(state, officers), "存档战区或军费无效。");
  const occupied = new Set();
  requireRule(state.cities && Object.keys(state.cities).length === world.cities.length, "存档需要包含完整的 42 城。");
  requireRule(state.factions && Object.keys(state.factions).length === era.factions.length, "存档势力资料不全。");
  requireRule(validPolity(world, state, era, base), "存档势力演变、州郡或议案资料无效。");
  requireRule(validGrand(world, state, officers), "存档战略调度、联军编组或议约资料无效。");
  requireRule(validLandscape(world, state), "存档时令、物流或多方议约资料无效。");
  requireRule(validStatecraft(world, state, officers), "存档全国方针、战区或人才资料无效。");
  requireRule(validSandtable(world, state, officers), "存档沙盘据点、战争或动员记录无效。");
  requireRule(validFrontline(state, officers), "存档会战、军团履历或联军请求无效。");
  requireRule(validHighCommand(state, officers), "存档全国军议或战役授权无效。");
  requireRule(validDynasty(world, state, officers), "存档天下经略、工程或粮运资料无效。");
  requireRule(validStrategy9(world, state, officers), "存档诸侯争衡、战区或战略调令资料无效。");
  requireRule(validReign(world, state, officers), "存档王朝兴替、民仓、册任或集团资料无效。");
  requireRule(validCentury(world, state, officers), "存档山河百年、年度方略或战役纪事无效。");
  requireRule(validCampaignProgress(state, officers), "存档战役或武将资历无效。");
  requireRule(state.nationalPolicy === undefined || validNationalPolicy(state.nationalPolicy), "存档国策无效。");
  const overrides = state.policyOverrides;
  requireRule(overrides === undefined || (state.nationalPolicy && Array.isArray(overrides) && new Set(overrides).size === overrides.length
    && overrides.every((key) => typeof key === "string" && owns(state, key))), "存档手动接管记录无效。");
  state.strategies ??= {};
  requireRule(typeof state.strategies === "object" && !Array.isArray(state.strategies)
    && Object.entries(state.strategies).every(([key, goal]) => key !== state.player
      && era.factions.some((faction) => faction.key === key) && validGoal(world, goal, state.turn)), "存档势力战略无效。");
  for (const { key } of era.factions) {
    const stocks = state.factions[key];
    requireRule(stocks && [stocks.treasury, stocks.grain, stocks.morale].every(nonnegative), "存档钱粮数据无效。");
  }
  for (const { key } of world.cities) {
    const city = state.cities[key];
    requireRule(city && era.factions.some((faction) => faction.key === city.owner) && nonnegative(city.troops), "存档城池数据无效。");
    requireRule(Object.keys(projects).every((project) => nonnegative(city[project]) && city[project] <= 5), "存档建设等级无效。");
    city.delegateBudget ??= null;
    city.occupation ??= 0;
    requireRule(nonnegative(city.occupation) && city.occupation <= occupationSeasons, "存档占领整顿状态无效。");
    requireRule(governanceFocus.includes(city.focus) && (city.focus !== "auto" || city.owner === state.player) && validBudget(city.delegateBudget)
      && (city.mode === "direct" || (city.mode === "delegated" && city.governor)), "存档内政设置无效。");
    for (const officer of [city.governor, city.commander]) {
      if (officer === null) continue;
      requireRule(officers.get(officer)?.faction === city.owner && knownOfficer(state, officers.get(officer)) && !occupied.has(officer), "存档人员职务冲突。");
      occupied.add(officer);
    }
  }
  requireRule(state.delegationPriority === undefined || validDelegationPriority(state, state.delegationPriority), "存档委任优先级无效。");
  requireRule(state.delegationReserve === undefined || validResourcePair(state.delegationReserve), "存档委任预留无效。");
  state.treaties ??= [];
  state.treatyOffers ??= [];
  state.incomingTreaty ??= null;
  requireRule(validDiplomacy(state, era), "存档外交记录无效。");
  const startingStations = initialStations(world, era, state);
  requireRule(state.stations === undefined || (state.stations && typeof state.stations === "object" && !Array.isArray(state.stations)), "存档人员驻地无效。");
  state.stations = { ...startingStations, ...state.stations };
  for (const [key, city] of Object.entries(state.stations)) {
    const officer = officers.get(key);
    const posting = postingOf(state, key);
    requireRule(officer && (knownOfficer(state, officer) || city === null)
      && (posting ? posting.city === city : city === null || owns(state, city, officer.faction)), "存档人员驻地无效。");
  }
  requireRule(validArmies(world, state, officers), "存档军团或行军道路无效。");
  requireRule(state.personnelHistory === undefined || (Array.isArray(state.personnelHistory)
    && state.personnelHistory.length <= personnelHistoryLimit
    && state.personnelHistory.every((change, index, history) => validPersonnelChange(change, state.cities,
      state.polity ? new Map(eraByYear(world, state, change?.turn).officers.map((person) => [person.key, person])) : officers, state.player)
      && nonnegative(change.turn) && change.turn <= state.turn && change.turn >= state.turn - archivedQuarters
      && (!index || change.turn >= history[index - 1].turn))), "存档人事履历无效。");
  for (const report of state.history) {
    const historical = state.polity ? new Map(eraByYear(world, state, Math.max(0, report?.turn - 1)).officers.map((person) => [person.key, person])) : officers;
    requireRule(report && nonnegative(report.turn) && (report.viewer === undefined || state.sandtable && Object.hasOwn(state.factions, report.viewer))
      && Array.isArray(report.entries)
      && report.entries.every((entry) => entry && typeof entry.text === "string" && typeof entry.type === "string"
        && (entry.type !== "war" || (warEvents.has(entry.event) && Object.hasOwn(state.factions, entry.faction)
          && Object.hasOwn(state.cities, entry.city) && (entry.officer === undefined || officers.has(entry.officer))))
        && (entry.city === undefined || Object.hasOwn(state.cities, entry.city))
        && (entry.participants === undefined || (Array.isArray(entry.participants)
          && entry.participants.every((faction) => Object.hasOwn(state.factions, faction))))
        && (entry.battle === undefined || validBattle(world, state, historical, entry))
        && (entry.personnelChange === undefined || (report.turn >= 1 && report.turn <= state.turn
          && validOrderPersonnel(entry, state.cities, historical)))), "存档奏报无效。");
    if (report.decisions !== undefined) {
      requireRule(Array.isArray(report.decisions) && report.decisions.length <= era.factions.length
        && report.decisions.every((decision) => decision && era.factions.some(({ key }) => key === decision.faction)
          && ["model", "rules", "fallback"].includes(decision.source)
          && ["attack", "mobilize", "transfer", "deploy", "appoint-governor", "delegate-city", "build", "recruit", "rest"].includes(decision.orderType)
          && typeof decision.reason === "string" && typeof decision.action === "string"
          && (decision.strategy === undefined || validGoalResult(world, decision.strategy, report.turn))), "存档对手政令无效。");
      const linked = report.decisions.filter(({ entryIndex }) => entryIndex !== undefined);
      requireRule(new Set(linked.map(({ faction }) => faction)).size === linked.length
        && linked.every((decision) => validDecisionReceipt(state, report, decision)), "存档对手政令回执无效。");
    }
    if (report.finance !== undefined) requireRule(validLedger(report.finance, state.cities, governanceFocus, developmentProjects), "存档财政账目无效。");
  }
  requireRule(validEnding(world, state, officers), "存档结局或复盘无效。");
  requireRule(validRealm(world, state, officers) && validAccords(world, state), "存档国政或通商资料无效。");
  requireRule(state.war === undefined || (state.war && validIntelligence(state, officers) && validWarRecords(state, officers)
    && validRecovery(state)), "存档战役、情报或接管计划无效。");
  previewOrders(world, state);
  return state;
}
