"""Run the national command, migration and continued campaign in a real browser."""
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
old = runpy.run_path(str(here.with_name("reign-smoke.py")))


def attach(browser, address, viewport, fixture=None, context=None):
    width, height = viewport
    mobile = width < 800
    if context is None:
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=mobile, has_touch=mobile)
    key = os.environ.get("SAN_VERIFY_BYPASS")
    if key and not context.cookies(address):
        for _ in range(3):
            setup = context.request.get(address + "/api/ai", headers={
                "x-vercel-protection-bypass": key, "x-vercel-set-bypass-cookie": "true",
                "Accept": "application/json"
            }, max_redirects=0)
            if setup.ok and context.cookies(address):
                break
        assert context.cookies(address), ("预发布认证 cookie 未建立", setup.status)
    page = context.new_page()
    page.set_default_timeout(30000 if key else 14000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda response: errors.append(f"HTTP {response.status} {response.url.split('?')[0]}")
            if response.status >= 400 else None)
    if fixture:
        page.add_init_script(f"""if (!sessionStorage.getItem('century-seed')) {{
          localStorage.setItem('jinglue-sanguo:auto:v1', {json.dumps(json.dumps(fixture))});
          sessionStorage.setItem('century-seed', 'yes');
        }}""")
    page.goto(address + "/")
    try:
        page.locator("#open-frontline-map").wait_for(state="visible")
    except Exception as error:
        raise AssertionError((page.locator("#boot").text_content(), errors)) from error
    use = lambda control: control.tap() if mobile else control.click()
    desk = page.locator("#century-dialog")
    action = lambda name: desk.locator('[data-century-action="' + name + '"]')
    return page, context, errors, use, desk, action


def upgrade(page, use, action):
    use(page.locator("#open-menu"))
    use(page.locator("#open-century-menu"))
    use(action("upgrade"))


def migration_and_battle(browser, address, viewport):
    fixture = old["seed"]()
    page, context, errors, use, desk, action = attach(browser, address, viewport, fixture)
    upgrade(page, use, action)
    backup = page.evaluate("JSON.parse(localStorage.getItem('jinglue-sanguo:before-century')).state")
    assert "century" not in backup and backup["strategy9"]["fronts"]
    close = desk.locator('[data-close="century-dialog"]')
    use(close)
    use(page.locator("#open-frontline-map"))
    use(action("preset-recovery"))
    use(action("preview"))
    assert desk.locator(".century-table tbody tr").count() == 4
    shared["fit"](page, "#century-dialog")
    use(action("publish"))
    use(action("local"))
    use(action("compact"))
    use(action("front-priority"))
    use(action("front-priority"))
    assert shared["saved"](page)["century"]["charters"]
    assert shared["saved"](page)["strategy9"]["fronts"] == backup["strategy9"]["fronts"]
    use(action("overview"))
    use(action("advance"))
    state = shared["wait_for_turn"](page, 1)
    assert len(state["cities"]) == len(state["reign"]["markets"]) == 42
    assert state["sandtable"]["posts"]["changan:luoyang"]["owner"] == "cao"
    assert state["dynasty"]["programs"][0]["made"] == 1
    assert state["century"]["battles"]
    use(page.locator("#open-frontline-map"))
    use(action("journal"))
    use(action("after-map"))
    assert page.locator("#map-stage").get_attribute("data-dynasty-replay") == "true"
    use(page.locator("#dynasty-map-return"))
    use(page.locator("#open-frontline-map"))
    use(action("overview"))
    use(action("replay"))
    battle = page.locator("#frontline-dialog")
    battle.locator(".frontline-scene[data-century-terrain][data-unit-art='formations']").wait_for(state="visible")
    use(battle.locator('[data-battle-step="2"]'))
    assert battle.locator(".battlefield-force").count() == 2
    shared["fit"](page, "#frontline-dialog")
    if viewport[0] in (390, 1440):
        page.screenshot(path=str(Path(gettempdir()) / f"san15-battle-{viewport[0]}.png"))
    use(battle.get_by_role("button", name="返回地图"))
    page.reload()
    page.locator("#open-frontline-map").wait_for(state="visible")
    assert shared["saved"](page) == state
    shared["fit"](page, "html")
    assert not errors, errors
    context.close()
    print(f"{viewport}: 10.0 migration, four-season forecast, charter, gate battle, visual replay, timeline, reload", flush=True)


