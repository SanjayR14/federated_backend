const https = require('https');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1';
const GROQ_MODEL = process.env.GROQ_MODEL || 'groq-1';

function requestJson(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const payload = JSON.stringify(body);

        const request = https.request(
            {
                hostname: parsedUrl.hostname,
                path: `${parsedUrl.pathname}${parsedUrl.search}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    ...headers,
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk.toString();
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data || '{}');
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            reject(
                                new Error(
                                    `Groq API error ${res.statusCode}: ${JSON.stringify(parsed.error || data)}`                                ),
                            );
                        }
                    } catch (err) {
                        const snippet = data.slice(0, 200).replace(/\n/g, ' ');
                        reject(
                            new Error(
                                `Groq response parse error: ${err.message}. ` +
                                `Response may be HTML or invalid JSON. URL=${url} ResponseStart=${snippet}`,
                            ),
                        );
                    }
                });
            },
        );

        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}

function buildPrompt({ currentMetrics, previousMetrics, aiPrediction, trend, isHighRisk, visitIntervalDays }) {
    const normalize = (metrics) => ({
        hemoglobin: Number(metrics.hemoglobin).toFixed(1),
        rbcCount: Number(metrics.rbcCount).toFixed(1),
        cholesterol: Number(metrics.cholesterol).toFixed(0),
        hdl: Number(metrics.hdl).toFixed(0),
        ldl: Number(metrics.ldl).toFixed(0),
        triglycerides: Number(metrics.triglycerides).toFixed(0),
        creatinine: Number(metrics.creatinine).toFixed(2),
        urea: Number(metrics.urea).toFixed(0),
    });

    const current = normalize(currentMetrics);
    const priorSection = previousMetrics
        ? `Previous lab visit (approximately ${visitIntervalDays ?? 'N/A'} days prior):
- Hemoglobin: ${normalize(previousMetrics).hemoglobin} g/dL
- RBC count: ${normalize(previousMetrics).rbcCount} x10^12/L
- Total cholesterol: ${normalize(previousMetrics).cholesterol} mg/dL
- HDL: ${normalize(previousMetrics).hdl} mg/dL
- LDL: ${normalize(previousMetrics).ldl} mg/dL
- Triglycerides: ${normalize(previousMetrics).triglycerides} mg/dL
- Creatinine: ${normalize(previousMetrics).creatinine} mg/dL
- Urea: ${normalize(previousMetrics).urea} mg/dL

`
        : '';

    const intervalNote = previousMetrics
        ? `The prior visit was about ${visitIntervalDays ?? 'N/A'} days ago.`
        : 'No prior visit data is available for comparison.';

    return `You are a clinical analytics assistant generating a concise provider-facing interpretation.

Current lab visit:
- Hemoglobin: ${current.hemoglobin} g/dL
- RBC count: ${current.rbcCount} x10^12/L
- Total cholesterol: ${current.cholesterol} mg/dL
- HDL: ${current.hdl} mg/dL
- LDL: ${current.ldl} mg/dL
- Triglycerides: ${current.triglycerides} mg/dL
- Creatinine: ${current.creatinine} mg/dL
- Urea: ${current.urea} mg/dL

${priorSection}${intervalNote}

AI prediction:
- Estimated HbA1c: ${Number(aiPrediction.predicted_hba1c).toFixed(2)}%
- Triage level: ${aiPrediction.triage_level}
- Trend: ${trend}

Using both the current and prior results, write a single clinical insight that:
1. explains the current triage classification,
2. compares the current visit to the prior visit,
3. recommends when the patient should next see a clinician, and
4. lists two practical actions to minimize risk.

Do not mention any patient identifiers or hospital-specific IDs. Use a clear, professional tone and keep it under 140 words.`;
}

function buildFallbackSummary({ currentMetrics, previousMetrics, aiPrediction, trend, isHighRisk, visitIntervalDays }) {
    const isUrgent = aiPrediction.triage_level === 'Urgent';
    const nextVisit = isUrgent
        ? trend === 'Improving'
            ? 'Recommend follow-up in 4–6 weeks to confirm response to therapy.'
            : 'Recommend follow-up in 2–4 weeks to reassess control and adjust therapy.'
        : 'Recommend routine follow-up in 3 months, unless symptoms emerge sooner.';

    const steps = isUrgent
        ? [
              'Optimize glucose and lipid control through diet, exercise, and medication review.',
              'Increase monitoring frequency and schedule an earlier follow-up visit.',
          ]
        : [
              'Continue current metabolic management and reinforce lifestyle habits.',
              'Maintain routine monitoring and repeat labs per standard care.',
          ];

    const comparison = previousMetrics
        ? trend === 'Improving'
            ? 'Compared to the prior visit, current results show modest improvement.'
            : trend === 'Worsening'
                ? 'Compared to the prior visit, current results indicate worse metabolic control.'
                : 'Current results are stable compared to the prior visit.'
        : 'No prior visit is available for comparison.';

    return `AI triage: ${aiPrediction.triage_level ?? aiPrediction.risk_level} with estimated HbA1c ${Number(
        aiPrediction.predicted_hba1c,
    ).toFixed(2)}%. ${comparison} ${nextVisit} Steps: ${steps.join(' ')}`;
}

async function callGroq(prompt) {
    const endpoint = `${GROQ_API_URL}/chat/completions`;

    const body = {   // ✅ MAKE SURE THIS EXISTS
        model: "llama-3.1-8b-instant",
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],
        max_tokens: 220,
        temperature: 0.2,
    };

    const headers = {
        Authorization: `Bearer ${GROQ_API_KEY}`,
    };

    const response = await requestJson(endpoint, body, headers);

    return response.choices?.[0]?.message?.content?.trim();
}
async function generateClinicalNarrative({ currentMetrics, previousMetrics, aiPrediction, trend, isHighRisk, visitIntervalDays }) {
    if (!currentMetrics || !aiPrediction) {
        throw new Error('Missing metrics or AI prediction for narrative generation');
    }

    const prompt = buildPrompt({ currentMetrics, previousMetrics, aiPrediction, trend, isHighRisk, visitIntervalDays });

    if (!GROQ_API_KEY) {
        return buildFallbackSummary({ currentMetrics, previousMetrics, aiPrediction, trend, isHighRisk, visitIntervalDays });
    }

    try {
        return await callGroq(prompt);
    } catch (error) {
        console.error('Groq API call failed:', error);
        return buildFallbackSummary({ currentMetrics, previousMetrics, aiPrediction, trend, isHighRisk, visitIntervalDays });
    }
}

module.exports = {
    generateClinicalNarrative,
};
