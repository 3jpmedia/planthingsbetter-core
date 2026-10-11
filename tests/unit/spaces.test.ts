import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { applyFilters, seedFromFilters, snapshotContext } from "../../src/core/views";
import { DEFAULT_DEFINITION } from "../../src/core/views/defaults";
import { NONE, type WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

function withSpaces(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	const spaces = [
		{ path: "s-products", id: "S-0003", title: "Products" },
		{ path: "s-clients", id: "S-0004", title: "Client work" },
	];
	const tasks = [
		task({ path: "t1", id: "T-1", title: "One", space: "s-products" }),
		task({ path: "t2", id: "T-2", title: "Two", space: "s-clients" }),
		task({ path: "t3", id: "T-3", title: "Three", space: null }),
		// A host without Spaces leaves the field out: workspace-wide.
		task({ path: "t4", id: "T-4", title: "Four" }),
	];
	return { ...base, tasks, spaces };
}

describe("space in the query language", () => {
	const snapshot = withSpaces();
	const ctx = queryContext(snapshot);

	it("prints the key and reads it back", () => {
		const definition = { ...DEFAULT_DEFINITION, filters: { space: ["s-products"] } };
		const source = printQuery(definition, ctx);
		expect(source).toContain("space:S-0003");
		const parsed = parseQuery(source, ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition.filters.space).toEqual(["s-products"]);
	});

	it("takes a Space's name too, unset for workspace-wide, and exclusion", () => {
		expect(parseQuery('space:"Client work"', ctx).definition.filters.space).toEqual(["s-clients"]);
		expect(parseQuery("space:unset", ctx).definition.filters.space).toEqual([NONE]);
		expect(parseQuery("-space:Products", ctx).definition.filters.excludeSpace).toEqual(["s-products"]);
		expect(printQuery({ ...DEFAULT_DEFINITION, filters: { space: [NONE] } }, ctx)).toContain("space:unset");
	});

	it("warns about a Space it doesn't know", () => {
		const parsed = parseQuery("space:Nowhere", ctx);
		expect(parsed.issues.some((issue) => issue.message.includes("Nowhere"))).toBe(true);
	});
});

describe("space in views", () => {
	const snapshot = withSpaces();
	const context = snapshotContext(snapshot);
	const paths = (filters: object) => applyFilters(snapshot.tasks, filters, context).map((t) => t.path).sort();

	it("filters, finds workspace-wide tasks, and excludes", () => {
		expect(paths({ space: ["s-products"] })).toEqual(["t1"]);
		expect(paths({ space: ["s-products", "s-clients"] })).toEqual(["t1", "t2"]);
		expect(paths({ space: [NONE] })).toEqual(["t3", "t4"]);
		expect(paths({ excludeSpace: ["s-products"] })).toEqual(["t2", "t3", "t4"]);
		expect(paths({ excludeSpace: [NONE] })).toEqual(["t1", "t2"]);
	});

	it("seeds a new task's Space, but not from workspace-wide", () => {
		expect(seedFromFilters({ space: ["s-products"] })).toMatchObject({ space: "s-products" });
		expect(seedFromFilters({ space: [NONE] }).space).toBeUndefined();
	});
});
