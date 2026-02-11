<!--
SYNC IMPACT REPORT
Version: 1.0.0 (Initial Ratification)
Changes:
- Defined 6 Core Principles based on user input and PRD.
- Set strict rules for Type Safety (No 'any') and Testing (Mandatory).
- Established Functional/Modular architecture guidelines.
Templates Status:
- .specify/templates/plan-template.md: ✅ Alignment required in "Constitution Check"
- .specify/templates/spec-template.md: ✅ Requirements section maps to Principle VI
- .specify/templates/tasks-template.md: ✅ Testing tasks map to Principle IV
TODO:
- None
-->

# TrendRadar Constitution

## Core Principles

### I. Simplicity & Pragmatism
The project is fundamentally a self-hosted scheduled task (crontab). Logic MUST be simple, reliable, concise, and easy to maintain. Do not over-engineer; "good enough to work reliably" takes precedence over complex abstractions.

### II. Functional & Modular
Follow Functional Programming (FP) paradigms; prefer function composition and minimize the use of Classes. Functionality MUST be split into small, focused modules. Large, monolithic files are prohibited to ensure maintainability and clarity.

### III. Test-Driven Reliability (NON-NEGOTIABLE)
New code MUST include unit tests to guarantee reliability. Code must be designed for testability from the start.

### IV. Type Safety
TypeScript types are first-class citizens. The use of `any` is strictly prohibited. Use strict typing and validation (e.g., Zod) to ensure system stability.

### V. Iterative Quality
Maintain structural elegance during iterations. If a planned feature requires an unreasonable hack or threatens the architecture, refactor the underlying structure first.

### VI. Requirement Adherence
Strictly follow the requirements. Implement exactly what is requested in the specification to ensure the tool performs its intended specific duty without bloat.

## Governance

This constitution serves as the primary source of architectural truth.
Amendments require explicit justification and version bumping.

**Version**: 1.0.0 | **Ratified**: 2026-02-06 | **Last Amended**: 2026-02-06