import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { TabShell } from "../ui/shell"
import { HintBar } from "../ui/hint"
import { FilterChip } from "../ui/filter-chip"
import { openConfirm } from "../dialogs/confirm"
import { openEikonCatalogAction, openEikonCatalogActivation } from "../dialogs/eikon-catalog-action"
import { useKeys, handleListKey, useFollow } from "../keys"
import { EikonCardGrid, EikonTitleList, titleWidth, type EikonCard } from "./eikon-panels"
import * as perf from "../utils/perf"
import { AnimatedAvatar } from "../components/avatar/AnimatedAvatar"
import { parseEikon, type ParsedEikon } from "../components/avatar/eikon"
import { eikon } from "../service/eikon"
import * as prefs from "../context/preferences"
import * as cat from "../service/eikon-catalog"
import type { CatalogRow, CatalogState } from "../service/eikon-catalog"
import type { AvatarState } from "../components/avatar/states"

const NO_CATALOG: CatalogState = { status: "empty", query: "", rows: [] }
const DETAIL = 54

type Pane = "grid" | "detail"
type Preview = { eikon: ParsedEikon; state: AvatarState; states: AvatarState[] }

function localCatalog(raw?: string) {
  if (!raw) return false
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    return url.protocol === "file:" || host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".localhost")
  } catch { return false }
}

