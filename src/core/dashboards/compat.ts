/**
 * The chart-type → allowed-fields compatibility matrix (§Dashboards Phase 1).
 *
 * This is the single source of truth the config popover derives its option
 * lists from - invalid combinations are unrepresentable *by construction*, not
 * merely rejected at the UI layer. The serializer (`serialization/dashboards`)
 * runs the same `isFieldMappingValid` check and falls back gracefully when a
 * hand-edited dashboard note names something impossible.
 */

import {
	DASHBOARD_GROUPING_FIELDS,
	DASHBOARD_METRICS,
	DASHBOARD_TEMPORAL_FIELDS,
	DASHBOARD_TIME_BUCKETS,
	isCustomFieldRef,
	type ChartType,
	type CustomFieldDef,
	type CustomFieldRef,
	type DashboardFieldMapping,
	type DashboardGroupBy,
	type DashboardGroupingField,
	type DashboardMetric,
	type DashboardTemporalField,
	type DashboardTimeBucket,
} from "../types";
import type { ViewContext } from "../views/context";
import { isGroupableCustomField } from "../views/group";

/** Bar / Pie group by a discrete field; Line / Timeline plot a temporal one. */
export function isDiscreteChart(chartType: ChartType): boolean {
	return chartType === "bar" || chartType === "pie";
}

export function isTemporalChart(chartType: ChartType): boolean {
	return chartType === "line" || chartType === "timeline";
}

/** Grouping fields a discrete chart (or a line/timeline secondary split) allows. */
export function groupingFieldsFor(): readonly DashboardGroupingField[] {
	return DASHBOARD_GROUPING_FIELDS;
}

/** The custom fields a chart can group by (a select, multi-select or
 *  member field), from the workspace's, in their order. */
export function groupableCustomFields(
	context: Pick<ViewContext, "customFields">,
): CustomFieldDef[] {
	return (context.customFields ?? []).filter(isGroupableCustomField);
}

/** The custom fields `fieldSum` and `fieldAvg` can measure (number fields). */
export function measurableCustomFields(
	context: Pick<ViewContext, "customFields">,
): CustomFieldDef[] {
	return (context.customFields ?? []).filter((field) => field.type === "number");
}

/** Whether a metric adds or averages a number custom field. */
export function isFieldMetric(metric: DashboardMetric | undefined): boolean {
	return metric === "fieldSum" || metric === "fieldAvg";
}

export function temporalFieldsFor(): readonly DashboardTemporalField[] {
	return DASHBOARD_TEMPORAL_FIELDS;
}

export function timeBucketsFor(): readonly DashboardTimeBucket[] {
	return DASHBOARD_TIME_BUCKETS;
}

export function metricsFor(): readonly DashboardMetric[] {
	return DASHBOARD_METRICS;
}

function isBuiltInGrouping(value: unknown): value is DashboardGroupingField {
	return DASHBOARD_GROUPING_FIELDS.includes(value as DashboardGroupingField);
}

/** A built-in grouping, or a custom field's reference (whether the field
 *  exists, and fits, is checked where the workspace's fields are known). */
function isGroupingField(value: unknown): value is DashboardGroupBy {
	return isBuiltInGrouping(value) || isCustomFieldRef(value);
}

function isTemporalField(value: unknown): value is DashboardTemporalField {
	return DASHBOARD_TEMPORAL_FIELDS.includes(value as DashboardTemporalField);
}

function isTimeBucket(value: unknown): value is DashboardTimeBucket {
	return DASHBOARD_TIME_BUCKETS.includes(value as DashboardTimeBucket);
}

function isMetric(value: unknown): value is DashboardMetric {
	return DASHBOARD_METRICS.includes(value as DashboardMetric);
}

/** A metric with the field it needs: the number custom field's reference for
 *  `fieldSum` / `fieldAvg`, and none for any other. */
function isMeasure(metric: unknown, metricField: unknown): boolean {
	if (!isMetric(metric)) return false;
	return isFieldMetric(metric) ? isCustomFieldRef(metricField) : metricField === undefined;
}

/**
 * True when `mapping` is a legal combination for its own `chartType`. Used both
 * by the parser (drop/repair invalid) and by tests.
 */
