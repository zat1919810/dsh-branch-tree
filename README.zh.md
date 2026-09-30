# dsh-branch-tree — DSH 对话分支

> 英文版（发布到 npm 的主 README）：[README.md](README.md)

在 DSH 的 Web/桌面界面上把"对话"变成**可分叉的树**：从主对话的任意一轮开出一个分支，
分支自动继承分叉点之前的全部上下文，同级分支互不影响，分支还能继续开分支。

## 它做了什么

DSH 内核其实**已经有**开分支的原语，只是之前没有面向人的入口：

| 内核已有能力 | 位置 |
| --- | --- |
| `session.fork`：把源会话的某个事件前缀原样复制成一个新会话 | `SessionStore.fork(source, boundary, childSessionId)` |
| 血缘落盘：子会话 header 带 `parentSession`、`isSeeded: true` | `SessionHeader` |
| 隔离性：分支是各自独立的会话日志，同级分支天然看不到对方 | 会话存储模型 |
| 分支列表投影：`flattenLineage` 已算出每个会话的层级 `depth`（但界面没用它） | `dsh-client-runtime` |

之前界面上只有一个"分支"图标动作，挂在**最后一轮**助手消息的操作条里（`branchUnavailable`
在它后面还有内容时直接置灰），所以实际上你只能在对话末尾分叉。

本插件补上缺的那层：

1. **会话头部「分支」导航器**（`conversation.session.header.utilities`）
   - 展开后是一棵分支树：主干 / 各级分支，按 `depth` 缩进并画引导线，标出当前所在分支；
   - 点任意一行即可切过去；每行悬停出现四个动作：**打开 / 重命名 / 在此再开分支 / 删除**；
   - 「新分支」在当前对话末尾开一个新分支，**不会把你从当前对话拽走** —— 面板里出现
     "已创建分支：…" 的提示条，想进去再点「打开」；
   - 删除走的是**归档**（`archiveSession`，可恢复），两步确认；删掉自己所在的分支会自动落到父分支。

2. **每轮对话尾部的「从此处分支」**（`conversation.chat.turnTail`）
   - 出现在**每一轮**已完成的对话尾部，不只是最后一轮 —— 所以你可以回到第 3 轮分叉重问；
   - 展开后可以在分叉点直接输入问题：「分支并提问」= 建分支 + 切过去 + 把问题发出去；
   - 「只开分支」= 建分支但不切走。

3. **侧边栏分支标记 + 真缩进 + 折叠**（`sidebar.session.row.leading` + `sidebar.session.row.hover`）
   - 有父会话的行前面出现一个 ⑂ 标记，悬停卡片里多一行血缘（"分支自：<父标题>"+ 同级分支数）；
   - **有下级分支的行前面是一个折叠箭头**（▸ 收起 / ▾ 展开），**和面板共用同一份折叠状态**：
     在哪边收起，另一边跟着收起；
   - **分支行按层级真缩进**（每级 16px）并画一条竖引导线，主对话与分支在侧边栏一眼可辨。

4. **轮次树**（面板内，数据来自应用自带的 `turnOutline` 投影）
   - 列出当前分支的**每一轮**：`#N` + 该轮提示词的预览（应用自己的归一化预览，就是"轮的默认名称"）；
   - 点整行 = **跳到那一轮**：见下方"跳转怎么做到精确"；
   - 每行 `✎` = **自定义轮名**（本地覆盖，见下方说明）；`⑂` = **从这一轮的末尾开分支**；
   - `⑂` 用的切点是**精确**的：`turnOutline` 给的是该轮 `turn/start` 的 seq，而宿主 `atSeq` 是
     inclusive 的，所以"第 N 轮末尾"= **下一轮的 start seq − 1**；最后一轮不给锚点，交给宿主取
     "最后一个已完成的轮"，因此**永远不会切进正在跑的那一轮**。

### 跳转怎么做到精确

应用的对话界面**没有给每一轮留 DOM 锚点**（我核对了应用自带产物：只有 `data-conversation-scroll`
滚动容器），也没有公开的"滚动到第 N 轮"接口。所以插件**自己造锚点**：

本插件本来就往**每一轮已完成的尾巴**里挂了一个控件（`conversation.chat.turnTail` 的「从此处分支」），
它的 owner currency 里带 `turn: TurnLocation` —— 于是那个组件在挂载时把**自己的 DOM 元素**登记到
`turn → element` 的表里，卸载时注销。点轮次时的顺序是：

