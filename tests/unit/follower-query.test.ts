import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { applyFilters, isEmptyFilterSet, snapshotContext } from "../../src/core/views";
import type { WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

const ME = "jr";
const SAM = "sam";

/** `follower:` -- who follows a task to hear when it changes (T-1078). */
describe("follower: in queries (T-1078)", () => {
	const base = sampleSnapshot();
	const snapshot: WorkspaceSnapshot = {
		...base,
		workspace: {
			...base.workspace,
			people: [
				{ id: ME, name: "JR Leonard", email: "M-0001", aliases: [] },
				{ id: SAM, name: "Sam Rivera", email: "M-0002", aliases: [] },
			],
		},
		tasks: [
			task({ path: "a", id: "T-1", title: "Plan", followers: [ME] }),
			task({ path: "b", id: "T-2", title: "Build", followers: [ME, SAM] }),
			task({ path: "c", id: "T-3", title: "Ship", followers: [SAM] }),
			task({ path: "d", id: "T-4", title: "Rest" }),
			task({ path: "e", id: "T-5", title: "Wait", followers: [] }),
		],
	};
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

	it("matches me, a member by key or name, unset and any", () => {
		expect(paths("follower:me")).toEqual(["a", "b"]);
		expect(paths("follower:M-0002")).toEqual(["b", "c"]);
		expect(paths('follower:"Sam Rivera"')).toEqual(["b", "c"]);
		expect(paths("follower:me,M-0002")).toEqual(["a", "b", "c"]);
		expect(paths("follower:unset")).toEqual(["d", "e"]);
		expect(paths("follower:any")).toEqual(["a", "b", "c"]);
	});

	it("excludes", () => {
		expect(paths("-follower:me")).toEqual(["c", "d", "e"]);
		expect(paths("-follower:any")).toEqual(["d", "e"]);
		expect(paths("-follower:unset")).toEqual(["a", "b", "c"]);
	});

	it("prints as follower:, and reads its other spellings", () => {
		expect(round("follower:me")).toContain("follower:me");
		expect(round("followed-by:me")).toContain("follower:me");
		expect(round("followers:M-0002")).toContain("follower:M-0002");
		expect(round("-follower:me")).toContain("-follower:me");
		expect(round("follower:any")).toContain("follower:any");
		expect(round("follower:unset")).toContain("follower:unset");
	});

	it("counts as a filter", () => {
		for (const query of ["follower:me", "-follower:me", "follower:unset", "follower:any"]) {
			expect(isEmptyFilterSet(parseQuery(query, ctx).definition.filters)).toBe(false);
		}
	});
});
