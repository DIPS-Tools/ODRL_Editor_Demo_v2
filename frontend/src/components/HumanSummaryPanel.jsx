// components/HumanSummaryPanel.jsx
import React from 'react';

export default function HumanSummaryPanel({ policy, activePermissionIdx }) {
  return (
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
            <div key={`perm-${index}`} className={`p-2 border-l-2 bg-slate-50 rounded-r transition-all ${activePermissionIdx.type === 'permission' && index === activePermissionIdx.idx ? 'border-blue-600 font-medium' : 'border-slate-300 opacity-60'}`}>
              <span className="font-bold text-blue-800 block mb-1">
                Permission Rule #{index + 1}: {activePermissionIdx.type === 'permission' && index === activePermissionIdx.idx && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 rounded py-0.5 ml-1">Viewing</span>}
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
        ) : null}

        {policy.prohibitions?.length > 0 ? (
          policy.prohibitions.map((prohib, index) => (
            <div key={`prohib-${index}`} className={`p-2 border-l-2 bg-slate-50 rounded-r transition-all ${activePermissionIdx.type === 'prohibition' && index === activePermissionIdx.idx ? 'border-rose-600 font-medium' : 'border-slate-300 opacity-60'}`}>
              <span className="font-bold text-rose-800 block mb-1">
                Prohibition Rule #{index + 1}: {activePermissionIdx.type === 'prohibition' && index === activePermissionIdx.idx && <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 rounded py-0.5 ml-1">Viewing</span>}
              </span>
              <p>
                Prohibits execution of <span className="bg-rose-100 text-rose-800 px-1 font-mono text-[10px] break-all rounded">{prohib.action?.name || 'unspecified action'}</span> on <code>{prohib.target?.name || 'unspecified target'}</code>
                {prohib.assigner && <span> issued by a rule <span className="bg-slate-100 text-slate-800 px-1 font-mono rounded">{prohib.assigner.type}</span></span>}
                {prohib.actor && <span> for a <span className="bg-indigo-100 text-indigo-800 px-1 font-mono rounded">{prohib.actor.type}</span></span>}
                {prohib.purpose && <span> with purpose <span className="bg-purple-100 text-purple-800 px-1 font-mono text-[10px] break-all rounded">{prohib.purpose.name || 'unspecified purpose'}</span></span>}.
              </p>
            </div>
          ))
        ) : null}

        {(!policy.permissions?.length && !policy.prohibitions?.length) && (
          <div className="text-slate-400 text-xs italic">No rules defined to summarize.</div>
        )}
      </div>
    </div>
  );
}