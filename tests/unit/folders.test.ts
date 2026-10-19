import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { inFolder, normalizeFolderPath } from "../../src/core/folders";
import { indexKindItems, matchesKindQuery, parseKindQuery, parseQuery, printQuery, queryContext, type KindItem } from "../../src/core/query";
import { applyFilters, snapshotContext } from "../../src/core/views";
import { DEFAULT_DEFINITION } from "../../src/core/views/defaults";
import { NONE, type Milestone, type WorkspaceSnapshot } from "../../src/core/types";
import { project, task } from "./fixtures";

/** Tasks by the hub folder their project, milestone or labels are in (T-0926). */

describe("folder paths", () => {
	it("tidies a path's levels and the spaces around them", () => {
		expect(normalizeFolderPath("Plan Things Better/Web")).toBe("Plan Things Better / Web");
		expect(normalizeFolderPath("  Plan  Things Better /  Web / ")).toBe("Plan Things Better / Web");
	});

	it("is in a folder, or anywhere below it", () => {
		const folder = "Plan Things Better / Web / Clients";
		expect(inFolder(folder, "Plan Things Better")).toBe(true);
		expect(inFolder(folder, "plan things better/web")).toBe(true);
		expect(inFolder(folder, "Plan Things Better / Web / Clients")).toBe(true);
		expect(inFolder(folder, "Plan Things Better / Obsidian")).toBe(false);
		expect(inFolder(folder, "Plan Things Better / Web / Clients / Old")).toBe(false);
		expect(inFolder(null, "Plan Things Better")).toBe(false);
	});

	it("takes a folder's name, or a run of its path, at any depth", () => {
		expect(inFolder("Plan Things Better / Web", "Web")).toBe(true);
		expect(inFolder("Abundant Life Inc. / Web", "Web")).toBe(true);
		expect(inFolder("Plan Things Better / Web / Clients", "Web / Clients")).toBe(true);
		// A level's whole name, never part of it.
		expect(inFolder("Plan Things Better / Website", "Web")).toBe(false);
	});
});

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

function withFolders(): WorkspaceSnapshot {
	const base = sampleSnapshot();
	return {
		...base,
		workspace: {
			...base.workspace,
			labels: [
				{ id: "l-bug", name: "Bug", color: "#ff0000", path: "Plan Things Better / Web" },
				{ id: "l-copy", name: "Copy", color: "#00ff00" },
			],
		},
		milestones: [
			milestone({ path: "m-web", id: "R-0001", title: "Web 1.0", folder: "Releases / Web" }),
			milestone({ path: "m-loose", id: "R-0002", title: "Someday" }),
		],
		projects: [
			project({ path: "p-core", id: "P-0001", title: "Core", folder: "Plan Things Better" }),
			project({ path: "p-help", id: "P-0002", title: "Help", folder: "Plan Things Better / Web" }),
			project({ path: "p-vf", id: "P-0003", title: "Vertex Flow", folder: "Plan Things Better / Obsidian" }),
			project({ path: "p-alc", id: "P-0004", title: "Clips", folder: "Abundant Life Inc. / Web" }),
			project({ path: "p-loose", id: "P-0005", title: "Loose" }),
		],
		tasks: [
			task({ path: "t1", id: "T-1", title: "One", project: "p-core", labels: ["l-bug"], milestone: "m-web" }),
			task({ path: "t2", id: "T-2", title: "Two", project: "p-help", labels: ["l-copy"] }),
			task({ path: "t3", id: "T-3", title: "Three", project: "p-vf", labels: [] }),
			task({ path: "t4", id: "T-4", title: "Four", project: "p-alc", labels: ["l-copy", "l-bug"], milestone: "m-loose" }),
			task({ path: "t5", id: "T-5", title: "Five", project: "p-loose", labels: [] }),
			task({ path: "t6", id: "T-6", title: "Six", project: null, labels: [] }),
		],
	};
}

