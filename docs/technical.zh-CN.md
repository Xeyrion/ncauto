# NCAuto · 技术文档

[English](technical.md)

本文记录 NCAuto 背后的逆向研究结论：官方导出格式、应用私有接口的调用过程、
报文结构，以及经实测确认的行为与约束。以下结论均可通过抓包复现。

---

## 1. 背景

- 根据官方文档（2026 年 6 月），Codex 仅支持导出为 ZIP，不提供导入功能，
  条目需手动逐条新建或经由 Extract 创建。
- 导出入口：Codex 侧边栏齿轮图标，产物为 ZIP 归档。
- 目标：将导出包（含 Codex / Snippets / Chats）批量写回操作者拥有写权限的任意书籍。

## 2. 导出格式（输入侧）

### 2.1 Codex 导出（`*- codex.zip`）

```
<characters|locations|lore|objects|subplots|other>/<名称>-<27位id>/
    metadata.json   # {id, attributes:{type,name,color,aliases,tags,
                    #   alwaysIncludeInContext,doNotTrack,noAutoInclude},
                    #  relationships:{nestedEntries:[id...]}, links:{...}}
    entry.md        # YAML frontmatter + Markdown 正文（描述）
    notes.md        # 研究笔记纯文本（仅非空时存在）
codex.html          # 汇总预览，可忽略
```

- 类型映射（复数目录名 → 单数记录值）：`characters→character`、
  `locations→location`、`lore→lore`、`objects→object`、
  `subplots→subplot`、`other→other`。
- 导出与写入接口之间存在一处字段名差异：
  `alwaysIncludeInContext`（导出）对应 `alwaysInclude`（接口）。

### 2.2 整项目导出（`*- full.zip`，导出向导三项全选）

在 2.1 的基础上，归档根目录增加：

```
novel.md                 # 手稿正文（导入流程不使用）
snippets/<YYYY-MM-DD> [<标题> - ]<id前8位>.md
codex.html
```

`snippets/*.md` 格式：frontmatter（`title` / `favourite`）后接纯文本正文，
段落之间以空行分隔。归档中仅保留 ID 的前 8 位，完整主键不可得，
导入时必须生成新 ID。

### 2.3 对话导出（`*- chats.zip`，或勾选 Chats 的 full 导出）

```
<YYYY-MM-DD> [<标题> - ]<id前8位>.md   # 归档根目录或 chats/ 子目录
```

frontmatter 与 Snippet 一致。正文按角色标题分段：
`## User` / `## AI`（`Assistant` 视为等价）/ `## System`。

## 3. 抓包方法

1. 启动带 HAR 录制的 Chromium，手动登录并打开目标书籍。
2. 手动新建一条 Codex（使用 `TEST_PROBE_xxx` 之类的特征名称，便于在抓包结果中定位），
   等待约 3 秒自动保存完成。
3. 在 HAR 中搜索 `TEST_PROBE`，定位真正的写入请求。注意：按 `codex|entries`
   之类的 URL 关键词过滤只能得到 Sentry 上报，必须按特征内容字符串搜索。
4. 结论：条目创建请求发往 `app.novelcrafter.com/api/trpc/data.commit`，
   正文写入使用 `data.updateOne`。

## 4. 鉴权

- 会话状态：`__session` Cookie（**非 HttpOnly，页面上下文可读**）存放 JWT；
  请求携带 `Authorization: Bearer <JWT>` 请求头。
- userId 为 JWT payload 的 `sub` 声明（base64url 解码）。
  不可拼接 `__session_*` 后缀 Cookie，否则返回 HTTP 401。
- 常用请求头：`novelcrafter-client-version: client@f81152`、
  `novelcrafter-client-time: <毫秒时间戳>`、
  `novelcrafter-client-token-time: 0`、`content-type: application/json`。
- 油猴脚本方案：被动截获应用自身发出的 tRPC 请求头
  （Authorization + client-version），Cookie 由浏览器自动携带，
  token 轮换时始终采用最新截获的值。

## 5. tRPC 信封格式

