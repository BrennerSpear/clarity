import { parseHelmChart } from "../packages/core/src/parsers/helm"

const testCharts = [
	{
		name: "Temporal",
		path: "test-data/helm-samples/temporal-helm/charts/temporal",
	},
	{
		name: "Mattermost EE",
		path: "test-data/helm-samples/mattermost-helm/charts/mattermost-enterprise-edition",
	},
	{
		name: "Mattermost Team",
		path: "test-data/helm-samples/mattermost-helm/charts/mattermost-team-edition",
	},
	{
		name: "Focalboard",
		path: "test-data/helm-samples/mattermost-helm/charts/focalboard",
	},
	{
		name: "Mattermost Push Proxy",
		path: "test-data/helm-samples/mattermost-helm/charts/mattermost-push-proxy",
	},
	{
		name: "Mattermost RTCD",
		path: "test-data/helm-samples/mattermost-helm/charts/mattermost-rtcd",
	},
	{
		name: "GitLab Webservice",
		path: "test-data/helm-samples/gitlab-helm/charts/gitlab/charts/webservice",
	},
	{
		name: "GitLab Sidekiq",
		path: "test-data/helm-samples/gitlab-helm/charts/gitlab/charts/sidekiq",
	},
	{
		name: "GitLab Gitaly",
		path: "test-data/helm-samples/gitlab-helm/charts/gitlab/charts/gitaly",
	},
	{
		name: "GitLab KAS",
		path: "test-data/helm-samples/gitlab-helm/charts/gitlab/charts/kas",
	},
	{
		name: "GitLab Toolbox",
		path: "test-data/helm-samples/gitlab-helm/charts/gitlab/charts/toolbox",
	},
	{
		name: "GitLab Migrations",
		path: "test-data/helm-samples/gitlab-helm/charts/gitlab/charts/migrations",
	},
	{
		name: "Minio (GitLab)",
		path: "test-data/helm-samples/gitlab-helm/charts/minio",
	},
	{
		name: "Registry (GitLab)",
		path: "test-data/helm-samples/gitlab-helm/charts/registry",
	},
	{
		name: "Nginx Ingress (GitLab)",
		path: "test-data/helm-samples/gitlab-helm/charts/nginx-ingress",
	},
]

console.log("=".repeat(80))
console.log("HELM PARSER OUTPUT (Codex Implementation)")
console.log("=".repeat(80))

for (const chart of testCharts) {
	console.log(`\n${"─".repeat(80)}`)
	console.log(`### ${chart.name}`)
	console.log(`Path: ${chart.path}`)
	console.log("─".repeat(80))

	try {
		const graph = parseHelmChart(
			chart.path,
			chart.name.toLowerCase().replace(/\s+/g, "-"),
		)

		console.log(`\nNodes (${graph.nodes.length}):`)
		for (const node of graph.nodes) {
			const extras: string[] = []
			if (node.external) extras.push("EXTERNAL")
			if (node.replicas) extras.push(`replicas=${node.replicas}`)
			if (node.resourceRequests?.cpu)
				extras.push(`cpu=${node.resourceRequests.cpu}`)
			if (node.resourceRequests?.memory)
				extras.push(`mem=${node.resourceRequests.memory}`)
			if (node.storageSize) extras.push(`storage=${node.storageSize}`)
			if (node.group) extras.push(`group=${node.group}`)

			const extrasStr = extras.length > 0 ? ` (${extras.join(", ")})` : ""
			const portsStr = node.ports?.length
				? ` ports:[${node.ports.map((p) => p.internal).join(",")}]`
				: ""

			console.log(`  • ${node.id} [${node.type}]${portsStr}${extrasStr}`)
			if (node.image) console.log(`      image: ${node.image}`)
		}

		if (graph.edges.length > 0) {
			console.log(`\nEdges (${graph.edges.length}):`)
			for (const edge of graph.edges) {
				console.log(`  ${edge.from} ──[${edge.type}]──> ${edge.to}`)
			}
		}
	} catch (e) {
		console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`)
	}
}

console.log("\n" + "=".repeat(80))
