# Agent Atelier — instructions for continuing work

## Start each session

1. Read `README.md` for setup, supported behavior, and the last verification record. Treat recorded test results as historical; verify changes against the current checkout.
2. Inspect the working tree and preserve existing user changes. Use Serena first for repository navigation, symbols, references, and execution flow. Fall back to `rg` and targeted file reads when Serena is unavailable, errors, cannot locate the target, or has not indexed the repository.
3. Trace the affected callers, validation, persistence, UI, and tests before editing. Work on the user's current request; the handoff below is context, not authorization to start unrelated work.

## Product decisions

- This is a local, single-user visual office for coding and general-purpose AI teammates. One office and a permanent team serve multiple projects. The user assigns work; agents may consult each other, but delegation requires human approval.
- Keep the UI in Thai with familiar English technical terms. The office is editable 2D pixel art, including furniture, seating, and configurable avatars. Character movement reflects actual work or messages; task execution remains independent of animation.
- Each agent has its own model, instructions, appearance, permissions, and private project-scoped memory. Project knowledge is shared explicitly. Initial teammates are Atlas, Nova, Sage, and Pixel.
- Use the existing signed-in Codex CLI account. Discover models through App Server; account/model errors must remain visible. Custom agent instructions are developer instructions under Codex's own rules, not replacements for system policy.
- Keep the local single-user architecture. A Project has a general workspace, description, and up to 16 named repositories; General is the default Project. Multi-user access, cloud hosting, 3D, AI-generated custom avatars, and non-Codex model providers are outside the agreed v1 scope.

## Where to work

| When changing | Start here |
| --- | --- |
| App composition, navigation, and feature views | `components/OfficeApp.tsx`; focused components under `components/` |
| Office rendering, movement, avatar colors, and placement | `components/OfficeScene.tsx`, `components/avatar-art.ts`, `shared/room.ts` |
| HTTP actions, SSE, server startup, and request protections | `server/index.ts` |
| Task queue, context, messaging, approvals, and recovery | `server/runtime.ts` |
| Codex process and JSON-RPC transport | `server/codex.ts`; dynamic tool definitions in `server/tools.ts` |
| Persistence and schedules | `server/store.ts`, `server/scheduler.ts` |
| Git isolation and merging | `server/git.ts` |
| Google OAuth, Gmail, and Calendar | `server/google.ts` |
| Shared contracts and input validation | `shared/types.ts`, `shared/validation.ts` |

Next.js/React supplies the UI; Phaser renders the office. A persistent Node server owns Codex processes and schedule execution, with HTTP commands and SSE snapshots. SQLite uses the built-in `node:sqlite` module. Dependencies and scripts are authoritative in `package.json`.

When changing visuals, read `docs/design/design-system.md` and inspect `docs/design/concept.png` first. Production assets are in `public/assets/`; keep controls and labels in HTML rather than embedding them into images.

## Contracts to preserve

### Runtime and context

- Run at most two tasks concurrently and one task per agent. Apply the six-round consultation budget to the whole conversation, including parallel messages. Continuing beyond the budget requires human approval.
- Build model context from the selected project's shared knowledge, the current agent's private memory, and relevant messages. Other projects and teammates' private memories must stay out of that context.
- Consultations inspect the original task worktrees read-only. An authorized coding agent receiving an answer may continue in its original worktrees only while every repository remains unmerged; preserve that exception and the merge guard while related consultations remain active.
- Store durable state server-side so closing a tab does not stop work. Interrupted work must remain visibly interrupted after a server restart rather than being silently replayed.

### Approvals, Git, and external effects

- New Codex threads use `approvalPolicy: "on-request"` and `approvalsReviewer: "auto_review"` (Approve for me), preserving each task's sandbox and read-only consultations. Show auto-review rejection reasons; preserve rejected decisions without automatically approving or replaying them. Existing threads retain their original policy.
- Human approval gates delegation, Git initialization, merging, and every Gmail/Calendar write. Show the concrete action and payload before execution. Claim an approval before awaiting external I/O so repeated clicks cannot execute it twice.
- Preserve the `unknown` result for external actions interrupted during execution. Require checking the destination before retrying; automatic retries can send duplicate email or notifications.
- Coding work uses an isolated branch/worktree for each linked repository. Preserve each task's source paths and per-repository merge status independently of later Project edits. Main-project changes happen only through explicit user-approved merge after diff review for that repository. Keep branch/clean-tree/source-identity checks, conflict aborts, and worktree preservation, including partial preparation failures. Git initialization approvals bind to the displayed repository path and must not automatically stage and commit the user's files.
- Bind external approvals to their Google account. OAuth credentials stay server-side and out of model context, browser snapshots, source control, and logs. Inspect credential presence or safe metadata only.
- Preserve loopback-only serving, Host/Origin validation, input limits, and frame protections. Browser approval requirements must not be bypassed by direct shell or HTTP side effects.

