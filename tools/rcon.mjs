// Minimal Minecraft RCON client (no dependencies) used to drive the test server.
//
// Protocol (see wiki.vg/Developer/RCON):
//   packet = int32 LE length | int32 LE id | int32 LE type | body | NUL
//   length counts every byte after the length field itself.
//
// Types:
//   3 = AUTH (client -> server)
//   2 = AUTH_RESPONSE (server -> client) and also EXECCOMMAND (client -> server)
//   0 = RESPONSE_VALUE (server -> client), carries the command output
//
// Usage:
//   node tools/rcon.mjs <command> [more commands...]
import net from 'node:net';

const HOST = process.env.RCON_HOST || '127.0.0.1';
const PORT = Number(process.env.RCON_PORT || 25575);
const PASSWORD = process.env.RCON_PASSWORD || 'nebesny';

const TYPE_RESPONSE = 0;
const TYPE_COMMAND = 2;
const TYPE_AUTH = 3;
const TYPE_AUTH_RESPONSE = 2;

function encode(requestId, type, body) {
  const payload = Buffer.from(body, 'utf8');
  // length = id(4) + type(4) + body + NUL
  const buffer = Buffer.alloc(4 + 4 + 4 + payload.length + 1);
  buffer.writeInt32LE(4 + 4 + payload.length + 1, 0);
  buffer.writeInt32LE(requestId, 4);
  buffer.writeInt32LE(type, 8);
  payload.copy(buffer, 12);
  buffer.writeUInt8(0, 12 + payload.length);
  return buffer;
}

/**
 * Runs a list of commands and resolves with their combined output.
 * @param {string[]} commands
 * @returns {Promise<string>}
 */
export function rcon(commands) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    let buffer = Buffer.alloc(0);
    let requestId = 0;
    let authenticated = false;
    let pending = 0;
    const outputs = [];

    const send = (type, body) => {
      requestId += 1;
      socket.write(encode(requestId, type, body));
    };

    const fail = (error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(60000);
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('RCON timeout')));
    socket.on('close', () => {
      if (pending > 0) fail(new Error('RCON connection closed'));
    });

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0);
        if (length < 10 || buffer.length < 4 + length) break;
        const packet = buffer.subarray(4, 4 + length);
        buffer = buffer.subarray(4 + length);

        const id = packet.readInt32LE(0);
        const type = packet.readInt32LE(4);
        const body = packet.subarray(8, packet.length - 1).toString('utf8');

        if (type === TYPE_AUTH_RESPONSE) {
          authenticated = true;
          if (!commands.length) {
            socket.end();
            resolve('');
          } else {
            pending = commands.length;
            send(TYPE_COMMAND, commands[0]);
          }
          continue;
        }

        if (type === TYPE_RESPONSE && id === requestId) {
          outputs.push(body);
          const remaining = commands.length - outputs.length;
          if (remaining > 0) {
            send(TYPE_COMMAND, commands[outputs.length]);
          } else {
            socket.end();
            resolve(outputs.join('\n'));
          }
        }
      }
    });

    socket.on('connect', () => send(TYPE_AUTH, PASSWORD));
  });
}

if (process.argv[1] && process.argv[1].endsWith('rcon.mjs')) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('usage: node tools/rcon.mjs <command> [command...]');
    process.exit(0);
  }
  rcon(args)
    .then((output) => console.log(output))
    .catch((error) => {
      console.error(`RCON error: ${error.message}`);
      process.exit(1);
    });
}
