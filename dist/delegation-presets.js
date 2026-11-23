import { forecastDelegationZones, projects } from "./engine.js";

export const zonePresets = {
  balanced: { name: "均衡发展", front: "auto", rear: "auto" },
  grain: { name: "积蓄粮草", front: "farming", rear: "farming" },
  defense: { name: "巩固边防", front: "defense", rear: "farming" },
};

export function presetPolicies(key) {
  if (!Object.hasOwn(zonePresets, key)) return null;
  const preset = zonePresets[key];
  const autoBudget = Math.max(...Object.values(projects).map(({ cost }) => cost));
  return Object.fromEntries(["front", "rear"].map((zone) => {
    const focus = preset[zone];
    return [zone, { focus, budget: focus === "auto" ? autoBudget : projects[focus].cost }];
  }));
}

export function compareDelegationPresets(world, state) {
  return Object.entries(zonePresets).map(([key, { name }]) => {
    try {
      const { groups, closing, spent } = forecastDelegationZones(world, state, presetPolicies(key));
      const rows = [...groups.front.rows, ...groups.rear.rows];
      const projectsDone = Object.fromEntries(Object.keys(projects).map((project) => [project, 0]));
      const blockers = new Map();
      let completed = 0;
      let appointments = 0;
      for (const row of rows) {
        if (row.newGovernor) appointments += 1;
        if (row.result === "completed") {
          completed += 1;
          projectsDone[row.project ?? row.focus] += 1;
        } else {
          blockers.set(row.result, (blockers.get(row.result) ?? 0) + 1);
        }
      }
      return { key, name, completed, total: rows.length, appointments, projectsDone, spent, closing,
        blockers: [...blockers].sort((a, b) => b[1] - a[1]) };
    } catch (error) {
      return { key, name, error: error.message };
    }
  });
}
