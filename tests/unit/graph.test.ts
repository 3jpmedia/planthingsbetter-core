import { describe, expect, it } from "vitest";
import { buildGraph, graphEdges, graphSnapshot, isGraphSnapshot, layoutGraph, visibleHubs } from "../../src/core/graph";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { workspaceTaxonomies } from "../../src/core/taxonomy";

// The workspace as a graph (T-0729).

const snapshot = sampleSnapshot();
const taxonomies = workspaceTaxonomies(snapshot.workspace);
const projects = new Map(snapshot.projects.map((p) => [p.path, { key: p.id ?? p.path, name: p.title }]));
const graph = buildGraph(snapshot.tasks, { statuses: taxonomies.status, projects, taskKeys: new Map(snapshot.tasks.map((t) => [t.path, t.id])) });

describe("buildGraph", () => {
	it("makes a dot per unarchived task, joined to its project's hub", () => {
		expect(graph.tasks.length).toBe(snapshot.tasks.filter((t) => !t.archived).length);
		const withProject = graph.tasks.find((t) => t.project);
		expect(withProject).toBeDefined();
		expect(graph.hubs.some((h) => h.id === withProject!.project && h.kind === "project")).toBe(true);
	});

	it("says which tasks are done, started or open", () => {
		const states = new Set(graph.tasks.map((t) => t.state));
		expect([...states].every((s) => ["open", "started", "done", "canceled"].includes(s))).toBe(true);
	});
});

describe("layoutGraph", () => {
	it("places every task and project hub, the same way every time", () => {
		const a = layoutGraph(graph);
		const b = layoutGraph(graph);
		for (const task of graph.tasks) expect(a.points.get(task.key)).toEqual(b.points.get(task.key));
		for (const hub of graph.hubs.filter((h) => h.kind === "project")) expect(a.points.has(hub.id)).toBe(true);
	});

	it("keeps a project's tasks around its hub", () => {
		const layout = layoutGraph(graph);
		const task = graph.tasks.find((t) => t.project)!;
		const hub = layout.points.get(task.project!)!;
		const dot = layout.points.get(task.key)!;
		expect(Math.hypot(dot.x - hub.x, dot.y - hub.y)).toBeLessThan(200);
	});

	it("places thousands of tasks quickly", () => {
		const many = { tasks: Array.from({ length: 5000 }, (_, i) => ({ ...graph.tasks[0], key: `T-${i}`, project: `project:P-${i % 40}`, parent: null })), hubs: Array.from({ length: 40 }, (_, i) => ({ kind: "project" as const, id: `project:P-${i}`, name: `P${i}` })) };
		const started = performance.now();
		const layout = layoutGraph(many);
		expect(layout.points.size).toBe(5040);
		expect(performance.now() - started).toBeLessThan(500);
	});
});

describe("edges and hubs", () => {
	it("draws labels, related and blocking links only when asked", () => {
		expect(graphEdges(graph).some((e) => e.kind === "label" || e.kind === "related" || e.kind === "blocks")).toBe(false);
		expect(visibleHubs(graph).some((h) => h.kind === "label")).toBe(false);
	});
});

describe("graphSnapshot", () => {
	it("holds shapes, states, days and counts, never a name or a key", () => {
		const shot = graphSnapshot(graph);
		expect(isGraphSnapshot(shot)).toBe(true);
		expect(shot.counts.tasks).toBe(graph.tasks.length);
		const text = JSON.stringify(shot);
		for (const task of graph.tasks) {
			expect(text).not.toContain(task.name);
			expect(text).not.toContain(`"${task.key}"`);
		}
		for (const hub of graph.hubs) expect(text).not.toContain(hub.name);
	});

	it("refuses what isn't one", () => {
		expect(isGraphSnapshot({ version: 2 })).toBe(false);
		expect(isGraphSnapshot(null)).toBe(false);
	});
});
