const Patient = require('../models/Patient');

/** Next numeric MedID string (matches seeded CSV style). */
async function generateNextMedId() {
    const rows = await Patient.aggregate([
        { $match: { medId: { $regex: /^[0-9]{4,12}$/ } } },
        { $addFields: { n: { $toLong: '$medId' } } },
        { $group: { _id: null, maxN: { $max: '$n' } } },
    ]);
    const maxN = rows[0]?.maxN;
    const base =
        typeof maxN === 'number' && Number.isFinite(maxN) && maxN >= 100000
            ? maxN + 1
            : 100001;
    return String(base);
    
}

module.exports = { generateNextMedId };
