/**
 * Saved View filtering.
 *
 * Semantics: values within one filter are OR'd, filters are AND'd together -
 * `status: [todo, in-progress], taskType: [bug]` means "a bug that is either
 * todo or in progress". This is the behaviour every issue tracker has, so it
 * needs no explanation in the UI.
 */

import { relationScope, type HierarchyScope } from "../hierarchy";
import { linksMatch } from "../links";
import { CHECKLIST_OPEN, checklistNameKey, hasChecklist, hasOpenChecklist, isChecklistKeyword, matchesChecklistValues } from "../checklists";
import { getValue, isOpen, type Taxonomy } from "../taxonomy";
import { inFolder } from "../folders";
import { DEFAULT_DEFINITION } from "./defaults";
import {
	ANY,
	CANVAS_RELATION_KINDS,
	LINKED_DATE_FIELDS,
	LINKED_DATE_FIELD_KEYS,
	LINKED_FOLDER_FIELD_KEYS,
	LINKED_NAME_FIELD_KEYS,
	NONE,
	OPEN_LINK,
	SELF,
	TASK_FIELDS,
	isCustomFieldRef,
	linkedDateExcludeKey,
	linkedFolderExcludeKey,
	type CanvasRelationKind,
	type CustomFieldRef,
	type LinkTarget,
	type LinkedDateBoundKey,
	type LinkedDateExcludeKey,
	type LinkedDateField,
	type LinkedFolderExcludeKey,
	type LinkedFolderField,
	type LinkedNameField,
	type SavedView,
	type SortField,
	type Task,
	type TableSortKey,
	type TaskField,
	type ViewDefinition,
	type ViewFilters,
} from "../types";
import type { ViewContext } from "./context";
import { matchesCustomFilters } from "./custom-fields";

/** Expand the `self` sentinel against the device's per-workspace "me" personId. */
function resolvePeople(values: string[], context: ViewContext): string[] {
	const out: string[] = [];
	for (const value of values) {
		if (value === SELF) {
			// No `me` is set in this workspace - a `self` filter then matches
			// nothing, which is honest. Silently matching everything would make
			// "Assigned to Me" look like "All Tasks".
			if (context.selfId) out.push(context.selfId);
		} else {
			out.push(value);
		}
	}
	return out;
}

/** OR-match a single-valued field, honouring the `NONE` sentinel. */
function matchesSingle(
	actual: string | null,
	allowed: string[] | undefined,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	return allowed.includes(actual);
}

/** OR-match a link field, tolerating short-form vs full-path wikilinks. */
function matchesLink(
	actual: LinkTarget | null,
	allowed: string[] | undefined,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	return allowed.some(
		(value) => value !== NONE && (value === actual || linksMatch(actual, value)),
	);
}

/** OR-match a task's own path against an explicit list -- no `NONE` (a task
 *  always has a path) and no traversal, unlike `root`: a task matches only
 *  if it's literally one of the listed tasks. */
function matchesId(actual: LinkTarget, allowed: string[] | undefined): boolean {
	if (!allowed || allowed.length === 0) return true;
	return allowed.some((value) => value === actual || linksMatch(actual, value));
}

/** OR-match a task's own array relation (`blocks`/`blockedBy`/`related`)
 *  against an explicit list of task paths -- any shared task counts. Plain
 *  membership like `matchesId`, not `root`'s traversal: a task's own
 *  `related` list, say, is never walked transitively. `NONE` matches a
 *  task with no entries in the field at all. */
function matchesTaskLinks(
	actual: LinkTarget[],
	allowed: string[] | undefined,
	context?: ViewContext,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual.length === 0) return allowed.includes(NONE);
	return actual.some((value) =>
		allowed.some((pattern) =>
			pattern === OPEN_LINK
				? isOpenLink(value, context)
				: pattern !== NONE && (pattern === value || linksMatch(value, pattern)),
		),
	);
}

/** Path -> task, once per task list (a view evaluates every task against
 *  the same context, so the map is built once, not per task). */
const tasksByPath = new WeakMap<Task[], Map<LinkTarget, Task | null>>();

/**
 * `OPEN_LINK` (`blocked-by:open`, T-0724): is the linked task still open --
 * neither completed nor canceled, and not archived? A link to a task the
 * context can't see (no `scope`, or a task outside it) doesn't count: there's
 * nothing known to be waiting on. Archived counts as finished, as the app's
 * Blocked by badge has it.
 */
function isOpenLink(path: LinkTarget, context: ViewContext | undefined): boolean {
	const tasks = context?.scope?.tasks;
	if (!tasks) return false;
	let byPath = tasksByPath.get(tasks);
	if (!byPath) {
		byPath = new Map(tasks.map((task) => [task.path, task]));
		tasksByPath.set(tasks, byPath);
	}
	let task = byPath.get(path);
	if (task === undefined) {
		// A short-form wikilink: looked up once, the answer kept.
		task = tasks.find((candidate) => linksMatch(candidate.path, path)) ?? null;
		byPath.set(path, task);
	}
	return task != null && !task.archived && isOpen(context!.taxonomies.status, task.status);
}

