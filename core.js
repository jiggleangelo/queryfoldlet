/* MIT · Original bounded SQL lexer, formatter and conservative advisory linter. */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({input: 200000, tokens: 30000, depth: 64, statements: 100, scans: 1000000});
  const KEYWORDS = new Set(('SELECT DISTINCT ALL FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET FETCH FIRST ROWS ONLY JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL ON USING AS UNION INTERSECT EXCEPT WITH RECURSIVE INSERT INTO UPDATE DELETE SET VALUES CREATE ALTER DROP TRUNCATE MERGE REPLACE GRANT REVOKE CALL EXEC EXECUTE DO COPY VACUUM ANALYZE EXPLAIN RETURNING AND OR NOT NULL IS IN EXISTS BETWEEN LIKE ILIKE CASE WHEN THEN ELSE END ASC DESC NULLS LAST OVER PARTITION WINDOW FOR SHARE OF SKIP LOCKED NOWAIT TRUE FALSE LATERAL TOP QUALIFY EXCLUDE').split(' '));
  const WRITES = new Set('INSERT UPDATE DELETE CREATE ALTER DROP TRUNCATE MERGE REPLACE GRANT REVOKE CALL EXEC EXECUTE DO COPY VACUUM ANALYZE ATTACH DETACH PRAGMA REINDEX REFRESH UPSERT LOAD INSTALL SET RESET BEGIN COMMIT ROLLBACK SAVEPOINT RELEASE LOCK UNLOCK'.split(' '));
  const isComment = t => t.kind === 'comment';
  const word = t => t && t.kind === 'word' ? t.value.toUpperCase() : '';
  function tokenize(sql) {
    if (typeof sql !== 'string' || sql.length > LIMITS.input) throw Error('SQL must be text of at most ' + LIMITS.input + ' characters');
    const out = []; let i = 0, depth = 0, count = 0, gap = '';
    const fail = message => { throw Error(message + ' at SQL offset ' + i); };
    function push(start, kind) {
      const value = sql.slice(start, i); if (value === ')') { if (--depth < 0) fail('Unmatched closing parenthesis'); }
      out.push({value, kind, depth, offset: start, gap}); gap = '';
      if (value === '(' && ++depth > LIMITS.depth) fail('Parenthesis nesting limit exceeded');
      if (out.length > LIMITS.tokens) fail('SQL token limit exceeded');
      if (value === ';' && depth === 0 && ++count > LIMITS.statements) fail('Statement limit exceeded');
    }
    function quoted(close, doubled = true) {
      i++;
      while (i < sql.length) {
        // Backslash string dialects are ambiguous; fail closed instead of reformatting them.
        if (sql[i] === '\\') fail('Backslash escapes are unsupported; use standard doubled quote escapes');
        if (sql[i++] === close) { if (doubled && sql[i] === close) { i++; continue; } return; }
      }
      fail('Unterminated quoted token');
    }
    while (i < sql.length) {
      if (/\s/.test(sql[i])) { gap += sql[i++]; continue; }
      if (/[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(sql[i])) fail('Unsupported control character');
      const start = i, c = sql[i];
      if (sql.startsWith('--', i)) { i += 2; while (i < sql.length && !/[\r\n]/.test(sql[i])) i++; push(start, 'comment'); continue; }
      if (sql.startsWith('/*', i)) {
        let nesting = 1; i += 2;
        while (i < sql.length && nesting) { if (sql.startsWith('/*', i)) { if (++nesting > LIMITS.depth) fail('Comment nesting limit exceeded'); i += 2; } else if (sql.startsWith('*/', i)) { nesting--; i += 2; } else i++; }
        if (nesting) fail('Unterminated block comment');
        // Optimizer hints and MySQL executable comments can contain instructions.
        if (/^\/\*[!+]/.test(sql.slice(start, i))) fail('Executable comments and optimizer hints are unsupported');
        push(start, 'comment'); continue;
      }
      if (/^[uU]&['"]/.test(sql.slice(i)) || /^[qQ]'/.test(sql.slice(i))) fail('Unicode and alternative quote prefixes are unsupported');
      if (/^[nNbBxXeE]'/.test(sql.slice(i))) { i++; quoted("'"); push(start, 'string'); continue; }
      if (c === "'" || c === '"' || c === '`' || c === '[') { quoted(c === '[' ? ']' : c); push(start, c === "'" ? 'string' : 'identifier'); continue; }
      const dollar = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (dollar) { i += dollar[0].length; const end = sql.indexOf(dollar[0], i); if (end < 0) fail('Unterminated dollar quote'); i = end + dollar[0].length; push(start, 'string'); continue; }
      const parameter = /^(?::[A-Za-z_][A-Za-z0-9_]*|\$[0-9]+|@{1,2}[A-Za-z_][A-Za-z0-9_]*)/.exec(sql.slice(i));
      if (parameter && !sql.startsWith('::', i)) { i += parameter[0].length; push(start, 'parameter'); continue; }
      const number = /^(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(sql.slice(i));
      if (number) { i += number[0].length; push(start, 'number'); continue; }
      const name = /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_$\u0080-\uFFFF]*/.exec(sql.slice(i));
      if (name) { i += name[0].length; push(start, 'word'); continue; }
      if ('(),;.?'.includes(c)) { i++; push(start, 'punct'); continue; }
      if (c === '#' && !sql.startsWith('#>', i)) fail('Hash comments and standalone hash operators are unsupported');
      if (sql.startsWith('::', i) || sql.startsWith(':=', i)) { i += 2; push(start, 'operator'); continue; }
      if (/[-+*/%=<>!~^|&:#@]/.test(c)) {
        i++; while (i < sql.length && /[-+*/%=<>!~^|&:#@]/.test(sql[i]) && !sql.startsWith('--', i) && !sql.startsWith('/*', i) && !/^(?::|@{1,2})[A-Za-z_]/.test(sql.slice(i)) && !(sql[i] === '#' && !sql.startsWith('#>', i))) i++;
        push(start, 'operator'); continue;
      }
      fail('Unsupported SQL character ' + c);
    }
    if (depth) fail('Unclosed parenthesis');
    return out;
  }
  function formatTokens(tokens) {
    const lines = []; let line = '', previous;
    const flush = () => { if (line.trim()) lines.push(line.trimEnd()); line = ''; };
    const breaks = new Set('SELECT FROM WHERE HAVING LIMIT OFFSET FETCH JOIN ON UNION INTERSECT EXCEPT RETURNING SET VALUES QUALIFY'.split(' '));
    for (let n = 0; n < tokens.length; n++) {
      const t = tokens[n], w = word(t), next = word(tokens[n + 1]), p = word(previous);
      const clause = breaks.has(w) || ((w === 'GROUP' || w === 'ORDER' || w === 'PARTITION') && next === 'BY') || (['LEFT','RIGHT','FULL','INNER','CROSS','NATURAL'].includes(w) && ['JOIN','OUTER','LEFT','RIGHT','FULL','INNER'].includes(next));
      if (clause && !(['LEFT','RIGHT','FULL','INNER','CROSS','NATURAL','OUTER'].includes(p) && (w === 'JOIN' || w === 'OUTER'))) flush();
      // SQL permits newline-separated adjacent string literals in some dialects.
      if (previous && previous.kind === 'string' && t.kind === 'string' && /[\r\n]/.test(t.gap)) flush();
      if (!line) line = '  '.repeat(Math.min(t.depth, LIMITS.depth));
      else line += ' ';
      line += t.kind === 'word' && KEYWORDS.has(w) ? w : t.value;
      if (t.value === ',' || t.value === ';' || (isComment(t) && t.value.startsWith('--'))) flush();
      previous = t;
    }
    flush(); return lines.join('\n');
  }
  function analyze(sql) {
    const tokens = tokenize(sql), meaningful = tokens.filter(t => !isComment(t));
    if (!meaningful.some(t => t.value !== ';')) throw Error('Enter at least one SQL statement');
    const groups = []; let group = [];
    for (const t of meaningful) { if (t.value === ';' && t.depth === 0) { if (group.length) groups.push(group); group = []; } else group.push(t); }
    if (group.length) groups.push(group);
    if (groups.length > LIMITS.statements) throw Error('Statement limit exceeded');
    const findings = [], statements = [];
    let scans = 0;
    const scan = () => { if (++scans > LIMITS.scans) throw Error('SQL analysis budget exceeded; simplify the query'); };
    const add = (code, severity, message, statement, token) => findings.push({code, severity, statement, offset: token.offset, message});
    groups.forEach((ts, index) => {
      const number = index + 1, writes = ts.filter(t => WRITES.has(word(t)));
      const hasSelect = ts.some(t => word(t) === 'SELECT'), first = word(ts[0]);
      const locking = ts.some((t, n) => word(t) === 'FOR' && ['UPDATE','SHARE','NO','KEY'].includes(word(ts[n + 1])));
      const into = ts.find(t => word(t) === 'INTO');
      const candidate = ['SELECT','WITH'].includes(first) && hasSelect && !writes.length && !locking && !into;
      statements.push({number, kind: first || 'unknown', readQueryShape: candidate, readOnlyProven: false});
      if (!candidate) add('NOT_READ_ONLY', 'error', 'Write, locking, unknown or unsupported statement shape; do not treat as read-only.', number, writes[0] || into || ts[0]);
      for (let n = 0; n < ts.length; n++) {
        const t = ts[n], w = word(t), d = t.depth;
        // A WHERE in a nested SELECT, sibling CTE or later UNION cannot protect a mutation.
        if (w === 'UPDATE' || w === 'DELETE') {
          if (w === 'UPDATE' && word(ts[n - 1]) === 'FOR') continue;
          let where = false;
          for (let j = n + 1; j < ts.length && ts[j].depth >= d; j++) {
            scan(); if (ts[j].depth !== d) continue;
            if (['UNION','RETURNING','UPDATE','DELETE','INSERT','SELECT'].includes(word(ts[j]))) break;
            if (word(ts[j]) === 'WHERE') { where = true; break; }
          }
          if (!where) add('MISSING_WHERE', 'error', w + ' has no WHERE in its own query scope. A WHERE is not proof of a restrictive predicate.', number, t);
        }
        if (w === 'SELECT') {
          let expressionStart = n + 1;
          for (let j = n + 1; j < ts.length && ts[j].depth >= d; j++) {
            scan(); if (ts[j].depth !== d) continue;
            const v = ts[j].value, jw = word(ts[j]);
            if (['FROM','INTO','WHERE','UNION','INTERSECT','EXCEPT'].includes(jw)) break;
            if (v === ',') { expressionStart = j + 1; continue; }
            if (['DISTINCT','ALL'].includes(jw) && j === expressionStart) { expressionStart++; continue; }
            const qualified = ts[j - 1]?.value === '.';
            if (v === '*' && (j === expressionStart || qualified)) add('SELECT_STAR', 'warning', 'Wildcard projection (SELECT * or qualifier.*); name required columns explicitly.', number, ts[j]);
          }
        }
        if (w === 'FROM') {
          for (let j = n + 1; j < ts.length && ts[j].depth >= d; j++) {
            scan(); if (ts[j].depth !== d) continue;
            if (['WHERE','GROUP','HAVING','ORDER','LIMIT','OFFSET','FETCH','UNION','INTERSECT','EXCEPT','RETURNING','SET'].includes(word(ts[j]))) break;
            if (ts[j].value === ',') add('COMMA_JOIN', 'warning', 'Comma-separated FROM sources can form a Cartesian product; use an explicit join predicate.', number, ts[j]);
          }
        }
        if (w === 'JOIN') {
          const prev = word(ts[n - 1]), prev2 = word(ts[n - 2]);
          const cross = prev === 'CROSS', natural = prev === 'NATURAL' || prev2 === 'NATURAL' || word(ts[n - 3]) === 'NATURAL';
          let predicate = false, predicateAt = -1;
          for (let j = n + 1; j < ts.length && ts[j].depth >= d; j++) {
            scan(); if (ts[j].depth !== d) continue;
            if (['JOIN','WHERE','GROUP','HAVING','ORDER','LIMIT','OFFSET','FETCH','UNION','RETURNING'].includes(word(ts[j])) || ts[j].value === ',') break;
            if (['ON','USING'].includes(word(ts[j]))) { predicate = true; predicateAt = j; break; }
          }
          if (cross) add('CARTESIAN_JOIN', 'warning', 'Explicit CROSS JOIN forms a Cartesian product.', number, t);
          else if (natural) add('NATURAL_JOIN', 'warning', 'NATURAL JOIN depends on matching column names; review implicit predicates.', number, t);
          else if (!predicate) add('JOIN_WITHOUT_PREDICATE', 'warning', 'JOIN has no ON or USING in its own scope; possible Cartesian product.', number, t);
          else {
            const on = predicateAt;
            if (word(ts[on]) === 'ON' && (word(ts[on + 1]) === 'TRUE' || (ts[on + 1]?.value === '1' && ts[on + 2]?.value === '=' && ts[on + 3]?.value === '1'))) add('TRIVIAL_JOIN_PREDICATE', 'warning', 'JOIN predicate starts with TRUE or 1=1; possible Cartesian product.', number, t);
          }
        }
      }
    });
    const formatted = formatTokens(tokens);
    // A formatter may change layout and keyword case only, never token content or order.
    const signature = list => list.map(t => [t.kind, t.kind === 'word' && KEYWORDS.has(word(t)) ? word(t) : t.value]);
    if (JSON.stringify(signature(tokenize(formatted))) !== JSON.stringify(signature(tokens))) throw Error('Formatting would change token boundaries; input left untouched');
    return {formatted, statements, findings, readOnlyProven: false, summary: 'Advisory lexical analysis only. Never executes SQL. Read-only behavior and query safety are NOT proven; functions, permissions, dialect and predicates require independent review.'};
  }
  const api = Object.freeze({analyze, tokenize, LIMITS});
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SQLFmt = api;
})(typeof globalThis === 'object' ? globalThis : this);
