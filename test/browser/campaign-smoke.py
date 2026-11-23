import json
import os
import re
import socket
import subprocess
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from urllib.error import URLError
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
WORLD = json.loads((ROOT / "dist/assets/world.json").read_text(encoding="utf-8"))
WORLD_CITIES = {city["key"]: city for city in WORLD["cities"]}
AUTO = "jinglue-sanguo:auto:v1"
MODEL = "smoke-fixture"
SCENARIOS = [
    ("199", "cao", "grain", (1440, 900)),
    ("262", "shu", "balanced", (390, 844)),
    ("265", "wu", "defense", (320, 440)),
]


@contextmanager
def isolated_game():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    address = f"http://127.0.0.1:{port}"
    with subprocess.Popen(["node", "server.mjs"], cwd=ROOT, env={**os.environ, "SAN_PORT": str(port)},
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
        try:
            status = None
            for _ in range(70):
                if process.poll() is not None:
                    raise RuntimeError("独立测试服务提前退出")
                try:
                    with urlopen(address + "/api/ai", timeout=0.5) as response:
                        status = json.load(response)
                    break
                except URLError:
                    time.sleep(0.07)
            assert status is not None and not status["ready"], "无法启动独立测试服务"
            yield address
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)


@contextmanager
def simulated_model():
    calls = []
    probes = []
    requested = Event()
    begin = Event()
    finish = Event()

    class ModelServer(ThreadingHTTPServer):
        request_queue_size = 16

    class ModelHandler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                self.reply(404, {})
                return
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if len(request["messages"]) == 1:
                model = request["model"]
                key = self.headers.get("Authorization")
                probes.append((model, key))
                assert set(request) == {"model", "messages", "stream"} and request["stream"] is False
                assert '"choice":"0"' in request["messages"][0]["content"]
                if key != "Bearer local-smoke-fixture":
                    self.reply(403, {"error": {"message": key}})
                    return
                if model == "missing-fixture":
                    self.reply(404, {"error": {"message": key}})
                    return
                if model == "incompatible-fixture":
                    self.reply(200, {"choices": [{"message": {"content": key}}]})
                    return
                if model == "timeout-fixture":
                    self.reply(504, {"error": {"message": key}})
                    return
                assert model == MODEL
                content = json.dumps({"choice": "0", "reason": key})
                self.reply(200, {"choices": [{"message": {"content": content}}]})
                return
            assert request["model"] == MODEL
            prompt = request["messages"][1]["content"]
            lines = prompt.splitlines()
            faction = lines[0].split(" · ", 1)[0]
            calls.append(faction)
            requested.set()
            if not begin.wait(15) or (faction == "刘表" and not finish.wait(15)):
                self.reply(504, {"error": "fixture gate timed out"})
                return
            if faction == "袁绍":
                self.reply(503, {"error": "fixture unavailable"})
                return
            choices = [(line.split(" ", 1)[0], line) for line in lines if re.match(r"^\d+ ", line)]
            choice = next((key for key, line in choices if "休整" not in line), choices[0][0])
            content = json.dumps({"choice": choice, "reason": "测试拟令"})
            self.reply(200, {"choices": [{"message": {"content": content}}]})

    with ModelServer(("127.0.0.1", 0), ModelHandler) as service:
        thread = Thread(target=service.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{service.server_port}/v1", calls, probes, requested, begin, finish
        finally:
            begin.set()
            finish.set()
            service.shutdown()
            thread.join(timeout=3)


def capture_fixture():
    source = """
import fs from 'node:fs';
import {createGame} from './dist/engine.js';
import {enrichWorld} from './dist/personnel.js';
const world=enrichWorld(JSON.parse(fs.readFileSync('./dist/assets/world.json')));
const state=createGame(world,199,'cao');
for(const city of Object.values(state.cities)) {
  if(city.owner!=='cao') city.troops=250;
}
Object.assign(state.cities.changan,{troops:0,defense:0});
console.log(JSON.stringify({state,selected:'luoyang'}));
"""
    raw = subprocess.check_output(["node", "--input-type=module", "-e", source], cwd=ROOT, encoding="utf-8")
    return json.loads(raw)


def stage_fixture(year, player):
    source = """
import fs from 'node:fs';
import {createGame, decodeSave, delegateCities, firstCity} from './dist/engine.js';
import {enrichWorld} from './dist/personnel.js';
const world = enrichWorld(JSON.parse(fs.readFileSync('./dist/assets/world.json')));
const year = Number(process.argv[1]);
const player = process.argv[2];
let state = createGame(world, year, player);
for (const city of Object.values(state.cities)) {
  if (city.owner !== player) city.troops = 250;
}
const owned = ({key}) => state.cities[key].owner === player;
if (year === 199) {
  const keys = world.cities.filter(owned).slice(0, 2).map(({key}) => key);
  state = delegateCities(world, state, keys, 'farming', 22);
  for (const key of keys) state.cities[key].farming = 1;
} else if (year === 262) {
  const frontline = world.cities.filter(city => owned(city) && city.links.some(key => !owned({key})));
  for (const {key} of frontline.slice(0, 2)) Object.assign(state.cities[key], {troops: 1800, defense: 2});
} else {
  const rivals = world.cities.filter(city => !owned(city)).slice(0, 2);
  for (const {key} of rivals) Object.assign(state.cities[key], {owner: player, occupation: 1, troops: 800, governor: null, commander: null});
  delete state.stations;
  state = decodeSave(world, JSON.stringify(state));
}
console.log(JSON.stringify({state, selected: firstCity(world, state)}));
"""
    raw = subprocess.check_output(["node", "--input-type=module", "-e", source, year, player], cwd=ROOT, encoding="utf-8")
    return json.loads(raw)


def supply_cut_fixture():
    source = """
import fs from 'node:fs';
import {advanceQuarter, createGame, playableFactions, queueOrder} from './dist/engine.js';
import {enrichWorld} from './dist/personnel.js';
const world = enrichWorld(JSON.parse(fs.readFileSync('./dist/assets/world.json')));
const era = world.scenarios.find(({year}) => year === 199);
let state = createGame(world, 199, 'cao');
const rest = Object.fromEntries(playableFactions(era).filter(({key}) => key !== 'cao').map(({key}) => [key, {source:'model', order:null, reason:'rest'}]));
Object.assign(state.cities.puyang, {owner:'yuan', troops:3500});
Object.assign(state.cities.changan, {owner:'yuan', troops:0, defense:0});
state.cities.chenliu.troops = 2100;
state.stations['yuan-roster-4'] = 'puyang';
for (const {key, faction} of era.officers) {
  if (faction === 'cao' && state.stations[key] === 'puyang') state.stations[key] = 'xu';
  if (faction === 'ma' && state.stations[key] === 'changan') state.stations[key] = 'tianshui';
}
state = queueOrder(world, state, {type:'mobilize', from:'chenliu', to:'changan', officer:'cao-roster-2', troops:1200});
for (let turn = 0; turn < 3; turn++) state = advanceQuarter(world, state, rest);
state = advanceQuarter(world, state, {...rest, yuan:{source:'rules'}});
for (const city of Object.values(state.cities)) if (city.owner !== 'cao') city.troops = 250;
console.log(JSON.stringify({state, selected:'luoyang'}));
"""
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", source], cwd=ROOT, encoding="utf-8"))


def new_page(browser, address, viewport, seed=None, mobile=False):
    width, height = viewport
    page = browser.new_page(viewport={"width": width, "height": height}, is_mobile=mobile, has_touch=mobile)
    page.set_default_timeout(10000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    if seed is not None:
        page.add_init_script(f"""if (!sessionStorage.getItem('smoke-seed')) {{
          localStorage.setItem({json.dumps(AUTO)}, {json.dumps(json.dumps(seed))});
          sessionStorage.setItem('smoke-seed', 'yes');
        }}""")
    page.goto(address + "/")
    page.locator(".city-pin:not([hidden])").first.wait_for(state="visible")
    return page, errors


def fit(page, selector):
    excess = page.locator(selector).evaluate("node => [node.scrollWidth - node.clientWidth, node.scrollHeight - node.clientHeight]")
    assert max(excess) <= 3, (page.viewport_size, selector, excess)


def saved(page):
    return page.evaluate("(key) => JSON.parse(localStorage.getItem(key)).state", AUTO)


def view(page, name):
    switch = page.locator(f'#view-switcher [data-view="{name}"]')
    if switch.is_visible():
        switch.click()


def close(page, dialog):
    page.locator(f'#{dialog} [data-close="{dialog}"]').first.click()
    assert page.locator("#" + dialog).is_hidden()


def guide(page):
    page.click("#open-menu")
    page.click("#open-game-guide")
    fit(page, "#game-guide")


def campaign_rows(page, pane, key):
    page.click(f'[data-campaign-pane="{pane}"]')
    next_page = page.locator(f"#campaign-{pane}-pages button").last
    rows = []
    while True:
        fit(page, "#campaign-dialog")
        rows.extend(page.locator(f"#campaign-{pane}-list li[data-{key}]").evaluate_all(
            "(items, key) => items.map(row => [row.dataset[key], ...Array.from(row.children, cell => cell.textContent)])", key))
        if not next_page.is_visible() or next_page.is_disabled():
            return rows
        next_page.click()


def check_campaign_details(state, seat, city_rows, command_rows, governance_rows):
    player = state["player"]
    holdings = {key: site for key, site in state["cities"].items() if site["owner"] == player}
    assert sorted(row[0] for row in city_rows) == sorted(holdings)
    assert city_rows[0][1] == seat and "治所" in city_rows[0][2]
    priorities = []
    for key, name, status, military in city_rows:
        city = WORLD_CITIES[key]
        assert city["name"] == name
        exposed = any(state["cities"][link]["owner"] != player for link in city["links"])
        assert ("临敌" in status) == exposed
        assert military == f'驻军 {holdings[key]["troops"]:,} · 城防 {holdings[key]["defense"]}'
        priorities.append(2 if "治所" in status else int(exposed))
    assert priorities == sorted(priorities, reverse=True)
    stationed = {person: city for person, city in state["stations"].items() if city in holdings}
    for rows, skill_index in ((command_rows, 0), (governance_rows, 1)):
        assert sorted(row[0] for row in rows) == sorted(stationed)
        values = []
        for person, name, station, skills in rows:
            assert name and station == WORLD_CITIES[stationed[person]]["name"]
            values.append(int(re.findall(r"\d+", skills)[skill_index]))
        assert values == sorted(values, reverse=True)


def start_from_guide(page, year, faction):
    guide(page)
    page.click("#guide-open-campaign")
    prior_save = page.evaluate("(key) => localStorage.getItem(key)", AUTO)
    page.select_option("#era-select", year)
    page.select_option("#force-select", faction)
    fit(page, "#campaign-dialog")
    preview = {
        field: page.locator("#campaign-" + field).inner_text()
        for field in ("seat", "holdings", "troops", "treasury", "grain", "objective-title")
    }
    assert preview["objective-title"] == {"199": "安民积粮", "208": "立稳商埠", "262": "整备边军", "265": "重整州郡"}[year]
    city_rows = campaign_rows(page, "cities", "city")
    command_rows = campaign_rows(page, "roster", "officer")
    page.select_option("#campaign-roster-sort", "governance")
    governance_rows = campaign_rows(page, "roster", "officer")
    assert page.evaluate("(key) => localStorage.getItem(key)", AUTO) == prior_save
    page.click("#start-game")
    assert page.locator("#game-guide").is_hidden() and page.locator("#menu-dialog").is_hidden()
    state = saved(page)
    assert (str(state["year"]), state["player"], len(state["cities"])) == (year, faction, 42)
    holdings = [city for city in state["cities"].values() if city["owner"] == faction]
    assert preview["holdings"] == f"{len(holdings)} / 42"
    assert preview["troops"] == f'{sum(city["troops"] for city in holdings):,}'
    for resource in ("treasury", "grain"):
        assert preview[resource] == f"{state['factions'][faction][resource]:,}"
    check_campaign_details(state, preview["seat"], city_rows, command_rows, governance_rows)


def check_campaign_switching(browser, address, viewport):
    page, errors = new_page(browser, address, viewport)
    page.click("#open-menu")
    page.click("#open-game-guide")
    page.click("#guide-open-campaign")
    prior_save = page.evaluate("(key) => localStorage.getItem(key)", AUTO)
    page.select_option("#era-select", "262")
    page.select_option("#force-select", "shu")
    assert page.locator("#campaign-seat").inner_text() == "成都"
    page.select_option("#force-select", "wu")
    wu_seat = page.locator("#campaign-seat").inner_text()
    assert wu_seat != "成都"
    page.select_option("#era-select", "265")
    assert page.locator("#force-select").input_value() == "wu"
    assert page.locator("#campaign-seat").inner_text() == wu_seat
    assert page.locator("#campaign-opponents").inner_text() == "1"
    fit(page, "#campaign-dialog")
    page.click('[data-campaign-pane="cities"]')
    page.locator("#campaign-cities-pages button").last.click()
    page.select_option("#force-select", "jin")
    assert page.locator("#campaign-cities-pages span").inner_text().startswith("1 / ")
    assert page.locator("#campaign-cities-list li strong").first.inner_text() == "洛阳"
    fit(page, "#campaign-dialog")
    page.click('[data-campaign-pane="roster"]')
    page.locator("#campaign-roster-pages button").last.click()
    page.select_option("#era-select", "262")
    page.select_option("#force-select", "shu")
    assert page.locator("#campaign-roster-pages span").inner_text().startswith("1 / ")
    fit(page, "#campaign-dialog")
    close(page, "campaign-dialog")
    assert page.evaluate("(key) => localStorage.getItem(key)", AUTO) == prior_save
    assert not errors, errors
    page.close()
    print(f"{viewport}: 开局情报与名册分页、切换和取消", flush=True)


def check_map(page):
    view(page, "map")
    page.click('[data-map-layer="cities"]')
    assert page.locator(".city-pin:not([hidden])").count() == 42
    page.click("#zoom-in")
    page.click("#zoom-out")
    assert page.locator('[data-map-layer="factions"]').get_attribute("aria-pressed") == "true"
    page.click("#zoom-in")
    if page.locator('[data-map-layer="roads"]').is_visible():
        assert page.locator('[data-map-layer="roads"]').get_attribute("aria-pressed") == "true"
        page.click("#zoom-in")
    assert page.locator('[data-map-layer="cities"]').get_attribute("aria-pressed") == "true"
    page.click('[data-map-layer="cities"]')
    assert page.locator(".city-pin:not([hidden])").count() == 42
    fit(page, "html")


def city(page, key):
    view(page, "map")
    if page.locator("#city-picker").is_hidden() and page.locator("#map-command-back").is_visible():
        page.click("#map-command-back")
    page.select_option("#city-picker", key)
    if page.locator("#inspect-city").is_visible():
        page.click("#inspect-city")
    else:
        view(page, "city")


def check_command_desk(browser, address, viewport):
    page, errors = new_page(browser, address, viewport)
    desktop = viewport[0] > 960
    view(page, "map")
    pin = page.locator('[data-city-pin="changan"]').bounding_box()
    page.mouse.click(pin["x"] + pin["width"] / 2, pin["y"] + pin["height"] / 2)
    assert page.locator("#workspace").get_attribute("data-view") == "map"
    assert page.locator("#city-picker").input_value() == "changan"
    assert page.locator("#tab-expedition").get_attribute("aria-selected") == "true"
    page.keyboard.press("/")
    page.fill("#city-search", "汉中")
    fit(page, "#city-search-dialog")
    page.locator("#city-search").press("Enter")
    assert page.locator("#city-picker").input_value() == "nanzheng"
    assert page.locator("#workspace").get_attribute("data-view") == "map"
    if page.locator("#city-picker").is_hidden():
        page.click("#map-command-back")
    page.select_option("#city-picker", "xu")
    assert page.locator("#workspace").get_attribute("data-view") == "map"
    assert page.locator("#tab-governance").get_attribute("aria-selected") == "true"
    view(page, "city")
    page.locator("#domestic-form button").click()
    advice = "#open-advice" if desktop else '#view-switcher [data-command-action="advice"]'
    page.click(advice)
    fit(page, "#advice-dialog")
    assert "1 道待执行政令" in page.locator('#advice-list [data-advice="orders"]').inner_text()
    page.locator('#advice-list [data-advice="orders"] button').click()
    assert page.locator("#order-list li").count() == 1
    fit(page, "#orders-dialog")
    page.click("#advance-from-orders")
    wait_for_turn(page, 1)
    if desktop:
        page.click('#command-dock [data-command-action="war"]')
        fit(page, "#grand-dialog")
        close(page, "grand-dialog")
    fit(page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 地图就地选城、键盘搜索、议事到政令与季末结算", flush=True)


def advance(page, expected):
    page.click("#advance")
    return wait_for_turn(page, expected)


def wait_for_turn(page, expected):
    page.wait_for_function("(turn) => JSON.parse(localStorage.getItem('jinglue-sanguo:auto:v1'))?.state.turn === turn", arg=expected)
    state = saved(page)
    assert state["history"][-1]["turn"] == expected and len(state["cities"]) == 42
    return state


def check_receipts(report):
    for decision in report["decisions"]:
        index = decision["entryIndex"]
        if decision["orderType"] == "rest":
            assert index is None
        else:
            assert report["entries"][index]["faction"] == decision["faction"]


def export_current(page):
    page.click("#open-menu")
    page.click("#open-saves")
    with page.expect_download() as pending_download:
        page.click("#export-current")
    backup = pending_download.value.path().read_bytes()
    close(page, "saves-dialog")
    return backup


def import_backup(page, backup, expected):
    page.click("#open-menu")
    page.click("#open-saves")
    page.locator("#save-file").set_input_files({
        "name": "campaign.json", "mimeType": "application/json", "buffer": backup,
    })
    page.locator("#import-review").wait_for(state="visible")
    assert saved(page)["turn"] == expected["turn"] + 1
    page.click("#confirm-import")
    assert page.locator("#saves-dialog").is_hidden()
    assert saved(page) == expected


def play_opening(browser, address, year, faction, preset, viewport):
    page, errors = new_page(browser, address, viewport)
    start_from_guide(page, year, faction)
    check_map(page)
    opening = saved(page)
    if year == "265":
        view(page, "forces")
        page.click("#open-holdings")
        page.click("#open-stage-details")
        assert "当前达标 0 城" in page.locator("#stage-detail-count").inner_text()
        page.click("#stage-open-expeditions")
        assert page.locator("#attack-opportunities-dialog").is_visible()
        fit(page, "#attack-opportunities-dialog")
        close(page, "attack-opportunities-dialog")
        close(page, "frontier-dialog")
    home = next(key for key, holding in opening["cities"].items() if holding["owner"] == faction)
    city(page, home)
    page.click("#tab-appointments")
    governor = page.locator('#governor option:not([value=""]):not([disabled])').first.get_attribute("value")
    page.select_option("#governor", governor)
    assert saved(page)["cities"][home]["governor"] == governor

    guide(page)
    page.click("#guide-open-governance")
    page.select_option("#zone-preset", preset)
    page.click("#preview-delegation-groups")
    fit(page, "#delegation-groups-preview")
    assert "全国季末余" in page.locator("#delegation-groups-balance").inner_text()
    page.click("#apply-delegation-groups")
    assert page.locator("#game-guide").is_visible()
    assert saved(page)["cities"][home]["mode"] == "delegated"
    close(page, "game-guide")
    close(page, "menu-dialog")
    page.click("#tab-governance")
    page.select_option("#domestic-order", "commerce")
    page.locator('#domestic-form button[type="submit"]').click()
    queued = saved(page)
    assert queued["orders"] == [{"type": "build", "city": home, "project": "commerce"}]
    guide(page)
    page.click("#guide-open-orders")
    page.click("#toggle-order-preview")
    assert "商贸" in page.locator("#order-preview-list").inner_text()
    fit(page, "#orders-dialog")
    close(page, "orders-dialog")
    close(page, "game-guide")
    close(page, "menu-dialog")

    first = advance(page, 1)
    assert first["history"][-1]["finance"]["orders"]["treasury"] > 0
    assert first["cities"][home]["commerce"] >= opening["cities"][home]["commerce"] + 1
    assert not first["orders"]
    second = advance(page, 2)
    page.click("#open-menu")
    page.click("#save-game")
    backup = export_current(page)
    advance(page, 3)
    import_backup(page, backup, second)
    advance(page, 3)
    page.click("#open-menu")
    page.click("#load-game")
    assert saved(page) == second
    page.reload()
    page.locator(".city-pin:not([hidden])").first.wait_for(state="visible")
    assert saved(page) == second
    advance(page, 3)
    final = advance(page, 4)
    assert [report["turn"] for report in final["history"]] == [1, 2, 3, 4]
    for report in final["history"]:
        assert report["finance"]["closing"]
        check_receipts(report)
    page.click("#open-chronicle")
    page.click('[data-report="plans"]')
    page.select_option("#chronicle-turn", "1")
    assert page.locator("#opponent-plan-list li").count() >= 1
    fit(page, "#chronicle")
    close(page, "chronicle")
    check_map(page)
    assert not errors, errors
    page.close()
    print(f"{year} {faction} {viewport}: 开局、国策、任命、政令、四季、奏报和存档恢复", flush=True)


def check_stage_rows(page, state):
    year, player = state["year"], state["player"]
    era = next(era for era in WORLD["scenarios"] if era["year"] == year)
    expected = {}
    for key, city in state["cities"].items():
        if city["owner"] != player:
            continue
        if year == 199:
            met = city["mode"] == "delegated" and city["focus"] == "farming" and city["farming"] >= 2
        elif year == 262:
            if all(state["cities"][neighbor]["owner"] == player for neighbor in WORLD_CITIES[key]["links"]):
                continue
            met = city["troops"] >= 1800 and city["defense"] >= 2
        else:
            if era["ownership"][key] == player:
                continue
            met = city["occupation"] == 0
        expected[key] = met

    rows = []
    next_page = page.locator("#stage-details-pages button").last
    while True:
        fit(page, "#stage-detail-dialog")
        rows.extend(page.locator("#stage-detail-list [data-city]").evaluate_all(
            "items => items.map(row => [row.dataset.city, row.dataset.met === 'true', row.textContent])"))
        if not next_page.is_visible() or next_page.is_disabled():
            break
        next_page.click()
    assert {key: met for key, met, _ in rows} == expected and len(rows) == len(expected)
    assert page.locator("#stage-detail-count").inner_text() == f"当前达标 {sum(expected.values())} 城 · 目标 2 城"
    for key, met, description in rows:
        holding = state["cities"][key]
        if year == 199:
            assert f'屯田 {holding["farming"]} 级' in description
        elif year == 262:
            assert f'驻军 {holding["troops"]:,}' in description
            if holding["troops"] < 1800:
                assert f'缺驻军 {1800 - holding["troops"]:,}' in description
            if holding["defense"] < 2:
                assert f'缺城防 {2 - holding["defense"]} 级' in description
        else:
            assert ("已完成整顿" if met else f'整顿余 {holding["occupation"]} 季') in description


def play_stage(browser, address, year, player, viewport):
    seed = stage_fixture(year, player)
    page, errors = new_page(browser, address, viewport, seed)
    view(page, "forces")
    page.click("#open-holdings")
    fit(page, "#holdings-dialog")
    page.click("#open-stage-details")
    check_stage_rows(page, seed["state"])
    completion = page.locator("#stage-detail-completion")
    if year == "262":
        assert "待季末验收" in completion.inner_text()
    else:
        assert completion.is_hidden()
    locate_row = page.locator("#stage-detail-list [data-city]").first
    key = locate_row.get_attribute("data-city")
    locate_row.get_by_role("button").click()
    assert page.locator("#holdings-dialog").is_hidden() and page.locator("#stage-detail-dialog").is_hidden()
    assert page.locator("#city-picker").input_value() == key
    settled = advance(page, 1)
    assert settled["stageCompletedAt"] == 1
    assert sum(entry["type"] == "stage" for entry in settled["history"][-1]["entries"]) == 1
    if year == "199":
        qualified = next(key for key, holding in settled["cities"].items()
                         if holding["owner"] == player and holding["mode"] == "delegated" and holding["farming"] >= 2)
        city(page, qualified)
        page.click("#tab-governance")
        page.select_option("#mode", "direct")
        settled = saved(page)
        assert settled["stageCompletedAt"] == 1
    page.reload()
    page.locator(".city-pin:not([hidden])").first.wait_for(state="visible")
    page.click("#open-menu")
    page.click("#open-outcome")
    fit(page, "#outcome-dialog")
    page.click("#outcome-stage-details")
    assert "已完成阶段目标" in completion.inner_text()
    check_stage_rows(page, settled)
    if year == "199":
        assert "当前达标 1 城" in page.locator("#stage-detail-count").inner_text()
    close(page, "stage-detail-dialog")
    assert page.locator("#outcome-dialog").is_visible()
    assert not errors, errors
    page.close()
    print(f"{year} {viewport}: 阶段目标逐城进度、定位、季末验收和读档", flush=True)


def play_capture(browser, address):
    page, errors = new_page(browser, address, (320, 440), capture_fixture())
    city(page, "luoyang")
    page.click("#tab-expedition")
    page.select_option("#target-picker", "changan")
    page.select_option("#officer-picker", "cao-1")
    page.fill("#troops", "200")
    assert "预计占优" in page.locator("#attack-forecast").inner_text()
    page.click("#send-order")
    first = advance(page, 1)
    assert first["cities"]["changan"]["owner"] == "cao" and first["cities"]["changan"]["occupation"] == 2
    report = first["history"][-1]
    assert any(entry["type"] == "capture" and entry.get("city") == "changan" and entry["faction"] == "cao" for entry in report["entries"])
    view(page, "forces")
    page.click("#open-holdings")
    page.select_option("#holdings-filter", "occupation")
    page.click("#open-takeover-plan")
    fit(page, "#takeover-plan-dialog")
    assert "拟排援军 1 道 · 拟补任 1 城" in page.locator("#takeover-plan-summary").inner_text()
    page.click("#confirm-takeover-plan")
    takeover = saved(page)
    assert takeover["orders"][0]["type"] == "transfer" and takeover["orders"][0]["to"] == "changan"
    assert takeover["cities"]["changan"]["governor"]
    close(page, "holdings-dialog")
    second = advance(page, 2)
    assert second["cities"]["changan"]["occupation"] == 0
    assert any(entry["type"] == "recovery" and entry.get("city") == "changan" for entry in second["history"][-1]["entries"])
    city(page, "changan")
    page.click("#tab-governance")
    page.select_option("#mode", "delegated")
    page.select_option("#focus", "commerce")
    third = advance(page, 3)
    assert third["cities"]["changan"]["commerce"] > second["cities"]["changan"]["commerce"]
    program = next(program for program in third["history"][-1]["finance"]["programs"] if program["city"] == "changan")
    assert (program["focus"], program["result"]) == ("commerce", "completed")
    advance(page, 4)
    fit(page, "html")
    assert not errors, errors
    page.close()
    print("受控战局: 出征、攻占、接管、整顿、委任建设", flush=True)


def open_armies(page):
    page.click("#open-menu")
    page.click("#open-armies")
    fit(page, "#army-dialog")


def play_army(browser, address, viewport):
    page, errors = new_page(browser, address, viewport, capture_fixture())
    open_armies(page)
    page.select_option("#army-origin", "luoyang")
    page.select_option("#army-target", "changan")
    page.select_option("#army-leader", "cao-1")
    page.fill("#army-troops", "1000")
    assert "洛阳 → 长安" in page.locator("#army-formation-route").inner_text()
    assert "预计 3 季交战" in page.locator("#army-formation-estimate").inner_text()
    fit(page, "#army-dialog")
    page.click("#queue-army")
    assert saved(page)["orders"][0]["type"] == "mobilize"
    first = advance(page, 1)
    assert first["armies"][0]["phase"] == "muster"
    page.click("#open-menu")
    page.click("#save-game")
    advance(page, 2)
    page.click("#open-menu")
    page.click("#load-game")
    assert saved(page) == first
    page.reload()
    marker = page.locator('.army-map-pin[data-army-officer="cao-1"]')
    marker.wait_for(state="visible")
    page.click('[data-map-layer="factions"]')
    assert marker.is_hidden()
    page.click('[data-map-layer="cities"]')
    assert page.locator('.city-pin:not([hidden])').count() == 42
    marker.click()
    assert "集结中" in page.locator("#army-summary").inner_text()
    assert "补给通畅" in page.locator("#army-supply").inner_text()
    close(page, "army-dialog")
    advance(page, 2)
    third = advance(page, 3)
    assert third["cities"]["changan"]["owner"] == "cao" and third["cities"]["changan"]["troops"] == 400
    assert third["armies"][0]["phase"] == "secured"
    open_armies(page)
    assert "战后驻扎" in page.locator("#army-summary").inner_text()
    page.click("#army-garrison")
    assert "armies" not in saved(page) and saved(page)["cities"]["changan"]["troops"] == 750
    close(page, "army-dialog")
    assert advance(page, 4)["cities"]["changan"]["occupation"] == 1
    fit(page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 洛阳至长安军团、地图切层、中途读档和攻占后驻入整顿", flush=True)


def play_army_supply(browser, address):
    seed = supply_cut_fixture()
    page, errors = new_page(browser, address, (320, 360), seed)
    assert seed["state"]["armies"][0]["phase"] == "hold"
    page.click("#open-chronicle")
    row = page.locator('[data-summary="army"]')
    while not row.is_visible():
        next_page = page.locator("#summary-pages button").last
        assert next_page.is_enabled()
        next_page.click()
    assert "补给中断" in row.inner_text()
    row.get_by_role("button", name="军团", exact=True).click()
    assert "补给中断" in page.locator("#army-supply").inner_text()
    page.click("#army-reroute")
    assert page.locator('#army-new-depot option[value="chenliu"]').count() == 0
    page.select_option("#army-new-depot", "xu")
    page.select_option("#army-new-target", "changan")
    fit(page, "#army-dialog")
    page.click("#confirm-army-instructions")
    assert "补给通畅" in page.locator("#army-supply").inner_text()
    assert saved(page)["armies"][0]["depot"] == "xu"
    page.click("#army-hold")
    assert saved(page)["armies"][0]["phase"] == "hold"
    page.click("#army-retreat")
    page.select_option("#army-new-target", "xu")
    assert "洛阳 → " + WORLD_CITIES["xu"]["name"] in page.locator("#army-instruction-route").inner_text()
    fit(page, "#army-dialog")
    page.click("#confirm-army-instructions")
    close(page, "army-dialog")
    returned = advance(page, 5)
    assert returned["stations"]["cao-roster-2"] == "xu" and "armies" not in returned
    assert not errors, errors
    page.close()
    print("(320, 360): AI 断粮后固守、换粮仓、沿路撤军", flush=True)


def open_saves(page):
    page.click("#open-menu")
    page.click("#open-saves")
    fit(page, "#saves-dialog")


def open_theaters(page):
    page.click("#open-menu")
    page.click("#open-theaters")
    fit(page, "#theater-dialog")


def open_realm(page):
    page.click("#open-menu")
    page.click("#open-realm")
    fit(page, "#realm-dialog")


def play_realm(browser, address, viewport):
    page, errors = new_page(browser, address, viewport, capture_fixture())
    opening = saved(page)
    open_realm(page)
    page.click("#start-realm")
    upgraded = saved(page)
    assert upgraded.pop("realm")["since"] == opening["turn"] and upgraded == opening
    close(page, "realm-dialog")
    start_from_guide(page, "208", "liu")
    assert len(saved(page)["realm"]["cities"]) == 42
    assert page.locator(".city-pin:not([hidden])").count() == 42

    open_realm(page)
    page.fill("#realm-development", "45")
    page.fill("#realm-reserve-grain", "28")
    page.select_option("#realm-priority", "relief")
    page.click("#realm-preview")
    assert "当前人口" in page.locator("#realm-ledger-note").inner_text()
    fit(page, "#realm-dialog")
    page.click('[data-realm-pane="policy"]')
    assert page.locator("#realm-development").input_value() == "45"
    page.click("#save-realm-policy")
    assert saved(page)["realm"]["policy"]["development"] == 45
    assert saved(page)["delegationReserve"]["grain"] == 28

    page.click('[data-realm-pane="offices"]')
    page.select_option("#realm-deputy", "liu-208-0")
    page.click("#save-realm-office")
    page.click("#realm-office-history")
    fit(page, "#realm-dialog")
    page.click('[data-realm-pane="diplomacy"]')
    page.select_option("#realm-partner", "wu")
    page.select_option("#realm-kind", "trade")
    assert "道路通畅" in page.locator("#realm-proposal-quote").inner_text()
    page.click("#send-realm-proposal")
    assert "等待对方回覆" in page.locator("#realm-diplomacy-note").inner_text()
    fit(page, "#realm-dialog")
    close(page, "realm-dialog")

    first = advance(page, 1)
    assert first["realm"]["offices"]["civil"]["holder"] == "liu-208-0"
    assert any(accord["kind"] == "trade" and accord["to"] == "wu" for accord in first["realm"]["accords"])
    second = advance(page, 2)
    assert second["history"][-1]["finance"]["realm"]["commerce"] > 0
    page.reload()
    page.locator(".city-pin:not([hidden])").first.wait_for(state="visible")
    assert saved(page) == second
    open_realm(page)
    page.click('[data-realm-pane="diplomacy"]')
    page.select_option("#realm-diplomacy-view", "active")
    page.locator("#realm-record-select").select_option(label="孙权 · 通商")
    assert "每季 +" in page.locator("#realm-diplomacy-note").inner_text()
    fit(page, "#realm-dialog")
    page.get_by_role("button", name="地图查看").click()
    assert page.locator("#realm-dialog").is_hidden()
    page.click('[data-map-layer="factions"]')
    page.click('[data-map-layer="cities"]')
    fit(page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 升级旧档、208 赤壁开局、全国预算试算、官职接班、提案、路网和重载", flush=True)


def play_coalition_ending(browser, address):
    source = """
import fs from 'node:fs';
import {createGame} from './dist/engine.js';
import {enrichWorld} from './dist/personnel.js';
import {accordProposal, commercialRoad} from './dist/accords.js';
const world = enrichWorld(JSON.parse(fs.readFileSync('./dist/assets/world.json')));
const state = createGame(world, 208, 'liu');
state.turn = 19;
state.treaties = ['han', 'wu'].map(other => ({sides: ['liu', other].sort(), kind: 'alliance', expires: 21}));
for (const [from, to] of [['liu', 'wu'], ['wu', 'han'], ['liu', 'han']]) {
  const proposal = accordProposal(world, state, from, to, 'trade');
  const route = commercialRoad(world, state, from, to, proposal.sites);
  state.realm.accords.push({...proposal, route, signed: 14, expires: 22, open: true});
}
state.realm.relations = {'han:liu': 16, 'liu:wu': 18, 'han:wu': 18};
state.realm.coalition = {streak: 4, partners: ['han', 'wu']};
console.log(JSON.stringify({state, selected: 'jiangxia'}));
"""
    raw = subprocess.check_output(["node", "--input-type=module", "-e", source], cwd=ROOT, encoding="utf-8")
    page, errors = new_page(browser, address, (320, 360), json.loads(raw))
    assert saved(page)["turn"] == 19
    open_realm(page)
    page.click('[data-realm-pane="coalition"]')
    assert "持续履约季度 4 / 4" in page.locator("#realm-coalition-checks").inner_text()
    fit(page, "#realm-dialog")
    page.click("#conclude-coalition")
    assert page.locator("#outcome-title").inner_text() == "诸侯共守"
    page.click("#open-ending-record")
    fit(page, "#ending-record-dialog")
    assert "联盟维持 4 季" in page.locator("#review-list").inner_text()
    assert saved(page)["scenarioEnding"] == {"turn": 19, "kind": "coalition"}
    assert not errors, errors
    page.close()
    print("(320, 360): 联盟结局确认、复盘、终局存档", flush=True)


def configure_theater(page, slot, name, goal, target, reserve, commander=None, seat=None, backup=None, grain=None):
    page.select_option("#theater-picker", str(slot))
    page.click("#theater-edit")
    page.fill("#theater-name", name)
    page.select_option("#theater-goal", goal)
    page.select_option("#theater-target", target)
    fit(page, "#theater-dialog")
    page.click('[data-theater-edit="roster"]')
    if seat:
        page.select_option("#theater-member", seat)
        page.click("#add-theater-member")
    if commander:
        page.select_option("#theater-commander", commander)
    if backup:
        page.select_option("#theater-backup", backup)
    fit(page, "#theater-dialog")
    if seat:
        page.click('[data-theater-edit="mission"]')
        page.select_option("#theater-seat", seat)
        fit(page, "#theater-dialog")
    page.click('[data-theater-edit="budget"]')
    page.fill("#theater-reserve", str(reserve))
    if grain is not None:
        page.fill("#theater-grain", str(grain))
    fit(page, "#theater-dialog")
    page.click("#save-theater")
    assert page.locator("#theater-overview").is_visible(), page.locator("#theater-feedback").inner_text()


def play_theaters(browser, address, viewport):
    page, errors = new_page(browser, address, viewport, capture_fixture())
    open_theaters(page)
    page.click('[data-theater-pane="national"]')
    page.fill("#war-grain", "86")
    page.fill("#war-treasury", "70")
    fit(page, "#theater-dialog")
    page.click("#save-war-budget")
    assert saved(page)["warBudget"] == {"grain": 86, "treasury": 70}
    page.click('[data-theater-pane="overview"]')
    configure_theater(page, 1, "关中", "advance", "changan", 350, "cao-1", seat="chenliu", backup="chenliu")
    close(page, "theater-dialog")
    city(page, "wan")
    open_theaters(page)
    configure_theater(page, 2, "荆州", "defend", "wan", 1700)
    close(page, "theater-dialog")
    initial = advance(page, 1)
    assert len(initial["theaters"]) == 2 and initial["armies"][0]["officer"] == "cao-1"
    assert initial["theaters"][0]["seat"] == "chenliu" and initial["theaters"][0]["depot"] == "luoyang"
    assert initial["theaters"][0]["backup"] == "chenliu"
    assert all(plan["report"]["status"] == "executed" for plan in initial["theaters"])
    page.reload()
    page.locator(".city-pin:not([hidden])").first.wait_for(state="visible")
    assert saved(page) == initial
    page.click('[data-map-layer="factions"]')
    marker = page.locator('[data-theater-pin="1"]')
    assert marker.is_visible()
    marker.click()
    assert page.locator("#theater-picker").input_value() == "1"
    assert "集结" in page.locator("#theater-report").inner_text()
    assert "治所 陈留 · 粮仓 洛阳" in page.locator("#theater-resources").inner_text()
    close(page, "theater-dialog")
    page.click('[data-map-layer="cities"]')
    assert page.locator(".city-pin:not([hidden])").count() == 42
    assert not errors, errors
    page.close()
    print(f"{viewport}: 两战区、全国限额、军团集结、地图战区与读档", flush=True)


def play_theater_alert(browser, address):
    seed = supply_cut_fixture()
    state = seed["state"]
    state["cities"]["wan"]["troops"] = 210
    state["theaters"] = [
        {"id": 1, "name": "关中", "cities": ["chenliu", "luoyang"], "commander": "cao-roster-2", "depot": "chenliu",
         "army": "cao-roster-2", "goal": "advance", "target": "changan", "priority": 1, "reserve": 700,
         "budget": {"treasury": 20, "grain": 50}, "paused": False},
        {"id": 2, "name": "荆州", "cities": ["xu", "wan"], "commander": "cao-0", "depot": "xu", "army": None,
         "goal": "defend", "target": "wan", "priority": 2, "reserve": 900, "budget": {"treasury": 20, "grain": 20}, "paused": False},
    ]
    page, errors = new_page(browser, address, (320, 360), seed)
    result = advance(page, 5)
    assert result["theaters"][0]["paused"] and result["theaters"][0]["report"]["status"] == "blocked"
    assert result["theaters"][1]["report"]["status"] == "executed" and result["cities"]["wan"]["troops"] == 900
    page.click("#open-chronicle")
    alert = page.locator('[data-summary="theater"]')
    while not alert.is_visible():
        next_page = page.locator("#summary-pages button").last
        assert next_page.is_enabled()
        next_page.click()
    alert.get_by_role("button", name="战区", exact=True).click()
    assert "粮仓失守" in page.locator("#theater-report").inner_text()
    fit(page, "#theater-dialog")
    assert not errors, errors
    page.close()
    print("(320, 360): 一条战线断粮暂停，另一条完成增援", flush=True)


def open_war(page):
    page.click("#open-menu")
    fit(page, "#menu-dialog")
    page.click("#open-war")
    fit(page, "#war-dialog")


def open_polity(page):
    page.click("#open-menu")
    fit(page, "#menu-dialog")
    page.click("#open-polity")
    fit(page, "#polity-dialog")


def grand_fixture():
    source = """
import fs from 'node:fs';
import {createGame} from './dist/engine.js';
import {enrichWorld} from './dist/personnel.js';
const world=enrichWorld(JSON.parse(fs.readFileSync('./dist/assets/world.json')));
const state=createGame(world,199,'cao',{grand:true});
state.cities.luoyang.troops=6800;
state.cities.changan.troops=850;
state.factions.cao.grain=460;
for (const key of ['cao-1','cao-2','cao-roster-3']) state.stations[key]='luoyang';
console.log(JSON.stringify({state,selected:'luoyang'}));
"""
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", source], cwd=ROOT, encoding="utf-8"))


def play_landscape(browser, address, viewport):
    mobile = viewport[0] <= 568
    page, errors = new_page(browser, address, viewport, grand_fixture(), mobile=mobile)
    use = page.tap if mobile else page.click

    def press(section, name):
        control = page.locator(section).get_by_role("button", name=name, exact=True)
        (control.tap if mobile else control.click)()

    def tap_city(key):
        marker = page.locator(f'[data-city-pin="{key}"]')
        box = marker.bounding_box()
        assert box is not None
        (page.touchscreen.tap if mobile else page.mouse.click)(
            box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)

    object_panel = "#map-landscape-command"
    use("#open-menu")
    use("#open-landscape-menu")
    press("#landscape-dialog", "在此存档启用 3.0")
    assert saved(page)["landscape"]["since"] == 0
    close(page, "landscape-dialog")
    assert page.locator("#map-weather").inner_text() == "春雨"
    tap_city("luoyang")
    use('[data-city-action="build"]')
    page.select_option("#map-command-project", "farming")
    use("#map-command-confirm")
    use('[data-city-action="policy"]')
    page.select_option("#map-landscape-policy", "equipment")
    press(object_panel, "颁行")
    press(object_panel, "收起")

    use('[data-map-layer="roads"]')
    use('[data-gate="changan:luoyang"]')
    assert page.locator("#map-landscape-title").inner_text() == "函谷道"
    assert page.locator(object_panel).get_by_role("button", name="封控关隘").is_disabled()
    press(object_panel, "收起")
    route = page.locator('[data-convoy="luoyang:xu"]:not([hidden])')
    if not route.count():
        route = page.locator(".landscape-road-marker:not([hidden])").first
    assert route.count() == 1
    (route.tap if mobile else route.click)()
    assert "→" in page.locator("#map-landscape-title").inner_text()
    page.fill("#map-convoy-count", "24")
    press(object_panel, "安排本季运输")
    assert saved(page)["landscape"]["convoys"][0]["amount"] == 24
    press(object_panel, "收起")

    use('[data-map-layer="cities"]')
    tap_city("luoyang")
    use('[data-city-action="attack"]')
    tap_city("changan")
    page.select_option("#map-command-method", "assault")
    page.fill("#map-command-troops", "2800")
    use("#map-command-confirm")
    fit(page, ".map-panel")
    first = advance(page, 1)
    assert first["landscape"]["convoys"][0]["status"] == "delivered"
    assert first["history"][-1]["finance"]["landscape"]["budget"]["treasury"] > 0
    assert page.locator("#map-weather").inner_text() == "夏汛"
    officer = next(row["officer"] for row in first["armies"] if row["faction"] == "cao")
    marker = page.locator(f'[data-army-officer="{officer}"]')
    (marker.tap if mobile else marker.click)()
    assert "军团" in page.locator("#map-landscape-title").inner_text()
    press(object_panel, "固守")
    press(object_panel, "换粮仓")
    fit(page, ".map-panel")
    tap_city("xu")
    assert next(row for row in saved(page)["armies"] if row["officer"] == officer)["depot"] == "xu"
    press(object_panel, "陆路改令")
    tap_city("changan")
    press(object_panel, "收起")

    use("#map-weather")
    use('[data-landscape-tab="treaty"]')
    page.select_option('[name="guest-a"]', "yuan")
    page.select_option('[name="guest-b"]', "ce")
    page.select_option('[name="target"]', "changan")
    page.select_option('[name="aid"]', "8")
    fit(page, "#landscape-dialog")
    press("#landscape-dialog", "提交各方表决")
    assert len(saved(page)["landscape"]["congresses"][0]["parties"]) == 3
    fit(page, "#landscape-dialog")
    close(page, "landscape-dialog")
    second = advance(page, 2)
    assert second["landscape"]["congresses"][0]["status"] in ("active", "rejected")
    for turn in (3, 4):
        state = advance(page, turn)
    assert state["cities"]["changan"]["owner"] == "cao"
    use('[data-map-layer="roads"]')
    use('[data-gate="changan:luoyang"]')
    press(object_panel, "封控关隘")
    assert saved(page)["grand"]["closed"]["changan:luoyang"] == "cao"
    press(object_panel, "解除封控")
    press(object_panel, "整修 · 24 钱 8 粮")
    assert "待整修" in page.locator(".landscape-brief").inner_text()
    press(object_panel, "收起")
    state = advance(page, 5)
    assert state["landscape"]["bridges"]["changan:luoyang"] == 1
    use("#map-weather")
    use('[data-landscape-tab="replay"]')
    assert page.locator(".landscape-timeline li").count()
    fit(page, "#landscape-dialog")
    close(page, "landscape-dialog")
    page.reload()
    page.locator("#map-weather").wait_for(state="visible")
    assert saved(page) == state
    fit(page, ".map-panel")
    fit(page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 3.0 地图点击/触控，经营、封控与整修、粮道、军团换仓改令、议盟、攻占、复盘与刷新读档", flush=True)


def play_landscape_opening(browser, address, viewport):
    mobile = viewport[0] < 600
    page, errors = new_page(browser, address, viewport, mobile=mobile)
    use = page.tap if mobile else page.click

    quick_opening(page, "208", "liu")
    use("[data-city-pin='jiangxia']")
    use("[data-city-action='attack']")
    marker = page.locator("[data-city-pin='chaisang']")
    box = marker.bounding_box()
    (page.touchscreen.tap if mobile else page.mouse.click)(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.select_option("#map-command-method", "assault")
    page.select_option("#map-command-travel", "water")
    page.fill("#map-command-troops", "1200")
    use("#map-command-confirm")
    assert saved(page)["orders"][-1]["travel"] == "water"
    first = advance(page, 1)
    assert any(unit["travel"] == "water" for unit in first["armies"] if unit["faction"] == "liu")
    for turn in (2, 3):
        state = advance(page, turn)
    assert any("水运" in step["text"] for row in state["landscape"]["replay"] for step in row["stages"])

    view(page, "forces")
    use("#open-campaign")
    page.select_option("#era-select", "184")
    page.select_option("#force-select", "yellow")
    assert "收拢流民" in page.locator("#campaign-objective-title").inner_text()
    page.select_option("#era-select", "234")
    page.select_option("#force-select", "shu")
    assert "重整前线屯仓" in page.locator("#campaign-objective-title").inner_text()
    use("#open-custom-opening")
    page.fill("#custom-title", "五丈原试演")
    page.select_option("#custom-mode", "rules")
    page.select_option("#custom-difficulty", "hard")
    page.select_option("#custom-goal", "ports")
    page.select_option("#custom-rival", "wei")
    page.fill("#custom-credit", "26")
    use("#custom-store")
    assert "已保存剧本" in page.locator("#custom-status").inner_text()
    use("#custom-reset")
    page.select_option("#custom-library", label="五丈原试演")
    assert page.locator("#custom-credit").input_value() == "26"
    fit(page, "#custom-opening-dialog")
    use("#custom-opening-form [type=submit]")
    state = saved(page)
    assert state["year"] == 234 and len(state["cities"]) == 42
    assert state["landscape"]["custom"] == {"difficulty": "hard", "goal": "ports", "relations": {"wei": 26}}
    assert not errors, errors
    fit(page, "html")
    page.close()
    print(f"{viewport}: 3.0 水运军团实战、184 与 234 剧本、自定义难度目标与复用", flush=True)


def play_map_city_commands(browser, address, viewport):
    mobile = viewport[0] < 600
    page, errors = new_page(browser, address, viewport, grand_fixture(), mobile=mobile)

    def choose_site(key):
        marker = page.locator(f'[data-city-pin="{key}"]')
        box = marker.bounding_box()
        assert box is not None
        point = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        (page.touchscreen.tap if mobile else page.mouse.click)(*point)

    def command(key):
        page.click(f'[data-city-action="{key}"]')
        fit(page, ".map-panel")
        assert page.locator("#workspace").get_attribute("data-view") == "map"

    choose_site("luoyang")
    assert page.locator("#map-command-title").inner_text() == "洛阳"
    command("appoint")
    page.select_option("#map-command-appointee", "cao-0")
    page.click("#map-command-confirm")
    assert saved(page)["cities"]["luoyang"]["governor"] == "cao-0"
    command("delegate")
    page.select_option("#map-command-policy", "defense")
    page.fill("#map-command-budget", "25")
    page.click("#map-command-confirm")
    assert saved(page)["cities"]["luoyang"]["delegateBudget"] == 25
    command("build")
    page.select_option("#map-command-project", "farming")
    assert "18 钱" in page.locator("#map-command-quote").inner_text()
    page.click("#map-command-confirm")
    command("attack")
    assert page.locator('[data-city-pin="changan"]').get_attribute("data-command-target") == "true"
    assert page.locator('[data-city-pin="xu"]').get_attribute("data-command-target") == "false"
    choose_site("changan")
    assert page.locator("#map-command-title").inner_text() == "洛阳 → 长安"
    page.select_option("#map-command-method", "siege")
    page.fill("#map-command-troops", "2300")
    fit(page, ".map-panel")
    page.keyboard.press("Escape")
    assert page.locator("#map-command-pick").is_visible()
    choose_site("changan")
    assert page.locator("#map-command-method").input_value() == "siege"
    assert page.locator("#map-command-troops").input_value() == "2300"
    page.click("#map-command-confirm")
    assert saved(page)["orders"][-1]["stance"] == "siege"
    command("transfer")
    choose_site("xu")
    assert "留守" in page.locator("#map-command-quote").inner_text()
    page.click("#map-command-confirm")
    assert saved(page)["orders"][-1]["to"] == "xu"
    first = advance(page, 1)
    assert any(unit["target"] == "changan" for unit in first["armies"])
    page.click('[data-map-layer="cities"]')
    choose_site("luoyang")
    command("recruit")
    assert "600 人" in page.locator("#map-command-quote").inner_text()
    page.click("#map-command-confirm")
    assert saved(page)["orders"][-1]["type"] == "recruit"
    choose_site("changan")
    command("attack")
    assert "己方出发城" in page.locator("#map-command-instruction").inner_text()
    page.select_option("#map-command-target", "luoyang")
    assert page.locator("#map-command-title").inner_text() == "洛阳 → 长安"
    assert not errors, errors
    fit(page, "html")
    page.close()
    print(f"{viewport}: 地图任命、委任、建设、出征、调兵、征兵与草案返回", flush=True)


def play_grand(browser, address, viewport):
    mobile = viewport[0] <= 568
    page, errors = new_page(browser, address, viewport, grand_fixture(), mobile=mobile)
    use = page.tap if mobile else page.click
    check_map(page)
    page.click('[data-map-layer="roads"]')
    assert page.locator(".grand-gate-marker:not([hidden])").count() > 0
    use("#open-grand-shortcut")
    page.fill("#grand-money", "24")
    page.fill("#grand-grain", "50")
    page.fill("#grand-reserve", "30")
    page.click("#grand-save-govern")
    page.select_option("#grand-region", "中原与淮北")
    page.select_option("#grand-priority", "defense")
    page.select_option("#grand-depot", "luoyang")
    page.fill("#grand-money", "18")
    page.fill("#grand-grain", "40")
    page.click("#grand-save-govern")
    fit(page, "#grand-dialog")
    page.click('[data-grand-pane="campaign"]')
    page.click("#grand-plan-new")
    page.select_option("#grand-plan-target", "changan")
    page.click("#grand-plan-next")
    page.select_option("#grand-plan-depot", "luoyang")
    page.select_option("#grand-plan-backup", "xu")
    page.select_option("#grand-plan-retreat", "luoyang")
    page.fill("#grand-plan-grain", "150")
    fit(page, "#grand-dialog")
    page.click("#grand-plan-next")
    for role, officer, troops in (("main", "cao-1", "2900"), ("support", "cao-2", "900"), ("escort", "cao-roster-3", "550")):
        page.select_option("#grand-wing-role", role)
        page.select_option("#grand-wing-officer", officer)
        page.fill("#grand-wing-troops", troops)
    page.click("#grand-plan-next")
    assert page.locator("#grand-plan-wings li").count() == 3
    fit(page, "#grand-dialog")
    use("#grand-plan-confirm")
    close(page, "grand-dialog")
    state = advance(page, 1)
    assert len([unit for unit in state["armies"] if unit["faction"] == "cao"]) == 3
    assert state["grand"]["depots"]["luoyang"] > 0
    page.click("#open-grand-shortcut")
    page.click('[data-grand-pane="campaign"]')
    page.click("#grand-plan-adjust")
    page.select_option("#grand-field-mode", "aid")
    page.fill("#grand-field-troops", "350")
    fit(page, "#grand-dialog")
    page.click("#grand-field-command [type=submit]")
    assert saved(page)["grand"]["campaigns"][0]["aid"]["troops"] == 350
    close(page, "grand-dialog")
    while state["turn"] < 11 and state["grand"]["campaigns"][0]["status"] != "complete":
        state = advance(page, state["turn"] + 1)
    assert state["cities"]["changan"]["owner"] == "cao"
    assert state["cities"]["changan"]["occupation"] == 0
    assert state["grand"]["campaigns"][0]["status"] == "complete"
    page.click("#open-grand-shortcut")
    page.click('[data-grand-pane="treaty"]')
    page.select_option("#grand-partner", "ma")
    page.select_option("#grand-clause", "halt")
    page.check("#grand-term-check")
    page.select_option("#grand-clause", "city")
    page.select_option("#grand-term-city", "changan")
    page.select_option("#grand-clause", "treasury")
    page.fill("#grand-term-number", "18")
    page.select_option("#grand-clause", "pass")
    page.check("#grand-term-check")
    fit(page, "#grand-dialog")
    use("#grand-package-send")
    close(page, "grand-dialog")
    state = advance(page, state["turn"] + 1)
    state = advance(page, state["turn"] + 1)
    assert state["cities"]["changan"]["owner"] == "ma"
    assert state["history"][-1]["finance"]["grand"]["out"]["treasury"] == 18
    assert all(row["ok"] for row in state["grand"]["receipts"][-1]["clauses"])
    page.click("#open-grand-shortcut")
    page.click('[data-grand-pane="treaty"]')
    page.select_option("#grand-treaty-mode", "receipt")
    page.select_option("#grand-review-clause", "city")
    assert "返城已交割" in page.locator("#grand-treaty-status").inner_text()
    fit(page, "#grand-dialog")
    close(page, "grand-dialog")
    page.reload()
    assert saved(page)["grand"]["receipts"] == state["grand"]["receipts"]
    fit(page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 2.0 地图军路、全国与州郡调度、三军团攻城接管、四条款交割与读档", flush=True)


def play_grand_opening(browser, address, viewport):
    page, errors = new_page(browser, address, viewport)
    view(page, "forces")
    page.click("#open-campaign")
    page.select_option("#era-select", "190")
    assert page.locator("#campaign-seat").inner_text()
    page.select_option("#era-select", "219")
    page.select_option("#force-select", "liu")
    assert page.locator("#campaign-seat").inner_text() == "成都"
    page.click("#open-custom-opening")
    page.fill("#custom-title", "荆州推演")
    page.select_option("#custom-city", "jiangxia")
    page.select_option("#custom-owner", "liu")
    page.select_option("#custom-mode", "stocks")
    page.select_option("#custom-faction", "liu")
    page.fill("#custom-money", "275")
    page.fill("#custom-grain", "340")
    page.select_option("#custom-mode", "stations")
    page.select_option("#custom-person", "liu-219-2")
    page.select_option("#custom-station", "jiangxia")
    fit(page, "#custom-opening-dialog")
    page.click("#custom-opening-form [type=submit]")
    state = saved(page)
    assert state["year"] == 219 and len(state["cities"]) == 42 and state["grand"]["custom"]["title"] == "荆州推演"
    assert state["cities"]["jiangxia"]["owner"] == "liu" and state["stations"]["liu-219-2"] == "jiangxia"
    assert state["factions"]["liu"]["treasury"] == 275 and state["factions"]["liu"]["grain"] == 340
    assert not errors, errors
    page.close()
    print(f"{viewport}: 两个新剧本与自定义城池、国库和驻地", flush=True)


def play_polity(browser, address, viewport):
    seed = capture_fixture()
    page, errors = new_page(browser, address, viewport, seed)
    open_polity(page)
    page.click("#polity-enable")
    assert saved(page)["polity"]["since"] == seed["state"]["turn"]
    assert saved(page)["cities"] == seed["state"]["cities"]
    page.click('[data-polity-tab="province"]')
    page.select_option("#polity-region", label="中原与淮北 · 9 城")
    page.fill("#polity-money", "48")
    page.fill("#polity-grain", "63")
    assert "支出" in page.locator("#polity-quote").inner_text()
    fit(page, "#polity-dialog")
    page.click("#polity-save-program")
    assert saved(page)["polity"]["programs"]["cao:中原与淮北"]["treasury"] == 48
    page.click('[data-polity-tab="court"]')
    assert "曹操" in page.locator("#polity-court-status").inner_text()
    page.select_option("#polity-heir", "cao-0")
    page.select_option("#polity-regent", "cao-1")
    assert "预计支持" in page.locator("#polity-backing").inner_text()
    page.click("#polity-abdicate")
    fit(page, "#polity-dialog")
    page.click('[data-polity-tab="diplomacy"]')
    page.select_option("#polity-partner", "yuan")
    page.fill("#polity-payment", "18")
    fit(page, "#polity-dialog")
    page.click("#polity-send")
    assert "18 钱" in page.locator("#polity-deal-note").inner_text()
    fit(page, "#polity-dialog")
    close(page, "polity-dialog")
    first = advance(page, 1)
    assert first["polity"]["courts"]["cao"]["head"] == "cao-0"
    assert first["polity"]["deals"][0]["payment"] == 18
    second = advance(page, 2)
    assert second["history"][-1]["finance"]["politics"]["out"]["treasury"] == 18
    open_polity(page)
    page.click('[data-polity-tab="archive"]')
    assert page.locator("#polity-quarter").input_value() == "2"
    assert "城" in page.locator("#polity-map").get_attribute("aria-label")
    fit(page, "#polity-dialog")
    page.locator("#polity-quarter").press("Home")
    assert page.locator("#polity-quarter-title").inner_text() == "纪事起点"
    page.click('[data-polity-tab="ending"]')
    assert page.locator("#polity-conditions li").count() == 6
    assert page.locator("#polity-conclude").is_disabled()
    fit(page, "#polity-dialog")
    fit(page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 1.3 旧档启用、州郡拨款、交接、议和交割及按季复盘", flush=True)


def play_peace_ending(browser, address):
    source = """
import fs from 'node:fs';
import {advanceQuarter,createGame,eraByYear} from './dist/engine.js';
import {enrichWorld} from './dist/personnel.js';
import {peaceCriteria} from './dist/polity.js';
import {saveSuccession} from './dist/polity-governance.js';
import {proposeSettlement,respondSettlement,settlementDraft} from './dist/polity-settlements.js';
const world=enrichWorld(JSON.parse(fs.readFileSync('./dist/assets/world.json')));
let state=createGame(world,199,'cao',{realm:true,war:true,polity:true});
state=saveSuccession(world,eraByYear(world,state),state,{heir:'cao-0',regent:'cao-1',abdicate:true});
for(const to of ['yuan','ce']) state=proposeSettlement(world,state,settlementDraft(state,'cao',to,'peace',{payment:15}));
while(state.turn<60 && !peaceCriteria(world,state).ready) {
  for (const {id,to,kind} of state.polity.offers) if(to==='cao') state=respondSettlement(state,id,kind==='peace');
  state=advanceQuarter(world,state);
}
if(!peaceCriteria(world,state).ready) throw Error('Peace ending is not ready');
console.log(JSON.stringify({state,selected:'luoyang'}));
"""
    raw = subprocess.check_output(["node", "--input-type=module", "-e", source], cwd=ROOT, encoding="utf-8")
    page, errors = new_page(browser, address, (320, 360), json.loads(raw))
    open_polity(page)
    page.click('[data-polity-tab="ending"]')
    fit(page, "#polity-dialog")
    page.click("#polity-conclude")
    assert saved(page)["scenarioEnding"]["kind"] == "peace"
    assert page.locator("#outcome-title").inner_text() == "天下承平"
    fit(page, "#outcome-dialog")
    page.click("#open-ending-record")
    page.click('[data-review-pane="polities"]')
    fit(page, "#ending-record-dialog")
    assert page.locator("#review-list li").count() == 1
    page.reload()
    assert saved(page)["scenarioEnding"]["kind"] == "peace"
    assert not errors, errors
    page.close()
    print("(320, 360): 天下承平确认、季末纪事与终局存档", flush=True)


def play_war(browser, address, viewport):
    seed = capture_fixture()
    seed["state"]["cities"]["luoyang"]["troops"] = 4100
    seed["state"]["cities"]["changan"]["troops"] = 950
    seed["state"]["cities"]["changan"]["defense"] = 3
    page, errors = new_page(browser, address, viewport, seed)
    open_war(page)
    page.click("#enable-war")
    upgraded = saved(page)
    assert upgraded.pop("war")["since"] == seed["state"]["turn"]
    assert upgraded == seed["state"]
    page.click("#war-open-theater")
    configure_theater(page, 1, "关中", "advance", "changan", 600, "cao-1", grain=70)
    page.click("#theater-open-war")
    assert "约 3 季" in page.locator("#war-plan-estimate").inner_text()
    page.click("#edit-war-plan")
    page.select_option("#war-stance", "siege")
    page.fill("#war-troops", "2700")
    page.fill("#war-floor", "650")
    fit(page, "#war-dialog")
    page.click("#save-war-plan")
    assert saved(page)["theaters"][0]["operation"]["stance"] == "siege"
    page.click("#war-budget")
    assert page.locator("#theater-grain").input_value() == "70"
    fit(page, "#theater-dialog")
    page.click("#save-theater")
    page.click("#theater-open-war")
    page.click('[data-war-pane="intel"]')
    page.select_option("#war-intel-city", "changan")
    assert "–" in page.locator("#war-intel-brief").inner_text()
    page.click("#war-scout")
    assert "本季已派斥候" in page.locator("#war-intel-origin").inner_text()
    page.click('[data-war-pane="recovery"]')
    fit(page, "#war-dialog")
    page.click("#save-war-recovery")
    assert saved(page)["war"]["recovery"]["follow"]
    close(page, "war-dialog")
    first = advance(page, 1)
    assert first["war"]["intel"]["cao"]["changan"]["source"] == "scout"
    advance(page, 2)
    third = advance(page, 3)
    assert any(army.get("engagement") for army in third["armies"] if army["faction"] == "cao")
    open_war(page)
    assert "围城第 1 季" in page.locator("#war-plan-estimate").inner_text()
    fit(page, "#war-dialog")
    page.click("#war-army")
    assert "围城第 1 季" in page.locator("#army-route").inner_text()
    fit(page, "#army-dialog")
    page.click("#army-reroute")
    assert page.locator("#army-new-stance").input_value() == "siege"
    fit(page, "#army-dialog")
    page.click("#cancel-army-instructions")
    close(page, "army-dialog")
    open_war(page)
    page.click("#war-plan-map")
    assert page.locator("#war-dialog").is_hidden()
    advance(page, 4)
    fifth = advance(page, 5)
    assert fifth["cities"]["changan"]["owner"] == "cao"
    sixth = advance(page, 6)
    assert sixth["cities"]["changan"]["occupation"] == 0
    open_war(page)
    page.click('[data-war-pane="route"]')
    assert page.locator("#war-route-goals li").count() == 3
    fit(page, "#war-dialog")
    page.click('[data-war-pane="review"]')
    assert any(entry["event"] == "restored" for entry in sixth["war"]["timeline"])
    assert page.locator("#war-review-note").inner_text()
    fit(page, "#war-dialog")
    close(page, "war-dialog")
    page.reload()
    page.locator(".city-pin:not([hidden])").first.wait_for(state="visible")
    assert saved(page) == sixth
    fit(page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 1.1 旧档、战役预演、斥候、围城、批量接管与复盘", flush=True)


def play_release_end(browser, address, viewport):
    seed = capture_fixture()
    state = seed["state"]
    state["turn"] = 16
    state["stageCompletedAt"] = 2
    state["campaignMilestones"] = [3, 4]
    state["factions"]["cao"]["treasury"] += 200
    rivals = [key for key, city_state in state["cities"].items() if city_state["owner"] != "cao"][:2]
    for key in rivals:
        state["cities"][key].update(owner="cao", governor=None, commander=None)
    state.pop("stations")
    page, errors = new_page(browser, address, viewport, seed)
    page.click("#open-menu")
    page.click("#open-recruitment")
    page.select_option("#recruitment-city", "luoyang")
    page.locator('[data-talent="cao-talent-0"] button').click()
    assert saved(page)["stations"]["cao-talent-0"] == "luoyang"
    fit(page, "#recruitment-dialog")
    close(page, "recruitment-dialog")
    page.click("#open-menu")
    page.click("#open-outcome")
    fit(page, "#outcome-dialog")
    page.click("#open-ending-record")
    fit(page, "#ending-record-dialog")
    assert page.locator("#conclude-scenario").is_enabled()
    page.click("#conclude-scenario")
    assert saved(page)["scenarioEnding"]["turn"] == 16
    assert page.locator("#advance").is_disabled()
    for pane in ("realm", "battles", "people"):
        page.click(f'[data-review-pane="{pane}"]')
        assert page.locator("#review-list li").count() > 0
        fit(page, "#ending-record-dialog")
    close(page, "ending-record-dialog")
    assert "立业中原" in page.locator("#outcome-title").inner_text()
    fit(page, "#outcome-dialog")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 人才招揽、确认剧本结局和三类复盘", flush=True)


def quick_opening(page, year, player):
    view(page, "forces")
    page.click("#open-campaign")
    page.select_option("#era-select", year)
    page.select_option("#force-select", player)
    page.click("#start-game")
    state = saved(page)
    assert (str(state["year"]), state["player"]) == (year, player)
    return state


def play_save_slots(browser, address, viewport):
    page, errors = new_page(browser, address, viewport)
    opening = quick_opening(page, "199", "cao")
    page.click("#open-menu")
    page.click("#save-game")
    open_saves(page)
    assert "199 年" in page.locator("#save-manual-label").inner_text()
    page.select_option("#manual-save-slot", "1")
    assert page.locator("#load-manual-slot").is_disabled()
    close(page, "saves-dialog")

    second = quick_opening(page, "262", "shu")
    open_saves(page)
    page.select_option("#manual-save-slot", "1")
    page.click("#write-manual-slot")
    assert "262 年" in page.locator("#save-manual-label").inner_text()
    close(page, "saves-dialog")

    third = quick_opening(page, "265", "wu")
    open_saves(page)
    page.select_option("#manual-save-slot", "2")
    page.click("#write-manual-slot")
    assert "265 年" in page.locator("#save-manual-label").inner_text()
    page.select_option("#manual-save-slot", "0")
    page.click("#write-manual-slot")
    assert page.locator("#save-overwrite").is_visible()
    fit(page, "#saves-dialog")
    page.click("#cancel-slot-overwrite")
    assert "199 年" in page.locator("#save-manual-label").inner_text()
    assert saved(page) == third
    close(page, "saves-dialog")

    page.reload()
    page.locator(".city-pin:not([hidden])").first.wait_for(state="visible")
    assert saved(page) == third
    for index, state in enumerate((second, third, opening), start=1):
        open_saves(page)
        page.select_option("#manual-save-slot", str(index % 3))
        with page.expect_download() as pending:
            page.click("#export-manual")
        assert json.loads(pending.value.path().read_text(encoding="utf-8"))["game"]["state"] == state
        page.click("#load-manual-slot")
        assert saved(page) == state
    open_saves(page)
    page.select_option("#manual-save-slot", "2")
    page.click("#write-manual-slot")
    page.click("#confirm-slot-overwrite")
    assert "199 年" in page.locator("#save-manual-label").inner_text()
    fit(page, "#saves-dialog")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 兼容旧槽、三个剧本存载和导出、覆盖确认与取消", flush=True)


def play_council(browser, address, viewport):
    seed = stage_fixture("199", "cao")
    seed["state"]["turn"] = 3
    front = next(key for key, city in seed["state"]["cities"].items() if city["governor"]
                 and city["owner"] == "cao" and any(seed["state"]["cities"][link]["owner"] != "cao"
                                                     for link in WORLD_CITIES[key]["links"]))
    officer = seed["state"]["cities"][front]["governor"]
    seed["state"]["officerService"] = {officer: {"governance": 2, "governanceRank": 0, "command": 0, "commandRank": 0}}
    page, errors = new_page(browser, address, viewport, seed)
    view(page, "forces")
    page.click("#open-holdings")
    page.click("#holdings-council")
    page.select_option("#national-front-focus", "farming")
    page.fill("#national-front-garrison", "0")
    page.fill("#national-treasury", "10")
    page.click("#apply-national-policy")
    assert saved(page)["nationalPolicy"]["front"]["focus"] == "farming"
    fit(page, "#campaign-council")
    page.click('[data-council-pane="route"]')
    assert page.locator("#campaign-route-list li").count() == 3
    fit(page, "#campaign-council")
    page.click('[data-council-pane="alerts"]')
    assert "太守空缺" in page.locator("#council-alert-list").inner_text()
    fit(page, "#campaign-council")
    close(page, "campaign-council")
    close(page, "holdings-dialog")

    state = advance(page, 4)
    assert state["campaignEvents"]["pending"]["kind"] == "recommendation"
    assert state["officerService"][officer]["governance"] == 3
    page.click("#open-menu")
    page.click("#open-campaign-council")
    assert "人才举荐" in page.locator("#council-event-title").inner_text()
    fit(page, "#campaign-council")
    page.click("#accept-campaign-event")
    assert "已接受" in page.locator("#council-event-history").inner_text()
    assert saved(page)["factions"]["cao"]["treasury"] == state["factions"]["cao"]["treasury"] - 18
    close(page, "campaign-council")

    city(page, front)
    page.click("#tab-governance")
    page.select_option("#mode", "direct")
    assert front in saved(page)["policyOverrides"]
    page.click("#open-menu")
    page.click("#open-campaign-council")
    page.click('[data-council-pane="alerts"]')
    managed = page.locator(f'#council-alert-list [data-city="{front}"]')
    while not managed.is_visible():
        next_page = page.locator("#council-alerts-pages button").last
        assert next_page.is_enabled()
        next_page.click()
    fit(page, "#campaign-council")
    managed.get_by_role("button", name="交回国策").click()
    assert "policyOverrides" not in saved(page)
    close(page, "campaign-council")

    view(page, "forces")
    page.click("#open-roster")
    roster = page.locator(f'#roster-list [data-officer="{officer}"]')
    while not roster.is_visible():
        next_page = page.locator("#roster-pages button").last
        assert next_page.is_enabled()
        next_page.click()
    roster.locator(".officer-link").click()
    fit(page, "#person-dialog")
    page.click("#person-open-service")
    fit(page, "#person-service-dialog")
    page.get_by_role("button", name="提拔政务").click()
    assert saved(page)["officerService"][officer]["governanceRank"] == 1
    assert page.get_by_role("button", name="提拔政务").is_disabled()
    assert not errors, errors
    page.close()
    print(f"{viewport}: 战役、国策、国政待办、事件接受与武将提拔", flush=True)


def old_turn_client(address, state):
    request = Request(address + "/api/turn", data=json.dumps({"state": state}).encode(),
                      headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=10) as response:
        assert response.headers.get_content_type() == "application/json"
        return json.load(response)["state"]


def probe_from_game(page, message, error=False):
    with page.expect_response(lambda response: response.url.endswith("/api/ai/test")) as pending_probe:
        page.click("#test-model-connection")
    response = pending_probe.value
    assert response.ok != error
    assert "local-smoke-fixture" not in response.text() and "invalid-probe-key" not in response.text()
    page.wait_for_function("message => document.getElementById('model-settings-status').textContent.includes(message)", arg=message)
    assert page.locator("#model-settings-status").get_attribute("data-error") == str(error).lower()
    fit(page, "#model-settings")


def play_model_turn(browser, address, viewport):
    with simulated_model() as (model_address, calls, probes, requested, begin, finish):
        page, errors = new_page(browser, address, viewport)
        start_from_guide(page, "199", "cao")
        initial_model = page.request.get(address + "/api/ai").json()
        initial_game = saved(page)
        guide(page)
        page.click("#guide-open-model")
        page.fill("#model-base-url", model_address)
        page.fill("#model-id", "")
        page.click("#test-model-connection")
        assert "请填写模型 ID" in page.locator("#model-settings-status").inner_text() and not probes
        page.fill("#model-id", MODEL)
        page.fill("#model-api-key", "invalid-probe-key")
        probe_from_game(page, "请检查 API Key", error=True)
        page.fill("#model-api-key", "local-smoke-fixture")
        page.fill("#model-id", "missing-fixture")
        probe_from_game(page, "找不到模型", error=True)
        page.fill("#model-id", "incompatible-fixture")
        probe_from_game(page, "模型响应与游戏不兼容", error=True)
        page.fill("#model-id", "timeout-fixture")
        probe_from_game(page, "模型连接超时", error=True)
        page.fill("#model-id", MODEL)
        probe_from_game(page, "测试通过")
        assert page.request.get(address + "/api/ai").json() == initial_model and saved(page) == initial_game
        assert not calls and len(probes) == 5
        page.click("#save-model-settings")
        page.locator("#model-settings").wait_for(state="hidden")
        page.click("#guide-open-model")
        assert page.locator("#model-api-key").input_value() == ""
        probe_from_game(page, "测试通过")
        assert probes[-1] == (MODEL, "Bearer local-smoke-fixture") and len(probes) == 6
        page.click("#close-model-settings")
        close(page, "game-guide")
        close(page, "menu-dialog")
        assert page.locator("#opponent-mode").input_value() == "model"
        snapshot = saved(page)
        faction_count = len({city["owner"] for city in snapshot["cities"].values()} & set(snapshot["factions"])) - 1
        with ThreadPoolExecutor(max_workers=1) as executor:
            legacy = executor.submit(old_turn_client, address, snapshot)
            assert requested.wait(5)
            page.click("#advance")
            view(page, "forces")
            assert page.locator("#advance").is_disabled() and page.locator("#opponent-mode").is_disabled()
            assert page.locator("#opponent-model").inner_text() == f"拟令进度 0 / {faction_count}"
            assert page.locator('#forces [data-faction="yuan"]').get_attribute("data-plan-status") == "pending"
            begin.set()
            expected = f"拟令进度 {faction_count - 1} / {faction_count}"
            page.wait_for_function("label => document.getElementById('opponent-model').textContent === label", arg=expected)
            live = {}
            next_page = page.locator("#forces-pages button").last
            while True:
                live.update(page.locator("#forces [data-plan-status]").evaluate_all(
                    "items => items.map(row => [row.dataset.faction, row.dataset.planStatus])"))
                fit(page, ".force-panel")
                fit(page, "html")
                if not next_page.is_visible() or next_page.is_disabled():
                    break
                next_page.click()
            assert len(live) == faction_count and live["biao"] == "pending" and live["yuan"] == "fallback"
            assert all(source == "model" for key, source in live.items() if key not in ("biao", "yuan")), live
            assert saved(page) == snapshot
            request = Request(address + "/api/turn", data=json.dumps({"state": snapshot}).encode(),
                              headers={"Content-Type": "application/json", "Accept": "application/x-ndjson"})
            with urlopen(request, timeout=5) as response:
                assert response.headers.get_content_type() == "application/x-ndjson"
                assert json.loads(response.readline())["type"] == "progress"
                finish.set()
                final = [json.loads(line) for line in response if line.strip()][-1]
                assert final["type"] == "result"
            state = wait_for_turn(page, 1)
            assert final["state"] == legacy.result() == state
        assert page.locator("#opponent-model").inner_text() == MODEL
        report = state["history"][-1]
        decisions = {item["faction"]: item for item in report["decisions"]}
        assert len(decisions) == len(calls) and all(count == 1 for count in Counter(calls).values()), (
            calls, {key: (item["source"], item["reason"]) for key, item in decisions.items()})
        assert len(calls) > 2 and "袁绍" in calls
        previous_calls = len(calls)
        assert old_turn_client(address, snapshot) == state
        assert len(calls) == previous_calls
        assert decisions["yuan"]["source"] == "fallback"
        assert all(item["source"] == "model" for key, item in decisions.items() if key != "yuan")
        check_receipts(report)
        page.click("#open-chronicle")
        page.click('[data-report="plans"]')
        page.select_option("#chronicle-faction", "yuan")
        assert "规则接管" in page.locator("#opponent-plan-list").inner_text()
        close(page, "chronicle")

        def legacy_response(route):
            response = route.fetch(headers={**route.request.headers, "accept": "application/json"})
            assert "application/json" in response.headers["content-type"]
            route.fulfill(response=response)

        page.route("**/api/turn", legacy_response)
        legacy_state = advance(page, 2)
        assert any(item["source"] == "model" for item in legacy_state["history"][-1]["decisions"])
        page.unroute("**/api/turn", legacy_response)

        def interrupted_stream(route):
            partial = json.dumps({"type": "progress", "faction": "yuan", "source": "model"}) + "\n"
            route.fulfill(status=200, content_type="application/x-ndjson", body=partial)

        page.route("**/api/turn", interrupted_stream)
        interrupted = advance(page, 3)["history"][-1]
        assert interrupted["decisions"] and all(item["source"] == "fallback" for item in interrupted["decisions"])
        check_receipts(interrupted)
        page.unroute("**/api/turn", interrupted_stream)
        page.route("**/api/turn", lambda route: route.fulfill(status=503, json={"error": "fixture outage"}))
        degraded = advance(page, 4)["history"][-1]
        assert degraded["decisions"] and all(item["source"] == "fallback" for item in degraded["decisions"])
        check_receipts(degraded)
        assert [item["turn"] for item in saved(page)["history"]] == [1, 2, 3, 4]
        assert not errors, errors
        page.close()
        print(f"{viewport}: 模型连接测试、独立拟令、并发共用结果、旧 JSON 和故障回退", flush=True)


def main():
    browser_path = os.getenv("SAN_CHROMIUM_PATH")
    if not browser_path:
        edge = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
        browser_path = str(edge) if edge.is_file() else None
    with isolated_game() as address, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=browser_path, headless=True)
        try:
            for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
                play_landscape(browser, address, viewport)
            for viewport in ((1440, 900), (390, 844)):
                play_landscape_opening(browser, address, viewport)
            for viewport in ((320, 360), (568, 320), (844, 390)):
                check_campaign_switching(browser, address, viewport)
            for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
                check_command_desk(browser, address, viewport)
                play_map_city_commands(browser, address, viewport)
            for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
                play_grand(browser, address, viewport)
            for viewport in ((1440, 900), (320, 360)):
                play_grand_opening(browser, address, viewport)
            for scenario in SCENARIOS:
                play_opening(browser, address, *scenario)
            for stage in (("199", "cao", (1440, 900)), ("262", "wei", (568, 320)), ("265", "jin", (320, 360))):
                play_stage(browser, address, *stage)
            play_capture(browser, address)
            for viewport in ((1440, 900), (568, 320), (320, 360)):
                play_army(browser, address, viewport)
            play_army_supply(browser, address)
            for viewport in ((1440, 900), (320, 360), (568, 320)):
                play_theaters(browser, address, viewport)
            play_theater_alert(browser, address)
            for viewport in ((1440, 900), (320, 360), (568, 320)):
                play_war(browser, address, viewport)
                play_polity(browser, address, viewport)
            for viewport in ((1440, 900), (320, 360), (568, 320)):
                play_realm(browser, address, viewport)
            play_coalition_ending(browser, address)
            play_peace_ending(browser, address)
            for viewport in ((320, 360), (568, 320)):
                play_release_end(browser, address, viewport)
            for viewport in ((320, 360), (568, 320)):
                play_save_slots(browser, address, viewport)
            for viewport in ((1440, 900), (320, 360), (568, 320)):
                play_council(browser, address, viewport)
            for viewport in ((1440, 900), (320, 440)):
                play_model_turn(browser, address, viewport)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
