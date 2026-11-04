/* AutoTax period K: pure client-side estimate from the selected invoice window.
 * Blank opening stock is intentionally shown as K=9, and no purchases AND
 * missing purchases OR missing sales is K=1, per product rule. These are defaults, not measured ratios.
 */
(()=>{
 'use strict';
 function parseStock(raw){
  const s=String(raw??'').trim().replace(/\s+/g,'');
  if(!s)return null;
  // Vietnamese grouping separators; decimal comma is allowed.
  const n=Number(s.replace(/\./g,'').replace(',','.'));
  return Number.isFinite(n)&&n>=0?n:NaN;
 }
 function calculate(buy,sold,raw){
  const purchase=Number.isFinite(Number(buy))?Math.max(0,Number(buy)):0;
  const sales=Number.isFinite(Number(sold))?Math.max(0,Number(sold)):0;
  const stock=parseStock(raw);
  if(Number.isNaN(stock))return {value:null,mode:'invalid',purchase,sales,stock:null};
  if(purchase===0||sales===0)return {value:1,mode:'missing-side',purchase,sales,stock};
  if(stock===null)return {value:9,mode:'stock-blank',purchase,sales,stock:null};
  const denominator=purchase+stock;
  if(denominator<=0)return {value:null,mode:'zero-denominator',purchase,sales,stock,denominator};
  return {value:sales/denominator,mode:'calculated',purchase,sales,stock,denominator};
 }
 window.AutoTaxPeriodK=Object.freeze({parseStock,calculate});
})();
