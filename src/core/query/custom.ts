/**
 * Custom fields in the query language: `custom.<slug>:<value>`.
 *
 * Always prefixed, never a bare name: a workspace can name a field anything
 * (even "Status") and it can't collide with a built-in field, today's or one
 * added later. The part after `custom.` is the field's slug ("due-to-client"),
 * or its key ("cf-0003") -- what a query printed without the field list
 * falls back to.
 *
 * Values, by type:
 * - a choice (select, multi-select) by name; a person by name, email or `me`;
 * - a number or a day, exactly or compared: `>3`, `<=2026-11-01`;
 * - a checkbox: `yes` / `no`;
 * - text and links: what the value contains (any case);
 * - `unset` for no value (`has:custom.points` for any value).
 */

import { isValidIsoDay } from "../date";
import { SELF, type CustomFieldDef, type CustomFieldMatch } from "../types";
import type { QueryContext } from "./context";
import { SELF_KEYWORDS, UNSET_KEYWORDS, VERBATIM_PREFIX } from "./grammar";
import { lex } from "./lex";
import { resolvePerson } from "./resolve";
import type { QueryIssue } from "./types";

export const CUSTOM_PREFIX = "custom.";

const lower = (text: string) => text.trim().toLowerCase();
const TRUE = new Set(["true", "yes", "y", "checked", "1", "on", "done"]);
const FALSE = new Set(["false", "no", "n", "unchecked", "0", "off"]);

/** The field `custom.<name>` names: by slug, by key, or by a name it had
 *  before a rename (a field's own name now always wins over another's old
 *  one). */
export function customFieldForToken(name: string, context: Pick<QueryContext, "customFields">): CustomFieldDef | undefined {
	const wanted = lower(name);
	const fields = context.customFields ?? [];
	return (
		fields.find((field) => field.slug.toLowerCase() === wanted) ??
		fields.find((field) => field.key.toLowerCase() === wanted) ??
		fields.find((field) => (field.formerSlugs ?? []).some((slug) => slug.toLowerCase() === wanted))
	);
}

/** How a query names the field with key `key`: `custom.<slug>`, or
 *  `custom.<key>` when the field list isn't at hand. */
export function customFieldToken(key: string, context: Pick<QueryContext, "customFields">): string {
	const field = context.customFields?.find((candidate) => candidate.key.toUpperCase() === key.toUpperCase());
	return `${CUSTOM_PREFIX}${field ? field.slug : key.toLowerCase()}`;
}

/** Every `custom.<slug>` the workspace has -- for "did you mean…". */
export function customFieldTokens(context: Pick<QueryContext, "customFields">): string[] {
	return (context.customFields ?? []).map((field) => `${CUSTOM_PREFIX}${field.slug}`);
}

type Issue = Omit<QueryIssue, "span">;

/** One query value → a test of the field's value. Never throws; what can't
 *  be read is kept as written, with a warning (or an error where it can
 *  never mean anything). */
