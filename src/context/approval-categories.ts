// Herm approval 审批卡片类型映射表原型
// pattern_key（后端英文描述）→ 中文类型标签 + 风险等级 + 默认建议
// 用法：herm PromptCard 拿到 req.pattern_keys 后，逐 key 查此表，
//       命中则显示中文标签，未命中 fallback 显示原始英文 + "其他"

export type RiskLevel = "low" | "medium" | "high" | "critical"

export interface ApprovalCategory {
  icon: string        // emoji 标签
  zh: string          // 中文类型名（大字标题）
  risk: RiskLevel     // 风险等级
  advice: string      // 默认建议（一行，人话）
  keys: string[]      // 匹配的后端 pattern_key（可含子串匹配）
  hardline?: boolean  // hardline：无条件阻止，不会弹窗（仅展示用）
}

export const APPROVAL_CATEGORIES: ApprovalCategory[] = [
  {
    icon: "🗑️",
    zh: "删除文件/目录",
    risk: "high",
    advice: "先看删的是什么路径：临时文件/构建产物可放行；个人目录、项目源码要慎重",
    keys: [
      "delete in root path",
      "recursive delete",
      "Windows cmd destructive delete",
      "Windows PowerShell destructive delete",
      "find -delete",
      "find -exec",
      "xargs with rm",
      "git clean with force",
      "git branch force delete",
    ],
  },
  {
    icon: "📜",
    zh: "执行脚本/代码",
    risk: "medium",
    advice: "看脚本做了什么：读数据/计算可放行；有删改文件、网络请求的要看内容",
    keys: [
      "script execution via -e/-c flag",
      "script execution via heredoc",
      "shell execution via heredoc",
      "shell command via -c",
      "arbitrary program execution via",
      "PowerShell encoded command execution",
      "chmod +x followed by immediate execution",
    ],
  },
  {
    icon: "🌐",
    zh: "下载并执行远程内容",
    risk: "critical",
    advice: "高危：把互联网内容直接喂给 shell。除非明确知道来源，否则默认拒绝",
    keys: [
      "pipe remote content to shell",
      "execute remote script via process substitution",
      "execute remote content via command substitution",
      "pipe decoded content to shell",
      "pipe xxd-decoded content to shell",
      "pipe tr-transformed output to shell",
      "pipe openssl-decoded content to shell",
    ],
  },
  {
    icon: "⚙️",
    zh: "修改系统配置/敏感文件",
    risk: "high",
    advice: "动的是 ~/.ssh、shell rc、.env、config.yaml 这类文件。先看改了哪个文件",
    keys: [
      "overwrite system config",
      "overwrite system file via tee",
      "overwrite system file via redirection",
      "overwrite project env/config",
      "copy/move file into system config path",
      "copy/move file into sensitive credential",
      "in-place edit of sensitive credential",
      "in-place edit of system config",
      "in-place edit of Hermes config/env",
      "world/other-writable permissions",
      "recursive world/other-writable",
      "recursive chown to root",
    ],
  },
  {
    icon: "🔐",
    zh: "提权/系统级控制",
    risk: "critical",
    advice: "sudo 提权、格式化磁盘、关机重启。除非明确意图，否则默认拒绝",
    keys: [
      "sudo with privilege flag",
      "sudo with combined-flag",
      "stop/restart system service",
      "format filesystem",
      "write to block device",
      "disk copy",
      "kill all processes",
      "force kill processes",
      "kill processes by regex",
      "kill process via pgrep/pidof",
      "kill process via backtick pgrep/pidof",
      "fork bomb",
      "system shutdown/reboot",
    ],
  },
  {
    icon: "🐳",
    zh: "Docker/容器操作",
    risk: "medium",
    advice: "容器生命周期操作（重启/停止/删除）。看操作对象是测试容器还是生产服务",
    keys: [
      "docker with remote daemon redirect",
      "docker with daemon redirect",
      "docker context use",
      "podman with remote daemon redirect",
      "podman remote mode",
      "docker/podman daemon redirect via environment",
      "docker compose restart/stop/kill/down",
      "docker restart/stop/kill",
    ],
  },
  {
    icon: "🛡️",
    zh: "Hermes 自身进程/配置",
    risk: "high",
    advice: "动 Hermes 自己的网关/进程/升级。通常 agent 不应该自己干这个",
    keys: [
      "stop/restart hermes gateway",
      "hermes update",
      "start gateway outside systemd",
      "kill hermes/gateway process",
      "kill process via pgrep/pidof",
      "stop/restart hermes launchd service",
    ],
  },
  {
    icon: "🗄️",
    zh: "数据库破坏性操作",
    risk: "high",
    advice: "SQL DROP / DELETE 不带 WHERE / TRUNCATE。先确认是哪张表、有没有备份",
    keys: [
      "SQL DROP",
      "SQL DELETE without WHERE",
      "SQL TRUNCATE",
    ],
  },
  {
    icon: "🔀",
    zh: "Git 历史重写",
    risk: "high",
    advice: "reset --hard / force push / 强删分支会丢工作或改写远端历史",
    keys: [
      "git reset --hard",
      "git force push",
      "git branch force delete",
    ],
  },
]

