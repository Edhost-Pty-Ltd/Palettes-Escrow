const express = require("express");
const { createSubaccount } = require("../controllers/createSubaccount");
const authenticateJWT = require("../middleware/authJwt");

const router = express.Router();


router.post("/create", authenticateJWT, createSubaccount);

module.exports = router;
