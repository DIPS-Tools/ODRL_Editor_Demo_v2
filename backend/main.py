from contextlib import asynccontextmanager
from typing import Optional
from typing import List, Dict, Any, Optional, Union
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from collections import defaultdict

from Validate.validate import diagnose_ODRL

from SPARQL import ACTION_QUERIES, LEFT_HAND_OPERAND_QUERIES, OPERATOR_QUERIES, ACTOR_QUERIES

import json
import os
import pyoxigraph
import rdflib

import urllib.parse
from pathlib import Path

import asyncio
import sys

import time


# Ensure the workspace directory exists on startup
POLICIES_DIR = "POLICIES"
if not os.path.exists(POLICIES_DIR):
    os.makedirs(POLICIES_DIR)

DEFAULT_VOCAB_DIR = "DEFAULT_VOCABULARIES"

# Dictionary to hold isolated graph stores and timestamps per client ID
# Structure: { client_id: {"graph": rdflib.Graph, "last_accessed": float} }
user_stores: Dict[str, Dict[str, Any]] = {}

# Timeout threshold in seconds (e.g., 24 hours = 86400 seconds)
SESSION_TIMEOUT_SECONDS = 24 * 60 * 60
# SESSION_TIMEOUT_SECONDS = 120

SESSION_CHECK_SECONDS = 3600
# SESSION_CHECK_SECONDS = 120

