const mongoose = require('mongoose');

const MetricsSchema = new mongoose.Schema(
    {
        hemoglobin: Number,
        rbcCount: Number,
        glucose: Number,
        cholesterol: Number,
        hdl: Number,
        ldl: Number,
        triglycerides: Number,
        creatinine: Number,
        urea: Number,
        hba1c: Number,
    },
    { _id: false },
);

const AiPredictionSchema = new mongoose.Schema(
    {
        predicted_hba1c: Number,
        triage_level: String,
        risk_level: String,
    },
    { _id: false },
);

const ReportSchema = new mongoose.Schema({
    /** Canonical link: many reports belong to one patient. */
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        index: true,
    },
    /** Denormalized MedID for queries — not unique (many visit rows per patient). */
    medId: { type: String, required: true, index: true },
    hospitalId: { type: String, required: true },
    collectedDate: { type: Date, required: true },
    metrics: MetricsSchema,
    aiRiskScore: Number,
    aiPrediction: AiPredictionSchema,
    notes: String,
});

ReportSchema.index({ patient: 1, collectedDate: 1 });
ReportSchema.index({ medId: 1, collectedDate: 1 });

module.exports = mongoose.model('Report', ReportSchema);
