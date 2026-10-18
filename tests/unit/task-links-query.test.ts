import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { applyFilters, evaluateView, snapshotContext, viewContext } from "../../src/core/views";
import { countTasks, taskRows } from "../../src/core/mcp";
import { emptyRelations, OPEN_LINK, type Task, type WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

/**
 * Task links as plain fields (T-0723): `related:`, `blocks:` and
 * `blocked-by:` take a task key, `any` or `unset`, with the pre-T-0728
 * spellings still read. And `blocked-by:open` (T-0724): a blocker that's
 * still open.
 *
 *   t1 blocked by t2 (in progress)       -> waiting
 *   t3 blocked by t4 (done) and t5 (canceled) -> nothing to wait on
 *   t6 blocked by t4 (done) and t7 (to do)    -> waiting
 *   t8 blocked by t9 (to do, archived)   -> nothing to wait on
 *   t10 related to t1, no blockers
 */
function linked(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	const make = (n: number, status: string, links: Partial<Task["relations"]> = {}, extra: Partial<Task> = {}) =>
		task({ path: `t${n}`, id: `T-${n}`, title: `Task ${n}`, status, relations: { ...emptyRelations(), ...links }, ...extra });
	const tasks = [
		make(1, "todo", { blockedBy: ["t2"], related: ["t10"] }),
		make(2, "in-progress", { blocks: ["t1"] }),
		make(3, "todo", { blockedBy: ["t4", "t5"] }),
		make(4, "done", { blocks: ["t3", "t6"] }),
		make(5, "canceled", { blocks: ["t3"] }),
		make(6, "in-progress", { blockedBy: ["t4", "t7"] }),
		make(7, "todo", { blocks: ["t6"] }),
		make(8, "todo", { blockedBy: ["t9"] }),
		make(9, "todo", { blocks: ["t8"] }, { archived: true }),
		make(10, "todo", { related: ["t1"] }),
	];
	return { ...base, tasks };
}

describe("task links as plain fields", () => {
	const snapshot = linked();
	const ctx = queryContext(snapshot);
	const context = snapshotContext(snapshot);
	const paths = (query: string) => {
		const parsed = parseQuery(query, ctx);
		expect(parsed.ok, query).toBe(true);
		return applyFilters(snapshot.tasks, parsed.definition.filters, context)
			.map((t) => t.path)
			.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
	};

	it("related:, blocks: and blocked-by: take a key, any and unset", () => {
		expect(paths("related:T-10")).toEqual(["t1"]);
		expect(paths("related:any")).toEqual(["t1", "t10"]);
		expect(paths("blocks:T-1")).toEqual(["t2"]);
		expect(paths("blocked-by:T-4")).toEqual(["t3", "t6"]);
		expect(paths("blocked-by:any")).toEqual(["t1", "t3", "t6", "t8"]);
		expect(paths("blocked-by:unset")).toEqual(["t2", "t4", "t5", "t7", "t10"]);
	});

	it("still reads the spellings saved views have", () => {
		for (const [old, now] of [
			["relatedTaskKey:any", "related:any"],
			["blocksTaskKey:T-1", "blocks:T-1"],
			["blockedByTaskKey:unset", "blocked-by:unset"],
		]) {
			expect(paths(old)).toEqual(paths(now));
			expect(printQuery(parseQuery(old, ctx).definition, ctx)).toContain(now);
		}
	});

	it("blocked-by:open matches tasks with a blocker that's neither completed nor canceled", () => {
		expect(paths("blocked-by:open")).toEqual(["t1", "t6"]);
		// Every blocker done, canceled or archived: nothing to wait on.
		expect(paths("blocked-by:open")).not.toContain("t3");
		expect(paths("blocked-by:open")).not.toContain("t8");
		// Excluded: nothing left to wait on, blocked or not.
		expect(paths("-blocked-by:open")).toEqual(["t2", "t3", "t4", "t5", "t7", "t8", "t10"]);
		// OR'd with a key, like any field's values.
		expect(paths("blocked-by:open,T-4")).toEqual(["t1", "t3", "t6"]);
	});

	it("stores OPEN_LINK and prints it back as open; =open is a value written open", () => {
		const parsed = parseQuery("blocked-by:open", ctx);
		expect(parsed.definition.filters.blockedBy).toEqual([OPEN_LINK]);
		expect(printQuery(parsed.definition, ctx)).toContain("blocked-by:open");
		expect(printQuery(parseQuery("-blocked-by:open", ctx).definition, ctx)).toContain("-blocked-by:open");
		expect(parseQuery("blocked-by:=open", ctx).definition.filters.blockedBy).toEqual(["open"]);
		// Only blocked-by: takes it: a task link elsewhere is a key.
		expect(parseQuery("blocks:open", ctx).definition.filters.blocks).not.toEqual([OPEN_LINK]);
	});

	it("matches the same in views, list_tasks and count_tasks", () => {
		const filters = parseQuery("blocked-by:open", ctx).definition;
		expect(evaluateView(snapshot, { ...filters, id: "v", name: "Stuck" } as never).tasks.map((t) => t.path).sort()).toEqual(["t1", "t6"]);
		expect(taskRows(snapshot, filters.filters).map((row) => row.id).sort()).toEqual(["T-1", "T-6"]);
		expect(countTasks(snapshot, filters.filters).total).toBe(2);
	});

	it("matches nothing without the tasks to look blockers up in", () => {
		const bare = viewContext(snapshot.workspace);
		expect(applyFilters(snapshot.tasks, parseQuery("blocked-by:open", ctx).definition.filters, bare)).toEqual([]);
	});
});
