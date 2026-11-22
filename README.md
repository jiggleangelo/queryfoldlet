# Queryfoldlet — v1.0.0

Standalone original MIT original SQL formatter and advisory read-only query linter. Open index.html directly. No dependencies, server, database connection, execution, storage or network. Format SQL, review findings, and explicitly copy formatted SQL or its report. Input is never executed or written to a file. All output is literal text.

Formatting uppercases a constant keyword vocabulary and breaks at clauses, commas and semicolons, with bounded indentation inside parentheses. Other token content and order are preserved. Deliberately spaced punctuation is valid for the supported standard lexical forms; this is a readable review format rather than a dialect-specific pretty printer. Single-quoted strings with doubled escapes, double/backtick/bracket quoted identifiers with doubled escapes, national/bit/hex/E-prefixed strings without backslashes, numeric and hex/binary literals, named/positional parameters (including @@ variables), dollar-quoted strings, line comments and nested section comments are preserved. Adjacent string literals separated by a newline keep that newline. Line comments always terminate before the next token. A retokenization invariant rejects any output that would change token boundaries/content (except keyword case).

Not a SQL parser or dialect validator. Lexical forms use a documented mixed standard/Postgres-style subset; nested section comments and dollar quoting are dialect-dependent. Standard doubled-quote escapes only; backslashes in quoted forms, Oracle q and U& quote prefixes, executable MySQL comments and optimizer hints fail closed. Vendor commands, procedural delimiters, MySQL hash comments/standalone hash operators (rejected), SQLite dot commands and custom string introducers are unsupported. A syntactically invalid query may still format; success does not establish validity or semantic equivalence for every SQL dialect. Check formatted SQL with your dialect before any use elsewhere.

Read-only findings:

- NOT_READ_ONLY: write/transaction/administrative vocabulary, SELECT INTO, locking clauses, unknown statements and shapes other than SELECT/WITH containing SELECT. Matching reserved-looking unquoted words is conservative and can produce false positives. ReadQueryShape is only a lexical description; readOnlyProven is always false. Functions called from SELECT may mutate state or access external resources.
- MISSING_WHERE: UPDATE or DELETE lacking WHERE at its own parenthesis depth before a scope boundary, new statement or RETURNING. Nested/sibling CTE or subquery WHERE does not isolate it. A present WHERE is never proof of restrictive conditions; WHERE 1=1 still has full-table risk. This is a heuristic for ordinary DML, not procedural SQL or a complete grammar.
- SELECT_STAR: wildcard projection, including qualifier.* and DISTINCT/ALL *. COUNT(*) and ordinary multiplication are excluded. Vendor projection modifiers and exotic expressions may escape this heuristic.
- COMMA_JOIN: comma-separated sources in FROM, even with a WHERE predicate (an explicit join is clearer). Nested function/list commas are excluded.
- CARTESIAN_JOIN: explicit CROSS JOIN. JOIN_WITHOUT_PREDICATE: ordinary JOIN without same-scope ON/USING. NATURAL_JOIN warns about implicit name-dependent matching. TRIVIAL_JOIN_PREDICATE flags ON starting with TRUE or 1=1. A more complex tautology, parenthesized condition, OR TRUE or unrelated-column predicate may escape; an ON clause alone never proves a valid relationship.

Findings identify one-based statement and zero-based UTF-16 source offset. Semicolons split only outside strings/comments and at parenthesis depth zero. Nothing is labeled bounded. No findings means only that these heuristics did not match. Linting is unsuitable as an enforcement boundary or substitute for database read-only roles, permissions and independent query review.

Limits: 200,000 UTF-16 input units, 30,000 lexical tokens, 64 nested parentheses/section comments, 100 nonempty statements (and at most 100 top-level semicolon delimiters, including empty statements). Unbalanced parentheses, unterminated quotes/comments, unsupported characters and exhausted limits fail without partial output. At most 1,000,000 inner-scope linter scan steps; pathological inputs fail with an analysis-budget diagnostic rather than producing a partial report.

API: core.js exposes SQLFmt.analyze(sql), SQLFmt.tokenize(sql) and LIMITS in the browser and as CommonJS in Node. analyze returns formatted SQL, statement descriptors, findings, summary and readOnlyProven:false. Editing/clear/example invalidate output and pending copy notices. Clipboard denial selects output for manual copy. Copying reports includes source-derived SQL/literals; review before sharing. No history persists. No upstream implementation was copied.


## Run, test and fork

Open `index.html` beside the supplied JavaScript and CSS files, or use any static server. Run the tests with `node --test` in this folder (Node 22 or later); they need no network. Fork the MIT source and retain its license.

[Tool page](https://manykiln.com/tools/queryfoldlet/) · [Source code](https://github.com/jiggleangelo/queryfoldlet) · [Join the list](https://join.manykiln.com/?from=queryfoldlet) · [Privacy](https://manykiln.com/privacy)
