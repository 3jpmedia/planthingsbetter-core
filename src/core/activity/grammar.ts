/**
 * The Activity query's own clauses -- pure data, like `query/grammar.ts`.
 *
 * Every token is `activity.<field>` -- the query language's one form for a
 * field of another kind (T-0728) -- so a query reads unambiguously:
 * `status:done` is activity on tasks that are Done now, `activity.to:done`
 * is the moments something was moved to Done. It also keeps them clear of
 * the task grammar's own tokens (`created:` is a task's creation date).
 * The spellings printed before (`activityBy:`, `activity-after:`) stay
 * aliases, so stored queries keep their meaning.
 */

import type { EnumValueSpec, ResolveAs } from "../query/grammar";
import type { ActivityField, ActivityFilters, ActivityKind, ActivityVerb } from "./types";

/** The keys of `ActivityFilters` a clause can fill (exclusions included). */
export type ActivityClauseKey = "by" | "action" | "field" | "kind" | "to" | "from" | "after" | "before";

export const ACTIVITY_CLAUSES: Record<ActivityClauseKey, EnumValueSpec> = {
	by: { token: "activity.by", aliases: ["activityby", "activityactor"] },
	action: { token: "activity.action", aliases: ["activityaction", "activityverb"] },
	field: { token: "activity.field", aliases: ["activityfield", "activityfields"] },
	kind: { token: "activity.kind", aliases: ["activityitem", "activitykind", "activity.item"] },
	to: { token: "activity.to", aliases: ["activityto"] },
	from: { token: "activity.from", aliases: ["activityfrom"] },
	after: { token: "activity.after", aliases: ["activity-after", "activityafter"] },
	before: { token: "activity.before", aliases: ["activity-before", "activitybefore"] },
};

/** The clauses `-` can exclude, and where the excluded values go. */
export const ACTIVITY_EXCLUDE_KEY: Partial<Record<ActivityClauseKey, keyof ActivityFilters>> = {
	by: "notBy",
	action: "notAction",
	field: "notField",
	kind: "notKind",
};

/** Past tense, as the Feed reads ("Allan trashed…"). */
export const ACTIVITY_VERB_VALUES: Record<ActivityVerb, EnumValueSpec> = {
	create: { token: "created", aliases: ["create", "added", "new"] },
	update: { token: "updated", aliases: ["update", "changed", "edited"] },
	comment: { token: "commented", aliases: ["comment", "comments"] },
	trash: { token: "trashed", aliases: ["trash"] },
	restore: { token: "restored", aliases: ["restore"] },
	delete: { token: "deleted", aliases: ["delete", "purged", "purge"] },
	share: { token: "shared", aliases: ["share"] },
	unshare: { token: "unshared", aliases: ["unshare", "made-private", "private"] },
};

export const ACTIVITY_KIND_VALUES: Record<ActivityKind, EnumValueSpec> = {
	task: { token: "task", aliases: ["tasks"] },
	project: { token: "project", aliases: ["projects"] },
	view: { token: "view", aliases: ["views"] },
	dashboard: { token: "dashboard", aliases: ["dashboards"] },
	label: { token: "label", aliases: ["labels"] },
	status: { token: "status", aliases: ["statuses"] },
	priority: { token: "priority", aliases: ["priorities"] },
	taskType: { token: "type", aliases: ["types", "tasktype", "task-type"] },
	member: { token: "member", aliases: ["members", "person", "people"] },
	workspace: { token: "workspace", aliases: ["settings"] },
	doc: { token: "doc", aliases: ["docs", "document", "documents"] },
	docStatus: { token: "doc-status", aliases: ["docstatus", "doc-statuses"] },
	folder: { token: "folder", aliases: ["folders"] },
	space: { token: "space", aliases: ["spaces"] },
	template: { token: "template", aliases: ["templates", "task-template"] },
	milestone: { token: "milestone", aliases: ["milestones"] },
	taskField: { token: "field", aliases: ["fields", "custom-field", "custom-fields"] },
	formResponse: { token: "response", aliases: ["responses", "form-response", "form-responses"] },
	signoff: { token: "signoff", aliases: ["signoffs", "sign-off", "sign-offs"] },
	signatureRequest: { token: "signing", aliases: ["signings", "signature-request", "signature-requests", "for-signature"] },
	link: { token: "link", aliases: ["links", "shared-link", "shared-links"] },
	brand: { token: "brand", aliases: ["brands"] },
};

