ACTION_QUERIES={
# https://github.com/DIPS-Tools/ODRL-Engine/blob/main/documentation/ontology_guidelines.md
'DEFAULT_ACTION_QUERY':
# Default Action Query
"""
SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
WHERE {
    BIND("No definition available" as ?default_definition)
    
    {
        # Pattern 1: Extract Subclass Hierarchy down from odrl:Action
        ?sub_action rdfs:subClassOf ?action .
        ?action rdfs:subClassOf* odrl:Action .
        ?sub_action rdfs:subClassOf* odrl:Action .
    }
    UNION
    {
        # Pattern 2: Extract Instances of any class/subclass under odrl:action
        ?sub_action rdf:type ?action .
        ?action rdfs:subClassOf* odrl:Action .
    }
    UNION
    {
        # Match items explicitly included via ODRL inclusion properties
        ?sub_action odrl:includedIn ?action .
    }
    
    # Retrieve labels and definitions for the child element (?sub_action)
    ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
    OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
    
    # Retrieve labels and definitions for the parent class (?action)
    # NEW: Added OPTIONAL HERE FOR MISSING PARENTS
    OPTIONAL { ?action (rdfs:label | skos:prefLabel) ?label . }
    OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
    
    # Fallback definitions
    BIND(COALESCE(?definition_res, ?default_definition) as ?definition)
    BIND(COALESCE(?sub_definition_res, ?default_definition) as ?sub_definition)
}
ORDER BY ?action ?sub_action
"""
}

LEFT_HAND_OPERAND_QUERIES={
'DEFAULT_LEFT_HAND_OPERAND_QUERY':
# Default Action Query
"""
SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
WHERE {
    BIND("No definition available" as ?default_definition)
    
    {
        # Pattern 1: Extract Subclass Hierarchy down from odrl:LeftOperand
        ?sub_action rdfs:subClassOf ?action .
        ?action rdfs:subClassOf* odrl:LeftOperand .
        ?sub_action rdfs:subClassOf* odrl:LeftOperand .
    }
    UNION
    {
        # Pattern 2: Extract Instances of any class/subclass under odrl:LeftOperand
        ?sub_action rdf:type ?action .
        ?action rdfs:subClassOf* odrl:LeftOperand .
    }
    
    # Retrieve labels and definitions for the child element (?sub_action)
    ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
    OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
    
    # Retrieve labels and definitions for the parent class (?action)
    # NEW: Added OPTIONAL HERE FOR MISSING PARENTS
    OPTIONAL { ?action (rdfs:label | skos:prefLabel) ?label . }
    OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
    
    # Fallback definitions
    BIND(COALESCE(?definition_res, ?default_definition) as ?definition)
    BIND(COALESCE(?sub_definition_res, ?default_definition) as ?sub_definition)
}
ORDER BY ?action ?sub_action
""",
'RELATED_LEFT_HAND_OPERAND_QUERY':
# Extracts left hand operands that are related to the item given as parameter
"""
SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
WHERE {
    BIND("No definition available" as ?default_definition)
    
    # Define the specific class URI you want to filter by
    VALUES ?targetClass { <{TARGET_CLASS}> }
    {
        # Pattern 1: Extract Subclass Hierarchy down from odrl:LeftOperand
        ?sub_action rdfs:subClassOf ?action .
        ?action rdfs:subClassOf* odrl:LeftOperand .
        ?sub_action rdfs:subClassOf* odrl:LeftOperand .
    }
    UNION
    {
        # Pattern 2: Extract Instances of any class/subclass under odrl:LeftOperand
        ?sub_action rdf:type ?action .
        ?action rdfs:subClassOf* odrl:LeftOperand .
    }
    
    # Ensure the left operand is explicitly related to the specified class URI via skos:related
    {
        ?sub_action skos:related ?targetClass .
    }
    UNION
    {
        ?targetClass skos:related ?sub_action .
    }
    
    # Retrieve labels and definitions for the child element (?sub_action)
    ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
    OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
    
    # Retrieve labels and definitions for the parent class (?action)
    # NEW: Added OPTIONAL HERE FOR MISSING PARENTS
    OPTIONAL { ?action (rdfs:label | skos:prefLabel) ?label . }
    OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
    
    # Fallback definitions
    BIND(COALESCE(?definition_res, ?default_definition) as ?definition)
    BIND(COALESCE(?sub_definition_res, ?default_definition) as ?sub_definition)
}
ORDER BY ?action ?sub_action
"""
}

