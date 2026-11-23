import { appoint, delegationZones, eraByYear, factionName, gameOutcome, needsRecoveryGovernor, pendingExpedition, postingOf, transferOfficer } from "./engine.js";
import { officerSkill } from "./campaign.js";
import { armyByOfficer } from "./armies.js";
import { knownOfficer } from "./personnel.js";
import { nationalDuty } from "./realm.js";

function personnelStatus(state, officer) {
  const posting = postingOf(state, officer);
  const expedition = pendingExpedition(state, officer);
  const army = armyByOfficer(state, officer);
  const office = nationalDuty(state, officer);
  return { posting, expedition, ...(army ? { army } : {}), ...(office ? { office } : {}), available: !posting && !expedition && !army && !office };
}

function latestRelocations(state) {
  const records = new Map();
  for (const { turn, entries } of state.history) {
    for (const entry of entries) {
      if (entry.type !== "capture") continue;
      for (const { officer, role } of entry.battle?.personnel?.relocated ?? []) {
        records.set(officer, { entry, turn, role, destination: entry.battle.occupation.retreatTo });
      }
    }
  }
  return records;
}

export function nationalRoster(world, state, { status, sort, query }) {
  const era = eraByYear(world, state);
  const stations = new Map(world.cities.map(({ key, name }) => [key, name]));
  const relocations = status === "relocated" ? latestRelocations(state) : null;
  const rows = era.officers.filter((person) => person.faction === state.player && knownOfficer(state, person)).map((base) => {
    const person = { ...base, governance: officerSkill(state, base, "governance"), command: officerSkill(state, base, "command") };
    const status = personnelStatus(state, person.key);
    const station = status.army?.location ?? state.stations[person.key];
    return { person, station, stationName: stations.get(station), relocation: relocations?.get(person.key), ...status };
  });
  const term = query.trim();
  const matching = rows.filter((row) => {
    if (term && !row.person.name.includes(term) && !row.stationName?.includes(term)) return false;
    if (status === "all") return true;
    if (status === "available") return row.available;
    if (status === "expedition") return Boolean(row.expedition || row.army);
    if (status === "relocated") return Boolean(row.relocation);
    return row.posting?.role === status;
  });
  matching.sort((a, b) => b.person[sort] - a.person[sort]);
  return { matching, total: rows.length };
}

export function nationalVacancies(world, state, planned, { role, area }) {
  const front = new Set(delegationZones(world, state).front);
  const ongoing = gameOutcome(state) === "ongoing";
  const available = ongoing ? nationalRoster(world, state, { status: "available", sort: "governance", query: "" }).matching : [];
  const matching = [];
  for (const city of world.cities) {
    const holding = state.cities[city.key];
    if (holding.owner !== state.player) continue;
    const zone = front.has(city.key) ? "front" : "rear";
    const recovering = holding.occupation > 0;
    if (area === "occupation" ? !recovering : area !== "all" && area !== zone) continue;
    const stationed = available.filter(({ station }) => station === city.key).length;
    const departing = state.orders.filter((order) => order.type === "attack" && order.from === city.key).length;
    const projected = planned.cities[city.key];
    for (const position of ["governor", "commander"]) {
      if (holding[position] || (role !== "all" && role !== position)) continue;
      const accelerates = position === "governor" && recovering && needsRecoveryGovernor(projected);
      const priority = Number(accelerates) * 2 + Number(position === "commander" && zone === "front");
      matching.push({ city, role: position, zone, recovering, accelerates, stationed, departing, priority });
    }
  }
  matching.sort((a, b) => b.priority - a.priority);
  return { matching, available: available.length, ongoing };
}

export function officerProfile(world, state, key) {
  const era = eraByYear(world, state);
  const person = era.officers.find((officer) => officer.key === key);
  if (!person) return null;
  const records = [];
  const timeline = [];
  const reports = [...state.history].sort((a, b) => b.turn - a.turn);
  for (const { turn, entries } of reports) {
    for (const entry of [...entries].reverse()) {
      if (entry.personnelChange?.officer === key) {
        timeline.push({ type: "personnel", season: turn - 1, settled: true, change: entry.personnelChange });
      }
      const { battle } = entry;
      const personnel = battle?.personnel;
      if (!personnel) continue;
      const attack = personnel.attacker === key;
      const defend = personnel.defender === key;
      const relocation = personnel.relocated?.find(({ officer }) => officer === key);
      if (!attack && !defend && !relocation) continue;
      const record = {
        entry, turn, attack, defend,
        relocation: relocation ? { role: relocation.role, destination: battle.occupation.retreatTo } : null,
      };
      records.push(record);
      timeline.push({ type: "battle", season: turn - 1, record });
    }
  }
  for (const change of [...(state.personnelHistory ?? [])].reverse()) {
    if (change.officer === key) timeline.push({ type: "personnel", season: change.turn, settled: false, change });
  }
  for (const { from, to, turn } of state.polity?.allegiances[key] ?? []) {
    timeline.push({ type: "polity", season: turn - 1, text: "由" + factionName(era, from) + "转仕" + factionName(era, to) + "。" });
  }
  for (const item of state.polity?.history ?? []) {
    if (item.officer === key) timeline.push({ type: "polity", season: item.turn - 1, text: item.text });
  }
  // The stable sort keeps settlement entries ahead of the same season's direct actions.
  timeline.sort((a, b) => b.season - a.season);
  return { person, station: state.stations[key], ...personnelStatus(state, key), records, timeline };
}

export function personnelDestinations(world, state, officer, role) {
  if (!["station", "governor", "commander"].includes(role) || gameOutcome(state) !== "ongoing") return [];
  const era = eraByYear(world, state);
  if (!era.officers.some(({ key, faction }) => key === officer && faction === state.player)
      || !personnelStatus(state, officer).available) return [];
  return ownPersonnelDestinations(world, state, officer, role);
}

function ownPersonnelDestinations(world, state, officer, role) {
  return world.cities.filter(({ key }) => {
    const city = state.cities[key];
    return city.owner === state.player && (role === "station" ? state.stations[officer] !== key : !city[role]);
  });
}

export function reassignmentOptions(world, state, officer) {
  const era = eraByYear(world, state);
  const person = era.officers.find(({ key, faction }) => key === officer && faction === state.player);
  if (!person || gameOutcome(state) !== "ongoing") return null;
  const { posting, expedition } = personnelStatus(state, officer);
  if (!posting || expedition || state.cities[posting.city].owner !== state.player) return null;
  return {
    person,
    posting,
    governors: ownPersonnelDestinations(world, state, officer, "governor"),
    commanders: ownPersonnelDestinations(world, state, officer, "commander"),
    endsDelegation: posting.role === "governor" && state.cities[posting.city].mode === "delegated",
    removesPriority: posting.role === "governor" && Boolean(state.delegationPriority?.includes(posting.city)),
  };
}

export function usePersonnel(world, state, officer, role, city) {
  if (!personnelDestinations(world, state, officer, role).some(({ key }) => key === city)) {
    throw new Error("当前无法在该城调驻或任用这名人员。请检查职务空缺和出征令。");
  }
  return role === "station" ? transferOfficer(world, state, officer, city) : appoint(world, state, city, role, officer);
}
