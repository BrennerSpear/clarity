import { describe, expect, test } from "bun:test"
import {
	extractExternalServicesFromValues,
	type HelmValues,
} from "./values"

describe("extractExternalServicesFromValues", () => {
	test("extracts postgres from connectAddr", () => {
		const values: HelmValues = {
			datastores: {
				default: {
					sql: {
						pluginName: "postgres12",
						connectAddr: "postgres.default.svc.cluster.local:5432",
					},
				},
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(1)
		expect(services[0]).toEqual({
			id: "external-postgres",
			name: "postgres",
			port: 5432,
			serviceType: "postgres",
		})
	})

	test("extracts elasticsearch from url.host", () => {
		const values: HelmValues = {
			datastores: {
				visibility: {
					elasticsearch: {
						url: {
							host: "elasticsearch.default.svc.cluster.local",
							port: 9200,
						},
					},
				},
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(1)
		expect(services[0]).toEqual({
			id: "external-elasticsearch",
			name: "elasticsearch",
			port: 9200,
			serviceType: "elasticsearch",
		})
	})

	test("extracts multiple services", () => {
		const values: HelmValues = {
			datastores: {
				default: {
					sql: {
						connectAddr: "postgres.default.svc.cluster.local:5432",
					},
				},
				visibility: {
					elasticsearch: {
						url: {
							host: "elasticsearch.default.svc.cluster.local:9200",
						},
					},
				},
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(2)

		const postgres = services.find((s) => s.name === "postgres")
		const elastic = services.find((s) => s.name === "elasticsearch")

		expect(postgres).toBeDefined()
		expect(postgres?.port).toBe(5432)

		expect(elastic).toBeDefined()
		expect(elastic?.port).toBe(9200)
	})

	test("handles short kubernetes DNS format", () => {
		const values: HelmValues = {
			database: {
				host: "mydb.myns.svc:3306",
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(1)
		expect(services[0]).toEqual({
			id: "external-mydb",
			name: "mydb",
			port: 3306,
			serviceType: "database",
		})
	})

	test("handles service:port format", () => {
		const values: HelmValues = {
			redis: {
				host: "redis-master:6379",
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(1)
		expect(services[0]?.name).toBe("redis-master")
		expect(services[0]?.port).toBe(6379)
		expect(services[0]?.serviceType).toBe("redis")
	})

	test("skips localhost", () => {
		const values: HelmValues = {
			database: {
				host: "localhost:5432",
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(0)
	})

	test("skips IP addresses", () => {
		const values: HelmValues = {
			database: {
				host: "192.168.1.100:5432",
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(0)
	})

	test("deduplicates services", () => {
		const values: HelmValues = {
			datastores: {
				default: {
					sql: {
						connectAddr: "postgres.default.svc.cluster.local:5432",
					},
				},
			},
			backup: {
				database: {
					host: "postgres.default.svc.cluster.local:5432",
				},
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(1)
		expect(services[0]?.name).toBe("postgres")
	})

	test("handles arrays in values", () => {
		const values: HelmValues = {
			servers: [
				{ host: "kafka-0.kafka.svc:9092" },
				{ host: "kafka-1.kafka.svc:9092" },
			],
		}

		const services = extractExternalServicesFromValues(values)
		// Should dedupe since both refer to kafka-0 and kafka-1
		expect(services.length).toBeGreaterThanOrEqual(1)
	})

	test("returns empty for values without connections", () => {
		const values: HelmValues = {
			replicaCount: 3,
			image: {
				repository: "myapp",
				tag: "latest",
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(0)
	})

	test("infers service type from context path", () => {
		const values: HelmValues = {
			mysql: {
				host: "mydb.default.svc.cluster.local:3306",
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(1)
		expect(services[0]?.serviceType).toBe("mysql")
	})

	test("handles address key", () => {
		const values: HelmValues = {
			cassandra: {
				address: "cassandra.default.svc.cluster.local:9042",
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(1)
		expect(services[0]?.name).toBe("cassandra")
		expect(services[0]?.serviceType).toBe("cassandra")
	})

	test("handles endpoint key", () => {
		const values: HelmValues = {
			kafka: {
				endpoint: "kafka-broker.kafka.svc:9092",
			},
		}

		const services = extractExternalServicesFromValues(values)
		expect(services).toHaveLength(1)
		expect(services[0]?.name).toBe("kafka-broker")
		expect(services[0]?.serviceType).toBe("kafka")
	})
})
