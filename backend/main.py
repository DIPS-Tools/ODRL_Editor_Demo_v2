from typing import List, Dict, Any, Optional, Union
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from collections import defaultdict

from Validate.validate import diagnose_ODRL

import json
import os
import rdflib

# Ensure the workspace directory exists on startup
POLICIES_DIR = "POLICIES"
if not os.path.exists(POLICIES_DIR):
    os.makedirs(POLICIES_DIR)

DEFAULT_VOCAB_DIR = "DEFAULT_VOCABULARIES"

# Global rdflib Graph available for other functions
vocab_graph = rdflib.Graph()

# Prefix block query variable defined globally
query_prefix = """
    PREFIX cc: <http://creativecommons.org/ns#>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX owl: <http://www.w3.org/2002/07/owl#>
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX schema: <http://schema.org/>
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX vcard: <http://www.w3.org/2006/vcard/ns#>
    PREFIX sw: <http://www.w3.org/2003/06/sw-vocab-status/ns#>
    PREFIX vann: <http://purl.org/vocab/vann/>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    PREFIX odrl: <http://www.w3.org/ns/odrl/2/>
    PREFIX dpv: <https://w3id.org/dpv#>
    PREFIX dvpowl: <https://w3id.org/dpv/owl#>
    PREFIX dcam: <http://purl.org/dc/dcam/>
    """

# Hierarchical SPARQL queries
actions_query = query_prefix + """
    SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
        WHERE {
            bind("No definition available" as ?default_definition)
            bind("No definition available" as ?default_sub_definition)
            
            {
                # Match items that are subclasses or direct instances of odrl:Action
                ?sub_action (rdf:type / rdfs:subClassOf*) odrl:Action .
            }
                UNION
            {
                # Match items explicitly included via ODRL inclusion properties
                ?sub_action odrl:includedIn ?action .
            }

            ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
            OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
            
            OPTIONAL {
                ?sub_action (odrl:includedIn | rdfs:subClassOf | skos:broader) ?action .
                ?action (rdfs:label | skos:prefLabel) ?label .
                OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
            }
            
            bind(coalesce(?definition_res, ?default_definition) as ?definition)
            bind(coalesce(?sub_definition_res, ?default_sub_definition) as ?sub_definition)
        }
    """

purpose_query = query_prefix + """
    SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
        WHERE {
            bind("No definition available" as ?default_definition)
            bind("No definition available" as ?default_sub_definition)
            
            ?sub_action (rdf:type / rdfs:subClassOf*) dvpowl:Purpose .
            ?sub_action ( rdfs:label | skos:prefLabel ) ?sub_label .
            OPTIONAL { ?sub_action ( skos:definition | rdfs:comment | skos:note ) ?sub_definition_res . }
            
            OPTIONAL {
                ?sub_action (odrl:includedIn | rdfs:subClassOf | skos:broader) ?action .
                ?action ( rdfs:label | skos:prefLabel ) ?label .
                OPTIONAL { ?action ( skos:definition | rdfs:comment | skos:note ) ?definition_res . }
            }
            
            bind(coalesce(?definition_res, ?default_definition) as ?definition)
            bind(coalesce(?sub_definition_res, ?default_sub_definition) as ?sub_definition)
        }
    """

left_operand_query = query_prefix + """
    SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
        WHERE {
            bind("No definition available" as ?default_definition)
            bind("No definition available" as ?default_sub_definition)
            
            ?sub_action (rdf:type / rdfs:subClassOf*) odrl:LeftOperand .
            ?sub_action ( rdfs:label | skos:prefLabel ) ?sub_label .
            OPTIONAL { ?sub_action ( skos:definition | rdfs:comment | skos:note ) ?sub_definition_res . }
            
            OPTIONAL {
                ?sub_action (odrl:includedIn | rdfs:subClassOf | skos:broader) ?action .
                ?action ( rdfs:label | skos:prefLabel ) ?label .
                OPTIONAL { ?action ( skos:definition | rdfs:comment | skos:note ) ?definition_res . }
            }
            
            bind(coalesce(?definition_res, ?default_definition) as ?definition)
            bind(coalesce(?sub_definition_res, ?default_sub_definition) as ?sub_definition)
        }
    """

