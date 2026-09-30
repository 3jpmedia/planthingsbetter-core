/**
 * The Activity page's query: the task clauses every view already speaks,
 * plus `activity…:` clauses about the events themselves.
 *
 * One lexer pass splits the two; the task clauses go through the task
 * parser untouched (`parseQueryTokens`, spans intact, so its diagnostics
 * point at the right characters), and the activity clauses are handled
 * here. Printing mirrors it: `printFilters` for the task part, then the
 * activity clauses, so `parse(print(q))` round-trips -- the same guarantee
 * the task query bar's two-way sync rests on.
 */

import { isValidIsoDay } from "../date";
import type { QueryContext } from "../query/context";
import { LAYOUT_ONLY_CLAUSES, type EnumValueSpec, type FilterFieldSpec } from "../query/grammar";
import { lex, type LexedToken } from "../query/lex";
import { parseQueryTokens } from "../query/parse";
import { printFilters, printValue } from "../query/print";
import { resolveValue } from "../query/resolve";
import type { QueryIssue, QuerySpan } from "../query/types";
import { NONE, type ViewFilters } from "../types";
import { canonicalizeFilters } from "../views/filter";
import {
	ACTIVITY_CLAUSE_BY_TOKEN,
	ACTIVITY_CLAUSES,
	ACTIVITY_EXCLUDE_KEY,
	ACTIVITY_FIELD_BY_TOKEN,
	ACTIVITY_FIELD_TOKENS,
	ACTIVITY_FIELD_VALUES,
	ACTIVITY_KIND_BY_TOKEN,
	ACTIVITY_KIND_VALUES,
	ACTIVITY_VERB_BY_TOKEN,
	ACTIVITY_VERB_VALUES,
	SYSTEM_ACTOR_KEYWORD,
	type ActivityClauseKey,
} from "./grammar";
import type {
	ActivityField,
	ActivityFilters,
	ActivityKind,
	ActivityQuery,
	ActivityRef,
	ActivityValue,
	ActivityVerb,
} from "./types";

export const EMPTY_ACTIVITY_QUERY: ActivityQuery = { items: {}, activity: {} };

const PERSON_SPEC: FilterFieldSpec = {
	token: ACTIVITY_CLAUSES.by.token,
	aliases: [],
	resolveAs: "person",
	unsetIsVacuous: false,
};

/** The spec `activityTo:`/`activityFrom:` resolve with, when `field` names
 *  exactly one field whose values can be named. */
function valueSpecFor(activity: ActivityFilters, key: "to" | "from"): FilterFieldSpec | null {
	if (activity.field?.length !== 1) return null;
	const resolveAs = ACTIVITY_FIELD_VALUES[activity.field[0]].resolveAs;
	if (!resolveAs) return null;
	return { token: ACTIVITY_CLAUSES[key].token, aliases: [], resolveAs, unsetIsVacuous: false };
}

function dedupe<T>(values: readonly T[] | undefined): T[] | undefined {
	if (!values || values.length === 0) return undefined;
	const out: T[] = [];
	for (const value of values) if (!out.includes(value)) out.push(value);
	return out;
}

export function canonicalizeActivityFilters(filters: ActivityFilters): ActivityFilters {
	const out: ActivityFilters = {};
	const lists = ["by", "notBy", "action", "notAction", "field", "notField", "kind", "notKind", "to", "from"] as const;
	for (const key of lists) {
		const values = dedupe(filters[key] as string[] | undefined);
		if (values) (out as Record<string, string[]>)[key] = values;
	}
	if (filters.after) out.after = filters.after;
	if (filters.before) out.before = filters.before;
	return out;
}

export function canonicalizeActivityQuery(query: ActivityQuery): ActivityQuery {
	return { items: canonicalizeFilters(query.items), activity: canonicalizeActivityFilters(query.activity) };
}

export function activityQueriesEqual(a: ActivityQuery, b: ActivityQuery): boolean {
	return JSON.stringify(canonicalizeActivityQuery(a)) === JSON.stringify(canonicalizeActivityQuery(b));
}

/**
 * Whether the task clauses narrow anything -- when they don't, activity on
 * everything (projects, labels, settings…) shows; when they do, only
 * activity on the tasks they match. `archived` alone doesn't count: it's
 * only a visibility switch (see `activityItemFilters`).
 */
export function activityItemScopeActive(items: ViewFilters): boolean {
	return Object.keys(canonicalizeFilters(items)).some((key) => key !== "archived");
}

