// Window setup: the BulkPublish side panel, its commands, and a settings page.
import { createResource, createSignal, For, Show } from "solid-js"
import { Command, MenuItem, Panel, SettingsPage, Style, usePlugin, type PanelTab, type Plugin } from "@opencode/plugin/gui"
import { countsFor, platformLabel, truncate, type Channel } from "../lib/core"
import { canRetry, statusLabel } from "../lib/view"
import { BulkPublish } from "./contract"
import type { definition } from "./definition"

type Ctx = Parameters<Plugin.Setup<typeof definition>>[0]

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Toasts cut a long title short, so the reason goes in the description. */
function fail(ctx: Ctx, title: string, e: unknown) {
  ctx.toast.show({ variant: "error", title, description: message(e), duration: 10_000 })
}

async function connect(ctx: Ctx) {
  const key = await ctx.dialogs.prompt({
    title: ctx.t("connect.title"),
    description: ctx.t("connect.description"),
    placeholder: "bp_…",
    secret: true,
    submit: ctx.t("connect.submit"),
  })
  if (!key) return
  const busy = ctx.toast.show({ variant: "loading", title: ctx.t("connect.checking"), persistent: true })
  try {
    await ctx.main(BulkPublish).setKey(key)
    ctx.toast.show({ variant: "success", title: ctx.t("connect.done") })
  } catch (e) {
    fail(ctx, ctx.t("fail.connect"), e)
  } finally {
    busy.dismiss()
  }
}

async function signOut(ctx: Ctx) {
  const ok = await ctx.dialogs.confirm({ title: ctx.t("signOut.title"), confirm: ctx.t("signOut"), danger: true })
  if (ok) await ctx.main(BulkPublish).signOut()
}

function SignedOut() {
  const ctx = usePlugin<typeof definition>()
  return (
    <div class="bp-empty">
      <p>{ctx.t("signedOut.body")}</p>
      <ctx.ui.Button variant="contrast" onClick={() => void connect(ctx)}>
        {ctx.t("connect")}
      </ctx.ui.Button>
      <ctx.ui.Button variant="ghost" onClick={() => ctx.system.openExternal("https://app.bulkpublish.com/developer")}>
        {ctx.t("signedOut.getKey")}
      </ctx.ui.Button>
    </div>
  )
}

