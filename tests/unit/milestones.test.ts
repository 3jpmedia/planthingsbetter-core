import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { applyFilters, groupTasks, renderedHiddenFields, seedFromFilters, snapshotContext, sortTasks } from "../../src/core/views";
import { DEFAULT_DEFINITION } from "../../src/core/views/defaults";
import { newTaskMilestone } from "../../src/core/hierarchy";
import { formatKey, parseKey, parseTemplateKey } from "../../src/core/ids";
import { NONE, type Milestone, type WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

const milestone = (partial: Partial<Milestone>): Milestone => ({
	title: "v1",
	id: "R-0001",
	state: "planned",
	targetDate: null,
	startDate: null,
	completedAt: null,
	createdAt: "2026-01-01",
	updatedAt: "2026-01-01",
	path: "m1",
	...partial,
});

function withMilestones(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	const milestones = [
		milestone({ path: "m-late", id: "R-0002", title: "Beta", targetDate: "2026-12-05" }),
		milestone({ path: "m-soon", id: "R-0001", title: "v1.0.30", targetDate: "2026-10-17" }),
		milestone({ path: "m-undated", id: "R-0003", title: "Someday" }),
	];
	const tasks = [
		task({ path: "t1", id: "T-1", title: "One", milestone: "m-late" }),
		task({ path: "t2", id: "T-2", title: "Two", milestone: "m-soon" }),
		task({ path: "t3", id: "T-3", title: "Three", milestone: null }),
		task({ path: "t4", id: "T-4", title: "Four", milestone: "m-undated" }),
	];
	return { ...base, tasks, milestones };
}

describe("milestone keys", () => {
	it("use R, and never parse as a template", () => {
		expect(formatKey("milestone", 30)).toBe("R-0030");
		expect(parseKey("r-30", "milestone")).toBe(30);
		expect(parseKey("R-0030", "member")).toBeNull();
		expect(parseTemplateKey("TR-0001")).toBeNull();
	});
});

describe("milestone in the query language", () => {
	const snapshot = withMilestones();
	const ctx = queryContext(snapshot);

	it("prints the key and reads it back", () => {
		const definition = { ...DEFAULT_DEFINITION, filters: { milestone: ["m-soon"] } };
		const source = printQuery(definition, ctx);
		expect(source).toContain("milestone:R-0001");
		const parsed = parseQuery(source, ctx);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition.filters.milestone).toEqual(["m-soon"]);
	});

	it("takes a milestone's name too, unset, exclusion, group and sort", () => {
		expect(parseQuery('milestone:"v1.0.30"', ctx).definition.filters.milestone).toEqual(["m-soon"]);
		expect(parseQuery("milestone:unset", ctx).definition.filters.milestone).toEqual([NONE]);
		expect(parseQuery("-milestone:Beta", ctx).definition.filters.excludeMilestone).toEqual(["m-late"]);
		expect(parseQuery("group:milestone sort:milestone", ctx).definition).toMatchObject({ groupBy: "milestone", sortBy: "milestone" });
	});
});

describe("milestone in views", () => {
	const snapshot = withMilestones();
	const context = snapshotContext(snapshot);

	it("filters and excludes", () => {
		const paths = (filters: object) => applyFilters(snapshot.tasks, filters, context).map((t) => t.path).sort();
		expect(paths({ milestone: ["m-soon"] })).toEqual(["t2"]);
		expect(paths({ milestone: [NONE] })).toEqual(["t3"]);
		expect(paths({ excludeMilestone: ["m-soon"] })).toEqual(["t1", "t3", "t4"]);
	});

	it("groups in the order milestones come due, undated and none last", () => {
		const groups = groupTasks(snapshot.tasks, "milestone", context);
		expect(groups.map((g) => g.label)).toEqual(["v1.0.30", "Beta", "Someday", "No Milestone"]);
	});

	it("sorts by target date", () => {
		const sorted = sortTasks(snapshot.tasks, "milestone", "asc", context).map((t) => t.path);
		expect(sorted).toEqual(["t2", "t1", "t4", "t3"]);
	});

	it("seeds a new task and hides the chip on a one-milestone view", () => {
		expect(seedFromFilters({ milestone: ["m-soon"], project: ["p"] })).toMatchObject({ milestone: "m-soon", project: "p" });
		expect(renderedHiddenFields({ filters: { milestone: ["m-soon"] }, hiddenFields: [] })).toEqual(["milestone"]);
	});
});

describe("a new sub-task's milestone", () => {
	it("is its parent's, whatever was asked for", () => {
		const parent = task({ path: "p", milestone: "m1" });
		expect(newTaskMilestone("m2", parent)).toBe("m1");
		expect(newTaskMilestone("m2", task({ path: "p2", milestone: null }))).toBeNull();
		expect(newTaskMilestone("m2", null)).toBe("m2");
		expect(newTaskMilestone(undefined, null)).toBeNull();
	});
});
