import React, { useState, useRef } from 'react';
import { useOdrlPolicy } from './useOdrlPolicy';
import { renderLeftOperandSelect, renderOperatorSelect, renderRightOperandInput } from './components/ConstraintHelpers';

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

  // State for toggling policy code format view (JSON-LD vs TTL)
  const [codeViewFormat, setCodeViewFormat] = useState('JSON-LD');

  // Ref for hidden file input used in uploading a local policy file
  const fileInputRef = useRef(null);

  // Helper function to fully convert JSON-LD policy object into valid Turtle (TTL) syntax
  const convertJsonLdToTtl = (jsonLdString) => {
    try {
      const data = JSON.parse(jsonLdString);
      let ttl = `@prefix odrl: <http://www.w3.org/ns/odrl/2/> .\n`;
      ttl += `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n`;
      ttl += `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n`;
      ttl += `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n\n`;

      const policyId = data["@id"] || data.uid || "_:policy";
      const policyType = data["@type"] || "odrl:Set";

      ttl += `<${policyId}>\n`;
      ttl += `  a ${policyType.startsWith('odrl:') ? policyType : `odrl:${policyType}`} ;\n`;

      if (data.profile) {
        ttl += `  odrl:profile <${data.profile}> ;\n`;
      }
      if (data.conflict) {
        ttl += `  odrl:conflict odrl:${data.conflict} ;\n`;
      }
      if (data.assigner) {
        ttl += `  odrl:assigner <${data.assigner}> ;\n`;
      }
      if (data.assignee) {
        ttl += `  odrl:assignee <${data.assignee}> ;\n`;
      }

      // Handle global targets
      const targets = data.target ? (Array.isArray(data.target) ? data.target : [data.target]) : [];
      targets.forEach(t => {
        const tId = typeof t === 'string' ? t : (t["@id"] || '');
        if (tId) {
          ttl += `  odrl:target <${tId}> ;\n`;
        }
      });

      // Helper to format constraints/refinements
      const formatConstraints = (constraints, indent = "    ") => {
        if (!constraints || constraints.length === 0) return "";
        let cTtl = "";
        constraints.forEach(c => {
          const left = c.leftOperand || '';
          const op = c.operator || '=';
          const right = c.rightOperand || '';
          cTtl += `${indent}odrl:constraint [\n`;
          cTtl += `${indent}  odrl:leftOperand <${left}> ;\n`;
          cTtl += `${indent}  odrl:operator odrl:${op === '=' ? 'eq' : op === '<' ? 'lt' : op === '>' ? 'gt' : op} ;\n`;
          cTtl += `${indent}  odrl:rightOperand "${right}"\n`;
          cTtl += `${indent}] ;\n`;
        });
        return cTtl;
      };

      // Helper to format parties (assigner/assignee)
      const formatParty = (party, roleName, indent = "    ") => {
        if (!party) return "";
        let pTtl = `${indent}odrl:${roleName} [\n`;
        pTtl += `${indent}  a odrl:${party.type || 'LegalEntity'} ;\n`;
        if (party.constraints && party.constraints.length > 0) {
          party.constraints.forEach(c => {
            pTtl += `${indent}  odrl:constraint [\n`;
            pTtl += `${indent}    odrl:leftOperand <${c.leftOperand}> ;\n`;
            pTtl += `${indent}    odrl:operator odrl:${c.operator === '=' ? 'eq' : c.operator} ;\n`;
            pTtl += `${indent}    odrl:rightOperand "${c.rightOperand}"\n`;
            pTtl += `${indent}  ] ;\n`;
          });
        }
        pTtl += `${indent}] ;\n`;
        return pTtl;
      };

      // Handle permissions recursively
      const permissions = data.permission ? (Array.isArray(data.permission) ? data.permission : [data.permission]) : [];
      permissions.forEach((perm) => {
        ttl += `  odrl:permission [\n`;
        
        // Action
        if (perm.action) {
          const actionVal = typeof perm.action === 'string' ? perm.action : (perm.action.rdfValue || perm.action["@id"] || '');
          ttl += `    odrl:action <${actionVal}> ;\n`;
          if (perm.action.refinement && perm.action.refinement.length > 0) {
            perm.action.refinement.forEach(ref => {
              ttl += `    odrl:refinement [\n`;
              ttl += `      odrl:leftOperand <${ref.leftOperand}> ;\n`;
              ttl += `      odrl:operator odrl:${ref.operator === '=' ? 'eq' : ref.operator} ;\n`;
              ttl += `      odrl:rightOperand "${ref.rightOperand}"\n`;
              ttl += `    ] ;\n`;
            });
          }
        }

        // Target inside permission
        if (perm.target) {
          const pTarget = typeof perm.target === 'string' ? perm.target : (perm.target["@id"] || '');
          if (pTarget) {
            ttl += `    odrl:target <${pTarget}> ;\n`;
          }
        }

        // Parties inside permission
        if (perm.assigner) {
          const assignerVal = typeof perm.assigner === 'string' ? perm.assigner : perm.assigner["@id"];
          ttl += `    odrl:assigner <${assignerVal}> ;\n`;
        }
        if (perm.assignee) {
          const assigneeVal = typeof perm.assignee === 'string' ? perm.assignee : perm.assignee["@id"];
          ttl += `    odrl:assignee <${assigneeVal}> ;\n`;
        }

        // Rule-level constraints
        if (perm.constraint) {
          const constraints = Array.isArray(perm.constraint) ? perm.constraint : [perm.constraint];
          constraints.forEach(c => {
            ttl += `    odrl:constraint [\n`;
            ttl += `      odrl:leftOperand <${c.leftOperand}> ;\n`;
            ttl += `      odrl:operator odrl:${c.operator === '=' ? 'eq' : c.operator} ;\n`;
            ttl += `      odrl:rightOperand "${c.rightOperand}"\n`;
            ttl += `    ] ;\n`;
          });
        }

        // Duties inside permission
        if (perm.duty) {
          const duties = Array.isArray(perm.duty) ? perm.duty : [perm.duty];
          duties.forEach(duty => {
            ttl += `    odrl:duty [\n`;
            if (duty.action) {
              const dAction = typeof duty.action === 'string' ? duty.action : (duty.action.rdfValue || duty.action["@id"] || '');
              ttl += `      odrl:action <${dAction}> ;\n`;
            }
            if (duty.consequence) {
              const consequences = Array.isArray(duty.consequence) ? duty.consequence : [duty.consequence];
              consequences.forEach(cons => {
                ttl += `      odrl:consequence [\n`;
                if (cons.action) {
                  const cAction = typeof cons.action === 'string' ? cons.action : (cons.action.rdfValue || cons.action["@id"] || '');
                  ttl += `        odrl:action <${cAction}> ;\n`;
                }
                ttl += `      ] ;\n`;
              });
            }
            ttl += `    ] ;\n`;
          });
        }

        ttl += `  ] ;\n`;
      });

      // Clean trailing punctuation
      if (ttl.endsWith(';\n')) {
        ttl = ttl.slice(0, -2) + ' .\n';
      } else {
        ttl += '.\n';
      }

      return ttl;
    } catch (e) {
      return `# Error parsing JSON-LD for TTL conversion: ${e.message}\n\n` + jsonLdString;
    }
  };

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
          
          // Normalize and load into internal policy structure using existing hook setters if available
          // (leveraging setPolicy which updates the active policy object similarly to handleLoadServerPolicy)
          const newTargets = parsedJson.target ? (Array.isArray(parsedJson.target) ? parsedJson.target : [parsedJson.target]) : [];
          
          const newPermissions = (parsedJson.permission ? (Array.isArray(parsedJson.permission) ? parsedJson.permission : [parsedJson.permission]) : []).map(p => ({
            action: { name: typeof p.action === 'string' ? p.action : (p.action?.rdfValue || p.action?.["@id"] || ''), constraints: [] },
            assigner: p.assigner ? { type: 'Legal Entity', constraints: [] } : null,
            actor: p.assignee ? { type: 'Legal Entity', constraints: [] } : null,
            purpose: null,
            target: p.target ? { name: typeof p.target === 'string' ? p.target : (p.target?.["@id"] || ''), constraints: [] } : null,
            constraints: p.constraint ? (Array.isArray(p.constraint) ? p.constraint : [p.constraint]).map(c => ({ leftOperand: c.leftOperand, operator: c.operator, rightOperand: c.rightOperand })) : [],
            duties: p.duty ? (Array.isArray(p.duty) ? p.duty : [p.duty]).map(d => ({
              action: typeof d.action === 'string' ? d.action : (d.action?.rdfValue || d.action?.["@id"] || ''),
              actionObj: { name: typeof d.action === 'string' ? d.action : '', constraints: [] },
              assigner: null,
              actor: null,
              constraints: d.constraint ? (Array.isArray(d.constraint) ? d.constraint : [d.constraint]).map(c => ({ leftOperand: c.leftOperand, operator: c.operator, rightOperand: c.rightOperand })) : [],
              consequences: []
            })) : []
          }));

          setPolicy({
            type: parsedJson["@type"] || 'Set',
            uid: parsedJson.uid || parsedJson["@id"] || '',
            profile: parsedJson.profile || '',
            assigner: parsedJson.assigner || null,
            assignee: parsedJson.assignee || null,
            conflict: parsedJson.conflict || null,
            targets: newTargets,
            permissions: newPermissions
          });
          setActivePermissionIdx(0);
        }
      } catch (err) {
        console.error("Failed to parse uploaded policy JSON file:", err);
        alert("Invalid JSON file format.");
      } finally {
        // Reset file input value so uploading the same file again triggers change event
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
      action: { name: '', constraints: [] },
      assigner: null, actor: null,
      purpose: null,
      target: hasGlobalTargets ? null : { name: '', constraints: [] },
      constraints: [], duties: []
    };
    const permissions = [...(policy.permissions || []), newPermission];
    setPolicy({ ...policy, permissions });
    setActivePermissionIdx(permissions.length - 1);
  };
  const removePermissionBlock = (permIdx) => {
    const permissions = policy.permissions.filter((_, idx) => idx !== permIdx);
    setPolicy({ ...policy, permissions });
    if (activePermissionIdx >= permissions.length) setActivePermissionIdx(Math.max(0, permissions.length - 1));
  };

  // Action Constraint (Refinement) Handlers
  const addActionConstraint = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].action.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateActionConstraint = (permIdx, index, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].action.constraints[index][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteActionConstraint = (permIdx, indexToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].action.constraints = permissions[permIdx].action.constraints.filter((_, idx) => idx !== indexToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Duty Action Constraint (Refinement) Handlers
  const addDutyActionConstraint = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    if (!permissions[permIdx].duties[dutyIdx].actionObj) {
      permissions[permIdx].duties[dutyIdx].actionObj = { name: permissions[permIdx].duties[dutyIdx].action || '', constraints: [] };
    }
    permissions[permIdx].duties[dutyIdx].actionObj.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateDutyActionConstraint = (permIdx, dutyIdx, index, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].actionObj.constraints[index][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteDutyActionConstraint = (permIdx, dutyIdx, indexToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].actionObj.constraints = permissions[permIdx].duties[dutyIdx].actionObj.constraints.filter((_, idx) => idx !== indexToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Global Permission Rule Constraint Handlers
  const addPermissionConstraint = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updatePermissionConstraint = (permIdx, index, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].constraints[index][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deletePermissionConstraint = (permIdx, indexToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].constraints = permissions[permIdx].constraints.filter((_, idx) => idx !== indexToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Assigner Block & Constraint Handlers
  const addAssignerBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].assigner = { type: 'Legal Entity', constraints: [] };
    setPolicy({ ...policy, permissions });
  };
  const removeAssignerBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].assigner = null;
    setPolicy({ ...policy, permissions });
  };
  const addAssignerConstraint = (permIdx) => {
    const permissions = [...policy.permissions];
    if (!permissions[permIdx].assigner) return;
    permissions[permIdx].assigner.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateAssignerConstraint = (permIdx, index, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].assigner.constraints[index][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteAssignerConstraint = (permIdx, indexToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].assigner.constraints = permissions[permIdx].assigner.constraints.filter((_, idx) => idx !== indexToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Actor (Assignee) Block & Constraint Handlers
  const addActorBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].actor = { type: 'Legal Entity', constraints: [] };
    setPolicy({ ...policy, permissions });
  };
  const removeActorBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].actor = null;
    setPolicy({ ...policy, permissions });
  };
  const addActorConstraint = (permIdx) => {
    const permissions = [...policy.permissions];
    if (!permissions[permIdx].actor) return;
    permissions[permIdx].actor.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateActorConstraint = (permIdx, index, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].actor.constraints[index][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteActorConstraint = (permIdx, indexToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].actor.constraints = permissions[permIdx].actor.constraints.filter((_, idx) => idx !== indexToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Purpose Block & Constraint/Refinement Handlers
  const addPurposeBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].purpose = { name: '', constraints: [] };
    setPolicy({ ...policy, permissions });
  };
  const removePurposeBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].purpose = null;
    setPolicy({ ...policy, permissions });
  };
  const addPurposeConstraint = (permIdx) => {
    const permissions = [...policy.permissions];
    if (!permissions[permIdx].purpose) return;
    permissions[permIdx].purpose.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updatePurposeConstraint = (permIdx, index, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].purpose.constraints[index][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deletePurposeConstraint = (permIdx, indexToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].purpose.constraints = permissions[permIdx].purpose.constraints.filter((_, idx) => idx !== indexToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Target Asset Block & Constraint Handlers
  const addTargetBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].target = { name: '', constraints: [] };
    setPolicy({ ...policy, permissions });
  };
  const removeTargetBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].target = null;
    setPolicy({ ...policy, permissions });
  };
  const addTargetConstraint = (permIdx) => {
    const permissions = [...policy.permissions];
    if (!permissions[permIdx].target) return;
    permissions[permIdx].target.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateTargetConstraint = (permIdx, index, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].target.constraints[index][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteTargetConstraint = (permIdx, indexToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].target.constraints = permissions[permIdx].target.constraints.filter((_, idx) => idx !== indexToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Duty & Consequence Handlers
  const addDutyBlock = (permIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties.push({ action: '', actionObj: { name: '', constraints: [] }, assigner: null, actor: null, constraints: [], consequences: [] });
    setPolicy({ ...policy, permissions });
  };
  const updateDutyAction = (permIdx, dutyIdx, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].action = value;
    if (!permissions[permIdx].duties[dutyIdx].actionObj) {
      permissions[permIdx].duties[dutyIdx].actionObj = { name: value, constraints: [] };
    } else {
      permissions[permIdx].duties[dutyIdx].actionObj.name = value;
    }
    setPolicy({ ...policy, permissions });
  };
  const removeDutyBlock = (permIdx, dutyIdxToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties = permissions[permIdx].duties.filter((_, idx) => idx !== dutyIdxToRemove);
    setPolicy({ ...policy, permissions });
  };
  const addDutyConstraint = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '>', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateDutyConstraint = (permIdx, dutyIdx, constraintIdx, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].constraints[constraintIdx][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteDutyConstraint = (permIdx, dutyIdx, constraintIdxToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].constraints = permissions[permIdx].duties[dutyIdx].constraints.filter((_, idx) => idx !== constraintIdxToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Duty Consequences Handlers
  const addDutyConsequence = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].consequences.push({ action: '', constraints: [] });
    setPolicy({ ...policy, permissions });
  };
  const updateDutyConsequenceAction = (permIdx, dutyIdx, consIdx, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].consequences[consIdx].action = value;
    setPolicy({ ...policy, permissions });
  };
  const removeDutyConsequence = (permIdx, dutyIdx, consIdxToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].consequences = permissions[permIdx].duties[dutyIdx].consequences.filter((_, idx) => idx !== consIdxToRemove);
    setPolicy({ ...policy, permissions });
  };
  const addDutyConsequenceConstraint = (permIdx, dutyIdx, consIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].consequences[consIdx].constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/dateTime', operator: '<', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateDutyConsequenceConstraint = (permIdx, dutyIdx, consIdx, constraintIdx, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].consequences[consIdx].constraints[constraintIdx][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteDutyConsequenceConstraint = (permIdx, dutyIdx, consIdx, constraintIdxToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].consequences[consIdx].constraints = permissions[permIdx].duties[dutyIdx].consequences[consIdx].constraints.filter((_, idx) => idx !== constraintIdxToRemove);
    setPolicy({ ...policy, permissions });
  };

  // Duty Assigner / Actor Sub-handlers
  const addDutyAssigner = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].assigner = { type: 'Legal Entity', constraints: [] };
    setPolicy({ ...policy, permissions });
  };
  const removeDutyAssigner = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].assigner = null;
    setPolicy({ ...policy, permissions });
  };
  const addDutyAssignerConstraint = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].assigner.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateDutyAssignerConstraint = (permIdx, dutyIdx, idx, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].assigner.constraints[idx][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteDutyAssignerConstraint = (permIdx, dutyIdx, idxToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].assigner.constraints = permissions[permIdx].duties[dutyIdx].assigner.constraints.filter((_, idx) => idx !== idxToRemove);
    setPolicy({ ...policy, permissions });
  };

  const addDutyActor = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].actor = { type: 'Legal Entity', constraints: [] };
    setPolicy({ ...policy, permissions });
  };
  const removeDutyActor = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].actor = null;
    setPolicy({ ...policy, permissions });
  };
  const addDutyActorConstraint = (permIdx, dutyIdx) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].actor.constraints.push({ leftOperand: 'http://www.w3.org/ns/odrl/2/spatial', operator: '=', rightOperand: '' });
    setPolicy({ ...policy, permissions });
  };
  const updateDutyActorConstraint = (permIdx, dutyIdx, idx, field, value) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].actor.constraints[idx][field] = value;
    setPolicy({ ...policy, permissions });
  };
  const deleteDutyActorConstraint = (permIdx, dutyIdx, idxToRemove) => {
    const permissions = [...policy.permissions];
    permissions[permIdx].duties[dutyIdx].actor.constraints = permissions[permIdx].duties[dutyIdx].actor.constraints.filter((_, idx) => idx !== idxToRemove);
    setPolicy({ ...policy, permissions });
  };

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

  const activePermission = policy.permissions && policy.permissions[activePermissionIdx];
  const hasGlobalTargets = policy.targets && policy.targets.length > 0 && policy.targets.some(t => t.trim() !== '');

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
            
            {activePermission ? (
              <div className="border border-slate-300 rounded-lg p-4 bg-slate-50 flex flex-col gap-4 relative">
                <button onClick={() => removePermissionBlock(activePermissionIdx)} title="Delete this permission rule completely" className="absolute top-2 right-2 text-rose-500 hover:text-white hover:bg-rose-500 border border-transparent hover:border-rose-600 font-bold text-xs w-6 h-6 flex items-center justify-center rounded transition-all cursor-pointer shadow-xs z-10">✕</button>

                <div className="flex justify-between items-start border-b pb-2 gap-4">
                  <div className="flex flex-col gap-1.5 flex-1 pr-6">
                    <span className="font-bold text-blue-700">🔒 EDITING: PERMISSION #{activePermissionIdx + 1}</span>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => addPermissionConstraint(activePermissionIdx)} className="text-xs bg-white border border-slate-300 px-2 py-1 rounded hover:bg-slate-100 transition-colors cursor-pointer text-slate-700 font-medium">+ Add Rule Constraint</button>
                      {!activePermission.assigner && <button onClick={() => addAssignerBlock(activePermissionIdx)} className="text-xs bg-slate-600 text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Assigner</button>}
                      {!activePermission.actor && <button onClick={() => addActorBlock(activePermissionIdx)} className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Assignee</button>}
                      {!activePermission.purpose && <button onClick={() => addPurposeBlock(activePermissionIdx)} className="text-xs bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Purpose</button>}
                      {hasGlobalTargets && !activePermission.target && <button onClick={() => addTargetBlock(activePermissionIdx)} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Target</button>}
                      <button onClick={() => addDutyBlock(activePermissionIdx)} className="text-xs bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700 transition-colors cursor-pointer font-medium shadow-sm">+ Add Duty</button>
                    </div>
                  </div>
                </div>

                {/* Action Block */}
                <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold uppercase text-blue-600">Action</label>
                    <button onClick={() => addActionConstraint(activePermissionIdx)} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors cursor-pointer text-slate-600 font-medium">+ Add Action Refinement</button>
                  </div>
                  
                  <select className="w-full border p-1.5 rounded text-xs bg-white font-medium font-mono truncate" value={activePermission.action?.name || ''} onChange={(e) => {
                    const permissions = [...policy.permissions];
                    permissions[activePermissionIdx].action.name = e.target.value;
                    setPolicy({...policy, permissions});
                  }}>
                    <option value="">-- Select Action --</option>
                    {dbActions.map(([path, uri, definition]) => (
                      <option key={uri} value={uri} title={definition}>{path}</option>
                    ))}
                  </select>

                  {activePermission.action?.constraints?.length > 0 && (
                    <div className="flex flex-col gap-2 pl-3 border-l-2 border-blue-400 mt-1 w-full min-w-0">
                      {activePermission.action.constraints.map((constraint, idx) => (
                        <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                          <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                          {renderLeftOperandSelect(constraint.leftOperand, (e) => updateActionConstraint(activePermissionIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                          {renderOperatorSelect(constraint.operator, (e) => updateActionConstraint(activePermissionIdx, idx, 'operator', e.target.value), dbOperators)}
                          {renderRightOperandInput(constraint.rightOperand, (e) => updateActionConstraint(activePermissionIdx, idx, 'rightOperand', e.target.value))}
                          <button type="button" onClick={() => deleteActionConstraint(activePermissionIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assigner Block */}
                {activePermission.assigner && (
                  <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold uppercase text-slate-600">Assigner</label>
                      <div className="flex items-center gap-2">
                        <button onClick={() => addAssignerConstraint(activePermissionIdx)} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors text-slate-600 font-medium">+ Add Assigner Constraint</button>
                        <button type="button" onClick={() => removeAssignerBlock(activePermissionIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                      </div>
                    </div>
                    <select className="w-full border p-1.5 rounded text-xs bg-white font-medium" value={activePermission.assigner.type} onChange={(e) => {
                      const permissions = [...policy.permissions];
                      permissions[activePermissionIdx].assigner.type = e.target.value;
                      setPolicy({...policy, permissions});
                    }}>
                      <option value="Legal Entity">Legal Entity</option>
                      <option value="Natural Person">Natural Person</option>
                      <option value="Organisational Unit">Organisational Unit</option>
                    </select>

                    {activePermission.assigner.constraints?.length > 0 && (
                      <div className="flex flex-col gap-2 pl-3 border-l-2 border-slate-400 mt-1 w-full min-w-0">
                        {activePermission.assigner.constraints.map((constraint, idx) => (
                          <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                            <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                            {renderLeftOperandSelect(constraint.leftOperand, (e) => updateAssignerConstraint(activePermissionIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                            {renderOperatorSelect(constraint.operator, (e) => updateAssignerConstraint(activePermissionIdx, idx, 'operator', e.target.value), dbOperators)}
                            {renderRightOperandInput(constraint.rightOperand, (e) => updateAssignerConstraint(activePermissionIdx, idx, 'rightOperand', e.target.value))}
                            <button type="button" onClick={() => deleteAssignerConstraint(activePermissionIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Actor / Assignee Block */}
                {activePermission.actor && (
                  <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold uppercase text-indigo-600">Assignee</label>
                      <div className="flex items-center gap-2">
                        <button onClick={() => addActorConstraint(activePermissionIdx)} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors text-slate-600 font-medium">+ Add Assignee Constraint</button>
                        <button type="button" onClick={() => removeActorBlock(activePermissionIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                      </div>
                    </div>
                    <select className="w-full border p-1.5 rounded text-xs bg-white font-medium" value={activePermission.actor.type} onChange={(e) => {
                      const permissions = [...policy.permissions];
                      permissions[activePermissionIdx].actor.type = e.target.value;
                      setPolicy({...policy, permissions});
                    }}>
                      <option value="Legal Entity">Legal Entity</option>
                      <option value="Natural Person">Natural Person</option>
                      <option value="Organisational Unit">Organisational Unit</option>
                    </select>

                    {activePermission.actor.constraints?.length > 0 && (
                      <div className="flex flex-col gap-2 pl-3 border-l-2 border-indigo-400 mt-1 w-full min-w-0">
                        {activePermission.actor.constraints.map((constraint, idx) => (
                          <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                            <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                            {renderLeftOperandSelect(constraint.leftOperand, (e) => updateActorConstraint(activePermissionIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                            {renderOperatorSelect(constraint.operator, (e) => updateActorConstraint(activePermissionIdx, idx, 'operator', e.target.value), dbOperators)}
                            {renderRightOperandInput(constraint.rightOperand, (e) => updateActorConstraint(activePermissionIdx, idx, 'rightOperand', e.target.value))}
                            <button type="button" onClick={() => deleteActorConstraint(activePermissionIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Purpose Block */}
                {activePermission.purpose && (
                  <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold uppercase text-purple-600">Purpose</label>
                      <div className="flex items-center gap-2">
                        <button onClick={() => addPurposeConstraint(activePermissionIdx)} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors text-slate-600 font-medium">+ Add Refinement</button>
                        <button type="button" onClick={() => removePurposeBlock(activePermissionIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                      </div>
                    </div>
                    
                    <select className="w-full border p-1.5 rounded text-xs bg-white font-medium font-mono truncate" value={activePermission.purpose?.name || ''} onChange={(e) => {
                      const permissions = [...policy.permissions];
                      permissions[activePermissionIdx].purpose.name = e.target.value;
                      setPolicy({...policy, permissions});
                    }}>
                      <option value="">-- Select Purpose --</option>
                      {(dbPurposes || []).map(([path, uri, definition]) => (
                        <option key={uri} value={uri} title={definition}>{path}</option>
                      ))}
                    </select>

                    {activePermission.purpose?.constraints?.length > 0 && (
                      <div className="flex flex-col gap-2 pl-3 border-l-2 border-purple-400 mt-1 w-full min-w-0">
                        {activePermission.purpose.constraints.map((constraint, idx) => (
                          <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                            <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                            {renderLeftOperandSelect(constraint.leftOperand, (e) => updatePurposeConstraint(activePermissionIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                            {renderOperatorSelect(constraint.operator, (e) => updatePurposeConstraint(activePermissionIdx, idx, 'operator', e.target.value), dbOperators)}
                            {renderRightOperandInput(constraint.rightOperand, (e) => updatePurposeConstraint(activePermissionIdx, idx, 'rightOperand', e.target.value))}
                            <button type="button" onClick={() => deletePurposeConstraint(activePermissionIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Target Asset Block */}
                {activePermission.target && (
                  <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold uppercase text-emerald-600">Target Asset</label>
                      <div className="flex items-center gap-2">
                        <button onClick={() => addTargetConstraint(activePermissionIdx)} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors text-slate-600 font-medium">+ Add Target Constraint</button>
                        {hasGlobalTargets && (
                          <button type="button" onClick={() => removeTargetBlock(activePermissionIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                        )}
                      </div>
                    </div>
                    <input type="text" placeholder="Target name or URI" className="w-full border p-1.5 rounded text-xs bg-white font-mono" value={activePermission.target?.name || ''} onChange={(e) => {
                      const permissions = [...policy.permissions];
                      if (!permissions[activePermissionIdx].target) permissions[activePermissionIdx].target = { name: '', constraints: [] };
                      permissions[activePermissionIdx].target.name = e.target.value;
                      setPolicy({...policy, permissions});
                    }}/>

                    {activePermission.target?.constraints?.length > 0 && (
                      <div className="flex flex-col gap-2 pl-3 border-l-2 border-emerald-400 mt-1 w-full min-w-0">
                        {activePermission.target.constraints.map((constraint, idx) => (
                          <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                            <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                            {renderLeftOperandSelect(constraint.leftOperand, (e) => updateTargetConstraint(activePermissionIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                            {renderOperatorSelect(constraint.operator, (e) => updateTargetConstraint(activePermissionIdx, idx, 'operator', e.target.value), dbOperators)}
                            {renderRightOperandInput(constraint.rightOperand, (e) => updateTargetConstraint(activePermissionIdx, idx, 'rightOperand', e.target.value))}
                            <button type="button" onClick={() => deleteTargetConstraint(activePermissionIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Global Rule Constraints */}
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Global Rule Constraints</label>
                  <div className="flex flex-col gap-2 pl-3 border-l-2 border-blue-400 w-full min-w-0">
                    {activePermission.constraints?.map((constraint, idx) => (
                      <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                        <span className="text-xs text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                        {renderLeftOperandSelect(constraint.leftOperand, (e) => updatePermissionConstraint(activePermissionIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                        {renderOperatorSelect(constraint.operator, (e) => updatePermissionConstraint(activePermissionIdx, idx, 'operator', e.target.value), dbOperators)}
                        {renderRightOperandInput(constraint.rightOperand, (e) => updatePermissionConstraint(activePermissionIdx, idx, 'rightOperand', e.target.value))}
                        <button type="button" onClick={() => deletePermissionConstraint(activePermissionIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Duties Block */}
                {activePermission.duties && activePermission.duties.map((dutyBlock, dutyIdx) => (
                  <div key={dutyIdx} className="border border-amber-200 bg-amber-50/50 rounded-lg p-4 flex flex-col gap-3">
                    <div className="flex justify-between items-start border-b border-amber-100 pb-1.5 gap-4">
                      <div className="flex flex-col gap-1.5 flex-1">
                        <div className="font-bold text-amber-800 text-xs uppercase">🛡️ Duty Block #{dutyIdx + 1}</div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => addDutyConstraint(activePermissionIdx, dutyIdx)} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors font-medium shadow-sm">+ Add Duty Constraint</button>
                          {!dutyBlock.assigner && <button onClick={() => addDutyAssigner(activePermissionIdx, dutyIdx)} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors font-medium shadow-sm">+ Add Assigner</button>}
                          {!dutyBlock.actor && <button onClick={() => addDutyActor(activePermissionIdx, dutyIdx)} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors font-medium shadow-sm">+ Add Assignee</button>}
                          <button onClick={() => addDutyConsequence(activePermissionIdx, dutyIdx)} className="text-[10px] bg-white border border-amber-200 text-amber-900 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors font-medium shadow-sm">+ Add Consequence</button>
                        </div>
                      </div>
                      <button type="button" onClick={() => removeDutyBlock(activePermissionIdx, dutyIdx)} className="text-amber-700 hover:text-amber-900 font-bold text-md leading-none p-1 rounded hover:bg-amber-100 transition-all cursor-pointer shrink-0">✕</button>
                    </div>
                    
                    <div className="bg-white p-3 border border-amber-200 rounded-lg shadow-xs flex flex-col gap-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[11px] font-bold uppercase text-amber-900">Duty Action Instruction</label>
                        <button onClick={() => addDutyActionConstraint(activePermissionIdx, dutyIdx)} className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors cursor-pointer text-slate-600 font-medium">+ Add Action Refinement</button>
                      </div>
                      <select 
                        className="w-full border p-1.5 rounded text-xs bg-white font-medium font-mono truncate" 
                        value={dutyBlock.action || ''} 
                        onChange={(e) => updateDutyAction(activePermissionIdx, dutyIdx, e.target.value)}
                      >
                        <option value="">-- Select Duty Action --</option>
                        {dbActions.map(([path, uri, definition]) => (
                          <option key={uri} value={uri} title={definition}>{path}</option>
                        ))}
                      </select>

                      {dutyBlock.actionObj?.constraints?.length > 0 && (
                        <div className="flex flex-col gap-2 pl-3 border-l-2 border-amber-400 mt-1 w-full min-w-0">
                          {dutyBlock.actionObj.constraints.map((constraint, idx) => (
                            <div key={idx} className="flex gap-2 items-center w-full min-w-0">
                              <span className="text-[11px] text-slate-400 w-8 shrink-0">C{idx+1}:</span>
                              {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyActionConstraint(activePermissionIdx, dutyIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                              {renderOperatorSelect(constraint.operator, (e) => updateDutyActionConstraint(activePermissionIdx, dutyIdx, idx, 'operator', e.target.value), dbOperators)}
                              {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyActionConstraint(activePermissionIdx, dutyIdx, idx, 'rightOperand', e.target.value))}
                              <button type="button" onClick={() => deleteDutyActionConstraint(activePermissionIdx, dutyIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Duty Assigner Subblock */}
                    {dutyBlock.assigner && (
                      <div className="bg-white p-2.5 border border-amber-200 rounded-md shadow-xs flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[11px] font-bold uppercase text-slate-600">Duty Assigner</label>
                          <div className="flex items-center gap-2">
                            <button onClick={() => addDutyAssignerConstraint(activePermissionIdx, dutyIdx)} className="text-[9px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-200 text-slate-600 font-medium">+ Add Refinement</button>
                            <button type="button" onClick={() => removeDutyAssigner(activePermissionIdx, dutyIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-0.5">✕</button>
                          </div>
                        </div>
                        <select className="w-full border p-1 rounded text-xs bg-white font-medium" value={dutyBlock.assigner.type} onChange={(e) => {
                          const permissions = [...policy.permissions];
                          permissions[activePermissionIdx].duties[dutyIdx].assigner.type = e.target.value;
                          setPolicy({...policy, permissions});
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
                                {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyAssignerConstraint(activePermissionIdx, dutyIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                {renderOperatorSelect(constraint.operator, (e) => updateDutyAssignerConstraint(activePermissionIdx, dutyIdx, idx, 'operator', e.target.value), dbOperators)}
                                {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyAssignerConstraint(activePermissionIdx, dutyIdx, idx, 'rightOperand', e.target.value))}
                                <button type="button" onClick={() => deleteDutyAssignerConstraint(activePermissionIdx, dutyIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold shrink-0">✕</button>
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
                          <label className="text-[11px] font-bold uppercase text-indigo-600">Duty Assignee</label>
                          <div className="flex items-center gap-2">
                            <button onClick={() => addDutyActorConstraint(activePermissionIdx, dutyIdx)} className="text-[9px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-200 text-slate-600 font-medium">+ Add Refinement</button>
                            <button type="button" onClick={() => removeDutyActor(activePermissionIdx, dutyIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-0.5">✕</button>
                          </div>
                        </div>
                        <select className="w-full border p-1 rounded text-xs bg-white font-medium" value={dutyBlock.actor.type} onChange={(e) => {
                          const permissions = [...policy.permissions];
                          permissions[activePermissionIdx].duties[dutyIdx].actor.type = e.target.value;
                          setPolicy({...policy, permissions});
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
                                {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyActorConstraint(activePermissionIdx, dutyIdx, idx, 'leftOperand', e.target.value), dbLeftOperands)}
                                {renderOperatorSelect(constraint.operator, (e) => updateDutyActorConstraint(activePermissionIdx, dutyIdx, idx, 'operator', e.target.value), dbOperators)}
                                {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyActorConstraint(activePermissionIdx, dutyIdx, idx, 'rightOperand', e.target.value))}
                                <button type="button" onClick={() => deleteDutyActorConstraint(activePermissionIdx, dutyIdx, idx)} className="text-red-500 hover:text-red-700 text-xs font-bold shrink-0">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Duty Constraints List */}
                    {dutyBlock.constraints?.length > 0 && (
                      <div className="mt-1">
                        <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1.5">Duty Constraints</label>
                        <div className="flex flex-col gap-2 pl-3 border-l-2 border-amber-400 w-full min-w-0">
                          {dutyBlock.constraints.map((constraint, constraintIdx) => (
                            <div key={constraintIdx} className="flex gap-2 items-center w-full min-w-0">
                              <span className="text-xs text-slate-400 w-8 shrink-0">C{constraintIdx+1}:</span>
                              {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyConstraint(activePermissionIdx, dutyIdx, constraintIdx, 'leftOperand', e.target.value), dbLeftOperands)}
                              {renderOperatorSelect(constraint.operator, (e) => updateDutyConstraint(activePermissionIdx, dutyIdx, constraintIdx, 'operator', e.target.value), dbOperators)}
                              {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyConstraint(activePermissionIdx, dutyIdx, constraintIdx, 'rightOperand', e.target.value))}
                              <button type="button" onClick={() => deleteDutyConstraint(activePermissionIdx, dutyIdx, constraintIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1 shrink-0">✕</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Duty Consequences Subblocks */}
                    {dutyBlock.consequences?.map((consequenceBlock, consIdx) => (
                      <div key={consIdx} className="bg-white p-3 border border-orange-200 rounded-md shadow-xs flex flex-col gap-3 mt-2">
                        <div className="flex justify-between items-center border-b border-orange-100 pb-1">
                          <label className="text-[11px] font-bold uppercase text-orange-600">💥 Consequence #{consIdx + 1}</label>
                          <div className="flex items-center gap-2">
                            <button onClick={() => addDutyConsequenceConstraint(activePermissionIdx, dutyIdx, consIdx)} className="text-[9px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-medium">+ Add Constraint</button>
                            <button type="button" onClick={() => removeDutyConsequence(activePermissionIdx, dutyIdx, consIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold px-1">✕</button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Consequence Action</label>
                          <input type="text" placeholder="Action URI or name" className="w-full border p-1 rounded text-xs bg-white font-medium font-mono" value={consequenceBlock.action} onChange={(e) => updateDutyConsequenceAction(activePermissionIdx, dutyIdx, consIdx, e.target.value)} />
                        </div>

                        {consequenceBlock.constraints?.length > 0 && (
                          <div className="flex flex-col gap-1.5 pl-2 border-l-2 border-orange-400 mt-1 w-full min-w-0">
                            {consequenceBlock.constraints.map((constraint, constraintIdx) => (
                              <div key={constraintIdx} className="flex gap-1.5 items-center w-full min-w-0">
                                <span className="text-[10px] text-slate-400 w-8 shrink-0">C{constraintIdx+1}:</span>
                                {renderLeftOperandSelect(constraint.leftOperand, (e) => updateDutyConsequenceConstraint(activePermissionIdx, dutyIdx, consIdx, constraintIdx, 'leftOperand', e.target.value), dbLeftOperands)}
                                {renderOperatorSelect(constraint.operator, (e) => updateDutyConsequenceConstraint(activePermissionIdx, dutyIdx, consIdx, constraintIdx, 'operator', e.target.value), dbOperators)}
                                {renderRightOperandInput(constraint.rightOperand, (e) => updateDutyConsequenceConstraint(activePermissionIdx, dutyIdx, consIdx, constraintIdx, 'rightOperand', e.target.value))}
                                <button type="button" onClick={() => deleteDutyConsequenceConstraint(activePermissionIdx, dutyIdx, consIdx, constraintIdx)} className="text-red-500 hover:text-red-700 text-xs font-bold shrink-0">✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-slate-400 text-xs italic text-center p-8 bg-slate-50 border border-dashed border-slate-300 rounded-lg">
                No active rules on the canvas. Click "+ Add Permission" inside the tabs header to append a new workspace rule or load an existing file.
              </div>
            )}
          </section>

          {/* Rule Tabs Footer Navigation */}
          <section className="bg-white rounded-lg p-3 shadow border border-slate-200 flex flex-col gap-2">
            <div className="flex items-center gap-3 border-b pb-1">
              <h2 className="font-bold text-xs uppercase tracking-wider text-slate-500">RULE TABS</h2>
              <button onClick={addPermissionBlock} className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-2 py-0.5 rounded shadow text-[11px] transition-colors cursor-pointer">+ Add Permission</button>
              <button onClick={() => setShowDevModal(true)} className="bg-rose-600 hover:bg-rose-700 text-white font-medium px-2 py-0.5 rounded shadow text-[11px] transition-colors cursor-pointer">+ Add Prohibition</button>
              <button onClick={() => setShowDevModal(true)} className="bg-amber-600 hover:bg-amber-700 text-white font-medium px-2 py-0.5 rounded shadow text-[11px] transition-colors cursor-pointer">+ Add Obligation</button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1 overflow-x-auto max-h-24">
              {policy.permissions?.length > 0 ? (
                policy.permissions.map((_, idx) => (
                  <button key={idx} type="button" onClick={() => setActivePermissionIdx(idx)} className={`text-xs px-3 py-1.5 rounded font-medium border transition-all cursor-pointer shadow-xs ${idx === activePermissionIdx ? 'bg-blue-600 text-white border-blue-600 font-bold scale-[1.02]' : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                    PERMISSION #{idx + 1} (Rule)
                  </button>
                ))
              ) : (
                <span className="text-xs text-slate-400 italic py-1">No active tabs</span>
              )}
            </div>
          </section>
        </div>

        {/* Right Panel: Human Summary & JSON-LD / TTL Output */}
        <section className="w-1/4 flex flex-col gap-4 overflow-hidden h-full">
          <div className="h-1/3 bg-white rounded-lg p-4 shadow border border-slate-200 flex flex-col">
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-500 border-b pb-2 mb-2">Human Summary (Live)</h2>
            <div className="text-xs text-slate-600 space-y-3 overflow-y-auto leading-relaxed pr-2">
              <div className="p-2 border-l-2 border-slate-700 bg-slate-50 rounded-r text-[11px]">
                <strong className="block text-slate-800 mb-0.5">Policy Target Inventory:</strong>
                {policy.targets?.length > 0 ? (
                  <ul className="list-disc pl-4 space-y-0.5">
                    {policy.targets.map((t, idx) => <li key={idx} className="font-mono">{t || '<unspecified target>'}</li>)}
                  </ul>
                ) : (
                  <span className="italic text-slate-400">No global targets declared.</span>
                )}
              </div>

              {policy.conflict && (
                <div className="p-2 border-l-2 border-purple-600 bg-purple-50 text-purple-950 rounded-r text-[11px]">
                  <strong>Conflict Resolution Strategy:</strong> <code>odrl:{policy.conflict}</code>
                </div>
              )}

              {policy.permissions?.length > 0 ? (
                policy.permissions.map((perm, index) => (
                  <div key={index} className={`p-2 border-l-2 bg-slate-50 rounded-r transition-all ${index === activePermissionIdx ? 'border-blue-600 font-medium' : 'border-slate-300 opacity-60'}`}>
                    <span className="font-bold text-blue-800 block mb-1">
                      Permission Rule #{index + 1}: {index === activePermissionIdx && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 rounded py-0.5 ml-1">Viewing</span>}
                    </span>
                    <p>
                      Grants permission to execute <span className="bg-blue-100 text-blue-800 px-1 font-mono text-[10px] break-all rounded">{perm.action?.name || 'unspecified action'}</span> on <code>{perm.target?.name || 'unspecified target'}</code>
                      {perm.assigner && <span> issued by a rule <span className="bg-slate-100 text-slate-800 px-1 font-mono rounded">{perm.assigner.type}</span></span>}
                      {perm.actor && <span> for a <span className="bg-indigo-100 text-indigo-800 px-1 font-mono rounded">{perm.actor.type}</span></span>}
                      {perm.purpose && <span> with purpose <span className="bg-purple-100 text-purple-800 px-1 font-mono text-[10px] break-all rounded">{perm.purpose.name || 'unspecified purpose'}</span></span>}.
                    </p>
                    
                    {perm.duties?.length > 0 && (
                      <div className="mt-2 pl-2 border-l border-amber-400 bg-amber-50/40 p-1 rounded">
                        <strong className="text-amber-800 text-[11px] block">Bound Duties:</strong>
                        {perm.duties.map((d, dIdx) => (
                          <div key={dIdx} className="text-[11px] text-slate-700">
                            • Must fulfill: {d.action ? `"${d.action}"` : "<unspecified duty action>"}
                            {d.assigner && <span> (Duty Assigner: <span className="underline">{d.assigner.type}</span>)</span>}
                            {d.actor && <span> (Duty Assignee: <span className="underline">{d.actor.type}</span>)</span>}
                            {d.consequences?.length > 0 && (
                              <div className="text-[10px] text-orange-700 pl-3">
                                ↳ Failure results in consequence: {d.consequences.map(c => `"${c.action || 'unspecified'}"`).join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-slate-400 text-xs italic">No rules defined to summarize.</div>
              )}
            </div>
          </div>

          <div className="h-2/3 bg-white rounded-lg p-4 shadow border border-slate-200 flex flex-col">
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-500 border-b pb-2 mb-2">JSON-LD / TTL Output</h2>
            <textarea 
              className="w-full flex-1 font-mono text-[11px] bg-slate-900 text-emerald-400 p-3 rounded border border-slate-900 resize-none overflow-y-auto mb-2" 
              value={codeViewFormat === 'JSON-LD' ? jsonLd : convertJsonLdToTtl(jsonLd)} 
              readOnly 
            />
            <button 
              onClick={() => setCodeViewFormat(codeViewFormat === 'JSON-LD' ? 'TTL' : 'JSON-LD')} 
              className="w-full bg-slate-700 hover:bg-slate-800 text-white font-medium py-1.5 px-3 rounded shadow-sm text-xs transition-colors cursor-pointer"
            >
              {codeViewFormat === 'JSON-LD' ? 'Display TTL' : 'Display JSON-LD'}
            </button>
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