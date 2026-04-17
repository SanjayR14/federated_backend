const Patient = require('../models/Patient');
const { generateNextMedId } = require('../utils/generateMedId');
const { persistReportWithAi } = require('./reportController');

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ALLOWED_HOSPITALS = ['A', 'B', 'C', 'D', 'E'];


exports.searchPatients = async (req, res) => {
    try {
        const hospitalId = req.params.hospitalId ?? req.query.hospitalId;
        const q = (req.query.q || '').trim();

        if (!hospitalId || !ALLOWED_HOSPITALS.includes(String(hospitalId))) {
            return res.status(400).json({ message: 'Invalid or missing hospitalId' });
        }

        if (!q) {
            return res.json([]);
        }

        const patients = await Patient.find({
            hospitalId: String(hospitalId),
            medId: new RegExp(escapeRegex(q), 'i'),
        })
            .select('medId name hospitalId')
            .limit(25)
            .lean();

        res.json(patients);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.getPatientsByHospital = async (req, res) => {
    try {
        const patients = await Patient.find({ hospitalId: req.params.hospitalId });
        res.json(patients);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

/** Creates/finds patient and appends a report via shared report pipeline (Python AI on the new row). */
exports.addPatientAndPredict = async (req, res) => {
    try {
        const {
            medId,
            hospitalId,
            hemoglobin,
            rbcCount,
            cholesterol,
            hdl,
            ldl,
            triglycerides,
            creatinine,
            urea,
            glucose,
            hba1c,
            collectedDate,
        } = req.body;

        if (!ALLOWED_HOSPITALS.includes(hospitalId)) {
            return res.status(400).json({ message: 'Invalid hospitalId' });
        }

        const useAutoMedId =
            medId === undefined ||
            medId === null ||
            medId === '' ||
            (typeof medId === 'string' && medId.trim().toLowerCase() === 'auto');

        let resolvedMedId = useAutoMedId ? await generateNextMedId() : String(medId).trim();

        if (!resolvedMedId) {
            return res.status(400).json({ message: 'Could not assign MedID' });
        }

        const metrics = {
            hemoglobin: Number(hemoglobin),
            rbcCount: Number(rbcCount),
            cholesterol: Number(cholesterol),
            hdl: Number(hdl),
            ldl: Number(ldl),
            triglycerides: Number(triglycerides),
            creatinine: Number(creatinine),
            urea: Number(urea),
            hba1c:
                hba1c !== undefined && hba1c !== ''
                    ? Number(hba1c)
                    : 0,
            glucose:
                glucose !== undefined && glucose !== ''
                    ? Number(glucose)
                    : 0,
        };

        for (const k of ['hemoglobin', 'rbcCount', 'cholesterol', 'hdl', 'ldl', 'triglycerides', 'creatinine', 'urea']) {
            if (Number.isNaN(metrics[k])) {
                return res.status(400).json({ message: `Invalid or missing numeric field: ${k}` });
            }
        }

        if (Number.isNaN(metrics.glucose)) {
            return res.status(400).json({ message: 'Invalid glucose' });
        }

        const visitDate = collectedDate ? new Date(collectedDate) : new Date();
        if (Number.isNaN(visitDate.getTime())) {
            return res.status(400).json({ message: 'Invalid collectedDate' });
        }

        const { patient, report, aiPrediction } = await persistReportWithAi({
            medId: resolvedMedId,
            hospitalId,
            metrics,
            collectedDate: visitDate,
        });

        res.status(201).json({
            medId: patient.medId,
            hospitalId,
            reportId: report._id,
            aiPrediction,
            metrics: report.metrics,
            medIdAutoAssigned: useAutoMedId,
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'Duplicate MedID' });
        }
        if (err.status === 409) {
            return res.status(409).json({ message: err.message });
        }
        if (err.status === 400) {
            return res.status(400).json({ message: err.message });
        }
        console.error(err);
        res.status(500).json({ message: err.message || 'Server error' });
    }
};
