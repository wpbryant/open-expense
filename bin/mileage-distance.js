#!/usr/bin/env node
"use strict";

// mileage-distance "Stop 1" "Stop 2" [more stops...] [--unit km] [--place-ids id1 id2 ...]
//   Routes the given stops with Google Maps and prints the driving distance as
//   JSON on stdout. Unix-style: one job, text out.
//
//   GOOGLE_MAPS_API_KEY=... node bin/mileage-distance.js "Home" "Office" | jq .
//
//   --place-ids routes raw place ids instead of address text — this doubles as
//   the live check that place ids returned by Places Autocomplete (New) are
//   accepted by Routes v2:
//
//   GOOGLE_MAPS_API_KEY=... node bin/mileage-distance.js \
//     --place-ids ChIJ5YQQf1GHhYARPKG7WLIaOko ChIJd8BlQ2BZwokRAFUEcm_qrcA

const db = require("../src/lib/db");
const maps = require("../src/lib/maps");
const settings = require("../src/lib/settings");

async function main() {
  const argv = process.argv.slice(2);
  let unit = "";
  const placeIds = [];
  const names = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--unit") {
      unit = argv[++i] || "";
    } else if (argv[i] === "--place-ids") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) placeIds.push(argv[++i]);
    } else {
      names.push(argv[i]);
    }
  }

  if (names.length + placeIds.length < 2) {
    process.stderr.write('usage: mileage-distance "Stop 1" "Stop 2" [more] [--unit km] [--place-ids id1 id2 ...]\n');
    process.exit(2);
  }
  if (!maps.isConfigured()) {
    process.stderr.write("error: GOOGLE_MAPS_API_KEY is not set.\n");
    process.exit(1);
  }

  // With --place-ids alone, route the ids directly (interop probe). Otherwise
  // zip place ids onto the named stops, keeping address fallback for the rest.
  const stops =
    names.length === 0 && placeIds.length >= 2
      ? placeIds.map((id) => ({ name: id, placeId: id }))
      : names.map((name, i) => ({ name, placeId: placeIds[i] || "" }));

  const effUnit = /^(mi|km)$/i.test(unit) ? unit.toLowerCase() : settings.mileage().unit;
  const { meters } = await maps.routeDistance(stops);

  process.stdout.write(
    JSON.stringify(
      {
        stops: stops.map((s) => s.name),
        meters,
        distance: Math.round(settings.fromMeters(meters, effUnit) * 10) / 10,
        unit: effUnit,
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((e) => {
  process.stderr.write(`error: ${e.message || e}\n`);
  process.exit(1);
});