export const EikonCatalog = memo((props: { focused: boolean }) => {
  const toast = useToast()
  const dialog = useDialog()
  const keys = useKeys()
  const theme = useTheme().theme
  const rev = useSyncExternalStore(eikon.onRevision, eikon.revision)
  const [sel, setSel] = useState(0)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [hide, setHide] = useState(false)
  const pref = prefs.usePref("eikonCatalogInstallActivation")
  const act = pref === "always" || pref === "never" ? pref : "ask"
  const [state, setState] = useState<CatalogState>(NO_CATALOG)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [previewState, setPreviewState] = useState<AvatarState>("idle")
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const [pane, setPane] = useState<Pane>("grid")
  const seq = useRef(0)
  const grid = useFollow("catalog", i => state.rows[i]?.entry.identityKey ?? i)
  const list = useFollow("catalog-list", i => state.rows[i]?.entry.identityKey ?? i)
  const dims = useTerminalDimensions()

  useEffect(() => { if (sel >= state.rows.length) setSel(Math.max(0, state.rows.length - 1)) }, [state.rows.length, sel])

  const selected = state.rows[sel]

  useEffect(() => {
    if (!selected || !state.service) {
      setPreview(undefined)
      return
    }
    const id = ++seq.current
    const key = selected.entry.identityKey
    perf.count("catalog:preview:load")
    state.service.preview(key)
      .then(text => {
        if (seq.current !== id) return
        const e = parseEikon(text)
        const st = e.states.has(previewState) ? previewState : "idle"
        setPreview({ eikon: e, state: st, states: [...e.states.keys()] as AvatarState[] })
        perf.count("catalog:preview:ready")
      })
      .catch(() => {
        if (seq.current !== id) return
        setPreview(undefined)
        perf.count("catalog:preview:error")
      })
  }, [selected, state.service, previewState])

  useEffect(() => () => {
    seq.current++
    setPreview(undefined)
  }, [])

  const loadCatalog = useCallback((q = query) => {
    setLoading(true)
    const end = perf.mark("catalog:list:load")
    const catalog = process.env.EIKON_URL
    void cat.load({ catalog, allowPrivate: localCatalog(catalog), query: q, mode: "ui", hideInstalled: hide })
      .then(next => {
        perf.count("catalog:list:rows", next.rows.length)
        setState(next)
        setSel(p => Math.max(0, Math.min(next.rows.length - 1, p)))
      })
      .finally(() => { end(); setLoading(false) })
  }, [query, hide])

  const refreshCatalog = useCallback((svc: cat.CatalogService, q = query) => {
    const rows = svc.rows(q, { mode: "ui", hideInstalled: hide })
    setState({ status: rows.length > 0 ? "ready" : "empty", query: q, rows, selected: rows[0], service: svc })
    setSel(p => Math.max(0, Math.min(rows.length - 1, p)))
  }, [query, hide])

  useEffect(() => { loadCatalog(query) }, [query, rev, loadCatalog])

  const cycle = useCallback((by: number) => {
    const states = preview?.states
    const cur = preview?.state
    if (!states?.length || !cur) return
    const at = Math.max(0, states.indexOf(cur))
    setPreviewState(states[(at + by + states.length) % states.length]!)
  }, [preview])

  const activate = useCallback(async (name: string) => {
    if (prefs.get("eikon") === name) return
    if (act === "always") {
      eikon.useInstalled(name)
      toast.show({ variant: "success", message: `Avatar → ${name}` })
      return
    }
    if (act === "never") return
    const pick = await openEikonCatalogActivation(dialog, { name })
    if (!pick) return
    if (pick === "always" || pick === "never") prefs.set("eikonCatalogInstallActivation", pick)
    if (pick === "use" || pick === "always") {
      eikon.useInstalled(name)
      toast.show({ variant: "success", message: `Avatar → ${name}` })
    }
  }, [act, dialog, toast])

  const primary = useCallback((idx?: number) => {
    const row = state.rows[idx ?? sel]
    const svc = state.service
    if (!row || !svc || installing) return
    const run = async () => {
      const sizes = !row.installed ? await svc.packageSizes(row.entry.identityKey).catch(() => undefined) : undefined
      const pick = await openEikonCatalogAction(dialog, { row, sizes, activation: act })
      if (!pick) return
      if (pick === "use") {
        const name = row.installedName ?? row.entry.name
        eikon.useInstalled(name)
        toast.show({ variant: "success", message: `Avatar → ${name}` })
        refreshCatalog(svc, query)
        return
      }
      if (pick === "delete") return removeSelected(idx)
      if (pick === "activation-ask") {
        prefs.set("eikonCatalogInstallActivation", "ask")
        toast.show({ variant: "info", message: "Catalog installs will ask before activating" })
        return
      }
      setInstalling(true)
      try {
        const confirm = row.installState === "active-name-conflict"
          ? await openConfirm(dialog, {
              title: `Replace active '${row.entry.name}'?`, danger: true,
              body: `Installing this catalog package will replace the active avatar's backing package for '${row.entry.name}' because another package with the same installed name is active.`,
              yes: "replace active", no: "cancel",
            })
          : true
        if (!confirm) return
        const out = pick === "download" ? await svc.downloadSource(row.entry.identityKey) : await svc.install(row.entry.identityKey, { media: pick === "source", confirmActive: row.installState === "active-name-conflict" })
        toast.show({ variant: "success", message: pick === "download" ? `Downloaded source for '${out.name}'` : `Installed '${out.name}' (${out.n} files)` })
        if (pick !== "download") await activate(out.name)
        refreshCatalog(svc, query)
      } catch (err) {
        toast.show({ variant: "error", title: pick === "download" ? "Source download failed" : "Install failed", message: err instanceof Error ? err.message : String(err), duration: 6000 })
        refreshCatalog(svc, query)
      } finally {
        setInstalling(false)
      }
    }
    void run()
  }, [act, activate, dialog, state.rows, state.service, sel, installing, toast, refreshCatalog, query])

  const removeSelected = useCallback(async (idx?: number) => {
    const row = state.rows[idx ?? sel]
    const svc = state.service
    const name = row?.installedName ?? row?.entry.name
    if (!row || !svc || !name || !row.removable) return toast.show({ variant: "warning", message: "This eikon is not removable" })
    const active = row.active
    const ok = await openConfirm(dialog, {
      title: `Remove '${name}'?`, danger: true,
      body: active
        ? `Remove the local package for '${name}'. This is the active avatar; removal will clear the active avatar selection.`
        : `Remove the local package for '${name}'. This does not change the active avatar.`,
      yes: "remove", no: "cancel",
    })
    if (!ok) return
    const out = eikon.remove(name, { confirmActive: active })
    if (out) return toast.show({ variant: "warning", message: out.message })
    toast.show({ variant: "info", message: `Removed '${name}'` })
    refreshCatalog(svc, query)
  }, [dialog, query, refreshCatalog, sel, state.rows, state.service, toast])

  useKeyboard(key => {
    if (!props.focused || dialog.open()) return
    if (searching) {
      if (key.name === "escape" || key.name === "esc") { setSearching(false); return }
      if (key.name === "backspace") { setQuery(q => q.slice(0, -1)); setSel(0); return }
      const raw = key.raw && key.raw.length === 1 ? key.raw : ""
      const str = typeof key.sequence === "string" && key.sequence.length === 1 ? key.sequence : ""
      const ch = raw || str || (key.name.length === 1 && !key.ctrl && !key.meta ? key.name : "")
      if (ch >= " ") { setQuery(q => q + ch); setSel(0); return }
      return
    }
    const plain = !key.shift && !key.ctrl && !key.meta
    if (key.name === "tab") return setPane(p => p === "grid" ? "detail" : "grid")
    if (pane === "detail") {
      if (key.name === "escape" || (plain && key.name === "left")) { setPane("grid"); return }
      if (plain && key.name === "right") { cycle(1); return }
      if (keys.match("list.activate", key)) { primary(); return }
      if (keys.match("list.toggle", key)) { cycle(1); return }
      if (keys.match("list.search", key)) { setPane("grid"); setSearching(true); return }
      if (keys.match("list.refresh", key)) { loadCatalog(query); return }
      return
    }
    const move = (by: number) => setSel(p => {
      const n = Math.max(0, Math.min(state.rows.length - 1, p + by))
      grid.opts.scrollTo?.(n)
      list.opts.scrollTo?.(n)
      return n
    })
    if (plain && key.name === "left") { move(-1); return }
    if (plain && key.name === "right") { move(1); return }
    if (plain && key.name === "up") { move(-1); return }
    if (plain && key.name === "down") { move(1); return }
    if (plain && key.name === "h") { setHide(v => !v); return }
    if (handleListKey(keys, key, {
      count: state.rows.length, setSel, page: list.opts.page,
      scrollTo: n => { grid.opts.scrollTo?.(n); list.opts.scrollTo?.(n) },
      onActivate: primary,
      onToggle: () => cycle(1),
      onSearch: () => setSearching(true),
      onRefresh: () => loadCatalog(query),
      onDelete: () => void removeSelected(),
    })) return
  })

  perf.count("catalog:render")
  const titles = state.rows.map(r => ({ key: r.entry.identityKey, name: r.entry.name, active: r.active }))
  const cards: EikonCard[] = state.rows.map(r => ({
    key: r.entry.identityKey,
    name: r.entry.name,
    active: r.active,
    author: r.entry.author,
    status: stateLabel(r, true),
    lines: posterLines(r.entry.poster),
  }))
  const listW = titleWidth(`Catalog (${state.rows.length})`, titles)
  const showGrid = dims.width >= 190

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <box flexDirection="row" flexGrow={1} minWidth={0} minHeight={0}>
        <box flexDirection="column" width={listW} flexShrink={0} minHeight={0}>
          <box height={1} flexShrink={0} flexDirection="row">
            <FilterChip label="hide installed" state={hide ? "in" : "off"} gap={0}
              color={theme.primary} textColor={theme.textMuted}
              onMouseDown={() => setHide(v => !v)} />
          </box>
          <EikonTitleList title={`Catalog (${state.rows.length})${searching ? ` Search: ${query}` : ""}`}
            rows={titles} sel={sel} focus={props.focused && pane === "grid"} follow={list} width={listW}
            onSel={setSel} onUse={primary} />
        </box>
        {showGrid ? (
          <TabShell title="Posters" grow={1}>
            {state.error
              ? <box padding={1}><text fg={theme.error} wrapMode="word">Catalog unavailable: {state.error}</text></box>
              : loading && state.rows.length === 0
                ? <box padding={1}><text fg={theme.textMuted}>Loading shared eikons…</text></box>
                : <EikonCardGrid rows={cards} sel={sel} follow={grid}
                    empty={<text fg={theme.textMuted}>No catalog eikons match. Press / to change search.</text>}
                    onSel={setSel} onUse={primary} />}
          </TabShell>
        ) : null}
        <box width={DETAIL} flexShrink={0} minHeight={0}>
          <TabShell title={selected ? `Details — ${selected.entry.name}` : "Details"} focus={props.focused && pane === "detail"} grow={1}>
            <CatalogDetail row={selected} loading={loading} installing={installing} onFocus={() => setPane("detail")}
              onState={setPreviewState} preview={preview} />
          </TabShell>
        </box>
      </box>
      <HintBar pairs={searching ? [
        [keys.print("list.search"), "typing search"], ["Esc", "finish search"], ["Backspace", "delete"],
      ] : [
        ["Tab", pane === "grid" ? "details" : "catalog"], [keys.print("list.activate"), "actions"],
        [pane === "detail" ? "→/Space" : "↑↓←→/Pg", pane === "detail" ? "state" : "select"],
        [keys.print("list.search"), "search"], ["h", hide ? "show installed" : "hide installed"],
        [keys.print("list.refresh"), "reload"], ["d", "delete in modal"], ["Space", "preview"],
      ]} />
    </box>
  )
})

