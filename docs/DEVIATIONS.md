# Deviations

Each entry is something a reference does that pantaujalur does not do on purpose, and the reason. Only the operator adds an entry.

- **WALL-STILLS** The wall shows a still photo per camera, not a live player per tile. One live player stays, for the camera the person opened. A player per tile would hold a stream open per camera. The queue in `src/components/snapshotQueue.ts` exists so the city sees at most three captures.
- **PUBLIC-GEO** Routing stays the public OSRM demo and search stays the public Nominatim demo. The app does not host a routing graph. Both are rate-limited, as README.md says, and not for heavy use.
