const express = require("express");
const { createEscrow, getEscrow, updateEscrow } = require("../controllers/escrowController");
const { releaseFunds } = require("../controllers/releaseFundsController");
const authenticateJWT = require("../middleware/authJwt");

const router = express.Router();

router.post("/create", authenticateJWT, createEscrow);
router.post("/:id/complete", authenticateJWT, releaseFunds);
router.get("/:id", authenticateJWT, getEscrow);
router.patch("/:id", authenticateJWT, updateEscrow);

// Debug endpoint to list all escrows
router.get("/debug/list-all", authenticateJWT, async (req, res) => {
  try {
    const db = require("../config/firebase");
    const snapshot = await db.collection("escrowTransactions").limit(10).get();
    
    const escrows = [];
    snapshot.forEach(doc => {
      escrows.push({
        id: doc.id,
        data: doc.data()
      });
    });
    
    res.json({
      count: escrows.length,
      escrows: escrows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