1. **锚点命中** → `scrollIntoView({block:'center'})`，精确；
2. 没有锚点（该轮还分页在外，或者 markdown 把提示词拆了节点）→ 退回到**只在滚动容器内部**的文本前缀查找；
3. 请求的是**最后一轮**（还在跑，没有尾巴也就没有锚点）→ 滚到对话末尾，并明确告诉你；
4. 都没有 → 直说"这一轮还没加载到当前视图里"。



> **缩进是怎么做到的（以及代价）**：会话列表的行布局属于应用自带的工作区插件，
> `--dsh-workspace-indent` 那个 `depth` 是**工作区**层级，不是会话血缘；插件没有能改行布局的槽位。
> 所以我走的是应用自带的 DOM 钩子：每个会话行带 `data-row-key="session:<id>"`（在应用自带产物里读到的），
> 我据此找到行元素，只写两样东西——`padding-left` 和一条 `--dbt-guide` 引导线。要点：
> - **只动有血缘的行**：根行（`depth === 0`）完全不被触碰，保持应用原样；
> - **找不到钩子就等于没有这个功能**，不会把行改坏；
> - 列表是虚拟滚动的（会复用行、换 `data-row-key`），所以用一个 `MutationObserver`
>   把变更合并到一帧里处理，并在卸载时把改过的行**全部还原**。
> - 代价：这依赖应用自带的 DOM 属性，**将来升级若改了属性名，缩进会静默失效**（其余功能不受影响）。


### 子代理会话不算分支（但"子代理的分支"算）

子代理（以及 workflow 子会话）**和 fork 子会话一样带 `parentSession` 血缘**，所以只要按血缘
遍历就会把"You are researching…"这类委派会话混进分支树里。插件把它们排除掉，规则是：

1. `row.origin === 'subagent'` —— 运行中的客户端自己就是用这条判定的；
2. id 是**裸 UUID**（`^[0-9a-f]{8}-…$`）—— 这台机器上委派会话的真实形状；普通会话和 fork 子会话
   都是 `session-<uuid>` / `session-<n>`。

第二条刻意收窄：只有"明确不是普通会话"的 id 才被排除，因为**漏掉一个子代理只是多一行，误藏一个
真分支才是真 bug**。排除同时作用于：分支树、`⑂N` 编号（子代理不占号）、侧边栏的 ⑂ 标记与血缘行。

**但"在看子代理时开的分支"必须仍然算分支。** 这是落盘数据里真实存在的一种形状：

```
主对话
├── 子代理（DELEGATED，侧边栏里不是普通行）
│   └── session-…   ← 在看子代理时点的"开分支"，标题继承了子代理的名字
└── 另一个分支
```

如果按**原始**父级建树，这个分支的父级是委派会话 → 它就会**从树里消失**（我第一版就是这样，
面板少算了一个分支），在侧边栏里也会看起来"挂在一个看不见的父级下"。所以树、缩进、血缘、
编号全部按**最近的非委派祖先**（`visibleParentOf`）计算：这个分支会正常挂在主对话下面、
计入编号、血缘写"分支自：<主对话>"。而**从子代理开新分支**时，编号用的是**子代理自己的子级计数**
和它自己的标题，所以同一个子代理的多个分支仍然连号、可区分。


### 收起 / 展开（级联是结构保证的，不靠状态同步）

- 每个**有下级**的行左侧有折叠箭头（▸ 收起 / ▾ 展开），叶子行没有箭头（留同宽占位，标签不会错位）；
- 面板标题栏有一个**全部收起 / 全部展开**按钮；收起时标题旁显示 `-N`（当前一共藏了多少个下级分支）；
- 收起后的行右侧用**虚线标签**显示它藏了几个分支（和展开时 `+n` 的实心标签区分开）；
- 如果被收起的分支里**包含你当前所在的分支**，那一行会显示 `含当前`，否则树看起来会像"当前分支不见了"；
- 折叠状态**按家族（血缘根）记忆**：在同一条对话的各分支间来回切换，树的形状不会被重置。
  切换会话会让头部组件重新挂载，所以这份记忆放在模块级而不是组件状态里。

