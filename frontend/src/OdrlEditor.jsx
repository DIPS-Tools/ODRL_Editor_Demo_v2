import React, { useState, useRef } from 'react';
import { useOdrlPolicy } from './useOdrlPolicy';
import { renderLeftOperandSelect, renderOperatorSelect, renderRightOperandInput } from './components/ConstraintHelpers';
import HumanSummaryPanel from './components/HumanSummaryPanel';

export default function OdrlEditor() {
  const {
    activePermissionIdx, setActivePermissionIdx,
    showVocabModal, setShowVocabModal,
    vocabOutput, setVocabOutput,
    policy, setPolicy,
    jsonLd, backendStatus,
    shaclResult, showShaclReport, setShowShaclReport,
    serverFiles, showDropdown, setShowDropdown,
    dbActions, dbPurposes, dbLeftOperands, dbOperators,
    fetchServerFiles, handleLoadServerPolicy, handlePublish, handleValidateShacl
  } = useOdrlPolicy();

  // State for feature under development modal
  const [showDevModal, setShowDevModal] = useState(false);
  
  // State for magnifying glass floating modal
  const [showMagnifyModal, setShowMagnifyModal] = useState(false);

  // State for toggling policy code format view (JSON-LD vs TTL)
  const [codeViewFormat, setCodeViewFormat] = useState('JSON-LD');
  
  // State to hold the TTL string fetched from the backend endpoint
  const [ttlOutput, setTtlOutput] = useState('');

  // Ref for hidden file input used in uploading a local policy file
  const fileInputRef = useRef(null);

  // Asynchronous helper function to call the api/policy/to-ttl endpoint
  const convertJsonLdToTtl = async (jsonLdString) => {
    try {
      const response = await fetch('api/policy/to-ttl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonLdString, // Pass the JSON-LD string directly (or JSON.stringify({ policy: jsonLdString }) if your backend expects a JSON object wrapper)
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}: ${response.statusText}`);
      }

      // Assuming the endpoint returns the raw TTL string. 
      // Use response.json() if your API returns an object like { ttl: "..." }
      // Parse the response as JSON
      const data = await response.json();

      // Return just the "ttl" content if it exists, otherwise throw an error
      if (data && data.ttl) {
        return data.ttl;
      } else {
        throw new Error('Response object did not contain a "ttl" property.');
      }
    } catch (e) {
      return `# Error parsing JSON-LD for TTL conversion via API: ${e.message}\n\n` + jsonLdString;
    }
  };
  
  // Automatically fetch TTL when JSON-LD updates or when TTL view format is selected
  React.useEffect(() => {
    if (codeViewFormat === 'TTL' && jsonLd) {
      convertJsonLdToTtl(jsonLd).then((result) => {
        setTtlOutput(result);
      });
    }
  }, [jsonLd, codeViewFormat]);

  // Handler for downloading the current policy as a .json file
  const handleDownloadPolicy = () => {
    try {
      const blob = new Blob([jsonLd], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const fileName = policy.uid ? `${policy.uid.replace(/[:\/]/g, '_')}.json` : 'policy.json';
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to download policy JSON file:", e);
    }
  };

  // Helper to parse constraints or refinements from any ODRL entity object/array
  const parseConstraints = (obj) => {
    const raw = obj?.constraint || obj?.refinement;
    if (!raw) return [];
    const rawList = Array.isArray(raw) ? raw : [raw];
    const parsed = [];

    rawList.forEach(c => {
      // Check for ODRL logical constraint operators
      const logicalOp = ['and', 'or', 'xone'].find(op => c[op]);
      if (logicalOp && Array.isArray(c[logicalOp])) {
        // Flatten sub-constraints inside the logical block
        c[logicalOp].forEach(subC => {
          parsed.push({
            leftOperand: subC.leftOperand || '',
            operator: subC.operator || '',
            rightOperand: subC.rightOperand || ''
          });
        });
      } else if (c.leftOperand || c.operator || c.rightOperand) {
        // Standard single constraint
        parsed.push({
          leftOperand: c.leftOperand || '',
          operator: c.operator || '',
          rightOperand: c.rightOperand || ''
        });
      }
    });

    return parsed;
  };
  
  // Helper function to safely extract the party type whether it's a string or an object
  const parsePartyType = (val) => {
    if (!val) return 'Legal Entity';
    if (typeof val === 'string') return val;
    return val.type || val["@type"] || 'Legal Entity';
  };
  
  // Handler for uploading and parsing a local policy .json file into the editor
  const handleUploadPolicyFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result;
        if (typeof content === 'string') {
          const parsedJson = JSON.parse(content);
          
          const newTargets = parsedJson.target ? (Array.isArray(parsedJson.target) ? parsedJson.target : [parsedJson.target]) : [];
          
          // Unified parser for Permissions, Prohibitions, and Obligations
          const parseRule = (p) => ({
			uid: p.uid || p["@id"] || null, // Added UID parsing
            // 1) Refinements for an action
            action: { 
              name: typeof p.action === 'string' ? p.action : (p.action?.rdfValue || p.action?.["@id"] || ''), 
              constraints: parseConstraints(p.action) 
            },
            assigner: p.assigner ? { 
              type: parsePartyType(p.assigner), 
              constraints: parseConstraints(p.assigner) 
            } : null,

            actor: p.assignee ? { 
              type: parsePartyType(p.assignee), 
              constraints: parseConstraints(p.assignee) 
            } : null,
            purpose: p.purpose ? {
              name: typeof p.purpose === 'string' ? p.purpose : (p.purpose?.["@id"] || p.purpose?.rdfValue || ''),
              constraints: parseConstraints(p.purpose)
            } : null,
			
            // 2) Any data about the target (URI/name + constraints)
            // Updated target parser to check for "source"
            target: p.target ? { 
              name: typeof p.target === 'string' 
                ? p.target 
                : (p.target?.source || p.target?.["@id"] || p.target?.rdfValue || p.target?.id || ''), 
              constraints: parseConstraints(p.target) 
            } : null,
            // 4) All rule level constraints
            constraints: parseConstraints(p),
            duties: (p.duty || p.remedy || p.consequence) ? (Array.isArray(p.duty || p.remedy || p.consequence) ? (p.duty || p.remedy || p.consequence) : [p.duty || p.remedy] || p.consequence).map(d => ({
              action: typeof d.action === 'string' ? d.action : (d.action?.rdfValue || d.action?.["@id"] || ''),
              // 5) Duty actions constraints
              actionObj: { 
                name: typeof d.action === 'string' ? d.action : (d.action?.rdfValue || d.action?.["@id"] || ''), 
                constraints: parseConstraints(d.action) 
              },
			  
              assigner: d.assigner ? { 
                type: parsePartyType(d.assigner), 
                constraints: parseConstraints(d.assigner) 
              } : null,

              actor: (d.assignee || d.actor) ? { 
                type: parsePartyType(d.assignee || d.actor), 
                constraints: parseConstraints(d.assignee || d.actor) 
              } : null,
			  
              constraints: parseConstraints(d),
              consequences: d.consequence ? (Array.isArray(d.consequence) ? d.consequence : [d.consequence]).map(c => ({
                action: typeof c.action === 'string' ? c.action : (c.action?.rdfValue || c.action?.["@id"] || ''),
                constraints: parseConstraints(c)
              })) : []
            })) : []
          });

          const newPermissions = (parsedJson.permission ? (Array.isArray(parsedJson.permission) ? parsedJson.permission : [parsedJson.permission]) : []).map(parseRule);
          const newProhibitions = (parsedJson.prohibition ? (Array.isArray(parsedJson.prohibition) ? parsedJson.prohibition : [parsedJson.prohibition]) : []).map(parseRule);
          const newObligations = (parsedJson.obligation ? (Array.isArray(parsedJson.obligation) ? parsedJson.obligation : [parsedJson.obligation]) : []).map(parseRule);

          setPolicy({
            type: parsedJson["@type"] || 'Set',
            uid: parsedJson.uid || parsedJson["@id"] || '',
            profile: parsedJson.profile || '',
            assigner: parsedJson.assigner || null,
            assignee: parsedJson.assignee || null,
            conflict: parsedJson.conflict || null,
            targets: newTargets,
            permissions: newPermissions,
            prohibitions: newProhibitions,
            obligations: newObligations
          });
          setActivePermissionIdx({ type: 'permission', idx: 0 });
        }
      } catch (err) {
        console.error("Failed to parse uploaded policy JSON file:", err);
        alert("Invalid JSON file format.");
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  // Policy Metadata Target Handlers
  const addMetadataTarget = () => setPolicy({ ...policy, targets: [...(policy.targets || []), ''] });
  const updateMetadataTarget = (index, value) => {
    const targets = [...policy.targets];
    targets[index] = value;
    setPolicy({ ...policy, targets });
  };
  const removeMetadataTarget = (indexToRemove) => setPolicy({ ...policy, targets: policy.targets.filter((_, idx) => idx !== indexToRemove) });

  // Permission Block Handlers
  const addPermissionBlock = () => {
    const hasGlobalTargets = policy.targets && policy.targets.length > 0 && policy.targets.some(t => t.trim() !== '');
    const newPermission = {
	  uid: null, // Initialized as null
      action: { name: '', constraints: [] },
      assigner: null, actor: null,
      purpose: null,
      target: hasGlobalTargets ? null : { name: '', constraints: [] },
      constraints: [], 
	  duties: []
    };
    const permissions = [...(policy.permissions || []), newPermission];
    setPolicy({ ...policy, permissions });
    setActivePermissionIdx({ type: 'permission', idx: permissions.length - 1 });
  };
  const removePermissionBlock = (permIdx) => {
    const permissions = policy.permissions.filter((_, idx) => idx !== permIdx);
    setPolicy({ ...policy, permissions });
    if (activePermissionIdx.type === 'permission' && activePermissionIdx.idx >= permissions.length) {
      if (permissions.length > 0) {
        setActivePermissionIdx({ type: 'permission', idx: permissions.length - 1 });
      } else if (policy.prohibitions && policy.prohibitions.length > 0) {
        setActivePermissionIdx({ type: 'prohibition', idx: 0 });
      }
    }
  };

  // Prohibition Block Handlers
  const addProhibitionBlock = () => {
    const hasGlobalTargets = policy.targets && policy.targets.length > 0 && policy.targets.some(t => t.trim() !== '');
    const newProhibition = {
	  uid: null, // Initialized as null
      action: { name: '', constraints: [] },
      assigner: null, actor: null,
      purpose: null,
      target: hasGlobalTargets ? null : { name: '', constraints: [] },
      constraints: [],
	  duties: []
    };
    const prohibitions = [...(policy.prohibitions || []), newProhibition];
    setPolicy({ ...policy, prohibitions });
    setActivePermissionIdx({ type: 'prohibition', idx: prohibitions.length - 1 });
  };
  const removeProhibitionBlock = (prohibIdx) => {
    const prohibitions = policy.prohibitions.filter((_, idx) => idx !== prohibIdx);
    setPolicy({ ...policy, prohibitions });
    if (activePermissionIdx.type === 'prohibition' && activePermissionIdx.idx >= prohibitions.length) {
      if (prohibitions.length > 0) {
        setActivePermissionIdx({ type: 'prohibition', idx: prohibitions.length - 1 });
      } else if (policy.permissions && policy.permissions.length > 0) {
        setActivePermissionIdx({ type: 'permission', idx: 0 });
      }
    }
  };

  // --- Abstracted Generic Constraint Handlers ---
  const modifyPermissions = (updaterFn) => {
    const permissions = [...(policy.permissions || [])];
    updaterFn(permissions);
    setPolicy({ ...policy, permissions });
  };

  const modifyProhibitions = (updaterFn) => {
    const prohibitions = [...(policy.prohibitions || [])];
    updaterFn(prohibitions);
    setPolicy({ ...policy, prohibitions });
  };

  // Specific constraint handlers mapped to common abstractions
  const addActionConstraint = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].action.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
  });
  const updateActionConstraint = (permIdx, index, field, value) => modifyPermissions(permissions => {
    permissions[permIdx].action.constraints[index][field] = value;
  });
  const deleteActionConstraint = (permIdx, indexToRemove) => modifyPermissions(permissions => {
    permissions[permIdx].action.constraints = permissions[permIdx].action.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addProhibitionActionConstraint = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].action.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
  });
  const updateProhibitionActionConstraint = (prohibIdx, index, field, value) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].action.constraints[index][field] = value;
  });
  const deleteProhibitionActionConstraint = (prohibIdx, indexToRemove) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].action.constraints = prohibitions[prohibIdx].action.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addPermissionConstraint = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
  });
  const updatePermissionConstraint = (permIdx, index, field, value) => modifyPermissions(permissions => {
    permissions[permIdx].constraints[index][field] = value;
  });
  const deletePermissionConstraint = (permIdx, indexToRemove) => modifyPermissions(permissions => {
    permissions[permIdx].constraints = permissions[permIdx].constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addProhibitionConstraint = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
  });
  const updateProhibitionConstraint = (prohibIdx, index, field, value) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].constraints[index][field] = value;
  });
  const deleteProhibitionConstraint = (prohibIdx, indexToRemove) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].constraints = prohibitions[prohibIdx].constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addAssignerConstraint = (permIdx) => modifyPermissions(permissions => {
    if (!permissions[permIdx].assigner) return;
    permissions[permIdx].assigner.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateAssignerConstraint = (permIdx, index, field, value) => modifyPermissions(permissions => {
    permissions[permIdx].assigner.constraints[index][field] = value;
  });
  const deleteAssignerConstraint = (permIdx, indexToRemove) => modifyPermissions(permissions => {
    permissions[permIdx].assigner.constraints = permissions[permIdx].assigner.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addProhibitionAssignerConstraint = (prohibIdx) => modifyProhibitions(prohibitions => {
    if (!prohibitions[prohibIdx].assigner) return;
    prohibitions[prohibIdx].assigner.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateProhibitionAssignerConstraint = (prohibIdx, index, field, value) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].assigner.constraints[index][field] = value;
  });
  const deleteProhibitionAssignerConstraint = (prohibIdx, indexToRemove) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].assigner.constraints = prohibitions[prohibIdx].assigner.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addActorConstraint = (permIdx) => modifyPermissions(permissions => {
    if (!permissions[permIdx].actor) return;
    permissions[permIdx].actor.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateActorConstraint = (permIdx, index, field, value) => modifyPermissions(permissions => {
    permissions[permIdx].actor.constraints[index][field] = value;
  });
  const deleteActorConstraint = (permIdx, indexToRemove) => modifyPermissions(permissions => {
    permissions[permIdx].actor.constraints = permissions[permIdx].actor.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addProhibitionActorConstraint = (prohibIdx) => modifyProhibitions(prohibitions => {
    if (!prohibitions[prohibIdx].actor) return;
    prohibitions[prohibIdx].actor.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateProhibitionActorConstraint = (prohibIdx, index, field, value) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].actor.constraints[index][field] = value;
  });
  const deleteProhibitionActorConstraint = (prohibIdx, indexToRemove) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].actor.constraints = prohibitions[prohibIdx].actor.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addPurposeConstraint = (permIdx) => modifyPermissions(permissions => {
    if (!permissions[permIdx].purpose) return;
    permissions[permIdx].purpose.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updatePurposeConstraint = (permIdx, index, field, value) => modifyPermissions(permissions => {
    permissions[permIdx].purpose.constraints[index][field] = value;
  });
  const deletePurposeConstraint = (permIdx, indexToRemove) => modifyPermissions(permissions => {
    permissions[permIdx].purpose.constraints = permissions[permIdx].purpose.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addProhibitionPurposeConstraint = (prohibIdx) => modifyProhibitions(prohibitions => {
    if (!prohibitions[prohibIdx].purpose) return;
    prohibitions[prohibIdx].purpose.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateProhibitionPurposeConstraint = (prohibIdx, index, field, value) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].purpose.constraints[index][field] = value;
  });
  const deleteProhibitionPurposeConstraint = (prohibIdx, indexToRemove) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].purpose.constraints = prohibitions[prohibIdx].purpose.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addTargetConstraint = (permIdx) => modifyPermissions(permissions => {
    if (!permissions[permIdx].target) return;
    permissions[permIdx].target.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateTargetConstraint = (permIdx, index, field, value) => modifyPermissions(permissions => {
    permissions[permIdx].target.constraints[index][field] = value;
  });
  const deleteTargetConstraint = (permIdx, indexToRemove) => modifyPermissions(permissions => {
    permissions[permIdx].target.constraints = permissions[permIdx].target.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addProhibitionTargetConstraint = (prohibIdx) => modifyProhibitions(prohibitions => {
    if (!prohibitions[prohibIdx].target) return;
    prohibitions[prohibIdx].target.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateProhibitionTargetConstraint = (prohibIdx, index, field, value) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].target.constraints[index][field] = value;
  });
  const deleteProhibitionTargetConstraint = (prohibIdx, indexToRemove) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].target.constraints = prohibitions[prohibIdx].target.constraints.filter((_, idx) => idx !== indexToRemove);
  });


  // Assigner Block & Constraint Handlers
  const addAssignerBlock = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].assigner = { type: 'Legal Entity', constraints: [] };
  });
  const removeAssignerBlock = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].assigner = null;
  });

  const addProhibitionAssignerBlock = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].assigner = { type: 'Legal Entity', constraints: [] };
  });
  const removeProhibitionAssignerBlock = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].assigner = null;
  });

  // Actor (Assignee) Block & Constraint Handlers
  const addActorBlock = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].actor = { type: 'Legal Entity', constraints: [] };
  });
  const removeActorBlock = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].actor = null;
  });

  const addProhibitionActorBlock = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].actor = { type: 'Legal Entity', constraints: [] };
  });
  const removeProhibitionActorBlock = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].actor = null;
  });

  // Purpose Block & Constraint/Refinement Handlers
  const addPurposeBlock = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].purpose = { name: '', constraints: [] };
  });
  const removePurposeBlock = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].purpose = null;
  });

  const addProhibitionPurposeBlock = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].purpose = { name: '', constraints: [] };
  });
  const removeProhibitionPurposeBlock = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].purpose = null;
  });

  // Target Asset Block & Constraint Handlers
  const addTargetBlock = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].target = { name: '', constraints: [] };
  });
  const removeTargetBlock = (permIdx) => modifyPermissions(permissions => {
    permissions[permIdx].target = null;
  });

  const addProhibitionTargetBlock = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].target = { name: '', constraints: [] };
  });
  const removeProhibitionTargetBlock = (prohibIdx) => modifyProhibitions(prohibitions => {
    prohibitions[prohibIdx].target = null;
  });

  const handleAddActionVocab = () => {
    const name = prompt("Action Name:");
    const desc = prompt("Descriptive Text:");
    const defBy = prompt("Defined By URI:");
    const label = prompt("Action Label:");
    const inclusion = prompt("Action Inclusion URI:");

    if (name && defBy && label && inclusion && desc) {
      const newTtl = `\n\n:${name} a odrl:Action , skos:Concept ;\nrdfs:isDefinedBy <${defBy}> ;\nrdfs:label "${label}"@en ;\nodrl:includedIn <${inclusion}> ;\nskos:definition "${desc}"@en .`;
      setVocabOutput(prev => prev + newTtl);
    }
  };

  const activePermission = activePermissionIdx.type === 'permission' 
    ? (policy.permissions && policy.permissions[activePermissionIdx.idx]) 
    : null;

  const activeProhibition = activePermissionIdx.type === 'prohibition' 
    ? (policy.prohibitions && policy.prohibitions[activePermissionIdx.idx]) 
    : null;
	
  const activeObligation = activePermissionIdx.type === 'obligation' 
    ? (policy.obligations && policy.obligations[activePermissionIdx.idx]) 
    : null;

  const hasGlobalTargets = policy.targets && policy.targets.length > 0 && policy.targets.some(t => t.trim() !== '');
  
  // ADDING OBLIGATION ELEMENTS HERE [TIDY IN FUTURE]
  
  // Obligation Block Handlers
  const addObligationBlock = () => {
    const hasGlobalTargets = policy.targets && policy.targets.length > 0 && policy.targets.some(t => t.trim() !== '');
    const newObligation = {
	  uid: null, // Initialized as null
      action: { name: '', constraints: [] },
      assigner: null, actor: null,
      purpose: null,
      target: hasGlobalTargets ? null : { name: '', constraints: [] },
      constraints: [],
	  duties: []
    };
    const obligations = [...(policy.obligations || []), newObligation];
    setPolicy({ ...policy, obligations });
    setActivePermissionIdx({ type: 'obligation', idx: obligations.length - 1 });
  };

  const removeObligationBlock = (oblIdx) => {
    const obligations = policy.obligations.filter((_, idx) => idx !== oblIdx);
    setPolicy({ ...policy, obligations });
    if (activePermissionIdx.type === 'obligation' && activePermissionIdx.idx >= obligations.length) {
      if (obligations.length > 0) {
        setActivePermissionIdx({ type: 'obligation', idx: obligations.length - 1 });
      } else if (policy.prohibitions && policy.prohibitions.length > 0) {
        setActivePermissionIdx({ type: 'prohibition', idx: policy.prohibitions.length - 1 });
      } else if (policy.permissions && policy.permissions.length > 0) {
        setActivePermissionIdx({ type: 'permission', idx: policy.permissions.length - 1 });
      }
    }
  };

  const modifyObligations = (updaterFn) => {
    const obligations = [...(policy.obligations || [])];
    updaterFn(obligations);
    setPolicy({ ...policy, obligations });
  };

  // Specific Obligation Constraint & Sub-block Handlers
  const addObligationActionConstraint = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].action.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
  });
  const updateObligationActionConstraint = (oblIdx, index, field, value) => modifyObligations(obligations => {
    obligations[oblIdx].action.constraints[index][field] = value;
  });
  const deleteObligationActionConstraint = (oblIdx, indexToRemove) => modifyObligations(obligations => {
    obligations[oblIdx].action.constraints = obligations[oblIdx].action.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addObligationConstraint = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
  });
  const updateObligationConstraint = (oblIdx, index, field, value) => modifyObligations(obligations => {
    obligations[oblIdx].constraints[index][field] = value;
  });
  const deleteObligationConstraint = (oblIdx, indexToRemove) => modifyObligations(obligations => {
    obligations[oblIdx].constraints = obligations[oblIdx].constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addObligationAssignerConstraint = (oblIdx) => modifyObligations(obligations => {
    if (!obligations[oblIdx].assigner) return;
    obligations[oblIdx].assigner.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateObligationAssignerConstraint = (oblIdx, index, field, value) => modifyObligations(obligations => {
    obligations[oblIdx].assigner.constraints[index][field] = value;
  });
  const deleteObligationAssignerConstraint = (oblIdx, indexToRemove) => modifyObligations(obligations => {
    obligations[oblIdx].assigner.constraints = obligations[oblIdx].assigner.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addObligationActorConstraint = (oblIdx) => modifyObligations(obligations => {
    if (!obligations[oblIdx].actor) return;
    obligations[oblIdx].actor.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
    });
  const updateObligationActorConstraint = (oblIdx, index, field, value) => modifyObligations(obligations => {
    obligations[oblIdx].actor.constraints[index][field] = value;
  });
  const deleteObligationActorConstraint = (oblIdx, indexToRemove) => modifyObligations(obligations => {
    obligations[oblIdx].actor.constraints = obligations[oblIdx].actor.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addObligationPurposeConstraint = (oblIdx) => modifyObligations(obligations => {
    if (!obligations[oblIdx].purpose) return;
    obligations[oblIdx].purpose.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateObligationPurposeConstraint = (oblIdx, index, field, value) => modifyObligations(obligations => {
    obligations[oblIdx].purpose.constraints[index][field] = value;
  });
  const deleteObligationPurposeConstraint = (oblIdx, indexToRemove) => modifyObligations(obligations => {
    obligations[oblIdx].purpose.constraints = obligations[oblIdx].purpose.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addObligationTargetConstraint = (oblIdx) => modifyObligations(obligations => {
    if (!obligations[oblIdx].target) return;
    obligations[oblIdx].target.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateObligationTargetConstraint = (oblIdx, index, field, value) => modifyObligations(obligations => {
    obligations[oblIdx].target.constraints[index][field] = value;
  });
  const deleteObligationTargetConstraint = (oblIdx, indexToRemove) => modifyObligations(obligations => {
    obligations[oblIdx].target.constraints = obligations[oblIdx].target.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addObligationAssignerBlock = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].assigner = { type: 'Legal Entity', constraints: [] };
  });
  const removeObligationAssignerBlock = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].assigner = null;
  });

  const addObligationActorBlock = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].actor = { type: 'Legal Entity', constraints: [] };
  });
  const removeObligationActorBlock = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].actor = null;
  });

  const addObligationPurposeBlock = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].purpose = { name: '', constraints: [] };
  });
  const removeObligationPurposeBlock = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].purpose = null;
  });

  const addObligationTargetBlock = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].target = { name: '', constraints: [] };
  });
  const removeObligationTargetBlock = (oblIdx) => modifyObligations(obligations => {
    obligations[oblIdx].target = null;
  });
  
  
  // END ADDING OBLIGATION ELEMENTS HERE
  
  
  // Add Duty Handlers HERE
  
  // Unified helper for modifying duties on either permissions or prohibitions
  const modifyDutyRule = (updaterFn) => {
    if (activePermissionIdx.type === 'permission') {
      const permissions = [...(policy.permissions || [])];
      updaterFn(permissions[activePermissionIdx.idx]);
      setPolicy({ ...policy, permissions });
    } else if (activePermissionIdx.type === 'prohibition') {
      const prohibitions = [...(policy.prohibitions || [])];
      updaterFn(prohibitions[activePermissionIdx.idx]);
      setPolicy({ ...policy, prohibitions });
	} else if (activePermissionIdx.type === 'obligation') {
      const obligations = [...(policy.obligations || [])];
      updaterFn(obligations[activePermissionIdx.idx]);
      setPolicy({ ...policy, obligations });
    }
  };

  // Generalized Duty & Consequence Handlers
  const addDutyBlock = () => modifyDutyRule(rule => {
    if (!rule.duties) rule.duties = [];
    rule.duties.push({ action: '', actionObj: { name: '', constraints: [] }, assigner: null, actor: null, constraints: [], consequences: [] });
  });
  const updateDutyAction = (dutyIdx, value) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].action = value;
    if (!rule.duties[dutyIdx].actionObj) {
      rule.duties[dutyIdx].actionObj = { name: value, constraints: [] };
    } else {
      rule.duties[dutyIdx].actionObj.name = value;
    }
  });
  const removeDutyBlock = (dutyIdxToRemove) => modifyDutyRule(rule => {
    rule.duties = rule.duties.filter((_, idx) => idx !== dutyIdxToRemove);
  });

  // Duty Consequences Handlers
  const addDutyConsequence = (dutyIdx) => modifyDutyRule(rule => {
    if (!rule.duties[dutyIdx].consequences) rule.duties[dutyIdx].consequences = [];
    rule.duties[dutyIdx].consequences.push({ action: '', constraints: [] });
  });
  const updateDutyConsequenceAction = (dutyIdx, consIdx, value) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].consequences[consIdx].action = value;
  });
  const removeDutyConsequence = (dutyIdx, consIdxToRemove) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].consequences = rule.duties[dutyIdx].consequences.filter((_, idx) => idx !== consIdxToRemove);
  });
  
  const addDutyConsequenceConstraint = (dutyIdx, consIdx) => modifyDutyRule(rule => {
    if (!rule.duties[dutyIdx].consequences[consIdx].constraints) {
      rule.duties[dutyIdx].consequences[consIdx].constraints = [];
    }
    rule.duties[dutyIdx].consequences[consIdx].constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
  });
  const updateDutyConsequenceConstraint = (dutyIdx, consIdx, constraintIdx, field, value) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].consequences[consIdx].constraints[constraintIdx][field] = value;
  });
  const deleteDutyConsequenceConstraint = (dutyIdx, consIdx, constraintIdxToRemove) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].consequences[consIdx].constraints = rule.duties[dutyIdx].consequences[consIdx].constraints.filter((_, idx) => idx !== constraintIdxToRemove);
  });

  // Duty Assigner / Actor Sub-handlers
  const addDutyAssigner = (dutyIdx) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].assigner = { type: 'Legal Entity', constraints: [] };
  });
  const removeDutyAssigner = (dutyIdx) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].assigner = null;
  });

  const addDutyActor = (dutyIdx) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].actor = { type: 'Legal Entity', constraints: [] };
  });
  const removeDutyActor = (dutyIdx) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].actor = null;
  });

  const addDutyActionConstraint = (dutyIdx) => modifyDutyRule(rule => {
    if (!rule.duties[dutyIdx].actionObj) {
      rule.duties[dutyIdx].actionObj = { name: rule.duties[dutyIdx].action || '', constraints: [] };
    }
    rule.duties[dutyIdx].actionObj.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
  });
  const updateDutyActionConstraint = (dutyIdx, index, field, value) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].actionObj.constraints[index][field] = value;
  });
  const deleteDutyActionConstraint = (dutyIdx, indexToRemove) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].actionObj.constraints = rule.duties[dutyIdx].actionObj.constraints.filter((_, idx) => idx !== indexToRemove);
  });

  const addDutyConstraint = (dutyIdx) => modifyDutyRule(rule => {
    if (!rule.duties[dutyIdx].constraints) rule.duties[dutyIdx].constraints = [];
    rule.duties[dutyIdx].constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '>', rightOperand: '' });
  });
  const updateDutyConstraint = (dutyIdx, constraintIdx, field, value) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].constraints[constraintIdx][field] = value;
  });
  const deleteDutyConstraint = (dutyIdx, constraintIdxToRemove) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].constraints = rule.duties[dutyIdx].constraints.filter((_, idx) => idx !== constraintIdxToRemove);
  });

  const addDutyAssignerConstraint = (dutyIdx) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].assigner.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateDutyAssignerConstraint = (dutyIdx, idx, field, value) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].assigner.constraints[idx][field] = value;
  });
  const deleteDutyAssignerConstraint = (dutyIdx, idxToRemove) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].assigner.constraints = rule.duties[dutyIdx].assigner.constraints.filter((_, idx) => idx !== idxToRemove);
  });

  const addDutyActorConstraint = (dutyIdx) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].actor.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
  });
  const updateDutyActorConstraint = (dutyIdx, idx, field, value) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].actor.constraints[idx][field] = value;
  });
  const deleteDutyActorConstraint = (dutyIdx, idxToRemove) => modifyDutyRule(rule => {
    rule.duties[dutyIdx].actor.constraints = rule.duties[dutyIdx].actor.constraints.filter((_, idx) => idx !== idxToRemove);
  });
  
  
  
  // Rule UID Handlers
  const addRuleUid = () => {
    //const listKey = isPerm ? 'permissions' : isProhib ? 'prohibitions' : 'obligations';
    // Note: ensure 'isPerm', 'isProhib', 'isOblig' or equivalent logic is accessible, 
    // or use activePermissionIdx.type to determine listKey:
    const activeType = activePermissionIdx.type;
    const keyMap = { permission: 'permissions', prohibition: 'prohibitions', obligation: 'obligations' };
    const targetKey = keyMap[activeType];
    const items = [...policy[targetKey]];
    items[activePermissionIdx.idx].uid = '';
    setPolicy({ ...policy, [targetKey]: items });
  };

  const updateRuleUid = (value) => {
    const activeType = activePermissionIdx.type;
    const keyMap = { permission: 'permissions', prohibition: 'prohibitions', obligation: 'obligations' };
    const targetKey = keyMap[activeType];
    const items = [...policy[targetKey]];
    items[activePermissionIdx.idx].uid = value;
    setPolicy({ ...policy, [targetKey]: items });
  };

  const removeRuleUid = () => {
    const activeType = activePermissionIdx.type;
    const keyMap = { permission: 'permissions', prohibition: 'prohibitions', obligation: 'obligations' };
    const targetKey = keyMap[activeType];
    const items = [...policy[targetKey]];
    items[activePermissionIdx.idx].uid = null;
    setPolicy({ ...policy, [targetKey]: items });
  };

  return (
    <div className="flex flex-col h-screen bg-slate-100 font-sans text-sm text-slate-800 relative w-full min-w-[1280px]">
      
      {/* Header Toolbar */}
      <header className="bg-slate-600 text-white pt-1.5 pb-1 px-2 flex justify-between items-end shadow-xs z-30">
        <div className="flex flex-col items-start leading-none">
          <h1 className="font-bold tracking-wide text-[8px] uppercase mb-1">ODRL Editor</h1>
          <div className="flex gap-2 items-center text-slate-800">
            <div className="relative inline-block text-left text-slate-800">
              <button 
                onClick={() => { fetchServerFiles(); setShowDropdown(!showDropdown); }}
                className="bg-slate-700 hover:bg-slate-500 text-white font-semibold text-xs py-1 px-2.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-400 shadow-xs leading-tight"
              >
                📂 Load Policy from Server
              </button>
              
              {showDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                  <div className="absolute left-0 mt-1 w-64 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 divide-y divide-slate-100 focus:outline-none z-50 animate-in fade-in duration-100 text-slate-800">
                    <div className="p-2 bg-slate-50 text-[11px] font-bold tracking-wider uppercase text-slate-400 border-b">Server Storage (POLICIES/)</div>
                    <div className="max-h-60 overflow-y-auto p-1 flex flex-col gap-0.5">
                      {serverFiles.length === 0 ? (
                        <span className="block px-3 py-2 text-xs italic text-slate-400 text-center">No policy records found.</span>
                      ) : (
                        serverFiles.map((file) => (
                          <button key={file} onClick={() => handleLoadServerPolicy(file)} className="w-full text-left px-3 py-2 text-xs rounded hover:bg-blue-50 hover:text-blue-700 font-mono transition-colors truncate" title={file}>📄 {file}</button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <button onClick={() => setShowVocabModal(true)} className="bg-slate-700 hover:bg-slate-500 text-white font-semibold text-xs py-1 px-2.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-400 shadow-xs leading-tight">
              ➕ Add Simple Vocabulary
            </button>

            <button onClick={handleDownloadPolicy} className="bg-slate-700 hover:bg-slate-500 text-white font-semibold text-xs py-1 px-2.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-400 shadow-xs leading-tight">
              💾 Download Current Policy
            </button>

            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleUploadPolicyFile} 
              accept=".json" 
              className="hidden" 
            />
            <button onClick={() => fileInputRef.current?.click()} className="bg-slate-700 hover:bg-slate-500 text-white font-semibold text-xs py-1 px-2.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-400 shadow-xs leading-tight">
              📤 Upload Policy File
            </button>
          </div>
        </div>
        <span className="text-[10px] bg-slate-700/60 px-1.5 py-0.5 rounded text-slate-200 font-mono leading-tight">{policy.uid || 'New Unsaved Policy'}</span>
      </header>

      {/* Main Workspace */}
      <main className="flex flex-1 overflow-hidden p-4 gap-4 relative">
        
        {/* Left Panel: Metadata & SHACL */}
        <div className="w-1/4 flex flex-col gap-4 overflow-hidden h-full">
          <section className="bg-white rounded-lg p-4 shadow flex flex-col gap-4 border border-slate-200 overflow-y-auto flex-1 min-h-0">
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-500 border-b pb-2">Policy Metadata</h2>
            
            <div>
              <label className="block font-semibold mb-1">Policy Type</label>
              <select className="w-full border p-2 rounded bg-white font-medium" value={policy.type} onChange={(e) => setPolicy({...policy, type: e.target.value})}>
                <option value="Agreement">Agreement</option>
                <option value="Offer">Offer</option>
                <option value="Set">Set</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Policy UID (URI)</label>
              <input type="text" className="w-full border p-2 rounded" placeholder="e.g. urn:policy:v1" value={policy.uid || ''} onChange={(e) => setPolicy({...policy, uid: e.target.value})} />
            </div>

            <div>
              <label className="block font-semibold mb-1">Profile</label>
              <input type="text" className="w-full border p-2 rounded" placeholder="e.g. Standard" value={policy.profile || ''} onChange={(e) => setPolicy({...policy, profile: e.target.value})} />
            </div>

            {/* Assigner Field / Add Button Logic */}
            {policy.type === 'Agreement' ? (
              <div>
                <label className="block font-semibold mb-1">Assigner</label>
                <input type="text" className="w-full border p-2 rounded bg-white" placeholder="Assigner URI or ID" value={policy.assigner || ''} onChange={(e) => setPolicy({...policy, assigner: e.target.value})} />
              </div>
            ) : policy.type === 'Offer' ? (
              <div>
                <label className="block font-semibold mb-1">Assigner</label>
                <input type="text" className="w-full border p-2 rounded bg-white" placeholder="Assigner URI or ID" value={policy.assigner || ''} onChange={(e) => setPolicy({...policy, assigner: e.target.value})} />
              </div>
            ) : policy.type === 'Set' ? (
              policy.assigner !== null && policy.assigner !== undefined ? (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="font-semibold">Assigner</label>
                    <button onClick={() => setPolicy({ ...policy, assigner: null })} className="text-rose-500 hover:text-rose-700 font-bold text-xs px-1">✕</button>
                  </div>
                  <input type="text" className="w-full border p-2 rounded bg-white" placeholder="Assigner URI or ID" value={policy.assigner || ''} onChange={(e) => setPolicy({...policy, assigner: e.target.value})} />
                </div>
              ) : (
                <button onClick={() => setPolicy({ ...policy, assigner: '' })} className="text-xs bg-slate-100 border border-slate-300 px-3 py-2 rounded text-slate-700 font-medium hover:bg-slate-200 text-left transition-colors">+ Add Assigner</button>
              )
            ) : null}

            {/* Assignee Field / Add Button Logic */}
            {policy.type === 'Agreement' ? (
              <div>
                <label className="block font-semibold mb-1">Assignee</label>
                <input type="text" className="w-full border p-2 rounded bg-white" placeholder="Assignee URI or ID" value={policy.assignee || ''} onChange={(e) => setPolicy({...policy, assignee: e.target.value})} />
              </div>
            ) : policy.type === 'Offer' ? (
              policy.assignee !== null && policy.assignee !== undefined ? (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="font-semibold">Assignee</label>
                    <button onClick={() => setPolicy({ ...policy, assignee: null })} className="text-rose-500 hover:text-rose-700 font-bold text-xs px-1">✕</button>
                  </div>
                  <input type="text" className="w-full border p-2 rounded bg-white" placeholder="Assignee URI or ID" value={policy.assignee || ''} onChange={(e) => setPolicy({...policy, assignee: e.target.value})} />
                </div>
              ) : (
                <button onClick={() => setPolicy({ ...policy, assignee: '' })} className="text-xs bg-slate-100 border border-slate-300 px-3 py-2 rounded text-slate-700 font-medium hover:bg-slate-200 text-left transition-colors">+ Add Assignee</button>
              )
            ) : policy.type === 'Set' ? (
              policy.assignee !== null && policy.assignee !== undefined ? (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="font-semibold">Assignee</label>
                    <button onClick={() => setPolicy({ ...policy, assignee: null })} className="text-rose-500 hover:text-rose-700 font-bold text-xs px-1">✕</button>
                  </div>
                  <input type="text" className="w-full border p-2 rounded bg-white" placeholder="Assignee URI or ID" value={policy.assignee || ''} onChange={(e) => setPolicy({...policy, assignee: e.target.value})} />
                </div>
              ) : (
                <button onClick={() => setPolicy({ ...policy, assignee: '' })} className="text-xs bg-slate-100 border border-slate-300 px-3 py-2 rounded text-slate-700 font-medium hover:bg-slate-200 text-left transition-colors">+ Add Assignee</button>
              )
            ) : null}

            {/* Conflict Strategy */}
            {policy.conflict !== null && policy.conflict !== undefined ? (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-semibold">Conflict Strategy</label>
                  <button onClick={() => setPolicy({ ...policy, conflict: null })} className="text-rose-500 hover:text-rose-700 font-bold text-xs px-1">✕</button>
                </div>
                <select className="w-full border p-2 rounded bg-white font-medium" value={policy.conflict || 'perm'} onChange={(e) => setPolicy({ ...policy, conflict: e.target.value })}>
                  <option value="perm">perm</option>
                  <option value="prohibit">prohibit</option>
                  <option value="invalid">invalid</option>
                </select>
              </div>
            ) : (
              <button onClick={() => setPolicy({ ...policy, conflict: 'perm' })} className="text-xs bg-slate-100 border border-slate-300 px-3 py-2 rounded text-slate-700 font-medium hover:bg-slate-200 text-left transition-colors">+ Add Conflict Strategy</button>
            )}

            {/* Targets */}
            <div className="flex flex-col gap-2 mt-2 w-full overflow-visible">
              <div className="flex justify-between items-center">
                <label className="font-semibold">Policy Targets</label>
                <button type="button" onClick={addMetadataTarget} className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded font-medium hover:bg-blue-100 transition-colors">+ Add Target</button>
              </div>

              {policy.targets?.length > 0 ? (
                <div className="p-2 bg-slate-50 rounded border border-slate-200 flex flex-col gap-2 w-full overflow-visible">
                  {policy.targets.map((tgt, idx) => (
                    <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                      <input type="text" className="border p-1.5 rounded text-xs bg-white font-mono min-w-0 flex-1" placeholder="Target asset URI / filename" value={tgt} onChange={(e) => updateMetadataTarget(idx, e.target.value)} />
                      <button type="button" onClick={() => removeMetadataTarget(idx)} className="text-rose-500 hover:text-rose-700 font-bold text-xs px-1 shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 italic p-2 bg-slate-50 border border-dashed rounded text-center w-full">No targets configured.</div>
              )}
            </div>
          </section>

          {/* SHACL Inspector */}
          <section className="bg-white rounded-lg p-4 shadow flex flex-col gap-3 border border-slate-200 max-h-[40%] overflow-y-auto">
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-500 border-b pb-2">SHACL Inspector</h2>
            <button onClick={handleValidateShacl} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 rounded shadow-sm text-xs transition-colors cursor-pointer">Perform SHACL verification</button>
            {shaclResult && (
              <div className={`p-2.5 rounded text-xs border flex flex-col ${shaclResult.loading ? 'bg-slate-50 border-slate-200 text-slate-600' : shaclResult.valid ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <span>{shaclResult.loading ? '⏳' : shaclResult.valid ? '✅ Conforms' : '❌ Violation'}</span>
                  <span className="truncate">{shaclResult.message}</span>
                </div>
                {shaclResult.report && (
                  <button onClick={() => setShowShaclReport(true)} className="mt-2 text-[10px] font-bold uppercase tracking-wide bg-white border border-slate-300 shadow-sm px-2 py-1.5 rounded hover:bg-slate-100 transition-colors w-full text-slate-700">View Report</button>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Center Panel: Rule Builder & Rule Tabs */}
        <div className="w-1/2 flex flex-col gap-4 overflow-hidden h-full">
          <section className="bg-white rounded-lg p-4 shadow overflow-y-auto border border-slate-200 flex-1 flex flex-col gap-4 relative">
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-500 border-b pb-2">Rule Builder</h2>
            
            {/* Unified Rule Builder Panel (Permission / Prohibition / Obligation) */}
              {(() => {
                const activeRule = activePermission || activeProhibition || activeObligation;
                if (!activeRule) {
                  return (
                    <div className="text-slate-400 text-xs italic text-center p-8 bg-slate-50 border border-dashed border-slate-300 rounded-lg">
                      No active rules on the canvas. Click "+ Add Permission" or "+ Add Prohibition" or "+ Add Obligation" inside the tabs header to append a new workspace rule or load an existing file.
                    </div>
                  );
                }

                const isPerm = !!activePermission;
                const isProhib = !!activeProhibition;
                const isOblig = !!activeObligation;

                const idxObj = activePermissionIdx;
                const ruleTypeLabel = isPerm ? 'PERMISSION' : isProhib ? 'PROHIBITION' : 'OBLIGATION';
                const badgeColorClass = isPerm ? 'text-blue-700' : isProhib ? 'text-rose-700' : 'text-amber-700';
                const borderAccentClass = isPerm ? 'border-blue-400' : isProhib ? 'border-rose-400' : 'border-amber-400';
                const actionLabel = isPerm ? 'Action' : isProhib ? 'Prohibited Action' : 'Obligation Action Instruction';

                // Handlers mapped dynamically based on active rule type prefix
                const removeBlock = isPerm ? () => removePermissionBlock(idxObj.idx) : isProhib ? () => removeProhibitionBlock(idxObj.idx) : () => removeObligationBlock(idxObj.idx);
    
                const addConstraint = isPerm ? () => addPermissionConstraint(idxObj.idx) : isProhib ? () => addProhibitionConstraint(idxObj.idx) : () => addObligationConstraint(idxObj.idx);
                const updateConstraint = isPerm ? updatePermissionConstraint : isProhib ? updateProhibitionConstraint : updateObligationConstraint;
                const deleteConstraint = isPerm ? deletePermissionConstraint : isProhib ? deleteProhibitionConstraint : deleteObligationConstraint;

                const addAssigner = isPerm ? () => addAssignerBlock(idxObj.idx) : isProhib ? () => addProhibitionAssignerBlock(idxObj.idx) : () => addObligationAssignerBlock(idxObj.idx);
                const removeAssigner = isPerm ? () => removeAssignerBlock(idxObj.idx) : isProhib ? () => removeProhibitionAssignerBlock(idxObj.idx) : () => removeObligationAssignerBlock(idxObj.idx);
                const addAssignerConstraintFn = isPerm ? () => addAssignerConstraint(idxObj.idx) : isProhib ? () => addProhibitionAssignerConstraint(idxObj.idx) : () => addObligationAssignerConstraint(idxObj.idx);
                const updateAssignerConstraintFn = isPerm ? updateAssignerConstraint : isProhib ? updateProhibitionAssignerConstraint : updateObligationAssignerConstraint;
                const deleteAssignerConstraintFn = isPerm ? deleteAssignerConstraint : isProhib ? deleteProhibitionAssignerConstraint : deleteObligationAssignerConstraint;

                const addActor = isPerm ? () => addActorBlock(idxObj.idx) : isProhib ? () => addProhibitionActorBlock(idxObj.idx) : () => addObligationActorBlock(idxObj.idx);
                const removeActor = isPerm ? () => removeActorBlock(idxObj.idx) : isProhib ? () => removeProhibitionActorBlock(idxObj.idx) : () => removeObligationActorBlock(idxObj.idx);
                const addActorConstraintFn = isPerm ? () => addActorConstraint(idxObj.idx) : isProhib ? () => addProhibitionActorConstraint(idxObj.idx) : () => addObligationActorConstraint(idxObj.idx);
                const updateActorConstraintFn = isPerm ? updateActorConstraint : isProhib ? updateProhibitionActorConstraint : updateObligationActorConstraint;
                const deleteActorConstraintFn = isPerm ? deleteActorConstraint : isProhib ? deleteProhibitionActorConstraint : deleteObligationActorConstraint;

                const addPurpose = isPerm ? () => addPurposeBlock(idxObj.idx) : isProhib ? () => addProhibitionPurposeBlock(idxObj.idx) : () => addObligationPurposeBlock(idxObj.idx);
                const removePurpose = isPerm ? () => removePurposeBlock(idxObj.idx) : isProhib ? () => removeProhibitionPurposeBlock(idxObj.idx) : () => removeObligationPurposeBlock(idxObj.idx);
                const addPurposeConstraintFn = isPerm ? () => addPurposeConstraint(idxObj.idx) : isProhib ? () => addProhibitionPurposeConstraint(idxObj.idx) : () => addObligationPurposeConstraint(idxObj.idx);
                const updatePurposeConstraintFn = isPerm ? updatePurposeConstraint : isProhib ? updateProhibitionPurposeConstraint : updateObligationPurposeConstraint;
                const deletePurposeConstraintFn = isPerm ? deletePurposeConstraint : isProhib ? deleteProhibitionPurposeConstraint : deleteObligationPurposeConstraint;

                const addTarget = isPerm ? () => addTargetBlock(idxObj.idx) : isProhib ? () => addProhibitionTargetBlock(idxObj.idx) : () => addObligationTargetBlock(idxObj.idx);
                const removeTarget = isPerm ? () => removeTargetBlock(idxObj.idx) : isProhib ? () => removeProhibitionTargetBlock(idxObj.idx) : () => removeObligationTargetBlock(idxObj.idx);
                const addTargetConstraintFn = isPerm ? () => addTargetConstraint(idxObj.idx) : isProhib ? () => addProhibitionTargetConstraint(idxObj.idx) : () => addObligationTargetConstraint(idxObj.idx);
                const updateTargetConstraintFn = isPerm ? updateTargetConstraint : isProhib ? updateProhibitionTargetConstraint : updateObligationTargetConstraint;
                const deleteTargetConstraintFn = isPerm ? deleteTargetConstraint : isProhib ? deleteProhibitionTargetConstraint : deleteObligationTargetConstraint;

                const addActionConstraintFn = isPerm ? () => addActionConstraint(idxObj.idx) : isProhib ? () => addProhibitionActionConstraint(idxObj.idx) : () => addObligationActionConstraint(idxObj.idx);
                const updateActionConstraintFn = isPerm ? updateActionConstraint : isProhib ? updateProhibitionActionConstraint : updateObligationActionConstraint;
                const deleteActionConstraintFn = isPerm ? deleteActionConstraint : isProhib ? deleteProhibitionActionConstraint : deleteObligationActionConstraint;

                return (
                  <div className="border border-slate-300 rounded-lg p-4 bg-slate-50 flex flex-col gap-4 relative">
                    <button onClick={removeBlock} title="Delete this rule completely" className="absolute top-2 right-2 text-rose-500 hover:text-white hover:bg-rose-500 border border-transparent hover:border-rose-600 font-bold text-xs w-6 h-6 flex items-center justify-center rounded transition-all cursor-pointer shadow-xs z-10">✕</button>

                    <div className="flex justify-between items-start border-b pb-2 gap-4">
                      <div className="flex flex-col gap-1.5 flex-1 pr-6">
                        <span className={`font-bold ${badgeColorClass}`}>🔒 EDITING: {ruleTypeLabel} #{idxObj.idx + 1}</span>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={addConstraint} className="text-xs bg-white border border-slate-300 px-2 py-1 rounded hover:bg-slate-100 transition-colors cursor-pointer text-slate-700 font-medium">+ Add Rule Constraint</button>
                          {!activeRule.assigner && <button onClick={addAssigner} className="text-xs bg-slate-600 text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Assigner</button>}
                          {!activeRule.actor && <button onClick={addActor} className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Assignee</button>}
                          {!activeRule.purpose && <button onClick={addPurpose} className="text-xs bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Purpose</button>}
                          {hasGlobalTargets && !activeRule.target && <button onClick={addTarget} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Target</button>}
                          {(isPerm || isProhib || isOblig) && (
                            <button 
                              onClick={() => addDutyBlock()} 
                              className="text-xs bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700 transition-colors cursor-pointer font-medium shadow-sm"
                            >
                              {isProhib ? '+ Add Remedy' : isOblig ? '+ Add Consequence' : '+ Add Duty'}
                            </button>
                          )}
						  {(activeRule.uid === null || activeRule.uid === undefined) && (
                            <button onClick={addRuleUid} className="text-xs bg-slate-700 text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors cursor-pointer font-medium shadow-sm">
                              + UID
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
					
					{activeRule.uid !== null && activeRule.uid !== undefined && (
                      <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase text-slate-600">Rule UID</label>
                          <button type="button" onClick={removeRuleUid} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                        </div>
                        <input 
                          type="text" 
                          placeholder="e.g. urn:rule:permission-1" 
                          className="w-full border p-1.5 rounded text-xs bg-white font-mono" 
                          value={activeRule.uid} 
                          onChange={(e) => updateRuleUid(e.target.value)} 
                        />
                      </div>
                    )}

                    {/* Action Block */}
                    <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold uppercase text-blue-600">{actionLabel}</label>
                        <button onClick={addActionConstraintFn} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors cursor-pointer text-slate-600 font-medium">+ Add Action Refinement</button>
                      </div>
          
                      <select className="w-full border p-1.5 rounded text-xs bg-white font-medium font-mono truncate" value={activeRule.action?.name || ''} onChange={(e) => {
                        const listKey = isPerm ? 'permissions' : isProhib ? 'prohibitions' : 'obligations';
                        const items = [...policy[listKey]];
                        items[idxObj.idx].action.name = e.target.value;
                        setPolicy({...policy, [listKey]: items});
                      }}>
                        <option value="">-- Select Action --</option>
                        {dbActions.map(([path, uri, definition]) => (
                          <option key={uri} value={uri} title={definition}>{path}</option>
                        ))}
                      </select>

                      {activeRule.action?.constraints?.length > 0 && (
                        <div className="flex flex-col gap-2 pl-3 border-l-2 border-blue-400 mt-1 w-full min-w-0">
                          {activeRule.action.constraints.map((constraint, idx) => (
                            <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                              <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                              {renderLeftOperandSelect(constraint.leftOperand, (e) => updateActionConstraintFn(idxObj.idx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                              {renderOperatorSelect(constraint.operator, (e) => updateActionConstraintFn(idxObj.idx, idx, 'operator', e.target.value), dbOperators)}
                              {renderRightOperandInput(constraint.rightOperand, (e) => updateActionConstraintFn(idxObj.idx, idx, 'rightOperand', e.target.value))}
                              <button type="button" onClick={() => deleteActionConstraintFn(idxObj.idx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Assigner Block */}
                    {activeRule.assigner && (
                      <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase text-slate-600">Assigner</label>
                          <div className="flex items-center gap-2">
                            <button onClick={addAssignerConstraintFn} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors text-slate-600 font-medium">+ Add Assigner Constraint</button>
                            <button type="button" onClick={removeAssigner} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                          </div>
                        </div>
                        <select className="w-full border p-1.5 rounded text-xs bg-white font-medium" value={activeRule.assigner.type} onChange={(e) => {
                          const listKey = isPerm ? 'permissions' : isProhib ? 'prohibitions' : 'obligations';
                          const items = [...policy[listKey]];
                          items[idxObj.idx].assigner.type = e.target.value;
                          setPolicy({...policy, [listKey]: items});
                        }}>
                          <option value="Legal Entity">Legal Entity</option>
                          <option value="Natural Person">Natural Person</option>
                          <option value="Organisational Unit">Organisational Unit</option>
                        </select>

                        {activeRule.assigner.constraints?.length > 0 && (
                          <div className="flex flex-col gap-2 pl-3 border-l-2 border-slate-400 mt-1 w-full min-w-0">
                            {activeRule.assigner.constraints.map((constraint, idx) => (
                              <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                                <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                                {renderLeftOperandSelect(constraint.leftOperand, (e) => updateAssignerConstraintFn(idxObj.idx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                {renderOperatorSelect(constraint.operator, (e) => updateAssignerConstraintFn(idxObj.idx, idx, 'operator', e.target.value), dbOperators)}
                                {renderRightOperandInput(constraint.rightOperand, (e) => updateAssignerConstraintFn(idxObj.idx, idx, 'rightOperand', e.target.value))}
                                <button type="button" onClick={() => deleteAssignerConstraintFn(idxObj.idx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actor / Assignee Block */}
                    {activeRule.actor && (
                      <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase text-indigo-600">Assignee</label>
                          <div className="flex items-center gap-2">
                            <button onClick={addActorConstraintFn} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors text-slate-600 font-medium">+ Add Assignee Constraint</button>
                            <button type="button" onClick={removeActor} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                          </div>
                        </div>
                        <select className="w-full border p-1.5 rounded text-xs bg-white font-medium" value={activeRule.actor.type} onChange={(e) => {
                          const listKey = isPerm ? 'permissions' : isProhib ? 'prohibitions' : 'obligations';
                          const items = [...policy[listKey]];
                          items[idxObj.idx].actor.type = e.target.value;
                          setPolicy({...policy, [listKey]: items});
                        }}>
                          <option value="Legal Entity">Legal Entity</option>
                          <option value="Natural Person">Natural Person</option>
                          <option value="Organisational Unit">Organisational Unit</option>
                        </select>

                        {activeRule.actor.constraints?.length > 0 && (
                          <div className="flex flex-col gap-2 pl-3 border-l-2 border-indigo-400 mt-1 w-full min-w-0">
                           {activeRule.actor.constraints.map((constraint, idx) => (
                              <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                                <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                                {renderLeftOperandSelect(constraint.leftOperand, (e) => updateActorConstraintFn(idxObj.idx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                {renderOperatorSelect(constraint.operator, (e) => updateActorConstraintFn(idxObj.idx, idx, 'operator', e.target.value), dbOperators)}
                                {renderRightOperandInput(constraint.rightOperand, (e) => updateActorConstraintFn(idxObj.idx, idx, 'rightOperand', e.target.value))}
                                <button type="button" onClick={() => deleteActorConstraintFn(idxObj.idx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Purpose Block */}
                    {activeRule.purpose && (
                      <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase text-purple-600">Purpose</label>
                          <div className="flex items-center gap-2">
                            <button onClick={addPurposeConstraintFn} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors text-slate-600 font-medium">+ Add Refinement</button>
                            <button type="button" onClick={removePurpose} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                          </div>
                        </div>
            
                        <select className="w-full border p-1.5 rounded text-xs bg-white font-medium font-mono truncate" value={activeRule.purpose?.name || ''} onChange={(e) => {
                          const listKey = isPerm ? 'permissions' : isProhib ? 'prohibitions' : 'obligations';
                          const items = [...policy[listKey]];
                          items[idxObj.idx].purpose.name = e.target.value;
                          setPolicy({...policy, [listKey]: items});
                        }}>
                          <option value="">-- Select Purpose --</option>
                          {(dbPurposes || []).map(([path, uri, definition]) => (
                            <option key={uri} value={uri} title={definition}>{path}</option>
                          ))}
                        </select>

                        {activeRule.purpose?.constraints?.length > 0 && (
                          <div className="flex flex-col gap-2 pl-3 border-l-2 border-purple-400 mt-1 w-full min-w-0">
                            {activeRule.purpose.constraints.map((constraint, idx) => (
                              <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                                <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                                {renderLeftOperandSelect(constraint.leftOperand, (e) => updatePurposeConstraintFn(idxObj.idx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                {renderOperatorSelect(constraint.operator, (e) => updatePurposeConstraintFn(idxObj.idx, idx, 'operator', e.target.value), dbOperators)}
                                {renderRightOperandInput(constraint.rightOperand, (e) => updatePurposeConstraintFn(idxObj.idx, idx, 'rightOperand', e.target.value))}
                                <button type="button" onClick={() => deletePurposeConstraintFn(idxObj.idx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Target Asset Block */}
                    {activeRule.target && (
                      <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase text-emerald-600">Target Asset</label>
                          <div className="flex items-center gap-2">
                            <button onClick={addTargetConstraintFn} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors text-slate-600 font-medium">+ Add Target Constraint</button>
                            {hasGlobalTargets && (
                              <button type="button" onClick={removeTarget} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                            )}
                          </div>
                        </div>
                        <input type="text" placeholder="Target name or URI" className="w-full border p-1.5 rounded text-xs bg-white font-mono" value={activeRule.target?.name || ''} onChange={(e) => {
                          const listKey = isPerm ? 'permissions' : isProhib ? 'prohibitions' : 'obligations';
                          const items = [...policy[listKey]];
                          if (!items[idxObj.idx].target) items[idxObj.idx].target = { name: '', constraints: [] };
                          items[idxObj.idx].target.name = e.target.value;
                          setPolicy({...policy, [listKey]: items});
                        }}/>

                        {activeRule.target?.constraints?.length > 0 && (
                          <div className="flex flex-col gap-2 pl-3 border-l-2 border-emerald-400 mt-1 w-full min-w-0">
                            {activeRule.target.constraints.map((constraint, idx) => (
                              <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                                <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                                {renderLeftOperandSelect(constraint.leftOperand, (e) => updateTargetConstraintFn(idxObj.idx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                {renderOperatorSelect(constraint.operator, (e) => updateTargetConstraintFn(idxObj.idx, idx, 'operator', e.target.value), dbOperators)}
                                {renderRightOperandInput(constraint.rightOperand, (e) => updateTargetConstraintFn(idxObj.idx, idx, 'rightOperand', e.target.value))}
                                <button type="button" onClick={() => deleteTargetConstraintFn(idxObj.idx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Global Rule Constraints */}
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Global Rule Constraints</label>
                      <div className={`flex flex-col gap-2 pl-3 border-l-2 ${borderAccentClass} w-full min-w-0`}>
                        {activeRule.constraints?.map((constraint, idx) => (
                          <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                            <span className="text-xs text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                            {renderLeftOperandSelect(constraint.leftOperand, (e) => updateConstraint(idxObj.idx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                            {renderOperatorSelect(constraint.operator, (e) => updateConstraint(idxObj.idx, idx, 'operator', e.target.value), dbOperators)}
                            {renderRightOperandInput(constraint.rightOperand, (e) => updateConstraint(idxObj.idx, idx, 'rightOperand', e.target.value))}
                            <button type="button" onClick={() => deleteConstraint(idxObj.idx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Duties Block */}
                    {(isPerm || isProhib || isOblig) && activeRule.duties && activeRule.duties.map((dutyBlock, dutyIdx) => (
                      <div key={dutyIdx} className="border border-amber-200 bg-amber-50/50 rounded-lg p-4 flex flex-col gap-3">
                        <div className="flex justify-between items-start border-b border-amber-100 pb-1.5 gap-4">
                          <div className="flex flex-col gap-1.5 flex-1">
                            <div className="font-bold text-amber-800 text-xs uppercase">
                              {isProhib ? `🛡️ Remedy Block #${dutyIdx + 1}` : isOblig ? `🛡️ Consequence Block #${dutyIdx + 1}`: `🛡️ Duty Block #${dutyIdx + 1}`}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => addDutyConstraint(dutyIdx)} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors font-medium shadow-sm">+ Add Constraint</button>
                              {!dutyBlock.assigner && <button onClick={() => addDutyAssigner(dutyIdx)} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors font-medium shadow-sm">+ Add Assigner</button>}
                              {!dutyBlock.actor && <button onClick={() => addDutyActor(dutyIdx)} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors font-medium shadow-sm">+ Add Assignee</button>}
							  {isPerm && (
                                <button onClick={() => addDutyConsequence(dutyIdx)} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors font-medium shadow-sm">+ Add Consequence</button>
							  )}
                            </div>
                          </div>
                          <button type="button" onClick={() => removeDutyBlock(dutyIdx)} className="text-amber-700 hover:text-amber-900 font-bold text-md leading-none p-1 rounded hover:bg-amber-100 transition-all cursor-pointer shrink-0">✕</button>
                        </div>
            
                        <div className="bg-white p-3 border border-amber-200 rounded-lg shadow-xs flex flex-col gap-3">
                          <div className="flex justify-between items-center">
                            <label className="text-[11px] font-bold uppercase text-amber-900">Action</label>
                            <button onClick={() => addDutyActionConstraint(dutyIdx)} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors cursor-pointer text-slate-600 font-medium">+ Add Action Refinement</button>
                          </div>
                          <select 
                            className="w-full border p-1.5 rounded text-xs bg-white font-medium font-mono truncate" 
                            value={dutyBlock.action || ''} 
                            onChange={(e) => updateDutyAction(dutyIdx, e.target.value)}
                          >
                            <option value="">-- Select Action --</option>
                            {dbActions.map(([path, uri, definition]) => (
                              <option key={uri} value={uri} title={definition}>{path}</option>
                            ))}
                          </select>

                          {dutyBlock.actionObj?.constraints?.length > 0 && (
                            <div className="flex flex-col gap-2 pl-3 border-l-2 border-amber-400 mt-1 w-full min-w-0">
                              {dutyBlock.actionObj.constraints.map((constraint, idx) => (
                                <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                                  <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                                  {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyActionConstraint(dutyIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                  {renderOperatorSelect(constraint.operator, (e) => updateDutyActionConstraint(dutyIdx, idx, 'operator', e.target.value), dbOperators)}
                                  {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyActionConstraint(dutyIdx, idx, 'rightOperand', e.target.value))}
                                  <button type="button" onClick={() => deleteDutyActionConstraint(dutyIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
						
						{/* Duty Constraints */}
                        {dutyBlock.constraints?.length > 0 && (
                          <div className="flex flex-col gap-2 pl-3 border-l-2 border-amber-400 mt-1 w-full min-w-0">
                            <label className="text-[10px] font-bold uppercase text-amber-900">Duty Constraints</label>
                           {dutyBlock.constraints.map((constraint, idx) => (
                             <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                               <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                               {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyConstraint(dutyIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                               {renderOperatorSelect(constraint.operator, (e) => updateDutyConstraint(dutyIdx, idx, 'operator', e.target.value), dbOperators)}
                               {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyConstraint(dutyIdx, idx, 'rightOperand', e.target.value))}
                               <button type="button" onClick={() => deleteDutyConstraint(dutyIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                             </div>
                           ))}
                          </div>
                        )}

                        {/* Duty Assigner Subblock */}
                        {dutyBlock.assigner && (
                          <div className="bg-white p-2.5 border border-amber-200 rounded-md shadow-xs flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                              <label className="text-[11px] font-bold uppercase text-slate-600">Assigner</label>
                              <div className="flex items-center gap-2">
                                <button onClick={() => addDutyAssignerConstraint(dutyIdx)} className="text-[9px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-200 text-slate-600 font-medium">+ Add Refinement</button>
                                <button type="button" onClick={() => removeDutyAssigner(dutyIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-0.5">✕</button>
                              </div>
                            </div>
                            <select className="w-full border p-1 rounded text-xs bg-white font-medium" value={dutyBlock.assigner.type} onChange={(e) => {
                              // const listKey = isPerm ? 'permissions' : 'prohibitions';
							  const listKey = isPerm ? 'permissions' : isProhib ? 'prohibitions' : 'obligations';
                              const items = [...policy[listKey]];
                              items[idxObj.idx].duties[dutyIdx].assigner.type = e.target.value;
                              setPolicy({...policy, [listKey]: items});
                            }}>
                              <option value="Legal Entity">Legal Entity</option>
                              <option value="Natural Person">Natural Person</option>
                              <option value="Organisational Unit">Organisational Unit</option>
                            </select>

                            {dutyBlock.assigner.constraints?.length > 0 && (
                              <div className="flex flex-col gap-1.5 pl-2 border-l-2 border-slate-400 mt-1 w-full min-w-0">
                                {dutyBlock.assigner.constraints.map((constraint, idx) => (
                                  <div key={idx} className="flex gap-1.5 items-center w-full min-w-0">
                                    <span className="text-[10px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                                    {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyAssignerConstraint(dutyIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                    {renderOperatorSelect(constraint.operator, (e) => updateDutyAssignerConstraint(dutyIdx, idx, 'operator', e.target.value), dbOperators)}
                                    {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyAssignerConstraint(dutyIdx, idx, 'rightOperand', e.target.value))}
                                    <button type="button" onClick={() => deleteDutyAssignerConstraint(dutyIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold shrink-0">✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Duty Assignee Subblock */}
                        {dutyBlock.actor && (
                          <div className="bg-white p-2.5 border border-amber-200 rounded-md shadow-xs flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                              <label className="text-[11px] font-bold uppercase text-indigo-600">Assignee</label>
                              <div className="flex items-center gap-2">
                                <button onClick={() => addDutyActorConstraint(dutyIdx)} className="text-[9px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-200 text-slate-600 font-medium">+ Add Refinement</button>
                                <button type="button" onClick={() => removeDutyActor(dutyIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-0.5">✕</button>
                              </div>
                            </div>
                            <select className="w-full border p-1 rounded text-xs bg-white font-medium" value={dutyBlock.actor.type} onChange={(e) => {
                              // const listKey = isPerm ? 'permissions' : 'prohibitions';
							  const listKey = isPerm ? 'permissions' : isProhib ? 'prohibitions' : 'obligations';
                              const items = [...policy[listKey]];
                              items[idxObj.idx].duties[dutyIdx].actor.type = e.target.value;
                              setPolicy({...policy, [listKey]: items});
                            }}>
                              <option value="Legal Entity">Legal Entity</option>
                              <option value="Natural Person">Natural Person</option>
                              <option value="Organisational Unit">Organisational Unit</option>
                            </select>

                            {dutyBlock.actor.constraints?.length > 0 && (
                              <div className="flex flex-col gap-1.5 pl-2 border-l-2 border-indigo-400 mt-1 w-full min-w-0">
                                {dutyBlock.actor.constraints.map((constraint, idx) => (
                                  <div key={idx} className="flex gap-1.5 items-center w-full min-w-0">
                                    <span className="text-[10px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                                    {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyActorConstraint(dutyIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                    {renderOperatorSelect(constraint.operator, (e) => updateDutyActorConstraint(dutyIdx, idx, 'operator', e.target.value), dbOperators)}
                                    {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyActorConstraint(dutyIdx, idx, 'rightOperand', e.target.value))}
                                    <button type="button" onClick={() => deleteDutyActorConstraint(dutyIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold shrink-0">✕</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
						
						{/* Duty Consequences Subblock */}
                        {dutyBlock.consequences?.length > 0 && (
                          <div className="flex flex-col gap-3 mt-2">
                            <label className="text-[11px] font-bold uppercase text-amber-900">Consequences</label>
                            {dutyBlock.consequences.map((cons, consIdx) => (
                              <div key={consIdx} className="bg-white p-3 border border-amber-200 rounded-md shadow-xs flex flex-col gap-2.5">
                                <div className="flex justify-between items-center">
                                  <span className="text-[11px] font-bold text-amber-900">Consequence #{consIdx + 1}</span>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => addDutyConsequenceConstraint(dutyIdx, consIdx)} className="text-[9px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-200 text-slate-600 font-medium">+ Add Refinement</button>
                                    <button type="button" onClick={() => removeDutyConsequence(dutyIdx, consIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-0.5">✕</button>
                                  </div>
                                </div>
                                <select 
                                  className="w-full border p-1.5 rounded text-xs bg-white font-medium font-mono truncate" 
                                  value={cons.action || ''} 
                                  onChange={(e) => updateDutyConsequenceAction(dutyIdx, consIdx, e.target.value)}
                                >
                                  <option value="">-- Select Consequence Action --</option>
                                  {dbActions.map(([path, uri, definition]) => (
                                    <option key={uri} value={uri} title={definition}>{path}</option>
                                  ))}
                                </select>

                                {cons.constraints?.length > 0 && (
                                  <div className="flex flex-col gap-1.5 pl-2 border-l-2 border-amber-400 mt-1 w-full min-w-0">
                                    {cons.constraints.map((constraint, cIdx) => (
                                      <div key={cIdx} className="flex gap-1.5 items-center w-full min-w-0">
                                        <span className="text-[10px] text-slate-400 w-8 shrink-0">C{cIdx+1}:</span>
                                        {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyConsequenceConstraint(dutyIdx, consIdx, cIdx, 'leftOperand', e.target.value), dbLeftOperands)}
                                        {renderOperatorSelect(constraint.operator, (e) => updateDutyConsequenceConstraint(dutyIdx, consIdx, cIdx, 'operator', e.target.value), dbOperators)}
                                        {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyConsequenceConstraint(dutyIdx, consIdx, cIdx, 'rightOperand', e.target.value))}
                                        <button type="button" onClick={() => deleteDutyConsequenceConstraint(dutyIdx, consIdx, cIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold shrink-0">✕</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
						
						
                      </div>
                    ))}
                  </div>
                );
              })()}
          </section>

          {/* Rule Tabs Footer Navigation */}
          <section className="bg-white rounded-lg p-3 shadow border border-slate-200 flex flex-col gap-2">
            <div className="flex items-center gap-3 border-b pb-1">
              <h2 className="font-bold text-xs uppercase tracking-wider text-slate-500">RULE TABS</h2>
              <button onClick={addPermissionBlock} className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-2 py-0.5 rounded shadow text-[11px] transition-colors cursor-pointer">+ Add Permission</button>
              <button onClick={addProhibitionBlock} className="bg-rose-600 hover:bg-rose-700 text-white font-medium px-2 py-0.5 rounded shadow text-[11px] transition-colors cursor-pointer">+ Add Prohibition</button>
              <button onClick={addObligationBlock} className="bg-amber-600 hover:bg-amber-700 text-white font-medium px-2 py-0.5 rounded shadow text-[11px] transition-colors cursor-pointer">+ Add Obligation</button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1 overflow-x-auto max-h-24">
              {(policy.permissions?.length > 0 || policy.prohibitions?.length > 0 || policy.obligations?.length > 0) ? (
                <>
                  {policy.permissions?.map((_, idx) => (
                    <button key={`perm-${idx}`} type="button" onClick={() => setActivePermissionIdx({ type: 'permission', idx })} className={`text-xs px-3 py-1.5 rounded font-medium border transition-all cursor-pointer shadow-xs ${activePermissionIdx.type === 'permission' && idx === activePermissionIdx.idx ? 'bg-blue-600 text-white border-blue-600 font-bold scale-[1.02]' : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                      PERMISSION #{idx + 1} (Rule)
                    </button>
                  ))}
                  {policy.prohibitions?.map((_, idx) => (
                    <button key={`prohib-${idx}`} type="button" onClick={() => setActivePermissionIdx({ type: 'prohibition', idx })} className={`text-xs px-3 py-1.5 rounded font-medium border transition-all cursor-pointer shadow-xs ${activePermissionIdx.type === 'prohibition' && idx === activePermissionIdx.idx ? 'bg-rose-600 text-white border-rose-600 font-bold scale-[1.02]' : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                      PROHIBITION #{idx + 1} (Rule)
                    </button>
                  ))}
				  {policy.obligations?.map((_, idx) => (
                    <button key={`obl-${idx}`} type="button" onClick={() => setActivePermissionIdx({ type: 'obligation', idx })} className={`text-xs px-3 py-1.5 rounded font-medium border transition-all cursor-pointer shadow-xs ${activePermissionIdx.type === 'obligation' && idx === activePermissionIdx.idx ? 'bg-amber-600 text-white border-amber-600 font-bold scale-[1.02]' : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                      OBLIGATION #{idx + 1} (Rule)
                    </button>
                  ))}
                </>
              ) : (
                <span className="text-xs text-slate-400 italic py-1">No active tabs</span>
              )}
            </div>
          </section>
        </div>

        {/* Right Panel: Human Summary & JSON-LD / TTL Output */}
        <section className="w-1/4 flex flex-col gap-4 overflow-hidden h-full">
          <HumanSummaryPanel policy={policy} activePermissionIdx={activePermissionIdx} />

          <div className="h-2/3 bg-white rounded-lg p-4 shadow border border-slate-200 flex flex-col">
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-500 border-b pb-2 mb-2">JSON-LD / TTL Output</h2>
            <textarea 
              className="w-full flex-1 font-mono text-[11px] bg-slate-900 text-emerald-400 p-3 rounded border border-slate-900 resize-none overflow-y-auto mb-2" 
              value={codeViewFormat === 'JSON-LD' ? jsonLd : ttlOutput } 
              readOnly 
            />
			<div className="flex gap-2 items-center">
              <button 
                onClick={() => setCodeViewFormat(codeViewFormat === 'JSON-LD' ? 'TTL' : 'JSON-LD')} 
                className="flex-1 bg-slate-700 hover:bg-slate-800 text-white font-medium py-1.5 px-3 rounded shadow-sm text-xs transition-colors cursor-pointer"
              >
                {codeViewFormat === 'JSON-LD' ? 'Display TTL' : 'Display JSON-LD'}
              </button>
              <button 
                onClick={() => setShowMagnifyModal(true)} 
                title="Magnify Content View"
                className="bg-slate-700 hover:bg-slate-800 text-white font-medium py-1.5 px-3 rounded shadow-sm text-xs transition-colors cursor-pointer shrink-0 flex items-center justify-center"
              >
                🔍
              </button>
            </div>
          </div>
        </section>

        {/* SHACL Report Modal Overlay */}
        {showShaclReport && shaclResult?.report && (
          <div className="fixed bottom-16 right-8 bg-white border border-slate-300 shadow-xl rounded-lg flex flex-col z-50 p-3 max-w-xl">
            <div className="flex justify-between items-center border-b pb-2 mb-2">
              <h3 className="font-bold text-xs uppercase text-slate-700 flex items-center gap-2">🔎 SHACL Validation Report</h3>
              <button onClick={() => setShowShaclReport(false)} className="text-slate-500 hover:text-rose-500 font-bold p-1 rounded transition-colors text-sm leading-none">✕</button>
            </div>
            <textarea readOnly className="min-w-[350px] min-h-[250px] bg-slate-900 text-emerald-400 font-mono text-[11px] p-3 rounded resize overflow-y-auto" value={shaclResult.report} />
          </div>
        )}
      </main>
	  
	  {/* Magnified Output Floating Modal */}
      {showMagnifyModal && (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg shadow-2xl p-4 w-full max-w-4xl h-[75vh] flex flex-col resize overflow-auto border border-slate-300">
            <div className="flex justify-between items-center border-b pb-2 mb-3">
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-2">
                🔍 Magnified Output ({codeViewFormat})
              </h3>
              <button 
                onClick={() => setShowMagnifyModal(false)} 
                className="text-slate-500 hover:text-rose-600 font-bold text-sm px-1.5 py-0.5 rounded transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
            <textarea 
              className="w-full flex-1 font-mono text-xs bg-slate-900 text-emerald-400 p-4 rounded border border-slate-900 resize-none overflow-y-auto" 
              value={codeViewFormat === 'JSON-LD' ? jsonLd : ttlOutput} 
              readOnly 
            />
          </div>
        </div>
      )}

      {/* Feature Under Development Modal */}
      {showDevModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg shadow-2xl p-6 max-w-sm w-full flex flex-col gap-4 text-center">
            <p className="text-sm font-medium text-slate-800">Feature currently under development</p>
            <button 
              onClick={() => setShowDevModal(false)} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-4 rounded text-xs transition-colors mx-auto"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Vocabulary Manager Modal */}
      {showVocabModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50">
              <h2 className="font-bold text-sm uppercase tracking-wider text-slate-700">Vocabulary Manager</h2>
              <button onClick={() => setShowVocabModal(false)} className="text-slate-500 hover:text-rose-600 font-bold text-lg">✕</button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              <div className="w-1/3 p-6 border-r flex flex-col gap-4">
                <h3 className="font-bold text-xs uppercase text-slate-500">Vocabulary Entry</h3>
                <button onClick={handleAddActionVocab} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded shadow-sm text-xs transition-colors">Add Action</button>
              </div>
              <div className="w-2/3 p-6 flex flex-col">
                <h3 className="font-bold text-xs uppercase text-slate-500 mb-2">Vocabulary Output</h3>
                <textarea className="flex-1 font-mono text-[11px] bg-slate-900 text-emerald-400 p-4 rounded resize-none overflow-y-auto whitespace-pre-wrap" value={vocabOutput} readOnly />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Publishing Bar */}
      <footer className="bg-slate-200 p-3 border-t flex justify-between items-center shadow-inner">
        <span className="text-xs text-slate-500 font-mono">{backendStatus || "Idle - Ready to validate"}</span>
        <div className="flex gap-2">
          <button className="bg-slate-300 hover:bg-slate-400 font-medium px-4 py-1.5 rounded">Save Draft</button>
          <button onClick={handlePublish} className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-1.5 rounded shadow">Publish Policy</button>
        </div>
      </footer>
    </div>
  );
}