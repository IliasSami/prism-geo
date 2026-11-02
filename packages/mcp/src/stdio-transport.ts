import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** JSON-RPC 2.0 error codes for input that never becomes a request. */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;

/** Largest line kept while waiting for its newline (a runaway client cannot fill memory). */
const MAX_LINE_BYTES = 16 * 1024 * 1024;

/**
 * Newline-delimited JSON-RPC over stdin/stdout, like the SDK's StdioServerTransport, except that a
 * line that is not JSON gets a -32700 "Parse error" reply and JSON that is not a JSON-RPC message
 * gets -32600 "Invalid Request", as JSON-RPC 2.0 requires. The SDK's transport drops both silently,
 * so a client waits forever.
 */
export class JsonRpcStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private buffer = "";
  private started = false;
  // Keeps a character split across two chunks whole
  private readonly decoder = new StringDecoder("utf8");

  constructor(
    private readonly stdin: Readable = process.stdin,
    private readonly stdout: Writable = process.stdout,
  ) {}

  private readonly onData = (chunk: Buffer | string) => {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    let index: number;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line);
    }
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) {
      this.buffer = "";
      this.reply(null, INVALID_REQUEST, "Invalid Request: the message is too large");
    }
  };

  private readonly onStreamError = (error: Error) => this.onerror?.(error);

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return this.reply(null, PARSE_ERROR, "Parse error: each line must be one JSON-RPC message");
    }
    const parsed = JSONRPCMessageSchema.safeParse(value);
    if (!parsed.success) {
      // Answer with the request's id when it has a usable one
      const id = value && typeof value === "object" && "id" in value ? (value as { id: unknown }).id : null;
      return this.reply(typeof id === "string" || typeof id === "number" ? id : null, INVALID_REQUEST, "Invalid Request: not a JSON-RPC 2.0 message");
    }
    this.onmessage?.(parsed.data);
  }

  private reply(id: string | number | null, code: number, message: string): void {
    this.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("JsonRpcStdioTransport already started");
    this.started = true;
    this.stdin.on("data", this.onData);
    this.stdin.on("error", this.onStreamError);
  }

  async close(): Promise<void> {
    this.stdin.off("data", this.onData);
    this.stdin.off("error", this.onStreamError);
    if (this.stdin.listenerCount("data") === 0) this.stdin.pause();
    this.buffer = "";
    this.onclose?.();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (this.stdout.write(`${JSON.stringify(message)}\n`)) resolve();
      else this.stdout.once("drain", resolve);
    });
  }
}
