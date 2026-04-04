const Patient = require('../models/Patient');
const Report = require('../models/Report');
const { getAiPrediction } = require('../services/aiService');
const { generateClinicalNarrative } = require('../services/groqService');
const { generateNextMedId } = require('../utils/generateMedId');

const ALLOWED_HOSPITALS = ['A', 'B', 'C', 'D', 'E'];

function buildRadarData(metrics) {
    const rows = [
        ['hemoglobin', 'Hemoglobin'],
        ['cholesterol', 'Cholesterol'],
        ['hdl', 'HDL'],
        ['creatinine', 'Creatinine'],
        ['urea', 'Urea'],
        ['triglycerides', 'Triglycerides'],
    ];
    return rows.map(([key, label]) => ({
        subject: label,
        value: Number(metrics[key]) || 0,
    }));
}

function metricsEight(metrics) {
    return {
        hemoglobin: Number(metrics.hemoglobin),
        rbcCount: Number(metrics.rbcCount),
        cholesterol: Number(metrics.cholesterol),
        hdl: Number(metrics.hdl),
        ldl: Number(metrics.ldl),
        triglycerides: Number(metrics.triglycerides),
        creatinine: Number(metrics.creatinine),
        urea: Number(metrics.urea),
    };
}

/**
 * Ensure Patient exists, create Report, run Python model, persist aiPrediction on that report.
 */
async function persistReportWithAi({ medId, hospitalId, metrics, collectedDate = new Date() }) {
    let patient = await Patient.findOne({ medId });
    if (!patient) {
        patient = await Patient.create({
            medId,
            name: `Patient ${medId}`,
            hospitalId,
        });
    } else if (patient.hospitalId !== hospitalId) {
        const err = new Error('MedID already registered at another hospital node.');
        err.status = 409;
        throw err;
    }

    const report = await Report.create({
        patient: patient._id,
        medId: patient.medId,
        hospitalId,
        collectedDate,
        metrics: { ...metrics },
    });

    const eight = metricsEight(report.metrics);
    for (const k of Object.keys(eight)) {
        if (Number.isNaN(eight[k])) {
            await Report.deleteOne({ _id: report._id });
            const err = new Error(`Invalid metric: ${k}`);
            err.status = 400;
            throw err;
        }
    }

    const aiRaw = await getAiPrediction(eight);
    const aiPrediction = {
        predicted_hba1c: aiRaw.predicted_hba1c,
        triage_level: aiRaw.triage_level,
        risk_level: aiRaw.risk_level,
    };
    report.aiPrediction = aiPrediction;
    report.aiRiskScore = aiPrediction.predicted_hba1c;
    await report.save();

    return { patient, report, aiPrediction };
}

exports.persistReportWithAi = persistReportWithAi;

/** POST /api/reports/add — add a lab visit; create patient if missing. */
exports.addReport = async (req, res) => {
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
            return res.status(400).json({ message: 'Could not resolve MedID' });
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
                hba1c !== undefined && hba1c !== '' ? Number(hba1c) : 0,
            glucose:
                glucose !== undefined && glucose !== '' ? Number(glucose) : 0,
        };

        for (const k of ['hemoglobin', 'rbcCount', 'cholesterol', 'hdl', 'ldl', 'triglycerides', 'creatinine', 'urea']) {
            if (Number.isNaN(metrics[k])) {
                return res.status(400).json({ message: `Invalid or missing: ${k}` });
            }
        }

        const date = collectedDate ? new Date(collectedDate) : new Date();
        if (Number.isNaN(date.getTime())) {
            return res.status(400).json({ message: 'Invalid collectedDate' });
        }

        const { patient, report, aiPrediction } = await persistReportWithAi({
            medId: resolvedMedId,
            hospitalId,
            metrics,
            collectedDate: date,
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

exports.getPatientAnalysis = async (req, res) => {
    try {
        const { medId } = req.params;

        const patient = await Patient.findOne({ medId }).lean();
        if (!patient) {
            return res.status(404).json({ msg: 'Patient not found' });
        }

        const reports = await Report.find({ medId: patient.medId }).sort({ collectedDate: 1 }).lean();

        if (reports.length === 0) {
            return res.status(404).json({ msg: 'No reports found for this patient' });
        }

        const current = reports[reports.length - 1];
        const previous = reports.length > 1 ? reports[reports.length - 2] : current;

        let aiResult;
        if (current.aiPrediction?.triage_level != null && current.aiPrediction?.predicted_hba1c != null) {
            aiResult = {
                predicted_hba1c: current.aiPrediction.predicted_hba1c,
                triage_level: current.aiPrediction.triage_level,
            };
        } else {
            const live = await getAiPrediction(metricsEight(current.metrics));
            aiResult = {
                predicted_hba1c: live.predicted_hba1c,
                triage_level: live.triage_level,
            };
        }

        const history = reports.map((r) => {
            const d = r.collectedDate ? new Date(r.collectedDate) : null;
            const collectedLabel =
                d && !Number.isNaN(d.getTime())
                    ? d.toISOString().slice(0, 16).replace('T', ' ')
                    : '';
            return {
                collectedDate: collectedLabel,
                hba1c: Number(r.metrics?.hba1c) || 0,
                predicted_hba1c:
                    r.aiPrediction?.predicted_hba1c != null
                        ? Number(r.aiPrediction.predicted_hba1c)
                        : null,
                avg_glucose: Number(r.metrics?.glucose) || 0,
            };
        });

        const radarData = buildRadarData(current.metrics);

        const patientOut = {
            medId: patient.medId,
            name: patient.name,
            hospitalId: patient.hospitalId,
            age: patient.age,
            gender: patient.gender,
            joinedDate: patient.joinedDate,
        };

        const trend = Number(current.metrics.hba1c) < Number(previous.metrics.hba1c)
            ? 'Improving'
            : Number(current.metrics.hba1c) > Number(previous.metrics.hba1c)
                ? 'Worsening'
                : 'Stable';

        const visitIntervalDays = previous.collectedDate && current.collectedDate
            ? Math.max(
                0,
                Math.round(
                    (new Date(current.collectedDate) - new Date(previous.collectedDate)) /
                        (1000 * 60 * 60 * 24),
                ),
            )
            : null;

        let aiNarrative = null;
        try {
            aiNarrative = await generateClinicalNarrative({
                currentMetrics: current.metrics,
                previousMetrics: previous === current ? null : previous.metrics,
                aiPrediction: aiResult,
                trend,
                isUrgent: aiResult.triage_level === 'Urgent',
                visitIntervalDays,
            });
        } catch (err) {
            console.error('Groq clinical narrative failed:', err);
        }

        res.json({
            patient: patientOut,
            reportCount: reports.length,
            aiPrediction: aiResult,
            aiNarrative,
            trends: {
                status: trend,
                glucoseDiff:
                    (Number(current.metrics.glucose) || 0) -
                    (Number(previous.metrics.glucose) || 0),
            },
            history,
            radarData,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error during AI Analysis' });
    }
};
