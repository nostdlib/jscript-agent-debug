// jscript-agent-debug — the MINIMAL alert-probe build of the JScript agent
// source. runAgent() does nothing but pop an alert: the end-to-end delivery
// probe (mshta fetches the .hta, the host master calls runAgent(), the box
// proves script execution on the target) with no beacon logic, no identity,
// no network. Pick the JScript-Agent-Debug row in the C2 Agents table to
// build a delivery against this source.
//
// This comment block is load-bearing: the C2 panel's fetch gate
// (AgentBinaryService.GetAgentTextAsync) accepts an agent source only when
// the text is non-trivial (>200 chars), does not start with '<', and defines
// 'function runAgent(' — keep a header of this size above the function, or
// every build against this repo's URL fails validation again.
function runAgent() {
    alert("Hello World!");
}
