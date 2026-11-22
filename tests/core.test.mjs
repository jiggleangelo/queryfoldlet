/* MIT · Synthetic SQL only; no database connection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import api from '../core.js';


const {analyze,tokenize,LIMITS}=api, codes=q=>analyze(q).findings.map(f=>f.code);
const fixtures=[
 ['select id, name from projects where active = true',[],true],
 ['SELECT * FROM t',['SELECT_STAR'],true],
 ['select distinct * from t',['SELECT_STAR'],true],
 ['select all t.* from t',['SELECT_STAR'],true],
 ['select a.*, b.* from a join b on a.id=b.id',['SELECT_STAR','SELECT_STAR'],true],
 ['select count(*) from t',[],true],
 ['select a * b from t',[],true],
 ['select count(*), amount * rate from t',[],true],
 ['select (select * from b) from a',['SELECT_STAR'],true],
 ['update t set x=1',['NOT_READ_ONLY','MISSING_WHERE'],false],
 ['delete from t',['NOT_READ_ONLY','MISSING_WHERE'],false],
 ['update t set x=1 where id=2',['NOT_READ_ONLY'],false],
 ['delete from t where id=2',['NOT_READ_ONLY'],false],
 ['update t set x=(select id from a where id=1)',['NOT_READ_ONLY','MISSING_WHERE'],false],
 ['update t set x=(select id from a where id=1) where id=2',['NOT_READ_ONLY'],false],
 ['delete from t using (select id from a where id=1) a',['NOT_READ_ONLY','MISSING_WHERE'],false],
 ['with a as (select id from t where id=1) delete from b',['NOT_READ_ONLY','MISSING_WHERE'],false],
 ['with a as (delete from t returning id) select id from a',['NOT_READ_ONLY','MISSING_WHERE'],false],
 ['with a as (update t set x=1 where id=1 returning id) select id from a',['NOT_READ_ONLY'],false],
 ['select id from a cross join b',['CARTESIAN_JOIN'],true],
 ['select id from a join b',['JOIN_WITHOUT_PREDICATE'],true],
 ['select id from a inner join b on a.id=b.id',[],true],
 ['select id from a left outer join b using (id)',[],true],
 ['select id from a full join b on a.id=b.id join c',['JOIN_WITHOUT_PREDICATE'],true],
 ['select id from a join (select id from b join c on b.id=c.id) d',['JOIN_WITHOUT_PREDICATE'],true],
 ['select id from a join b on true',['TRIVIAL_JOIN_PREDICATE'],true],
 ['select id from a join b on 1=1',['TRIVIAL_JOIN_PREDICATE'],true],
 ['select id from a natural join b',['NATURAL_JOIN'],true],
 ['select id from a natural left outer join b',['NATURAL_JOIN'],true],
 ['select id from a, b where a.id=b.id',['COMMA_JOIN'],true],
 ['select id from fn(1,2) a join b on a.id=b.id',[],true],
 ['select id from (select id from a,b) q',['COMMA_JOIN'],true],
 ['select id from a join b on a.id=b.id, c',['COMMA_JOIN'],true],
 ["select 'DELETE FROM t; SELECT * FROM a,b' as text",[],true],
 ['select "UPDATE", "*", `delete`, [drop] from t',[],true],
 ['select id from a -- join b\nwhere id=1',[],true],
 ['select id /* UPDATE t; SELECT * */ from t',[],true],
 ['select $$DELETE FROM t; select *$$ as text',[],true],
 ['select $tag$join a,b; delete from t$tag$ as text',[],true],
 ['select id into new_table from t',['NOT_READ_ONLY'],false],
 ['select id from t for update',['NOT_READ_ONLY'],false],
 ['select id from t for share',['NOT_READ_ONLY'],false],
 ['explain select id from t',['NOT_READ_ONLY'],false],
 ['values (1), (2)',['NOT_READ_ONLY'],false],
 ['pragma query_only=on',['NOT_READ_ONLY'],false],
 ['insert into t(id) values(1)',['NOT_READ_ONLY'],false],
 ['create table t(id int)',['NOT_READ_ONLY'],false],
 ['drop table t',['NOT_READ_ONLY'],false],
 ['call fictional_proc()',['NOT_READ_ONLY'],false],
 ['select dangerous_function()',[],true],
 ['select 1 where true',[],true]
];
for(const [sql,expected,candidate] of fixtures)test('lint '+sql,()=>{const r=analyze(sql);assert.deepEqual(r.findings.map(f=>f.code),expected);assert.equal(r.statements[0].readQueryShape,candidate);assert.equal(r.readOnlyProven,false);assert.equal(r.statements[0].readOnlyProven,false);assert.match(r.summary,/NOT proven/);for(const f of r.findings){assert.equal(f.statement,1);assert.ok(Number.isInteger(f.offset)&&f.offset>=0&&f.offset<sql.length);}});
for(const verb of ['alter table t add x int','truncate t','merge into t using s on t.id=s.id','replace into t values(1)','grant select on t to fictional','revoke select on t from fictional','exec fictional','execute fictional','do $$ begin end $$','copy t to stdout','vacuum t','analyze t','attach database \'fictional\' as x','refresh materialized view v','begin','commit','rollback','lock table t'])test('non-readonly '+verb,()=>assert.ok(codes(verb).includes('NOT_READ_ONLY')));
test('statement split ignores quoted/comment/dollar semicolons',()=>{const r=analyze("select ';' as x; /* ; */ update t set x=$$;$$; delete from t where id=:id;");assert.equal(r.statements.length,3);assert.deepEqual(r.findings.map(f=>[f.statement,f.code]),[[2,'NOT_READ_ONLY'],[2,'MISSING_WHERE'],[3,'NOT_READ_ONLY']]);});
test('sibling CTE WHERE cannot protect mutation',()=>assert.ok(codes('with a as (delete from t returning id), b as (select id from x where id=1) select id from b').includes('MISSING_WHERE')));
test('WHERE does not certify restrictive predicates',()=>{const r=analyze('update t set x=1 where 1=1');assert.deepEqual(r.findings.map(f=>f.code),['NOT_READ_ONLY']);assert.equal(r.readOnlyProven,false);});
test('comments cannot fabricate WHERE or ON',()=>{assert.ok(codes('delete from t /* WHERE id=1 */').includes('MISSING_WHERE'));assert.ok(codes("select id from a join b /* ON a.id=b.id */").includes('JOIN_WITHOUT_PREDICATE'));});
for(const q of ['', ' \n ', '-- only comment', '/* comment */', '; ;','select (1','select 1)',"select 'unfinished",'select "unfinished','select `unfinished','select [unfinished','select $$unfinished','select $tag$unfinished','select /* unfinished','select /* a /* b */',"select 'back\\slash'",'select \u0000', 'select /*! SQL_NO_CACHE */ id from t','select /*+ hint */ id from t',"select U&'escaped'", "select q'[oracle]'", 'select {', 'select id # hash comment', 'select 1+# comment'])test('reject malformed or unsupported '+JSON.stringify(q),()=>assert.throws(()=>analyze(q)));
test('parentheses and comment depth bounds',()=>{assert.ok(analyze('select '+'('.repeat(64)+'1'+')'.repeat(64)));assert.throws(()=>analyze('select '+'('.repeat(65)+'1'+')'.repeat(65)),/nesting/);assert.throws(()=>analyze('select '+'/*'.repeat(65)+'x'+'*/'.repeat(65)),/nesting/);});
test('resource limits and API arguments',()=>{assert.throws(()=>analyze(null));assert.throws(()=>analyze('x'.repeat(LIMITS.input+1)),/at most/);assert.throws(()=>analyze('select '+Array(16000).fill('1').join(',')),/token limit/);assert.throws(()=>analyze('select 1;'.repeat(101)),/Statement limit/);assert.throws(()=>analyze('select 1;'.repeat(100)+'select 1'),/Statement limit/);assert.equal(analyze('select 1;'.repeat(100)).statements.length,100);});
test('bounded pathological repeated scopes fail without partial output',()=>assert.throws(()=>analyze('select '.repeat(5000)+'1'),/analysis budget/));
test('format clauses, uppercase keywords and preserve names',()=>{const q=analyze('select CamelName, other from Fictional where other=:id order by CamelName desc;').formatted;assert.match(q,/SELECT CamelName ,\nother\nFROM Fictional\nWHERE other = :id\nORDER BY CamelName DESC ;/);});
test('literal and comment contents unchanged including multiline strings',()=>{
 const q="select N'Hello', E'plain', B'0101', X'ab', 'it''s', \"Odd\"\"Name\", `back``tick`, [a]]b], $x$line\n; -- untouched$x$, 0xAb, 0b01, 1., .5, 1.2e-4 /* a /* nested */ b */ from T -- trailing comment\nwhere id=$1 and x=:x and y=@y;";
 const before=tokenize(q),r=analyze(q),after=tokenize(r.formatted);
 const protectedKinds=new Set(['string','identifier','number','parameter','comment']);
 assert.deepEqual(after.filter(t=>protectedKinds.has(t.kind)).map(t=>[t.kind,t.value]),before.filter(t=>protectedKinds.has(t.kind)).map(t=>[t.kind,t.value]));
 assert.match(r.formatted,/-- trailing comment\n/);assert.equal(analyze(r.formatted).formatted,r.formatted);
});
test('adjacent newline-separated strings retain newline',()=>{assert.match(analyze("select 'a'\n'b'").formatted,/'a'\n'b'/);});
test('operator boundaries stay distinct',()=>{const r=analyze('select a - - b, c / * d, e ->> \'x\', f::int, a @> b from t');assert.equal(analyze(r.formatted).formatted,r.formatted);assert.ok(r.formatted.includes('- -'));assert.ok(r.formatted.includes('/ *'));assert.ok(r.formatted.includes('@>'));});
test('adjacent bind markers remain parameters',()=>{const q='select id from t where a=:id and b=@name and c=$1 and d::int=1 and e:=2 and f=@@version';const r=analyze(q);assert.deepEqual(tokenize(r.formatted).filter(t=>t.kind==='parameter').map(t=>t.value),[':id','@name','$1','@@version']);assert.ok(r.formatted.includes('::'));assert.ok(r.formatted.includes(':='));});
test('nested FROM/ON and commas stay scoped',()=>{const r=analyze('select coalesce(a,b), (select id from x join y using(id)) from fn(a,b) z join q on z.id=q.id');assert.deepEqual(r.findings,[]);});
// Independent preservation oracle: exact fixture literals/comments and stable output,
// plus normalized token stream. It never executes generated SQL.
for(let i=0;i<160;i++)test('generated formatting preservation '+i,()=>{
 const literal="'fictional ; FROM * UPDATE " + i + " '' value'", comment='/* comment WHERE ; '+i+' */';
 const q='sElEcT A.id, '+literal+' as note, '+(i+1)+'.25e-2 as amount '+comment+' fRoM Alpha A\nleft join Beta B on A.id=B.id where A.id=:p'+i+' and B.label=$tag$literal; '+i+'$tag$ order by A.id;';
 const result=analyze(q),second=analyze(result.formatted);
 assert.equal(second.formatted,result.formatted);assert.ok(result.formatted.includes(literal));assert.ok(result.formatted.includes(comment));assert.ok(result.formatted.includes('$tag$literal; '+i+'$tag$'));assert.deepEqual(result.findings,[]);
 const norm=t=>t.map(x=>x.kind==='word'?x.value.toUpperCase():x.value);
 assert.deepEqual(norm(tokenize(result.formatted)),norm(tokenize(q)));
});
