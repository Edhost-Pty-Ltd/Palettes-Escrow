const express = require("express");
const { createEscrow, getEscrow } = require("../controllers/escrowController");
const authenticateJWT = require("../middleware/authJwt");

const router = express.Router();

router.post("/create", authenticateJWT, createEscrow);
router.get("/:id", authenticateJWT, getEscrow);

module.exports = router;
