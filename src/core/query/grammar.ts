/**
 * The query language's vocabulary - pure data, no logic.
 *
 * Every table here is keyed by a model type (`Record<ArrayFilterKey, …>`,
 * `Record<GroupByField, …>`) rather than written as a free-standing literal.
 * That makes them exhaustive: dropping a field from `ViewFilters` or a member
 * from `GroupByField` surfaces as a type error pointing at the exact entry to
 * delete, instead of leaving a silently-dead token behind.
 *
 * One form everywhere (T-0728): a field is `field:value`, lowercase, with
 * dashes between words (`started-before`, `blocked-by`). A plain field is the
 * item's own; a field of a linked item is `{kind}.{field}`
 * (`milestone.target-before:`, `project.name:`), and `{kind}:` on its own is
 * that item (`project:P-0003`, short for `project.key:`). Every kind has a
 * `.key` and a `.name` (`.title` reads as it). Since a task query is about
 * tasks, `task.` in front of any field is the task's own (`task.status:` is
 * `status:`). Every spelling printed before this stays an alias, so stored
 * queries keep their meaning.
 */

import type {
	CalendarDateField,
	CalendarMode,
	CanvasArrangement,
	TimelineZoom,
	CanvasDirection,
	CanvasRelationKind,
	EmptyColumnBehavior,
	BuiltInGroupByField,
	SortField,
	SubtaskDisplay,
	TaskField,
	ViewType,
} from "../types";
import type { ArrayFilterKey } from "../views/filter";
import {
	LINKED_DATE_FIELDS,
	LINKED_DATE_FIELD_KEYS,
	type LinkedDateBoundKey,
	type LinkedDateField,
	type LinkedNameField,
} from "../types";

/** What kind of thing a filter field's values name. */
export type ResolveAs =
	| "status"
	| "priority"
	| "taskType"
	| "label"
	| "person"
	| "project"
	| "milestone"
	| "space"
	| "task"
	| "date";

export interface FilterFieldSpec {
	/** The canonical token - what the printer emits. */
	token: string;
	/** Extra spellings accepted on input. */
	aliases: readonly string[];
	resolveAs: ResolveAs;
	/**
	 * `unset` parses everywhere it's syntactically legal, but for these fields
	 * it can never match - `Task.status` is non-nullable, and `matchesFilters`
	 * gives `mentions` no NONE branch. Parsed, then warned about.
	 */
	unsetIsVacuous: boolean;
}