/**
 * The task filters to match tasks with on the Activity page. Archived tasks
 * are included unless the query says otherwise -- a task view hides them
 * by default, but here that would silently hide everything that ever
 * happened to them.
 */
export function activityItemFilters(items: ViewFilters): ViewFilters {
	return { ...items, archived: items.archived ?? "included" };
}

/** A list field's change, as what was added and what was removed. */
export function activityListDelta(from: ActivityValue | undefined, to: ActivityValue | undefined): {
	added: ActivityRef[];
	removed: ActivityRef[];
} {
	const before = Array.isArray(from) ? from : [];
	const after = Array.isArray(to) ? to : [];
	const ids = (list: ActivityRef[]) => new Set(list.map((ref) => ref.id));
	const had = ids(before);
	const has = ids(after);
	return {
		added: after.filter((ref) => !had.has(ref.id)),
		removed: before.filter((ref) => !has.has(ref.id)),
	};
}

/* --------------------------------------------------------------- parse ---- */

export interface ParsedActivityQuery {
	query: ActivityQuery;
	issues: QueryIssue[];
	/** No issue has severity `"error"`. */
	ok: boolean;
}

type Clause = Extract<LexedToken, { kind: "clause" }>;

export function parseActivityQuery(source: string, context: QueryContext): ParsedActivityQuery {
	const { tokens, issues: lexIssues } = lex(source);
	const itemTokens: LexedToken[] = [];
	const activityTokens: { key: ActivityClauseKey; token: Clause }[] = [];
	for (const token of tokens) {
		const key = token.kind === "clause" ? ACTIVITY_CLAUSE_BY_TOKEN.get(token.field) : undefined;
		if (key && token.kind === "clause") activityTokens.push({ key, token });
		else itemTokens.push(token);
	}

	const parsedItems = parseQueryTokens(itemTokens, lexIssues, context, ACTIVITY_FIELD_TOKENS);
	const issues: QueryIssue[] = [...parsedItems.issues];
	const fail = (code: QueryIssue["code"], message: string, span: QuerySpan, suggestion?: string) =>
		issues.push({ severity: "error", code, message, span, suggestion });

	// Nothing here has a layout to configure -- how entries show is the
	// Display menu's.
	for (const token of itemTokens) {
		if (token.kind === "clause" && LAYOUT_ONLY_CLAUSES.has(token.field)) {
			fail("not-expressible", `"${token.field}:" configures a view layout — use Display to change how activity shows`, token.span);
		}
	}

	const activity: ActivityFilters = {};
	const seen = new Set<string>();
	const noteDuplicate = (key: string, span: QuerySpan) => {
		if (seen.has(key)) {
			issues.push({ severity: "warning", code: "duplicate-field", message: `"${key}" appears more than once`, span });
		}
		seen.add(key);
	};
	const push = (key: keyof ActivityFilters, value: string) => {
		const list = ((activity as Record<string, string[] | undefined>)[key] ??= []);
		list.push(value);
	};
	const enumValue = <K extends string>(
		table: Map<string, K>,
		raw: string,
		what: string,
		span: QuerySpan,
	): K | null => {
		const match = table.get(raw.trim().toLowerCase());
		if (!match) fail("unknown-value", `"${raw}" isn't ${what}`, span);
		return match ?? null;
	};

	// `activityTo:`/`activityFrom:` resolve against the field `activityField:`
	// names, wherever in the query that is -- so they go last.
	const ordered = [
		...activityTokens.filter(({ key }) => key !== "to" && key !== "from"),
		...activityTokens.filter(({ key }) => key === "to" || key === "from"),
	];

	for (const { key, token } of ordered) {
		const spec = ACTIVITY_CLAUSES[key];
		const excludeKey = ACTIVITY_EXCLUDE_KEY[key];
		if (token.excluded && !excludeKey) {
			fail("not-expressible", `"-${spec.token}:" isn't supported — exclusion only works on who, what, which field and which item`, token.span);
			continue;
		}
		if (token.values.length === 0) {
			fail("empty-value", `"${spec.token}" needs a value`, token.span);
			continue;
		}
		const target: keyof ActivityFilters = token.excluded && excludeKey ? excludeKey : key;
		noteDuplicate(target, token.span);

		if (key === "after" || key === "before") {
			const raw = token.values[0].text.trim();
			if (!isValidIsoDay(raw)) fail("unknown-value", `"${raw}" isn't a valid date (expected YYYY-MM-DD)`, token.values[0].span);
			else activity[key] = raw;
			continue;
		}

		for (const value of token.values) {
			if (key === "by") {
				if (!value.verbatim && value.text.trim().toLowerCase() === SYSTEM_ACTOR_KEYWORD) {
					push(target, NONE);
					continue;
				}
				const resolved = resolveValue(PERSON_SPEC, value.text, value.verbatim, context);
				if (resolved.issue) issues.push({ ...resolved.issue, span: value.span });
				push(target, resolved.value);
			} else if (key === "action") {
				const verb = enumValue(ACTIVITY_VERB_BY_TOKEN, value.text, "an activity action", value.span);
				if (verb) push(target, verb);
			} else if (key === "kind") {
				const kind = enumValue(ACTIVITY_KIND_BY_TOKEN, value.text, "a kind of item", value.span);
				if (kind) push(target, kind);
			} else if (key === "field") {
				const field = enumValue(ACTIVITY_FIELD_BY_TOKEN, value.text, "a field activity records", value.span);
				if (field) push(target, field);
			} else {
				const valueSpec = valueSpecFor(activity, key);
				if (!valueSpec) {
					const fields = activity.field ?? [];
					const message =
						fields.length === 1
							? `"${ACTIVITY_FIELD_VALUES[fields[0]].token}" values can't be named in ${spec.token}:`
							: `${spec.token}: needs exactly one ${ACTIVITY_CLAUSES.field.token}: to say whose value it is`;
					fail("not-expressible", message, token.span);
					break;
				}
				const resolved = resolveValue(valueSpec, value.text, value.verbatim, context);
				if (resolved.issue) issues.push({ ...resolved.issue, span: value.span });
				push(target, resolved.value);
			}
		}
	}

	return {
		query: { items: parsedItems.definition.filters, activity: canonicalizeActivityFilters(activity) },
		issues,
		ok: !issues.some((issue) => issue.severity === "error"),
	};
}

