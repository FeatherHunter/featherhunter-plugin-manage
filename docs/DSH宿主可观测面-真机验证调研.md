# DSH 宿主可观测面 —— 真机验证调研

只读取证，2026-11-01。对象：`D:\DeepseekHarness\resources\app.asar`（单文件 182 MB，非目录）。
取证方式：用 `D:\dsh-plugin\dsh-prompt\.asar-tools\asar.mjs`（`openAsar/listAll/readText`）在 asar 内逐文件读源码与生成式 descriptor，**未启动任何实例、未安装任何包、除本文件外未写盘**。

路径约定：下文所有 `dsh/node_modules/@deepseek-ai/...` 均相对于 asar 根（`app.asar` 内路径前缀 `dsh/`）。宿主版本：`dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime@0.2.1-rc.3`；`dsh-runtime`（`dsh/node_modules/@deepseek-ai/dsh-app-boot/package.json`）= `0.2.1-rc.3`。

---

## 一、一句话结论

**宿主有稳定、可 headless 调用的本地 HTTP API（`POST /api/<endpoint>`，cookie 鉴权）：事实 3/4/5 完全走它，事实 1 除 `lib/client.js` 的 sha256 外也走它；事实 2（完整技能注册表，含 16 条隐藏项）HTTP 只能给"用户可调用"子集，完整 27 条必须靠文件枚举 + 官方 rank 规则，或由插件用 `ctx.skills.snapshot()` 自己开一个只读端点。**

| 事实 | 一句话 | 是否只剩文件可观测 |
|---|---|---|
| 1 插件包/版本/`lib/client.js` sha256 | 版本走 HTTP，**sha256 只能文件** | 只有哈希是 |
| 2 技能注册表（含隐藏项） | HTTP 只给 user-invocable 子集；完整集合靠文件树 + rank 表 | 是（除非插件自开端点） |
| 3 生效中的模型配置 | 全 HTTP，且不需要任何密钥 | 否 |
| 4 已装 bundle / profile 状态 | 全 HTTP（+ 文件兜底） | 否 |
| 5 是否真正 ready | **启动 stdout 那一行就是最强信号**，再用 HTTP 复核 | 否 |

**不要再为 3/4 解析 `cordis.patch.yml` 与 JSONL 日志**——HTTP 给的更准（是"实际生效"而非"文件上写着"）。

---

## 二、证据表

> 请求均为 `POST http://<authority>/api/<endpoint>`，头 `content-type: application/json` + `cookie` + `Origin`，体 `{"type":"client-request","rpcId":"<任意串>","method":"<endpoint，必须与 URL 完全一致>","payload":{...}}`；应答 `{"type":"server-response","rpcId":...,"result":{"ok":true,"value":<下表"返回形状">}}`。

