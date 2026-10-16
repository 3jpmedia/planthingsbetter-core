/**
 * Default taxonomy configurations for a new Workspace (-5.4).
 *
 * Every default here is overridable per Workspace - that is the whole point of
 * the taxonomy engine. These values simply mean a brand-new workspace is
 * immediately usable without visiting settings.
 */

import type {
  LabelValue,
  PriorityValue,
  StatusValue,
  TaskTypeValue,
} from "../types";

/**
 * The default status colors, by meaning. Pick from these first whenever
 * something needs a color (a meter, a badge, a chart series), so new UI
 * matches the rest of the app. They read well on light and dark backgrounds,
 * as fills, dots and bars; for small text use the theme's text colors.
 *
 *   neutral - queued, nothing yet      info    - to do, informational
 *   warning - in progress, nearly full good    - done, healthy
 *   danger  - canceled, full, failed
 *
 * A workspace can recolor its own statuses; these stay the app's defaults.
 */
export const STATUS_COLORS = {
  neutral: "#94a3b8",
  info: "#60a5fa",
  warning: "#fbbf24",
  good: "#34d399",
  danger: "#f87171",
} as const;

export type StatusColorRole = keyof typeof STATUS_COLORS;

/**
 * Default statuses map 1:1 to the fixed category enum, matching the common
 * default workflow. Users may rename, recolor, reorder, add and remove these
 * freely - the categories underneath never change.
 */
export const DEFAULT_STATUSES: StatusValue[] = [
  {
    id: "queue",
    name: "Queue",
    color: STATUS_COLORS.neutral,
    category: "backlog",
    order: 1,
  },
  {
    id: "todo",
    name: "Todo",
    color: STATUS_COLORS.info,
    category: "unstarted",
    order: 2,
  },
  {
    id: "in-progress",
    name: "In Progress",
    color: STATUS_COLORS.warning,
    category: "started",
    order: 3,
  },
  {
    id: "done",
    name: "Done",
    color: STATUS_COLORS.good,
    category: "completed",
    order: 4,
  },
  {
    id: "canceled",
    name: "Canceled",
    color: STATUS_COLORS.danger,
    category: "canceled",
    order: 5,
  },
];

/**
 * Fully flexible and ordered - order carries meaning, count does not.
 *
 * There is no "No Priority" rung: an un-prioritised task simply has `priority:
 * null`, rendered as "None". A dedicated value would be a second way to say the
 * same thing (and would show as its own board column next to the null bucket).
 */
export const DEFAULT_PRIORITIES: PriorityValue[] = [
  { id: "urgent", name: "Urgent", color: "#ef4444", order: 1 },
  { id: "high", name: "High", color: "#f97316", order: 2 },
  { id: "medium", name: "Medium", color: "#eab308", order: 3 },
  { id: "low", name: "Low", color: "#3b82f6", order: 4 },
];

export const DEFAULT_TASK_TYPES: TaskTypeValue[] = [
  { id: "bug", name: "Bug", color: "#ef4444" },
  { id: "feature", name: "Feature", color: "#3b82f6" },
  { id: "chore", name: "Chore", color: "#94a3b8" },
];

/** Workspaces start with no labels - labels are inherently project-specific. */
export const DEFAULT_LABELS: LabelValue[] = [];

/**
 * Default status for brand-new tasks. Configurable independently of category
 * - this is a status *id*, not "the first backlog status".
 */
export const DEFAULT_NEW_TASK_STATUS = "queue";
