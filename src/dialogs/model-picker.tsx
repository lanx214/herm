// Pick provider → model. Default scope is the *current session* (the
// gateway applies the switch to the live agent when `session_id` is
// passed); Tab toggles to global persist. The gateway's `config.set`
// accepts a single space-separated arg string with `--provider` /
// `--global` flags (same grammar as the `/model` slash command) and
// routes through `_apply_model_switch`, so we send one request rather
// than a provider/model pair.

import { useEffect, useState, useCallback } from "react"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type SelectOption } from "../ui/dialog-select"
import { useTheme } from "../theme"
import { useToast } from "../ui/toast"
import type { Gateway } from "../context/gateway"
import type { ConfigSetResponse, ModelOptionsResponse } from "../context/wire"

type Step = "provider" | "member" | "model"

type Provider = NonNullable<ModelOptionsResponse["providers"]>[number]

type ProviderGroup = NonNullable<ModelOptionsResponse["groups"]>[number]

type ProviderRow =
  | { readonly kind: "provider"; readonly provider: Provider }
  | { readonly kind: "group"; readonly group: ProviderGroup; readonly members: Provider[] }

const slugMap = (groups: readonly ProviderGroup[] = []) =>
  new Map(groups.flatMap(g => g.members.map(m => [m, g] as const)))

const groupRows = (providers: readonly Provider[], groups: readonly ProviderGroup[] = []): ProviderRow[] => {
  const bySlug = new Map(providers.map(p => [p.slug, p] as const))
  const byGroup = new Map(groups.map(g => [g.id, g] as const))
  const byMember = slugMap(groups)
  const emitted = new Set<string>()
  const rows: ProviderRow[] = []
  for (const p of providers) {
    const group = byMember.get(p.slug)
    if (!group) { rows.push({ kind: "provider", provider: p }); continue }
    if (emitted.has(group.id)) continue
    emitted.add(group.id)
    const members = group.members.flatMap(slug => {
      const member = bySlug.get(slug)
      return member ? [member] : []
    })
    if (members.length <= 1) { rows.push({ kind: "provider", provider: members[0] ?? p }); continue }
    rows.push({ kind: "group", group: byGroup.get(group.id) ?? group, members })
  }
  return rows
}

const currentInRow = (row: ProviderRow, current?: string) => row.kind === "provider"
  ? Boolean(row.provider.is_current || row.provider.slug === current)
  : row.members.some(p => p.is_current || p.slug === current)

const rowModels = (row: ProviderRow) => row.kind === "provider"
  ? row.provider.total_models
  : row.members.reduce((sum, p) => sum + (p.total_models ?? p.models?.length ?? 0), 0)

const rowDesc = (row: ProviderRow) => {
  const count = rowModels(row)
  if (row.kind === "provider") return count ? `${count} models` : undefined
  return [row.group.description, count ? `${count} models` : ""].filter(Boolean).join(" · ") || undefined
}

const rowSearch = (row: ProviderRow) => row.kind === "group"
  ? [row.group.description, ...row.members.flatMap(p => [p.name, p.slug])].filter(Boolean).join(" ")
  : row.provider.slug

type Props = {
  gw: Gateway
  /** Override the default "switch this session / global" apply. When
   *  set, the scope toggle is hidden and the caller owns the write. */
  onApply?: (provider: string, model: string) => Promise<void>
  title?: string
}