| 事实 | 观测通道 | 精确请求/路径 | 返回形状 | 证据 file:line | 可信度 |
|---|---|---|---|---|---|
| 1 已装插件（加载态） | a HTTP | `pluginInventory/list` payload `{}` | `{managementAvailable?, entries:[{entryId, moduleName, meta?, enabled, fiberPhase: null\|"failed"\|"pending"\|"active"\|"loading"\|"unloading"}], agentPresets?}` | `dsh/node_modules/@deepseek-ai/dsh-host-plugin-inventory/lib/typert.host.js:7`（result schema）、`:53`（descriptor，`parameters: []`） | 高 |
| 1 已装 bundle + 版本 | a HTTP | `pluginManager/listBundles` payload `{}` | `[{name, official, availability:"profile"\|"installation"\|"missing", version?, installed, enabled, source?, rows:[{rowId, moduleName, entryId?}], overrides, error?}]` | `dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/typert.host.js:85`（schema）、`:580`（descriptor，`parameters: []`） | 高 |
| 1 版本 + sha256 | c 文件 | `<DSH_HOME>/profiles/<name>/node_modules/<pkg>/package.json` 的 `version`；同目录 `lib/client.js` 的 sha256 | npm 包结构 | 写者：pnpm（`dsh plugin` 转发）+ `writeProfileBundles`（`dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:1188`） | 高（哈希仅此处） |
| 2 技能（可见子集） | a HTTP | `skills/list` payload `{"sessionId":"<id>"}` | `{skills:[{name, path?, description, whenToUse?, modelInvocable}]}` | schema `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js:1221`；参数 `:1217-1219`；**过滤** `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/skill-catalog.js:162` | 高（对可见子集） |
| 2 技能（完整 27 条） | c 文件树 + rank 规则 | 见 §5.2 的 6 个根目录 + 各自 rank | 目录扫描 + frontmatter | rank 常量 `dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js:20-24`；根表 `:155-183`；排序/去重 `dsh/node_modules/@deepseek-ai/dsh-skill/lib/index.js:511-513,520` | 中高（静态真相，非"已注册"） |
| 2 技能（进程内） | d 需插件开端点 | `ctx.skills.snapshot({cwd})` | `{skills:[{name, path?, description, whenToUse?, invocation:{modelInvocable,userInvocable}, source, provider, resourceBase?}], complete:boolean}` | `dsh/node_modules/@deepseek-ai/dsh-skill/lib/index.js:234-240`、`:491-503` | 高（但需插件） |
| 3 生效模型目录 | a HTTP | `session/modelCatalog` payload `{}` | `{default:{provider, model, reasoningEffort?}, routableProviders:[string], groups:[{id,name,models:[{id,name,description?,reasoning?}]}], failures:[{id,name,message}]}` | `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js:707`（schema）、`:1668`（descriptor，`parameters: []`） | 高 |
| 3 provider 声明 | a HTTP | `llm/listConfigurableProviders` payload `{}` | `[{provider, displayName, settingsNs, settingsPath:[string], declared?, defaultBaseURL?, baseURLEnv?, nativeAuth?:{env,oauth}, error?}]` | `dsh/node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js:24`（schema）、`:107`（descriptor） | 高 |
| 3 生效值（含模型 id、引用名） | a HTTP | `settings/describe` payload `{}` | `{writable, hasDocument, namespaces:[{ns, autoGenerate, schema, value, base?, user?, applies, secrets:[{path:string[], set:boolean}], revision}]}` | `dsh/node_modules/@deepseek-ai/dsh-api-settings-controller/lib/typert.host.js:25`（schema）、`:265`（descriptor，`parameters: []`） | 高 |
| 3 凭据引用是否配好（不含密钥） | a HTTP | `credentials/describe` payload `{"refs":["DEEPSEEK_API_KEY",...]}` | `Record<string,{configured:boolean, source?:string, writable:boolean}>` | `dsh/node_modules/@deepseek-ai/dsh-api-settings-controller/lib/typert.host.js:9`（schema）、`:154`（descriptor） | 高 |
| 3 会话实际选中 | a HTTP | `session/list` payload `{}` | `items[].projections.values.modelSelection = {lastUsed, next}`，各 `{provider, model, reasoningEffort?}` | `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.host.js:523`（result）、`:519-521`（参数 `{cursor?}`） | 高 |
| 4 profile 装配 | a HTTP | `pluginManager/listPlugins` payload `{}` | 二支 union：`{entryId, moduleName, meta?, enabled, fiberPhase, patchId}` 或 `{…, readOnlyReason:"management-required"\|"unaddressable"}` | `dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/typert.host.js:139`（schema）、`:595` | 高 |
| 4 profile 清单 | c 文件 | `<DSH_HOME>/profiles/<name>/package.json` 的 `dsh.profile.bundles[]` 与 `dependencies` | 见 `initProfile` | `dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:611-626` | 高 |
| 5 真正 ready | d stdout | 启动后 stdout 恰一行 `dsh web: http://127.0.0.1:<port>/?token=<43 字符>` | 该行 = loader 全部 settle 且 `auditStartupEntries` 通过 | `dsh/node_modules/@deepseek-ai/dsh-web-app/lib/index.js:156-177`（`announceReady` 在 `:162` 打印，`:171-176` 先 `loader.await()` 再 `auditStartupEntries`） | 高 |
| 5 未激活条目 | d stderr | `dsh web: warning: N entries did not activate` + 每行 `id (module): failed…\|pending (waiting for service(s): a, b)` | 文本 | `dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:4408-4420`（生成）、`:4464-4475`（审计） | 高 |
| 5 结构性复核 | a HTTP | `pluginInventory/list` 全 `fiberPhase === "active"` | 同上 | 同上 | 高 |
| 应用版本 | b CLI | `dsh --version`（`-V`） | `0.2.1-rc.3` | `dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:105,207-208` | 高 |

---

## 三、HTTP API 全貌

### 3.1 通道：只有一个 `/api`

客户端侧的"`/api/<channel>/<endpoint>`"是误读。注册器只接受 `"/api"` 一个通道：

