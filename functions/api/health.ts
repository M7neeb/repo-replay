export const onRequestGet: PagesFunction = async () =>
  Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
