import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFootprint } from '../src/lib/terminal/footprint-model.ts'
import { footprintGeometry, footprintHit, visibleFootprintBars, drawFootprintChart, footprintVolume } from '../src/lib/terminal/footprint-chart.ts'
const trades = [{a:1,t:59000,p:100,q:1,m:true},{a:2,t:61000,p:100,q:1,m:true},{a:3,t:62000,p:101,q:3,m:false},{a:4,t:181000,p:102,q:2,m:false}]
const bars = buildFootprint(trades,{interval:60000,tick:1,rowTicks:1,ratio:3,minQty:0,end:190000})
const view = {width:1000,height:600,start:60000,end:240000,low:98,high:104,interval:60000,step:1,bars,selected:60000,units:'coin',showPoc:true,formatPrice:n=>n.toFixed(2)}
test('shared time and price axes invert correctly at desktop and phone widths',()=>{
 for(const width of [320,390,1000]){const g=footprintGeometry({...view,width});assert.ok(g.right>g.left);assert.ok(Math.abs(g.time(g.x(90000))-90000)<1e-8);assert.ok(Math.abs(g.price(g.y(101.5))-101.5)<1e-8)}
})
test('hover resolves the correct candle and fixed price bin, including fractional ticks',()=>{
 const g=footprintGeometry(view),h=footprintHit(view,{x:g.x(90000),y:g.y(101.5)});assert.equal(h.bar.t,60000);assert.equal(h.row.buy,3);assert.equal(h.row.sell,0)
 const small=buildFootprint([{a:1,t:61000,p:0.104,q:1,m:false}],{interval:60000,tick:.001,rowTicks:5,ratio:3,minQty:0,end:190000});const v={...view,bars:small,low:.09,high:.12,step:.005};const sg=footprintGeometry(v);assert.equal(footprintHit(v,{x:sg.x(90000),y:sg.y(.1025)}).row.price,.1)
})
test('empty time windows and unobserved price rows do not manufacture executions',()=>{
 const g=footprintGeometry(view);assert.equal(footprintHit(view,{x:g.x(150000),y:g.y(101)}),null);assert.equal(footprintHit(view,{x:g.x(90000),y:g.y(103.5)}).row,undefined);assert.equal(footprintHit(view,{x:0,y:0}),null)
 assert.deepEqual(visibleFootprintBars({...view,start:120000,end:180000}),[])
})
test('zoom reveals row numbers without regrouping or changing executions',()=>{
 const before=structuredClone(bars)
 const render=v=>{const texts=[];const ctx=new Proxy({fillText:(text,x,y)=>texts.push({text,x,y})},{get:(t,k)=>k in t?t[k]:()=>{}});drawFootprintChart(ctx,v);return texts.filter(t=>t.y<footprintGeometry(v).bottom).map(t=>t.text)}
 const small=render({...view,low:0,high:200,start:0,end:6000000});const detailed=render(view)
 assert.ok(!small.includes('3.00'));assert.ok(detailed.includes('3.00'));assert.deepEqual(bars,before)
})
test('tiny executed volumes remain nonzero in the display',()=>{assert.notEqual(footprintVolume(.000003),'0');assert.notEqual(footprintVolume(.000003),'0.00');assert.equal(footprintVolume(0),'0')})
