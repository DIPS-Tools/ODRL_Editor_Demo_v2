import { useState, useEffect } from 'react';

/**
 * Custom hook to manage ODRL policy state, server synchronization, 
 * vocabulary data fetching, and JSON-LD compilation.
 */
export function useOdrlPolicy({ customUris = [] } = {}) {
  // Use an object structure for tracking active rules across permissions and prohibitions
  const [activePermissionIdx, setActivePermissionIdx] = useState({ type: 'permission', idx: 0 });

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

  // Core policy object state initialization (including prohibitions array)
  const [policy, setPolicy] = useState({
    type: 'odrl:Policy',
    uid: '',
    profile: ['file://../backend/DEFAULT_VOCABULARIES/ODRL_DPV.rdf'],
    assigner: null,
    assignee: null,
    conflict: null,
    targets: [],
    permissions: [],
    prohibitions: [],
	obligations: []
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
      const res = await fetch('api/policies');
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
        fetch('api/actions'),
        fetch('api/purposes'),
        fetch('api/leftOperands'),
        fetch('api/operators'),
        fetch('api/rightOperands')
      ]);

      if (actRes.ok) setDbActions(await actRes.json());
      if (purRes.ok) setDbPurposes(await purRes.json());
      if (leftRes.ok) setDbLeftOperands(await leftRes.json());
      if (opRes.ok) setDbOperators(await opRes.json());
      if (rightRes.ok) setDbRightOperands(await rightRes.json());
    } catch (err) {
      console.error("Could not fetch graph vocabularies:", err);
    }
  };

  useEffect(() => {
    fetchGraphVocabularies();
  }, []);

  /// Helper builder for constraints mapping supporting nested logical groups with validation
  const buildConstraintsObj = (constraints) => {
    if (!constraints || constraints.length === 0) return undefined;

    return constraints.map(item => {
      if (item.isGroup || item.type === 'group') {
        const logicalOp = item.logicalOp || item.operator || 'and';
        return {
          "@type": "LogicalConstraint",
          [logicalOp]: buildConstraintsObj(item.constraints) || []
        };
      } else {
        return {
          "@type": "odrl:Constraint",
          "odrl:leftOperand": { "@id": item.leftOperand },
          "odrl:operator": { "@id": item.operator },
          "odrl:rightOperand": item.rightOperand
        };
      }
    });
  };

  // Compile policy state into JSON-LD whenever policy data changes
  useEffect(() => {
    try {
      //const doc = {
      //  "@context": {
      //    "@vocab": "http://www.w3.org/ns/odrl/2/",
      //    "odrl": "http://www.w3.org/ns/odrl/2/"
      //  },
      //  "@type": policy.type || "Set",
      //  "@id": policy.uid || "urn:policy:unidentified"
      //};
	  
	  const doc = {
        "@context": {			
            //"odrl": "http://www.w3.org/ns/odrl.jsonld",
			"odrl": "http://www.w3.org/ns/odrl/2/",
            "dpv": "https://w3id.org/dpv/dpv-owl#",
			"rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
			// Transform the array of objects into key-value pairs for the context object
            ...(Array.isArray(customUris) 
              ? customUris.reduce((acc, item) => {
                  if (item && item.prefix && item.uri) {
                    acc[item.prefix.trim()] = item.uri.trim();
                  }
                  return acc;
                }, {}) 
              : {})         
        },
        "@type": policy.type || "Set",
        "@id": policy.uid || "urn:policy:unidentified"
      };

      // Replace: if (policy.profile) doc.profile = policy.profile;
      if (policy.profile) {
        const validProfiles = Array.isArray(policy.profile)
          ? policy.profile.filter(p => p && p.trim() !== '')
          : [policy.profile].filter(p => p && p.trim() !== '');

        if (validProfiles.length === 1) {
          doc.profile = validProfiles[0];
        } else if (validProfiles.length > 1) {
          doc.profile = validProfiles;
        }
      }
	  
      if (policy.assigner) doc["odrl:assigner"] = policy.assigner;
      if (policy.assignee) doc["odrl:assignee"] = policy.assignee;
      if (policy.conflict) doc["odrl:conflict"] = policy.conflict;

      if (policy.targets && policy.targets.length > 0) {
        const validTargets = policy.targets.filter(t => t && t.trim() !== '');
        if (validTargets.length === 1) {
          doc["odrl:target"] = { "@id": validTargets[0]};
        } else if (validTargets.length > 1) {
          doc["odrl:target"] = {
             "@type": "odrl:AssetCollection",
             // "source": validTargets.map(t => ({ "@id": t }))
			 "source": validTargets.map(t => ( t ))
          };
        }
      }
	  

      // Serialize Permissions
      if (policy.permissions && policy.permissions.length > 0) {
        doc["odrl:permission"] = policy.permissions.map(perm => {
          const pObj = {
            "@type": "odrl:Permission"
          };
		  
		  if (perm.uid) {
            pObj.uid = perm.uid; // Places uid at the top of the permission rule block
          }

          if (perm.action?.name) {
            if (perm.action.constraints && perm.action.constraints.length > 0) {
              pObj["odrl:action"] = {
                "@id": perm.action.name,
                "refinement": buildConstraintsObj(perm.action.constraints)
              };
            } else {
              pObj["odrl:action"] = { "@id": perm.action.name};
            }
          }

          //if (perm.target?.name) {
          //  pObj.target = perm.target.name;
          // }
		  
		  if (perm.target?.name) {
            const targetConstraints = buildConstraintsObj(perm.target.constraints);
            if (targetConstraints) {
              pObj["odrl:target"] = {
                "source": perm.target.name,
                "refinement": targetConstraints
              };
            } else {
              pObj["odrl:target"] = { "@id": perm.target.name};
            }
          }

          //if (perm.assigner) {
          //  pObj.assigner = {
          //    "@type": perm.assigner.type,
          //    ...(buildConstraintsObj(perm.assigner.constraints) && { "constraint": buildConstraintsObj(perm.assigner.constraints) })
          //  };
          //}
		  
		  if (perm.assigner) {
            // If there are constraints, keep the object structure; otherwise, just assign the type string
            const constraintsObj = buildConstraintsObj(perm.assigner.constraints);
  
            if (constraintsObj) {
               pObj["odrl:assigner"] = {
               "@type": perm.assigner.type,
               "constraint": constraintsObj
               };
            } else {
               //pObj["odrl:assigner"] = perm.assigner.type;
			   pObj["odrl:assigner"] = { "@id": perm.assigner.type};
            }
          }

          if (perm.actor) {
            //pObj.assignee = {
            //  "@type": perm.actor.type,
            //  ...(buildConstraintsObj(perm.actor.constraints) && { "constraint": buildConstraintsObj(perm.actor.constraints) })
            //};
			
			// If there are constraints, keep the object structure; otherwise, just assign the type string
            const constraintsObj = buildConstraintsObj(perm.actor.constraints);
  
            if (constraintsObj) {
               pObj["odrl:assignee"] = {
               "@type": perm.actor.type,
               "constraint": constraintsObj
               };
            } else {
               pObj["odrl:assignee"] = {"@id": perm.actor.type};
            }
          }

          //if (perm.purpose?.name) {
          //  pObj.purpose = perm.purpose.name;
          //}  
		  
		  //const globalConstraints = buildConstraintsObj(perm.constraints);
          //if (globalConstraints) {
          //  pObj.constraint = globalConstraints;
          //}
		  
		  // Build constraints list for permission
          let constraintsList = [];
          const globalConstraints = buildConstraintsObj(perm.constraints);

          if (perm.purpose?.name) {
            const purposeConstraint = {
              "@type": "odrl:Constraint",
              "odrl:leftOperand": "http://www.w3.org/ns/odrl/2/purpose",
              "odrl:operator": "eq",
              "odrl:rightOperand": perm.purpose.name
            };
			
			// Check specifically for purpose-specific constraints supplied by the user
            const purposeConstraints = buildConstraintsObj(perm.purpose.constraints);

            // If user-supplied constraints exist, group them using 'and'
            if (purposeConstraints && purposeConstraints.length > 0) {
              constraintsList.push({
                "@type": "LogicalConstraint",
                "and": [
                  purposeConstraint,
                  ...purposeConstraints
                ]
              });
            } else {
              // Otherwise, just use the simple purpose constraint block
              constraintsList.push(purposeConstraint);
            }
          }
		  
		  if (globalConstraints) {
            // If no purpose but global constraints exist
            constraintsList = constraintsList.concat(globalConstraints);
          }

          if (constraintsList.length > 0) {
            pObj["odrl:constraint"] = constraintsList;
          }
		 

          

          if (perm.duties && perm.duties.length > 0) {
            pObj.duty = perm.duties.map(duty => {
              const dObj = {};
			  
              // FIXED: Check duty.actionObj for action name and refinements, fallback to duty.action
              const dutyActionName = duty.actionObj?.name || duty.action;
              if (dutyActionName) {
                if (duty.actionObj?.constraints && duty.actionObj.constraints.length > 0) {
                  dObj["odrl:action"] = {
                    "@id": dutyActionName,
                    "refinement": buildConstraintsObj(duty.actionObj.constraints)
                  };
                } else {
                  dObj["odrl:action"] = { "@id": dutyActionName};
                }
              }
		
              //if (duty.assigner) {
              //  dObj.assigner = { "@type": duty.assigner.type };
              //}
			  
			  if (duty.assigner) {
                // If there are constraints, keep the object structure; otherwise, just assign the type string
                const constraintsObj = buildConstraintsObj(duty.assigner.constraints);
  
                if (constraintsObj) {
                   dObj.assigner = {
                   "@type": duty.assigner.type,
                   "constraint": constraintsObj
                   };
                } else {
                   dObj.assigner = duty.assigner.type;
                }
              }	  
			  
              //if (duty.actor) {
              //  dObj.assignee = { "@type": duty.actor.type };
              //}
			  
			  if (duty.actor) {
                // If there are constraints, keep the object structure; otherwise, just assign the type string
                const constraintsObj = buildConstraintsObj(duty.actor.constraints);
  
                if (constraintsObj) {
                   dObj.actor = {
                   "@type": duty.actor.type,
                   "constraint": constraintsObj
                   };
                } else {
                   dObj.actor = duty.actor.type;
                }
              }	  
			  
			  
              const dutyConst = buildConstraintsObj(duty.constraints);
              if (dutyConst) {
                dObj["odrl:constraint"] = dutyConst;
              }
              if (duty.consequences && duty.consequences.length > 0) {
                dObj.consequence = duty.consequences.map(cons => ({
                  action: cons.action,
                  ...(buildConstraintsObj(cons.constraints) && { constraint: buildConstraintsObj(cons.constraints) })
                }));
              }
              return dObj;
            });
          }

          return pObj;
        });
      }

      // Serialize Prohibitions (Added to ensure block renders correctly)
      if (policy.prohibitions && policy.prohibitions.length > 0) {
        doc["odrl:prohibition"] = policy.prohibitions.map(prohib => {
          const prObj = {
            "@type": "odrl:Prohibition"
          };
		  
		  if (prohib.uid) {
            prObj.uid = prohib.uid; // Places uid at the top of the prohibition rule block
          }

          if (prohib.action?.name) {
            if (prohib.action.constraints && prohib.action.constraints.length > 0) {
              prObj["odrl:action"] = {
                "@id": prohib.action.name,
                "refinement": buildConstraintsObj(prohib.action.constraints)
              };
            } else {
              prObj["odrl:action"] = { "@id": prohib.action.name};
            }
          }

          //if (prohib.target?.name) {
          //  prObj.target = prohib.target.name;
          //}
		  
		  if (prohib.target?.name) {
            const targetConstraints = buildConstraintsObj(prohib.target.constraints);
            if (targetConstraints) {
              prObj.target = {
                "source": prohib.target.name,
                "refinement": targetConstraints
              };
            } else {
              prObj.target = prohib.target.name;
            }
          }

          //if (prohib.assigner) {
          //  prObj.assigner = {
          //    "@type": prohib.assigner.type,
          //    ...(buildConstraintsObj(prohib.assigner.constraints) && { "constraint": buildConstraintsObj(prohib.assigner.constraints) })
          //  };
          //}
		  
		  if (prohib.assigner) {
            // If there are constraints, keep the object structure; otherwise, just assign the type string
            const constraintsObj = buildConstraintsObj(prohib.assigner.constraints);
  
            if (constraintsObj) {
               prObj.assigner = {
               "@type": prohib.assigner.type,
               "constraint": constraintsObj
               };
            } else {
			   prObj["odrl:assigner"] = { "@id": prohib.assigner.type};
            }
          }

          //if (prohib.actor) {
          //  prObj.assignee = {
          //    "@type": prohib.actor.type,
          //    ...(buildConstraintsObj(prohib.actor.constraints) && { "constraint": buildConstraintsObj(prohib.actor.constraints) })
          //  };
          //}
		  
		  if (prohib.actor) {
            // If there are constraints, keep the object structure; otherwise, just assign the type string
            const constraintsObj = buildConstraintsObj(prohib.actor.constraints);
  
            if (constraintsObj) {
               prObj.assignee = {
               "@type": prohib.actor.type,
               "constraint": constraintsObj
               };
            } else {
			   prObj["odrl:assignee"] = { "@id": prohib.actor.type};
            }
          }

          //if (prohib.purpose?.name) {
          //  prObj.purpose = prohib.purpose.name;
          //}		  

          //const globalConstraints = buildConstraintsObj(prohib.constraints);
          //if (globalConstraints) {
          //  prObj.constraint = globalConstraints;
          //}
		  
		  // Build constraints list for prohibition
          let prohibConstraintsList = [];
          const globalConstraintsProhib = buildConstraintsObj(prohib.constraints);

          if (prohib.purpose?.name) {
            const purposeConstraint = {
              "@type": "odrl:Constraint",
              "odrl:leftOperand": "http://www.w3.org/ns/odrl/2/purpose",
              "odrl:operator": "eq",
              "odrl:rightOperand": prohib.purpose.name
            };
			
			// Check specifically for purpose-specific constraints supplied by the user
            const purposeConstraintsProhib = buildConstraintsObj(prohib.purpose.constraints);

            // If user-supplied constraints exist, group them using 'and'
            if (purposeConstraintsProhib && purposeConstraintsProhib.length > 0) {
              prohibConstraintsList.push({
                "@type": "LogicalConstraint",
                "and": [
                  purposeConstraint,
                  ...purposeConstraintsProhib
                ]
              });
            } else {
              // Otherwise, just use the simple purpose constraint block
              prohibConstraintsList.push(purposeConstraint);
            }
          } 
		  
		  if (globalConstraintsProhib) {
            // If no purpose but global constraints exist
            prohibConstraintsList = prohibConstraintsList.concat(globalConstraintsProhib);
          }

          if (prohibConstraintsList.length > 0) {
            prObj["odrl:constraint"] = prohibConstraintsList;
          }
		  
		  if (prohib.duties && prohib.duties.length > 0) {
            prObj.remedy = prohib.duties.map(duty => {
              const dObj = {};
              
              const dutyActionName = duty.actionObj?.name || duty.action;
              if (dutyActionName) {
                if (duty.actionObj?.constraints && duty.actionObj.constraints.length > 0) {
                  dObj["odrl:action"] = {
                    "@id": dutyActionName,
                    "refinement": buildConstraintsObj(duty.actionObj.constraints)
                  };
                } else {
                  dObj["odrl:action"] = { "@id": dutyActionName};
                }
              }

              if (duty.assigner) {
                const constraintsObj = buildConstraintsObj(duty.assigner.constraints);
                if (constraintsObj) {
                  dObj.assigner = {
                    "@type": duty.assigner.type,
                    "constraint": constraintsObj
                  };
                } else {
                  dObj.assigner = duty.assigner.type;
                }
              }  

              if (duty.actor) {
                const constraintsObj = buildConstraintsObj(duty.actor.constraints);
                if (constraintsObj) {
                  dObj.actor = {
                    "@type": duty.actor.type,
                    "constraint": constraintsObj
                  };
                } else {
                  dObj.actor = duty.actor.type;
                }
              }  

              const dutyConst = buildConstraintsObj(duty.constraints);
              if (dutyConst) {
                dObj["odrl:constraint"] = dutyConst;
              }

              if (duty.consequences && duty.consequences.length > 0) {
                dObj.consequence = duty.consequences.map(cons => ({
                  action: cons.action,
                  ...(buildConstraintsObj(cons.constraints) && { constraint: buildConstraintsObj(cons.constraints) })
                }));
              }

              return dObj;
            });
          }

          return prObj;
        });
      }
	  
	  // Serialize Obligations
      if (policy.obligations && policy.obligations.length > 0) {
        doc["odrl:obligation"] = policy.obligations.map(obl => {
          const obObj = {
            "@type": "odrl:Obligation"
          };
		  
		  if (obl.uid) {
            obObj.uid = obl.uid; // Places uid at the top of the obligation rule block
          }

          if (obl.action?.name) {
            if (obl.action.constraints && obl.action.constraints.length > 0) {
              obObj["odrl:action"] = {
                "@id": obl.action.name,
                "refinement": buildConstraintsObj(obl.action.constraints)
              };
            } else {
              obObj["odrl:action"] = { "@id": obl.action.name};
            }
          }

          if (obl.target?.name) {
            const targetConstraints = buildConstraintsObj(obl.target.constraints);
            if (targetConstraints) {
              obObj.target = {
                "source": obl.target.name,
                "refinement": targetConstraints
              };
            } else {
              obObj.target = obl.target.name;
            }
          }

          if (obl.assigner) {
            const constraintsObj = buildConstraintsObj(obl.assigner.constraints);
            if (constraintsObj) {
              obObj.assigner = {
                "@type": obl.assigner.type,
                "constraint": constraintsObj
              };
            } else {
			  obObj["odrl:assigner"] = { "@id": obl.assigner.type};
            }
          }

          if (obl.actor) {
            const constraintsObj = buildConstraintsObj(obl.actor.constraints);
            if (constraintsObj) {
              obObj.assignee = {
                "@type": obl.actor.type,
                "constraint": constraintsObj
              };
            } else {
			  obObj["odrl:assignee"] = { "@id": obl.actor.type};
            }
          }

          let constraintsList = [];
          const globalConstraints = buildConstraintsObj(obl.constraints);

          if (obl.purpose?.name) {
            const purposeConstraint = {
              "@type": "odrl:Constraint",
              "odrl:leftOperand": "http://www.w3.org/ns/odrl/2/purpose",
              "odrl:operator": "eq",
              "odrl:rightOperand": obl.purpose.name
            };
            const purposeConstraints = buildConstraintsObj(obl.purpose.constraints);
            if (purposeConstraints && purposeConstraints.length > 0) {
              constraintsList.push({
                "@type": "LogicalConstraint",
                "and": [
                  purposeConstraint,
                  ...purposeConstraints
                ]
              });
            } else {
              constraintsList.push(purposeConstraint);
            }
          }

          if (globalConstraints) {
            constraintsList = constraintsList.concat(globalConstraints);
          }

          if (constraintsList.length > 0) {
            obObj["odrl:constraint"] = constraintsList;
          }
		  
		  if (obl.duties && obl.duties.length > 0) {
            obObj.consequence = obl.duties.map(duty => {
              const dObj = {};
              
              const dutyActionName = duty.actionObj?.name || duty.action;
              if (dutyActionName) {
                if (duty.actionObj?.constraints && duty.actionObj.constraints.length > 0) {
                  dObj["odrl:action"] = {
                    "@id": dutyActionName,
                    "refinement": buildConstraintsObj(duty.actionObj.constraints)
                  };
                } else {
                  dObj["odrl:action"] = { "@id": dutyActionName};
                }
              }

              if (duty.assigner) {
                const constraintsObj = buildConstraintsObj(duty.assigner.constraints);
                if (constraintsObj) {
                  dObj.assigner = {
                    "@type": duty.assigner.type,
                    "constraint": constraintsObj
                  };
                } else {
                  dObj.assigner = duty.assigner.type;
                }
              }  

              if (duty.actor) {
                const constraintsObj = buildConstraintsObj(duty.actor.constraints);
                if (constraintsObj) {
                  dObj.actor = {
                    "@type": duty.actor.type,
                    "constraint": constraintsObj
                  };
                } else {
                  dObj.actor = duty.actor.type;
                }
              }  

              const dutyConst = buildConstraintsObj(duty.constraints);
              if (dutyConst) {
                dObj["odrl:constraint"] = dutyConst;
              }

              if (duty.consequences && duty.consequences.length > 0) {
                dObj.consequence = duty.consequences.map(cons => ({
                  action: cons.action,
                  ...(buildConstraintsObj(cons.constraints) && { constraint: buildConstraintsObj(cons.constraints) })
                }));
              }

              return dObj;
            });
          }
      
          return obObj;
        });
      }

      setJsonLd(JSON.stringify(doc, null, 2));
    } catch (e) {
      console.error("Failed to compile JSON-LD:", e);
    }
  }, [policy]);

  // Handler to load server policy file into editor
  const handleLoadServerPolicy = async (filename) => {
    try {
      const res = await fetch(`api/policies/${filename}`);
      if (res.ok) {
        const data = await res.json();
		
		// Support both namespaced and shorthand keys for robustness[cite: 13]
        const rawPermissions = data["odrl:Permission"] || data.permission;
        const rawProhibitions = data["odrl:Prohibition"] || data.prohibition;
        const rawObligations = data["odrl:Obligation"] || data.obligation;
		
        setPolicy({
          type: data["@type"] || 'Agreement',
          uid: data["@id"] || data.uid || '',
          profile: data.profile ? (Array.isArray(data.profile) ? data.profile : [data.profile]) : '',
          assigner: data.assigner || null,
          assignee: data.assignee || null,
          conflict: data.conflict || null,
          targets: data.target ? (Array.isArray(data.target) ? data.target : [data.target]) : [],
          permissions: rawPermissions ? (Array.isArray(rawPermissions) ? rawPermissions : [rawPermissions]) : [],
          prohibitions: rawProhibitions ? (Array.isArray(rawProhibitions) ? rawProhibitions : [rawProhibitions]) : [],
		  obligations:rawObligations ? (Array.isArray(rawObligations) ? rawObligations : [rawObligations]) : []
        });
        setShowDropdown(false);
        setBackendStatus(`Loaded policy: ${filename}`);
      }
    } catch (err) {
      console.error("Failed to load server policy file:", err);
      setBackendStatus(`Error loading policy: ${filename}`);
    }
  };

  // Publish policy handler
  const handlePublish = async () => {
    try {
      setBackendStatus('Publishing policy...');
      const res = await fetch('api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonLd
      });
      if (res.ok) {
        setBackendStatus('Policy published successfully.');
        fetchServerFiles();
      } else {
        setBackendStatus('Failed to publish policy.');
      }
    } catch (err) {
      console.error("Publish network error:", err);
      setBackendStatus('Network error during publishing.');
    }
  };

  // Validate SHACL report handler
  const handleValidateShacl = async () => {
    setShaclResult({ loading: true, message: 'Validating against SHACL shapes...' });
    try {
      const res = await fetch('api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonLd
      });
      if (res.ok) {
        const result = await res.json();
        setShaclResult({
          loading: false,
          //valid: result.conforms,
          // message: result.conforms ? 'Policy conforms to SHACL rules.' : 'SHACL validation violations found.',
		  valid: result.valid, // Fixed: changed from result.conforms to result.valid
          message: result.message || (result.valid ? 'Policy conforms to SHACL rules.' : 'SHACL validation violations found.'), // Uses backend message directly
          report: result.report || ''
        });
      } else {
        setShaclResult({ loading: false, valid: false, message: 'Validation service error.' });
      }
    } catch (err) {
      console.error("SHACL validation failed:", err);
      setShaclResult({ loading: false, valid: false, message: 'Could not connect to SHACL validator.' });
    }
  };

  return {
    activePermissionIdx, setActivePermissionIdx,
    showVocabModal, setShowVocabModal,
    vocabOutput, setVocabOutput,
    policy, setPolicy,
    jsonLd, backendStatus,
    shaclResult, showShaclReport, setShowShaclReport,
    serverFiles, showDropdown, setShowDropdown,
    dbActions, dbPurposes, dbLeftOperands, dbOperators, dbRightOperands,
    fetchServerFiles, handleLoadServerPolicy, handlePublish, handleValidateShacl, fetchGraphVocabularies
  };
}