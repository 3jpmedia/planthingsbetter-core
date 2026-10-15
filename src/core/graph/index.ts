/**
 * The workspace as a graph (T-0729): every task a dot, joined to its project
 * and its milestone, with label hubs and related / blocking links when
 * they're asked for. Pure -- the Graph layout, the workspace home, the
 * dashboard widget and shared graphs all draw from it.
 *
 * - `buildGraph` turns tasks into the graph, by key.
 * - `layoutGraph` places it: each project a cluster of its tasks around
 *   its hub, the clusters on a spiral, biggest first; milestones and labels
 *   where their tasks are. Deterministic and linear, so thousands of tasks
 *   place at once and a task stays put between renders.
 * - `graphEdges` lists the lines to draw.
 * - `graphSnapshot` is what a shared graph holds: shapes, states, counts and
 *   days, never a name or a key.
 */

import { isCanceled, isCompleted, isStarted, type Taxonomy } from "../taxonomy/engine";
import type { StatusValue, Task } from "../types";

export type GraphTaskState = "open" | "started" | "done" | "canceled";
export type GraphHubKind = "project" | "milestone" | "label";

export interface GraphTask {
	/** Its key ("T-0042"). */
	key: string;
	name: string;
	state: GraphTaskState;
	/** Its hubs, by id. */
	project: string | null;
	milestone: string | null;
	labels: string[];
	parent: string | null;
	blocks: string[];
	related: string[];
	/** Days, `YYYY-MM-DD`. */
	created: string | null;
	completed: string | null;
}

export interface GraphHub {
	kind: GraphHubKind;
	id: string;
	name: string;
	/** A color the app gives it (labels have their own). */
	color?: string | null;
}

export interface WorkspaceGraph {
	tasks: GraphTask[];
	hubs: GraphHub[];
}

export interface BuildGraphOptions {
	statuses: Taxonomy<StatusValue>;
	/** Hub names, by the id a task holds (a project's path, a milestone's
	 *  path, a label's id), and each hub's key for the graph. */
	projects?: ReadonlyMap<string, { key: string; name: string }>;
	milestones?: ReadonlyMap<string, { key: string; name: string }>;
	labels?: ReadonlyMap<string, { key: string; name: string; color?: string | null }>;
	/** Task path -> key, for parents and links. */
	taskKeys?: ReadonlyMap<string, string>;
}

const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);

function stateOf(statuses: Taxonomy<StatusValue>, status: string | null): GraphTaskState {
	if (status && isCompleted(statuses, status)) return "done";
	if (status && isCanceled(statuses, status)) return "canceled";
	if (status && isStarted(statuses, status)) return "started";
	return "open";
}

/** The graph of `tasks`: each joined to the hubs it names. Archived tasks
 *  are left out, as from every layout. */
export function buildGraph(tasks: readonly Task[], options: BuildGraphOptions): WorkspaceGraph {
	const hubs = new Map<string, GraphHub>();
	const hub = (kind: GraphHubKind, ref: string | null | undefined, table?: ReadonlyMap<string, { key: string; name: string; color?: string | null }>) => {
		if (!ref) return null;
		const found = table?.get(ref);
		const id = `${kind}:${found?.key ?? ref}`;
		if (!hubs.has(id)) hubs.set(id, { kind, id, name: found?.name ?? ref, ...(found && "color" in found ? { color: found.color ?? null } : {}) });
		return id;
	};
	const keyOf = (path: string | null | undefined) => (path ? (options.taskKeys?.get(path) ?? path) : null);
	const graphTasks: GraphTask[] = [];
	for (const task of tasks) {
		if (task.archived) continue;
		graphTasks.push({
			key: task.id,
			name: task.title,
			state: stateOf(options.statuses, task.status),
			project: hub("project", task.project, options.projects),
			milestone: hub("milestone", task.milestone ?? null, options.milestones),
			labels: task.labels.map((label) => hub("label", label, options.labels)).filter((id): id is string => !!id),
			parent: keyOf(task.parent),
			blocks: task.relations.blocks.map((path) => keyOf(path)!).filter(Boolean),
			related: task.relations.related.map((path) => keyOf(path)!).filter(Boolean),
			created: day(task.createdAt),
			completed: day(task.completedAt),
		});
	}
	return { tasks: graphTasks, hubs: [...hubs.values()] };
}

/* ------------------------------------------------------------ layout ---- */

export interface GraphPoint {
	x: number;
	y: number;
	/** Its radius: hubs grow with their tasks. */
	r: number;
}