- `dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:874` `registerInterceptor`：`if (channel !== "/api") throw new Error(...)`。
- `:689` `const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/`；`:690` `ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/`。
- `:926-931` `endpointFromPath(channel, pathname)` 剥掉 `"/api/"` 后把剩余整段作为 endpoint（可含 `/`），并拒绝空段、`.`、`..`。所以 `POST /api/settings/describe` 的 endpoint 是 `settings/describe`；看起来像 channel 的 `settings`/`skills`/`llm` 只是 endpoint 的首段。

非 RPC 的 web 路由总共只有这些（全 asar 内 11 个文件调用 `webServer.register`/`registerUpgrade`）：

| 路径 | 类型 | 认证 | 证据 |
|---|---|---|---|
| `/api`（前缀） | RPC 桥 | `connection.admit` → 401 | `dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:1045-1058` |
| `/connect`（精确） | 换 cookie，302 | 一次性 launch token | 同上 `:1059-1065`；处理器 `:499-536` |
| `/api/remote.mux`（upgrade） | WS 流式通道 | 同 cookie | `dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js:820` |
| `/plugins`（前缀） | 客户端 bundle + sourcemap | **公开** | `dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:202,564-568` |
| `/plugins/events`（精确） | HMR SSE | 公开 | `dsh/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:5,141-152` |
| `/api/experimental-inspector/bootstrap`（精确） | inspector 引导 | cookie | `dsh/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/index.js:2329,2387` |
| `/inspector/devtools`（前缀）、`/inspector/devtools/cdp`（upgrade） | DevTools / **CDP 代理进宿主 Node 进程** | cookie | 同上 `:2369,2422-2446,2461-2500` |
| `/open-in-app/{apps,icon,open}` | 打开外部应用 | — | `dsh/node_modules/@deepseek-ai/dsh-host-open-in-app/lib/index.js:1126,1129,1132` |
| SPA 兜底 | 静态前端 | `authorizeIndex` | `dsh/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js:87` |

**没有** `/api/health`、`/api/version`、`/api/status`（见 §3.4）。

### 3.2 headless 调用（Node，无浏览器、无 WebSocket）

1. 从启动 stdout 抓 `http://127.0.0.1:<port>/?token=<43 字符>`。
2. `GET /connect?token=<43字符>`（**不要**带 `interactions`；省略即 `none`）→ `302` + `set-cookie: dsh-auth-<base64url(sha256(authority))>=<签名值>`。
   - `:507-514` `declarations = url.searchParams.getAll("interactions"); const interactions = declarations[0] ?? "none"`；重复声明或非 `answer`/`none` → 400 `interactions must be declared once as answer or none`。
   - `:519-536` 校验 `GET` + `pathname === "/connect"` + 恰好一个 token + 有 authority + token 匹配，然后 `:536` 写 `set-cookie`。
3. 之后每个请求带 `cookie`（名字从 `set-cookie` 里读，不必自己算）、`content-type: application/json`、`Origin: <同 authority>`。
   - cookie 30 天有效：`:1017` `cookieMaxAgeDays: z.natural().min(1).default(30)`。
   - 名字由 authority 派生：`:335-337` `COOKIE_PREFIX + encodeBase64Url(sha256(authority))`，`:277` `COOKIE_PREFIX = "dsh-auth-"`。
4. **可以不建立 WS**：README 明说未用的 API Peer 会留到宿主关闭（`dsh/node_modules/@deepseek-ai/dsh-client-connection/README.md:82` "Unused API Peers may remain until Host shutdown — no connect deadline or idle collection"），而 `interactions` 默认 `none`（`:51` "The API connection defaults to `none`… HTTP may precede WebSocket establishment"）。
   - 代价：README 说同一 cookie 在"owning socket 关闭后"失效（`:51`），但既然本方案从不建 socket，就不存在这一事件；宿主重启后必须重新 `/connect`。

### 3.3 请求/响应封包（严格）

- 请求：`dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:631-636`
  `z.object({ type: z.literal("client-request"), rpcId: z.string(), method: z.string(), payload: z.unknown() })`。
  **字段叫 `payload`，不是 `body`**；`method` **必须与 URL endpoint 逐字相同**，否则 `:904` 返回 `gateway/bad-request`（message：`method "X" does not match endpoint "Y"`）。
- 响应：`:638-642` `{type:"server-response", rpcId, result}`，`result` = `:621-629` 的 `{ok:true, value}` | `{ok:false, error:{code,message,details}}`。
  **业务数据在 `body.result.value`**；失败也可能 HTTP 200 + `result.ok:false`（`dsh/node_modules/@deepseek-ai/dsh-api-gateway/README.md:60` "never rejects for carrier problems"）。