const ModelPickerDialog = (props: Props) => {
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().theme
  const [data, setData] = useState<ModelOptionsResponse | null>(null)
  const [step, setStep] = useState<Step>("provider")
  const [group, setGroup] = useState<string | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [global, setGlobal] = useState(false)

  useEffect(() => {
    props.gw.request<ModelOptionsResponse>("model.options")
      .then(setData)
      .catch(() => setData({ providers: [] }))
  }, [props.gw])

  const apply = useCallback((model: string, prov: string) => {
    if (props.onApply) return void props.onApply(prov, model)
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
    const value = `${model} --provider ${prov}${global ? " --global" : ""}`
    props.gw.request<ConfigSetResponse>("config.set", global
      ? { key: "model", value, session_id: undefined }
      : { key: "model", value })
      .then(r => {
        toast.show({ variant: "success", message: `model → ${r.value ?? model}${global ? " (global)" : ""}` })
        if (r.warning) toast.show({ variant: "warning", message: r.warning })
      })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
  }, [props.gw, props.onApply, global, toast])

  const onKey = useCallback((k: { name: string }) => {
    if (k.name === "tab" && !props.onApply) { setGlobal(g => !g); return true }
    if (k.name === "left" && step === "model") {
      const g = provider ? slugMap(data?.groups ?? []).get(provider) : undefined
      setStep(g && group === g.id ? "member" : "provider")
      return true
    }
    if (k.name === "left" && step === "member") { setStep("provider"); return true }
    return false
  }, [step, props.onApply, provider, group, data?.groups])

  const backHint = step === "model"
    ? "←: " + (provider && slugMap(data?.groups ?? []).get(provider)?.id === group ? "members" : "providers")
    : step === "member" ? "←: providers" : ""
  const footer = props.onApply
    ? <text fg={theme.textMuted}>{backHint || " "}</text>
    : (
      <text fg={theme.textMuted}>
        <span>Scope: </span>
        <span fg={global ? theme.warning : theme.accent}>
          {global ? "global (persists to config)" : "this session"}
        </span>
        <span>{` · Tab: toggle${backHint ? ` · ${backHint}` : ""}`}</span>
      </text>
    )

  if (!data) return <box width={50} padding={1}><text>Loading models…</text></box>

  const groups = data.groups ?? []

  if (step === "provider") {
    const rows = groupRows(data.providers ?? [], groups)
      .toSorted((a, b) => Number(currentInRow(b, data.provider)) - Number(currentInRow(a, data.provider)))
    const current = rows.find(row => currentInRow(row, data.provider))
    const currentValue = current?.kind === "group" ? `group:${current.group.id}` : data.provider
    const options: SelectOption[] = rows.map(row => ({
      title: row.kind === "group" ? row.group.title : row.provider.name,
      value: row.kind === "group" ? `group:${row.group.id}` : row.provider.slug,
      description: rowDesc(row),
      search: rowSearch(row),
      hint: row.kind === "group" ? "›" : undefined,
      category: currentInRow(row, data.provider) ? "Current" : "Available",
    }))
    return (
      <DialogSelect
        title={props.title ?? "Switch Provider"}
        options={options}
        current={currentValue}
        onSelect={(o) => {
          if (!o.value.startsWith("group:")) { setProvider(o.value); setStep("model"); return }
          setGroup(o.value.slice("group:".length))
          setStep("member")
        }}
        onKey={onKey}
        placeholder="Search providers..."
        footer={footer}
      />
    )
  }

  if (step === "member") {
    const g = groups.find(x => x.id === group)
    const providers = data.providers ?? []
    const options: SelectOption[] = (g?.members ?? [])
      .flatMap(slug => {
        const p = providers.find(pp => pp.slug === slug)
        return p ? [p] : []
      })
      .map(p => ({
        title: p.name,
        value: p.slug,
        description: p.total_models ? `${p.total_models} models` : undefined,
        search: p.slug,
        category: p.is_current ? "Current" : "Available",
      }))
    return (
      <DialogSelect
        title={props.title ? `${props.title} · ${g?.title ?? group}` : `Switch Provider (${g?.title ?? group})`}
        options={options}
        current={data.provider}
        onSelect={(o) => { setProvider(o.value); setStep("model") }}
        onKey={onKey}
        placeholder="Search providers..."
        footer={footer}
      />
    )
  }

  const p = data.providers?.find(pp => pp.slug === provider)
  const options: SelectOption[] = (p?.models ?? []).map(m => ({
    title: m,
    value: m,
  }))

  return (
    <DialogSelect
      title={props.title ? `${props.title} · ${p?.name ?? provider}` : `Switch Model (${p?.name ?? provider})`}
      options={options}
      current={provider === data.provider ? data.model : undefined}
      onSelect={(o) => {
        if (provider) apply(o.value, provider)
        dialog.clear()
      }}
      onKey={onKey}
      placeholder="Search models..."
      footer={footer}
    />
  )
}

export const openModelPicker = (
  dialog: ReturnType<typeof useDialog>, gw: Gateway,
  opts?: { title?: string; onApply?: (provider: string, model: string) => Promise<void> },
) => {
  dialog.replace(<ModelPickerDialog gw={gw} title={opts?.title} onApply={opts?.onApply} />)
}
