# Diagram Improvement Ideas

Based on analysis of the PostHog diagram output.

![PostHog Diagram](../docs/diagrams/docker-compose.hobby.png)

## Completed

- [x] **Orphaned nodes** - Nodes with no connections are now filtered out and documented in a separate `.excluded.md` file.

## To Do

### Arrow Congestion
The right side has a massive bundle of ~20+ arrows converging on db/clickhouse/redis. This "cable spaghetti" makes it nearly impossible to trace individual connections.

Ideas:
- Bundle edges that share a target
- Use a bus/backbone pattern for shared dependencies
- Show only primary dependencies, with secondary ones available on hover

### No Visual Grouping
26 services are laid out flat. Grouping into containers like "Data Layer", "Workers", "Temporal Services", "API" would dramatically improve readability.

### Init Services
`kafka-init` is shown at the same level as runtime services. Could be visually de-emphasized or collapsed.

### Extremely Wide Layout
The diagram is ~1500px wide but only ~700px tall. A more square aspect ratio would be easier to view.

### Raw Service Names
Names like `temporal-django-worker` and `property-defs-rs` could use human-readable labels from LLM enhancement.

### Duplicate Redis
Both `redis` and `redis7` are shown. Might be accurate but worth noting in diagram annotations.