/** Does `name` fall under the group named by a `"Parent/*"` pattern? */
function matchesGroupPattern(name: string | null, pattern: string): boolean {
	if (name == null || !pattern.endsWith("/*")) return false;
	return name.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
}

/** OR-match labels: exact id, or a live group-pattern match on the
 *  label's current name (any nesting depth). */
function matchesLabels(
	actual: string[],
	allowed: string[] | undefined,
	taxonomy: Taxonomy,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual.length === 0) return allowed.includes(NONE);
	return actual.some((id) =>
		allowed.some(
			(pattern) =>
				pattern === id ||
				matchesGroupPattern(getValue(taxonomy, id)?.name ?? null, pattern),
		),
	);
}

/** OR-match project: exact path (tolerating wikilink forms, as today), or
 *  a live group-pattern match on the project's current title. */
function matchesProject(
	actual: LinkTarget | null,
	allowed: string[] | undefined,
	titles: Map<LinkTarget, string> | undefined,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	return allowed.some(
		(pattern) =>
			(pattern !== NONE &&
				(pattern === actual || linksMatch(actual, pattern))) ||
			matchesGroupPattern(titles?.get(actual) ?? null, pattern),
	);
}

/** OR-match milestone: exact path, or a live group-pattern match on the
 *  milestone's current title. */
function matchesMilestone(
	actual: LinkTarget | null | undefined,
	allowed: string[] | undefined,
	context: ViewContext,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	return allowed.some(
		(pattern) =>
			(pattern !== NONE && (pattern === actual || linksMatch(actual, pattern))) ||
			matchesGroupPattern(context.milestones?.get(actual)?.title ?? null, pattern),
	);
}

/** OR-match Space: exact path. A workspace-wide task (no Space) matches
 *  only `NONE`. */
function matchesSpace(actual: LinkTarget | null | undefined, allowed: string[] | undefined): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	return allowed.some((pattern) => pattern !== NONE && (pattern === actual || linksMatch(actual, pattern)));
}

/** OR-match an exact-day field, day-truncating a full timestamp. */
function matchesDateExact(
	actual: string | null,
	allowed: string[] | undefined,
): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (actual == null) return allowed.includes(NONE);
	const day = actual.slice(0, 10);
	return allowed.some((value) => value === day);
}

/** One of a task's milestone's or project's dates (`LINKED_DATE_FIELDS`),
 *  or null: no milestone (project), one this context can't see, or that
 *  date unset on it. */
function linkedDate(task: Task, field: LinkedDateField, context: ViewContext): string | null {
	const spec = LINKED_DATE_FIELDS[field];
	const link = task[spec.of];
	if (!link) return null;
	const item = spec.of === "milestone" ? context.milestones?.get(link) : context.projects?.get(link);
	if (!item) return null;
	return ((item as unknown as Record<string, string | null | undefined>)[spec.date] ?? null) || null;
}

/** The hub folders a task's linked items are filed in, for a
 *  `LINKED_FOLDER_FIELDS` filter (`project.folder:`): its project's or
 *  milestone's folder, or each of its labels' folders. Empty when it has no
 *  such item, none of them is in a folder, or this context can't see them. */
function linkedFolders(task: Task, field: LinkedFolderField, context: ViewContext): string[] {
	switch (field) {
		case "projectFolder": {
			const folder = task.project ? context.projects?.get(task.project)?.folder : undefined;
			return folder ? [folder] : [];
		}
		case "milestoneFolder": {
			const folder = task.milestone ? context.milestones?.get(task.milestone)?.folder : undefined;
			return folder ? [folder] : [];
		}
		case "labelFolder":
			return task.labels.map((id) => getValue(context.taxonomies.label, id)?.path).filter((path): path is string => !!path);
	}
}

/** OR-match folders: any of `folders` is in (or below) one of `allowed`;
 *  `NONE` matches no folder at all. */
function matchesFolders(folders: string[], allowed: string[] | undefined): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (folders.length === 0) return allowed.includes(NONE);
	return allowed.some((wanted) => wanted !== NONE && folders.some((folder) => inFolder(folder, wanted)));
}

/** The names a task's linked items have for a `LINKED_NAME_FIELDS` filter
 *  (`project.name:`): its project's, milestone's or Space's name, each of its
 *  labels' names, or its assignee's name and email. Empty when it has none,
 *  or this context can't see them. */
function linkedNames(task: Task, field: LinkedNameField, context: ViewContext): string[] {
	switch (field) {
		case "projectName": {
			if (!task.project) return [];
			const title = context.projects?.get(task.project)?.title ?? context.titles?.get(task.project);
			return title ? [title] : [];
		}
		case "milestoneName": {
			const title = task.milestone ? context.milestones?.get(task.milestone)?.title : undefined;
			return title ? [title] : [];
		}
		case "spaceName": {
			const title = task.space ? context.spaces?.get(task.space)?.title : undefined;
			return title ? [title] : [];
		}
		case "labelName":
			return task.labels.map((id) => getValue(context.taxonomies.label, id)?.name).filter((name): name is string => !!name);
		case "assigneeName": {
			const person = task.assignee ? context.people.find((candidate) => candidate.id === task.assignee) : undefined;
			return person ? [person.name, ...(person.email ? [person.email] : [])] : [];
		}
	}
}