function Composer(props: { channels: readonly Channel[]; onSent: () => void }) {
  const ctx = usePlugin<typeof definition>()
  const api = ctx.main(BulkPublish)
  const [text, setText] = createSignal("")
  const [chosen, setChosen] = createSignal<number[]>([])
  const [file, setFile] = createSignal<string>()
  const [when, setWhen] = createSignal("")
  const [busy, setBusy] = createSignal<string>()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const platforms = () => props.channels.filter((c) => chosen().includes(c.id)).map((c) => c.platform)
  const counts = () => countsFor(text(), platforms())
  const over = () => counts().some((c) => c.over)
  const toggle = (id: number, on: boolean) => setChosen((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)))

  async function attach() {
    try {
      const [path] = (await ctx.desktop?.pick({
        title: ctx.t("attach.title"),
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm", "m4v"],
      })) ?? []
      if (path) setFile(path)
    } catch (e) {
      fail(ctx, ctx.t("fail.attach"), e)
    }
  }

  async function go(mode: "now" | "schedule" | "draft") {
    setBusy(mode)
    try {
      const result = await api.send({
        content: text(),
        channelIds: chosen(),
        file: file(),
        mode,
        ...(mode === "schedule" ? { scheduledAt: when(), timezone: zone } : {}),
      })
      ctx.toast.show({ variant: "success", title: ctx.t(`sent.${mode}`) })
      for (const s of result.skipped) {
        ctx.toast.show({
          title: ctx.t("sent.skippedTitle", { name: s.name }),
          description: ctx.t("sent.skipped", { platform: platformLabel(s.platform), reason: s.reason }),
          duration: 10_000,
        })
      }
      setText("")
      setFile(undefined)
      setWhen("")
      props.onSent()
    } catch (e) {
      fail(ctx, ctx.t("fail.send"), e)
    } finally {
      setBusy(undefined)
    }
  }

  const ready = () => !busy() && !over() && text().trim() !== "" && chosen().length > 0

  return (
    <section class="bp-section">
      <h3>{ctx.t("channels")}</h3>
      <Show when={props.channels.length} fallback={<p class="bp-muted">{ctx.t("channels.none")}</p>}>
        <div class="bp-channels">
          <For each={props.channels}>
            {(c) => (
              <label classList={{ "bp-channel": true, "bp-disabled": !c.usable }}>
                <input
                  type="checkbox"
                  checked={chosen().includes(c.id)}
                  disabled={!c.usable}
                  onChange={(e) => toggle(c.id, e.currentTarget.checked)}
                />
                <span class="bp-channel-name">{c.name}</span>
                <span class="bp-muted">{platformLabel(c.platform)}</span>
                <Show when={c.problem}>
                  <span class="bp-muted">· {ctx.t("channel.problem", { problem: c.problem! })}</span>
                </Show>
              </label>
            )}
          </For>
        </div>
      </Show>

      <label class="bp-label" for="bp-caption">{ctx.t("caption")}</label>
      <textarea
        id="bp-caption"
        class="bp-caption"
        rows={6}
        value={text()}
        placeholder={ctx.t("caption.placeholder")}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <div class="bp-counts">
        <For each={counts()}>
          {(c) => (
            <span classList={{ "bp-count": true, "bp-over": c.over }}>
              {platformLabel(c.platform)} {c.length}
              {c.limit !== null ? `/${c.limit}` : ""}
            </span>
          )}
        </For>
      </div>

      <div class="bp-row">
        <Show
          when={file()}
          fallback={
            <ctx.ui.Button size="small" variant="ghost" icon="plus" onClick={() => void attach()} disabled={!ctx.desktop}>
              {ctx.t("attach")}
            </ctx.ui.Button>
          }
        >
          {(f) => (
            <>
              <span class="bp-file" title={f()}>{f().split(/[\\/]/).pop()}</span>
              <ctx.ui.IconButton size="small" variant="ghost" icon="close-small" label={ctx.t("attach.remove")} onClick={() => setFile(undefined)} />
            </>
          )}
        </Show>
      </div>

      <label class="bp-label" for="bp-when">{ctx.t("schedule.when", { zone })}</label>
      <input id="bp-when" class="bp-input" type="datetime-local" value={when()} onInput={(e) => setWhen(e.currentTarget.value)} />

      <div class="bp-row bp-actions">
        <ctx.ui.Button variant="contrast" busy={busy() === "now"} disabled={!ready()} onClick={() => void go("now")}>
          {ctx.t("publish")}
        </ctx.ui.Button>
        <ctx.ui.Button busy={busy() === "schedule"} disabled={!ready() || !when()} onClick={() => void go("schedule")}>
          {ctx.t("schedule")}
        </ctx.ui.Button>
        <ctx.ui.Button variant="ghost" busy={busy() === "draft"} disabled={!ready()} onClick={() => void go("draft")}>
          {ctx.t("draft")}
        </ctx.ui.Button>
      </div>
      <Show when={over()}>
        <p class="bp-error">{ctx.t("caption.over")}</p>
      </Show>
    </section>
  )
}

