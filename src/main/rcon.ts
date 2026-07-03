// Minimal Source RCON client, used to control the Palworld dedicated server.
//
// Palworld (unlike Bedrock) does not read commands from stdin. With
// RCONEnabled=True + AdminPassword set in PalWorldSettings.ini, it exposes a
// standard Source-RCON port. Useful commands: Info, ShowPlayers, Save,
// Broadcast <msg>, KickPlayer <id>, BanPlayer <id>, Shutdown <sec> <msg>, DoExit.

import net from 'node:net';

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;

function encode(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, 'utf-8');
  const size = payload.length + 10; // id(4) + type(4) + body + 2 null bytes
  const buf = Buffer.alloc(size + 4);
  let o = 0;
  buf.writeInt32LE(size, o); o += 4;
  buf.writeInt32LE(id, o); o += 4;
  buf.writeInt32LE(type, o); o += 4;
  payload.copy(buf, o); o += payload.length;
  buf.writeInt8(0, o); o += 1;
  buf.writeInt8(0, o);
  return buf;
}

export interface RconOptions {
  host?: string;
  port: number;
  password: string;
  timeoutMs?: number;
}

/**
 * Open a connection, authenticate, run a single command, return the response,
 * and close. Simple one-shot design keeps the caller side trivial.
 */
export function rconCommand(opts: RconOptions, command: string): Promise<string> {
  const { host = '127.0.0.1', port, password, timeoutMs = 5000 } = opts;
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buf = Buffer.alloc(0);
    let authed = false;
    const reqId = 1;

    const done = (err: Error | null, out?: string) => {
      socket.destroy();
      if (err) reject(err);
      else resolve(out ?? '');
    };

    socket.setTimeout(timeoutMs, () => done(new Error('RCON timeout')));
    socket.on('error', (e) => done(e));

    socket.connect(port, host, () => {
      socket.write(encode(reqId, SERVERDATA_AUTH, password));
    });

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // Parse as many complete packets as are buffered.
      while (buf.length >= 4) {
        const size = buf.readInt32LE(0);
        if (buf.length < size + 4) break;
        const packet = buf.subarray(4, size + 4);
        buf = buf.subarray(size + 4);

        const id = packet.readInt32LE(0);
        const body = packet.subarray(8, packet.length - 2).toString('utf-8');

        if (!authed) {
          if (id === -1) return done(new Error('RCON authentication failed (bad AdminPassword).'));
          authed = true;
          socket.write(encode(reqId, SERVERDATA_EXECCOMMAND, command));
        } else {
          done(null, body);
          return;
        }
      }
    });
  });
}
