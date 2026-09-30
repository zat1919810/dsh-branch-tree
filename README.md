# dsh-branch-tree

Conversation branching for **DeepSeek Harness (DSH)**: fork a conversation at any
completed turn into an independent conversation that inherits everything before
the fork point, ask a different question in each branch, branch a branch, and
navigate the whole tree.

[中文说明 →](README.zh.md)

```
main conversation
├── branch ⑂1        ← forked after turn 4, keeps turns 1–4
│   └── branch ⑂1     ← forked from the branch
└── branch ⑂2        ← sibling of ⑂1, never sees it
```

Sibling branches cannot affect each other: each one is a separate session log, so
only a branch's own ancestors' copied prefix reaches it.

## Features

| Surface | What it adds |
|---|---|
| **Session header** | A `Branches` chip: the whole branch family as an indented tree, with open / rename / delete / branch-again on every row, plus **Collapse all / Expand all**. |
| **Turn tail** | `Fork from here` under *every* completed turn (not just the last), with an optional question: *fork and ask* builds the branch, switches to it, and sends the question. |
| **Sidebar rows** | A `⑂` mark and hover lineage on branch rows, a fold chevron on rows that own branches, real indentation by lineage depth, and a switchable row order (tree vs. the shipped order). |
| **Turn tree (in the panel)** | Every turn of the current branch with the app's own prompt preview as its default name: click to jump to that turn, `✎` to rename it locally, `⑂` to fork at the **exact end of that turn**. |

Everything the feature needs already exists in the Host — the plugin adds the
presentation and orchestration layer on top of `session.fork` and the durable
`parentSession` lineage. It declares no Host state of its own.

## Install

DSH plugin manager (Web → **Plugins**, or `dsh plugin install`):

```
dsh-branch-tree            # from npm
<owner>/<repo>             # from GitHub
./dsh-branch-tree-1.0.0.tgz # from a tarball
```

The package ships `dsh.bundle.patch`, so installing it and selecting the bundle
is enough: its loader row is inserted by the patch it carries — you never hand
edit the profile's `cordis.patch.yml`.

Manual install into a profile (`~/.dsh/profiles/<profile>`):

```bash
pnpm add dsh-branch-tree
```

then add `"dsh-branch-tree"` to that profile's `package.json` under
`dsh.profile.bundles` and restart, or simply add this to the profile's
`cordis.patch.yml`:

```yaml
- insert:
    - id: ui-branch-tree
      name: dsh-branch-tree
```

Requirements: a DSH runtime whose version satisfies the `@deepseek-ai/dsh` peer
range in `package.json` (verified on `0.2.0-rc.2`; the `0.1.0-rc.8` API is
covered by code-level fallbacks but was not exercised at runtime). No build step
and no runtime dependencies: the browser half is a hand-written bundle that only
requires the shell-seeded React.

## Configuration

None. There is no plugin config schema; behaviour is fixed and all state lives
either in DSH's own session logs (branches, lineage) or in this browser's
`localStorage` (custom turn names, the sidebar order choice, fold state).

## What it touches (plugin contract)

Useful if you want to maintain a fork. All of these are additive DSH extension
points with `replaceRisk: none`, so the shipped UI keeps working without it:

- slots: `conversation.session.header.utilities`, `conversation.chat.turnTail`,
  `sidebar.session.row.leading`, `sidebar.session.row.hover`
- services (resolved lazily, with a fallback per capability): `sessions.fork`,
  `sessions.using`/`retain`/`binding`, `uiWorkspace.openSession` /
  `sessions.open`, `uiWorkspace.archiveSession` / `workspaces.archiveSession`
- standard slot props: `sessionId`, `useSessions`, `useProjection`
  (`turnOutline`), `inputActions`
- one shipped DOM hook, used defensively: session rows carry
  `data-row-key="session:<id>"`, which is how the sidebar gains indentation and
  folding. If a future build drops it, the sidebar simply renders as shipped
  again — nothing breaks.
- one shipped DOM container, used for the turn jump: `[data-conversation-scroll]`

Two client-runtime generations exist in the wild, so every verb above is chosen
**at call time** and degrades to the older generation's equivalent. The
authoritative description of the running client is DSH's own inspect surface
(`cordis_inspect_query`, platform `client`) — not the packages under
`profiles/node_modules`, which may be an older generation than the app ships.

## Limits

- **Turn names are local.** A session log has no durable turn title, so renaming
  a turn is a presentation overlay kept in `localStorage`.
- **"Jump to turn" needs the turn loaded.** Jumps use an anchor this plugin
  registers inside each completed turn's tail; a turn paginated out of the view
  falls back to a text probe inside the transcript and then says so.
- **Delete is archive.** DSH's only session-removal verb is `archiveSession`, so
  "delete branch" archives it (recoverable) — it is not a filesystem delete.
- **A branch's model** follows the Host default selection rather than inheriting
  the source conversation's manual model choice.
- The sidebar indentation/folding/order depend on the shipped `data-row-key`
  attribute described above.

## Tests

```bash
npm test          # 12 assertion groups over the pure projections
```

The pure logic (lineage family, branch titles, delegation filtering, collapse
cascade, sidebar fold, turn outline normalization, exact cut seqs, tree order) is
covered without a browser: the bundle is materialized with a stubbed React and
Windows module loader.

## Authorship

This plugin was **written entirely by AI** — authored inside a DeepSeek Harness
session from a human's requirements and acceptance testing, with no human
line-by-line review of the code. Treat it accordingly:

- every behavioural claim in this document was verified against a running DSH,
  and the pure logic is covered by the bundled suite (`npm test`, 12 groups);
- the least certain parts are the ones that depend on the shipped UI: the
  `data-row-key` sidebar hook, the sidebar reorder/fold engine, and the
  text-probe fallback for the turn jump. Those are the first things to check
  after a DSH upgrade.

Issues and patches are welcome.

## License

**MIT** — see [LICENSE](LICENSE). Use it, read it, modify it, redistribute it,
including commercially; the only condition is keeping the copyright notice.

A consequence worth stating plainly: MIT also grants the right to **sell** the
software (the license text says so: *"...and/or sell copies of the Software"*).
If you would rather nobody could sell it, that right is removed by appending the
[Commons Clause](https://commonsclause.com/) to the MIT text — a deliberate
trade-off, because "may not sell" makes a license **non-open-source** under the
OSI definition. This project chose plain MIT so it stays genuinely open and can
be bundled by anyone.

This is an unofficial plugin. DeepSeek Harness itself is MIT licensed and is not
affiliated with this project.
