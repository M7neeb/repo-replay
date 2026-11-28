<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Replay } from '../../shared/replay';
  import { chartModel, fmt, liveChartSvg, monthYear, rowAt, slot } from '../../shared/chart';
  import { findMoments } from '../../shared/moments';
  import { captionAt, captionParts, clock, compact, durationFor, readmeSnippet, timeAt } from './playback';
  import { summarize } from './summary';

  // `example` is the copy on the home page: no side panel, and it starts when it scrolls into view
  let { replay, note = '', example = false }: { replay: Replay; note?: string; example?: boolean } = $props();

  const moments = $derived(replay.moments.length ? replay.moments : findMoments(replay));
  const model = $derived(chartModel(replay, moments));
  const duration = $derived(durationFor(replay.repo.commits));
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // people who ask for less motion get the finished chart and can press play themselves
  let progress = $state(reduceMotion ? 1 : 0);
  let playing = $state(!reduceMotion && !untrack(() => example));
  let section: HTMLElement | undefined = $state();

  $effect(() => {
    if (!example || reduceMotion || !section || typeof IntersectionObserver === 'undefined') return;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.disconnect();
        if (progress === 0) playing = true;
      }
    }, { threshold: 0.5 });
    seen.observe(section);
    return () => seen.disconnect();
  });
  let width = $state(0);
  let chartEl: HTMLDivElement | undefined = $state();

  const t = $derived(timeAt(model, progress));
  const row = $derived(rowAt(model, t));
  const caption = $derived(captionAt(model, t));
  const chart = $derived(width > 0 ? liveChartSvg(model, Math.round(width), 'replay') : null);
  const table = $derived(summarize(replay));
  const parts = $derived.by(() => {
    const list = model.series.map((name, k) => ({ name: `${name}/`, files: row.v[k], cls: slot(model, k) }));
    const other = row.v[model.series.length];
    if (other > 0) list.push({ name: 'other', files: other, cls: 'o' });
    return list.filter((p) => p.files > 0).sort((a, b) => b.files - a.files);
  });

  let frame = 0;
  let last = 0;
  function tick(now: number) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    progress = Math.min(1, progress + dt / duration);
    if (progress >= 1) {
      playing = false;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  $effect(() => {
    if (!playing) return;
    last = 0;
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });
  onDestroy(() => cancelAnimationFrame(frame));

  function toggle() {
    if (!playing && progress >= 1) progress = 0;
    playing = !playing;
  }

  // the chart is drawn once per size; each frame only moves the reveal, the playhead and the milestones
  $effect(() => {
    if (!chart || !chartEl) return;
    const L = chart.layout;
    const x = L.X(t);
    const reveal = chartEl.querySelector('[data-reveal]');
    reveal?.setAttribute('width', String(Math.max(0, x)));
    const head = chartEl.querySelector('[data-playhead]');
    head?.setAttribute('x1', String(x));
    head?.setAttribute('x2', String(x));
    head?.setAttribute('visibility', progress > 0 && progress < 1 ? 'visible' : 'hidden');
    chartEl.querySelectorAll<SVGGElement>('[data-at]').forEach((g) => {
      g.setAttribute('visibility', Number(g.dataset.at) <= t ? 'visible' : 'hidden');
    });
  });

  function scrubFromPointer(e: PointerEvent) {
    if (!chart) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const L = chart.layout;
    const x = ((e.clientX - box.left) / box.width) * L.width;
    progress = Math.min(1, Math.max(0, (x - L.plot.x) / L.plot.w));
  }

  function chartDown(e: PointerEvent) {
    playing = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubFromPointer(e);
  }

  function chartMove(e: PointerEvent) {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) scrubFromPointer(e);
  }

  type VideoState =
    | { kind: 'idle' }
    | { kind: 'making'; share: number }
    | { kind: 'ready'; file: File; url: string }
    | { kind: 'failed'; message: string };
  let video = $state<VideoState>({ kind: 'idle' });
  let videoStop: AbortController | null = null;
  const fileName = $derived(`${replay.repo.owner}-${replay.repo.name}-replay.mp4`);

  async function makeTheVideo() {
    videoStop?.abort();
    const stop = new AbortController();
    videoStop = stop;
    video = { kind: 'making', share: 0 };
    try {
      const { makeVideo } = await import('./saveVideo');
      const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
      const blob = await makeVideo(model, replay.repo.commits, {
        theme: dark ? 'dark' : 'light',
        signal: stop.signal,
        onProgress: (done, total) => {
          if (videoStop === stop) video = { kind: 'making', share: done / total };
        },
      });
      if (videoStop !== stop) return;
      const file = new File([blob], fileName, { type: 'video/mp4' });
      video = { kind: 'ready', file, url: URL.createObjectURL(file) };
    } catch (err) {
      if (videoStop !== stop || (err as Error).name === 'AbortError') return;
      const unsupported = (err as Error).name === 'VideoUnsupported';
      video = {
        kind: 'failed',
        message: unsupported
          ? 'This browser can’t make videos. Safari on an iPhone, or Chrome or Edge on a computer, can.'
          : 'The video couldn’t be made. Try again.',
      };
    }
  }

  function cancelVideo() {
    videoStop?.abort();
    videoStop = null;
    video = { kind: 'idle' };
  }

  const canShareFile = (file: File) => typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  async function shareVideo(file: File) {
    try {
      await navigator.share({ files: [file], title: `How ${replay.repo.owner}/${replay.repo.name} grew` });
    } catch {
      // closing the share sheet is not a problem
    }
  }

  onDestroy(() => {
    videoStop?.abort();
    if (video.kind === 'ready') URL.revokeObjectURL(video.url);
  });

  const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

  let copied = $state<'' | 'link' | 'readme'>('');
  const snippet = $derived(readmeSnippet(typeof location === 'undefined' ? '' : location.origin, replay.repo.owner, replay.repo.name));
  async function copy(what: 'link' | 'readme') {
    try {
      await navigator.clipboard.writeText(what === 'link' ? location.href : snippet);
      copied = what;
      setTimeout(() => (copied = ''), 2000);
    } catch {
      copied = '';
    }
  }