- 传输层硬规则（`:888-917`）：只接受 `POST`（否则 404）；`content-type` 去掉参数后须为 `application/json`（否则 **415**）；body 非 JSON → 400 `body is not JSON`；封包不合 schema → 错误封包 `gateway/bad-request` + `details.issues`；handler 抛异常 → HTTP 500 `handler failure: ...`。
- 未带 cookie 访问任何 `/api/*` 得到 **401（不是 404）**——因为 `/api` 前缀路由先 `connection.admit`。带 cookie 但 endpoint 不存在才是 404。这一点很关键：**"端口通了 + 401"不等于 ready**。

### 3.4 端点清单（29 个 descriptor，144 个 endpoint）

生成式描述符在 `dsh/node_modules/@deepseek-ai/<pkg>/lib/typert.host.js`，方法键即是 URL path。下表"证据"列省略了公共前缀 `dsh/node_modules/@deepseek-ai/`，其余部分（含行号）逐字可拼。与本次五事实相关的：

| endpoint | 参数 | 用途 | 证据（schema / descriptor） |
|---|---|---|---|
| `pluginInventory/list` | `[]` | Loader 条目 + `fiberPhase`（事实 1、5） | `dsh-host-plugin-inventory/lib/typert.host.js:7` / `:53` |
| `pluginManager/listBundles` | `[]` | bundle 版本/安装态（事实 1、4） | `dsh-plugin-manager/lib/typert.host.js:85` / `:580` |
| `pluginManager/listPlugins` | `[]` | profile 条目装配（事实 4） | 同上 `:139` / `:595` |
| `pluginManager/listVersionExemptions`、`registries` | `[]` | 版本豁免、registry 配置 | 同上 `:175`、`:180` |
| `skills/list` | `[{sessionId}]` | 技能（**user-invocable 子集**，事实 2） | `dsh-api-session-controller/lib/typert.host.js:1221` / `:1977` |
| `session/modelCatalog` | `[]` | 生效模型目录（事实 3） | 同上 `:707` / `:1668` |
| `session/list` | `[{cursor?}]` | 会话 + `modelSelection`（事实 2 取 sessionId、事实 3） | 同上 `:523` / `:1635` |
| `session/create` | `[{workspaceId?, cwd?, sessionId?, agentPreset?}]` | 造一个 sessionId（**写盘**） | 同上 `:228-233` / `:1522` |
| `settings/describe`、`settings/openSettingsDocument` | `[]` | 生效配置（脱敏值 + `secrets[].set`） | `dsh-api-settings-controller/lib/typert.host.js:25` / `:265`、`:347` |
| `credentials/describe` | `[refs: string[]]` | 凭据引用状态，**永不回值** | 同上 `:9` / `:154` |
| `llm/listProviders`、`llm/listConfigurableProviders` | `[]` | provider 路由与声明 | `dsh-llm/lib/typert.host.js:39` / `:122`、`:24` / `:107` |
| `llm/discoverModels` | `[provider?, {provider?, baseURL?, api?, apiKey?}]` | **会发网络请求**，勿用于验证 | 同上 `:7`（param）、`:16`（result） / `:56` |
| `commands/list` | `[string]` | `/命令` 目录（**不是技能**，勿混） | `dsh-commands/lib/typert.host.js:35` / `:137` |

全 144 个 endpoint 中，用 `/version|health|boot|ready|ping|diag|about|describe|state/` 匹配方法键，只命中 `account/getState`、`credentials/describe`、`settings/describe`、`pluginManager/listVersionExemptions`、`pluginManager/setVersionExemption`。**不存在应用版本、健康检查、就绪、启动诊断端点。**

### 3.5 明确未能确认的部分