**级联为什么不会出 bug**：可见行是**自顶向下**生成的——遇到收起的行就**直接不再输出它的任何后代**。
所以"收起了第 1 级、第 3 级却还挂着"这种悬空孙代**在结构上不可能发生**，与更深层行自己的折叠标记无关
（那些标记在父级收起期间根本不参与计算）。测试里对这一点是专门的断言：
收起内层、收起顶层、**两层同时收起**、收起根、以及"叶子节点声称自己收起"都覆盖了。

### 侧边栏行的顺序：应用是"分支插在来源之上"

应用自带的列表排序（`ui-workspace` 的 `placeFork`）是这样的：

```js
const placeFork = (id) => {
  placeFork(parentId);                                  // 递归：先摆父级
  result.splice(result.indexOf(id), 1);
  result.splice(result.indexOf(parentId), 0, id);        // 再把子级插到父级【前面】
};
for (const id of [...ordinary].reverse()) placeFork(id);
```

基础顺序是**活跃时间（新的在上）**，然后每个分支被插到**它的来源之上**，而且**递归**执行 ——
所以父级会沉到整组的最下面、越深的分支越靠上，同级里新的更靠上。这是应用的设计，不是 bug。

插件给了一个**可切换的树序**（默认开）：父在上，紧跟着它的各级子分支（深度优先），
**根之间保持应用的时间顺序不变**。实现在 `treeOrder`（纯函数，幂等：已排好的列表原样返回，
所以每帧重放不会抖动），由侧边栏引擎在**只属于会话行的那些槽位**里就地重排 ——
分组标题、"更多"行等非会话行一律不动。面板底部有一行开关可以在
「树状（父在上）」和「应用默认（分支在来源上方）」之间切换，选择记在 `localStorage`。

> 代价：那棵列表由应用自己的 React 协调拥有，所以应用每次重绘会先按它的顺序落一次 DOM，
> 引擎在**下一帧**再校正回来 —— 列表有更新时可能看到一瞬的顺序跳变，稳定后始终是树序。
> 不想接受这一点就切回「应用默认」。

### `⑂N` 后缀不会被截断吃掉


分支标题形如 `<源标题> ⑂3`，而两条同级分支**唯一的区别就是末尾那个 `⑂N`** —— 一旦标题过长，
省略号最先吃掉的就是它，结果一排分支看起来一模一样。所以面板会把 `⑂N` **拆成独立的固定宽标签**
渲染在标题右侧，标题本体才参与省略（`splitBranchTitle`）。

## 语义与保证

- **继承**：分支复制的是分叉点（那一轮结束处）之前的完整会话前缀，所以"讨论马克思主义"
  的上下文会被完整带入分支。
- **隔离**：每个分支是独立会话日志。同级分支之间没有通道；分支只会被自己祖先的内容影响。
- **可嵌套**：在分支里再开分支，就得到 `主干 → 分支 → 分支的分支`，深度不受限。
- **不破坏原对话**：开分支不改动源会话，只是复制。
- **命名**：分支标题固定为 `<源标题> ⑂N`（N 是该源会话已有的子分支序号），方便在树里区分。
  标题被显式设定后会固定，不再被自动标题覆盖。

## 安装（分发给别人）

本包同时是一个 **bundle**：它自带 `cordis.patch.yml`（里面只有它自己的那一行
`- insert: [id: ui-branch-tree, name: dsh-branch-tree]`），并在 `package.json` 里声明
`dsh.bundle.patch`。所以**装包 + 选中 bundle 就够了，不需要别人手改 profile 的 patch**。

三种装法（DSH 的插件管理器都支持）：

| 来源 | spec |
| --- | --- |
| npm | `dsh-branch-tree` |
| GitHub 仓库 | `<owner>/<repo>` |
| 本地 tarball | `./dsh-branch-tree-1.0.0.tgz` |

入口：Web 侧边栏 → **Plugins** 页，或 `dsh plugin install <spec>`。插件管理器会在装之前
**校验包声明的 `@deepseek-ai/dsh*` peer 版本**，不匹配就直接拒绝、不下载也不跑任何脚本；
真要放行只能在 profile 的 `compatibility.json` 里写**精确版本豁免**（有风险，会警告）。

手动装进某个 profile（`~/.dsh/profiles/<profile>`）：

```bash
pnpm add dsh-branch-tree
```

