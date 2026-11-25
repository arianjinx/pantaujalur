import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Output from "alchemy/Output";
import { Stage } from "alchemy/Stage";
import { localState } from "alchemy/State";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const APP_DOMAIN = process.env.APP_DOMAIN || undefined;
const RELAY_HOSTNAME = process.env.RELAY_HOSTNAME || undefined;
const RELAY_ZONE = process.env.RELAY_ZONE || undefined;

const relayEnv = (stage: string) => {
  const url =
    stage === "prod"
      ? RELAY_HOSTNAME && `https://${RELAY_HOSTNAME}`
      : process.env.CCTV_UPSTREAM_URL;
  return url
    ? {
        CCTV_UPSTREAM_URL: url,
        CCTV_RELAY_SECRET: Config.Redacted("CCTV_RELAY_SECRET"),
      }
    : undefined;
};

export const Website = Cloudflare.Website.Vite(
  "Website",
  Stage.pipe(
    Effect.map((stage) => ({
      name: "pantaujalur",
      compatibility: { date: "2026-10-26", flags: ["nodejs_compat"] },
      domain: APP_DOMAIN,
      workersDev: APP_DOMAIN === undefined,
      observability: {
        enabled: true,
        headSamplingRate: 1,
        logs: { enabled: true, invocationLogs: true },
      },
      dev: { port: Number(process.env.PORT ?? 1337) },
      env: relayEnv(stage),
    })),
  ),
).pipe(adopt(true));

export default Alchemy.Stack(
  "pantaujalur",
  {
    providers: Cloudflare.providers(),
    state: Layer.unwrap(
      Effect.gen(function* () {
        return (yield* Stage) === "prod" ? Cloudflare.state() : localState();
      }),
    ),
  },
  Effect.gen(function* () {
    const stage = yield* Stage;
    const { dev } = yield* AlchemyContext;
    if (stage !== "prod" && !dev)
      return yield* Effect.die(
        `only the prod stage deploys; ${stage} runs with alchemy dev`,
      );

    if ((RELAY_HOSTNAME === undefined) !== (RELAY_ZONE === undefined))
      return yield* Effect.die("set RELAY_HOSTNAME and RELAY_ZONE together");

    const website = yield* Website;
    if (stage !== "prod" || !RELAY_HOSTNAME || !RELAY_ZONE)
      return { url: website.url };

    const tunnel = yield* Cloudflare.Tunnel.Tunnel("CctvRelay", {
      name: "pantaujalur-relay",
      adopt: true,
      ingress: [
        { hostname: RELAY_HOSTNAME, service: "http://relay:8080" },
        { service: "http_status:404" },
      ],
    });
    yield* Cloudflare.DNS.Record("CctvRelayRecord", {
      zoneId: Cloudflare.Zone.Zone.lookup({ name: RELAY_ZONE }).zoneId,
      name: RELAY_HOSTNAME,
      type: "CNAME",
      content: Output.interpolate`${tunnel.tunnelId}.cfargotunnel.com`,
      proxied: true,
    }).pipe(adopt(true));
    return { url: website.url };
  }),
);
