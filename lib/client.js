//#region dsh-branch-tree client half
/**
 * Conversation branching for DSH, browser half.
 *
 * The Host already owns every primitive this surface needs:
 *   - `session.fork` cuts an exact inclusive event prefix of a source session
 *     into a new durable session carrying `parentSession` lineage
 *     (`isSeeded: true`); an open cut is balanced Host-side with synthetic
 *     step/turn closers, so ANY existing seq is a legal cut;
 *   - sibling branches are separate session logs, so they can never see each
 *     other — only a branch's own ancestors' copied prefix reaches it;
 *   - a branch's session face reaches a turn through
 *     `sessions.retain`/`using` (or `binding` on older generations).
 *
 * This plugin adds the presentation layer: a branch-tree navigator in the
 * session header (open / rename / delete / branch-again), a per-turn
 * "branch from here (and ask)" control in the turn tail, and lineage marks on
 * the sidebar's session rows.
 *
 * TWO CLIENT GENERATIONS ARE IN THE WILD, so every capability is resolved at
 * CALL time and each verb has a fallback:
 *   - selecting a session: `uiWorkspace.openSession` (current) | `sessions.open`;
 *   - reaching a face: `sessions.using` (current) | `sessions.binding`;
 *   - removing a branch: `uiWorkspace.archiveSession` | `workspaces.archiveSession`.
 * The session LIST is never read from a service (the current `sessions` face has
 * no `list`): it arrives as the standard `useSessions` slot prop.
 */
