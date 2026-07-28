# UX copy canon

Locked, designer-facing strings shipped in the dashboard and terminal report. Change one, review the
build brief that introduced it; this file is the single source of truth for exact wording.

## 2026-07-28 — hygiene-speaks-designer (F4: the ledger card)

**Card title** (`#hygcard`, top of the working ledger):
- warn &gt; 0: `Worth a look — N thing${N===1?'':'s'} in the library`
- clean: `Library check — all clean`

**Per-finding line** (`‹A›`/`‹B›` = page display labels, never slugs):

| Finding | Line (locked) |
|---|---|
| same-template (vs rep) | `‹A› uses the same layout as ‹B› — one example can stand for both.` |
| same-template (group, no rep) | `‹A›, ‹B›… share one layout — one example can stand for all of them.` |
| duplicate-content | `‹A› and ‹B› are the same capture twice.` |
| orphan (warn) | `Nothing links to ‹A› — the map can't show how you reach it.` |
| identical-state (vs base) | `The state "‹name›" on ‹A› looks identical to the page itself — the click may not have changed anything.` |
| identical-state (vs sibling) | `"‹n1›" and "‹n2›" on ‹A› are the same view captured twice.` |
| quality: near-empty | `‹A› came back nearly empty — it may have been captured mid-load.` |
| quality: blob images | `Some images on ‹A› were live-only and didn't survive the capture.` |
| quality: missing screenshot | `‹A› has no screenshot.` |
| quality: mid-render | `‹A› may have been captured while still loading.` |

**Buttons:**
- Primary: `Fold into one example` · `Fold into one` · `Say how you got there` · `Re-capture` · `Re-capture it`
- Secondary: `Keep both` · `Keep them all` · `Keep as is` · `It's fine — keep it` · `It really looks like this`
- Tertiary (every warning): `Copy the fix prompt`

**Note-input placeholders:**
- Keep-note (optional): `Why keep it? (optional — your AI reads this)`
- Reached-by (required): `e.g. from the account menu`

**Info-level footer** (collapsed, no buttons): `N more note${N===1?'':'s'} — nothing needed from you`

**file:// / no-server degradation** (POST-backed buttons hidden, `Copy the fix prompt` remains):
`Fixes need the kit's server — run tools/start.sh`

**Terminal report tail** (F1 — acked findings never vanish, they fold into one line):
`N kept on purpose (noted).`
