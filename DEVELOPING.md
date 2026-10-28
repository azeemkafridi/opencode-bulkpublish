# Developing

```bash
npm install
npm test                 # unit tests (no network)
npm run typecheck
npm run build            # dist/gui-experimental.cjs
npm run watch            # rebuild on change; OpenCode reloads the plugin on each build
```

Live API test (saves a draft and a far-future scheduled post with an image,
lists them, then deletes them; nothing is published):

```bash
BP_API_URL=http://localhost:4322 BP_TEST_KEY=bp_… npm test
```

## Layout

- `src/gui.tsx` — the `./gui-experimental` entry.
- `src/gui/main.ts` — main process: holds the key (keychain-encrypted) and makes
  every request, so the key never reaches a window and attachments are read from
  disk by path.
- `src/gui/contract.ts` — the typed bridge between main and windows.
- `src/gui/window.tsx` — panel, dialog, commands, settings page.
- `src/lib/core.ts`, `src/lib/api.ts` — copied from `vscode-bulkpublish`
  (caption limits, channel rules, post body, API client). Keep them in step.
- `src/lib/service.ts` — what main does per request; unit-tested.

## Loading it locally

Point the global config at this folder (OpenCode Desktop reads only the global
`opencode.json(c)` for GUI plugins):

```json
{ "plugins": [{ "package": "/path/to/opencode-bulkpublish", "options": { "apiBase": "http://localhost:4322" } }] }
```

`opencode plugin list` does not list GUI-only plugins; check the server log
(`~/.local/share/opencode/log/opencode.log`, "loading plugin") or
**Settings > BulkPublish** in the app instead.