1. **`skills/list` 是否真的能返回 27 条**：代码只保留 `isUserInvocable` 为真的项（`skill-catalog.js:162`），所以 `user-invocable: false` 的技能**一定不在**。matt 说的"27 中 16 条隐藏"如果指这 16 条是 `user-invocable: false`，则 HTTP 拿不到它们；如果是 `model-invocable: false`（模型看不见但用户能调用），则它们在 `skills/list` 里且带 `modelInvocable:false`。**这两种"隐藏"方向相反，必须实测一次才能定论**（见 §7-Q1）。
2. **`pluginRegistryProbe/fastest`**（`dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/typert.host.js`）：疑为客户端 UI 探测，未读实现，不纳入建议。
3. **`session/create` 之后 session 是否立即出现在 `sessionQuery` 里**（`skills/list` 依赖 `observeSession` 能给出 projections，`skill-catalog.js:126-128` 在无 projections 时直接抛 `skill catalog requires a projected Session observation`）。冷启动实例上"create → skills/list"能否接通，需实测（§7-Q2）。
4. **`settings/describe` 的 `value` 是否会包含明文密钥**：schema 称 "Redacted resolved value… the value itself never rides"（`secrets[].set` 只给布尔），但 redaction 是宿主侧行为，未见实现级证据，需实测确认（§7-Q3）。

---

## 四、CLI 全貌

### 4.1 安全（纯读、不起宿主、不写盘）

| 命令 | 输出 | 证据 |
|---|---|---|
| `dsh --version` / `-V` | `0.2.1-rc.3`（runtime 版本，来自 `dsh-app-boot/package.json`） | `dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:105`（commander 内建）、`:208` `const version = getDshRuntimeVersion();` |
| `dsh --help` | launcher 自己的帮助（`dsh web` = `dsh --profile web` 等） | 同上 `:39-49,105` |
| `dsh <app> --help`（如 `dsh web --help`） | 应用自己的参数（`--host/--port/--no-open/--public-url/--trusted-host/--tls-cert/--tls-key`） | `dsh/node_modules/@deepseek-ai/dsh-web-app/lib/startup.js:24-36` |

只有这 3 类。**没有 `doctor`、`skills`、`models`、`plugin list` 这类"打印状态"的子命令。**

> 唯一擦边的是 `dsh plugin --profile X list`：它不是 DSH 自己的命令，而是把 `list` **原样转发给 pnpm**（`dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:116` "forwarding the remaining arguments to pnpm in the profile directory"、`passThroughOptions()` `:117`）。语义上只读，但走的是安装通道、会碰 `node_modules` 与 store 元数据，不能当"纯只读"用；而且输出是 pnpm 的人类可读树，不是给程序消费的。

### 4.2 会写盘（不要当作只读）

| 命令 | 副作用 | 证据 |
|---|---|---|
| `dsh --dump-config <profile>` / `--dump-default-config` | ① profile 不存在时按模板**新建**；② **无条件重写** `<profile>/cordis.yml` 为常量 `[]\n` | `dsh/node_modules/@deepseek-ai/dsh/lib/dump-config-CWs_HdOc.js:24-28` 调 `prepareProfile`；写入点 `dsh/node_modules/@deepseek-ai/dsh/lib/profile-boot-C14i-8IN.js:216-222`（`writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)`） |
| `dsh --dump-config-schema <profile>` | 同上（同样经 `prepareProfile`） | `dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:244-247` |
| `dsh --from-default-profile X <app>` | **删掉并重建** profile `X`（`.<name>.staging-*` 暂存后整体替换） | `dsh/node_modules/@deepseek-ai/dsh/lib/profile-boot-C14i-8IN.js:128-145` |
| `dsh plugin --profile X <pnpm args>` | 在 profile 目录跑 pnpm，装/卸包并改写 `package.json`、`dsh.profile.bundles` | `dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:115-127,234-237`；`dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:1188,1215-1220` |
| `dsh <app>`（任何 app） | 起宿主、写 `$DSH_HOME` 下的 `sessions/`、`.credentials.yaml`、`storages/` | 见 §5 |

> 结论：`--dump-config` **不是**只读命令。若要用它取"合成后的配置"，必须指向一个一次性 `DSH_HOME`，且接受它会写 `cordis.yml`。

---

## 五、文件/日志兜底

### 5.1 目录骨架

根目录 = `resolveDshHome()`（`dsh/node_modules/@deepseek-ai/dsh-home-paths/README.md`：显式配置 → `$DSH_HOME`（空串视为未设置）→ `~/.dsh`）。

```
<DSH_HOME>/
  .credentials.yaml          # 凭据（含明文 refs，见 5.4）
  .anonymous-user-id
  settings.yaml[.imported]   # 旧版一次性导入，非实时真相
  cordis.patch.yml           # home 级 patch 层，覆盖所有 profile
  profiles/<name>/
    package.json             # dsh.profile.bundles[] + dependencies
    cordis.patch.yml         # profile 用户层（实时配置值在这里）
    cordis.yml               # 生成物，恒为 []\n
    [compatibility.json]     # 版本豁免
    [pnpm-workspace.yaml]
    node_modules/<pkg>/…
  logs/startup-<ts>-<uuid>.log
  sessions/  storages/  cache/
```

