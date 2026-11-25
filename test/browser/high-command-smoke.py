"""Play one complete national authorization and campaign in desktop and touch layouts."""
import json
import os
import runpy
import subprocess
from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright

shared = runpy.run_path(str(Path(__file__).with_name("campaign-smoke.py")))


def seed():
    script = """
import fs from 'node:fs';
import {enrichWorld} from './dist/personnel.js';
import {createGame} from './dist/engine.js';
import {prepareConvoy} from './dist/landscape-economy.js';
const w = enrichWorld(JSON.parse(fs.readFileSync('dist/assets/world.json')));
let s = createGame(w,199,'cao',{highCommand:true});
const own = s.armies.find(a=>a.faction==='cao');
const rival = s.armies.find(a=>a.faction==='ma');
Object.assign(own,{location:'luoyang',depot:'luoyang',target:'luoyang',route:['luoyang'],troops:3200,grain:80});
Object.assign(rival,{location:'tianshui',depot:'tianshui',target:'tianshui',route:['tianshui'],troops:470,grain:80});
s.factions.cao.grain=220;
s=prepareConvoy(w,s,{from:'xu',to:'luoyang',mode:'land',cargo:'grain',amount:12});
console.log(JSON.stringify({state:s,selected:'luoyang'}));
"""
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=shared["ROOT"], encoding="utf-8"))


def play(browser, address, viewport):
    mobile = viewport[0] < 800
    page, errors = shared["new_page"](browser, address, viewport, seed(), mobile=mobile)
    council = page.locator("#high-command-dialog")
    battle = page.locator("#frontline-dialog")
    command = lambda key: council.locator(f'[data-command="{key}"]')
    use = lambda locator: locator.tap() if mobile else locator.click()
    entry = lambda: use(page.locator("#open-frontline-map"))
    fit = shared["fit"]
    save = lambda: shared["saved"](page)
    close = lambda dialog: use(dialog.get_by_role("button", name="返回地图"))
    assert page.locator(".troop-pin[data-visual-kind='wagon']:not([hidden])").count() == 1
    assert int(page.locator("#map-stage").get_attribute("data-garrisons")) >= 8
    entry()
    fit(page, "#high-command-dialog")
    use(command("policy"))
    command("floorGrain").fill("30")
    command("personnel").select_option("search")
    use(command("publish"))
    assert save()["highCommand"]["policies"]["cao"]["floorGrain"] == 30
    use(command("new-campaign"))
    command("target").select_option("changan:luoyang")
    named = command("commander").input_value()
    assert named == next(army["officer"] for army in save()["armies"] if army["faction"] == "cao")
    use(command("permissions"))
    command("withdraw").fill("400")
    fit(page, "#high-command-dialog")
    use(command("back"))
    use(command("authorize"))
    state = save()
    campaign = state["highCommand"]["campaigns"][0]
    key = campaign["id"]
    assert campaign["mode"] == "delegate" and campaign["withdraw"] == 400
    assert council.get_by_text("函谷关", exact=False).count()
    fit(page, "#high-command-dialog")
    close(council)
    pin = page.locator(f'[data-campaign-pin="{key}"]:not([hidden])')
    use(pin)
    use(command("direct"))
    assert save()["highCommand"]["campaigns"][0]["mode"] == "direct"
    use(command("battlefield"))
    battle.locator(".frontline-scene").wait_for(state="visible")
    battle.locator('.frontline-scene[data-terrain-art="pass"]').wait_for(state="visible")
    battle.locator('.frontline-scene[data-unit-art="formations"]').wait_for(state="visible")
    use(battle.locator("[data-field-formation]").first)
    use(battle.locator('[data-field-role="advance"]'))
    use(battle.get_by_role("button", name="更新调令"))
    assert save()["frontline"]["plans"][0]["units"][0]["role"] == "advance"
    fit(page, "#frontline-dialog")
    if viewport in ((1440, 900), (390, 844)):
        page.screenshot(path=str(Path(gettempdir()) / f"san8-deployment-{viewport[0]}.png"))
    close(battle)
    entry()
    use(command("campaign-" + str(key)))
    use(command("delegate"))
    assert save()["highCommand"]["campaigns"][0]["mode"] == "delegate"
    use(command("advance"))
    state = shared["wait_for_turn"](page, 1)
    assert state["sandtable"]["posts"]["changan:luoyang"]["owner"] == "cao"
    assert state["landscape"]["convoys"][0]["status"] == "delivered"
    assert state["highCommand"]["campaigns"][0]["stage"] == "secure"
    entry()
    use(command("campaign-" + str(key)))
    use(command("replay"))
    use(battle.locator('[data-battle-step="1"]'))
    assert battle.locator(".battlefield-force").count() == 2
    assert battle.get_by_text("战力", exact=True).count() == 2
    if viewport in ((1440, 900), (390, 844)):
        page.screenshot(path=str(Path(gettempdir()) / f"san8-engagement-{viewport[0]}.png"))
    use(battle.get_by_role("button", name="播放", exact=True))
    battle.get_by_text("曹操占优。").wait_for(state="visible")
    fit(page, "#frontline-dialog")
    if viewport in ((1440, 900), (390, 844)):
        page.screenshot(path=str(Path(gettempdir()) / f"san8-outcome-{viewport[0]}.png"))
    close(battle)
    shared["advance"](page, 2)
    entry()
    use(command("urgent"))
    use(command("alert-" + str(key)))
    assert save()["highCommand"]["campaigns"][0]["stage"] == "settlement"
    use(command("secure"))
    assert save()["highCommand"]["campaigns"][0]["resolution"] == "secure"
    fit(page, "#high-command-dialog")
    close(council)
    page.reload()
    page.locator(".city-pin:not([hidden])").first.wait_for(state="visible")
    assert save()["highCommand"]["campaigns"][0]["stage"] == "ended"
    fit(page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 军议授权、地图战役、接管与交还、据点争夺、回放、战后驻防和读档", flush=True)


def migrate(browser, address):
    previous = seed()
    previous["state"].pop("highCommand")
    own = next(unit for unit in previous["state"]["armies"] if unit["faction"] == "cao")
    own.update(phase="march", target="changan", route=["luoyang", "changan"])
    previous["state"]["treaties"].append({"sides": ["biao", "cao"], "kind": "alliance", "expires": 4})
    page, errors = shared["new_page"](browser, address, (390, 844), previous, mobile=True)
    page.locator("#open-menu").tap()
    page.locator("#open-frontline-menu").tap()
    page.locator('#high-command-dialog [data-command="upgrade"]').tap()
    state = shared["saved"](page)
    assert state.pop("highCommand")["campaigns"] == []
    assert state == previous["state"]
    page.locator('#high-command-dialog [data-close="high-command-dialog"]').tap()
    shared["advance"](page, 1)
    assert shared["saved"](page)["highCommand"]["since"] == 0
    assert not errors, errors
    page.close()
    print("390×844：6.0 在途军团、盟约和运输队升级后继续结算", flush=True)


def main():
    edge = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
    path = os.getenv("SAN_CHROMIUM_PATH") or (str(edge) if edge.is_file() else None)
    with shared["isolated_game"]() as address, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=path, headless=True)
        for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
            play(browser, address, viewport)
        migrate(browser, address)
        browser.close()


if __name__ == "__main__":
    main()
