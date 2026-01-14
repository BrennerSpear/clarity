import { describe, expect, test } from "bun:test"
import { isDependencyEnabled, parseChartYaml } from "./chart"
import { detectComponents } from "./components"
import { parseHelm } from "./index"
import {
	extractImage,
	extractPorts,
	extractReplicas,
	extractResourceRequests,
	extractStorageSize,
	getExternalDatabaseConfig,
	parseValuesYaml,
} from "./values"

// Sample Chart.yaml content
const sampleChartYaml = `
apiVersion: v2
name: myapp
version: 1.0.0
appVersion: "2.0.0"
description: My awesome application
dependencies:
  - name: postgresql
    version: "12.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
  - name: redis
    version: "17.x.x"
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
`

// Sample values.yaml content
const sampleValuesYaml = `
image:
  repository: myapp/server
  tag: "2.0.0"
  pullPolicy: IfNotPresent

replicaCount: 3

service:
  type: ClusterIP
  port: 8080
  ports:
    http: 8080
    metrics: 9090

containerPorts:
  http: 8080
  metrics: 9090

resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"

persistence:
  enabled: true
  size: "10Gi"
  storageClass: standard

postgresql:
  enabled: true
  auth:
    postgresPassword: secret

redis:
  enabled: false

externalRedis:
  host: redis.example.com
  port: 6379
`

// Multi-component values.yaml
const multiComponentValuesYaml = `
image:
  repository: myapp/base
  tag: "1.0.0"

web:
  replicaCount: 2
  containerPorts:
    http: 3000
  resources:
    requests:
      cpu: "250m"
      memory: "256Mi"

worker:
  replicaCount: 5
  containerPorts:
    metrics: 9090
  resources:
    requests:
      cpu: "1"
      memory: "1Gi"

scheduler:
  replicaCount: 1
  resources:
    requests:
      cpu: "100m"
      memory: "128Mi"
`

describe("parseChartYaml", () => {
	test("parses chart name and version", () => {
		const chart = parseChartYaml(sampleChartYaml)

		expect(chart.name).toBe("myapp")
		expect(chart.version).toBe("1.0.0")
		expect(chart.appVersion).toBe("2.0.0")
		expect(chart.description).toBe("My awesome application")
	})

	test("parses dependencies", () => {
		const chart = parseChartYaml(sampleChartYaml)

		expect(chart.dependencies).toHaveLength(2)
		expect(chart.dependencies?.[0]?.name).toBe("postgresql")
		expect(chart.dependencies?.[0]?.condition).toBe("postgresql.enabled")
		expect(chart.dependencies?.[1]?.name).toBe("redis")
	})

	test("throws on missing name", () => {
		expect(() => parseChartYaml("version: 1.0.0")).toThrow(
			"Chart.yaml must have a name field",
		)
	})
})

describe("isDependencyEnabled", () => {
	test("returns true when condition is true", () => {
		const dep = { name: "postgresql", condition: "postgresql.enabled" }
		const values = { postgresql: { enabled: true } }

		expect(isDependencyEnabled(dep, values)).toBe(true)
	})

	test("returns false when condition is false", () => {
		const dep = { name: "redis", condition: "redis.enabled" }
		const values = { redis: { enabled: false } }

		expect(isDependencyEnabled(dep, values)).toBe(false)
	})

	test("returns true when no condition specified", () => {
		const dep = { name: "postgresql" }
		const values = {}

		expect(isDependencyEnabled(dep, values)).toBe(true)
	})

	test("returns true when condition path does not exist", () => {
		const dep = { name: "postgresql", condition: "nonexistent.enabled" }
		const values = {}

		expect(isDependencyEnabled(dep, values)).toBe(true)
	})
})

describe("parseValuesYaml", () => {
	test("parses image configuration", () => {
		const values = parseValuesYaml(sampleValuesYaml)

		expect(values.image?.repository).toBe("myapp/server")
		expect(values.image?.tag).toBe("2.0.0")
	})

	test("parses service configuration", () => {
		const values = parseValuesYaml(sampleValuesYaml)

		expect(values.service?.port).toBe(8080)
		expect(values.service?.ports?.http).toBe(8080)
		expect(values.service?.ports?.metrics).toBe(9090)
	})

	test("parses resource requests", () => {
		const values = parseValuesYaml(sampleValuesYaml)

		expect(values.resources?.requests?.cpu).toBe("500m")
		expect(values.resources?.requests?.memory).toBe("512Mi")
	})
})

