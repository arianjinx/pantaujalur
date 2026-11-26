const REMOTE_DIR = "pantaujalur-relay";
const PROJECT = "pantaujalur-relay";
const TUNNEL_NAME = "pantaujalur-relay";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

const HOST = required("RELAY_SSH_HOST");
const secret = required("CCTV_RELAY_SECRET");
if (secret.length < 32 || /\s/.test(secret))
  throw new Error(
    "CCTV_RELAY_SECRET must be at least 32 characters with no whitespace",
  );
const apiToken = required("CLOUDFLARE_API_TOKEN");
const accountId = required("CLOUDFLARE_ACCOUNT_ID");

async function cloudflare<T>(path: string): Promise<T> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  const body = (await response.json()) as {
    success: boolean;
    errors: unknown[];
    result: T;
  };
  if (!body.success)
    throw new Error(
      `Cloudflare API ${path.split("?")[0]} failed (HTTP ${response.status}): ${JSON.stringify(body.errors)}`,
    );
  return body.result;
}

async function tunnelToken(): Promise<string | null> {
  const tunnels = await cloudflare<{ id: string }[]>(
    `/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false`,
  );
  const [tunnel] = tunnels;
  if (tunnel === undefined) return null;
  return cloudflare<string>(`/cfd_tunnel/${tunnel.id}/token`);
}

async function run(command: string[], stdin?: string): Promise<void> {
  console.log(`$ ${command.join(" ")}`);
  const child = Bun.spawn(command, {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0)
    throw new Error(`${command.slice(0, 2).join(" ")} exited with ${code}`);
}

const token = await tunnelToken();
console.log(
  token === null
    ? `No ${TUNNEL_NAME} tunnel yet: starting the relay without cloudflared.`
    : `Found the ${TUNNEL_NAME} tunnel: starting the relay and cloudflared.`,
);

const relayDir = `${import.meta.dir}/../relay`;
const image = new Bun.CryptoHasher("sha256");
for (const file of ["Dockerfile", "server.ts"])
  image.update(await Bun.file(`${relayDir}/${file}`).bytes());
const relayVersion = image.digest("hex").slice(0, 12);

const envFile = [
  `CCTV_RELAY_SECRET=${secret}`,
  `RELAY_VERSION=${relayVersion}`,
  ...(token === null
    ? []
    : [`TUNNEL_TOKEN=${token}`, "COMPOSE_PROFILES=tunnel"]),
  "",
].join("\n");

await run(["ssh", HOST, `mkdir -p ~/${REMOTE_DIR}`]);
await run([
  "rsync",
  "-a",
  "--delete",
  "--exclude=.env",
  "--exclude=*.test.ts",
  `${relayDir}/`,
  `${HOST}:${REMOTE_DIR}/`,
]);
await run(
  [
    "ssh",
    HOST,
    `umask 077 && cat > ~/${REMOTE_DIR}/.env.new && mv ~/${REMOTE_DIR}/.env.new ~/${REMOTE_DIR}/.env`,
  ],
  envFile,
);

const removeStaleConnector =
  token === null
    ? `docker compose -p ${PROJECT} --profile tunnel rm --stop --force cloudflared && `
    : "";
await run([
  "ssh",
  HOST,
  `cd ~/${REMOTE_DIR} && ${removeStaleConnector}docker compose -p ${PROJECT} up -d --remove-orphans && docker compose -p ${PROJECT} ps`,
]);
await run([
  "ssh",
  HOST,
  "curl -fsS --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8787/healthz",
]);
