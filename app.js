/* MIT */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let revision = 0;
  function invalidate(message = 'Input changed. Format and lint again.') {
    revision++; $('output').hidden = true; $('report').textContent = ''; $('formatted').textContent = ''; $('findings').replaceChildren(); $('copy-report').disabled = true; $('copy-sql').disabled = true; $('status').textContent = message;
  }
  $('sql').addEventListener('input', () => invalidate());
  $('clear').addEventListener('click', () => { $('sql').value = ''; invalidate('Cleared. No query is retained.'); });
  $('example').addEventListener('click', () => {
    $('sql').value = "select u.*, r.name from users u cross join roles r where u.active = true;\nupdate jobs set status = 'synthetic-demo';\ndelete from audit where id = :id;";
    invalidate('Synthetic example loaded. Format and lint to inspect risks.');
  });
  $('run').addEventListener('click', () => {
    invalidate('Formatting locally…');
    try {
      const result = SQLFmt.analyze($('sql').value);
      $('formatted').textContent = result.formatted; $('report').textContent = JSON.stringify(result, null, 2);
      for (const finding of result.findings) { const li = document.createElement('li'); li.textContent = finding.severity.toUpperCase() + ' · statement ' + finding.statement + ' · ' + finding.code + ': ' + finding.message; $('findings').append(li); }
      if (!result.findings.length) { const li = document.createElement('li'); li.textContent = 'No listed heuristic matched. Read-only behavior and query safety remain unproven.'; $('findings').append(li); }
      $('output').hidden = false; $('copy-report').disabled = false; $('copy-sql').disabled = false;
      $('status').textContent = result.statements.length + ' statement(s), ' + result.findings.length + ' finding(s). Advisory only; read-only behavior is NOT proven.';
    } catch (error) { $('status').textContent = error.message; }
  });
  for (const [button, target] of [['copy-report', 'report'], ['copy-sql', 'formatted']]) $(button).addEventListener('click', async () => {
    const rev = revision, text = $(target).textContent; if (!text) return;
    try { await navigator.clipboard.writeText(text); if (revision === rev) $('status').textContent = 'Copied ' + (target === 'report' ? 'report' : 'formatted SQL') + '. Review before sharing or running elsewhere.'; }
    catch { if (revision !== rev) return; const range = document.createRange(); range.selectNodeContents($(target)); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); $(target).focus(); $('status').textContent = 'Clipboard unavailable. Output selected; copy manually.'; }
  });
})();
