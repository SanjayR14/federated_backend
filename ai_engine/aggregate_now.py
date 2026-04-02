# backend/ai_engine/aggregate_now.py
from federated_aggregator import federated_averaging

# List the paths to the models sent by the 5 hospitals
hospital_models = [
    'local_nodes/Hospital_A_Model.pth',
    'local_nodes/Hospital_B_Model.pth',
    'local_nodes/Hospital_C_Model.pth',
    'local_nodes/Hospital_D_Model.pth',
    'local_nodes/Hospital_E_Model.pth'
]

# Run the math to create the new Super-Brain
federated_averaging(hospital_models, output_path="Global_Model.pth")