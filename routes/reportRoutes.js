const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

router.post('/add', reportController.addReport);
router.get('/analysis/:medId', reportController.getPatientAnalysis);

module.exports = router;