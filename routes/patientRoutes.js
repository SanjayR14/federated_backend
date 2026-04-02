const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patientController');

// Register literal paths before :hospitalId so they are never captured as a param.
router.get('/search', patientController.searchPatients);
router.post('/add', patientController.addPatientAndPredict);
router.get('/hospital/:hospitalId/search', patientController.searchPatients);
router.get('/hospital/:hospitalId', patientController.getPatientsByHospital);

module.exports = router;
