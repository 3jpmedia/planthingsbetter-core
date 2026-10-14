/**
 * The inverse of `parse.ts`: a live workspace's settings → a
 * `type: vertex-flow-workspace-template` markdown file the New Workspace
 * gallery can offer.
 *
 * Configuration plus Projects ride in frontmatter - statuses, priorities, task
 * types, labels, the people roster, saved views, dashboards, and each Project
 * as an entry (same shape as Views/Dashboards) carrying its title, icon,
 * description, status/priority/owner/labels and dates. Tasks, when the caller
 * asks for them, ride in the `# Tasks` body as `## Title {#id}` field-line
 * sections - with `:::description` and `:::comment Author (date)` fences for
 * the note body, so descriptions and comments come along too. Archived
 * Projects and Tasks ride along only when `includeArchived` is set; otherwise
 * they're workspace trash, not template payload.
 *
 * `supportsExampleContent` is truthful about what the toggle can populate:
 * `true` only when Tasks ride along (Projects are structure - always created
 * - so they never make a template "populatable"), `false` (blank, like
 * `blank-workspace.md`) when there's nothing to seed.
 *
 * Pure - no Obsidian import (Golden Rule); `yaml` is the one sanctioned
 * dependency, already used by `parse.ts` for the reverse direction.
 */

import { stringify as stringifyYaml } from "yaml";

import { NONE } from "../../types";
import { printFilters, printQuery, type QueryContext } from "../../query";
import { sortByRank } from "../../ranking";
import type {
	Comment,
	CustomFieldDef,
	CustomFieldType,
	CustomFieldValue,
	DashboardConfig,
	DashboardScope,
	DashboardWidget,
	PriorityValue,
	Project,
	RecurrenceConfig,
	RecurrenceFrequency,
	SavedView,
	StatusValue,
	Task,
	TaskTypeValue,
	WorkspaceConfig,
} from "../../types";
import { viewDefinition } from "../../views/filter";
import { TEMPLATE_SCHEMA_VERSION } from "./parse";

export interface TemplateSerializeInput {
	meta: { id: string; name: string; description?: string; icon?: string; createdAt?: string };
	/** Source of the taxonomy and the people roster. */
	workspace: WorkspaceConfig;
	/** Every Saved View to carry over - the caller drops synthetic System Views. */
	views: SavedView[];
	dashboards: DashboardConfig[];
	/** The workspace's Projects; archived ones are dropped by the serializer. */
	projects: Project[];
	/** A project's body description - the part that doesn't live on the bare
	 *  `Project` record - keyed by `project.path`. */
	projectDescriptions?: Record<string, string>;
	/** The workspace's Tasks to ride along in the `# Tasks` body. Omitted → the
	 *  template ships no Tasks. When present, `supportsExampleContent` is true. */
	tasks?: Task[];
	/** A task's body description, keyed by `task.path`. */
	taskDescriptions?: Record<string, string>;
	/** A task's comments, keyed by `task.path`. */
	taskComments?: Record<string, Comment[]>;
	/** Archived Projects *and* Tasks ride along only when true (so their
	 *  cross-links keep resolving); default drops them. */
	includeArchived?: boolean;
	/** The workspace's custom fields. Written to frontmatter `fields:` in the
	 *  taxonomy shorthand (a Space's own field as `space: Design`, a task
	 *  type's as `type: Bug`, each repeated for several; a guest-hidden one as
	 *  `guests: hidden`), and each Task's values (`Task.fields`) ride on its
	 *  field line. The host passes the fields a template should carry, with
	 *  `spaces` and `taskTypes` set to names where it has them; a host that
	 *  wants a field left out drops it here. */
	customFields?: CustomFieldDef[];
	/** For `printQuery` / `printFilters` - build it with `queryContext(snapshot)`. */
	queryContext: QueryContext;
}

/* ---------------------------------------------------------- taxonomy ------ */

function withDescription(head: string, description?: string): string {
	const trimmed = description?.trim();
	return trimmed ? `${head} - ${trimmed}` : head;
}

function statusShorthand(value: StatusValue): string {
	return withDescription(
		`${value.name} (${value.category}, ${value.color})`,
		value.description,
	);
}

