"use strict";

// Google Maps Platform helpers for mileage expenses: Places (New) address
// autocomplete, Routes v2 driving distance + route polyline, and a Static Map
// image used as the mileage "receipt". One API key (GOOGLE_MAPS_API_KEY) that
// always stays server-side — these calls happen only inside our own routes,
// and the key is sent via headers / outbound URLs, never to the browser.
//
// GCP setup: enable "Places API (New)", "Routes API", and "Maps Static API".
// Each is an Essentials-tier SKU with ~10k free requests/month.

const crypto = require("crypto");
const config = require("./config");

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";

// Google's Static Maps URLs are capped at 2048 chars — long encoded polylines
// can hit it, so the map degrades to fewer layers rather than failing.
const STATIC_MAP_MAX_URL = 2048;

const MAX_STOPS = 10;
const MARKER_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function isConfigured() {
  return Boolean(config.googleMapsApiKey);
}

// Places (New) may return a resource name ("places/ChIJ…") where Routes wants
// the bare id — normalize defensively.
function stripResourceName(id) {
  return String(id || "").replace(/^places\//, "");
}

// Shared POST with header-based auth (keeps the key out of URLs) and a short
// timeout. Surfaces Google's error message when there is one.
async function googlePost(url, fieldMask, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.googleMapsApiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new Error("Could not reach Google Maps" + (timedOut ? " (timed out)." : "."));
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    const msg = (j && j.error && j.error.message) || `Google Maps request failed (${res.status}).`;
    throw new Error(msg);
  }
  return res.json();
}

// Address suggestions for one autocomplete session. Returns at most 5 of
// {placeId, label, secondary}. A session token groups the keystrokes into one
// billing session — generate it client-side per form load.
async function autocomplete(input, sessionToken) {
  const q = String(input || "").trim().slice(0, 300);
  if (!q) return [];
  const data = await googlePost(
    AUTOCOMPLETE_URL,
    [
      "suggestions.placePrediction.placeId",
      "suggestions.placePrediction.text.text",
      "suggestions.placePrediction.structuredFormat.secondaryText.text",
    ].join(","),
    { input: q, sessionToken: String(sessionToken || "").trim() || crypto.randomUUID() }
  );
  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      placeId: stripResourceName(p.placeId || p.place),
      label: (p.text && p.text.text) || "",
      secondary: (p.structuredFormat && p.structuredFormat.secondaryText && p.structuredFormat.secondaryText.text) || "",
    }))
    .filter((p) => p.placeId && p.label)
    .slice(0, 5);
}

// Route a list of {name, placeId} stops (placeId optional — free text falls
// back to an address waypoint). Returns {meters, coords} where coords is the
// route shape as GeoJSON [lng, lat] pairs.
async function routeDistance(stops) {
  const list = (Array.isArray(stops) ? stops : [])
    .map((s) => ({ name: String((s && s.name) || "").trim(), placeId: stripResourceName(s && s.placeId) }))
    .filter((s) => s.name || s.placeId);
  if (list.length < 2) throw new Error("A route needs at least two stops.");
  if (list.length > MAX_STOPS) throw new Error(`A route can have at most ${MAX_STOPS} stops.`);

  // Waypoints sit directly on origin/destination/intermediates — Routes v2 has
  // no nested "waypoint" key. TRAFFIC_UNAWARE keeps distances deterministic.
  // We ask for the shape as GeoJSON (plain coordinates) rather than Routes'
  // encodedPolyline: Routes v2 uses its own polyline encoding variant, which
  // Static Maps' "enc:" parameter can't read (the map zooms out to the globe
  // because the decoded bounds are nonsense). Classic-encoding it ourselves
  // (see encodePolyline) keeps the two APIs' formats separate.
  const waypoint = (s) => (s.placeId ? { placeId: s.placeId } : { address: s.name });
  const data = await googlePost(
    ROUTES_URL,
    "routes.distanceMeters,routes.polyline.geoJsonLinestring",
    {
      origin: waypoint(list[0]),
      destination: waypoint(list[list.length - 1]),
      intermediates: list.slice(1, -1).map(waypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
    }
  );

  const route = (data.routes || [])[0];
  if (!route || typeof route.distanceMeters !== "number") {
    throw new Error("No driving route found between those stops.");
  }
  const coords = (route.polyline && route.polyline.geoJsonLinestring && route.polyline.geoJsonLinestring.coordinates) || [];
  return { meters: route.distanceMeters, coords };
}

// Classic Encoded Polyline Algorithm Format — the variant Static Maps' "enc:"
// parameter expects (https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
// Input is GeoJSON order ([lng, lat]); rounds to 1e-5 degrees like Google does.
function encodePolyline(coords) {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  const encodeValue = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1; // left-shift then sign-fold (zigzag)
    let s = "";
    do {
      let chunk = v & 31;
      v >>>= 5;
      if (v) chunk |= 32;
      s += String.fromCharCode(chunk + 63);
    } while (v);
    return s;
  };
  for (const point of coords || []) {
    const lng = Number(point && point[0]);
    const lat = Number(point && point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const ilat = Math.round(lat * 1e5);
    const ilng = Math.round(lng * 1e5);
    out += encodeValue(ilat - lastLat) + encodeValue(ilng - lastLng);
    lastLat = ilat;
    lastLng = ilng;
  }
  return out;
}

// Render the route as a portrait PNG for use as the mileage receipt: the route
// line plus labeled stop markers (A, B, C…). If the URL budget runs out, retry
// with fewer layers (path only → markers only) instead of failing.
async function routeMapImage(stops, coords) {
  const safeStops = (Array.isArray(stops) ? stops : []).slice(0, MAX_STOPS);
  const encoded = encodePolyline(coords);
  const pathParam = encoded
    ? "path=" + encodeURIComponent(`weight:5|color:0x2563eb|enc:${encoded}`)
    : "";
  const markerParams = safeStops.map((s, i) => {
    const label = MARKER_LABELS[i] || "";
    const loc = s.placeId
      ? `place_id:${s.placeId}`
      : String(s.name || "").trim();
    const marker = (label ? `label:${label}|` : "") + loc;
    return "markers=" + encodeURIComponent(marker);
  });
  const keyParam = "key=" + encodeURIComponent(config.googleMapsApiKey);

  // Layers we're willing to drop, most complete first.
  const layers = [
    [pathParam, ...markerParams].filter(Boolean),
    [pathParam].filter(Boolean),
    markerParams,
  ];

  let lastError = null;
  for (const parts of layers) {
    if (!parts.length) continue;
    const url = `${STATIC_MAP_URL}?size=640x800&scale=2&maptype=roadmap&${parts.concat(keyParam).join("&")}`;
    if (url.length > STATIC_MAP_MAX_URL) continue;
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch (e) {
      const timedOut = e && (e.name === "TimeoutError" || e.name === "AbortError");
      lastError = new Error("Could not reach Google Maps" + (timedOut ? " (timed out)." : "."));
      continue;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      lastError = new Error((j && j.error && j.error.message) || `Map render failed (${res.status}).`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length) return buf;
    lastError = new Error("Google returned an empty map image.");
  }
  throw lastError || new Error("Could not render the route map.");
}

module.exports = {
  isConfigured,
  autocomplete,
  routeDistance,
  routeMapImage,
  encodePolyline,
  MAX_STOPS,
};
