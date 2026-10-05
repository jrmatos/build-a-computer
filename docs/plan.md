<!-- Snapshot of the Claude Doc "Ground Up — Platform Implementation Plan" (2026-10-04). The doc is the source of truth: https://claude.ai/artifact/SHKETuSK6EnuuL993dDKWi -->

# Ground Up — Platform Implementation Plan
 · 
## Summary and scope
Ground Up (working title) is a browser platform where people learn computer science by building each layer themselves, with automatic checks at every step. Track 1 runs from one NAND gate to a RISC-V computer booting the player's own C operating system. Track 2 runs from one neuron to a small transformer language model trained in the browser.
It is built for programmers who are new to hardware, launches in English, and is free and open source.
Each level has a short tutorial, progressive hints, and 2 to 4 verified links to videos or articles. A verified part becomes a building block for later levels, and the engine runs it as fast native code.
### Goals for v1
Track 1 playable end to end in the browser, with no install and no account.
A shared platform core: level format, checkers, tutorials, resources, progress and saves.
Track 2 on the same core, started once Track 1 reaches its CPU phase.
Optional accounts with cloud saves, sharing and leaderboards, on Node.js and Postgres.
### Not in v1
Analog electronics, voltages, or transistor-level simulation.
Cycle-accurate copies of real chips, or booting Linux.
A native mobile app. Phones get tutorials, resources and progress, read-only.
Multiplayer or real-time collaboration.
### Success criteria
A new player finishes the first 5 levels in under 30 minutes without outside help.
The RISC-V emulator passes the official rv32ui, rv32um and rv32mi test suites.
A player's own kernel boots on their own CPU design and runs a shell in the browser.
Every shipped resource link passed an automated check in the last 30 days.
The editor holds 60 fps with 2,000 visible components on a mid-range 2020 laptop.
## How AI agents use this plan
Each backlog task fits one agent session and one pull request, with acceptance criteria an agent can check without a human. The repo's `AGENTS.md` copies the rules below, and `CLAUDE.md` points to it.
### Working agreement
One task per branch and per pull request. Branch name: `<task-id>-<short-slug>`.
Read the task, its dependencies and its spec section in this plan before writing code.
Write or update tests first when behavior changes. A task is not done while any test fails.
Never weaken, skip or delete a test to get a green build. Flag the problem in the PR instead.
No new runtime dependency without an ADR (architecture decision record) in `docs/adr/`.
Simulation packages (`sim-logic`, `rv32`, `asm`, `cc`, `tensor`) never import DOM, network or clock APIs.
Never invent a URL. Every resource link is fetched by the agent, and the title it saw is recorded.
Any schema change needs a version bump, a forward migration, and migration tests.
When a spec is ambiguous, take the simplest reading, note it in the PR, and add it to Open questions.
Every edge case ID named in a task gets a test whose name contains that ID.
### Task template
 Settle and clock
Deliverables: packages/sim-logic/src/settle.ts and tests
Acceptance criteria:
- [ ] E-SIM-01: a NOT gate wired to itself is reported unstable within the event budget
- [ ] An SR latch built from 2 NANDs settles and holds its state
- [ ] Unit and property tests pass in CI
Out of scope: canvas highlighting (EDIT-10)]]>
### Sizes
S: under 300 changed lines.
M: 300 to 1,000 changed lines.
L: split into S or M tasks before starting. Splits are listed in the task or done by the first agent.
### Definition of ready
Acceptance criteria are testable by a machine.
All dependencies are merged on `main`.
Needed types and schemas already exist in `packages/schema`.
### Definition of done
Every acceptance criterion is ticked in the PR description.
Lint, type check, unit, property and end-to-end tests pass in CI.
Performance budgets still pass.
Public APIs have TSDoc comments, and this plan is updated if behavior changed.
### Human review gates
The project owner approves before merge for: schema and save-format changes, auth and security code, new dependencies or licenses, curriculum text and resource links, and anything touching user data.
## Tech stack
Node.js, canvas and Postgres work, with TypeScript everywhere and one firm split: all simulation runs in the browser, and the server only stores and verifies. The first public release (M3) is a static site with local saves; Postgres arrives with accounts in M6.
 | 
Layer | 
Choice | 
Why
 | 
Language | 
TypeScript, strict mode | 
One language for simulation, UI, server and tests
 | 
Monorepo | 
pnpm workspaces + Turborepo | 
Fast installs and cached builds per package
 | 
Web app | 
React + Vite | 
Menus, tutorials, panels and routing
 | 
UI state | 
Zustand | 
Small, and usable outside React components
 | 
Circuit editor | 
Custom Canvas 2D renderer behind a `Renderer` interface | 
Full control of wires and hit testing, no DOM node per part. Switch to PixiJS (WebGL) if the 60 fps benchmark fails
 | 
Code editor | 
CodeMirror 6 | 
Custom modes for RISC-V assembly and C, small bundle
 | 
Simulation | 
Pure TypeScript packages on typed arrays, in a Web Worker | 
Deterministic, testable in Node, never blocks the UI
 | 
Worker calls | 
Comlink + transferable ArrayBuffers | 
Simple RPC; no SharedArrayBuffer in v1 (see E-PLAT-06)
 | 
Local data | 
IndexedDB via Dexie | 
Autosave, progress, offline play
 | 
Offline | 
Service worker via vite-plugin-pwa | 
Play without network after the first load
 | 
Content | 
YAML + MDX in the repo, compiled to JSON and checked by zod at build | 
Every content change goes through Git review; no CMS
 | 
API | 
Node.js 24 LTS + NestJS, REST with OpenAPI | 
Modules, guards and DI; a framework already familiar to the owner
 | 
Contracts | 
zod schemas in `packages/schema` | 
One source of truth for client, server and content
 | 
Database | 
PostgreSQL 17 or newer + Drizzle ORM | 
SQL-first, typed queries, plain migration files
 | 
Jobs | 
pg-boss (queue stored in Postgres) | 
Verification jobs without running Redis
 | 
Auth | 
Better Auth: email magic link + GitHub OAuth (confirm in ADR-003) | 
TypeScript-native, self-hosted, sessions in Postgres
 | 
Large files | 
S3-compatible storage (Cloudflare R2) | 
Disk images, model checkpoints, saves over 1 MB
 | 
ML compute | 
WebGPU with WGSL kernels, CPU fallback on typed arrays | 
Trains small models in the browser
 | 
Tests | 
Vitest, fast-check, Playwright, axe | 
Unit, property, end-to-end and accessibility
 | 
Hosting | 
Static site on Cloudflare Pages; API in one container; managed Postgres | 
Cheap at hobby scale. Move to Kubernetes only if traffic needs it
 | 
Monitoring | 
Sentry for client errors, OpenTelemetry for the API | 
Real browser errors; vendor-neutral traces
M0 pins exact versions, and ADR-001 records these choices with the alternatives considered.
## Architecture
Simulation code lives in pure TypeScript packages that run unchanged in the browser worker, in Node tests, and in the server verifier. The UI never simulates: it sends commands to the worker and draws the snapshots it gets back.
Every simulation runs in the worker, so the UI never freezes; the API only stores data and re-runs solutions for leaderboards.
### Packages
 | 
Package | 
Responsibility | 
Depends on
 | 
`packages/schema` | 
zod schemas and types for levels, saves, resources, progress and API contracts | 
none
 | 
`packages/det` | 
Seeded PRNG, 32-bit math helpers, canonical JSON and hashing | 
none
 | 
`packages/platform-core` | 
Track registry, level runner, checker interface, unlock graph, hints, progress rules | 
schema
 | 
`packages/sim-logic` | 
Gate-level simulator: netlist compiler, event engine, clock, power, behavioral models | 
schema, det
 | 
`packages/rv32` | 
RISC-V emulator (RV32IMA + Zicsr, M/S/U modes, Sv32) and devices | 
det
 | 