operator_query = query_prefix + """
    SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
        WHERE {
            bind("No definition available" as ?default_definition)
            bind("No definition available" as ?default_sub_definition)
            
            ?sub_action (rdf:type / rdfs:subClassOf*) odrl:Operator .
            ?sub_action ( rdfs:label | skos:prefLabel ) ?sub_label .
            OPTIONAL { ?sub_action ( skos:definition | rdfs:comment | skos:note ) ?sub_definition_res . }
            
            OPTIONAL {
                ?sub_action (odrl:includedIn | rdfs:subClassOf | skos:broader) ?action .
                ?action ( rdfs:label | skos:prefLabel ) ?label .
                OPTIONAL { ?action ( skos:definition | rdfs:comment | skos:note ) ?definition_res . }
            }
            
            bind(coalesce(?definition_res, ?default_definition) as ?definition)
            bind(coalesce(?sub_definition_res, ?default_sub_definition) as ?sub_definition)
        }
    """

right_operand_query = query_prefix + """
    SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
        WHERE {
            bind("No definition available" as ?default_definition)
            bind("No definition available" as ?default_sub_definition)
            
            ?sub_action (rdf:type / rdfs:subClassOf*) odrl:RightOperand .
            ?sub_action ( rdfs:label | skos:prefLabel ) ?sub_label .
            OPTIONAL { ?sub_action ( skos:definition | rdfs:comment | skos:note ) ?sub_definition_res . }
            
            OPTIONAL {
                ?sub_action (odrl:includedIn | rdfs:subClassOf | skos:broader) ?action .
                ?action ( rdfs:label | skos:prefLabel ) ?label .
                OPTIONAL { ?action ( skos:definition | rdfs:comment | skos:note ) ?definition_res . }
            }
            
            bind(coalesce(?definition_res, ?default_definition) as ?definition)
            bind(coalesce(?sub_definition_res, ?default_sub_definition) as ?sub_definition)
        }
    """

def init_default_vocabularies():
    global vocab_graph
    
    if os.environ.get("EXTENDED_MODE"):
        print("EXTENDED_MODE detected. Skipping loading of default vocabularies.")
        return

    if not os.path.exists(DEFAULT_VOCAB_DIR):
        os.makedirs(DEFAULT_VOCAB_DIR)
        print(f"Created '{DEFAULT_VOCAB_DIR}' directory. Populate it with RDF/TTL files.")
        return

    for filename in os.listdir(DEFAULT_VOCAB_DIR):
        file_path = os.path.join(DEFAULT_VOCAB_DIR, filename)
        
        if os.path.isfile(file_path):
            ext = filename.lower()
            if ext.endswith(('.ttl', '.turtle')):
                fmt = "turtle"
            elif ext.endswith(('.json', '.jsonld', '.json-ld')):
                fmt = "json-ld"
            elif ext.endswith(('.rdf', '.xml')):
                fmt = "xml"
            elif ext.endswith(('.nt', '.ntriples')):
                fmt = "nt"
            else:
                fmt = None

            try:
                vocab_graph.parse(file_path, format=fmt)
                print(f"Loaded vocabulary: {filename} (Format: {fmt or 'auto-guessed'})")
            except Exception as e:
                print(f"Error loading vocabulary file '{filename}': {str(e)}")

init_default_vocabularies()

try:
    from pyshacl import validate as shacl_validate
except ImportError:
    shacl_validate = None