然后把 `"dsh-branch-tree"` 加进该 profile `package.json` 的 `dsh.profile.bundles` 并重启；
或者退一步，直接在 profile 的 `cordis.patch.yml` 里加那一行 `- insert:`。

**版本要求**：`package.json` 里声明了 `@deepseek-ai/dsh` 的 peer 范围（`^0.2.0-rc.2 || ^0.1.0-rc.8`）。
`0.2.0-rc.2` 是实测过的运行时；`0.1.0-rc.8` 那代只做了代码级回退、没有实测。
**没有构建步骤、没有运行时依赖**：浏览器半边是手写的 bundle，只 require 内核自带（shell-seeded）的 React。

## 手动安装与本地开发（不走 bundle 时）

如果不想用插件管理器，可以手动装进某个 profile（下面用 `~/.dsh/profiles/<profile>` 表示）：

| 项 | 值 |
| --- | --- |
| 插件包 | `~/.dsh/profiles/node_modules/dsh-branch-tree/` |
| loader 条目 | `~/.dsh/profiles/<profile>/cordis.patch.yml` 末尾 `- id: ui-branch-tree` |

> 这种方式是**手动安装**（包放进 profile 的 `node_modules` + 手写 patch 行）。
> 包已经具备 bundle 元数据，随时可以改成正式安装（见上文"安装"）。

包内结构：

```
dsh-branch-tree/
  package.json       # dsh.client（browser 半边）+ dsh.bundle（自带 loader patch）
  cordis.patch.yml   # bundle patch：只插入本插件自己那一行
  lib/index.js       # node 半边：空 apply，只为了让包出现在 Loader 里
  lib/client.js      # 浏览器半边：手写的 __ModuleLoader__ 工厂 bundle，无需构建步骤
  test/family.test.mjs  # 纯投影逻辑的断言（12 组），node 直接跑
  tools/             # 维护用工具：读 asar / 解会话日志 / 还原血缘树
```

## 更新插件代码（本地开发循环）

改 `lib/client.js` 后：

```bash
npm run check     # node --check lib/client.js && node test/family.test.mjs
```

装到正在运行的 profile 里（把 `<profile>` 换成你的 profile 名）：

```bash
cp lib/client.js ~/.dsh/profiles/node_modules/dsh-branch-tree/lib/client.js
```

宿主侧的 `clientModules` 会检测到 bundle 变化并把新版本推给浏览器；
实测无需重启 DSH 进程。若界面没更新，刷新一次页面即可。

## 关闭 / 回滚

- **只关界面**：删掉 patch 里的 `- insert:` 那段（`ui-branch-tree`），
  包体留在 `node_modules` 不影响任何东西；插件管理器里取消选中 bundle 同理。
- **完全卸载**：再删掉 `~/.dsh/profiles/node_modules/dsh-branch-tree/`。
- 备份：安装时的原始配置在 `cordis.patch.yml.bak-branch-<时间戳>`。

## 已知边界

- **轮名只存在本地浏览器**：会话日志里没有"轮的标题"这种东西，所以自定义轮名是**表现层覆盖**，
  存在 `localStorage`（key 为 `dsh-branch-tree:turn-names:<sessionId>`）。换浏览器/清缓存就没了；
  想要跨设备持久，需要加一个宿主侧落盘（我的 node 半边现在还是空的，可以扩）。
  未自定义时显示的是应用 `turnOutline` 投影给的提示词预览。
- **"跳到某一轮"先走精确锚点**：插件在每轮尾巴登记自己的元素（见"跳转怎么做到精确"），
  锚点不在时才退回到**只在滚动容器内部**的文本前缀查找（20 字→8 字）；再退到"滚到末尾"或
  "这一轮还没加载"。所以**已经加载并已结束的轮**是精确跳转；分页在外的老轮需要先翻到它。
- **侧边栏折叠不会隐藏你当前所在的行**（否则"我在哪"就丢了）；代价是当前行所在的子树也会保持可见。
- **切点是精确事件序号**：`atSeq` 是 inclusive 的 seq，宿主把 `events[0..atSeq]` 原样复制，
  任意**已存在**的 seq 都是合法切点；切口落在一轮中间时会由宿主补上合成的 step/turn 收尾
  （`buildForkSeed` + `openTurnClosers(..., {kind:'forked'})`）。界面暴露的切点是**轮级**的
  （每轮尾部的「从此处分支」+ 轮树里的 `⑂`）；轮内部的消息级切点宿主支持，但界面还没做。
