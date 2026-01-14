# Clarity: Helm Chart Support

## Overview

Add support for parsing Helm charts to generate architecture diagrams alongside the existing Docker Compose support. Helm charts are the de facto standard for Kubernetes deployments and contain rich infrastructure metadata.

## Research Findings

### Helm Chart Structure

A Helm chart is a directory with this structure:

```
mychart/
├── Chart.yaml          # Chart metadata (name, version, dependencies)
├── values.yaml         # Default configuration values
├── templates/          # Go templates that generate K8s manifests
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── _helpers.tpl    # Template helpers
│   └── NOTES.txt       # Post-install notes
├── charts/             # Subcharts (dependencies)
└── values.schema.json  # Optional JSON schema for values
```

### Data Available in Helm Charts

**From Chart.yaml:**
- `name` - Chart name
- `version` - Chart version (SemVer)
- `appVersion` - Version of the app being deployed
- `description` - Chart description
- `dependencies` - List of subchart dependencies with:
  - `name`, `version`, `repository`
  - `condition` - Feature flag (e.g., `postgresql.enabled`)
  - `tags` - Grouping tags

**From values.yaml:**
- Image references (`image.repository`, `image.tag`)
- Replica counts (`replicaCount`, `worker.replicaCount`)
- Port configurations (`service.ports.http`, `containerPorts.http`)
- Persistence settings (`persistence.enabled`, `persistence.size`, `persistence.storageClass`)
- Resource limits (`resources.requests`, `resources.limits`)
- Ingress configuration (`ingress.enabled`, `ingress.hostname`, `ingress.path`)
- External service configurations (`externalDatabase.host`, `externalRedis.host`)
- Component-specific configurations (e.g., `scheduler`, `worker`, `web` sections)
- Authentication settings (`auth.username`, `auth.password`)

**From templates/:**
- Kubernetes resource kinds (Deployment, StatefulSet, Service, Ingress, ConfigMap, Secret)
- Service discovery patterns (DNS names, headless services)
- Network policies
- Health check configurations

### Comparison: Helm vs Docker Compose

| Data Point | Docker Compose | Helm Chart |
|------------|----------------|------------|
| Service name | `services.<name>` | `Chart.yaml:name`, template names |
| Image | `image:` | `values.yaml: image.repository:tag` |
| Ports | `ports:` | `service.ports`, `containerPorts` |
| Volumes | `volumes:` | `persistence.*`, `extraVolumeMounts` |
| Environment | `environment:` | `extraEnvVars`, config templates |
| Dependencies | `depends_on:` | `Chart.yaml: dependencies` |
| Replicas | `deploy.replicas` | `replicaCount`, component replicas |
| **New in Helm** | - | Ingress config, storage classes, resource limits, RBAC, network policies |

### What Helm Adds (Not in Docker Compose)

**Useful for diagrams:**
1. **Resource Requests/Limits**: CPU/memory - indicates relative "size" of services
2. **Storage Size**: PVC size requests - shows data volume expectations
3. **Explicit Dependencies**: Chart dependencies with version constraints
4. **External Service Configs**: When dependencies are disabled, external host/port/credentials
5. **Component Grouping**: Natural grouping (scheduler, worker, web, etc.)

**Not useful for diagrams (implementation details):**
- Ingress hostnames, paths, TLS config, ingress class
- Storage classes, access modes
- Liveness/readiness probes
- Node selectors, affinity, tolerations
- Network policies (beyond "A talks to B")
- Service type (ClusterIP vs LoadBalancer)

### Sample Charts Downloaded

Located in `test-data/helm-samples/`:

- `temporal-helm/charts/temporal/` - Workflow orchestration engine
- `mastodon-helm/` - Social network (elasticsearch, postgresql, redis deps)
- `mattermost-helm/charts/` - Multiple editions (team, enterprise, calls, etc.)
- `gitlab-helm/` - Complex: 15+ dependencies including postgresql, redis, prometheus, cert-manager, gitlab-runner, multiple ingress options

Note: Bitnami charts (postgresql, redis, etc.) are declared as dependencies in these project charts - we don't need them separately.

## Implementation Plan

### Phase 1: Basic values.yaml Parsing

Parse `values.yaml` to extract the primary service and its configuration.

**Input Files:**
- `values.yaml` (required)
- `Chart.yaml` (required)

**Extract:**
- Chart name as primary service
- Image from `image.repository:image.tag`
- Ports from `service.ports.*` and `containerPorts.*`
- Replicas from `replicaCount` and component-specific replica counts
- Service type inference from chart name/description

**Output:**
- `ServiceNode` for the main chart service
- Infer service type from image name (reuse existing `inferServiceType` logic)

### Phase 2: Dependency Resolution

