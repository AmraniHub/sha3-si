// Run one scan from this machine and print the event stream and the checks.
// Usage: node tests/scan-cli.mjs <url-or-domain> [--lei LEI]
import { scan } from "../lib/scanner.js";

const args = process.argv.slice(2);
const lei = args.includes("--lei") ? args[args.indexOf("--lei") + 1] : undefined;
const input = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--lei");
const { report } = await scan({ input, lei }, (type, data) => {
  if (type === "step") console.log("·", data.msg);
  if (type === "fetch") console.log("  fetch", data.status ?? data.error, data.url, data.sha3_256 ? data.sha3_256.slice(0, 12) : "");
});
for (const c of report.checks) console.log(`[${c.state}] ${c.title}: ${c.detail}`);
console.log("score", JSON.stringify(report.score), "firm", report.firm && report.firm.name, "ms", report.duration_ms);
for (const l of report.limits) console.log("limit:", l);
