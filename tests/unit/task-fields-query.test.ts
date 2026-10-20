import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { matchesNumberValue, normalizeNumberValue } from "../../src/core/number-values";
import { applyFilters, isEmptyFilterSet, snapshotContext } from "../../src/core/views";
import type { WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

const ME = "jr";
const SAM = "sam";

/** Tasks with estimates, makers, comments, sub-tasks and internal ones (T-0951). */
function withFields(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	return {
		...base,
		workspace: {
			...base.workspace,
			people: [
				{ id: ME, name: "JR Leonard", email: "M-0001", aliases: [] },
				{ id: SAM, name: "Sam Rivera", email: "M-0002", aliases: [] },
			],
		},
		tasks: [
			task({ path: "a", id: "T-1", title: "Plan", estimate: 3, createdBy: ME, commentCount: 2, commenters: [SAM], description: "Ask Nafis about the CAT scan" }),
			task({ path: "b", id: "T-2", title: "Build", estimate: 8, createdBy: SAM, commentCount: 0, internal: true, parent: "a" }),
			task({ path: "c", id: "T-3", title: "Ship", estimate: null, commentCount: 6, commenters: [ME, SAM], parent: "a" }),
			task({ path: "d", id: "T-4", title: "Rest", estimate: 13, createdBy: null }),
		],
	};
}

describe("number values", () => {
	it("tidies and compares", () => {
		expect(normalizeNumberValue(" > 3.0 ")).toBe(">3");
		expect(normalizeNumberValue("3 .. 8")).toBe("3..8");
		expect(normalizeNumberValue("-2")).toBe("-2");
		expect(normalizeNumberValue("lots")).toBeNull();
		expect(matchesNumberValue(5, "3..8")).toBe(true);
		expect(matchesNumberValue(8, "3..8")).toBe(true);
		expect(matchesNumberValue(9, "3..8")).toBe(false);
		expect(matchesNumberValue(3, ">=3")).toBe(true);
		expect(matchesNumberValue(3, ">3")).toBe(false);
		expect(matchesNumberValue(3, "3")).toBe(true);
		expect(matchesNumberValue(3, "nope")).toBe(false);
	});

	it("reads lengths of time for estimates", () => {
		expect(normalizeNumberValue(">2H", { durations: true })).toBe(">2h");
		expect(normalizeNumberValue("1h 30m", { durations: true })).toBe("1h30m");
		expect(normalizeNumberValue("30m .. 1d", { durations: true })).toBe("30m..1d");
		expect(normalizeNumberValue("1.50h", { durations: true })).toBe("1.5h");
		expect(normalizeNumberValue("2h")).toBeNull();
		expect(normalizeNumberValue("2x", { durations: true })).toBeNull();
		// Minutes against lengths of time; a bare number is hours when asked.
		expect(matchesNumberValue(150, ">2h")).toBe(true);
		expect(matchesNumberValue(90, "1h30m")).toBe(true);
		expect(matchesNumberValue(480, "1d")).toBe(true);
		expect(matchesNumberValue(240, "30m..1d")).toBe(true);
		expect(matchesNumberValue(120, "2", { bareHours: true })).toBe(true);
		expect(matchesNumberValue(120, ">2", { bareHours: true })).toBe(false);
		expect(matchesNumberValue(90, "1..2", { bareHours: true })).toBe(true);
		expect(matchesNumberValue(2, "2")).toBe(true);
	});
});

describe("time estimates in queries", () => {
	const base = sampleSnapshot();
	const snapshot: WorkspaceSnapshot = {
		...base,
		workspace: { ...base.workspace, estimatesInTime: true },
		tasks: [
			task({ path: "short", id: "T-1", estimate: 30 }),
			task({ path: "hour", id: "T-2", estimate: 60 }),
			task({ path: "half-day", id: "T-3", estimate: 240 }),
			task({ path: "days", id: "T-4", estimate: 960 }),
		],
	};
	const ctx = queryContext(snapshot);
	const paths = (query: string) =>
		applyFilters(snapshot.tasks, parseQuery(query, ctx).definition.filters, snapshotContext(snapshot))
			.map((t) => t.path)
			.sort();

	it("reads a bare number as hours, and units as written", () => {
		expect(paths("estimate:>2")).toEqual(["days", "half-day"]);
		expect(paths("estimate:<=1")).toEqual(["hour", "short"]);
		expect(paths("estimate:1")).toEqual(["hour"]);
		expect(paths("estimate:>=4h")).toEqual(["days", "half-day"]);
		expect(paths("estimate:30m..1h")).toEqual(["hour", "short"]);
		expect(paths("estimate:>1d")).toEqual(["days"]);
		expect(paths("-estimate:<1h")).toEqual(["days", "half-day", "hour"]);
		expect(printQuery(parseQuery(`estimate:">1H 30m"`, ctx).definition, ctx)).toContain("estimate:>1h30m");
	});
});

describe("task fields in queries (T-0951)", () => {
	const snapshot = withFields();
	const ctx = queryContext(snapshot, ME);
	const context = snapshotContext(snapshot, ME);
	const paths = (query: string) => {
		const parsed = parseQuery(query, ctx);
		expect(parsed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
		return applyFilters(snapshot.tasks, parsed.definition.filters, context)
			.map((t) => t.path)
			.sort();
	};
	const round = (query: string) => printQuery(parseQuery(query, ctx).definition, ctx);

	it("estimate: compares, ranges, unset and any", () => {
		expect(paths("estimate:8")).toEqual(["b"]);
		expect(paths("estimate:>3")).toEqual(["b", "d"]);
		expect(paths("estimate:3..8")).toEqual(["a", "b"]);
		expect(paths("estimate:unset")).toEqual(["c"]);
		expect(paths("estimate:any")).toEqual(["a", "b", "d"]);
		expect(paths("-estimate:>3")).toEqual(["a", "c"]);
		expect(paths("estimate:<3,13")).toEqual(["d"]);
		expect(round("estimate:>3.0")).toContain("estimate:>3");
		expect(round("estimate:3..8")).toContain("estimate:3..8");
		expect(parseQuery("estimate:lots", ctx).issues[0].severity).toBe("warning");
	});

	it("comments: counts, with none as unset", () => {
		expect(paths("comments:any")).toEqual(["a", "c"]);
		expect(paths("comments:unset")).toEqual(["b", "d"]);
		expect(paths("comments:>5")).toEqual(["c"]);
		expect(paths("comments:1..2")).toEqual(["a"]);
	});

	it("creator: who made it", () => {
		expect(paths("creator:me")).toEqual(["a"]);
		expect(paths("creator:\"Sam Rivera\"")).toEqual(["b"]);
		expect(paths("creator:unset")).toEqual(["c", "d"]);
		expect(paths("-creator:me")).toEqual(["b", "c", "d"]);
		expect(paths("author:me")).toEqual(["a"]);
		expect(round("created-by:me")).toContain("creator:me");
	});

	it("comment.by: who commented", () => {
		expect(paths("comment.by:me")).toEqual(["c"]);
		expect(paths("comment.by:M-0002")).toEqual(["a", "c"]);
		expect(paths("comment.by:unset")).toEqual(["b", "d"]);
		expect(paths("commenter:me")).toEqual(["c"]);
		expect(round("commenter:me")).toContain("comment.by:me");
	});

	it("description: words in it", () => {
		expect(paths("description:nafis")).toEqual(["a"]);
		expect(paths("description:\"cat scan\"")).toEqual(["a"]);
		expect(paths("description:nothing")).toEqual([]);
		expect(round("desc:\"cat scan\"")).toContain('description:"cat scan"');
		expect(parseQuery("-description:x", ctx).ok).toBe(false);
	});

	it("internal: yes or no", () => {
		expect(paths("internal:yes")).toEqual(["b"]);
		expect(paths("internal:no")).toEqual(["a", "c", "d"]);
		expect(paths("-internal:yes")).toEqual(["a", "c", "d"]);
		expect(round("internal:true")).toContain("internal:yes");
		expect(parseQuery("internal:maybe", ctx).ok).toBe(false);
	});

	it("child: tasks with sub-tasks, or with one in particular", () => {
		expect(paths("child:any")).toEqual(["a"]);
		expect(paths("child:unset")).toEqual(["b", "c", "d"]);
		expect(paths("child:T-3")).toEqual(["a"]);
		expect(paths("-child:any")).toEqual(["b", "c", "d"]);
	});

	it("counts them as filters", () => {
		for (const query of ["estimate:3", "comments:any", "creator:me", "comment.by:me", "description:x", "internal:no", "child:any"]) {
			expect(isEmptyFilterSet(parseQuery(query, ctx).definition.filters)).toBe(false);
		}
	});
});
