import { describe, expect, it } from "vitest";

import { answerFields, matchesAnswers, parseAnswerQuery, printAnswerQuery, type AnswerQuestion } from "../../src/core/forms";

const QUESTIONS: AnswerQuestion[] = [
	{ id: "q1", label: "Company", type: "text" },
	{ id: "q2", label: "What do you need?", type: "select", options: [{ id: "web", name: "Website" }, { id: "brand", name: "Brand refresh" }] },
	{ id: "q3", label: "Budget", type: "number" },
	{ id: "q4", label: "Launch", type: "date" },
	{ id: "q5", label: "Agree", type: "checkbox" },
	{ id: "q6", label: "Channels", type: "multiSelect", options: [{ id: "a", name: "Email" }, { id: "b", name: "Social" }] },
	{ id: "q7", label: "Company", type: "text" },
];
const FIELDS = answerFields(QUESTIONS);
const RESPONSE = { q1: "Northwind Ltd", q2: "web", q3: 18000, q4: "2026-12-12", q5: true, q6: ["b"] };

const run = (query: string, values: Record<string, unknown> = RESPONSE) => {
	const parsed = parseAnswerQuery(query, FIELDS);
	expect(parsed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
	return matchesAnswers(parsed, values as never, FIELDS);
};

describe("form answers in the query language", () => {
	it("names each question by a slug of its words, unique in the form", () => {
		expect(FIELDS.map((field) => field.slug)).toEqual(["company", "what-do-you-need", "budget", "launch", "agree", "channels", "company-2"]);
	});

	it("matches choices by name, numbers and days compared, checkboxes, text and lists", () => {
		expect(run("answer.what-do-you-need:Website")).toBe(true);
		expect(run('answer.what-do-you-need:"Brand refresh"')).toBe(false);
		expect(run("answer.what-do-you-need:website,brand")).toBe(true);
		expect(run("answer.budget:>=5000")).toBe(true);
		expect(run("answer.budget:<5000")).toBe(false);
		expect(run("answer.launch:<2027-01-01")).toBe(true);
		expect(run("answer.agree:yes")).toBe(true);
		expect(run("answer.company:north")).toBe(true);
		expect(run("answer.channels:social")).toBe(true);
		expect(run("answer.channels:email")).toBe(false);
	});

	it("reads any, unset, a leading - and words on their own", () => {
		expect(run("answer.company:any answer.company-2:unset")).toBe(true);
		expect(run("answer.company-2:any")).toBe(false);
		expect(run("-answer.what-do-you-need:Website")).toBe(false);
		expect(run("northwind website")).toBe(true);
		expect(run("northwind bakery")).toBe(false);
		expect(run("kind:response answer.budget:18000")).toBe(true);
	});

	it("an empty query matches every response", () => {
		expect(run("", {})).toBe(true);
	});

	it("names what it can't read, with the nearest question", () => {
		const parsed = parseAnswerQuery("answer.budjet:>5 status:done", FIELDS);
		expect(parsed.ok).toBe(false);
		expect(parsed.issues.map((issue) => [issue.code, issue.suggestion])).toEqual([
			["unknown-field", "answer.budget"],
			["unknown-field", undefined],
		]);
		const warned = parseAnswerQuery("answer.what-do-you-need:Logo", FIELDS);
		expect(warned.ok).toBe(true);
		expect(warned.issues[0].message).toContain("no choice");
	});

	it("prints clauses back to text that parses to the same clauses", () => {
		for (const source of [
			"answer.what-do-you-need:Website answer.budget:>=5000",
			'answer.what-do-you-need:"Brand refresh"',
			"-answer.company:acme answer.agree:no",
			"answer.company:any",
			"answer.launch:<=2026-12-31 answer.channels:Email,Social northwind",
		]) {
			const parsed = parseAnswerQuery(source, FIELDS);
			const printed = printAnswerQuery(parsed, FIELDS);
			expect(printed).toBe(source);
			expect(parseAnswerQuery(printed, FIELDS).clauses).toEqual(parsed.clauses);
		}
	});
});