describe("extractImage", () => {
	test("extracts image from top-level", () => {
		const values = parseValuesYaml(sampleValuesYaml)
		const image = extractImage(values)

		expect(image).toBe("myapp/server:2.0.0")
	})

	test("extracts image without tag", () => {
		const values = parseValuesYaml(`
image:
  repository: myapp/server
`)
		const image = extractImage(values)

		expect(image).toBe("myapp/server")
	})

	test("returns undefined when no image", () => {
		const values = parseValuesYaml("replicaCount: 1")
		const image = extractImage(values)

		expect(image).toBeUndefined()
	})
})

describe("extractPorts", () => {
	test("extracts single service port", () => {
		const values = parseValuesYaml(`
service:
  port: 8080
`)
		const ports = extractPorts(values)

		expect(ports).toHaveLength(1)
		expect(ports[0]?.internal).toBe(8080)
	})

	test("extracts named service ports", () => {
		const values = parseValuesYaml(sampleValuesYaml)
		const ports = extractPorts(values)

		expect(ports.length).toBeGreaterThanOrEqual(2)
		expect(ports.some((p) => p.internal === 8080)).toBe(true)
		expect(ports.some((p) => p.internal === 9090)).toBe(true)
	})

	test("extracts container ports", () => {
		const values = parseValuesYaml(`
containerPorts:
  http: 3000
  ws: 3001
`)
		const ports = extractPorts(values)

		expect(ports).toHaveLength(2)
		expect(ports.some((p) => p.internal === 3000)).toBe(true)
		expect(ports.some((p) => p.internal === 3001)).toBe(true)
	})
})

describe("extractReplicas", () => {
	test("extracts replica count", () => {
		const values = parseValuesYaml(sampleValuesYaml)
		const replicas = extractReplicas(values)

		expect(replicas).toBe(3)
	})

	test("returns undefined when no replicas", () => {
		const values = parseValuesYaml("image:\n  repository: test")
		const replicas = extractReplicas(values)

		expect(replicas).toBeUndefined()
	})
})

describe("extractResourceRequests", () => {
	test("extracts resource requests", () => {
		const values = parseValuesYaml(sampleValuesYaml)
		const resources = extractResourceRequests(values)

		expect(resources?.cpu).toBe("500m")
		expect(resources?.memory).toBe("512Mi")
	})

	test("returns undefined when no resources", () => {
		const values = parseValuesYaml("replicaCount: 1")
		const resources = extractResourceRequests(values)

		expect(resources).toBeUndefined()
	})
})

describe("extractStorageSize", () => {
	test("extracts storage size when persistence enabled", () => {
		const values = parseValuesYaml(sampleValuesYaml)
		const size = extractStorageSize(values)

		expect(size).toBe("10Gi")
	})

	test("returns undefined when persistence disabled", () => {
		const values = parseValuesYaml(`
persistence:
  enabled: false
  size: "10Gi"
`)
		const size = extractStorageSize(values)

		expect(size).toBeUndefined()
	})
})

describe("getExternalDatabaseConfig", () => {
	test("returns undefined when no external database", () => {
		const values = parseValuesYaml(sampleValuesYaml)
		const extDb = getExternalDatabaseConfig(values)

		expect(extDb).toBeUndefined()
	})

	test("extracts external database config", () => {
		const values = parseValuesYaml(`
externalDatabase:
  host: db.example.com
  port: 5432
  database: myapp
`)
		const extDb = getExternalDatabaseConfig(values)

		expect(extDb?.host).toBe("db.example.com")
		expect(extDb?.port).toBe(5432)
		expect(extDb?.database).toBe("myapp")
	})
})

