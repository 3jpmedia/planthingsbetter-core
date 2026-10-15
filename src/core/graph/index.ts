/**
 * The workspace as a graph (T-0729): every task a dot, joined to its project
 * and its milestone, with label hubs and related / blocking links when
 * they're asked for. Pure -- the Graph layout, the workspace home, the
 * dashboard widget and shared graphs all draw from it.
 *
 * - `buildGraph` turns tasks into the graph, by key.
 * - `layoutGraph` places it the way Obsidian draws a vault: springs along
 *   the links (a task to its project, its milestone and its parent) and a
 *   short-range push between dots, so the work that belongs together pulls
 *   together. Labels sit among their tasks afterwards, so showing them never
 *   moves anything. Deterministic, and given the last layout it starts from
 *   there, so a task stays put as the work changes.
 * - `graphEdges` lists the lines to draw.
 * - `graphSnapshot` is what a shared graph holds: shapes, states, counts and
 *   days, never a name or a key.
 */

import { categoryOf, isCanceled, isCompleted, isStarted, type Taxonomy } from "../taxonomy/engine";
import type { StatusValue, Task } from "../types";

export type GraphTaskState = "open" | "started" | "done" | "canceled";
/** Where a task's status sits, by its category: what Color by Status shows. */
export type GraphTaskStage = "backlog" | "todo" | "started" | "done" | "canceled";
export type GraphHubKind = "project" | "milestone" | "label";

export interface GraphTask {
	/** Its key ("T-0042"). */
	key: string;
	name: string;
	state: GraphTaskState;
	stage: GraphTaskStage;
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
	/** How many of the graph's tasks it holds. */
	size: number;
	/** A milestone that's finished. */
	done?: boolean;
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
	milestones?: ReadonlyMap<string, { key: string; name: string; done?: boolean }>;
	labels?: ReadonlyMap<string, { key: string; name: string; color?: string | null }>;
	/** Task path -> key, for parents and links. */
	taskKeys?: ReadonlyMap<string, string>;
}

const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);

function stageOf(statuses: Taxonomy<StatusValue>, status: string | null): GraphTaskStage {
	const category = status ? categoryOf(statuses, status) : null;
	if (category === "completed") return "done";
	if (category === "canceled") return "canceled";
	if (category === "started") return "started";
	if (category === "backlog") return "backlog";
	return "todo";
}

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
	const hub = (kind: GraphHubKind, ref: string | null | undefined, table?: ReadonlyMap<string, { key: string; name: string; color?: string | null; done?: boolean }>) => {
		if (!ref) return null;
		const found = table?.get(ref);
		const id = `${kind}:${found?.key ?? ref}`;
		const known = hubs.get(id);
		if (known) known.size++;
		else
			hubs.set(id, {
				kind,
				id,
				name: found?.name ?? ref,
				size: 1,
				...(found && "color" in found ? { color: found.color ?? null } : {}),
				...(kind === "milestone" && found?.done ? { done: true } : {}),
			});
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
			stage: stageOf(options.statuses, task.status),
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
	/** Its size on screen at an ordinary zoom, in pixels: hubs grow with
	 *  their tasks. A drawing scales it gently as it zooms, far less than
	 *  the space between dots, so a crowded cluster opens up. */
	r: number;
}

