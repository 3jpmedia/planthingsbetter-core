/**
 * Queries across kinds (T-0735): one field registry for every kind a query
 * can find, and a parser and matcher for a query whose results are of more
 * than one kind -- workspace search, and later shared links and forms.
 *
 * The language is the task query's one form (grammar.ts, T-0728):
 *
 * - `kind:project,doc` picks what comes back; without it, every kind does.
 * - A plain field is the item's own: `status:done` is a task's, a project's
 *   or a doc's own status. A kind without that field doesn't match.
 * - `{kind}.{field}` is that kind's field: an item of that kind matches on
 *   its own field, and anything linked to such an item matches too --
 *   `project.name:Website` finds the project and its tasks and docs.
 * - `{kind}:` alone is that item by key or name (`project:P-0003`), short for
 *   `{kind}.key:`. Every kind has `.key`, `.name` (`.title` reads as it),
 *   `created` and `updated`.
 * - Dates take a day, `unset` or `any`, and have `-before` / `-after` forms.
 * - `unset` / `any` on every field, `-` in front excludes, `me` is the viewer.
 *
 * A task query on its own (views, dashboards) stays parse.ts's: it knows
 * every task field, custom fields and layout. This one knows the fields
 * every kind shares with the others, enough to find things.
 */

import { ANY_KEYWORDS, RESULT_KINDS, SELF_KEYWORDS, UNSET_KEYWORDS } from "./grammar";
import { lex, type LexedToken, type LexedValue } from "./lex";
import type { QueryIssue, QuerySpan } from "./types";

export type ResultKind = (typeof RESULT_KINDS)[number];

/**
 * - `text`: contains the words given (`name:launch`).
 * - `list`: one of the values given, by any of the item's spellings of it.
 * - `date`: that day, or before / after it with `-before` / `-after`.
 * - `flag`: yes or no.
 * - `link`: the linked item(s) of `links`, by key or name.
 */
export type KindFieldType = "text" | "list" | "date" | "flag" | "link";

export interface KindFieldSpec {
	token: string;
	aliases?: readonly string[];
	type: KindFieldType;
	/** For `link` fields: the kind linked to. */
	links?: ResultKind;
	label: string;
}

export interface KindSpec {
	kind: ResultKind;
	/** "Project", "Doc"... */
	label: string;
	/** "Projects", "Docs"... */
	plural: string;
	/** Its own fields, beyond the ones every kind has (`COMMON_FIELDS`). */
	fields: readonly KindFieldSpec[];
}

/** What every kind has. */
export const COMMON_FIELDS: readonly KindFieldSpec[] = [
	{ token: "key", type: "list", label: "Key" },
	{ token: "name", aliases: ["title"], type: "text", label: "Name contains" },
	{ token: "created", type: "date", label: "Created" },
	{ token: "updated", type: "date", label: "Updated" },
];

const space: KindFieldSpec = { token: "space", type: "link", links: "space", label: "Space" };
const folder: KindFieldSpec = { token: "folder", type: "list", label: "Folder" };
const owner: KindFieldSpec = { token: "owner", type: "link", links: "member", label: "Owner" };
const shared: KindFieldSpec = { token: "shared", type: "flag", label: "Shared with the workspace" };

/**
 * Every kind and its fields. A kind that has no items to search yet (form,
 * link) still has its key and name, so `form:` and `link.name:` parse.
 */
