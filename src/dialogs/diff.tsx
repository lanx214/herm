import { useEffect, useMemo, useRef, useState } from "react"
import type { MouseEvent, ParsedKey, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import type { DialogContext } from "../ui/dialog"
import { useTheme } from "../theme"
import type { FileDiff, Hunk } from "../components/chat/diff-model"
import { DiffBlock } from "../components/chat/DiffBlock"

const same = (key: ParsedKey, a: string, b: string) => key.name === a || key.name === b

type Decision = "accepted" | "rejected"
type State = Record<string, Decision | "pending" | "error">

type Props = {
  files: FileDiff[]
  at: number
  dialog: DialogContext
}

function oldRows(h: Hunk) {
  return h.patch.split("\n").slice(1).filter(l => !l.startsWith("+")).map(l => l.startsWith("-") ? l.slice(1) : l.startsWith(" ") ? l.slice(1) : l)
}

function newRows(h: Hunk) {
  return h.patch.split("\n").slice(1).filter(l => !l.startsWith("-")).map(l => l.startsWith("+") ? l.slice(1) : l.startsWith(" ") ? l.slice(1) : l)
}

const chip = (d?: State[string]) =>
  d === "accepted" ? "accepted"
  : d === "rejected" ? "rejected"
  : d === "pending" ? "pending"
  : d === "error" ? "error"
  : "pending"

const Pane = ({ title, rows, sign }: { title: string; rows: string[]; sign: "-" | "+" }) => {
  const theme = useTheme().theme
  const fg = sign === "+" ? theme.success : theme.error
  return (
    <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0} height="100%" border borderStyle="single" borderColor={theme.border} paddingX={1}>
      <box height={1}><text fg={theme.textMuted}>{title}</text></box>
      <box height={1} />
      {rows.length ? rows.map((l, i) => (
        <box key={i} height={1} overflow="hidden" minWidth={0}>
          <text><span fg={fg}>{sign}</span><span fg={theme.text}>{l || " "}</span></text>
        </box>
      )) : (
        <box height={1}><text fg={theme.textMuted}>∅</text></box>
      )}
    </box>
  )
}

const HunkView = ({ h, on, state, action }: { h: Hunk; on: boolean; state?: State[string]; action: (kind: Decision) => void }) => {
  const theme = useTheme().theme
  const border = on ? theme.primary : theme.border
  const muted = state === "accepted" ? theme.success : state === "rejected" ? theme.error : state === "error" ? theme.warning : theme.textMuted
  return (
    <box flexDirection="column" id={`diff-hunk-${h.id}`} border borderStyle="single" borderColor={border} marginBottom={1} paddingX={1} paddingY={1}>
      <box height={1} flexDirection="row">
        <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
          <text><span fg={theme.accent}>{on ? "▸ " : "  "}</span><span fg={theme.textMuted}>{h.header}</span></text>
        </box>
        <box height={1} paddingX={1} backgroundColor={state === "accepted" ? theme.success : undefined}
             onMouseDown={(e: MouseEvent) => { e.stopPropagation(); action("accepted") }}>
          <text fg={state === "accepted" ? theme.background : theme.textMuted}>a accept</text>
        </box>
        <box width={1} />
        <box height={1} paddingX={1} backgroundColor={state === "rejected" ? theme.error : undefined}
             onMouseDown={(e: MouseEvent) => { e.stopPropagation(); action("rejected") }}>
          <text fg={state === "rejected" ? theme.background : theme.textMuted}>r reject</text>
        </box>
      </box>
      <box height={1}><text fg={muted}>{chip(state)} · +{h.add} / -{h.del}</text></box>
      <box flexDirection="row" gap={1} minHeight={3}>
        <Pane title={`old ${h.oldStart},${h.oldLines}`} rows={oldRows(h)} sign="-" />
        <Pane title={`new ${h.newStart},${h.newLines}`} rows={newRows(h)} sign="+" />
      </box>
    </box>
  )
}

const DiffDialog = (props: Props) => {
  const theme = useTheme().theme
  const [file, setFile] = useState(Math.min(props.at, props.files.length - 1))
  const [sel, setSel] = useState(0)
  const [state, setState] = useState<State>({})
  const cur = props.files[file]
  const hs = cur?.hunks ?? []
  const box = useRef<ScrollBoxRenderable | null>(null)
  const hunk = hs[Math.min(sel, Math.max(0, hs.length - 1))]

  useEffect(() => {
    if (hunk) box.current?.scrollChildIntoView(`diff-hunk-${hunk.id}`)
  }, [hunk])

  const act = (h: Hunk | undefined, kind: Decision) => {
    if (!h || state[h.id] === "pending") return
    setState(s => ({ ...s, [h.id]: kind }))
  }

  useKeyboard((key) => {
    if (props.dialog.stack.length === 0 && !props.dialog.open()) return
    if (same(key, "left", "h")) { setFile(i => Math.max(0, i - 1)); setSel(0); return }
    if (same(key, "right", "l")) { setFile(i => Math.min(props.files.length - 1, i + 1)); setSel(0); return }
    if (same(key, "up", "k")) { setSel(i => Math.max(0, i - 1)); return }
    if (same(key, "down", "j")) { setSel(i => Math.min(hs.length - 1, i + 1)); return }
    if (key.name === "a") return act(hunk, "accepted")
    if (key.name === "r") return act(hunk, "rejected")
  })

  if (!cur) return <box width={60} height={3}><text fg={theme.textMuted}>No diff data.</text></box>

  return (
    <box flexDirection="column" width={120} height={34}>
      <box height={1}><text><span fg={theme.primary}><strong>Diff</strong></span><span fg={theme.textMuted}>{` · ${file + 1}/${props.files.length} files · ${hs.length} hunks`}</span></text></box>
      <box height={1} flexDirection="row" flexWrap="wrap">
        {props.files.map((f, i) => (
          <box key={f.id} height={1} paddingX={1} marginRight={1} backgroundColor={i === file ? theme.backgroundElement : undefined}
               onMouseDown={(e: MouseEvent) => { e.stopPropagation(); setFile(i); setSel(0) }}>
            <text fg={i === file ? theme.primary : theme.textMuted}>{f.label}</text>
          </box>
        ))}
      </box>
      <box height={1}><text><span fg={theme.success}>+{cur.add}</span><span fg={theme.textMuted}> / </span><span fg={theme.error}>-{cur.del}</span><span fg={theme.textMuted}>{`  ${cur.path}`}</span></text></box>
      <box height={1} />
      <scrollbox ref={box} scrollY flexGrow={1} contentOptions={{ flexDirection: "column" }}>
        <box flexDirection="column" width="100%">
          {hs.length ? hs.map((h, i) => <HunkView key={h.id} h={h} on={i === sel} state={state[h.id]} action={kind => act(h, kind)} />) : <DiffBlock text={cur.diff} />}
        </box>
      </scrollbox>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>←/→ file · ↑/↓ hunk · a accept · r reject · Esc close</text></box>
    </box>
  )
}

export const openDiff = (dialog: DialogContext, files: FileDiff[], at = 0) =>
  dialog.replace(<DiffDialog files={files} at={at} dialog={dialog} />)
