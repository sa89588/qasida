// Decide whether the collector should run now: until the first full pass is done, every run;
// afterwards every run that is at least 3½ hours after the last (new recordings from the site's
// "new" list, new albums, and once a week a full walk — crawl.mjs decides which).
import fs from "node:fs";
const dir = process.argv[2] || "data";
let st = {};
try { st = JSON.parse(fs.readFileSync(dir + "/state.json", "utf8")); } catch {}
const last = st.lastNew || st.lastRun || 0;
const run = !st.done || Date.now() - last > 3.5 * 3600e3 || process.env.FORCE === "1";
fs.appendFileSync(process.env.GITHUB_OUTPUT || "/dev/stdout", `run=${run}\n`);
console.log({ done: !!st.done, last: last ? new Date(last).toISOString() : null, run });
