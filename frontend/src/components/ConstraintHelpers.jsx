import React from 'react';

export function renderLeftOperandSelect(value, onChangeHandler, dbLeftOperands) {
  const getLocalName = (str) => {
    if (!str) return '';
    if (str.includes('#')) return str.split('#').pop();
    if (str.includes('/')) return str.split('/').pop();
    if (str.includes(':')) return str.split(':').pop();
    return str;
  };

  const targetNorm = getLocalName(value);
  const matchingEntry = dbLeftOperands.find(([path, uri]) => 
    uri === value || path === value || getLocalName(uri) === targetNorm || getLocalName(path) === targetNorm
  );

  const selectedValue = matchingEntry ? matchingEntry[1] : value;
  const optionsToRender = [...dbLeftOperands];
  if (value && !matchingEntry) {
    optionsToRender.unshift([value, value, 'Loaded custom operand']);
  }

  return (
    <select className="w-2/5 min-w-0 border p-1 rounded text-xs bg-white shrink-0 truncate font-medium" value={selectedValue || ''} onChange={onChangeHandler}>
      <option value="" disabled>-- Left Operand --</option>
      {optionsToRender.length > 0 ? (
        optionsToRender.map(([path, uri, definition]) => (
          <option key={uri} value={uri} title={definition}>{path}</option>
        ))
      ) : (
        <>
          <option value="http://www.w3.org/ns/odrl/2/dateTime">dateTime</option>
          <option value="http://www.w3.org/ns/odrl/2/spatial">spatial</option>
          <option value="http://www.w3.org/ns/odrl/2/purpose">purpose</option>
        </>
      )}
    </select>
  );
}

export function renderOperatorSelect(value, onChangeHandler, dbOperators) {
  const normalizeOp = (op) => {
    if (op === 'eq' || op === '=') return '=';
    if (op === 'lt' || op === '<') return '<';
    if (op === 'gt' || op === '>') return '>';
    return op;
  };

  const currentNorm = normalizeOp(value);
  const defaultOps = [
    ['=', 'eq', 'Equal to'],
    ['<', 'lt', 'Less than'],
    ['>', 'gt', 'Greater than'],
    ['>=', 'gte', 'Greater than or equal'],
    ['<=', 'lte', 'Less than or equal'],
    ['!=', 'neq', 'Not equal']
  ];

  const sourceList = dbOperators.length > 0 ? dbOperators : defaultOps;
  const matchingEntry = sourceList.find(([path, uri]) => 
    uri === value || path === value || normalizeOp(uri) === currentNorm || normalizeOp(path) === currentNorm
  );

  const selectedValue = matchingEntry ? matchingEntry[1] : value;
  const optionsToRender = [...sourceList];
  if (value && !matchingEntry) {
    optionsToRender.unshift([value, value, 'Loaded operator']);
  }

  return (
    <select className="w-20 min-w-0 border p-1 rounded text-xs bg-white shrink-0 font-medium" value={selectedValue || ''} onChange={onChangeHandler}>
      <option value="" disabled>-- Op --</option>
      {optionsToRender.map(([path, uri, definition]) => (
        <option key={uri} value={uri} title={definition}>{path}</option>
      ))}
    </select>
  );
}

export function renderRightOperandInput(value, onChangeHandler) {
  return (
    <input type="text" className="flex-1 min-w-0 border p-1 rounded text-xs bg-white font-mono truncate" value={value ?? ''} onChange={onChangeHandler} placeholder="Operand value or URI" />
  );
}