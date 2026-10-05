// Copies an optional extra page (../hide.html + its data) into public/u/ before dev/build.
// public/u/ is git-ignored. Missing files are simply skipped.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = path.resolve(here, "../..");
const out = path.resolve(here, "../public/u");
const page = path.join(root, "hide.html");
if (!fs.existsSync(page)) process.exit(0);
fs.mkdirSync(path.join(out, "img"), { recursive: true });
fs.copyFileSync(page, path.join(out, "index.html"));
const data = path.join(root, "img", "tkl.points.js");
if (fs.existsSync(data)) fs.copyFileSync(data, path.join(out, "img", "tkl.points.js"));