证据：`dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:507`（`PROFILES_DIR = "profiles"`）、`:509`（`PROFILE_PATCH_FILENAME = "cordis.patch.yml"`）、`:548`（`join(home, PROFILES_DIR, name)`）、`:551-557`（`PROFILE_TEMPLATES`：`web` = `dsh-base` + `dsh-web-app`）、`:570`（默认 `["@deepseek-ai/dsh-base"]`）、`:611-626`（`initProfile` 写 `package.json`/`cordis.patch.yml`/`pnpm-workspace.yaml`）、`:1065-1070`（`loadProfile` 按模板 `initProfile`）。

### 5.2 技能来源（事实 2 的文件通道）

`dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js:20-24` 的 rank 常量与 `:155-183` 的根表：

| rank | source | 根目录 | 说明 |
|---|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` | |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` | |
| 300 | `custom` | `Config.customSkillDirs` | 默认 `[]` |
| 400 | `user-dsh` | `<dshHome>/skills` | 跳过其 `.system` 子目录 |
| 500 | `user-agents` | `<agentsHome>/skills` | `agentsHome` = `$DSH_AGENTS_HOME` → `~/.agents` |
| 600 | `bundled` | `bundledSkillDir` 或 `$DSH_BUNDLED_SKILL_DIR` | |

- `projectRoot` = 最近的含 `.git` 的祖先目录，否则 cwd（`dsh/node_modules/@deepseek-ai/dsh-skill-filesystem/README.md`）。
- 格式：`<name>/SKILL.md` 或扁平 `<name>.md`，**只扫根目录的第一层**（不递归找 `**/SKILL.md`）。
- frontmatter 必填 `name`、`description`；可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`。
- 同名去重：先比 `candidate.rank`，同 rank 再看 provider 注册顺序（`dsh/node_modules/@deepseek-ai/dsh-skill/lib/index.js:520`），被丢弃者会打 `skill "X" from <source> ignored because a higher-priority skill already exists`（`:320`）。
- 排序：按 name 码点（`:511-513`）。

**rank 不出现在任何 API 返回值里**（`toSummary` `:491-503` 只给 `source`/`provider`；`skills/list` 更少，只给 `path`）。所以"名字+来源+rank"三者如果要凑齐，要么文件枚举 + 上表，要么插件自己开端点（`snapshot()` 给 `source`，rank 仍要靠上表）。

### 5.3 profile 状态（事实 4 的文件通道）

`<DSH_HOME>/profiles/<name>/package.json`：

```json
{ "dependencies": { "@deepseek-ai/dsh-base": "...", "<pkg>": "..." },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }
```

写者：`initProfile`（首次，`dsh-app-boot/lib/index.js:611-626`）、pnpm（装包时改写 `dependencies`）、`writeProfileBundles`（`:1188`）与 post-pnpm 对账（`:1215-1220`）。

**陈旧风险**：手改 `package.json` 而没跑 pnpm 时，`bundles` 与实际 `node_modules` 会不一致；以 `pluginManager/listBundles` 的 `installed`/`availability` 为准更可靠。

### 5.4 凭据（**只在必要时读，且会拿到明文**）

`dsh/node_modules/@deepseek-ai/dsh-credentials-local/README.md`：默认 `<harness home>/.credentials.yaml`，`watch` 默认 true。

```yaml
version: 1
refs:                      # 明文密钥，按环境变量名索引
  DEEPSEEK_API_KEY: sk-…
records:                   # 按 <owner>/<id>
  <owner>/<id>:
    kind: grant            # 或 api-key
    payload: {…}