`packages/asm` | 
Assembler, disassembler and flat-image linker | 
rv32 encodings
 | 
`packages/cc` | 
C subset compiler that emits RISC-V assembly | 
asm
 | 
`packages/libc` | 
Startup code and a small C library, compiled at build time | 
cc
 | 
`packages/os-kit` | 
Bootloader, reference kernel (hidden), disk image builder, test programs | 
cc, asm
 | 
`packages/tensor` | 
Tensors, autograd, CPU and WebGPU backends | 
det
 | 
`packages/content` | 
Tracks, levels, tutorials, resources and hidden reference solutions | 
schema
 | 
`packages/worker` | 
Worker entry, command protocol, time slicing, snapshot diffs | 
sim-logic, rv32, tensor
 | 
`apps/web` | 
React app with board, code and graph editors | 
platform-core, worker, content
 | 
`apps/api` | 
NestJS API: auth, saves, progress, shares, verification jobs | 
schema, sim packages
 | 
`tools/*` | 
Content checker, link checker, benchmarks, ISA and compiler test runners | 
various
### Runtime split
Main thread: React UI, canvas rendering, input, autosave and sync outbox in IndexedDB.
Sim worker: owns all simulation state, runs in slices of at most 8 ms, and posts snapshots at most 60 times a second.
Server: stores saves and progress, and re-runs submitted solutions in sandboxed worker threads for leaderboards.
### Track plugin interface
; // test kinds this track adds
  components: ComponentLibrary;      // primitives and verified blocks
  panels: PanelKind[];               // 'waveform', 'registers', 'memory', 'loss-curve'
}
interface Checker {
  kind: string;
  run(sim: SimulatorHandle, test: TestSpec, limits: Limits): Promise;
}]]>
Track 1 is built against this interface from the start. M12 moves anything Track 1 hard-coded into the plugin once Track 2 needs it.
## Data formats
Every stored format is versioned JSON, validated by a zod schema, with a forward migration for each version bump. A client that meets a version newer than it knows refuses to load it and never overwrites it.
### Level
Reference solutions live in `packages/content/solutions/`. CI runs them, and the client bundle never includes them.
### Resource
### Save
 }[];
    wires: { id: string; from: PinRef; to: PinRef; points: [number, number][] }[];
    chips: Record;  // custom chips, referenced by stable id, never by name
  };
  source?: string;           // assembly or C text
}]]>
### Versioning rules
Level ids never change. Renaming a level changes only its title.
A completed level stays completed when its version changes; scores from older versions leave the leaderboard.
Migrations are pure functions from version N to N+1, each with a fixture test.
Imports reject files over 5 MB, nesting deeper than 64 levels, and keys named `__proto__`, `constructor` or `prototype`.
## Simulation engine
The logic simulator is event-driven with a unit gate delay, so players can build latches from NAND, and it compiles verified parts into fast straight-line code. A slow, simple reference engine is kept forever, and the fast engine is fuzzed against it on every PR.
### Values and nets
A 1-bit signal is 0, 1 or X (unknown). Buses carry 1 to 64 bits, each bit with its own X flag.
An unconnected input reads X. X propagates unless the other input decides the result, so 0 AND X gives 0.
Two drivers with different values on one net make it X and raise a `contention` diagnostic.
Tri-state buffers output Z. A net resolves to its single non-Z driver, or to X with a diagnostic when several drive it.
Mismatched widths between pins are compile errors, and the design cannot run until they are fixed.
### Compile step
Flatten custom chips into one netlist, except chips running as behavioral models.
Find strongly connected components. Levelize the acyclic part into topological order.
Emit typed arrays: gate types, input and output indices, and net values.
Refuse designs over 200,000 flattened gates or 64 MB of state, before running anything.
### Settle and clock
A tick has two phases: apply input and clock changes, then settle until no events remain.
Acyclic gates are evaluated once per settle in level order. Gates inside loops use event propagation.
Settle stops at an event budget (default 1,000 events per gate, capped at 5 million per tick). Nets still changing are marked `unstable`, and tests fail with an oscillation message.
v1 has one global clock. Flip-flops sample on its rising edge.
### Power and reset
Power off stops the clock and clears all volatile state: wires, latches, flip-flops, registers and RAM.
ROM and the block device are non-volatile and keep their contents across power cycles.
Power on sets volatile state to 0 or to seeded random values, per the level's `power` setting.
Power on then holds `reset` high for 4 cycles. Reset loads the boot vector into the program counter.
### Behavioral swap
When a player's chip passes its level, its canonical TypeScript model becomes available as a fast block.
Swap applies to combinational chips with exhaustive tests, and to sequential chips whose outputs change only after the clock edge.
At swap time, 10,000 random input vectors compare the player's gates with the model. Any difference refuses the swap and shows the vector.
A "simulate my gates" toggle runs the player's own design instead, for debugging.
### Determinism and limits
`sim-logic` and `rv32` use no `Date.now`, no `Math.random` and no floating point. Randomness comes from a seeded PRNG passed in.
32-bit math uses `Math.imul`, `>>> 0` and `| 0`, with tests at 0, 1, -1, 0x7FFFFFFF and 0x80000000.
Every run has a cycle budget and a wall-clock budget. Stop always works, because the worker yields every 8 ms.
Golden tests produce identical results in Node, Chromium, Firefox and WebKit.
### Worker protocol
 | 
Command | 
Effect
 | 
`load(design, level)` | 
Compile and return diagnostics
 | 
`step(n)`, `run(hz)`, `pause()` | 
Advance ticks or cycles, or stop
 | 
`setInput(pin, value)` | 
Change a switch or input pin
 | 
`power(on)`, `reset()` | 
Power cycle or reset
 | 
`runTests()` | 
Run the level's tests, streaming results
 | 
`watch(netIds)` | 
Choose which nets appear in snapshots
Snapshots carry only watched nets that changed, sent as transferable ArrayBuffers. If the worker crashes, the UI restarts it, keeps the editor state, and shows the error.
### RISC-V emulator (behavioral CPU, from M7)
Interpreter with a decode cache per 4 KiB page. A write to a cached page invalidates it, which covers self-modifying code and FENCE.I.
Speed target: at least 10 million instructions per second in Chromium on a mid-range 2020 laptop.
Traps follow the RISC-V privileged spec: illegal instruction, misaligned access, access fault, ECALL, EBREAK, timer and external interrupts.
WFI parks the worker until the next timer or device event instead of spinning.
### Machine memory map
RAM, UART, CLINT and PLIC addresses follow QEMU's virt machine, so outside tutorials match.
 | 
Region | 
Base address | 
Size
 | 
Boot ROM (reset vector) | 
0x0000_0000 | 
64 KiB
 | 
CLINT timer (mtime, mtimecmp) | 
0x0200_0000 | 
64 KiB
 | 
PLIC subset | 
0x0C00_0000 | 
4 MiB window
 | 
UART (16550 subset) | 
0x1000_0000 | 
256 B
 | 
Keyboard | 
0x1000_1000 | 
256 B
 | 
Block device (512-byte sectors) | 
0x1000_2000 | 
4 KiB
 | 
Framebuffer control and palette | 
0x1000_3000 | 
4 KiB
 | 
Framebuffer pixels (320 by 200, 8 bits each) | 
0x2000_0000 | 
64,000 B
 | 
