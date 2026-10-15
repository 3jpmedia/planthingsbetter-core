/**
 * A form's answers in the query language (T-0730): `answer.<question>:value`,
 * which a form's rules use to pick where a response goes --
 * `answer.request-type:Website answer.budget:>=5000`.
 *
 * Each question reads as a custom field does (query/custom.ts), with the
 * same values: a choice by name, a number or a day exactly or compared
 * (`>3`, `<=2026-11-01`), a checkbox `yes` / `no`, text by what it contains,
 * `unset` for no answer and `any` for one; a leading `-` excludes and a
 * comma lists alternatives. A word on its own matches any answer that
 * contains it. So a host hands its questions over as custom field
 * definitions (`answerFields`) and gets back clauses it can test against a
 * response (`matchesAnswers`) and print again (`printAnswerQuery`) -- the
 * same round trip a task query and its filters make.
 */

import { slugify } from "../ids";
import { emptyQueryContext, type QueryContext } from "../query/context";
import { parseCustomValue, printCustomMatch } from "../query/custom";
import { ANY_KEYWORDS, KIND_FIELD } from "../query/grammar";
import { lex } from "../query/lex";
import type { QueryIssue } from "../query/types";
import type { CustomFieldDef, CustomFieldFilter, CustomFieldType, CustomFieldValue, Task, WorkspaceConfig } from "../types";
import { viewContext, type ViewContext } from "../views/context";
import { matchesCustomFilters } from "../views/custom-fields";

export const ANSWER_PREFIX = "answer.";

/** A question as a host has it: its id, its words, how it's answered. */
export interface AnswerQuestion {
	id: string;
	label: string;
	type: CustomFieldType;
	options?: { id: string; name: string }[];
}

/**
 * Each question as a custom field: its id as both id and key, and a slug
 * from its words, unique in the form ("Your name" → `your-name`, a second
 * one `your-name-2`). A question with no words is named by its id.
 */
export function answerFields(questions: readonly AnswerQuestion[]): CustomFieldDef[] {
	const taken: string[] = [];
	return questions.map((question) => {
		const slug = slugify(question.label.trim() || question.id, taken);
		taken.push(slug);
		return {
			id: question.id,
			key: question.id,
			slug,
			name: question.label.trim() || question.id,
			type: question.type,
			...(question.options ? { options: question.options.map((option) => ({ id: option.id, name: option.name, color: "" })) } : {}),
		};
	});
}

/** How a query names a question: `answer.<slug>`. */
export const answerToken = (field: Pick<CustomFieldDef, "slug">) => `${ANSWER_PREFIX}${field.slug}`;

export interface AnswerQuery {
	/** One clause per `answer.` field typed, keyed by the question's id. */
	clauses: CustomFieldFilter[];
	/** Words on their own: every one must appear in some answer. */
	text: string;
	issues: QueryIssue[];
	/** No issue is an error. */
	ok: boolean;
}

const isAny = (text: string, verbatim: boolean) => !verbatim && (ANY_KEYWORDS as readonly string[]).includes(text.trim().toLowerCase());

function contexts(fields: readonly CustomFieldDef[]): { query: QueryContext; view: ViewContext } {
	const workspace = { statuses: [], priorities: [], taskTypes: [], labels: [], people: [] } as unknown as WorkspaceConfig;
	return { query: { ...emptyQueryContext(), customFields: [...fields] }, view: { ...viewContext(workspace), customFields: [...fields] } };
}

/** The nearest question to a mistyped `answer.` name, if one is close. */
function nearest(name: string, fields: readonly CustomFieldDef[]): string | undefined {
	const distance = (a: string, b: string) => {
		let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
		for (let i = 1; i <= a.length; i += 1) {
			const current = [i];
			for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			previous = current;
		}
		return previous[b.length];
	};
	let best: string | undefined;
	let bestDistance = 3;
	for (const field of fields) {
		const d = distance(name, field.slug);
		if (d < bestDistance) {
			bestDistance = d;
			best = answerToken(field);
		}
	}
	return best;
}

/**
 * Query text → clauses about a response. Never throws: what can't be read
 * is an issue with its span, like a task query's. `kind:response` (or
 * `kind:form`) is allowed and adds nothing; any other field is an error.
 */
