# Pi Skill collision 启动提示过滤扩展设计

## 1. 目标

创建一个全局 Pi 扩展，在交互式 TUI 启动和 `/reload` 时隐藏同名 Skill 产生的 collision 诊断，同时保留其他 Skill 配置警告和所有非 Skill 诊断。

扩展只改变显示，不改变 Skill 的发现、优先级、加载结果、系统提示词或诊断数据源。

## 2. 范围

### 包含

- 新建本地 Pi package：`~/dev/pi-skill-conflict-filter`。
- 过滤满足以下条件的诊断：
  - `diagnostic.type === "collision"`
  - `diagnostic.collision.resourceType === "skill"`
- 保留无效 frontmatter、缺失路径等 Skill 警告。
- 保留 `[Prompt conflicts]`、`[Extension issues]`、`[Theme conflicts]` 等其他诊断。
- 支持初次启动、`/reload`、`/new`、`/resume` 和 `/fork` 生命周期。
- 作为本地 package 安装到全局 Pi 设置。

### 不包含

- 解决或删除重复 Skill。
- 修改 Pi 源码或发布 Pi fork。
- 提供运行时开关或设置界面。
- 影响 JSON、print 或 RPC 模式的数据。

## 3. 方案选择

采用 monkey-patch `InteractiveMode.prototype.showLoadedResources`。

每次调用原方法前，扩展仅在当前 `resourceLoader` 实例上临时包装 `getSkills()`，返回原始 Skills 和过滤后的 diagnostics；原方法结束或抛错后，通过 `finally` 恢复原方法。

未采用的方案：

1. patch `DefaultResourceLoader.prototype.getSkills`：会改变非 TUI 消费者看到的诊断，影响面过大。
2. 修改 `tui.children` 或过滤最终文本：依赖组件下标、ANSI 文本和布局，升级兼容性更差。

## 4. 组件

### 4.1 内部模块解析

使用 `import.meta.resolve("@earendil-works/pi-coding-agent")` 定位当前运行中的 Pi package root，再动态导入：

```text
dist/modes/interactive/interactive-mode.js
```

不硬编码 Node 版本目录或全局安装绝对路径。

### 4.2 诊断过滤器

纯函数接收 `getSkills()` 返回值，创建浅拷贝并移除 Skill collision。原对象和原 diagnostics 数组保持不变，便于测试并避免污染其他消费者。

### 4.3 Patch 生命周期

使用 `Symbol.for("pi-skill-conflict-filter.state")` 在 `globalThis` 保存：

- 原始 `showLoadedResources`
- 已安装 patch
- 引用计数
- cleanup / release handle

安装必须幂等。`/reload` 和退出时恢复原方法；会话切换期间可复用已安装 patch，避免重复包装。

### 4.4 降级行为

若内部模块路径、类或方法发生变化：

- 不阻止 Pi 启动。
- 不修改任何诊断。
- 通过 `ctx.ui.notify(..., "warning")` 提示扩展已降级。

## 5. 数据流

```text
Pi 准备显示启动资源
  → patched showLoadedResources()
  → 临时包装当前 resourceLoader.getSkills()
  → 原 showLoadedResources() 读取 Skills
  → 仅 collision Skill diagnostics 被过滤
  → 原 TUI 渲染其余内容
  → finally 恢复 getSkills()
```

## 6. 文件结构

```text
pi-skill-conflict-filter/
├── extensions/
│   └── skill-conflict-filter.ts
├── docs/superpowers/specs/
│   └── 2026-07-18-skill-conflict-filter-design.md
├── skill-conflict-filter.test.mjs
├── package.json
├── README.md
├── LICENSE
└── .gitignore
```

## 7. 验证

Node 测试覆盖：

1. 扩展可被 Pi extension loader 加载。
2. `InteractiveMode.prototype.showLoadedResources` 被替换。
3. Skill collision 被过滤。
4. 非 collision Skill 警告保留。
5. 输入结果未被原地修改。
6. cleanup 后恢复原方法。
7. 重复安装不会形成多层 patch。

安装后执行交互式启动 smoke test，验证当前环境不再显示同名 Skill collision，同时 Pi 仍可正常进入编辑器。

## 8. 风险

该扩展依赖 Pi 私有 `InteractiveMode` 路径和方法，Pi 升级后可能失效。风险通过以下方式控制：

- 集中声明内部模块路径。
- 启动时校验目标方法。
- 失败时降级而非阻断启动。
- README 明确说明 monkey-patch 风险。
- 测试直接覆盖当前安装版本的内部结构。