OPERATOR_QUERIES={
'DEFAULT_OPERATOR_QUERY':
# Default Action Query
"""
SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
WHERE {
    BIND("No definition available" as ?default_definition)
    
    {
        # Pattern 1: Extract Subclass Hierarchy down from odrl:Operator
        ?sub_action rdfs:subClassOf ?action .
        ?action rdfs:subClassOf* odrl:Operator .
        ?sub_action rdfs:subClassOf* odrl:Operator .
    }
    UNION
    {
        # Pattern 2: Extract Instances of any class/subclass under odrl:LeftOperand
        ?sub_action rdf:type ?action .
        ?action rdfs:subClassOf* odrl:Operator .
    }
    
    # Retrieve labels and definitions for the child element (?sub_action)
    ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
    OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
    
    # Retrieve labels and definitions for the parent class (?action)
    # NEW: Added OPTIONAL HERE FOR MISSING PARENTS
    OPTIONAL { ?action (rdfs:label | skos:prefLabel) ?label . }
    OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
    
    # Fallback definitions
    BIND(COALESCE(?definition_res, ?default_definition) as ?definition)
    BIND(COALESCE(?sub_definition_res, ?default_definition) as ?sub_definition)
}
ORDER BY ?action ?sub_action
""",
'RELATED_OPERATOR_QUERY':
# Extracts left hand operands that are related to the item given as parameter
"""
SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
WHERE {
    BIND("No definition available" as ?default_definition)
    
    # Define the specific class URI you want to filter by
    VALUES ?targetClass { <{TARGET_CLASS}> }
    {
        # Pattern 1: Extract Subclass Hierarchy down from odrl:Operator
        ?sub_action rdfs:subClassOf ?action .
        ?action rdfs:subClassOf* odrl:Operator .
        ?sub_action rdfs:subClassOf* odrl:Operator .
    }
    UNION
    {
        # Pattern 2: Extract Instances of any class/subclass under odrl:LeftOperand
        ?sub_action rdf:type ?action .
        ?action rdfs:subClassOf* odrl:Operator .
    }
    
    # Ensure the left operand is explicitly related to the specified class URI via skos:related
    {
        ?sub_action skos:related ?targetClass .
    }
    UNION
    {
        ?targetClass skos:related ?sub_action .
    }
    
    # Retrieve labels and definitions for the child element (?sub_action)
    ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
    OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
    
    # Retrieve labels and definitions for the parent class (?action)
    # NEW: Added OPTIONAL HERE FOR MISSING PARENTS
    OPTIONAL { ?action (rdfs:label | skos:prefLabel) ?label . }
    OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
    
    # Fallback definitions
    BIND(COALESCE(?definition_res, ?default_definition) as ?definition)
    BIND(COALESCE(?sub_definition_res, ?default_definition) as ?sub_definition)
}
ORDER BY ?action ?sub_action
"""
}

ACTOR_QUERIES={
'DEFAULT_ACTOR_QUERY':
"""
    SELECT DISTINCT ?action ?label ?definition ?sub_action ?sub_label ?sub_definition
    WHERE {
        bind("No definition available" as ?default_definition)
        bind("No definition available" as ?default_sub_definition)
    
        {
           # Pattern 1: Extract Subclass Hierarchy down from odrl:Party 
           ?sub_action rdfs:subClassOf ?action .
           ?action rdfs:subClassOf* odrl:Party  .
           ?sub_action rdfs:subClassOf* odrl:Party  .
        }
        
        UNION
        { 
            # Pattern 2: Extract Instances of any class/subclass under dvpowl:Entity
            ?sub_action rdf:type ?action .
            ?action rdfs:subClassOf* odrl:Party .
        }
    
        # Retrieve labels and definitions for the child element (?sub_action)
        ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
        OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
    
        # Retrieve labels and definitions for the parent class (?action)
        # NEW: Added OPTIONAL HERE FOR MISSING PARENTS
        OPTIONAL { ?action (rdfs:label | skos:prefLabel) ?label . }
        OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
    
        # Fallback definitions
        BIND(COALESCE(?definition_res, ?default_definition) as ?definition)
        BIND(COALESCE(?sub_definition_res, ?default_definition) as ?sub_definition)
    }
    ORDER BY ?action ?sub_action
    """,
'DEFAULT_ACTOR_QUERY_OLD':
"""
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
        UNION
        {
           # Pattern 2: Extract Instances of any class/subclass under odrl:Party
           ?sub_action rdfs:subClassOf ?action .
           ?action rdfs:subClassOf* odrl:Party .
           ?sub_action rdfs:subClassOf* odrl:Party .
        }
        UNION
        { 
            # Pattern 2: Extract Instances of any class/subclass under dvpowl:Entity
            ?sub_action rdf:type ?action .
            ?action rdfs:subClassOf* odrl:Party .
        }
    
        # Retrieve labels and definitions for the child element (?sub_action)
        ?sub_action (rdfs:label | skos:prefLabel) ?sub_label .
        OPTIONAL { ?sub_action (skos:definition | rdfs:comment | skos:note) ?sub_definition_res . }
    
        # Retrieve labels and definitions for the parent class (?action)
        # NEW: Added OPTIONAL HERE FOR MISSING PARENTS
        OPTIONAL { ?action (rdfs:label | skos:prefLabel) ?label . }
        OPTIONAL { ?action (skos:definition | rdfs:comment | skos:note) ?definition_res . }
    
        # Fallback definitions
        BIND(COALESCE(?definition_res, ?default_definition) as ?definition)
        BIND(COALESCE(?sub_definition_res, ?default_definition) as ?sub_definition)
    }
    ORDER BY ?action ?sub_action
    """
    
}