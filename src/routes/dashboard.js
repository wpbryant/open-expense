"use strict";

// Dashboard: at-a-glance totals, category breakdown, recent activity.

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const queries = require("../lib/queries");
const { money } = require("../lib/format");

const router = express.Router();

router.all("*", requireAuth);

router.get("/", (req, res) => {
  const stats = queries.dashboardStats(res.locals.currentUser.id);
  res.render("dashboard", { stats, money });
});

module.exports = router;