describe("a task's project, milestone and label folders in views", () => {
	const snapshot = withFolders();
	const ctx = queryContext(snapshot);
	const context = snapshotContext(snapshot);
	const parsed = (query: string) => {
		const result = parseQuery(query, ctx);
		expect(result.issues).toEqual([]);
		return result;
	};
	const paths = (query: string) =>
		applyFilters(snapshot.tasks, parsed(query).definition.filters, context)
			.map((t) => t.path)
			.sort();

	it("takes in every folder below the one named", () => {
		expect(paths('project.folder:"Plan Things Better"')).toEqual(["t1", "t2", "t3"]);
		expect(paths('project.folder:"Plan Things Better/Web"')).toEqual(["t2"]);
	});

	it("cuts a branch out with -", () => {
		expect(paths('project.folder:"Plan Things Better" -project.folder:"Plan Things Better / Obsidian"')).toEqual(["t1", "t2"]);
	});

	it("takes a folder's name alone at any depth, and several with commas", () => {
		expect(paths("project.folder:Web")).toEqual(["t2", "t4"]);
		expect(paths('project.folder:Obsidian,"Abundant Life Inc."')).toEqual(["t3", "t4"]);
	});

	it("unset is no folder, or no project; any is in one", () => {
		expect(paths("project.folder:unset")).toEqual(["t5", "t6"]);
		expect(paths("project.folder:any")).toEqual(["t1", "t2", "t3", "t4"]);
	});

	it("matches a milestone's folder and any of a task's labels' folders", () => {
		expect(paths("milestone.folder:Releases")).toEqual(["t1"]);
		expect(paths("milestone.folder:unset")).toEqual(["t2", "t3", "t4", "t5", "t6"]);
		expect(paths('label.folder:"Plan Things Better"')).toEqual(["t1", "t4"]);
		expect(paths("-label.folder:Web")).toEqual(["t2", "t3", "t5", "t6"]);
		expect(paths("label.folder:unset")).toEqual(["t2", "t3", "t5", "t6"]);
	});

	it("prints a path with spaced slashes, reads it back, and reads the other spellings", () => {
		const source = printQuery(parsed('project.folder:"Plan Things Better/Web" -label.folder:Web milestone.folder:any').definition, ctx);
		expect(source).toContain('project.folder:"Plan Things Better / Web"');
		expect(source).toContain("-label.folder:Web");
		expect(source).toContain("milestone.folder:any");
		expect(parsed(source).definition.filters).toEqual(parsed('project.folder:"Plan Things Better/Web" -label.folder:Web milestone.folder:any').definition.filters);
		expect(parsed("projectFolder:Web").definition.filters.projectFolder).toEqual(["Web"]);
		expect(parsed("project-folder:Web").definition.filters.projectFolder).toEqual(["Web"]);
		const definition = { ...DEFAULT_DEFINITION, filters: { projectFolder: [NONE] } };
		expect(printQuery(definition, ctx)).toContain("project.folder:unset");
	});
});

describe("folder: in a query across kinds", () => {
	const items: KindItem[] = [
		{ kind: "project", key: "P-0001", name: "Core", fields: { folder: "Plan Things Better" } },
		{ kind: "project", key: "P-0002", name: "Help", fields: { folder: "Plan Things Better / Web" } },
		{ kind: "project", key: "P-0003", name: "Clips", fields: { folder: "Abundant Life Inc. / Web" } },
		{ kind: "project", key: "P-0004", name: "Loose", fields: {} },
		{ kind: "task", key: "T-0001", name: "Write help", links: { project: ["P-0002"] } },
	];
	const context = { index: indexKindItems(items) };
	const keys = (source: string) => items.filter((item) => matchesKindQuery(item, parseKindQuery(source).query, context)).map((item) => item.key);

	it("follows the same path rules", () => {
		expect(keys('kind:project folder:"Plan Things Better"')).toEqual(["P-0001", "P-0002"]);
		expect(keys("kind:project folder:Web")).toEqual(["P-0002", "P-0003"]);
		expect(keys('kind:project -folder:"Plan Things Better"')).toEqual(["P-0003", "P-0004"]);
		expect(keys("kind:project folder:unset")).toEqual(["P-0004"]);
		expect(keys('project.folder:"Plan Things Better/Web"')).toEqual(["P-0002", "T-0001"]);
	});
});
