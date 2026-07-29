import { useState, useEffect } from 'react';

/**
 * Custom hook to manage ODRL policy state, server synchronization, 
 * vocabulary data fetching, and JSON-LD compilation.
 */
export function useOdrlPolicy() {
  const [activePermissionIdx, setActivePermissionIdx] = useState(0);

  // Vocabulary feature state
  const [showVocabModal, setShowVocabModal] = useState(false);
  const [vocabOutput, setVocabOutput] = useState(`@prefix : <http://example.org/> .
@prefix dpv: <https://w3id.org/dpv#> .
@prefix dpv-owl: <https://w3id.org/dpv/owl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix profile: <http://www.w3.org/ns/dx/prof/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix role: <http://www.w3.org/ns/dx/prof/role/> .
@prefix schema: <https://schema.org/> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .`);

  // Core policy object state initialization
  const [policy, setPolicy] = useState({
    type: 'Agreement',
    uid: '',
    profile: '',
    assigner: null,
    assignee: null,
    conflict: null,
    targets: [],
    permissions: []
  });

  const [jsonLd, setJsonLd] = useState('');
  const [backendStatus, setBackendStatus] = useState('');
  const [shaclResult, setShaclResult] = useState(null);
  const [showShaclReport, setShowShaclReport] = useState(false);

  const [serverFiles, setServerFiles] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  
  // Dynamic SPARQL vocabulary lookup options
  const [dbActions, setDbActions] = useState([]);
  const [dbPurposes, setDbPurposes] = useState([]);
  const [dbLeftOperands, setDbLeftOperands] = useState([]);
  const [dbOperators, setDbOperators] = useState([]);
  const [dbRightOperands, setDbRightOperands] = useState([]);

  // Fetch server file lists from backend
  const fetchServerFiles = async () => {
    try {
      const res = await fetch('/api/policies'); // Changed from http://127.0.0.1:8005/api/policies
      if (res.ok) {
        const files = await res.json();
        setServerFiles(files);
      }
    } catch (err) {
      console.error("Could not load policy catalog listings:", err);
    }
  };

  // Fetch dynamic vocabulary rules graphs via endpoints
  const fetchGraphVocabularies = async () => {
    try {
      const [actRes, purRes, leftRes, opRes, rightRes] = await Promise.all([
        fetch('/api/actions'),
        fetch('/api/purposes'),
        fetch('/api/leftOperands'),
        fetch('/api/operators'),
        fetch('/api/rightOperands')
      ]);

      if (actRes.ok) setDbActions(await actRes.json());
      if (purRes.ok) setDbPurposes(await purRes.json());
      if (leftRes.ok) setDbLeftOperands(await leftRes.json());
      if (opRes.ok) setDbOperators(await opRes.json());
      if (rightRes.ok) setDbRightOperands(await rightRes.json());
    } catch (err) {
      console.error("Error retrieving SPARQL graph vocabulary rows:", err);
    }
  };

  useEffect(() => {
    fetchServerFiles();
    fetchGraphVocabularies();
  }, []);

  // Load a specified policy file from the backend storage directory
  const handleLoadServerPolicy = async (filename) => {
    try {
      setBackendStatus(`Reading ${filename}...`);
      const res = await fetch(`http://127.0.0.1:8005/api/policies/${filename}`);
      if (!res.ok) {
        const errData = await res.json();
        setBackendStatus(`Load failed: ${errData.detail || res.statusText}`);
        return;
      }
      
      const importedPolicy = await res.json();
      setPolicy(importedPolicy);
      setActivePermissionIdx(0);
      setShaclResult(null);
      setShowShaclReport(false);
      
      setBackendStatus(`Loaded policy successfully from ${filename}`);
      setShowDropdown(false);
    } catch (err) {
      setBackendStatus('Network execution block error during ingestion.');
    }
  };

  // Helper mapping functions for building structured ODRL constraints
  const mapConstraints = (constraintsArray) => {
    return (constraintsArray || []).map(c => ({
      "leftOperand": c.leftOperand || 'http://www.w3.org/ns/odrl/2/dateTime',
      "operator": c.operator === '=' ? 'eq' : c.operator === '<' ? 'lt' : c.operator === '>' ? 'gt' : c.operator,
      "rightOperand": c.rightOperand
    }));
  };

  const formatPurposeValue = (val) => {
    if (!val) return '';
    if (val.startsWith('http') || val.startsWith('odrl:')) {
      return val;
    }
    return `odrl:${val.replace(/[^a-zA-Z0-9]/g, '')}`;
  };

  // Automatic compilation effect mapping internal state to ODRL JSON-LD document specs
  useEffect(() => {
    if (!policy) return;

    const compiledPermissions = (policy.permissions || []).map(perm => {
      const baseGlobalConstraints = mapConstraints(perm.constraints || []);
      let finalGlobalConstraints = [...baseGlobalConstraints];

      // Restored purpose compilation routing into global rule constraints block with proper URI preservation
      if (perm.purpose) {
        const primaryPurposeConstraint = {
          "leftOperand": "http://www.w3.org/ns/odrl/2/purpose",
          "operator": "eq",
          "rightOperand": formatPurposeValue(perm.purpose.name)
        };

        if (perm.purpose.constraints && perm.purpose.constraints.length > 0) {
          const subConstraints = mapConstraints(perm.purpose.constraints);
          const purposeBundle = {
            "and": [
              primaryPurposeConstraint,
              ...subConstraints
            ]
          };
          finalGlobalConstraints.unshift(purposeBundle);
        } else {
          finalGlobalConstraints.unshift(primaryPurposeConstraint);
        }
      }

      const compiledDuties = perm.duties?.map(d => {
        const mappedConsequences = d.consequences?.map(c => ({
          "action": c.action,
          ...(c.constraints?.length > 0 && {
            "constraint": mapConstraints(c.constraints)
          })
        })) || [];

        const rawDutyAction = (d.actionObj && d.actionObj.name) || d.action || '';
        const parsedDutyActionValue = (rawDutyAction.startsWith('http') || rawDutyAction.startsWith('odrl:')) 
          ? rawDutyAction 
          : (rawDutyAction ? `odrl:${rawDutyAction}` : '');

        const dutyActionConstraints = d.actionObj?.constraints || [];

        return {
          "action": dutyActionConstraints.length > 0 ? {
            "value": parsedDutyActionValue,
            "refinement": mapConstraints(dutyActionConstraints)
          } : parsedDutyActionValue,

          ...(d.assigner && {
            "assigner": d.assigner.constraints?.length > 0 ? {
              "source": d.assigner.type.startsWith('odrl:') ? d.assigner.type : `odrl:${d.assigner.type.replace(' ', '')}`,
              "refinement": mapConstraints(d.assigner.constraints)
            } : (d.assigner.type.startsWith('odrl:') ? d.assigner.type : `odrl:${d.assigner.type.replace(' ', '')}`)
          }),
          ...(d.actor && {
            "assignee": d.actor.constraints?.length > 0 ? {
              "source": d.actor.type.startsWith('odrl:') ? d.actor.type : `odrl:${d.actor.type.replace(' ', '')}`,
              "refinement": mapConstraints(d.actor.constraints)
            } : (d.actor.type.startsWith('odrl:') ? d.actor.type : `odrl:${d.actor.type.replace(' ', '')}`)
          }),
          ...(d.constraints?.length > 0 && {
            "constraint": mapConstraints(d.constraints)
          }),
          ...(mappedConsequences.length > 0 && {
            "consequence": mappedConsequences.length === 1 ? mappedConsequences[0] : mappedConsequences
          })
        };
      });

      const rawActionName = perm.action?.name || 'http://www.w3.org/ns/odrl/2/display';
      const parsedActionValue = (rawActionName.startsWith('http') || rawActionName.startsWith('odrl:')) 
        ? rawActionName 
        : `odrl:${rawActionName}`;

      return {
        "target": perm.target?.constraints?.length > 0 ? {
          "source": perm.target.name,
          "refinement": mapConstraints(perm.target.constraints)
        } : perm.target?.name,

        "action": (perm.target?.constraints?.length > 0 || perm.action?.constraints?.length > 0) ? {
          "value": parsedActionValue,
          "refinement": mapConstraints(perm.action?.constraints || [])
        } : parsedActionValue,

        ...(perm.assigner && {
          "assigner": perm.assigner.constraints?.length > 0 ? {
            "source": perm.assigner.type.startsWith('odrl:') ? perm.assigner.type : `odrl:${perm.assigner.type.replace(' ', '')}`,
            "refinement": mapConstraints(perm.assigner.constraints)
          } : (perm.assigner.type.startsWith('odrl:') ? perm.assigner.type : `odrl:${perm.assigner.type.replace(' ', '')}`)
        }),

        ...(perm.actor && {
          "assignee": perm.actor.constraints?.length > 0 ? {
            "source": perm.actor.type.startsWith('odrl:') ? perm.actor.type : `odrl:${perm.actor.type.replace(' ', '')}`,
            "refinement": mapConstraints(perm.actor.constraints)
          } : (perm.actor.type.startsWith('odrl:') ? perm.actor.type : `odrl:${perm.actor.type.replace(' ', '')}`)
        }),

        ...(finalGlobalConstraints.length > 0 && {
          "constraint": finalGlobalConstraints
        }),

        ...(compiledDuties && compiledDuties.length > 0 && {
          "duty": compiledDuties.length === 1 ? compiledDuties[0] : compiledDuties
        })
      };
    });

    let targetOutput = undefined;
    if (policy.targets && policy.targets.length === 1) {
      targetOutput = policy.targets[0];
    } else if (policy.targets && policy.targets.length > 1) {
      targetOutput = {
        "@type": "AssetCollection",
        "uid": policy.targets
      };
    }

    const doc = {
      "@context": "http://www.w3.org/ns/odrl/2/",
      "@type": policy.type,
      "uid": policy.uid || undefined,
      "profile": policy.profile || undefined,
      ...(policy.assigner && { "assigner": policy.assigner }),
      ...(policy.assignee && { "assignee": policy.assignee }),
      ...(policy.conflict && { "conflict": policy.conflict.startsWith('odrl:') ? policy.conflict : `odrl:${policy.conflict}` }),
      ...(targetOutput && { "target": targetOutput }),
      ...(compiledPermissions.length > 0 && {
        "permission": compiledPermissions.length === 1 ? compiledPermissions[0] : compiledPermissions
      })
    };
    
    setJsonLd(JSON.stringify(doc, null, 2));
  }, [policy]);

  // Server publishing pipeline execution
  const handlePublish = async () => {
    const policyName = prompt("Please enter a name for this policy file:", "my_custom_policy");
    if (policyName === null) return;
    const sanitizedName = policyName.trim();
    if (!sanitizedName) {
      setBackendStatus("Publish aborted: Filename cannot be empty.");
      alert("Error: Policy file name cannot be empty.");
      return;
    }

    try {
      setBackendStatus('Writing file ledger...');
      const compiledJsonData = JSON.parse(jsonLd);

      const response = await fetch('http://127.0.0.1:8005/api/policy/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: sanitizedName,
          policy_data: compiledJsonData
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.status !== "error") {
        setBackendStatus(data.message || "Policy successfully published.");
        alert(`Success! ${data.message || "The document was saved to the server directory."}`);
        fetchServerFiles(); 
      } else {
        const errorMsg = data.message || data.detail || "Server failed to process file compilation.";
        setBackendStatus(`Error: ${errorMsg}`);
        alert(`Failed to save policy: ${errorMsg}`);
      }
    } catch (err) {
      const errorMsg = "Error connecting to Python backend server framework.";
      setBackendStatus(errorMsg);
      alert(errorMsg);
    }
  };

  // SHACL structural validation check
  const handleValidateShacl = async () => {
    try {
      setShaclResult({ loading: true, message: 'Validating against SHACL shapes...' });
      const response = await fetch('http://127.0.0.1:8005/api/policy/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json_string: jsonLd })
      });
      const data = await response.json();
      setShaclResult({ loading: false, valid: data.valid, message: data.message, report: data.report });
    } catch (err) {
      setShaclResult({ loading: false, valid: false, message: 'Network verification structural failure.', report: err.message });
    }
  };

  return {
    activePermissionIdx,
    setActivePermissionIdx,
    showVocabModal,
    setShowVocabModal,
    vocabOutput,
    setVocabOutput,
    policy,
    setPolicy,
    jsonLd,
    backendStatus,
    setBackendStatus,
    shaclResult,
    showShaclReport,
    setShowShaclReport,
    serverFiles,
    showDropdown,
    setShowDropdown,
    dbActions,
    dbPurposes,
    dbLeftOperands,
    dbOperators,
    dbRightOperands,
    fetchServerFiles,
    handleLoadServerPolicy,
    handlePublish,
    handleValidateShacl
  };
}