function Recent(props: { refreshKey: number }) {
  const ctx = usePlugin<typeof definition>()
  const api = ctx.main(BulkPublish)
  const [posts, { refetch }] = createResource(() => props.refreshKey, () => api.posts())
  const [retrying, setRetrying] = createSignal<number>()

  async function retry(id: number) {
    setRetrying(id)
    try {
      await api.retry(id)
      ctx.toast.show({ variant: "success", title: ctx.t("retry.done") })
      await refetch()
    } catch (e) {
      fail(ctx, ctx.t("fail.retry"), e)
    } finally {
      setRetrying(undefined)
    }
  }

  return (
    <section class="bp-section">
      <div class="bp-row bp-head">
        <h3>{ctx.t("recent")}</h3>
        <ctx.ui.IconButton size="small" variant="ghost" icon="refresh" label={ctx.t("refresh")} busy={posts.loading} onClick={() => void refetch()} />
      </div>
      <Show when={!posts.error} fallback={<p class="bp-error">{message(posts.error)}</p>}>
        <Show when={posts()} fallback={<ctx.ui.Loader />}>
          {(list) => (
            <Show when={list().length} fallback={<p class="bp-muted">{ctx.t("recent.none")}</p>}>
              <ul class="bp-posts">
                <For each={list()}>
                  {(p) => (
                    <li class="bp-post">
                      <div class="bp-row bp-head">
                        <span class={`bp-status bp-status-${p.status}`}>{statusLabel(p.status)}</span>
                        <Show when={canRetry(p.status, p.destinations)}>
                          <ctx.ui.Button size="small" variant="ghost" busy={retrying() === p.id} onClick={() => void retry(p.id)}>
                            {ctx.t("retry")}
                          </ctx.ui.Button>
                        </Show>
                      </div>
                      <p>{truncate(p.content, 140)}</p>
                      <p class="bp-muted">
                        {p.destinations.map((d) => `${platformLabel(d.platform)}: ${statusLabel(d.status)}`).join(" · ")}
                        {p.scheduledAt && p.status === "scheduled" ? ` · ${new Date(p.scheduledAt).toLocaleString()}` : ""}
                      </p>
                      <For each={p.destinations.filter((d) => d.error)}>
                        {(d) => <p class="bp-error">{platformLabel(d.platform)}: {d.error}</p>}
                      </For>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          )}
        </Show>
      </Show>
    </section>
  )
}

function SignedIn() {
  const ctx = usePlugin<typeof definition>()
  const api = ctx.main(BulkPublish)
  const [channels, { refetch }] = createResource(() => api.channels())
  const [tick, setTick] = createSignal(0)
  return (
    <>
      <Show when={!channels.error} fallback={<p class="bp-error">{message(channels.error)}</p>}>
        <Show when={channels()} fallback={<ctx.ui.Loader />}>
          {(list) => <Composer channels={list()} onSent={() => setTick((n) => n + 1)} />}
        </Show>
      </Show>
      <Recent refreshKey={tick()} />
      <div class="bp-row">
        <ctx.ui.Button size="small" variant="ghost-muted" onClick={() => void refetch()}>
          {ctx.t("channels.reload")}
        </ctx.ui.Button>
        <ctx.ui.Button size="small" variant="ghost-muted" onClick={() => void signOut(ctx)}>
          {ctx.t("signOut")}
        </ctx.ui.Button>
      </div>
    </>
  )
}

function View() {
  const ctx = usePlugin<typeof definition>()
  const state = () => ctx.main(BulkPublish).state()
  return (
    <div class="bp-root">
      <Show when={state()} fallback={<ctx.ui.Loader />}>
        {(s) => (
          // Keyed on the account, so a replaced key starts a fresh view.
          <Show when={s().signedIn ? s().account : undefined} keyed fallback={<SignedOut />}>
            {(_account: number) => <SignedIn />}
          </Show>
        )}
      </Show>
    </div>
  )
}

function SettingsView() {
  const ctx = usePlugin<typeof definition>()
  const signedIn = () => !!ctx.main(BulkPublish).state()?.signedIn
  return (
    <div class="bp-root bp-settings">
      <h2>{ctx.t("title")}</h2>
      <p>{signedIn() ? ctx.t("settings.connected") : ctx.t("signedOut.body")}</p>
      <div class="bp-row">
        <ctx.ui.Button variant="contrast" onClick={() => void connect(ctx)}>
          {signedIn() ? ctx.t("connect.replace") : ctx.t("connect")}
        </ctx.ui.Button>
        <Show when={signedIn()}>
          <ctx.ui.Button variant="ghost" onClick={() => void signOut(ctx)}>
            {ctx.t("signOut")}
          </ctx.ui.Button>
        </Show>
      </div>
    </div>
  )
}

export const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const key = `${ctx.id}:compose`
  const tab: PanelTab = {
    id: "compose",
    get title() {
      return ctx.t("title")
    },
    closable: "compact",
  }

  const open = () => {
    const session = ctx.sessions.current()
    if (session) return ctx.layout.open(key, session)
    // No session to hang a side panel on: show the same view in a dialog.
    ctx.dialogs.open(() => (
      <ctx.ui.Dialog title={ctx.t("title")} size="large">
        <View />
      </ctx.ui.Dialog>
    ))
  }

  ctx.add(Style, STYLE)
  ctx.add(Panel, {
    id: "compose",
    region: "side",
    list: (input) => (input.open.includes("compose") ? [tab] : []),
    render: () => <View />,
  })
  ctx.add(MenuItem, (): MenuItem => {
    const session = ctx.sessions.current()
    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("title"),
      icon: "cloud-upload",
      keybind: `${ctx.id}.open`,
      opened: !!session && ctx.layout.state(key, session) !== "closed",
      run: open,
    }
  })
  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("command.open"),
    keywords: "social post schedule publish",
    slash: { name: "bulkpublish" },
    run: open,
  }))
  ctx.add(Command, () => ({ id: "connect", title: ctx.t("command.connect"), run: () => void connect(ctx) }))
  ctx.add(Command, () => ({
    id: "signOut",
    title: ctx.t("command.signOut"),
    enabled: !!ctx.main(BulkPublish).state()?.signedIn,
    run: () => void signOut(ctx),
  }))
  ctx.add(SettingsPage, {
    id: "bulkpublish",
    icon: "cloud-upload",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [{ id: "key", title: ctx.t("settings.key"), keywords: "api key token sign out" }]
    },
    render: () => <SettingsView />,
  })
}

