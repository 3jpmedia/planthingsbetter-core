import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../../src/core/templates/instantiate";
import { queryContext } from "../../src/core/query";
import { isSystemViewId } from "../../src/core/views";
import { serializeTemplateMarkdown } from "../../src/core/templates/markdown/serialize";
import { parseTemplateMarkdown } from "../../src/core/templates/markdown/parse";
import { resolveTemplateContent } from "../../src/core/templates/markdown/resolve";
import { formatTaskId } from "../../src/core/ids";
import { joinPath } from "../../src/core/links";
import { NONE, emptyRelations } from "../../src/core/types";
import { makeDashboard, makeWidget } from "../../src/core/templates/helpers";
import type {
	CustomFieldDef,
	RecurrenceConfig,
	RecurrenceFrequency,
	RecurrenceTrigger,
	Task,
} from "../../src/core/types";
import type { TemplateBuildContext } from "../../src/core/templates/types";

const DAY = 24 * 60 * 60 * 1000;
function ctx(): TemplateBuildContext {
	const now = new Date("2026-08-26T12:00:00Z");
	const iso = (o: number) => new Date(now.getTime() + o * DAY).toISOString();
	return {
		root: "WS",
		idPrefix: "FIX",
		now,
		iso,
		day: (o) => iso(o).slice(0, 10),
		taskPath: (n) => joinPath("WS", "Tasks", formatTaskId("FIX", n)),
	};
}

const snapshot = sampleSnapshot();

function roundTrip() {
	const source = serializeTemplateMarkdown({
		meta: { id: "my-template", name: "My Template", icon: "rocket" },
		workspace: snapshot.workspace,
		views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
		dashboards: snapshot.dashboards,
		projects: snapshot.projects,
		queryContext: queryContext(snapshot),
	});
	const parsed = parseTemplateMarkdown(source);
	const content = resolveTemplateContent(parsed, ctx());
	return { source, parsed, content };
}

/** A minimal, valid recurrence rule for `printRepeatToken` tests. */
function recurrence(
	partial: Partial<RecurrenceConfig> & {
		freq: RecurrenceFrequency;
		interval?: number;
		trigger?: RecurrenceTrigger;
		triggerStatus?: string | null;
	},
): RecurrenceConfig {
	return {
		trigger: partial.trigger ?? "on-date",
		triggerStatus: partial.triggerStatus ?? null,
		freq: partial.freq,
		interval: partial.interval ?? 1,
		weekdays: [],
		dayOfMonth: null,
		weekdayOfMonth: null,
		monthOfYear: null,
		anchor: "dueDate",
		newStatus: null,
		endsAfter: null,
		endsOn: null,
		nextDate: "2026-09-01",
		copyFields: null,
	};
}

/** A task shaped from the sample snapshot, with controllable links. */
function task(overrides: Partial<Task> & { id: string; title: string }): Task {
	return {
		...snapshot.tasks[0],
		relations: emptyRelations(),
		archived: false,
		...overrides,
	};
}