const posterLines = (poster?: string) => {
  const lines = poster ? poster.split("\n") : []
  return lines.length ? lines : ["(no poster)"]
}

const CatalogDetail = (props: {
  row?: CatalogRow
  loading: boolean
  installing: boolean
  onFocus: () => void
  onState: (state: AvatarState) => void
  preview?: Preview
}) => {
  const theme = useTheme().theme
  const r = props.row
  if (!r) return <box padding={1}><text fg={theme.textMuted}>{props.loading ? "Loading shared eikons…" : "No catalog entry selected."}</text></box>
  const previewState = props.preview?.state ?? "idle"
  const states = props.preview?.states ?? [previewState]
  return (
    <box flexDirection="column" padding={1} onMouseDown={props.onFocus}>
      {props.preview ? (
        <box alignItems="center" justifyContent="center" width={48} height={24} flexShrink={0} overflow="hidden">
          <AnimatedAvatar key={`${r.entry.identityKey}:${props.preview.state}`} state={props.preview.state} eikon={props.preview.eikon} />
        </box>
      ) : null}
      <box height={1} overflow="hidden"><text fg={r.active ? theme.accent : theme.text} wrapMode="none"><strong>{r.active ? "● " : ""}{r.entry.name}</strong></text></box>
      <box height={1} overflow="hidden"><text fg={theme.textMuted} wrapMode="none">by {r.entry.author ?? "unknown"}</text></box>
      <box minHeight={1}><text fg={theme.text} wrapMode="word">{r.entry.description ?? "No description."}</text></box>
      <box flexDirection="row" flexWrap="wrap" flexShrink={0}>
        {states.map((s, i) => (
          <FilterChip key={s} label={s} state={s === previewState ? "in" : "off"}
            gap={i === 0 ? 0 : 1} color={theme.primary} textColor={theme.textMuted}
            onMouseDown={() => props.onState(s)} />
        ))}
      </box>
      <DetailRow label="Status" value={previewStatus(r)} block />
      <DetailRow label="Trust" value={trustLabel(r)} block />
      <DetailRow label="Source" value={sourceText(r)} block />
      <DetailRow label="Compat" value={compatText(r)} />
      <DetailRow label="Digest" value={digest(r) ?? "unknown"} block />
    </box>
  )
}