export const KIND_SPECS: Record<ResultKind, KindSpec> = {
	task: {
		kind: "task",
		label: "Task",
		plural: "Tasks",
		fields: [
			{ token: "status", aliases: ["state"], type: "list", label: "Status" },
			{ token: "priority", type: "list", label: "Priority" },
			{ token: "type", aliases: ["tasktype"], type: "list", label: "Type" },
			{ token: "label", aliases: ["labels", "tag"], type: "link", links: "label", label: "Label" },
			{ token: "assignee", aliases: ["assigned"], type: "link", links: "member", label: "Assignee" },
			{ token: "project", type: "link", links: "project", label: "Project" },
			{ token: "milestone", type: "link", links: "milestone", label: "Milestone" },
			space,
			{ token: "parent", type: "link", links: "task", label: "Parent task" },
			{ token: "due", type: "date", label: "Due" },
			{ token: "start", type: "date", label: "Start" },
			{ token: "started", type: "date", label: "Started" },
			{ token: "completed", type: "date", label: "Completed" },
			{ token: "archived", type: "flag", label: "Archived" },
		],
	},
	project: {
		kind: "project",
		label: "Project",
		plural: "Projects",
		fields: [{ token: "status", aliases: ["state"], type: "list", label: "Status" }, space, folder],
	},
	milestone: {
		kind: "milestone",
		label: "Milestone",
		plural: "Milestones",
		fields: [
			{ token: "state", aliases: ["status"], type: "list", label: "State" },
			space,
			folder,
			{ token: "start", type: "date", label: "Start" },
			{ token: "target", type: "date", label: "Target" },
			{ token: "completed", type: "date", label: "Completed" },
		],
	},
	doc: {
		kind: "doc",
		label: "Doc",
		plural: "Docs",
		fields: [
			{ token: "status", aliases: ["state"], type: "list", label: "Status" },
			{ token: "type", aliases: ["doctype"], type: "list", label: "Type" },
			owner,
			space,
			folder,
			shared,
			{ token: "project", type: "link", links: "project", label: "Attached to a project" },
			{ token: "milestone", type: "link", links: "milestone", label: "Attached to a milestone" },
			{ token: "task", type: "link", links: "task", label: "Attached to a task" },
		],
	},
	view: {
		kind: "view",
		label: "View",
		plural: "Views",
		fields: [{ token: "layout", type: "list", label: "Layout" }, owner, space, folder, shared],
	},
	dashboard: { kind: "dashboard", label: "Dashboard", plural: "Dashboards", fields: [owner, space, folder, shared] },
	label: { kind: "label", label: "Label", plural: "Labels", fields: [{ token: "color", type: "list", label: "Color" }, folder] },
	space: { kind: "space", label: "Space", plural: "Spaces", fields: [{ token: "visibility", type: "list", label: "Visibility" }] },
	member: {
		kind: "member",
		label: "Member",
		plural: "Members",
		fields: [
			{ token: "email", type: "text", label: "Email contains" },
			{ token: "role", type: "list", label: "Role" },
			{ token: "status", aliases: ["state"], type: "list", label: "Status" },
		],
	},
	channel: { kind: "channel", label: "Channel", plural: "Channels", fields: [space] },
	template: { kind: "template", label: "Template", plural: "Templates", fields: [owner] },
	form: { kind: "form", label: "Form", plural: "Forms", fields: [owner, space, folder] },
	link: {
		kind: "link",
		label: "Shared link",
		plural: "Shared links",
		fields: [
			{ ...owner, aliases: ["by", "created-by"], label: "Made by" },
			// What it shares: task, project, view, dashboard, doc, form, graph,
			// embed (a live graph) or setup (a published setup).
			{ token: "type", aliases: ["of"], type: "list", label: "What it shares" },
			{ token: "access", type: "list", label: "Who can open it (public, invited)" },
			{ token: "status", aliases: ["state"], type: "list", label: "On, off or expired" },
			{ token: "last-viewed", aliases: ["lastviewed", "viewed"], type: "date", label: "Last opened" },
			{ token: "expires", aliases: ["expiry"], type: "date", label: "Turns off" },
			space,
		],
	},
	activity: { kind: "activity", label: "Activity", plural: "Activity", fields: [] },
};

/** `kind`'s fields, the common ones first. */
export function kindFields(kind: ResultKind): readonly KindFieldSpec[] {
	return [...COMMON_FIELDS, ...KIND_SPECS[kind].fields];
}

/** `kind`'s field named `token` (or an alias of it). */
export function kindField(kind: ResultKind, token: string): KindFieldSpec | undefined {
	const lowered = token.toLowerCase();
	return kindFields(kind).find((field) => field.token === lowered || field.aliases?.includes(lowered));
}

