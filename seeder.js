const mongoose = require('mongoose');
const csv = require('csvtojson');
const dotenv = require('dotenv');
const Patient = require('./models/Patient');
const Report = require('./models/Report');

dotenv.config();

// --- CHANGE THIS FOR EACH RUN ---
const TARGET_HOSPITAL = 'D'; 
// Set this to 'B', then later 'C', 'D', 'E'
// --------------------------------

async function seedSingleHospital() {
    try {
        console.log(`Connecting to MongoDB to seed Hospital ${TARGET_HOSPITAL}...`);
        await mongoose.connect(process.env.MONGO_URI);

        // 1. Only delete data belonging to THIS specific hospital
        console.log(`🧹 Cleaning existing records for Hospital ${TARGET_HOSPITAL}...`);
        await Patient.deleteMany({ hospitalId: TARGET_HOSPITAL });
        await Report.deleteMany({ hospitalId: TARGET_HOSPITAL });

        const filePath = `../ml/dataset/Hospital_${TARGET_HOSPITAL}_Master_Records.csv`;
        console.log(`Reading: ${filePath}`);

        const jsonArray = await csv().fromFile(filePath);

        for (const row of jsonArray) {
            // Find or create patient
            let patient = await Patient.findOne({ medId: row.MedID });
            if (!patient) {
                patient = await Patient.create({
                    medId: row.MedID,
                    name: `Patient ${row.MedID}`,
                    hospitalId: TARGET_HOSPITAL,
                    age: Math.floor(Math.random() * 40) + 20,
                    gender: Math.random() > 0.5 ? 'Male' : 'Female'
                });
            }

            // Create Report entry (linked to Patient — one-to-many)
            await Report.create({
                patient: patient._id,
                medId: row.MedID,
                hospitalId: TARGET_HOSPITAL,
                collectedDate: new Date(row.Collected),
                metrics: {
                    hemoglobin: parseFloat(row.Hemoglobin) || 0,
                    rbcCount: parseFloat(row.RBC_Count) || 0,
                    glucose: parseFloat(row.Glucose) || 0,
                    cholesterol: parseFloat(row.Total_Cholesterol) || 0,
                    hdl: parseFloat(row.HDL) || 0,
                    ldl: parseFloat(row.LDL) || 0,
                    triglycerides: parseFloat(row.Triglycerides) || 0,
                    creatinine: parseFloat(row.Creatinine) || 0,
                    urea: parseFloat(row.Urea) || 0,
                    hba1c: parseFloat(row['HbA1c_%']) || 0
                }
            });
        }

        console.log(`\n🚀 Hospital ${TARGET_HOSPITAL} seeded successfully!`);
        process.exit(0);
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        process.exit(1);
    }
}

seedSingleHospital();