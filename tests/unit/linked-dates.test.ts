import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { applyFilters, snapshotContext } from "../../src/core/views";
import { DEFAULT_DEFINITION } from "../../src/core/views/defaults";
import { NONE, type Milestone, type WorkspaceSnapshot } from "../../src/core/types";
import { project, task } from "./fixtures";

/** Tasks by their milestone's and project's dates (T-0639). */
const milestone = (partial: Partial<Milestone>): Milestone => ({
	title: "v1",
	id: "R-0001",
	state: "planned",
	targetDate: null,
	startDate: null,
	completedAt: null,
	createdAt: "2026-09-01T10:00:00.000Z",
	updatedAt: "2026-09-01T10:00:00.000Z",
	path: "m1",
	...partial,
});

function withLinks(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	return {
		...base,
		milestones: [
			milestone({ path: "m-oct", id: "R-0001", title: "October", startDate: "2026-10-01", targetDate: "2026-10-20" }),
			milestone({ path: "m-nov", id: "R-0002", title: "November", targetDate: "2026-11-15", completedAt: "2026-11-14T18:00:00.000Z" }),
		],
		projects: [
			project({ path: "p-web", id: "P-0001", title: "Website", startDate: "2026-09-15", dueDate: "2026-10-31" }),
			project({ path: "p-app", id: "P-0002", title: "App", startDate: null, dueDate: null }),
		],
		tasks: [
			task({ path: "t1", id: "T-1", title: "One", milestone: "m-oct", project: "p-web" }),
			task({ path: "t2", id: "T-2", title: "Two", milestone: "m-nov", project: "p-app" }),
			task({ path: "t3", id: "T-3", title: "Three", milestone: null, project: null }),
		],
	};
}

describe("a task's milestone and project dates in views", () => {
	const snapshot = withLinks();
	const ctx = queryContext(snapshot);
	const context = snapshotContext(snapshot);
	const paths = (query: string) =>
		applyFilters(snapshot.tasks, parseQuery(query, ctx).definition.filters, context)
			.map((t) => t.path)
			.sort();

	it("matches a milestone's start, target and completed day, and its bounds", () => {
		expect(paths("milestoneTarget:2026-10-20")).toEqual(["t1"]);
		expect(paths("milestoneTargetBefore:2026-11-01")).toEqual(["t1"]);
		expect(paths("milestoneTargetAfter:2026-10-20")).toEqual(["t2"]);
		expect(paths("milestoneStart:2026-10-01")).toEqual(["t1"]);
		expect(paths("milestoneCompleted:2026-11-14")).toEqual(["t2"]);
		expect(paths("milestoneCreated:2026-09-01")).toEqual(["t1", "t2"]);
		expect(paths("milestoneUpdatedBefore:2026-09-02")).toEqual(["t1", "t2"]);
	});

	it("matches a project's start and due day, and its bounds", () => {
		expect(paths("projectDue:2026-10-31")).toEqual(["t1"]);
		expect(paths("projectDueBefore:2026-11-01")).toEqual(["t1"]);
		expect(paths("projectStartAfter:2026-09-01")).toEqual(["t1"]);
	});

	it("unset is no milestone (project) or no such date on it; any is the rest; - excludes", () => {
		expect(paths("milestoneStart:unset")).toEqual(["t2", "t3"]);
		expect(paths("milestoneStart:any")).toEqual(["t1"]);
		expect(paths("projectDue:unset")).toEqual(["t2", "t3"]);
		expect(paths("-milestoneTarget:2026-10-20")).toEqual(["t2", "t3"]);
		// A task with no milestone has no milestone dates to fall in a range.
		expect(paths("milestoneTargetAfter:2000-01-01")).toEqual(["t1", "t2"]);
	});

	it("prints {kind}.{field} names and reads the older ones", () => {
		const definition = { ...DEFAULT_DEFINITION, filters: { milestoneTarget: ["2026-10-20"], projectDueBefore: "2026-11-01", milestoneStart: [NONE] } };
		const source = printQuery(definition, ctx);
		expect(source).toContain("milestone.target:2026-10-20");
		expect(source).toContain("project.due-before:2026-11-01");
		expect(source).toContain("milestone.start:unset");
		expect(parseQuery(source, ctx).definition.filters).toMatchObject({ milestoneTarget: ["2026-10-20"], projectDueBefore: "2026-11-01", milestoneStart: [NONE] });
		expect(parseQuery("milestone-target-before:2026-11-01 project-due:2026-10-31", ctx).definition.filters).toMatchObject({
			milestoneTargetBefore: "2026-11-01",
			projectDue: ["2026-10-31"],
		});
	});
});