### Scheduling and stored data

- Use `Asia/Vientiane` by default and preserve IANA timezone/DST handling. On startup, coalesce missed runs into one job per schedule and prevent overlapping instances of that schedule.
- Schedules require the machine and Node server to be running. Closing the browser is supported; powered-off execution is not.
- `.data/` contains user state, credentials, the starter workspace, and potentially unmerged worktrees. Preserve it as user data. Use unique temporary directories for tests, keep live side effects out of automated tests, and clean up only artifacts created by the current task.

## Implementation style

- For UI work, prefer shadcn components and Tailwind CSS utilities. Use the shared shadcn Select for every value-selection dropdown; do not add native `<select>` controls. Add custom components or CSS only when the existing shadcn/Tailwind patterns do not fit.
- Make the smallest complete change within the existing architecture. Keep methods focused, names descriptive, and logic shared where the code already has a suitable helper. Add dependencies only when existing code and platform features are insufficient.
- Preserve surrounding style and minimize unrelated edits. If the user supplies an entire file, change only the requested parts; list unrelated improvements separately before modifying them. Suggest clearer names rather than silently renaming unclear existing symbols.
- Keep comments for non-obvious intent or business rules. Document a deliberate known limit as `shortcut: <limit>, <when to upgrade>`.
- Cover new non-trivial behavior and bug fixes with a focused test or self-check. Preserve validation, error handling, accessibility, and protection against data loss.
- When the user supplies a git diff, provide a Conventional Commit title where appropriate and a detailed commit description. Create branches with the `codex/` prefix when a branch is needed; committing or publishing still follows the user's requested scope.

## Verification and handoff

- Use the validation scripts in `package.json`: `npm run typecheck`, `npm test`, and `npm run build` for runtime/contract changes. Documentation-only changes need content and reference checks, not a full application test run.
- For UI changes, verify the actual flow in the in-app browser when available, including desktop and mobile, console health, visible results, and keyboard access. Consult the design references for visual changes. A successful build alone does not establish UI correctness.
- For integration changes, distinguish fake-provider tests, real Codex calls, and real Google calls. Never claim a live integration was verified from mocks alone.
- End with what changed, the checks actually run, and any remaining limitation. Update these instructions or the linked documentation when a product contract or handoff status changes.

### Last handoff — 2026-11-02

Projects now support descriptions and named repositories with per-task, per-repository worktrees and merge status. Static app instructions live in `prompts/app.md`; runtime injects the selected Project map and private/shared context. Legacy Project.path and task branch/workspace fields remain supported. README records the 57-test/typecheck/Webpack build and desktop/mobile checks; live model execution across repositories remains unverified. Preserve worktrees after merge because artifact links use them.

The v1 implementation is present. `README.md` records the previous 22-test/typecheck/build baseline, tested tool versions, and the real Codex/browser smoke tests. Preview servers were stopped after verification; check current process state before starting a server.

Google OAuth and the Gmail/Calendar approval broker are implemented, but no real Google account was connected and no live email/event write was tested. The app's Connections screen contains the setup flow. Use mocks for further development until the user connects an account; live writes require approval of the exact action. This is the main remaining integration verification, not evidence of a confirmed bug.


Rename handoff: the local folder/package is now `agent-atelier`, with Agent Atelier branding. README records the 28-test/typecheck/build and desktop/mobile rename checks. Keep the documented legacy storage/tool identifiers for compatibility. The one-off path relocation script is `scripts/relocate-data.ts`; stop the server and back up user data before using it. Reopen the workspace from its new folder after moving it; existing chats may still reference the previous working directory.