export const FILTER_FIELDS: Record<ArrayFilterKey, FilterFieldSpec> = {
	status: {
		token: "status",
		aliases: ["state"],
		resolveAs: "status",
		unsetIsVacuous: true,
	},
	priority: {
		token: "priority",
		aliases: ["p"],
		resolveAs: "priority",
		unsetIsVacuous: false,
	},
	taskType: {
		token: "type",
		aliases: ["tasktype", "kind"],
		resolveAs: "taskType",
		unsetIsVacuous: false,
	},
	labels: {
		token: "label",
		aliases: ["labels", "tag", "tags", "label.key"],
		resolveAs: "label",
		unsetIsVacuous: false,
	},
	assignee: {
		token: "assignee",
		aliases: ["assigned", "owner", "assignee.key"],
		resolveAs: "person",
		unsetIsVacuous: false,
	},
	mentions: {
		token: "mentions",
		aliases: ["mention"],
		resolveAs: "person",
		unsetIsVacuous: true,
	},
	// `project`/`parent`/`root`/`task` print an item's stable key (see
	// `print.ts`'s entity branch), never its renameable name; a name still
	// works on input. `projectKey`/`taskParentKey`/`taskRootKey`/`taskKey`
	// were printed before T-0728 and stay aliases, as does `{kind}.key`.
	project: {
		token: "project",
		aliases: ["projectkey", "project.key"],
		resolveAs: "project",
		unsetIsVacuous: false,
	},
	// Printed as the milestone's key ("PRD-R0030"); its title works on input.
	milestone: {
		token: "milestone",
		aliases: ["milestonekey", "ms", "milestone.key"],
		resolveAs: "milestone",
		unsetIsVacuous: false,
	},
	// Printed as the Space's key ("S-0003"); its name works on input.
	// `space:unset` is workspace-wide.
	space: {
		token: "space",
		aliases: ["spacekey", "space.key"],
		resolveAs: "space",
		unsetIsVacuous: false,
	},
	parent: {
		token: "parent",
		aliases: ["taskparentkey", "subtaskof", "parent.key"],
		resolveAs: "task",
		unsetIsVacuous: false,
	},
	root: {
		token: "root",
		aliases: ["taskrootkey", "root.key"],
		resolveAs: "task",
		unsetIsVacuous: false,
	},
	// No collision with `sort:id` (SORT_VALUES, above): that spelling is
	// always prefixed, so a bare field token only ever means a filter.
	id: {
		token: "task",
		aliases: ["taskkey", "id", "task.key"],
		resolveAs: "task",
		unsetIsVacuous: true,
	},
	// Plain membership on a task's own blocks/blockedBy/related array (see
	// matchesTaskLinks in views/filter.ts) -- not root's transitive scope.
	// `blockedBy`/`blocks` name which array is checked, not which direction
	// reads naturally as a sentence; PTB's own UI labels them "Blocked
	// Task"/"Blocking Task" for that reason (see FilterControls.tsx).
	blocks: {
		token: "blocks",
		aliases: ["blockstaskkey"],
		resolveAs: "task",
		unsetIsVacuous: false,
	},
	blockedBy: {
		token: "blocked-by",
		aliases: ["blockedbytaskkey", "blockedby"],
		resolveAs: "task",
		unsetIsVacuous: false,
	},
	related: {
		token: "related",
		aliases: ["relatedtaskkey"],
		resolveAs: "task",
		unsetIsVacuous: false,
	},
	dueDate: {
		token: "due",
		aliases: ["duedate", "due-date"],
		resolveAs: "date",
		unsetIsVacuous: false,
	},
	startDate: {
		token: "start",
		aliases: ["startdate", "start-date"],
		resolveAs: "date",
		unsetIsVacuous: false,
	},
	createdAt: {
		token: "created",
		aliases: ["createdat", "created-at"],
		resolveAs: "date",
		unsetIsVacuous: true,
	},
	updatedAt: {
		token: "updated",
		aliases: ["updatedat", "updated-at"],
		resolveAs: "date",
		unsetIsVacuous: true,
	},
	// When work began (`Task.startedAt`): `started:unset` is never started.
	// Printed `taskStarted:` before T-0728; a milestone's own start is
	// `milestone.start:`, so the plain word is the task's again.
	startedAt: {
		token: "started",
		aliases: ["taskstarted", "startedat", "started-at"],
		resolveAs: "date",
		unsetIsVacuous: false,
	},
	completedAt: {
		token: "completed",
		aliases: ["completedat", "completed-at"],
		resolveAs: "date",
		unsetIsVacuous: false,
	},
	// A task's milestone's and project's dates (LINKED_DATE_FIELDS in types.ts):
	// `milestone.target:2026-10-20`, `project.due:unset`. The camelCase
	// (`milestoneTarget:`, printed before T-0728) and dashed
	// (`milestone-target:`) spellings stay aliases.
	...(Object.fromEntries(
		LINKED_DATE_FIELD_KEYS.map((field) => [
			field,
			{ token: linkedDateToken(field), aliases: [field.toLowerCase(), kebab(field)], resolveAs: "date", unsetIsVacuous: false } satisfies FilterFieldSpec,
		]),
	) as unknown as Record<LinkedDateField, FilterFieldSpec>),
};

