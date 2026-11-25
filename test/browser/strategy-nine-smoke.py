"""Drive the 9.0 command system in desktop, touch, and compact viewports."""
import json
import os
import runpy
import subprocess
import sys
from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright

here = Path(__file__).resolve()
shared = runpy.run_path(str(here.with_name("campaign-smoke.py")))


def seed():
    script = """
import fs from 'node:fs';
import {enrichWorld} from './dist/personnel.js';
import {availableAttackers,createGame,eraByYear} from './dist/engine.js';
import {mobilizeArmy,armyByOfficer} from './dist/armies.js';
import {reconcileFormations} from './dist/frontline.js';
import {commissionProgram} from './dist/dynasty-economy.js';
const w=enrichWorld(JSON.parse(fs.readFileSync('dist/assets/world.json')));
let s=createGame(w,199,'cao',{dynasty:true});
s.factions.cao.grain=350;
s.factions.cao.treasury=350;
const main=s.armies.find((a)=>a.faction==='cao');
Object.assign(main,{location:'luoyang',depot:'luoyang',target:'luoyang',route:['luoyang'],troops:3200,grain:80});
const rival=s.armies.find((a)=>a.faction==='ma');
Object.assign(rival,{troops:470,grain:80});
const officer=availableAttackers(eraByYear(w,s),s,'cao','xu')[0].key;
mobilizeArmy(w,s,'cao',{type:'garrison-muster',from:'xu',to:'xu',officer,troops:800});
Object.assign(armyByOfficer(s,officer),{prepared:true,phase:'hold',grain:40,opening:true});
reconcileFormations(s,[]);
s=commissionProgram(w,s,{city:'luoyang',kind:'fields',money:80,grain:40});
console.log(JSON.stringify({state:s,selected:'luoyang',main:main.officer,reserve:officer}));
"""
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=shared["ROOT"], encoding="utf-8"))


def play(browser, address, viewport):
    setup = seed()
    mobile = viewport[0] < 800
    page, errors = shared["new_page"](browser, address, viewport, seed=setup, mobile=mobile)
    save = lambda: shared["saved"](page)
    use = lambda locator: locator.tap() if mobile else locator.click()
    desk = page.locator("#strategy-nine-dialog")
    field = lambda label: desk.get_by_label(label, exact=True)
    action = lambda key: desk.locator(f'[data-strategy-action="{key}"]')
    fit = lambda: shared["fit"](page, "#strategy-nine-dialog")
    open_desk = lambda: use(page.locator("#open-frontline-map"))
    close_desk = lambda: use(desk.get_by_role("button", name="返回地图"))
    battle = page.locator("#frontline-dialog")
    close_battle = lambda: use(battle.get_by_role("button", name="返回地图"))
    use(page.locator("#open-menu"))
    use(page.locator("#open-strategy-nine-menu"))
    use(action("upgrade"))
    migrated = save()
    assert migrated.pop("strategy9")["since"] == 0 and migrated == setup["state"]
    fit()

    use(action("aims"))
    field("主目标地点").select_option("changan:luoyang")
    field("次目标地点").select_option("luoyang")
    field("季拨钱").fill("48")
    field("路网运力").fill("3")
    field("授权无赔款停战").check()
    use(action("compare"))
    assert desk.get_by_role("heading", name="战区额度预演").count() == 1
    fit()
    use(action("adopt"))
    assert save()["strategy9"]["plans"]["cao"]["money"] == 48
    fit()

    def found(role, site, commander=None, priority=None):
        use(action("fronts"))
        field("战区").select_option("")
        field("战区任务").select_option(role)
        field("战区目标").select_option(site)
        if commander:
            field("指定统帅").select_option(commander)
        if priority:
            field("优先级").fill(str(priority))
        use(action("charter"))
        fit()
        return save()["strategy9"]["fronts"][-1]["id"]

    west = found("diversion", "changan:luoyang", setup["main"], 5)
    east = found("defense", "xiapi", priority=2)
    use(action("reserve"))
    field("战区").select_option(str(east))
    field("调拨军团").select_option(setup["reserve"])
    use(action("send"))
    assert save()["strategy9"]["movements"][0]["eta"] >= 2
    fit()

    use(action("fronts"))
    field("战区").select_option(str(west))
    use(action("locate"))
    pin = page.locator(f'[data-strategy-front="{west}"]:not([hidden])')
    use(pin)
    assert field("战区").input_value() == str(west)
    use(action("battle"))
    battle.locator('.frontline-scene[data-terrain-art="pass"][data-unit-art="formations"]').wait_for(state="visible")
    shared["fit"](page, "#frontline-dialog")
    close_battle()
    open_desk()
    if viewport in ((1440, 900), (390, 844)):
        main = found("offensive", "ye", priority=1)
        use(action("battle"))
        battle.locator('.frontline-scene[data-season-terrain="rain-siege"]').wait_for(state="visible")
        assert battle.locator(".battlefield-board[data-defender-intel]").count() == 1
        shared["fit"](page, "#frontline-dialog")
        page.screenshot(path=str(Path(gettempdir()) / f"san9-field-{viewport[0]}.png"))
        close_battle()
        open_desk()
        use(action("fronts"))
        field("战区").select_option(str(main))
        use(action("pause"))
        assert save()["strategy9"]["fronts"][-1]["status"] == "paused"
    use(action("overview"))
    fit()
    if viewport in ((1440, 900), (390, 844)):
        page.screenshot(path=str(Path(gettempdir()) / f"san9-council-{viewport[0]}.png"))
    use(action("batch"))
    state = shared["wait_for_turn"](page, 1)
    assert state["sandtable"]["posts"]["changan:luoyang"]["owner"] == "cao"
    assert len(state["strategy9"]["records"][0]["operations"]) >= 2
    assert any(reply["kind"] in ["raid", "screen"] for reply in state["strategy9"]["responses"].values())
    assert state["dynasty"]["programs"][0]["made"] == 1
    assert state["strategy9"]["movements"][0]["status"] == "travel"
    open_desk()
    use(action("reports"))
    fit()
    use(action("replay"))
    battle.locator(".frontline-scene[data-unit-art='formations']").wait_for(state="visible")
    use(battle.locator('[data-battle-step="2"]'))
    assert battle.locator(".battlefield-force").count() == 2
    shared["fit"](page, "#frontline-dialog")
    close_battle()
    shared["advance"](page, 2)
    assert any(report["kind"] == "terms" for report in save()["strategy9"]["reports"])
    shared["advance"](page, 3)
    assert any(war["status"] == "ended" and war["receipt"]["kind"] == "ceasefire" for war in save()["sandtable"]["wars"])
    open_desk()
    use(action("regions"))
    use(action("measure"))
    assert save()["strategy9"]["measures"]
    fit()
    close_desk()
    saved = save()
    page.reload()
    page.locator("#open-frontline-map").wait_for(state="visible")
    assert save() == saved
    shared["fit"](page, "html")
    assert not errors, errors
    page.close()
    print(f"{viewport}: 8.0 升级、全国方略、双战区、预备军、敌军反制、急报暂停、会战回放、地方决议、重读", flush=True)


def main():
    edge = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
    path = os.getenv("SAN_CHROMIUM_PATH") or (str(edge) if edge.is_file() else None)
    with shared["isolated_game"]() as address, sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=path, headless=True)
        for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
            if len(sys.argv) == 1 or str(viewport[0]) in sys.argv[1:]:
                play(browser, address, viewport)
        browser.close()


if __name__ == "__main__":
    main()