function flatShorthand(value: PriorityValue | TaskTypeValue): string {
	return withDescription(`${value.name} (${value.color})`, value.description);
}

/* ------------------------------------------------------ custom fields ---- */

/** The type words `parseCustomFields` reads (the inverse of its table). */
const FIELD_TYPE_WORD: Record<CustomFieldType, string> = {
	text: "text",
	number: "number",
	select: "select",
	multiSelect: "multi-select",
	date: "date",
	checkbox: "checkbox",
	member: "person",
	url: "url",
};

/** Built-in task field-line keys: a custom field named like one is written
 *  as `custom.<slug>` so it can't be read as the built-in. */
const BUILT_IN_FIELD_KEYS = new Set([
	"project", "parent", "type", "status", "priority", "assignee", "estimate",
	"labels", "start", "due", "created", "updated", "completed", "archived",
	"repeat", "blocks", "blockedby", "related", "duplicateof",
]);

/** Whether the shorthand can carry the field: no brackets, commas, pipes,
 *  colons or line breaks where they would be read as syntax. */
function fieldIsWritable(field: CustomFieldDef): boolean {
	if (!field.name.trim() || /[()|:\n,]/.test(field.name)) return false;
	// Each Space's and task type's name sits in the brackets as `space: Name`
	// / `type: Name`.
	if ([...(field.spaces ?? []), ...(field.taskTypes ?? [])].some((name) => !name.trim() || /[(),|\n]/.test(name))) return false;
	// A choice that reads as a scope setting would be taken for one.
	return (field.options ?? []).every((o) => o.name.trim() && !/[(),|\n]/.test(o.name) && !/^\s*(space|type|guests)\s*:/i.test(o.name));
}

function fieldShorthand(field: CustomFieldDef): string {
	const choices = field.type === "select" || field.type === "multiSelect"
		? (field.options ?? []).map((o) => o.name.trim())
		: [];
	const scope = [
		...(field.spaces ?? []).map((space) => `space: ${space.trim()}`),
		...(field.taskTypes ?? []).map((type) => `type: ${type.trim()}`),
		...(field.internal ? ["guests: hidden"] : []),
	];
	return `${field.name.trim()} (${[FIELD_TYPE_WORD[field.type], ...choices, ...scope].join(", ")})`;
}

/** The key a task's field line uses for a field. */
function fieldLineKey(field: CustomFieldDef): string {
	const name = field.name.trim();
	return /^[a-z]+$/i.test(name) && BUILT_IN_FIELD_KEYS.has(name.toLowerCase())
		? `custom.${field.slug}`
		: name;
}

/** A value as the field line reads it, or null when it is empty or can't be
 *  written (an unknown choice, a person no longer on the roster). */
function fieldValueText(
	field: CustomFieldDef,
	value: CustomFieldValue | undefined,
	workspace: WorkspaceConfig,
): string | null {
	if (value === undefined || value === null) return null;
	const list = (items: string[]) => (items.length > 0 ? `[${items.join(", ")}]` : null);
	switch (field.type) {
		case "number":
			return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
		case "checkbox":
			return value === true ? "yes" : null;
		case "select": {
			const option = field.options?.find((o) => o.id === value);
			return option ? option.name.trim() : null;
		}
		case "multiSelect": {
			const ids = Array.isArray(value) ? value : [];
			return list(
				ids
					.map((id) => field.options?.find((o) => o.id === id)?.name.trim())
					.filter((n): n is string => Boolean(n)),
			);
		}
		case "member": {
			const ids = Array.isArray(value) ? value : [];
			return list(
				ids
					.map((id) => workspace.people.find((p) => p.id === id)?.name)
					.filter((n): n is string => Boolean(n) && !/[,\][]/.test(n as string)),
			);
		}
		default:
			return typeof value === "string" && value.trim() ? value.trim() : null;
	}
}

/* ---------------------------------------------------------- dashboards --- */

