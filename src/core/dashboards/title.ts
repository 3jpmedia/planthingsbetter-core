/**
 * Auto-generated widget titles (§Dashboards Phase 1).
 *
 * "Tasks by Status", "Estimate sum where Status is Done", etc. Once a user
 * renames a widget (`titleIsCustom`), these never overwrite it - the caller
 * checks that flag, not this module.
 */

import { NONE, customFieldKeyOf } from "../types";
import type {
  CustomFieldDef,
  CustomFieldRef,
  DashboardFieldMapping,
  DashboardGoal,
  DashboardGroupBy,
  DashboardGroupingField,
  DashboardMetric,
  DashboardScope,
  DashboardTemporalField,
} from "../types";
import type { ViewContext } from "../views/context";
import { displayName } from "../taxonomy/engine";
import { basename } from "../links";
import { customFieldByKey } from "../views/custom-fields";
import { groupingField } from "../views/group";

const GROUPING_LABEL: Record<DashboardGroupingField, string> = {
  status: "Status",
  priority: "Priority",
  taskType: "Type",
  label: "Label",
  assignee: "Assignee",
  project: "Project",
  milestone: "Milestone",
  space: "Space",
};

const TEMPORAL_LABEL: Record<DashboardTemporalField, string> = {
  dueDate: "Due date",
  startDate: "Start date",
  createdAt: "Created date",
  updatedAt: "Updated date",
  startedAt: "Started date",
  completedAt: "Completed date",
};

const METRIC_LABEL: Record<DashboardMetric, string> = {
  count: "Task count",
  estimateSum: "Estimate sum",
  estimateAvg: "Average estimate",
  cycleTimeAvg: "Average cycle time",
  cycleTimeMedian: "Median cycle time",
  fieldSum: "Sum",
  fieldAvg: "Average",
};

/** A grouping's name: a built-in's, or a custom field's own (its current
 *  name, so a rename shows; "a removed field" once it's gone). */
export function groupingFieldLabel(
  field: DashboardGroupBy,
  context?: Pick<ViewContext, "customFields">,
): string {
  const key = customFieldKeyOf(field);
  if (key) return (context && customFieldByKey(context, key)?.name) ?? "a removed field";
  return GROUPING_LABEL[field as DashboardGroupingField];
}

export function temporalFieldLabel(field: DashboardTemporalField): string {
  return TEMPORAL_LABEL[field];
}

/** A metric's name. `field`: the number custom field `fieldSum` and
 *  `fieldAvg` read ("Points sum", "Average points"). */
export function metricLabel(
  metric: DashboardMetric,
  field?: Pick<CustomFieldDef, "name">,
): string {
  if (metric === "fieldSum") return field ? `${field.name} sum` : "Sum of a field";
  if (metric === "fieldAvg") return field ? `Average ${field.name.toLowerCase()}` : "Average of a field";
  return METRIC_LABEL[metric];
}

/** Human name for one discrete value of a grouping field. */
export function valueLabel(
  field: DashboardGroupBy,
  value: string,
  context: ViewContext,
): string {
  if (customFieldKeyOf(field)) {
    const def = groupingField(field as CustomFieldRef, context);
    if (!def) return value;
    if (value === NONE) return `No ${def.name.toLowerCase()}`;
    if (def.type === "member") return context.people.find((p) => p.id === value)?.name ?? value;
    return def.options?.find((o) => o.id === value)?.name ?? value;
  }
  field = field as DashboardGroupingField;
  if (value === NONE) {
    return field === "assignee"
      ? "Unassigned"
      : field === "project"
        ? "No project"
        : `No ${GROUPING_LABEL[field].toLowerCase()}`;
  }
  switch (field) {
    case "status":
    case "priority":
    case "taskType":
      return displayName(context.taxonomies[field], value, value);
    case "label":
      return displayName(context.taxonomies.label, value, value);
    case "assignee":
      return context.people.find((p) => p.id === value)?.name ?? value;
    case "project":
      return context.titles?.get(value) ?? basename(value);
    case "milestone":
      return context.milestones?.get(value)?.title ?? basename(value);
    case "space":
      return context.spaces?.get(value)?.title ?? basename(value);
  }
}

function describeScope(scope: DashboardScope, context: ViewContext): string {
  return `${groupingFieldLabel(scope.field, context)} is ${valueLabel(scope.field, scope.value, context)}`;
}

/** What a bar or line measures, as a title's head: "Tasks" for a count. */
function measured(
  metric: DashboardMetric | undefined,
  metricField: CustomFieldRef | undefined,
  context: ViewContext,
): string {
  if (!metric || metric === "count") return "Tasks";
  return metricLabel(metric, fieldOf(metricField, context));
}

function fieldOf(
  ref: CustomFieldRef | undefined,
  context: Pick<ViewContext, "customFields">,
): CustomFieldDef | undefined {
  const key = ref ? customFieldKeyOf(ref) : null;
  return key ? customFieldByKey(context, key) : undefined;
}

const PER_PERIOD = { day: "a day", week: "a week", month: "a month" } as const;

/** A goal in words, for a title: "goal 2 a week" (T-1128). */
export function goalLabel(goal: DashboardGoal): string {
  return `goal ${goal.amount.toLocaleString("en-US")}${goal.period ? ` ${PER_PERIOD[goal.period]}` : ""}`;
}

export function autoTitle(
  mapping: DashboardFieldMapping,
  context: ViewContext,
): string {
  switch (mapping.chartType) {
    case "bar": {
      const head = `${measured(mapping.metric, mapping.metricField, context)} by ${groupingFieldLabel(mapping.groupBy, context)}`;
      const split = mapping.splitBy ? `, split by ${groupingFieldLabel(mapping.splitBy, context)}` : "";
      return `${head}${split}${mapping.goal ? `, ${goalLabel(mapping.goal)}` : ""}`;
    }
    case "pie":
      return `Tasks by ${groupingFieldLabel(mapping.groupBy, context)}`;
    case "table":
      return mapping.columns
        ? `${measured(mapping.metric, mapping.metricField, context)} by ${groupingFieldLabel(mapping.rows, context)} and ${groupingFieldLabel(mapping.columns, context)}`
        : `${measured(mapping.metric, mapping.metricField, context)} by ${groupingFieldLabel(mapping.rows, context)}`;
    case "line":
    case "timeline": {
      const head =
        mapping.chartType === "timeline"
          ? `Cumulative tasks by ${TEMPORAL_LABEL[mapping.xField]}`
          : `${measured(mapping.metric, mapping.metricField, context)} by ${TEMPORAL_LABEL[mapping.xField]}`;
      return mapping.groupBy
        ? `${head}, split by ${groupingFieldLabel(mapping.groupBy, context)}`
        : head;
    }
    case "kpi": {
      const head = mapping.scope
        ? `${metricLabel(mapping.metric, fieldOf(mapping.metricField, context))} where ${describeScope(mapping.scope, context)}`
        : metricLabel(mapping.metric, fieldOf(mapping.metricField, context));
      return mapping.goal ? `${head}, ${goalLabel(mapping.goal)}` : head;
    }
    case "graph":
      return "Graph";
  }
}
