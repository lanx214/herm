import { accessSync, existsSync, statSync } from "fs"
import { constants } from "fs"
import { join, resolve } from "path"
import { homedir } from "os"
import { Database } from "bun:sqlite"
import { GatewayClient, hermesAgentRoot as defaultAgentRoot, python as resolvePython } from "../context/gateway-client"
import { VERSION } from "../app/launch"
import type { GatewayEvent } from "../context/wire"
import type { PluginStatus } from "../plugins/types"

export type DoctorStatus = "ok" | "warn" | "fail"

export type DoctorProbe = {
  id: string
  status: DoctorStatus
  label: string
  details: string
  hint?: string
}

export type DoctorCommandResult = {
  ok: boolean
  stdout?: string
  stderr?: string
  code?: number | null
}

export type DoctorGatewayResult = {
  ok: boolean
  details?: string
  error?: string
}

export type DoctorOptions = {
  hermesHome?: string
  hermesAgentRoot?: string
  cwd?: string
  env?: Record<string, string | undefined>
  command?: (cmd: string[], opts?: { cwd?: string; env?: Record<string, string | undefined> }) => Promise<DoctorCommandResult>
  gateway?: () => Promise<DoctorGatewayResult>
  plugins?: () => ReadonlyArray<PluginStatus>
  gatewayTimeoutMs?: number
}

export type DoctorSummary = {
  ok: number
  warn: number
  fail: number
  status: DoctorStatus
}

const HINT = {
  gateway: "Start Hermes through the configured gateway path or check HERMES_PYTHON / HERMES_AGENT_ROOT.",
  python: "Set HERMES_PYTHON to a working interpreter or create venv/.venv under the Hermes Agent root.",
  chafa: "Install chafa and ensure it is on PATH; image previews fall back without it.",
  db: "Check HERMES_HOME ownership and permissions; move corrupt DB files aside only after backing them up.",
  bun: "Install Bun >= 1.3.0 and ensure bun is on PATH.",
  opentui: "Run bun install so @opentui/core and @opentui/react resolve from this Herm checkout.",
  auth: "Run Hermes setup/auth in the CLI, then reopen Herm.",
  plugins: "Disable the failing plugin or inspect its activation/dispose error in stderr.",
}

const home = (env: Record<string, string | undefined>) => env.HERMES_HOME || `${env.HOME || homedir()}/.hermes`

const shellEnv = (env: Record<string, string | undefined>) => {
  const out: Record<string, string | undefined> = { ...process.env, ...env }
  return out
}