app = FastAPI(title="Abstract ODRL Editor Validation Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SHACL_SHAPE_FILE = "ODRL_Agreement_Shape.ttl"
OFFICIAL_ODRL_SHACL_SHAPE = ""

if os.path.exists(SHACL_SHAPE_FILE):
    with open(SHACL_SHAPE_FILE, "r", encoding="utf-8") as f:
        OFFICIAL_ODRL_SHACL_SHAPE = f.read()
else:
    OFFICIAL_ODRL_SHACL_SHAPE = """
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix odrl: <http://www.w3.org/ns/odrl/2/> .
    odrl:PolicyShape a sh:NodeShape ; sh:targetClass odrl:Agreement, odrl:Offer, odrl:Set .
    """
    print(f"WARNING: {SHACL_SHAPE_FILE} not found. Using a barebones fallback shape.")

class RawJsonLdPayload(BaseModel):
    json_string: str

class PublishPolicyPayload(BaseModel):
    filename: str = Field(..., description="The name designated by the user for the policy output file.")
    policy_data: Dict[str, Any] = Field(..., description="The dynamic JSON-LD data payload representing the ODRL policy.")

def _build_hierarchy_tree(sparql_query: str) -> List[List[str]]:
    """Builds an alphabetized, deduplicated hierarchical tree array from SPARQL results."""
    print("<< INTO BUILD HIERARCHY TREE >>")
    qres = vocab_graph.query(sparql_query)
        
    children_map = defaultdict(list)
    label_to_uri = {}
    label_to_def = {}
    
    all_children = set()
    all_parents = set()
    has_parent = set()
 
    TOT_RESP = ""
    
    for row in qres:
        if sparql_query == actions_query:
            TOT_RESP = TOT_RESP + str("[[" + str(row.action) + " / " + str(row.sub_action) + "]],")
            
        sub_uri = str(row.sub_action) if row.sub_action else ""
        if not sub_uri:
            continue
            
        # Fallback to URI fragment/local name if sub_label is missing
        if row.sub_label:
            sub_label = str(row.sub_label)
        else:
            sub_label = sub_uri.split("#")[-1] if "#" in sub_uri else sub_uri.split("/")[-1]
            
        sub_def = str(row.sub_definition) if row.sub_definition else "No definition available"
        
        label_to_uri[sub_label] = sub_uri
        label_to_def[sub_label] = sub_def
        all_children.add(sub_label)

        if row.action:
            parent_uri = str(row.action)
            # Fallback to URI fragment/local name if parent label is missing
            if row.label:
                parent_label = str(row.label)
            else:
                parent_label = parent_uri.split("#")[-1] if "#" in parent_uri else parent_uri.split("/")[-1]
                
            label_to_uri[parent_label] = parent_uri
            if row.definition:
                label_to_def[parent_label] = str(row.definition)
            
            children_map[parent_label].append(sub_label)
            all_parents.add(parent_label)
            has_parent.add(sub_label)

    # Roots are all nodes (children + parents) that do not have a parent
    all_nodes = all_children.union(all_parents)
    roots = all_nodes - has_parent

    if not roots and all_children:
        roots = all_children

    formatted_rows = []
    visited_paths = set()

    def build_tree_paths(current_node: str, current_path: List[str]):
        path_list = current_path + [current_node]
        hierarchy_path = " -> ".join(path_list)
        
        if hierarchy_path not in visited_paths:
            visited_paths.add(hierarchy_path)
            node_uri = label_to_uri.get(current_node, "")
            node_def = label_to_def.get(current_node, "No definition available")
            formatted_rows.append([hierarchy_path, node_uri, node_def])

        for child in children_map.get(current_node, []):
            if child not in path_list:
                build_tree_paths(child, path_list)

    for root in sorted(roots):
        build_tree_paths(root, [])
        
    if sparql_query == actions_query:
        print("Total response was <<< " + TOT_RESP)

    return sorted(formatted_rows, key=lambda x: x[0])
    
# Robust constraint item parser
def _parse_constraint_item(c: dict) -> dict:
    raw_op = str(c.get("operator", "="))
    op_map = {"eq": "=", "lt": "<", "gt": ">", "gte": ">=", "lte": "<=", "neq": "!="}
    clean_op = op_map.get(raw_op, raw_op)

    left_val = str(c.get("leftOperand", ""))
    
    # Normalize leftOperand to full URI if given as a short string or prefixed string
    if left_val and not left_val.startswith("http"):
        if left_val.startswith("odrl:"):
            left_val = f"http://www.w3.org/ns/odrl/2/{left_val[5:]}"
        else:
            left_val = f"http://www.w3.org/ns/odrl/2/{left_val}"

    right_val = c.get("rightOperand", "")
    if isinstance(right_val, dict) and "@value" in right_val:
        right_val = right_val["@value"]
    elif isinstance(right_val, dict) and "@id" in right_val:
        right_val = right_val["@id"]
    else:
        right_val = str(right_val) if right_val is not None else ""

    return {
        "leftOperand": left_val,
        "operator": clean_op,
        "rightOperand": right_val
    }

# --- API Endpoints ---

@app.get("/api/actions")
async def get_actions():
    try:
        return _build_hierarchy_tree(actions_query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")

@app.get("/api/purposes")
async def get_purposes():
    try:
        return _build_hierarchy_tree(purpose_query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Purpose query failure: {str(e)}")

@app.get("/api/leftOperands")
async def get_left_operand():
    try:
        return _build_hierarchy_tree(left_operand_query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LeftOperand query failure: {str(e)}")

@app.get("/api/operators")
async def get_operator():
    try:
        return _build_hierarchy_tree(operator_query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Operator query failure: {str(e)}")

@app.get("/api/rightOperands")
async def get_right_operand():
    try:
        return _build_hierarchy_tree(right_operand_query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RightOperand query failure: {str(e)}")

@app.post("/api/validate")
async def validate_policy_shacl(payload: Union[Dict[str, Any], RawJsonLdPayload]):
    try:
        print("In validate")
        # Handle whether payload is sent as a raw JSON dict or wrapped in RawJsonLdPayload
        if isinstance(payload, RawJsonLdPayload):
            parsed_data = json.loads(payload.json_string)
        elif isinstance(payload, dict):
            if "json_string" in payload:
                parsed_data = json.loads(payload["json_string"])
            else:
                parsed_data = payload
        else:
            parsed_data = payload
        print("Parsed data")
        
        # Additional context fixes if needed before diagnosis
        if parsed_data.get("@context") == "http://www.w3.org/ns/odrl/2/":
            parsed_data["@context"] = {
                "@vocab": "http://www.w3.org/ns/odrl/2/",
                "odrl": "http://www.w3.org/ns/odrl/2/"
            }
            
        if "permission" in parsed_data and isinstance(parsed_data["permission"], dict):
            if "@type" not in parsed_data["permission"] and "type" not in parsed_data["permission"]:
                parsed_data["permission"]["@type"] = "Permission"
                
            if "duty" in parsed_data["permission"] and isinstance(parsed_data["permission"]["duty"], dict):
                if "@type" not in parsed_data["permission"]["duty"] and "type" not in parsed_data["permission"]["duty"]:
                    parsed_data["permission"]["duty"]["@type"] = "Duty"

        # Call the updated diagnose_ODRL function passing the JSON object
        print("About to diagnose")
        errors, warnings, parsed_info, is_valid = diagnose_ODRL(parsed_data)
        print("Diagmosed")
        
        message = "SHACL compliance assessment engine process pass finalized successfully." if is_valid else "Semantic policy structural validation constraints failed."
        if errors:
            message = errors[0]
            
        full_report = "\n".join(errors + warnings + parsed_info)
        
        return {
            "valid": bool(is_valid),
            "message": message,
            "report": full_report
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Malformed JSON serialization data context layout stream.")
    except Exception as e:
        import traceback
        return {
            "valid": False,
            "message": f"Engine Error: {str(e)}",
            "report": traceback.format_exc()
        }
        
@app.post("/api/policy/publish")
async def publish_policy(payload: PublishPolicyPayload):
    try:
        target_dir = "POLICIES"
        os.makedirs(target_dir, exist_ok=True)
        
        clean_filename = payload.filename.strip().replace("..", "").replace("/", "").replace("\\", "")
        if not clean_filename:
            raise HTTPException(status_code=400, detail="Invalid policy document name provided.")
            
        if not clean_filename.endswith(".json"):
            clean_filename += ".json"
            
        target_filepath = os.path.join(target_dir, clean_filename)
        
        with open(target_filepath, "w", encoding="utf-8") as file_out:
            json.dump(payload.policy_data, file_out, indent=2, ensure_ascii=False)
            
        return {
            "status": "success",
            "message": f"Policy document successfully written to ledger location: {target_filepath}"
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": f"Critical File Storage IO Error: Unable to serialize policy to disk. Details: {str(e)}"
        }
        
@app.get("/api/policies")
async def list_policies():
    try:
        if not os.path.exists(POLICIES_DIR):
            return []
        files = [f for f in os.listdir(POLICIES_DIR) if os.path.isfile(os.path.join(POLICIES_DIR, f))]
        return sorted(files)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to scan directory: {str(e)}")
        
@app.get("/api/policies/{filename}")
async def get_policy(filename: str):
    file_path = os.path.join(POLICIES_DIR, filename)
    
    if not os.path.abspath(file_path).startswith(os.path.abspath(POLICIES_DIR)):
        raise HTTPException(status_code=403, detail="Access denied.")
        
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Requested policy file not found.")
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        policy_type = data.get("@type", "Agreement")
        uid = data.get("uid", "")
        profile = data.get("profile", "")
        assigner = data.get("assigner", None)
        assignee = data.get("assignee", None)
        
        raw_conflict = data.get("conflict", None)
        conflict = raw_conflict.replace("odrl:", "") if isinstance(raw_conflict, str) else raw_conflict
        
        targets = []
        raw_target = data.get("target")
        if isinstance(raw_target, str):
            targets = [raw_target]
        elif isinstance(raw_target, dict) and "uid" in raw_target:
            targets = raw_target["uid"] if isinstance(raw_target["uid"], list) else [raw_target["uid"]]
            
        permissions = []
        raw_permissions = data.get("permission", [])
        if not isinstance(raw_permissions, list) and raw_permissions:
            raw_permissions = [raw_permissions]
            
        for perm in raw_permissions:
            action_data = perm.get("action", "")
            action_name = action_data if isinstance(action_data, str) else action_data.get("value", "")
            
            if action_name.startswith("odrl:") and not action_name.startswith("http"):
                action_name = action_name.split("odrl:")[1]
                
            action_constraints = []
            if isinstance(action_data, dict) and "refinement" in action_data:
                for c in action_data["refinement"]:
                    action_constraints.append(_parse_constraint_item(c))
            
            global_constraints = []
            raw_constraints = perm.get("constraint", [])
            purpose_block = None
            
            # Support parsing purpose block structure similar to action/target with refinement
            raw_purpose = perm.get("purpose", None)
            if raw_purpose:
                p_name = raw_purpose if isinstance(raw_purpose, str) else raw_purpose.get("value", "")
                p_constraints = []
                if isinstance(raw_purpose, dict) and "refinement" in raw_purpose:
                    for c in raw_purpose["refinement"]:
                        p_constraints.append(_parse_constraint_item(c))
                purpose_block = {"name": p_name, "constraints": p_constraints}
            else:
                for c in raw_constraints:
                    if "and" in c:
                        and_list = c["and"]
                        purpose_node = next((item for item in and_list if item.get("leftOperand") == "purpose"), None)
                        if purpose_node:
                            p_val = str(purpose_node.get("rightOperand", ""))
                            sub_c = []
                            for item in and_list:
                                if item.get("leftOperand") != "purpose":
                                    sub_c.append(_parse_constraint_item(item))
                            purpose_block = {"name": p_val, "constraints": sub_c}
                        continue
                        
                    if c.get("leftOperand") == "purpose":
                        p_val = str(c.get("rightOperand", ""))
                        purpose_block = {"name": p_val, "constraints": []}
                        continue
                        
                    global_constraints.append(_parse_constraint_item(c))

            target_data = perm.get("target", "")
            target_name = target_data if isinstance(target_data, str) else target_data.get("source", "")
            target_constraints = []
            if isinstance(target_data, dict) and "refinement" in target_data:
                for c in target_data["refinement"]:
                    target_constraints.append(_parse_constraint_item(c))
                    
            def parse_actor(actor_node):
                if not actor_node: return None
                if isinstance(actor_node, str):
                    return {"type": actor_node.replace("odrl:", ""), "constraints": []}
                type_val = actor_node.get("source", "Legal Entity").replace("odrl:", "")
                refs = []
                for c in actor_node.get("refinement", []):
                    refs.append(_parse_constraint_item(c))
                return {"type": type_val, "constraints": refs}

            duties = []
            raw_duties = perm.get("duty", [])
            if not isinstance(raw_duties, list) and raw_duties:
                raw_duties = [raw_duties]
            for d in raw_duties:
                d_action = d.get("action", "")
                d_constraints = []
                for c in d.get("constraint", []):
                    d_constraints.append(_parse_constraint_item(c))
                
                consequences = []
                raw_cons = d.get("consequence", [])
                if not isinstance(raw_cons, list) and raw_cons:
                    raw_cons = [raw_cons]
                for cons in raw_cons:
                    cons_constraints = []
                    for c in cons.get("constraint", []):
                        cons_constraints.append(_parse_constraint_item(c))
                    consequences.append({
                        "action": cons.get("action", ""),
                        "constraints": cons_constraints
                    })

                duties.append({
                    "action": d_action,
                    "assigner": parse_actor(d.get("assigner")),
                    "actor": parse_actor(d.get("assignee")),
                    "constraints": d_constraints,
                    "consequences": consequences
                })

            permissions.append({
                "action": {"name": action_name, "constraints": action_constraints},
                "assigner": parse_actor(perm.get("assigner")),
                "actor": parse_actor(perm.get("assignee")),
                "purpose": purpose_block,
                "target": {"name": target_name, "constraints": target_constraints},
                "constraints": global_constraints,
                "duties": duties
            })

        return {
            "type": policy_type,
            "uid": uid,
            "profile": profile,
            "assigner": assigner,
            "assignee": assignee,
            "conflict": conflict,
            "targets": targets,
            "permissions": permissions
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed parsing file structural mappings: {str(e)}")
        
@app.post("/api/policy/to-ttl")
async def convert_policy_to_ttl(payload: Union[Dict[str, Any], RawJsonLdPayload]):
    try:
        # Handle whether payload is sent as a raw JSON dict or wrapped in RawJsonLdPayload
        if isinstance(payload, RawJsonLdPayload):
            parsed_data = json.loads(payload.json_string)
        elif isinstance(payload, dict):
            if "json_string" in payload:
                parsed_data = json.loads(payload["json_string"])
            else:
                parsed_data = payload
        else:
            parsed_data = payload
        
        # Additional context fixes matching the validate endpoint pipeline
        if parsed_data.get("@context") == "http://www.w3.org/ns/odrl/2/":
            parsed_data["@context"] = {
                "@vocab": "http://www.w3.org/ns/odrl/2/",
                "odrl": "http://www.w3.org/ns/odrl/2/"
            }
            
        if "permission" in parsed_data and isinstance(parsed_data["permission"], dict):
            if "@type" not in parsed_data["permission"] and "type" not in parsed_data["permission"]:
                parsed_data["permission"]["@type"] = "Permission"
                
            if "duty" in parsed_data["permission"] and isinstance(parsed_data["permission"]["duty"], dict):
                if "@type" not in parsed_data["permission"]["duty"] and "type" not in parsed_data["permission"]["duty"]:
                    parsed_data["permission"]["duty"]["@type"] = "Duty"

        # Parse the JSON-LD object into an rdflib Graph and serialize to Turtle (TTL)
        graph = rdflib.Graph()
        graph.parse(data=json.dumps(parsed_data), format="json-ld")
        ttl_output = graph.serialize(format="turtle")
        
        return {
            "status": "success",
            "ttl": ttl_output
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Malformed JSON serialization data context layout stream.")
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=f"RDF Conversion Engine Error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8005)