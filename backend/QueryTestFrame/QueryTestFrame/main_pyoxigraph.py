from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
import pyoxigraph
import rdflib
from collections import defaultdict
from fastapi.middleware.cors import CORSMiddleware
from SPARQL import ACTION_QUERIES, LEFT_HAND_OPERAND_QUERIES, OPERATOR_QUERIES, ACTOR_QUERIES

import asyncio
import sys

# pip install oxrdflib
# pip install pyoxigraph
# Key Changes Made:
# Store Initialization: Replaced rdflib.Graph() with pyoxigraph.Store().

# Parsing Ontologies: Used store.load(path=file_path) which automatically infers format from the file extension 
# (supporting .ttl, .rdf, .owl, .xml, .jsonld, .n3).

# Query Execution: Replaced graph querying with store.query(sparql_query).

# Iterating Query Solutions: Adjusted result handling to use pyoxigraph's solution binding dictionary keys (e.g., row["sub_action"], row["sub_label"], etc.).

# Switch to SelectorEventLoop on Windows to avoid Proactor socket noise
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ==========================================
# CONFIGURABLE RELATIONSHIP PROPERTIES
# ==========================================
CONFIGURED_ACTION_RELATIONSHIPS = [
    "odrl:includedIn",
    "rdfs:subClassOf*",
    "skos:broader",
    "rdf:type"
]

# NEWUSERBLOCK
RELATIONSHIP_PROPERTY_SET = " | ".join(CONFIGURED_ACTION_RELATIONSHIPS)
ONTOLOGY_DIR = Path("OntologiesToLoad")

# Dictionary to hold isolated graph stores per client/session ID
user_stores = {}

def load_ontologies_into_store(store: rdflib.Graph):
    """Scans the OntologiesToLoad directory and parses all ontology files into a specific store instance."""
    if not ONTOLOGY_DIR.exists() or not ONTOLOGY_DIR.is_dir():
        print(f"Warning: Directory '{ONTOLOGY_DIR}' does not exist. Store will be empty.")
        return

    valid_extensions = {".ttl", ".rdf", ".owl", ".xml", ".jsonld", ".n3"}
    
    loaded_files = 0
    for file_path in ONTOLOGY_DIR.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in valid_extensions:
            try:
                store.parse(file_path)
                print(f"Successfully loaded into store: {file_path.name}")
                loaded_files += 1
            except Exception as e:
                print(f"Error parsing file {file_path.name}: {e}")
                
    print(f"Initialization complete for store. Loaded {loaded_files} file(s). Total triples: {len(store)}")

def get_user_store(client_id: str) -> rdflib.Graph:
    """Retrieves an existing store for the client_id or creates and initializes a new one."""
    if client_id not in user_stores:
        print(f"Creating new isolated graph store for client_id: {client_id}")
        new_store = rdflib.Graph(store="Oxigraph")
        load_ontologies_into_store(new_store)
        user_stores[client_id] = new_store
    return user_stores[client_id]

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup: You can pre-load a default store if desired ---
    yield
    # --- Shutdown: Clear all user stores ---
    for store in user_stores.values():
        store.remove((None, None, None))
    user_stores.clear()

import uuid

# @app.post("/register")
# async def register_client():
#     """Generates a unique client ID on the server and initializes their isolated graph store."""
#     client_id = f"client_{uuid.uuid4()}"
#     store = get_user_store(client_id)
#     return {
#         "client_id": client_id,
#         "message": "Isolated graph store created successfully",
#         "total_triples_in_memory": len(store)
#     }
    
# END_NEWUSERBLOCK

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

# def load_ontologies_into_store():
#     """Scans the OntologiesToLoad directory and parses all ontology files into the pyoxigraph store."""
#     if not ONTOLOGY_DIR.exists() or not ONTOLOGY_DIR.is_dir():
#         print(f"Warning: Directory '{ONTOLOGY_DIR}' does not exist. Store will be empty.")
#         return

#     valid_extensions = {".ttl", ".rdf", ".owl", ".xml", ".jsonld", ".n3"}
    
#     loaded_files = 0
#     for file_path in ONTOLOGY_DIR.iterdir():
#         if file_path.is_file() and file_path.suffix.lower() in valid_extensions:
#             try:
#                 # pyoxigraph store.load accepts a file path directly and handles format guessing
#                 # ontology_store.load(path=file_path)
#                 ontology_store.parse(file_path)
#                 print(f"Successfully loaded: {file_path.name}")
#                 loaded_files += 1
#             except Exception as e:
#                 print(f"Error parsing file {file_path.name}: {e}")
                
#     print(f"Initialization complete. Loaded {loaded_files} file(s). Total triples/quads: {len(ontology_store)}")

# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     # --- Startup: You can pre-load a default store if desired ---
#     yield
#     # --- Shutdown: Clear all user stores ---
#     for store in user_stores.values():
#         store.clear()
#     user_stores.clear()

# Initialize FastAPI with the lifespan handler
app = FastAPI(
    title="ODRL Ontology Service (Pyoxigraph)",
    description="FastAPI service loaded with base ODRL and custom extensions using Pyoxigraph.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _build_hierarchy_tree(store: rdflib.Graph, sparql_query: str):
    """Builds an alphabetized, deduplicated hierarchical tree array matching the requested output field structuring."""
    print("Querying now")
    qres = store.query(sparql_query)
    print("Querying complete")
        
    children_map = defaultdict(list)
    label_to_uri = {}
    label_to_def = {}
    
    all_children = set()
    all_parents = set()
    has_parent = set()
    
    for row in qres:
        sub_uri = str(row.sub_action) if row.sub_action else ""
        if not sub_uri:
            continue
            
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

    all_nodes = all_children.union(all_parents)
    roots = all_nodes - has_parent

    if not roots and all_children:
        roots = all_children

    formatted_rows = []
    visited_paths = set()

    def build_tree_paths(current_node: str, current_path: list):
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

    return sorted(formatted_rows, key=lambda x: x[0])
    
@app.post("/register")
async def register_client():
    """Generates a unique client ID on the server and initializes their isolated graph store."""
    client_id = f"client_{uuid.uuid4()}"
    store = get_user_store(client_id)
    return {
        "client_id": client_id,
        "message": "Isolated graph store created successfully",
        "total_triples_in_memory": len(store)
    }

@app.get("/getActions")
async def get_actions(plan_name: str = Query(..., description="Key name for ACTION_QUERIES"),
                        client_id: str = Query("default_user", description="Unique client session ID")):
    try:
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + ACTION_QUERIES[plan_name])
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": ACTION_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            "configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")

@app.get("/getLeftHandOperands")
async def get_left_hand_operands(plan_name: str = Query(..., description="Key name for LHO_QUERIES"),
                        client_id: str = Query("default_user", description="Unique client session ID")):
    try:
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + LEFT_HAND_OPERAND_QUERIES[plan_name])
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": LEFT_HAND_OPERAND_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            "configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")
        
@app.get("/getRelatedLeftHandOperands")
async def get_related_left_hand_operands(
    plan_name: str = Query(..., description="Key name for LHO_QUERIES"),
    class_uri: str = Query(..., description="Target class URI to filter related items"),
                        client_id: str = Query("default_user", description="Unique client session ID")
):
    try: 
        print("Prepping query")
        PREPPED_QUERY = LEFT_HAND_OPERAND_QUERIES[plan_name].replace("{TARGET_CLASS}", class_uri)
        print("The prepped query is " + PREPPED_QUERY)
        
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + PREPPED_QUERY)
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": LEFT_HAND_OPERAND_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            "configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")

@app.get("/getOperators")
async def get_operators(plan_name: str = Query(..., description="Key name for OP_QUERIES"),
                        client_id: str = Query("default_user", description="Unique client session ID")):
    try:
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + OPERATOR_QUERIES[plan_name])
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": OPERATOR_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            "configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")
        
@app.get("/getRelatedOperators")
async def get_related_operators(
    plan_name: str = Query(..., description="Key name for OP_QUERIES"),
    class_uri: str = Query(..., description="Target class URI to filter related items"),
    client_id: str = Query("default_user", description="Unique client session ID")
):
    try: 
        print("Prepping query")
        PREPPED_QUERY = OPERATOR_QUERIES[plan_name].replace("{TARGET_CLASS}", class_uri)
        print("The prepped query is " + PREPPED_QUERY)
        
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + PREPPED_QUERY)
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": OPERATOR_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            "configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")
            
@app.get("/getActors")
async def get_actors(plan_name: str = Query(..., description="Key name for ACTOR_QUERIES"),
                     client_id: str = Query("default_user", description="Unique client session ID")):
    try:
        store = get_user_store(client_id)
        hierarchy_data = _build_hierarchy_tree(store, query_prefix + ACTOR_QUERIES[plan_name])
        return {
            "plan_number": plan_name,
            "total_triples_in_memory": len(store),
            "query_run": ACTOR_QUERIES[plan_name],
            "number_of_items_returned": len(hierarchy_data),
            "configured_relationships": CONFIGURED_ACTION_RELATIONSHIPS,
            "actions": hierarchy_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Graph query pipeline failure: {str(e)}")
   
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8010)