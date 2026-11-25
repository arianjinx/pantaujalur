# pantaujalur

The fastest driving route between two points in Malang, and the city's public
CCTV cameras along it. Watch one camera live, or open the wall of photos along
the route.

It is an unofficial client of the city's public CCTV map. Maps are
OpenStreetMap, routing is OSRM, and place search is Nominatim. It needs no
API key.

## Run it

Bun 1.4.4, the version in `packageManager`.

```sh
bun install
bun run dev
```

`bun run dev` serves http://localhost:1337. The server calls the city from
this machine. A network the city refuses leaves the camera list empty.

## Deploy

A deploy is `gh workflow run deploy.yml`, by hand. The workflow skips when
these repo secrets are unset:

| Secret                  | Value                                            |
| ----------------------- | ------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Workers, Secrets Store, and Tunnel edit          |
| `CLOUDFLARE_ACCOUNT_ID` | The account                                      |
| `CCTV_RELAY_SECRET`     | Shared with `relay/`                             |
| `RELAY_HOSTNAME`        | The relay's public hostname                      |
| `RELAY_ZONE`            | The zone that hostname is on                     |
| `APP_DOMAIN`            | Optional. Without it the app is on `workers.dev` |

`bun run relay:deploy` installs `relay/` on the machine the city accepts.

## License

[MIT](LICENSE)