const STYLE = `
.bp-root { display: flex; flex-direction: column; gap: 16px; padding: 12px; font-size: 13px; overflow-y: auto; height: 100%; box-sizing: border-box; }
.bp-settings { padding: 48px 0 0; max-width: 640px; height: auto; }
.bp-settings h2 { margin: 0; font-size: 16px; font-weight: 600; }
.bp-settings p { margin: 0; opacity: .75; }
.bp-section { display: flex; flex-direction: column; gap: 8px; }
.bp-section h3 { margin: 0; font-size: 13px; font-weight: 600; }
.bp-empty { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.bp-channels { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
.bp-channel { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; cursor: pointer; }
.bp-channel-name { font-weight: 500; }
.bp-disabled { cursor: default; opacity: .6; }
.bp-label { font-weight: 500; }
.bp-caption, .bp-input { font: inherit; color: inherit; background: transparent; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 6px; padding: 8px; }
.bp-caption { resize: vertical; min-height: 96px; }
.bp-counts { display: flex; flex-wrap: wrap; gap: 6px; }
.bp-count { font-size: 11px; opacity: .75; font-variant-numeric: tabular-nums; }
.bp-over { opacity: 1; color: #d33; font-weight: 600; }
.bp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bp-head { justify-content: space-between; }
.bp-file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.bp-muted { opacity: .65; margin: 0; }
.bp-error { color: #d33; margin: 0; }
.bp-posts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.bp-post { border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent); padding-top: 8px; }
.bp-post p { margin: 4px 0 0; word-break: break-word; }
.bp-status { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
.bp-status-failed, .bp-status-partial { color: #d33; }
.bp-status-published { color: #2a9d55; }
`