const run = async (cmd: string[], opts: DoctorOptions, env: Record<string, string | undefined>): Promise<DoctorCommandResult> => {
  if (opts.command) return opts.command(cmd, { cwd: opts.cwd, env })
  try {
    const proc = Bun.spawn(cmd, { cwd: opts.cwd, env: shellEnv(env), stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { ok: code === 0, stdout, stderr, code }
  } catch (e) {
    return { ok: false, stderr: e instanceof Error ? e.message : String(e) }
  }
}

const clean = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ")

const result = (id: string, status: DoctorStatus, label: string, details: string, hint?: string): DoctorProbe => ({
  id,
  status,
  label,
  details,
  ...(hint ? { hint } : {}),
})

const can = (path: string, mode: number) => {
  try { accessSync(path, mode); return true }
  catch { return false }
}

async function probeAuth(opts: DoctorOptions, env: Record<string, string | undefined>): Promise<DoctorProbe> {
  const cmd = await run([resolvePython(opts.hermesAgentRoot || defaultAgentRoot(), process.platform), "-m", "hermes_cli", "setup", "status", "--json"], opts, env)
  if (!cmd.ok) return result("auth", "warn", "Auth/setup", "setup.status unavailable", HINT.auth)
  const text = clean(cmd.stdout)
  if (!text) return result("auth", "warn", "Auth/setup", "setup.status returned no output", HINT.auth)
  try {
    const data = JSON.parse(text) as { ok?: boolean; authenticated?: boolean; status?: string }
    const ok = data.ok === true || data.authenticated === true || data.status === "ok"
    return result("auth", ok ? "ok" : "warn", "Auth/setup", text, ok ? undefined : HINT.auth)
  } catch {
    return result("auth", "warn", "Auth/setup", text, undefined)
  }
}

async function defaultGateway(timeoutMs: number): Promise<DoctorGatewayResult> {
  const gw = new GatewayClient()
  return new Promise(resolve => {
    let done = false
    const finish = (out: DoctorGatewayResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      gw.removeAllListeners()
      gw.kill()
      resolve(out)
    }
    const timer = setTimeout(() => finish({ ok: false, error: "gateway readiness timed out" }), timeoutMs)
    gw.on("event", (ev: GatewayEvent) => {
      if (ev.type === "gateway.ready" || ev.type === "session.info") finish({ ok: true, details: ev.type })
      if (ev.type === "gateway.start_timeout") finish({ ok: false, error: "gateway startup timed out" })
      if (ev.type === "gateway.protocol_error") finish({ ok: false, error: `protocol error: ${ev.payload?.preview ?? "unknown"}` })
    })
    gw.on("exit", code => finish({ ok: false, error: `gateway exited${code === null ? "" : ` (${code})`}` }))
    try { gw.start(); gw.drain() }
    catch (e) { finish({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
  })
}

async function probeGateway(opts: DoctorOptions): Promise<DoctorProbe> {
  try {
    const g = opts.gateway ? await opts.gateway() : await defaultGateway(opts.gatewayTimeoutMs ?? 5000)
    if (g.ok) return result("gateway", "ok", "Gateway", g.details || "reachable")
    return result("gateway", "fail", "Gateway", g.error || "unreachable", HINT.gateway)
  } catch (e) {
    return result("gateway", "fail", "Gateway", e instanceof Error ? e.message : String(e), HINT.gateway)
  }
}

async function probePython(opts: DoctorOptions, env: Record<string, string | undefined>): Promise<DoctorProbe> {
  const root = opts.hermesAgentRoot || defaultAgentRoot()
  const bin = resolvePython(root, process.platform)
  const exists = bin.includes("/") || bin.includes("\\") ? existsSync(bin) : true
  if (!exists) return result("python", "fail", "Python", `${bin} does not exist`, HINT.python)
  const out = await run([bin, "--version"], opts, env)
  if (!out.ok) return result("python", "fail", "Python", `${bin}: ${clean(out.stderr) || "not executable"}`, HINT.python)
  return result("python", "ok", "Python", `${bin} · ${clean(out.stdout || out.stderr)}`)
}

async function probeChafa(opts: DoctorOptions, env: Record<string, string | undefined>): Promise<DoctorProbe> {
  const out = await run(["chafa", "--version"], opts, env)
  if (!out.ok) return result("chafa", "fail", "chafa", clean(out.stderr) || "not found", HINT.chafa)
  return result("chafa", "ok", "chafa", clean(out.stdout || out.stderr) || "present")
}

function integrity(path: string): string | null {
  let db: Database | null = null
  try {
    db = new Database(path, { readwrite: true, create: false })
    const row = db.query("PRAGMA integrity_check").get() as Record<string, unknown> | undefined
    const val = Object.values(row ?? {})[0]
    return typeof val === "string" ? val : "unknown"
  } finally {
    db?.close()
  }
}

function probeDb(id: string, label: string, path: string): DoctorProbe {
  if (!existsSync(path)) return result(id, "warn", label, `${path} missing`, "Hermes will create this on first use; if expected, check HERMES_HOME.")
  try {
    const st = statSync(path)
    const r = can(path, constants.R_OK)
    const w = can(path, constants.W_OK)
    if (!st.isFile()) return result(id, "fail", label, `${path} is not a file`, HINT.db)
    if (!r) return result(id, "fail", label, `${path} is not readable`, HINT.db)
    const ok = integrity(path)
    if (ok !== "ok") return result(id, "fail", label, `${path} integrity ${ok}`, HINT.db)
    const perms = w ? "read/write" : "read-only"
    return result(id, w ? "ok" : "warn", label, `${path} · ${perms} · integrity ok`, w ? undefined : HINT.db)
  } catch (e) {
    return result(id, "fail", label, `${path}: ${e instanceof Error ? e.message : String(e)}`, HINT.db)
  }
}

async function probeBun(opts: DoctorOptions, env: Record<string, string | undefined>): Promise<DoctorProbe> {
  const out = await run(["bun", "--version"], opts, env)
  if (!out.ok) return result("bun", "fail", "Bun", clean(out.stderr) || "not found", HINT.bun)
  return result("bun", "ok", "Bun", clean(out.stdout || out.stderr))
}

async function probeOpenTui(opts: DoctorOptions, env: Record<string, string | undefined>): Promise<DoctorProbe> {
  const core = await run(["bun", "pm", "pkg", "get", "dependencies.@opentui/core"], opts, env)
  const react = await run(["bun", "pm", "pkg", "get", "dependencies.@opentui/react"], opts, env)
  if (!core.ok || !react.ok) return result("opentui", "fail", "OpenTUI", "package metadata unavailable", HINT.opentui)
  return result("opentui", "ok", "OpenTUI", `core ${clean(core.stdout)} · react ${clean(react.stdout)}`)
}

function probePlugins(opts: DoctorOptions): DoctorProbe {
  if (!opts.plugins) return result("plugins", "warn", "Plugins", "runtime status not exposed")
  try {
    const statuses = [...opts.plugins()]
    if (!statuses.length) return result("plugins", "ok", "Plugins", "no plugins registered")
    const bad = statuses.filter(p => p.error)
    if (bad.length) return result("plugins", "fail", "Plugins", bad.map(p => `${p.id}: ${p.error}`).join("; "), HINT.plugins)
    const active = statuses.filter(p => p.active).length
    return result("plugins", "ok", "Plugins", `${active}/${statuses.length} active`)
  } catch (e) {
    return result("plugins", "warn", "Plugins", e instanceof Error ? e.message : String(e), HINT.plugins)
  }
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorProbe[]> {
  const env = { ...process.env, ...(opts.env ?? {}) } as Record<string, string | undefined>
  const hermesHome = opts.hermesHome || home(env)
  const db = (name: string) => join(hermesHome, name)
  return [
    await probeAuth(opts, env),
    await probeGateway(opts),
    await probePython(opts, env),
    await probeChafa(opts, env),
    probeDb("state-db", "state.db", db("state.db")),
    probeDb("sessions-db", "sessions.db", db("sessions.db")),
    await probeBun(opts, env),
    await probeOpenTui(opts, env),
    result("herm", "ok", "Herm", `version ${VERSION}`),
    probePlugins(opts),
  ]
}

export function summarize(items: ReadonlyArray<DoctorProbe>): DoctorSummary {
  const sum = { ok: 0, warn: 0, fail: 0, status: "ok" as DoctorStatus }
  for (const item of items) sum[item.status]++
  sum.status = sum.fail ? "fail" : sum.warn ? "warn" : "ok"
  return sum
}

export function formatDoctor(items: ReadonlyArray<DoctorProbe>): string {
  const lines = ["Herm doctor"]
  for (const item of items) {
    const mark = item.status === "ok" ? "ok" : item.status === "warn" ? "warn" : "fail"
    lines.push(`${mark.padEnd(4)} ${item.label}: ${item.details}`)
    if (item.hint) lines.push(`     hint: ${item.hint}`)
  }
  const sum = summarize(items)
  lines.push(`summary: ${sum.ok} ok, ${sum.warn} warn, ${sum.fail} fail`)
  return lines.join("\n")
}

export async function doctorText(opts: DoctorOptions = {}): Promise<string> {
  return formatDoctor(await runDoctor(opts))
}
