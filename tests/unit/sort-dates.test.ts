import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { parseLegacyViewDefinition } from "../../src/core/serialization/views";
import { snapshotContext, sortTasks } from "../../src/core/views";
import type { SortField, WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

/** Sorting by when a task was finished (`sort:completed`, T-0725), and the
 *  other date sorts read the same ways. */
function withCompletions(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	const tasks = [
		task({ path: "t1", id: "T-1", title: "One", completedAt: "2026-10-11T14:14:39.100Z" }),
		task({ path: "t2", id: "T-2", title: "Two", completedAt: "2026-10-09T08:00:00.000Z" }),
		task({ path: "t3", id: "T-3", title: "Three", completedAt: null }),
		task({ path: "t4", id: "T-4", title: "Four", completedAt: "2026-10-11T09:00:00.000Z" }),
	];
	return { ...base, tasks };
}

describe("sort:completed", () => {
	const snapshot = withCompletions();
	const ctx = queryContext(snapshot);
	const context = snapshotContext(snapshot);

	it("parses in every spelling, both ways", () => {
		for (const spelling of ["completed", "completedAt", "completed-at", "done", "task.completed"]) {
			const asc = parseQuery(`sort:${spelling}`, ctx);
			expect(asc.ok).toBe(true);
			expect(asc.definition.sortBy).toBe("completedAt");
			expect(asc.definition.sortDirection).toBe("asc");
			const desc = parseQuery(`sort:-${spelling}`, ctx);
			expect(desc.definition.sortBy).toBe("completedAt");
			expect(desc.definition.sortDirection).toBe("desc");
		}
		expect(parseQuery("table-sort:-completed", ctx).definition.tableSort).toEqual([{ field: "completedAt", direction: "desc" }]);
	});

	it("prints as sort:completed and reads back the same", () => {
		const parsed = parseQuery("sort:-completed", ctx);
		const printed = printQuery(parsed.definition, ctx);
		expect(printed).toContain("sort:-completed");
		expect(parseQuery(printed, ctx).definition.sortBy).toBe("completedAt");
	});

	it("sorts by it, never-finished last either way", () => {
		const sorted = (direction: "asc" | "desc") => sortTasks(snapshot.tasks, "completedAt", direction, context).map((t) => t.path);
		expect(sorted("asc")).toEqual(["t2", "t4", "t1", "t3"]);
		expect(sorted("desc")).toEqual(["t1", "t4", "t2", "t3"]);
	});

	it("is kept by a legacy view record, as milestone is", () => {
		for (const sortBy of ["completedAt", "milestone"]) {
			expect(parseLegacyViewDefinition({ viewType: "list", sortBy, sortDirection: "desc" }).sortBy).toBe(sortBy);
		}
	});
});

describe("the other date sorts", () => {
	const ctx = queryContext(sampleSnapshot());
	const cases: [SortField, string[]][] = [
		["createdAt", ["created", "createdat", "created-at"]],
		["updatedAt", ["updated", "updatedat", "updated-at"]],
		["dueDate", ["due", "duedate", "due-date"]],
		["startDate", ["start", "startdate", "start-date"]],
		["startedAt", ["started", "startedat", "started-at"]],
	];
	it.each(cases)("%s reads in every spelling, both ways", (field, spellings) => {
		for (const spelling of spellings) {
			for (const sign of ["", "-"]) {
				const parsed = parseQuery(`sort:${sign}${spelling}`, ctx);
				expect(parsed.ok).toBe(true);
				expect(parsed.definition.sortBy).toBe(field);
				expect(parsed.definition.sortDirection).toBe(sign ? "desc" : "asc");
			}
		}
	});
});
