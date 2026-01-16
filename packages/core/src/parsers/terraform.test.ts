import { describe, expect, test } from "bun:test"
import { parseTerraformFiles } from "./terraform"

describe("parseTerraformFiles", () => {
	test("parses application-level resources and filters infrastructure by default", () => {
		const hcl = `
resource "aws_ecs_service" "web" {
  name = "web-service"
  cluster = aws_ecs_cluster.main.arn
}

resource "aws_db_instance" "postgres" {
  identifier = "mydb"
  engine = "postgres"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
}

resource "aws_ecs_cluster" "main" {
  name = "main-cluster"
}

resource "aws_ecs_task_definition" "web" {
  family = "web"
}
`
		const graph = parseTerraformFiles(
			[{ path: "main.tf", content: hcl }],
			"test-project",
		)

		const nodeIds = graph.nodes.map((node) => node.id)
		// Application-level resources should be included
		expect(nodeIds).toContain("aws_ecs_service.web")
		expect(nodeIds).toContain("aws_db_instance.postgres")

		// Infrastructure resources should be filtered out by default
		expect(nodeIds).not.toContain("aws_vpc.main")
		expect(nodeIds).not.toContain("aws_security_group.web")
		expect(nodeIds).not.toContain("aws_ecs_cluster.main")
		expect(nodeIds).not.toContain("aws_ecs_task_definition.web")
	})

	test("includes infrastructure when explicitly enabled", () => {
		const hcl = `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "private" {
  vpc_id = aws_vpc.main.id
}
`
		const graph = parseTerraformFiles(
			[{ path: "main.tf", content: hcl }],
			"test-project",
			{ includeInfrastructure: true },
		)

		const nodeIds = graph.nodes.map((node) => node.id)
		expect(nodeIds).toContain("aws_vpc.main")
		expect(nodeIds).toContain("aws_subnet.private")
	})

	test("parses JSON Terraform configs", () => {
		const json = JSON.stringify({
			resource: {
				aws_s3_bucket: {
					assets: {
						bucket: "my-assets",
					},
				},
				aws_elasticache_cluster: {
					redis: {
						cluster_id: "redis-cache",
						engine: "redis",
					},
				},
			},
		})

		const graph = parseTerraformFiles(
			[{ path: "main.tf.json", content: json }],
			"test-project",
		)

		const bucket = graph.nodes.find((node) => node.id === "aws_s3_bucket.assets")
		const cacheNode = graph.nodes.find((node) => node.id === "aws_elasticache_cluster.redis")

		expect(bucket).toBeTruthy()
		expect(bucket?.type).toBe("storage")
		expect(cacheNode).toBeTruthy()
		expect(cacheNode?.type).toBe("cache")
	})

	test("infers connections between services and data stores by name", () => {
		const hcl = `
resource "aws_ecs_service" "myapp_web" {
  name = "myapp-web"
}

resource "aws_ecs_service" "myapp_worker" {
  name = "myapp-worker"
}

resource "aws_db_instance" "myapp" {
  identifier = "myapp-db"
}

resource "aws_elasticache_cluster" "myapp" {
  cluster_id = "myapp-cache"
}
`
		const graph = parseTerraformFiles(
			[{ path: "main.tf", content: hcl }],
			"test-project",
		)

		// Services should connect to data stores with matching name prefix
		const webToDb = graph.edges.find(
			(e) => e.from === "aws_ecs_service.myapp_web" && e.to === "aws_db_instance.myapp"
		)
		const webToCache = graph.edges.find(
			(e) => e.from === "aws_ecs_service.myapp_web" && e.to === "aws_elasticache_cluster.myapp"
		)
		const workerToDb = graph.edges.find(
			(e) => e.from === "aws_ecs_service.myapp_worker" && e.to === "aws_db_instance.myapp"
		)

		expect(webToDb).toBeTruthy()
		expect(webToCache).toBeTruthy()
		expect(workerToDb).toBeTruthy()
	})
})
