"use strict";

// JSON proxy for the mileage feature. Mounted under /api with requireAuth, so a
// signed-in user can geocode stops and compute driving distance while the
// Google key stays on the server. Errors use the app's uniform {error} JSON
// convention (same as the receipt crop/upload endpoints).

const express = require("express");
const maps = require("../lib/maps");
const settings = require("../lib/settings");
const receipts = require("../lib/receipts");
const { fileUrl, imgUrl } = require("../lib/urls");

const router = express.Router();

router.get("/places/autocomplete", async (req, res) => {
  try {
    if (!maps.isConfigured()) {
      return res.status(403).json({ error: "Address autocomplete is disabled — set GOOGLE_MAPS_API_KEY." });
    }
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Type a few characters to search." });
    const suggestions = await maps.autocomplete(q, req.query.session);
    res.json({ suggestions });
  } catch (e) {
    res.status(502).json({ error: e.message || "Address search failed." });
  }
});

router.post("/mileage/distance", async (req, res) => {
  try {
    if (!maps.isConfigured()) {
      return res.status(403).json({ error: "Driving distance is disabled — set GOOGLE_MAPS_API_KEY." });
    }
    const body = req.body || {};
    const stops = (Array.isArray(body.stops) ? body.stops : [])
      .map((s) => ({
        name: String((s && s.name) || "").trim(),
        placeId: String((s && s.placeId) || "").trim(),
      }))
      .filter((s) => s.name || s.placeId);
    if (stops.length < 2) {
      return res.status(400).json({ error: "A route needs at least two stops." });
    }
    if (stops.length > maps.MAX_STOPS) {
      return res.status(400).json({ error: `A route can have at most ${maps.MAX_STOPS} stops.` });
    }
    const unit = body.unit === "km" || body.unit === "mi" ? body.unit : settings.mileage().unit;

    const { meters, coords } = await maps.routeDistance(stops);

    // Render the route map and stage it as a receipt exactly like
    // POST /receipts/upload stages an upload: the form's hidden receipt_path
    // input carries it until the expense is saved. The map is a nice-to-have —
    // a render failure never costs the distance.
    let map = null;
    try {
      const png = await maps.routeMapImage(stops, coords);
      if (png) {
        const rel = await receipts.save(png, "route-map.png", "image/png", res.locals.currentUser.id);
        map = { path: rel, previewUrl: imgUrl(rel), downloadUrl: fileUrl(rel), isPdf: false };
      }
    } catch (e) {
      map = { error: e.message || "Could not render the route map." };
    }

    res.json({
      meters,
      distance: settings.fromMeters(meters, unit),
      unit,
      map,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "Could not calculate the distance." });
  }
});

module.exports = router;
