import type { ToolPart } from "../../types/message"
import { sanitize as clean } from "../../utils/sanitize"
import { isDiff } from "./DiffBlock"

const PATH_KEY = /"(?:path|file_path|filename|target|file)"\s*:\s*"((?:\\.|[^"\\])*)"/
const DIFF_HEAD_ARROW = /(?:^|\s)a\/+\S.*?\s*→\s*b\/+(\S.+?)\s*$/m
const DIFF_HEAD_NEW = /^\+\+\+ b?\/+(\S.*?)\s*$/m
const DIFF_HEAD_OLD = /^--- a?\/+(\S.*?)\s*$/m
const HUNK = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/
const STRIPS = [
  /^\s*┊.*$/,
  /^\s*[+-]\d+\s*\/\s*[-+]\d+\s*$/,
  /^\s*…/,
  /a\/+\S.*?\s*→\s*b\/+\S/,
]

export type Hunk = {
  id: string
  header: string
  patch: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  add: number
  del: number
}

export type FileDiff = {
  id: string
  label: string
  path: string
  tool: string
  diff: string
  add: number
  del: number
  hunks: Hunk[]
}

function pathFor(t: ToolPart): string {
  const args = (t as { args?: string }).args
  if (args && /^\s*\{/.test(args)) {
    const m = clean(args).match(PATH_KEY)
    if (m) return m[1]
  }
  const sources = [t.diff, t.preview].filter((s): s is string => !!s)
  for (const s of sources) {
    const m = clean(s).match(DIFF_HEAD_ARROW) || clean(s).match(DIFF_HEAD_NEW) || clean(s).match(DIFF_HEAD_OLD)
    if (m) return m[1]
  }
  return clean(t.preview ?? t.name)
}

function sanitizeDiff(s: string): string {
  return clean(s).split("\n").filter(l => !STRIPS.some(re => re.test(l))).join("\n")
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const parent = (p: string) => {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ""
}
const trunc = (s: string, n: number) => s.length <= n ? s : "…" + s.slice(-(n - 1))

export function hunks(diff: string, tool: string, path: string): Hunk[] {
  const lines = diff.split("\n")
  const idx = lines.flatMap((l, i) => HUNK.test(l) ? [i] : [])
  return idx.map((start, i) => {
    const end = idx[i + 1] ?? lines.length
    const body = lines.slice(start, end)
    const m = body[0].match(HUNK)!
    const patch = body.join("\n")
    const add = body.filter(l => /^\+(?!\+\+)/.test(l)).length
    const del = body.filter(l => /^-(?!--)/.test(l)).length
    return {
      id: `${tool}:${path}:${m[1]}:${m[3]}:${i}`,
      header: body[0],
      patch,
      oldStart: Number(m[1]),
      oldLines: Number(m[2] ?? 1),
      newStart: Number(m[3]),
      newLines: Number(m[4] ?? 1),
      add,
      del,
    }
  })
}

export function files(tools: ToolPart[]): FileDiff[] {
  const raw = tools.flatMap(t => {
    const diff = t.diff ?? (isDiff(t.result) ? t.result : undefined)
    if (!diff) return []
    return [{ tool: t, path: pathFor(t), diff: sanitizeDiff(diff) }]
  })
  const counts = new Map<string, number>()
  raw.forEach(r => counts.set(base(r.path), (counts.get(base(r.path)) ?? 0) + 1))
  return raw.map(r => {
    const b = base(r.path)
    const dup = (counts.get(b) ?? 0) > 1 && parent(r.path)
    const label = trunc(dup ? `${parent(r.path)}/${b}` : b, 24)
    const rows = r.diff.split("\n")
    const add = rows.filter(l => /^\+(?!\+\+)/.test(l)).length
    const del = rows.filter(l => /^-(?!--)/.test(l)).length
    const tool = r.tool.id || `${r.tool.name}-${r.path}`
    return { id: tool, label, path: r.path, tool, diff: r.diff, add, del, hunks: hunks(r.diff, tool, r.path) }
  })
}