```

解析顺序（先命中先用）：存储文件（可写）> 启动环境 > `<invocation cwd>/.env` > `$DSH_HOME/.env`。

> ⚠️ `refs` 里是**明文密钥**。事实 3 要求"绝不看密钥值"——那就用 `credentials/describe`，不要读这个文件。

### 5.5 启动日志

- 致命启动失败：`<DSH_HOME>/logs/startup-<ts>-<uuid>.log`，`writeFile(..., {flag:"wx", mode:384})`，内容 = 一行警告（"Raw diagnostics may contain configuration or credential values from plugin errors."）+ `util.inspect({timestamp, dshVersion, nodeVersion, platform, arch, profile, error}, {depth:null,…})`。证据 `dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:158-194`。
- 非致命（可选条目未激活）：**只到 stderr，不落盘**——`dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:4474` `warn(activationDiagnostic(binName, failures))`，`:4408-4411` 文本 `"<binName>: warning: N entries did not activate\n<id> (<module>): <detail>\n"`。
- 插件自己的 JSONL（matt 的 `<cwd>/.dsh-<plugin>-cache/logs/`）是**插件行为**，不是宿主契约，宿主升级不会保证其格式。

### 5.6 settings.yaml 不是真相

`dsh/node_modules/@deepseek-ai/dsh-settings/README.md`：home 里的旧 `settings.yaml` 在 settle 后**只导入一次**，随后改名为 `settings.yaml.imported`；被拒的段只留在改名文件里。"Home patches and command-line overlays take precedence; a form write that they would override is refused." 实时值 = `<profile>/cordis.patch.yml` 的条目 `config`，或直接问 `settings/describe`。

---

## 六、给实施者的建议

### 6.1 该用

1. **主通道 = HTTP**。一次性握手机：

```js
// 1) 抓 stdout：/^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]{43})$/m
// 2) 换 cookie（redirect 必须 manual：/connect 的 302 指向 ./api/remote.mux）
const connectUrl = new URL(url); connectUrl.pathname = '/connect';   // 保留 token 查询参数
const conn = await fetch(connectUrl, { redirect: 'manual' });
const cookie = (conn.headers.getSetCookie?.() ?? [conn.headers.get('set-cookie')])[0].split(';')[0];
const authority = new URL(url).host;
// 3) 调用
async function rpc(endpoint, payload = {}) {
  const res = await fetch(`http://${authority}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: `http://${authority}` },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload }),
  });
  const body = await res.json();                 // 数据在 body.result.value
  if (!body.result.ok) throw new Error(`${body.result.error.code}: ${body.result.error.message}`);
  return body.result.value;
}
```

2. **事实 5 只用两件事判定**：stdout 出现 `dsh web: …`（= loader settle + 审计通过）+ `pluginInventory/list` 里预期条目全部 `fiberPhase === "active"`。**不要**用"端口应答"或"HTTP 401/404"判 ready。
3. **事实 3 用三件套**：`session/modelCatalog`（有哪些）+ `settings/describe`（配成什么，`secrets[].set` 是否就位）+ `credentials/describe({refs})`（引用解析得到吗）。跨条引用一致性（如 vision-router 里写的模型名 vs provider 声明）就从 `settings/describe` 各 namespace 的 `value` 里取字段，与 `modelCatalog.groups[].models[].id` 比对——**全程不碰密钥**。
4. **事实 4 用 `pluginManager/listBundles` + `pluginInventory/list`**，分别回答"profile 声明装了什么"与"Loader 真的加载了什么"。
5. **事实 1 的哈希**老实算文件：`<profile>/node_modules/<pkg>/lib/client.js` 的 sha256；版本用 `listBundles[].version` 交叉验证。
6. **事实 2 若真需要完整集合，最优解是自己开端点**（我们本来就在写插件）：host 侧 `@Remote` 一个只读方法，内部 `const snap = await ctx.skills.snapshot({ cwd })`（`dsh/node_modules/@deepseek-ai/dsh-skill/lib/index.js:234-240`），返回 `snap.skills`（每项含 `source`、`provider`、`invocation`）+ `snap.complete`；rank 用 §5.2 的常量表按 `source` 映射。这比文件枚举更接近"宿主的真实视图"，且能拿到 `skills/list` 过滤掉的项。代价：要改我们自己的插件，且依赖 `ctx.skills` 这个服务名不被改。

### 6.2 该避

- **别读 `.credentials.yaml`**：里面是明文密钥，`credentials/describe` 已能满足"引用名 + 是否配好"。
- **别用 `llm/discoverModels` 做验证**：参数里有 `apiKey` 且会发网络请求。
- **别用 `pluginManager/inspect` 验证"已装"**：它解析的是待安装 spec，可能联网，且返回 `status:"accepted"` 只代表 spec 合法。
- **别把 `--dump-config` 当只读**：它会新建 profile 并重写 `cordis.yml`。
- **别直接连 `/api/remote.mux`**：那是流式通道，需要 WS + Ping 心跳；unary 端点不需要它。
- **别用 `commands/list` 代替 `skills/list`**：前者是 `/命令` 目录。
- **别碰 `/inspector/devtools/cdp`**：那是进宿主 Node 进程的 CDP 代理，只读工具没有理由碰它。

### 6.3 每条断言的置信度与"下次升级要复查"

| 断言 | 置信 | 升级时复查点 |
|---|---|---|
| 只有 `/api` 一个通道 | 高 | `dsh-client-connection/lib/index.js` 的 `registerInterceptor` 里 `channel !== "/api"` 的断言是否还在 |
| 响应在 `result.value` | 高 | `client-connection/lib/index.js` 的 `clientRequestSchema`/`serverResponseSchema` |
| `skills/list` 过滤 `isUserInvocable` | 高 | `dsh-api-session-controller/lib/types/skill-catalog.js` 的 `.filter(isUserInvocable)` |
| rank 常量 100/200/300/400/500/600 | 中高 | `dsh-skill-filesystem/lib/index.js` 顶部常量（**最容易变的一条**） |
| 版本号 `0.2.1-rc.3` | 高 | `dsh/node_modules/@deepseek-ai/dsh-app-boot/package.json` |
| `--dump-config` 会写 `cordis.yml` | 高 | `dsh/lib/profile-boot-*.js` 的 `prepareProfile`（文件名带 hash，会变） |

> 实用提示：descriptor 里每条端点都带 `sourceLocation`（如 `{"file":"packages/api/settings-controller/src/index.ts","line":98,"column":3}`），升级后可以按这个原始路径去对。

---

## 七、未解问题

1. **"27 条里 16 条隐藏"到底是哪个方向？**
   - 若被隐藏的是 `user-invocable: false` → `skills/list` 拿不到，必须文件枚举或插件开端点。
   - 若是 `model-invocable: false`（模型看不见、用户能调）→ 它们在 `skills/list` 里，只是 `modelInvocable:false`。
   - **定论证据**：在一个隔离实例上 `POST /api/skills/list {sessionId}`，数 `skills.length`；与 `ctx.skills.snapshot()`（插件侧日志打一行 `skills.length` + 各 `invocation`）对比。

2. **冷启动实例能否"只读地"拿到 sessionId？**
   `skills/list` 需要 `sessionId`（`typert.host.js:1217-1219`），而它内部要 `observeSession` 给出 projections（`skill-catalog.js:125-128`），否则抛 `skill catalog requires a projected Session observation`。全新 `DSH_HOME` 可能一条 session 都没有 → 只能 `session/create`（写盘）。
   - **定论证据**：空 home 起实例 → `session/list` 看 `items.length`；若为 0，再测 `session/create` 后 `skills/list` 是否立刻可用、以及 `session/create` 生成了哪些文件。

3. **`settings/describe` 的 `value` 会不会漏明文？**
   schema 声称 redacted（"the value itself never rides"），但没读到 redaction 实现。
   - **定论证据**：在隔离实例写入一个可识别的假密钥，然后 `settings/describe`，grep 返回体里有没有那个字符串。

4. **`pluginManager/listBundles[].version` 与 `node_modules/<pkg>/package.json.version` 何时会不一致？**
   前者来自 profile 清单/安装产物，后者是磁盘真相。手改或半途失败的 pnpm 可能让两者分叉。
   - **定论证据**：构造"删 `node_modules/<pkg>` 但不改 `package.json`"的实例，看 `availability`、`installed`、`version` 各自怎么变。

5. **`interactions=none` 的 peer 会不会因为长期不用被回收？**
   README 明说不会主动回收（`client-connection/README.md:82`），但这是文档承诺而非代码断言。
   - **定论证据**：`/connect` 后不建 WS，隔 30 分钟再发一次 unary 请求，看是否 401。

6. **是否有未注册进 `typert` 描述符的隐藏端点？**
   本次靠"29 个 `typert.host.js` + 11 个 `webServer.register` 调用点"枚举。若有包用动态路径或自建 HTTP server，会漏。
   - **定论证据**：起实例后遍历 `ctx.webServer` 的路由表（需插件，或读 `--expose-internals` 下的 internals），与本次清单做差集。

7. **会话级 `modelSelection.next` 与 `settings/describe` 里的默认模型谁是"实际生效"？**
   两者语义不同（会话覆盖 vs 部署默认），`modelCatalog.default` 是第三个来源。
   - **定论证据**：改 `agent-default-model` 条目 → 重启 → 对比 `modelCatalog.default`、`settings/describe('llm-deepseek')`、`session/list[].projections.values.modelSelection.next` 三者。
