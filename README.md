# repo-replay

Paste a GitHub link and watch how the project grew, from the first file to today.

Work in progress. Right now it reads a public repo's history and shows it year by year; the
animated replay comes next.

## How it reads a repo

The site runs on Cloudflare Pages, and the functions in `functions/api` talk to GitHub with one
read-only token. A Worker on the free plan gets 10 ms of CPU and 50 requests to other servers per
call, so the page builds a replay in small steps:

- `GET /api/replay/:owner/:name` returns the saved replay, or what's needed to build one.
- `GET /api/history` reads 500 commits per call. Histories over 5,000 commits are sampled
  instead (`GET /api/buckets`): 60 slices of time, with the commit count for each and a sample.
- `GET /api/trees` lists the files at up to 60 points in time. Big file lists are read in parts.
- `POST /api/replay` saves the finished replay to KV.

The server signs every step's answer and checks the signatures before saving, so a saved
replay can only contain data that came from GitHub.

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
