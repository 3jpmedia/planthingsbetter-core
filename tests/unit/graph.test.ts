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

	it("says which tasks are done, started or open, and their stage", () => {
		const states = new Set(graph.tasks.map((t) => t.state));
		expect([...states].every((s) => ["open", "started", "done", "canceled"].includes(s))).toBe(true);
		for (const task of graph.tasks) {
			if (task.state === "done") expect(task.stage).toBe("done");
			if (task.state === "open") expect(["backlog", "todo"]).toContain(task.stage);
		}
	});

	it("counts each hub's tasks and knows a finished milestone", () => {
		const done = buildGraph(snapshot.tasks.map((t, i) => ({ ...t, milestone: i < 3 ? "m1" : null })), { statuses: taxonomies.status, milestones: new Map([["m1", { key: "R-0001", name: "Launch", done: true }]]) });
		expect(done.hubs.find((h) => h.id === "milestone:R-0001")).toMatchObject({ size: 3, done: true });
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
		const many = { tasks: Array.from({ length: 5000 }, (_, i) => ({ ...graph.tasks[0], key: `T-${i}`, project: `project:P-${i % 40}`, parent: null })), hubs: Array.from({ length: 40 }, (_, i) => ({ kind: "project" as const, id: `project:P-${i}`, name: `P${i}`, size: 125 })) };
		// Warmed up first, so it times the layout and not the first compile;
		// about 2s here, with room for a slower CI runner.
		layoutGraph({ tasks: many.tasks.slice(0, 200), hubs: many.hubs });
		const started = performance.now();
		const layout = layoutGraph(many);
		expect(layout.points.size).toBe(5040);
		expect(performance.now() - started).toBeLessThan(5000);
	});

	it("starts from the last layout, so an unchanged graph barely moves", () => {
		const first = layoutGraph(graph);
		const again = layoutGraph(graph, { previous: first });
		for (const task of graph.tasks) {
			const a = first.points.get(task.key)!;
			const b = again.points.get(task.key)!;
			expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(25);
		}
	});

	it("places labels without moving anything else", () => {
		const labelled = buildGraph(snapshot.tasks, { statuses: taxonomies.status, projects, labels: new Map(taxonomies.label.values.map((l) => [l.id, { key: l.id, name: l.name }])) });
		const plain = { ...labelled, hubs: labelled.hubs.filter((h) => h.kind !== "label"), tasks: labelled.tasks.map((t) => ({ ...t, labels: [] })) };
		const a = layoutGraph(labelled);
		const b = layoutGraph(plain);
		for (const task of labelled.tasks) expect(a.points.get(task.key)).toEqual(b.points.get(task.key));
		for (const hub of labelled.hubs.filter((h) => h.kind === "label")) expect(a.points.has(hub.id)).toBe(true);
	});

	it("lets labels pull when asked: tasks that share one gather, and the labels spread out", () => {
		const labelled = buildGraph(snapshot.tasks, { statuses: taxonomies.status, projects, labels: new Map(taxonomies.label.values.map((l) => [l.id, { key: l.id, name: l.name }])) });
		const labels = labelled.hubs.filter((h) => h.kind === "label" && h.size >= 2);
		expect(labels.length).toBeGreaterThan(1);
		// How far a label's tasks sit from the middle of them, on average.
		const spread = (layout: ReturnType<typeof layoutGraph>) => {
			let total = 0;
			for (const label of labels) {
				const points = labelled.tasks.filter((t) => t.labels.includes(label.id)).map((t) => layout.points.get(t.key)!);
				const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
				const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
				total += points.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / points.length;
			}
			return total / labels.length;
		};
		const still = layoutGraph(labelled);
		const pulling = layoutGraph(labelled, { labels: true });
		expect(spread(pulling)).toBeLessThan(spread(still));
		// No two labels on top of each other.
		const at = labels.map((l) => pulling.points.get(l.id)!);
		for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) expect(Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y)).toBeGreaterThan(8);
		// Turned on from a laid-out graph, it regroups from there, and back.
		const on = layoutGraph(labelled, { previous: still, labels: true, regroup: true });
		expect(spread(on)).toBeLessThan(spread(still));
		const off = layoutGraph(labelled, { previous: on, regroup: true });
		expect(spread(off)).toBeGreaterThan(spread(on));
	});

	it("spreads to fill a wide box", () => {
		const round = layoutGraph(graph).bounds;
		const wide = layoutGraph(graph, { aspect: 4 }).bounds;
		const ratio = (b: typeof round) => (b.maxX - b.minX) / Math.max(1, b.maxY - b.minY);
		expect(ratio(wide)).toBeGreaterThan(ratio(round) * 1.5);
	});

	it("sizes hubs by their tasks", () => {
		const layout = layoutGraph(graph);
		const [big, small] = graph.hubs.filter((h) => h.kind === "project").sort((x, y) => y.size - x.size);
		if (big && small && big.size > small.size) expect(layout.points.get(big.id)!.r).toBeGreaterThan(layout.points.get(small.id)!.r);
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

	it("keeps hub names only when asked, and marks a finished milestone", () => {
		const tasks = snapshot.tasks.map((t, i) => ({ ...t, milestone: i < 3 ? "m1" : null }));
		const withMilestone = buildGraph(tasks, { statuses: taxonomies.status, projects, milestones: new Map([["m1", { key: "R-0001", name: "Launch", done: true }]]) });
		const plain = graphSnapshot(withMilestone);
		expect(JSON.stringify(plain)).not.toContain("Launch");
		expect(plain.nodes.find((n) => n.k === "m")).toMatchObject({ s: "done" });
		const named = graphSnapshot(withMilestone, undefined, { names: true });
		expect(named.nodes.find((n) => n.k === "m")?.n).toBe("Launch");
		for (const task of withMilestone.tasks) expect(JSON.stringify(named)).not.toContain(task.name);
	});

	it("refuses what isn't one", () => {
		expect(isGraphSnapshot({ version: 2 })).toBe(false);
		expect(isGraphSnapshot(null)).toBe(false);
	});
});
