---
templateSchema: 1
type: vertex-flow-workspace-template
id: product-team
name: Product Team
description: A small product team shipping a mobile release and a billing overhaul - linked tasks, a sprint board, and dashboards for the whole team.
icon: rocket
supportsExampleContent: true
history: true

statuses: ["Backlog (backlog, #94a3b8) - Not planned yet", "To Do (unstarted, #60a5fa) - Planned for this cycle", "In Progress (started, #fbbf24) - Someone is on it", "In Review (started, #a78bfa) - Waiting on review or QA", "Done (completed, #34d399) - Shipped", "Canceled (canceled, #f87171) - Won't happen"]
taskTypes: ["Feature (#3b82f6) - New behavior people will notice", "Bug (#ef4444) - Something that's broken", "Design (#ec4899) - Mockups, prototypes and research", "Chore (#94a3b8) - Upkeep nobody sees"]
labels: ["Frontend (#06b6d4) - Web and mobile UI", "Backend (#8b5cf6) - APIs, data and jobs", "Customer request (#f59e0b) - Asked for by a customer", "Tech debt (#64748b) - Pays down past shortcuts", "Performance (#22c55e) - Faster, lighter, smoother"]
people: [You*, Maya Chen, Leo Park, Priya Nair, Sam Ortiz]

views:
  - name: Sprint Board
    description: This cycle's work by status - drag a card to move it along.
    icon: kanban
    type: board
    groupBy: status
  - name: Bugs to fix
    description: Every open bug, the most urgent first.
    icon: bug
    query: 'type:Bug is:open'
    sortBy: priority
  - name: Roadmap
    description: Everything with dates, on a timeline by project.
    icon: gantt-chart
    type: timeline
    groupBy: project
  - name: Dependencies
    description: How the work connects - what's blocking what.
    icon: workflow
    type: canvas

dashboards:
  - name: Team Overview
    description: Where the work stands, who's on what, and what's coming due.
    icon: gauge
    rows:
      - [{type: kpi, title: In Progress, metric: count, scope: {field: status, value: In Progress}}, {type: kpi, title: Open Bugs, metric: count, scope: {field: taskType, value: Bug}}, {type: kpi, title: Customer Requests, metric: count, scope: {field: label, value: Customer request}}]
      - [{type: bar, title: Tasks by Status, groupBy: status, weight: 7}, {type: pie, title: Tasks by Type, groupBy: taskType, weight: 5}]
      - [{type: bar, title: Work by Person, groupBy: assignee, weight: 6}, {type: timeline, title: Due Dates by Week, xField: dueDate, bucket: week, groupBy: status, weight: 6}]
---

# Projects

## Mobile App 2.0 {#mobile}
status: in-progress | created: -45d

The next major version of the mobile app: a new navigation, offline mode, and a faster task list. Beta goes out to TestFlight once offline sync lands, then the store submission.

**Goal:** ship to the stores by the end of the quarter.

## Billing Revamp {#billing}
status: in-progress | created: -30d

Moving billing to usage-based plans: new pricing page, a proper plan picker, and migrating every existing customer without anyone noticing.

## Onboarding Improvements {#onboarding}
status: to do | created: -12d

New sign-ups drop off before creating their first project. This project tries three fixes - a sample workspace, a shorter sign-up, and a checklist - and measures which one works.

## Q3 Web Release {#q3}
status: done | created: -80d

Shipped. Dark mode, keyboard shortcuts and the new search - kept here as a record of what went out and when.

# Tasks

## Design the new navigation {#nav-design}
project: Mobile App 2.0 | type: design | status: done | priority: high | labels: [Frontend] | assignee: Maya Chen | start: -40d | due: -30d | completed: -29d | created: -44d | blocks: [nav-shell]

:::description
## Description
A bottom tab bar with four destinations: **Home**, **Tasks**, **Inbox** and **Me**. Prototype in the design file; tested with five customers.

- [x] Low-fi sketches
- [x] Clickable prototype
- [x] Five customer tests
:::

:::comment Leo Park (-30d)
Looks great. The Inbox badge needs a count from the API - I'll add it to the sync endpoint.
:::

## Build the navigation shell {#nav-shell}
project: Mobile App 2.0 | type: feature | status: done | priority: high | labels: [Frontend] | assignee: Priya Nair | start: -28d | due: -18d | completed: -17d | created: -40d | blockedBy: [nav-design] | blocks: [port-tasks, port-settings]

The tab bar and routing, with each screen as a placeholder until it's ported.

## Port the task list to the new shell {#port-tasks}
project: Mobile App 2.0 | type: feature | status: in-progress | priority: high | labels: [Frontend, Performance] | assignee: Priya Nair | start: -10d | due: +3d | created: -30d | blockedBy: [nav-shell] | blocks: [beta]

:::description
## Description
The list was the slowest screen in 1.x. Virtualize it while porting it.
:::

### Virtualize long lists
type: feature | status: done | priority: medium | labels: [Performance] | assignee: Priya Nair | completed: -4d | created: -12d

Only the rows on screen are rendered - scrolling 2,000 tasks stays at 60fps.

### Swipe actions on rows
type: feature | status: in-progress | priority: medium | labels: [Frontend] | assignee: Priya Nair | due: +2d | created: -9d

Swipe right to complete, left to snooze.

## Port the settings screen {#port-settings}
project: Mobile App 2.0 | type: feature | status: in review | priority: medium | labels: [Frontend] | assignee: Maya Chen | start: -8d | due: -1d | created: -28d | blockedBy: [nav-shell] | blocks: [beta]

