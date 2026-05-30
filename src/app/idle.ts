import { StdinParser } from "@opentui/core"

type Renderer = {
  suspend: () => void
  resume: () => void
  addInputHandler?: (fn: (seq: string) => boolean) => void
  prependInputHandler?: (fn: (seq: string) => boolean) => void
  removeInputHandler?: (fn: (seq: string) => boolean) => void
  currentControlState?: string
  isDestroyed?: boolean
}

type Opts = { ms?: number }

export class Idle {
  private renderer: Renderer
  private ms: number
  private parser = new StdinParser({ armTimeouts: false })
  private input = (seq: string) => this.handle(seq)
  private timer?: Timer
  private suspended = false
  private stopping = false
  private listening = false

  constructor(renderer: Renderer, opts: Opts = {}) {
    this.renderer = renderer
    this.ms = opts.ms ?? 15_000
  }

  start() {
    if (this.stopping) return
    if (!this.listening) {
      if (this.renderer.prependInputHandler) this.renderer.prependInputHandler(this.input)
      else this.renderer.addInputHandler?.(this.input)
      this.listening = true
    }
    this.arm()
  }

  activity() {
    if (this.stopping) return
    if (this.suspended) this.resume()
    this.arm()
  }

  stop() {
    this.stopping = true
    this.clear()
    this.unlisten()
    if (this.suspended) this.resume()
  }

  shutdown() {
    this.stopping = true
    this.clear()
    this.unlisten()
  }

  private handle(seq: string) {
    const active = this.events(seq)
    if (active) this.activity()
    return false
  }

  private events(seq: string) {
    let active = false
    this.parser.push(Buffer.from(seq))
    this.parser.drain(ev => {
      if (ev.type === "key" || ev.type === "mouse" || ev.type === "paste") active = true
    })
    return active
  }

  private arm() {
    this.clear()
    this.timer = setTimeout(() => this.suspend(), this.ms)
  }

  private suspend() {
    this.timer = undefined
    if (this.stopping || this.suspended || this.renderer.isDestroyed) return
    if (this.renderer.currentControlState !== "auto_started"
      && this.renderer.currentControlState !== "explicit_started") return
    this.renderer.suspend()
    this.suspended = true
  }

  private resume() {
    if (!this.suspended || this.renderer.isDestroyed) return
    this.renderer.resume()
    this.suspended = false
  }

  private clear() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private unlisten() {
    if (!this.listening) return
    this.renderer.removeInputHandler?.(this.input)
    this.listening = false
  }
}