describe("detectComponents", () => {
	test("detects multi-component structure", () => {
		const values = parseValuesYaml(multiComponentValuesYaml)
		const components = detectComponents(values)

		expect(components.length).toBeGreaterThanOrEqual(3)

		const webComponent = components.find((c) => c.name === "web")
		expect(webComponent).toBeDefined()
		expect(webComponent?.hasReplicas).toBe(true)
		expect(webComponent?.hasPorts).toBe(true)
		expect(webComponent?.hasResources).toBe(true)

		const workerComponent = components.find((c) => c.name === "worker")
		expect(workerComponent).toBeDefined()

		const schedulerComponent = components.find((c) => c.name === "scheduler")
		expect(schedulerComponent).toBeDefined()
	})

	test("returns empty for single-component chart", () => {
		const values = parseValuesYaml(sampleValuesYaml)
		const components = detectComponents(values)

		// Should not detect postgresql/redis as components (they're dependencies)
		const appComponents = components.filter(
			(c) => !["postgresql", "redis"].includes(c.name),
		)
		expect(appComponents).toHaveLength(0)
	})
})

describe("parseHelm", () => {
	test("parses simple single-service chart", () => {
		const graph = parseHelm(sampleChartYaml, sampleValuesYaml, "myapp", "test")

		// Should have main service + enabled postgresql
		expect(graph.nodes.length).toBeGreaterThanOrEqual(2)

		// Main service node
		const mainNode = graph.nodes.find((n) => n.id === "myapp")
		expect(mainNode).toBeDefined()
		expect(mainNode?.name).toBe("myapp")
		expect(mainNode?.image).toBe("myapp/server:2.0.0")
		expect(mainNode?.replicas).toBe(3)
		expect(mainNode?.resourceRequests?.cpu).toBe("500m")
		expect(mainNode?.storageSize).toBe("10Gi")

		// PostgreSQL dependency node (enabled)
		const pgNode = graph.nodes.find((n) => n.id === "postgresql")
		expect(pgNode).toBeDefined()
		expect(pgNode?.type).toBe("database")

		// Redis is disabled, should have external node
		const externalRedis = graph.nodes.find((n) => n.id === "external-redis")
		expect(externalRedis).toBeDefined()
		expect(externalRedis?.external).toBe(true)
		expect(externalRedis?.name).toBe("redis.example.com")
	})

	test("parses multi-component chart", () => {
		const chartYaml = `
apiVersion: v2
name: airflow
version: 1.0.0
`
		const graph = parseHelm(
			chartYaml,
			multiComponentValuesYaml,
			"airflow",
			"test",
		)

		// Should have separate nodes for web, worker, scheduler
		expect(graph.nodes.length).toBeGreaterThanOrEqual(3)

		const webNode = graph.nodes.find((n) => n.id === "airflow-web")
		expect(webNode).toBeDefined()
		expect(webNode?.name).toBe("web")
		expect(webNode?.group).toBe("airflow")
		expect(webNode?.replicas).toBe(2)

		const workerNode = graph.nodes.find((n) => n.id === "airflow-worker")
		expect(workerNode).toBeDefined()
		expect(workerNode?.replicas).toBe(5)
		expect(workerNode?.resourceRequests?.cpu).toBe("1")

		const schedulerNode = graph.nodes.find((n) => n.id === "airflow-scheduler")
		expect(schedulerNode).toBeDefined()
		expect(schedulerNode?.replicas).toBe(1)
	})

	test("creates subchart edges", () => {
		const graph = parseHelm(sampleChartYaml, sampleValuesYaml, "myapp", "test")

		// Should have edge from main service to postgresql
		const pgEdge = graph.edges.find(
			(e) => e.from === "myapp" && e.to === "postgresql",
		)
		expect(pgEdge).toBeDefined()
		expect(pgEdge?.type).toBe("subchart")
	})

	test("sets source format to helm", () => {
		const graph = parseHelm(sampleChartYaml, sampleValuesYaml, "myapp", "test")

		for (const node of graph.nodes) {
			expect(node.source.format).toBe("helm")
		}
	})

	test("sets metadata correctly", () => {
		const graph = parseHelm(sampleChartYaml, sampleValuesYaml, "myapp", "test")

		expect(graph.metadata.project).toBe("test")
		expect(graph.metadata.sourceFiles).toContain("myapp/Chart.yaml")
		expect(graph.metadata.sourceFiles).toContain("myapp/values.yaml")
	})
})
