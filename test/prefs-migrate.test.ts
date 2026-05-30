import { test, expect } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { configDir } from "../src/utils/paths"
import * as prefs from "../src/context/preferences"

test("prefs: eikonPath → eikon migration on load", () => {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(`${configDir()}/tui.json`,
    JSON.stringify({ eikonPath: "/home/x/.hermes/eikons/ares/ares.eikon", theme: "t" }))
  prefs.reset()
  expect(prefs.get("eikon")).toBe("ares")
  expect(prefs.get("eikonPath")).toBeUndefined()
  expect(prefs.get("theme")).toBe("t")
})

test("prefs: targetFps is parsed and clamped", () => {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(`${configDir()}/tui.json`, JSON.stringify({ targetFps: "12" }))
  prefs.reset()
  expect(prefs.get("targetFps")).toBe(15)

  prefs.set("targetFps", 99)
  expect(prefs.get("targetFps")).toBe(30)

  prefs.set("targetFps", 24)
  prefs.reset()
  expect(prefs.get("targetFps")).toBe(24)
})