RAM | 
0x8000_0000 | 
16 MiB default, 64 MiB max
Any access outside these regions raises an access fault with the address in `mtval`.
## Editor and UX
The editor is desktop-first, works fully by keyboard and mouse, and never freezes because all heavy work runs in the worker. Tablets can edit with touch; phones get tutorials, resources and progress, read-only.
### Board editor
Grid snapping; place, move, rotate, flip and delete parts.
Orthogonal wires with waypoints, and junction dots where nets join.
Pan and zoom by mouse wheel, trackpad pinch and touch; zoom to fit; a minimap on large boards.
Selection by click, Shift-click and box; copy, cut and paste within and across levels.
Undo and redo for every edit through a command stack, at least 500 steps per session.
Autosave to IndexedDB 1 second after the last edit, on tab hide, and before unload.
Pin tooltips show name and width; wires show bus width; running wires show live values.
### Custom chips
"Make chip" turns the current board into a reusable part. Its input and output pins become ports, in an order the player can change.
Double-click enters a chip; breadcrumbs lead back out.
Editing a chip's definition updates every instance. Deleting a chip in use lists its usages first.
A chip can never contain itself, directly or through other chips. The editor blocks it, and the loader rejects such saves.
### Running and debugging
Controls: power, reset, step one tick, step one clock cycle, run at a chosen speed, pause.
Waveform panel: pin any net to a timeline and scrub through the last 4,096 ticks.
Probe: hover a wire to see its value in binary, decimal and hex.
Diagnostics panel: contention, unstable nets, floating inputs and width errors. Clicking one pans to the part.
### Test runner
Runs the level's tests in the worker and shows pass or fail per case as results stream in.
The first failing case shows inputs, expected and actual values, and can be replayed step by step.
Success shows the afterword, the newly unlocked parts and the next level.
### Code levels (assembly and C)
CodeMirror editor with highlighting, inline errors, and the current line tied to the program counter.
Debugger: breakpoints, step instruction, step line in C, registers, memory hex view, call stack and CSRs.
Console panel for UART output and keyboard input; framebuffer panel for the screen device.
### Accessibility and comfort
Color never carries meaning alone: 1 is bright and solid, 0 is dim, X is striped, and contention flashes an outline.
A palette checked with color-blindness simulators, light and dark themes, and a reduced-motion setting.
Menus, tutorials and test results work with keyboard and screen readers, checked by axe in CI.
All interface text goes through i18n keys from day one, even while only English ships.
## Curriculum
Track 1 has 10 phases and 88 levels; Track 2 has 7 phases and 31 levels. Content agents write each level from this outline, and the owner approves tutorial text and links before merge.
### Track 1: NAND to OS
 | 
Phase | 
Levels, in order | 
Count | 
Unlocks
 | 
0 Onboarding | 
Wires and lamps; switches; meet NAND | 
3 | 
Switch, lamp, NAND
 | 
1 Gates | 
NOT, AND, OR, NOR, XOR, XNOR, 3-input AND, 2:1 multiplexer, demultiplexer, 2-to-4 decoder | 
10 | 
Each gate as a block
 | 
2 Arithmetic | 
Binary counting (interactive), half adder, full adder, 8-bit adder, two's complement negation, subtractor, equality, signed and unsigned less-than, logic unit, shifter, 8-bit ALU with flags, widening to 32 bits | 
12 | 
Adder, ALU, splitter, joiner
 | 
3 Memory and time | 
The clock, SR latch from NAND, D latch, D flip-flop, register with enable, 8-bit register, counter, register file (4 by 8), RAM (16 by 8), ROM | 
10 | 
Flip-flop, register, RAM, ROM
 | 
4 Toy CPU (8-bit) | 
Program counter, fetch from ROM, decoder, register file wiring, ALU execute, load and store, jump, conditional branch, halt, first program (multiply by repeated addition) | 
10 | 
Toy-8 CPU, machine-code editor
 | 
5 RISC-V core | 
Register file with x0 fixed at 0, immediate generator, ALU control, branch comparator, load/store unit with sign extension, next-PC logic, single-cycle RV32I datapath, running test programs, optional 5-stage pipeline | 
9 | 
RV32IM CPU block
 | 
6 Assembly | 
Hand-encoding instructions, ABI register names, loops, arrays, functions and the stack, recursion, strings, optional: write an assembler | 
8 | 
Assembler, debugger
 | 
7 Devices and interrupts | 
Memory-mapped I/O, UART output, keyboard polling, CSRs and the timer, trap handler, timer interrupt, framebuffer, block device | 
8 | 
Full machine with devices
 | 
8 C | 
Translating C to assembly by hand, variables and control flow, functions, pointers and arrays, structs, strings and printf, heap with malloc and free, optional: build a compiler | 
8 | 
C compiler, libc
 | 
9 Operating system | 
Bootloader, kernel entry and trap vector, system calls, processes and context switch, preemptive scheduler, virtual memory (Sv32, user and supervisor modes), memory allocator, file system, shell, final project: a game on your OS on your CPU | 
10 | 
The finished computer
### Track 2: Neuron to LLM
 | 
Phase | 
Levels, in order | 
Count
 | 
1 Numbers | 
Vectors and dot product, matrix multiply, broadcasting, softmax | 
4
 | 
2 Learning | 
A neuron, loss functions, gradient descent in 1D, the chain rule by hand, an autograd engine with gradient checks | 
5
 | 
3 Networks | 
An MLP that solves XOR, training loop and learning rate, overfitting and validation, a small digit recognizer | 
4
 | 
4 Text | 
Character tokenizer, BPE tokenizer, embeddings, bigram language model | 
4
 | 
5 Transformer | 
Positional encoding, single-head self-attention, causal mask, multi-head attention, layer norm and residuals, full transformer block | 
6
 | 
6 Tiny GPT | 
Batching and data pipeline, training on public-domain text, loss curves and perplexity, sampling (greedy, temperature, top-k, top-p) | 
4
 | 
7 Beyond | 
Fine-tuning, LoRA, a toy preference model, a scaling experiment | 
4
### Resource policy
2 to 4 resources per level, with at least one tagged `start-here`.
Agents fetch every URL and record `verifiedTitle` and `verifiedAt`. A URL written from memory is rejected by CI.
YouTube links are checked through YouTube's oEmbed endpoint; other links by GET, following redirects.
Prefer course sites, official specifications and established authors. Avoid content farms and auto-generated videos.
A resource about another ISA or notation carries a `differsNote` badge.
Link out by default. YouTube embeds use the privacy-enhanced domain and load only after a click. Never copy text from a source.
A weekly CI job opens an issue for each failing link. It never swaps links on its own.
Datasets: public domain or permissive licenses only, recorded in `content/datasets/LICENSES.md`, at most 20 MB per level.
### Candidate sources to verify
Names only; each becomes a link after an agent fetches and checks it.
Hardware: Crash Course Computer Science; Ben Eater's 8-bit breadboard computer series; Sebastian Lague's Digital Logic Sim videos; the Nand2Tetris course and book.
RISC-V: the unprivileged and privileged ISA specifications; The RISC-V Reader.
Compilers: Nora Sandler's Writing a C Compiler; Rui Ueyama's chibicc; Jack Crenshaw's Let's Build a Compiler.
Operating systems: Operating Systems: Three Easy Pieces; the xv6 book and MIT 6.1810 labs; the OSDev wiki. xv6-riscv targets 64-bit RISC-V, so it serves as a reference design here.
LLMs: Andrej Karpathy's Neural Networks: Zero to Hero; Attention Is All You Need (Vaswani et al., 2017).
## Backend
The API is one NestJS service on Postgres that stores saves and progress, publishes shares, and re-verifies leaderboard submissions; nobody needs it to play. Guests play fully offline, and an account adds sync, sharing and leaderboards.
### Modules
 | 
Module | 
Endpoints (REST under `/v1`) | 
Notes
 | 
auth | 
Sign in by magic link or GitHub, sign out, session | 
Cookie sessions; CSRF token on every write
 | 
users | 
Read and update profile, export data, delete account | 
Deletion removes personal data within 30 days
 | 
progress | 
Read all, upsert one level's status | 
Merge rules below
 | 
saves | 
List, read, write with `baseRevision`, delete | 
Immutable revisions plus a head pointer per level
 | 
shares | 
Create a public snapshot, read by slug | 
Read-only, immutable, size-limited
 | 
submissions | 
Submit a save for scoring, read its status | 
Queued in pg-boss, run by the verifier
 | 
verifier | 
Separate process, no public endpoints | 
Node worker threads with memory and time limits
 | 
