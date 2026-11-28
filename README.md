# repo-replay

Paste a GitHub link and watch how the project grew, from the first commit to today.

<a href="https://repo-replay.pages.dev/M7neeb/repo-replay"><picture><source media="(prefers-color-scheme: dark)" srcset="https://repo-replay.pages.dev/api/card/M7neeb/repo-replay.svg?theme=dark"><img alt="How M7neeb/repo-replay grew" src="https://repo-replay.pages.dev/api/card/M7neeb/repo-replay.svg"></picture></a>

**[repo-replay.pages.dev](https://repo-replay.pages.dev)**

A replay is a chart of the project's files, stacked by top-level folder, that draws itself over
30 to 60 seconds. Captions mark the moments you can check on GitHub: the first commit, the first
release, a folder arriving or taking over, the busiest stretch, a big cleanup.

- **Share it.** Every replay has its own link (`/owner/repo`), and the link shows the project's
  chart when you paste it into a chat.
- **Save it as a video.** A square MP4 made in your browser, ready for Photos, WhatsApp or X.
- **Put it in your README.** The card above is one line of HTML, in GitHub's light and dark
  themes. It shows the newest saved replay, so it catches up whenever someone opens the page.

It works with public repos only. There's no sign-in, no cookies and no tracking. The only thing
kept is the public repo data a replay is drawn from.

## How it reads a repo

The site runs on Cloudflare Pages. The functions in `functions/` talk to GitHub with one read-only
token. A function on the free plan gets 10 ms of CPU and 50 requests to other servers per call,
so the page builds a replay in small steps:

- `GET /api/replay/:owner/:name` returns the saved replay, or what's needed to build one.
- `GET /api/history` reads 500 commits per call. Histories over 5,000 commits are sampled instead
  (`GET /api/buckets`): 60 slices of time, each with its commit count and a sample.
- `GET /api/trees` lists the files at up to 60 points in time. Big file lists are read in parts.
- `POST /api/replay` saves the finished replay to KV.

The server signs every step's answer and checks the signatures before saving, so a saved replay
can only contain data that came from GitHub.

Everything else reads saved replays and never calls GitHub:

- `GET /api/card/:owner/:name.svg` (`?theme=dark`): the animated README card. It reads only the
  small signed summaries, so it stays inside the CPU limit for big projects.
- `GET /api/og/:owner/:name.png`: the picture for link previews. Drawing an SVG with a full
  renderer took about 50 ms of CPU, so `server/raster.ts` draws the chart's shapes directly, sets
  text from pre-rendered Noto Sans glyphs (`server/glyphs.ts`, made by `scripts/glyphs.mjs`) and
  writes the PNG with a run-length encoder. Each picture is drawn once and then cached.
- `GET /api/saved/:owner/:name`: the replay on the home page.
- `/:owner/:name`: the app's page with that repo's title and preview picture filled in.

Videos are made in the browser: `src/lib/video.ts` draws each frame on a canvas and
[Mediabunny](https://mediabunny.dev) encodes them as H.264 in an MP4 with WebCodecs.

## Limits

- Histories over 5,000 commits are sampled, so their per-period numbers are estimates. File counts
  always come from real snapshots.
- When GitHub lists only part of a huge file tree, the counts say so and are lower than the real ones.
- The first replay of a very big project (torvalds/linux) takes up to two minutes. After that it
  opens straight away.
- All visitors share one GitHub allowance. When it runs out, saved replays still open and new ones
  say when to try again.

## Running it locally

```
npm ci
npm run dev
```

Checks: `npm run check`, `npm test`, `npm run e2e`.

To try the API locally, put `GITHUB_TOKEN=...` (a fine-grained token with read access to public
repos) in `.dev.vars`, then run `npm run build` and `npx wrangler pages dev dist`.

## Deploying your own

Set `GITHUB_TOKEN` as a secret on the Pages project and bind a KV namespace as `REPLAYS`.
Without KV everything still works; replays just aren't saved.

## Licence

[MIT](LICENSE)
