# Infrastructure-to-Excalidraw Research

## Goal

Auto-generate Excalidraw diagrams of system architecture at multiple levels of resolution using a combination of scripts and LLMs. The tool should scale to handle large enterprise infrastructure.

---

## Open Source Projects Analyzed

Projects with complex, multi-service infrastructure suitable for testing and development.

### Summary Table: IaC Tools by Project

| Project | Docker Compose | Kubernetes/Helm | Terraform | Ansible | Other Notable |
|---------|---------------|-----------------|-----------|---------|---------------|
| **Mastodon** | ✅ | ✅ (official Helm chart) | ✅ (Fastly CDN) | ✅ | Vagrant |
| **Zulip** | ✅ | ✅ (in docker-zulip repo) | ❌ | ❌ | **Puppet** (primary), Vagrant |
| **Mattermost** | ✅ | ✅ (Helm + Operator) | ✅ | ❌ | kops, Tilt |
| **GitLab** | ✅ | ✅ (Helm + Operator) | ✅ | ✅ | CNG images, Omnibus |
| **Sentry** | ✅ (only) | ❌ | ❌ | ❌ | Bash scripts |
| **PostHog** | ✅ | ✅ (sunsetted 2023) | ✅ | ❌ | Dagster |
| **Temporal** | ✅ | ✅ (official Helm) | ✅ (Cloud provider) | ❌ | Pulumi |
| **Taiga** | ✅ (only official) | Community only | Community only | Community only | — |
| **Nextcloud** | ✅ | ❌ | ❌ | ❌ | Nix flakes |
| **Outline** | ✅ | Community only | ❌ | ❌ | Heroku (Procfile) |
| **Discourse** | Custom Docker | ❌ | ❌ | ❌ | **Pups** (custom YAML), launcher script |

---

## Recommended Implementation Order

### Phase 1: Sentry (Start Here)

**Repository:** https://github.com/getsentry/self-hosted

**Why this is the ideal starting point:**
- Single `docker-compose.yml` containing ~15 clearly defined services
- All infrastructure defined in one parseable file
- Complex enough to be interesting without being overwhelming
- Clean service dependencies that can be traced
- No custom DSLs or unusual tooling

**Services included:**
- PostgreSQL, PgBouncer (database layer)
- Redis, Memcached (caching)
- Kafka (event streaming)
- ClickHouse (analytics)
- Snuba, Symbolicator, Relay, Vroom (Sentry-specific)
- Nginx (reverse proxy)

**Deliverable:** Working pipeline from docker-compose.yml → Excalidraw JSON

---

### Phase 2: Temporal

**Repositories:**
- https://github.com/temporalio/temporal
- https://github.com/temporalio/docker-compose
- https://github.com/temporalio/helm-charts

**Why this is the next step:**
- Clean Helm charts in dedicated repository
- Docker Compose variants for different backends (Postgres, MySQL, Cassandra)
- Well-documented architecture with clear component boundaries
- Tests multi-format parsing capability

**Deliverable:** Add Helm chart parsing, validate against docker-compose output

---

### Phase 3: Mastodon

**Repositories:**
- https://github.com/mastodon/mastodon
- https://github.com/mastodon/chart (Helm)
- https://github.com/mastodon/mastodon-ansible

**Why this tests IaC diversity:**
- Has Docker Compose, Helm, Terraform, AND Ansible
- Forces building parsers for multiple formats
- Moderate complexity with clear service roles
- Good reference architecture documentation

**Services:**
- Web (Rails), Streaming (Node.js), Sidekiq (background jobs)
- PostgreSQL, Redis, Elasticsearch (optional)

**Deliverable:** Add Terraform and Ansible parsing, cross-validate outputs

---

### Phase 4: GitLab (Final Validation)

**Repositories:**
- https://github.com/gitlabhq/gitlabhq
- https://gitlab.com/gitlab-org/charts/gitlab (Helm)
- https://gitlab.com/gitlab-org/omnibus-gitlab
- https://gitlab.com/gitlab-org/gitlab-environment-toolkit (Terraform + Ansible)
- https://gitlab.com/gitlab-org/cloud-native/gitlab-operator

**Why this is the ultimate test:**
- Most complex infrastructure of all analyzed projects
- Multiple deployment patterns (Omnibus, Helm, Cloud Native)
- Official reference architectures at different scales (1k, 3k, 10k, 50k users)
- Real enterprise-grade complexity with 30+ components
- Uses Terraform + Ansible + Helm + Kubernetes Operator

