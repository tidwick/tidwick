// Serves a fake bucket over HTTP on 127.0.0.1 for the restore drill, so the off-account copy leaves through a
// real `fetch` and socket. Node only. Relative imports carry `.ts`.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fakeBucket, type FakeBucket } from './fake-bucket.ts';

async function toRequest(message: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const method = message.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? null : Buffer.concat(chunks);
  return new Request(`http://${message.headers.host ?? ''}${message.url ?? '/'}`, {
    method,
    headers,
    body,
  });
}

/** A fake bucket listening on a free port of 127.0.0.1, and a `close` that ends every connection. */
export async function serveFakeBucket(): Promise<{
  bucket: FakeBucket;
  close: () => Promise<void>;
}> {
  const holder: { bucket?: FakeBucket } = {};
  const server = createServer((message, reply) => {
    toRequest(message)
      .then((request) => holder.bucket?.fetch(request) ?? new Response(null, { status: 503 }))
      .then(async (response) => {
        reply.writeHead(response.status);
        reply.end(Buffer.from(await response.arrayBuffer()));
      })
      .catch(() => {
        reply.writeHead(500);
        reply.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const bucket = fakeBucket(`http://127.0.0.1:${String(port)}`);
  holder.bucket = bucket;
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  return { bucket, close };
}