content | 
Current content manifest version | 
Content files themselves come from the CDN
 | 
health | 
Liveness and readiness | 
Used by the host and uptime checks
### Postgres schema, first cut
 | 
Table | 
Key columns
 | 
users | 
id, email (unique, case-insensitive), display_name, locale, created_at, deleted_at
 | 
auth tables | 
Created and managed by the auth library
 | 
level_progress | 
user_id, level_id, level_version, status, best_metrics (jsonb), completed_at; key (user_id, level_id)
 | 
save_revisions | 
id, user_id, level_id, schema_version, content_hash, data (jsonb, up to 1 MB) or blob_key, parent_id, device_id, created_at
 | 
save_heads | 
user_id, level_id, slot, revision_id, updated_at; key (user_id, level_id, slot)
 | 
shares | 
slug (unique), revision_id, title, created_at, hidden
 | 
submissions | 
id, user_id, level_id, level_version, revision_id, status, metrics (jsonb), verifier_version, error, created_at
 | 
reports | 
id, share_slug, reason, reporter_id, created_at, resolved_at
### Sync and conflicts
The client queues changes in an IndexedDB outbox and pushes them when online, with backoff.
Each save write sends `baseRevision`. If the head has moved, the server keeps both revisions and returns 409, and the client asks which to keep.
Progress merges by taking the best status and best metrics per level. It never moves backward.
On first sign-in, guest progress and saves merge into the account by the same rules.
### Verification
The server ignores scores sent by clients and recomputes them from the save with the same simulation packages.
Each job runs in a worker thread with a 256 MB heap limit, a 10-second budget, and no network or file access.
Results record `verifier_version`, so a simulator fix can re-verify old submissions.
### Security and privacy
zod validation on every request. Bodies over 2 MB get 413; saves over 1 MB go to R2 through signed upload URLs.
Rate limits per IP and per user, answering 429 with Retry-After.
Strict Content Security Policy: scripts from self, workers from self and blob, frames only from YouTube's privacy-enhanced domain.
User text (display names, share titles) is plain text, length-limited and escaped. No HTML or MDX from users.
LGPD and GDPR basics: minimal data, a privacy policy, data export, account deletion, and consent before any analytics.
Secrets live in environment variables; CI runs a dependency audit against the lockfile.
## Testing and quality
Correctness rests on differential testing: every fast engine is compared with a slow reference or an external standard. CI blocks a merge on any failing test or missed performance budget.
 | 
Layer | 
What is tested | 
Tooling
 | 
Unit | 
Every package's public functions, with edge values | 
Vitest
 | 
Property | 
Adders, ALU, shifts and encoders over random inputs; serialize and parse round trips | 
fast-check
 | 
Differential: logic | 
Fast engine against the reference engine on random circuits, loops included | 
fast-check with seeded generators
 | 
Differential: CPU | 
rv32 instruction traces against the Spike reference simulator on random programs | 
Docker image, CI only
 | 
ISA compliance | 
Official riscv-tests (rv32ui, rv32um, rv32mi) and the RISC-V architecture test suite | 
`tools/isa-runner`
 | 
Compiler | 
A corpus of C programs: our compiler against riscv gcc, both run on our emulator, same output and exit code | 
`tools/cc-diff`
 | 
Content | 
Schema valid; reference solution passes; empty and trivial solutions fail; every level reachable; no unlock cycles; hints and afterword present | 
`tools/content-check`
 | 
Resources | 
Every link has `verifiedAt` and `verifiedTitle`; weekly live check | 
`tools/link-check`
 | 
End to end | 
Solve level 1 with the mouse, autosave and reload, offline play, power cycle, two open tabs | 
Playwright on Chromium, Firefox, WebKit
 | 
Accessibility | 
Menus, tutorials, test results | 
axe in Playwright
 | 
Performance | 
The budgets below, on every PR | 
`tools/bench`
The rule that empty and trivial solutions must fail catches tests that pass by accident. Vendored test suites keep their license files, and the owner checks each license before import.
### Performance budgets
 | 
Metric | 
Budget
 | 
Editor frame time, 2,000 visible components | 
16 ms or less (60 fps)
 | 
Settle of a flattened 32-bit ripple adder | 
1 ms or less
 | 
RISC-V interpreter speed in Chromium | 
10 million instructions per second or more
 | 
JavaScript for the first level, gzipped | 
400 KB or less
 | 
Time to interactive on a mid-range laptop | 
2 seconds or less
## Edge cases
Each case below needs a test whose name contains its ID before its milestone closes. Backlog tasks reference these IDs in their acceptance criteria.
### Simulation
 | 
ID | 
Case | 
Expected handling
 | 
E-SIM-01 | 
A gate's output feeds its own input, like a NOT ring | 
Settle budget ends; nets marked unstable; test fails with an oscillation message; UI stays responsive
 | 
E-SIM-02 | 
Two outputs drive one net with different values | 
Net becomes X; contention diagnostic; both drivers highlighted
 | 
E-SIM-03 | 
An input pin is left unconnected | 
Reads X; test fails naming the floating pin
 | 
E-SIM-04 | 
Bus width mismatch between pins | 
Compile error; run disabled; both ends highlighted
 | 
E-SIM-05 | 
A chip contains itself, directly or through other chips | 
Blocked in the editor; the loader rejects such saves with a clear message
 | 
E-SIM-06 | 
Design exceeds 200,000 flattened gates | 
Refused before running; message suggests verified blocks
 | 
E-SIM-07 | 
Registers read before reset after power on | 
Value per level setting (0 or seeded random); tests check behavior after reset, not luck
 | 
E-SIM-08 | 
Power off during a run | 
Clock stops; volatile state cleared; ROM and disk kept
 | 
E-SIM-09 | 
A player's chip passes the tests but differs from the model elsewhere | 
Swap refused at fuzz time; the differing input is shown
 | 
E-SIM-10 | 
A program loops forever | 
Cycle budget ends the test; pause still works; message suggests a halt
 | 
E-SIM-11 | 
Worker crashes or runs out of memory | 
Worker restarts; editor state kept; error shown
 | 
E-SIM-12 | 
Tab hidden during a long run | 
Run pauses by default and resumes on return; a setting keeps it running
### CPU
 | 
ID | 
Case | 
Expected handling
 | 
E-CPU-01 | 
Write to x0 | 
Ignored; x0 always reads 0
 | 
E-CPU-02 | 
Signed and unsigned 32-bit math in JavaScript | 
Normalized with `>>> 0` and `Math.imul`; boundary tests at 0, 1, -1, 0x7FFFFFFF, 0x80000000
 | 
E-CPU-03 | 
Division by zero (M extension) | 
Quotient all ones, remainder equals the dividend, no trap, as the spec says
 | 
E-CPU-04 | 
Most negative integer divided by -1 | 
Quotient is the dividend, remainder 0, as the spec says
 | 
E-CPU-05 | 
Misaligned load or store | 
Trap with the misaligned cause; a level teaches the handler
 | 
E-CPU-06 | 
JALR target with its lowest bit set | 
Lowest bit cleared, as the spec says
 | 
E-CPU-07 | 
Jump or branch to an address not divisible by 4 | 
Instruction-address-misaligned exception
 | 
E-CPU-08 | 
Illegal or unimplemented instruction, including an all-zero word | 
Illegal-instruction trap; debugger shows the word
 | 
E-CPU-09 | 
Access outside mapped memory | 
Access-fault trap with the address in mtval
 | 
E-CPU-10 | 
Self-modifying code and FENCE.I | 
Decode cache invalidated on any write to a cached page
 | 
E-CPU-11 | 
WFI with no interrupt ever arriving | 
Worker idles; UI shows waiting for interrupt; test budget still applies
 | 
E-CPU-12 | 
CSR access from a lower privilege mode | 
Illegal-instruction trap
### Data and editor
 | 
ID | 
Case | 
Expected handling
 | 
