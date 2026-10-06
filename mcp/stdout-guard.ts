// Imported first by mcp/server.ts. In an MCP stdio server, stdout carries the
// JSON-RPC protocol: one stray console.log (from our code or a dependency)
// corrupts the stream and the client disconnects. Send all console output to
// stderr instead, before any other module gets a chance to log.

console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;
