import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { mountNode, until } from "./harness"
import { hermesPath, readEnvFile, writeEnvVar, removeEnvVar, ENV_CATALOG } from "../src/service/hermes-home"
import { home } from "../src/home"
import { Env } from "../src/tabs/Env"

// hermes-home resolves ENV_PATH at import time from the sandbox
// HERMES_HOME set in preload.ts — write the fixture there.
const ENV = hermesPath(".env")

beforeEach(() => {
  mkdirSync(hermesPath("."), { recursive: true })
  writeFileSync(ENV, "ANTHROPIC_API_KEY=sk-ant-secret123\nCUSTOM_THING=hello\n")
})

describe("Env tab", () => {
  afterEach(() => { home.invalidate("env") })

  test("catalog includes upstream Camofox and memory env vars", () => {
    const keys = new Set(ENV_CATALOG.flatMap(g => g.keys))
    for (const key of [
      "CAMOFOX_URL", "CAMOFOX_API_KEY", "HINDSIGHT_API_KEY", "HINDSIGHT_API_URL",
      "SUPERMEMORY_API_KEY", "MEM0_API_KEY", "RETAINDB_API_KEY", "RETAINDB_BASE_URL",
      "BRV_API_KEY", "OPENVIKING_API_KEY", "OPENVIKING_ENDPOINT",
    ]) expect(keys.has(key), key).toBe(true)
  })

  test("env reader and writer understand export-prefixed lines", async () => {
    writeFileSync(ENV, "export CAMOFOX_API_KEY=old\nPLAIN=yes\n")
    expect(await readEnvFile()).toEqual({ CAMOFOX_API_KEY: "old", PLAIN: "yes" })

    await writeEnvVar("CAMOFOX_API_KEY", "new")
    expect(readFileSync(ENV, "utf8")).toContain("export CAMOFOX_API_KEY=new")

    await removeEnvVar("CAMOFOX_API_KEY")
    const text = readFileSync(ENV, "utf8")
    expect(text).not.toContain("CAMOFOX_API_KEY")
    expect(text).toContain("PLAIN=yes")
    home.invalidate("env")
  })

  test("masks values by default; Space reveals all", async () => {
    const t = await mountNode(<Env focused />, { height: 80 })
    await until(t, () => t.frame().includes("ANTHROPIC_API_KEY"))

    const f = t.frame()
    expect(f).toContain("SET")
    expect(f).toContain("•".repeat(12))
    expect(f).not.toContain("sk-ant-" + "secret123")
    // Un-catalogued key surfaces under Other
    expect(f).toContain("Other")
    expect(f).toContain("CUSTOM_THING")
    expect(f).not.toContain("hello")

    await act(async () => { await t.keys.typeText(" ") })
    await until(t, () => t.frame().includes("sk-ant-" + "secret123"))
    expect(t.frame()).toContain("hello")

    // Toggle back
    await act(async () => { await t.keys.typeText(" ") })
    await until(t, () => !t.frame().includes("sk-ant-" + "secret123"))
    t.destroy()
  })

  test("Enter reveals selected, second Enter opens edit prompt", async () => {
    const t = await mountNode(<Env focused />)
    await until(t, () => t.frame().includes("ANTHROPIC_API_KEY"))

    // row 0 is the "LLM Providers" header → move to first var
    act(() => t.keys.pressArrow("down"))
    await t.settle()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("sk-ant-secret123"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Edit ANTHROPIC_API_KEY"))
    act(() => t.keys.pressEscape())
    await t.settle()
    t.destroy()
  })

  test("click row reveals; second click opens edit; click header collapses", async () => {
    const SECRET = "sk-ant-" + "secret123"
    const t = await mountNode(<Env focused />, { width: 120, height: 40 })
    await until(t, () => t.frame().includes("ANTHROPIC_API_KEY"))

    const rowY = (s: string) => t.frame().split("\n").findIndex(l => l.includes(s))
    const tap = async (s: string) => {
      const y = rowY(s)
      await act(async () => { await t.mouse.pressDown(30, y) })
      await t.settle()
      await act(async () => { await t.mouse.release(30, y) })
      await t.settle()
    }
    // Click a set var → reveals value (Enter-parity path 1).
    expect(t.frame()).not.toContain(SECRET)
    await tap("ANTHROPIC_API_KEY")
    await until(t, () => t.frame().includes(SECRET))
    // Second click → edit prompt (Enter-parity path 2).
    await tap("ANTHROPIC_API_KEY")
    await until(t, () => t.frame().includes("Edit ANTHROPIC_API_KEY"))
    act(() => t.keys.pressEscape())
    await t.settle()
    // Click header → collapses group.
    await tap("LLM Providers")
    expect(t.frame()).not.toContain("ANTHROPIC_API_KEY")
    t.destroy()
  })

  test("n prompts for key then value and writes to .env", async () => {
    const t = await mountNode(<Env focused />)
    await until(t, () => t.frame().includes("ANTHROPIC_API_KEY"))

    await act(async () => { await t.keys.typeText("n") })
    await until(t, () => t.frame().includes("New Variable"))
    for (const c of "FOO_KEY") await act(async () => { await t.keys.typeText(c) })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Set FOO_KEY"))
    for (const c of "abc") await act(async () => { await t.keys.typeText(c) })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("FOO_KEY added"))

    const text = await Bun.file(ENV).text()
    expect(text).toContain("FOO_KEY=abc")
    t.destroy()
  })
})
