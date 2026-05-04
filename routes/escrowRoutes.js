const express = require("express");
const { createEscrow, getEscrow, updateEscrow } = require("../controllers/escrowController");
const { releaseFunds, toggleReleaseApproval } = require("../controllers/releaseFundsController");
const authenticateJWT = require("../middleware/authJwt");

const router = express.Router();

router.post("/create", authenticateJWT, createEscrow);
router.post("/:id/toggle-release", authenticateJWT, toggleReleaseApproval);
router.post("/:id/complete", authenticateJWT, releaseFunds);
router.get("/:id", authenticateJWT, getEscrow);
router.patch("/:id", authenticateJWT, updateEscrow);

module.exports = router;
