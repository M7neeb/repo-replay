export interface Env {
  GITHUB_TOKEN?: string;
  REPLAYS?: KVNamespace;
  /** The site's static files (Cloudflare Pages provides this). */
  ASSETS?: Fetcher;
}
