/**
 * Checklists on a task (`Checklist`, `ChecklistSummary` in types.ts): zero
 * or more named lists of items, each item ticked on its own. What both the
 * app and the plugin need to agree on about them -- how they're counted,
 * what "open" means, and how a name is compared -- lives here; their
 * markdown form is `serialization/checklists.ts`.
 */

import type { Checklist, ChecklistSummary, Task } from "./types";

/** The name a new checklist gets when none is given. */
export const DEFAULT_CHECKLIST_NAME = "Checklist";

/** A checklist's name as it's compared: trimmed, case-folded, inner
 *  spaces collapsed -- so `checklist:"after deploy"` finds "After  deploy". */
export const checklistNameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Each list, counted. */
export function summarizeChecklists(lists: readonly Checklist[]): ChecklistSummary[] {
	return lists.map((list) => ({
		name: list.name,
		done: list.items.filter((item) => item.done).length,
		total: list.items.length,
	}));
}

/** All of a task's lists together -- a card's "7/12". `null` when it has
 *  no items at all (nothing to show). */
export function checklistTotals(lists: readonly ChecklistSummary[] | undefined): { done: number; total: number } | null {
	if (!lists || lists.length === 0) return null;
	let done = 0;
	let total = 0;
	for (const list of lists) {
		done += list.done;
		total += list.total;
	}
	return total > 0 ? { done, total } : null;
}

/** Whether a list still has something to tick. */
export const isChecklistOpen = (list: ChecklistSummary): boolean => list.done < list.total;

/** `has:checklist`: at least one list, even an empty one. */
export const hasChecklist = (task: Pick<Task, "checklists">): boolean => (task.checklists?.length ?? 0) > 0;

/** `is:checklist-open`: an unticked item in any list. */
export const hasOpenChecklist = (task: Pick<Task, "checklists">): boolean => task.checklists?.some(isChecklistOpen) ?? false;

/** `checklist:<name>`: an unticked item in a list called one of `names`. */
export function hasOpenChecklistNamed(task: Pick<Task, "checklists">, names: readonly string[]): boolean {
	if (names.length === 0) return true;
	const wanted = new Set(names.map(checklistNameKey));
	return task.checklists?.some((list) => isChecklistOpen(list) && wanted.has(checklistNameKey(list.name))) ?? false;
}