export interface GraphLayout {
	/** By task key or hub id. */
	points: Map<string, GraphPoint>;
	/** The box everything sits in. */
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface LayoutGraphOptions {
	/** The layout before this change: dots already placed start where they
	 *  were and settle briefly, so nothing jumps. */
	previous?: GraphLayout | null;
	/** The shape it's drawn in, width over height: a wide box (a banner)
	 *  spreads the graph sideways to fill it, a tall one upwards. 1 for
	 *  as round as it comes. */
	aspect?: number;
}

/** A dot's size: a task, or a hub of `size` tasks. */
export const TASK_RADIUS = 2;
export function hubRadius(kind: GraphHubKind, size: number): number {
	if (kind === "project") return 3.2 + Math.sqrt(size) * 0.55;
	if (kind === "milestone") return 2.6 + Math.sqrt(size) * 0.5;
	return 2.4 + Math.sqrt(size) * 0.45;
}

/** A seeded random, so a layout is the same every time. */
function seeded(seed: number) {
	let state = seed;
	return () => {
		state = (state * 16807) % 2147483647;
		return (state - 1) / 2147483646;
	};
}

/**
 * Places the graph. Projects start on a ring, tasks beside their project,
 * milestones among their tasks; then springs pull along each link (a task
 * to its project, its milestone and its parent) while every dot pushes its
 * near neighbours away -- through a grid, so thousands stay quick -- and
 * the hubs push each other apart. Tasks with no project float free, like
 * notes with no links. Labels go among their tasks at the end.
 */
export function layoutGraph(graph: WorkspaceGraph, options: LayoutGraphOptions = {}): GraphLayout {
	const random = seeded(7);
	// Drawn in a wide (or tall) box: start stretched that way, and pull to
	// the middle less across it, so the graph fills the shape it's in.
	const aspect = Math.max(0.25, Math.min(6, options.aspect ?? 1));
	const stretch = Math.sqrt(aspect);
	const pullX = 0.004 / Math.max(1, aspect) ** 2;
	const pullY = 0.004 * Math.min(1, aspect) ** 2 * Math.max(1, aspect);
	const previous = options.previous?.points;
	// Hubs first, biggest project first, so the order doesn't depend on input.
	const placed = graph.hubs.filter((hub) => hub.kind !== "label").sort((a, b) => (a.kind === b.kind ? b.size - a.size || a.name.localeCompare(b.name) : a.kind === "project" ? -1 : 1));
	const ids: string[] = [...placed.map((hub) => hub.id), ...graph.tasks.map((task) => task.key)];
	const index = new Map(ids.map((id, i) => [id, i]));
	const hubCount = placed.length;
	const n = ids.length;
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);

	const edges: [number, number, 0 | 1 | 2][] = [];
	graph.tasks.forEach((task, k) => {
		const i = hubCount + k;
		const project = task.project ? index.get(task.project) : undefined;
		const milestone = task.milestone ? index.get(task.milestone) : undefined;
		const parent = task.parent ? index.get(task.parent) : undefined;
		if (project !== undefined) edges.push([i, project, 0]);
		if (milestone !== undefined) edges.push([i, milestone, 1]);
		if (parent !== undefined && parent !== i) edges.push([i, parent, 2]);
	});
	const degree = new Float64Array(n);
	for (const [a, b] of edges) {
		degree[a]++;
		degree[b]++;
	}
	const weight = Array.from(degree, (d) => Math.sqrt(d));

	// Where each starts: where it was, or beside what it belongs to.
	const projects = placed.filter((hub) => hub.kind === "project");
	let fresh = 0;
	placed.forEach((hub, i) => {
		const was = previous?.get(hub.id);
		if (was) [xs[i], ys[i]] = [was.x, was.y];
		else if (hub.kind === "project") {
			const angle = (projects.indexOf(hub) / Math.max(1, projects.length)) * Math.PI * 2;
			const radius = 120 + random() * 60;
			[xs[i], ys[i]] = [Math.cos(angle) * radius * stretch, (Math.sin(angle) * radius) / stretch];
			fresh++;
		}
	});
	graph.tasks.forEach((task, k) => {
		const i = hubCount + k;
		const was = previous?.get(task.key);
		if (was) {
			[xs[i], ys[i]] = [was.x, was.y];
			random();
			random();
			return;
		}
		fresh++;
		const anchor = task.project ? index.get(task.project) : task.parent ? index.get(task.parent) : undefined;
		const spread = previous ? 20 : 60;
		if (anchor !== undefined && anchor < hubCount) [xs[i], ys[i]] = [xs[anchor] + (random() - 0.5) * spread, ys[anchor] + (random() - 0.5) * spread];
		else [xs[i], ys[i]] = [(random() - 0.5) * 300 * stretch, ((random() - 0.5) * 300) / stretch];
	});
	placed.forEach((hub, i) => {
		if (hub.kind !== "milestone" || previous?.get(hub.id)) return;
		let x = 0;
		let y = 0;
		let count = 0;
		graph.tasks.forEach((task, k) => {
			if (task.milestone !== hub.id) return;
			x += xs[hubCount + k];
			y += ys[hubCount + k];
			count++;
		});
		[xs[i], ys[i]] = count ? [x / count + (random() - 0.5) * 20, y / count + (random() - 0.5) * 20] : [(random() - 0.5) * 200, (random() - 0.5) * 200];
	});