function widgetMap(
	widget: DashboardWidget,
	includeWeight: boolean,
	customFields: readonly CustomFieldDef[],
	people: readonly { id: string; name: string }[],
): Record<string, unknown> | null {
	const fm = widget.fieldMapping;
	// A custom field is written by its query name (`custom.client`); a chart
	// of one the template doesn't carry is left out, as it couldn't be read.
	const named = (ref: string): string | null => {
		const field = customFields.find((candidate) => `field:${candidate.key}` === ref);
		return field ? `custom.${field.slug}` : null;
	};
	// A scope on a custom field names the field by its query name, and the
	// value by the choice's name (or the person's); a field the template
	// doesn't carry, or a value that can't be written, leaves the chart out.
	const scopeMap = (scope: DashboardScope): { field: string; value: string } | null => {
		if (!scope.field.startsWith("field:")) return { field: scope.field, value: scope.value };
		const field = customFields.find((candidate) => `field:${candidate.key}` === scope.field);
		if (!field) return null;
		if (scope.value === NONE) return { field: `custom.${field.slug}`, value: "none" };
		const name =
			field.type === "member"
				? people.find((person) => person.id === scope.value)?.name
				: field.options?.find((option) => option.id === scope.value)?.name;
		return name ? { field: `custom.${field.slug}`, value: name } : null;
	};
	const groupName = (groupBy: string): string | null => (groupBy.startsWith("field:") ? named(groupBy) : groupBy);
	const measure = (map: Record<string, unknown>): boolean => {
		if (!("metric" in fm) || !fm.metric || fm.metric === "count") return true;
		map.metric = fm.metric;
		if (fm.metric === "fieldSum" || fm.metric === "fieldAvg") {
			const field = "metricField" in fm && fm.metricField ? named(fm.metricField) : null;
			if (!field) return false;
			map.metricField = field;
		}
		return true;
	};
	const map: Record<string, unknown> = {
		type: fm.chartType,
		title: widget.title.trim() || fm.chartType,
	};

	switch (fm.chartType) {
		case "bar":
		case "pie": {
			const groupBy = groupName(fm.groupBy);
			if (!groupBy) return null;
			map.groupBy = groupBy;
			if (fm.chartType === "bar" && !measure(map)) return null;
			break;
		}
		case "line":
		case "timeline": {
			map.xField = fm.xField;
			map.bucket = fm.bucket;
			if (fm.groupBy) {
				const groupBy = groupName(fm.groupBy);
				if (!groupBy) return null;
				map.groupBy = groupBy;
			}
			if (fm.chartType === "line" && !measure(map)) return null;
			break;
		}
		case "kpi":
			if (!measure(map)) return null;
			map.metric = fm.metric;
			if (fm.scope) {
				const scope = scopeMap(fm.scope);
				if (!scope) return null;
				map.scope = scope;
			}
			break;
	}

	// `weight` is a relative share within its row - the parser normalises it
	// against the row total, so the raw column width carries over directly.
	if (includeWeight) map.weight = widget.layout.w;
	return map;
}

/**
 * Group widgets into rows by their `y` band (widgets sharing a `y` are one
 * row), each row ordered by `x`. Some fidelity loss going grid → rows → grid is
 * expected and acceptable - dashboards are Phase 1 and row-share is already a
 * simplification.
 */
function widgetRows(
	dashboard: DashboardConfig,
	customFields: readonly CustomFieldDef[],
	people: readonly { id: string; name: string }[],
): Record<string, unknown>[][] {
	const byY = new Map<number, DashboardWidget[]>();
	for (const widget of dashboard.widgets) {
		const row = byY.get(widget.layout.y) ?? [];
		row.push(widget);
		byY.set(widget.layout.y, row);
	}

	return [...byY.keys()]
		.sort((a, b) => a - b)
		.map((y) => {
			const row = byY.get(y)!.sort((a, b) => a.layout.x - b.layout.x);
			return row
				.map((widget) => widgetMap(widget, row.length > 1, customFields, people))
				.filter((map): map is Record<string, unknown> => map !== null);
		});
}

function dashboardMap(
	dashboard: DashboardConfig,
	context: QueryContext,
	customFields: readonly CustomFieldDef[],
	people: readonly { id: string; name: string }[],
): Record<string, unknown> {
	const map: Record<string, unknown> = { name: dashboard.name };
	if (dashboard.icon) map.icon = dashboard.icon;
	if (dashboard.description) map.description = dashboard.description;

	const filter = printFilters(dashboard.filters, context);
	if (filter) map.filter = filter;

	map.rows = widgetRows(dashboard, customFields, people).filter((row) => row.length > 0);
	return map;
}

