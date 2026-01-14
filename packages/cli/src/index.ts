#!/usr/bin/env bun
import { Command } from "commander"
import { configCommand } from "./commands/config"
import { fetchCommand } from "./commands/fetch"
import { inspectCommand } from "./commands/inspect"
import { listCommand } from "./commands/list"
import { runCommand } from "./commands/run"

const program = new Command()
	.name("clarity")
	.description("Clarity - Generate architecture diagrams from IaC files")
	.version("0.1.0")

program.addCommand(configCommand)
program.addCommand(fetchCommand)
program.addCommand(runCommand)
program.addCommand(listCommand)
program.addCommand(inspectCommand)

program.parse()