	// A change to a laid-out graph settles briefly; a new one from scratch.
	// Very large ones take fewer steps, so they still place in a moment.
	const iterations = previous && fresh < n / 3 ? 50 : Math.max(80, Math.min(260, Math.round(260 * Math.sqrt(1500 / Math.max(1500, n)))));
	const vx = new Float64Array(n);
	const vy = new Float64Array(n);
	const fx = new Float64Array(n);
	const fy = new Float64Array(n);
	const CELL = 24;
	const grid = new Map<number, number[]>();
	const cellKey = (cx: number, cy: number) => cx * 73856093 + cy * 19349663;
	for (let it = 0; it < iterations; it++) {
		const cool = (previous && fresh < n / 3 ? 0.35 : 1) * (1 - it / (iterations * 1.15));
		fx.fill(0);
		fy.fill(0);
		grid.clear();
		for (let i = 0; i < n; i++) {
			const key = cellKey(Math.floor(xs[i] / CELL), Math.floor(ys[i] / CELL));
			const cell = grid.get(key);
			if (cell) cell.push(i);
			else grid.set(key, [i]);
		}
		// Near dots push apart.
		for (let i = 0; i < n; i++) {
			const cx = Math.floor(xs[i] / CELL);
			const cy = Math.floor(ys[i] / CELL);
			for (let gx = cx - 2; gx <= cx + 2; gx++)
				for (let gy = cy - 2; gy <= cy + 2; gy++) {
					const cell = grid.get(cellKey(gx, gy));
					if (!cell) continue;
					for (const j of cell) {
						if (j <= i) continue;
						let dx = xs[i] - xs[j];
						let dy = ys[i] - ys[j];
						let d2 = dx * dx + dy * dy;
						if (d2 < 0.01) {
							dx = random() - 0.5;
							dy = random() - 0.5;
							d2 = 0.01;
						}
						if (d2 > 3600) continue;
						const d = Math.sqrt(d2);
						const f = (60 * (1 + weight[i] * 0.25) * (1 + weight[j] * 0.25)) / d2;
						fx[i] += (dx / d) * f;
						fy[i] += (dy / d) * f;
						fx[j] -= (dx / d) * f;
						fy[j] -= (dy / d) * f;
					}
				}
		}
		// Hubs push each other apart from further off.
		for (let i = 0; i < hubCount; i++)
			for (let j = i + 1; j < hubCount; j++) {
				const dx = xs[i] - xs[j];
				const dy = ys[i] - ys[j];
				const d2 = Math.max(25, dx * dx + dy * dy);
				const d = Math.sqrt(d2);
				const f = (900 * (1 + weight[i] * 0.3) * (1 + weight[j] * 0.3)) / d2;
				fx[i] += (dx / d) * f;
				fy[i] += (dy / d) * f;
				fx[j] -= (dx / d) * f;
				fy[j] -= (dy / d) * f;
			}
		// Springs along the links: short to a project, longer to a milestone.
		for (const [a, b, kind] of edges) {
			const dx = xs[b] - xs[a];
			const dy = ys[b] - ys[a];
			const d = Math.sqrt(dx * dx + dy * dy) || 1;
			const f = (d - (kind === 0 ? 14 : kind === 1 ? 26 : 10)) * (kind === 0 ? 0.06 : kind === 1 ? 0.03 : 0.05);
			const wa = 1 / (1 + degree[a] * 0.05);
			const wb = 1 / (1 + degree[b] * 0.05);
			fx[a] += (dx / d) * f * wa;
			fy[a] += (dy / d) * f * wa;
			fx[b] -= (dx / d) * f * wb;
			fy[b] -= (dy / d) * f * wb;
		}
		// A gentle pull to the middle, then move, damped and capped.
		const cap = 8 * cool + 0.5;
		for (let i = 0; i < n; i++) {
			fx[i] -= xs[i] * pullX;
			fy[i] -= ys[i] * pullY;
			vx[i] = (vx[i] + fx[i]) * 0.55;
			vy[i] = (vy[i] + fy[i]) * 0.55;
			const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
			if (speed > cap) {
				vx[i] *= cap / speed;
				vy[i] *= cap / speed;
			}
			xs[i] += vx[i];
			ys[i] += vy[i];
		}
	}