/* ------------------------------------------------------------- views ----- */

function viewMap(view: SavedView, context: QueryContext): Record<string, unknown> {
	const map: Record<string, unknown> = { name: view.name };
	if (view.icon) map.icon = view.icon;
	if (view.description) map.description = view.description;
	// A single `query:` line is a complete, battle-tested round-trip - the
	// grammar defines it to take precedence over every structured alternative.
	map.query = printQuery(viewDefinition(view), context);
	return map;
}

/* ----------------------------------------------------------- projects ------ */

/** A Project rides in frontmatter, same shape as Views/Dashboards, so every
 *  property survives the trip. References (status/priority/owner/labels) are
 *  written as *names* rather than ids - the parser re-resolves them against the
 *  same taxonomy this template ships, exactly as the old body field line did. */
function projectMap(
	project: Project,
	description: string | undefined,
	workspace: WorkspaceConfig,
): Record<string, unknown> {
	const nameById = (list: { id: string; name: string }[], id: string | null) =>
		list.find((v) => v.id === id)?.name;

	const map: Record<string, unknown> = { title: project.title };
	if (project.icon) map.icon = project.icon;
	if (description?.trim()) map.description = description.trim();

	const status = nameById(workspace.statuses, project.status);
	if (status) map.status = status;
	const priority = nameById(workspace.priorities, project.priority);
	if (priority) map.priority = priority;
	if (project.labels.length > 0) {
		map.labels = project.labels
			.map((id) => nameById(workspace.labels, id))
			.filter((n): n is string => Boolean(n));
	}
	const owner = nameById(workspace.people, project.owner);
	if (owner) map.owner = owner;

	if (project.startDate) map.start = project.startDate;
	if (project.dueDate) map.due = project.dueDate;
	if (project.createdAt) map.created = project.createdAt;
	if (project.updatedAt) map.updated = project.updatedAt;
	return map;
}

/* ------------------------------------------------------------- tasks ------ */

/** The repeat shorthand's canonical frequency words - the inverse of the
 *  aliases `parseRepeatToken` accepts (day/days/week/weeks/…). One map per
 *  cardinality, because a multi-interval cadence is written "every 2 weeks" -
 *  the parser's plural aliases - not "every 2 weekly". */
const REPEAT_FREQ_WORDS: Record<RecurrenceFrequency, string> = {
	daily: "daily",
	weekly: "weekly",
	monthly: "monthly",
	yearly: "yearly",
};
const REPEAT_FREQ_PLURALS: Record<RecurrenceFrequency, string> = {
	daily: "days",
	weekly: "weeks",
	monthly: "months",
	yearly: "years",
};

/** `RecurrenceConfig` → the `repeat:` field-line token, or `null` when the
 *  shorthand can't express a rule faithfully - the token deliberately covers
 *  only frequency, interval, and the "when completed" on-close trigger, so a
 *  custom trigger status (e.g. "when Review lands") is skipped rather than
 *  silently flattened into an on-date cadence. */
function printRepeatToken(rule: RecurrenceConfig): string | null {
	if (rule.trigger === "on-close" && rule.triggerStatus !== null) return null;
	const cadence =
		rule.interval > 1
			? `every ${rule.interval} ${REPEAT_FREQ_PLURALS[rule.freq]}`
			: REPEAT_FREQ_WORDS[rule.freq];
	return rule.trigger === "on-close" ? `${cadence} when completed` : cadence;
}

/** One `## Title {#id}` field-line section per Task, in global `rank` order
 *  (resolve re-derives rank from document order, so ordering survives the
 *  re-import). Description and comments ride in `:::` fences - the same
 *  grammar a hand-author writes against. Refs are *anchors* (the source task
 *  ids, unique by construction); a ref that points at a Task excluded by the
 *  archived filter is dropped rather than left dangling. No `*` "me" marker
 *  and no `history` toggle anywhere - see the module doc. */
