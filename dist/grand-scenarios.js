const openings = {
  190: {
    title: "关东联军",
    sides: {
      dong: ["董卓", "西守关中", "luoyang", 172, 160, 60, "luoyang changan wan jinyang", ["董卓", "吕布", "李傕", "郭汜", "贾诩", "华雄", "徐荣"]],
      yuan: ["袁绍", "联合诸侯", "nanpi", 138, 125, 69, "nanpi ye pingyuan", ["袁绍", "颜良", "文丑", "逢纪", "许攸", "郭图"]],
      cao: ["曹操", "立足陈留", "chenliu", 110, 106, 68, "chenliu xu puyang", ["曹操", "曹仁", "夏侯惇", "夏侯渊", "曹洪", "乐进"]],
      gongsun: ["公孙瓒", "护持北疆", "beiping", 106, 110, 68, "beiping ji xiangping", ["公孙瓒", "刘备", "关羽", "张飞", "赵云", "田豫"]],
      jiu: ["袁术", "经营淮南", "shouchun", 130, 134, 67, "shouchun runan xiaopei xiapi beihai", ["袁术", "纪灵", "阎象", "杨弘", "张勋", "桥蕤"]],
      biao: ["刘表", "绥靖荆襄", "xiangyang", 120, 137, 70, "xiangyang xinye jiangxia jiangling shangyong", ["刘表", "蒯越", "蔡瑁", "蒯良", "文聘", "黄祖"]],
      jian: ["孙坚", "北上勤王", "linxiang", 128, 137, 74, "linxiang guiyang linyuan quanling chaisang lujiang moling wu shanyin", ["孙坚", "黄盖", "程普", "韩当", "祖茂", "孙策"]],
      yan: ["刘焉", "自守蜀道", "chengdu", 132, 146, 70, "chengdu zitong jiangzhou yufu jianning yunnan nanzheng", ["刘焉", "刘璋", "张鲁", "赵韪", "张任", "庞羲"]],
      ma: ["马腾与韩遂", "联保西凉", "tianshui", 95, 104, 67, "tianshui guzang anding", ["马腾", "韩遂", "庞德", "成公英", "梁兴", "马超"]],
    },
  },
  219: {
    title: "荆襄争夺",
    sides: {
      cao: ["曹操", "扼守汉水", "xu", 210, 190, 69, "xiangping beiping ji nanpi pingyuan jinyang ye guzang tianshui anding changan beihai xiapi xiaopei shouchun puyang chenliu xu runan luoyang wan xinye xiangyang",
        ["曹操", "曹仁", "徐晃", "满宠", "庞德", "于禁", "张辽", "司马懿", "陈群", "贾诩", "曹休", "乐进"]],
      liu: ["刘备", "守汉中与荆州", "chengdu", 175, 172, 74, "shangyong jiangling linxiang guiyang quanling linyuan nanzheng zitong chengdu jiangzhou yufu jianning yunnan",
        ["刘备", "诸葛亮", "关羽", "关平", "张飞", "赵云", "黄忠", "魏延", "马超", "法正", "廖化", "关兴"]],
      wu: ["孙权", "经营长江", "moling", 154, 161, 73, "jiangxia moling wu shanyin lujiang chaisang",
        ["孙权", "吕蒙", "陆逊", "甘宁", "周泰", "朱然", "蒋钦", "潘璋", "顾雍", "张昭"]],
    },
  },
};

export function grandScenarios(world, baseline) {
  const positions = new Map(world.cities.map(({ key, position }) => [key, position]));
  const skills = [[86, 80], [93, 56], [66, 93], [73, 88], [90, 73], [67, 87], [78, 87], [91, 76]];
  return Object.entries(openings).map(([value, { title, sides }]) => {
    const year = Number(value);
    const ownership = {};
    const capitals = {};
    const factions = [];
    const officers = [];
    for (const [key, [name, trait, capital, treasury, grain, morale, list, roster]] of Object.entries(sides)) {
      const cities = list.split(" ");
      for (const city of cities) {
        if (!positions.has(city) || ownership[city]) throw new Error("剧本城池配置冲突 " + year + " " + city);
        ownership[city] = key;
      }
      capitals[key] = capital;
      factions.push({ key, name, trait, stats: [treasury, grain, morale], position: positions.get(capital),
        path: cities.map((city) => baseline.zones[city]).join(" ") });
      for (const [index, person] of roster.entries()) {
        const [governance, command] = skills[index % skills.length];
        officers.push({ key: key + "-" + year + "-" + index, name: person, faction: key, governance, command,
          home: index === 0 ? capital : cities[(index - 1) % cities.length] });
      }
    }
    if (Object.keys(ownership).length !== world.cities.length) throw new Error("剧本未覆盖全量城池 " + year);
    return { year, title, ownership, capitals, factions, officers, zones: baseline.zones, periodNames: { ...baseline.periodNames } };
  });
}