E-DATA-01 | 
Same level open in two tabs | 
BroadcastChannel lock; second tab is read-only with a take-over button
 | 
E-DATA-02 | 
IndexedDB missing (some private modes) or quota exceeded | 
In-memory mode with a banner and an export button; no silent loss
 | 
E-DATA-03 | 
Malformed or hostile import file | 
Rejected by schema, size and depth limits; prototype keys stripped
 | 
E-DATA-04 | 
Save written by a newer app version | 
Refused and never overwritten; prompt to reload the app
 | 
E-DATA-05 | 
Save in an old format | 
Migrated forward; original kept until the migrated copy is saved
 | 
E-DATA-06 | 
Level updated after the player solved it | 
Stays completed with a level-updated badge; old score leaves the leaderboard
 | 
E-DATA-07 | 
Paste includes parts not unlocked in this level | 
Those parts are dropped, with a message listing them
 | 
E-DATA-08 | 
Deleting a custom chip that other boards use | 
Usages listed; deletion leaves a tombstone so old saves still load
 | 
E-DATA-09 | 
App updated while a device was offline with old cached content | 
Versions checked on reconnect; reload prompt if incompatible
### Content and resources
 | 
ID | 
Case | 
Expected handling
 | 
E-RES-01 | 
Link dead, redirected elsewhere, or a soft 404 (works but shows a different title) | 
Weekly check opens an issue; the level shows its remaining links
 | 
E-RES-02 | 
Video removed, private, region-blocked or not embeddable | 
oEmbed check fails; shown as a plain link or hidden
 | 
E-RES-03 | 
Resource uses a different ISA or notation | 
`differsNote` badge beside it
 | 
E-RES-04 | 
Resource only in English for a Portuguese-speaking player | 
Language badge; sorted after resources in the player's language
 | 
E-RES-05 | 
Agent adds a URL it never fetched | 
CI rejects resources without `verifiedAt` and `verifiedTitle`
 | 
E-RES-06 | 
A level's tests pass an empty solution | 
content-check fails the build
### Platform
 | 
ID | 
Case | 
Expected handling
 | 
E-PLAT-01 | 
Guest signs in to an account that already has progress | 
Best status per level wins; both save versions kept
 | 
E-PLAT-02 | 
Client submits a faked score | 
Ignored; the server recomputes from the save
 | 
E-PLAT-03 | 
Submission hangs or uses too much memory | 
Worker thread killed at its limits; status set to timeout or limit
 | 
E-PLAT-04 | 
Offensive text in a share title | 
Report button; hidden while under review; length limits
 | 
E-PLAT-05 | 
Account deletion request | 
Personal data removed; shares unpublished; audit entry without personal data
 | 
E-PLAT-06 | 
Cross-origin isolation would block YouTube embeds | 
v1 sends no COEP header and uses no SharedArrayBuffer; embeds load on click
 | 
E-PLAT-07 | 
A pull request from a fork tries to read CI secrets | 
Fork PRs run without secrets; preview deploys and secret-using jobs run only for branches in the main repo
### LLM track
 | 
ID | 
Case | 
Expected handling
 | 
E-ML-01 | 
WebGPU missing, or device lost mid-training | 
CPU fallback with a smaller config; resume from the last checkpoint
 | 
E-ML-02 | 
Different GPUs give slightly different floats | 
Checks use tolerances and statistics, never exact equality
 | 
E-ML-03 | 
Loss becomes NaN or infinite | 
Training stops; the level explains exploding gradients and suggests a lower learning rate
 | 
E-ML-04 | 
Model larger than the device's buffer limits | 
Adapter limits read first; config scaled down with a message
 | 
E-ML-05 | 
Gradient checks are noisy in float32 | 
Gradient-check levels run in float64 on the CPU
 | 
E-ML-06 | 
Tab closed during training | 
Checkpoint to IndexedDB every N steps; resume offered
 | 
E-ML-07 | 
Dataset with unclear licensing | 
Not allowed; each dataset's license is recorded and checked by content-check
## Milestones and backlog
Fifteen milestones run from an empty repo to two tracks and community features, and each one ends with something playable or deployable. M3 is the first public release; M6, M12, M13 and M14 run beside the Track 1 path.
M6 can start once M3 ships, M12 once Track 1 reaches the toy CPU, and M14 waits for both M6 and M12.
### M0 Foundations
Exit: an empty but fully wired repo, with CI, schemas and agent rules in place.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
FND-01 | 
Monorepo with the packages and apps from Architecture; strict TypeScript, ESLint, Prettier, shared configs | 
none | 
`pnpm build`, `pnpm test` and `pnpm lint` pass; each package builds alone | 
S
 | 
FND-02 | 
GitHub Actions CI: install, lint, type check, test, build, with Turbo cache | 
FND-01 | 
CI required on `main`; a full run takes under 10 minutes | 
S
 | 
FND-03 | 
`AGENTS.md`, `CLAUDE.md` and a PR template with the acceptance-criteria checklist | 
FND-01 | 
Files match the working agreement in this plan | 
S
 | 
FND-04 | 
ADR template plus ADR-001 (stack), ADR-002 (no SharedArrayBuffer in v1), ADR-003 (auth library) | 
FND-01 | 
Three ADRs merged after owner review | 
S
 | 
FND-05 | 
`packages/schema`: Level, Resource, Save and Progress schemas with versions and JSON Schema export | 
FND-01 | 
Round-trip tests; invalid fixtures rejected; E-DATA-03 passes | 
M
 | 
FND-06 | 
Migration runner from any version to the latest; refuses newer versions | 
FND-05 | 
A fixture test per version; E-DATA-04 and E-DATA-05 pass | 
S
 | 
FND-07 | 
`packages/det`: seeded PRNG (xoshiro128**), 32-bit helpers, canonical JSON, SHA-256 | 
FND-01 | 
Same sequences in Node and three browsers; E-CPU-02 boundary tests pass | 
S
 | 
FND-08 | 
Web app shell: Vite, React, routing, theme tokens, i18n keys | 
FND-01 | 
App boots; light and dark themes; a sample string switches locale | 
S
 | 
FND-10 | 
Open-source files: LICENSE per the license decision, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY; fork-safe CI workflows | 
FND-02 | 
Files present; pull requests from forks run without secrets; E-PLAT-07 passes | 
S
### M1 Logic simulation core
Exit: the engine runs NAND-built circuits, latches and clocks deterministically inside a worker.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
SIM-01 | 
Reference engine: plain event-driven simulation with 0, 1 and X and unit delay | 
FND-05, FND-07 | 
NAND-built NOT, AND, OR and XOR pass truth tables; an SR latch holds state | 
M
 | 
SIM-02 | 
Netlist model and flattening of custom chips, with chip cycle detection | 
SIM-01 | 
Nested chips flatten correctly; E-SIM-05 passes | 
M
 | 
SIM-03 | 
Compiler: strongly connected components, levelization, typed-array output | 
SIM-02 | 
Output matches the reference on 1,000 random acyclic circuits | 
M
 | 
SIM-04 | 
Fast engine: level-order evaluation plus event propagation inside loops | 
SIM-03 | 
Matches the reference on every tick of 10,000 random circuits with loops | 
M
 | 
SIM-05 | 
Settle budget and oscillation detection | 
SIM-04 | 
E-SIM-01 passes; the API returns the unstable nets | 
S
 | 
SIM-06 | 
Diagnostics for contention, floating inputs and width mismatch | 
SIM-03 | 
E-SIM-02, E-SIM-03 and E-SIM-04 pass with component and pin ids | 
S
 | 
SIM-07 | 
Buses of 1 to 64 bits, splitter, joiner, tri-state buffer | 
SIM-04 | 
Split and join round trips pass property tests; two active drivers give contention | 
M
 | 
SIM-08 | 
Clock, rising-edge D flip-flop primitive, tick and cycle stepping | 
SIM-04 | 
An 8-bit counter counts 0 to 255 and wraps | 
S
 | 
