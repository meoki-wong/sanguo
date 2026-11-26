const leaders = {
  cao: ["曹操", "北方整军", "xu", [190, 175, 65]],
  wu: ["孙权", "江东通商", "moling", [118, 100, 70]],
  liu: ["刘备", "守江联吴", "jiangxia", [84, 96, 76]],
  han: ["荆南诸郡", "守土互市", "linxiang", [88, 82, 68]],
  zhang: ["刘璋", "安定益州", "chengdu", [103, 120, 66]],
  lu: ["张鲁", "汉中储粮", "nanzheng", [84, 88, 75]],
  ma: ["马腾与韩遂", "关凉军备", "tianshui", [99, 104, 65]],
  gongsun: ["公孙康", "经营辽东", "xiangping", [78, 90, 68]],
  shi: ["士燮", "交州通商", "jiaozhi", [96, 102, 74]],
};

const people = {
  cao: [
    ["荀彧", 96, 55, "xu"], ["曹仁", 75, 89, "jiangling"], ["夏侯惇", 72, 86, "wan"], ["张辽", 72, 95, "shouchun"],
    ["荀攸", 94, 59, "xu"], ["贾诩", 91, 72, "xiangyang"], ["赵俨", 84, 70, "xinye"], ["乐进", 63, 84, "shangyong"],
    ["李典", 76, 82, "runan"], ["于禁", 70, 86, "shouchun"], ["徐晃", 71, 91, "luoyang"], ["满宠", 88, 84, "xiangyang"],
    ["臧霸", 67, 81, "xiapi"], ["田豫", 83, 75, "beiping"], ["程昱", 90, 64, "ye"], ["曹洪", 61, 82, "wan"],
  ],
  wu: [["张昭", 91, 48], ["周瑜", 90, 96], ["鲁肃", 93, 74], ["程普", 69, 84], ["吕蒙", 74, 88, "lujiang"], ["孙权", 87, 76]],
  liu: [["诸葛亮", 98, 78], ["关羽", 76, 94], ["张飞", 51, 89], ["赵云", 74, 90], ["糜竺", 85, 53], ["刘备", 85, 80]],
  han: [["韩玄", 77, 57], ["黄忠", 65, 92], ["刘度", 76, 45], ["赵范", 72, 56], ["金旋", 64, 67], ["魏延", 63, 86]],
  zhang: [["黄权", 89, 68], ["张任", 70, 86], ["法正", 95, 65], ["刘巴", 89, 47]],
  lu: [["阎圃", 84, 51], ["张卫", 64, 76], ["张鲁", 81, 66]],
  ma: [["成公英", 80, 65], ["马超", 58, 94], ["庞德", 60, 87], ["韩遂", 78, 81]],
  gongsun: [["公孙康", 81, 71], ["公孙恭", 73, 64], ["柳毅", 69, 65]],
  shi: [["士燮", 86, 63, "jiaozhi"], ["士壹", 78, 59, "panyu"], ["士武", 66, 70, "panyu"], ["士䵋", 68, 56, "jiaozhi"]],
};

export function redCliffScenario(world, earlier) {
  const ownership = Object.fromEntries(world.cities.map(({ key }) => {
    const former = earlier.ownership[key];
    if (former === "yuan") return [key, "cao"];
    if (former === "ce") return [key, "wu"];
    if (key === "jiangxia") return [key, "liu"];
    if (["linxiang", "guiyang", "quanling", "linyuan"].includes(key)) return [key, "han"];
    return [key, former === "biao" ? "cao" : former];
  }));
  const positions = new Map(world.cities.map(({ key, position }) => [key, position]));
  const factions = Object.entries(leaders).map(([key, [name, trait, capital, stats]]) => ({
    key, name, trait, stats, position: positions.get(capital),
    path: Object.keys(ownership).filter((city) => ownership[city] === key).map((city) => earlier.zones[city]).join(" "),
  }));
  const officers = Object.entries(people).flatMap(([faction, roster]) => roster.map(([name, governance, command, home], index) => ({
    key: faction + "-208-" + index, faction, name, governance, command, ...(home ? { home } : {}),
  })));
  return { year: 208, title: "赤壁前夕", ownership, officers, factions, zones: earlier.zones,
    capitals: Object.fromEntries(Object.entries(leaders).map(([key, [, , capital]]) => [key, capital])),
    periodNames: { ...earlier.periodNames } };
}
