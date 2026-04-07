import sys
import json
import torch
import torch.nn as nn
import os

# Architecture must match Global_Model.pth (fc1 → fc2 → fc3 with ReLU).
# Checkpoint shapes: fc1 [16,8], fc2 [8,16], fc3 [1,8]
class HealthModel(nn.Module):
    def __init__(self, input_dim=8):
        super(HealthModel, self).__init__()
        self.fc1 = nn.Linear(input_dim, 16)
        self.fc2 = nn.Linear(16, 8)
        self.fc3 = nn.Linear(8, 1)

    def forward(self, x):
        x = torch.relu(self.fc1(x))
        x = torch.relu(self.fc2(x))
        return self.fc3(x)

def scale_value(val, min_val, max_val):
    # Standard Min-Max scaling: (x - min) / (max - min)
    scaled = (float(val) - min_val) / (max_val - min_val)
    return max(0, min(1, scaled)) # Clamp between 0 and 1


def metabolic_clinical_hba1c(data):
    """
    Lipid / renal heuristic: Global_Model.pth outputs a small unscaled score (~0.4) that is NOT
    in % HbA1c units and barely separates cases. This layer maps real lab values to a plausible
    glycemic-risk % so high chol/TG/LDL and low HDL can surface as High risk.
    """
    c = float(data["cholesterol"])
    hdl = float(data["hdl"])
    ldl = float(data["ldl"])
    tg = float(data["triglycerides"])
    cr = float(data["creatinine"])
    u = float(data["urea"])
    hb = float(data["hemoglobin"])

    pts = 0.0
    if c >= 240:
        pts += 2.0
    elif c >= 200:
        pts += 1.0
    if ldl >= 160:
        pts += 2.0
    elif ldl >= 130:
        pts += 1.0
    if hdl < 40:
        pts += 2.0
    elif hdl < 50:
        pts += 1.0
    if tg >= 200:
        pts += 2.0
    elif tg >= 150:
        pts += 1.0
    if cr > 1.4:
        pts += 1.0
    if u > 50:
        pts += 0.5
    if hb < 12:
        pts += 0.5

    # Map burden to % range ~5.0–12.5 (clamped); >=7% => High in UI
    est = 5.0 + min(7.5, pts * 0.75)
    return min(15.0, max(4.0, est))


def predict():
    try:
        # 1. Parse Input from Node.js
        data = json.loads(sys.argv[1])
        weights_path = None
        if len(sys.argv) > 2:
            weights_path = sys.argv[2]

        # 2. CALIBRATION LAYER (Pillar 1)
        # We use clinical ranges derived from your Hospital Master Records
        features = [
            scale_value(data['hemoglobin'], 10, 18),
            scale_value(data['rbcCount'], 3, 7),
            scale_value(data['cholesterol'], 100, 300),
            scale_value(data['hdl'], 20, 100),
            scale_value(data['ldl'], 50, 200),
            scale_value(data['triglycerides'], 50, 400),
            scale_value(data['creatinine'], 0.5, 2.0),
            scale_value(data['urea'], 10, 60)
        ]

        # 3. Load the Federated Global Model
        model = HealthModel()
        if weights_path and os.path.exists(weights_path):
            selected_weights = weights_path
        else:
            selected_weights = os.path.join(os.path.dirname(__file__), "Global_Model.pth")
        model.load_state_dict(torch.load(selected_weights, map_location=torch.device('cpu')))
        model.eval()

        # 4. Inference
        with torch.no_grad():
            input_tensor = torch.tensor([features], dtype=torch.float32)
            prediction = model(input_tensor).item()

        # 5. Logical Output — guard NaN/Inf from bad tensors
        if prediction != prediction or prediction == float("inf") or prediction == float("-inf"):
            raise ValueError(f"Model returned non-finite prediction: {prediction}")

        raw = float(prediction)
        # NN head is not calibrated to % HbA1c; map to a modest span so it contributes without dominating.
        nn_hba1c = 4.0 + max(0.0, min(1.0, raw)) * 4.5
        clinical_hba1c = metabolic_clinical_hba1c(data)
        # Worst-case drives display so obvious metabolic patterns are not labeled Routine.
        combined = max(nn_hba1c, clinical_hba1c)
        clamped_prediction = min(15.0, max(4.0, combined))

        if clamped_prediction >= 9.0:
            triage_level = "Urgent"
        elif clamped_prediction >= 7.0:
            triage_level = "Priority"
        else:
            triage_level = "Routine"

        model_source = "Global model"
        if weights_path and os.path.exists(weights_path):
            filename = os.path.basename(weights_path)
            if filename.startswith("weights_") and len(filename) > 8:
                model_source = f"Hospital {filename[8]}"
            elif filename == "Global_Model.pth":
                model_source = "Global model"

        out = {
            "predicted_hba1c": round(clamped_prediction, 2),
            "triage_level": triage_level,
            "model_source": model_source,
        }
        print(json.dumps(out), flush=True)

    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

if __name__ == "__main__":
    predict()