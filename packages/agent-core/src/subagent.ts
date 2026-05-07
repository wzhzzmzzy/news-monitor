export interface SubagentTask {
  id: string;
  instruction: string;
  input?: Record<string, unknown>;
}

export interface SubagentResult {
  taskId: string;
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
}

export interface SubagentService {
  spawn(task: SubagentTask): Promise<SubagentResult>;
}

export class NotImplementedSubagentService implements SubagentService {
  async spawn(task: SubagentTask): Promise<SubagentResult> {
    return {
      taskId: task.id,
      status: "failed",
      error: "首版未实现 subagent runtime"
    };
  }
}
