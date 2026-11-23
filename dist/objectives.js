import { isHostile } from "./diplomacy.js";

export const frontierGarrisonTarget = 1800;
const farmingTarget = 2;
const defenseTarget = 2;

function objective(title, description, required, rows) {
  return { title, description, required, progress: rows.filter(({ met }) => met).length, rows };
}

export function scenarioObjective(world, era, state) {
  const owned = world.cities.filter(({ key }) => state.cities[key].owner === state.player)
    .map((city) => ({ city, holding: state.cities[city.key] }));
  if (era.year === 190) return objective("立足一方", "守住两座主城，并把两城的驻军提升到 1,600。", 2,
    owned.map((row) => ({ ...row, met: row.holding.troops >= 1600 && !row.holding.occupation })));
  if (era.year === 219) {
    const sites = ["nanzheng", "shangyong", "xiangyang", "jiangling", "jiangxia", "chaisang"];
    return objective("控制荆汉要道", "在六座荆汉要城中稳固控制两座。驻军须达到 1,500。", 2,
      owned.filter(({ city }) => sites.includes(city.key))
        .map((row) => ({ ...row, met: row.holding.troops >= 1500 && !row.holding.occupation })));
  }
  if (era.year === 199) {
    const startingCities = Object.values(era.ownership).filter((owner) => owner === state.player).length;
    const required = Math.min(2, startingCities);
    const rows = owned.map((row) => {
      const { mode, focus, farming } = row.holding;
      return { ...row, met: mode === "delegated" && focus === "farming" && farming >= farmingTarget };
    });
    return objective("安民积粮", `让 ${required} 座辖城委任屯田，且屯田达到 ${farmingTarget} 级。`, required, rows);
  }
  if (era.year === 208) {
    const required = Math.min(2, Object.values(era.ownership).filter((owner) => owner === state.player).length);
    const rows = owned.map((row) => ({ ...row, met: !row.holding.occupation && row.holding.commerce >= 2 }));
    return objective("立稳商埠", `让 ${required} 座已结束整顿的辖城达到 2 级商贸。`, required, rows);
  }
  if (era.year === 262) {
    const front = owned.filter(({ city }) => city.links.some((key) => isHostile(state, state.player, state.cities[key].owner)));
    const rows = front.map((row) => {
      const troopShortage = Math.max(0, frontierGarrisonTarget - row.holding.troops);
      const defenseShortage = Math.max(0, defenseTarget - row.holding.defense);
      return { ...row, troopShortage, defenseShortage, met: troopShortage === 0 && defenseShortage === 0 };
    });
    return objective("整备边军", `让 2 座前线辖城各有至少 ${frontierGarrisonTarget.toLocaleString("en-US")} 驻军，且城防达到 ${defenseTarget} 级。`, 2, rows);
  }
  if (era.year !== 265) return null;
  const rows = owned.filter(({ city }) => era.ownership[city.key] !== state.player)
    .map((row) => ({ ...row, met: row.holding.occupation === 0 }));
  return objective("重整州郡", "攻占开局疆域之外的 2 座城池，并完成整顿。", 2, rows);
}
