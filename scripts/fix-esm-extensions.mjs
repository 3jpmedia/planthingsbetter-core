#!/usr/bin/env node
/**
 * Rewrites extensionless relative import/export specifiers in `dist/` to
 * include an explicit `.js` (or `/index.js`) extension.
 *
 * `tsconfig.json` uses `moduleResolution: "bundler"` so source files can
 * write `from "./types"` without an extension -- convenient for editing,
 * and fine for consumers that resolve modules through a bundler (webpack,
 * Vite, Next.js). But this package's `package.json` declares `"type":
 * "module"` and ships to consumers that load it directly through Node's
 * (or Vitest's) native ESM resolver, which requires explicit extensions on
 * relative specifiers -- an extensionless `export * from "./types"` fails
 * with "Cannot find module '.../dist/core/types'" there, even though the
 * file exists right next to it.
 *
 * Rather than rewriting every relative import across `src/` to spell out
 * `.js` (which `moduleResolution: "bundler"` doesn't require and would fight
 * the editing convenience it's there for), this runs once after `tsc` and
 * patches only the emitted `.js`/`.d.ts` output -- source stays exactly as
 * written.
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const SPECIFIER_RE = /((?:from|import)\s+["'])(\.\.?\/[^"']+)(["'])/g;

function resolveExtension(fromFile, specifier) {
	const base = resolve(dirname(fromFile), specifier);
	if (existsSync(`${base}.js`)) return `${specifier}.js`;
	if (existsSync(base) && statSync(base).isDirectory() && existsSync(join(base, "index.js"))) {
		return `${specifier}/index.js`;
	}
	// Already has an extension, or nothing on disk matches (shouldn't happen
	// for a clean build) -- leave it untouched rather than guessing.
	return specifier;
}

function patchFile(file) {
	const original = readFileSync(file, "utf8");
	const patched = original.replace(SPECIFIER_RE, (match, prefix, specifier, suffix) => {
		if (/\.[a-zA-Z]+$/.test(specifier)) return match; // already has an extension
		return `${prefix}${resolveExtension(file, specifier)}${suffix}`;
	});
	if (patched !== original) writeFileSync(file, patched);
}

function walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full);
		} else if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
			patchFile(full);
		}
	}
}

walk(distDir);
console.log("[fix-esm-extensions] patched relative import/export specifiers in dist/");
