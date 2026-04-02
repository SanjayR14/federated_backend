const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to FederatedHealthDB'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));

const reportRoutes = require('./routes/reportRoutes');
const patientController = require('./controllers/patientController');

app.use('/api/reports', reportRoutes);

// Register patient routes on `app` so paths like /api/patients/search always resolve
// (avoids 404s if an older `patientRoutes` file is cached or out of sync).
app.get('/api/patients/search', patientController.searchPatients);
app.post('/api/patients/add', patientController.addPatientAndPredict);
app.get('/api/patients/hospital/:hospitalId/search', patientController.searchPatients);
app.get('/api/patients/hospital/:hospitalId', patientController.getPatientsByHospital);
// backend/server.js
app.post('/api/admin/sync-models', (req, res) => {
    const { spawn } = require('child_process');
    // Call the aggregator script
    const pythonProcess = spawn('python3', ['./ai_engine/aggregate_now.py']);

    pythonProcess.on('close', (code) => {
        if (code === 0) {
            res.json({ message: "Federated Global Model updated successfully!" });
        } else {
            res.status(500).json({ error: "Aggregation failed" });
        }
    });
});
app.get('/', (req, res) => {
    res.send('Federated Health API is running...');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log('   GET  /api/patients/search?hospitalId=A&q=');
});