// 特殊入口（非正则命令模式）
export const SPECIAL_KEYS: Record<string, { icon: string; zh: string; risk: RiskLevel; advice: string }> = {
  execute_code: {
    icon: "🧪",
    zh: "执行 Python 代码",
    risk: "medium",
    advice: "execute_code 可跑任意 Python（含子进程）。看代码做什么，通常可放行",
  },
}

// hardline 类（后端无条件阻止，不弹窗，仅用于教育展示）
export const HARDLINE_INFO = [
  "recursive delete of root filesystem",
  "recursive delete of system directory",
  "recursive delete of home directory",
  "format filesystem (mkfs)",
  "dd to raw block device",
  "redirect to raw block device",
  "fork bomb",
  "kill all processes",
  "system shutdown/reboot",
]

// 查询函数：给定 pattern_key，返回分类（或 null → 显示英文原文）
export function categorize(key: string): ApprovalCategory | null {
  if (SPECIAL_KEYS[key]) {
    return {
      icon: SPECIAL_KEYS[key].icon,
      zh: SPECIAL_KEYS[key].zh,
      risk: SPECIAL_KEYS[key].risk,
      advice: SPECIAL_KEYS[key].advice,
      keys: [key],
    }
  }
  for (const cat of APPROVAL_CATEGORIES) {
    if (cat.keys.some(k => key.includes(k))) return cat
  }
  return null
}

// ── 动态建议（第 1 层）──────────────────────────────────────────────
// 按类别 + 命令内容特征输出建议。verdict: allow=建议放行 / deny=建议拒绝 / review=自行判断

export type Verdict = "allow" | "deny" | "review"

export interface Suggestion {
  verdict: Verdict
  reason: string
}

// 路径特征
const DENY_PATHS = ["~/.hermes", "/root/", "~/.ssh", "/etc/", "authorized_keys", ".bashrc", ".zshrc", "config.yaml"]
const ALLOW_PATHS = ["/tmp/", "/var/tmp/", "build/", "dist/", "node_modules", ".cache", "/mnt/c/", "--dry-run"]
// 命令特征
const DENY_CMDS = ["os.system", "subprocess", "curl", "wget", "| sh", "| bash", "rm -rf", "sudo", "dd ", "chmod 777"]
const ALLOW_CMDS = ["--help", "--dry-run", "print(", "echo ", "ls ", "cat ", "pwd", "git status", "git diff", "pip install", "npm install"]

function hasAny(s: string, frags: string[]): boolean {
  return frags.some(f => s.includes(f))
}

function verdictOf(v: Verdict, reason: string): Suggestion {
  return { verdict: v, reason }
}

export function suggest(cat: ApprovalCategory, command: string): Suggestion {
  const c = command.toLowerCase()
  const zh = cat.zh

  // 🗑️ 删除
  if (zh.includes("删除")) {
    if (hasAny(c, DENY_PATHS)) return verdictOf("deny", "目标含个人配置/系统路径，谨慎")
    if (hasAny(c, ALLOW_PATHS)) return verdictOf("allow", "目标在临时/构建/挂载目录，风险较低")
    return verdictOf("review", "看不出目标位置，建议先看路径再决定")
  }

  // 🌐 远程下载执行
  if (zh.includes("远程")) {
    return verdictOf("deny", "远程内容直接进 shell，除非确认来源可信，否则拒绝")
  }

  // 📜 脚本 / 🧪 代码
  if (zh.includes("脚本") || zh.includes("Python")) {
    if (hasAny(c, DENY_CMDS)) return verdictOf("deny", "脚本内含删除/下载/提权类操作，确认内容再放行")
    if (hasAny(c, ALLOW_CMDS)) return verdictOf("allow", "脚本内容为常规计算/查询/安装，风险较低")
    return verdictOf("review", "看不出脚本具体做什么，建议看内容再决定")
  }

  // ⚙️ 敏感文件
  if (zh.includes("敏感")) {
    if (c.includes(".example")) return verdictOf("allow", "目标是示例文件，风险较低")
    if (hasAny(c, [".env", ".ssh", "authorized_keys", "netrc", ".npmrc", ".pypirc"])) return verdictOf("deny", "目标为凭据/密钥类文件，确认用途再放行")
    return verdictOf("review", "确认改的是哪个文件、改了什么")
  }

  // 🔐 提权
  if (zh.includes("提权")) {
    return verdictOf("deny", "提权/系统级操作，非明确意图默认拒绝")
  }

  // 🗄️ 数据库
  if (zh.includes("数据库")) {
    if (c.includes("where")) return verdictOf("review", "带 WHERE 的删除可考虑放行，确认条件无误")
    return verdictOf("deny", "破坏性 SQL（DROP/TRUNCATE/无 WHERE 删除），确认表与备份")
  }

  // 🔀 Git 历史重写
  if (zh.includes("Git")) {
    if (hasAny(c, ["--hard", "force push"])) return verdictOf("deny", "会丢工作/改写远端历史，确认分支与备份")
    return verdictOf("review", "确认分支与影响范围")
  }

  // 🛡️ Hermes 自身
  if (zh.includes("Hermes")) {
    return verdictOf("deny", "操作 Hermes 自身进程/配置，默认拒绝")
  }

  // 兜底
  return verdictOf("review", cat.advice)
}