</script>

<section class="player" class:example bind:this={section} aria-label="Replay of {replay.repo.owner}/{replay.repo.name}">
  <div class="intro">
    <svelte:element this={example ? 'h2' : 'h1'} class="repo">{replay.repo.owner}/<b>{replay.repo.name}</b></svelte:element>
    {#if replay.repo.description}<p class="desc">{replay.repo.description}</p>{/if}
    <p class="meta">
      {monthYear(replay.repo.firstAt)} to {monthYear(replay.repo.headAt)} · {fmt(replay.repo.commits)}
      {replay.repo.commits === 1 ? 'commit' : 'commits'} · {compact(replay.repo.stars)} {replay.repo.stars === 1 ? 'star' : 'stars'}
    </p>
    <div class="now" aria-live="off">
      <span class="count" data-testid="count">{fmt(row.files)} {row.files === 1 ? 'file' : 'files'}</span>
      <span class="when" data-testid="when">in {monthYear(row.at)}</span>
    </div>
    <p class="caption" data-testid="caption">
      {#if caption}
        {#each captionParts(caption) as part, i (i)}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}
      {:else}&nbsp;{/if}
    </p>
  </div>

  <div class="story">
    <div
      class="chart"
      bind:clientWidth={width}
      bind:this={chartEl}
      onpointerdown={chartDown}
      onpointermove={chartMove}
      role="presentation"
    >
      {#if chart}{@html chart.svg}{/if}
    </div>
    <div class="controls">
      <button class="play" onclick={toggle} aria-label={playing ? 'Pause' : progress >= 1 ? 'Play again' : 'Play'}>
        {#if playing}
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor"/></svg>
        {:else if progress >= 1}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2.5v3h3"/></svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>
        {/if}
      </button>
      <input
        class="scrub"
        type="range"
        min="0"
        max="1000"
        step="1"
        value={Math.round(progress * 1000)}
        oninput={(e) => { playing = false; progress = Number(e.currentTarget.value) / 1000; }}
        aria-label="Position in the replay"
        aria-valuetext={monthYear(t)}
        style="--p: {progress * 100}%"
      />
      <span class="time">{clock(progress * duration)} / {clock(duration)}</span>
    </div>
  </div>

  {#if !example}
  <aside class="side">
    <h2>What it’s made of in {monthYear(row.at)}</h2>
    <div class="bar" aria-hidden="true">
      {#each parts as p (p.name)}<span class="seg {p.cls}" style="flex: {p.files}"></span>{/each}
    </div>
    <ul class="rows">
      {#each parts as p (p.name)}
        <li>
          <i class="sw {p.cls}" aria-hidden="true"></i>
          <span class="name">{p.name}</span>
          <span class="n">{fmt(p.files)}</span>
          <span class="pc">{Math.round((p.files / Math.max(row.files, 1)) * 100)}%</span>
        </li>
      {/each}
    </ul>

    <div class="actions">
      <div class="video" aria-live="polite">
        {#if video.kind === 'idle'}
          <button class="btn primary" onclick={makeTheVideo}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M2.5 13.5h11"/></svg>
            Save video
          </button>
        {:else if video.kind === 'making'}
          <div class="making">
            <span>Making the video… {Math.round(video.share * 100)}%</span>
            <button class="btn small" onclick={cancelVideo}>Cancel</button>
          </div>
          <div class="meter" aria-hidden="true"><i style="width: {video.share * 100}%"></i></div>
        {:else if video.kind === 'ready'}
          {#if canShareFile(video.file)}
            <button class="btn primary" onclick={() => video.kind === 'ready' && shareVideo(video.file)}>Save or share the video</button>
          {:else}
            <a class="btn primary" href={video.url} download={fileName}>Download the video</a>
          {/if}
          <p class="vnote">MP4, {megabytes(video.file.size)}, {clock(duration + 4)} long. <button class="link" onclick={cancelVideo}>Start over</button></p>
        {:else}
          <p class="vfail">{video.message}</p>
          <button class="btn" onclick={makeTheVideo}>Try again</button>
        {/if}
      </div>
      <button class="btn" onclick={() => copy('link')}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6.5 9.5l3-3M5.5 7.5L4 9a2.4 2.4 0 003.4 3.4L9 11M10.5 8.5L12 7a2.4 2.4 0 00-3.4-3.4L7 5"/></svg>
        {copied === 'link' ? 'Link copied' : 'Copy link'}
      </button>
      <div class="readme">
        <div class="readme-head">
          <strong>Put it in your README</strong>
          <button class="btn small" onclick={() => copy('readme')}>{copied === 'readme' ? 'Copied' : 'Copy'}</button>
        </div>
        <p>An animated version of this chart for GitHub, in light and dark. It shows the newest saved replay, so it catches up whenever someone opens this page.</p>
        <code class="snippet">{snippet}</code>
      </div>
      <span class="vh" role="status">{copied === 'link' ? 'Link copied' : copied === 'readme' ? 'README line copied' : ''}</span>
    </div>

    <details class="tablewrap">
      <summary>Show as a table</summary>
      <table>
        <caption class="vh">{table.byMonth ? 'Month by month' : 'Year by year'}</caption>
        <thead>
          <tr><th scope="col">{table.byMonth ? 'Month' : 'Year'}</th><th scope="col">Commits</th><th scope="col">Files</th><th scope="col">New people</th></tr>
        </thead>
        <tbody>
          {#each table.periods as p (p.label)}
            <tr><th scope="row">{p.label}</th><td>{fmt(p.commits)}</td><td>{p.files === null ? '' : fmt(p.files)}</td><td>{fmt(p.newPeople)}</td></tr>
          {/each}
        </tbody>
      </table>
    </details>

    <p class="foot">
      {#if replay.repo.sampled}This history has {fmt(replay.repo.commits)} commits, so it was read in 60 time slices.{/if}
      {#if replay.snapshots.at(-1)?.truncated} GitHub listed only part of the files, so file counts are lower than the real ones.{/if}
      {note}
    </p>
  </aside>
  {/if}
</section>

<style>
  .player { display: grid; gap: 0; }
  .repo { font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .repo b { font-weight: 700; }
  .desc { color: var(--muted); margin: 2px 0 0; }
  .meta { color: var(--muted); font-size: 14px; margin: 6px 0 0; font-variant-numeric: tabular-nums; }
  .now { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; margin-top: 22px; }
  .count { font-size: 40px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
  .when { color: var(--muted); font-variant-numeric: tabular-nums; }
  .caption { font-size: 22px; line-height: 1.3; font-weight: 500; margin: 10px 0 8px; max-width: 32ch; min-height: 2.6em; text-wrap: balance; }
  .caption code { font: 600 0.9em ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; background: var(--sunk); border: 1px solid var(--line); border-radius: 6px; padding: 0 5px; }
  .chart { margin: 4px 0 0; touch-action: pan-y; cursor: ew-resize; user-select: none; }
  .chart :global(svg) { display: block; width: 100%; height: auto; overflow: visible; }

  /* the chart SVG carries light colours; these take over so it follows the page's theme */
  .chart :global(.band.s1) { fill: var(--s1); } .chart :global(.edge.s1) { stroke: var(--s1); }
  .chart :global(.band.s2) { fill: var(--s2); } .chart :global(.edge.s2) { stroke: var(--s2); }
  .chart :global(.band.s3) { fill: var(--s3); } .chart :global(.edge.s3) { stroke: var(--s3); }
  .chart :global(.band.s4) { fill: var(--s4); } .chart :global(.edge.s4) { stroke: var(--s4); }
  .chart :global(.band.s5) { fill: var(--s5); } .chart :global(.edge.s5) { stroke: var(--s5); }
  .chart :global(.band.s6) { fill: var(--s6); } .chart :global(.edge.s6) { stroke: var(--s6); }
  .chart :global(.band.o) { fill: var(--other); } .chart :global(.edge.o) { stroke: var(--other); }
  .chart :global(.band) { fill-opacity: var(--fill); }
  .chart :global(.gap) { stroke: var(--surface); }
  .chart :global(.gr) { stroke: var(--grid); }
  .chart :global(.ax) { stroke: var(--line); }
  .chart :global(text) { font-family: inherit; }
  .chart :global(.m) { fill: var(--muted); }
  .chart :global(.i) { fill: var(--ink); }
  .chart :global(.h) { paint-order: stroke; stroke: var(--surface); stroke-width: 5px; stroke-linejoin: round; }
  .chart :global(.lead) { stroke: var(--muted); }
  .chart :global(.dot) { fill: var(--ink); stroke: var(--surface); }
  .chart :global(.ph) { stroke: var(--ink); }

  .controls { display: grid; grid-template-columns: 44px 1fr auto; align-items: center; gap: 12px; margin-top: 8px; }
  .play { width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--ink); color: var(--surface); display: grid; place-items: center; cursor: pointer; }
  .time { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .scrub { -webkit-appearance: none; appearance: none; width: 100%; height: 28px; background: transparent; margin: 0; cursor: pointer; }
  .scrub::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(to right, var(--ink) var(--p), var(--hair) var(--p)); }
  .scrub::-moz-range-track { height: 6px; border-radius: 3px; background: linear-gradient(to right, var(--ink) var(--p), var(--hair) var(--p)); }
  .scrub::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; margin-top: -6px; border-radius: 50%; background: var(--ink); border: 3px solid var(--surface); }
  .scrub::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--ink); border: 3px solid var(--surface); }

  h2 { font-size: 15px; font-weight: 600; margin: 28px 0 10px; }
  .bar { display: flex; height: 14px; gap: 2px; border-radius: 4px; overflow: hidden; background: var(--hair); }
  .seg { display: block; min-width: 2px; transition: flex-grow 0.25s ease-out; }
  .rows { list-style: none; margin: 10px 0 0; padding: 0; font-size: 14px; }
  .rows li { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto 40px; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--hair); font-variant-numeric: tabular-nums; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sw { width: 12px; height: 12px; border-radius: 3px; }
  .n { text-align: right; }
  .pc { text-align: right; color: var(--muted); }
  .seg.s1, .sw.s1 { background: var(--s1); } .seg.s2, .sw.s2 { background: var(--s2); }
  .seg.s3, .sw.s3 { background: var(--s3); } .seg.s4, .sw.s4 { background: var(--s4); }
  .seg.s5, .sw.s5 { background: var(--s5); } .seg.s6, .sw.s6 { background: var(--s6); }
  .seg.o, .sw.o { background: var(--other); }

  .actions { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 24px; }
  .btn { height: 44px; border-radius: 6px; border: 1px solid var(--line); background: var(--sunk); color: var(--ink); font-weight: 600; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
  .btn:hover { border-color: var(--muted); }
  .btn.small { height: 34px; padding: 0 14px; font-size: 14px; }
  .btn.primary { background: var(--ink); color: var(--surface); border-color: var(--ink); text-decoration: none; }
  .video { display: grid; gap: 8px; }
  .making { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-variant-numeric: tabular-nums; }
  .meter { height: 6px; border-radius: 3px; background: var(--hair); overflow: hidden; }
  .meter i { display: block; height: 100%; background: var(--ink); border-radius: 3px; }
  .vnote, .vfail { margin: 0; font-size: 14px; color: var(--muted); }
  .vfail { color: var(--error); }
  .link { border: 0; background: none; padding: 0; color: var(--ink); text-decoration: underline; font: inherit; cursor: pointer; }
  .readme { border: 1px solid var(--line); border-radius: 6px; padding: 14px; }
  .readme-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .readme p { color: var(--muted); font-size: 14px; margin: 6px 0 10px; }
  .snippet { display: block; font: 12px/1.5 ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace; background: var(--sunk); border-radius: 6px; padding: 10px; overflow-wrap: anywhere; color: var(--muted); max-height: 7.5em; overflow: auto; user-select: all; }

  .tablewrap { margin-top: 20px; font-size: 14px; }
  .tablewrap summary { cursor: pointer; color: var(--muted); }
  .tablewrap table { width: 100%; border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
  .tablewrap th, .tablewrap td { text-align: right; padding: 5px 0 5px 10px; border-bottom: 1px solid var(--hair); }
  .tablewrap th:first-child { text-align: left; padding-left: 0; }
  .tablewrap thead th { color: var(--muted); font-weight: 500; }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .foot { color: var(--muted); font-size: 13px; margin: 18px 0 0; }

  @media (min-width: 960px) {
    .player:not(.example) { grid-template-columns: minmax(0, 1fr) 320px; column-gap: 56px; }
    .intro, .story { grid-column: 1; }
    .side { grid-column: 2; grid-row: 1 / 3; padding-top: 4px; }
    .side h2 { margin-top: 0; }
    .count { font-size: 48px; }
    .caption { font-size: 26px; }
  }
</style>
