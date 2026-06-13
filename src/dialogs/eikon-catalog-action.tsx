import { useState } from "react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import type { CatalogRow, CatalogSizes } from "../service/eikon-catalog"

type Choice = "install" | "source" | "use" | "download" | "delete" | "activation-ask"
type Activation = "ask" | "always" | "never"
type ActivationChoice = "use" | "skip" | "always" | "never"
type Opt = { label: string; hint?: string; value: Choice }

type Props = {
  row: CatalogRow
  sizes?: CatalogSizes
  activation?: Activation
  onPick: (choice: Choice) => void
}

const fmt = (n?: number) => n == null ? "size unknown" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(1)} MiB`

const reset = (activation?: Activation): Opt[] => activation && activation !== "ask"
  ? [{ label: "Ask After Future Installs", hint: `current: ${activation}`, value: "activation-ask" }] : []

const choices = (row: CatalogRow, sizes?: CatalogSizes, activation?: Activation): Opt[] => {
  if (row.installState === "incompatible" || row.installState === "mismatch") return reset(activation)
  if (!row.installed) return [
    { label: "Install", hint: fmt(sizes?.eikon), value: "install" },
    { label: "Install + Source", hint: `${fmt((sizes?.eikon ?? 0) + (sizes?.source ?? 0))} · Source files needed to edit Eikon in Studio`, value: "source" },
    ...reset(activation),
  ]
  return [
    ...(!row.active ? [{ label: "Use", hint: "set as active avatar", value: "use" as const }] : []),
    ...(row.sourceDownloadable ? [{ label: "Download Source", hint: "needed to edit in Studio", value: "download" as const }] : []),
    ...(row.removable ? [{ label: "Delete", value: "delete" as const }] : []),
    ...reset(activation),
  ]
}

const Action = (props: Props) => {
  const theme = useTheme().theme
  const opts = choices(props.row, props.sizes, props.activation)
  const [sel, setSel] = useState(0)
  const desc = opts.some(o => !!o.hint)
  return (
    <box flexDirection="column" width={64}>
      <text fg={theme.text}><strong>{props.row.entry.name}</strong></text>
      <box height={1} />
      <text fg={theme.textMuted} wrapMode="word">{props.row.entry.description ?? "No description."}</text>
      <box height={1} />
      {opts.length > 0 ? (
        <select
          focused={true}
          width={62}
          height={Math.min(12, Math.max(1, opts.length * (desc ? 2 : 1)))}
          options={opts.map(o => ({ name: o.label, description: o.hint ?? "", value: o.value }))}
          selectedIndex={Math.min(sel, opts.length - 1)}
          showDescription={desc}
          showScrollIndicator={opts.length > 6}
          backgroundColor={theme.backgroundPanel}
          focusedBackgroundColor={theme.backgroundPanel}
          textColor={theme.textMuted}
          focusedTextColor={theme.text}
          selectedBackgroundColor={theme.backgroundElement}
          selectedTextColor={theme.text}
          descriptionColor={theme.textMuted}
          selectedDescriptionColor={theme.textMuted}
          keyBindings={[
            { name: "home", action: "move-up-fast" },
            { name: "end", action: "move-down-fast" },
            { name: "return", action: "select-current" },
          ]}
          onChange={i => setSel(i)}
          onSelect={i => {
            const opt = opts[i]
            if (opt) props.onPick(opt.value)
          }}
        />
      ) : (
        <text fg={theme.textMuted}>{props.row.reason ?? "No available actions."}</text>
      )}
      <box height={1} />
      <text fg={theme.textMuted}>[↑↓] move   [Enter] confirm   [Esc] cancel</text>
    </box>
  )
}

export function openEikonCatalogAction(dialog: DialogContext, opts: { row: CatalogRow; sizes?: CatalogSizes; activation?: Activation }): Promise<Choice | null> {
  return new Promise(resolve => {
    const done = (v: Choice | null) => { resolve(v); dialog.clear() }
    dialog.replace(<Action {...opts} onPick={done} />, () => resolve(null))
  })
}


const Activate = (props: { name: string; onPick: (choice: ActivationChoice) => void }) => {
  const theme = useTheme().theme
  const opts: Array<{ name: string; description: string; value: ActivationChoice }> = [
    { name: "Use now", description: "set as active avatar once", value: "use" },
    { name: "Not now", description: "leave active avatar unchanged", value: "skip" },
    { name: "Always use after Catalog install", description: "remember for future Catalog installs", value: "always" },
    { name: "Never use after Catalog install", description: "remember for future Catalog installs", value: "never" },
  ]
  const [sel, setSel] = useState(0)
  return (
    <box flexDirection="column" width={64}>
      <text fg={theme.text}><strong>Use '{props.name}' as active Eikon?</strong></text>
      <box height={1} />
      <select
        focused={true}
        width={62}
        height={8}
        options={opts}
        selectedIndex={sel}
        showDescription={true}
        backgroundColor={theme.backgroundPanel}
        focusedBackgroundColor={theme.backgroundPanel}
        textColor={theme.textMuted}
        focusedTextColor={theme.text}
        selectedBackgroundColor={theme.backgroundElement}
        selectedTextColor={theme.text}
        descriptionColor={theme.textMuted}
        selectedDescriptionColor={theme.textMuted}
        keyBindings={[
          { name: "home", action: "move-up-fast" },
          { name: "end", action: "move-down-fast" },
          { name: "space", action: "select-current" },
          { name: " ", action: "select-current" },
          { name: "return", action: "select-current" },
        ]}
        onChange={i => setSel(i)}
        onSelect={i => {
          const opt = opts[i]
          if (opt) props.onPick(opt.value)
        }}
      />
      <box height={1} />
      <text fg={theme.textMuted}>[↑↓] move   [Space/Enter] confirm   [Esc] not now</text>
    </box>
  )
}

export function openEikonCatalogActivation(dialog: DialogContext, opts: { name: string }): Promise<ActivationChoice | null> {
  return new Promise(resolve => {
    const done = (v: ActivationChoice | null) => { resolve(v); dialog.clear() }
    dialog.replace(<Activate name={opts.name} onPick={done} />, () => resolve(null))
  })
}