- 查询：`GET /api/trpc/<过程>?batch=1&input=<URL编码的 {"0":{"json":<入参>}}>`。
- 变更：`POST /api/trpc/<过程>?batch=1`，请求体为 `{"0":{"json":<入参>},"meta":{...}}`。
- 成功：`[{"result":{"data":{"json":...}}}]`；失败：
  `[{"error":{"json":{"message","code","data":{"code","httpStatus","path"}}}}}]`。
- 入参错误返回 `BAD_REQUEST`（400）；过程名不存在返回 `NOT_FOUND`（404），
  该特性可用于探测接口是否存在。
- `Date` 类型的值须配套 `meta.values` 声明
  （如 `"transaction.upsert.0.meta.createdAt": ["Date"]`）。
  一次 commit 打包多条 upsert 时，**每个下标都必须单独声明**，否则返回 400。

## 6. 端点清单（实测）

| 过程 | 方法 | 入参 | 用途 | 状态 |
|---|---|---|---|---|
| `data.getAll` | GET | novelId **字符串本体**（传入对象返回 400） | 读取整本书的全部记录：novels/novelDetails/acts/chapters/scenes/codexEntries/snippets/chatThreads/chatMessages | 可用 |
| `data.commit` | POST | 见 §7 | upsert 任意记录 | 可用 |
| `data.updateOne` | POST | 见 §7 | 更新单条记录的部分字段与关联 | 可用 |
| `snippets.getAll` | GET | novelId 字符串 | 读取片段 | 可用 |
| `novels.getPermissions` | GET | novelId 字符串 | 查询当前账号对书籍的 role/canWrite（写前预检） | 可用 |
| `snippets.create/upsert/update/...` | — | — | 全部返回 404：**不存在片段专用写接口**，写入一律经由 `data.commit` | 不可用 |

## 7. 记录报文详解

### 7.1 `codexEntries`

```json
{
  "id": "<27位id>", "type": "codexEntries",
  "meta": {"createdAt": "<ISO>", "updatedAt": "<ISO>", "state": "active"},
  "attributes": {
    "type": "character|location|object|lore|subplot|other",
    "name": "…", "description": "<p>…</p>", "notes": "<p>…</p> 或 null",
    "tags": [], "aliases": [],
    "alwaysInclude": false, "doNotTrack": false, "noAutoInclude": false,
    "hideFromAi": false, "promptInclusions": null,
    "matchExclusions": [], "matchCaseSensitive": false, "color": null
  },
  "fields": {},
  "relationships": {
    "nestedEntries": ["<关联条目id>"],
    "belongsTo": {"type": "novels", "id": "<novelId>"},
    "connections": []
  },
  "links": {"thumbnail": null, "externalReferences": []}
}
```

- `description`（Details）与 `notes`（Research）均以 **HTML** 存储：
  段落使用 `<p>`，段内换行使用 `<br>`。
  由 Markdown 导出转换时：按空行切分为段落并包裹 `<p>`，
  段内 `\n` 转为 `<br>`，并转义 `&<>"'`。
- `context.event.name` 使用 `codex_entry_created`（服务端不校验，可自定义）。
- 写入分两个阶段，与官网手动建条目的行为一致：① commit 创建空条目，
  ② updateOne 写入详情。updateOne 的 `context` 可传 `null`；
  `relationships.nestedEntries` 为**整体替换语义**（非追加）。

### 7.2 `snippets`

```json
{
  "id": "<新id>", "type": "snippets",
  "attributes": {"title": "…", "favourite": false,
    "content": {"type": "doc", "content": [...]}},
  "relationships": {"belongsTo": {"type": "novels", "id": "<novelId>"}}, "links": {}
}
```

- 正文为 **ProseMirror/Tiptap JSON**（非 HTML）：空行分段；
  单行 `#` 开头为 heading；全部以 `-/*/+` 开头为 bulletList；
  全部以 `1.` 开头为 orderedList；段内换行转为 hardBreak 节点。
- 事件名为 `snippet_created`，一次 commit 写入一条即可。

### 7.3 `chatMessages` + `chatThreads`

```json
// 消息
{"type": "chatMessages",
 "attributes": {"type": "user|ai|system", "text": "纯文本", "model": null},
 "relationships": {}}
// 线程
{"type": "chatThreads",
 "attributes": {"title": "", "favourite": false,
   "includeOutlineInContext": false, "includeAllTextInContext": false,
   "inputs": {}, "memoryCutoff": 14, "thinking": null},
 "relationships": {"messages": ["<按时间排序的消息id>"], "prompt": null, "model": null, "sceneContext": null}}
```