export interface ActivityFieldSpec extends EnumValueSpec {
	/** How an `activity.to:`/`activity.from:` value for this field resolves --
	 *  absent where the field's values aren't something to name (a title,
	 *  a color), so those clauses are refused for it. */
	resolveAs?: ResolveAs;
}

/** Tokens follow the task grammar's own spellings where it has one
 *  (`type`, `due`, `start`, `parent`). */
export const ACTIVITY_FIELD_VALUES: Record<ActivityField, ActivityFieldSpec> = {
	title: { token: "title", aliases: [] },
	name: { token: "name", aliases: ["rename"] },
	description: { token: "description", aliases: ["desc"] },
	status: { token: "status", aliases: ["state"], resolveAs: "status" },
	priority: { token: "priority", aliases: [], resolveAs: "priority" },
	taskType: { token: "type", aliases: ["tasktype"], resolveAs: "taskType" },
	labels: { token: "labels", aliases: ["label", "tags"], resolveAs: "label" },
	assignee: { token: "assignee", aliases: ["assigned"], resolveAs: "person" },
	project: { token: "project", aliases: [], resolveAs: "project" },
	milestone: { token: "milestone", aliases: ["ms"], resolveAs: "milestone" },
	parentTask: { token: "parent", aliases: ["parenttask"], resolveAs: "task" },
	dueDate: { token: "due", aliases: ["duedate"], resolveAs: "date" },
	startDate: { token: "start", aliases: ["startdate"], resolveAs: "date" },
	archived: { token: "archived", aliases: ["archive"] },
	blocks: { token: "blocks", aliases: [], resolveAs: "task" },
	blockedBy: { token: "blocked-by", aliases: ["blockedby"], resolveAs: "task" },
	related: { token: "related", aliases: [], resolveAs: "task" },
	icon: { token: "icon", aliases: [] },
	color: { token: "color", aliases: ["colour"] },
	category: { token: "category", aliases: [] },
	editAccess: { token: "edit-access", aliases: ["editaccess"] },
	role: { token: "role", aliases: [] },
	memberStatus: { token: "member-status", aliases: ["memberstatus"] },
	idPrefix: { token: "id-prefix", aliases: ["idprefix", "prefix"] },
	slug: { token: "slug", aliases: [] },
	newTaskPlacement: { token: "new-task-placement", aliases: ["newtaskplacement"] },
	defaultNewTaskStatus: { token: "default-status", aliases: ["defaultnewtaskstatus"], resolveAs: "status" },
	defaultNewTaskType: { token: "default-type", aliases: ["defaultnewtasktype"], resolveAs: "taskType" },
	trashRetentionDays: { token: "trash-retention", aliases: ["trashretentiondays"] },
	charts: { token: "charts", aliases: ["widgets"] },
	chart: { token: "chart", aliases: ["widget"] },
	chartLayout: { token: "chart-layout", aliases: ["chartlayout", "arrangement"] },
	filter: { token: "filter", aliases: ["filters"] },
	body: { token: "body", aliases: ["content"] },
	docType: { token: "doc-type", aliases: ["doctype"] },
	docStatus: { token: "doc-status", aliases: ["docstatus"] },
	parentDoc: { token: "parent-doc", aliases: ["parentdoc"] },
	task: { token: "task", aliases: [] },
	defaultNewDocStatus: { token: "default-doc-status", aliases: ["defaultnewdocstatus"] },
	rows: { token: "rows", aliases: ["row"] },
	cell: { token: "cell", aliases: ["cells"] },
	columns: { token: "columns", aliases: [] },
	column: { token: "column", aliases: [] },
	tableViews: { token: "table-views", aliases: ["tableviews", "table-view"] },
	folder: { token: "folder", aliases: [] },
	parentFolder: { token: "parent-folder", aliases: ["parentfolder"] },
	space: { token: "space", aliases: [] },
	people: { token: "people", aliases: ["person"], resolveAs: "person" },
	visibility: { token: "visibility", aliases: [] },
	plan: { token: "plan", aliases: [] },
	subscriptionStatus: { token: "billing-status", aliases: ["subscription"] },
	internal: { token: "internal", aliases: ["hidden-from-guests"] },
	owner: { token: "owner", aliases: ["owned-by"], resolveAs: "person" },
	estimate: { token: "estimate", aliases: ["est", "points"] },
	recurrence: { token: "repeat", aliases: ["recurrence", "recurring"] },
	estimates: { token: "estimates", aliases: ["estimate-setting"] },
	calendarFeeds: { token: "calendar-feeds", aliases: ["calendarfeeds", "ical"] },
	taskTitle: { token: "task-title", aliases: ["tasktitle"] },
	subtasks: { token: "subtasks", aliases: ["sub-tasks"] },
	targetDate: { token: "target", aliases: ["targetdate", "target-date"], resolveAs: "date" },
	milestoneState: { token: "milestone-state", aliases: ["milestonestate"] },
	customField: { token: "custom", aliases: ["custom-field", "customfield"] },
	customFields: { token: "custom-fields", aliases: ["customfields"] },
	fieldType: { token: "field-type", aliases: ["fieldtype"] },
	options: { token: "choices", aliases: ["options"] },
	checklists: { token: "checklists", aliases: [] },
	checklistName: { token: "checklist-name", aliases: ["checklistname"] },
	checklistItems: { token: "checklist-items", aliases: ["checklistitems"] },
	checklistItem: { token: "checklist-item", aliases: ["checklistitem"] },
	checked: { token: "ticked", aliases: ["checked", "tick"] },
	active: { token: "active", aliases: ["turned-on", "turned-off"] },
	access: { token: "access", aliases: [] },
	expires: { token: "expires", aliases: ["expiry", "expires-at"] },
	linkExpiryDays: { token: "link-expiry", aliases: ["linkexpirydays", "share-expiry"] },
	publishSetups: { token: "publish-setup", aliases: ["publishsetups", "publish-setups"] },
	signoffStatus: { token: "signoff-status", aliases: ["signoffstatus", "sign-off-status"] },
	signingStatus: { token: "signing-status", aliases: ["signingstatus"] },
	signedBy: { token: "signed-by", aliases: ["signedby", "signers"] },
	brand: { token: "brand", aliases: [] },
	showAs: { token: "show-as", aliases: ["showas"] },
	defaultBrand: { token: "default-brand", aliases: ["defaultbrand"] },
	logo: { token: "logo", aliases: [] },
	website: { token: "website", aliases: ["site", "url"] },
};