function taskSection(
	tasks: Task[],
	taskDescriptions: Record<string, string> | undefined,
	taskComments: Record<string, Comment[]> | undefined,
	workspace: WorkspaceConfig,
	anchorByPath: Map<string, string>,
	projectTitleByPath: Map<string, string>,
	customFields: CustomFieldDef[],
): string {
	const nameById = (list: { id: string; name: string }[], id: string | null) =>
		list.find((v) => v.id === id)?.name;

	/** A field-line value that won't break the `|`-separated grammar. */
	const token = (value: string | undefined | null): string | null =>
		value && !value.includes("|") && !value.includes("\n") ? value : null;

	// Relations link to *included* Tasks only; a link that would dangle (its
	// target dropped by the archived filter) is omitted.
	const included = new Set(anchorByPath.keys());
	const linkList = (paths: string[]): string[] =>
		paths
			.map((path) => anchorByPath.get(path))
			.filter((anchor): anchor is string => anchor !== undefined);

	const notes: string[] = [];
	for (const task of sortByRank(tasks, (task) => task.rank)) {
		const segments: string[] = [];

		const projectTitle = task.project
			? projectTitleByPath.get(task.project)
			: undefined;
		if (projectTitle) segments.push(`project: ${projectTitle}`);

		const status = nameById(workspace.statuses, task.status);
		if (status) segments.push(`status: ${status}`);
		const priority = nameById(workspace.priorities, task.priority);
		if (priority) segments.push(`priority: ${priority}`);
		const taskType = nameById(workspace.taskTypes, task.taskType);
		if (taskType) segments.push(`type: ${taskType}`);
		const assignee = nameById(workspace.people, task.assignee);
		if (assignee) segments.push(`assignee: ${assignee}`);
		if (task.estimate != null) segments.push(`estimate: ${task.estimate}`);
		if (task.labels.length > 0) {
			const labels = task.labels
				.map((id) => nameById(workspace.labels, id))
				.filter(Boolean) as string[];
			if (labels.length > 0) segments.push(`labels: [${labels.join(", ")}]`);
		}
		if (task.startDate) segments.push(`start: ${task.startDate}`);
		if (task.dueDate) segments.push(`due: ${task.dueDate}`);
		if (task.createdAt) segments.push(`created: ${task.createdAt}`);
		if (task.updatedAt) segments.push(`updated: ${task.updatedAt}`);
		if (task.completedAt) segments.push(`completed: ${task.completedAt}`);
		if (task.archived) segments.push("archived: true");

		if (task.parent && included.has(task.parent))
			segments.push(`parent: ${anchorByPath.get(task.parent)}`);
		const blocks = linkList(task.relations.blocks);
		if (blocks.length > 0) segments.push(`blocks: [${blocks.join(", ")}]`);
		const blockedBy = linkList(task.relations.blockedBy);
		if (blockedBy.length > 0)
			segments.push(`blockedby: [${blockedBy.join(", ")}]`);
		const related = linkList(task.relations.related);
		if (related.length > 0)
			segments.push(`related: [${related.join(", ")}]`);
		if (task.relations.duplicateOf && included.has(task.relations.duplicateOf))
			segments.push(`duplicateof: ${anchorByPath.get(task.relations.duplicateOf)}`);

		for (const field of customFields) {
			const text = fieldValueText(field, task.fields?.[field.id], workspace);
			if (text) segments.push(`${fieldLineKey(field)}: ${text}`);
		}

		const repeat = task.recurrence ? printRepeatToken(task.recurrence) : null;
		if (repeat) segments.push(`repeat: ${repeat}`);

		// `token()` guards every name-bearing segment - a name with a `|` or a
		// newline would silently corrupt the field line, so that one field is
		// dropped instead (the rest of the Task still rides).
		const fieldLine = segments
			.map((segment) => token(segment))
			.filter((segment): segment is string => segment !== null)
			.join(" | ");

		const notesForTask = [`## ${task.title} {#${anchorByPath.get(task.path)}}`];
		if (fieldLine) notesForTask.push(fieldLine);

		const description = taskDescriptions?.[task.path];
		if (description?.trim()) {
			notesForTask.push("", ":::description", description.trim(), ":::");
		}

		for (const comment of taskComments?.[task.path] ?? []) {
			// A comment by a roster member deleted since can't re-resolve - its
			// author would fail template resolution, so it's dropped.
			const author = nameById(workspace.people, comment.author);
			if (!author || /[()]/.test(author)) continue;
			notesForTask.push(
				"",
				`:::comment ${author} (${comment.date})`,
				comment.body,
				":::",
			);
		}

		notes.push(notesForTask.join("\n"));
	}
	return notes.join("\n\n");
}

