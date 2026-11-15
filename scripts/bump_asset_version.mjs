// Sets a new cache-busting version on every local asset URL in index.html.
// Usage: npm run bump
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../index.html", import.meta.url);
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const version = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

const html = readFileSync(file, "utf-8");
const updated = html.replace(/\?v=\d+/g, `?v=${version}`);
writeFileSync(file, updated);
console.log(`Asset version set to ${version}`);