export function parseAnswerQuery(source: string, fields: readonly CustomFieldDef[]): AnswerQuery {
	const { tokens, issues: lexIssues } = lex(source);
	const issues: QueryIssue[] = [...lexIssues];
	const clauses: CustomFieldFilter[] = [];
	const words: string[] = [];
	const { query } = contexts(fields);
	for (const token of tokens) {
		if (token.kind === "bare") {
			words.push(token.value.text);
			continue;
		}
		if (token.field === KIND_FIELD && token.values.every((value) => ["response", "form"].includes(value.text.trim().toLowerCase()))) continue;
		if (!token.field.startsWith(ANSWER_PREFIX)) {
			issues.push({ severity: "error", code: "unknown-field", message: `"${token.field}" isn't a question - a rule reads answers, as answer.<question>`, span: token.fieldSpan });
			continue;
		}
		const name = token.field.slice(ANSWER_PREFIX.length);
		const field = fields.find((candidate) => candidate.slug === name || candidate.id.toLowerCase() === name);
		if (!field) {
			const suggestion = nearest(name, fields);
			issues.push({ severity: "error", code: "unknown-field", message: `"${token.field}" isn't one of this form's questions`, span: token.fieldSpan, ...(suggestion ? { suggestion } : {}) });
			continue;
		}
		if (token.values.length === 0) {
			issues.push({ severity: "error", code: "empty-value", message: `"${token.field}" needs a value`, span: token.span });
			continue;
		}
		// `any` is excluding "no answer", as for custom fields.
		const anyValue = token.values.some((value) => isAny(value.text, value.verbatim));
		const matches = token.values
			.filter((value) => !isAny(value.text, value.verbatim))
			.map((value) => {
				const parsed = parseCustomValue(field, value.text, value.verbatim, query);
				if (parsed.issue) issues.push({ ...parsed.issue, message: parsed.issue.message.split(`custom.${field.slug}`).join(answerToken(field)), span: value.span });
				return parsed.match;
			});
		if (matches.length > 0) clauses.push({ field: field.key, matches, ...(token.excluded ? { exclude: true } : {}) });
		if (anyValue) clauses.push({ field: field.key, matches: [{ op: "unset" }], ...(token.excluded ? {} : { exclude: true }) });
	}
	return { clauses, text: words.join(" ").trim(), issues, ok: !issues.some((issue) => issue.severity === "error") };
}

const quoteIfNeeded = (text: string) => (/^[^\s"():,]+$/.test(text) ? text : `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);

/** Clauses back to query text, in the order given (what a picker writes). */
export function printAnswerQuery(query: Pick<AnswerQuery, "clauses" | "text">, fields: readonly CustomFieldDef[]): string {
	const { query: context } = contexts(fields);
	const parts: string[] = [];
	for (const clause of query.clauses) {
		const field = fields.find((candidate) => candidate.key === clause.field);
		if (!field) continue;
		const token = answerToken(field);
		if (clause.exclude && clause.matches.length > 0 && clause.matches.every((match) => match.op === "unset")) {
			parts.push(`${token}:any`);
			continue;
		}
		const rendered = clause.matches.map((match) => printCustomMatch(field, match, context));
		parts.push(`${clause.exclude ? "-" : ""}${token}:${rendered.join(",")}`);
	}
	for (const word of query.text.split(/\s+/).filter(Boolean)) parts.push(quoteIfNeeded(word));
	return parts.join(" ");
}

/** A response's answers as a custom field holds them: a choice by its id,
 *  several as a list, a number, a day (YYYY-MM-DD), a checkbox, or text. */
export type AnswerValues = Record<string, CustomFieldValue>;

/**
 * Whether a response passes every clause and word. A response is tested as
 * a task whose custom values are its answers, so it matches exactly as the
 * same query would match a task's custom fields.
 */
export function matchesAnswers(query: Pick<AnswerQuery, "clauses" | "text">, values: AnswerValues, fields: readonly CustomFieldDef[]): boolean {
	const { view } = contexts(fields);
	const response = { fields: values, space: null, taskType: null } as unknown as Task;
	if (!matchesCustomFilters(response, query.clauses, view)) return false;
	const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = fields
		.map((field) => {
			const value = values[field.id];
			if (value == null) return "";
			const named = (id: string) => field.options?.find((option) => option.id === id)?.name ?? id;
			if (field.type === "select") return named(String(value));
			if (field.type === "multiSelect" && Array.isArray(value)) return value.map(named).join(" ");
			return Array.isArray(value) ? value.join(" ") : String(value);
		})
		.join("\n")
		.toLowerCase();
	return words.every((word) => haystack.includes(word));
}
