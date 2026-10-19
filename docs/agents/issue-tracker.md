# 本地 Markdown 任务

任务和规格保存在本仓库的 `.scratch/`，使用文本编辑工具维护。

- 每项功能使用 `.scratch/<feature>/` 目录。
- 规格使用 `spec.md`，任务分别使用 `issues/01-<slug>.md` 等编号文件。
- 任务开头使用 `Status:` 记录状态；名称见 `triage-labels.md`。
- 依赖使用 `Blocked by:` 引用任务编号。
- 讨论追加在任务的 `## Comments` 部分。
- skill 要求发布任务时，创建对应 Markdown 文件。
- skill 要求读取任务时，阅读用户指定的文件及其依赖。
