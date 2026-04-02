const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema(
    {
        medId: { type: String, required: true, unique: true },
        name: { type: String, required: true },
        hospitalId: { type: String, enum: ['A', 'B', 'C', 'D', 'E'], required: true },
        age: Number,
        gender: String,
        joinedDate: { type: Date, default: Date.now },
    },
    { toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/** One patient → many reports (by reference on Report.patient). */
PatientSchema.virtual('reports', {
    ref: 'Report',
    localField: '_id',
    foreignField: 'patient',
});

module.exports = mongoose.model('Patient', PatientSchema);
