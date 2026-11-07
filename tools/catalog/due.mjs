// Decide whether the collector should run now: until the first full pass is done, every run;
// afterwards once a week (only new albums are read then).
import fs from "node:fs";
const dir = process.argv[2] || "data";
let st = {};
try { st = JSON.parse(fs.readFileSync(dir + "/state.json", "utf8")); } catch {}
const week = 7 * 864e5;
const run = !st.done || !st.lastRun || Date.now() - st.lastRun > week || process.env.FORCE === "1";
fs.appendFileSync(process.env.GITHUB_OUTPUT || "/dev/stdout", `run=${run}\n`);
console.log({ done: !!st.done, lastRun: st.lastRun ? new Date(st.lastRun).toISOString() : null, run });
