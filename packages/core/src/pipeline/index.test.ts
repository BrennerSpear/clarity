import { describe, test, expect, beforeAll } from "bun:test"
import { parseDockerCompose } from "../parsers/docker-compose"
import { InfraGraphSchema } from "../graph/schema"

describe("docker-compose parser", () => {
	test("parses simple docker-compose file", () => {
		const yaml = `
version: "3"
services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
    depends_on:
      - api
  api:
    image: node:18
    ports:
      - "3000:3000"
    depends_on:
      - db
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - db-data:/var/lib/postgresql/data
volumes:
  db-data:
`
		const graph = parseDockerCompose(yaml, "docker-compose.yml", "test-project")

		expect(graph.nodes.length).toBe(3)
		expect(graph.edges.length).toBe(2)

		// Check node types
		const webNode = graph.nodes.find((n) => n.id === "web")
		const dbNode = graph.nodes.find((n) => n.id === "db")
		expect(webNode?.type).toBe("proxy")
		expect(dbNode?.type).toBe("database")

		// Check edges
		expect(graph.edges.some((e) => e.from === "web" && e.to === "api")).toBe(true)
		expect(graph.edges.some((e) => e.from === "api" && e.to === "db")).toBe(true)
	})

	test("infers dependencies from environment variables", () => {
		const yaml = `
version: "3"
services:
  app:
    image: myapp
    environment:
      DATABASE_HOST: postgres
      REDIS_URL: "redis://redis:6379"
  postgres:
    image: postgres:15
  redis:
    image: redis:7
`
		const graph = parseDockerCompose(yaml, "docker-compose.yml", "test-project")

		expect(graph.nodes.length).toBe(3)
		// Should have inferred dependencies from env vars
		expect(graph.edges.some((e) => e.from === "app" && e.to === "redis" && e.type === "inferred")).toBe(true)
	})

	test("validates against Zod schema", () => {
		const yaml = `
version: "3"
services:
  web:
    image: nginx
    ports:
      - "80:80"
`
		const graph = parseDockerCompose(yaml, "docker-compose.yml", "test-project")
		const result = InfraGraphSchema.safeParse(graph)

		expect(result.success).toBe(true)
	})

	test("handles YAML merge keys", () => {
		const yaml = `
x-defaults: &defaults
  restart: always
  environment:
    SHARED: value

services:
  app:
    <<: *defaults
    image: myapp
  worker:
    <<: *defaults
    image: myworker
`
		const graph = parseDockerCompose(yaml, "docker-compose.yml", "test-project")

		expect(graph.nodes.length).toBe(2)
		const appNode = graph.nodes.find((n) => n.id === "app")
		expect(appNode?.environment?.SHARED).toBe("value")
	})
})