def new_game(browser, address, viewport):
    page, context, errors, use, desk, action = attach(browser, address, viewport)
    use(page.locator("#open-frontline-map"))
    use(action("preset-accord"))
    use(action("publish"))
    use(action("overview"))
    use(action("economy-map"))
    assert page.locator("#map-stage").get_attribute("data-reign-lens") == "economy"
    use(page.locator("#reign-map-close"))
    use(page.locator("#century-pending"))
    assert desk.is_visible()
    use(desk.locator('[data-close="century-dialog"]'))
    page.locator("#advance").evaluate("(button) => { button.click(); button.click(); }")
    first = shared["wait_for_turn"](page, 1)
    page.wait_for_timeout(650)
    assert shared["saved"](page)["turn"] == 1
    other, _, other_errors, _, _, _ = attach(browser, address, viewport, context=context)
    use(page.locator("#advance"))
    second = shared["wait_for_turn"](page, 2)
    other.locator("#advance").evaluate("(button) => button.click()")
    other.get_by_text("另一页已更新战局。请重新载入当前进度后再推进。").wait_for()
    assert shared["saved"](page)["turn"] == 2
    assert first["century"]["plan"] == second["century"]["plan"]
    assert not errors and not other_errors, (errors, other_errors)
    shared["fit"](page, "html")
    context.close()
    print(f"{viewport}: new campaign, national command and economy map, repeat click and concurrent tab preserved one settlement", flush=True)


def small_faction_campaign(browser, address, viewport):
    script = old["foundation"] + "console.log(JSON.stringify({state:createGame(w,208,'liu',{century:true}),selected:'jiangxia'}));"
    fixture = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=shared["ROOT"], encoding="utf-8"))
    page, context, errors, use, desk, action = attach(browser, address, viewport, fixture)
    use(page.locator("#open-frontline-map"))
    use(action("preset-accord"))
    use(action("publish"))
    use(action("local"))
    use(action("leagues"))
    league = page.locator("#reign-dialog")
    fields = lambda label, type="select": league.locator("label").filter(has_text=label).locator(type)
    fields("共同目标").select_option("cao")
    fields("邀请主盟友").select_option("wu")
    fields("追加盟友").select_option("zhang")
    fields("每季盟粮", "input").fill("1")
    fields("条约季数", "input").fill("12")
    use(league.locator('[data-reign-action="summon"]'))
    use(league.locator('[data-close="reign-dialog"]'))
    for turn in range(1, 6):
        page.wait_for_timeout(500)
        use(page.locator("#advance"))
        state = shared["wait_for_turn"](page, turn)
    assert state["reign"]["leagues"][0]["status"] == "active"
    assert state["century"]["trade"] == 5 and state["century"]["epochs"][0]["kind"] == "accord"
    use(page.locator("#open-frontline-map"))
    use(action("journal"))
    use(action("conclude-accord"))
    assert shared["saved"](page)["century"]["concluded"]["kind"] == "accord"
    use(action("reopen"))
    assert shared["saved"](page)["reign"]["stewardship"]["kind"] == "scenario"
    assert not errors, errors
    context.close()
    print(f"{viewport}: normal Liu Bei opening, league with two AI peers, five paid quarters, victory and continued campaign", flush=True)


def continued_campaign(browser, address, viewport):
    fixture = old["seed"](True)
    page, context, errors, use, desk, action = attach(browser, address, viewport, fixture)
    upgrade(page, use, action)
    state = shared["saved"](page)
    first = state["turn"]
    use(action("reopen"))
    use(action("policy"))
    use(action("preset-recovery"))
    use(action("publish"))
    use(action("pending"))
    use(action("renew"))
    heir = desk.locator('[data-century-field="successor"] option').nth(1).get_attribute("value")
    desk.locator('[data-century-field="successor"]').select_option(heir)
    use(action("succession"))
    use(desk.locator('[data-close="century-dialog"]'))
    for turn in range(first + 1, first + 15):
        page.wait_for_timeout(500)
        use(page.locator("#advance"))
        state = shared["wait_for_turn"](page, turn)
        if state["reign"]["stewardship"]["finished"]:
            break
    assert state["reign"]["stewardship"]["transferred"] > first
    assert state["reign"]["stewardship"]["finished"] and state["century"]["epochs"]
    use(page.locator("#outcome-stewardship"))
    assert shared["saved"](page)["century"]["generation"] == 2
    assert not errors, errors
    context.close()
    print(f"{viewport}: peaceful ending continued, legitimate handover, stewardship completed, reopened third chapter", flush=True)


def run(address, playwright):
    edge = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
    path = os.getenv("SAN_CHROMIUM_PATH") or (str(edge) if edge.is_file() else None)
    browser = playwright.chromium.launch(executable_path=path, headless=True)
    for viewport in ((1440, 900), (390, 844), (320, 360), (568, 320)):
        if len(sys.argv) != 1 and str(viewport[0]) not in sys.argv[1:]:
            continue
        migration_and_battle(browser, address, viewport)
        if viewport[0] in (1440, 390):
            new_game(browser, address, viewport)
            small_faction_campaign(browser, address, viewport)
            continued_campaign(browser, address, viewport)
    browser.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        if "SAN_VERIFY_URL" in os.environ:
            run(os.environ["SAN_VERIFY_URL"], playwright)
        else:
            with shared["isolated_game"]() as home:
                run(home, playwright)
