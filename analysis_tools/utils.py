
import json

def load_json_file(filepath):
    with open(filepath, mode='r', encoding="utf-8") as f:
        json_obj = json.load(f)
        print("Json file (%s) loaded." % filepath)
    return json_obj

def save_json_file(filepath, json_obj, sort_keys=False):
    with open(filepath, mode='w', encoding="utf-8") as f:
        json.dump(json_obj, f, indent = 2, sort_keys = sort_keys)
        print("Json file (%s) saved." % filepath)
