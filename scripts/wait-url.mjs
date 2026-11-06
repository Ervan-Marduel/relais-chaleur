// Attend qu'une URL réponde (utilisé par Playwright pour démarrer le 2e serveur après le build du 1er).
const url = process.argv[2];
const deadline = Date.now() + 300_000;
while (Date.now() < deadline) {
  try { const r = await fetch(url); if (r.status < 500) process.exit(0); } catch { /* pas encore prêt */ }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error(`Délai dépassé en attendant ${url}`);
process.exit(1);
