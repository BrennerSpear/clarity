#!/usr/bin/env bun
import { Command } from "commander"
import { fetchCommand } from "./commands/fetch"
import { runCommand } from "./commands/run"
import { listCommand } from "./commands/list"
import { inspectCommand } from "./commands/inspect"

const program = new Command()
	.name("ite")
	.description("Infrastructure to Excalidraw - Generate architecture diagrams from IaC files")
	.version("0.1.0")

program.addCommand(fetchCommand)
program.addCommand(runCommand)
program.addCommand(listCommand)
program.addCommand(inspectCommand)

program.parse()