Parse `Chart.yaml` dependencies to create nodes for subcharts.

**For each dependency:**
1. Check if enabled via `condition` (e.g., `postgresql.enabled: true`)
2. Create a `ServiceNode` for the subchart
3. Infer type from dependency name (postgresql → database, redis → cache)
4. Add `DependencyEdge` from main chart to dependency

**Handle external services:**
- When `postgresql.enabled: false`, check for `externalDatabase.*` config
- Create node for external service with `external: true` flag (new field)

### Phase 3: Multi-Component Charts

Parse component sections within `values.yaml` (e.g., `scheduler:`, `worker:`, `web:`).

**Detect components by:**
- Separate template directories (`templates/web/`, `templates/worker/`)
- Top-level value sections with `replicaCount` or `containerPorts`

**For each component:**
- Create separate `ServiceNode`
- Infer relationships (all components typically connect to same database)
- Use component name as service name (e.g., `airflow-web`, `airflow-worker`)

### Phase 4: Template Parsing (Advanced)

Parse rendered templates for additional relationship information.

**Options:**
1. **Static Analysis**: Parse Go templates to extract Service definitions
2. **Rendered Manifests**: Run `helm template` to get actual K8s manifests
3. **Hybrid**: Parse values + templates without full rendering

**Extract from templates:**
- Service DNS names for cross-service references
- ConfigMap values that reference other services
- NetworkPolicy rules

### Schema Extensions

Add new fields to `ServiceNode` for diagram-relevant data:

```typescript
interface ServiceNode {
  // ... existing fields ...

  // Size/scale indicators (useful for understanding service weight)
  resourceRequests?: {
    cpu?: string      // e.g., "500m", "2"
    memory?: string   // e.g., "256Mi", "8Gi"
  }
  storageSize?: string  // e.g., "8Gi" - shows data volume expectations

  // External service flag (managed service not deployed by chart)
  external?: boolean
}
```

Add new edge type for subchart dependencies:

```typescript
type DependencyType =
  | "depends_on"
  | "network"
  | "volume"
  | "link"
  | "inferred"
  | "subchart"  // New: Helm subchart dependency
```

### File Structure

```
packages/core/src/parsers/
├── docker-compose.ts    # Existing
├── helm/
│   ├── index.ts         # Main parser entry point
│   ├── chart.ts         # Chart.yaml parsing
│   ├── values.ts        # values.yaml parsing
│   ├── components.ts    # Multi-component detection
│   └── templates.ts     # Optional template parsing
```

### CLI Integration

Add Helm chart fetching to the existing `fetch` command:

```bash
# Fetch Helm chart from repository
bun run clarity fetch <project> --helm <chart-name> --repo <helm-repo-url>

# Fetch from local path
bun run clarity fetch <project> --helm-path ./path/to/chart

# Example: Fetch Bitnami Airflow chart
bun run clarity fetch airflow --helm airflow --repo https://charts.bitnami.com/bitnami
```

### Implementation Order

1. **Parser foundation**: `parseHelmChart(chartDir: string): InfraGraph`
2. **Chart.yaml parsing**: Extract name, description, dependencies
3. **values.yaml parsing**: Extract image, ports, replicas for main service
4. **Dependency nodes**: Create nodes for enabled subcharts
5. **External services**: Handle disabled subcharts with external configs
6. **Multi-component**: Detect and create component nodes
7. **CLI integration**: Add fetch support for Helm repos
8. **Testing**: Use downloaded Bitnami charts as test fixtures

### Diagram Enhancements

New visual elements for diagram-relevant data:

1. **External Services**: Dashed border or cloud icon for managed/external dependencies
2. **Service Size**: Visual indicator based on resource requests (larger box = more resources)
3. **Component Groups**: Auto-group components (web, worker, scheduler) under parent chart

### Test Cases

**Simple:**
1. `temporal-helm/charts/temporal/` - Clean structure, configurable backends

**Medium complexity:**
2. `mastodon-helm/` - Web + streaming + sidekiq + 3 dependencies (elasticsearch, postgresql, redis)
3. `mattermost-helm/charts/mattermost-enterprise-edition/` - Enterprise app with multiple services

**Complex:**
4. `gitlab-helm/` - Ultimate stress test: 30+ components, 15+ dependencies

### Questions for Later

1. Should we render templates with `helm template` or parse statically?
2. How to handle multiple values files (values.yaml, values-production.yaml)?
3. Should we support Helm hooks and their dependencies?
4. How to represent Helm release namespaces in diagrams?

## References

- [Helm Chart Structure](https://helm.sh/docs/topics/charts/)
- [Bitnami Charts](https://github.com/bitnami/charts)
- [Values Files](https://helm.sh/docs/chart_template_guide/values_files/)