/** Exclusive before/after bound on an (optionally full-timestamp) date field. */
function matchesDateRange(
	actual: string | null,
	before: string | undefined,
	after: string | undefined,
): boolean {
	if (!before && !after) return true;
	if (actual == null) return false;
	const day = actual.slice(0, 10);
	if (before && !(day < before)) return false;
	if (after && !(day > after)) return false;
	return true;
}

export function matchesFilters(
	task: Task,
	filters: ViewFilters,
	context: ViewContext,
): boolean {
	// Archived is a visibility flag, not a status: hidden by default, mixed in
	// by `archived: "included"`, and shown exclusively by `archived: "only"`.
	if (filters.archived === "only") {
		if (!task.archived) return false;
	} else if (!filters.archived && task.archived) {
		return false;
	}

	// Triaged-out predicates: finished work and scheduled work have both left
	// the "needs a decision" pool. Independent of the `archived` filter.
	if (filters.openOnly && !isOpen(context.taxonomies.status, task.status)) {
		return false;
	}
	if (filters.unscheduled && (task.dueDate || task.startDate)) return false;
	if (filters.recurring && !task.recurrence) return false;
	// Checklists (checklists.ts): `checklist:any|unset|open|done|<name>`,
	// plus the older flags a filter saved before them may still carry.
	if (filters.hasChecklist && !hasChecklist(task)) return false;
	if (filters.checklistOpen && !hasOpenChecklist(task)) return false;
	if (filters.checklist?.length && !matchesChecklistValues(task, filters.checklist)) return false;

	if (!matchesSingle(task.status, filters.status)) return false;
	if (!matchesSingle(task.priority, filters.priority)) return false;
	if (!matchesSingle(task.taskType, filters.taskType)) return false;
	if (!matchesLabels(task.labels, filters.labels, context.taxonomies.label))
		return false;

	if (filters.assignee && filters.assignee.length > 0) {
		const allowed = resolvePeople(filters.assignee, context);
		const wantsNone = filters.assignee.includes(NONE);
		if (task.assignee == null) {
			if (!wantsNone) return false;
		} else if (!allowed.includes(task.assignee)) {
			return false;
		}
	}

	if (filters.mentions && filters.mentions.length > 0) {
		const allowed = resolvePeople(filters.mentions, context);
		if (!task.mentions.some((id) => allowed.includes(id))) return false;
	}

	if (!matchesProject(task.project, filters.project, context.titles))
		return false;
	if (!matchesMilestone(task.milestone, filters.milestone, context)) return false;
	if (!matchesSpace(task.space, filters.space)) return false;
	if (!matchesLink(task.parent, filters.parent)) return false;
	if (!matchesId(task.path, filters.id)) return false;
	if (!matchesTaskLinks(task.relations.blocks, filters.blocks)) return false;
	if (!matchesTaskLinks(task.relations.blockedBy, filters.blockedBy, context)) return false;
	if (!matchesTaskLinks(task.relations.related, filters.related)) return false;

	if (!matchesCustomFilters(task, filters.custom, context)) return false;

	if (!matchesDateExact(task.dueDate, filters.dueDate)) return false;
	if (!matchesDateRange(task.dueDate, filters.dueDateBefore, filters.dueDateAfter))
		return false;
	if (!matchesDateExact(task.startDate, filters.startDate)) return false;
	if (
		!matchesDateRange(task.startDate, filters.startDateBefore, filters.startDateAfter)
	)
		return false;
	if (!matchesDateExact(task.createdAt, filters.createdAt)) return false;
	if (
		!matchesDateRange(task.createdAt, filters.createdAtBefore, filters.createdAtAfter)
	)
		return false;
	if (!matchesDateExact(task.updatedAt, filters.updatedAt)) return false;
	if (
		!matchesDateRange(task.updatedAt, filters.updatedAtBefore, filters.updatedAtAfter)
	)
		return false;
	if (!matchesDateExact(task.startedAt, filters.startedAt)) return false;
	if (!matchesDateRange(task.startedAt, filters.startedAtBefore, filters.startedAtAfter)) return false;
	if (!matchesDateExact(task.completedAt, filters.completedAt)) return false;
	if (
		!matchesDateRange(
			task.completedAt,
			filters.completedAtBefore,
			filters.completedAtAfter,
		)
	)
		return false;

	for (const field of LINKED_DATE_FIELD_KEYS) {
		const exact = filters[field];
		const before = filters[`${field}Before`];
		const after = filters[`${field}After`];
		if (!exact?.length && !before && !after) continue;
		const value = linkedDate(task, field, context);
		if (!matchesDateExact(value, exact)) return false;
		if (!matchesDateRange(value, before, after)) return false;
	}

	for (const field of LINKED_FOLDER_FIELD_KEYS) {
		const allowed = filters[field];
		const excluded = filters[linkedFolderExcludeKey(field)];
		if (!allowed?.length && !excluded?.length) continue;
		const folders = linkedFolders(task, field, context);
		if (!matchesFolders(folders, allowed)) return false;
		if (excluded?.length && matchesFolders(folders, excluded)) return false;
	}

	/* -- exclusions: task fails if its value falls in any excluded list -- */

	if (filters.excludeStatus?.length && matchesSingle(task.status, filters.excludeStatus))
		return false;
	if (
		filters.excludePriority?.length &&
		matchesSingle(task.priority, filters.excludePriority)
	)
		return false;
	if (
		filters.excludeTaskType?.length &&
		matchesSingle(task.taskType, filters.excludeTaskType)
	)
		return false;
	if (
		filters.excludeLabels?.length &&
		matchesLabels(task.labels, filters.excludeLabels, context.taxonomies.label)
	)
		return false;

	if (filters.excludeAssignee && filters.excludeAssignee.length > 0) {
		const excluded = resolvePeople(filters.excludeAssignee, context);
		const wantsNone = filters.excludeAssignee.includes(NONE);
		if (task.assignee == null) {
			if (wantsNone) return false;
		} else if (excluded.includes(task.assignee)) {
			return false;
		}
	}

	if (filters.excludeMentions && filters.excludeMentions.length > 0) {
		const excluded = resolvePeople(filters.excludeMentions, context);
		if (task.mentions.some((id) => excluded.includes(id))) return false;
	}

	if (
		filters.excludeProject?.length &&
		matchesProject(task.project, filters.excludeProject, context.titles)
	)
		return false;
	if (filters.excludeMilestone?.length && matchesMilestone(task.milestone, filters.excludeMilestone, context))
		return false;
	if (filters.excludeSpace?.length && matchesSpace(task.space, filters.excludeSpace)) return false;
	if (filters.excludeParent?.length && matchesLink(task.parent, filters.excludeParent))
		return false;
	if (filters.excludeId?.length && matchesId(task.path, filters.excludeId)) return false;
	if (filters.excludeBlocks?.length && matchesTaskLinks(task.relations.blocks, filters.excludeBlocks))
		return false;
	if (filters.excludeBlockedBy?.length && matchesTaskLinks(task.relations.blockedBy, filters.excludeBlockedBy, context))
		return false;
	if (filters.excludeRelated?.length && matchesTaskLinks(task.relations.related, filters.excludeRelated))
		return false;

	if (filters.excludeDueDate?.length && matchesDateExact(task.dueDate, filters.excludeDueDate))
		return false;
	if (
		filters.excludeStartDate?.length &&
		matchesDateExact(task.startDate, filters.excludeStartDate)
	)
		return false;
	if (
		filters.excludeCreatedAt?.length &&
		matchesDateExact(task.createdAt, filters.excludeCreatedAt)
	)
		return false;
	if (
		filters.excludeUpdatedAt?.length &&
		matchesDateExact(task.updatedAt, filters.excludeUpdatedAt)
	)
		return false;
	if (filters.excludeStartedAt?.length && matchesDateExact(task.startedAt, filters.excludeStartedAt)) return false;
	for (const field of LINKED_DATE_FIELD_KEYS) {
		const excluded = filters[linkedDateExcludeKey(field)];
		if (excluded?.length && matchesDateExact(linkedDate(task, field, context), excluded)) return false;
	}
	if (
		filters.excludeCompletedAt?.length &&
		matchesDateExact(task.completedAt, filters.excludeCompletedAt)
	)
		return false;

	if (filters.text && filters.text.trim()) {
		const needle = filters.text.trim().toLowerCase();
		const haystack = `${task.title} ${task.id}`.toLowerCase();
		if (!haystack.includes(needle)) return false;
	}

	for (const field of LINKED_NAME_FIELD_KEYS) {
		const needle = filters[field]?.trim().toLowerCase();
		if (needle && !linkedNames(task, field, context).some((name) => name.toLowerCase().includes(needle))) return false;
	}

	return true;
}

