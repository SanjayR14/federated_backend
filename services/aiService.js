const { spawn } = require('child_process');
const path = require('path');

const backendRoot = path.join(__dirname, '..');

const getAiPrediction = (metrics) => {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(backendRoot, 'ai_engine', 'predict.py');
        const payload = JSON.stringify(metrics);

        let exe;
        let args;
        if (process.env.PYTHON_PATH) {
            exe = process.env.PYTHON_PATH;
            args = [scriptPath, payload];
        } else if (process.platform === 'win32') {
            exe = 'py';
            args = ['-3', scriptPath, payload];
        } else {
            exe = 'python3';
            args = [scriptPath, payload];
        }

        const pythonProcess = spawn(exe, args, {
            cwd: backendRoot,
            windowsHide: true,
        });

        
        let result = '';
        let errBuf = '';
        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });
        pythonProcess.stderr.on('data', (data) => {
            errBuf += data.toString();
        });
        pythonProcess.on('error', reject);
        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error('predict.py stderr:', errBuf);
                reject(new Error(`AI process exited with code ${code}`));
                return;
            }
            try {
                const parsed = JSON.parse(result.trim());
                if (parsed.error) {
                    console.error('predict.py error:', parsed.error, 'stderr:', errBuf);
                    reject(new Error(String(parsed.error)));
                    return;
                }
                const hba1c = Number(parsed.predicted_hba1c);
                if (!Number.isFinite(hba1c)) {
                    console.error('predict.py invalid predicted_hba1c:', parsed, 'stderr:', errBuf);
                    reject(new Error('AI response missing valid predicted_hba1c'));
                    return;
                }
                resolve(parsed);
            } catch (e) {
                console.error('predict.py stdout:', result, 'stderr:', errBuf);
                reject(new Error('AI Script Error'));
            }
        });
    });
};

module.exports = { getAiPrediction };