# Global rdflib Graph available for other functions
#vocab_graph = rdflib.Graph()

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
    
    
# Define the SPARQL query to get actors and their relationships
actor_query_old = query_prefix + """
    SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
        WHERE {
            bind("No definition available" as ?default_definition)
            bind("No definition available" as ?default_sub_definition)
            
            ?sub_action (rdf:type / rdfs:subClassOf*) dvpowl:Entity .
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
    
actor_query = query_prefix + """
    SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
    WHERE {
        bind("No definition available" as ?default_definition)
        bind("No definition available" as ?default_sub_definition)
    
        {
           # Pattern 1: Extract Subclass Hierarchy down from dvpowl:Entity
           ?sub_action rdfs:subClassOf ?action .
           ?action rdfs:subClassOf* dvpowl:Entity .
           ?sub_action rdfs:subClassOf* dvpowl:Entity .
        }
        #UNION
        #{
        #   # Pattern 2: Extract Instances of any class/subclass under dvpowl:Entity
        #   ?sub_action rdf:type ?action .
        #   ?action rdfs:subClassOf* dvpowl:Entity .
        #}
    
        # Retrieve labels and definitions for the child element (?sub_action)
        ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
        OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
    
        # Retrieve labels and definitions for the parent class (?action)
        ?action (rdfs:label | skos:prefLabel) ?label .
        OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
    
        # Fallback definitions
        BIND(COALESCE(?definition_res, ?default_definition) as ?definition)
        BIND(COALESCE(?sub_definition_res, ?default_definition) as ?sub_definition)
    }
    ORDER BY ?action ?sub_action
    """

async def cleanup_expired_sessions_loop():
    """Background task that periodically scans and purges inactive user stores."""
    while True:
        try:
            await asyncio.sleep(SESSION_CHECK_SECONDS)  # Check every 1 hour
            print(f"Checking for graphs to purge")
            current_time = time.time()
            expired_clients = []

            for client_id, data in user_stores.items():
                print(f"Checking for client_id " + str(client_id))
                if current_time - data["last_accessed"] > SESSION_TIMEOUT_SECONDS:
                    expired_clients.append(client_id)

            for client_id in expired_clients:
                print(f"Purging inactive session store for client_id: {client_id} due to timeout.")
                store = user_stores[client_id]["graph"]
                store.remove((None, None, None))
                del user_stores[client_id]
                
        except Exception as e:
            print(f"Error in cleanup background task: {str(e)}")

def _trim_hierarchy_data(hierarchy_data, trim_item: Optional[str] = None):
    """
    Removes rows that exclusively match `trim_item` and strips 
    '<trim_item> -> ' from the start of matching hierarchical paths.
    """
    if not trim_item:
        return hierarchy_data
        
    trimmed_rows = []
    prefix_to_remove = trim_item + " -> "
    
    for row in hierarchy_data:
        path = row[0]
        if path == trim_item:
            # Skip rows that ONLY contain the trim_item
            continue
        elif path.startswith(prefix_to_remove):
            # Strip the prefix from the start of the path
            new_path = path[len(prefix_to_remove):]
            trimmed_rows.append([new_path] + row[1:])
        else:
            # Keep unrelated rows as they are
            trimmed_rows.append(row)
            
    return trimmed_rows
    
@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup: Start background cleanup task ---
    cleanup_task = asyncio.create_task(cleanup_expired_sessions_loop())
    yield
    # --- Shutdown: Cancel task and clear all user stores ---
    cleanup_task.cancel()
    for data in user_stores.values():
        data["graph"].remove((None, None, None))
    user_stores.clear()

import uuid

def reset_user_store(client_id: str):
    """Clears all triples from an existing client store or initializes a new one."""
    store = get_user_store(client_id)
    # Remove all triples matching (None, None, None) to clear the graph
    store.remove((None, None, None))
    return store
    
def get_user_store(client_id: str) -> rdflib.Graph:
    """Retrieves an existing store, updates its last accessed timestamp, or creates a new one."""
    current_time = time.time()
    """Retrieves an existing store for the client_id or creates and initializes a new one."""
    if client_id not in user_stores:
        print(f"Creating new isolated graph store for client_id: {client_id}")
        new_store = rdflib.Graph(store="Oxigraph")
        user_stores[client_id] = {
            "graph": new_store,
            "last_accessed": current_time
        }
    else:
        # Refresh the last accessed timestamp on activity
        user_stores[client_id]["last_accessed"] = current_time
        
    return user_stores[client_id]["graph"]
    
def reset_default_vocabularies(client_id: str, profile_values: Optional[Union[str, List[str]]] = None):
    """
    Resets the client vocab_graph and populates it based on provided profile values.
    Supports:
      - Full HTTP/HTTPS URIs (downloaded or read if local)
      - File-style URIs (e.g., file:///path/to/file.ttl)
      - Local filenames or relative paths inside DEFAULT_VOCAB_DIR
    """
    #global vocab_graph
    
    # 1. Completely reset the global graph
    #vocab_graph = get_user_store(client_id)
    vocab_graph = reset_user_store(client_id)

    if os.environ.get("EXTENDED_MODE"):
        print("EXTENDED_MODE detected. Skipping loading of default vocabularies.")
        return

    if not os.path.exists(DEFAULT_VOCAB_DIR):
        os.makedirs(DEFAULT_VOCAB_DIR)

    # Normalize profile_values into a clean list of strings
    profiles = []
    if profile_values:
        if isinstance(profile_values, str):
            profiles = [p.strip() for p in profile_values.split(",") if p.strip()]
        elif isinstance(profile_values, list):
            profiles = [str(p).strip() for p in profile_values if p and str(p).strip()]

    # Fallback: If no profiles are provided, load everything from DEFAULT_VOCAB_DIR as before
    if not profiles:
        print(f"No profile values specified. Loading all files from '{DEFAULT_VOCAB_DIR}'...")
        for filename in os.listdir(DEFAULT_VOCAB_DIR):
            file_path = os.path.join(DEFAULT_VOCAB_DIR, filename)
            if os.path.isfile(file_path):
                _parse_file_into_graph(vocab_graph, file_path)
        return

    # Process each profile entry
    for profile in profiles:
        print("Loading profile " + str(profile))
        target_path = profile

        # Strip 'file://' or 'file:///' if present
        if profile.lower().startswith("file://"):
            # Remove scheme prefix
            path_part = profile[7:]
            # If it starts with an extra slash on Windows (e.g., file:///C:/...), clean it up
            if path_part.startswith("/") and len(path_part) > 2 and path_part[2] == ":":
                path_part = path_part[1:]
            
            # Convert forward slashes to OS-specific slashes and make absolute if relative
            target_path = os.path.abspath(os.path.normpath(urllib.parse.unquote(path_part)))

        # Check if it's an absolute or relative local path/filename
        if os.path.exists(target_path):
            _parse_file_into_graph(vocab_graph, target_path)
        else:
            # Try checking relative to DEFAULT_VOCAB_DIR
            local_path = os.path.join(DEFAULT_VOCAB_DIR, profile)
            if os.path.exists(local_path):
                _parse_file_into_graph(vocab_graph, local_path)
            else:
                # Check if it's a remote URL (http/https)
                parsed_url = urllib.parse.urlparse(profile)
                if parsed_url.scheme in ("http", "https"):
                    try:
                        print(f"Fetching remote vocabulary profile: {profile}")
                        ext = profile.lower()
                        fmt = _guess_rdf_format(ext)
                        vocab_graph.parse(profile, format=fmt)
                        print(f"Successfully loaded remote profile: {profile}")
                    except Exception as e:
                        print(f"Error fetching remote vocabulary profile '{profile}': {str(e)}")
                else:
                    print(f"Warning: Profile path or file not found: {target_path}")

def _parse_file_into_graph(store: rdflib.Graph, file_path: str):
    ext = file_path.lower()
    fmt = _guess_rdf_format(ext)
    try:
        store.parse(file_path, format=fmt)
        print(f"Loaded vocabulary source: {file_path} (Format: {fmt or 'auto-guessed'})")
    except Exception as e:
        print(f"Error loading vocabulary source '{file_path}': {str(e)}")

def _guess_rdf_format(filename_or_url: str) -> Optional[str]:
    if filename_or_url.endswith(('.ttl', '.turtle')):
        return "turtle"
    elif filename_or_url.endswith(('.json', '.jsonld', '.json-ld')):
        return "json-ld"
    elif filename_or_url.endswith(('.rdf', '.xml')):
        return "xml"
    elif filename_or_url.endswith(('.nt', '.ntriples')):
        return "nt"
    return None
    
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

#init_default_vocabularies()

try:
    from pyshacl import validate as shacl_validate
except ImportError:
    shacl_validate = None

app = FastAPI(title="Abstract ODRL Editor Validation Server", lifespan=lifespan)

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

def _build_hierarchy_tree(store: rdflib.Graph, sparql_query: str) -> List[List[str]]:
    """Builds an alphabetized, deduplicated hierarchical tree array from SPARQL results."""
    print("<< INTO BUILD HIERARCHY TREE >>")
    try:
        qres = store.query(sparql_query)
        print(f"<< SPARQL QUERY SUCCESS. Rows returned: {len(qres)} >>")
    except Exception as e:
        import traceback
        print("<< SPARQL QUERY FAILED WITH EXCEPTION >>")
        print(traceback.format_exc())
        raise e
    
    print("<< SPARQL RESULT >>")
        
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
        print("Total response was <<< ") # + TOT_RESP)
    
    print("The number of formatted rows being returned is " + str(len(formatted_rows)))
    return sorted(formatted_rows, key=lambda x: x[0])

# --- NEW/UPDATED STATUS ENDPOINT ---
@app.get("/api/get_status")
async def get_status():
    """
    Returns the current active graph stores with client_ids and latest timestamps,
    along with the list of query names defined in SPARQL.py.
    """
    stores_summary = []
    for client_id, data in user_stores.items():
        stores_summary.append({
            "client_id": client_id,
            "latest_timestamp": data["last_accessed"],
            "triple_count": len(data["graph"])
        })
        
    return {
        "status": "online",
        "current_stores": stores_summary,
        "sparql_queries": {
            "ACTION_QUERIES": list(ACTION_QUERIES.keys()),
            "LEFT_HAND_OPERAND_QUERIES": list(LEFT_HAND_OPERAND_QUERIES.keys()),
            "OPERATOR_QUERIES": list(OPERATOR_QUERIES.keys()),
            "ACTOR_QUERIES": list(ACTOR_QUERIES.keys())
        }
    }
    
@app.post("/api/heartbeat")
async def client_heartbeat(client_id: str = Query(..., description="Unique client session ID")):
    """Updates the last accessed timestamp for an active client session."""
    if client_id in user_stores:
        user_stores[client_id]["last_accessed"] = time.time()
        return {"status": "success", "message": "Session refreshed."}
    else:
        # If the session expired or was never registered, you can either recreate it or return 404.
        # Returning 404 lets the client know it needs to re-register if needed.
        raise HTTPException(status_code=404, detail="Client session store not found.")
        
@app.post("/api/register")
async def register_client():
    """Generates a unique client ID on the server and initializes their isolated graph store."""
    client_id = f"client_{uuid.uuid4()}"
    store = get_user_store(client_id)
    return {
        "client_id": client_id,
        "message": "Isolated graph store created successfully",
        "total_triples_in_memory": len(store)
    }
    
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
        
@app.get("/api/actors")
async def get_actors():
    try:
        return _build_hierarchy_tree(actor_query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")


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
        
class VocabResetPayload(BaseModel):
    profiles: Optional[Union[str, List[str]]] = Field(None, description="List or string of profile URIs/files")
    client_id: Optional[str] = Field("default_user", description="Unique client session ID")

@app.post("/api/vocabularies/reset")
async def api_reset_vocabularies(payload: VocabResetPayload):
    try:
        print("Reset vocabs " + str(payload.client_id) + " / " + str(payload.profiles))
        reset_default_vocabularies(payload.client_id, payload.profiles)
        return {
            "status": "success",
            "message": "Vocabulary graph successfully reset and re-parsed."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset vocabularies: {str(e)}")

@app.get("/api/getActions")
async def get_actions_new(plan_name: str = Query(..., description="Key name for ACTION_QUERIES"),
                        client_id: str = Query("default_user", description="Unique client session ID")):
    """
    Endpoint that takes plan_number as its sole parameter to fetch and build 
    the hierarchy tree using the corresponding index in ACTION_QUERIES.
    """
    try:
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + ACTION_QUERIES[plan_name])
        
        # Apply the trimming function if trim_item is provided
        
        hierarchy_data = _trim_hierarchy_data(hierarchy_data, "Action")
        
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": ACTION_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            #"configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")

@app.get("/api/getLeftHandOperands")
async def get_left_hand_operands_new(plan_name: str = Query(..., description="Key name for LHO_QUERIES"),
                        client_id: str = Query("default_user", description="Unique client session ID")):
    """
    Endpoint that takes plan_number as its sole parameter to fetch and build 
    the hierarchy tree using the corresponding index in ACTION_QUERIES.
    """
    try:
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + LEFT_HAND_OPERAND_QUERIES[plan_name])
                
        # Apply the trimming function if trim_item is provided
        hierarchy_data = _trim_hierarchy_data(hierarchy_data, "Left Operand")
        hierarchy_data = _trim_hierarchy_data(hierarchy_data, "LeftOperand")
        
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": LEFT_HAND_OPERAND_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            #"configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")
        
@app.get("/api/getRelatedLeftHandOperands")
async def get_related_left_hand_operands_new(
    plan_name: str = Query(..., description="Key name for LHO_QUERIES"),
    class_uri: str = Query(..., description="Target class URI to filter related items"),
    client_id: str = Query("default_user", description="Unique client session ID")
):

    """
    Endpoint that takes plan_number as its sole parameter to fetch and build 
    the hierarchy tree using the corresponding index in ACTION_QUERIES.
    """
    try: 
        print("Prepping query")
        
        PREPPED_QUERY=LEFT_HAND_OPERAND_QUERIES[plan_name].replace("{TARGET_CLASS}", class_uri)
        
        #print("The prepped query is " + PREPPED_QUERY)
        
        store = get_user_store(client_id)
        print("The required store has " + str(len(store)))
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + PREPPED_QUERY)
        
        # Apply the trimming function if trim_item is provided
        hierarchy_data = _trim_hierarchy_data(hierarchy_data, "Left Operand")
        hierarchy_data = _trim_hierarchy_data(hierarchy_data, "LeftOperand")
        
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": LEFT_HAND_OPERAND_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            #"configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")

@app.get("/api/getOperators")
async def get_operators_new(plan_name: str = Query(..., description="Key name for OP_QUERIES"),
                        client_id: str = Query("default_user", description="Unique client session ID")):
    """
    Endpoint that takes plan_number as its sole parameter to fetch and build 
    the hierarchy tree using the corresponding index in ACTION_QUERIES.
    """
    try:
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + OPERATOR_QUERIES[plan_name])
        
        # Apply the trimming function if trim_item is provided
        
        hierarchy_data = _trim_hierarchy_data(hierarchy_data, "Operator")
        
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": OPERATOR_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            #"configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")
        
@app.get("/api/getRelatedOperators")
async def get_related_operators_new(
    plan_name: str = Query(..., description="Key name for OP_QUERIES"),
    class_uri: str = Query(..., description="Target class URI to filter related items"),
    client_id: str = Query("default_user", description="Unique client session ID")
):

    """
    Endpoint that takes plan_number as its sole parameter to fetch and build 
    the hierarchy tree using the corresponding index in ACTION_QUERIES.
    """
    try: 
        print("Prepping query")
        
        PREPPED_QUERY=OPERATOR_QUERIES[plan_name].replace("{TARGET_CLASS}", class_uri)
        
        #print("The prepped query is " + PREPPED_QUERY)
        
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + PREPPED_QUERY)
         
        # Apply the trimming function if trim_item is provided
        hierarchy_data = _trim_hierarchy_data(hierarchy_data, "Operator")
        
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": OPERATOR_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            #"configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")
            
@app.get("/api/getActors")
async def get_actors_new(plan_name: str = Query(..., description="Key name for ACTOR_QUERIES"),
                     client_id: str = Query("default_user", description="Unique client session ID")):
    """
    Endpoint that takes plan_number as its sole parameter to fetch and build 
    the hierarchy tree using the corresponding index in ACTOR_QUERIES.
    """
    try:
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + ACTOR_QUERIES[plan_name])
        
        # Apply the trimming function if trim_item is provided
        hierarchy_data = _trim_hierarchy_data(hierarchy_data, "Party")
        
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": ACTOR_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            #"configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")
   
if __name__ == "__main__":
    import uvicorn
    from uvicorn.config import LOGGING_CONFIG
    
    # Customize Uvicorn's default log formats to include timestamps
    LOGGING_CONFIG["formatters"]["default"]["fmt"] = "%(asctime)s %(levelprefix)s %(message)s"
    LOGGING_CONFIG["formatters"]["default"]["datefmt"] = "%Y-%m-%d %H:%M:%S"
    
    LOGGING_CONFIG["formatters"]["access"]["fmt"] = '%(asctime)s %(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s'
    LOGGING_CONFIG["formatters"]["access"]["datefmt"] = "%Y-%m-%d %H:%M:%S"
    
    uvicorn.run(app, host="127.0.0.1", port=8005)