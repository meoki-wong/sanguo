const openings = {
  184: {
    title: "黄巾起事",
    sides: {
      han: ["汉廷", "平乱安民", "luoyang", 180, 164, 66, "luoyang changan wan xinye xiangyang chenliu xu jinyang", ["汉灵帝", "皇甫嵩", "朱儁", "卢植", "何进", "刘备", "曹操"]],
      yellow: ["张角", "联结诸郡", "ye", 110, 145, 76, "ye pingyuan puyang nanpi beihai runan xiaopei xiapi shouchun", ["张角", "张宝", "张梁", "波才", "彭脱", "管亥"]],
      frontier: ["刘虞", "绥靖北境", "ji", 100, 103, 71, "beiping ji xiangping", ["刘虞", "公孙瓒", "阎柔", "田豫"]],
      biao: ["荆州诸郡", "安定郡县", "jiangling", 111, 122, 65, "jiangxia jiangling linxiang guiyang linyuan quanling shangyong", ["王叡", "刘表", "蔡瑁", "蒯越"]],
      jian: ["孙坚", "整备江东", "moling", 105, 110, 72, "chaisang lujiang moling wu shanyin", ["孙坚", "程普", "黄盖", "韩当", "祖茂"]],
      yan: ["益州诸郡", "保境护蜀", "chengdu", 120, 130, 65, "chengdu zitong jiangzhou yufu jianning yunnan nanzheng", ["郤俭", "刘焉", "张鲁", "张任"]],
      ma: ["西凉诸部", "守住陇右", "tianshui", 93, 102, 64, "tianshui guzang anding", ["北宫伯玉", "李文侯", "韩遂", "马腾"]],
    },
  },
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
  234: {
    title: "五丈原",
    sides: {
      wei: ["魏", "守住渭水", "luoyang", 220, 185, 71, "xiangping beiping ji nanpi pingyuan jinyang ye guzang tianshui anding changan beihai xiapi xiaopei shouchun puyang chenliu xu runan luoyang wan xinye xiangyang shangyong",
        ["曹叡", "司马懿", "郭淮", "费曜", "陈群", "满宠", "杜袭", "夏侯霸", "辛毗", "秦朗"]],
      shu: ["蜀", "北伐陇右", "chengdu", 160, 155, 71, "nanzheng zitong chengdu jiangzhou yufu jianning yunnan",
        ["刘禅", "诸葛亮", "魏延", "杨仪", "姜维", "王平", "蒋琬", "费祎", "邓芝", "马岱"]],
      wu: ["吴", "水陆牵制", "moling", 171, 168, 73, "jiangxia jiangling linxiang guiyang quanling linyuan moling wu shanyin lujiang chaisang",
        ["孙权", "陆逊", "诸葛瑾", "朱然", "步骘", "潘璋", "顾雍", "全琮", "陆凯", "孙韶"]],
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
