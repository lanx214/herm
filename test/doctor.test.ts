import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Database } from "bun:sqlite"
import { runDoctor, summarize, type DoctorProbe } from "../src/service/doctor"

const roots: string[] = []

const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "herm-doctor-"))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const byId = (items: DoctorProbe[], id: string) => {
  const hit = items.find(p => p.id === id)
  expect(hit).toBeDefined()
  return hit!
}

describe("doctor probes", () => {
  test("missing runtime dependencies return actionable results", async () => {
    const home = tmp()
    const root = join(home, "agent")
    const items = await runDoctor({
      hermesHome: home,
      hermesAgentRoot: root,
      env: { HERMES_PYTHON: join(home, "missing-python"), PATH: "" },
      command: async cmd => cmd[0] === "bun"
        ? { ok: true, stdout: "1.3.4\n" }
        : { ok: false, stderr: "not found" },
      gateway: async () => ({ ok: false, error: "ECONNREFUSED" }),
    })

    expect(byId(items, "python")).toMatchObject({ status: "fail", label: "Python" })
    expect(byId(items, "python").hint).toContain("HERMES_PYTHON")
    expect(byId(items, "gateway")).toMatchObject({ status: "fail", label: "Gateway" })
    expect(byId(items, "chafa")).toMatchObject({ status: "fail", label: "chafa" })
    expect(byId(items, "state-db")).toMatchObject({ status: "warn", label: "state.db" })
    expect(byId(items, "sessions-db")).toMatchObject({ status: "warn", label: "sessions.db" })
  })

  test("safe sqlite integrity checks report healthy db files", async () => {
    const home = tmp()
    for (const name of ["state.db", "sessions.db"]) {
      const db = new Database(join(home, name))
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
      db.close()
    }

    const items = await runDoctor({
      hermesHome: home,
      hermesAgentRoot: home,
      env: { PATH: "/bin" },
      command: async cmd => {
        if (cmd[0] === "bun") return { ok: true, stdout: "1.3.4" }
        if (cmd[0] === "chafa") return { ok: true, stdout: "Chafa version 1.14.5" }
        return { ok: true, stdout: "Python 3.12.0" }
      },
      gateway: async () => ({ ok: true, details: "ready" }),
    })

    expect(byId(items, "state-db")).toMatchObject({ status: "ok", details: expect.stringContaining("integrity ok") })
    expect(byId(items, "sessions-db")).toMatchObject({ status: "ok", details: expect.stringContaining("integrity ok") })
  })

  test("db permission failures do not throw", async () => {
    const home = tmp()
    writeFileSync(join(home, "state.db"), "not sqlite")
    chmodSync(join(home, "state.db"), 0o000)

    const items = await runDoctor({
      hermesHome: home,
      hermesAgentRoot: home,
      env: { PATH: "/bin" },
      command: async () => ({ ok: false, stderr: "missing" }),
      gateway: async () => ({ ok: false, error: "down" }),
    })

    expect(["warn", "fail"]).toContain(byId(items, "state-db").status)
    expect(byId(items, "state-db").hint).toBeTruthy()
  })

  test("default gateway probe starts the reusable gateway client", async () => {
    const home = tmp()
    let started = false
    const items = await runDoctor({
      hermesHome: home,
      hermesAgentRoot: home,
      env: { PATH: "/bin" },
      gatewayTimeoutMs: 1,
      command: async () => ({ ok: false, stderr: "missing" }),
    })

    started = byId(items, "gateway").details.includes("timed out")
    expect(started).toBe(true)
    expect(byId(items, "gateway")).toMatchObject({ status: "fail", label: "Gateway" })
  })

  test("plugin statuses are included when exposed", async () => {
    const home = tmp()
    const items = await runDoctor({
      hermesHome: home,
      hermesAgentRoot: home,
      env: { PATH: "/bin" },
      command: async () => ({ ok: false, stderr: "missing" }),
      gateway: async () => ({ ok: false, error: "down" }),
      plugins: () => [
        { id: "clock", enabled: true, active: true },
        { id: "bad", enabled: true, active: false, error: "boom" },
      ],
    })

    expect(byId(items, "plugins")).toMatchObject({ status: "fail", label: "Plugins" })
    expect(byId(items, "plugins").details).toContain("bad: boom")
  })

  test("summary escalates fail over warn over ok", () => {
    expect(summarize([{ id: "a", status: "ok", label: "A", details: "" }])).toEqual({ ok: 1, warn: 0, fail: 0, status: "ok" })
    expect(summarize([{ id: "a", status: "warn", label: "A", details: "" }]).status).toBe("warn")
    expect(summarize([{ id: "a", status: "fail", label: "A", details: "" }]).status).toBe("fail")
  })
})
