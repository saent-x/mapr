import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const url = process.env.CONVEX_SELF_HOSTED_URL || "http://127.0.0.1:3210";
const client = new ConvexHttpClient(url);
const q = (name) => makeFunctionReference(name);

const list = await client.query(q("events:list"), {});
console.log("events.list count:", list.length);

async function intent(text) {
  const r = await client.query(q("events:intentSearch"), { text });
  console.log(`\n> "${text}"`);
  console.log(`  intent=${r.intent} matchCount=${r.matchCount} scope=${r.scope ?? "—"}`);
  console.log(`  reply: ${r.reply}`);
  if (r.eventIds) console.log(`  mapEventIds=${r.eventIds.length}`);
  if (r.regions) console.log(`  regions=${r.regions.map((x) => `${x.iso}:${x.avg.toFixed(1)}`).join(", ")}`);
  if (r.anomalies) console.log(`  anomalies=${r.anomalies.map((x) => `${x.label} ${x.delta}`).join(", ")}`);
}

await intent("red-tier conflict in the last hour");
await intent("cyber activity in Europe");
await intent("how many events in the last 24h");
await intent("top 3 by severity");
await intent("what's spiking right now?");
await intent("top hotspots");
await intent("brief me on the last 6 hours");