/**
 * Build one reachable-path `Set` per distinct root value, so membership
 * checks become a `Set.has()` lookup per task instead of a fresh
 * `relationScope` walk per (root × task) pair.
 */
function buildRootScopeSets(
	roots: string[],
	scope: HierarchyScope,
): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const root of roots) {
		if (out.has(root)) continue;
		const rootTask = scope.tasks.find((t) => linksMatch(t.path, root));
		const paths = new Set<string>();
		paths.add(rootTask ? rootTask.path : root);
		for (const task of relationScope(scope, root)) paths.add(task.path);
		out.set(root, paths);
	}
	return out;
}

/** Does `task.path` fall inside any of these precomputed root scopes? */
function inAnyScope(task: Task, scopeSets: Map<string, Set<string>>): boolean {
	for (const paths of scopeSets.values()) {
		if (paths.has(task.path)) return true;
	}
	return false;
}

export function applyFilters(
	tasks: Task[],
	filters: ViewFilters,
	context: ViewContext,
): Task[] {
	const scope = context.scope;
	if (!scope || !(filters.root?.length || filters.excludeRoot?.length)) {
		return tasks.filter((task) => matchesFilters(task, filters, context));
	}

	const included = filters.root?.length
		? buildRootScopeSets(filters.root, scope)
		: null;
	const excluded = filters.excludeRoot?.length
		? buildRootScopeSets(filters.excludeRoot, scope)
		: null;

	const pool = tasks.filter((task) => {
		if (included && !inAnyScope(task, included)) return false;
		if (excluded && inAnyScope(task, excluded)) return false;
		return true;
	});
	return pool.filter((task) => matchesFilters(task, filters, context));
}