**Components:**
- Gitaly, GitLab Shell, Workhorse, Registry
- PostgreSQL, Redis, Sidekiq
- Prometheus, Grafana (monitoring)
- Nginx, Consul, PgBouncer
- Object storage, Elasticsearch

**Deliverable:** Full multi-resolution diagram generation for enterprise-scale infrastructure

---

## Projects to Avoid Initially

| Project | Reason |
|---------|--------|
| **Discourse** | Custom Pups YAML DSL is non-standard and won't generalize |
| **Zulip** | Puppet-based infrastructure is less common in modern stacks |
| **Taiga/Outline/Nextcloud** | Too simple to stress-test parsers effectively |
| **PostHog** | K8s support was sunsetted, IaC is in mixed state |

---

## Proposed Architecture

```
IaC Source Files (docker-compose, helm, terraform, etc.)
                              │
                              ▼
                 ┌────────────────────────┐
                 │     Format Parsers     │
                 │  ─────────────────────  │
                 │  • docker-compose      │
                 │  • helm charts         │
                 │  • terraform           │
                 │  • ansible             │
                 └────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │  Intermediate Graph    │
                 │  ─────────────────────  │
                 │  • services/nodes      │
                 │  • dependencies/edges  │
                 │  • ports/protocols     │
                 │  • volumes/storage     │
                 │  • networks            │
                 └────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │   LLM Enhancement      │
                 │  ─────────────────────  │
                 │  • categorize services │
                 │  • infer relationships │
                 │  • generate labels     │
                 │  • suggest groupings   │
                 └────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │  Excalidraw Generator  │
                 │  ─────────────────────  │
                 │  • layout algorithm    │
                 │  • zoom level configs  │
                 │  • style/theming       │
                 │  • JSON output         │
                 └────────────────────────┘
                              │
                              ▼
              Excalidraw JSON (multiple resolution levels)
```

---

## Resolution Levels

The tool should generate diagrams at multiple levels of detail:

### Level 1: Executive Overview
- Major system boundaries only
- 5-10 boxes maximum
- Categories: "Database", "Application", "Cache", "Queue", etc.

### Level 2: Service Groups
- Grouped by function (data layer, application layer, infrastructure)
- Shows inter-group communication
- 10-20 elements

### Level 3: Full Service Map
- Every container/service as a node
- All dependencies shown
- Ports and protocols labeled
- 20-50+ elements

### Level 4: Detailed View (per-group)
- Drill-down into specific subsystems
- Configuration details
- Volume mounts, environment variables
- Replicas/scaling information

---

## Key IaC Parsing Challenges

### Docker Compose
- `depends_on` for explicit dependencies
- `networks` for implicit communication
- `links` (legacy) for service discovery
- Volume mounts for shared storage
- Environment variables for configuration

### Helm Charts
- `values.yaml` for configuration
- Template conditionals (`{{- if }}`)
- Sub-chart dependencies
- Service/Ingress definitions for networking

### Terraform
- Resource dependencies (implicit via references)
- Module composition
- Provider-specific resource types
- State file for actual deployed resources

### Ansible
- Role dependencies
- Inventory groups
- Task ordering
- Variable precedence

---

## Success Metrics

1. **Parsing accuracy:** Correctly identify 95%+ of services and dependencies
2. **Cross-format consistency:** Same infrastructure described in different IaC formats produces equivalent diagrams
3. **Scalability:** Handle GitLab-scale complexity (30+ services) without degradation
4. **Usability:** Generated Excalidraw files are immediately editable and presentable

---

## References

### Project Repositories

- Sentry: https://github.com/getsentry/self-hosted
- Temporal: https://github.com/temporalio/temporal
- Mastodon: https://github.com/mastodon/mastodon
- GitLab: https://github.com/gitlabhq/gitlabhq
- Mattermost: https://github.com/mattermost/mattermost
- Zulip: https://github.com/zulip/zulip
- PostHog: https://github.com/PostHog/posthog
- Taiga: https://github.com/taigaio/taiga-docker
- Nextcloud: https://github.com/nextcloud/docker
- Outline: https://github.com/outline/outline
- Discourse: https://github.com/discourse/discourse_docker

### Excalidraw Resources

- Excalidraw JSON schema: https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/restore.ts
- Excalidraw libraries: https://libraries.excalidraw.com/
