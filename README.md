# jscript-agent-debug

The **alert-probe** build of the JScript agent source for the
[C2](https://github.com/nostdlib/C2) platform — a minimal
[`jscript-agent.js`](jscript-agent.js) whose `runAgent()` does nothing but pop
`alert("Hello World!")`. No beacon logic, no identity, no network: it exists to
prove a delivery end-to-end (the `.lnk` dials mshta, mshta fetches the hosted
`.hta`, the host master calls `runAgent()`, the alert proves script execution on
the box) while the real agent source stays in
[jscript-agent](https://github.com/nostdlib/jscript-agent).

Pure ES3-era JScript (the engine inside `mshta.exe` / `cscript.exe`, JScript 5.8)
— the file defines exactly one top-level symbol, `function runAgent()`, the
contract the C2 host master calls.

## Host behavior

- **mshta (the delivery host):** the Windows-Delivery master embeds this source
  inside its `runStager()` wrapper and calls `runAgent()` after hiding the
  window — `alert()` is the windowed IE engine's own dialog and pops on screen;
  after dismissal `runAgent()` returns and the master's `quitHost()` closes the
  process.
- **Bare WSH (cscript/wscript):** the file only *defines* `runAgent()` — nothing
  self-runs — and `alert` does not exist there, so this build is not meant for
  direct WSH execution.

## The C2 fetch contract (why the comment header stays)

The panel's fetch gate (`AgentBinaryService.GetAgentTextAsync`) accepts an agent
source only when the fetched text is non-trivial (**>200 chars**), does not
start with `<`, and defines **`function runAgent(`**. A bare stub line fails
that gate and every Windows-Delivery build against this repo's URL errors with
*"…row's URL did not return the agent script"* — the comment header atop the
function is what keeps the minimal probe over the size floor. Keep it.

## Build & Release

There is nothing to compile — the source **is** the artifact. CI
(`.github/workflows/build.yml`) gates every push/PR with a `node --check` syntax
gate and the `function runAgent(` needle (the panel's own contract), and on
every push to `main` republishes the rolling GitHub Release
**`jscript-agent-debug`** with `jscript-agent.js` as its asset.

---

Authorized red-team / pentest / research use only. MIT.