/* ------------------------------------------------------- canonicalisation -- */

/**
 * The array-valued filter fields, in the order canonical filters emit them.
 *
 * Typed as a `Record` key list rather than a bare array so that removing a
 * field from `ViewFilters` surfaces here as a type error instead of leaving a
 * silently-dead entry behind.
 */
export type ArrayFilterKey = Exclude<
	keyof ViewFilters,
	| "text"
	| "archived"
	| "openOnly"
	| "unscheduled"
	| "recurring"
	| "hasChecklist"
	| "checklistOpen"
	| "checklist"
	| "custom"
	| "dueDateBefore"
	| "dueDateAfter"
	| "startDateBefore"
	| "startDateAfter"
	| "createdAtBefore"
	| "createdAtAfter"
	| "updatedAtBefore"
	| "updatedAtAfter"
	| "startedAtBefore"
	| "startedAtAfter"
	| "completedAtBefore"
	| "completedAtAfter"
	| "excludeStatus"
	| "excludePriority"
	| "excludeTaskType"
	| "excludeLabels"
	| "excludeAssignee"
	| "excludeMentions"
	| "excludeProject"
	| "excludeMilestone"
	| "excludeSpace"
	| "excludeParent"
	| "excludeRoot"
	| "excludeId"
	| "excludeBlocks"
	| "excludeBlockedBy"
	| "excludeRelated"
	| "excludeDueDate"
	| "excludeStartDate"
	| "excludeCreatedAt"
	| "excludeUpdatedAt"
	| "excludeStartedAt"
	| "excludeCompletedAt"
	| LinkedDateBoundKey
	| LinkedDateExcludeKey
	| LinkedFolderExcludeKey
	| LinkedNameField
>;

export const FILTER_ARRAY_FIELDS: readonly ArrayFilterKey[] = [
	"status",
	"priority",
	"taskType",
	"labels",
	"assignee",
	"mentions",
	"project",
	"milestone",
	"space",
	"parent",
	"root",
	"id",
	"blocks",
	"blockedBy",
	"related",
	"dueDate",
	"startDate",
	"createdAt",
	"updatedAt",
	"startedAt",
	"completedAt",
	...LINKED_DATE_FIELD_KEYS,
	...LINKED_FOLDER_FIELD_KEYS,
];

/** The 19 `ViewFilters` property names that hold excluded values. */
export type ExcludeFilterKey =
	| "excludeStatus"
	| "excludePriority"
	| "excludeTaskType"
	| "excludeLabels"
	| "excludeAssignee"
	| "excludeMentions"
	| "excludeProject"
	| "excludeMilestone"
	| "excludeSpace"
	| "excludeParent"
	| "excludeRoot"
	| "excludeId"
	| "excludeBlocks"
	| "excludeBlockedBy"
	| "excludeRelated"
	| "excludeDueDate"
	| "excludeStartDate"
	| "excludeCreatedAt"
	| "excludeUpdatedAt"
	| "excludeStartedAt"
	| "excludeCompletedAt"
	| LinkedDateExcludeKey
	| LinkedFolderExcludeKey;

/**
 * `ArrayFilterKey` → the `ViewFilters` property holding its excluded
 * values. One exhaustive table (like `FILTER_FIELDS` in grammar.ts) so a
 * new filterable field can't silently skip exclusion support - adding it
 * to `ArrayFilterKey` forces an entry here too.
 */