- **省略 `atSeq`（"新分支"按钮）选的是"最后一个已结束的轮"**：如果当前这轮还在生成中，
  尾部开分支会切到上一个已结束的轮，而不是"到目前为止的全部"。这轮跑完后才是完整尾部。
- 分支的**模型选择**沿用宿主默认策略；如果原对话手动切过模型，分支不保证跟着切。
- 分支是**独立会话**，会各自计费、各自跑各自的回合。

## 重要：profile 里的包 ≠ 正在运行的客户端这台机器上有一个必须先知道的坑，否则插件必然写错：

- `profiles/node_modules/@deepseek-ai/*` 里是 **rc.8 的源码**（`dsh-client-ui-conversation`、
  `dsh-client-runtime` 等都在），我最初就是照它写的。
- 但**浏览器里真正跑的是应用自带的 baseline 产物**（比 rc.8 新）。`clientModules` 对每个
  插件都有 `artifactBaseline(id)`：基线存在就用应用自带的 bundle，只有本地包被改动过才用
  本地文件。所以我这个**新包**（没有基线）走的是我自己的 `lib/client.js`，而别的插件走的是
  应用自带的更新版本。

两代 API 的差别（实测，来源是 `cordis_inspect_query` 的 client / `Service` 目录，
**这才是权威**，不是源码）：

| 能力 | rc.8 源码（旧） | 运行中（新） |
| --- | --- | --- |
| 切换当前会话 | `sessions.open(id)` | `uiWorkspace.openSession(target)`，`sessions` 里**没有** `open` |
| 在尾部开分支 | `sessions.fork({increaseTitle}).then(id => open(id))` | `uiWorkspace.forkSession(sessionId, onCreated?)` |
| 会话列表 | `sessions.list.getSnapshot()` | `sessions` 上**没有** `list`，列表只通过槽位的 `useSessions` 标准 prop 暴露 |
| 拿到某会话的 face | `sessions.binding(id)` | 需要先 `retain`/`using`，`binding(id)` 只对已保留的世代有效 |

因此插件里的每一处能力都是**调用时解析 + 逐级回退**（`uiWorkspace.openSession` → `sessions.open`；
`uiWorkspace.forkSession` → `sessions.fork` + `openSession`；`sessions.using` → `sessions.binding`），
并且在两代上都能工作。

调试提示：要确认"正在运行的客户端到底有什么服务/方法"，用
`cordis_inspect_query`（platform=client, provider=Service），不要读 `profiles/node_modules` 里的源码。

## 作者与来源

本插件**完全由 AI 写成**：在一个 DeepSeek Harness 会话里，由人提出需求、验收，AI 完成全部代码，
**没有经过人工逐行审查**。请据此评估：

- 本文档里的行为都在**运行中的 DSH 上实测过**，纯逻辑部分有随包断言（`npm test`，12 组）；
- 最不确定的是**依赖应用自带 UI 的那几处**：`data-row-key` 侧边栏钩子、侧边栏重排/折叠引擎、
  以及"点轮跳转"的文本兜底 —— **DSH 升级后最需要跟着检查的就是这些**。

欢迎提 issue 和 PR。

## 许可：纯 MIT（真开源）

`LICENSE` 是标准的 **MIT**，版权人 `zat`。可以用、读、改、再分发，**包括商业用途**，
唯一条件是保留版权声明。

有一点必须说明白：MIT 同时**授予了"卖"的权利**（原文里就写着 *"and/or sell copies of the
Software"*）。如果你希望"谁也不许卖"，做法是在 MIT 正文后面追加
[Commons Clause](https://commonsclause.com/) —— 但那是一个**取舍**：一旦加上"不许卖"，
按 OSI 的《开源定义》它**就不再算开源**（定义要求不得限制使用领域），只能叫 source-available，
部分公司白名单和发行版会因此拒绝。本项目选择**纯 MIT**，就是为了保持真开源、谁都能打包带走。

如果你后来改主意想加回 Commons Clause，改 `LICENSE` 一个文件即可（MIT 正文不用动，后面接一段条款）。

DSH 本身是 MIT 许可，本项目是**非官方插件**，与其无隶属关系。


