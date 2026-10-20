import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { parseQuery, printQuery, queryContext } from "../../src/core/query";
import { groupTasks, snapshotContext } from "../../src/core/views";
import { DEFAULT_DEFINITION } from "../../src/core/views/defaults";
import { groupKeys, matchesScope } from "../../src/core/dashboards/aggregate";
import { groupingFieldLabel } from "../../src/core/dashboards/title";
import { groupingFieldsFor } from "../../src/core/dashboards/compat";
import { NONE, type WorkspaceSnapshot } from "../../src/core/types";
import { task } from "./fixtures";

// Grouping by the Space a task is kept in (T-0984): a family's workspace
// with a Space per kid, or a studio's with one per client.
function withSpaces(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	return {
		...base,
		spaces: [
			{ path: "s-trey", id: "S-0001", title: "Trey's schoolwork" },
			{ path: "s-aj", id: "S-0003", title: "AJ's schoolwork" },
		],
		tasks: [
			task({ path: "t1", id: "T-1", title: "Algebra 2.02", space: "s-trey" }),
			task({ path: "t2", id: "T-2", title: "Math 8.05", space: "s-aj" }),
			task({ path: "t3", id: "T-3", title: "Pick up books", space: null }),
			task({ path: "t4", id: "T-4", title: "Biology 3.03", space: "s-trey" }),
		],
	};
}

describe("grouping by Space", () => {
	const snapshot = withSpaces();
	const context = snapshotContext(snapshot);

	it("groups by each Space's name, alphabetically, workspace-wide tasks last", () => {
		const groups = groupTasks(snapshot.tasks, "space", context);
		expect(groups.map((g) => g.label)).toEqual(["AJ's schoolwork", "Trey's schoolwork", "No Space"]);
		expect(groups.map((g) => g.tasks.map((t) => t.path))).toEqual([["t2"], ["t1", "t4"], ["t3"]]);
	});

	it("is `group:space` in a query, and prints back", () => {
		const ctx = queryContext(snapshot);
		const definition = parseQuery("group:space", ctx).definition;
		expect(definition.groupBy).toBe("space");
		expect(printQuery({ ...DEFAULT_DEFINITION, groupBy: "space" }, ctx)).toContain("group:space");
	});

	it("groups and scopes a dashboard's charts", () => {
		expect(groupingFieldsFor()).toContain("space");
		expect(groupingFieldLabel("space")).toBe("Space");
		expect(groupKeys(snapshot.tasks[0], "space")).toEqual(["s-trey"]);
		expect(groupKeys(snapshot.tasks[2], "space")).toEqual([NONE]);
		expect(matchesScope(snapshot.tasks[1], { field: "space", value: "s-aj" })).toBe(true);
		expect(matchesScope(snapshot.tasks[2], { field: "space", value: NONE })).toBe(true);
		expect(matchesScope(snapshot.tasks[0], { field: "space", value: NONE })).toBe(false);
	});
});