export const EXCLUDE_FIELD_KEY: Record<ArrayFilterKey, ExcludeFilterKey> = {
	status: "excludeStatus",
	priority: "excludePriority",
	taskType: "excludeTaskType",
	labels: "excludeLabels",
	assignee: "excludeAssignee",
	mentions: "excludeMentions",
	project: "excludeProject",
	milestone: "excludeMilestone",
	space: "excludeSpace",
	parent: "excludeParent",
	root: "excludeRoot",
	id: "excludeId",
	blocks: "excludeBlocks",
	blockedBy: "excludeBlockedBy",
	related: "excludeRelated",
	dueDate: "excludeDueDate",
	startDate: "excludeStartDate",
	createdAt: "excludeCreatedAt",
	updatedAt: "excludeUpdatedAt",
	startedAt: "excludeStartedAt",
	completedAt: "excludeCompletedAt",
	...(Object.fromEntries(LINKED_DATE_FIELD_KEYS.map((field) => [field, linkedDateExcludeKey(field)])) as Record<LinkedDateField, LinkedDateExcludeKey>),
	...(Object.fromEntries(LINKED_FOLDER_FIELD_KEYS.map((field) => [field, linkedFolderExcludeKey(field)])) as Record<LinkedFolderField, LinkedFolderExcludeKey>),
};

export const EXCLUDE_ARRAY_FIELDS: readonly ExcludeFilterKey[] =
	Object.values(EXCLUDE_FIELD_KEY);

/**
 * One filter set, one representation.
 *
 * `matchesFilters` already treats an empty array, a blank `text`, and a `false`
 * boolean as no-ops, so canonical form simply drops them - and fixes key order,
 * which is what lets equality be a `JSON.stringify` comparison.
 *
 * Values are de-duplicated but deliberately **not sorted**: the query bar
 * re-prints its text from these arrays, so sorting would reorder the user's
 * tokens under their cursor and shuffle the chip row on every click.
 * First-occurrence dedup is idempotent, which is all canonicity needs here.
 */