const DetailRow = (props: { label: string; value: string; block?: boolean }) => {
  const theme = useTheme().theme
  if (props.block) return (
    <box flexDirection="column" minHeight={props.label === "Status" ? 2 : 1}>
      <text fg={theme.textMuted} wrapMode="word">{props.label}: {props.value}</text>
    </box>
  )
  return <box height={1} overflow="hidden"><text fg={theme.textMuted} wrapMode="none">{props.label}: {props.value}</text></box>
}

const shortDigest = (value?: string) => {
  if (!value) return undefined
  const [algo, hash] = value.includes(":") ? value.split(":", 2) : [undefined, value]
  if (!hash || hash.length <= 16) return value
  return algo ? `${algo}:${hash.slice(0, 12)}…` : `${hash.slice(0, 12)}…`
}

const digest = (row: CatalogRow) => {
  const t = row.entry.trust as { manifestDigest?: string; runtimeDigest?: string; digest?: string }
  return shortDigest(t.manifestDigest ?? t.runtimeDigest ?? t.digest)
}

const trustLabel = (row: CatalogRow) => {
  const t = row.trust === "mismatch" ? "Mismatch" : row.trust === "verified" ? "Verified" : row.trust === "unverified" ? "Unverified" : "Trust unknown"
  return row.reason && row.trust === "mismatch" ? `${t}: ${row.reason}` : t
}

const sourceText = (row: CatalogRow) => row.sourceIdentity ?? row.lifecycle.source.packageUrl ?? row.entry.sourceKey ?? row.entry.packageUrl

const compatText = (row: CatalogRow) => row.installState === "incompatible"
  ? `Blocked: ${row.reason ?? "requires newer Herm/eikon"}`
  : row.installState === "active-name-conflict" ? `Requires confirmation: ${row.reason}` : "Compatible"

const baseLabel = (row: CatalogRow) => row.installState === "active-name-conflict" ? "active name conflict" : row.active ? "active" : row.installed ? "installed" : "not installed"

const previewStatus = (row: CatalogRow) => {
  const src = row.sourcePresent ? " · source present" : row.sourceDownloadable ? " · source downloadable" : row.sourceAvailable ? " · source available" : ""
  const rm = row.removable ? " · removable" : row.installed ? " · not removable" : ""
  return `${baseLabel(row)}${src}${rm}`
}

const stateLabel = (row: CatalogRow, short = false) => {
  const base = baseLabel(row)
  if (short) return base
  return previewStatus(row)
}
