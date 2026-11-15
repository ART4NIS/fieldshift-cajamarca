import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf-8");

test("every local asset URL in index.html shares one version", () => {
  const versions = new Set([...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
  assert.equal(versions.size, 1, `found versions: ${[...versions].join(", ")}`);
});

test("every imported module is versioned through the import map", () => {
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const modules = readdirSync(new URL("../js/", import.meta.url)).filter((f) => f.endsWith(".js") && f !== "ui.js");
  for (const m of modules) {
    assert.match(map[`./js/${m}`] ?? "", new RegExp(`^\\./js/${m.replace(".", "\\.")}\\?v=\\d+$`), `${m} missing from import map`);
  }
  assert.match(html, /src="js\/ui\.js\?v=\d+"/, "entry module is versioned");
  assert.match(html, /href="css\/styles\.css\?v=\d+"/, "stylesheet is versioned");
});