Waiting on QA. Due yesterday - one review comment left to address.

:::comment Sam Ortiz (-1d)
Two small things: the notification toggles don't save on Android, and the version number is cut off on small screens.
:::

## Build the sync API for offline mode {#sync-api}
project: Mobile App 2.0 | type: feature | status: in-progress | priority: urgent | labels: [Backend] | assignee: Leo Park | start: -14d | due: +2d | created: -35d | blocks: [offline]

:::description
## Description
A delta endpoint: the app sends its last sync token and gets back every change since. Conflicts resolve last-write-wins per field.
:::

## Offline mode {#offline}
project: Mobile App 2.0 | type: feature | status: to do | priority: high | labels: [Frontend, Backend] | assignee: Priya Nair | start: +3d | due: +12d | created: -35d | blockedBy: [sync-api] | blocks: [beta]

Read and edit tasks without a connection; changes sync when it's back.

## Ship the beta to TestFlight {#beta}
project: Mobile App 2.0 | type: chore | status: to do | priority: high | assignee: You | due: +14d | created: -20d | blockedBy: [port-tasks, port-settings, offline] | blocks: [store]

## Submit to the App Store and Play Store {#store}
project: Mobile App 2.0 | type: chore | status: backlog | priority: high | assignee: You | due: +24d | created: -20d | blockedBy: [beta]

Screenshots, release notes and the review questionnaire.

## App crashes when rotating on the task detail screen
project: Mobile App 2.0 | type: bug | status: to do | priority: urgent | labels: [Frontend, Customer request] | assignee: Priya Nair | due: -2d | created: -6d

Three customers reported it this week. Only on Android tablets.

## Usage-based pricing model {#pricing-model}
project: Billing Revamp | type: design | status: done | priority: high | assignee: You | start: -28d | due: -20d | completed: -21d | created: -30d | blocks: [pricing-page, plan-picker]

Free up to 3 members, then per active member per month. Signed off by finance.

## New pricing page {#pricing-page}
project: Billing Revamp | type: design | status: in review | priority: medium | labels: [Frontend] | assignee: Maya Chen | start: -12d | due: +1d | created: -25d | blockedBy: [pricing-model]

:::comment You (-2d)
Love the comparison table. Can we move the FAQ above the footer so it's not missed?
:::

## Plan picker in settings {#plan-picker}
project: Billing Revamp | type: feature | status: in-progress | priority: high | labels: [Frontend, Backend] | assignee: Leo Park | start: -7d | due: +5d | created: -25d | blockedBy: [pricing-model] | blocks: [migrate]

## Migrate existing customers to the new plans {#migrate}
project: Billing Revamp | type: chore | status: to do | priority: high | labels: [Backend] | assignee: Leo Park | start: +6d | due: +15d | created: -25d | blockedBy: [plan-picker]

Every customer lands on the closest new plan, never paying more than before. Email them a week ahead.

### Email customers about their new plan
type: chore | status: to do | priority: high | labels: [Customer request] | assignee: You | due: +8d | created: -6d

### Drop the legacy billing tables
type: chore | status: backlog | priority: low | labels: [Tech debt] | assignee: Leo Park | created: -20d

Once every customer is on a new plan.

## Invoices show the wrong tax rate for EU customers
project: Billing Revamp | type: bug | status: in-progress | priority: urgent | labels: [Backend, Customer request] | assignee: Leo Park | due: -1d | created: -4d

VAT is applied twice when a customer's address changes mid-cycle.

## A sample workspace for new sign-ups {#sample}
project: Onboarding Improvements | type: feature | status: to do | priority: medium | labels: [Frontend, Customer request] | assignee: You | due: +9d | created: -10d | related: [checklist]

Start new accounts in a workspace with example tasks instead of an empty screen.

## Shorter sign-up form
project: Onboarding Improvements | type: design | status: canceled | priority: medium | labels: [Frontend] | assignee: Maya Chen | archived: -3d | created: -10d

Dropped: the form is already two fields, and the drop-off happens after it.

## Getting-started checklist {#checklist}
project: Onboarding Improvements | type: feature | status: backlog | priority: low | labels: [Frontend] | created: -10d | related: [sample]

## Dark mode
project: Q3 Web Release | type: feature | status: done | priority: medium | labels: [Frontend] | assignee: Maya Chen | completed: -50d | archived: -40d | created: -78d

## Keyboard shortcuts everywhere
project: Q3 Web Release | type: feature | status: done | priority: high | labels: [Frontend] | assignee: Priya Nair | completed: -44d | archived: -35d | created: -75d

## New search
project: Q3 Web Release | type: feature | status: done | priority: high | labels: [Backend, Performance] | assignee: Leo Park | completed: -36d | created: -70d

## Search misses tasks with accented titles
project: Q3 Web Release | type: bug | status: done | priority: medium | labels: [Backend, Customer request] | assignee: Leo Park | completed: -24d | created: -35d

## Release notes for Q3
project: Q3 Web Release | type: chore | status: done | priority: low | assignee: You | completed: -15d | created: -40d

## Fix flaky end-to-end tests
type: chore | status: in-progress | priority: medium | labels: [Tech debt] | assignee: Sam Ortiz | due: +6d | created: -9d

## Weekly team sync
type: chore | status: to do | priority: low | assignee: You | due: +2d | repeat: weekly | created: -60d

Agenda: blockers first, then demos.
