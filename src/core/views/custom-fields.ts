/**
 * Custom fields in views: matching a task against a custom field clause,
 * and ordering tasks by a custom field. A host's fields come in on the
 * snapshot (`WorkspaceSnapshot.customFields`) and reach evaluation through
 * the view context; a task's values are keyed by field id (`Task.fields`),
 * while clauses and sorts name a field by its key (`field:CF-0003`).
 */

import {
	SELF,
	customFieldKeyOf,
	customFieldRef,
	type CustomFieldDef,
	type CustomFieldFilter,
	type CustomFieldMatch,
	type CustomFieldValue,
	type SavedView,
	type Task,
} from "../types";
import type { ViewContext } from "./context";

/** The field a key names, if the host has it. */
export function customFieldByKey(context: Pick<ViewContext, "customFields">, key: string): CustomFieldDef | undefined {
	const wanted = key.toUpperCase();
	return context.customFields?.find((field) => field.key.toUpperCase() === wanted);
}

/** A task's value for a field, or undefined when it has none. An empty
 *  list or an unchecked box counts as none. */
export function customValueOf(task: Task, field: CustomFieldDef): CustomFieldValue | undefined {
	const value = task.fields?.[field.id];
	if (value == null || value === "" || value === false) return undefined;
	if (Array.isArray(value) && value.length === 0) return undefined;
	return value;
}

const day = (value: string) => value.slice(0, 10);
const TRUE = new Set(["true", "yes", "y", "checked", "1", "on", "done"]);

function compareTo(field: CustomFieldDef, value: CustomFieldValue, target: string): number | null {
	if (field.type === "number") {
		const n = Number(target);
		if (typeof value !== "number" || !Number.isFinite(n)) return null;
		return value === n ? 0 : value < n ? -1 : 1;
	}
	if (field.type === "date") {
		if (typeof value !== "string") return null;
		const a = day(value);
		const b = day(target);
		return a === b ? 0 : a < b ? -1 : 1;
	}
	return null;
}

function matchesOne(task: Task, field: CustomFieldDef, match: CustomFieldMatch, context: ViewContext): boolean {
	const value = customValueOf(task, field);
	if (match.op === "unset") return value === undefined;
	// A checkbox never ticked is as unchecked as one unticked.
	if (field.type === "checkbox" && match.op === "eq" && match.value != null) return (value === true) === TRUE.has(match.value.toLowerCase());
	if (value === undefined || match.value == null) return false;
	const target = match.value === SELF ? (context.selfId ?? "\u0000") : match.value;
	if (match.op !== "eq") {
		const order = compareTo(field, value, target);
		if (order === null) return false;
		return match.op === "gt" ? order > 0 : match.op === "gte" ? order >= 0 : match.op === "lt" ? order < 0 : order <= 0;
	}
	switch (field.type) {
		case "select":
			return value === target;
		case "multiSelect":
		case "member":
			return Array.isArray(value) ? value.includes(target) : value === target;
		case "number":
		case "date":
			return compareTo(field, value, target) === 0;
		default:
			return String(value).toLowerCase().includes(target.toLowerCase());
	}
}

/** Whether a task passes every custom field clause. A clause naming a
 *  field the host doesn't have matches nothing (or, excluded, everything),
 *  the same as an unknown taxonomy value. */
export function matchesCustomFilters(task: Task, filters: readonly CustomFieldFilter[] | undefined, context: ViewContext): boolean {
	for (const clause of filters ?? []) {
		const field = customFieldByKey(context, clause.field);
		const any = field ? clause.matches.some((match) => matchesOne(task, field, match, context)) : false;
		if (clause.exclude ? any : !any) return false;
	}
	return true;
}

/**
 * The custom fields a view's rows and cards show, in the host's order: those
 * the view doesn't hide (`hiddenFields` holds `field:<key>`), and only where
 * they're in use -- some task in the view has a value, or the view filters,
 * sorts or groups by the field. `hiddenFields` stores what's hidden, so without that a
 * field just added would switch itself on as an empty column in every saved
 * view (see `renderedHiddenFields`); this way it shows up where it's used.
 */
export function shownCustomFields(
	view: Pick<SavedView, "hiddenFields" | "filters" | "sortBy"> & Partial<Pick<SavedView, "groupBy">>,
	tasks: readonly Task[],
	context: Pick<ViewContext, "customFields">,
): CustomFieldDef[] {
	const hidden = new Set<string>(view.hiddenFields.map((field) => field.toUpperCase()));
	const filtered = new Set((view.filters.custom ?? []).map((clause) => clause.field.toUpperCase()));
	const sorted = customFieldKeyOf(view.sortBy)?.toUpperCase();
	const grouped = view.groupBy ? customFieldKeyOf(view.groupBy)?.toUpperCase() : undefined;
	return (context.customFields ?? []).filter((field) => {
		const key = field.key.toUpperCase();
		if (hidden.has(customFieldRef(key).toUpperCase())) return false;
		return filtered.has(key) || sorted === key || grouped === key || tasks.some((task) => customValueOf(task, field) !== undefined);
	});
}

/** Signed comparison of two tasks by a custom field (`field:<key>`), unset
 *  last; null when the sort isn't a custom field. */
export function compareCustomField(
	a: Task,
	b: Task,
	sortField: string,
	context: ViewContext,
): { value: number; nullSkewed: boolean } | null {
	const key = customFieldKeyOf(sortField);
	if (!key) return null;
	const field = customFieldByKey(context, key);
	if (!field) return { value: 0, nullSkewed: false };
	const va = customValueOf(a, field);
	const vb = customValueOf(b, field);
	if (va === undefined || vb === undefined) {
		return { value: va === vb ? 0 : va === undefined ? 1 : -1, nullSkewed: va !== vb };
	}
	return { value: compareValues(field, va, vb, context), nullSkewed: false };
}

function compareValues(field: CustomFieldDef, a: CustomFieldValue, b: CustomFieldValue, context: ViewContext): number {
	switch (field.type) {
		case "number":
			return Number(a) - Number(b);
		case "checkbox":
			// Checked first.
			return a === b ? 0 : a === true ? -1 : 1;
		case "select":
		case "multiSelect": {
			// In the choices' order (a multi-select by its first choice).
			const position = (value: CustomFieldValue) => {
				const id = Array.isArray(value) ? value[0] : value;
				const index = (field.options ?? []).findIndex((option) => option.id === id);
				return index === -1 ? Number.POSITIVE_INFINITY : index;
			};
			const pa = position(a);
			const pb = position(b);
			return pa === pb ? 0 : pa < pb ? -1 : 1;
		}
		case "member": {
			const name = (value: CustomFieldValue) => {
				const id = Array.isArray(value) ? value[0] : String(value);
				return context.people.find((person) => person.id === id)?.name ?? id;
			};
			return name(a).localeCompare(name(b));
		}
		case "date":
			return day(String(a)).localeCompare(day(String(b)));
		default:
			return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
	}
}