export function isFieldMappingValid(mapping: DashboardFieldMapping): boolean {
	switch (mapping.chartType) {
		case "bar":
			return (
				isGroupingField(mapping.groupBy) &&
				(mapping.metric === undefined || isMeasure(mapping.metric, mapping.metricField))
			);
		case "pie":
			return isGroupingField(mapping.groupBy);
		case "line":
		case "timeline":
			return (
				isTemporalField(mapping.xField) &&
				isTimeBucket(mapping.bucket) &&
				(mapping.groupBy === null || isGroupingField(mapping.groupBy)) &&
				(mapping.chartType === "timeline" ||
					mapping.metric === undefined ||
					isMeasure(mapping.metric, mapping.metricField))
			);
		case "kpi":
			return (
				isMeasure(mapping.metric, mapping.metricField) &&
				(mapping.scope === null ||
					(isGroupingField(mapping.scope.field) &&
						typeof mapping.scope.value === "string" &&
						mapping.scope.value.length > 0))
			);
	}
}

/**
 * A safe default mapping for a freshly chosen chart type - the first allowed
 * field of each kind. Every widget always has a *valid* mapping.
 */
export function defaultFieldMapping(chartType: ChartType): DashboardFieldMapping {
	switch (chartType) {
		case "bar":
			return { chartType: "bar", groupBy: "status" };
		case "pie":
			return { chartType: "pie", groupBy: "status" };
		case "line":
			return {
				chartType: "line",
				xField: "createdAt",
				bucket: "week",
				groupBy: null,
			};
		case "timeline":
			return {
				chartType: "timeline",
				xField: "createdAt",
				bucket: "week",
				groupBy: null,
			};
		case "kpi":
			return { chartType: "kpi", metric: "count", scope: null };
	}
}

/** Which chart types measure something other than a count: a bar's or
 *  line's height can be any metric; a pie's slices and a timeline's running
 *  total must add up, and a KPI always names its own. */
export function measuresMetric(chartType: ChartType): boolean {
	return chartType === "bar" || chartType === "line";
}

/** The metric a mapping measures (a count unless it says otherwise), with
 *  the number custom field it reads, if any. */
function metricOf(
	from: DashboardFieldMapping,
): { metric: DashboardMetric; metricField?: CustomFieldRef } | undefined {
	if (!("metric" in from) || !from.metric || from.metric === "count" || !isMetric(from.metric)) {
		return undefined;
	}
	const metricField = "metricField" in from ? from.metricField : undefined;
	if (isFieldMetric(from.metric)) {
		return metricField ? { metric: from.metric, metricField } : undefined;
	}
	return { metric: from.metric };
}

/**
 * Re-shape an existing mapping onto a new chart type, keeping whatever still
 * applies (a grouping field survives bar↔pie; a temporal field survives
 * line↔timeline; a measure survives among bar, line and KPI) and filling
 * the rest from `defaultFieldMapping`.
 */
export function retargetFieldMapping(
	from: DashboardFieldMapping,
	chartType: ChartType,
): DashboardFieldMapping {
	const base = defaultFieldMapping(chartType);
	const metric = metricOf(from);
	const withMetric = <T extends DashboardFieldMapping>(mapping: T): T =>
		metric && measuresMetric(chartType) ? { ...mapping, ...metric } : mapping;

	if (chartType === "kpi") {
		return metric ? { chartType, ...metric, scope: null } : base;
	}

	if ((chartType === "bar" || chartType === "pie") && "groupBy" in from) {
		const groupBy = from.groupBy;
		if (groupBy && isGroupingField(groupBy)) {
			return chartType === "bar"
				? withMetric({ chartType, groupBy })
				: { chartType, groupBy };
		}
	}

	if (
		(chartType === "line" || chartType === "timeline") &&
		"xField" in from &&
		isTemporalField(from.xField)
	) {
		const groupBy =
			"groupBy" in from && from.groupBy && isGroupingField(from.groupBy)
				? from.groupBy
				: null;
		const bucket = isTimeBucket(from.bucket) ? from.bucket : "week";
		return chartType === "line"
			? withMetric({ chartType, xField: from.xField, bucket, groupBy })
			: { chartType, xField: from.xField, bucket, groupBy };
	}

	return withMetric(base);
}