/** `milestoneTarget` -> `milestone-target`. */
function kebab(token: string): string {
	return token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** `milestoneTarget` -> `milestone.target`, `projectDue` -> `project.due`:
 *  the linked kind, then its field. */
function linkedDateToken(field: LinkedDateField): string {
	const of = LINKED_DATE_FIELDS[field].of;
	return `${of}.${kebab(field.slice(of.length)).replace(/^-/, "")}`;
}

/** The free-text field (a task's name). Not in `FILTER_FIELDS` - its value
 *  isn't a list. Printed as `name:` -- always labelled, never bare words,
 *  though bare words still parse as it. Every kind's display name is
 *  `.name` (T-0728), even where it's stored as a title; `taskTitle:`
 *  (printed before that), `title`, `text` and `search` stay aliases so
 *  nothing already typed or saved breaks. */
export const TEXT_FIELD = { token: "name", aliases: ["tasktitle", "title", "text", "search", "task.name", "task.title"] };

/**
 * A linked item's name, as free text: `project.name:web`, tasks whose
 * project's name contains "web" (LINKED_NAME_FIELDS in types.ts). Each kind's
 * `.title` reads as its `.name`.
 */
export const LINKED_NAME_TOKENS: Record<LinkedNameField, EnumValueSpec> = {
	projectName: { token: "project.name", aliases: ["project.title"] },
	milestoneName: { token: "milestone.name", aliases: ["milestone.title"] },
	spaceName: { token: "space.name", aliases: ["space.title"] },
	labelName: { token: "label.name", aliases: ["label.title"] },
	assigneeName: { token: "assignee.name", aliases: ["assignee.title"] },
};

/**
 * The kinds a query can be about (`kind:`). A task query (a view, a
 * dashboard filter, Activity's task clauses) is about tasks, so `kind:task`
 * is what it already is and any other kind isn't expressible there. Before
 * T-0728 `kind:` was a spelling of a task's `type:`; a value that isn't one
 * of these still reads that way, so nothing typed before means less now.
 */
export const RESULT_KINDS = [
	"task",
	"project",
	"milestone",
	"doc",
	"view",
	"dashboard",
	"label",
	"space",
	"member",
	"channel",
	"template",
	"form",
	"link",
	"activity",
] as const;

export const KIND_FIELD = "kind";

/**
 * A field as the parser looks it up: lowercase, and with a leading `task.`
 * dropped, since a task query's own fields are the task's -- `task.status:`
 * is `status:`, `task.custom.points:` is `custom.points:`. `task.key`,
 * `task.name` and `task.title` keep it (they're spellings of their own).
 */
export function selfField(field: string): string {
	const lowered = field.toLowerCase();
	if (!lowered.startsWith("task.")) return lowered;
	const rest = lowered.slice("task.".length);
	return rest === "key" || rest === "name" || rest === "title" || rest === "" ? lowered : rest;
}

export interface EnumValueSpec {
	token: string;
	aliases: readonly string[];
}

export const GROUP_VALUES: Record<BuiltInGroupByField, EnumValueSpec> = {
	none: { token: "none", aliases: [] },
	status: { token: "status", aliases: [] },
	priority: { token: "priority", aliases: [] },
	taskType: { token: "type", aliases: ["tasktype", "kind"] },
	assignee: { token: "assignee", aliases: ["owner"] },
	label: { token: "label", aliases: ["labels", "tag", "tags"] },
	project: { token: "project", aliases: [] },
	milestone: { token: "milestone", aliases: ["ms"] },
};

export const SORT_VALUES: Record<SortField, EnumValueSpec> = {
	rank: { token: "rank", aliases: ["manual"] },
	priority: { token: "priority", aliases: [] },
	status: { token: "status", aliases: [] },
	title: { token: "name", aliases: ["title", "task.name"] },
	id: { token: "id", aliases: [] },
	dueDate: { token: "due", aliases: ["duedate"] },
	startDate: { token: "start", aliases: ["startdate"] },
	estimate: { token: "estimate", aliases: [] },
	createdAt: { token: "created", aliases: ["createdat"] },
	updatedAt: { token: "updated", aliases: ["updatedat"] },
	startedAt: { token: "started", aliases: ["taskstarted", "startedat"] },
	taskType: { token: "type", aliases: ["tasktype", "kind"] },
	project: { token: "project", aliases: [] },
	milestone: { token: "milestone", aliases: ["ms"] },
	assignee: { token: "assignee", aliases: ["owner"] },
	labels: { token: "labels", aliases: ["label", "tag", "tags"] },
	progress: { token: "progress", aliases: [] },
	relations: { token: "relations", aliases: ["rel"] },
	comments: { token: "comments", aliases: ["comment", "cmt"] },
	subtasks: { token: "subtasks", aliases: ["subtask", "children", "child"] },
};

export const LAYOUT_VALUES: Record<ViewType, EnumValueSpec> = {
	list: { token: "list", aliases: [] },
	board: { token: "board", aliases: ["kanban"] },
	table: { token: "table", aliases: [] },
	timeline: { token: "timeline", aliases: ["gantt"] },
	calendar: { token: "calendar", aliases: ["cal"] },
	canvas: { token: "canvas", aliases: [] },
	// The workspace as a graph of dots (T-0729).
	graph: { token: "graph", aliases: ["network"] },
};

/** Calendar-only: the date (or two, `date:start,due`) the calendar plots
 *  tasks by (`date:` clause). */
export const DATE_FIELD_VALUES: Record<CalendarDateField, EnumValueSpec> = {
	dueDate: { token: "due", aliases: ["duedate", "due-date"] },
	startDate: { token: "start", aliases: ["startdate", "start-date"] },
	createdAt: { token: "created", aliases: ["createdat", "created-at"] },
	updatedAt: { token: "updated", aliases: ["updatedat", "updated-at"] },
	completedAt: { token: "completed", aliases: ["completedat", "completed-at", "done"] },
};

/** Calendar-only: how time is laid out (`calendar:` clause). */
export const CALENDAR_MODE_VALUES: Record<CalendarMode, EnumValueSpec> = {
	month: { token: "month", aliases: [] },
	week: { token: "week", aliases: [] },
	"2weeks": { token: "2weeks", aliases: ["two-weeks", "fortnight"] },
	"4weeks": { token: "4weeks", aliases: ["four-weeks"] },
	schedule: { token: "schedule", aliases: ["agenda"] },
};

/**
 * Date range-bound clauses (`due-before:`, `due-after:`, …) - each token
 * names the exact `ViewFilters` scalar key it sets. Single-valued, unlike
 * the exact-match date fields above, so this is a plain token → key map
 * rather than a `FilterFieldSpec` table.
 */
export const DATE_BOUND_FIELDS: Record<
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
	| LinkedDateBoundKey,
	EnumValueSpec
> = {
	dueDateBefore: { token: "due-before", aliases: [] },
	dueDateAfter: { token: "due-after", aliases: [] },
	startDateBefore: { token: "start-before", aliases: [] },
	startDateAfter: { token: "start-after", aliases: [] },
	createdAtBefore: { token: "created-before", aliases: [] },
	createdAtAfter: { token: "created-after", aliases: [] },
	updatedAtBefore: { token: "updated-before", aliases: [] },
	updatedAtAfter: { token: "updated-after", aliases: [] },
	startedAtBefore: { token: "started-before", aliases: ["taskstartedbefore"] },
	startedAtAfter: { token: "started-after", aliases: ["taskstartedafter"] },
	completedAtBefore: { token: "completed-before", aliases: [] },
	completedAtAfter: { token: "completed-after", aliases: [] },
	// `milestone.target-before:`; `milestoneTargetBefore:` (printed before
	// T-0728) and `milestone-target-before:` stay aliases.
	...(Object.fromEntries(
		LINKED_DATE_FIELD_KEYS.flatMap((field) =>
			(["Before", "After"] as const).map((side) => [
				`${field}${side}`,
				{
					token: `${linkedDateToken(field)}-${side.toLowerCase()}`,
					aliases: [`${field}${side}`.toLowerCase(), `${kebab(field)}-${side.toLowerCase()}`],
				},
			]),
		),
	) as unknown as Record<LinkedDateBoundKey, EnumValueSpec>),
};

/** Timeline-only: the zoom level (`zoom:` clause). */
export const TIMELINE_ZOOM_VALUES: Record<TimelineZoom, EnumValueSpec> = {
	day: { token: "day", aliases: ["days"] },
	week: { token: "week", aliases: ["weeks"] },
	month: { token: "month", aliases: ["months"] },
	quarter: { token: "quarter", aliases: ["quarters"] },
	year: { token: "year", aliases: ["years"] },
	all: { token: "all", aliases: ["fit"] },
};

/** Canvas-only: the arrangement algorithm (`canvas-layout:` clause). */
export const CANVAS_LAYOUT_VALUES: Record<CanvasArrangement, EnumValueSpec> = {
	flow: { token: "flow", aliases: ["layered", "dependency"] },
	tree: { token: "tree", aliases: ["hierarchy", "hierarchical"] },
};

/** Canvas-only: which way the graph points (`canvas-direction:` clause). */
export const CANVAS_DIRECTION_VALUES: Record<CanvasDirection, EnumValueSpec> = {
	right: { token: "right", aliases: ["lr", "left-to-right", "lefttoright"] },
	down: { token: "down", aliases: ["tb", "top-to-bottom", "toptobottom"] },
};

/** Canvas-only: which relation kinds are hidden (`relations:` clause). */
export const RELATION_KIND_VALUES: Record<CanvasRelationKind, EnumValueSpec> = {
	dependency: { token: "blocks", aliases: ["dependency", "depends", "blocked"] },
	hierarchy: { token: "parent", aliases: ["hierarchy", "subtask", "child"] },
	related: { token: "related", aliases: ["rel"] },
};

export const EMPTY_VALUES: Record<EmptyColumnBehavior, EnumValueSpec> = {
	"show-normal": { token: "show-normal", aliases: ["normal", "show"] },
	"auto-collapse": { token: "auto-collapse", aliases: ["collapse"] },
	"auto-hide": { token: "auto-hide", aliases: ["hide"] },
};

/** How the view treats sub-tasks (`subtasks:` clause). */
export const SUBTASK_VALUES: Record<SubtaskDisplay, EnumValueSpec> = {
	nested: { token: "nested", aliases: ["nest", "tree", "indent"] },
	flat: { token: "flat", aliases: ["show", "loose"] },
	hidden: { token: "hidden", aliases: ["hide", "top-level", "toplevel", "root"] },
};

/** Task fields the `hide:` clause can name. Keyed for exhaustiveness. */
export const FIELD_VALUES: Record<TaskField, EnumValueSpec> = {
	type: { token: "type", aliases: ["tasktype", "kind"] },
	project: { token: "project", aliases: ["proj"] },
	milestone: { token: "milestone", aliases: ["ms"] },
	priority: { token: "priority", aliases: ["p"] },
	assignee: { token: "assignee", aliases: ["owner", "assigned"] },
	labels: { token: "labels", aliases: ["label", "tag", "tags"] },
	estimate: { token: "estimate", aliases: ["est", "points"] },
	startDate: { token: "start", aliases: ["startdate"] },
	dueDate: { token: "due", aliases: ["duedate"] },
	progress: { token: "progress", aliases: [] },
	checklists: { token: "checklists", aliases: ["checklist"] },
	relations: { token: "relations", aliases: ["rel", "relation"] },
};

/* ----------------------------------------------------------- keywords ----- */

/** Resolves to `SELF`. `self` is accepted because it's the literal stored value. */
export const SELF_KEYWORDS = ["me", "self"] as const;

/**
 * Resolves to `NONE`.
 *
 * `none` is deliberately **not** here: the default priorities include a real
 * value whose id is literally `"none"` ("No Priority"), so `priority:none` must
 * mean that value. Use `=unset` to filter on a taxonomy value actually named
 * "unset".
 */
export const UNSET_KEYWORDS = ["unset"] as const;

/**
 * Resolves to `ANY`: the field has a value (`project:any`) -- the positive
 * form of `unset`, taken by every field that takes `unset`. An array filter
 * stores it as excluding `NONE`, so `x:any` and the older `-x:unset` are the
 * same filter (printed as `x:any`), and `-x:any` is `x:unset`. `=any` is a
 * value literally named "any".
 */
export const ANY_KEYWORDS = ["any"] as const;

/** Prefix marking a value as verbatim - skip keyword and name resolution. */
export const VERBATIM_PREFIX = "=";

/* ------------------------------------------------------------- flags ------ */

export const FLAG_TOKENS = {
	archivedIncluded: { field: "show", value: "archived", aliases: [] },
	archivedOnly: { field: "show", value: "archived-only", aliases: [] },
	openOnly: { field: "is", value: "open", aliases: [] },
	unscheduled: { field: "is", value: "unscheduled", aliases: [] },
	recurring: { field: "is", value: "recurring", aliases: [] },
	recurringPreview: { field: "show", value: "recurring", aliases: [] },
} as const;

/**
 * Spellings from before `checklist:any` / `checklist:open`, still parsed so
 * saved views and links keep working; the printer writes the new ones.
 * Anything a task has or holds is `field:value` (with `unset` / `any`),
 * never `has:`, and `is:` is only for states of the whole task.
 */
export const LEGACY_CHECKLIST_FLAGS = {
	checklistOpen: { field: "is", value: "checklist-open", aliases: [] },
	hasChecklist: { field: "has", value: "checklist", aliases: ["checklists"] },
} as const;

/**
 * `checklist:` -- tasks by their checklists (`ViewFilters.checklist`):
 * `any` (has one), `unset` (has none), `open` (an unticked item in any
 * list), `done` (items, all ticked), or a list's name
 * (`checklist:"After deploy"`: a list of that name with an unticked item).
 * Names are taken as typed, not resolved against anything: a list is the
 * task's own, not a taxonomy. `=open` is a list literally named "open".
 * `-checklist:any` is `checklist:unset` and the other way round.
 */
export const CHECKLIST_FIELD = { token: "checklist", aliases: ["checklists"] } as const;

/** `checklist:`'s keywords, in the order suggestions show them. */
export const CHECKLIST_VALUES = {
	any: { token: "any", label: "Has a checklist" },
	unset: { token: "unset", label: "No checklist" },
	open: { token: "open", label: "Something left to tick" },
	done: { token: "done", label: "Every item ticked" },
} as const;

/**
 * Legacy spellings of the removed `is:top-level` flag. Still parsed - they set
 * `subtaskDisplay: "hidden"` - so a query written before the tri-state existed
 * keeps working. The printer emits `subtasks:hidden` instead.
 */
export const LEGACY_TOP_LEVEL_VALUES = ["top-level", "toplevel", "root"] as const;

/** `include:archived` reads fine; accept it as a second spelling of `show:`. */
export const FLAG_FIELD_ALIASES: Record<string, string> = { include: "show" };

/**
 * Tokens that look reasonable but name a field `ViewFilters` doesn't have.
 * `is:` and `archived:` aren't real fields; archived visibility is the `show:`
 * flag (`show:archived` to mix archived tasks in, `show:archived-only` to filter
 * to just them). Rejected with a pointer rather than silently misinterpreted.
 */
export const NOT_EXPRESSIBLE: Record<
	string,
	{ message: string; suggestion?: string }
> = {
	"is:archived": {
		message: "Use show:archived-only to filter to just archived tasks.",
		suggestion: "show:archived-only",
	},
	"archived:true": {
		message: "Use show:archived-only to filter to just archived tasks.",
		suggestion: "show:archived-only",
	},
	"archived:only": {
		message: "Use show:archived-only to filter to just archived tasks.",
		suggestion: "show:archived-only",
	},
	"is:sub-task": {
		message: "Use parent:any for sub-tasks, parent:unset for top-level tasks.",
		suggestion: "parent:any",
	},
	"is:subtask": {
		message: "Use parent:any for sub-tasks, parent:unset for top-level tasks.",
		suggestion: "parent:any",
	},
};

/* -------------------------------------------------------- lookup tables --- */

function indexBy<T extends { token: string; aliases: readonly string[] }>(
	entries: [string, T][],
): Map<string, string> {
	const out = new Map<string, string>();
	for (const [key, spec] of entries) {
		out.set(spec.token.toLowerCase(), key);
		for (const alias of spec.aliases) out.set(alias.toLowerCase(), key);
	}
	return out;
}

/** Token (or alias) → `ViewFilters` key. Includes the text field. */
export const FILTER_FIELD_BY_TOKEN: Map<string, ArrayFilterKey | "text"> =
	(() => {
		const map = indexBy(
			Object.entries(FILTER_FIELDS) as [ArrayFilterKey, FilterFieldSpec][],
		) as Map<string, ArrayFilterKey | "text">;
		// `indexBy` above lowercases every FILTER_FIELDS token/alias it
		// inserts; matching that here too (previously missing, but harmless
		// while TEXT_FIELD.token was the already-lowercase "title") -- a
		// mixed-case token like "taskTitle" would otherwise never match the
		// lexer's lowercased lookup.
		map.set(TEXT_FIELD.token.toLowerCase(), "text");
		for (const alias of TEXT_FIELD.aliases) map.set(alias.toLowerCase(), "text");
		return map;
	})();

export const GROUP_BY_TOKEN = indexBy(
	Object.entries(GROUP_VALUES) as [BuiltInGroupByField, EnumValueSpec][],
) as Map<string, BuiltInGroupByField>;

export const SORT_BY_TOKEN = indexBy(
	Object.entries(SORT_VALUES) as [SortField, EnumValueSpec][],
) as Map<string, SortField>;

export const LAYOUT_BY_TOKEN = indexBy(
	Object.entries(LAYOUT_VALUES) as [ViewType, EnumValueSpec][],
) as Map<string, ViewType>;

export const DATE_FIELD_BY_TOKEN = indexBy(
	Object.entries(DATE_FIELD_VALUES) as [CalendarDateField, EnumValueSpec][],
) as Map<string, CalendarDateField>;

export const CALENDAR_MODE_BY_TOKEN = indexBy(
	Object.entries(CALENDAR_MODE_VALUES) as [CalendarMode, EnumValueSpec][],
) as Map<string, CalendarMode>;

export const LINKED_NAME_BY_TOKEN = indexBy(
	Object.entries(LINKED_NAME_TOKENS) as [LinkedNameField, EnumValueSpec][],
) as Map<string, LinkedNameField>;

export const DATE_BOUND_FIELD_BY_TOKEN = indexBy(
	Object.entries(DATE_BOUND_FIELDS) as [
		keyof typeof DATE_BOUND_FIELDS,
		EnumValueSpec,
	][],
) as Map<string, keyof typeof DATE_BOUND_FIELDS>;

export const TIMELINE_ZOOM_BY_TOKEN = indexBy(
	Object.entries(TIMELINE_ZOOM_VALUES) as [TimelineZoom, EnumValueSpec][],
) as Map<string, TimelineZoom>;

export const CANVAS_LAYOUT_BY_TOKEN = indexBy(
	Object.entries(CANVAS_LAYOUT_VALUES) as [CanvasArrangement, EnumValueSpec][],
) as Map<string, CanvasArrangement>;

export const CANVAS_DIRECTION_BY_TOKEN = indexBy(
	Object.entries(CANVAS_DIRECTION_VALUES) as [CanvasDirection, EnumValueSpec][],
) as Map<string, CanvasDirection>;

export const RELATION_KIND_BY_TOKEN = indexBy(
	Object.entries(RELATION_KIND_VALUES) as [CanvasRelationKind, EnumValueSpec][],
) as Map<string, CanvasRelationKind>;

export const EMPTY_BY_TOKEN = indexBy(
	Object.entries(EMPTY_VALUES) as [EmptyColumnBehavior, EnumValueSpec][],
) as Map<string, EmptyColumnBehavior>;

export const SUBTASK_BY_TOKEN = indexBy(
	Object.entries(SUBTASK_VALUES) as [SubtaskDisplay, EnumValueSpec][],
) as Map<string, SubtaskDisplay>;

export const FIELD_BY_TOKEN = indexBy(
	Object.entries(FIELD_VALUES) as [TaskField, EnumValueSpec][],
) as Map<string, TaskField>;

/**
 * Clause fields that configure a view's *layout*, not its filter set. A context
 * with no layout to configure - a dashboard's `filter:` line, a workspace
 * template's dashboard `filter:` - rejects a query that uses any of them.
 */
export const LAYOUT_ONLY_CLAUSES: ReadonlySet<string> = new Set([
	"view",
	"layout",
	"group",
	"sort",
	"table-sort",
	"hide",
	"date",
	"calendar",
	"subtasks",
	"empty",
	"canvas-layout",
	"canvas-direction",
	"relations",
]);

/** Every field token the parser recognises - the pool for "did you mean…". */
export const ALL_FIELD_TOKENS: readonly string[] = [
	...FILTER_FIELD_BY_TOKEN.keys(),
	...DATE_BOUND_FIELD_BY_TOKEN.keys(),
	...LINKED_NAME_BY_TOKEN.keys(),
	KIND_FIELD,
	"zoom",
	"group",
	"sort",
	"table-sort",
	"layout",
	"empty",
	"hide",
	"date",
	"calendar",
	"subtasks",
	"canvas-layout",
	"canvas-direction",
	"relations",
	"is",
	"show",
	"include",
	CHECKLIST_FIELD.token,
	...CHECKLIST_FIELD.aliases,
];