SIM-09 | 
Power model: on, off, volatile clear, non-volatile ROM, seeded init, reset hold | 
SIM-08 | 
E-SIM-07 and E-SIM-08 pass | 
S
 | 
SIM-10 | 
Limits: gate count, state size, cycle and wall-clock budgets, with typed errors | 
SIM-04 | 
E-SIM-06 and E-SIM-10 pass | 
S
 | 
SIM-11 | 
Worker package: protocol, 8 ms slices, snapshot diffs, crash restart, hidden-tab pause | 
SIM-05, SIM-09 | 
UI stays responsive during a 10-second run; E-SIM-11 and E-SIM-12 pass | 
M
 | 
SIM-12 | 
Simulation benchmarks wired to the CI budgets | 
SIM-04 | 
Adder settle budget enforced; results posted on the PR | 
S
### M2 Board editor
Exit: a player builds and runs a circuit with the mouse, and nothing is lost on reload.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
EDIT-01 | 
Canvas renderer behind a `Renderer` interface: grid, parts, wires, camera | 
FND-08 | 
Benchmark page draws 2,000 parts at 60 fps | 
M
 | 
EDIT-02 | 
Hit testing with a spatial index | 
EDIT-01 | 
Correct pin picked on 1,000 random overlapping fixtures | 
S
 | 
EDIT-03 | 
Place, move, rotate, flip and delete parts with grid snapping | 
EDIT-02 | 
Playwright places, rotates and deletes a NAND; model state matches | 
M
 | 
EDIT-04 | 
Wiring: drag from a pin, orthogonal routing with waypoints, junctions, net merge and split | 
EDIT-03 | 
Deleting a middle segment splits the net correctly, in unit and end-to-end tests | 
M
 | 
EDIT-05 | 
Selection, box select, copy, cut and paste | 
EDIT-03 | 
Pasted parts get new ids; E-DATA-07 passes | 
M
 | 
EDIT-06 | 
Command stack for undo and redo of every edit | 
EDIT-04, EDIT-05 | 
A 500-step random edit, undo and redo fuzz returns identical models | 
M
 | 
EDIT-07 | 
Pan and zoom by mouse, trackpad and touch; zoom to fit | 
EDIT-01 | 
Works in Chromium and WebKit with touch emulation | 
S
 | 
EDIT-08 | 
Autosave to IndexedDB on debounce, hide and unload; two-tab lock | 
FND-05, EDIT-03 | 
Reload restores the board; E-DATA-01 and E-DATA-02 pass | 
M
 | 
EDIT-09 | 
Live wire values from worker snapshots; probes; color-blind-safe patterns | 
SIM-11, EDIT-04 | 
A switch toggle updates its lamp within one frame | 
M
 | 
EDIT-10 | 
Diagnostics panel linked to canvas highlights | 
SIM-06, EDIT-09 | 
Clicking a diagnostic pans to the part and highlights it | 
S
### M3 Levels and first playable
Exit: Phases 0 and 1 play at a public URL, offline included.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
LVL-01 | 
Level registry built from content output; unlock graph | 
FND-05 | 
No cycles; every level reachable; locked levels cannot be opened by URL | 
M
 | 
LVL-02 | 
Test runner with truth-table and sequence checkers in the worker | 
SIM-11 | 
Per-case results stream in; the first failure replays; budgets respected | 
M
 | 
LVL-03 | 
Level screen: spec panel, palette limited to allowed parts, test button, success flow | 
LVL-01, LVL-02, EDIT-09 | 
End to end: build NOT from NAND with the mouse and unlock the next level | 
M
 | 
LVL-04 | 
MDX tutorial renderer with an interactive truth-table widget and progressive hints | 
LVL-03 | 
Hints reveal one at a time; renders in both themes | 
M
 | 
LVL-05 | 
Resources panel with tags, language and differs badges, click-to-load YouTube | 
LVL-03 | 
No third-party request before a click; E-RES-02 and E-RES-03 pass | 
S
 | 
LVL-06 | 
Progress store and level map; progress export and import | 
LVL-01 | 
Progress survives reload; export and import round trip | 
S
 | 
CNT-01 | 
Content pipeline: YAML and MDX compiled to validated JSON; `tools/content-check` | 
FND-05 | 
Build fails on schema errors or a missing solution; E-RES-06 passes | 
M
 | 
CNT-02 | 
Link checker: fetch, YouTube oEmbed, title compare, weekly job that opens issues | 
CNT-01 | 
E-RES-01 and E-RES-05 pass; dry-run mode on PRs | 
M
 | 
CNT-03 | 
Write Phase 0 and Phase 1 levels (13) with tutorials, hints, afterwords and verified resources | 
LVL-04, LVL-05, CNT-02 | 
All 13 pass content-check; owner approves text and links | 
L
 | 
FND-09 | 
Deploy to Cloudflare Pages with preview deploys per PR; service worker for offline play | 
LVL-03 | 
A preview URL on each PR; level 1 plays after reload with no network | 
S
### M4 Arithmetic and memory
Exit: Phases 2 and 3 play end to end, including latches from NAND and verified blocks running fast.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
CHIP-01 | 
Make chip from a board: ports, port order, label, stable ids | 
EDIT-05, SIM-02 | 
A chip made in one level works in another; renaming keeps references | 
M
 | 
CHIP-02 | 
Enter and exit chips, with breadcrumbs | 
CHIP-01 | 
Editing inside a chip updates every instance, end to end | 
M
 | 
CHIP-03 | 
Chip dependency graph: block self-inclusion, list usages, tombstones | 
CHIP-01 | 
E-SIM-05 and E-DATA-08 pass | 
S
 | 
CHIP-04 | 
Behavioral swap: canonical models, equivalence fuzz at swap time, simulate-my-gates toggle | 
CHIP-01, SIM-04 | 
E-SIM-09 passes; a swapped 32-bit adder settles at least 10 times faster than flattened | 
M
 | 
EDIT-11 | 
Waveform panel: pin nets, 4,096-tick history, scrubbing | 
SIM-11 | 
Clock and counter waveforms render; scrubbing shows past values | 
M
 | 
EDIT-12 | 
Power and reset controls, power light, run speed | 
SIM-09, EDIT-09 | 
End to end: a power cycle clears RAM and keeps ROM | 
S
 | 
SIM-13 | 
RAM and ROM parts (behavioral, up to 64 KiB) with a hex editor for ROM | 
SIM-09 | 
Read and write tests pass; ROM survives a power cycle | 
M
 | 
LVL-07 | 
Checker kinds: clocked sequences, exhaustive combinational, random property | 
LVL-02 | 
Each kind has unit tests and failing-case replay | 
M
 | 
CNT-04 | 
Write Phase 2 levels (12) | 
CHIP-04, LVL-07 | 
All pass content-check; owner approves | 
L
 | 
CNT-05 | 
Write Phase 3 levels (10), including the SR latch from NAND | 
EDIT-11, SIM-13 | 
The latch level is solvable with loops; all pass content-check | 
L
### M5 Toy CPU
Exit: Phase 4 plays end to end, and players run a first program on a CPU they wired.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
TOY-01 | 
Toy-8 ISA spec: 8-bit data, 4 registers, 256 bytes of memory, 16 instructions, plus a reference model | 
none | 
Owner approves the spec; the model passes a test per instruction | 
S
 | 
TOY-02 | 
Machine-code editor: binary and hex entry with a mnemonic preview | 
TOY-01, SIM-13 | 
A program typed in the editor runs on the reference model | 
M
 | 
TOY-03 | 
Program-run checker: load ROM, run N cycles, compare registers, memory and output | 
LVL-07, TOY-01 | 
Accepts a correct program; rejects an off-by-one version | 
S
 | 
TOY-04 | 
CPU panels: program counter, registers, current instruction, memory | 
TOY-02 | 
Panels update at 60 Hz without dropped frames | 
M
 | 
