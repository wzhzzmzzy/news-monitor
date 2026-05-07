# Agent Workflow Core 验证记录

日期：2026-05-07

命令：

```bash
pnpm test
pnpm run typecheck
pnpm run build
pnpm run cli -- --help
```

预期结果：

- 所有测试通过。
- TypeScript 不报告错误。
- 构建在 `dist/` 下写入编译产物。
- CLI 帮助列出 `chat`、`workflow` 和 `report`。
