<script lang="ts">
  import { onMount } from 'svelte';
  import { parseRepoUrl, type RepoRef } from './lib/repoUrl';
  import { loadReplay, LoadError, type Loaded, type Progress } from './lib/build';
  import { summarize, formatCount, formatDate, formatShort, plural } from './lib/summary';

  type View =
    | { kind: 'home' }
    | { kind: 'loading'; ref: RepoRef; progress: Progress }
    | { kind: 'done'; ref: RepoRef; loaded: Loaded; seconds: number }
    | { kind: 'failed'; ref: RepoRef; error: LoadError };

  let link = $state('');
  let linkError = $state('');
  let view = $state<View>({ kind: 'home' });
  let controller: AbortController | null = null;

  const summary = $derived(view.kind === 'done' ? summarize(view.loaded.replay) : null);

  function refFromPath(path: string): RepoRef | null {
    const parts = path.split('/').filter(Boolean);
    return parts.length === 2 ? parseRepoUrl(`${parts[0]}/${parts[1]}`) : null;
  }

  async function open(ref: RepoRef) {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    const started = performance.now();
    view = { kind: 'loading', ref, progress: { stage: 'start' } };
    try {
      const loaded = await loadReplay(ref, {
        signal: mine.signal,
        onProgress: (progress) => {
          if (controller === mine) view = { kind: 'loading', ref, progress };
        },
      });
      if (controller !== mine) return;
      const actual = { owner: loaded.replay.repo.owner, name: loaded.replay.repo.name };
      view = { kind: 'done', ref: actual, loaded, seconds: (performance.now() - started) / 1000 };
      if (location.pathname !== `/${actual.owner}/${actual.name}`) {
        history.replaceState(null, '', `/${actual.owner}/${actual.name}`);
      }
    } catch (err) {
      if (controller !== mine || (err as Error).name === 'AbortError') return;
      view = { kind: 'failed', ref, error: err instanceof LoadError ? err : new LoadError('upstream') };
    }
  }

  function route() {
    const ref = refFromPath(location.pathname);
    if (ref) {
      link = `github.com/${ref.owner}/${ref.name}`;
      open(ref);
    } else {
      controller?.abort();
      controller = null;
      view = { kind: 'home' };
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const ref = parseRepoUrl(link);
    if (!ref) {
      linkError = 'That doesn’t look like a GitHub repo. Try something like github.com/sveltejs/svelte';
      return;
    }
    linkError = '';
    const path = `/${ref.owner}/${ref.name}`;
    if (location.pathname !== path) history.pushState(null, '', path);
    open(ref);
  }

  onMount(() => {
    route();
    window.addEventListener('popstate', route);
    return () => window.removeEventListener('popstate', route);
  });

  function progressText(p: Progress, ref: RepoRef): string {
    switch (p.stage) {
      case 'start':
        return `Looking up ${ref.owner}/${ref.name}`;
      case 'history':
        return p.unit === 'parts'
          ? `Reading the history: ${p.done} of ${p.total} parts`
          : `Reading the history: ${formatCount(p.done)} of ${plural(p.total, 'commit', 'commits')}`;
      case 'files':
        return `Looking at the files: ${p.done} of ${p.total} points in time`;
      case 'save':
        return 'Saving the replay';
    }
  }

  function seconds(s: number): string {
    return s < 0.1 ? 'under 0.1 s' : `${s.toFixed(1)} s`;
  }

  function errorText(e: LoadError): string {
    switch (e.kind) {
      case 'not_found':
        return 'This repo is private or doesn’t exist. repo-replay only works with public repos.';
      case 'empty':
        return 'There’s nothing to replay yet. The project needs at least two commits.';
      case 'busy': {
        const at = e.retryAt ? new Date(e.retryAt * 1000) : null;
        const time = at?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `repo-replay has used up its GitHub allowance for now. Replays already saved still open. Try this one again${time ? ` after ${time}` : ' in an hour'}.`;
      }
      case 'offline':
        return 'Couldn’t connect. Check your internet and try again.';
      case 'not_configured':
        return 'repo-replay isn’t set up on this server yet.';
      case 'upstream':
        return 'GitHub didn’t answer properly. Try again in a minute.';
      default:
        return 'Something went wrong while building this replay. Try again.';
    }
  }
</script>

<main>
  <h1><a href="/" onclick={(e) => { e.preventDefault(); history.pushState(null, '', '/'); route(); }}>repo-replay</a></h1>
  <p class="lede">Paste a GitHub link and watch how the project grew.</p>

  <form onsubmit={submit} novalidate>
    <label for="link">GitHub link</label>
    <div class="row">
      <input
        id="link"
        name="link"
        type="text"
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="github.com/owner/repo"
        bind:value={link}
        aria-invalid={linkError ? 'true' : undefined}
        aria-describedby={linkError ? 'link-error' : undefined}
      />
      <button type="submit">Replay</button>
    </div>
    {#if linkError}
      <p id="link-error" class="error" role="alert">{linkError}</p>
    {/if}
  </form>

  {#if view.kind === 'loading'}
    <p class="status" role="status" aria-live="polite">{progressText(view.progress, view.ref)}</p>
  {:else if view.kind === 'failed'}
    <p class="error" role="alert">{errorText(view.error)}</p>
  {:else if view.kind === 'done' && summary}
    {@const r = view.loaded.replay.repo}
    <section aria-labelledby="repo-title">
      <h2 id="repo-title">{r.owner}/{r.name}</h2>
      {#if r.description}<p class="desc">{r.description}</p>{/if}

      <dl>
        <div><dt>First commit</dt><dd>{formatDate(summary.firstAt)}</dd></div>
        <div><dt>Latest commit</dt><dd>{formatDate(summary.headAt)}</dd></div>
        <div><dt>Commits</dt><dd>{formatCount(summary.commits)}</dd></div>
        <div><dt>{r.sampled ? 'People seen' : 'People'}</dt><dd>{formatCount(summary.people)}</dd></div>
        <div><dt>Files now</dt><dd>{formatCount(summary.files)}</dd></div>
        <div><dt>Stars</dt><dd>{formatCount(r.stars)}</dd></div>
      </dl>

      {#if r.sampled}
        <p class="note">This history is too long to read commit by commit, so lines of code aren’t counted and the people are the ones seen in a sample.</p>
      {/if}
      {#if view.loaded.replay.snapshots.at(-1)?.truncated}
        <p class="note">GitHub listed only part of the files, so file counts are lower than the real ones.</p>
      {/if}

      <div class="table">
        <table>
          <caption>{summary.byMonth ? 'Month by month' : 'Year by year'}{#if !r.sampled}<span>, lines of code added and removed</span>{/if}</caption>
          <thead>
            <tr>
              <th scope="col">{summary.byMonth ? 'Month' : 'Year'}</th>
              <th scope="col">Commits</th>
              {#if !r.sampled}
                <th scope="col">Added</th>
                <th scope="col">Removed</th>
              {/if}
              <th scope="col">Files</th>
              <th scope="col">New people</th>
            </tr>
          </thead>
          <tbody>
            {#each summary.periods as p (p.label)}
              <tr>
                <th scope="row">{p.label}</th>
                <td>{formatCount(p.commits)}</td>
                {#if !r.sampled}
                  <td>{formatShort(p.added)}</td>
                  <td>{formatShort(p.deleted)}</td>
                {/if}
                <td>{p.files === null ? '' : formatCount(p.files)}</td>
                <td>{formatCount(p.newPeople)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <p class="note" data-testid="source">
        {#if view.loaded.stale}
          GitHub is busy, so this is the last saved copy. It may be missing the newest commits.
        {:else if view.loaded.cached}
          Opened the saved replay in {seconds(view.seconds)}.
        {:else}
          Built in {seconds(view.seconds)}{view.loaded.saved ? ' and saved, so it opens straight away next time' : ''}.
        {/if}
      </p>
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 44rem;
    margin: 0 auto;
    padding: max(48px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
      48px max(16px, env(safe-area-inset-left));
  }
  h1 { font-size: 2rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
  h1 a { color: inherit; text-decoration: none; }
  .lede { color: var(--muted); margin: 0 0 2rem; }
  label { display: block; font-weight: 600; margin-bottom: 0.5rem; }
  .row { display: flex; gap: 0.5rem; }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 16px;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: transparent;
    color: inherit;
  }
  input[aria-invalid='true'] { border-color: var(--error); }
  button {
    font: inherit;
    font-weight: 600;
    padding: 0.7rem 1.1rem;
    border: 0;
    border-radius: 6px;
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
  }
  input:focus-visible, button:focus-visible, h1 a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .error { color: var(--error); margin: 0.6rem 0 0; }
  .status { margin-top: 1.5rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  section { margin-top: 2.5rem; }
  h2 { font-size: 1.35rem; margin: 0 0 0.35rem; overflow-wrap: anywhere; }
  .desc { margin: 0 0 1.25rem; color: var(--muted); }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.75rem 1.5rem;
    margin: 0 0 1.25rem;
  }
  dt { font-size: 0.8rem; color: var(--muted); }
  dd { margin: 0.1rem 0 0; font-weight: 600; font-variant-numeric: tabular-nums; }
  .note { font-size: 0.875rem; color: var(--muted); margin: 0 0 1rem; }
  .table { overflow-x: auto; margin: 0 0 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.875rem; font-variant-numeric: tabular-nums; }
  caption { text-align: left; font-weight: 600; padding-bottom: 0.5rem; }
  caption span { font-weight: 400; color: var(--muted); }
  th, td { padding: 0.4rem 0 0.4rem 0.75rem; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--line); }
  th:first-child { text-align: left; padding-left: 0; }
  thead th { font-weight: 500; color: var(--muted); white-space: normal; vertical-align: bottom; }
</style>