export function canonicalizeFilters(filters: ViewFilters): ViewFilters {
	const out: ViewFilters = {};

	for (const key of FILTER_ARRAY_FIELDS) {
		const values = filters[key];
		if (!values || values.length === 0) continue;
		const deduped: string[] = [];
		for (const value of values) {
			if (!deduped.includes(value)) deduped.push(value);
		}
		out[key] = deduped;
	}

	for (const key of EXCLUDE_ARRAY_FIELDS) {
		const values = filters[key];
		if (!values || values.length === 0) continue;
		// `NONE` first: it's printed on its own as `x:any`, ahead of the
		// field's `-x:` clause (print.ts), so it reads back in that order.
		const deduped: string[] = values.includes(NONE) ? [NONE] : [];
		for (const value of values) {
			if (!deduped.includes(value)) deduped.push(value);
		}
		out[key] = deduped;
	}

	// Custom field clauses: kept in order, the same clause once.
	if (filters.custom?.length) {
		const seen = new Set<string>();
		// An excluded clause that also excludes "no value" is two clauses:
		// `custom.x:any` (printed as such) and the rest -- the same test, as
		// excluding either fails the task.
		const split = filters.custom.flatMap((clause) => {
			if (!clause.exclude || clause.matches.length < 2 || !clause.matches.some((match) => match.op === "unset")) return [clause];
			return [
				{ ...clause, matches: [{ op: "unset" as const }] },
				{ ...clause, matches: clause.matches.filter((match) => match.op !== "unset") },
			];
		});
		const custom = split.filter((clause) => {
			const id = JSON.stringify([clause.field.toUpperCase(), Boolean(clause.exclude), clause.matches]);
			if (seen.has(id) || clause.matches.length === 0) return false;
			seen.add(id);
			return true;
		});
		if (custom.length > 0) out.custom = custom.map((clause) => ({ field: clause.field, matches: clause.matches, ...(clause.exclude ? { exclude: true } : {}) }));
	}

	const text = filters.text?.trim();
	if (text) out.text = text;
	for (const field of LINKED_NAME_FIELD_KEYS) {
		const name = filters[field]?.trim();
		if (name) out[field] = name;
	}
	if (filters.archived) out.archived = filters.archived;
	if (filters.openOnly) out.openOnly = true;
	if (filters.unscheduled) out.unscheduled = true;
	if (filters.recurring) out.recurring = true;
	// `checklist:` values in the order typed, each once (names compared as
	// checklistNameKey does). The older `has:checklist` / `is:checklist-open`
	// flags fold in: on their own they're `checklist:any` / `checklist:open`;
	// beside other checklist values they added nothing those didn't (each of
	// those flags was implied by them), so they go.
	const checklist = [...(filters.checklist ?? [])];
	if (checklist.length === 0 && filters.checklistOpen) checklist.push(CHECKLIST_OPEN);
	else if (checklist.length === 0 && filters.hasChecklist) checklist.push(ANY);
	if (checklist.length) {
		const seen = new Set<string>();
		const values = checklist
			.map((value) => (isChecklistKeyword(value) ? value : value.trim()))
			.filter((value) => {
				const key = isChecklistKeyword(value) ? value : checklistNameKey(value);
				if (!key || seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		if (values.length > 0) out.checklist = values;
	}

	if (filters.dueDateBefore) out.dueDateBefore = filters.dueDateBefore;
	if (filters.dueDateAfter) out.dueDateAfter = filters.dueDateAfter;
	if (filters.startDateBefore) out.startDateBefore = filters.startDateBefore;
	if (filters.startDateAfter) out.startDateAfter = filters.startDateAfter;
	if (filters.createdAtBefore) out.createdAtBefore = filters.createdAtBefore;
	if (filters.createdAtAfter) out.createdAtAfter = filters.createdAtAfter;
	if (filters.updatedAtBefore) out.updatedAtBefore = filters.updatedAtBefore;
	if (filters.updatedAtAfter) out.updatedAtAfter = filters.updatedAtAfter;
	for (const field of LINKED_DATE_FIELD_KEYS) {
		for (const bound of [`${field}Before`, `${field}After`] as const) {
			if (filters[bound]) out[bound] = filters[bound];
		}
	}
	if (filters.startedAtBefore) out.startedAtBefore = filters.startedAtBefore;
	if (filters.startedAtAfter) out.startedAtAfter = filters.startedAtAfter;
	if (filters.completedAtBefore) out.completedAtBefore = filters.completedAtBefore;
	if (filters.completedAtAfter) out.completedAtAfter = filters.completedAtAfter;

	return out;
}

export function filtersEqual(a: ViewFilters, b: ViewFilters): boolean {
	return (
		JSON.stringify(canonicalizeFilters(a)) ===
		JSON.stringify(canonicalizeFilters(b))
	);
}

/**
 * One hidden-fields set, one representation: deduped and reordered into
 * `TASK_FIELDS` order so equality is a `JSON.stringify` comparison.
 *
 * Filter values stay unsorted (the query bar re-prints them under the user's
 * cursor), but a field checklist has no such concern - a fixed order also keeps
 * a view's note diff stable when the same set is toggled in a different sequence.
 */
export function canonicalizeHiddenFields(
	fields: readonly (TaskField | CustomFieldRef)[] | undefined,
): Array<TaskField | CustomFieldRef> {
	const set = new Set<string>(fields ?? []);
	// Custom fields (`field:<key>`) after the built-in ones, in the order met.
	const custom = [...new Set((fields ?? []).filter(isCustomFieldRef))];
	return [...TASK_FIELDS.filter((field) => set.has(field)), ...custom];
}

/**
 * One table-sort set, one representation: deduped by field, first occurrence
 * wins. Unlike `canonicalizeHiddenFields`, order is meaningful (index 0 is the
 * primary key) so it's preserved in encounter order rather than sorted into
 * `TASK_FIELDS`/`SortField` canonical order.
 */
export function canonicalizeTableSort(
	sorts: readonly TableSortKey[] | undefined,
): TableSortKey[] {
	const seen = new Set<SortField>();
	const out: TableSortKey[] = [];
	for (const key of sorts ?? []) {
		if (seen.has(key.field)) continue;
		seen.add(key.field);
		out.push(key);
	}
	return out;
}

export function canonicalizeHiddenRelationKinds(
	kinds: readonly CanvasRelationKind[] | undefined,
): CanvasRelationKind[] {
	const set = new Set(kinds ?? []);
	return CANVAS_RELATION_KINDS.filter((kind) => set.has(kind));
}

/**
 * The hidden-field set a view's rows and cards should actually render with -
 * the user's own choices plus anything the view's filters make redundant.
 *
 * Today that's the project chip inside a view already scoped to one project:
 * repeating the same project name on every row is noise, and the alternative
 * (seeding `project` into every existing view's `hiddenFields` on upgrade)
 * would be a migration that also takes the choice away from the user. This
 * suppression is presentation-only - it never touches the saved view, so
 * toggling the filter off brings the chip straight back, and the Fields
 * control still shows the field as "shown" because that's what's saved.
 */
export function renderedHiddenFields(
	view: Pick<SavedView, "filters" | "hiddenFields">,
): Array<TaskField | CustomFieldRef> {
	const hidden = [...view.hiddenFields];
	// Same for a view of one milestone (a milestone's own page).
	for (const field of ["project", "milestone"] as const) {
		if ((view.filters[field] ?? []).length === 1 && !hidden.includes(field)) hidden.push(field);
	}
	return hidden;
}

/** Strip a view down to what it *is*, dropping identity and column furniture. */
export function viewDefinition(view: SavedView): ViewDefinition {
	return {
		filters: view.filters,
		viewType: view.viewType,
		groupBy: view.groupBy,
		sortBy: view.sortBy,
		sortDirection: view.sortDirection,
		emptyColumnBehavior: view.emptyColumnBehavior,
		hiddenFields: view.hiddenFields,
		subtaskDisplay: view.subtaskDisplay,
		calendarDateField: view.calendarDateField,
		calendarEndField: view.calendarEndField,
		calendarMode: view.calendarMode,
		canvasArrangement: view.canvasArrangement,
		timelineZoom: view.timelineZoom,
		canvasDirection: view.canvasDirection,
		canvasHiddenRelationKinds: view.canvasHiddenRelationKinds,
		recurringPreview: view.recurringPreview,
		tableSort: view.tableSort,
	};
}

export function canonicalizeDefinition(
	definition: ViewDefinition,
): ViewDefinition {
	return {
		filters: canonicalizeFilters(definition.filters),
		viewType: definition.viewType,
		groupBy: definition.groupBy,
		sortBy: definition.sortBy,
		sortDirection: definition.sortDirection,
		emptyColumnBehavior: definition.emptyColumnBehavior,
		hiddenFields: canonicalizeHiddenFields(definition.hiddenFields),
		subtaskDisplay: definition.subtaskDisplay,
		calendarDateField: definition.calendarDateField,
		// A second date equal to the first is just one date.
		calendarEndField:
			definition.calendarEndField && definition.calendarEndField !== definition.calendarDateField
				? definition.calendarEndField
				: null,
		calendarMode: definition.calendarMode ?? DEFAULT_DEFINITION.calendarMode,
		// Canvas arrangement/direction resolve to their defaults when absent -
		// a pre-arrangement view note carries neither, and canonical canonicity
		// (the round-trip invariant) needs those as explicit values.
		canvasArrangement:
			definition.canvasArrangement ?? DEFAULT_DEFINITION.canvasArrangement,
		timelineZoom: definition.timelineZoom ?? DEFAULT_DEFINITION.timelineZoom,
		canvasDirection:
			definition.canvasDirection ?? DEFAULT_DEFINITION.canvasDirection,
		// A *hidden* list, like `hiddenFields` - absent or empty means "show all
		// three", so canonicalizing to `[]` when unset introduces no second
		// meaning for "unset" between the Phase 3 toolbar and the query language.
		canvasHiddenRelationKinds: canonicalizeHiddenRelationKinds(
			definition.canvasHiddenRelationKinds,
		),
		recurringPreview: definition.recurringPreview,
		tableSort: canonicalizeTableSort(definition.tableSort),
	};
}

export function definitionsEqual(a: ViewDefinition, b: ViewDefinition): boolean {
	return (
		JSON.stringify(canonicalizeDefinition(a)) ===
		JSON.stringify(canonicalizeDefinition(b))
	);
}

/** True when a view would show everything - used to label the empty state. */
export function isEmptyFilterSet(filters: ViewFilters): boolean {
	return (
		!filters.status?.length &&
		!filters.priority?.length &&
		!filters.taskType?.length &&
		!filters.labels?.length &&
		!filters.assignee?.length &&
		!filters.project?.length &&
		!filters.milestone?.length &&
		!filters.space?.length &&
		!filters.parent?.length &&
		!filters.root?.length &&
		!filters.excludeRoot?.length &&
		!filters.id?.length &&
		!filters.excludeId?.length &&
		!filters.blocks?.length &&
		!filters.excludeBlocks?.length &&
		!filters.blockedBy?.length &&
		!filters.excludeBlockedBy?.length &&
		!filters.related?.length &&
		!filters.excludeRelated?.length &&
		!filters.mentions?.length &&
		!filters.text?.trim() &&
		LINKED_NAME_FIELD_KEYS.every((field) => !filters[field]?.trim()) &&
		!filters.custom?.length &&
		!filters.recurring &&
		!filters.hasChecklist &&
		!filters.checklistOpen &&
		!filters.checklist?.length &&
		filters.archived !== "only" &&
		!filters.dueDate?.length &&
		!filters.startDate?.length &&
		!filters.createdAt?.length &&
		!filters.updatedAt?.length &&
		!filters.startedAt?.length &&
		!filters.completedAt?.length &&
		!filters.dueDateBefore &&
		!filters.dueDateAfter &&
		!filters.startDateBefore &&
		!filters.startDateAfter &&
		!filters.createdAtBefore &&
		!filters.createdAtAfter &&
		!filters.updatedAtBefore &&
		!filters.updatedAtAfter &&
		!filters.startedAtBefore &&
		!filters.startedAtAfter &&
		!filters.completedAtBefore &&
		!filters.completedAtAfter &&
		!filters.excludeStatus?.length &&
		!filters.excludePriority?.length &&
		!filters.excludeTaskType?.length &&
		!filters.excludeLabels?.length &&
		!filters.excludeAssignee?.length &&
		!filters.excludeMentions?.length &&
		!filters.excludeProject?.length &&
		!filters.excludeMilestone?.length &&
		!filters.excludeSpace?.length &&
		!filters.excludeParent?.length &&
		!filters.excludeDueDate?.length &&
		!filters.excludeStartDate?.length &&
		!filters.excludeCreatedAt?.length &&
		!filters.excludeUpdatedAt?.length &&
		!filters.excludeStartedAt?.length &&
		LINKED_DATE_FIELD_KEYS.every((field) => !filters[field]?.length && !filters[`${field}Before`] && !filters[`${field}After`] && !filters[linkedDateExcludeKey(field)]?.length) &&
		LINKED_FOLDER_FIELD_KEYS.every((field) => !filters[field]?.length && !filters[linkedFolderExcludeKey(field)]?.length) &&
		!filters.excludeCompletedAt?.length
	);
}