window.__ModuleLoader__.load({
	id: "dsh-branch-tree",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;
		const NS = "branchTree";

		//#region styles
		// Design scale: spacing 4/6/8/12, radii 6/8/10/14, type 13/12/11.
		// Colour comes from the shell's theme tokens with neutral-alpha fallbacks, so
		// the panel reads correctly in both the light and dark themes. Numeric chips
		// use the mono token so branch and turn numbers stay column-aligned.
		const css = `
.dbt_root{position:relative;display:inline-flex;align-items:center}
.dbt_trigger{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:3px 9px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);font-size:12px;line-height:18px;cursor:pointer}
.dbt_trigger:hover{color:var(--dsw-alias-label-primary,#111);background:rgba(127,127,127,.10)}
.dbt_triggerActive{color:var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.10)}
.dbt_triggerDot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe)}
.dbt_glyph{flex:none;opacity:.85}

/* Panel: fixed header + scrolling body, so the header controls never scroll away. */
.dbt_panel{position:absolute;top:calc(100% + 6px);right:0;z-index:120;box-sizing:border-box;display:flex;flex-direction:column;width:360px;max-width:min(400px,100vw - 32px);max-height:min(520px,74vh);overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);border-radius:14px;background:var(--dsw-alias-bg-overlay,#fff);box-shadow:0 18px 44px rgba(0,0,0,.22)}
.dbt_panelHead{flex:none;display:flex;align-items:center;gap:6px;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#e4e4e4)}
.dbt_panelTitle{flex:1;min-width:0;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#6b6b6b)}
.dbt_count{flex:none;padding:0 6px;border-radius:6px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary,#6b6b6b);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,monospace)}
.dbt_body{flex:1;min-height:0;overflow:auto;padding:6px 8px 8px;--dsh-scrollbar-thumb:var(--dsw-alias-border-l2,#d0d0d0);--dsh-scrollbar-thumb-hover:var(--dsw-alias-label-secondary,#6b6b6b)}
.dbt_newBtn{flex:none;display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid var(--dsw-alias-border-l1,#e4e4e4);border-radius:8px;background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);font-size:12px;line-height:18px;cursor:pointer}
.dbt_newBtn:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.08)}
.dbt_newBtn:disabled{opacity:.45;cursor:default}

/* Rows */
.dbt_list{list-style:none;margin:0;padding:0}
.dbt_li{position:relative}
.dbt_row{display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;min-height:32px;padding:4px 7px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary,#111);font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dbt_row:hover{background:rgba(127,127,127,.09)}
.dbt_rowCurrent{background:rgba(77,107,254,.10);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary,#4d6bfe)}
.dbt_rowCurrent:hover{background:rgba(77,107,254,.14)}
.dbt_guide{flex:none;width:10px;align-self:stretch;border-left:1px solid var(--dsw-alias-border-l1,#e4e4e4);opacity:.75}
.dbt_rowTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dbt_rowCurrent .dbt_rowTitle{font-weight:600}
.dbt_rowTitleNamed{color:var(--dsw-alias-brand-primary,#4d6bfe)}

/* Chips */
.dbt_tag{flex:none;padding:0 6px;border-radius:6px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary,#6b6b6b);font-size:11px;line-height:16px}
.dbt_tagDepth,.dbt_tagBranch,.dbt_tagTurn{font-variant-numeric:tabular-nums;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,monospace)}
.dbt_tagRoot{background:rgba(77,107,254,.16);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dbt_tagBranch{flex:none;background:rgba(77,107,254,.14);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dbt_tagInside{flex:none;background:rgba(77,107,254,.14);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dbt_tagHidden{flex:none;background:transparent;border:1px dashed var(--dsw-alias-border-l2,#d0d0d0);color:var(--dsw-alias-label-secondary,#6b6b6b)}
.dbt_dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#22a06b)}

/* Row actions: quiet until the row is engaged. */
.dbt_rowActions{flex:none;display:inline-flex;align-items:center;gap:1px;opacity:0;transition:opacity .12s}
.dbt_row:hover .dbt_rowActions,.dbt_rowCurrent .dbt_rowActions,.dbt_row:focus-within .dbt_rowActions{opacity:1}
.dbt_iconBtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);cursor:pointer}
.dbt_iconBtn:hover{background:rgba(127,127,127,.16);color:var(--dsw-alias-label-primary,#111)}
.dbt_iconBtn:disabled{opacity:.4;cursor:default}
.dbt_iconDanger:hover{background:rgba(217,45,32,.14);color:var(--dsw-alias-state-error-primary,#d92d20)}
.dbt_iconConfirm{width:auto;padding:0 8px;font-size:11px;line-height:20px;color:var(--dsw-alias-state-error-primary,#d92d20);background:rgba(217,45,32,.12)}
.dbt_chevron{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);cursor:pointer;transition:transform .12s}
.dbt_chevron:hover{background:rgba(127,127,127,.16);color:var(--dsw-alias-label-primary,#111)}
.dbt_chevronOpen{transform:rotate(90deg)}
.dbt_chevronSpacer{flex:none;width:18px;height:18px}

/* Inputs */
.dbt_renameInput{flex:1;min-width:0;box-sizing:border-box;padding:2px 7px;border:1px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:7px;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,#111);font-size:13px;line-height:18px;outline:none}
.dbt_input{flex:1;min-width:160px;box-sizing:border-box;padding:5px 9px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);border-radius:8px;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,#111);font-size:13px;line-height:18px;outline:none}
.dbt_input:focus,.dbt_renameInput:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px rgba(77,107,254,.18)}
.dbt_primary{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:0;border-radius:8px;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.dbt_primary:disabled{opacity:.45;cursor:default}

/* Notices, errors, footer */
.dbt_notice{display:flex;align-items:center;gap:8px;margin:2px 0 6px;padding:7px 9px;border:1px solid rgba(77,107,254,.28);border-radius:10px;background:rgba(77,107,254,.08);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#111)}
.dbt_noticeText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dbt_noticeWarn{border-color:rgba(217,45,32,.3);background:rgba(217,45,32,.08)}
.dbt_error{padding:2px 2px 4px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary,#d92d20);word-break:break-word}
.dbt_note{width:100%;padding:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b6b6b)}
.dbt_footer{margin-top:8px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l1,#e4e4e4)}
.dbt_hint{padding:0 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b6b6b)}
.dbt_linkBtn{display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l1,#e4e4e4);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);font-size:11px;line-height:16px;cursor:pointer;text-align:left}
.dbt_linkBtn:hover{border-color:var(--dsw-alias-border-l2,#d0d0d0);color:var(--dsw-alias-label-primary,#111)}

/* Turn section: a labelled divider with its own sticky sub-header. */
.dbt_turnSection{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,#e4e4e4)}
.dbt_turnSection .dbt_panelHead{position:sticky;top:-6px;z-index:1;margin-bottom:2px;padding:4px 2px;border-bottom:0;background:var(--dsw-alias-bg-overlay,#fff)}
.dbt_turnRow{cursor:pointer}
.dbt_tagTurn{flex:none;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary,#6b6b6b)}

/* Turn-tail bar (inside the transcript) */
.dbt_bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:-6px}
.dbt_barButton{display:inline-flex;align-items:center;gap:4px;min-height:26px;padding:2px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);font-size:12px;line-height:18px;cursor:pointer}
.dbt_barButton:hover{color:var(--dsw-alias-label-primary,#111);border-color:var(--dsw-alias-border-l1,#e4e4e4)}
.dbt_barButton:disabled{opacity:.45;cursor:default}
.dbt_barPanel{display:flex;align-items:center;gap:6px;width:100%;padding:6px;border:1px solid var(--dsw-alias-border-l1,#e4e4e4);border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04))}

/* Sidebar seats: one quiet glyph, and a fold control that owns its 16px cell. */
.dbt_mark{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary,#6b6b6b);opacity:.6}
.dbt_markFold{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);cursor:pointer;transition:transform .12s}
.dbt_markFold:hover{background:rgba(127,127,127,.18);color:var(--dsw-alias-label-primary,#111)}
.dbt_markFoldOpen{transform:rotate(90deg)}
.dbt_hoverLine{display:flex;align-items:center;gap:5px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#6b6b6b);max-width:100%}
.dbt_hoverText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Keyboard focus, everywhere this plugin owns a control. */
.dbt_root button:focus-visible,.dbt_body button:focus-visible,.dbt_bar button:focus-visible,[data-dbt-indent] button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}

/* Real indentation for branch rows in the SHIPPED sidebar list. There is no slot
   for row layout, so the engine below stamps two things onto the row element it
   finds through the shipped session-row DOM hook: a padding shift and one
   hairline guide. Absent hook = no styling, never a broken row. */
[data-dbt-indent]{position:relative}
[data-dbt-indent]::before{content:"";position:absolute;top:4px;bottom:4px;left:var(--dbt-guide,0px);width:2px;border-radius:2px;background:var(--dsw-alias-border-l1,#e4e4e4);pointer-events:none}

@media (prefers-reduced-motion: reduce){
.dbt_chevron,.dbt_markFold,.dbt_rowActions{transition:none}
}
`;
		const tagId = "dsh-branch-tree/BranchTree.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-branch-tree";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region locales
		/** Simplified Chinese dictionary (key-set source of truth). */
		const zh = {
			"trigger.label": "分支",
			"trigger.title": "查看对话分支",
			"trigger.pending": "分支中…",
			"trigger.notReady": "分支 (未就绪)",
			"trigger.sibling": "{index}/{total}",
			"panel.title": "对话分支",
			"panel.countTitle": "共 {shown} 个可见分支，另有 {hidden} 个被收起",
			"panel.new": "新分支",
			"panel.newTitle": "在当前对话末尾开一个新分支（不切走）",
			"panel.open": "打开",
			"panel.forkHere": "在此处开分支",
			"panel.rename": "重命名",
			"panel.delete": "删除分支",
			"panel.deleteConfirm": "确认删除",
			"panel.tagRoot": "主干",
			"panel.tagCurrent": "当前",
			"panel.collapse": "收起下级",
			"panel.expand": "展开下级",
			"panel.collapseAll": "全部收起",
			"panel.expandAll": "全部展开",
			"panel.containsCurrent": "含当前",
			"panel.hidden": "已收起 {count} 个下级分支",
			"panel.hint": "同级分支互不影响；每个分支只继承分叉点之前的上下文。删除是归档，可在“已归档”里找回。",
			"notice.created": "已创建分支：{title}",
			"notice.open": "打开",
			"notice.dismiss": "知道了",
			"bar.branch": "从此处分支",
			"bar.placeholder": "在这个分叉点提问…",
			"bar.ask": "分支并提问",
			"bar.only": "只开分支",
			"bar.cancel": "取消",
			"bar.note": "在过去的这一轮开分支：新分支从这一轮结束处复制上下文，原对话不受影响。",
			"mark.title": "分支自：{title}",
			"hover.lineage": "分支自：{title}",
			"hover.siblings": "共 {count} 个同级分支",
			"turn.title": "轮次 · 共 {count} 轮",
			"turn.collapse": "收起轮次",
			"turn.expand": "展开轮次",
			"turn.rename": "重命名这一轮",
			"turn.fork": "从这一轮开分支",
			"turn.untitled": "(无文字提示)",
			"turn.notLoaded": "这一轮还没加载到当前视图里（已尝试文本定位）。向上翻到它、或先从这一轮开分支都可以。",
			"turn.atEnd": "已跳到对话末尾（这一轮还在进行中，没有分叉点）。",
			"remove.stale": "已归档，但应用的列表状态还没刷新：{title}（刷新页面后它就会消失）",
			"error.fork": "开分支失败：{message}",
			"error.rename": "重命名失败：{message}",
			"error.remove": "删除失败：{message}",
			"order.title": "切换侧边栏会话行的排列顺序",
			"order.switchToTree": "侧边栏顺序：树状（父在上）· 点此改回应用默认",
			"order.switchToApp": "侧边栏顺序：应用默认（分支在来源上方）· 点此改成树状",
		};
		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			"trigger.label": "Branches",
			"trigger.title": "Browse conversation branches",
			"trigger.pending": "Branching…",
			"trigger.notReady": "Branches (unavailable)",
			"trigger.sibling": "{index}/{total}",
			"panel.title": "Conversation branches",
			"panel.countTitle": "{shown} branches shown, {hidden} folded away",
			"panel.new": "New branch",
			"panel.newTitle": "Fork a new branch at the end of this conversation (stays here)",
			"panel.open": "Open",
			"panel.forkHere": "Fork from here",
			"panel.rename": "Rename",
			"panel.delete": "Delete branch",
			"panel.deleteConfirm": "Confirm",
			"panel.tagRoot": "root",
			"panel.tagCurrent": "current",
			"panel.collapse": "Collapse children",
			"panel.expand": "Expand children",
			"panel.collapseAll": "Collapse all",
			"panel.expandAll": "Expand all",
			"panel.containsCurrent": "holds current",
			"panel.hidden": "{count} nested branches hidden",
			"panel.hint": "Sibling branches never affect each other; a branch inherits only the context before its fork point. Deletion archives it, recoverable from Archived.",
			"notice.created": "Branch created: {title}",
			"notice.open": "Open",
			"notice.dismiss": "Dismiss",
			"bar.branch": "Fork from here",
			"bar.placeholder": "Ask at this fork point…",
			"bar.ask": "Fork and ask",
			"bar.only": "Fork only",
			"bar.cancel": "Cancel",
			"bar.note": "Forking at a past turn copies the context up to the end of that turn; the original conversation is untouched.",
			"mark.title": "Branched from: {title}",
			"hover.lineage": "Branched from: {title}",
			"hover.siblings": "{count} sibling branches",
			"turn.title": "Turns · {count}",
			"turn.collapse": "Hide turns",
			"turn.expand": "Show turns",
			"turn.rename": "Rename this turn",
			"turn.fork": "Branch from this turn",
			"turn.untitled": "(no text prompt)",
			"turn.notLoaded": "That turn is not loaded in the current view (a text search was attempted). Scroll up to it, or branch from it instead.",
			"turn.atEnd": "Jumped to the end of the conversation (this turn is still running, so it has no fork point).",
			"remove.stale": "Archived, but the app's list state has not refreshed yet: {title} (it disappears after a page refresh)",
			"error.fork": "Fork failed: {message}",
			"error.rename": "Rename failed: {message}",
			"error.remove": "Delete failed: {message}",
			"order.title": "Switch how sidebar session rows are ordered",
			"order.switchToTree": "Sidebar order: tree (parent above) · click for the app default",
			"order.switchToApp": "Sidebar order: app default (fork above source) · click for tree",
		};
		//#endregion

		//#region lineage
		/** Stable empty id list so a store without ids keeps one array identity. */
		const EMPTY_IDS = [];
		/** Stable empty row map for the same reason. */
		const EMPTY_BY_ID = {};

		/** The bare-UUID session id shape this build's delegation children use. */
		const BARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

		/**
		 * Whether a list row is a DELEGATION session rather than a conversation
		 * branch. Subagent (and workflow-child) sessions carry `parentSession`
		 * lineage exactly like a fork child, so a naive family walk mixes them in —
		 * but they are delegation artifacts, not branches the user made.
		 *
		 * The first test is the running client's own (`if (session.origin ===
		 * "subagent") return false`); the second is an observation-backed fallback
		 * narrowed to an UNMISTAKABLE shape: ordinary sessions and fork children are
		 * minted as `session-<uuid>` (or `session-<n>`), while the delegation
		 * children observed in this build carry a bare UUID. The asymmetry is
		 * deliberate — a miss costs one stray row, whereas a loose rule would hide a
		 * real branch — so anything not clearly a bare UUID stays a branch.
		 *
		 * @param id - the row's session id.
		 * @param row - the row's summary, when known.
		 * @returns true when the row is a delegated child.
		 */
		function isDelegated(id, row) {
			if (row !== undefined && row !== null && row.origin === "subagent") return true;
			return typeof id === "string" && BARE_UUID.test(id);
		}

		/** Stable exclusion predicate for the branch views (delegation sessions). */
		const SKIP_DELEGATED = (id, row) => isDelegated(id, row);

		/**
		 * Split a generated branch title into its base and its `⑂N` discriminator,
		 * so presentation can keep the discriminator visible while the (possibly
		 * long) base title truncates.
		 * @param title - the durable title.
		 * @returns the base title and the suffix tag, when the title carries one.
		 */
		function splitBranchTitle(title) {
			if (typeof title !== "string") return { base: "", suffix: null };
			const match = /^(.*?)\s*⑂(\d+)$/.exec(title);
			if (match === null) return { base: title, suffix: null };
			return { base: match[1], suffix: `⑂${match[2]}` };
		}

		/**
		 * The lineage root above one session: the topmost non-delegated ancestor,
		 * or the session itself when it has none. Extracted because BOTH the family
		 * projection and the collapse store need it, and the collapse store must be
		 * keyed by it before any family rows exist (so the two can never disagree).
		 *
		 * @param byId - session summary rows keyed by id.
		 * @param currentId - the session to trace from.
		 * @param skip - optional exclusion predicate (delegation sessions).
		 * @returns the root session id.
		 */
		function rootOf(byId, currentId, skip) {
			try {
				if (byId === null || typeof byId !== "object" || byId[currentId] === undefined) return currentId;
				const excluded = typeof skip === "function" ? skip : isDelegated;
				// Viewing a delegated session keeps it as its own root: the tree must not
				// jump to the conversation that owns the subagent.
				if (excluded(currentId, byId[currentId]) === true) return currentId;
				let root = currentId;
				const seen = new Set([currentId]);
				let cursor = visibleParentOf(byId, currentId);
				while (cursor !== undefined && !seen.has(cursor)) {
					seen.add(cursor);
					root = cursor;
					cursor = visibleParentOf(byId, cursor);
				}
				return root;
			} catch (error) {
				return currentId;
			}
		}

		/**
		 * Build the branch family around one session from the list snapshot.
		 *
		 * The family is the subtree of the current session's ROOT ancestor: every
		 * root, sibling, and descendant is reachable from it, while unrelated
		 * conversations stay out. Row order follows the host list order so the
		 * navigator never re-sorts a hydrated list.
		 * @param ids - host-ordered session ids.
		 * @param byId - session summary rows keyed by id.
		 * @param currentId - the session being viewed.
		 * @param skip - optional predicate excluding a row (delegation sessions).
		 * @param collapsed - optional Set (or array) of ids whose subtrees are
		 *   hidden. A collapsed row emits none of its descendants, so the cascade
		 *   cannot leave an orphaned grandchild behind.
		 * @returns the family rows plus the facts the navigator renders.
		 */
		function familyOf(ids, byId, currentId, skip, collapsed) {
			const empty = {
				rootId: currentId,
				rows: [],
				parentId: undefined,
				siblingTotal: 1,
				siblingIndex: 1,
				hasFamily: false,
			};
			try {
				if (!Array.isArray(ids) || byId === null || typeof byId !== "object") return empty;
				const excluded = typeof skip === "function" ? skip : () => false;
				// A delegated session is not a branch point: leave the navigator quiet
				// rather than showing the delegating conversation's tree under it.
				if (excluded(currentId, byId[currentId]) === true) {
					return {
						...empty,
						rows: byId[currentId] === undefined ? [] : [{
							id: currentId,
							depth: 0,
							title: byId[currentId].displayTitle !== undefined && byId[currentId].displayTitle !== ""
								? byId[currentId].displayTitle
								: byId[currentId].title ?? currentId,
							running: byId[currentId].running === true,
							childCount: 0,
							descendantCount: 0,
							containsCurrent: true,
							collapsed: false,
						}],
					};
				}
				const position = new Map();
				ids.forEach((id, index) => position.set(id, index));
				const parentOf = id => (byId[id] === undefined ? undefined : byId[id].parentId);
				const rootId = rootOf(byId, currentId, excluded);
				const childrenOf = new Map();
				for (const id of ids) {
					if (excluded(id, byId[id]) === true) continue;
					// Edges run over VISIBLE parents, so a branch made while viewing a
					// subagent hangs off the conversation that owns that subagent instead
					// of vanishing (its raw parent is a delegation row that is not in the
					// tree at all).
					const parent = visibleParentOf(byId, id);
					if (parent === undefined) continue;
					const bucket = childrenOf.get(parent);
					if (bucket === undefined) childrenOf.set(parent, [id]);
					else bucket.push(id);
				}
				const sortKids = list => list.slice().sort((left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0));
				// Subtree facts are computed over the FULL tree, independently of
				// collapse state, so a collapsed row can still report how much it
				// hides and whether the current session sits inside it.
				const info = new Map();
				const analyze = id => {
					const cached = info.get(id);
					if (cached !== undefined) return cached;
					// Provisional entry breaks a (pathological) cycle without hanging.
					info.set(id, { descendants: 0, containsCurrent: id === currentId });
					let descendants = 0;
					let containsCurrent = id === currentId;
					for (const kid of childrenOf.get(id) ?? []) {
						const kidInfo = analyze(kid);
						descendants += 1 + kidInfo.descendants;
						if (kidInfo.containsCurrent) containsCurrent = true;
					}
					const facts = { descendants, containsCurrent };
					info.set(id, facts);
					return facts;
				};
				const collapsedSet = collapsed instanceof Set ? collapsed : new Set(Array.isArray(collapsed) ? collapsed : []);
				const rows = [];
				const seen = new Set();
				const walk = (id, depth) => {
					if (seen.has(id)) return;
					seen.add(id);
					const row = byId[id];
					const facts = info.get(id) ?? { descendants: 0, containsCurrent: id === currentId };
					const isCollapsed = collapsedSet.has(id) && facts.descendants > 0;
					rows.push({
						id,
						depth,
						title: row.displayTitle !== undefined && row.displayTitle !== "" ? row.displayTitle : row.title ?? id,
						running: row.running === true,
						childCount: (childrenOf.get(id) ?? []).length,
						descendantCount: facts.descendants,
						containsCurrent: facts.containsCurrent,
						collapsed: isCollapsed,
					});
					// THE CASCADE, by construction: a collapsed row emits none of its
					// descendants, so no grandchild can ever survive its ancestor's
					// collapse — regardless of those rows' own collapse flags.
					if (isCollapsed) return;
					for (const kid of sortKids(childrenOf.get(id) ?? [])) walk(kid, depth + 1);
				};
				if (byId[rootId] !== undefined) {
					analyze(rootId);
					walk(rootId, 0);
				}
				const parentId = visibleParentOf(byId, currentId);
				// Siblings share a VISIBLE parent. A root conversation has none:
				// unrelated roots are separate conversations, never each other's "2/3".
				const siblings = parentId === undefined
					? rows.filter(row => row.id === currentId)
					: rows.filter(row => row.id === currentId || visibleParentOf(byId, row.id) === parentId);
				const index = siblings.findIndex(row => row.id === currentId);
				return {
					rootId,
					rows,
					parentId,
					siblingTotal: siblings.length,
					siblingIndex: index < 0 ? 0 : index + 1,
					hasFamily: rows.length > 1,
				};
			} catch (error) {
				// A projection failure must never take the session header down with it.
				return empty;
			}
		}

		/**
		 * Name a branch after its source so the navigator can tell branches apart:
		 * `<source title> ⑂<n>`, where n counts the source's existing children
		 * (1-based). One suffix at most, so branching a branch stays readable.
		 *
		 * Derived in the component rather than read off a service: the session
		 * list is a standard slot prop (`useSessions`), not part of the sessions
		 * service face, so this works on every runtime generation.
		 *
		 * @param ids - host-ordered session ids from the list snapshot.
		 * @param byId - session summary rows keyed by id.
		 * @param sourceSessionId - the session being forked.
		 * @param skip - optional predicate excluding a row (delegation sessions),
		 *   so a subagent sibling never inflates the branch numbering.
		 * @returns the title to pin on the child, or null when the source is unknown.
		 */
		function childTitleOf(ids, byId, sourceSessionId, skip) {
			try {
				if (!Array.isArray(ids) || byId === null || typeof byId !== "object") return null;
				const source = byId[sourceSessionId];
				if (source === undefined) return null;
				const excluded = typeof skip === "function" ? skip : () => false;
				const raw = source.title !== undefined && source.title !== ""
					? source.title
					: source.displayTitle !== undefined && source.displayTitle !== ""
						? source.displayTitle
						: null;
				if (raw === null) return null;
				// A branch OF A SUBAGENT numbers against that subagent's own children
				// (its siblings share its title, so they must share the counter); every
				// other source numbers against the branch group the tree displays.
				const sourceIsDelegated = excluded(sourceSessionId, source) === true;
				let count = 0;
				for (const id of ids) {
					const row = byId[id];
					if (row === undefined) continue;
					if (excluded(id, row) === true) continue;
					if (sourceIsDelegated) {
						if (row.parentId === sourceSessionId) count++;
					} else if (visibleParentOf(byId, id) === sourceSessionId) count++;
				}
				return `${raw.replace(/ ⑂\d+$/, "")} ⑂${count + 1}`;
			} catch (error) {
				// Naming is cosmetic: an unexpected store shape must not block a fork.
				return null;
			}
		}

		/**
		 * The nearest ancestor that belongs to the CONVERSATION tree: delegation
		 * sessions are walked past, never returned.
		 *
		 * This is what keeps a branch-of-a-subagent from looking orphaned. Forking
		 * while viewing a subagent is legitimate, but the subagent is not a row the
		 * user branches between, so the child must present itself against the
		 * nearest real conversation ancestor instead of a parent it cannot see.
		 *
		 * @param byId - session summary rows keyed by id.
		 * @param id - the session to trace from.
		 * @returns the nearest non-delegated ancestor id, or undefined for a root.
		 */
		function visibleParentOf(byId, id) {
			try {
				if (byId === null || typeof byId !== "object") return undefined;
				const row = byId[id];
				if (row === undefined) return undefined;
				let cursor = row.parentId;
				const seen = new Set([id]);
				while (cursor !== undefined && byId[cursor] !== undefined && !seen.has(cursor)) {
					seen.add(cursor);
					if (isDelegated(cursor, byId[cursor]) !== true) return cursor;
					cursor = byId[cursor].parentId;
				}
				return undefined;
			} catch (error) {
				return undefined;
			}
		}

		/**
		 * How deep a session sits below its lineage root, for indentation.
		 *
		 * Levels are counted over CONVERSATION ancestors only (`visibleParentOf`),
		 * so a branch of a subagent indents under the conversation that owns that
		 * subagent — the row it can actually be seen against. Root (and any
		 * delegated session) is 0. Cycles stop at a guard rather than looping.
		 *
		 * @param byId - session summary rows keyed by id.
		 * @param id - the session to measure.
		 * @returns the indent level, 0 for a root.
		 */
		function depthInList(byId, id) {
			try {
				if (byId === null || typeof byId !== "object") return 0;
				const row = byId[id];
				if (row === undefined || row.parentId === undefined) return 0;
				if (isDelegated(id, row)) return 0;
				let depth = 0;
				const seen = new Set([id]);
				let cursor = visibleParentOf(byId, id);
				while (cursor !== undefined && !seen.has(cursor)) {
					seen.add(cursor);
					depth += 1;
					if (depth >= 8) break;
					cursor = visibleParentOf(byId, cursor);
				}
				return depth;
			} catch (error) {
				return 0;
			}
		}

		/**
		 * Read one row's lineage facts for the sidebar seats.
		 *
		 * The parent reported is the nearest CONVERSATION ancestor, so a branch of a
		 * subagent still names the conversation it belongs to rather than a
		 * delegation session the sidebar never showed as a row.
		 *
		 * @param byId - session summary rows.
		 * @param sessionId - the row's session.
		 * @returns the parent's label and the sibling count, or null for a root or
		 *   a delegated row (a subagent is not a conversation branch).
		 */
		function lineageOf(byId, sessionId) {
			try {
				if (byId === null || typeof byId !== "object") return null;
				const row = byId[sessionId];
				if (row === undefined || isDelegated(sessionId, row)) return null;
				const parentId = visibleParentOf(byId, sessionId);
				if (parentId === undefined) return null;
				const parent = byId[parentId];
				// Siblings are everyone whose VISIBLE parent is the same, which is what
				// makes a branch-of-a-subagent count as a sibling of the conversation's
				// other branches rather than disappearing from the count.
				let siblings = 0;
				for (const id of Object.keys(byId)) {
					const candidate = byId[id];
					if (candidate === undefined || isDelegated(id, candidate)) continue;
					if (visibleParentOf(byId, id) === parentId) siblings++;
				}
				return {
					parentId,
					parentTitle: parent === undefined
						? null
						: parent.title !== undefined && parent.title !== "" ? parent.title : parent.displayTitle ?? null,
					siblings,
				};
			} catch (error) {
				return null;
			}
		}
		//#endregion

		//#region branch actions
		/**
		 * The shared fork/open/rename/remove face handed to every entry this
		 * plugin registers. One in-flight operation at a time is enough for a
		 * human gesture, and the last failure stays readable until the next.
		 * @param ctx - client root context (services are read from it per call).
		 * @returns the action face plus a subscription for in-flight/error state.
		 */
		function createBranchActions(ctx) {
			const listeners = new Set();
			let state = { pending: false, error: null, errorOp: "fork" };
			const publish = next => {
				state = next;
				for (const listener of listeners) listener();
			};
			const fail = (op, error) => {
				const code = error !== undefined && error !== null && typeof error.code === "string" ? `${error.code}: ` : "";
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[dsh-branch-tree] ${op} failed`, error);
				return `${code}${message}`;
			};
			/** The sessions service, or undefined when the composition omits it. */
			const sessionsOf = () => ctx.get("sessions");
			/** Select one session as current through whichever verb exists. */
			function select(id) {
				const uiWorkspace = ctx.get("uiWorkspace");
				if (uiWorkspace !== undefined && uiWorkspace !== null && typeof uiWorkspace.openSession === "function") {
					uiWorkspace.openSession(id);
					return;
				}
				const sessions = sessionsOf();
				if (sessions !== undefined && sessions !== null && typeof sessions.open === "function") {
					sessions.open(id);
					return;
				}
				throw new Error("no session-selection verb (uiWorkspace.openSession / sessions.open)");
			}
			/**
			 * Run one operation against a session's face, holding a reference when
			 * the generation requires retention to address it.
			 * @param id - the session.
			 * @param operation - receives the session face.
			 */
			async function withFace(id, operation) {
				const sessions = sessionsOf();
				if (sessions === undefined || sessions === null) throw new Error("sessions service is unavailable");
				/** Address the face without retention (older generations, or an already-retained child). */
				const borrow = async () => {
					const binding = typeof sessions.binding === "function" ? sessions.binding(id) : undefined;
					const face = binding === undefined ? undefined : binding.session;
					if (face === undefined) throw new Error("session is not locally addressable");
					return await operation(face);
				};
				if (typeof sessions.using === "function") {
					try {
						return await sessions.using(id, { source: "controllerOperation" }, async reference => {
							// `reference.binding` is addressable immediately; awaiting
							// `reference.ready` would gate a rename or a prompt on the
							// whole inherited history being loaded.
							return await operation(reference.binding.session);
						});
					} catch (retainError) {
						console.warn("[dsh-branch-tree] retained access failed; borrowing the binding instead", retainError);
						return await borrow();
					}
				}
				return await borrow();
			}
			/** Throw when the remote rejected a receipt. */
			function assertAccepted(receipt, what) {
				if (receipt === null || typeof receipt !== "object") return;
				if (receipt.ok === false) {
					const failure = receipt.error;
					throw new Error(failure !== undefined && failure.message !== undefined ? failure.message : `${what} rejected`);
				}
			}
			/**
			 * Fork `sourceSessionId`, optionally select the child, name it, and
			 * admit a question into it.
			 * @param request - source, optional inclusive anchor seq, whether to
			 *   switch to the child, the child title to pin, and the question.
			 * @returns the child session id.
			 */
			async function fork(request) {
				const sessions = sessionsOf();
				if (sessions === undefined || sessions === null || typeof sessions.fork !== "function") {
					// Self-describing failure: a missing/renamed verb is otherwise
					// indistinguishable from a host rejection.
					const found = sessions === undefined || sessions === null
						? "no sessions service"
						: `keys: ${Object.keys(sessions).join(", ") || "(none)"}`;
					const reason = `sessions service is not fork-capable (${found})`;
					publish({ pending: false, error: reason, errorOp: "fork" });
					throw new Error(reason);
				}
				publish({ pending: true, error: null, errorOp: "fork" });
				let childId;
				try {
					// ONE path on purpose. `uiWorkspace.forkSession` is tempting but it
					// only forwards to `sessions.fork({increaseTitle: true})` — it does
					// NOT select the child — while `sessions.fork` exists in both client
					// generations. Fork, then select explicitly when the caller wants it;
					// the tail cut is simply the call that omits `atSeq`.
					childId = await sessions.fork({
						sessionId: request.sourceSessionId,
						...(request.atSeq === undefined ? {} : { atSeq: request.atSeq }),
					});
					if (request.select !== false) select(childId);
					if (request.title !== undefined && request.title !== null && request.title !== "") {
						// Naming is cosmetic AND must never delay the visible fork, so it
						// runs detached; a failure only reaches the console.
						void withFace(childId, async face => {
							assertAccepted(await face.rename(request.title), "rename");
						}).catch(renameError => {
							console.warn("[dsh-branch-tree] branch rename failed", renameError);
						});
					}
					if (request.ask !== undefined && request.ask.trim() !== "") {
						await withFace(childId, async face => {
							assertAccepted(await face.prompt([{ type: "text", text: request.ask }], "queue"), "prompt");
						});
					}
					publish({ pending: false, error: null, errorOp: "fork" });
					return childId;
				} catch (error) {
					// A failure after the child exists is NOT a failed fork: say so, so
					// the user does not re-fork a branch that is already there.
					const prefix = childId === undefined ? "" : `${childId} 已建好，但后续步骤失败：`;
					publish({ pending: false, error: `${prefix}${fail("fork", error)}`, errorOp: "fork" });
					throw error;
				}
			}
			/**
			 * Pin a branch's durable title.
			 * @param id - the branch.
			 * @param title - the new title (trimmed; blank is refused).
			 */
			async function rename(id, title) {
				const next = typeof title === "string" ? title.trim() : "";
				if (next === "") throw new Error("title must not be blank");
				publish({ pending: true, error: null, errorOp: "rename" });
				try {
					await withFace(id, async face => {
						assertAccepted(await face.rename(next), "rename");
					});
					publish({ pending: false, error: null, errorOp: "rename" });
				} catch (error) {
					publish({ pending: false, error: fail("rename", error), errorOp: "rename" });
					throw error;
				}
			}
			/**
			 * Remove a branch from the list. Archiving is the supported verb — it
			 * leaves the log on disk and the session restorable from Archived.
			 * @param id - the branch to remove.
			 */
			async function remove(id) {
				publish({ pending: true, error: null, errorOp: "remove" });
				try {
					const uiWorkspace = ctx.get("uiWorkspace");
					const workspaces = ctx.get("workspaces");
					if (uiWorkspace !== undefined && uiWorkspace !== null && typeof uiWorkspace.archiveSession === "function") {
						await uiWorkspace.archiveSession(id, { stopActivity: true });
					} else if (workspaces !== undefined && workspaces !== null && typeof workspaces.archiveSession === "function") {
						await workspaces.archiveSession(id, { stopActivity: true });
					} else {
						throw new Error("no session-archive verb (uiWorkspace.archiveSession / workspaces.archiveSession)");
					}
					publish({ pending: false, error: null, errorOp: "remove" });
				} catch (error) {
					publish({ pending: false, error: fail("remove", error), errorOp: "remove" });
					throw error;
				}
			}
			return {
				ready: true,
				fork,
				rename,
				remove,
				open(sessionId) {
					select(sessionId);
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				snapshot() {
					return state;
				},
			};
		}

		/**
		 * Subscribe a component to the shared in-flight/error state.
		 * @param branches - the action face.
		 * @returns the current state, re-rendering on every change.
		 */
		function useBranchState(branches) {
			const [state, setState] = React.useState(() => branches.snapshot());
			React.useEffect(() => branches.subscribe(() => setState(branches.snapshot())), [branches]);
			return state;
		}

		/** Shared empty collapse set (identity-stable, never mutated). */
		const NO_COLLAPSE = new Set();

		/**
		 * The one collapse truth, shared by the panel tree and the sidebar list so a
		 * row collapsed in either place is collapsed in both. It is a flat set of
		 * ROW ids (session ids are globally unique), which is all "is this row
		 * folded" needs — there is no per-family bookkeeping to keep in sync, and
		 * therefore nothing that can disagree after a branch is added or deleted.
		 *
		 * Reassigned (never mutated in place) because it is a `useMemo` dependency of
		 * the family projection: an in-place edit would keep the same identity and
		 * the tree would not recompute.
		 */
		let collapsedIds = NO_COLLAPSE;
		/** Non-React consumers (the sidebar DOM engine) re-apply on every change. */
		const collapseListeners = new Set();

		/** Tell every collapse consumer that the folded set changed. */
		function notifyCollapse() {
			for (const listener of collapseListeners) listener();
		}

		/**
		 * Collapse state plus its toggles.
		 * @returns the collapsed id set, a row toggle, and the bulk operations.
		 */
		function useCollapse() {
			const [, bump] = React.useState(0);
			React.useEffect(() => {
				const listener = () => bump(version => version + 1);
				collapseListeners.add(listener);
				return () => collapseListeners.delete(listener);
			}, []);
			const write = React.useCallback(next => {
				collapsedIds = next.size === 0 ? NO_COLLAPSE : next;
				notifyCollapse();
			}, []);
			const toggle = React.useCallback(id => {
				const next = new Set(collapsedIds);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				write(next);
			}, [write]);
			const collapseAll = React.useCallback(ids => write(new Set(ids)), [write]);
			const expandAll = React.useCallback(() => write(new Set()), [write]);
			return { collapsed: collapsedIds, toggle, collapseAll, expandAll };
		}

		/**
		 * Whether the sidebar should hide one row: some CONVERSATION ancestor of it
		 * is collapsed. This is the sidebar's half of the same cascade the panel
		 * gets for free by not emitting descendants — and it is deliberately NOT
		 * applied to the current session, because hiding the row you are standing in
		 * would lose the "you are here" affordance in the list itself.
		 *
		 * @param byId - session summary rows keyed by id.
		 * @param id - the row to test.
		 * @param collapsed - the flat collapsed row set.
		 * @param currentId - the session being viewed, never hidden.
		 * @returns true when the row must not be shown.
		 */
		function hiddenInList(byId, id, collapsed, currentId) {
			try {
				if (id === currentId) return false;
				if (collapsed instanceof Set === false || collapsed.size === 0) return false;
				const seen = new Set([id]);
				let cursor = visibleParentOf(byId, id);
				while (cursor !== undefined && !seen.has(cursor)) {
					seen.add(cursor);
					if (collapsed.has(cursor)) return true;
					if (cursor === currentId) return false;
					cursor = visibleParentOf(byId, cursor);
				}
				return false;
			} catch (error) {
				return false;
			}
		}

		/**
		 * Normalize the `turnOutline` session projection into the turn list the tree
		 * renders. The projection is registered by the app's turn-outline plugin, so
		 * an assembly without it yields an empty list and the section stays hidden.
		 *
		 * Wire shape: `{ turn, seq, prompt, response }[]` ordered strictly by `turn`,
		 * where `seq` is that turn's `turn/start` event and `prompt` is a normalized
		 * preview of the turn's first human prompt (`''` for a non-text prompt).
		 *
		 * @param raw - the projection value, in any of its observable wrappers.
		 * @returns the normalized turn entries.
		 */
		function normalizeOutline(raw) {
			try {
				const unwrapped = raw !== null && typeof raw === "object" && typeof raw.getSnapshot === "function"
					? raw.getSnapshot()
					: raw;
				const list = Array.isArray(unwrapped)
					? unwrapped
					: Array.isArray(unwrapped?.value)
						? unwrapped.value
						: Array.isArray(unwrapped?.turns)
							? unwrapped.turns
							: [];
				const out = [];
				for (const entry of list) {
					if (entry === null || typeof entry !== "object") continue;
					const turn = typeof entry.turn === "number" ? entry.turn : undefined;
					if (turn === undefined) continue;
					out.push({
						turn,
						seq: typeof entry.seq === "number" ? entry.seq : undefined,
						prompt: typeof entry.prompt === "string" ? entry.prompt : "",
						response: typeof entry.response === "string" ? entry.response : "",
					});
				}
				return out.sort((left, right) => left.turn - right.turn);
			} catch (error) {
				return [];
			}
		}

		/**
		 * The inclusive event seq that cuts a branch at the END of one turn.
		 *
		 * The outline exposes each turn's `turn/start` seq, and the host's `atSeq` is
		 * INCLUSIVE — so cutting at a turn's own start would hand the child that turn
		 * with nothing in it. The end of turn N is one event before turn N+1 begins;
		 * for the LAST turn the anchor is omitted, which asks the host for its
		 * "latest completed turn" prefix and never cuts into a running turn.
		 *
		 * @param outline - normalized turn entries.
		 * @param index - the entry to cut after.
		 * @returns the inclusive seq, or undefined to let the host pick the prefix.
		 */
		function turnCutSeq(outline, index) {
			if (!Array.isArray(outline) || index < 0 || index >= outline.length) return undefined;
			const next = outline[index + 1];
			if (next === undefined || typeof next.seq !== "number") return undefined;
			return next.seq > 0 ? next.seq - 1 : undefined;
		}

		/** localStorage key holding one session's custom turn names. */
		function turnNameKey(sessionId) {
			return `dsh-branch-tree:turn-names:${String(sessionId)}`;
		}

		/**
		 * Custom turn names for one session.
		 *
		 * Turn display names are a presentation overlay only: the session log has no
		 * durable turn title, so renaming a turn must not pretend to write one. They
		 * live in this browser's localStorage, keyed by session + turn number.
		 *
		 * @param sessionId - the session whose names to read.
		 * @returns a plain `{ [turn]: name }` record, empty when unset or unreadable.
		 */
		function readTurnNames(sessionId) {
			try {
				if (typeof localStorage === "undefined") return {};
				const raw = localStorage.getItem(turnNameKey(sessionId));
				if (raw === null || raw === "") return {};
				const parsed = JSON.parse(raw);
				return parsed !== null && typeof parsed === "object" ? parsed : {};
			} catch (error) {
				return {};
			}
		}

		/**
		 * Pin or clear one custom turn name.
		 * @param sessionId - the session.
		 * @param turn - the turn number.
		 * @param name - the new name; blank clears the overlay.
		 * @returns the record after the write.
		 */
		function writeTurnName(sessionId, turn, name) {
			const next = { ...readTurnNames(sessionId) };
			const trimmed = typeof name === "string" ? name.trim() : "";
			if (trimmed === "") delete next[String(turn)];
			else next[String(turn)] = trimmed;
			try {
				if (typeof localStorage !== "undefined") {
					if (Object.keys(next).length === 0) localStorage.removeItem(turnNameKey(sessionId));
					else localStorage.setItem(turnNameKey(sessionId), JSON.stringify(next));
				}
			} catch (error) {
				// A full or blocked store must not break the panel.
			}
			return next;
		}

		/**
		 * Live anchors for turns already rendered in the transcript.
		 *
		 * The shipped conversation UI publishes NO per-turn DOM hook, but this plugin
		 * already mounts a control inside every completed turn's tail — so that
		 * component registers its own element here. "Take me to turn N" is then an
		 * exact `scrollIntoView`, not a text guess. Turns that are paginated out, and
		 * the still-running last turn, have no tail and therefore no anchor; those
		 * fall back to the text probe and then to the transcript's end.
		 */
		const turnAnchors = new Map();

		/**
		 * Scroll the transcript to one turn.
		 * @param turn - the turn number.
		 * @param probe - the turn's prompt (or response) preview, for the text fallback.
		 * @param isLast - whether this is the newest turn (a running turn has no tail).
		 * @returns how the jump was satisfied: 'anchor', 'text', 'bottom', or 'missing'.
		 */
		function jumpToTurn(turn, probe, isLast) {
			try {
				const anchor = turnAnchors.get(turn);
				if (anchor !== undefined && anchor.isConnected === true) {
					anchor.scrollIntoView({ block: "center", behavior: "smooth" });
					return "anchor";
				}
				if (typeof probe === "string" && probe !== "" && scrollToTurnText(probe) === true) return "text";
				if (isLast === true) {
					const container = document.querySelector("[data-conversation-scroll]");
					if (container !== null) {
						container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
						return "bottom";
					}
				}
				return "missing";
			} catch (error) {
				return "missing";
			}
		}

		/**
		 * Best-effort scroll of the transcript to the turn whose prompt starts with
		 * `text`.
		 *
		 * This build exposes no per-turn DOM anchor, so the transcript's own text is
		 * the only handle: search INSIDE the shipped scroll container (never the whole
		 * document, so this panel's own copy can never match), and try a longer probe
		 * first, then a short one for prompts that markdown split across nodes.
		 *
		 * @param text - the turn's prompt preview.
		 * @returns true when something was scrolled into view.
		 */
		function scrollToTurnText(text) {
			try {
				if (typeof document === "undefined" || typeof text !== "string") return false;
				const container = document.querySelector("[data-conversation-scroll]");
				if (container === null) return false;
				const flat = text.replace(/\s+/g, " ").trim();
				for (const length of [20, 8]) {
					const needle = flat.slice(0, length).toLowerCase();
					if (needle.length < 4) continue;
					const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
					let node = walker.nextNode();
					while (node !== null) {
						const value = (node.nodeValue ?? "").replace(/\s+/g, " ").toLowerCase();
						if (value.includes(needle)) {
							const element = node.parentElement;
							if (element !== null) {
								element.scrollIntoView({ block: "center", behavior: "smooth" });
								return true;
							}
						}
						node = walker.nextNode();
					}
				}
				return false;
			} catch (error) {
				return false;
			}
		}

		/**
		 * Reorder session ids into the conventional tree reading order: every root in
		 * its existing relative order, each immediately followed by its descendants
		 * (depth-first, children in their existing relative order).
		 *
		 * The shipped sidebar instead places a fork immediately ABOVE its source,
		 * recursively (`placeFork`), so a child ends up above its parent and the
		 * deepest branch ends up highest. Its base order is recency, which stays the
		 * root order here — this only re-nests the branches under their source.
		 *
		 * Pure and idempotent: an already-ordered list comes back unchanged, which is
		 * what lets the sidebar engine apply it on every frame without churn.
		 *
		 * @param ids - the ids currently shown, in the shipped order.
		 * @param byId - session summary rows keyed by id.
		 * @returns the same ids in parent-above-children order.
		 */
		function treeOrder(ids, byId) {
			try {
				if (!Array.isArray(ids)) return [];
				const present = new Set(ids);
				const childrenOf = new Map();
				const roots = [];
				for (const id of ids) {
					const parent = visibleParentOf(byId, id);
					if (parent === undefined || parent === id || !present.has(parent)) {
						roots.push(id);
						continue;
					}
					const bucket = childrenOf.get(parent);
					if (bucket === undefined) childrenOf.set(parent, [id]);
					else bucket.push(id);
				}
				const out = [];
				const seen = new Set();
				const walk = id => {
					if (seen.has(id)) return;
					seen.add(id);
					out.push(id);
					for (const kid of childrenOf.get(id) ?? []) walk(kid);
				};
				for (const root of roots) walk(root);
				// Cycle members (unreachable from any root) keep a place rather than
				// vanishing from the list they belong to.
				for (const id of ids) walk(id);
				return out;
			} catch (error) {
				return Array.isArray(ids) ? ids : [];
			}
		}

		/** Sidebar row order: the conventional tree, or the shipped (fork-above-source) order. */
		const ORDER_TREE = "tree";
		const ORDER_APP = "app";
		/** localStorage key for the chosen sidebar order. */
		const ORDER_STORAGE_KEY = "dsh-branch-tree:sidebar-order";
		/** Current sidebar row order, read at call time by the engine. */
		let sidebarOrderMode = readStoredOrderMode();

		/** Read the persisted sidebar order, defaulting to the tree reading order. */
		function readStoredOrderMode() {
			try {
				if (typeof localStorage === "undefined") return ORDER_TREE;
				const raw = localStorage.getItem(ORDER_STORAGE_KEY);
				return raw === ORDER_APP ? ORDER_APP : ORDER_TREE;
			} catch (error) {
				return ORDER_TREE;
			}
		}

		/**
		 * Switch the sidebar row order and re-apply it immediately.
		 * @param mode - ORDER_TREE or ORDER_APP.
		 */
		function setSidebarOrderMode(mode) {
			sidebarOrderMode = mode === ORDER_APP ? ORDER_APP : ORDER_TREE;
			try {
				if (typeof localStorage !== "undefined") localStorage.setItem(ORDER_STORAGE_KEY, sidebarOrderMode);
			} catch (error) {
				// A blocked store must not break the toggle.
			}
			notifyCollapse();
		}

		/**
		 * How many CONVERSATION branches hang off one session, i.e. how many rows the
		 * sidebar would hide by folding it.
		 * @param byId - session summary rows.
		 * @param id - the session to count under.
		 * @returns the number of visible children.
		 */
		function visibleChildCount(byId, id) {
			try {
				if (byId === null || typeof byId !== "object") return 0;
				let count = 0;
				for (const candidate of Object.keys(byId)) {
					const row = byId[candidate];
					if (row === undefined || isDelegated(candidate, row)) continue;
					if (visibleParentOf(byId, candidate) === id) count++;
				}
				return count;
			} catch (error) {
				return 0;
			}
		}

		/**
		 * Dismiss a popover on an outside pointer press or Escape.
		 * @param rootRef - the popover's positioning root.
		 * @param open - whether the popover is open.
		 * @param close - the dismissal callback.
		 */
		function useDismiss(rootRef, open, close) {
			React.useEffect(() => {
				if (!open) return undefined;
				const onPointer = event => {
					const root = rootRef.current;
					if (root !== null && !root.contains(event.target)) close();
				};
				const onKey = event => {
					if (event.key === "Escape") close();
				};
				document.addEventListener("pointerdown", onPointer, true);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", onPointer, true);
					document.removeEventListener("keydown", onKey);
				};
			}, [rootRef, open, close]);
		}

		/** Indent step per lineage level, in px. */
		const INDENT_STEP = 16;
		/** The shipped sidebar's session-row DOM hook. */
		const ROW_KEY_ATTR = "data-row-key";
		const SESSION_ROW_PREFIX = "session:";
		/** Marks a row this engine styled for indentation. */
		const INDENT_ATTR = "data-dbt-indent";
		/** Marks a row this engine hid by collapse. */
		const HIDDEN_ATTR = "data-dbt-hidden";

		/**
		 * Indent and fold the SHIPPED sidebar's session rows.
		 *
		 * The sidebar list owns its own row layout and offers no slot for either, so
		 * this reaches the rows through the shipped `data-row-key="session:<id>"`
		 * attribute and applies exactly three things: a padding shift, one hairline
		 * guide, and `display:none` for a row whose conversation ancestor is folded.
		 * Everything is keyed off that attribute, so a row this engine never touched
		 * is left exactly as shipped, and if a future build drops the attribute the
		 * hook simply finds no rows — degradation, not breakage. Cleanup restores
		 * every row it changed.
		 *
		 * The list is plain rows (no virtual scroller in this build), so hiding a row
		 * collapses the gap instead of leaving a hole. Mutations are coalesced into
		 * one animation frame, and the engine re-applies whenever the shared collapse
		 * set changes, so folding from the panel folds the list too.
		 *
		 * @param factsOf - resolves a session id to its indent level and hidden state.
		 * @param orderOf - reorders the session ids currently shown; omitted leaves the
		 *   shipped order untouched.
		 */
		function useSidebarTree(factsOf, orderOf) {
			React.useEffect(() => {
				if (typeof document === "undefined" || typeof MutationObserver === "undefined") return undefined;
				/** Rows this engine currently styles. */
				const touched = new Set();
				let frame = 0;
				/**
				 * Re-nest the session rows of each list container into parent-above-children
				 * order, in place: only the slots already holding session rows are
				 * rewritten, so headers, "more" rows, and every other sibling keep their
				 * position. Idempotent — an already-ordered container performs no DOM write
				 * (which is what keeps the observer from looping on its own work).
				 */
				const reorder = () => {
					if (typeof orderOf !== "function") return;
					const holders = new Map();
					for (const row of document.querySelectorAll(`[${ROW_KEY_ATTR}^="${SESSION_ROW_PREFIX}"]`)) {
						const holder = row.parentElement;
						if (holder === null) continue;
						const bucket = holders.get(holder);
						if (bucket === undefined) holders.set(holder, [row]);
						else bucket.push(row);
					}
					for (const [holder, rows] of holders) {
						if (rows.length < 2) continue;
						const keys = rows.map(row => row.getAttribute(ROW_KEY_ATTR));
						const ids = keys.map(key => (key ?? "").slice(SESSION_ROW_PREFIX.length));
						const wantedIds = orderOf(ids);
						if (!Array.isArray(wantedIds) || wantedIds.length !== ids.length) continue;
						const byKey = new Map(rows.map(row => [row.getAttribute(ROW_KEY_ATTR), row]));
						// ONLY the slots already holding SESSION rows are rewritten. A group
						// header, an "overflow" row, and any other sibling carry their own
						// `data-row-key`, so filtering by the session prefix is what keeps
						// them pinned — and it is also why the count check below compares
						// like with like.
						let slots = [...holder.children].filter(child => {
							const key = child.getAttribute(ROW_KEY_ATTR);
							return typeof key === "string" && key.startsWith(SESSION_ROW_PREFIX);
						});
						if (slots.length !== rows.length) continue;
						for (let index = 0; index < wantedIds.length; index += 1) {
							const wanted = byKey.get(`${SESSION_ROW_PREFIX}${wantedIds[index]}`);
							if (wanted === undefined || slots[index] === wanted) continue;
							holder.insertBefore(wanted, slots[index]);
							// Re-read the slots: the move changed which element sits where.
							slots = [...holder.children].filter(child => {
								const key = child.getAttribute(ROW_KEY_ATTR);
								return typeof key === "string" && key.startsWith(SESSION_ROW_PREFIX);
							});
						}
					}
				};
				/** Apply the current depth/visibility to every mounted session row. */
				const apply = () => {
					const rows = document.querySelectorAll(`[${ROW_KEY_ATTR}^="${SESSION_ROW_PREFIX}"]`);
					for (const row of rows) {
						const key = row.getAttribute(ROW_KEY_ATTR);
						if (key === null) continue;
						const id = key.slice(SESSION_ROW_PREFIX.length);
						if (id === "") continue;
						const facts = factsOf(id);
						const depth = facts !== undefined && facts !== null && typeof facts.depth === "number" ? facts.depth : 0;
						if (facts !== undefined && facts !== null && facts.hidden === true) {
							row.style.display = "none";
							row.setAttribute(HIDDEN_ATTR, "");
							touched.add(row);
							continue;
						}
						if (row.hasAttribute(HIDDEN_ATTR)) {
							row.style.display = "";
							row.removeAttribute(HIDDEN_ATTR);
						}
						if (depth > 0) {
							row.style.paddingLeft = `${depth * INDENT_STEP}px`;
							row.style.setProperty("--dbt-guide", `${(depth - 1) * INDENT_STEP + 8}px`);
							row.setAttribute(INDENT_ATTR, String(depth));
							touched.add(row);
						} else if (row.hasAttribute(INDENT_ATTR)) {
							row.style.paddingLeft = "";
							row.style.removeProperty("--dbt-guide");
							row.removeAttribute(INDENT_ATTR);
							touched.delete(row);
						}
					}
					// Rows scrolled out of a re-rendered list are discarded, so drop the
					// detached ones rather than holding them for the mount's lifetime.
					for (const row of touched) {
						if (row.isConnected === false) touched.delete(row);
					}
					reorder();
				};
				/** Coalesce a burst of list mutations into one pass. */
				const schedule = () => {
					if (frame !== 0) return;
					frame = requestAnimationFrame(() => {
						frame = 0;
						apply();
					});
				};
				const observer = new MutationObserver(schedule);
				observer.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: [ROW_KEY_ATTR],
				});
				collapseListeners.add(schedule);
				apply();
				return () => {
					observer.disconnect();
					collapseListeners.delete(schedule);
					if (frame !== 0) cancelAnimationFrame(frame);
					for (const row of touched) {
						row.style.paddingLeft = "";
						row.style.display = "";
						row.style.removeProperty("--dbt-guide");
						row.removeAttribute(INDENT_ATTR);
						row.removeAttribute(HIDDEN_ATTR);
					}
					touched.clear();
				};
			}, [factsOf]);
		}
		//#endregion

		//#region components
		/** Fallback actions: an entry must render inert, never throw, if its face is missing. */
		const NOOP_BRANCHES = {
			ready: false,
			fork: async () => undefined,
			rename: async () => undefined,
			remove: async () => undefined,
			open: () => {},
			subscribe: () => () => {},
			snapshot: () => ({ pending: false, error: null, errorOp: "fork" }),
		};

		/** The fork glyph shared by every entry. */
		function BranchGlyph(props) {
			return h("svg", {
				className: "dbt_glyph",
				width: props.size ?? 14,
				height: props.size ?? 14,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
			}, h("path", {
				d: "M4.5 2.5v7a3 3 0 0 0 3 3h4M4.5 6.5h3a3 3 0 0 0 3-3v-1",
				stroke: "currentColor",
				"stroke-width": "1.4",
				"stroke-linecap": "round",
			}), h("circle", { cx: "4.5", cy: "2.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }), h("circle", { cx: "12.5", cy: "12.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }), h("circle", { cx: "11", cy: "2.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }));
		}

		/** Small pencil / trash / open glyphs for the row actions. */
		function IconGlyph(props) {
			const path = props.path;
			return h("svg", {
				className: props.className,
				width: props.size ?? 13,
				height: props.size ?? 13,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
			}, h("path", { d: path, stroke: "currentColor", "stroke-width": "1.4", "stroke-linecap": "round", "stroke-linejoin": "round" }));
		}
		const PATH_OPEN = "M9 2.5h4.5V7M13.5 2.5 8 8M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5";
		const PATH_RENAME = "M10.5 2.5 13.5 5.5 6 13H3v-3z";
		const PATH_TRASH = "M3.5 5h9M6.5 5V3.5h3V5M5 5l.5 8h5L11 5";
		const PATH_CHEVRON = "M6 3.5 10.5 8 6 12.5";

		/**
		 * Session-header branch navigator: the whole branch family around the
		 * current session, with open / rename / delete / fork-again per row, and
		 * a fork-at-the-end action that does NOT steal the current view.
		 */
		function BranchNavigator(props) {
			const { sessionId, useSessions } = props;
			// Defensive reads: a shipped-slot contract change must degrade to an
			// inert control rather than break the session header it sits in.
			const t = typeof props.t === "function" ? props.t : key => key;
			const branches = props.branches !== undefined && typeof props.branches.fork === "function"
				? props.branches
				: NOOP_BRANCHES;
			const ids = typeof useSessions === "function"
				? useSessions(state => (state !== undefined && Array.isArray(state.ids) ? state.ids : EMPTY_IDS))
				: EMPTY_IDS;
			const byId = typeof useSessions === "function"
				? useSessions(state => (state !== undefined && state.byId !== undefined ? state.byId : EMPTY_BY_ID))
				: EMPTY_BY_ID;
			const [open, setOpen] = React.useState(false);
			const [renamingId, setRenamingId] = React.useState(null);
			const [renameText, setRenameText] = React.useState("");
			const [confirmId, setConfirmId] = React.useState(null);
			const [notice, setNotice] = React.useState(null);
			const [removed, setRemoved] = React.useState(null);
			const rootRef = React.useRef(null);
			const status = useBranchState(branches);
			const { collapsed, toggle: toggleCollapse, collapseAll, expandAll } = useCollapse();
			const family = React.useMemo(
				() => familyOf(ids, byId, sessionId, SKIP_DELEGATED, collapsed),
				[ids, byId, sessionId, collapsed],
			);
			const close = React.useCallback(() => setOpen(false), []);
			useDismiss(rootRef, open, close);
			// Indent and fold the shipped sidebar's rows. The engine reads the LATEST
			// snapshot through a ref and resolves the current session the same way, so
			// its effect mounts once (a new callback per render would tear the observer
			// down and rebuild it on every update).
			const byIdRef = React.useRef(byId);
			byIdRef.current = byId;
			const currentRef = React.useRef(sessionId);
			currentRef.current = sessionId;
			const factsOf = React.useCallback(id => ({
				depth: depthInList(byIdRef.current, id),
				hidden: hiddenInList(byIdRef.current, id, collapsedIds, currentRef.current),
			}), []);
			// The shipped order is read at apply time, so switching it needs no remount.
			const orderOf = React.useCallback(ids => (sidebarOrderMode === ORDER_APP ? ids : treeOrder(ids, byIdRef.current)), []);
			useSidebarTree(factsOf, orderOf);
			const ready = branches.ready !== false;
			const busy = status.pending;

			/** Fork one source and, unless told otherwise, stay in the current view. */
			const forkFrom = (sourceId, ask) => {
				const title = childTitleOf(ids, byId, sourceId, SKIP_DELEGATED);
				branches.fork({
					sourceSessionId: sourceId,
					title,
					select: ask !== undefined,
					...(ask === undefined ? {} : { ask }),
				}).then(childId => {
					if (ask === undefined) setNotice({ childId, title: title === null ? childId : title });
					else close();
				}).catch(() => {});
			};

			const label = !ready
				? t("trigger.notReady")
				: busy
					? t("trigger.pending")
					: family.siblingTotal > 1
						? `${t("trigger.label")} ${t("trigger.sibling", { index: family.siblingIndex, total: family.siblingTotal })}`
						: t("trigger.label");

			// "Collapse all" only needs the VISIBLE rows that still have an expanded
			// subtree: collapsing those hides everything below them, including rows
			// that are already hidden, so the whole tree ends up collapsed.
			const expandable = family.rows.filter(row => row.descendantCount > 0 && !row.collapsed).map(row => row.id);
			const allCollapsed = expandable.length === 0;
			const hiddenTotal = family.rows.reduce((sum, row) => sum + (row.collapsed ? row.descendantCount : 0), 0);

			const rows = family.rows.map(row => {
				const isCurrent = row.id === sessionId;
				const isRenaming = renamingId === row.id;
				const isConfirming = confirmId === row.id;
				// The generated `⑂N` discriminator is the ONLY thing telling two
				// sibling branches apart, so it must never be the part that the
				// row's ellipsis eats: split it out and render it as a fixed tag.
				const titleParts = splitBranchTitle(row.title);
				const actions = [];
				if (!isRenaming && !isConfirming) {
					if (!isCurrent) {
						actions.push(h("button", {
							key: "open",
							type: "button",
							className: "dbt_iconBtn",
							title: t("panel.open"),
							"aria-label": t("panel.open"),
							onClick: event => {
								event.stopPropagation();
								branches.open(row.id);
								close();
							},
						}, h(IconGlyph, { path: PATH_OPEN })));
					}
					actions.push(h("button", {
						key: "rename",
						type: "button",
						className: "dbt_iconBtn",
						title: t("panel.rename"),
						"aria-label": t("panel.rename"),
						disabled: busy,
						onClick: event => {
							event.stopPropagation();
							setConfirmId(null);
							setRenamingId(row.id);
							setRenameText(row.title);
						},
					}, h(IconGlyph, { path: PATH_RENAME })));
					actions.push(h("button", {
						key: "fork",
						type: "button",
						className: "dbt_iconBtn",
						title: t("panel.forkHere"),
						"aria-label": t("panel.forkHere"),
						disabled: busy,
						onClick: event => {
							event.stopPropagation();
							forkFrom(row.id);
						},
					}, h(BranchGlyph, { size: 12 })));
					actions.push(h("button", {
						key: "delete",
						type: "button",
						className: "dbt_iconBtn dbt_iconDanger",
						title: t("panel.delete"),
						"aria-label": t("panel.delete"),
						disabled: busy,
						onClick: event => {
							event.stopPropagation();
							setRenamingId(null);
							setConfirmId(row.id);
						},
					}, h(IconGlyph, { path: PATH_TRASH })));
				}
				if (isConfirming) {
					actions.push(h("button", {
						key: "confirm",
						type: "button",
						className: "dbt_iconBtn dbt_iconConfirm",
						disabled: busy,
						onClick: event => {
							event.stopPropagation();
							branches.remove(row.id).then(() => {
								setConfirmId(null);
								// Deleting is ARCHIVING: the app hides archived rows, but its own
								// list state can lag. Keep the fact, so the panel can say so
								// instead of pretending the row vanished everywhere.
								setRemoved({ id: row.id, title: row.title });
								// Removing the branch we are standing in must land somewhere:
								// prefer the parent, else the first remaining family row.
								if (isCurrent) {
									const fallback = family.parentId !== undefined
										? family.parentId
										: (family.rows.find(candidate => candidate.id !== row.id) ?? { id: family.rootId }).id;
									if (fallback !== row.id) branches.open(fallback);
								}
							}).catch(() => {});
						},
					}, t("panel.deleteConfirm")));
					actions.push(h("button", {
						key: "cancel",
						type: "button",
						className: "dbt_iconBtn",
						"aria-label": t("bar.cancel"),
						onClick: event => {
							event.stopPropagation();
							setConfirmId(null);
						},
					}, "×"));
				}

				const commitRename = () => {
					const next = renameText.trim();
					setRenamingId(null);
					if (next === "" || next === row.title) return;
					branches.rename(row.id, next).catch(() => {});
				};

				return h("li", { key: row.id, className: "dbt_li" },
					h("div", {
						className: `dbt_row${isCurrent ? " dbt_rowCurrent" : ""}`,
						onClick: () => {
							if (isRenaming) return;
							if (!isCurrent) {
								branches.open(row.id);
								close();
							}
						},
					},
						// Indent guide: one 9px cell per level, drawn as a hairline.
						Array.from({ length: row.depth }, (_, index) => h("span", { key: `g${index}`, className: "dbt_guide" })),
						row.descendantCount > 0
							? h("button", {
								type: "button",
								className: `dbt_chevron${row.collapsed ? "" : " dbt_chevronOpen"}`,
								title: row.collapsed ? t("panel.expand") : t("panel.collapse"),
								"aria-label": row.collapsed ? t("panel.expand") : t("panel.collapse"),
								"aria-expanded": !row.collapsed,
								onClick: event => {
									event.stopPropagation();
									toggleCollapse(row.id);
								},
							}, h(IconGlyph, { path: PATH_CHEVRON, size: 12 }))
							: h("span", { className: "dbt_chevronSpacer" }),
						row.running ? h("span", { className: "dbt_dot" }) : null,
						h("span", { className: `dbt_tag dbt_tagDepth${row.id === family.rootId ? " dbt_tagRoot" : ""}` },
							row.depth === 0 ? t("panel.tagRoot") : `L${row.depth}`),
						isRenaming
							? h("input", {
								className: "dbt_renameInput",
								type: "text",
								autoFocus: true,
								value: renameText,
								disabled: busy,
								onClick: event => event.stopPropagation(),
								onChange: event => setRenameText(event.target.value),
								onKeyDown: event => {
									if (event.key === "Enter") commitRename();
									if (event.key === "Escape") setRenamingId(null);
								},
								onBlur: commitRename,
							})
							: h("span", { className: "dbt_rowTitle", title: row.title }, titleParts.base),
						isRenaming ? null : (titleParts.suffix === null
							? null
							: h("span", { className: "dbt_tag dbt_tagBranch", title: row.title }, titleParts.suffix)),
						isCurrent ? h("span", { className: "dbt_tag" }, t("panel.tagCurrent")) : null,
						// A collapsed row hiding the branch you are viewing must say so,
						// or the tree would look like the current branch vanished.
						row.collapsed && row.containsCurrent
							? h("span", { className: "dbt_tag dbt_tagInside" }, t("panel.containsCurrent"))
							: null,
						row.collapsed
							? h("span", { className: "dbt_tag dbt_tagHidden", title: t("panel.hidden", { count: row.descendantCount }) }, `+${row.descendantCount}`)
							: (row.childCount > 0 ? h("span", { className: "dbt_tag" }, `+${row.childCount}`) : null),
						h("span", { className: "dbt_rowActions" }, actions),
					));
			});

			return h("div", { className: "dbt_root", ref: rootRef },
				h("button", {
					type: "button",
					className: `dbt_trigger${open ? " dbt_triggerActive" : ""}`,
					"aria-expanded": open,
					"aria-label": t("trigger.title"),
					title: t("trigger.title"),
					onClick: () => setOpen(current => !current),
				}, h(BranchGlyph, {}), family.parentId === undefined ? null : h("span", { className: "dbt_triggerDot" }), h("span", null, label)),
				open ? h("div", { className: "dbt_panel", role: "dialog", "aria-label": t("panel.title") },
					h("div", { className: "dbt_panelHead" },
						h("span", { className: "dbt_panelTitle" },
							h("span", null, t("panel.title")),
							h("span", {
								className: "dbt_count",
								title: t("panel.countTitle", { shown: family.rows.length, hidden: hiddenTotal }),
							}, hiddenTotal > 0 ? `${family.rows.length}+${hiddenTotal}` : String(family.rows.length))),
						h("button", {
							type: "button",
							className: "dbt_iconBtn",
							title: allCollapsed ? t("panel.expandAll") : t("panel.collapseAll"),
							"aria-label": allCollapsed ? t("panel.expandAll") : t("panel.collapseAll"),
							disabled: family.rows.length === 0,
							onClick: () => {
								if (allCollapsed) expandAll();
								else collapseAll(expandable);
							},
						}, h(IconGlyph, { path: PATH_CHEVRON, size: 13, className: allCollapsed ? "" : "dbt_chevronOpen" })),
						h("button", {
							type: "button",
							className: "dbt_newBtn",
							title: t("panel.newTitle"),
							disabled: busy || !ready,
							onClick: () => forkFrom(sessionId),
						}, h(BranchGlyph, { size: 12 }), h("span", null, t("panel.new")))),
					h("div", { className: "dbt_body" },
						notice === null ? null : h("div", { className: "dbt_notice" },
							h("span", { className: "dbt_noticeText", title: notice.title }, t("notice.created", { title: notice.title })),
							h("button", {
								type: "button",
								className: "dbt_primary",
								onClick: () => {
									branches.open(notice.childId);
									setNotice(null);
									close();
								},
							}, t("notice.open")),
							h("button", {
								type: "button",
								className: "dbt_iconBtn",
								"aria-label": t("notice.dismiss"),
								title: t("notice.dismiss"),
								onClick: () => setNotice(null),
							}, "×")),
						h("ul", { className: "dbt_list" }, rows),
						removed !== null && ids.includes(removed.id) ? h("div", { className: "dbt_notice dbt_noticeWarn" },
							h("span", { className: "dbt_noticeText", title: removed.title }, t("remove.stale", { title: removed.title })),
							h("button", {
								type: "button",
								className: "dbt_iconBtn",
								"aria-label": t("notice.dismiss"),
								title: t("notice.dismiss"),
								onClick: () => setRemoved(null),
							}, "×")) : null,
						h(TurnTreePanel, {
							t,
							branches,
							sessionId,
							ids,
							byId,
							useProjection: props.useProjection,
						}),
						status.error === null ? null : h("div", { className: "dbt_error" },
							status.errorOp === "rename"
								? t("error.rename", { message: status.error })
								: status.errorOp === "remove"
									? t("error.remove", { message: status.error })
									: t("error.fork", { message: status.error })),
						h("div", { className: "dbt_footer" },
							h("div", { className: "dbt_hint" }, t("panel.hint")),
							h("button", {
								type: "button",
								className: "dbt_linkBtn",
								title: t("order.title"),
								onClick: () => setSidebarOrderMode(sidebarOrderMode === ORDER_APP ? ORDER_TREE : ORDER_APP),
							}, h(BranchGlyph, { size: 11 }), h("span", null, t(sidebarOrderMode === ORDER_APP ? "order.switchToTree" : "order.switchToApp"))))))
				: null);
		}

		/**
		 * Turn-tail fork control: cut a branch at the end of THIS completed turn
		 * (any turn, not just the latest), optionally asking a question inside it.
		 */
		function TurnBranchBar(props) {
			const { seq, sessionId } = props;
			const t = typeof props.t === "function" ? props.t : key => key;
			const branches = props.branches !== undefined && typeof props.branches.fork === "function"
				? props.branches
				: NOOP_BRANCHES;
			const useSessions = props.useSessions;
			const rootRef = React.useRef(null);
			// The turn this tail belongs to. `turn` is the engine's TurnLocation, so this
			// is what the branch tree uses to find the turn in the transcript again.
			const turnNumber = props.turn !== undefined && props.turn !== null && typeof props.turn.turn === "number"
				? props.turn.turn
				: undefined;
			React.useEffect(() => {
				const element = rootRef.current;
				if (turnNumber === undefined || element === null) return undefined;
				turnAnchors.set(turnNumber, element);
				return () => {
					if (turnAnchors.get(turnNumber) === element) turnAnchors.delete(turnNumber);
				};
			}, [turnNumber]);
			const ids = typeof useSessions === "function"
				? useSessions(state => (state !== undefined && Array.isArray(state.ids) ? state.ids : EMPTY_IDS))
				: EMPTY_IDS;
			const byId = typeof useSessions === "function"
				? useSessions(state => (state !== undefined && state.byId !== undefined ? state.byId : EMPTY_BY_ID))
				: EMPTY_BY_ID;
			const [open, setOpen] = React.useState(false);
			const [text, setText] = React.useState("");
			const status = useBranchState(branches);
			const busy = status.pending;
			const ready = branches.ready !== false;

			const run = ask => {
				branches.fork({
					sourceSessionId: sessionId,
					atSeq: seq,
					title: childTitleOf(ids, byId, sessionId, SKIP_DELEGATED),
					// Asking inside the branch is the point of this control, so the
					// view follows the child; "fork only" leaves the view alone.
					select: ask !== undefined,
					...(ask === undefined ? {} : { ask }),
				}).then(() => {
					setOpen(false);
					setText("");
				}).catch(() => {});
			};

			if (!open) {
				return h("div", { className: "dbt_bar", ref: rootRef },
					h("button", {
						type: "button",
						className: "dbt_barButton",
						disabled: busy,
						title: t("bar.note"),
						onClick: () => setOpen(true),
					}, h(BranchGlyph, { size: 12 }), h("span", null, ready ? t("bar.branch") : t("trigger.notReady"))));
			}
			return h("div", { className: "dbt_bar", ref: rootRef },
				h("div", { className: "dbt_barPanel" },
					h("input", {
						className: "dbt_input",
						type: "text",
						autoFocus: true,
						placeholder: t("bar.placeholder"),
						value: text,
						disabled: busy || !ready,
						onChange: event => setText(event.target.value),
						onKeyDown: event => {
							if (event.key === "Enter" && text.trim() !== "") run(text);
							if (event.key === "Escape") {
								setOpen(false);
								setText("");
							}
						},
					}),
					h("button", {
						type: "button",
						className: "dbt_primary",
						disabled: busy || !ready || text.trim() === "",
						onClick: () => run(text),
					}, h(BranchGlyph, { size: 12 }), h("span", null, t("bar.ask"))),
					h("button", {
						type: "button",
						className: "dbt_barButton",
						disabled: busy || !ready,
						onClick: () => run(undefined),
					}, t("bar.only")),
					h("button", {
						type: "button",
						className: "dbt_barButton",
						onClick: () => {
							setOpen(false);
							setText("");
						},
					}, t("bar.cancel"))),
				h("div", { className: "dbt_note" }, t("bar.note")),
				status.error === null ? null : h("div", { className: "dbt_error" }, t("error.fork", { message: status.error })));
		}

		/**
		 * Sidebar session-row mark: a fold control for a row that OWNS branches, and
		 * a branch glyph for a row that IS a branch.
		 *
		 * The shipped list does not indent lineage and has no fold control, so this
		 * 16px cell is the additive seat for both. It is also the seat a live status
		 * dot replaces, so a running row shows its dot instead — the panel tree always
		 * keeps its own chevron.
		 */
		function BranchRowMark(props) {
			const t = typeof props.t === "function" ? props.t : key => key;
			const useSessions = props.useSessions;
			const byId = typeof useSessions === "function"
				? useSessions(state => (state !== undefined && state.byId !== undefined ? state.byId : EMPTY_BY_ID))
				: EMPTY_BY_ID;
			const { collapsed, toggle } = useCollapse();
			const sessionId = props.sessionId;
			const childCount = visibleChildCount(byId, sessionId);
			if (childCount > 0) {
				const folded = collapsed.has(sessionId);
				return h("button", {
					type: "button",
					className: `dbt_markFold${folded ? "" : " dbt_markFoldOpen"}`,
					title: t(folded ? "panel.expand" : "panel.collapse"),
					"aria-label": t(folded ? "panel.expand" : "panel.collapse"),
					"aria-expanded": !folded,
					onClick: event => {
						event.stopPropagation();
						event.preventDefault();
						toggle(sessionId);
					},
				}, h(IconGlyph, { path: PATH_CHEVRON, size: 12 }));
			}
			const lineage = lineageOf(byId, sessionId);
			if (lineage === null) return null;
			return h("span", {
				className: "dbt_mark",
				title: lineage.parentTitle === null ? t("trigger.label") : t("mark.title", { title: lineage.parentTitle }),
			}, h(BranchGlyph, { size: 12 }));
		}

		/** Sidebar session-row hover card: one lineage line for a branch row. */
		function BranchRowHover(props) {
			const t = typeof props.t === "function" ? props.t : key => key;
			const useSessions = props.useSessions;
			const byId = typeof useSessions === "function"
				? useSessions(state => (state !== undefined && state.byId !== undefined ? state.byId : EMPTY_BY_ID))
				: EMPTY_BY_ID;
			const lineage = lineageOf(byId, props.sessionId);
			if (lineage === null) return null;
			return h("span", { className: "dbt_hoverLine" },
				h(BranchGlyph, { size: 11 }),
				h("span", { className: "dbt_hoverText", title: lineage.parentTitle ?? "" },
					lineage.parentTitle === null ? t("trigger.label") : t("hover.lineage", { title: lineage.parentTitle })),
				lineage.siblings > 1 ? h("span", { className: "dbt_tag" }, t("hover.siblings", { count: lineage.siblings })) : null);
		}
		/**
		 * The current branch's turn outline, rendered under the session tree.
		 *
		 * Every turn gets the app's own `turnOutline` preview as its default name, a
		 * local rename overlay, a best-effort "take me there", and a fork at that
		 * turn's exact cut seq — so an old turn can be branched from the tree instead
		 * of being scrolled to by hand.
		 */
		function TurnTreePanel(props) {
			const t = typeof props.t === "function" ? props.t : key => key;
			const branches = props.branches !== undefined && typeof props.branches.fork === "function"
				? props.branches
				: NOOP_BRANCHES;
			const useProjection = props.useProjection;
			// The projection hook must be called unconditionally; an assembly without
			// the turn-outline plugin simply yields undefined.
			const rawOutline = typeof useProjection === "function" ? useProjection("turnOutline") : undefined;
			const outline = React.useMemo(() => normalizeOutline(rawOutline), [rawOutline]);
			const [open, setOpen] = React.useState(true);
			const [renamingTurn, setRenamingTurn] = React.useState(null);
			const [renameText, setRenameText] = React.useState("");
			const [names, setNames] = React.useState(() => readTurnNames(props.sessionId));
			const [jumpNote, setJumpNote] = React.useState(null);
			const status = useBranchState(branches);
			const byId = props.byId !== undefined ? props.byId : EMPTY_BY_ID;
			const ids = Array.isArray(props.ids) ? props.ids : EMPTY_IDS;
			if (outline.length === 0) return null;

			const nameOf = entry => names[String(entry.turn)] ?? (entry.prompt !== "" ? entry.prompt : t("turn.untitled"));
			const commitRename = turn => {
				const next = renameText;
				setRenamingTurn(null);
				setNames(writeTurnName(props.sessionId, turn, next));
			};
			const forkAt = (entry, index) => {
				branches.fork({
					sourceSessionId: props.sessionId,
					atSeq: turnCutSeq(outline, index),
					title: childTitleOf(ids, byId, props.sessionId, SKIP_DELEGATED),
					select: false,
				}).catch(() => {});
			};

			const rows = outline.map((entry, index) => {
				const isRenaming = renamingTurn === entry.turn;
				const custom = names[String(entry.turn)] !== undefined;
				return h("li", { key: `t${entry.turn}`, className: "dbt_li" },
					h("div", {
						className: "dbt_row dbt_turnRow",
						title: entry.response !== "" ? `${nameOf(entry)}\n\n${entry.response}` : nameOf(entry),
						onClick: () => {
							if (isRenaming) return;
							// A non-text prompt has no transcript text to find; the response
							// preview is the next-best probe for "take me there".
							const probe = entry.prompt !== "" ? entry.prompt : entry.response;
							setJumpNote(jumpToTurn(entry.turn, probe, index === outline.length - 1));
						},
					},
						h("span", { className: "dbt_tag dbt_tagTurn" }, `#${entry.turn}`),
						isRenaming
							? h("input", {
								className: "dbt_renameInput",
								type: "text",
								autoFocus: true,
								value: renameText,
								onClick: event => event.stopPropagation(),
								onChange: event => setRenameText(event.target.value),
								onKeyDown: event => {
									if (event.key === "Enter") commitRename(entry.turn);
									if (event.key === "Escape") setRenamingTurn(null);
								},
								onBlur: () => commitRename(entry.turn),
							})
							: h("span", { className: `dbt_rowTitle${custom ? " dbt_rowTitleNamed" : ""}` }, nameOf(entry)),
						h("span", { className: "dbt_rowActions" },
							entry.seq === undefined ? null : h("button", {
								type: "button",
								className: "dbt_iconBtn",
								title: t("turn.fork"),
								"aria-label": t("turn.fork"),
								disabled: status.pending,
								onClick: event => {
									event.stopPropagation();
									forkAt(entry, index);
								},
							}, h(BranchGlyph, { size: 12 })),
							h("button", {
								type: "button",
								className: "dbt_iconBtn",
								title: t("turn.rename"),
								"aria-label": t("turn.rename"),
								onClick: event => {
									event.stopPropagation();
									setRenamingTurn(entry.turn);
									setRenameText(names[String(entry.turn)] ?? entry.prompt);
								},
							}, h(IconGlyph, { path: PATH_RENAME })),
						)));
			});

			return h("div", { className: "dbt_turnSection" },
				h("div", { className: "dbt_panelHead" },
					h("button", {
						type: "button",
						className: "dbt_iconBtn",
						title: open ? t("turn.collapse") : t("turn.expand"),
						"aria-label": open ? t("turn.collapse") : t("turn.expand"),
						"aria-expanded": open,
						onClick: () => setOpen(current => !current),
					}, h(IconGlyph, { path: PATH_CHEVRON, size: 12, className: open ? "dbt_chevronOpen" : "" })),
					h("span", { className: "dbt_panelTitle" },
						h("span", null, t("turn.title", { count: outline.length })),
						h("span", { className: "dbt_count" }, String(outline.length)))),
				open ? h("ul", { className: "dbt_list" }, rows) : null,
				open && jumpNote === "bottom" ? h("div", { className: "dbt_note" }, t("turn.atEnd")) : null,
				open && jumpNote === "missing" ? h("div", { className: "dbt_note" }, t("turn.notLoaded")) : null);
		}
		//#endregion

		//#region plugin
		/** Required services: slot contributions, dictionaries, and the fork verbs. */
		const inject = ["sessions", "slots", "locale"];

		/**
		 * Client plugin body: register the branch navigator in the session header,
		 * the fork-from-here bar in every completed turn's tail, and the lineage
		 * marks on sidebar session rows.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "branch-tree: dictionaries");
			const branches = createBranchActions(ctx);
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "branch-tree",
				order: 20,
				locale: NS,
				inject: () => ({ branches }),
			}, BranchNavigator));
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				id: "branch-tree-turn",
				order: 35,
				locale: NS,
				inject: () => ({ branches }),
			}, TurnBranchBar));
			ctx.slots.inject("sidebar.session.row.leading", () => ctx.slots.register({
				name: "sidebar.session.row.leading",
				id: "branch-tree-mark",
				order: 5,
				locale: NS,
			}, BranchRowMark));
			ctx.slots.inject("sidebar.session.row.hover", () => ctx.slots.register({
				name: "sidebar.session.row.hover",
				id: "branch-tree-hover",
				order: 5,
				locale: NS,
			}, BranchRowHover));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.familyOf = familyOf;
		exports.childTitleOf = childTitleOf;
		exports.lineageOf = lineageOf;
		exports.isDelegated = isDelegated;
		exports.splitBranchTitle = splitBranchTitle;
		exports.depthInList = depthInList;
		exports.rootOf = rootOf;
		exports.visibleParentOf = visibleParentOf;
		exports.hiddenInList = hiddenInList;
		exports.visibleChildCount = visibleChildCount;
		exports.normalizeOutline = normalizeOutline;
		exports.turnCutSeq = turnCutSeq;
		exports.treeOrder = treeOrder;
		return module.exports;
	}
});
