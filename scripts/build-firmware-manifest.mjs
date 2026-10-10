#!/usr/bin/env node
// Adds firmware zips to a firmware directory and rewrites manifest.json (see src/domain/manifest.ts).
// The firmware fork (kbball/MeshCore-tracker) runs this from its ares-firmware workflow, checked out from
// this repo's main: keep the command line below stable.
//
//   node scripts/build-firmware-manifest.mjs --dir out/firmware --version v1.12.0-abc1234 --keep 5 \
//     --entry "Xiao_nrf52_companion_radio_usb_ble|Seeed XIAO nRF52840|companion|path/to/firmware.zip" ...
//
// Zips are copied to <dir>/<version>/<env>.zip. Existing entries are kept; only the newest --keep versions
// stay (older version directories are deleted). Re-adding a version replaces that version's entries.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    version: { type: "string" },
    keep: { type: "string", default: "5" },
    entry: { type: "string", multiple: true },
  },
});
if (!values.dir || !values.version || !values.entry?.length) {
  console.error(
    'usage: --dir <dir> --version <v> [--keep N] --entry "env|board|kind|zip" ...',
  );
  process.exit(2);
}

const dir = values.dir;
const version = values.version;
const keep = Number(values.keep);
const manifestPath = join(dir, "manifest.json");
mkdirSync(join(dir, version), { recursive: true });

let entries = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8")).entries
  : [];
entries = entries.filter((e) => e.version !== version);

for (const spec of values.entry) {
  const [env, board, kind, src] = spec.split("|");
  if (!env || !board || !["companion", "gateway", "tracker"].includes(kind) || !src)
    throw new Error(`bad --entry: ${spec}`);
  const file = `${version}/${env}.zip`;
  copyFileSync(src, join(dir, file));
  const sha256 = createHash("sha256").update(readFileSync(src)).digest("hex");
  entries.push({ board, env, kind, version, file, sha256 });
}

// keep the newest versions, ordered by when they were first added (manifest order), newest last
const order = [...new Set(entries.map((e) => e.version))];
const dropped = order.slice(0, Math.max(0, order.length - keep));
for (const v of dropped) rmSync(join(dir, v), { recursive: true, force: true });
entries = entries.filter((e) => !dropped.includes(e.version));

writeFileSync(manifestPath, JSON.stringify({ entries }, null, 2) + "\n");
console.log(
  `manifest: ${entries.length} entries, versions ${[...new Set(entries.map((e) => e.version))].join(", ")}`,
);
