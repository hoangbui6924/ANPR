// Server entry: load models once (docs 6.5), check the database, then listen.
import "dotenv/config";
import { config } from "./config.ts";
import { prisma } from "./db.ts";
import { createApp } from "./app.ts";
import { initRecognizer } from "./services/recognize.ts";
import { ensureDirs } from "./services/storage.ts";

await ensureDirs();
const t0 = performance.now();
await initRecognizer();
await prisma.$queryRaw`SELECT 1`;
console.log(`models loaded in ${Math.round(performance.now() - t0)} ms, database ok`);

createApp().listen(config.port, (err) => {
  if (err) {
    console.error(`cannot listen on port ${config.port}: ${err.message} (change PORT in backend/.env)`);
    process.exit(1);
  }
  console.log(`ANPR API on http://localhost:${config.port}`);
});
