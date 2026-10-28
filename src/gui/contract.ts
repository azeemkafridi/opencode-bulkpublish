// The bridge between the window and the main process. The API key and every
// request to BulkPublish live in main: the key never reaches a window, and main
// can read an attached file from disk by its path.
import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

const Channel = Schema.Struct({
  id: Schema.Number,
  platform: Schema.String,
  name: Schema.String,
  usable: Schema.Boolean,
  problem: Schema.optional(Schema.String),
})

const Post = Schema.Struct({
  id: Schema.Number,
  content: Schema.String,
  status: Schema.String,
  scheduledAt: Schema.NullOr(Schema.String),
  publishedAt: Schema.NullOr(Schema.String),
  destinations: Schema.Array(
    Schema.Struct({ platform: Schema.String, status: Schema.String, error: Schema.optional(Schema.String) }),
  ),
})

export const SendInput = Schema.Struct({
  content: Schema.String,
  channelIds: Schema.Array(Schema.Number),
  file: Schema.optional(Schema.String),
  mode: Schema.Literals(["now", "schedule", "draft"]),
  scheduledAt: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String),
})

const Skipped = Schema.Struct({ name: Schema.String, platform: Schema.String, reason: Schema.String })

export const BulkPublish = Ipc.define({
  id: "opencode-bulkpublish.api",
  state: Schema.Struct({ signedIn: Schema.Boolean, account: Schema.Number }),
  methods: {
    setKey: { input: Schema.String },
    signOut: {},
    channels: { output: Schema.Array(Channel) },
    posts: { output: Schema.Array(Post) },
    send: { input: SendInput, output: Schema.Struct({ id: Schema.Number, skipped: Schema.Array(Skipped) }) },
    retry: { input: Schema.Number },
  },
})
