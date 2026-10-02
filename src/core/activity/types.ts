/**
 * Activity: the record of what people (and the system) did in a workspace --
 * a task's status changing, a label being renamed, a view being shared.
 *
 * The entries themselves are written by the host app (Plan Things Better
 * records them on its server, in the same transaction as the change they
 * describe). What lives here is what both sides of that app need to agree
 * on: the vocabulary of kinds, verbs and fields an entry is made of, the
 * shape of a recorded change, and the filters the Activity page's query
 * narrows entries with.
 */

import type { ViewFilters } from "../types";

/** What an entry happened to. */
export const ACTIVITY_KINDS = [
	"task",
	"project",
	"view",
	"dashboard",
	"label",
	"status",
	"priority",
	"taskType",
	"member",
	"workspace",
	"doc",
	"docStatus",
	"folder",
	"space",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * What happened. `delete` is "deleted forever" -- moving something to the
 * Trash is `trash`. `share` is a private view, dashboard or doc made
 * visible to everyone in its place; `unshare` is one made private again.
 */
export const ACTIVITY_VERBS = [
	"create",
	"update",
	"comment",
	"trash",
	"restore",
	"delete",
	"share",
	"unshare",
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

/**
 * Every field an `update` entry can name. Deliberately a closed list: only
 * what reads as something a person did is recorded -- never bookkeeping
 * that changes on every save (`rank`, `updatedAt`), or values derived from
 * another field (`completedAt` from `status`, `mentions` from the
 * description).
 *
 * `memberStatus` is a membership's own invited/active/removed state, named
 * apart from a task's `status` so a query on one never matches the other.
 *
 * A dashboard's: `charts` (the list, for charts added and removed), `chart`
 * (the charts edited -- retitled, a different kind or data), `chartLayout`
 * (moved or resized, recorded without values) and `filter` (its query
 * text, before and after).
 *
 * A doc's: `body` (recorded without values, like `description`),
 * `docType`, `docStatus` (named apart from a task's `status`, since doc
 * statuses are their own list), `parentDoc` (moved in the tree) and `task`
 * (the task it's attached to).
 *
 * A table doc's (a small database): `rows` (the list, for rows added and
 * removed), `cell` (one row's value in one column -- the change names the
 * row and the column), `columns` (the list, for columns added and
 * removed), `column` (a column renamed, given another type or options) and
 * `tableViews` (its saved views, added, removed or changed).
 *
 * Folders: `folder` (a project, view, dashboard or label moved into another
 * folder, or out of any) and `parentFolder` (a folder moved inside another).
 *
 * Spaces: `space` (anything moved into a Space, or out to the whole
 * workspace), and a Space's own `people` (who was added or removed) and
 * `visibility` (open to every member, or private to the people added).
 */
export const ACTIVITY_FIELDS = [
	"title",
	"name",
	"description",
	"status",
	"priority",
	"taskType",
	"labels",
	"assignee",
	"project",
	"parentTask",
	"dueDate",
	"startDate",
	"archived",
	"blocks",
	"blockedBy",
	"related",
	"icon",
	"color",
	"category",
	"editAccess",
	"role",
	"memberStatus",
	"idPrefix",
	"slug",
	"newTaskPlacement",
	"defaultNewTaskStatus",
	"defaultNewTaskType",
	"trashRetentionDays",
	"charts",
	"chart",
	"chartLayout",
	"filter",
	"body",
	"docType",
	"docStatus",
	"parentDoc",
	"task",
	"defaultNewDocStatus",
	"rows",
	"cell",
	"columns",
	"column",
	"tableViews",
	"folder",
	"parentFolder",
	"space",
	"people",
	"visibility",
	// A workspace's plan and its subscription's state (PTB's billing).
	"plan",
	"subscriptionStatus",
	// A task hidden from the workspace's guests.
	"internal",
	// Who a view, dashboard or doc belongs to -- its "Only me" when private.
	"owner",
] as const;
export type ActivityField = (typeof ACTIVITY_FIELDS)[number];

/**
 * Something an entry pointed at, as it was when the entry was written: its
 * id, plus the name (and color) it had then -- so an entry still reads
 * "moved from Backlog" after Backlog is renamed or deleted. Readers show
 * the current name while the id still resolves, and this one after.
 */
export interface ActivityRef {
	id: string;
	name: string;
	color?: string;
}

/**
 * A recorded value: a plain scalar, a reference, or -- for a list field like
 * `labels` -- the whole list, before and after. Added/removed are derived
 * from the two lists (`activityListDelta`), which is also what lets several
 * quick edits merge into one entry: keep the first `from`, take the last
 * `to`.
 */
export type ActivityValue = string | number | boolean | null | ActivityRef | ActivityRef[];

/**
 * One field's change. `description` records neither side (the entry says
 * the description changed, not what to), so both are optional.
 */
export interface ActivityChange {
	field: ActivityField;
	from?: ActivityValue;
	to?: ActivityValue;
	/** A table's `cell`: the row it's in, as it was named then. */
	row?: ActivityRef;
	/** A table's `cell`: its column's name then. */
	column?: string;
}

/** What the Activity page's query narrows entries with, beyond the task
 *  clauses (`ActivityQuery.items`). Each list is OR'd within itself and
 *  AND'd with the rest; a `not…` list excludes. */
export interface ActivityFilters {
	/** Who acted: user ids, `SELF`, or `NONE` for the system. */
	by?: string[];
	notBy?: string[];
	action?: ActivityVerb[];
	notAction?: ActivityVerb[];
	field?: ActivityField[];
	notField?: ActivityField[];
	kind?: ActivityKind[];
	notKind?: ActivityKind[];
	/** Values `field` changed to / from -- ids for a reference field, a
	 *  `YYYY-MM-DD` for a date. Only meaningful with exactly one `field`. */
	to?: string[];
	from?: string[];
	/** Calendar-day bounds, exclusive -- the same rule as `due-after:`. */
	after?: string;
	before?: string;
}

/**
 * A whole Activity query: `items` is an ordinary task filter set (the same
 * clauses every task view uses) choosing *whose* activity to show, matched
 * against each task as it is now; `activity` describes the events
 * themselves.
 */
export interface ActivityQuery {
	items: ViewFilters;
	activity: ActivityFilters;
}
