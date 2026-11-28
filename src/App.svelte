<script lang="ts">
  import { onMount } from 'svelte';
  import { parseRepoUrl, type RepoRef } from './lib/repoUrl';
  import { loadReplay, loadSaved, LoadError, type Loaded, type Progress } from './lib/build';
  import type { Replay } from '../shared/replay';
  import { formatCount, plural } from './lib/summary';
  import Player from './lib/Player.svelte';

  type View =
    | { kind: 'home' }
    | { kind: 'loading'; ref: RepoRef; progress: Progress }
    | { kind: 'done'; ref: RepoRef; loaded: Loaded; seconds: number }
    | { kind: 'failed'; ref: RepoRef; error: LoadError };

  const EXAMPLES = ['sveltejs/svelte', 'torvalds/linux', 'M7neeb/repo-replay'];
  // the replay already playing on the home page; only a saved copy is used, so it costs no GitHub calls
  const SHOWCASE = { owner: 'sveltejs', name: 'svelte' };

  let link = $state('');
  let linkError = $state('');
  let view = $state<View>({ kind: 'home' });
  let controller: AbortController | null = null;
  let input: HTMLInputElement | undefined = $state();
  let showcase = $state<Replay | null>(null);
  let showcaseAsked = false;

  $effect(() => {
    if (view.kind !== 'home' || showcaseAsked) return;
    showcaseAsked = true;
    loadSaved(SHOWCASE).then((r) => (showcase = r)).catch(() => {});
  });

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
    document.title = `${ref.owner}/${ref.name} · repo-replay`;
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
      document.title = `${actual.owner}/${actual.name} · repo-replay`;
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
      linkError = '';
      open(ref);
    } else {
      controller?.abort();
      controller = null;
      view = { kind: 'home' };
      document.title = 'repo-replay';
    }
  }

  function go(path: string) {
    if (location.pathname !== path) history.pushState(null, '', path);
    route();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const ref = parseRepoUrl(link);
    if (!ref) {
      linkError = 'That doesn’t look like a GitHub repo. Try something like github.com/sveltejs/svelte';
      return;
    }
    linkError = '';
    go(`/${ref.owner}/${ref.name}`);
  }

  function goHome(event: MouseEvent) {
    event.preventDefault();
    go('/');
    queueMicrotask(() => input?.focus());
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
          ? `Reading the history: ${p.done} of ${p.total} slices`
          : `Reading the history: ${formatCount(p.done)} of ${plural(p.total, 'commit', 'commits')}`;
      case 'files':
        return `Looking at the files: ${p.done} of ${p.total} points in time`;
      case 'save':
        return 'Saving the replay';
    }
  }

  function progressShare(p: Progress): number {
    switch (p.stage) {
      case 'start': return 0.03;
      case 'history': return 0.05 + 0.55 * (p.total ? p.done / p.total : 0);
      case 'files': return 0.6 + 0.35 * (p.total ? p.done / p.total : 0);
      case 'save': return 0.97;
    }
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

  function savedNote(v: Extract<View, { kind: 'done' }>): string {
    if (v.loaded.stale) return 'GitHub is busy, so this is the last saved copy and may miss the newest commits.';
    if (v.loaded.cached) return '';
    return `Built in ${v.seconds.toFixed(1)} s${v.loaded.saved ? ' and saved, so it opens straight away next time' : ''}.`;
  }
</script>

<header class="top">
  <a class="mark" href="/" onclick={goHome}>
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M2 19h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 16l4-5 4 2 4-6 4-4" fill="none" stroke="var(--s1)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    repo-replay
  </a>
  {#if view.kind !== 'home'}
    <a class="another" href="/" onclick={goHome}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5" stroke-linecap="round"/></svg>
      Another repo
    </a>
  {/if}
</header>

<main>
  {#if view.kind === 'home' || view.kind === 'failed'}
    <section class="home">
      {#if view.kind === 'home'}
        <h1>See how any GitHub project grew.</h1>
        <p class="lede">Paste a link to a public repo. You get a short replay of its files and folders from the first commit to today, with the big moments marked.</p>
      {/if}

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
            bind:this={input}
            aria-invalid={linkError ? 'true' : undefined}
            aria-describedby={linkError ? 'link-error' : undefined}
          />
          <button type="submit">Replay</button>
        </div>
        {#if linkError}
          <p id="link-error" class="error" role="alert">{linkError}</p>
        {/if}
      </form>

      {#if view.kind === 'failed'}
        <div class="problem" role="alert">
          <strong>{view.ref.owner}/{view.ref.name}</strong>
          <p>{errorText(view.error)}</p>
        </div>
      {:else}
        <p class="try">
          Try
          {#each EXAMPLES as ex, i (ex)}
            <a href="/{ex}" onclick={(e) => { e.preventDefault(); link = `github.com/${ex}`; go(`/${ex}`); }}>{ex}</a>{i < EXAMPLES.length - 2 ? ', ' : i === EXAMPLES.length - 2 ? ' or ' : '.'}
          {/each}
        </p>
      {/if}
    </section>
    {#if view.kind === 'home' && showcase}
      <section class="showcase" aria-labelledby="showcase-label">
        <p class="label" id="showcase-label">Example</p>
        <Player replay={showcase} example />
        <a class="full" href="/{SHOWCASE.owner}/{SHOWCASE.name}" onclick={(e) => { e.preventDefault(); link = `github.com/${SHOWCASE.owner}/${SHOWCASE.name}`; go(`/${SHOWCASE.owner}/${SHOWCASE.name}`); }}>Open the full replay</a>
      </section>
    {/if}
  {:else if view.kind === 'loading'}
    <section class="loading" aria-busy="true">
      <h1 class="repo">{view.ref.owner}/<b>{view.ref.name}</b></h1>
      <div class="meter" aria-hidden="true"><i style="width: {progressShare(view.progress) * 100}%"></i></div>
      <p class="status" role="status" aria-live="polite">{progressText(view.progress, view.ref)}</p>
      <p class="hint">The first replay of a big project takes up to a minute. After that it opens straight away.</p>
    </section>
  {:else if view.kind === 'done'}
    {#key `${view.ref.owner}/${view.ref.name}@${view.loaded.replay.repo.head}`}
      <Player replay={view.loaded.replay} note={savedNote(view)} />
    {/key}
  {/if}
</main>

<style>
  .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 60px; padding: 10px max(16px, env(safe-area-inset-right)) 10px max(16px, env(safe-area-inset-left)); border-bottom: 1px solid var(--line); }
  .mark { display: flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: -0.01em; color: var(--ink); text-decoration: none; }
  .another { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--sunk); color: var(--muted); font-size: 14px; text-decoration: none; }
  .another:hover { color: var(--ink); border-color: var(--muted); }
  main { max-width: 1240px; margin: 0 auto; padding: 22px max(16px, env(safe-area-inset-right)) 48px max(16px, env(safe-area-inset-left)); }

  .home { max-width: 40rem; padding-top: 6vh; }
  h1 { font-size: 36px; line-height: 1.1; letter-spacing: -0.025em; margin: 0 0 12px; font-weight: 700; text-wrap: balance; }
  .lede { color: var(--muted); font-size: 18px; margin: 0 0 28px; max-width: 34em; }
  label { display: block; font-weight: 600; font-size: 14px; margin-bottom: 6px; }
  .row { display: flex; gap: 8px; }
  input { flex: 1; min-width: 0; font-size: 16px; height: 46px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--sunk); }
  input:focus { border-color: var(--s1); background: var(--surface); }
  input[aria-invalid='true'] { border-color: var(--error); }
  button[type='submit'] { height: 46px; padding: 0 18px; border: 0; border-radius: 6px; background: var(--ink); color: var(--surface); font-weight: 600; cursor: pointer; }
  .error { color: var(--error); margin: 8px 0 0; font-size: 14px; }
  .try { color: var(--muted); margin: 18px 0 0; font-size: 15px; }
  .try a { color: var(--ink); }
  .problem { margin-top: 20px; padding: 14px 16px; border: 1px solid var(--error); border-radius: 6px; }
  .problem strong { display: block; margin-bottom: 2px; overflow-wrap: anywhere; }
  .problem p { margin: 0; }

  .showcase { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line); max-width: 960px; }
  .label { margin: 0 0 14px; color: var(--muted); font-size: 14px; font-weight: 600; }
  .full { display: inline-block; margin-top: 14px; color: var(--ink); font-size: 15px; font-weight: 600; }

  .loading { max-width: 40rem; padding-top: 4vh; }
  .repo { font-size: 24px; font-weight: 600; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .repo b { font-weight: 700; }
  .meter { height: 6px; border-radius: 3px; background: var(--hair); overflow: hidden; margin-top: 22px; }
  .meter i { display: block; height: 100%; background: var(--s1); border-radius: 3px; transition: width 0.3s ease-out; }
  .status { margin: 12px 0 0; font-variant-numeric: tabular-nums; }
  .hint { color: var(--muted); font-size: 14px; margin: 6px 0 0; }

  @media (min-width: 960px) {
    .top { padding: 10px 32px; }
    main { padding: 32px 40px 56px; }
    h1 { font-size: 48px; }
  }
</style>
