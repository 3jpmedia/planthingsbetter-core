/**
 * A field written twice, merged into one clause (T-1059).
 *
 * `-status:done -status:canceled` already reads as `-status:done,canceled`:
 * the parser puts both clauses' values in the same list, which matches any
 * of them (or, excluded, none of them). So the query bar merges the text
 * too, once the query applies, and shows one chip instead of two.
 *
 * Only the clauses merge; the rest of the text stays as it was typed. A
 * custom field's clauses stay apart, since each one has to match on its
 * own, and so do layout clauses, `text:` and `kind:`.
 */

import { ANY_KEYWORDS, FILTER_FIELD_BY_TOKEN, FLAG_FIELD_ALIASES, KIND_FIELD, selfField } from "./grammar";
import { lex, type LexedToken } from "./lex";

type Clause = Extract<LexedToken, { kind: "clause" }>;

/** Which list a clause's values go into, or null when it doesn't merge. */
function mergeKey(token: Clause): string | null {
	if (token.values.length === 0) return null;
	const field = selfField(FLAG_FIELD_ALIASES[token.field] ?? token.field);
	if (field === KIND_FIELD) return null;
	const filterKey = FILTER_FIELD_BY_TOKEN.get(field);
	if (!filterKey || filterKey === "text") return null;
	// `label:any` is printed as a clause of its own (it lands in the other
	// list), so it's left as one.
	const isAny = (text: string) => (ANY_KEYWORDS as readonly string[]).includes(text.trim().toLowerCase());
	if (token.values.every((value) => !value.verbatim && isAny(value.text))) return null;
	return `${token.excluded ? "-" : ""}${filterKey}`;
}

/** `source` with each field's repeated clauses merged into its first one;
 *  the same text when nothing repeats. */
export function mergeRepeatedClauses(source: string): string {
	const first = new Map<string, Clause>();
	const added = new Map<Clause, string[]>();
	const removed: Clause[] = [];
	for (const token of lex(source).tokens) {
		if (token.kind !== "clause") continue;
		const key = mergeKey(token);
		if (!key) continue;
		const into = first.get(key);
		if (!into) {
			first.set(key, token);
			continue;
		}
		// A value written again is left out -- as written: one that names
		// nothing is kept as typed, so its case matters.
		const values = added.get(into) ?? [];
		const have = new Set([...into.values.map((value) => source.slice(value.span.start, value.span.end).trim()), ...values]);
		for (const value of token.values) {
			const text = source.slice(value.span.start, value.span.end).trim();
			if (have.has(text)) continue;
			have.add(text);
			values.push(text);
		}
		added.set(into, values);
		removed.push(token);
	}
	if (removed.length === 0) return source;

	// Edits from the end back, so earlier offsets stay right.
	const edits: Array<{ start: number; end: number; text: string }> = [];
	for (const [into, values] of added) {
		if (values.length === 0) continue;
		const at = into.values[into.values.length - 1].span.end;
		edits.push({ start: at, end: at, text: `,${values.join(",")}` });
	}
	for (const token of removed) {
		// The clause and the space before it.
		let start = token.span.start;
		while (start > 0 && /\s/.test(source[start - 1])) start -= 1;
		edits.push({ start, end: token.span.end, text: "" });
	}
	// A removal starting where an insertion is goes first, so it doesn't
	// take the inserted values with it.
	edits.sort((a, b) => b.start - a.start || b.end - a.end);
	let out = source;
	for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
	return out;
}