CNT-06 | 
Write Phase 4 levels (10) | 
TOY-03, TOY-04 | 
All pass content-check; owner approves | 
L
### M6 Accounts and cloud (parallel, after M3)
Exit: optional accounts sync progress and saves across devices.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
API-01 | 
NestJS skeleton: config, health, OpenAPI, zod validation, error format | 
FND-05 | 
Health returns 200; an invalid body returns 400 with field errors | 
S
 | 
API-02 | 
Postgres with Drizzle: tables from Backend, migrations, seed, test database in CI | 
API-01 | 
Migrations run up and down in CI | 
M
 | 
API-03 | 
Auth per ADR-003: magic link, GitHub, cookie sessions, CSRF | 
API-02, FND-04 | 
Sign-in works end to end; a write without a CSRF token gets 403 | 
M
 | 
API-04 | 
Saves API: revisions, heads, conflicts on `baseRevision`, signed R2 uploads over 1 MB | 
API-03 | 
A conflict returns 409 with both revisions; oversized bodies get 413 | 
M
 | 
API-05 | 
Progress API with merge rules and guest merge on first sign-in | 
API-03 | 
E-PLAT-01 passes; progress never decreases | 
S
 | 
WEB-01 | 
Client sync: IndexedDB outbox, retry with backoff, conflict screen | 
API-04, API-05, EDIT-08 | 
Offline edits sync on reconnect; a two-device conflict shows both versions; E-DATA-09 passes | 
M
 | 
API-06 | 
Rate limits, security headers, CSP, body limits | 
API-01 | 
Header tests pass; 429 includes Retry-After | 
S
 | 
API-07 | 
Data export and account deletion | 
API-05 | 
E-PLAT-05 passes | 
S
 | 
API-08 | 
Deploy the API container with managed Postgres, daily backups, Sentry and OpenTelemetry | 
API-06 | 
A restore from backup is tested and documented; errors reach Sentry | 
M
### M7 RISC-V core
Exit: Phase 5 plays end to end, and the emulator passes rv32ui and rv32um.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
RV-01 | 
RV32I decoder for every instruction format, with immediate sign extension | 
FND-07 | 
A table test per opcode; encode and decode round-trip fuzz | 
M
 | 
RV-02 | 
Interpreter for RV32I with a memory bus | 
RV-01 | 
rv32ui passes; E-CPU-01, E-CPU-06 and E-CPU-07 pass | 
M
 | 
RV-03 | 
M extension (multiply and divide) | 
RV-02 | 
rv32um passes; E-CPU-03 and E-CPU-04 pass | 
S
 | 
RV-04 | 
Decode cache with page invalidation, tuned to the speed budget | 
RV-02 | 
10 million instructions per second in the benchmark; E-CPU-10 passes | 
M
 | 
RV-05 | 
Differential harness against Spike in CI | 
RV-02 | 
100,000 random instructions match Spike's trace | 
M
 | 
RV-06 | 
Datapath blocks as canonical models: register file, immediate generator, ALU control, branch unit, load/store unit | 
CHIP-04, RV-02 | 
Each block matches emulator semantics in property tests | 
M
 | 
RV-07 | 
Program-run checker for RISC-V: memory image, registers, UART output | 
TOY-03, RV-02 | 
Accepts correct programs and rejects broken ones | 
S
 | 
CNT-07 | 
Write Phase 5 levels (9), including the optional pipeline challenge | 
RV-06, RV-07 | 
All pass content-check; owner approves | 
L
### M8 Assembly and debugger
Exit: Phase 6 plays end to end, with a debugger players can rely on.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
ASM-01 | 
Assembler for RV32IM: labels, pseudo-instructions (li, la, mv, call, ret), directives (.text, .data, .word, .byte, .ascii, .align) | 
RV-01 | 
Errors point to line and column; the corpus assembles to the expected bytes | 
M
 | 
ASM-02 | 
Disassembler and flat-image linker with a symbol map | 
ASM-01 | 
Disassemble then reassemble is identical across the corpus | 
S
 | 
ASM-03 | 
CodeMirror mode for RISC-V assembly with inline errors | 
ASM-01 | 
Errors underline the right token | 
S
 | 
ASM-04 | 
Debugger: breakpoints, step, registers, memory, stack, symbols | 
ASM-02, RV-04 | 
End to end: break on a label, read a register, continue | 
M
 | 
ASM-05 | 
JavaScript sandbox for the build-your-own-assembler challenge: worker, no network, time limit | 
LVL-07 | 
An infinite loop is killed at the limit; fetch is unavailable inside | 
M
 | 
CNT-08 | 
Write Phase 6 levels (8) | 
ASM-04, ASM-05 | 
All pass content-check; owner approves | 
L
### M9 Devices, traps and privilege
Exit: Phase 7 plays end to end, and the machine has a console, timer, screen and disk.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
DEV-01 | 
Machine bus with device registration and the memory map from Simulation engine | 
RV-02 | 
The map matches the spec table; E-CPU-09 passes | 
S
 | 
DEV-02 | 
Zicsr and machine-mode traps: mtvec, mepc, mcause, mtval, mstatus, mie, mip | 
RV-02 | 
rv32mi passes; E-CPU-05 and E-CPU-08 pass | 
M
 | 
DEV-03 | 
UART (16550 subset) with a console panel | 
DEV-01 | 
A hello-world program prints in the console, end to end | 
S
 | 
DEV-04 | 
CLINT timer and timer interrupts; WFI idle | 
DEV-02 | 
The interrupt fires at the set time; E-CPU-11 passes | 
M
 | 
DEV-05 | 
Keyboard device and PLIC subset for external interrupts | 
DEV-04 | 
A key press raises an interrupt; polling also works | 
M
 | 
DEV-06 | 
Framebuffer (320 by 200, 256-color palette) with a canvas panel | 
DEV-01 | 
A drawing program renders an image with the expected hash | 
M
 | 
DEV-07 | 
Block device with 512-byte sectors, stored in IndexedDB | 
DEV-01, SIM-09 | 
Write, power cycle, then read back the same bytes | 
M
 | 
DEV-08 | 
Supervisor and user modes, trap delegation, Sv32 paging, TLB flush on satp writes and SFENCE.VMA | 
DEV-02 | 
Paging tests pass; E-CPU-12 passes | 
L
 | 
CNT-09 | 
Write Phase 7 levels (8) | 
DEV-03 to DEV-07 | 
All pass content-check; owner approves | 
L
### M10 C compiler and libc
Exit: Phase 8 plays end to end, and C compiles in the browser to run on the player's machine.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
CC-01 | 
C subset spec: int, char, unsigned, pointers, arrays, structs, control flow, functions, globals, string literals, and what is excluded | 
none | 
Owner approves; an example program per feature | 
S
 | 
