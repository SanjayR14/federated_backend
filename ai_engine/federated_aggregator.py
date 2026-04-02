import torch
import copy

def federated_averaging(model_paths, output_path="Global_Model.pth"):
    """
    Combines weights from multiple hospital models into one Global Model.
    """
    # 1. Load the first model to use as a template
    global_weights = torch.load(model_paths[0])
    
    # 2. Initialize a dictionary to store the sum of weights
    for key in global_weights.keys():
        global_weights[key] = global_weights[key].float()

    # 3. Sum the weights from all other models
    for i in range(1, len(model_paths)):
        local_weights = torch.load(model_paths[i])
        for key in global_weights.keys():
            global_weights[key] += local_weights[key].float()

    # 4. Divide by the number of models to get the Average
    num_models = len(model_paths)
    for key in global_weights.keys():
        global_weights[key] = global_weights[key] / num_models

    # 5. Save the new "Super-Brain"
    torch.save(global_weights, output_path)
    print(f"✅ Success: {num_models} hospital models aggregated into {output_path}")
