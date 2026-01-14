export type PipelineStep =
	| "fetch"
	| "parse"
	| "enhance"
	| "layout"
	| "generate"

export type ResolutionLevel = "executive" | "groups" | "services" | "detailed"

export interface PipelineConfig {
	project: string
	steps?: PipelineStep[]
	outputDir: string
	llm?: {
		enabled: boolean
		model?: string
	}
	excalidraw?: {
		resolutionLevels: ResolutionLevel[]
		theme?: "light" | "dark"
	}
}

export type StepStatus = "pending" | "running" | "completed" | "failed"
export type RunStatus = "running" | "completed" | "failed"

export interface StepResult {
	step: PipelineStep
	status: StepStatus
	startedAt?: string
	completedAt?: string
	duration?: number
	outputFile?: string
	outputFiles?: string[]
	error?: string
}

export interface PipelineRun {
	id: string
	project: string
	startedAt: string
	completedAt?: string
	status: RunStatus
	steps: StepResult[]
	sourceFiles?: string[]
	config?: {
		resolutionLevels?: ResolutionLevel[]
		llmEnabled?: boolean
	}
}
