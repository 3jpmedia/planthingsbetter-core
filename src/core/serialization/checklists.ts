/**
 * The `## Checklists` section of a task note: a task's named checklists
 * (types.ts `Checklist`), one `### <name>` per list and a `- [ ]` / `- [x]`
 * line per item, fenced like the description so rewriting it never touches
 * anything else in the note:
 *
 *     <!-- PLUGIN_CHECKLISTS_START -->
 *     ## Checklists
 *     ### Done when
 *     - [x] Send test email
 *     - [ ] Check the logs
 *     <!-- PLUGIN_CHECKLISTS_END -->
 *
 * It sits after the description block and before the comments block.
 * Reading is forgiving: a hand-written `## Checklists` section without the
 * fence counts too (up to the next `#`/`##` heading or plugin block), as do
 * `*`/`+` bullets and `[X]`; items before any `### ` heading go in a list
 * called "Checklist". Pure string surgery, like description.ts.
 */

import { DEFAULT_CHECKLIST_NAME } from "../checklists";
import type { Checklist, ChecklistItem } from "../types";
import { COMMENTS_START } from "./comments";
import { DESCRIPTION_END_TAG } from "./description";

export const CHECKLISTS_START_TAG = "<!-- PLUGIN_CHECKLISTS_START -->";
export const CHECKLISTS_END_TAG = "<!-- PLUGIN_CHECKLISTS_END -->";
export const CHECKLISTS_HEADING = "## Checklists";

/** One line, as a name or an item has to be. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** The lists as their fenced block -- `""` for none, so a note without
 *  checklists has no section at all. */
export function serializeChecklists(lists: readonly Checklist[] | undefined | null): string {
	if (!lists || lists.length === 0) return "";
	const lines = [CHECKLISTS_START_TAG, CHECKLISTS_HEADING];
	for (const list of lists) {
		lines.push(`### ${oneLine(list.name) || DEFAULT_CHECKLIST_NAME}`);
		for (const item of list.items) lines.push(`- [${item.done ? "x" : " "}] ${oneLine(item.text)}`);
	}
	lines.push(CHECKLISTS_END_TAG);
	return lines.join("\n");
}

const ITEM_RE = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const LIST_RE = /^###\s+(.*)$/;

/** The lists in a section's lines (heading already off). */
function parseLines(lines: readonly string[]): Checklist[] {
	const lists: Checklist[] = [];
	let current: Checklist | null = null;
	for (const line of lines) {
		const heading = LIST_RE.exec(line.trim());
		if (heading) {
			current = { name: oneLine(heading[1]) || DEFAULT_CHECKLIST_NAME, items: [] };
			lists.push(current);
			continue;
		}
		const item = ITEM_RE.exec(line);
		if (!item) continue;
		const text = oneLine(item[2]);
		if (!text) continue;
		if (!current) {
			current = { name: DEFAULT_CHECKLIST_NAME, items: [] };
			lists.push(current);
		}
		current.items.push({ text, done: item[1] !== " " } satisfies ChecklistItem);
	}
	return lists;
}

interface Section {
	start: number;
	end: number;
	/** The section's lines, its heading left out. */
	lines: string[];
}

/** Where the checklists section is in `body`, fenced or not. */
function findSection(body: string): Section | null {
	const start = body.indexOf(CHECKLISTS_START_TAG);
	const end = start === -1 ? -1 : body.indexOf(CHECKLISTS_END_TAG, start);
	if (start !== -1 && end !== -1) {
		const inner = body.slice(start + CHECKLISTS_START_TAG.length, end);
		const lines = inner.split(/\r?\n/).filter((line) => line.trim() !== CHECKLISTS_HEADING);
		return { start, end: end + CHECKLISTS_END_TAG.length, lines };
	}
	// Unfenced: a `## Checklists` heading on its own line, outside the
	// description and comments blocks.
	const heading = /^##\s+Checklists\s*$/im.exec(body);
	if (!heading) return null;
	const at = heading.index;
	const descriptionStart = body.indexOf("<!-- PLUGIN_DESCRIPTION_START -->");
	const descriptionEnd = body.indexOf(DESCRIPTION_END_TAG);
	if (descriptionStart !== -1 && descriptionEnd !== -1 && at > descriptionStart && at < descriptionEnd) return null;
	const commentsStart = body.indexOf(COMMENTS_START);
	if (commentsStart !== -1 && at > commentsStart) return null;
	const after = at + heading[0].length;
	const rest = body.slice(after);
	const stop = /^(#{1,2}\s|<!-- PLUGIN_)/m.exec(rest);
	const sectionEnd = stop ? after + stop.index : body.length;
	return { start: at, end: sectionEnd, lines: body.slice(after, sectionEnd).split(/\r?\n/) };
}

/** The checklists in a note body, in order; `[]` when it has none. */
export function parseChecklists(body: string): Checklist[] {
	const section = findSection(body);
	return section ? parseLines(section.lines) : [];
}

/**
 * `body` with its checklists section made `lists`: replaced where it is,
 * taken out (with the blank lines around it) when `lists` is empty, or --
 * new -- put after the description block, else before the comments block,
 * else at the end. Nothing else in the note changes.
 */
export function replaceChecklists(body: string, lists: readonly Checklist[] | undefined | null): string {
	const block = serializeChecklists(lists);
	const section = findSection(body);
	if (section) {
		const before = body.slice(0, section.start);
		const after = body.slice(section.end);
		if (block) return `${before}${block}${after.startsWith("\n") || !after ? after : `\n${after}`}`;
		return joinParts(before.replace(/\n+$/, ""), after.replace(/^\n+/, ""));
	}
	if (!block) return body;
	const descriptionEnd = body.indexOf(DESCRIPTION_END_TAG);
	if (descriptionEnd !== -1) {
		const cut = descriptionEnd + DESCRIPTION_END_TAG.length;
		return joinParts(joinParts(body.slice(0, cut), block), body.slice(cut).replace(/^\n+/, ""));
	}
	const commentsStart = body.indexOf(COMMENTS_START);
	if (commentsStart !== -1) return joinParts(joinParts(body.slice(0, commentsStart).replace(/\n+$/, ""), block), body.slice(commentsStart));
	return joinParts(body.replace(/\n+$/, ""), block) + (body.endsWith("\n") ? "\n" : "");
}

/** Two parts of a note with one blank line between them (none when one is empty). */
function joinParts(a: string, b: string): string {
	if (!a) return b;
	if (!b) return a;
	return `${a}\n\n${b}`;
}