/* --------------------------------------------------------------- print ---- */

function printEnum<K extends string>(values: readonly K[], table: Record<K, EnumValueSpec>): string {
	return values.map((value) => table[value].token).join(",");
}

function printPerson(value: string, context: QueryContext): string {
	if (value === NONE) return SYSTEM_ACTOR_KEYWORD;
	const printed = printValue(PERSON_SPEC, value, context);
	// Someone actually called "system" (with no email to print instead)
	// would read back as the system itself -- spell them out verbatim.
	return printed.toLowerCase() === SYSTEM_ACTOR_KEYWORD ? `=${value}` : printed;
}

export function printActivityQuery(query: ActivityQuery, context: QueryContext): string {
	const parts: string[] = [];
	const items = printFilters(query.items, context);
	if (items) parts.push(items);

	const activity = canonicalizeActivityFilters(query.activity);
	const clause = (key: ActivityClauseKey, rendered: string, excluded = false) =>
		parts.push(`${excluded ? "-" : ""}${ACTIVITY_CLAUSES[key].token}:${rendered}`);

	if (activity.kind) clause("kind", printEnum<ActivityKind>(activity.kind, ACTIVITY_KIND_VALUES));
	if (activity.notKind) clause("kind", printEnum<ActivityKind>(activity.notKind, ACTIVITY_KIND_VALUES), true);
	if (activity.by) clause("by", activity.by.map((value) => printPerson(value, context)).join(","));
	if (activity.notBy) clause("by", activity.notBy.map((value) => printPerson(value, context)).join(","), true);
	if (activity.action) clause("action", printEnum<ActivityVerb>(activity.action, ACTIVITY_VERB_VALUES));
	if (activity.notAction) clause("action", printEnum<ActivityVerb>(activity.notAction, ACTIVITY_VERB_VALUES), true);
	if (activity.field) clause("field", printEnum<ActivityField>(activity.field, ACTIVITY_FIELD_VALUES));
	if (activity.notField) clause("field", printEnum<ActivityField>(activity.notField, ACTIVITY_FIELD_VALUES), true);
	for (const key of ["from", "to"] as const) {
		const values = activity[key];
		if (!values) continue;
		const spec = valueSpecFor(activity, key);
		clause(key, values.map((value) => (spec ? printValue(spec, value, context) : `=${value}`)).join(","));
	}
	if (activity.after) clause("after", activity.after);
	if (activity.before) clause("before", activity.before);

	return parts.join(" ");
}