- 写入顺序：先一次 commit 创建全部消息（多 upsert，meta 逐下标声明），
  再创建线程并挂载 `messages`。
- 消息与线程不携带 `belongsTo`，书籍归属由 commit 的
  `context.scope.novelId` 决定。

### 7.4 ID 机制

- ID 为 27 位 base62 的 KSUID（时间可排序全局唯一标识），
  空间为 62^27 ≈ 2^161。随机碰撞概率约为 4×10^-49，工程上可忽略。
- `data.commit` 按 ID 执行 upsert：ID 不存在则插入，已存在则原地覆盖
  （因此沿用 ID 重复导入天然幂等）。
- **跨账号沿用已有 ID 将返回 403**：ID 为带归属的全局主键，
  对他人拥有的 ID 执行 upsert 等同于试图修改他人的记录。
  实测结论：同账号跨书复用成功；跨账号复用失败（`FORBIDDEN -32003`）；
  全新随机 ID 成功。
- 结论：导入同一账号的导出包时可沿用 ID（增量同步不产生副本）；
  导入其他账号的导出包时必须使用新 ID，关联按“旧 ID → 名称 → 新 ID”
  重新链接，以保证整包迁移不断链。

### 7.5 权限模型

- HTTP 403 `You do not have permission to edit model "novels:<id>"`
  为服务端最终裁决：读（getAll）正常但写被拒绝，
  即当前账号对该书无写权限（只读分享、登录错误账号或跨账号 ID 复用）。
- 批量写入前应先调用 `novels.getPermissions` 查询 `role`/`canWrite`，
  权限不足时提前终止。

## 8. 导入流程（NCAuto 实现）

```
解析 zip/folder/json → 三组可选列表（Codex/Snippets/Chats）
  → 权限预检 → 读取已有索引（名→id：判重与关联重链）
  → 第一遍 data.commit 创建条目/片段/消息/线程
  → 第二遍 data.updateOne 写入 Codex 详情（正文+笔记+关联）
  → 汇总日志 → 操作者刷新页面（前端缓存非实时，以 data.getAll 为准）
```

- 跳过重名：Codex 按名称，片段与对话按标题（空标题不参与匹配）。
- 关联重链：引用 ID 在本次导入集合内则直连；指向被跳过的已有条目则按名重链；
  两者均不命中则丢弃并计数。
- 节流：默认每条写入间隔 200ms 并附加随机抖动；出现 HTTP 429 或大面积失败时应调大间隔。

## 9. 已知行为与约束

1. 按 URL 关键词过滤 HAR 会遗漏：Sentry 上报同样含有关键词，应按特征内容字符串搜索。
2. `data.getAll` 入参须为字符串本体，包装为对象将返回 400。
3. 多 upsert 的 commit 必须在 `meta.values` 中逐下标声明 Date。
4. `nestedEntries` 更新为整体替换，非追加。
5. 面板自身位于文档 body 内：以 `innerText` 判重前必须先隐藏面板，否则全部条目将自我匹配。
6. JSZip 文件对象使用 `.async('text')`，仅原生 File 对象提供 `.text()`。
7. 油猴 `@require` 的 CDN 在部分地区可能整体加载失败，已改用懒加载加多 CDN 兜底。
8. 写入后读取可能短暂不一致，校验前应稍候；侧边栏非实时，以刷新为准。
9. 发表文章或截图前应脱敏：JWT、userId、novelId、私有书名均不可保留。

## 10. 风险声明

本文所述接口为私有接口，无版本承诺，官方站点变更可能随时导致其失效
（典型症状：大面积 HTTP 4xx）。本工具仅操作登录者拥有写权限的书籍，
不绕过任何服务端权限检查。转载时请保留本声明。

## 11. 致谢

Snippet / Chat 报文格式、整包导出结构与幂等 ID 方案借鉴了第三方 `ncauto` 研究
（`NOTES.md` 及 `ncimport*.mjs` 系列）。油猴零安装实现路线为本项目原创。