CC-02 | 
Lexer and preprocessor subset (#include of bundled headers, object-like #define) | 
CC-01 | 
Token tests pass; errors carry positions | 
M
 | 
CC-03 | 
Parser to AST with error recovery | 
CC-02 | 
50 malformed programs each produce one useful first error | 
M
 | 
CC-04 | 
Type checker: integer promotions, pointer arithmetic, struct layout and alignment | 
CC-03 | 
Struct layouts match riscv gcc on 30 test structs | 
M
 | 
CC-05 | 
Code generation to RV32 assembly with the standard calling convention | 
CC-04, ASM-01 | 
Calls work both ways with gcc-compiled functions | 
L
 | 
CC-06 | 
libc subset: startup code, putchar, puts, printf (d, u, x, s, c, p), memcpy, memset, strlen, strcmp, malloc, free | 
CC-05, DEV-03 | 
Same output as gcc-compiled versions on the emulator | 
M
 | 
CC-07 | 
Differential harness: our compiler against riscv gcc on a 200-program corpus | 
CC-05 | 
Runs in CI; any output or exit-code difference fails | 
M
 | 
CC-08 | 
Source-level debugging: line table, step by line, locals view | 
CC-05, ASM-04 | 
End to end: a breakpoint on a C line shows local values | 
M
 | 
CNT-10 | 
Write Phase 8 levels (8) plus the optional compiler challenge | 
CC-06, CC-08 | 
All pass content-check; owner approves | 
L
### M11 Operating system
Exit: Phase 9 plays end to end, and a player's kernel runs a shell and a game on their own CPU.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
OS-01 | 
ROM bootloader that loads a kernel image from the block device into RAM and jumps to it | 
DEV-07 | 
A hello-kernel image boots from disk | 
M
 | 
OS-02 | 
Disk image builder for kernel and file system images | 
OS-01 | 
The same inputs always produce the same image hash | 
S
 | 
OS-03 | 
Reference kernel (hidden solution): traps, system calls, processes, scheduler, Sv32, allocator, file system, shell | 
DEV-08, CC-06 | 
ls, cat, echo and run work in the shell, end to end | 
L
 | 
OS-04 | 
OS checkers: boots to prompt, system call behavior, preemption fairness, memory isolation | 
OS-03, RV-07 | 
Each checker fails on a deliberately broken kernel | 
M
 | 
OS-05 | 
Visualizer panels for the process table and page tables | 
OS-03 | 
Panels match kernel state during a scripted run | 
M
 | 
CNT-11 | 
Write Phase 9 levels (10) and the final project | 
OS-04, OS-05 | 
A game runs on the player's OS on their CPU; all pass content-check | 
L
### M12 Platform and tensor engine (parallel, after M5)
Exit: Track 1 runs through the plugin interface, and the tensor engine trains a small network in the browser.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
PLAT-01 | 
Move Track 1 specifics behind `TrackPlugin`; platform-core keeps only shared logic | 
CNT-06 | 
Track 1 runs unchanged; platform-core has no Track 1 imports | 
M
 | 
PLAT-02 | 
Graph editor for dataflow nodes and tensor edges, reusing the canvas renderer | 
PLAT-01, EDIT-01 | 
A 3-node graph shows tensor shapes on its edges | 
M
 | 
ML-01 | 
Tensor core: shapes, broadcasting, matmul, elementwise ops and reductions in float32 and float64 | 
FND-07 | 
Results match NumPy fixtures within tolerance | 
M
 | 
ML-02 | 
Autograd: reverse-mode tape and a float64 gradient-check utility | 
ML-01 | 
Gradient checks pass for every op; E-ML-05 passes | 
M
 | 
ML-03 | 
WebGPU backend: WGSL kernels for matmul, softmax and layer norm; device-lost handling | 
ML-01 | 
Matches the CPU backend within tolerance; E-ML-01 and E-ML-04 pass | 
L
 | 
ML-04 | 
Training utilities: SGD and Adam, schedules, IndexedDB checkpoints, NaN guard | 
ML-02 | 
E-ML-03 and E-ML-06 pass | 
M
 | 
ML-05 | 
Numeric checkers: tolerance compare, loss under a threshold after N seeded steps, statistical tests | 
LVL-07, ML-04 | 
Stable across 20 seeds and 3 browsers; E-ML-02 passes | 
M
 | 
ML-06 | 
Dataset loader with license records and a size budget | 
ML-01 | 
E-ML-07 enforced by content-check | 
S
### M13 LLM track content
Exit: Track 2 plays end to end.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
CNT-12 | 
Write Track 2 phases 1 to 3 (13 levels) | 
ML-05, PLAT-02 | 
All pass content-check; owner approves | 
L
 | 
CNT-13 | 
Write Track 2 phases 4 and 5 (10 levels), with an attention-weights view | 
CNT-12 | 
All pass content-check; owner approves | 
L
 | 
CNT-14 | 
Write Track 2 phases 6 and 7 (8 levels): train and sample a tiny GPT | 
CNT-13, ML-03 | 
Training reaches the target loss in under 10 minutes on a mid-range laptop GPU | 
L
### M14 Community (after M6 and M12)
Exit: players share designs, compete on verified leaderboards, and publish their own levels.
 | 
ID | 
Task | 
Depends on | 
Acceptance criteria | 
Size
 | 
COM-01 | 
Public share links: immutable snapshots, fork into your own save | 
API-04 | 
Logged-out visitors open shares read-only; forks work | 
M
 | 
COM-02 | 
Leaderboards with server verification on pg-boss and worker threads | 
API-04, LVL-07 | 
E-PLAT-02 and E-PLAT-03 pass | 
M
 | 
COM-03 | 
Community level editor that requires a passing reference solution | 
PLAT-01 | 
Publishing fails unless the solution passes and an empty one fails | 
L
 | 
COM-04 | 
Moderation: report, hide, review queue | 
COM-01 | 
E-PLAT-04 passes | 
S
 | 
COM-05 | 
Consent-based analytics: level funnel, hint use, drop-off per level | 
API-08 | 
Nothing is collected before consent; the dashboard shows drop-off per level | 
M
## Risks and mitigations
The biggest risk is scope: this is years of hobby work, so every milestone must end playable and optional levels get cut before core ones.
 | 
Risk | 
Impact | 
Mitigation
 | 
Scope too large for a hobby project | 
Burnout before anything is playable | 
Ship M3 first; every milestone ends playable; cut optional levels before core ones
 | 
Wiring UX takes far longer than planned | 
Content work waits on the editor | 
Timebox EDIT-04; fall back to straight wires with manual waypoints
 | 
Agents drift from the architecture | 
Inconsistent APIs and rework | 
Schema-first contracts, ADRs, `AGENTS.md`, owner review gates
 | 
Bugs in the fast engine teach wrong lessons | 
Players lose trust in the checker | 
Differential fuzzing against the reference engine and Spike on every PR
 | 
Links rot, or agents invent URLs | 
Broken learning path | 
`verifiedAt` and `verifiedTitle` required; weekly link check
 | 
A gate-level CPU runs too slowly to be fun | 
Players stall at Phase 5 | 
Behavioral swap of verified blocks; datapath levels use blocks, not raw gates
 | 
The C compiler grows complex | 
Phase 8 slips | 
Strict C subset; differential tests against gcc; gcc-built kernels as a fallback for Phase 9
 | 
WebGPU gaps in some browsers | 
Track 2 unusable for some players | 
CPU fallback with smaller models; capability check before training
 | 
Legal: personal data, minors, licenses | 
Takedowns or fines | 
LGPD basics from M6; a license record per dataset and test suite; an age policy decision
## Open questions
Three questions are settled, and each open one has a default, so agents are never blocked. Changing a default after work starts needs an ADR.
### Decided
Languages: English only at launch. Interface text still goes through i18n keys, so a translation stays possible later.
Open source and free: a public repo, and no payments in v1.
Audience: programmers who are new to hardware. Tutorials assume programming experience and teach hardware from zero, with no beginner primer in v1.
### Still open
 | 
Question | 
Default if unanswered | 
Affects
 | 
Final name? | 
Ground Up as the working title; repo named `ground-up` | 
Branding, domain, repo
 | 
Which licenses? | 
Public repo from M3; code under MIT, content under CC BY-SA 4.0 | 
Repo, contributions
 | 
Should reference solutions be hidden? | 
Public in packages/content/solutions, never bundled or linked from the game; move them to a private repo if spoilers become a problem | 
Content, CI
 | 
32-bit or 64-bit RISC-V? | 
RV32: simpler to build and teach. xv6-riscv is 64-bit, so it is a reference, not a binary we run | 
M7, M9, M11
 | 
Do players build the assembler and compiler themselves? | 
Tools are provided; building them is an optional challenge | 
M8, M10
 | 
Minimum age for accounts? | 
Accounts from 16; guest mode for everyone, with no personal data | 
Legal, M6
 | 
Hosting? | 
Cloudflare Pages, one small container host, managed Postgres | 
M6 deploy
 | 
2D or 3D board? | 
2D in v1; a 3D showcase view may come later | 
M2 and beyond