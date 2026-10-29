import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { prepareContentModuleArchive } from "../lib/content-module/package.ts";

const validArchive = zipSync({
  "bundle/content-module.json": strToU8(JSON.stringify({
    name: "Тестовый контент",
    version: "2.4.0",
    entry: "dist/index.html"
  })),
  "bundle/dist/index.html": strToU8("<!doctype html><script src=\"./assets/app.js\"></script>"),
  "bundle/dist/assets/app.js": strToU8("document.body.textContent = 'OK';")
});
const prepared = prepareContentModuleArchive(validArchive);
assert.equal(prepared.name, "Тестовый контент");
assert.equal(prepared.version, "2.4.0");
assert.equal(prepared.entryPath, "index.html");
assert.deepEqual(prepared.files.map((file) => file.path), ["index.html", "assets/app.js"]);

const sourceArchive = zipSync({
  "package.json": strToU8("{}"),
  "src/app.tsx": strToU8("export default function App() { return null; }")
});
assert.throws(() => prepareContentModuleArchive(sourceArchive), /исходники/);

const traversalArchive = zipSync({ "../index.html": strToU8("bad") });
assert.throws(() => prepareContentModuleArchive(traversalArchive), /небезопасный/);

console.log("Content module package OK: nested build detected, sources and path traversal rejected.");
