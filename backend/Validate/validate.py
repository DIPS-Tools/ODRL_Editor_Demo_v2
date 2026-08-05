from rdflib import Graph, Namespace, RDF
from typing import Union
import json
import pyshacl
import os
import rdf_utils
from owlrl import RDFS_Semantics

def validate_SHACL(graph, shacl, ont_graph=None):
    r = pyshacl.validate(graph, shacl_graph=shacl, ont_graph=ont_graph, inference='rdfs', abort_on_first=False, meta_shacl=False, debug=False)
    conforms, results_graph, results_text = r
    return conforms, results_text

from owlrl import RDFS_Semantics

def get_ODRL_macro_statistics(graph: Graph, ont_graph: Graph = None):
    """
    Given an RDFLib graph (and optionally an ontology graph),
    return a list of integers representing the number of instances
    of key ODRL classes, after applying RDFS inference.

    Order of classes:
    1. odrl:Policy
    2. odrl:Set
    3. odrl:Agreement
    4. odrl:Offer
    5. odrl:Permission
    6. odrl:Prohibition
    7. odrl:Duty
    8. odrl:Constraint
    """
    # Merge ontology into graph for reasoning if provided
    merged = Graph()
    for g in (ont_graph, graph):
        if g is not None:
            for triple in g:
                merged.add(triple)

    # Apply simple RDFS reasoning
    reasoning = RDFS_Semantics(merged, axioms=True, daxioms=True)
    reasoning.closure()
    reasoning.flush_stored_triples()

    # Define ODRL namespace
    ODRL = Namespace("http://www.w3.org/ns/odrl/2/")

    # List of ODRL classes to count
    classes = [
        ODRL.Policy,
        ODRL.Set,
        ODRL.Agreement,
        ODRL.Offer,
        ODRL.Permission,
        ODRL.Prohibition,
        ODRL.Duty,
        ODRL.Constraint,
    ]

    # Count instances of each class
    counts = []
    for cls in classes:
        count = len(set(merged.subjects(RDF.type, cls)))
        counts.append(count)

    return counts

def describe_ODRL_statistics(stats):
    """
    Given a list of counts from get_ODRL_macro_statistics(),
    returns a formatted string describing the number of ODRL entities.

    The order of 'stats' is assumed to be:
    1. Policy
    2. Set
    3. Agreement
    4. Offer
    5. Permission
    6. Prohibition
    7. Duty
    8. Constraint
    """
    labels = [
        "Policy",
        "Set",
        "Agreement",
        "Offer",
        "Permission",
        "Prohibition",
        "Duty",
        "Constraint"
    ]

    # Defensive check
    if len(stats) != len(labels):
        raise ValueError(f"Expected {len(labels)} statistics, got {len(stats)}")

    # Build readable text
    lines = []
    for label, count in zip(labels, stats):
        lines.append(f"- {count} {label}")

    return "ODRL entities summary:\n" + "\n".join(lines)


def diagnose_ODRL(filepath) -> str:
    graph, format = rdf_utils.load(filepath)
    errors = []
    warnings = []
    parsed_info = []
    format_report = ""
    if graph is None or len(graph) == 0:
        try:
            json.load(filepath)
            errors.append("FORMAT ERROR: The provided string is plain JSON. An ODRL file should be in a graph format, like JSON-LD.")
        except (ValueError, TypeError):
            errors.append("FORMAT ERROR: The provided string is not recognised as any ODRL graph formats, such as JSON-LD, Turtle or RDF/XML. It does not appear to be plain JSON either.")
            return errors, warnings, parsed_info, False
    parsed_info.append("INFO: The file contains an RDF graph in the following format: "+str(format))

    # validate ODRL using SHACL
    # The SHACL shapes graph used is derived from the one at https://github.com/woutslabbinck/ODRL-shape
    # https://github.com/woutslabbinck/ODRL-shape/blob/main/odrl-shacl.ttl
    # They are extended to allow for lists of IRIs in the right operands

    shacl_file = os.path.join("SHACL", "odrl-shacl.ttl")
    ont_file = os.path.join("ODRL", "ODRL22.ttl")
    ont_graph = Graph().parse(ont_file, format="turtle")
    conforms, report = validate_SHACL(graph, shacl_file, ont_graph=ont_graph)
    stats = get_ODRL_macro_statistics(graph, ont_graph)
    parsed_info.append(describe_ODRL_statistics(stats))
    if conforms :
        parsed_info.append("SHACL validation check passed")
    else :
        parsed_info.append("\nSHACL validation failed")
        parsed_info.append("SHACL validation report : \n" + str(report))
    is_valid = conforms and not errors
    return errors, warnings, parsed_info, is_valid

def generate_ODRL_diagnostic_report(filepath: str) -> str:
    errors, warnings, parsed_info, is_valid = diagnose_ODRL(filepath)
    print("REPORT START\nAnalysing the file "+str(filepath)+" for ODRL compliance:")
    print(f"Is it compliant? {is_valid}")
    for error in errors:
        print(error)
    for warning in warnings:
        print(warning)
    for info in parsed_info:
        print(info)
    print("REPORT END\n")