export function isResultKind(value: string): value is ResultKind {
	return (RESULT_KINDS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------- items ---- */

/** A field's value on an item: its spellings (a status's name and id), a
 *  date (`YYYY-MM-DD...`), a flag, or nothing. */
export type KindFieldValue = string | readonly string[] | boolean | null | undefined;

/**
 * Something a query across kinds can find, as the app hands it over. `fields`
 * holds its own fields by token (a date as an ISO string or day); `links`
 * the keys of what it's linked to, by kind -- a task's project, labels and
 * assignees, a doc's attached tasks.
 */
export interface KindItem {
	kind: ResultKind;
	key: string;
	name: string;
	/** More text its words can match (a description, an email). */
	text?: string;
	fields?: Readonly<Record<string, KindFieldValue>>;
	links?: Partial<Readonly<Record<ResultKind, readonly string[]>>>;
}

/* ------------------------------------------------------------- query ---- */

export interface KindClause {
	/** The kind it's about: `project.status:` -> project. Null for a plain
	 *  field, which is each item's own. */
	of: ResultKind | null;
	/** The field's token (`status`, `key`...). */
	field: string;
	/** `-before` / `-after` on a date. */
	bound?: "before" | "after";
	values: string[];
	excluded: boolean;
	span: QuerySpan;
}

export interface KindQuery {
	/** What comes back; null for every kind. */
	kinds: ResultKind[] | null;
	/** Words every result's name, key or text contains. */
	words: string[];
	clauses: KindClause[];
}

export interface ParsedKindQuery {
	query: KindQuery;
	issues: QueryIssue[];
	ok: boolean;
}

export const EMPTY_KIND_QUERY: KindQuery = { kinds: null, words: [], clauses: [] };

const UNSET = new Set<string>(UNSET_KEYWORDS);
const ANY = new Set<string>(ANY_KEYWORDS);
const SELF = new Set<string>(SELF_KEYWORDS);

/** `started-before` -> `started`, "before". */
function splitBound(token: string): { base: string; bound?: "before" | "after" } {
	const match = /^(.+)-(before|after)$/.exec(token);
	return match ? { base: match[1], bound: match[2] as "before" | "after" } : { base: token };
}

/** Every kind with a field `token` (with its own spelling). */
function kindsWithField(token: string): ResultKind[] {
	return RESULT_KINDS.filter((kind) => kindField(kind, token));
}

/**
 * Reads a query across kinds. `kinds` limits what can come back (a bar that
 * only finds some kinds); `kind:` in the query narrows it further.
 */
export function parseKindQuery(source: string, options: { kinds?: readonly ResultKind[] } = {}): ParsedKindQuery {
	const { tokens, issues } = lex(source);
	const query: KindQuery = { kinds: null, words: [], clauses: [] };
	const allowed = options.kinds ?? RESULT_KINDS;
	const fail = (code: QueryIssue["code"], message: string, span: QuerySpan, suggestion?: string) =>
		issues.push({ severity: "error", code, message, span, ...(suggestion ? { suggestion } : {}) });

	const clause = (token: Extract<LexedToken, { kind: "clause" }>) => {
		const values = token.values.map((value: LexedValue) => value.text.trim()).filter(Boolean);
		// A field it doesn't know is that, valued or not (`Re: launch`).
		const empty = () => fail("empty-value", `"${token.field}" needs a value`, token.span);

		// `kind:` picks what comes back. A value that isn't a kind is a type,
		// as in a task query (`kind:bug`).
		if (token.field === "kind" && values.length === 0) return empty();
		if (token.field === "kind" && values.every((value) => isResultKind(value.toLowerCase()))) {
			const named = values.map((value) => value.toLowerCase() as ResultKind);
			const outside = named.filter((kind) => !allowed.includes(kind));
			if (outside.length) {
				return fail("not-expressible", `This finds ${allowed.join(", ")}, not ${outside.join(" or ")}`, token.span);
			}
			const base = query.kinds ?? [...allowed];
			query.kinds = token.excluded ? base.filter((kind) => !named.includes(kind)) : base.filter((kind) => named.includes(kind));
			return;
		}
		const field = token.field === "kind" ? "type" : token.field;

		// `{kind}.{field}`, `{kind}:`, or a plain field.
		const dot = field.indexOf(".");
		const head = dot === -1 ? field : field.slice(0, dot);
		let of: ResultKind | null = null;
		let rest = field;
		if (isResultKind(head)) {
			of = head;
			rest = dot === -1 ? "key" : field.slice(dot + 1);
		}
		const { base, bound } = splitBound(rest);
		if (of) {
			const spec = kindField(of, base) ?? (bound ? undefined : kindField(of, rest));
			if (!spec) {
				const own = kindFields(of).map((f) => f.token).join(", ");
				return fail("unknown-field", `${KIND_SPECS[of].label} has no "${rest}" - it has ${own}`, token.fieldSpan);
			}
			if (bound && spec.type !== "date") return fail("unknown-field", `"${rest}" isn't a date`, token.fieldSpan);
			if (values.length === 0) return empty();
			query.clauses.push({ of, field: spec.token, ...(bound ? { bound } : {}), values, excluded: token.excluded, span: token.span });
			return;
		}
		// A plain field: the kinds that have it.
		const owners = kindsWithField(base);
		if (owners.length === 0) return fail("unknown-field", `"${field}" isn't a field`, token.fieldSpan);
		const spec = kindField(owners[0], base)!;
		if (bound && spec.type !== "date") return fail("unknown-field", `"${field}" isn't a field`, token.fieldSpan);
		if (values.length === 0) return empty();
		query.clauses.push({ of: null, field: spec.token, ...(bound ? { bound } : {}), values, excluded: token.excluded, span: token.span });
	};

	for (const token of tokens) {
		if (token.kind === "bare") {
			if (token.value.text.trim()) query.words.push(token.value.text.trim());
			continue;
		}
		clause(token);
	}
	return { query, issues, ok: !issues.some((issue) => issue.severity === "error") };
}

/* ---------------------------------------------------------- matching ---- */

export interface KindMatchContext {
	/** Every item the query runs over, so a link can be followed to what it
	 *  names: by key. Built once with `indexKindItems`. */
	index: ReadonlyMap<string, KindItem>;
	/** The viewer's member key (and other spellings), for `me`. */
	self?: readonly string[];
	/** The day of an item's date, for comparing; defaults to its first ten
	 *  characters (`2026-10-15T...` -> `2026-10-15`). */
	dayOf?: (value: string) => string;
}

/** `kind:key` -> item, for following links. */
export function indexKindItems(items: Iterable<KindItem>): Map<string, KindItem> {
	const index = new Map<string, KindItem>();
	for (const item of items) index.set(`${item.kind}:${item.key.toLowerCase()}`, item);
	return index;
}

const spellings = (value: KindFieldValue): string[] =>
	value == null ? [] : typeof value === "boolean" ? [value ? "yes" : "no"] : (typeof value === "string" ? [value] : [...value]).filter(Boolean);

function linked(item: KindItem, kind: ResultKind, context: KindMatchContext): KindItem[] {
	const keys = item.links?.[kind] ?? [];
	return keys.map((key) => context.index.get(`${kind}:${key.toLowerCase()}`)).filter((found): found is KindItem => !!found);
}

/** The spellings of `item`'s field: its own value, or for a link field the
 *  keys and names of what it links to. Undefined: it has no such field. */
function fieldValues(item: KindItem, field: string, context: KindMatchContext): string[] | undefined {
	// `{kind}:` takes a name as well as a key.
	if (field === "key") return [item.key, item.name];
	if (field === "name") return [item.name];
	const spec = kindField(item.kind, field);
	if (!spec) return undefined;
	if (spec.type === "link" && spec.links) {
		const keys = item.links?.[spec.links] ?? [];
		return [...keys, ...linked(item, spec.links, context).map((target) => target.name)];
	}
	return spellings(item.fields?.[spec.token]);
}

const FLAG_WORDS: Record<string, string> = { yes: "yes", true: "yes", no: "no", false: "no" };

/** Whether `item`'s own field meets the clause (excluded or not). */
function ownMatch(item: KindItem, clause: KindClause, context: KindMatchContext): boolean {
	const values = fieldValues(item, clause.field, context);
	if (values === undefined) return false;
	const spec = kindField(item.kind, clause.field)!;
	const lower = values.map((value) => value.toLowerCase());
	const dayOf = context.dayOf ?? ((value: string) => value.slice(0, 10));
	const hit = clause.values.some((raw) => {
		const wanted = raw.toLowerCase();
		if (UNSET.has(wanted)) return lower.length === 0 || (spec.type === "flag" && lower.includes("no"));
		if (ANY.has(wanted)) return lower.length > 0 && !(spec.type === "flag" && lower.includes("no"));
		if (spec.type === "text") return lower.some((value) => value.includes(wanted));
		if (spec.type === "date") {
			const days = values.map(dayOf);
			if (clause.bound === "before") return days.some((day) => day < raw);
			if (clause.bound === "after") return days.some((day) => day > raw);
			return days.includes(raw);
		}
		if (spec.type === "flag") return lower.includes(FLAG_WORDS[wanted] ?? wanted);
		if (SELF.has(wanted) && context.self?.length) return context.self.some((self) => lower.includes(self.toLowerCase()));
		return lower.includes(wanted);
	});
	return clause.excluded ? !hit : hit;
}

/** Whether `item` meets one clause. */
function clauseMatch(item: KindItem, clause: KindClause, context: KindMatchContext): boolean {
	// A plain field is the item's own; a kind without it doesn't match.
	if (clause.of === null || clause.of === item.kind) return ownMatch(item, clause, context);
	// `{kind}.{field}` on something else: what it's linked to of that kind.
	const targets = linked(item, clause.of, context);
	// It can't link to that kind at all: it doesn't match.
	if (!kindFields(item.kind).some((field) => field.links === clause.of)) return false;
	// `project:P-0003` on a task is its project, by key or name, and answers
	// `unset` / `any` for tasks with none.
	if (clause.field === "key") return matchKeys([...(item.links?.[clause.of] ?? []), ...targets.map((target) => target.name)], clause, context);
	const any = targets.some((target) => ownMatch(target, { ...clause, excluded: false }, context));
	return clause.excluded ? !any : any;
}

function matchKeys(keys: string[], clause: KindClause, context: KindMatchContext): boolean {
	const lower = keys.map((key) => key.toLowerCase());
	const hit = clause.values.some((raw) => {
		const wanted = raw.toLowerCase();
		if (UNSET.has(wanted)) return lower.length === 0;
		if (ANY.has(wanted)) return lower.length > 0;
		if (SELF.has(wanted) && context.self?.length) return context.self.some((self) => lower.includes(self.toLowerCase()));
		return lower.includes(wanted);
	});
	return clause.excluded ? !hit : hit;
}

/** Whether `item` is one of the query's results. */
export function matchesKindQuery(item: KindItem, query: KindQuery, context: KindMatchContext): boolean {
	if (query.kinds && !query.kinds.includes(item.kind)) return false;
	if (query.words.length) {
		const haystack = `${item.name} ${item.key} ${item.text ?? ""}`.toLowerCase();
		if (!query.words.every((word) => haystack.includes(word.toLowerCase()))) return false;
	}
	return query.clauses.every((clause) => clauseMatch(item, clause, context));
}

/** Whether a query asks for more than words (a field, or `kind:`). */
export function kindQueryHasFilters(query: KindQuery): boolean {
	return query.kinds !== null || query.clauses.length > 0;
}

/**
 * `source` with its `kind:` clause set to `kinds` (none: every kind), the
 * rest left as typed -- for a bar's kind chip, which is part of its query.
 */
export function withKinds(source: string, kinds: readonly ResultKind[]): string {
	const { tokens } = lex(source);
	let text = source;
	// Drop the existing kind: clauses, last first so spans stay put.
	for (const token of [...tokens].reverse()) {
		if (token.kind !== "clause" || token.field !== "kind") continue;
		if (!token.values.every((value) => isResultKind(value.text.trim().toLowerCase()))) continue;
		text = text.slice(0, token.span.start) + text.slice(token.span.end).replace(/^\s+/, "");
	}
	text = text.trim();
	return kinds.length ? `kind:${kinds.join(",")}${text ? ` ${text}` : ""}` : text;
}