/* ------------------------------------------------------------- entry ----- */

export function serializeTemplateMarkdown(input: TemplateSerializeInput): string {
	const {
		meta,
		workspace,
		views,
		dashboards,
		projects,
		projectDescriptions,
		tasks,
		taskDescriptions,
		taskComments,
		includeArchived = false,
		queryContext,
	} = input;
	const customFields = (input.customFields ?? []).filter(fieldIsWritable);

	const statuses = [...workspace.statuses].sort((a, b) => a.order - b.order);
	const priorities = [...workspace.priorities].sort((a, b) => a.order - b.order);

	// Archived entities are workspace trash, not template payload - unless the
	// caller explicitly asks for them (a full snapshot). Projects and Tasks are
	// kept on the same toggle so a Task's own project link always resolves.
	const activeProjects = projects.filter((p) => includeArchived || !p.archived);
	const activeTasks = (tasks ?? []).filter(
		(t) => includeArchived || !t.archived,
	);

	const frontmatter: Record<string, unknown> = {
		templateSchema: TEMPLATE_SCHEMA_VERSION,
		type: "vertex-flow-workspace-template",
		id: meta.id,
		name: meta.name,
		// The parser requires a non-empty description; fall back to the name.
		description: meta.description?.trim() || meta.name,
	};
	if (meta.icon) frontmatter.icon = meta.icon;
	if (meta.createdAt) frontmatter.createdAt = meta.createdAt;
	// Truthful: Projects are structure (always created), so a template is only
	// "populatable" when Tasks ride along for the toggle to seed.
	frontmatter.supportsExampleContent = activeTasks.length > 0;

	frontmatter.statuses = statuses.map(statusShorthand);
	frontmatter.priorities = priorities.map(flatShorthand);
	frontmatter.taskTypes = workspace.taskTypes.map(flatShorthand);
	frontmatter.labels = workspace.labels.map(flatShorthand);
	// Real names, full roster - but never the `*` "me" marker (§9): carrying it
	// would auto-assign the exporting device's identity to whoever creates a
	// workspace from this template.
	frontmatter.people = workspace.people.map((person) => person.name);

	if (customFields.length > 0) {
		frontmatter.fields = customFields.map(fieldShorthand);
	}

	if (views.length > 0) {
		frontmatter.views = views.map((view) => viewMap(view, queryContext));
	}
	if (dashboards.length > 0) {
		frontmatter.dashboards = dashboards.map((dashboard) =>
			dashboardMap(dashboard, queryContext, customFields, workspace.people),
		);
	}
	if (activeProjects.length > 0) {
		frontmatter.projects = activeProjects.map((project) =>
			projectMap(project, projectDescriptions?.[project.path], workspace),
		);
	}

	const yaml = stringifyYaml(frontmatter);

	// Projects ride in frontmatter, so `# Projects` is empty scaffolding - the
	// grammar a template's body conforms to is still exactly "# Projects" and
	// "# Tasks", and a hand-author adding `##` sections from there works.
	// Tasks (when carried) fill `# Tasks` as `## Title {#id}` sections.
	let body = `# Projects\n\n# Tasks\n`;
	if (activeTasks.length > 0) {
		// Task ids are unique anchors by construction; a collision with a
		// Project's slugified-title anchor is effectively impossible, and the
		// gallery's parser reports one loudly rather than silently breaking.
		const anchorByPath = new Map(
			activeTasks.map((task) => [task.path, task.id] as const),
		);
		const projectTitleByPath = new Map(
			activeProjects.map(
				(project) => [project.path, project.title] as const,
			),
		);
		body += `\n${taskSection(
			activeTasks,
			taskDescriptions,
			taskComments,
			workspace,
			anchorByPath,
			projectTitleByPath,
			customFields,
		)}\n`;
	}
	return `---\n${yaml}---\n\n${body}`;
}
