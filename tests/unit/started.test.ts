import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, queryContext } from "../../src/core/query";
import { applyFilters, snapshotContext, sortTasks } from "../../src/core/views";
import type { WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

/** When work on a task began (`startedAt`), as queries and sorting see it. */
function withStarts(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	const tasks = [
		task({ path: "t1", id: "T-1", title: "One", startedAt: "2026-10-11T14:14:39.100Z" }),
		task({ path: "t2", id: "T-2", title: "Two", startedAt: "2026-10-09T08:00:00.000Z" }),
		task({ path: "t3", id: "T-3", title: "Three", startedAt: null }),
		task({ path: "t4", id: "T-4", title: "Four", startedAt: "2026-10-11T09:00:00.000Z" }),
	];
	return { ...base, tasks };
}

describe("started: in views", () => {
	const snapshot = withStarts();
	const ctx = queryContext(snapshot);
	const context = snapshotContext(snapshot);
	const paths = (query: string) =>
		applyFilters(snapshot.tasks, parseQuery(query, ctx).definition.filters, context)
			.map((t) => t.path)
			.sort();

	it("matches the day work began, by range, never started, and excluded", () => {
		expect(paths("started:2026-10-11")).toEqual(["t1", "t4"]);
		expect(paths("started-before:2026-10-11")).toEqual(["t2"]);
		expect(paths("started-after:2026-10-09")).toEqual(["t1", "t4"]);
		expect(paths("started:unset")).toEqual(["t3"]);
		expect(paths("started:any")).toEqual(["t1", "t2", "t4"]);
		expect(paths("-started:2026-10-11")).toEqual(["t2", "t3"]);
	});

	it("sorts by it, never-started last either way", () => {
		const sorted = (direction: "asc" | "desc") => sortTasks(snapshot.tasks, "startedAt", direction, context).map((t) => t.path);
		expect(sorted("asc")).toEqual(["t2", "t4", "t1", "t3"]);
		expect(sorted("desc")).toEqual(["t1", "t4", "t2", "t3"]);
		expect(parseQuery("sort:started", ctx).definition.sortBy).toBe("startedAt");
	});
});
