import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { JsonRpcStdioTransport, INVALID_REQUEST, PARSE_ERROR } from "../src/stdio-transport";

/** A transport on in-memory streams; returns what it writes and what it passes on. */
async function harness() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const transport = new JsonRpcStdioTransport(stdin, stdout);
  const received: unknown[] = [];
  transport.onmessage = (m) => received.push(m);
  await transport.start();
  const written: string[] = [];
  stdout.on("data", (c: Buffer) => written.push(...c.toString("utf8").split("\n").filter(Boolean)));
  const flush = () => new Promise((r) => setImmediate(r));
  return { stdin, transport, received, replies: () => written.map((l) => JSON.parse(l)), flush };
}

test("a line that is not JSON gets a -32700 parse error", async () => {
  const h = await harness();
  h.stdin.write("this is not json\n");
  await h.flush();
  assert.equal(h.received.length, 0);
  const [reply] = h.replies();
  assert.equal(reply.jsonrpc, "2.0");
  assert.equal(reply.id, null);
  assert.equal(reply.error.code, PARSE_ERROR);
  await h.transport.close();
});

test("JSON that is not a JSON-RPC message gets -32600 with its id", async () => {
  const h = await harness();
  h.stdin.write(JSON.stringify({ id: 7, hello: "world" }) + "\n");
  await h.flush();
  const [reply] = h.replies();
  assert.equal(reply.id, 7);
  assert.equal(reply.error.code, INVALID_REQUEST);
  await h.transport.close();
});

test("valid messages pass through, also when split across chunks and after a bad line", async () => {
  const h = await harness();
  const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  h.stdin.write("{bad\n" + ping.slice(0, 10));
  h.stdin.write(ping.slice(10) + "\r\n\n");
  await h.flush();
  assert.equal(h.replies().length, 1);
  assert.equal(h.replies()[0].error.code, PARSE_ERROR);
  assert.deepEqual(h.received, [{ jsonrpc: "2.0", id: 1, method: "ping" }]);
  await h.transport.send({ jsonrpc: "2.0", id: 1, result: {} });
  await h.flush();
  assert.deepEqual(h.replies()[1], { jsonrpc: "2.0", id: 1, result: {} });
  await h.transport.close();
});
