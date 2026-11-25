<script lang="ts">
  import { parseRepoUrl, type RepoRef } from './lib/repoUrl';

  let link = $state('');
  let error = $state('');
  let picked = $state<RepoRef | null>(null);

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const repo = parseRepoUrl(link);
    if (!repo) {
      picked = null;
      error = 'That doesn’t look like a GitHub repo. Try something like github.com/sveltejs/svelte';
      return;
    }
    error = '';
    picked = repo;
  }
</script>

<main>
  <h1>repo-replay</h1>
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
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'link-error' : undefined}
      />
      <button type="submit">Replay</button>
    </div>
    {#if error}
      <p id="link-error" class="error" role="alert">{error}</p>
    {/if}
  </form>

  {#if picked}
    <p class="status" role="status">
      Found <strong>{picked.owner}/{picked.name}</strong>. Replays are still being built.
    </p>
  {/if}
</main>

<style>
  main {
    max-width: 36rem;
    margin: 0 auto;
    padding: max(48px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
      48px max(16px, env(safe-area-inset-left));
  }
  h1 { font-size: 2rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
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
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .error { color: var(--error); margin: 0.6rem 0 0; }
  .status { margin-top: 1.5rem; }
</style>