export interface GraphLayout {
	/** By task key or hub id. */
	points: Map<string, GraphPoint>;
	/** The box everything sits in. */
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** The golden angle: successive dots never line up. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
export const TASK_RADIUS = 3;
const TASK_SPACING = 7;
const CLUSTER_GAP = 26;

/** How far a cluster of `n` tasks reaches from its hub. */
const clusterRadius = (n: number) => 14 + TASK_SPACING * Math.sqrt(n + 1);

/**
 * Places the graph: every project's tasks in a sunflower around its hub,
 * a task's sub-tasks next to it; the clusters on a spiral, biggest at the
 * middle; tasks with no project in a cluster of their own; milestones and
 * labels at the middle of their tasks.
 */
export function layoutGraph(graph: WorkspaceGraph): GraphLayout {
	const points = new Map<string, GraphPoint>();
	const byProject = new Map<string, GraphTask[]>();
	const LOOSE = "\u0000loose";
	for (const task of graph.tasks) {
		const id = task.project ?? LOOSE;
		const list = byProject.get(id);
		if (list) list.push(task);
		else byProject.set(id, [task]);
	}
	// Biggest first, then by name, so the layout doesn't depend on order.
	const hubName = new Map(graph.hubs.map((h) => [h.id, h.name]));
	const clusters = [...byProject.entries()].sort(
		(a, b) => b[1].length - a[1].length || (hubName.get(a[0]) ?? "~").localeCompare(hubName.get(b[0]) ?? "~"),
	);

	// Clusters on a spiral: each one as far out as the area used so far.
	let area = 0;
	clusters.forEach(([id, tasks], index) => {
		const reach = clusterRadius(tasks.length);
		const distance = index === 0 ? 0 : Math.sqrt(area / Math.PI) + reach + CLUSTER_GAP;
		area += Math.PI * (reach + CLUSTER_GAP) ** 2;
		const angle = index * GOLDEN * 2.2;
		const cx = Math.cos(angle) * distance;
		const cy = Math.sin(angle) * distance;
		if (id !== LOOSE) points.set(id, { x: cx, y: cy, r: Math.min(18, 6 + Math.sqrt(tasks.length) * 1.4) });
		// Parents before their sub-tasks, so siblings sit side by side.
		const ordered = orderByParent(tasks);
		ordered.forEach((task, j) => {
			const at = j + (id === LOOSE ? 0 : 2);
			const r = 10 + TASK_SPACING * Math.sqrt(at);
			points.set(task.key, { x: cx + Math.cos(at * GOLDEN) * r, y: cy + Math.sin(at * GOLDEN) * r, r: TASK_RADIUS });
		});
	});

	// Milestones and labels: at the middle of their tasks, pulled out a little.
	for (const hub of graph.hubs) {
		if (hub.kind === "project") continue;
		const members = graph.tasks.filter((task) => (hub.kind === "milestone" ? task.milestone === hub.id : task.labels.includes(hub.id)));
		if (members.length === 0) continue;
		let x = 0;
		let y = 0;
		for (const task of members) {
			const point = points.get(task.key)!;
			x += point.x;
			y += point.y;
		}
		x /= members.length;
		y /= members.length;
		const offset = hub.kind === "milestone" ? 12 : 20;
		const angle = hashAngle(hub.id);
		points.set(hub.id, { x: x + Math.cos(angle) * offset, y: y + Math.sin(angle) * offset, r: Math.min(14, 5 + Math.sqrt(members.length)) });
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const point of points.values()) {
		minX = Math.min(minX, point.x - point.r);
		minY = Math.min(minY, point.y - point.r);
		maxX = Math.max(maxX, point.x + point.r);
		maxY = Math.max(maxY, point.y + point.r);
	}
	if (points.size === 0) [minX, minY, maxX, maxY] = [0, 0, 0, 0];
	return { points, bounds: { minX, minY, maxX, maxY } };
}

function orderByParent(tasks: GraphTask[]): GraphTask[] {
	const keys = new Set(tasks.map((task) => task.key));
	const children = new Map<string, GraphTask[]>();
	const roots: GraphTask[] = [];
	for (const task of tasks) {
		if (task.parent && keys.has(task.parent)) {
			const list = children.get(task.parent);
			if (list) list.push(task);
			else children.set(task.parent, [task]);
		} else roots.push(task);
	}
	const out: GraphTask[] = [];
	const seen = new Set<string>();
	const visit = (task: GraphTask) => {
		if (seen.has(task.key)) return;
		seen.add(task.key);
		out.push(task);
		for (const child of children.get(task.key) ?? []) visit(child);
	};
	roots.forEach(visit);
	// A loop of parents (shouldn't happen): whatever's left, in order.
	for (const task of tasks) visit(task);
	return out;
}

function hashAngle(id: string): number {
	let hash = 0;
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
	return ((hash >>> 0) % 360) * (Math.PI / 180);
}

/* ------------------------------------------------------------- edges ---- */

export type GraphEdgeKind = "project" | "milestone" | "label" | "related" | "blocks" | "parent";

export interface GraphEdge {
	from: string;
	to: string;
	kind: GraphEdgeKind;
}

export interface GraphEdgeOptions {
	labels?: boolean;
	related?: boolean;
	blocks?: boolean;
}

/** The lines to draw: a task to its project and milestone, its parent, and
 *  -- when asked -- its labels, related and blocked tasks. */
export function graphEdges(graph: WorkspaceGraph, options: GraphEdgeOptions = {}): GraphEdge[] {
	const keys = new Set(graph.tasks.map((task) => task.key));
	const edges: GraphEdge[] = [];
	for (const task of graph.tasks) {
		if (task.project) edges.push({ from: task.key, to: task.project, kind: "project" });
		if (task.milestone) edges.push({ from: task.key, to: task.milestone, kind: "milestone" });
		if (task.parent && keys.has(task.parent)) edges.push({ from: task.key, to: task.parent, kind: "parent" });
		if (options.labels) for (const label of task.labels) edges.push({ from: task.key, to: label, kind: "label" });
		if (options.blocks) for (const other of task.blocks) if (keys.has(other)) edges.push({ from: task.key, to: other, kind: "blocks" });
		// Related links go both ways: draw each once.
		if (options.related) for (const other of task.related) if (keys.has(other) && task.key < other) edges.push({ from: task.key, to: other, kind: "related" });
	}
	return edges;
}

/** The hubs drawn: projects and milestones always, labels when asked. */
export function visibleHubs(graph: WorkspaceGraph, options: GraphEdgeOptions = {}): GraphHub[] {
	return graph.hubs.filter((hub) => hub.kind !== "label" || options.labels);
}

/* ---------------------------------------------------------- snapshot ---- */

/**
 * A graph as a shared link holds it: where each dot is, what state it's
 * in, which hub it belongs to and the days it was made and finished -- for
 * a picture or a time-lapse -- plus counts. No names and no keys, so
 * nothing about the work leaks through a public link.
 */
export interface GraphSnapshot {
	version: 1;
	/** `t` task, `p` project, `m` milestone, `l` label. */
	nodes: { k: "t" | "p" | "m" | "l"; x: number; y: number; r: number; s?: GraphTaskState; c?: string | null; d?: string | null }[];
	/** Pairs of node indexes, and the line's kind. */
	edges: [number, number, GraphEdgeKind][];
	counts: { tasks: number; done: number; started: number; projects: number; milestones: number };
	/** The first and last day in it, for a time-lapse. */
	from: string | null;
	to: string | null;
}

export function graphSnapshot(graph: WorkspaceGraph, layout: GraphLayout = layoutGraph(graph), options: GraphEdgeOptions = {}): GraphSnapshot {
	const index = new Map<string, number>();
	const nodes: GraphSnapshot["nodes"] = [];
	const round = (n: number) => Math.round(n * 10) / 10;
	for (const hub of visibleHubs(graph, options)) {
		const point = layout.points.get(hub.id);
		if (!point) continue;
		index.set(hub.id, nodes.length);
		nodes.push({ k: hub.kind === "project" ? "p" : hub.kind === "milestone" ? "m" : "l", x: round(point.x), y: round(point.y), r: round(point.r) });
	}
	let from: string | null = null;
	let to: string | null = null;
	for (const task of graph.tasks) {
		const point = layout.points.get(task.key);
		if (!point) continue;
		index.set(task.key, nodes.length);
		nodes.push({ k: "t", x: round(point.x), y: round(point.y), r: round(point.r), s: task.state, c: task.created, d: task.completed });
		for (const value of [task.created, task.completed]) {
			if (!value) continue;
			if (!from || value < from) from = value;
			if (!to || value > to) to = value;
		}
	}
	const edges: GraphSnapshot["edges"] = [];
	for (const edge of graphEdges(graph, options)) {
		const a = index.get(edge.from);
		const b = index.get(edge.to);
		if (a !== undefined && b !== undefined) edges.push([a, b, edge.kind]);
	}
	return {
		version: 1,
		nodes,
		edges,
		counts: {
			tasks: graph.tasks.length,
			done: graph.tasks.filter((task) => task.state === "done").length,
			started: graph.tasks.filter((task) => task.state === "started").length,
			projects: graph.hubs.filter((hub) => hub.kind === "project").length,
			milestones: graph.hubs.filter((hub) => hub.kind === "milestone").length,
		},
		from,
		to,
	};
}

/** Whether `value` is a snapshot this version can draw -- what a public
 *  page checks before trusting stored JSON. */
export function isGraphSnapshot(value: unknown): value is GraphSnapshot {
	const snapshot = value as GraphSnapshot | null;
	return !!snapshot && snapshot.version === 1 && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.edges) && typeof snapshot.counts === "object";
}