	const points = new Map<string, GraphPoint>();
	const round = (v: number) => Math.round(v * 100) / 100;
	placed.forEach((hub, i) => points.set(hub.id, { x: round(xs[i]), y: round(ys[i]), r: hubRadius(hub.kind, hub.size) }));
	graph.tasks.forEach((task, k) => points.set(task.key, { x: round(xs[hubCount + k]), y: round(ys[hubCount + k]), r: TASK_RADIUS }));

	// Labels: among their tasks, so switching them on never moves anything.
	for (const hub of graph.hubs) {
		if (hub.kind !== "label") continue;
		const was = previous?.get(hub.id);
		let x = 0;
		let y = 0;
		let count = 0;
		for (const task of graph.tasks) {
			if (!task.labels.includes(hub.id)) continue;
			const point = points.get(task.key)!;
			x += point.x;
			y += point.y;
			count++;
		}
		if (count === 0) continue;
		const angle = hashAngle(hub.id);
		points.set(hub.id, was ?? { x: round(x / count + Math.cos(angle) * 15), y: round(y / count + Math.sin(angle) * 15), r: hubRadius("label", hub.size) });
	}

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const point of points.values()) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	if (points.size === 0) [minX, minY, maxX, maxY] = [0, 0, 0, 0];
	return { points, bounds: { minX, minY, maxX, maxY } };
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
	/** `t` task, `p` project, `m` milestone, `l` label. `s` is a task's
	 *  state, or `done` for a finished milestone; `c` and `d` the days it was
	 *  made and finished; `n` a hub's name, only when its maker chose to show
	 *  names. */
	nodes: { k: "t" | "p" | "m" | "l"; x: number; y: number; r: number; s?: GraphTaskState; c?: string | null; d?: string | null; n?: string }[];
	/** Pairs of node indexes, and the line's kind. */
	edges: [number, number, GraphEdgeKind][];
	counts: { tasks: number; done: number; started: number; projects: number; milestones: number };
	/** The first and last day in it, for a time-lapse. */
	from: string | null;
	to: string | null;
}

export interface GraphSnapshotOptions extends GraphEdgeOptions {
	/** Keep project, milestone and label names (never task names). */
	names?: boolean;
}

export function graphSnapshot(graph: WorkspaceGraph, layout: GraphLayout = layoutGraph(graph), options: GraphSnapshotOptions = {}): GraphSnapshot {
	const index = new Map<string, number>();
	const nodes: GraphSnapshot["nodes"] = [];
	const round = (n: number) => Math.round(n * 10) / 10;
	// A finished milestone turns green the day its last task was finished.
	const finished = new Map<string, string | null>();
	for (const task of graph.tasks) {
		if (!task.milestone || !task.completed) continue;
		const was = finished.get(task.milestone);
		if (!was || task.completed > was) finished.set(task.milestone, task.completed);
	}
	for (const hub of visibleHubs(graph, options)) {
		const point = layout.points.get(hub.id);
		if (!point) continue;
		index.set(hub.id, nodes.length);
		nodes.push({
			k: hub.kind === "project" ? "p" : hub.kind === "milestone" ? "m" : "l",
			x: round(point.x),
			y: round(point.y),
			r: round(point.r),
			...(hub.done ? { s: "done" as const, d: finished.get(hub.id) ?? null } : {}),
			...(options.names ? { n: hub.name } : {}),
		});
	}
	let from: string | null = null;
	let to: string | null = null;
	for (const task of graph.tasks) {
		const point = layout.points.get(task.key);
		if (!point) continue;
		index.set(task.key, nodes.length);
		nodes.push({ k: "t", x: round(point.x), y: round(point.y), r: point.r, s: task.state, c: task.created, d: task.completed });
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