describe("serializeTemplateMarkdown round-trip", () => {
	it("reproduces the taxonomy with names, colors, categories and order", () => {
		const { parsed } = roundTrip();
		const statuses = parsed.workspaceOverrides.statuses!;
		expect(statuses.map((s) => s.name)).toEqual(
			snapshot.workspace.statuses.map((s) => s.name),
		);
		expect(statuses.map((s) => s.category)).toEqual(
			snapshot.workspace.statuses.map((s) => s.category),
		);
		expect(statuses.map((s) => s.color)).toEqual(
			snapshot.workspace.statuses.map((s) => s.color),
		);
		expect(statuses.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(parsed.workspaceOverrides.labels!.map((l) => l.name)).toEqual(
			snapshot.workspace.labels.map((l) => l.name),
		);
	});

	it("carries the people roster with no '*' me marker", () => {
		const { parsed } = roundTrip();
		expect(parsed.workspaceOverrides.people!.map((p) => p.name).sort()).toEqual(
			["Alice", "Bob"],
		);
		expect(parsed.mePersonId).toBeUndefined();
	});

	it("reproduces views through the query round-trip", () => {
		const { content } = roundTrip();
		const names = content.views!.map((v) => v.name);
		expect(names).toContain("Sprint Board");
		const sprint = content.views!.find((v) => v.name === "Sprint Board")!;
		expect(sprint.viewType).toBe("board");
		expect(sprint.groupBy).toBe("status");
	});

	it("reproduces dashboards (widget count + chart types)", () => {
		const { content } = roundTrip();
		const dash = content.dashboards!.find((d) => d.name === "Sprint Overview")!;
		expect(dash.widgets.length).toBe(3);
		expect(dash.widgets.map((w) => w.chartType).sort()).toEqual([
			"bar",
			"pie",
			"timeline",
		]);
	});

	it("round-trips a graph widget (T-0729)", () => {
		const dashboards = [
			makeDashboard("graph", "Graph board", [
				makeWidget("w1", "graph", "The work", { chartType: "graph" }, { x: 0, y: 0, w: 6, h: 4 }),
				makeWidget("w2", "kpi", "Tasks", { chartType: "kpi", metric: "count", scope: null }, { x: 6, y: 0, w: 6, h: 4 }),
			]),
		];
		const source = serializeTemplateMarkdown({
			meta: { id: "graph", name: "Graph" },
			workspace: snapshot.workspace,
			views: [],
			dashboards,
			projects: [],
			queryContext: queryContext(snapshot),
		});
		expect(source).toContain("type: graph");
		const content = resolveTemplateContent(parseTemplateMarkdown(source), ctx());
		const dash = content.dashboards!.find((d) => d.name === "Graph board")!;
		expect(dash.widgets.map((w) => [w.chartType, w.title, w.fieldMapping])).toEqual([
			["graph", "The work", { chartType: "graph" }],
			["kpi", "Tasks", { chartType: "kpi", metric: "count", scope: null }],
		]);
	});

	it("round-trips a split, a goal and a table (T-1127, T-1128)", () => {
		const dashboards = [
			makeDashboard("goals", "Goals board", [
				makeWidget(
					"w1",
					"bar",
					"Weekly",
					{ chartType: "bar", groupBy: "assignee", splitBy: "project", sideBySide: true, goal: { amount: 2, period: "week", dueDay: 5 } },
					{ x: 0, y: 0, w: 6, h: 4 },
				),
				makeWidget("w2", "table", "Matrix", { chartType: "table", rows: "assignee", columns: "taskType" }, { x: 6, y: 0, w: 6, h: 4 }),
				makeWidget("w3", "kpi", "Done", { chartType: "kpi", metric: "count", scope: null, goal: { amount: 10, period: "month" } }, { x: 0, y: 4, w: 6, h: 4 }),
			]),
		];
		const source = serializeTemplateMarkdown({
			meta: { id: "goals", name: "Goals" },
			workspace: snapshot.workspace,
			views: [],
			dashboards,
			projects: [],
			queryContext: queryContext(snapshot),
		});
		expect(source).toContain("type: table");
		const content = resolveTemplateContent(parseTemplateMarkdown(source), ctx());
		const dash = content.dashboards!.find((d) => d.name === "Goals board")!;
		expect(dash.widgets.map((w) => w.fieldMapping)).toEqual(dashboards[0].widgets.map((w) => w.fieldMapping));
	});

	it("round-trips updatedAt/completedAt chart xFields from a live dashboard", () => {
		const dashboards = [
			makeDashboard("temporal", "Temporal", [
				makeWidget(
					"w1",
					"line",
					"Updates",
					{ chartType: "line", xField: "updatedAt", bucket: "day", groupBy: null },
					{ x: 0, y: 0, w: 2, h: 1 },
				),
				makeWidget(
					"w2",
					"timeline",
					"Completions",
					{
						chartType: "timeline",
						xField: "completedAt",
						bucket: "week",
						groupBy: null,
					},
					{ x: 2, y: 0, w: 2, h: 1 },
				),
			]),
		];
		const source = serializeTemplateMarkdown({
			meta: { id: "x-fields", name: "X Fields" },
			workspace: snapshot.workspace,
			views: [],
			dashboards,
			projects: snapshot.projects,
			queryContext: queryContext(snapshot),
		});
		const content = resolveTemplateContent(parseTemplateMarkdown(source), ctx());
		const dash = content.dashboards!.find((d) => d.name === "Temporal")!;
		expect(
			dash.widgets.map(
				(w) => (w.fieldMapping as { xField?: string }).xField,
			),
		).toEqual(["updatedAt", "completedAt"]);
	});

	it("carries the workspace's Projects (structure, not populatable material)", () => {
		const { source, parsed, content } = roundTrip();
		// Projects are always created, so a Projects-only template has nothing
		// for the populate toggle to gate - `supportsExampleContent` is false.
		expect(parsed.meta.supportsExampleContent).toBe(false);
		expect(parsed.tasks).toEqual([]);
		expect(parsed.projects.map((p) => p.title)).toEqual(
			["Core App Experience", "App Store Launch & Marketing", "Developer Platform"],
		);
		// The frontmatter entry is written in taxonomy names, so a re-import
		// resolves status/priority against the very statuses this template ships.
		expect(content.projects.map((p) => p.title)).toEqual(parsed.projects.map((p) => p.title));
		expect(content.projects.map((p) => p.status)).toEqual(
			snapshot.projects.map((p) => p.status),
		);
		expect(content.projects.map((p) => p.createdAt)).toEqual(
			snapshot.projects.map((p) => p.createdAt),
		);
		// Projects ride in frontmatter like Views/Dashboards, not as body sections.
		expect(source).toContain("projects:");
		expect(source).toContain(`title: ${snapshot.projects[0].title}`);
	});

	it("carries a Project's icon, description and dates", () => {
		const project = {
			...snapshot.projects[0],
			icon: "briefcase",
			startDate: "2026-09-01",
			dueDate: "2026-09-30",
		};
		const source = serializeTemplateMarkdown({
			meta: { id: "my-template", name: "My Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: [project],
			projectDescriptions: { [project.path]: "The flagship app." },
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.projects[0]).toMatchObject({
			title: project.title,
			icon: "briefcase",
			status: snapshot.workspace.statuses.find((s) => s.id === project.status)?.name,
			description: "The flagship app.",
		});
		expect(parsed.projects[0].start?.kind).toBe("absolute");
		expect(parsed.projects[0].due?.kind).toBe("absolute");
		const content = resolveTemplateContent(parsed, ctx());
		expect(content.projects[0].icon).toBe("briefcase");
		expect(content.projects[0].startDate).toBe("2026-09-01");
		expect(content.projects[0].dueDate).toBe("2026-09-30");
		expect(content.projectDescriptions?.get(content.projects[0].path)).toBe(
			"The flagship app.\n",
		);
		// The description survives as frontmatter, not a body section.
		expect(source).toContain("description: The flagship app.");
	});

	it("drops archived projects from the template", () => {
		const archived = {
			...snapshot.projects[0],
			title: "Retired Project",
			archived: true,
			archivedAt: "2026-08-01T12:00:00.000Z",
		};
		const source = serializeTemplateMarkdown({
			meta: { id: "my-template", name: "My Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: [...snapshot.projects, archived],
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.projects.map((p) => p.title)).not.toContain("Retired Project");
		// A Projects-only template is still structure-only: nothing to populate.
		expect(parsed.meta.supportsExampleContent).toBe(false);
	});

	it("a workspace with no Projects exports as a blank template", () => {
		const source = serializeTemplateMarkdown({
			meta: { id: "empty-template", name: "Empty Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: [],
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.projects).toEqual([]);
		expect(parsed.meta.supportsExampleContent).toBe(false);
	});

	it("carries Tasks in the body with links, fences and names", () => {
		const project = snapshot.projects[0];
		const status = snapshot.workspace.statuses.find((s) => s.category === "started")!;
		const priority = snapshot.workspace.priorities[0];
		const taskType = snapshot.workspace.taskTypes[0];
		const label = snapshot.workspace.labels[0];
		const alice = snapshot.workspace.people.find((p) => p.name === "Alice")!;
		const parent = task({
			id: "FIX-0102",
			title: "Parent task",
			path: joinPath("WS", "Tasks", "FIX-0102"),
			project: project.path,
		});
		const child = task({
			id: "FIX-0103",
			title: "Child task",
			path: joinPath("WS", "Tasks", "FIX-0103"),
			project: project.path,
			parent: parent.path,
			assignee: alice.id,
			status: status.id,
			priority: priority.id,
			taskType: taskType.id,
			labels: [label.id],
			estimate: 3,
			startDate: "2026-09-01",
			dueDate: "2026-09-15",
			createdAt: "2026-08-20T09:00:00.000Z",
			updatedAt: "2026-08-25T14:00:00.000Z",
			completedAt: "2026-08-24T10:00:00.000Z",
			recurrence: recurrence({ freq: "weekly" }),
			relations: {
				blocks: [parent.path],
				blockedBy: [],
				related: [parent.path],
				duplicateOf: parent.path,
			},
		});

		const source = serializeTemplateMarkdown({
			meta: { id: "tasked-template", name: "Tasked Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: snapshot.projects,
			tasks: [parent, child],
			taskDescriptions: {
				[child.path]: "First line.\nSecond line.",
			},
			taskComments: {
				[child.path]: [
					{
						id: "c-1",
						author: alice.id,
						date: "2026-08-22T11:00:00.000Z",
						body: "Nice start.",
						reactions: {},
						editedAt: null,
						replyTo: null,
					},
				],
			},
			queryContext: queryContext(snapshot),
		});

		// Tasks make the template populatable - that's what the toggle seeds.
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.meta.supportsExampleContent).toBe(true);
		expect(source).toContain("supportsExampleContent: true");
		expect(parsed.tasks.map((t) => t.anchor)).toContain("FIX-0102");
		expect(parsed.tasks.map((t) => t.anchor)).toContain("FIX-0103");

		const childParsed = parsed.tasks.find((t) => t.title === "Child task")!;
		expect(childParsed.project).toBe(project.title);
		expect(childParsed.parent).toBe("FIX-0102");
		// Refs are written as names/anchors and re-resolved on import.
		expect(childParsed.status).toBe(status.name);
		expect(childParsed.priority).toBe(priority.name);
		expect(childParsed.type).toBe(taskType.name);
		expect(childParsed.assignee).toBe("Alice");
		expect(childParsed.estimate).toBe(3);
		expect(childParsed.labels).toEqual([label.name]);
		expect(childParsed.start?.kind).toBe("absolute");
		expect(childParsed.created).toEqual({
			kind: "absolute",
			iso: "2026-08-20T09:00:00.000Z",
		});
		expect(childParsed.completed).toEqual({
			kind: "absolute",
			iso: "2026-08-24T10:00:00.000Z",
		});
		expect(childParsed.blocks).toEqual(["FIX-0102"]);
		expect(childParsed.related).toEqual(["FIX-0102"]);
		expect(childParsed.duplicateOf).toBe("FIX-0102");
		expect(childParsed.repeat).toMatchObject({
			freq: "weekly",
			interval: 1,
			onClose: false,
		});
		expect(childParsed.description).toBe("First line.\nSecond line.");
		expect(childParsed.comments).toMatchObject([
			{ author: "Alice", body: "Nice start." },
		]);

		// And the resolved re-import lands the same ids the workspace used.
		const content = resolveTemplateContent(parsed, ctx());
		const resolvedProject = content.projects.find(
			(p) => p.title === project.title,
		)!;
		const parentResolved = content.tasks.find(
			(t) => t.title === "Parent task",
		)!;
		const childResolved = content.tasks.find((t) => t.title === "Child task")!;
		expect(childResolved.project).toBe(resolvedProject.path);
		expect(childResolved.parent).toBe(parentResolved.path);
		expect(childResolved.assignee).toBe(alice.id);
		expect(childResolved.status).toBe(status.id);
		expect(childResolved.priority).toBe(priority.id);
		expect(childResolved.taskType).toBe(taskType.id);
		expect(childResolved.labels).toEqual([label.id]);
		expect(childResolved.estimate).toBe(3);
		expect(childResolved.startDate).toBe("2026-09-01");
		expect(childResolved.dueDate).toBe("2026-09-15");
		expect(childResolved.createdAt).toBe("2026-08-20T09:00:00.000Z");
		expect(childResolved.completedAt).toBe("2026-08-24T10:00:00.000Z");
		expect(childResolved.recurrence?.freq).toBe("weekly");
		expect(childResolved.relations.blocks).toEqual([parentResolved.path]);
		expect(childResolved.relations.related).toEqual([parentResolved.path]);
		expect(childResolved.relations.duplicateOf).toBe(parentResolved.path);
		expect(content.comments?.get(childResolved.path)?.[0]).toMatchObject({
			author: alice.id,
			body: "Nice start.",
		});
		expect(content.descriptions?.get(childResolved.path)).toBe(
			"First line.\nSecond line.\n",
		);
	});

	it("prints the repeat shorthand and skips rules it can't express", () => {
		const serializeWith = (recurrence: RecurrenceConfig) =>
			serializeTemplateMarkdown({
				meta: { id: "repeating-template", name: "Repeating Template" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				tasks: [
					task({
						id: "FIX-0104",
						title: "Recurring task",
						path: joinPath("WS", "Tasks", "FIX-0104"),
						recurrence,
					}),
				],
				queryContext: queryContext(snapshot),
			});

		expect(serializeWith(recurrence({ freq: "weekly" }))).toContain(
			"repeat: weekly",
		);
		expect(
			serializeWith(
				recurrence({ freq: "weekly", interval: 2, trigger: "on-close" }),
			),
		).toContain("repeat: every 2 weeks when completed");
		// An on-close rule firing on a specific status has no shorthand - it's
		// skipped rather than silently flattened into an on-date cadence.
		expect(
			serializeWith(
				recurrence({ freq: "daily", trigger: "on-close", triggerStatus: "s2" }),
			),
		).not.toContain("repeat:");
	});

	it("keeps archived Projects and Tasks only when includeArchived is set", () => {
		const archivedProject = {
			...snapshot.projects[0],
			title: "Retired Project",
			archived: true,
			archivedAt: "2026-08-01T12:00:00.000Z",
		};
		const archivedTask = task({
			id: "FIX-0105",
			title: "Archived task",
			path: joinPath("WS", "Tasks", "FIX-0105"),
			project: archivedProject.path,
			archived: true,
			archivedAt: "2026-08-02T12:00:00.000Z",
		});

		const base = {
			meta: { id: "archived-template", name: "Archived Template" },
			workspace: snapshot.workspace,
			views: [],
			dashboards: [],
			projects: [...snapshot.projects, archivedProject],
			tasks: [archivedTask],
			queryContext: queryContext(snapshot),
		};

		// Default: both are trash, not template payload.
		const parsed = parseTemplateMarkdown(
			serializeTemplateMarkdown(base),
		);
		expect(parsed.projects.map((p) => p.title)).not.toContain("Retired Project");
		expect(parsed.tasks.map((t) => t.title)).not.toContain("Archived task");

		// A full snapshot keeps them - and the archived Task's project link
		// still resolves, because the archived Project rides along too.
		const content = resolveTemplateContent(
			parseTemplateMarkdown(
				serializeTemplateMarkdown({ ...base, includeArchived: true }),
			),
			ctx(),
		);
		expect(content.projects.map((p) => p.title)).toContain("Retired Project");
		const archivedResolved = content.tasks.find(
			(t) => t.title === "Archived task",
		)!;
		const resolvedArchivedProject = content.projects.find(
			(p) => p.title === archivedProject.title,
		)!;
		expect(archivedResolved.archived).toBe(true);
		expect(archivedResolved.project).toBe(resolvedArchivedProject.path);
	});

	it("drops dangling task links to Tasks excluded by the archived filter", () => {
		const kept = task({
			id: "FIX-0106",
			title: "Kept task",
			path: joinPath("WS", "Tasks", "FIX-0106"),
		});
		const archived = task({
			id: "FIX-0107",
			title: "Archived task",
			path: joinPath("WS", "Tasks", "FIX-0107"),
			archived: true,
			archivedAt: "2026-08-02T12:00:00.000Z",
			relations: {
				blocks: [kept.path],
				blockedBy: [],
				related: [kept.path],
				duplicateOf: kept.path,
			},
		});

		// Archived excluded, kept included: the archived task isn't serialized,
		// so nothing dangles. Include archived: the kept link stays, and a link
		// to an excluded task is dropped rather than breaking the file.
		const full = parseTemplateMarkdown(
			serializeTemplateMarkdown({
				meta: { id: "dangling-template", name: "Dangling Template" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				tasks: [kept, archived],
				includeArchived: true,
				queryContext: queryContext(snapshot),
			}),
		);
		const archivedParsed = full.tasks.find((t) => t.title === "Archived task")!;
		expect(archivedParsed.blocks).toEqual(["FIX-0106"]);
		expect(archivedParsed.related).toEqual(["FIX-0106"]);
		expect(archivedParsed.duplicateOf).toBe("FIX-0106");
		expect(parseTemplateMarkdown(
			serializeTemplateMarkdown({
				meta: { id: "dangling-template", name: "Dangling Template" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				tasks: [archived],
				queryContext: queryContext(snapshot),
			}),
		).tasks).toEqual([]);
	});


	it("round-trips an optional createdAt timestamp", () => {
		const source = serializeTemplateMarkdown({
			meta: {
				id: "my-template",
				name: "My Template",
				createdAt: "2026-08-26T12:00:00.000Z",
			},
			workspace: snapshot.workspace,
			views: snapshot.views.filter((v) => !isSystemViewId(v.id)),
			dashboards: snapshot.dashboards,
			projects: snapshot.projects,
			queryContext: queryContext(snapshot),
		});
		const parsed = parseTemplateMarkdown(source);
		expect(parsed.meta.createdAt).toBe("2026-08-26T12:00:00.000Z");
	});


	it("leaves createdAt undefined when the template doesn't set one", () => {
		const { parsed } = roundTrip();
		expect(parsed.meta.createdAt).toBeUndefined();
	});
	describe("custom fields", () => {
		const opt = (name: string, n: number) => ({ id: `o${n}`, name, color: "#ff0000" });
		const person = snapshot.workspace.people[0];
		const fields: CustomFieldDef[] = [
			{ id: "f1", key: "CF-0001", slug: "points", name: "Points", type: "number" },
			{ id: "f2", key: "CF-0002", slug: "client", name: "Client", type: "select", options: [opt("Acme", 1), opt("Globex", 2)] },
			{ id: "f3", key: "CF-0003", slug: "tags", name: "Tags", type: "multiSelect", options: [opt("a", 3), opt("b", 4)] },
			{ id: "f4", key: "CF-0004", slug: "reviewer", name: "Reviewer", type: "member" },
			{ id: "f5", key: "CF-0005", slug: "signed-off", name: "Signed off", type: "checkbox" },
			{ id: "f6", key: "CF-0006", slug: "due-to-client", name: "Due to client", type: "date" },
			{ id: "f7", key: "CF-0007", slug: "status", name: "Status", type: "text" },
			{ id: "f8", key: "CF-0008", slug: "bad", name: "Bad (name)", type: "text" },
		];
		const tasks = [
			task({
				id: "FIX-0201",
				title: "With values",
				path: joinPath("WS", "Tasks", "FIX-0201"),
				fields: { f1: 5, f2: "o2", f3: ["o3", "o4"], f4: [person.id], f5: true, f6: "2026-11-01", f7: "Waiting", f8: "x" },
			}),
		];
		const serialize = () =>
			serializeTemplateMarkdown({
				meta: { id: "fields-template", name: "Fields Template" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				tasks,
				customFields: fields,
				queryContext: queryContext(snapshot),
			});

		it("writes definitions to frontmatter and values to the field line", () => {
			const source = serialize();
			expect(source).toContain("Points (number)");
			expect(source).toContain("Client (select, Acme, Globex)");
			expect(source).toContain("Reviewer (person)");
			expect(source).not.toContain("Bad (name)");
			expect(source).toContain("Points: 5");
			expect(source).toContain("Client: Globex");
			expect(source).toContain("custom.status: Waiting");
		});

		it("round-trips fields and values", () => {
			const parsed = parseTemplateMarkdown(serialize());
			expect(parsed.customFields?.map((f) => f.name)).toEqual(
				["Points", "Client", "Tags", "Reviewer", "Signed off", "Due to client", "Status"],
			);
			const content = resolveTemplateContent(parsed, ctx());
			const values = content.tasks[0].fields!;
			const byName = (name: string) => content.customFields!.find((f) => f.name === name)!;
			const client = byName("Client");
			expect(values[client.id]).toBe(client.options!.find((o) => o.name === "Globex")!.id);
			expect(values[byName("Points").id]).toBe(5);
			expect(values[byName("Signed off").id]).toBe(true);
			expect(values[byName("Due to client").id]).toBe("2026-11-01");
			expect(values[byName("Status").id]).toBe("Waiting");
			expect(values[byName("Tags").id]).toHaveLength(2);
			expect(values[byName("Reviewer").id]).toHaveLength(1);
		});

		it("round-trips charts that group by or add up a custom field (T-0274)", () => {
			const dashboards = [
				makeDashboard("d", "Fields", [
					makeWidget("w1", "bar", "Points by client", { chartType: "bar", groupBy: "field:CF-0002", metric: "fieldSum", metricField: "field:CF-0001" }, { x: 0, y: 0, w: 6, h: 4 }),
					makeWidget("w2", "kpi", "Points left", { chartType: "kpi", metric: "fieldAvg", metricField: "field:CF-0001", scope: null }, { x: 6, y: 0, w: 6, h: 2 }),
					// A field the template doesn't carry can't be read back: left out.
					makeWidget("w3", "pie", "By gone", { chartType: "pie", groupBy: "field:CF-0099" }, { x: 0, y: 4, w: 6, h: 4 }),
				]),
			];
			const source = serializeTemplateMarkdown({
				meta: { id: "charts", name: "Charts" },
				workspace: snapshot.workspace,
				views: [],
				dashboards,
				projects: [],
				customFields: fields,
				queryContext: queryContext(snapshot),
			});
			expect(source).toContain("custom.client");
			const content = resolveTemplateContent(parseTemplateMarkdown(source), ctx());
			const mappings = content.dashboards![0].widgets.map((w) => w.fieldMapping);
			const keyOf = (slug: string) => `field:${content.customFields!.find((f) => f.slug === slug)!.key}`;
			expect(mappings).toEqual([
				{ chartType: "bar", groupBy: keyOf("client"), metric: "fieldSum", metricField: keyOf("points") },
				{ chartType: "kpi", metric: "fieldAvg", metricField: keyOf("points"), scope: null },
			]);
		});

		it("round-trips a field's Space and guest visibility (T-0659)", () => {
			const scoped: CustomFieldDef[] = [
				{ id: "s1", key: "CF-0001", slug: "points", name: "Points", type: "number", spaces: ["Design"], internal: true },
				{ id: "s2", key: "CF-0002", slug: "client", name: "Client", type: "select", options: [opt("Acme", 1)], spaces: ["Design"] },
				{ id: "s3", key: "CF-0003", slug: "notes", name: "Notes", type: "text", internal: true },
				{ id: "s4", key: "CF-0004", slug: "plain", name: "Plain", type: "text" },
				// A Space name the shorthand can't carry leaves the field out.
				{ id: "s5", key: "CF-0005", slug: "odd", name: "Odd", type: "text", spaces: ["A, B"] },
				{ id: "s6", key: "CF-0006", slug: "tricky", name: "Tricky", type: "select", options: [{ id: "x", name: "space: Fake", color: "#ff0000" }] },
			];
			const source = serializeTemplateMarkdown({
				meta: { id: "scoped", name: "Scoped" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				customFields: scoped,
				queryContext: queryContext(snapshot),
			});
			expect(source).toContain("Points (number, space: Design, guests: hidden)");
			expect(source).toContain("Client (select, Acme, space: Design)");
			expect(source).toContain("Notes (text, guests: hidden)");
			expect(source).not.toContain("Odd");
			expect(source).not.toContain("Tricky");
			const parsed = parseTemplateMarkdown(source);
			const back = parsed.customFields!;
			expect(back.map((f) => [f.name, f.spaces?.[0], f.internal])).toEqual([
				["Points", "Design", true],
				["Client", "Design", undefined],
				["Notes", undefined, true],
				["Plain", undefined, undefined],
			]);
			expect(back[1].options?.map((o) => o.name)).toEqual(["Acme"]);
			const content = resolveTemplateContent(parsed, ctx());
			expect(content.customFields![0]).toMatchObject({ spaces: ["Design"], internal: true });
		});

		it("round-trips several Spaces and task types (T-0720)", () => {
			const scoped: CustomFieldDef[] = [
				{ id: "e1", key: "CF-0001", slug: "environment", name: "Environment", type: "select", options: [opt("Prod", 1)], spaces: ["Client 2", "Client 3"], taskTypes: ["Bug"] },
				{ id: "e2", key: "CF-0002", slug: "browser", name: "Browser", type: "text", taskTypes: ["Bug", "Chore"] },
				// A choice that reads as a task type setting can't be carried.
				{ id: "e3", key: "CF-0003", slug: "odd", name: "Odd", type: "select", options: [{ id: "x", name: "type: Fake", color: "#ff0000" }] },
			];
			const source = serializeTemplateMarkdown({
				meta: { id: "typed", name: "Typed" },
				workspace: snapshot.workspace,
				views: [],
				dashboards: [],
				projects: [],
				customFields: scoped,
				queryContext: queryContext(snapshot),
			});
			expect(source).toContain("Environment (select, Prod, space: Client 2, space: Client 3, type: Bug)");
			expect(source).toContain("Browser (text, type: Bug, type: Chore)");
			expect(source).not.toContain("Odd");
			const back = parseTemplateMarkdown(source).customFields!;
			expect(back.map((f) => [f.name, f.spaces, f.taskTypes])).toEqual([
				["Environment", ["Client 2", "Client 3"], ["Bug"]],
				["Browser", undefined, ["Bug", "Chore"]],
			]);
			expect(back[0].options?.map((o) => o.name)).toEqual(["Prod"]);
		});

		it("reads a field that starts with a scope setting as text", () => {
			const source = `---\ntype: vertex-flow-workspace-template\ntemplateSchema: 1\nid: x\nname: X\ndescription: d\nfields:\n  - "Steps (type: Bug)"\n---\n`;
			expect(parseTemplateMarkdown(source).customFields).toMatchObject([{ name: "Steps", type: "text", taskTypes: ["Bug"] }]);
		});

		it("rejects a bad scope setting", () => {
			const source = (field: string) => `---\ntype: vertex-flow-workspace-template\ntemplateSchema: 1\nid: x\nname: X\ndescription: d\nfields:\n  - "${field}"\n---\n`;
			expect(() => parseTemplateMarkdown(source("Points (number, guests: maybe)"))).toThrow(/hidden/);
			expect(() => parseTemplateMarkdown(source("Points (number, space: )"))).toThrow(/Space/);
			expect(() => parseTemplateMarkdown(source("Points (number, type: )"))).toThrow(/task type/);
		});

		it("round-trips a KPI narrowed by a custom field (T-0659)", () => {
			const dashboards = [
				makeDashboard("d", "Fields", [
					makeWidget("w1", "kpi", "Acme tasks", { chartType: "kpi", metric: "count", scope: { field: "field:CF-0002", value: "o1" } }, { x: 0, y: 0, w: 6, h: 2 }),
					makeWidget("w2", "kpi", "Reviewer's", { chartType: "kpi", metric: "count", scope: { field: "field:CF-0004", value: person.id } }, { x: 6, y: 0, w: 6, h: 2 }),
					makeWidget("w3", "kpi", "No client", { chartType: "kpi", metric: "count", scope: { field: "field:CF-0002", value: NONE } }, { x: 0, y: 2, w: 6, h: 2 }),
					makeWidget("w4", "kpi", "Gone", { chartType: "kpi", metric: "count", scope: { field: "field:CF-0099", value: "o1" } }, { x: 6, y: 2, w: 6, h: 2 }),
				]),
			];
			const source = serializeTemplateMarkdown({
				meta: { id: "scoped-kpi", name: "Scoped KPI" },
				workspace: snapshot.workspace,
				views: [],
				dashboards,
				projects: [],
				customFields: fields,
				queryContext: queryContext(snapshot),
			});
			expect(source).toContain("field: custom.client");
			expect(source).toContain("value: Acme");
			const content = resolveTemplateContent(parseTemplateMarkdown(source), ctx());
			const mappings = content.dashboards![0].widgets.map((w) => w.fieldMapping);
			const def = (slug: string) => content.customFields!.find((f) => f.slug === slug)!;
			expect(mappings).toHaveLength(3);
			expect(mappings[0]).toEqual({ chartType: "kpi", metric: "count", scope: { field: `field:${def("client").key}`, value: def("client").options![0].id } });
			expect(mappings[1]).toMatchObject({ scope: { field: `field:${def("reviewer").key}` } });
			expect(mappings[2]).toMatchObject({ scope: { field: `field:${def("client").key}`, value: NONE } });
		});

		it("writes no fields when there are none", () => {
			expect(serializeTemplateMarkdown({
				meta: { id: "x", name: "X" }, workspace: snapshot.workspace, views: [], dashboards: [], projects: [], queryContext: queryContext(snapshot),
			})).not.toContain("fields:");
		});
	});
});
