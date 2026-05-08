#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ArtifactRef } from "../../../packages/archive/src/index.js";
import { getGatewayStatus, restartGateway, startGateway, stopGateway } from "./gateway-process.js";
import { createRuntime } from "./runtime.js";

const program = new Command();

program
  .name("hot-board")
  .description("Hot Board Monitor CLI")
  .version("0.1.0");

program
  .command("chat")
  .description("启动最小报告阅读 chat session")
  .action(async () => {
    const runtime = await createRuntime();
    const rl = createInterface({ input, output });
    output.write("Hot Board chat 已启动。输入 exit 退出。\n");
    for (;;) {
      const question = await rl.question("> ");
      if (question.trim() === "exit") {
        rl.close();
        return;
      }
      const response = await runtime.agent.ask(question);
      output.write(`${response.text}\n`);
    }
  });

const workflow = program.command("workflow").description("Workflow 命令");

workflow
  .command("run <workflowId>")
  .description("运行内置 workflow")
  .action(async (workflowId: string) => {
    const runtime = await createRuntime();
    const selected = runtime.workflows[workflowId as keyof typeof runtime.workflows];
    if (!selected) {
      throw new Error(`找不到 workflow：${workflowId}`);
    }
    const record = await runtime.runner.run(selected, {});
    output.write(`${JSON.stringify(record, null, 2)}\n`);
  });

workflow
  .command("status <runId>")
  .description("读取 workflow run 状态")
  .action(async (runId: string) => {
    const runtime = await createRuntime();
    const status = await runtime.tools.execute("get_workflow_status", { runId });
    output.write(`${JSON.stringify(status, null, 2)}\n`);
  });

const report = program.command("report").description("报告命令");

const gateway = program.command("gateway").description("Gateway lifecycle commands");

gateway.command("status").description("显示 gateway 状态").action(async () => {
  const runtime = await createRuntime();
  output.write(`${JSON.stringify(await getGatewayStatus({ paths: runtime.paths }), null, 2)}\n`);
});

gateway.command("start").description("启动 gateway").action(async () => {
  const runtime = await createRuntime();
  output.write(`${JSON.stringify(await startGateway({
    paths: runtime.paths,
    config: runtime.appConfig.gateway
  }), null, 2)}\n`);
});

gateway.command("stop").description("停止 gateway").action(async () => {
  const runtime = await createRuntime();
  output.write(`${JSON.stringify(await stopGateway({ paths: runtime.paths }), null, 2)}\n`);
});

gateway.command("restart").description("重启 gateway").action(async () => {
  const runtime = await createRuntime();
  output.write(`${JSON.stringify(await restartGateway({
    paths: runtime.paths,
    config: runtime.appConfig.gateway
  }), null, 2)}\n`);
});

report
  .command("list")
  .description("列出 report artifacts")
  .action(async () => {
    const runtime = await createRuntime();
    const reports = await runtime.tools.execute<ArtifactRef[]>("list_reports", { limit: 20 });
    output.write(`${JSON.stringify(reports, null, 2)}\n`);
  });

report
  .command("read <reportId>")
  .description("按 id 读取 report artifact")
  .action(async (reportId: string) => {
    const runtime = await createRuntime();
    const reports = await runtime.archive.listArtifacts({ type: "reports" });
    const ref = reports.find((candidate) => candidate.id === reportId);
    if (!ref) {
      throw new Error(`找不到报告：${reportId}`);
    }
    const artifact = await runtime.archive.readArtifact(ref);
    output.write(`${JSON.stringify(artifact, null, 2)}\n`);
  });

const argv = process.argv.filter((arg, index) => index < 2 || arg !== "--");
await program.parseAsync(argv);