/** `activity.by:system` -- an entry the app made on its own (the Trash's
 *  clean-up, a workspace template). Stored as `NONE`. */
export const SYSTEM_ACTOR_KEYWORD = "system";

function indexBy<K extends string>(table: Record<K, EnumValueSpec>): Map<string, K> {
	const out = new Map<string, K>();
	for (const [key, spec] of Object.entries(table) as [K, EnumValueSpec][]) {
		out.set(spec.token.toLowerCase(), key);
		for (const alias of spec.aliases) out.set(alias.toLowerCase(), key);
	}
	return out;
}

/** Lower-cased token (or alias) → clause, as the lexer hands fields over. */
export const ACTIVITY_CLAUSE_BY_TOKEN = indexBy(ACTIVITY_CLAUSES);
export const ACTIVITY_VERB_BY_TOKEN = indexBy(ACTIVITY_VERB_VALUES);
export const ACTIVITY_KIND_BY_TOKEN = indexBy(ACTIVITY_KIND_VALUES);
export const ACTIVITY_FIELD_BY_TOKEN = indexBy(ACTIVITY_FIELD_VALUES);

/** Every activity clause token, for the parser's "did you mean…" pool. */
export const ACTIVITY_FIELD_TOKENS: readonly string[] = [...ACTIVITY_CLAUSE_BY_TOKEN.keys()];
