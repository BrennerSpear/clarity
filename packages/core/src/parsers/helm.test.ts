import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseHelmChart } from "./helm"

describe("parseHelmChart", () => {
	test("parses components, dependencies, and externals", async () => {
		const chartYaml = `
name: myapp
version: 1.0.0
dependencies:
  - name: postgresql
    version: 12.1.0
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
  - name: redis
    version: 17.0.0
    repository: https://charts.bitnami.com/bitnami
    condition: redis.enabled
`

		const valuesYaml = `
image:
  repository: myorg/myapp
  tag: "1.2.3"
replicaCount: 2
service:
  ports:
    http: 8080
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
postgresql:
  enabled: false
redis:
  enabled: true
externalDatabase:
  host: db.example.com
  port: 5432
web:
  replicaCount: 2
  containerPorts:
    http: 3000
worker:
  replicaCount: 1
  image:
    repository: myorg/myapp-worker
    tag: "1.2.3"
`

		const tempDir = await mkdtemp(join(tmpdir(), "clarity-helm-test-"))
		try {
			await writeFile(join(tempDir, "Chart.yaml"), chartYaml)
			await writeFile(join(tempDir, "values.yaml"), valuesYaml)

			const graph = parseHelmChart(tempDir, "test-project")

			expect(graph.nodes.find((n) => n.id === "myapp")).toBeUndefined()

			const web = graph.nodes.find((n) => n.id === "myapp-web")
			const worker = graph.nodes.find((n) => n.id === "myapp-worker")
			expect(web).toBeTruthy()
			expect(worker).toBeTruthy()
			expect(web?.image).toBe("myorg/myapp:1.2.3")
			expect(worker?.image).toBe("myorg/myapp-worker:1.2.3")
			expect(web?.group).toBe("myapp")

			const redis = graph.nodes.find((n) => n.id === "redis")
			const externalPostgres = graph.nodes.find(
				(n) => n.id === "external-postgresql",
			)
			expect(redis).toBeTruthy()
			expect(externalPostgres?.external).toBe(true)
			expect(externalPostgres?.ports?.[0]?.internal).toBe(5432)

			const edgeTargets = graph.edges
				.filter((edge) => edge.from === "myapp-web")
				.map((edge) => edge.to)
			expect(edgeTargets).toContain("redis")
			expect(edgeTargets).toContain("external-postgresql")
		} finally {
			await rm(tempDir, { recursive: true, force: true })
		}
	})
})