export function parseCustomValue(
	field: CustomFieldDef,
	raw: string,
	verbatim: boolean,
	context: QueryContext,
): { match: CustomFieldMatch; issue?: Issue } {
	const token = `${CUSTOM_PREFIX}${field.slug}`;
	if (verbatim) return { match: { op: "eq", value: raw } };
	const text = raw.trim();
	if (UNSET_KEYWORDS.includes(lower(text) as (typeof UNSET_KEYWORDS)[number])) return { match: { op: "unset" } };

	const compared = /^(>=|<=|>|<)\s*(.*)$/.exec(text);
	if (compared) {
		const op = ({ ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" } as const)[compared[1] as ">" | ">=" | "<" | "<="];
		const value = compared[2].trim();
		if (field.type !== "number" && field.type !== "date") {
			return {
				match: { op: "eq", value: text },
				issue: { severity: "error", code: "not-expressible", message: `${token} can't be compared - only numbers and dates can` },
			};
		}
		const valid = field.type === "number" ? value !== "" && Number.isFinite(Number(value)) : isValidIsoDay(value);
		return {
			match: { op, value: field.type === "number" && valid ? String(Number(value)) : value },
			issue: valid
				? undefined
				: { severity: "warning", code: "unknown-value", message: `"${value}" isn't ${field.type === "number" ? "a number" : "a date (YYYY-MM-DD)"} - keeping it as written` },
		};
	}

	switch (field.type) {
		case "select":
		case "multiSelect": {
			const option =
				field.options?.find((candidate) => candidate.id === text) ?? field.options?.find((candidate) => lower(candidate.name) === lower(text));
			if (option) return { match: { op: "eq", value: option.id } };
			return {
				match: { op: "eq", value: text },
				issue: { severity: "warning", code: "unknown-value", message: `${field.name} has no choice "${text}" - keeping it as written` },
			};
		}
		case "member": {
			if (SELF_KEYWORDS.includes(lower(text) as (typeof SELF_KEYWORDS)[number])) {
				return {
					match: { op: "eq", value: SELF },
					issue: context.selfId ? undefined : { severity: "warning", code: "self-unconfigured", message: "Nobody is marked as you yet, so this matches nothing" },
				};
			}
			const person = resolvePerson(text, context);
			return { match: { op: "eq", value: person.value }, issue: person.issue };
		}
		case "number": {
			const valid = text !== "" && Number.isFinite(Number(text));
			return {
				match: { op: "eq", value: valid ? String(Number(text)) : text },
				issue: valid ? undefined : { severity: "warning", code: "unknown-value", message: `"${text}" isn't a number - keeping it as written` },
			};
		}
		case "date":
			return {
				match: { op: "eq", value: text },
				issue: isValidIsoDay(text) ? undefined : { severity: "warning", code: "unknown-value", message: `"${text}" isn't a date (YYYY-MM-DD) - keeping it as written` },
			};
		case "checkbox": {
			if (TRUE.has(lower(text))) return { match: { op: "eq", value: "true" } };
			if (FALSE.has(lower(text))) return { match: { op: "eq", value: "false" } };
			return {
				match: { op: "eq", value: text },
				issue: { severity: "warning", code: "unknown-value", message: `${token} takes yes or no` },
			};
		}
		default:
			return { match: { op: "eq", value: text } };
	}
}

/** A test as the words that read back to it: a choice's name, a person's
 *  email (or `me`), `yes`/`no`, `>3`, `unset`. */
function words(field: CustomFieldDef, match: CustomFieldMatch, context: QueryContext): string {
	if (match.op === "unset") return "unset";
	const value = match.value ?? "";
	const prefix = { eq: "", gt: ">", gte: ">=", lt: "<", lte: "<=" }[match.op];
	if (match.op !== "eq") return `${prefix}${value}`;
	if (field.type === "select" || field.type === "multiSelect") return field.options?.find((option) => option.id === value)?.name ?? value;
	if (field.type === "member") {
		if (value === SELF) return "me";
		const person = context.people.find((candidate) => candidate.id === value);
		return person ? (person.email ?? person.name) : value;
	}
	if (field.type === "checkbox") return value === "true" ? "yes" : value === "false" ? "no" : value;
	return value;
}

const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A test as query text: the prettiest rendering that reads back to exactly
 *  the same test (bare, then quoted, then verbatim). */
export function printCustomMatch(field: CustomFieldDef, match: CustomFieldMatch, context: QueryContext): string {
	const text = words(field, match, context);
	const same = (candidate: string) => {
		const lexed = lex(`${CUSTOM_PREFIX}${field.slug}:${candidate}`).tokens;
		const token = lexed[0];
		if (lexed.length !== 1 || token.kind !== "clause" || token.values.length !== 1) return false;
		const value = token.values[0];
		const back = parseCustomValue(field, value.text, value.verbatim, context).match;
		return back.op === match.op && (back.value ?? null) === (match.value ?? null);
	};
	for (const candidate of [text, quote(text), `${VERBATIM_PREFIX}${quote(match.value ?? text)}`]) {
		if (same(candidate)) return candidate;
	}
	return `${VERBATIM_PREFIX}${quote(match.value ?? text)}`;
}
